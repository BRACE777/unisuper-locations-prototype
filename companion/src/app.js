// Call companion UI. Reads the inlined data bundle, renders search results and browse views.
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var engine = CompanionSearch.create(DATA);
  var cal = CompanionDates.makeCalendar(DATA.holidays);
  var DOCS = {};
  DATA.sources.forEach(function (s) { DOCS[s.id] = s; });
  var RULES = {};
  DATA.rules.forEach(function (r) { RULES[r.id] = r; });
  var TIMEFRAMES = {};
  DATA.timeframes.forEach(function (t) { TIMEFRAMES[t.id] = t; });

  var PRODUCTS = [
    { id: '', label: 'All products' }, { id: 'super', label: 'Super (Acc 1, Acc 2, PA)', short: 'Super' }, { id: 'dbd', label: 'DBD' },
    { id: 'rp', label: 'Retirement Phase' }, { id: 'ttr', label: 'TTR' }, { id: 'bis', label: 'BIS' }
  ];
  var TABS = [
    { id: 'all', label: 'Search', types: null }, { id: 'rule', label: 'Rules', types: ['rule'] },
    { id: 'form', label: 'Forms', types: ['form'] }, { id: 'timeframe', label: 'Timeframes', types: ['timeframe'] },
    { id: 'explainer', label: 'Explainers', types: ['explainer'] }, { id: 'calc', label: 'Drawdown calculator', types: [] }
  ];
  var TYPE_LABEL = { procedure: 'Checklists', rule: 'Rules', form: 'Forms', timeframe: 'Timeframes', explainer: 'Explainers' };
  TABS.splice(1, 0, { id: 'proc', label: 'Checklists', types: ['procedure'] });
  var PROCS = {};
  DATA.procedures.forEach(function (p) { PROCS[p.id] = p; });
  var FORMS = {};
  DATA.forms.forEach(function (f) { FORMS[f.id] = f; });
  var MEMBERS = {};
  DATA.members.forEach(function (m) { MEMBERS[m.number] = m; });

  var store = {
    get: function (k) { try { return window.localStorage.getItem('companion.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem('companion.' + k, v); } catch (e) { /* storage unavailable */ } }
  };

  // Every launch starts on the quiet start screen; 'recent' is what was opened during this call.
  var state = { member: null, stripOpen: false, ticks: {}, q: '', product: '', tab: 'all', memberText: '', age: null, dob: null, showHidden: false, calcPreset: null,
    sel: null, pinned: false, recent: [], railList: [] };

  var $ = function (id) { return document.getElementById(id); };

  // ----- light / dark / automatic -----
  var THEMES = ['auto', 'light', 'dark'];
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var b = document.getElementById('theme');
    if (b) {
      b.setAttribute('data-mode', t);
      b.querySelector('span').textContent = { auto: 'Auto', light: 'Light', dark: 'Dark' }[t];
      b.title = 'Theme: ' + t + ' (click to change)';
    }
  }
  var theme = store.get('theme') || 'auto';
  applyTheme(theme);
  document.getElementById('theme').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set('theme', theme);
    applyTheme(theme);
  });
  var qEl = $('q'), main = $('main');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return n == null ? '–' : '$' + Math.round(n).toLocaleString('en-AU'); }
  function pct(p) { return Math.round(p * 1000) / 10 + '%'; }
  function fmtDate(d) { return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function issued(id) {
    var d = DOCS[id];
    if (!d || !d.issued) return '';
    var p = d.issued.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ----- context: age and DOB -----
  function currentAge() {
    if (state.dob) return CompanionDrawdown.ageOn(CompanionDates.parse(state.dob), new Date());
    return state.age;
  }

  // ----- sources -----
  function sourceHtml(s) {
    var d = DOCS[s.doc] || { title: s.doc, url: '#' };
    var href = d.url + (s.page ? '#page=' + s.page : '');
    return '<div class="src"><a href="' + esc(href) + '" target="_blank" rel="noopener"><span class="src-doc">' + esc(d.title) + '</span>' +
      '<span class="src-meta">' + esc(issued(s.doc)) + (s.page ? ' · p.' + s.page : '') + ' ↗</span></a>' +
      '<q>' + esc(s.label || s.quote) + '</q></div>';
  }
  function sourcesHtml(list, ato) {
    // A card sourced only from a form or the website has no PDS line.
    return '<footer class="sources">' + (list.length ? '<span class="label">' + (list.length > 1 ? 'Sources' : 'Source') + ' · UniSuper PDS</span>' : '') + list.map(sourceHtml).join('') +
      (ato && ato.length ? atoHtml(ato) : '') + '</footer>';
  }
  // Supplementary material (ATO pages, UniSuper's public website): shown under the PDS source, never instead of it.
  function atoHtml(list) {
    return [['form', 'UniSuper form · supplementary'], ['web', 'UniSuper website · supplementary'], ['ato', 'ATO · supplementary']].map(function (k) {
      var group = list.filter(function (s) { return (DOCS[s.doc] || {}).kind === k[0]; });
      return group.length ? '<div class="ato"><span class="label">' + k[1] + '</span>' + group.map(function (s) {
        var d = DOCS[s.doc];
        var meta = d.kind === 'form' ? (d.issued ? 'issued ' + esc(isoText(d.issued)) : 'form') + (s.page ? ' · p.' + s.page : '')
          : (d.updated ? 'updated ' + esc(d.updated) + ' · ' : '') + 'read ' + esc(isoText(d.retrieved));
        return '<div class="src"><a href="' + esc(d.url + (d.kind === 'form' && s.page ? '#page=' + s.page : '')) + '" target="_blank" rel="noopener"><span class="src-doc">' + esc(d.title) + (d.kind === 'form' ? ' (form)' : '') + '</span>' +
          '<span class="src-meta">' + meta + ' ↗</span></a>' +
          '<q>' + esc(s.quote) + '</q></div>';
      }).join('') + '</div>' : '';
    }).join('');
  }
  function isoText(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function sourceText(s) {
    var d = DOCS[s.doc] || { title: s.doc };
    return d.title + ' (' + issued(s.doc) + ')' + (s.page ? ', PDF p. ' + s.page : '') + ': "' + s.quote + '"';
  }

  // ----- hover-over terms: explainers and acronyms -----
  var EXPLAINERS = {};
  DATA.explainers.forEach(function (e) { EXPLAINERS[e.id] = e; });
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var TERM_TO_ID = {}, termAlts = [];
  DATA.explainers.forEach(function (e) {
    (e.terms || []).forEach(function (t) { var k = esc(t).toLowerCase(); TERM_TO_ID[k] = e.id; termAlts.push(reEsc(esc(t))); });
  });
  termAlts.sort(function (a, b) { return b.length - a.length; });
  var TERM_RE = termAlts.length ? new RegExp('(?<![A-Za-z0-9-])(?:' + termAlts.join('|') + ')(?![A-Za-z0-9-])', 'gi') : null;
  var ACRONYMS = {};
  DATA.glossary.terms.forEach(function (g) { if (/^[A-Z][A-Z0-9]{1,5}$/.test(g.term)) ACRONYMS[g.term] = g.means; });
  var ACR_RE = new RegExp('(?<![A-Za-z0-9-])(?:' + Object.keys(ACRONYMS).sort(function (a, b) { return b.length - a.length; }).join('|') + ')(?![A-Za-z0-9-])', 'g');

  // Wraps explainer phrases and acronyms in already-escaped text. Each one is marked once per
  // card (`seen`), so a card isn't covered in underlines.
  // ----- assumptions: a double-brace marker (assumption id, colon, words) becomes a red dotted underline with a hover-over -----
  var ASSUMPTIONS = {};
  DATA.assumptions.forEach(function (a) { ASSUMPTIONS[a.id] = a; });
  var MARK_RE = /\{\{([a-z0-9-]+):([^}]*)\}\}/g;
  function assumeSpan(id, html) { return '<span class="assume" data-assumption="' + id + '" tabindex="0">' + html + '</span>'; }
  function marks(escaped) { return escaped.replace(MARK_RE, function (all, id, words) { return ASSUMPTIONS[id] ? assumeSpan(id, words) : words; }); }
  function rich(text) { return marks(esc(text)); }
  function plain(text) { return String(text == null ? '' : text).replace(MARK_RE, '$2'); }

  function annotate(escaped, seen) {
    // Assumption markers are kept whole; terms and acronyms are found in the text around them.
    // A local regex: the recursive calls below must not share (and reset) a global regex's position,
    // or the loop finds the same marker forever and the page freezes.
    var markRe = new RegExp(MARK_RE.source, 'g'), mm = markRe.exec(escaped);
    if (mm) {
      var parts = [], last = 0;
      for (; mm; mm = markRe.exec(escaped)) { parts.push(annotate(escaped.slice(last, mm.index), seen)); parts.push(ASSUMPTIONS[mm[1]] ? assumeSpan(mm[1], mm[2]) : mm[2]); last = mm.index + mm[0].length; }
      return parts.join('') + annotate(escaped.slice(last), seen);
    }
    var found = [], m;
    if (TERM_RE) { TERM_RE.lastIndex = 0; while ((m = TERM_RE.exec(escaped))) found.push({ s: m.index, e: m.index + m[0].length, t: m[0], id: TERM_TO_ID[m[0].toLowerCase()], kind: 'x' }); }
    ACR_RE.lastIndex = 0;
    while ((m = ACR_RE.exec(escaped))) found.push({ s: m.index, e: m.index + m[0].length, t: m[0], id: m[0], kind: 'a' });
    found.sort(function (a, b) { return a.s - b.s || (b.e - b.s) - (a.e - a.s) || (a.kind === 'x' ? -1 : 1); });
    var out = '', at = 0;
    found.forEach(function (f) {
      if (f.s < at) return;
      var key = f.kind + ':' + f.id;
      if (seen[key] || (f.kind === 'x' && !EXPLAINERS[f.id])) return;
      seen[key] = true;
      out += escaped.slice(at, f.s) + (f.kind === 'x'
        ? '<span class="term" data-explainer="' + f.id + '" tabindex="0">' + f.t + '</span>'
        : '<abbr class="acr" data-acronym="' + f.id + '" tabindex="0">' + f.t + '</abbr>');
      at = f.e;
    });
    return out + escaped.slice(at);
  }
  function explainersIn(text) {
    var ids = [], m;
    if (!TERM_RE) return ids;
    TERM_RE.lastIndex = 0;
    while ((m = TERM_RE.exec(esc(text)))) { var id = TERM_TO_ID[m[0].toLowerCase()]; if (id && ids.indexOf(id) < 0) ids.push(id); }
    return ids;
  }
  function explainChips(ids) {
    if (!ids.length) return '';
    return '<div class="explain-row"><span class="label">Explain it</span>' + ids.slice(0, 4).map(function (id) {
      return '<button type="button" class="term-chip" data-explainer="' + id + '" data-open-explainer="' + id + '">' + esc(EXPLAINERS[id].title) + '</button>';
    }).join('') + '</div>';
  }

  // ----- interactive figures -----
  var FIGURE_FOR = { 'min-pct': 'bands', 'min-payment': 'bands', 'min-first-year': 'months', 'first-year-pro-rata': 'months',
    'drawdown-methods': 'layers', 'drawdown-order': 'layers', 'tbc-what': 'cap', 'tbc': 'cap' };
  var SHORT_BANDS = DATA.rates.tables.minimum_drawdown.rows.map(function (r, i, rows) {
    return i === 0 ? '<' + rows[1].from_age : i === rows.length - 1 ? r.from_age + '+' : r.from_age + '–' + (rows[i + 1].from_age - 1);
  });
  function figureOptions(name) {
    var age = currentAge(), rows = DATA.rates.tables.minimum_drawdown.rows, band = -1;
    if (age != null) rows.forEach(function (r, i) { if (age >= r.from_age) band = i; });
    var now = new Date(), fy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    if (name === 'bands') return { rows: rows.map(function (r, i) { return { label: r.label, short: SHORT_BANDS[i], pct: r.pct }; }), selected: band >= 0 ? band : 1, note: band >= 0 ? 'member is ' + age : '' };
    if (name === 'months') {
      var bal = state.dd && CompanionParse.parseMoney(state.dd.bal);
      return { fyStartYear: fy, selected: 3, balance: bal || 500000, pct: band >= 0 ? rows[band].pct : 0.05, example: !bal || band < 0 };
    }
    if (name === 'layers') return { names: DATA.rates.tables.drawdown_order.rows.slice(0, 8) };
    if (name === 'cap') return { cap: DATA.rates.rates.filter(function (r) { return r.id === 'tbc_general'; })[0].value, amount: 1500000 };
    return {};
  }
  function figureSlot(id) {
    var name = FIGURE_FOR[id];
    return name ? '<div class="fig" data-figure="' + name + '"></div>' : '';
  }
  var mounted = [];
  function mountFigures(root, list) {
    root.querySelectorAll('[data-figure]').forEach(function (host) {
      if (host.getAttribute('data-mounted')) return;
      host.setAttribute('data-mounted', '1');
      var name = host.getAttribute('data-figure');
      var h = CompanionFigures.mount(host, name, figureOptions(name));
      if (h) (list || mounted).push(h);
    });
  }
  function unmountFigures(list) { (list || mounted).splice(0).forEach(function (h) { h.destroy(); }); }
  function setMain(html) { unmountFigures(); hidePop(true); main.innerHTML = html; mountFigures(main); }

  // ----- age tables on rule cards -----
  function ageTableHtml(card) {
    var age = currentAge();
    if (card.age_table === 'minimum_drawdown') {
      var rows = DATA.rates.tables.minimum_drawdown.rows, hit = -1;
      if (age != null) rows.forEach(function (r, i) { if (age >= r.from_age) hit = i; });
      var note = hit >= 0 ? '<div class="age-note">Age ' + age + ': <b>' + pct(rows[hit].pct) + '</b> (' + esc(rows[hit].label) + ')</div>' : '';
      return note + '<table class="mini"><thead><tr><th>Age at start, then each 1 July</th><th class="num">Minimum</th></tr></thead><tbody>' + rows.map(function (r, i) {
        return '<tr class="' + (i === hit ? 'hit' : '') + '"><td>' + esc(r.label) + '</td><td class="num">' + pct(r.pct) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (card.age_table === 'preservation_age') {
      var prow = DATA.rates.tables.preservation_age.rows, phit = -1;
      if (state.dob) { for (var i = 0; i < prow.length; i++) if (state.dob < prow[i].born_before) { phit = i; break; } }
      var labels = prow.map(function (r, i) {
        var from = i ? CompanionDates.parse(prow[i - 1].born_before) : null, to = CompanionDates.addDays(CompanionDates.parse(r.born_before), -1);
        if (!from) return 'Before ' + P.fmt(CompanionDates.parse(r.born_before));
        return i === prow.length - 1 ? P.fmt(from) + ' or later' : P.fmt(from) + ' – ' + P.fmt(to);
      });
      var pnote = phit >= 0 ? '<div class="age-note">Born ' + esc(CompanionParse.fmt(CompanionDates.parse(state.dob))) + ': preservation age <b>' + prow[phit].age + '</b></div>' : (age != null ? '<div class="meta">Enter a date of birth to pick the row.</div>' : '');
      return pnote + '<table class="mini"><thead><tr><th>Date of birth</th><th class="num">Preservation age</th></tr></thead><tbody>' + prow.map(function (r, i) {
        return '<tr class="' + (i === phit ? 'hit' : '') + '"><td>' + labels[i] + '</td><td class="num">' + r.age + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (card.age_table === 'bring_forward') {
      var b = DATA.rates.tables.bring_forward.rows, prev = 0;
      var fy = /(\d{4})-\d{2}/.exec(DATA.rates.tables.bring_forward.label);
      return '<table class="mini"><thead><tr><th>Total super balance' + (fy ? ' at 30 June ' + fy[1] : ' on the previous 30 June') + '</th><th class="num">First-year cap</th><th>Period</th></tr></thead><tbody>' + b.map(function (r) {
        var lab = r.tsb_below == null ? money(prev) + ' or more' : (prev ? money(prev) + ' to under ' : 'Under ') + money(r.tsb_below);
        prev = r.tsb_below || prev;
        return '<tr><td>' + lab + '</td><td class="num">' + money(r.cap) + '</td><td>' + esc(r.period) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    return '';
  }

  // ----- cards -----
  function head(label, badges) {
    return '<header class="card-head"><span class="label">' + esc(label) + '</span>' + (badges ? '<span class="badges">' + badges + '</span>' : '') + '</header>';
  }
  function badge(text, tone) { return '<span class="badge' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>'; }

  function ruleCard(c) {
    var seen = {};
    var products = c.products.map(function (p) {
      var lab = PRODUCTS.filter(function (x) { return x.id === p; })[0];
      return badge(lab ? lab.short || lab.label : p);
    }).join('');
    var see = c.see && c.see.length ? '<div class="see"><span class="label">Related</span>' + c.see.filter(function (id) { return RULES[id]; }).map(function (id) {
      return '<button class="link" data-open-rule="' + esc(id) + '">' + esc(RULES[id].q) + '</button>';
    }).join('') + '</div>' : '';
    var atoUrls = (c.ato || []).map(function (s) { return (DOCS[s.doc] || {}).url; }).filter(function (u, i, a) { return u && a.indexOf(u) === i; });
    var copy = plain(c.a) + '\n' + c.sources.map(sourceText).join('\n') + (atoUrls.length ? '\nSee also (ATO): ' + atoUrls.join(' ') : '');
    return '<article class="card" data-id="' + esc(c.id) + '">' + head(c.topic, products) +
      '<h3 class="card-title">' + esc(c.q) + '</h3>' +
      '<p class="answer">' + annotate(esc(c.a), seen) + '</p>' +
      (c.detail ? '<p class="detail">' + annotate(esc(c.detail), seen) + '</p>' : '') + figureSlot(c.id) + ageTableHtml(c) +
      explainChips(explainersIn(c.q + ' ' + c.a + ' ' + (c.detail || ''))) +
      sourcesHtml(c.sources, c.ato) +
      '<div class="actions"><button class="btn" data-main-copy data-copy="' + esc(copy) + '">Copy answer and source</button>' +
      (c.calc === 'drawdown' ? calcButton('btn ghost', calcTypeOf(c)) : '') + '</div>' + see + '</article>';
  }
  // The pension type a rule is about, so the calculator opens already set to it.
  function calcTypeOf(c) {
    if (!c) return '';
    var p = c.products || [];
    if (/^ttr/.test(c.id) || (p.indexOf('ttr') >= 0 && p.indexOf('rp') < 0)) return 'TTR';
    if (/^bis/.test(c.id) || (p.indexOf('bis') >= 0 && p.indexOf('rp') < 0)) return 'Beneficiary (BIS)';
    if (p.indexOf('rp') >= 0 && p.indexOf('ttr') < 0) return 'Retirement Phase';
    return '';
  }
  function calcButton(cls, type) {
    return '<button class="' + cls + '" data-goto-calc="drawdown"' + (type ? ' data-calc-type="' + esc(type) + '"' : '') + '>Drawdown calculator' + (type ? ' (' + esc(type === 'Beneficiary (BIS)' ? 'BIS' : type) + ')' : '') + ' →</button>';
  }

  function formSteps(f) {
    var steps = [];
    if (f.site_tab) {
      steps.push('Go to <span class="address">unisuper.com.au/forms</span>');
      steps.push('Choose the <b>' + esc(f.site_tab) + '</b> tab, then <b>Find by topic</b>');
      steps.push('Open <b>' + esc(f.topics[0]) + '</b>, then <b>' + esc(f.title) + '</b>');
    } else if (f.where) {
      steps.push(esc(f.where));
    }
    return steps;
  }
  function formCard(f) {
    var seen = {};
    var badges = (f.online ? badge('Online', 'positive') : '') + (f.pdf ? badge('PDF' + (f.pdf_size ? ' ' + f.pdf_size : '')) : '') + (f.phone ? badge('Phone', 'info') : '');
    var steps = formSteps(f);
    var account = f.account_path ? '<div class="row-line"><span class="label">Online account</span><span>Log in, then <b>' + (f.account_path.verified ? esc(f.account_path.path) : assumeSpan('account-path-labels', esc(f.account_path.path))) + '</b>' +
      '' + '</span></div>' : '';
    var say = f.say ? '<div class="row-line"><span class="label">Say</span><span class="address">' + esc(f.say) + '</span></div>' : '';
    var reqs = f.requirements && f.requirements.length ? '<ul class="reqs">' + f.requirements.map(function (r) { return '<li>' + annotate(esc(r), seen) + '</li>'; }).join('') + '</ul>' : '';
    var directionsText = [f.title + (f.summary ? ': ' + f.summary : '')]
      .concat(f.online ? ['Online: ' + f.online] : [])
      .concat(f.pdf ? ['PDF form: ' + f.pdf] : [])
      .concat(f.phone ? ['Phone: ' + f.phone] : [])
      .concat(steps.length ? ['On the website: ' + steps.map(function (s) { return s.replace(/<[^>]+>/g, ''); }).join(', then ')] : [])
      .concat(f.requirements || []).join('\n');
    var srcs = [f.pds, f.account_source].filter(function (s) { return s && !/^form:/.test(s.doc); });
    var formSrcs = [f.account_source].filter(function (s) { return s && /^form:/.test(s.doc); }).concat(f.form_quotes || []);
    return '<article class="card" data-id="' + esc(f.id) + '">' + head(f.group + ' form', badges) +
      '<h3 class="card-title">' + esc(f.title) + '</h3>' +
      (f.summary ? '<p class="detail">' + annotate(esc(f.summary), seen) + '</p>' : '') + say +
      (steps.length ? '<ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' : '') +
      account + (f.phone ? '<div class="row-line"><span class="label">Phone</span><span class="num">' + esc(f.phone) + '</span></div>' : '') + reqs +
      (srcs.length || formSrcs.length ? sourcesHtml(srcs, formSrcs) : '') +
      '<div class="actions">' +
      (f.online ? '<a class="btn solid" href="' + esc(f.online) + '" target="_blank" rel="noopener">' + esc(f.online_label || 'Complete online') + ' ↗</a>' : '') +
      (f.pdf ? '<a class="btn" href="' + esc(f.pdf) + '" target="_blank" rel="noopener">Open PDF ↗</a><button class="btn" data-copy="' + esc(f.pdf) + '">Copy PDF link</button>' : '') +
      '<button class="btn" data-main-copy data-copy="' + esc(directionsText) + '">Copy directions</button></div></article>';
  }

  // The date a timeframe lands on if its clock starts today, so it can be read out without the calculator.
  function dueDate(t) {
    if (!t.calc) return null;
    return CompanionDates.apply({ type: t.calc.type, n: t.calc.n }, CompanionParse.today(), cal).date;
  }
  function shortDate(d) { return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function timeframeCard(t) {
    var seen = {}, due = dueDate(t);
    var kind = { pds: 'PDS', law: 'Law', internal: 'Internal', form: 'Form' }[t.kind] || t.kind;
    return '<article class="card" data-id="' + esc(t.id) + '">' + head((t.topic || 'Timeframe') + ' · timeframe', badge(kind, t.kind === 'internal' ? 'caution' : '')) +
      '<h3 class="card-title">' + esc(t.task) + '</h3>' +
      // A count in plain days is taken as calendar days (an assumption the PDS doesn't settle).
      '<div class="figure-line">' + (t.calc && t.calc.type === 'days' ? assumeSpan('calendar-days', esc(t.timeframe)) : esc(t.timeframe)) + '</div>' +
      (due ? '<div class="due-line"><span class="label">If the clock starts today</span><b>' + esc(shortDate(due)) + '</b></div>' : '') +
      (t.starts ? '<div class="meta">Clock starts: ' + rich(t.starts) + '</div>' : '') +
      '<div class="say"><span class="label">Say</span><p>' + annotate(esc(t.say), seen) + '</p></div>' + (t.source || (t.ato && t.ato.length) ? sourcesHtml(t.source ? [t.source] : [], t.ato) : '') +
      '<div class="actions"><button class="btn" data-main-copy data-copy="' + esc(plain(t.say)) + '">Copy wording</button>' +
      (t.calc ? '<button class="btn ghost" data-calc-preset="' + esc(t.id) + '">Work out the date →</button>' : '') + '</div></article>';
  }

  // Three listeners, each an ordered chain: every step follows from the one before, or is the next thing to do.
  var VERSIONS = [['simple', 'Simple', 'The concept in a few steps'], ['standard', 'Standard', 'The rule and the key numbers, in order'], ['detailed', 'Detailed', 'The full rule, worked examples and edge cases']];
  var DEFAULT_VERSION = 'standard';
  function versionsHtml(attr) {
    return '<div class="seg" role="group" aria-label="Level of detail">' + VERSIONS.map(function (x) {
      return '<button type="button" ' + attr + '="' + x[0] + '" aria-pressed="' + (x[0] === DEFAULT_VERSION) + '" title="' + x[2] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  // A level is a list of blocks. A plain string is a numbered step (the chain); the others break the
  // chain up where a list would blur together: {lead}, {options:[{name,text}]}, {table:{head,rows}},
  // {example}, {note}.
  var LETTERS = 'ABCDEFGH';
  function blockHtml(b) {
    if (typeof b === 'string') return '<div class="xstep">' + rich(b) + '</div>';
    if (b.lead) return '<p class="lead">' + rich(b.lead) + '</p>';
    if (b.options) {
      return '<div class="options" style="--n:' + Math.min(b.options.length, 3) + '"><span class="label">' + esc(b.label || b.options.length + ' options') + '</span><div class="opt-grid">' +
        b.options.map(function (o, i) {
          return '<div class="opt"><span class="opt-key">' + LETTERS[i] + '</span><strong>' + esc(o.name) + '</strong><p>' + rich(o.text) + '</p></div>';
        }).join('') + '</div></div>';
    }
    if (b.table) {
      return '<div class="table-wrap"><table class="ex-table"><thead><tr>' + b.table.head.map(function (h) { return '<th>' + rich(h) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + b.table.rows.map(function (r) {
          return '<tr>' + r.map(function (c, i) { return i ? '<td>' + rich(c) + '</td>' : '<th scope="row">' + rich(c) + '</th>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (b.example) return '<div class="callout ex"><span class="label">Example</span><p>' + rich(b.example) + '</p></div>';
    if (b.note) return '<div class="callout note"><span class="label">Watch for</span><p>' + rich(b.note) + '</p></div>';
    return '';
  }
  function blockText(blocks) {
    var n = 0, numbered = blocks.filter(function (b) { return typeof b === 'string'; }).length > 1;
    return blocks.map(function (b) {
      if (typeof b === 'string') return (numbered ? (++n) + '. ' : '') + plain(b);
      if (b.lead) return plain(b.lead);
      if (b.options) return b.options.map(function (o, i) { return LETTERS[i] + ') ' + o.name + ': ' + plain(o.text); }).join('\n');
      if (b.table) return [b.table.head.filter(Boolean).map(plain).join(' | ')].concat(b.table.rows.map(function (r) { return r.map(plain).join(' | '); })).join('\n');
      if (b.example) return 'Example: ' + plain(b.example);
      if (b.note) return 'Watch for: ' + plain(b.note);
      return '';
    }).join('\n');
  }
  function chainsHtml(e) {
    return VERSIONS.map(function (x) {
      // A single numbered step reads oddly as "1", so it's shown without a number.
      var steps = e[x[0]].filter(function (b) { return typeof b === 'string'; }).length;
      return '<div class="script chain' + (steps < 2 ? ' no-num' : '') + '" data-script="' + x[0] + '" data-explainer-id="' + esc(e.id) + '" aria-label="' + x[2] + '"' + (x[0] === DEFAULT_VERSION ? '' : ' hidden') + '>' +
        e[x[0]].map(blockHtml).join('') + '</div>';
    }).join('');
  }
  function chainText(el) {
    var e = EXPLAINERS[el.getAttribute('data-explainer-id')];
    return e ? e.title + '\n' + blockText(e[el.getAttribute('data-script')]) : el.textContent;
  }
  // "Go to" links from an explainer to the calculator, checklists, rules, forms, timeframes and other explainers.
  function goLink(l) {
    if (l.calc) return '<button class="btn sm ghost" data-goto-calc="drawdown">Drawdown calculator →</button>';
    if (l.proc) { var p = DATA.procedures.filter(function (x) { return x.id === l.proc; })[0]; return p ? '<button class="btn sm ghost" data-open-proc="' + esc(p.id) + '">Checklist: ' + esc(p.title) + ' →</button>' : ''; }
    if (l.rule && RULES[l.rule]) return '<button class="btn sm ghost" data-open-rule="' + esc(l.rule) + '">Rule: ' + esc(RULES[l.rule].q) + '</button>';
    if (l.explainer && EXPLAINERS[l.explainer]) return '<button class="btn sm ghost" data-open-explainer="' + esc(l.explainer) + '">Explainer: ' + esc(EXPLAINERS[l.explainer].title) + '</button>';
    if (l.form) { var f = DATA.forms.filter(function (x) { return x.id === l.form; })[0]; return f ? '<button class="btn sm ghost" data-open-form="' + esc(f.id) + '">Form: ' + esc(f.title) + '</button>' : ''; }
    if (l.timeframe) { var t = DATA.timeframes.filter(function (x) { return x.id === l.timeframe; })[0]; return t ? '<button class="btn sm ghost" data-open-timeframe="' + esc(t.id) + '">Timeframe: ' + esc(t.task) + '</button>' : ''; }
    return '';
  }
  function linksHtml(e) {
    return e.links && e.links.length ? '<div class="go-row"><span class="label">Go to</span>' + e.links.map(goLink).join('') + '</div>' : '';
  }
  function explainerCard(e) {
    return '<article class="card explainer" data-id="' + esc(e.id) + '">' + head(e.topic + ' · explainer', '') +
      '<h3 class="card-title">' + esc(e.title) + '</h3>' + figureSlot(e.id) + versionsHtml('data-version') +
      chainsHtml(e) + linksHtml(e) +
      '<div class="general"><span class="label">Stay general</span><p>' + esc(e.general) + '</p></div>' + sourcesHtml([].concat(e.source), e.also) +
      '<div class="actions"><button class="btn" data-main-copy data-copy-script>Copy this version</button></div></article>';
  }


  // ----- list of every assumption -----
  function showAssumptions() {
    hidePop(true);
    state.q = ''; qEl.value = '';
    setMain('<h2 class="section-title"><span class="label">Assumptions</span><span class="count">' + DATA.assumptions.length + '</span></h2>' +
      '<p class="hint">Everything the companion assumes rather than takes straight from the PDS. Wherever one is used, the words have a ' + assumeSpan('day-count', 'red dotted underline') + '; hover over them for the details.</p>' +
      '<div class="stack">' + DATA.assumptions.map(function (a) {
        return '<article class="card assumption-card" id="assume-' + esc(a.id) + '">' + head('Assumption', '') + '<h3 class="card-title">' + esc(a.title) + '</h3>' +
          '<p class="answer">' + esc(a.assumed) + '</p><div class="row-line"><span class="label">What the PDS says</span><span>' + esc(a.pds) + '</span></div>' +
          '<div class="row-line"><span class="label">To be sure</span><span>' + esc(a.check) + '</span></div></article>';
      }).join('') + '</div>');
    window.scrollTo(0, 0);
  }

  // ----- checklists -----
  // A test member gives every note; an age or date of birth alone still gives the age-based ones.
  // Preservation age is 60 for anyone under 60 now, and anyone 60 or over has reached theirs.
  function memberCtx() {
    if (state.member) return CompanionMembers.context(state.member, DATA.rates, new Date());
    var age = currentAge();
    if (age == null) return null;
    var pa = null;
    if (state.dob) { pa = 60; DATA.rates.tables.preservation_age.rows.some(function (r) { if (state.dob < r.born_before) { pa = r.age; return true; } return false; }); }
    else if (age < 60) pa = 60;
    var reached = pa == null || age >= pa;
    return { ageOnly: true, cond: { under_25: age < 25, under_55: age < 55, under_60: age < 60, over_60: age >= 60, age_67_74: age >= 67 && age <= 74,
      age_75_plus: age >= 75, preservation_reached: reached, preservation_not_reached: !reached },
      vars: { name: 'The member', age: age, presAge: pa != null ? pa : '60 or under' } };
  }
  function stepNotes(st, ctx) {
    if (!ctx || !st.member) return '';
    var tag = ctx.ageOnly ? 'Age ' + ctx.vars.age : '#' + state.member.number;
    return st.member.filter(function (n) { return ctx.cond[n.cond]; }).map(function (n) {
      return '<div class="step-member"><span class="label">' + esc(tag) + '</span>' + rich(CompanionMembers.fill(n.text, ctx.vars)) + '</div>';
    }).join('');
  }
  function stepLinks(st) {
    var out = [];
    if (st.form && FORMS[st.form]) {
      var f = FORMS[st.form];
      out.push(f.online ? '<a class="btn sm" href="' + esc(f.online) + '" target="_blank" rel="noopener">Online ↗</a>' : '');
      out.push(f.pdf ? '<a class="btn sm" href="' + esc(f.pdf) + '" target="_blank" rel="noopener">' + esc(f.title) + ' (PDF) ↗</a>' : '');
      if (!f.online && !f.pdf) out.push('<span class="btn sm">' + esc(f.title) + '</span>');
    }
    if (st.rule && RULES[st.rule]) out.push('<button class="btn sm ghost" data-open-rule="' + esc(st.rule) + '">Rule: ' + esc(RULES[st.rule].q) + '</button>');
    if (st.calc) out.push('<button class="btn sm ghost" data-goto-calc="drawdown">Drawdown calculator →</button>');
    return out.filter(Boolean).length ? '<div class="step-links">' + out.join('') + '</div>' : '';
  }
  function stepSource(s) {
    var d = DOCS[s.doc] || { title: s.doc, url: '#' };
    return '<details class="step-src"><summary>' + esc(d.title) + (s.page ? ' · p.' + s.page : '') + '</summary><q>' + esc(s.quote) + '</q>' +
      '<a href="' + esc(d.url + (s.page ? '#page=' + s.page : '')) + '" target="_blank" rel="noopener">Open the PDS ↗</a></details>';
  }
  function procedureCard(p) {
    var done = Object.keys(state.ticks[p.id] || {}).length;
    return '<article class="card proc-card" data-id="' + esc(p.id) + '">' + head(p.topic + ' · checklist', badge(p.steps.length + ' steps')) +
      '<h3 class="card-title">' + esc(p.title) + '</h3><p class="detail">' + esc(p.when) + '</p>' +
      '<div class="actions"><button class="btn solid" data-open-proc="' + esc(p.id) + '">' + (done ? 'Continue (' + done + ' of ' + p.steps.length + ' done)' : 'Open checklist') + ' →</button></div></article>';
  }
  function procedureView(p) {
    var ticks = state.ticks[p.id] || {}, ctx = memberCtx(), seen = {};
    var done = p.steps.filter(function (s, i) { return ticks[i]; }).length;
    return '<article class="card proc" data-proc="' + esc(p.id) + '">' + head(p.topic + ' · checklist', '<span class="badge" id="proc-progress">' + done + ' of ' + p.steps.length + ' done</span>') +
      '<h3 class="card-title proc-title">' + esc(p.title) + '</h3><p class="detail">' + esc(p.when) + ' <span class="meta">Steps are in ' + assumeSpan('checklist-order', 'a suggested order') + '.</span></p>' +
      (state.member ? '<div class="proc-member">Notes for <b>#' + esc(state.member.number) + ' ' + esc(state.member.name) + '</b> (test member) are shown under the steps they affect.</div>' :
        ctx ? '<div class="proc-member">Notes for a member aged <b>' + esc(ctx.vars.age) + '</b> are shown under the steps their age affects.</div>' : '') +
      '<ol class="steps-list">' + p.steps.map(function (st, i) {
        return '<li class="step' + (ticks[i] ? ' done' : '') + '"><button class="tick" data-tick="' + i + '" aria-pressed="' + !!ticks[i] + '" aria-label="Mark step ' + (i + 1) + ' done"><span class="tick-n">' + (i + 1) + '</span></button>' +
          '<div class="step-body"><p>' + annotate(esc(st.do), seen) + '</p>' + stepNotes(st, ctx) + stepLinks(st) + (st.source ? stepSource(st.source) : '') + '</div></li>';
      }).join('') + '</ol>' +
      (p.mistakes && p.mistakes.length ? '<div class="general"><span class="label">Common mistakes</span><ul class="reqs">' + p.mistakes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="actions"><button class="btn solid" data-main-copy data-copy-proc>Copy as call note</button><button class="btn ghost" data-reset-proc>Reset ticks</button></div></article>';
  }
  function openProcedure(id) { openItem('procedure', id); }
  function procNote(p) {
    var ticks = state.ticks[p.id] || {};
    var who = state.member ? ' for test member #' + state.member.number + ' ' + state.member.name : '';
    return 'Checklist: ' + p.title + who + '\n' + p.steps.map(function (st, i) { return (ticks[i] ? '[x] ' : '[ ] ') + (i + 1) + '. ' + plain(st.do); }).join('\n');
  }

  var RENDER = { procedure: procedureCard, rule: ruleCard, form: formCard, timeframe: timeframeCard, explainer: explainerCard };

  function highlight(snippet, terms) {
    var out = esc(snippet);
    terms.filter(function (t) { return t.length > 2; }).forEach(function (t) {
      out = out.replace(new RegExp('\\b(' + reEsc(t) + '[a-z]*)', 'gi'), '<mark>$1</mark>');
    });
    return out;
  }
  function pagesHtml(q, open) {
    var hits = engine.searchPages(q, 6);
    if (!hits.length) return '';
    return '<details class="pages"' + (open ? ' open' : '') + '><summary><span class="label">PDS text</span> ' + hits.length + ' passages that mention this</summary>' + hits.map(function (h) {
      var d = DOCS[h.doc];
      return '<div class="passage"><a href="' + esc(d.url + '#page=' + h.page) + '" target="_blank" rel="noopener"><span class="src-doc">' + esc(d.title) + '</span><span class="src-meta">p.' + h.page + ' ↗</span></a><p>' + highlight(h.snippet, h.terms) + '</p></div>';
    }).join('') + '</details>';
  }

  // ----- views -----
  // Call flow: a quiet start screen; once the consultant types or browses, a three-column workspace:
  // results (compact, keyboard-navigable) | the selected answer | related timeframes, forms, checklists.
  function sectionTitle(text, count) {
    return '<h2 class="section-title"><span class="label">' + esc(text) + '</span>' + (count != null ? '<span class="count">' + count + '</span>' : '') + '</h2>';
  }
  function groupBy(list, key) {
    var g = {}, order = [];
    list.forEach(function (x) { var k = x[key] || 'Other'; if (!g[k]) { g[k] = []; order.push(k); } g[k].push(x); });
    return order.map(function (k) { return [k, g[k]]; });
  }

  var TYPE_ONE = { procedure: 'Checklist', rule: 'Rule', form: 'Form', timeframe: 'Timeframe', explainer: 'Explainer' };
  var TYPE_TAB = { procedure: 'proc', rule: 'rule', form: 'form', timeframe: 'timeframe', explainer: 'explainer' };
  function itemOf(type, id) {
    return type === 'procedure' ? PROCS[id] : type === 'rule' ? RULES[id] : type === 'form' ? FORMS[id] : type === 'timeframe' ? TIMEFRAMES[id] : type === 'explainer' ? EXPLAINERS[id] : null;
  }
  function titleOf(type, x) {
    return type === 'rule' ? x.q : type === 'timeframe' ? x.task : x.title;
  }
  // The one line under a result: enough to answer from the list without opening it.
  function subOf(type, x) {
    if (type === 'rule') return plain(x.a);
    if (type === 'timeframe') { var due = dueDate(x); return x.timeframe + (due ? ' · from today: ' + shortDate(due) : ''); }
    if (type === 'form') return x.summary || '';
    if (type === 'procedure') return x.steps.length + ' steps · ' + x.when;
    if (type === 'explainer') { var s = x.standard.filter(function (b) { return typeof b === 'string'; })[0] || (x.standard[0] && x.standard[0].lead) || ''; return plain(s); }
    return '';
  }
  function key(type, id) { return type + ':' + id; }

  function hitHtml(type, x, selected) {
    return '<button class="hit' + (selected ? ' on' : '') + '" data-sel="' + esc(key(type, x.id)) + '" aria-current="' + selected + '">' +
      '<span class="hit-type t-' + type + '">' + TYPE_ONE[type] + '</span>' +
      '<span class="hit-title">' + esc(titleOf(type, x)) + '</span>' +
      '<span class="hit-sub">' + esc(subOf(type, x)) + '</span></button>';
  }

  // What the results rail lists right now: search results, or everything of the browsed type.
  function railModel() {
    var tab = TABS.filter(function (t) { return t.id === state.tab; })[0] || TABS[0];
    if (state.q.trim()) {
      var res = engine.search(state.q, { product: state.showHidden ? '' : state.product, limit: 80 });
      var counts = {};
      res.results.forEach(function (r) { counts[r.type] = (counts[r.type] || 0) + 1; });
      var list = res.results.filter(function (r) { return !tab.types || tab.types.indexOf(r.type) >= 0; })
        .map(function (r) { return { type: r.type, id: r.item.id, item: r.item }; });
      return { search: true, res: res, counts: counts, total: res.results.length, list: list, groups: null };
    }
    var type = tab.types && tab.types[0];
    var source = { procedure: DATA.procedures, rule: DATA.rules.filter(function (r) { return !state.product || !r.products.length || r.products.indexOf(state.product) >= 0; }),
      form: DATA.forms, timeframe: DATA.timeframes, explainer: DATA.explainers }[type] || [];
    var groups = groupBy(source, type === 'form' ? 'group' : 'topic').map(function (g) {
      return [g[0], g[1].map(function (x) { return { type: type, id: x.id, item: x }; })];
    });
    return { search: false, list: [].concat.apply([], groups.map(function (g) { return g[1]; })), groups: groups };
  }

  function railHtml(m) {
    var html = '';
    if (m.search) {
      var res = m.res;
      html += '<div class="rail-head"><span class="label">' + m.total + ' match' + (m.total === 1 ? '' : 'es') + '</span><div class="type-chips">' +
        '<button class="tchip" data-tab="all" aria-pressed="' + (state.tab === 'all') + '">All <span>' + m.total + '</span></button>' +
        ['procedure', 'rule', 'form', 'timeframe', 'explainer'].filter(function (t) { return m.counts[t]; }).map(function (t) {
          return '<button class="tchip" data-tab="' + TYPE_TAB[t] + '" aria-pressed="' + (state.tab === TYPE_TAB[t]) + '">' + TYPE_LABEL[t] + ' <span>' + m.counts[t] + '</span></button>';
        }).join('') + '</div></div>';
      if (res.corrections && res.corrections.length) {
        html += '<div class="fixes"><span class="label">Spelling</span>' + res.corrections.map(function (f) { return '<s>' + esc(f.from) + '</s> → <b>' + esc(f.to) + '</b>'; }).join(', ') + '</div>';
      }
      if (res.glossary.length) html += '<div class="gloss">' + res.glossary.map(function (g) { return '<span><b>' + esc(g.term) + '</b>' + esc(g.means) + '</span>'; }).join('') + '</div>';
      if (res.hidden) html += '<div class="notice">' + res.hidden + ' hidden by the product filter. <button class="link" data-show-hidden>Show</button></div>';
      if (!m.list.length) html += '<div class="empty"><p>Nothing matches “' + esc(state.q) + '”' + (state.tab !== 'all' ? ' here. <button class="link" data-tab="all">Search everything</button>' : '.') + '</p></div>';
      html += '<div class="hits">' + m.list.map(function (r) { return hitHtml(r.type, r.item, state.sel && key(r.type, r.id) === key(state.sel.type, state.sel.id)); }).join('') + '</div>';
      html += pagesHtml(state.q, !m.list.length);
    } else {
      html += '<div class="rail-head"><span class="label">' + esc(TABS.filter(function (t) { return t.id === state.tab; })[0].label) + '</span><span class="count">' + m.list.length + '</span></div>';
      m.groups.forEach(function (g) {
        html += '<div class="hit-group"><span class="label">' + esc(g[0]) + '</span>' + g[1].map(function (r) {
          return hitHtml(r.type, r.item, state.sel && key(r.type, r.id) === key(state.sel.type, state.sel.id));
        }).join('') + '</div>';
      });
    }
    return html;
  }

  // ----- related: what sits alongside the selected item -----
  var RELATED_CAPS = { timeframe: 3, form: 3, procedure: 2, rule: 4, explainer: 3 };
  function relatedFor(type, x) {
    var out = { timeframe: [], form: [], procedure: [], rule: [], explainer: [] };
    function add(t, id) {
      if (!out[t] || (t === type && id === x.id) || !itemOf(t, id) || out[t].indexOf(id) >= 0) return;
      out[t].push(id);
    }
    // Direct links first: the ones the data says belong together.
    if (type === 'rule') {
      (x.see || []).forEach(function (id) { add('rule', id); });
      explainersIn(x.q + ' ' + x.a + ' ' + (x.detail || '')).forEach(function (id) { add('explainer', id); });
      DATA.procedures.forEach(function (p) { if (p.steps.some(function (s) { return s.rule === x.id; })) add('procedure', p.id); });
    }
    if (type === 'procedure') x.steps.forEach(function (s) { if (s.form) add('form', s.form); if (s.rule) add('rule', s.rule); });
    if (type === 'form') DATA.procedures.forEach(function (p) { if (p.steps.some(function (s) { return s.form === x.id; })) add('procedure', p.id); });
    if (type === 'explainer') (x.links || []).forEach(function (l) {
      if (l.proc) add('procedure', l.proc); if (l.rule) add('rule', l.rule); if (l.form) add('form', l.form); if (l.timeframe) add('timeframe', l.timeframe); if (l.explainer) add('explainer', l.explainer);
    });
    if (type === 'timeframe') explainersIn(x.task + ' ' + x.say).forEach(function (id) { add('explainer', id); });
    // Then whatever the search engine finds for the item's own title, up to a few of each type.
    engine.search(titleOf(type, x), { product: state.product, limit: 40 }).results.forEach(function (r) {
      if (out[r.type] && out[r.type].length < RELATED_CAPS[r.type]) add(r.type, r.item.id);
    });
    Object.keys(out).forEach(function (t) { out[t] = out[t].slice(0, RELATED_CAPS[t] + 1); });
    return out;
  }
  function miniHtml(type, x) {
    var sub = type === 'timeframe' ? '<span class="mini-figure">' + esc(x.timeframe) + '</span>' :
      type === 'form' ? '<span class="mini-sub">' + (x.online ? 'Online' : '') + (x.online && x.pdf ? ' · ' : '') + (x.pdf ? 'PDF' : '') + (x.phone ? ' · Phone' : '') + '</span>' :
      type === 'rule' ? '<span class="mini-sub">' + esc(plain(x.a).slice(0, 90)) + (plain(x.a).length > 90 ? '…' : '') + '</span>' : '';
    return '<button class="mini" data-sel="' + esc(key(type, x.id)) + '"><span class="mini-title">' + esc(titleOf(type, x)) + '</span>' + sub + '</button>';
  }
  function sideHtml() {
    var html = '';
    if (state.sel && itemOf(state.sel.type, state.sel.id)) {
      var rel = relatedFor(state.sel.type, itemOf(state.sel.type, state.sel.id));
      var order = ['timeframe', 'form', 'procedure', 'explainer', 'rule'];
      var any = false;
      order.forEach(function (t) {
        if (!rel[t].length) return;
        any = true;
        html += '<section class="side-group"><span class="label">' + TYPE_LABEL[t] + '</span>' + rel[t].map(function (id) { return miniHtml(t, itemOf(t, id)); }).join('') + '</section>';
      });
      if (!any) html += '<p class="meta">Nothing else linked to this one.</p>';
      if (state.sel.type === 'rule' && RULES[state.sel.id].calc === 'drawdown' || state.sel.type === 'explainer' && (EXPLAINERS[state.sel.id].links || []).some(function (l) { return l.calc; })) {
        html = calcButton('btn solid wide', state.sel.type === 'rule' ? calcTypeOf(RULES[state.sel.id]) : '') + html;
      }
    }
    var recent = state.recent.filter(function (r) { return !state.sel || key(r.type, r.id) !== key(state.sel.type, state.sel.id); });
    if (recent.length) {
      html += '<section class="side-group this-call"><span class="label">Earlier in this call</span>' + recent.slice(0, 6).map(function (r) { return miniHtml(r.type, itemOf(r.type, r.id)); }).join('') + '</section>';
    }
    return '<span class="label side-title">Alongside</span>' + (html || '<p class="meta">Related timeframes, forms and checklists show here.</p>');
  }

  function detailHtml() {
    if (state.sel && state.sel.type === 'tool') return datesToolHtml();
    if (!state.sel) return '<div class="empty detail-empty"><p>' + (state.q.trim() ? 'No card matches. Try other words, or check the PDS text matches.' : 'Pick something from the list.') + '</p></div>';
    var x = itemOf(state.sel.type, state.sel.id);
    if (!x) return '';
    if (state.sel.type === 'procedure') return procedureView(x);
    var html = RENDER[state.sel.type](x);
    if (state.sel.type === 'timeframe' && x.calc) { state.calcPreset = x.id; html += datesToolHtml(); }
    return html;
  }

  var ws = null;
  function renderWorkspace(keepRailScroll) {
    var m = railModel();
    state.railList = m.list;
    if (!state.sel || (!state.pinned && !m.list.some(function (r) { return key(r.type, r.id) === key(state.sel.type, state.sel.id); }))) {
      state.sel = m.list.length ? { type: m.list[0].type, id: m.list[0].id } : (state.sel && state.sel.type === 'tool' ? state.sel : null);
    }
    var railScroll = ws && keepRailScroll ? ws.rail.scrollTop : 0;
    if (!ws || !main.contains(ws.root)) {
      setMain('<div class="ws"><aside class="rail" id="rail" aria-label="Results"></aside><section class="detail" id="detail" tabindex="-1" aria-label="Answer"></section><aside class="side" id="side" aria-label="Alongside"></aside></div>');
      ws = { root: main.querySelector('.ws'), rail: $('rail'), detail: $('detail'), side: $('side') };
    }
    ws.rail.innerHTML = railHtml(m);
    ws.rail.scrollTop = railScroll;
    renderDetail();
  }
  function renderDetail() {
    unmountFigures(); hidePop(true);
    ws.detail.innerHTML = detailHtml();
    mountFigures(ws.detail);
    // Screen readers hear which item is open, not the whole card on every arrow press.
    var sel = state.sel && state.sel.type !== 'tool' && itemOf(state.sel.type, state.sel.id);
    var live = $('sr-live');
    if (live) live.textContent = sel ? TYPE_ONE[state.sel.type] + ': ' + titleOf(state.sel.type, sel) : '';
    if ($('dt-from')) bindDates();
    ws.side.innerHTML = sideHtml();
    ws.rail.querySelectorAll('.hit').forEach(function (b) {
      var on = !!state.sel && b.getAttribute('data-sel') === key(state.sel.type, state.sel.id);
      b.classList.toggle('on', on); b.setAttribute('aria-current', String(on));
    });
  }
  function rememberInCall(sel) {
    if (!sel || sel.type === 'tool') return;
    state.recent = [sel].concat(state.recent.filter(function (r) { return key(r.type, r.id) !== key(sel.type, sel.id); })).slice(0, 8);
  }
  // Opens an item in the middle column without throwing away the search on the left.
  function openItem(type, id, opts) {
    if (!itemOf(type, id)) return;
    hidePop(true);
    state.sel = { type: type, id: id };
    state.pinned = true;
    rememberInCall(state.sel);
    if (state.tab === 'calc' || (!state.q.trim() && (state.tab === 'all' || state.tab !== TYPE_TAB[type]))) {
      state.tab = TYPE_TAB[type];
      renderTabs();
      renderWorkspace();
    } else if (ws && main.contains(ws.root)) {
      renderDetail();
    } else renderWorkspace();
    if (!opts || !opts.stay) scrollToDetail();
  }
  function scrollToDetail() {
    if (!ws) return;
    var r = ws.detail.getBoundingClientRect(), topH = document.querySelector('.top').offsetHeight;
    if (window.innerWidth < 900 || r.top < topH || r.top > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + r.top - topH - 12, behavior: 'smooth' });
  }
  // Arrow keys in the search box move through the results.
  function moveSel(step) {
    var list = state.railList || [];
    if (!list.length) return;
    var i = state.sel ? list.findIndex(function (r) { return key(r.type, r.id) === key(state.sel.type, state.sel.id); }) : -1;
    var next = list[Math.max(0, Math.min(list.length - 1, i + step))];
    state.sel = { type: next.type, id: next.id }; state.pinned = false;
    renderDetail();
    var b = ws.rail.querySelector('.hit.on');
    if (b) b.scrollIntoView({ block: 'nearest' });
  }

  var TRY = ['ttr max', 'noi deadline', 'change my bank', 'how long withdrawal', 'perservation age', 'split with my wife'];
  var COMMON = ['noi', 'start-rp', 'pension-withdrawal', 'bdbn', 'split', 'change-payments'];
  function startHtml() {
    var recent = state.recent.length ? '<section class="start-block"><span class="label">Earlier in this call</span><div class="start-list">' +
      state.recent.slice(0, 6).map(function (r) { return miniHtml(r.type, itemOf(r.type, r.id)); }).join('') + '</div></section>' : '';
    return '<section class="start">' +
      '<h1>What did the member ask?</h1>' +
      '<p>Type it in their words, in the box above. Results show on the left, the answer in the middle, and related timeframes, forms and checklists on the right.</p>' +
      '<p class="keys"><kbd>↑</kbd> <kbd>↓</kbd> move through results · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> copy the answer · <kbd>Shift</kbd>+<kbd>Enter</kbd> jump into the answer · <kbd>/</kbd> back to the search box</p>' +
      '<div class="try"><span class="label">For example</span>' + TRY.map(function (t) { return '<button class="chip" data-q="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
      recent +
      '<section class="start-block"><span class="label">Common tasks</span><div class="start-grid">' + COMMON.filter(function (id) { return PROCS[id]; }).map(function (id) {
        return '<button class="start-task" data-open-proc="' + id + '"><span class="hit-type t-procedure">Checklist</span><b>' + esc(PROCS[id].title) + '</b></button>';
      }).join('') + '</div></section>' +
      '<section class="start-block"><span class="label">Tools</span><div class="start-grid">' +
      '<button class="start-task" data-goto-calc="drawdown"><span class="hit-type">Calculator</span><b>Minimum and maximum pension payments</b></button>' +
      '<button class="start-task" data-open-dates><span class="hit-type">Calculator</span><b>When is it due? Dates and business days</b></button>' +
      '<button class="start-task" data-tab="explainer"><span class="hit-type t-explainer">Explainers</span><b>' + DATA.explainers.length + ' concepts, explained three ways</b></button>' +
      '</div></section></section>';
  }

  function renderBrowse() {
    ws = null;
    setMain(startHtml());
  }

  // ----- popover for hover-over terms -----
  var pop = null, popHandles = [], popTarget = null, showTimer = 0, hideTimer = 0;
  function popEl() {
    if (!pop) { pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true; document.body.appendChild(pop); }
    return pop;
  }
  function showPop(target) {
    clearTimeout(hideTimer);
    if (popTarget === target && !popEl().hidden) return;
    unmountFigures(popHandles);
    popTarget = target;
    var p = popEl(), id = target.getAttribute('data-explainer'), acr = target.getAttribute('data-acronym'), asm = target.getAttribute('data-assumption');
    if (asm && ASSUMPTIONS[asm]) {
      var a = ASSUMPTIONS[asm];
      p.innerHTML = '<span class="label assume-label">Assumption</span><h4>' + esc(a.title) + '</h4>' +
        '<p class="script">' + esc(a.assumed) + '</p>' +
        '<div class="pop-row"><span class="label">What the PDS says</span><p>' + esc(a.pds) + '</p></div>' +
        '<div class="pop-row"><span class="label">To be sure</span><p>' + esc(a.check) + '</p></div>' +
        '<div class="actions"><button class="btn ghost" data-show-assumptions>All assumptions →</button></div>';
      p.setAttribute('aria-label', 'Assumption: ' + a.title);
      p.classList.remove('wide'); p.hidden = false;
      var ar = target.getBoundingClientRect(), aw = p.offsetWidth, ah = p.offsetHeight;
      p.style.left = Math.max(8, Math.min(ar.left, window.innerWidth - aw - 8)) + 'px';
      p.style.top = (ar.bottom + 8 + ah > window.innerHeight - 8 ? Math.max(8, ar.top - ah - 8) : ar.bottom + 8) + 'px';
      return;
    }
    if (id && EXPLAINERS[id]) {
      var e = EXPLAINERS[id];
      p.innerHTML = '<span class="label">' + esc(e.topic) + ' · explainer</span><h4>' + esc(e.title) + '</h4>' + figureSlot(id) + versionsHtml('data-pop-version') +
        chainsHtml(e) + linksHtml(e) +
        '<div class="actions"><button class="btn" data-copy-script>Copy</button><button class="btn ghost" data-open-explainer="' + id + '">Open explainer →</button></div>';
      p.setAttribute('aria-label', e.title);
    } else if (acr) {
      p.innerHTML = '<span class="label">Acronym</span><h4>' + esc(acr) + '</h4><p class="script">' + esc(ACRONYMS[acr]) + '</p>';
      p.setAttribute('aria-label', acr);
    } else return;
    p.classList.toggle('wide', !!(id && FIGURE_FOR[id]));
    p.hidden = false;
    mountFigures(p, popHandles);
    var r = target.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    var top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  }
  function hidePop(now) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    var go = function () { if (pop) pop.hidden = true; unmountFigures(popHandles); popTarget = null; };
    if (now === true) go(); else hideTimer = setTimeout(go, 220);
  }
  var TERM_SEL = '[data-explainer], [data-acronym], [data-assumption]';
  document.addEventListener('mouseover', function (e) {
    if (pop && pop.contains(e.target)) { clearTimeout(hideTimer); return; }
    var t = e.target.closest && e.target.closest(TERM_SEL);
    if (!t) return;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = setTimeout(function () { showPop(t); }, 160);
  });
  document.addEventListener('mouseout', function (e) {
    var to = e.relatedTarget;
    if (to && ((pop && pop.contains(to)) || (popTarget && popTarget.contains(to)))) return;
    if (e.target.closest && (e.target.closest(TERM_SEL) || (pop && pop.contains(e.target)))) { clearTimeout(showTimer); hidePop(); }
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target.closest && e.target.closest(TERM_SEL);
    if (t && !t.hasAttribute('data-open-explainer')) showPop(t);
    else if (pop && !pop.hidden && !pop.contains(e.target)) hidePop();
  });
  window.addEventListener('scroll', function () { if (pop && !pop.hidden) hidePop(true); }, { passive: true });

  // ----- calculators -----
  var P = CompanionParse;
  var DD_TYPES = ['Retirement Phase', 'TTR', 'Beneficiary (BIS)'];
  var DD_FREQS = ['Fortnightly', 'Monthly', 'Quarterly', 'Half-yearly', 'Annual'];
  var UNITS = [['business_days', 'Business days'], ['days', 'Days'], ['months', 'Months'], ['years', 'Years']];
  // Type and frequency start fresh on every launch and every new call; `touched` is what the consultant typed or picked.
  var DD_DEFAULTS = { type: 'Retirement Phase', freq: 'Monthly' };
  state.dd = { start: '', bal: '', anchor: '', chosen: '', n: '', type: DD_DEFAULTS.type, freq: DD_DEFAULTS.freq, touched: {} };
  state.dt = { from: '', n: '5', unit: 'business_days' };
  function resetCalc() {
    state.dd = { start: '', bal: '', anchor: '', chosen: '', n: '', type: DD_DEFAULTS.type, freq: DD_DEFAULTS.freq, touched: {} };
  }
  function dmy(d) { return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }

  function echoHtml(id) { return '<span class="echo" id="' + id + '-echo"></span>'; }
  function setEcho(id, text, bad) {
    var el = $(id + '-echo');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }
  function echoDate(id, text) {
    if (!String(text).trim()) return setEcho(id, '');
    var d = P.parseDate(text, 'any');
    setEcho(id, d ? fmtDate(d) : 'Not a date I recognise. Try 1/10/2026 or 1 Oct 2026', !d);
  }
  function echoMoney(id, text) {
    if (!String(text).trim()) return setEcho(id, '');
    var n = P.parseMoney(text);
    setEcho(id, n != null ? money(n) : 'Not an amount. Try 500000, $500,000 or 500k', n == null);
  }
  function memberEcho() {
    var t = state.memberText;
    if (!t.trim()) return '';
    if (state.member) return '#' + state.member.number + ' ' + state.member.name + ', age ' + currentAge() + ' (test member)';
    if (state.dob) return 'Born ' + P.fmt(CompanionDates.parse(state.dob)) + ', age ' + currentAge();
    if (state.age != null) return 'Age ' + state.age;
    if (/^\d{3}$/.test(t.trim()) && +t.trim() > 110) return 'No test member ' + t.trim() + '. Try 101 to 113.';
    if (state.memberError) return state.memberError;
    return 'Type a member number, an age (67) or a date of birth (14/5/1959)';
  }
  function setMember(text, from) {
    state.memberText = text;
    var num = String(text).trim(), m = /^\d{3}$/.test(num) ? MEMBERS[num] : null;
    var was = state.member;
    state.member = m || null;
    state.memberError = null;
    if (m) { state.dob = m.dob; state.age = null; }
    else {
      var r = P.parseAgeOrDate(text);
      state.dob = r && r.dob ? P.iso(r.dob) : null;
      state.age = r && r.age != null ? r.age : null;
      state.memberError = r && r.error ? r.error : null;
    }
    var bad = text.trim() && !m && state.dob == null && state.age == null;
    if (from !== 'member') $('member').value = text;
    if (from !== 'dd-member' && $('dd-member')) $('dd-member').value = text;
    setEcho('member', memberEcho(), bad);
    setEcho('dd-member', memberEcho(), bad);
    if (m !== was) {
      if (m) {
        state.product = CompanionMembers.primaryProduct(m);
        applyPrefill(m, from === 'panel');
      } else if (was) state.product = '';
      renderProducts();
      renderMemberStrip();
    }
  }

  // Fills the drawdown calculator from a test member's pension (or planned pension).
  // Picking a member from the list fills everything. Typing a member number only fills what the
  // consultant hasn't typed themselves, and updates the boxes in place so the cursor stays put.
  function applyPrefill(m, all) {
    var pf = CompanionMembers.prefill(m, new Date());
    if (!pf) return;
    var t = state.dd.touched, put = function (k, v) { if (all || !t[k]) state.dd[k] = v; };
    put('start', dmy(pf.start));
    put('bal', Math.round(pf.balance).toLocaleString('en-AU'));
    put('anchor', pf.anchor ? dmy(pf.anchor) : '');
    put('chosen', pf.chosen ? Math.round(pf.chosen).toLocaleString('en-AU') : '');
    put('n', '');
    if (all || !t.type) state.dd.type = pf.type;
    if (all || !t.freq) state.dd.freq = pf.freq;
    if (all) state.dd.touched = {};
    if (state.tab === 'calc' && $('dd-start')) syncCalcFields();
  }
  function syncCalcFields() {
    ['start', 'bal', 'anchor', 'chosen', 'n'].forEach(function (k) { var el = $('dd-' + k); if (el && el !== document.activeElement) el.value = state.dd[k]; });
    setSeg('type', state.dd.type);
    setSeg('freq', state.dd.freq);
    echoDrawdown();
    runDrawdown();
  }

  // ----- test member strip and picker -----
  function renderMemberStrip() {
    var el = $('member-strip'), m = state.member;
    if (!m) { el.hidden = true; el.innerHTML = ''; return; }
    var ins = CompanionMembers.insights(m, DATA.rates, new Date());
    el.hidden = false;
    el.innerHTML = '<div class="ms-head"><span class="badge caution">Fictional test member</span>' +
      '<b>#' + esc(m.number) + ' ' + esc(m.name) + '</b><span class="meta">' + esc(m.scenario) + '</span>' +
      '<button class="link ms-toggle" data-ms-toggle>' + (state.stripOpen ? 'Hide' : 'Show') + ' details</button></div>' +
      '<div class="ms-accounts">' + m.accounts.map(function (a) {
        return '<span class="ms-acc"><span class="label">' + esc(a.type) + '</span><span class="num">' + CompanionMembers.money(a.balance) + '</span></span>';
      }).join('') + '<span class="ms-acc"><span class="label">Age</span><span class="num">' + currentAge() + '</span></span>' +
      (m.income != null ? '<span class="ms-acc"><span class="label">Income</span><span class="num">' + CompanionMembers.money(m.income) + '</span></span>' : '') + '</div>' +
      (state.stripOpen ? '<ul class="ms-insights">' + ins.map(function (i) {
        var link = i.checklist ? ' data-open-proc="' + esc(i.checklist) + '"' : i.rule ? ' data-open-rule="' + esc(i.rule) + '"' : i.calc ? ' data-goto-calc="drawdown"' : '';
        return '<li class="ms-' + i.tone + '"><button class="ms-item"' + link + '>' + rich(i.text) + (link ? ' <span class="ms-go">' + (i.checklist ? 'Checklist →' : 'Rule →') + '</span>' : '') + '</button></li>';
      }).join('') + '</ul>' : '<div class="meta">' + ins.length + ' things to know. ' + ins.filter(function (i) { return i.tone === 'alarm' || i.tone === 'caution'; }).length + ' need attention.</div>');
  }
  function renderMemberPanel() {
    var el = $('member-panel');
    el.innerHTML = '<div class="mp-head"><span class="label">Fictional test members</span><span class="meta">Load one to pre-fill the age, product, calculator and checklist notes. Not real people.</span></div>' +
      '<div class="mp-list">' + DATA.members.map(function (m) {
        return '<button class="mp-item" data-load-member="' + esc(m.number) + '"><span class="num">#' + esc(m.number) + '</span><b>' + esc(m.name) + '</b><span class="meta">' + esc(m.scenario) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn" data-member-import>Import members (JSON)</button><button class="btn ghost" data-member-template>Download template</button></div>' +
      '<p class="meta">Imported members stay in this browser tab only. Use made-up details: never import real member data.</p>';
  }

  function seg(name, values, current) {
    return '<div class="seg" role="group">' + values.map(function (v) {
      var val = Array.isArray(v) ? v[0] : v, lab = Array.isArray(v) ? v[1] : v;
      return '<button type="button" data-seg="' + name + '" data-val="' + esc(val) + '" aria-pressed="' + (val === current) + '">' + esc(lab) + '</button>';
    }).join('') + '</div>';
  }
  function field(id, label, inner) { return '<label for="' + id + '">' + label + '</label><div class="cell">' + inner + '</div>'; }
  function textInput(id, value, placeholder, mode) {
    return '<input id="' + id + '" type="text" autocomplete="off" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"' + (mode ? ' inputmode="' + mode + '"' : '') + '>' + echoHtml(id);
  }

  function renderCalculators() {
    unmountFigures(); hidePop(true);
    var dd = state.dd;
    if (!dd.start) dd.start = dmy(P.today());
    var fortnightly = dd.freq === 'Fortnightly';
    main.innerHTML = '<div class="calc-layout">' +
      '<section class="card" id="calc-drawdown"><span class="label">Flexi Pension</span><h3>Minimum and maximum payments</h3>' +
      '<p class="detail">Same arithmetic as the Excel workbook. Type values the way you see them; each field shows what it understood.</p>' +
      '<div class="quick"><label for="dd-quick">Quick entry</label>' +
      '<input id="dd-quick" type="text" autocomplete="off" placeholder="e.g. 14/5/1959 500k 1/10/2026 TTR fortnightly">' + echoHtml('dd-quick') + '</div>' +
      '<div class="form-grid">' +
      field('dd-member', 'Age or date of birth', textInput('dd-member', state.memberText, '67 or 14/5/1959')) +
      field('dd-start', 'Pension start date', textInput('dd-start', dd.start, '1/10/2026 or 1 Oct') +
        '<div class="presets"><button type="button" class="btn sm" data-start="today">Today</button><button type="button" class="btn sm" data-start="next-month">1st of next month</button><button type="button" class="btn sm" data-start="july">Next 1 July</button></div>') +
      field('dd-bal', 'Opening balance', textInput('dd-bal', dd.bal, '500000, $500,000 or 500k', 'decimal')) +
      '<span class="label">Type</span><div class="cell">' + seg('type', DD_TYPES, dd.type) + '</div>' +
      '<span class="label">Frequency</span><div class="cell">' + seg('freq', DD_FREQS, dd.freq) + '</div>' +
      '<label for="dd-anchor" class="anchor-row"' + (fortnightly ? '' : ' hidden') + '>Any fortnightly payment date</label><div class="cell anchor-row"' + (fortnightly ? '' : ' hidden') + '>' +
        textInput('dd-anchor', dd.anchor, 'optional, e.g. 13/11/2026') +
        '<span class="field-help">Fortnightly payments go out every second Friday. One past payment date from the account history tells the calculator which Fridays, so it can count exactly. ' + assumeSpan('fortnightly', 'Leave it blank to estimate one payment every 14 days') + '.</span></div>' +
      field('dd-chosen', 'Chosen annual amount', textInput('dd-chosen', dd.chosen, 'optional', 'decimal')) +
      field('dd-n', 'Payments left', textInput('dd-n', dd.n, 'optional: overrides the count', 'numeric')) +
      '</div><div class="actions"><button type="button" class="btn ghost" data-clear-calc>Clear calculator</button></div></section>' +
      '<section class="card results-card"><span class="label">Result</span><div class="results" id="dd-out"></div></section></div>';

    $('dd-quick').addEventListener('input', quickEntry);
    $('dd-member').addEventListener('input', function () { setMember(this.value, 'dd-member'); runDrawdown(); });
    ['start', 'bal', 'anchor', 'chosen', 'n'].forEach(function (k) {
      $('dd-' + k).addEventListener('input', function () { state.dd[k] = this.value; state.dd.touched[k] = true; echoDrawdown(); runDrawdown(); });
    });
    setMember(state.memberText, 'render');
    echoDrawdown();
    runDrawdown();
  }

  // Date calculator: opens from the start screen, and under any timeframe that has a fixed length.
  function datesToolHtml() {
    var dt = state.dt, presets = DATA.timeframes.filter(function (t) { return t.calc; });
    if (!dt.from) dt.from = dmy(P.today());
    return '<section class="card dates-tool" id="calc-dates"><span class="label">Date calculator</span><h3>When is it due?</h3>' +
      '<p class="detail">Pick a timeframe or enter your own. ' + assumeSpan('business-days', 'Business days') + ' skip weekends and ' + assumeSpan('vic-holidays', 'Victorian public holidays') + '; counts in days are ' + assumeSpan('calendar-days', 'calendar days') + '.</p>' +
      '<div class="dates-grid"><div class="form-grid">' +
      field('dt-from', 'From', textInput('dt-from', dt.from, 'today, 23/12/2026 or 23 Dec') +
        '<div class="presets"><button type="button" class="btn sm" data-from="today">Today</button></div>') +
      '<label for="dt-preset">Timeframe</label><div class="cell"><select id="dt-preset"><option value="">Custom</option>' + presets.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (state.calcPreset === t.id ? ' selected' : '') + '>' + esc(t.task) + ' (' + t.calc.n + ' ' + t.calc.type.replace('_', ' ') + ')</option>';
      }).join('') + '</select></div>' +
      field('dt-n', 'Amount', textInput('dt-n', dt.n, '5', 'numeric')) +
      '<span class="label">Unit</span><div class="cell">' + seg('unit', UNITS, dt.unit) + '</div>' +
      '</div><div class="results" id="dt-out"></div></div></section>';
  }
  function bindDates() {
    if (!$('dt-from')) return;
    $('dt-from').addEventListener('input', function () { state.dt.from = this.value; echoDate('dt-from', this.value); runDates(); });
    $('dt-n').addEventListener('input', function () { state.dt.n = this.value; state.calcPreset = null; $('dt-preset').value = ''; runDates(); });
    $('dt-preset').addEventListener('change', function () { state.calcPreset = this.value || null; applyPreset(); runDates(); });
    if (state.calcPreset) applyPreset();
    echoDate('dt-from', state.dt.from);
    runDates();
  }

  function echoDrawdown() {
    echoDate('dd-start', state.dd.start);
    echoMoney('dd-bal', state.dd.bal);
    echoDate('dd-anchor', state.dd.anchor);
    var a = P.parseDate(state.dd.anchor, 'any');
    if (a && a.getDay() !== 5) setEcho('dd-anchor', fmtDate(a) + ' is not a Friday', true);
    echoMoney('dd-chosen', state.dd.chosen);
  }

  // Fills the drawdown fields from one typed or pasted line.
  function quickEntry() {
    var q = P.parseQuick(this.value), got = [];
    if (q.dob) { setMember(dmy(q.dob), 'quick'); got.push('born ' + P.fmt(q.dob)); }
    else if (q.age != null) { setMember(String(q.age), 'quick'); got.push('age ' + q.age); }
    if (q.start) { state.dd.touched.start = true; state.dd.start = dmy(q.start); $('dd-start').value = state.dd.start; got.push('starts ' + P.fmt(q.start)); }
    if (q.balance != null) { state.dd.touched.bal = true; state.dd.bal = q.balance.toLocaleString('en-AU'); $('dd-bal').value = state.dd.bal; got.push(money(q.balance)); }
    if (q.type) { state.dd.touched.type = true; setSeg('type', q.type); got.push(q.type); }
    if (q.freq) { state.dd.touched.freq = true; setSeg('freq', q.freq); got.push(q.freq.toLowerCase()); }
    setEcho('dd-quick', this.value.trim() ? (got.length ? 'Understood: ' + got.join(', ') : 'Nothing recognised yet') : '', this.value.trim() && !got.length);
    echoDrawdown();
    runDrawdown();
  }

  function setSeg(name, value) {
    if (name === 'type') state.dd.type = value;
    if (name === 'freq') {
      state.dd.freq = value;
      document.querySelectorAll('.anchor-row').forEach(function (el) { el.hidden = value !== 'Fortnightly'; });
    }
    if (name === 'unit') { state.dt.unit = value; state.calcPreset = null; if ($('dt-preset')) $('dt-preset').value = ''; }
    document.querySelectorAll('[data-seg="' + name + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-val') === value)); });
  }

  function applyPreset() {
    var t = TIMEFRAMES[state.calcPreset];
    if (!t || !t.calc) return;
    state.dt.n = String(t.calc.n);
    $('dt-n').value = state.dt.n;
    var keep = state.calcPreset;
    setSeg('unit', t.calc.type);
    state.calcPreset = keep;
    $('dt-preset').value = keep;
  }

  function row(label, value) { return '<div class="row"><span>' + rich(label) + '</span><b>' + value + '</b></div>'; }

  function runDrawdown() {
    var out = $('dd-out'), dd = state.dd;
    var start = P.parseDate(dd.start, 'any'), bal = P.parseMoney(dd.bal);
    var missing = [];
    if (!state.dob && state.age == null) missing.push('age or date of birth');
    if (!start) missing.push('start date');
    if (!(bal > 0)) missing.push('balance');
    if (missing.length) { out.innerHTML = '<p class="meta">Still needed: ' + missing.join(', ') + '.</p>'; return; }
    var r = CompanionDrawdown.calculate({
      dob: state.dob ? CompanionDates.parse(state.dob) : null, age: state.age, start: start, balance: bal,
      type: dd.type === 'TTR' ? 'TTR' : dd.type, freq: dd.freq, anchor: P.parseDate(dd.anchor, 'any'),
      chosen: P.parseMoney(dd.chosen), paymentsOverride: dd.n.trim() ? parseInt(dd.n, 10) : null
    }, DATA.rates);
    var range = money(r.proMin) + (r.max != null ? ' to ' + money(r.max) : ' or more');
    // The inputs go into the copied note too, so it stands on its own in the call notes.
    var anchor = P.parseDate(dd.anchor, 'any'), chosen = P.parseMoney(dd.chosen);
    var inputs = (state.dob ? 'Born ' + P.fmt(CompanionDates.parse(state.dob)) : 'Age ' + state.age) + '. ' + dd.type + ' Flexi Pension starting ' + P.fmt(start) +
      ', opening balance ' + money(bal) + ', ' + dd.freq.toLowerCase() + ' payments' + (anchor ? ' (a pay date: ' + P.fmt(anchor) + ')' : '') +
      (chosen ? ', chosen amount ' + money(chosen) + ' a year' : '') + (dd.n.trim() ? ', ' + parseInt(dd.n, 10) + ' payments left (entered)' : '') + '.\n';
    var summary = inputs + 'Age ' + r.age + ', ' + pct(r.pct) + ' minimum. Pro-rata minimum to 30 June: ' + money(r.proMin) +
      (r.max != null ? '; TTR maximum ' + money(r.max) : '') + ' (' + r.daysLeft + ' of ' + r.daysYear + ' days, rounded to the nearest $10).' +
      (r.perMin != null ? ' ' + r.payments + ' ' + dd.freq.toLowerCase() + ' payments of at least ' + money(r.perMin) + '.' : '');
    // The calculator's caveats travel with the copied note, so an estimate isn't pasted as fact.
    if (r.warnings.length) summary += '\nNotes: ' + r.warnings.map(plain).join(' ');
    out.innerHTML = '<div class="headline">' + esc(range) + '<span>allowed this financial year</span></div>' +
      row(state.dob ? 'Age at start' : '{{age-only:Age at start}}', r.age) + row('Minimum percentage', pct(r.pct) + ' (' + esc(r.band) + ')') +
      row('Preservation age', r.preservationAge != null ? r.preservationAge + (r.preservationReached ? ' (reached)' : ' (not reached yet)') : 'Reached (60 or over)') +
      row('{{day-count:Days left / days in year}}', r.daysLeft + ' / ' + r.daysYear) + row('Full-year minimum', money(r.fullMin)) +
      row('Pro-rata minimum to 30 June', money(r.proMin)) + row('Maximum', r.max != null ? money(r.max) : 'No maximum') +
      row(dd.freq === 'Fortnightly' && !dd.anchor.trim() ? '{{fortnightly:Payments left}}' : '{{payments-left:Payments left}}', r.payments == null ? '–' : r.payments) +
      (r.perMin != null ? row('{{payment-rounding:Each payment at the minimum}}', money(r.perMin)) : '') +
      (r.perMax != null ? row('{{payment-rounding:Each payment at the maximum}}', money(r.perMax)) : '') +
      (r.perChosen != null ? row('{{payment-rounding:Each payment at the chosen amount}}', money(r.perChosen)) : '') +
      (r.pctNext != null ? row('Minimum from next 1 July (age ' + r.ageNext + ')', pct(r.pctNext)) : '') +
      (r.warnings.length ? '<ul class="warns">' + r.warnings.map(function (w) { return '<li>' + rich(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="actions"><button class="btn" data-copy="' + esc(summary) + '">Copy summary</button></div>';
  }

  // The Friday before the AFL Grand Final is set each year by the Victorian Government, so it's only
  // counted once it's in holidays.json. Flag a business-day count that runs through late September of
  // a year that has no entry yet.
  function grandFinalNote(from, to, unit) {
    if (unit !== 'business_days') return '';
    var missing = [];
    for (var y = from.getFullYear(); y <= to.getFullYear(); y++) {
      var lo = new Date(y, 8, 18), hi = new Date(y, 9, 2);
      var known = (DATA.holidays || []).some(function (h) { return h.date.slice(0, 4) === String(y) && /grand final/i.test(h.name); });
      if (!known && from <= hi && to >= lo) missing.push(y);
    }
    return missing.length ? '<ul class="warns"><li>' + rich('{{vic-holidays:The Friday before the AFL Grand Final}} for ' + missing.join(' and ') +
      ' isn\'t loaded. If it falls in this range, the due date is one business day later.') + '</li></ul>' : '';
  }

  function runDates() {
    var out = $('dt-out');
    var d0 = P.parseDate(state.dt.from, 'any'), n = parseInt(state.dt.n, 10), unit = state.dt.unit;
    if (!d0 || !(n >= 0)) { out.innerHTML = '<p class="meta">Enter a start date and an amount.</p>'; return; }
    // Counted one day at a time, so a huge number would freeze the page. Ten years is plenty.
    var LIMIT = { business_days: 2600, days: 3660, months: 120, years: 10 }[unit];
    if (n > LIMIT) { out.innerHTML = '<p class="meta bad">Up to ' + LIMIT.toLocaleString('en-AU') + ' ' + unit.replace('_', ' ') + ' (about ten years).</p>'; return; }
    var res = CompanionDates.apply({ type: unit, n: n }, d0, cal);
    var fyEnd = CompanionDates.financialYearEnd(d0);
    var t = TIMEFRAMES[state.calcPreset];
    var unitLabel = { business_days: 'business days', days: 'days', months: 'months', years: 'years' }[unit];
    var unitMark = { business_days: '{{business-days:business days}}', days: '{{calendar-days:days}}', months: 'months', years: 'years' }[unit];
    var text = n + ' ' + unitLabel + ' from ' + fmtDate(d0) + ' is ' + fmtDate(res.date) + '.';
    out.innerHTML = '<div class="headline">' + esc(fmtDate(res.date)) + '<span>' + rich(n + ' ' + unitMark + ' from ' + fmtDate(d0)) + '</span></div>' +
      (t ? '<div class="say">' + esc(t.say) + '</div>' : '') +
      (res.skipped.length ? row('Public holidays skipped', esc(res.skipped.map(function (s) {
        return CompanionDates.parse(s.slice(0, 10)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' (' + s.slice(11) + ')';
      }).join(', '))) : '') +
      (cal.holidayName(d0) ? row('Note', esc(cal.holidayName(d0)) + ' on the start date') : '') +
      grandFinalNote(d0, res.date, unit) +
      row('Days from this date to 30 June ' + fyEnd.getFullYear() + ', both counted', CompanionDates.daysBetweenInclusive(d0, fyEnd)) +
      '<div class="actions"><button class="btn" data-copy="' + esc(text) + '">Copy</button></div>';
  }

  function render() {
    renderTabs();
    if (state.tab === 'calc') { ws = null; return renderCalculators(); }
    if (!state.q.trim() && state.tab === 'all') return renderBrowse();
    renderWorkspace(true);
  }

  function renderTabs() {
    $('tabs').innerHTML = TABS.map(function (t) {
      return '<button class="tab" role="tab" data-tab="' + t.id + '" aria-selected="' + (state.tab === t.id) + '">' + t.label + '</button>';
    }).join('');
  }

  function renderProducts() {
    $('product').innerHTML = PRODUCTS.map(function (p) {
      return '<option value="' + p.id + '"' + (state.product === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>';
    }).join('');
    $('product').classList.toggle('set', !!state.product);
  }
  $('product').addEventListener('change', function () {
    state.product = this.value; renderProducts(); render();
  });

  // ----- events -----
  var timer = null;
  qEl.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = qEl.value; state.showHidden = false; state.sel = null; state.pinned = false;
      if (state.tab === 'calc') state.tab = 'all';
      render();
    }, 60);
  });
  // ↑ ↓ move through the results without leaving the search box; Enter keeps the selected one for this call.
  qEl.addEventListener('keydown', function (e) {
    if (!ws || !main.contains(ws.root)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && e.shiftKey && state.sel) {
      // Shift+Enter: into the answer, so Tab reaches its buttons without passing every result.
      e.preventDefault(); rememberInCall(state.sel); scrollToDetail(); ws.detail.focus({ preventScroll: true });
    }
    else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && state.sel) { e.preventDefault(); rememberInCall(state.sel); renderDetail(); scrollToDetail(); }
  });
  // New call: clears the search, member, product filter, ticks and the "earlier in this call" list.
  $('new-call').addEventListener('click', function () {
    state.q = ''; qEl.value = ''; state.tab = 'all'; state.sel = null; state.pinned = false; state.recent = []; state.ticks = {}; state.showHidden = false;
    state.product = '';
    resetCalc(); state.dt = { from: '', n: '5', unit: 'business_days' }; state.calcPreset = null; state.stripOpen = false; state.memberError = null;
    setMember('', 'clear');
    $('member-panel').hidden = true; $('member-pick').setAttribute('aria-expanded', 'false');
    renderProducts(); render(); window.scrollTo(0, 0); qEl.focus();
    toast('Ready for the next call');
  });
  // Keeps the sticky side columns just under the header, whatever its height.
  var topEl = document.querySelector('.top');
  function syncTop() { document.documentElement.style.setProperty('--top-h', topEl.offsetHeight + 'px'); }
  if (window.ResizeObserver) new ResizeObserver(syncTop).observe(topEl);
  syncTop();
  $('member').addEventListener('input', function () { setMember(this.value, 'member'); if (state.tab === 'calc') runDrawdown(); else render(); });
  $('member-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result), list = Array.isArray(parsed) ? parsed : parsed.members;
        var errs = CompanionMembers.validate(list);
        if (errs.length) { toast('Not imported: ' + errs[0]); return; }
        list.forEach(function (m) {
          if (!MEMBERS[m.number]) DATA.members.push(m);
          else DATA.members[DATA.members.indexOf(MEMBERS[m.number])] = m;
          MEMBERS[m.number] = m;
        });
        renderMemberPanel();
        toast('Imported ' + list.length + ' test member' + (list.length > 1 ? 's' : ''));
      } catch (err) { toast('Not imported: that file isn\'t valid JSON'); }
    };
    reader.readAsText(file);
    this.value = '';
  });
  $('clear-context').addEventListener('click', function () { setMember('', 'clear'); state.product = ''; renderProducts(); render(); });

  // Enter moves to the next field in a calculator, like Tab.
  main.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    var fields = Array.prototype.slice.call(e.target.closest('section').querySelectorAll('input:not([hidden])')).filter(function (el) { return el.offsetParent; });
    var next = fields[fields.indexOf(e.target) + 1];
    if (next) { e.preventDefault(); next.focus(); next.select(); }
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a, .term, .acr, .assume');
    if (!t) { if (pop && !pop.hidden && !pop.contains(e.target)) hidePop(true); return; }
    if (t.hasAttribute('data-open-explainer')) { openItem('explainer', t.getAttribute('data-open-explainer')); return; }
    if (t.hasAttribute('data-sel')) {
      var sp = t.getAttribute('data-sel').split(':');
      if (t.classList.contains('hit')) {
        state.sel = { type: sp[0], id: sp[1] }; state.pinned = false;
        rememberInCall(state.sel); renderDetail(); scrollToDetail();
      } else openItem(sp[0], sp[1]);
      return;
    }
    if (t.hasAttribute('data-open-dates')) {
      state.tab = 'timeframe'; state.q = ''; qEl.value = ''; state.sel = { type: 'tool', id: 'dates' }; state.pinned = true; state.calcPreset = null;
      renderTabs(); renderWorkspace(); scrollToDetail(); return;
    }
    if (t.matches('.term, .acr, .assume')) { showPop(t); return; }
    if (t.hasAttribute('data-show-assumptions')) { showAssumptions(); return; } // tap on touch screens
    if (t.hasAttribute('data-q')) { qEl.value = t.getAttribute('data-q'); state.q = qEl.value; render(); qEl.focus(); return; }
    if (t.hasAttribute('data-pop-version')) {
      var pv = t.getAttribute('data-pop-version');
      pop.querySelectorAll('[data-pop-version]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      pop.querySelectorAll('.script').forEach(function (s) { s.hidden = s.getAttribute('data-script') !== pv; });
      return;
    }
    if (t.hasAttribute('data-tab')) {
      var nt = t.getAttribute('data-tab');
      if (nt !== state.tab) { state.sel = null; state.pinned = false; }
      state.tab = nt; render(); if (!t.classList.contains('tchip')) window.scrollTo(0, 0); return;
    }
    if (t.hasAttribute('data-copy')) { copy(t.getAttribute('data-copy')); return; }
    if (t.hasAttribute('data-copy-script')) {
      var card = t.closest('.card, .pop'), shown = card.querySelector('.script:not([hidden])');
      copy(shown.hasAttribute('data-explainer-id') ? chainText(shown) : shown.textContent); return;
    }
    if (t.hasAttribute('data-version')) {
      var c = t.closest('.card'), v = t.getAttribute('data-version');
      c.querySelectorAll('[data-version]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      c.querySelectorAll('.script').forEach(function (s) { s.hidden = s.getAttribute('data-script') !== v; });
      return;
    }
    if (t.hasAttribute('data-open-proc')) { openProcedure(t.getAttribute('data-open-proc')); return; }
    if (t.hasAttribute('data-tick')) {
      var pid = t.closest('[data-proc]').getAttribute('data-proc'), i = +t.getAttribute('data-tick');
      var tk = state.ticks[pid] = state.ticks[pid] || {};
      if (tk[i]) delete tk[i]; else tk[i] = true;
      t.setAttribute('aria-pressed', String(!!tk[i]));
      t.closest('.step').classList.toggle('done', !!tk[i]);
      $('proc-progress').textContent = Object.keys(tk).length + ' of ' + PROCS[pid].steps.length + ' done';
      return;
    }
    if (t.hasAttribute('data-copy-proc')) { copy(procNote(PROCS[t.closest('[data-proc]').getAttribute('data-proc')])); return; }
    if (t.hasAttribute('data-reset-proc')) { var rp = t.closest('[data-proc]').getAttribute('data-proc'); state.ticks[rp] = {}; renderDetail(); return; }
    if (t.hasAttribute('data-load-member')) {
      setMember(t.getAttribute('data-load-member'), 'panel');
      $('member-panel').hidden = true; $('member-pick').setAttribute('aria-expanded', 'false');
      render(); return;
    }
    if (t.hasAttribute('data-ms-toggle')) { state.stripOpen = !state.stripOpen; renderMemberStrip(); return; }
    if (t.id === 'member-pick') {
      var panel = $('member-panel'); panel.hidden = !panel.hidden; t.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) renderMemberPanel();
      return;
    }
    if (t.hasAttribute('data-member-import')) { $('member-file').click(); return; }
    if (t.hasAttribute('data-member-template')) {
      var sample = { note: 'Fictional test members only. number: 3 digits. Account types: Accumulation 1, Accumulation 2, Personal Account, DBD, Retirement Phase, TTR, BIS.', members: [DATA.members[1]] };
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' }));
      a.download = 'test-members-template.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return;
    }
    if (t.hasAttribute('data-open-form')) { openItem('form', t.getAttribute('data-open-form')); return; }
    if (t.hasAttribute('data-open-timeframe')) { openItem('timeframe', t.getAttribute('data-open-timeframe')); return; }
    if (t.hasAttribute('data-open-rule')) { openItem('rule', t.getAttribute('data-open-rule')); return; }
    if (t.hasAttribute('data-seg')) {
      setSeg(t.getAttribute('data-seg'), t.getAttribute('data-val'));
      if (t.getAttribute('data-seg') !== 'unit') state.dd.touched[t.getAttribute('data-seg')] = true;
      if (t.getAttribute('data-seg') === 'unit') runDates(); else runDrawdown();
      return;
    }
    if (t.hasAttribute('data-start')) {
      var now = CompanionParse.today(), which = t.getAttribute('data-start'), d = now;
      if (which === 'next-month') d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      if (which === 'july') d = new Date(now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(), 6, 1);
      state.dd.start = dmy(d); state.dd.touched.start = true; $('dd-start').value = state.dd.start; echoDrawdown(); runDrawdown(); return;
    }
    if (t.hasAttribute('data-from')) { state.dt.from = dmy(CompanionParse.today()); $('dt-from').value = state.dt.from; echoDate('dt-from', state.dt.from); runDates(); return; }
    if (t.hasAttribute('data-clear-calc')) {
      resetCalc();
      setMember('', 'clear'); renderCalculators(); $('dd-quick').focus(); return;
    }
    if (t.hasAttribute('data-show-hidden')) { state.showHidden = true; render(); return; }
    if (t.hasAttribute('data-calc-preset')) {
      // The date calculator sits under the timeframe in the middle column, already set to it.
      var tfId = t.getAttribute('data-calc-preset');
      if (!state.sel || state.sel.type !== 'timeframe' || state.sel.id !== tfId) openItem('timeframe', tfId, { stay: true });
      var dtFrom = $('dt-from'); if (dtFrom) { dtFrom.scrollIntoView({ block: 'center', behavior: 'smooth' }); dtFrom.focus({ preventScroll: true }); }
      return;
    }
    if (t.hasAttribute('data-goto-calc')) {
      // Opened from a TTR, BIS or Retirement Phase card: start on that type, with the cursor in the first empty box.
      if (t.getAttribute('data-calc-type')) state.dd.type = t.getAttribute('data-calc-type');
      state.tab = 'calc'; render(); window.scrollTo(0, 0);
      var empty = ['dd-member', 'dd-bal'].map($).filter(function (el) { return el && !el.value.trim(); })[0];
      if (empty) empty.focus();
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    // Ctrl+Enter: copy the open answer (the card's main copy button), from the search box or anywhere.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ws && main.contains(ws.root)) {
      var mainCopy = ws.detail.querySelector('[data-main-copy]');
      if (mainCopy) { e.preventDefault(); if (state.sel) rememberInCall(state.sel); mainCopy.click(); }
      return;
    }
    if (e.key === '/' && document.activeElement !== qEl && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); qEl.focus(); qEl.select();
    } else if (e.key === 'Escape' && pop && !pop.hidden) {
      var back = popTarget; hidePop(true); if (back) back.focus();
    } else if (e.key === 'Escape' && document.activeElement === qEl) {
      qEl.value = ''; state.q = ''; state.sel = null; state.pinned = false; render();
    } else if (e.altKey && /^[1-7]$/.test(e.key)) {
      state.tab = TABS[+e.key - 1].id; state.sel = null; state.pinned = false; render();
    }
  });

  function copy(text) {
    function done() { toast('Copied'); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('Copy failed: select the text instead'); }
      document.body.removeChild(ta);
    }
  }
  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1400);
  }

  $('foot').innerHTML = 'General information from the public UniSuper PDS documents issued ' + esc(issued('flexi')) + ': ' +
    DATA.sources.filter(function (s) { return s.kind === 'pds'; }).map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>'; }).join(', ') +
    '. ATO pages are linked as supplementary sources only. Words with a red dotted underline are <button class="link" data-show-assumptions>assumptions (' + DATA.assumptions.length + ')</button>. Built ' + esc(DATA.built) + '. Not personal advice. Nothing typed here is saved or sent anywhere.';

  // The tests render every card through these (see test/companion.test.mjs); unused in the page.
  if (window.__companionTest) window.__companionTest.api = { RENDER: RENDER, procedureView: procedureView, datesToolHtml: datesToolHtml, startHtml: startHtml, sideHtml: sideHtml, state: state, setMember: setMember };

  if (!TABS.some(function (t) { return t.id === state.tab; })) state.tab = 'all';
  renderProducts();
  render();
  qEl.focus();
})();
