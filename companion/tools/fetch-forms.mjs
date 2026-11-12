// Builds data/forms.json from the public "Complete a form" page, then adds the hand-written
// directions in data/forms-extra.json. Prints what was added or removed since the last run.
//
// Run:  node companion/tools/fetch-forms.mjs                 (fetches the live page)
//       node companion/tools/fetch-forms.mjs --file page.html (uses a page saved from a browser)
//
// The site sometimes answers scripts with a bot-check page. When that happens this script stops;
// save https://www.unisuper.com.au/tools-and-learning/forms-and-documents from a browser
// (Save page as > Webpage, HTML only) and pass it with --file. Do not try to get around the check.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const PAGE = 'https://www.unisuper.com.au/tools-and-learning/forms-and-documents';
const SITE = 'https://www.unisuper.com.au';
const root = new URL('../', import.meta.url);
const dataFile = new URL('data/forms.json', root);
const extraFile = new URL('data/forms-extra.json', root);

const fileArg = process.argv.indexOf('--file');
let html;
if (fileArg > 0) {
  html = readFileSync(process.argv[fileArg + 1], 'utf8');
} else {
  const res = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; forms-finder)' } });
  html = await res.text();
  if (res.ok && !/Pardon Our Interruption/i.test(html)) {
    mkdirSync(new URL('sources/', root), { recursive: true });
    writeFileSync(new URL('sources/forms-page.html', root), html);
  }
}
if (/Pardon Our Interruption/i.test(html) || !html.includes('Find by topic')) {
  console.error('The site returned its bot-check page, not the forms page. Save the page from a browser and re-run with --file <saved.html>.');
  process.exit(1);
}

const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();
const abs = (href) => (href.startsWith('http') ? href : SITE + href).replace(/\?.*$/, '').replace(/ /g, '%20');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const tabNames = [...html.matchAll(/<li tabindex="0" tabname="[^"]*">[\s\S]*?<\/li>/g)]
  .map((m) => [...m[0].matchAll(/<p>([^<]+)<\/p>/g)].map((x) => x[1].trim()).pop());
const tabStarts = [...html.matchAll(/class="tab"/g)].map((m) => m.index);
const GROUP = { Super: 'Super', Retirement: 'Pension', Insurance: 'Insurance', 'For Employers': 'Employer' };

const forms = [];
tabStarts.forEach((start, t) => {
  const seg = html.slice(start, tabStarts[t + 1] ?? html.indexOf('Important documents', start));
  const topicsAt = seg.indexOf('Find by topic');
  const topicChunks = seg.slice(topicsAt).split('class="toggle-header').slice(1);
  for (const chunk of topicChunks) {
    const topic = text(chunk.match(/field-heading">([\s\S]*?)<\/div>/)?.[1] ?? '');
    for (const item of chunk.split('class="component popular-item').slice(1)) {
      const title = text(item.match(/field-title">([\s\S]*?)<\/div>/)?.[1] ?? '');
      if (!title) continue;
      const pdfMatch = item.match(/<a href="([^"]+\.pdf)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      const links = item.split('popular-item__links')[1] ?? '';
      const online = [...links.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
        .map((m) => ({ url: abs(m[1]), label: text(m[2]) }))
        .filter((l) => !/\.pdf$/i.test(l.url) && !/sitecore\/media-library/i.test(l.url));
      const pdfLabel = pdfMatch ? text(pdfMatch[2]) : '';
      const size = pdfLabel.match(/PDF,?\s*([\d.]+\s*[KM]B)/i)?.[1] ?? null;
      const group = GROUP[tabNames[t]] ?? tabNames[t];
      forms.push({
        id: `${slug(group)}-${slug(title)}`,
        title,
        group,
        site_tab: tabNames[t],
        topic,
        summary: text(item.match(/field-summary">([\s\S]*?)<\/div>/)?.[1] ?? ''),
        pdf: pdfMatch ? abs(pdfMatch[1]) : null,
        pdf_name: pdfLabel.replace(/\s*[–-]\s*PDF.*$/i, '') || null,
        pdf_size: size,
        online: online[0]?.url ?? null,
        online_label: online[0]?.label ?? null,
      });
    }
  }
});

// The same form can appear under two topics; keep one record and list both topics.
const byId = new Map();
for (const f of forms) {
  const key = f.pdf ?? f.online ?? f.id;
  const seen = byId.get(key);
  if (seen) {
    if (!seen.topics.includes(f.topic)) seen.topics.push(f.topic);
  } else byId.set(key, { ...f, topics: [f.topic] });
}
let merged = [...byId.values()].map(({ topic, ...f }) => f);

// Ensure unique ids after de-duplication.
const used = new Set();
for (const f of merged) {
  let id = f.id, n = 2;
  while (used.has(id)) id = `${f.id}-${n++}`;
  f.id = id;
  used.add(id);
}

const extra = existsSync(extraFile) ? JSON.parse(readFileSync(extraFile, 'utf8')) : { forms: {}, manual: [] };
for (const f of merged) {
  const key = Object.keys(extra.forms).find((k) => f.id === k || (f.pdf && f.pdf.endsWith(k)));
  Object.assign(f, extra.forms[key] ?? {});
}
merged = merged.concat(extra.manual ?? []);

const previous = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')).forms : [];
const prevIds = new Set(previous.map((f) => f.id));
const nowIds = new Set(merged.map((f) => f.id));
const added = merged.filter((f) => !prevIds.has(f.id)).map((f) => f.id);
const removed = previous.filter((f) => !nowIds.has(f.id)).map((f) => f.id);
const unmatchedExtra = Object.keys(extra.forms).filter((k) => !merged.some((f) => f.id === k || (f.pdf && f.pdf.endsWith(k))));

writeFileSync(dataFile, JSON.stringify({
  note: 'Generated by tools/fetch-forms.mjs from the public forms page plus data/forms-extra.json. Edit forms-extra.json, not this file.',
  page: PAGE,
  generated: new Date().toISOString().slice(0, 10),
  forms: merged,
}, null, 2) + '\n');

console.log(`${merged.length} forms (${merged.filter((f) => f.pdf).length} with a PDF, ${merged.filter((f) => f.online).length} online)`);
if (previous.length) {
  console.log(added.length ? `Added: ${added.join(', ')}` : 'Added: none');
  console.log(removed.length ? `Removed: ${removed.join(', ')}` : 'Removed: none');
}
if (unmatchedExtra.length) console.warn(`!! forms-extra.json entries that no longer match a form: ${unmatchedExtra.join(', ')}`);
