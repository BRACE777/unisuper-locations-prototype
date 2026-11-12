// Turns each PDF in sources/ into plain text, one entry per PDF page, in data/pages.json.
// Uses pdftotext's reading-order mode, which joins two-column layouts correctly.
// Run: node companion/tools/extract-pages.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sources = JSON.parse(readFileSync(new URL('data/sources.json', root), 'utf8'));

const pages = [];
for (const doc of sources.documents) {
  const pdf = fileURLToPath(new URL(`sources/${doc.id}.pdf`, root));
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const raw = text.split('\f');
  if (raw.at(-1).trim() === '') raw.pop();
  raw.forEach((t, i) => {
    const clean = t
      .replace(/­/g, '')               // soft hyphens
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    pages.push({ doc: doc.id, page: i + 1, text: clean });
  });
  console.log(`${doc.id.padEnd(6)} ${raw.length} pages`);
}

writeFileSync(new URL('data/pages.json', root), JSON.stringify(pages));
console.log(`Wrote data/pages.json (${pages.length} pages)`);
