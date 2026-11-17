// Tests for the call companion: search quality, dates, and the quick drawdown calculator.
// Run after building: node --test companion/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const ctx = vm.createContext({ console });
for (const f of ['search.js', 'dates.js', 'parse.js', 'drawdown.js', 'members.js', 'calcs.js']) {
  vm.runInContext(readFileSync(new URL(`src/${f}`, root), 'utf8'), ctx, { filename: f });
}
const { CompanionSearch, CompanionDates: D, CompanionDrawdown, CompanionParse: P, CompanionMembers: M, CompanionCalcs: C } = vm.runInContext('({ CompanionSearch, CompanionDates, CompanionDrawdown, CompanionParse, CompanionMembers, CompanionCalcs })', ctx);
const data = JSON.parse(readFileSync(new URL('dist/companion-data.json', root), 'utf8'));
const engine = CompanionSearch.create(data);
const strip = (t) => String(t).replace(/\{\{[a-z0-9-]+:/g, '').replace(/\}\}/g, '');
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
  assert.ok(est.warnings.some((w) => strip(w).startsWith('Fortnightly payments left is an estimate')));
  assert.equal(calc({ ...base, start: D.parse('2028-06-10') }).daysYear, 366);
  assert.ok(calc({ ...base, start: D.parse('2027-06-10') }).warnings.some((w) => strip(w).startsWith('Starts in June')));
  assert.ok(calc({ dob: D.parse('1952-03-10'), start: D.parse('2026-10-01'), balance: 500000 }).warnings.some((w) => strip(w).includes('steps up from 5% to 6%')));
  assert.ok(calc({ ...base, start: D.parse('2026-10-01'), balance: 20000 }).warnings.some((w) => strip(w).startsWith('Below the $25,000')));
  assert.ok(calc({ dob: D.parse('1970-01-01'), start: D.parse('2026-10-01'), balance: 300000, type: 'TTR' }).warnings.some((w) => strip(w).includes('Under preservation age')));
});

test('data: every PDS quote resolved to a PDF page', () => {
  const missing = [];
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!n || typeof n !== 'object') return;
    if (typeof n.quote === 'string' && typeof n.doc === 'string' && !/^(ato|web)-/.test(n.doc) && !n.page) missing.push(path);
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
  assert.ok(r.warnings.some((w) => strip(w).startsWith('Age entered without a date of birth')));
});

test('data: ATO sources are supplementary only', () => {
  for (const r of data.rules) {
    assert.ok(r.sources.length > 0, `${r.id} has no PDS source`);
    for (const s of r.sources) assert.ok(!s.doc.startsWith('ato-'), `${r.id} cites the ATO as its main source`);
  }
  assert.ok(data.rules.filter((r) => r.ato && r.ato.length).length >= 20, 'expected ATO links on at least 20 cards');
});

const TODAY = new Date(2026, 10, 13);
const member = (n) => data.members.find((m) => m.number === n);
const has = (n, re) => M.insights(member(n), data.rates, TODAY).some((i) => re.test(strip(i.text)));

test('members: each fictional member shows the alerts its scenario is about', () => {
  assert.ok(has('101', /No default insurance until 25/));
  assert.ok(has('102', /TTR maximum this year: \$30,000/));
  assert.ok(has('103', /Retirement Phase minimum this year: \$22,500/));
  assert.ok(has('104', /Division 293 likely/));
  assert.ok(has('105', /Division 296/));
  assert.ok(has('106', /first-year minimum \$18,700/));
  assert.ok(has('107', /BIS pension/));
  assert.ok(has('108', /Lapsing binding nomination expires on 10 Dec 2026/));
  assert.ok(has('109', /carried forward/));
  assert.ok(has('110', /up to \$21,250/));
  assert.ok(has('111', /insurance stops on 15 Jan 2027/));
  assert.ok(has('112', /claim a DASP by 10 Mar 2027/));
  assert.ok(has('113', /co-contribution of about \$500/));
});

