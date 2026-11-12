// Tests for the call companion: search quality, dates, and the quick drawdown calculator.
// Run after building: node --test companion/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const ctx = vm.createContext({ console });
for (const f of ['search.js', 'dates.js', 'parse.js', 'drawdown.js']) {
  vm.runInContext(readFileSync(new URL(`src/${f}`, root), 'utf8'), ctx, { filename: f });
}
const { CompanionSearch, CompanionDates: D, CompanionDrawdown, CompanionParse: P } = vm.runInContext('({ CompanionSearch, CompanionDates, CompanionDrawdown, CompanionParse })', ctx);
const data = JSON.parse(readFileSync(new URL('dist/companion-data.json', root), 'utf8'));
const engine = CompanionSearch.create(data);
const cases = JSON.parse(readFileSync(new URL('test/search-cases.json', root), 'utf8'));

test('search: each query finds its card in the top three', () => {
  const misses = [];
  for (const c of cases.cases) {
    const type = c.type ?? 'rule';
    const res = engine.search(c.q, { product: c.product ?? '' }).results.filter((r) => r.type === type).slice(0, 3).map((r) => r.id);
    if (!res.includes(c.expect)) misses.push(`"${c.q}" -> expected ${c.expect}, got [${res.join(', ')}]`);
  }
  assert.deepEqual(misses, [], `${misses.length} of ${cases.cases.length} queries missed:\n${misses.join('\n')}`);
});

test('search: misspelt queries still find their card', () => {
  const misses = [];
  for (const c of cases.typos) {
    const type = c.type ?? 'rule';
    const res = engine.search(c.q).results.filter((r) => r.type === type).slice(0, 3).map((r) => r.id);
    if (!res.includes(c.expect)) misses.push(`"${c.q}" -> expected ${c.expect}, got [${res.join(', ')}]`);
  }
  assert.deepEqual(misses, [], misses.join(' | '));
});

test('search: everyday situations find the right card', () => {
  const misses = [];
  for (const c of cases.situations) {
    const type = c.type ?? 'rule';
    const res = engine.search(c.q).results.filter((r) => r.type === type).slice(0, 3).map((r) => r.id);
    if (!res.includes(c.expect)) misses.push(`"${c.q}" -> expected ${c.expect}, got [${res.join(', ')}]`);
  }
  assert.deepEqual(misses, [], misses.join(' | '));
});

test('search: correctly spelt words are never "corrected"', () => {
  const changed = [];
  for (const c of cases.cases) {
    const fixes = engine.correctQuery(c.q).fixes;
    if (fixes.length) changed.push(`${c.q}: ${fixes.map((f) => f.from + '>' + f.to).join(' ')}`);
  }
  for (const r of data.rules) {
    const fixes = engine.correctQuery(r.q).fixes;
    if (fixes.length) changed.push(`${r.id}: ${fixes.map((f) => f.from + '>' + f.to).join(' ')}`);
  }
  assert.deepEqual(changed, []);
});

test('search: the product filter hides cards that do not apply', () => {
  for (const c of cases.hidden) {
    const res = engine.search(c.q, { product: c.product });
    assert.ok(!res.results.some((r) => r.type === 'rule' && r.id === c.absent), `${c.absent} should be hidden for ${c.product}`);
    assert.ok(res.hidden > 0, 'hidden count should be reported');
  }
});

test('search: numbers are normalised the same way in queries and text', () => {
  for (const [q, n] of [['$6,000', '6000'], ['6k', '6000'], ['six thousand', '6000'], ['$2.1 million', '2100000'], ['two point one million', '2100000'], ['$32,500', '32500']]) {
    assert.ok(CompanionSearch.normaliseNumbers(q).includes(n), `${q} -> ${CompanionSearch.normaliseNumbers(q)}`);
  }
});

test('search: unknown queries fall back to PDS passages', () => {
  const pages = engine.searchPages('credit union', 3);
  assert.ok(pages.length > 0);
  assert.equal(pages[0].doc, 'flexi');
});

test('search: every query runs quickly', () => {
  const t0 = performance.now();
  for (const c of cases.cases) engine.search(c.q);
  const per = (performance.now() - t0) / cases.cases.length;
  assert.ok(per < 20, `average ${per.toFixed(1)} ms per query`);
});

