// Downloads the public PDS documents listed in data/sources.json into sources/,
// then records size, SHA-256 and the issue date printed on page 1.
// Run: node companion/tools/fetch-sources.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sourcesFile = new URL('data/sources.json', root);
const outDir = new URL('sources/', root);
mkdirSync(outDir, { recursive: true });

const sources = JSON.parse(readFileSync(sourcesFile, 'utf8'));
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

for (const doc of sources.documents) {
  const res = await fetch(doc.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pds-fetch)' } });
  if (!res.ok) throw new Error(`${doc.id}: HTTP ${res.status} for ${doc.url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error(`${doc.id}: not a PDF`);

  const file = new URL(`${doc.id}.pdf`, outDir);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const changed = existsSync(file) && doc.sha256 && doc.sha256 !== sha256;
  writeFileSync(file, bytes);

  // The issue date is printed on the first page as e.g. "28 September 2026".
  const firstPage = execFileSync('pdftotext', ['-f', '1', '-l', '2', '-enc', 'UTF-8', fileURLToPath(file), '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const m = firstPage.match(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)/);
  const printed = m ? `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;

  if (printed && printed !== doc.issued) {
    console.warn(`!! ${doc.id}: issue date changed from ${doc.issued} to ${printed}. Review rates.json and the rule cards.`);
  }
  if (changed) console.warn(`!! ${doc.id}: file content changed since the last fetch.`);

  Object.assign(doc, { issued: printed ?? doc.issued, bytes: bytes.length, sha256, fetched: new Date().toISOString().slice(0, 10) });
  console.log(`${doc.id.padEnd(6)} ${String(bytes.length).padStart(8)} bytes  issued ${doc.issued}  ${doc.title}`);
}

writeFileSync(sourcesFile, JSON.stringify(sources, null, 2) + '\n');
