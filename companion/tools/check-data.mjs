// Checks every data file before a build:
//  - every {doc, quote} pair is found word for word in that PDS (and records its page)
//  - ids are unique, required fields are present
//  - explainers only quote dollar figures that appear in rates.json or their own source quotes
// Run: node companion/tools/check-data.mjs   (exit code 1 on any problem)
import { readFileSync, existsSync } from 'node:fs';
import { loadPages, locate } from './lib/quotes.mjs';
import { loadRules } from './lib/load-rules.mjs';

const root = new URL('../', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(`data/${f}`, root), 'utf8'));
const pages = loadPages(root);
const docs = new Set(read('sources.json').documents.map((d) => d.id));
const atoDocs = new Set(read('ato-excerpts.json').pages.map((a) => a.id));
atoDocs.forEach((id) => docs.add(id));
const webDocs = new Set(read('web-excerpts.json').pages.map((w) => w.id));
webDocs.forEach((id) => docs.add(id));
const problems = [];

function walkQuotes(file, node, path = file) {
  if (Array.isArray(node)) return node.forEach((n, i) => walkQuotes(file, n, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return;
  if (typeof node.doc === 'string' && typeof node.quote === 'string') {
    if (!docs.has(node.doc)) problems.push(`${path}: unknown document "${node.doc}"`);
    else if (locate(pages, node.doc, node.quote) === null) problems.push(`${path}: quote not found in ${node.doc}: "${node.quote.slice(0, 90)}"`);
  }
  for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walkQuotes(file, v, `${path}.${k}`);
}

function uniqueIds(file, list) {
  const seen = new Set();
  for (const item of list) {
    if (!item.id) problems.push(`${file}: item without id: ${JSON.stringify(item).slice(0, 80)}`);
    else if (seen.has(item.id)) problems.push(`${file}: duplicate id "${item.id}"`);
    seen.add(item.id);
  }
}

function requireFields(file, list, fields) {
  for (const item of list) for (const f of fields) {
    if (item[f] === undefined || item[f] === '' || (Array.isArray(item[f]) && !item[f].length)) {
      problems.push(`${file}: "${item.id}" is missing ${f}`);
    }
  }
}

const rates = read('rates.json');
walkQuotes('rates.json', rates);
uniqueIds('rates.json', rates.rates);

const optional = (f) => (existsSync(new URL(`data/${f}`, root)) ? read(f) : null);

const glossary = optional('glossary.json');
if (glossary) {
  const terms = new Set();
  for (const g of glossary.terms) {
    const k = g.term.toLowerCase();
    if (terms.has(k)) problems.push(`glossary.json: duplicate term "${g.term}"`);
    terms.add(k);
  }
}

const timeframes = optional('timeframes.json');
if (timeframes) {
  walkQuotes('timeframes.json', timeframes);
  uniqueIds('timeframes.json', timeframes.items);
  requireFields('timeframes.json', timeframes.items, ['task', 'timeframe', 'kind', 'say']);
  for (const t of timeframes.items) if (t.kind !== 'internal' && !t.source) problems.push(`timeframes.json: "${t.id}" has no source`);
}

const cards = loadRules(root);
walkQuotes('rules', cards.map((c) => ({ ...c, file: undefined })), 'rules');
uniqueIds('rules', cards);
requireFields('rules', cards, ['q', 'a', 'sources', 'topic']);
const cardIds = new Set(cards.map((c) => c.id));
for (const c of cards) for (const s of c.see) if (!cardIds.has(s)) problems.push(`rules/${c.file}: "${c.id}" links to missing card "${s}"`);
const PRODUCTS = new Set(['super', 'dbd', 'rp', 'ttr', 'bis']);
// The PDS is the primary source: a card's main sources must be PDS documents, ATO only in 'ato'.
for (const c of cards) {
  for (const s of c.sources ?? []) if (atoDocs.has(s.doc)) problems.push(`rules/${c.file}: "${c.id}" cites ATO as a primary source; move it to 'ato'`);
  for (const s of c.ato ?? []) if (!atoDocs.has(s.doc)) problems.push(`rules/${c.file}: "${c.id}" has a non-ATO document in 'ato'`);
}
for (const c of cards) for (const p of c.products) if (!PRODUCTS.has(p)) problems.push(`rules/${c.file}: "${c.id}" has unknown product "${p}"`);

const forms = optional('forms.json');
if (forms) {
  walkQuotes('forms.json', forms);
  uniqueIds('forms.json', forms.forms);
  requireFields('forms.json', forms.forms, ['title', 'group']);
  for (const f of forms.forms) if (!f.pdf && !f.online && !f.phone && !f.say) problems.push(`forms.json: "${f.id}" has no way to complete it`);
  for (const f of forms.forms) if (f.account_path?.verified && !f.account_source) problems.push(`forms.json: "${f.id}" marks its account path verified without a PDS quote`);
}

const explainers = optional('explainers.json');
if (explainers) {
  walkQuotes('explainers.json', explainers);
  uniqueIds('explainers.json', explainers.items);
  requireFields('explainers.json', explainers.items, ['title', 'simple', 'standard', 'detailed', 'general', 'source']);
  // A level is a list of blocks: a string is a numbered step; objects are lead, options, table, example or note.
  const blockOk = (b) => (typeof b === 'string' && b.trim()) ||
    (b && typeof b.lead === 'string') || (b && typeof b.example === 'string') || (b && typeof b.note === 'string') ||
    (b && Array.isArray(b.options) && b.options.length >= 2 && b.options.every((o) => o.name && o.text)) ||
    (b && b.table && Array.isArray(b.table.head) && Array.isArray(b.table.rows) && b.table.rows.length && b.table.rows.every((r) => r.length === b.table.head.length));
  for (const e of explainers.items) for (const v of ['simple', 'standard', 'detailed']) {
    if (!Array.isArray(e[v]) || e[v].length < 2) problems.push(`explainers.json: "${e.id}" ${v} must be a list of at least two blocks`);
    else e[v].forEach((b, i) => { if (!blockOk(b)) problems.push(`explainers.json: "${e.id}" ${v}[${i}] isn't a step, lead, options, table, example or note`); });
  }

  // 'links' must point at something that exists.
  const ruleIds = new Set(cards.map((r) => r.id));
  const procIds = new Set((optional('procedures.json')?.items ?? []).map((x) => x.id));
  const formIds = new Set((optional('forms.json')?.forms ?? []).map((x) => x.id));
  const tfIds = new Set((optional('timeframes.json')?.items ?? []).map((x) => x.id));
  const exIds = new Set(explainers.items.map((x) => x.id));
  for (const e of explainers.items) for (const l of e.links ?? []) {
    const ok = l.calc === 'drawdown' || ruleIds.has(l.rule) || procIds.has(l.proc) || formIds.has(l.form) || tfIds.has(l.timeframe) || exIds.has(l.explainer);
    if (!ok) problems.push(`explainers.json: "${e.id}" links to something that doesn't exist: ${JSON.stringify(l)}`);
  }
  for (const e of explainers.items) for (const s of e.also ?? []) {
    if (!/^(ato|web)-/.test(s.doc)) problems.push(`explainers.json: "${e.id}" has a PDS quote in 'also'; put it in 'source'`);
  }
  for (const e of explainers.items) for (const s of [].concat(e.source)) {
    if (/^(ato|web)-/.test(s.doc)) problems.push(`explainers.json: "${e.id}" cites ${s.doc} as a primary source; move it to 'also'`);
  }

  // Every dollar figure in an explainer must exist somewhere we have verified.
  const known = new Set();
  const addNums = (s) => { for (const m of String(s).matchAll(/\$?\d[\d,]*(?:\.\d+)?/g)) known.add(m[0].replace(/[$,]/g, '')); };
  for (const r of rates.rates) { addNums(r.value); addNums(r.quote); addNums(r.label); }
  for (const t of Object.values(rates.tables)) addNums(JSON.stringify(t));
  for (const e of explainers.items) {
    const own = new Set(known);
    for (const m of JSON.stringify([e.source, e.also ?? []]).matchAll(/\d[\d,]*(?:\.\d+)?/g)) own.add(m[0].replace(/,/g, ''));
    for (const m of (e.allow_numbers ?? [])) own.add(String(m).replace(/[$,]/g, ''));
    for (const field of ['simple', 'standard', 'detailed']) {
      for (const m of JSON.stringify(e[field] ?? []).matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) {
        const n = m[0].replace(/[$,]/g, '');
        if (!own.has(n)) problems.push(`explainers.json: "${e.id}" ${field} uses ${m[0]}, which isn't in rates.json, its source, or allow_numbers`);
      }
    }
  }
}

const procedures = optional('procedures.json');
if (procedures) {
  walkQuotes('procedures.json', procedures);
  uniqueIds('procedures.json', procedures.items);
  requireFields('procedures.json', procedures.items, ['title', 'topic', 'when', 'steps']);
  const formIds = new Set((forms ? forms.forms : []).map((f) => f.id));
  for (const p of procedures.items) for (const [i, st] of p.steps.entries()) {
    if (!st.do) problems.push(`procedures.json: "${p.id}" step ${i + 1} has no text`);
    if (st.form && !formIds.has(st.form)) problems.push(`procedures.json: "${p.id}" step ${i + 1} links to missing form "${st.form}"`);
    if (st.rule && !cardIds.has(st.rule)) problems.push(`procedures.json: "${p.id}" step ${i + 1} links to missing card "${st.rule}"`);
  }
}

const members = optional('members.json');
if (members) {
  const nums = new Set();
  const TYPES = new Set(['Accumulation 1', 'Accumulation 2', 'Personal Account', 'DBD', 'Retirement Phase', 'TTR', 'BIS']);
  for (const m of members.members) {
    if (!/^\d{3}$/.test(m.number)) problems.push(`members.json: "${m.name}" needs a 3-digit number`);
    if (nums.has(m.number)) problems.push(`members.json: duplicate member number ${m.number}`);
    nums.add(m.number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.dob)) problems.push(`members.json: ${m.number} has a bad date of birth`);
    for (const a of m.accounts) if (!TYPES.has(a.type)) problems.push(`members.json: ${m.number} has unknown account type "${a.type}"`);
  }
}

// Assumption markers {{id:words}} in any data file must name a registered assumption.
const assumptionIds = new Set(read('assumptions.json').items.map((a) => a.id));
for (const f of ['rates.json', 'timeframes.json', 'explainers.json', 'procedures.json', 'forms-extra.json']) {
  for (const m of JSON.stringify(read(f)).matchAll(/\{\{([a-z0-9-]+):/g)) if (!assumptionIds.has(m[1])) problems.push(`${f}: unknown assumption "${m[1]}"`);
}
for (const c of cards) for (const m of JSON.stringify(c).matchAll(/\{\{([a-z0-9-]+):/g)) if (!assumptionIds.has(m[1])) problems.push(`rules/${c.file}: unknown assumption "${m[1]}"`);

if (problems.length) {
  console.error(`${problems.length} problem(s):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log('Data checks passed.');
