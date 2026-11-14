// Downloads the public PDF forms listed in data/forms.json into sources/forms/ (git-ignored), then
// extracts their text, one entry per page, into data/form-pages.json (git-ignored too).
// The text makes the forms quotable: a card can cite a form the way it cites a PDS page, and
// check-data.mjs finds each quote in it. Forms are supplementary to the PDS.
//
// Run: node companion/tools/fetch-form-pdfs.mjs           (download, then extract)
//      node companion/tools/fetch-form-pdfs.mjs --extract (extract only, from files already downloaded)
//
// One ordinary request per form, a second apart. If the site answers with a bot-check page instead
// of a PDF, the script stops: download that form in a browser into sources/forms/<id>.pdf instead.
// Do not try to get around the check.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const outDir = new URL('sources/forms/', root);
mkdirSync(outDir, { recursive: true });
const forms = JSON.parse(readFileSync(new URL('data/forms.json', root), 'utf8')).forms.filter((f) => f.pdf);
const extractOnly = process.argv.includes('--extract');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

if (!extractOnly) {
  for (const f of forms) {
    const res = await fetch(f.pdf, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; forms-fetch)' } });
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok || bytes.subarray(0, 4).toString() !== '%PDF') {
      console.error(`!! ${f.id}: ${res.ok ? 'not a PDF (possibly a bot-check page)' : 'HTTP ' + res.status} from ${f.pdf}. Stopping.`);
      process.exit(1);
    }
    writeFileSync(new URL(`${f.id}.pdf`, outDir), bytes);
    console.log(`${String(bytes.length).padStart(9)} bytes  ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}  ${f.id}`);
    await sleep(1000);
  }
}

const pages = [], meta = [], missing = [];
for (const f of forms) {
  const file = new URL(`${f.id}.pdf`, outDir);
  if (!existsSync(file)) { missing.push(f.id); continue; }
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', fileURLToPath(file), '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const raw = text.split('\f');
  if (raw.at(-1).trim() === '') raw.pop();
  raw.forEach((t, i) => pages.push({ doc: 'form:' + f.id, page: i + 1, text: t.replace(/­/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }));
  // The issue date printed on the form, e.g. "Issue date: 17 November 2025".
  const m = text.replace(/\s+/g, ' ').match(/Issue date:? (\d{1,2}) (\w+) (20\d\d)/i);
  const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  meta.push({ id: 'form:' + f.id, title: f.title, url: f.pdf, issued: mi >= 0 ? `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null, pages: raw.length });
}
writeFileSync(new URL('data/form-pages.json', root), JSON.stringify({ retrieved: new Date().toISOString().slice(0, 10), forms: meta, pages }));
console.log(`Wrote data/form-pages.json: ${pages.length} pages from ${meta.length} forms (${meta.filter((x) => x.issued).length} with an issue date)` + (missing.length ? `; not downloaded: ${missing.join(', ')}` : ''));