test('members: drawdown prefill matches the member pension', () => {
  const nina = M.prefill(member('106'), TODAY);
  assert.equal(nina.balance, 500000);
  assert.equal(D.ymd(nina.start), '2026-10-01');
  const r = CompanionDrawdown.calculate({ dob: D.parse(member('106').dob), start: nina.start, balance: nina.balance, type: nina.type, freq: nina.freq }, data.rates);
  assert.equal(r.proMin, 18700);
  const pat = M.prefill(member('103'), TODAY);
  assert.equal(pat.freq, 'Fortnightly');
  assert.equal(D.ymd(pat.start), '2026-07-01');
  assert.equal(pat.balance, 450000);
});

test('checklists: every member note uses a known condition and fills its blanks', () => {
  const known = new Set(M.CONDITIONS);
  for (const p of data.procedures) for (const st of p.steps) for (const n of st.member ?? []) {
    assert.ok(known.has(n.cond), `${p.id}: unknown condition ${n.cond}`);
  }
  for (const m of data.members) {
    const c = M.context(m, data.rates, TODAY);
    for (const p of data.procedures) for (const st of p.steps) for (const n of st.member ?? []) {
      if (c.cond[n.cond]) assert.ok(!/\{\w+\}/.test(M.fill(n.text, c.vars)), `${p.id} / #${m.number}: unfilled blank in "${n.text}"`);
    }
  }
});

test('members: import validation catches bad files', () => {
  assert.deepEqual([...M.validate(data.members)], []);
  assert.ok(M.validate([{ number: '12', name: 'X', dob: '1990-01-01', accounts: [{ type: 'Accumulation 1' }] }]).length > 0);
  assert.ok(M.validate([{ number: '120', name: 'X', dob: '1990-01-01', accounts: [{ type: 'Super' }] }]).length > 0);
});