test('dates: Victorian holidays and business days', () => {
  const cal = D.makeCalendar([]);
  assert.equal(D.ymd(D.easterSunday(2027)), '2027-03-28');
  assert.equal(D.ymd(D.easterSunday(2028)), '2028-04-16');
  // Christmas 2027 is a Saturday: Mon 27 and Tue 28 Dec are holidays.
  assert.equal(cal.holidayName(D.parse('2027-12-27')), 'Christmas Day (additional)');
  assert.equal(cal.holidayName(D.parse('2027-12-28')), 'Boxing Day (additional)');
  assert.equal(cal.holidayName(D.parse('2027-03-08')), 'Labour Day');
  assert.equal(cal.holidayName(D.parse('2027-06-14')), "King's Birthday");
  assert.equal(cal.holidayName(D.parse('2027-11-02')), 'Melbourne Cup');
  // 5 business days from Wed 23 Dec 2026: Thu 24, (Fri 25 Christmas, Mon 28 Boxing Day substitute),
  // Tue 29, Wed 30, Thu 31, (Fri 1 Jan) -> Mon 4 Jan 2027.
  const r = cal.addBusinessDays(D.parse('2026-12-23'), 5);
  assert.equal(D.ymd(r.date), '2027-01-04');
  assert.deepEqual([...r.skipped], ['2026-12-25 Christmas Day', '2026-12-28 Boxing Day (additional)', "2027-01-01 New Year's Day"]);
  // Easter 2027: 2 business days from Thu 25 Mar -> Wed 31 Mar.
  assert.equal(D.ymd(cal.addBusinessDays(D.parse('2027-03-25'), 2).date), '2027-03-31');
});

test('dates: months and years keep the day where possible', () => {
  assert.equal(D.ymd(D.addMonths(D.parse('2026-01-31'), 16)), '2027-05-31');
  assert.equal(D.ymd(D.addMonths(D.parse('2026-08-31'), 6)), '2027-02-28');
  assert.equal(D.ymd(D.addYears(D.parse('2028-02-29'), 3)), '2031-02-28');
});

const rates = data.rates;
const calc = (o) => CompanionDrawdown.calculate({ freq: 'Monthly', type: 'Retirement Phase', ...o }, rates);

test('drawdown: PDS worked examples (same as the Excel checks)', () => {
  const gavin = calc({ dob: D.parse('1959-05-14'), start: D.parse('2026-10-01'), balance: 500000 });
  assert.equal(gavin.age, 67);
  assert.equal(gavin.daysLeft, 273);
  assert.equal(gavin.proMin, 18700);
  assert.equal(gavin.payments, 9);
  assert.equal(gavin.perMin, 2080);
  const stacey = calc({ dob: D.parse('1964-03-02'), start: D.parse('2026-07-01'), balance: 300000, type: 'TTR' });
  assert.equal(stacey.proMin, 12000);
  assert.equal(stacey.max, 30000);
  const bryn = calc({ dob: D.parse('1965-08-20'), start: D.parse('2027-04-01'), balance: 400000, type: 'TTR' });
  assert.equal(bryn.payments, 3);
  assert.equal(bryn.perMax, 13330);
});

test('drawdown: frequencies, leap year and warnings', () => {
  const base = { dob: D.parse('1959-05-14'), balance: 500000 };
  assert.equal(calc({ ...base, start: D.parse('2026-10-15'), freq: 'Quarterly' }).payments, 3);
  assert.equal(calc({ ...base, start: D.parse('2027-01-15'), freq: 'Half-yearly' }).payments, 1);
  assert.equal(calc({ ...base, start: D.parse('2026-10-01'), freq: 'Fortnightly', anchor: D.parse('2026-11-13') }).payments, 20);
  const est = calc({ ...base, start: D.parse('2026-10-01'), freq: 'Fortnightly' });
  assert.equal(est.payments, 20); // 273 days / 14, rounded
  assert.ok(est.warnings.some((w) => w.startsWith('Fortnightly payments left is an estimate')));
  assert.equal(calc({ ...base, start: D.parse('2028-06-10') }).daysYear, 366);
  assert.ok(calc({ ...base, start: D.parse('2027-06-10') }).warnings.some((w) => w.startsWith('Starts in June')));
  assert.ok(calc({ dob: D.parse('1952-03-10'), start: D.parse('2026-10-01'), balance: 500000 }).warnings.some((w) => w.includes('steps up from 5% to 6%')));
  assert.ok(calc({ ...base, start: D.parse('2026-10-01'), balance: 20000 }).warnings.some((w) => w.startsWith('Below the $25,000')));
  assert.ok(calc({ dob: D.parse('1970-01-01'), start: D.parse('2026-10-01'), balance: 300000, type: 'TTR' }).warnings.some((w) => w.includes('Under preservation age')));
});

