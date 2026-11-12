// Serves companion/dist on http://localhost:5174 for previewing. The page also works opened
// straight from disk (double-click companion.html); this is only for testing in a browser pane.
//
// It also accepts POST /capture?id=ato-xxx from an ATO page open in a browser, and saves the
// page text to sources/ato/<id>.txt. The ATO blocks automated downloads, so its pages are read
// in a normal browser visit and captured this way; the quote checker then reads those files.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const ATO = 'https://www.ato.gov.au';

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/capture') {
    const cors = { 'Access-Control-Allow-Origin': ATO, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const id = url.searchParams.get('id') || '';
    const from = url.searchParams.get('url') || '';
    if (req.method !== 'POST' || !/^ato-[a-z0-9-]+$/.test(id) || !from.startsWith(ATO + '/')) { res.writeHead(400, cors).end('bad request'); return; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 2e6) break; }
    await mkdir(new URL('sources/ato/', root), { recursive: true });
    await writeFile(new URL(`sources/ato/${id}.txt`, root), `${from}\n${new Date().toISOString().slice(0, 10)}\n\n${body}`);
    console.log(`captured ${id} (${body.length} chars) from ${from}`);
    res.writeHead(200, cors).end('saved');
    return;
  }
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'companion.html';
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(new URL(path, dist));
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(5174, () => console.log('Call companion on http://localhost:5174'));