test('assumptions: every marker in the code and data names a registered assumption', () => {
  const ids = new Set(data.assumptions.map((a) => a.id));
  const used = new Set();
  for (const f of ['app.js', 'members.js', 'drawdown.js', 'figures.js', 'calcs.js']) {
    const src = readFileSync(new URL(`src/${f}`, root), 'utf8');
    for (const m of src.matchAll(/\{\{([a-z0-9-]+):/g)) used.add(m[1]);
    for (const m of src.matchAll(/assume(?:Span)?\('([a-z0-9-]+)'/g)) used.add(m[1]);
  }
  for (const m of JSON.stringify([data.rules, data.procedures, data.timeframes, data.explainers]).matchAll(/\{\{([a-z0-9-]+):/g)) used.add(m[1]);
  for (const id of used) assert.ok(ids.has(id), `unknown assumption ${id}`);
  const unused = [...ids].filter((id) => !used.has(id));
  assert.deepEqual(unused, [], 'registered but never shown');
});

test('explainers: three levels of steps and blocks, with links that resolve', () => {
  const kinds = ['lead', 'options', 'table', 'example', 'note'];
  const exists = {
    rule: new Set(data.rules.map((r) => r.id)), proc: new Set(data.procedures.map((p) => p.id)),
    form: new Set(data.forms.map((f) => f.id)), timeframe: new Set(data.timeframes.map((t) => t.id)), explainer: new Set(data.explainers.map((x) => x.id)),
  };
  for (const e of data.explainers) {
    for (const v of ['simple', 'standard', 'detailed']) {
      assert.ok(Array.isArray(e[v]) && e[v].length >= 2, `${e.id} ${v} needs at least two blocks`);
      for (const b of e[v]) assert.ok(typeof b === 'string' || kinds.some((k) => k in b), `${e.id} ${v}: unknown block ${JSON.stringify(b).slice(0, 60)}`);
    }
    for (const old of ['short', 'walk', 'example', 'kid', 'plain', 'member']) assert.equal(e[old], undefined, `${e.id} still has ${old}`);
    assert.ok(e.links && e.links.length, `${e.id} has no links`);
    for (const l of e.links) {
      const [kind, id] = Object.entries(l)[0];
      assert.ok(kind === 'calc' || exists[kind]?.has(id), `${e.id} links to missing ${kind} ${id}`);
    }
  }
  const drawdown = data.explainers.find((x) => x.id === 'drawdown-order');
  for (const v of ['simple', 'standard', 'detailed']) assert.equal(drawdown[v].find((b) => b.options).options.length, 3, 'drawdown order shows its three methods as options');
});

// Loads the page script against a stand-in DOM and renders every card. A time limit turns a
// rendering loop (which would freeze the real page) into a failed test.
function loadApp(patch) {
  const el = () => {
    const e = {
      value: '', textContent: '', innerHTML: '', hidden: false, style: { setProperty() {} }, offsetHeight: 60, offsetWidth: 300, files: null,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}, getAttribute: () => null, hasAttribute: () => false, removeAttribute() {}, addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [], contains: () => true, appendChild() {}, focus() {}, select() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0 }), closest: () => null, scrollIntoView() {},
    };
    e.querySelector = () => el();
    return e;
  };
  const els = {};
  const raw = JSON.parse(readFileSync(new URL('dist/companion-data.json', root), 'utf8'));
  const bundle = JSON.stringify(patch ? patch(raw) : raw);
  const document = {
    getElementById: (id) => (els[id] ||= Object.assign(el(), id === 'data' ? { textContent: bundle } : {})),
    querySelector: () => el(), querySelectorAll: () => [], createElement: () => el(), addEventListener() {},
    documentElement: el(), body: el(), activeElement: el(),
  };
  const window = { __companionTest: {}, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, scrollTo() {}, innerWidth: 1366, innerHeight: 768, isSecureContext: false };
  const appCtx = vm.createContext({ console, document, window, navigator: {}, setTimeout, clearTimeout, URL, Blob: class {} });
  for (const f of ['search.js', 'dates.js', 'parse.js', 'drawdown.js', 'figures.js', 'members.js', 'calcs.js', 'charts.js', 'app.js']) {
    vm.runInContext(readFileSync(new URL(`src/${f}`, root), 'utf8'), appCtx, { filename: f, timeout: 5000 });
  }
  appCtx.api = window.__companionTest.api;
  return appCtx;
}

test('page: every card, checklist and explainer renders without hanging', () => {
  const app = loadApp();
  const run = (code) => vm.runInContext(code, app, { timeout: 3000 });
  const types = { rule: 'rules', form: 'forms', timeframe: 'timeframes', explainer: 'explainers', procedure: 'procedures' };
  for (const [type, list] of Object.entries(types)) {
    for (const x of data[list]) {
      app.item = x;
      const html = type === 'procedure' ? run('api.procedureView(item)') : run(`api.RENDER.${type}(item)`);
      assert.ok(html.length > 100, `${type} ${x.id} rendered nothing`);
      assert.ok(!/\{\{[a-z0-9-]+:/.test(html), `${type} ${x.id} shows a raw assumption marker`);
      run(`api.state.sel = { type: '${type}', id: item.id }; api.sideHtml()`);
    }
  }
  // Checklists again with each test member loaded, so the member notes render too.
  for (const m of data.members) {
    app.num = m.number;
    run('api.setMember(num, "render")');
    for (const p of data.procedures) { app.item = p; run('api.procedureView(item)'); }
  }
  assert.ok(run('api.startHtml()').includes('What did the member ask?'));
  assert.ok(run('api.datesToolHtml()').includes('When is it due?'));
});

test('search: common words and small-word phrases do not hijack results', () => {
  const top = (q) => engine.search(q).results.slice(0, 3).map((r) => r.id);
  assert.notEqual(top('super')[0], 'conditions-of-release', '"super" alone should not jump to conditions of release');
  assert.ok(!top('when will I get my money').includes('lpr'), '"when will…" should not bring up estates');
  assert.ok(!top('how much does my employer pay').some((id) => /fee/.test(id)), '"how much does…" should not bring up fees');
  assert.deepEqual([...engine.correctQuery('dying of cancer').fixes], [], 'cancer is a real word, not a typo of cancel');
  assert.deepEqual([...engine.correctQuery('im sick and cant work anymore').fixes], []);
  const fix = engine.correctQuery('insurence').fixes[0];
  assert.equal(fix && fix.to, 'insurance', 'corrections show a whole word, not a stem');
});

test('search: the wording of the question picks the kind of answer', () => {
  const first = (q) => engine.search(q).results[0];
  assert.equal(first('how long does a rollover take').type, 'timeframe');
  assert.equal(first('how long for my lump sum').type, 'timeframe');
  assert.equal(first('what form to change my address').type, 'form');
  assert.equal(first('whats the difference between ttr and retirement phase').type, 'explainer');
  // The very first result, across every type, for questions consultants hear daily.
  for (const [q, id] of [['how young super', 'pa-eligibility'], ['sal sac', 'salary-sacrifice'], ['my husband died', 'manual-death-benefit-claim'],
    ['get rid of my insurance', 'opt-out'], ['backpacker super', 'dasp'], ['ex wife wants my super', 'family-law']]) {
    assert.equal(first(q).id, id, `"${q}" should put ${id} first`);
  }
});

test('drawdown: an age alone still settles preservation age', () => {
  const start = new Date(2026, 10, 1);
  const at = (age, type) => CompanionDrawdown.calculate({ age, start, balance: 300000, type, freq: 'Monthly' }, data.rates);
  assert.equal(at(62, 'TTR').preservationReached, true);
  assert.ok(!at(62, 'TTR').warnings.some((w) => /Under preservation age/.test(w)));
  assert.equal(at(58, 'TTR').preservationAge, 60);
  assert.ok(at(58, 'TTR').warnings.some((w) => /Under preservation age \(60\)/.test(w)));
});

test('parse: the member box rejects ages and birth dates that cannot be right', () => {
  assert.equal(P.parseAgeOrDate('14').age, 14);
  assert.equal(P.parseAgeOrDate('110').age, 110);
  assert.ok(P.parseAgeOrDate('114').error, '114 is a mistyped member number, not an age');
  assert.ok(P.parseAgeOrDate('12').error);
  const thisYear = new Date().getFullYear();
  assert.ok(P.parseAgeOrDate('1/1/' + thisYear).error, 'born this year');
  assert.ok(P.parseAgeOrDate('1/1/' + (thisYear - 5)).error, 'five years old');
  assert.ok(P.parseAgeOrDate('14/5/1959').dob);
});

test('search: every common misspelling of beneficiary is read as beneficiary', () => {
  for (const w of ['benificiary', 'beneficary', 'benefishary', 'benefeciary', 'benificary', 'beneficiery', 'benefitiary', 'benefiary', 'beneficairy', 'beneficiry', 'bennificiary', 'benefactor', 'nominee']) {
    const fix = engine.correctQuery(w).fixes[0];
    assert.equal(fix && fix.to, 'beneficiary', `${w} should be read as beneficiary`);
    assert.equal(engine.search(w).results[0].id, 'nom-types', `${w} should put the nomination types card first`);
  }
});

test('internal notes: shown from a local file, never in the published page', () => {
  const example = JSON.parse(readFileSync(new URL('data/internal.example.json', root), 'utf8'));
  const app = loadApp((d) => ({ ...d, internal: example, local: { ...d.local, internal: true } }));
  const run = (code) => vm.runInContext(code, app, { timeout: 3000 });
  app.item = data.rules.find((r) => r.id === 'hardship');
  assert.match(run('api.RENDER.rule(item)'), /Internal · team only/);
  app.item = data.rules.find((r) => r.id === 'claims');
  assert.match(run('api.RENDER.rule(item)'), /Refer to/);
  assert.match(run('api.startHtml()'), /Start of call · internal/);
  // Without the local file there is no internal box anywhere.
  const pub = loadApp();
  pub.item = data.rules.find((r) => r.id === 'hardship');
  assert.doesNotMatch(vm.runInContext('api.RENDER.rule(item)', pub, { timeout: 3000 }), /Internal · team only/);
  // The published page is built from the public data only.
  const site = readFileSync(new URL('site/index.html', root), 'utf8');
  assert.doesNotMatch(site, /"internal":\{|"kind":"internal"/);
  assert.equal(data.internal, null);
});

test('missed searches: member numbers, TFNs and emails are blanked before saving', () => {
  const app = loadApp();
  const scrub = (s) => vm.runInContext(`api.scrub(${JSON.stringify(s)})`, app);
  assert.equal(scrub('member 12345678 withdrawal'), 'member ###### withdrawal');
  assert.equal(scrub('tfn 123 456 789'), 'tfn ######');
  assert.equal(scrub('email jo@example.com about split'), 'email [email] about split');
  assert.equal(scrub('ttr max 10%'), 'ttr max 10%');
});

test('calculators: caps, top-ups, spouse offset, Division 293 and cover by age', () => {
  const r = data.rates;
  const c = C.caps({ salary: 100000, employerRate: 0.12, salarySacrifice: 10000, tsb: 800000, age: 50, ncc: 0 }, r);
  assert.equal(c.cc, 22000); assert.equal(c.ccLeft, 10500);
  assert.equal(c.nccAvailable, 390000); assert.equal(c.period, 'Three years');
  assert.equal(C.caps({ tsb: 1900000, age: 50 }, r).nccAvailable, 260000);
  assert.equal(C.caps({ tsb: 2000000, age: 50 }, r).nccAvailable, 130000);
  assert.equal(C.caps({ tsb: 2200000, age: 50 }, r).nccAvailable, 0);
  assert.equal(C.caps({ tsb: 800000, age: 76 }, r).nccAvailable, 130000, 'no bring-forward at 75+');
  assert.equal(C.caps({ cc: 0, tsb: 600000, carryForward: 20000 }, r).ccAvailable, 32500, 'no carry-forward from $500,000');
  assert.equal(C.caps({ tsb: 400000, carryForward: 20000 }, r).ccAvailable, 52500);

  assert.equal(C.topups({ income: 40000, ncc: 1000 }, r).co, 500);
  assert.equal(C.topups({ income: 56793, ncc: 1000 }, r).co, 250, 'halfway through the taper');
  assert.equal(C.topups({ income: 64293, ncc: 1000 }, r).co, 0);
  assert.equal(C.topups({ income: 40000, ncc: 400 }, r).co, 200, '50 cents a dollar');
  assert.equal(C.topups({ income: 30000, cc: 5000 }, r).listo, 500);
  assert.equal(C.topups({ income: 30000, cc: 2000 }, r).listo, 300);
  assert.equal(C.topups({ income: 37001, cc: 2000 }, r).listo, 0);

  assert.equal(C.spouseOffset({ spouseIncome: 30000, contribution: 3000 }, r).offset, 540);
  assert.equal(C.spouseOffset({ spouseIncome: 38500, contribution: 3000 }, r).offset, 270);
  assert.equal(C.spouseOffset({ spouseIncome: 40000, contribution: 3000 }, r).offset, 0);
  assert.equal(C.spouseOffset({ spouseIncome: 20000, contribution: 1000 }, r).offset, 180);

  assert.equal(C.div293({ income: 240000, cc: 30000 }, r).tax, 3000);
  assert.equal(C.div293({ income: 300000, cc: 30000 }, r).tax, 4500);
  assert.equal(C.div293({ income: 200000, cc: 30000 }, r).applies, false);
  // Excess over the cap isn't a Division 293 contribution (How super works p12).
  const high = C.div293({ income: 300000, cc: 60000 }, r);
  assert.equal(high.counted, 32500); assert.equal(high.excess, 27500); assert.equal(high.tax, 4875);
  assert.equal(C.div293({ income: 3000000, cc: 32500 }, r).tax, 4875, 'a $3 million income');


  assert.equal(C.cover({ age: 35, units: 10 }, r).cover, 266000, 'the PDS example');
  assert.equal(C.cover({ age: 55, units: 10 }, r).cover, 86000);
  assert.equal(C.cover({ age: 38, units: 1 }, r).peak.age, 38);
  assert.equal(C.cover({ units: 10 }, r).curve.length, 61);

  // Income Protection: the PDS examples (Angela $120,000 -> 19 units; Kent $90,000 -> 14 units).
  assert.equal(C.ipCover({ salary: 120000 }, r).allowed, 19);
  assert.equal(C.ipCover({ salary: 90000 }, r).allowed, 14);
  assert.equal(C.ipCover({ salary: 400000 }, r).allowed, 23, 'never more than 23 units');
  const ip = C.ipCover({ salary: 120000, age: 35, wait: '90', period: '2y', sex: 'm' }, r);
  assert.equal(ip.units, 19); assert.equal(ip.weekly, 1900);
  assert.equal(ip.rate, 3.21); assert.equal(ip.premium, 60.99);
  assert.equal(Math.round(ip.benefit), 8233); assert.equal(ip.cash, 7300, '73% of $10,000 a month');
  assert.equal(Math.round(ip.toSuper), 933);
  assert.equal(C.ipCover({ salary: 120000, age: 50, wait: '30', period: '65', sex: 'f', units: 10 }, r).premium, 5404.9, 'to-65, 30-day, female, age 50: $540.49 a unit');
  const late = C.ipCover({ salary: 120000, age: 64, wait: '90', period: '65', sex: 'm', units: 10 }, r);
  assert.equal(late.converted, true); assert.equal(late.rate, 27.56, 'to-65 becomes two-year rates from 63');
  assert.equal(C.ipCover({ age: 66, units: 1 }, r).curve.length, 53);
});

test('calculators: every calculator renders its result with sample values', () => {
  const app = loadApp();
  const samples = {
    caps: { salary: '95000', employerRate: '0.17', salarySacrifice: '8000', personal: '', tsb: '450000', carryForward: '12000', age: '52', ncc: '20000' },
    topups: { income: '52000', ncc: '1000', cc: '4500' }, spouse: { spouseIncome: '38500', contribution: '3000' },
    div293: { income: '240000', cc: '30000' }, cover: { age: '35', units: '10' }, ip: { salary: '120000', age: '35', units: '', wait: '90', period: '2y', sex: 'm' },
  };
  for (const [id, raw] of Object.entries(samples)) {
    app.raw = raw; app.id = id;
    const html = vm.runInContext(`(() => { const d = api.SIMPLE[id], v = {};
      d.fields.forEach((f) => { const x = raw[f.k]; v[f.k] = f.kind === 'choice' ? x : f.kind === 'rate' ? +x : (f.kind === 'age' || f.kind === 'number') ? (x === '' ? '' : parseInt(x, 10)) : (x === '' ? null : +x); });
      const r = d.compute(v); return api.marks(d.out(raw, r)) + d.summary(raw, r); })()`, app, { timeout: 2000 });
    assert.ok(html.length > 100, `${id} rendered nothing`);
    assert.doesNotMatch(html, /\{\{[a-z0-9-]+:|NaN|undefined/, `${id} shows a raw marker, NaN or undefined`);
  }
});

test('sliders: round steps, and latching onto caps and thresholds', () => {
  const app = loadApp();
  const latch = (key, v) => vm.runInContext(`api.latch(api.SLIDE[${JSON.stringify(key)}](), ${v})`, app);
  assert.equal(latch('caps.salary', 95400), 95000, 'salary in $1,000 steps');
  assert.equal(latch('caps.tsb', 1851000), 1840000, 'latches onto the $1.84m bring-forward threshold');
  assert.equal(latch('caps.tsb', 1500000), 1500000);
  assert.equal(latch('caps.salarySacrifice', 32100), 32500, 'latches onto the concessional cap');
  assert.equal(latch('topups.income', 49100), 49293, 'latches onto the co-contribution lower threshold');
  assert.equal(latch('topups.income', 45200), 45000);
  assert.equal(latch('div293.income', 247000), 250000);
  assert.equal(latch('cover.age', 37), 37, 'whole years stay exact (38 is a tick mark)');
  assert.equal(latch('cover.units', 10), 10);
  assert.equal(latch('caps.salary', -500), 0, 'stays in range');
  assert.equal(latch('caps.salary', 641200), 640000, '$5,000 steps between $300,000 and $1 million');
  assert.equal(latch('caps.salary', 1234000), 1230000, '$10,000 steps above $1 million');
  assert.equal(latch('caps.salary', 3000000), 3000000, 'reaches $3 million');
  const pos = (key, v) => vm.runInContext(`api.toPos(api.SLIDE[${JSON.stringify(key)}](), ${v})`, app);
  assert.equal(pos('caps.salary', 300000), 0.6, '$300,000 sits 60% along the stretched salary slider');
  assert.equal(vm.runInContext(`api.toValue(api.SLIDE['caps.salary'](), 0.85)`, app), 1000000);
  // No two latch points closer than the latch distance, so every one can be reached.
  for (const key of vm.runInContext('Object.keys(api.SLIDE)', app)) {
    const cfg = vm.runInContext(`api.SLIDE[${JSON.stringify(key)}]()`, app);
    if (cfg.ticksOnly) continue;
    const snaps = (cfg.snaps || []).filter((x) => x != null).sort((a, b) => a - b);
    for (let i = 1; i < snaps.length; i++) assert.ok(pos(key, snaps[i]) - pos(key, snaps[i - 1]) > 0.03 || key === 'dd.chosen', `${key}: ${snaps[i - 1]} and ${snaps[i]} too close`);
  }
});

test('sliders: every slider draws, with its tick marks', () => {
  const app = loadApp();
  for (const key of vm.runInContext('Object.keys(api.SLIDE)', app)) {
    const html = vm.runInContext(`api.sliderHtml(${JSON.stringify(key)}, 'x-' + ${JSON.stringify(key.replace('.', '-'))}, '12345', ${!/age|units/.test(key)})`, app, { timeout: 2000 });
    assert.match(html, /type="range"/, `${key} drew no slider`);
    assert.doesNotMatch(html, /NaN|undefined/, `${key}: ${html.slice(0, 120)}`);
  }
});

test('search: the member\'s product and age move their cards up', () => {
  const first = (q, o) => engine.search(q, o).results[0].id;
  const top3 = (q, o) => engine.search(q, o).results.slice(0, 3).map((r) => r.id);
  assert.equal(first('withdrawal', { product: 'ttr', products: ['ttr'] }), 'ttr-lump-sum', 'a TTR member asking about a withdrawal');
  assert.equal(first('withdrawal', { product: 'rp', products: ['rp'] }), 'pension-lump-sum');
  assert.equal(first('insurance', { product: 'dbd', products: ['dbd'] }), 'ip-dbd');
  assert.ok(engine.search('contributions', { age: 70 }).results.slice(0, 4).some((r) => r.id === 'contrib-age'), 'age 70: which contributions are accepted');
  assert.ok(!top3('contributions', { age: 30 }).includes('contrib-age'));
  assert.ok(top3('can i get my super', { age: 55 }).includes('preservation-age'));
  // Ranking changes the order, never what's found.
  const plain = engine.search('withdrawal').results.map((r) => r.id).sort();
  const ranked = engine.search('withdrawal', { products: ['ttr'], age: 62 }).results.map((r) => r.id).sort();
  assert.deepEqual(ranked, plain);
});