test('data: every PDS quote resolved to a PDF page', () => {
  const missing = [];
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!n || typeof n !== 'object') return;
    if (typeof n.quote === 'string' && typeof n.doc === 'string' && !n.doc.startsWith('ato-') && !n.page) missing.push(path);
    for (const [k, v] of Object.entries(n)) if (v && typeof v === 'object') walk(v, `${path}.${k}`);
  };
  walk([data.rates, data.rules, data.forms, data.timeframes, data.explainers], 'bundle');
  assert.deepEqual(missing, []);
});

const iso = (d) => (d ? P.iso(d) : null);
test('parse: dates typed the way they appear on screen', () => {
  for (const [text, want] of [
    ['14/5/1959', '1959-05-14'], ['14/05/1959', '1959-05-14'], ['14.05.1959', '1959-05-14'], ['14-5-1959', '1959-05-14'],
    ['14051959', '1959-05-14'], ['1959-05-14', '1959-05-14'], ['14 May 1959', '1959-05-14'], ['14th may 1959', '1959-05-14'],
    ['May 14, 1959', '1959-05-14'], ['31/2/2027', null], ['hello', null],
  ]) assert.equal(iso(P.parseDate(text, 'past')), want, text);
  assert.equal(iso(P.parseDate('14/5/59', 'past')), '1959-05-14');
  assert.equal(iso(P.parseDate('1/10/26', 'any')), '2026-10-01');
  assert.equal(iso(P.parseDate('140559', 'past')), '1959-05-14');
  assert.ok(P.parseDate('today', 'any'));
});

test('parse: money and the member box', () => {
  for (const [text, want] of [['500000', 500000], ['$500,000.00', 500000], ['500k', 500000], ['1.2m', 1200000], ['$ 25 000', 25000], ['abc', null]]) {
    assert.equal(P.parseMoney(text), want, text);
  }
  assert.equal(P.parseAgeOrDate('67').age, 67);
  assert.equal(iso(P.parseAgeOrDate('14/5/1959').dob), '1959-05-14');
  assert.equal(P.parseAgeOrDate('5'), null);
});

test('parse: quick entry line', () => {
  const q = P.parseQuick('14/5/1959 500k 1/10/2026 TTR fortnightly');
  assert.equal(iso(q.dob), '1959-05-14');
  assert.equal(iso(q.start), '2026-10-01');
  assert.equal(q.balance, 500000);
  assert.equal(q.type, 'TTR');
  assert.equal(q.freq, 'Fortnightly');
  const q2 = P.parseQuick('age 67 $350,000 quarterly');
  assert.equal(q2.age, 67);
  assert.equal(q2.balance, 350000);
  assert.equal(q2.freq, 'Quarterly');
});

test('drawdown: works from an age when there is no date of birth', () => {
  const r = CompanionDrawdown.calculate({ age: 67, start: D.parse('2026-10-01'), balance: 500000, freq: 'Monthly', type: 'Retirement Phase' }, rates);
  assert.equal(r.proMin, 18700);
  assert.equal(r.pctNext, null);
  assert.ok(r.warnings.some((w) => w.startsWith('Age entered without a date of birth')));
});

test('data: ATO sources are supplementary only', () => {
  for (const r of data.rules) {
    assert.ok(r.sources.length > 0, `${r.id} has no PDS source`);
    for (const s of r.sources) assert.ok(!s.doc.startsWith('ato-'), `${r.id} cites the ATO as its main source`);
  }
  assert.ok(data.rules.filter((r) => r.ato && r.ato.length).length >= 20, 'expected ATO links on at least 20 cards');
});
