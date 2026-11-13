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
    { id: 'all', label: 'All', types: null }, { id: 'rule', label: 'Rules', types: ['rule'] },
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

  var state = { member: null, stripOpen: false, ticks: {}, q: '', product: store.get('product') || '', tab: store.get('tab') || 'all', memberText: '', age: null, dob: null, showHidden: false, calcPreset: null };

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
    if (!d) return '';
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
    return '<footer class="sources"><span class="label">' + (list.length > 1 ? 'Sources' : 'Source') + ' · UniSuper PDS</span>' + list.map(sourceHtml).join('') +
      (ato && ato.length ? atoHtml(ato) : '') + '</footer>';
  }
  // Supplementary ATO material: shown under the PDS source, never instead of it.
  function atoHtml(list) {
    return '<div class="ato"><span class="label">ATO · supplementary</span>' + list.map(function (s) {
      var d = DOCS[s.doc] || { title: s.doc, url: '#' };
      return '<div class="src"><a href="' + esc(d.url) + '" target="_blank" rel="noopener"><span class="src-doc">' + esc(d.title) + '</span>' +
        '<span class="src-meta">' + (d.updated ? 'updated ' + esc(d.updated) + ' · ' : '') + 'read ' + esc(isoText(d.retrieved)) + ' ↗</span></a>' +
        '<q>' + esc(s.quote) + '</q></div>';
    }).join('') + '</div>';
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
    if (MARK_RE.test(escaped)) {
      MARK_RE.lastIndex = 0;
      var parts = [], last = 0, mm;
      while ((mm = MARK_RE.exec(escaped))) { parts.push(annotate(escaped.slice(last, mm.index), seen)); parts.push(ASSUMPTIONS[mm[1]] ? assumeSpan(mm[1], mm[2]) : mm[2]); last = mm.index + mm[0].length; }
      MARK_RE.lastIndex = 0;
      return parts.join('') + annotate(escaped.slice(last), seen);
    }
    MARK_RE.lastIndex = 0;
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
  var SHORT_BANDS = ['<65', '65–74', '75–79', '80–84', '85–89', '90–94', '95+'];
  function figureOptions(name) {
    var age = currentAge(), rows = DATA.rates.tables.minimum_drawdown.rows, band = -1;
    if (age != null) rows.forEach(function (r, i) { if (age >= r.from_age) band = i; });
    var now = new Date(), fy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    if (name === 'bands') return { rows: rows.map(function (r, i) { return { label: r.label, short: SHORT_BANDS[i], pct: r.pct }; }), selected: band >= 0 ? band : 1, note: band >= 0 ? 'member is ' + age : '' };
    if (name === 'months') {
      var bal = state.dd && CompanionParse.parseMoney(state.dd.bal);
      return { fyStartYear: fy, selected: 3, balance: bal || 500000, pct: band >= 0 ? rows[band].pct : 0.05, example: !bal || band < 0 };
    }
    if (name === 'layers') return { names: ['Cash', 'Australian Bond', 'Conservative', 'Conservative Balanced', 'Australian Income', 'Balanced', 'Sustainable Balanced', 'Growth'] };
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
      var labels = ['Before 1 July 1960', '1 Jul 1960 – 30 Jun 1961', '1 Jul 1961 – 30 Jun 1962', '1 Jul 1962 – 30 Jun 1963', '1 Jul 1963 – 30 Jun 1964', '1 July 1964 or later'];
      var pnote = phit >= 0 ? '<div class="age-note">Born ' + esc(CompanionParse.fmt(CompanionDates.parse(state.dob))) + ': preservation age <b>' + prow[phit].age + '</b></div>' : (age != null ? '<div class="meta">Enter a date of birth to pick the row.</div>' : '');
      return pnote + '<table class="mini"><thead><tr><th>Date of birth</th><th class="num">Preservation age</th></tr></thead><tbody>' + prow.map(function (r, i) {
        return '<tr class="' + (i === phit ? 'hit' : '') + '"><td>' + labels[i] + '</td><td class="num">' + r.age + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (card.age_table === 'bring_forward') {
      var b = DATA.rates.tables.bring_forward.rows, prev = 0;
      return '<table class="mini"><thead><tr><th>Total super balance at 30 June 2026</th><th class="num">First-year cap</th><th>Period</th></tr></thead><tbody>' + b.map(function (r) {
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
      '<div class="actions"><button class="btn" data-copy="' + esc(copy) + '">Copy answer and source</button>' +
      (c.calc === 'drawdown' ? '<button class="btn ghost" data-goto-calc="drawdown">Drawdown calculator →</button>' : '') + '</div>' + see + '</article>';
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
    var srcs = [f.pds, f.account_source].filter(Boolean);
    return '<article class="card" data-id="' + esc(f.id) + '">' + head(f.group + ' form', badges) +
      '<h3 class="card-title">' + esc(f.title) + '</h3>' +
      (f.summary ? '<p class="detail">' + annotate(esc(f.summary), seen) + '</p>' : '') + say +
      (steps.length ? '<ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' : '') +
      account + (f.phone ? '<div class="row-line"><span class="label">Phone</span><span class="num">' + esc(f.phone) + '</span></div>' : '') + reqs +
      (srcs.length ? sourcesHtml(srcs) : '') +
      '<div class="actions">' +
      (f.online ? '<a class="btn solid" href="' + esc(f.online) + '" target="_blank" rel="noopener">' + esc(f.online_label || 'Complete online') + ' ↗</a>' : '') +
      (f.pdf ? '<a class="btn" href="' + esc(f.pdf) + '" target="_blank" rel="noopener">Open PDF ↗</a><button class="btn" data-copy="' + esc(f.pdf) + '">Copy PDF link</button>' : '') +
      '<button class="btn" data-copy="' + esc(directionsText) + '">Copy directions</button></div></article>';
  }

  function timeframeCard(t) {
    var seen = {};
    var kind = { pds: 'PDS', law: 'Law', internal: 'Internal' }[t.kind] || t.kind;
    return '<article class="card" data-id="' + esc(t.id) + '">' + head((t.topic || 'Timeframe') + ' · timeframe', badge(kind, t.kind === 'internal' ? 'caution' : '')) +
      '<h3 class="card-title">' + esc(t.task) + '</h3>' +
      '<div class="figure-line">' + esc(t.timeframe) + '</div>' + (t.starts ? '<div class="meta">Clock starts: ' + esc(t.starts) + '</div>' : '') +
      '<div class="say"><span class="label">Say</span><p>' + annotate(esc(t.say), seen) + '</p></div>' + (t.source ? sourcesHtml([t.source], t.ato) : '') +
      '<div class="actions"><button class="btn" data-copy="' + esc(plain(t.say)) + '">Copy wording</button>' +
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
  function chainsHtml(e) {
    return VERSIONS.map(function (x) {
      return '<ol class="script chain" data-script="' + x[0] + '" aria-label="' + x[2] + '"' + (x[0] === DEFAULT_VERSION ? '' : ' hidden') + '>' +
        e[x[0]].map(function (s) { return '<li>' + rich(s) + '</li>'; }).join('') + '</ol>';
    }).join('');
  }
  function chainText(ol) {
    return Array.prototype.map.call(ol.querySelectorAll('li'), function (li, i) { return (i + 1) + '. ' + li.textContent; }).join('\n');
  }
  function explainerCard(e) {
    return '<article class="card explainer" data-id="' + esc(e.id) + '">' + head(e.topic + ' · explainer', '') +
      '<h3 class="card-title">' + esc(e.title) + '</h3>' + figureSlot(e.id) + versionsHtml('data-version') +
      chainsHtml(e) +
      '<div class="general"><span class="label">Stay general</span><p>' + esc(e.general) + '</p></div>' + sourcesHtml([e.source]) +
      '<div class="actions"><button class="btn" data-copy-script>Copy this version</button></div></article>';
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
  function memberCtx() { return state.member ? CompanionMembers.context(state.member, DATA.rates, new Date()) : null; }
  function stepNotes(st, ctx) {
    if (!ctx || !st.member) return '';
    return st.member.filter(function (n) { return ctx.cond[n.cond]; }).map(function (n) {
      return '<div class="step-member"><span class="label">#' + esc(state.member.number) + '</span>' + rich(CompanionMembers.fill(n.text, ctx.vars)) + '</div>';
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
    return '<button class="btn ghost back" data-tab="proc">← All checklists</button>' +
      '<article class="card proc" data-proc="' + esc(p.id) + '">' + head(p.topic + ' · checklist', '<span class="badge" id="proc-progress">' + done + ' of ' + p.steps.length + ' done</span>') +
      '<h3 class="card-title proc-title">' + esc(p.title) + '</h3><p class="detail">' + esc(p.when) + ' <span class="meta">Steps are in ' + assumeSpan('checklist-order', 'a suggested order') + '.</span></p>' +
      (state.member ? '<div class="proc-member">Notes for <b>#' + esc(state.member.number) + ' ' + esc(state.member.name) + '</b> (test member) are shown under the steps they affect.</div>' : '') +
      '<ol class="steps-list">' + p.steps.map(function (st, i) {
        return '<li class="step' + (ticks[i] ? ' done' : '') + '"><button class="tick" data-tick="' + i + '" aria-pressed="' + !!ticks[i] + '" aria-label="Mark step ' + (i + 1) + ' done"><span class="tick-n">' + (i + 1) + '</span></button>' +
          '<div class="step-body"><p>' + annotate(esc(st.do), seen) + '</p>' + stepNotes(st, ctx) + stepLinks(st) + (st.source ? stepSource(st.source) : '') + '</div></li>';
      }).join('') + '</ol>' +
      (p.mistakes && p.mistakes.length ? '<div class="general"><span class="label">Common mistakes</span><ul class="reqs">' + p.mistakes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="actions"><button class="btn solid" data-copy-proc>Copy as call note</button><button class="btn ghost" data-reset-proc>Reset ticks</button></div></article>';
  }
  function openProcedure(id) {
    state.tab = 'proc'; state.q = ''; qEl.value = ''; state.openProc = id;
    renderTabs();
    setMain(procedureView(PROCS[id]));
    window.scrollTo(0, 0);
  }
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
  function sectionTitle(text, count) {
    return '<h2 class="section-title"><span class="label">' + esc(text) + '</span>' + (count != null ? '<span class="count">' + count + '</span>' : '') + '</h2>';
  }
  function renderSearch() {
    var tab = TABS.filter(function (t) { return t.id === state.tab; })[0];
    var res = engine.search(state.q, { types: tab.types, product: state.showHidden ? '' : state.product });
    var html = '';
    if (res.corrections && res.corrections.length) {
      html += '<div class="fixes"><span class="label">Spelling</span>' + res.corrections.map(function (f) {
        return '<s>' + esc(f.from) + '</s> → <b>' + esc(f.to) + '</b>';
      }).join(', ') + '</div>';
    }
    if (res.glossary.length) {
      html += '<div class="gloss">' + res.glossary.map(function (g) { return '<span><b>' + esc(g.term) + '</b>' + esc(g.means) + '</span>'; }).join('') + '</div>';
    }
    if (res.hidden) {
      html += '<div class="notice">' + res.hidden + ' rule card' + (res.hidden > 1 ? 's' : '') + ' hidden by the product filter. <button class="link" data-show-hidden>Show them</button></div>';
    }
    if (!res.results.length) {
      html += '<div class="empty"><span class="label">No cards</span><p>Nothing matches “' + esc(state.q) + '”. The PDS text search is below.</p></div>';
      setMain(html + pagesHtml(state.q, true));
      return;
    }
    var groups = {}, order = [];
    res.results.forEach(function (r) {
      if (!groups[r.type]) { groups[r.type] = []; order.push(r.type); }
      groups[r.type].push(r);
    });
    order.forEach(function (type) {
      if (state.tab === 'all') html += sectionTitle(TYPE_LABEL[type], groups[type].length);
      var list = state.tab === 'all' ? groups[type].slice(0, type === 'rule' ? 6 : 3) : groups[type];
      html += '<div class="stack">' + list.map(function (r) { return RENDER[r.type](r.item); }).join('') + '</div>';
      if (state.tab === 'all' && groups[type].length > list.length) {
        html += '<button class="btn ghost more" data-tab="' + type + '">All ' + groups[type].length + ' ' + TYPE_LABEL[type].toLowerCase() + ' →</button>';
      }
    });
    setMain(html + pagesHtml(state.q, res.results.length < 2));
  }

  function groupBy(list, key) {
    var g = {}, order = [];
    list.forEach(function (x) { var k = x[key] || 'Other'; if (!g[k]) { g[k] = []; order.push(k); } g[k].push(x); });
    return order.map(function (k) { return [k, g[k]]; });
  }

  var TRY = ['ttr max', '6000', 'noi deadline', 'change my bank', 'how long withdrawal', 'perservation age'];
  function homeHtml() {
    var tiles = [['rule', DATA.rules.length, 'Rule cards', 'Each with its PDS page'], ['form', DATA.forms.length, 'Forms', 'With directions to read out'],
      ['timeframe', DATA.timeframes.length, 'Timeframes', 'With a date calculator'], ['explainer', DATA.explainers.length, 'Explainers', 'Simple, standard, detailed'],
      ['calc', '$', 'Drawdown calculator', 'Minimum and maximum payments']];
    var html = '<section class="hero"><div class="hero-text"><span class="label">Call companion · PDS issued ' + esc(issued('flexi')) + '</span>' +
      '<h1>Find the rule, the form, the date, or the words to say.</h1>' +
      '<p>Type what the member said. Underlined terms explain themselves when you hover over them.</p>' +
      '<div class="try"><span class="label">Try</span>' + TRY.map(function (t) { return '<button class="chip" data-q="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>' +
      '<div class="hero-fig fig" data-figure="terrain" aria-hidden="true"></div></section>';
    html += sectionTitle('Explainers', DATA.explainers.length) + '<p class="hint">Each comes in three levels, step by step: simple, standard and detailed. Hover over one for the standard version; click to open all three.</p>' +
      '<div class="explainer-index">' + groupBy(DATA.explainers, 'topic').map(function (g) {
        return '<div class="ex-group"><span class="label">' + esc(g[0]) + '</span><div class="chips">' + g[1].map(function (e) {
          return '<button type="button" class="term-chip" data-explainer="' + e.id + '" data-open-explainer="' + e.id + '">' + esc(e.title) + (FIGURE_FOR[e.id] ? '<span class="dot" title="Has an interactive picture"></span>' : '') + '</button>';
        }).join('') + '</div></div>';
      }).join('') + '</div>';
    html += sectionTitle('Everything in the companion') + '<section class="tiles">' + tiles.map(function (t) {
      return '<button class="tile" data-tab="' + t[0] + '"><span class="label">' + t[2] + '</span><span class="tile-figure">' + t[1] + '</span><span class="tile-note">' + t[3] + '</span></button>';
    }).join('') + '</section>';
    return html;
  }

  function renderBrowse() {
    var html = '';
    if (state.tab === 'all') {
      html = homeHtml();
    } else if (state.tab === 'proc') {
      if (state.openProc && PROCS[state.openProc]) { setMain(procedureView(PROCS[state.openProc])); return; }
      html += '<p class="hint">Step-by-step lists for specific tasks, in ' + assumeSpan('checklist-order', 'the order you\'d do them') + '. Tick steps off during the call, then copy them as a call note. Load a test member to see notes for them.</p>';
      groupBy(DATA.procedures, 'topic').forEach(function (g) {
        html += sectionTitle(g[0], g[1].length) + '<div class="grid-cards">' + g[1].map(procedureCard).join('') + '</div>';
      });
    } else if (state.tab === 'rule') {
      groupBy(DATA.rules.filter(function (r) { return !state.product || !r.products.length || r.products.indexOf(state.product) >= 0; }), 'topic').forEach(function (g) {
        html += sectionTitle(g[0], g[1].length) + '<div class="ledger">' + g[1].map(function (r) {
          return '<button class="ledger-row" data-open-rule="' + esc(r.id) + '"><span>' + esc(r.q) + '</span><span class="ledger-meta">' + esc(r.a.slice(0, 70)) + (r.a.length > 70 ? '…' : '') + '</span></button>';
        }).join('') + '</div>';
      });
    } else if (state.tab === 'form') {
      groupBy(DATA.forms, 'group').forEach(function (g) {
        html += sectionTitle(g[0], g[1].length) + '<div class="stack">' + g[1].map(formCard).join('') + '</div>';
      });
      html += '<p class="meta">Forms list taken from ' + esc(DATA.formsPage) + ' on ' + esc(DATA.formsGenerated) + '.</p>';
    } else if (state.tab === 'timeframe') {
      html += datesToolHtml();
      groupBy(DATA.timeframes, 'topic').forEach(function (g) {
        html += sectionTitle(g[0], g[1].length) + '<div class="stack">' + g[1].map(timeframeCard).join('') + '</div>';
      });
      if (!DATA.local.timeframes) html += '<p class="meta">Internal processing times (rollovers, claims, applications) aren\'t in the PDS. Add them to data/timeframes.local.json and rebuild.</p>';
    } else if (state.tab === 'explainer') {
      groupBy(DATA.explainers, 'topic').forEach(function (g) {
        html += sectionTitle(g[0], g[1].length) + '<div class="grid-cards">' + g[1].map(explainerCard).join('') + '</div>';
      });
    }
    setMain(html);
    if (state.tab === 'timeframe') bindDates();
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
        chainsHtml(e) +
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
  state.dd = { start: '', bal: '', anchor: '', chosen: '', n: '', type: store.get('dd.type') || 'Retirement Phase', freq: store.get('dd.freq') || 'Monthly' };
  state.dt = { from: '', n: '5', unit: 'business_days' };
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
    if (/^\d{3}$/.test(t.trim())) return 'No test member ' + t.trim() + '. Try 101 to 113.';
    return 'Type a member number, an age (67) or a date of birth (14/5/1959)';
  }
  function setMember(text, from) {
    state.memberText = text;
    var num = String(text).trim(), m = /^\d{3}$/.test(num) ? MEMBERS[num] : null;
    var was = state.member;
    state.member = m || null;
    if (m) { state.dob = m.dob; state.age = null; }
    else {
      var r = P.parseAgeOrDate(text);
      state.dob = r && r.dob ? P.iso(r.dob) : null;
      state.age = r && r.age != null ? r.age : null;
    }
    var bad = text.trim() && !m && state.dob == null && state.age == null;
    if (from !== 'member') $('member').value = text;
    if (from !== 'dd-member' && $('dd-member')) $('dd-member').value = text;
    setEcho('member', memberEcho(), bad);
    setEcho('dd-member', memberEcho(), bad);
    if (m !== was) {
      if (m) {
        state.product = CompanionMembers.primaryProduct(m);
        applyPrefill(m);
      } else if (was) state.product = '';
      renderProducts();
      renderMemberStrip();
    }
  }

  // Fills the drawdown calculator from a test member's pension (or planned pension).
  function applyPrefill(m) {
    var pf = CompanionMembers.prefill(m, new Date());
    if (!pf) return;
    state.dd.start = dmy(pf.start);
    state.dd.bal = Math.round(pf.balance).toLocaleString('en-AU');
    state.dd.type = pf.type;
    state.dd.freq = pf.freq;
    state.dd.anchor = pf.anchor ? dmy(pf.anchor) : '';
    state.dd.chosen = pf.chosen ? Math.round(pf.chosen).toLocaleString('en-AU') : '';
    state.dd.n = '';
    if (state.tab === 'calc' && $('dd-start')) renderCalculators();
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
      $('dd-' + k).addEventListener('input', function () { state.dd[k] = this.value; echoDrawdown(); runDrawdown(); });
    });
    setMember(state.memberText, 'render');
    echoDrawdown();
    runDrawdown();
  }

  // Date calculator: lives at the top of the Timeframes tab.
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
    if (q.start) { state.dd.start = dmy(q.start); $('dd-start').value = state.dd.start; got.push('starts ' + P.fmt(q.start)); }
    if (q.balance != null) { state.dd.bal = q.balance.toLocaleString('en-AU'); $('dd-bal').value = state.dd.bal; got.push(money(q.balance)); }
    if (q.type) { setSeg('type', q.type); got.push(q.type); }
    if (q.freq) { setSeg('freq', q.freq); got.push(q.freq.toLowerCase()); }
    setEcho('dd-quick', this.value.trim() ? (got.length ? 'Understood: ' + got.join(', ') : 'Nothing recognised yet') : '', this.value.trim() && !got.length);
    echoDrawdown();
    runDrawdown();
  }

  function setSeg(name, value) {
    if (name === 'type') { state.dd.type = value; store.set('dd.type', value); }
    if (name === 'freq') {
      state.dd.freq = value; store.set('dd.freq', value);
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
    var summary = 'Age ' + r.age + ', ' + pct(r.pct) + ' minimum. Pro-rata minimum to 30 June: ' + money(r.proMin) +
      (r.max != null ? '; TTR maximum ' + money(r.max) : '') + ' (' + r.daysLeft + ' of ' + r.daysYear + ' days, rounded to the nearest $10).' +
      (r.perMin != null ? ' ' + r.payments + ' ' + dd.freq.toLowerCase() + ' payments of at least ' + money(r.perMin) + '.' : '');
    out.innerHTML = '<div class="headline">' + esc(range) + '<span>allowed this financial year</span></div>' +
      row(state.dob ? 'Age at start' : '{{age-only:Age at start}}', r.age) + row('Minimum percentage', pct(r.pct) + ' (' + esc(r.band) + ')') +
      (r.preservationAge != null ? row('Preservation age', r.preservationAge) : '') +
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

  function runDates() {
    var out = $('dt-out');
    var d0 = P.parseDate(state.dt.from, 'any'), n = parseInt(state.dt.n, 10), unit = state.dt.unit;
    if (!d0 || !(n >= 0)) { out.innerHTML = '<p class="meta">Enter a start date and an amount.</p>'; return; }
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
      row('Days from this date to 30 June ' + fyEnd.getFullYear() + ', both counted', CompanionDates.daysBetweenInclusive(d0, fyEnd)) +
      '<div class="actions"><button class="btn" data-copy="' + esc(text) + '">Copy</button></div>';
  }

  function render() {
    renderTabs();
    if (state.tab === 'calc') return renderCalculators();
    if (state.q.trim()) return renderSearch();
    renderBrowse();
  }

  function renderTabs() {
    $('tabs').innerHTML = TABS.map(function (t) {
      return '<button class="tab" role="tab" data-tab="' + t.id + '" aria-selected="' + (state.tab === t.id) + '">' + t.label + '</button>';
    }).join('');
  }

  function renderProducts() {
    $('products').innerHTML = PRODUCTS.map(function (p) {
      return '<button class="chip" role="radio" data-product="' + p.id + '" aria-checked="' + (state.product === p.id) + '">' + esc(p.label) + '</button>';
    }).join('');
  }

  // ----- events -----
  var timer = null;
  qEl.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = qEl.value; state.showHidden = false;
      if (state.tab === 'calc') state.tab = 'all';
      render();
    }, 60);
  });
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
  $('clear-context').addEventListener('click', function () { setMember('', 'clear'); state.product = ''; store.set('product', ''); renderProducts(); render(); });

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
    if (t.hasAttribute('data-open-explainer')) {
      var xid = t.getAttribute('data-open-explainer');
      state.tab = 'explainer'; state.q = ''; qEl.value = '';
      renderTabs();
      setMain('<button class="btn ghost back" data-tab="explainer">← All explainers</button><div class="stack">' + explainerCard(EXPLAINERS[xid]) + '</div>');
      window.scrollTo(0, 0);
      return;
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
    if (t.hasAttribute('data-product')) { state.product = t.getAttribute('data-product'); store.set('product', state.product); renderProducts(); render(); return; }
    if (t.hasAttribute('data-tab')) { state.openProc = null; state.tab = t.getAttribute('data-tab'); store.set('tab', state.tab); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-copy')) { copy(t.getAttribute('data-copy')); return; }
    if (t.hasAttribute('data-copy-script')) {
      var card = t.closest('.card, .pop'), shown = card.querySelector('.script:not([hidden])');
      copy(shown.tagName === 'OL' ? chainText(shown) : shown.textContent); return;
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
    if (t.hasAttribute('data-reset-proc')) { var rp = t.closest('[data-proc]').getAttribute('data-proc'); state.ticks[rp] = {}; openProcedure(rp); return; }
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
    if (t.hasAttribute('data-open-rule')) {
      var id = t.getAttribute('data-open-rule');
      state.tab = 'rule'; state.q = '';
      renderTabs();
      setMain('<button class="btn ghost back" data-tab="rule">← All rules</button><div class="stack">' + ruleCard(RULES[id]) + '</div>');
      window.scrollTo(0, 0);
      return;
    }
    if (t.hasAttribute('data-seg')) {
      setSeg(t.getAttribute('data-seg'), t.getAttribute('data-val'));
      if (t.getAttribute('data-seg') === 'unit') runDates(); else runDrawdown();
      return;
    }
    if (t.hasAttribute('data-start')) {
      var now = CompanionParse.today(), which = t.getAttribute('data-start'), d = now;
      if (which === 'next-month') d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      if (which === 'july') d = new Date(now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(), 6, 1);
      state.dd.start = dmy(d); $('dd-start').value = state.dd.start; echoDrawdown(); runDrawdown(); return;
    }
    if (t.hasAttribute('data-from')) { state.dt.from = dmy(CompanionParse.today()); $('dt-from').value = state.dt.from; echoDate('dt-from', state.dt.from); runDates(); return; }
    if (t.hasAttribute('data-clear-calc')) {
      state.dd.start = ''; state.dd.bal = ''; state.dd.anchor = ''; state.dd.chosen = ''; state.dd.n = '';
      setMember('', 'clear'); renderCalculators(); $('dd-quick').focus(); return;
    }
    if (t.hasAttribute('data-show-hidden')) { state.showHidden = true; render(); return; }
    if (t.hasAttribute('data-calc-preset')) { state.calcPreset = t.getAttribute('data-calc-preset'); state.tab = 'timeframe'; state.q = ''; qEl.value = ''; render(); window.scrollTo(0, 0); var dtFrom = $('dt-from'); if (dtFrom) dtFrom.focus(); return; }
    if (t.hasAttribute('data-goto-calc')) { state.tab = 'calc'; render(); window.scrollTo(0, 0); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== qEl && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); qEl.focus(); qEl.select();
    } else if (e.key === 'Escape' && pop && !pop.hidden) {
      var back = popTarget; hidePop(true); if (back) back.focus();
    } else if (e.key === 'Escape' && document.activeElement === qEl) {
      qEl.value = ''; state.q = ''; render();
    } else if (e.altKey && /^[1-7]$/.test(e.key)) {
      state.tab = TABS[+e.key - 1].id; store.set('tab', state.tab); render();
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
    DATA.sources.filter(function (s) { return s.kind !== 'ato'; }).map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>'; }).join(', ') +
    '. ATO pages are linked as supplementary sources only. Words with a red dotted underline are <button class="link" data-show-assumptions>assumptions (' + DATA.assumptions.length + ')</button>. Built ' + esc(DATA.built) + '. Not personal advice. Nothing typed here is saved or sent anywhere.';

  if (!TABS.some(function (t) { return t.id === state.tab; })) state.tab = 'all';
  renderProducts();
  render();
  qEl.focus();
})();
