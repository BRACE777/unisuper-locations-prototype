// Builds the call companion:
//   1. checks every data file (quotes, ids, figures)
//   2. adds the PDF page number to every quoted source
//   3. writes dist/companion-data.json and one self-contained dist/companion.html
// Run: node companion/build.mjs        (after tools/fetch-sources.mjs and tools/extract-pages.mjs)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPages, locate } from './tools/lib/quotes.mjs';
import { loadRules } from './tools/lib/load-rules.mjs';

const root = new URL('./', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const readOptional = (f) => (existsSync(new URL(f, root)) ? read(f) : null);

const check = spawnSync(process.execPath, [fileURLToPath(new URL('tools/check-data.mjs', root))], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);

const pages = loadPages(root);
function addPages(node) {
  if (Array.isArray(node)) return node.forEach(addPages);
  if (!node || typeof node !== 'object') return;
  if (typeof node.doc === 'string' && typeof node.quote === 'string') node.page = locate(pages, node.doc, node.quote);
  for (const v of Object.values(node)) if (v && typeof v === 'object') addPages(v);
}

const sources = read('data/sources.json');
const rates = read('data/rates.json');
const glossary = read('data/glossary.json');
const rules = loadRules(root).map(({ file, ...c }) => c);
const forms = read('data/forms.json');
const timeframes = read('data/timeframes.json');
const explainers = read('data/explainers.json');
const holidays = read('data/holidays.json');

// Local-only additions (git-ignored): team shorthand and internal processing times.
const localGlossary = readOptional('data/glossary.local.json');
if (localGlossary) {
  glossary.terms.push(...(localGlossary.terms ?? []));
  glossary.phrases.push(...(localGlossary.phrases ?? []));
}
const localTimeframes = readOptional('data/timeframes.local.json');
if (localTimeframes) timeframes.items.push(...localTimeframes.items.map((t) => ({ kind: 'internal', ...t })));

const bundle = {
  built: new Date().toISOString().slice(0, 10),
  sources: sources.documents.map(({ id, title, issued, url }) => ({ id, title, issued, url, kind: 'pds' }))
    .concat(read('data/ato-excerpts.json').pages.map(({ id, title, url, updated }) => ({ id, title, url, updated, kind: 'ato', retrieved: read('data/ato-excerpts.json').retrieved })))
    .concat(read('data/web-excerpts.json').pages.map(({ id, title, url, retrieved }) => ({ id, title, url, kind: 'web', retrieved: retrieved || read('data/web-excerpts.json').retrieved })))
    .concat((readOptional('data/form-pages.json') || { forms: [] }).forms.map(({ id, title, url, issued }) => ({ id, title, url, issued, kind: 'form' }))),
  rates, glossary, rules,
  forms: forms.forms, formsPage: forms.page, formsGenerated: forms.generated,
  timeframes: timeframes.items, explainers: explainers.items, holidays: holidays.extra,
  procedures: read('data/procedures.json').items, assumptions: read('data/assumptions.json').items, members: read('data/members.json').members,
  // PDS text only: the page's full-text search is over the PDS. Form text is for checking quotes, not shipped.
  pages: pages.filter(({ doc }) => !doc.startsWith('form:')).map(({ doc, page, text }) => ({ doc, page, text: text.replace(/\r/g, '').replace(/[ \t]+/g, ' ') })),
  local: { glossary: !!localGlossary, timeframes: !!localTimeframes },
};
addPages([bundle.rates, bundle.rules, bundle.forms, bundle.timeframes, bundle.explainers, bundle.procedures]);

const dist = new URL('dist/', root);
mkdirSync(dist, { recursive: true });
writeFileSync(new URL('companion-data.json', dist), JSON.stringify(bundle));

const src = (f) => readFileSync(new URL(`src/${f}`, root), 'utf8');
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
// Fonts (SIL Open Font Licence, see src/fonts/OFL-*.txt) are embedded so the page looks the
// same offline.
const font = (file, family, weights) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weights};font-display:swap;` +
  `src:url(data:font/woff2;base64,${readFileSync(new URL(`src/fonts/${file}`, root)).toString('base64')}) format("woff2")}`;
const fonts = font('schibsted-grotesk-latin.woff2', 'Schibsted Grotesk', '400 700') + font('azeret-mono-latin.woff2', 'Azeret Mono', '400 500');
const html = src('companion.html')
  .replace('/*STYLES*/', () => src('styles.css').replace('/*FONTS*/', () => fonts))
  .replace('/*DATA*/', () => safe(JSON.stringify(bundle)))
  .replace('/*SCRIPTS*/', () => safe(['search.js', 'dates.js', 'parse.js', 'drawdown.js', 'figures.js', 'members.js', 'app.js'].map(src).join('\n;\n')));
writeFileSync(new URL('companion.html', dist), html);
// site/ is committed and published to GitHub Pages at /companion/ (see the repo's build.js).
const site = new URL('site/', root);
mkdirSync(site, { recursive: true });
writeFileSync(new URL('index.html', site), html);

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Built dist/companion.html (${kb} KB): ${rules.length} rule cards, ${bundle.forms.length} forms, ${bundle.timeframes.length} timeframes, ${bundle.explainers.length} explainers, ${bundle.pages.filter((p) => p.page > 0).length} PDS pages, ${bundle.sources.filter((d) => d.kind === 'ato').length} ATO pages and ${bundle.sources.filter((d) => d.kind === 'form').length} PDF forms (supplementary).`);
