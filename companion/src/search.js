// Search for the call companion. Plain script (no modules) so it can be inlined into one
// HTML file and also loaded by the tests through node:vm. Exposes `CompanionSearch`.
var CompanionSearch = (function () {
  'use strict';

  var STOP = new Set(('a an and are as at be by can could do does for from get got have how i if in into is it ' +
    'me my of on or our should so that the their them there they this to was we what when where which who ' +
    'why will with would you your much many any about need want tell know please ' +
    // contractions (apostrophes are dropped before this check) and call filler
    'im ive id ill cant dont wont didnt doesnt isnt wasnt havent whats its thats theres hes shes theyre youre ' +
    'just like actually really basically hi hello um uh ok okay thanks member members wants wanted wanting trying currently gonna wanna ' +
    'am been has had also still some very bit').split(' '));

  // Everyday words a member might say that the cards don't use. They are never "corrected"
  // into a card word (without this, cancer became cancel and sick became tick).
  var EVERYDAY = new Set(('cancer sick ill illness dying died dead passed passing funeral surgery operation hospital doctor medical dental ' +
    'ivf injury injured accident disability disabled mum mom dad mother father parent parents son daughter brother sister grandchild ' +
    'grandson granddaughter nephew niece kid kids child baby boyfriend girlfriend fiance widow widower ex expensive cheap price ' +
    'mortgage rent bills debt broke struggling bank house home car holiday boss job work working worked fired redundant redundancy ' +
    'casual contractor uni university student teen teenager young old older pay paid payday cash money ' +
    'anymore anyway anything anyone everything nothing someone something half whole help sorry yes yeah nope').split(' '));

  // Misspellings heard on calls that are too far from the word for the edit-distance check.
  var MISSPELT = { penshun: 'pension', penshon: 'pension', pention: 'pension', pensoin: 'pension', superanuation: 'superannuation',
    superanuaton: 'superannuation', superannuaton: 'superannuation', perservation: 'preservation', preservaton: 'preservation',
    seperation: 'separation', seperated: 'separated', devorce: 'divorce', divorse: 'divorce', rolover: 'rollover', rollovr: 'rollover',
    consoldate: 'consolidate', consolodate: 'consolidate', withdrawl: 'withdrawal', withdrawel: 'withdrawal', benificiary: 'beneficiary',
    beneficary: 'beneficiary', benefishary: 'beneficiary', contibution: 'contribution', contribtion: 'contribution', contribtions: 'contributions',
    insurence: 'insurance', insurace: 'insurance', retirment: 'retirement', nomanation: 'nomination',
    hardshp: 'hardship', compasionate: 'compassionate', compassonate: 'compassionate', terminaly: 'terminally', tranfer: 'transfer' };

  var WORD_NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var SCALE = { hundred: 100, thousand: 1000, k: 1000, million: 1e6, m: 1e6, mil: 1e6 };

  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’‚`]/g, "'").replace(/[“”]/g, '"')
      .replace(/[‐-―−]/g, '-');
  }

  // "$6,000" "6k" "$2.1 million" "two point one million" "six thousand" -> "6000", "2100000"
  function normaliseNumbers(s) {
    s = fold(s);
    s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|sixteen|eighteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](one|two|three|four|five|six|seven|eight|nine))?(?: point (one|two|three|four|five|six|seven|eight|nine))?\b/g,
      function (m, a, b, c) {
        var n = WORD_NUM[a] + (b ? WORD_NUM[b] : 0);
        return c ? n + '.' + WORD_NUM[c] : String(n);
      });
    s = s.replace(/(?:\$\s?)?\b(\d[\d,]*(?:\.\d+)?)\s?(hundred|thousand|million|mil|k|m)\b/g, function (m, n, unit) {
      return String(Math.round(parseFloat(n.replace(/,/g, '')) * SCALE[unit]));
    });
    s = s.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, function (m, n) { return n.replace(/,/g, ''); });
    s = s.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, function (m) { return m.replace(/,/g, ''); });
    return s;
  }

  // Light stemming so "aged"/"age", "retired"/"retire", "splitting"/"split", "fees"/"fee"
  // and "ceases"/"cease" all meet at the same root. Numbers and short acronyms are left alone.
  function stem(t) {
    if (/\d/.test(t) || t.length < 3) return t;
    if (t.length > 4 && /ies$/.test(t)) t = t.slice(0, -3) + 'y';
    else if (t.length > 5 && /ing$/.test(t)) t = t.slice(0, -3);
    else if (t.length > 3 && /ed$/.test(t)) t = t.slice(0, -2);
    else if (t.length > 3 && /es$/.test(t) && !/(ss|us|is)es$/.test(t)) t = t.slice(0, -1);
    else if (t.length > 3 && /s$/.test(t) && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
    if (/([bdgklmnprt])\1$/.test(t) && t.length > 4) t = t.slice(0, -1); // splitt -> split, stopp -> stop
    if (t.length >= 3 && /e$/.test(t)) t = t.slice(0, -1);                 // retire/retired -> retir, age/aged -> ag
    return t;
  }

  function tokens(s, keepStop) {
    var out = [];
    var parts = normaliseNumbers(String(s || '').replace(/\{\{[a-z0-9-]+:/g, '').replace(/\}\}/g, '')).split(/[^a-z0-9%.']+/);
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/^[.']+|[.']+$/g, '').replace(/'s$/, '').replace(/'/g, '');
      if (!t) continue;
      if (!keepStop && STOP.has(t)) continue;
      out.push(stem(t));
    }
    return out;
  }

  // Build lookups for glossary terms (single and multi-word) and member phrases.
  function buildGlossary(glossary) {
    var terms = [];
    function seq(text) { return tokens(fold(text).replace(/[-/]/g, ' '), true); }
    (glossary.terms || []).forEach(function (g) {
      terms.push({ key: fold(g.term).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(), seq: seq(g.term), expands: tokens(g.expands_to), means: g.means, term: g.term });
    });
    (glossary.phrases || []).forEach(function (p) {
      terms.push({ key: fold(p.phrase), seq: seq(p.phrase), expands: tokens(p.expands_to), phrase: true });
    });
    terms.forEach(function (t) { t.content = t.seq.filter(function (w) { return !STOP.has(w); }); });
    terms = terms.filter(function (t) { return t.seq.length; });
    terms.sort(function (a, b) { return b.seq.length - a.seq.length || b.key.length - a.key.length; });
    return terms;
  }

  function seqAt(words, sq) {
    if (!sq.length) return false;
    for (var i = 0; i + sq.length <= words.length; i++) {
      var ok = true;
      for (var j = 0; j < sq.length && ok; j++) ok = words[i + j] === sq[j];
      if (ok) return true;
    }
    return false;
  }

  // Glossary entries match whole words after stemming, so "wifes" meets "wife", and a phrase also
  // matches with the small words left out ("change my address" meets "change address"). `links`
  // records which query words each entry explains, so a card that matches the expansion still
  // counts those words as covered.
  function expandQuery(q, gloss) {
    var src = fold(q).replace(/[-/]/g, ' ');
    var words = tokens(src, true), base = tokens(src);
    var extra = [], hits = [], links = {};
    gloss.forEach(function (g) {
      if (!seqAt(words, g.seq) && !(g.content.length > 1 && seqAt(base, g.content))) return;
      hits.push(g);
      g.expands.forEach(function (t) { if (base.indexOf(t) < 0 && extra.indexOf(t) < 0) extra.push(t); });
      g.seq.forEach(function (t) { if (base.indexOf(t) >= 0) links[t] = (links[t] || []).concat(g.expands); });
    });
    return { base: base, extra: extra, links: links, glossary: hits.filter(function (h) { return !h.phrase; }) };
  }

  // What kind of answer the question is after, judged from its wording. Matching items get a boost,
  // and the words that only say what kind of answer is wanted don't have to match.
  var INTENTS = [
    { type: 'timeframe', boost: 1.7, drop: ['long', 'tak', 'quick', 'quickly', 'soon', 'wait', 'arriv', 'receiv', 'process'],
      re: /\b(how long|how quick(ly)?|how soon|how many (business )?days|processing time|turn ?around|waiting time)\b|\bwhen (will|do|does|would|should|can) .*\b(get|receive|be paid|arrive|come through|hear back|go through|be processed|land)\b/ },
    { type: 'form', boost: 1.6, drop: ['form', 'paperwork', 'fill'],
      re: /\b(forms?|paperwork|fill (it )?(in|out)|what (do|does) (i|they|he|she) (need to )?(fill|sign|send|complete))\b/ },
    { type: 'explainer', boost: 1.5, drop: ['explain', 'differenc', 'mean', 'work'],
      re: /\b(explain|difference between|what('?s| is) the difference|how does .+ work|what does .+ mean)\b/ },
    { type: 'procedure', boost: 1.3, drop: ['step', 'process'],
      re: /\b(steps|walk me through|checklist|process for)\b/ }
  ];
  function intentOf(q) {
    var f = fold(q);
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].re.test(f)) return INTENTS[i];
    return null;
  }

  // Each indexed item: { type, id, fields: [{ text, weight }], aliases: [], products: [], item }
  function indexItem(entry) {
    var tf = {};
    entry.fields.forEach(function (f) {
      tokens(f.text, false).forEach(function (t) {
        tf[t] = Math.max(tf[t] || 0, f.weight);
      });
    });
    var aliasTokens = (entry.aliases || []).map(function (a) { return tokens(a).join(' '); }).filter(Boolean);
    // Aliases that were one word to begin with ("pension"), as opposed to ones that shrank to one word.
    var aliasOneWord = {};
    (entry.aliases || []).forEach(function (a) { if (!/\s/.test(String(a).trim())) aliasOneWord[tokens(a).join(' ')] = true; });
    // Word pairs from the title and aliases: two query words side by side there earn a small bonus,
    // so "life cover" prefers cover cards over "life events".
    var pairs = {};
    entry.fields.filter(function (f) { return f.weight >= 3; }).forEach(function (f) {
      String(f.text).split(/[.,;:?!()]/).forEach(function (part) {
        var w = tokens(part);
        for (var i = 1; i < w.length; i++) pairs[w[i - 1] + ' ' + w[i]] = true;
      });
    });
    (entry.aliases || []).forEach(function (a) {
      var w = tokens(a);
      for (var i = 1; i < w.length; i++) pairs[w[i - 1] + ' ' + w[i]] = true;
    });
    return { type: entry.type, id: entry.id, tf: tf, keys: Object.keys(tf), aliasTokens: aliasTokens, aliasOneWord: aliasOneWord, exactOnly: {}, pairs: pairs, products: entry.products || [], item: entry.item };
  }

  function scoreDoc(doc, base, extra, links, idf, countable) {
    var score = 0, matchedBase = 0, counted = 0;
    function termScore(t) {
      var w = idf(t);
      if (doc.tf[t]) return doc.tf[t] * w;
      if (t.length >= 4) {
        var best = 0;
        for (var i = 0; i < doc.keys.length; i++) {
          var k = doc.keys[i];
          if (k.length > t.length && k.indexOf(t) === 0) best = Math.max(best, doc.tf[k] * 0.6);
        }
        return best * w;
      }
      return 0;
    }
    for (var i = 0; i < base.length; i++) {
      var s = termScore(base[i]);
      if (s > 0) score += s;
      if (!countable(base[i])) continue;
      counted++;
      if (s > 0 || (links[base[i]] || []).some(function (t) { return termScore(t) > 0; })) matchedBase++;
    }
    for (var j = 0; j < extra.length; j++) score += termScore(extra[j]) * 0.45;
    for (var b = 1; b < base.length; b++) if (doc.pairs[base[b - 1] + ' ' + base[b]]) score += 1.5;
    var joined = base.join(' ');
    if (joined) {
      for (var a = 0; a < doc.aliasTokens.length; a++) {
        var al = doc.aliasTokens[a];
        if (al === joined) score += 8;
        else if (doc.exactOnly[al]) continue;
        else if ((' ' + joined + ' ').indexOf(' ' + al + ' ') >= 0) score += 4;
        else if (al.indexOf(joined) === 0 && joined.length >= 3) score += 3;
      }
    }
    var coverage = counted ? matchedBase / counted : (score > 0 ? 1 : 0);
    return { score: score * (0.4 + 0.6 * coverage), coverage: coverage };
  }

  function create(data) {
    var gloss = buildGlossary(data.glossary || {});
    var docs = [];

    (data.procedures || []).forEach(function (p) {
      docs.push(indexItem({ type: 'procedure', id: p.id, aliases: (p.aliases || []).concat([p.title]), item: p, fields: [
        { text: p.title + ' steps checklist how to', weight: 3 }, { text: (p.aliases || []).join(' '), weight: 3 }, { text: p.topic, weight: 1 },
        { text: p.when, weight: 1.5 }, { text: p.steps.map(function (s) { return s.do; }).join(' '), weight: 0.5 }] }));
    });
    (data.rules || []).forEach(function (c) {
      docs.push(indexItem({ type: 'rule', id: c.id, products: c.products, aliases: c.aliases, item: c, fields: [
        { text: c.q, weight: 3 }, { text: (c.aliases || []).join(' '), weight: 3 },
        { text: c.topic, weight: 1 }, { text: c.a, weight: 1.5 }, { text: c.detail || '', weight: 1 }] }));
    });
    (data.forms || []).forEach(function (f) {
      docs.push(indexItem({ type: 'form', id: f.id, aliases: [f.title], item: f, fields: [
        { text: f.title, weight: 3 }, { text: f.keywords || '', weight: 2.5 }, { text: (f.topics || []).join(' ') + ' form', weight: 1.2 },
        { text: f.summary || '', weight: 1 }, { text: (f.requirements || []).join(' '), weight: 0.6 }] }));
    });
    (data.timeframes || []).forEach(function (t) {
      docs.push(indexItem({ type: 'timeframe', id: t.id, aliases: [t.task], item: t, fields: [
        { text: t.task, weight: 3 }, { text: t.timeframe + ' how long days', weight: 1.5 }, { text: t.topic, weight: 1 },
        { text: t.say, weight: 0.8 }, { text: t.starts || '', weight: 0.5 }] }));
    });
    // Explainer levels mix plain steps with option, table, example and note blocks: index all the words.
    var flat = function (x) {
      if (typeof x === 'string') return x;
      if (Array.isArray(x)) return x.map(flat).join(' ');
      if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return flat(x[k]); }).join(' ');
      return '';
    };
    (data.explainers || []).forEach(function (e) {
      docs.push(indexItem({ type: 'explainer', id: e.id, aliases: [e.title], item: e, fields: [
        { text: e.title + ' explain', weight: 3 }, { text: e.topic, weight: 1 }, { text: flat(e.standard), weight: 1.2 }, { text: flat(e.simple), weight: 0.8 }, { text: flat(e.detailed), weight: 0.6 }] }));
    });

    // How rare each word is across the cards: "super" and "pension" are everywhere, "hardship" isn't,
    // so rarer words count for more.
    var df = {};
    docs.forEach(function (d) { d.keys.forEach(function (k) { df[k] = (df[k] || 0) + 1; }); });
    var N = docs.length, idfNorm = Math.log(1 + N / 8);
    function idf(t) { var n = df[t] || 1; return 0.55 + 0.45 * Math.min(1.6, Math.log(1 + N / n) / idfNorm); }
    // An alias that shrinks to one common word ("when can I get my super" -> "super") would win every
    // query that mentions it, so those are dropped. A one-word alias that is a common word ("pension")
    // only counts when the whole query is that word.
    docs.forEach(function (d) {
      d.aliasTokens = d.aliasTokens.filter(function (a) {
        if (a.indexOf(' ') >= 0 || (df[a] || 0) <= N * 0.05) return true;
        if (d.aliasOneWord[a]) { d.exactOnly[a] = true; return true; }
        return false;
      });
    });

    var pages = (data.pages || []).map(function (p) {
      return { doc: p.doc, page: p.page, orig: p.text.replace(/\s+/g, ' '), norm: normaliseNumbers(p.text).replace(/\s+/g, ' ') };
    });

    // ----- typo tolerance -----
    // Vocabulary: every word in the cards and glossary, with how many items use it.
    var vocab = {};
    docs.forEach(function (d) { d.keys.forEach(function (k) { vocab[k] = (vocab[k] || 0) + 1; }); });
    gloss.forEach(function (g) { g.key.split(' ').forEach(function (w) { if (w) vocab[stem(w)] = (vocab[stem(w)] || 0) + 3; }); });
    var vocabList = Object.keys(vocab).filter(function (w) { return /^[a-z][a-z'-]*$/.test(w); });
    // The real word each stem came from, so a correction shows "expensive", not "expens".
    var surfaceCount = {}, surface = {};
    function noteWords(text) {
      (fold(text).match(/[a-z][a-z]+/g) || []).forEach(function (w) {
        var st = stem(w), c = surfaceCount[st] = surfaceCount[st] || {};
        c[w] = (c[w] || 0) + 1;
      });
    }
    (data.rules || []).forEach(function (r) { noteWords(r.q + ' ' + r.a + ' ' + (r.aliases || []).join(' ')); });
    (data.forms || []).forEach(function (f) { noteWords(f.title + ' ' + (f.keywords || '')); });
    (data.timeframes || []).forEach(function (t) { noteWords(t.task); });
    (data.procedures || []).forEach(function (p) { noteWords(p.title); });
    (data.explainers || []).forEach(function (e) { noteWords(e.title); });
    gloss.forEach(function (g) { noteWords(g.key); });
    Object.keys(surfaceCount).forEach(function (st) {
      var c = surfaceCount[st];
      surface[st] = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.length - b.length; })[0];
    });

    // Damerau-Levenshtein distance (adjacent swaps count as one edit), stopping early past `max`.
    function distance(a, b, max) {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      var prev2 = null, prev = [], cur, i, j;
      for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        cur = [i];
        var rowMin = i;
        for (j = 1; j <= b.length; j++) {
          var cost = a[i - 1] === b[j - 1] ? 0 : 1;
          var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
          cur[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2 = prev; prev = cur;
      }
      return prev[b.length];
    }

    // Closest known word for a misspelt one: 1 edit for short words, 2 for 8+ letters.
    // Three-letter words (acronyms such as "nio") are only corrected by swapping two letters.
    var correctionCache = {};
    function correctWord(w) {
      if (w in correctionCache) return correctionCache[w];
      if (MISSPELT[w]) return (correctionCache[w] = MISSPELT[w]);
      var st = stem(w), best = null, bestD = 99, bestF = 0, twos = 0;
      if (vocab[st] || vocab[w] || STOP.has(w) || EVERYDAY.has(w) || EVERYDAY.has(st) || /\d/.test(w) || w.length < 3) return (correctionCache[w] = null);
      // 1 edit for short words, 2 for 8+ letters. 6 and 7 letters may take 2 edits, but only when one
      // word (with the same first letter) is that close.
      var max = w.length >= 6 ? 2 : 1;
      for (var i = 0; i < vocabList.length; i++) {
        var v = vocabList[i];
        if (w.length === 3 && v.length !== 3) continue;
        var d = Math.min(distance(st, v, max), distance(w, v, max));
        if (w.length === 3 && d === 1 && st.split('').sort().join('') !== v.split('').sort().join('')) continue;
        if (d === 2 && v[0] === w[0]) twos++;
        if (d <= max && (d < bestD || (d === bestD && vocab[v] > bestF))) { best = v; bestD = d; bestF = vocab[v]; }
      }
      if (best && bestD === 2 && w.length < 8 && (twos !== 1 || best[0] !== w[0])) best = null;
      return (correctionCache[w] = best ? (surface[best] || best) : null);
    }

    // Returns the query with misspelt words replaced, and the list of corrections made.
    function correctQuery(q) {
      var fixes = [];
      var out = String(q || '').replace(/[A-Za-z][A-Za-z'-]*/g, function (word) {
        var lw = fold(word).replace(/'s$/, '');
        if (lw.indexOf("'") >= 0) return word; // contractions such as don't, hasn't
        var fix = correctWord(lw);
        if (!fix) return word;
        fixes.push({ from: word, to: fix });
        return fix;
      });
      return { text: out, fixes: fixes };
    }

    function search(q, opts) {
      opts = opts || {};
      var corrected = correctQuery(q);
      var ex = expandQuery(corrected.text, gloss);
      ex.corrections = corrected.fixes;
      if (!ex.base.length && !ex.extra.length) return { results: [], hidden: 0, glossary: ex.glossary, query: ex, corrections: corrected.fixes };
      var results = [], hidden = 0, intent = intentOf(corrected.text);
      var countable = function (t) { return !intent || intent.drop.indexOf(t) < 0; };
      var counted = ex.base.filter(countable).length;
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        if (opts.types && opts.types.indexOf(d.type) < 0) continue;
        var s = scoreDoc(d, ex.base, ex.extra, ex.links, idf, countable);
        if (intent && d.type === intent.type) s.score *= intent.boost;
        if (s.score < 1.2 || (counted > 1 && s.coverage < 0.34)) continue;
        if (opts.product && d.type === 'rule' && d.products.length && d.products.indexOf(opts.product) < 0) { hidden++; continue; }
        results.push({ type: d.type, id: d.id, score: s.score, item: d.item });
      }
      // Ties go to the shorter, more specific title.
      var titleLen = function (r) { var x = r.item; return String(x.q || x.task || x.title || '').length; };
      results.sort(function (a, b) { return b.score - a.score || titleLen(a) - titleLen(b); });
      if (results.length) {
        var top = results[0].score;
        results = results.filter(function (r) { return r.score >= top * 0.25; });
      }
      return { results: results.slice(0, opts.limit || 40), hidden: hidden, glossary: ex.glossary, query: ex, corrections: corrected.fixes, intent: intent ? intent.type : null };
    }

    // Full-text fallback over the PDS pages: best passages for the query terms.
    function searchPages(q, limit) {
      var ex = expandQuery(correctQuery(q).text, gloss);
      var terms = ex.base.concat(ex.extra.slice(0, 6)).filter(function (t) { return t.length > 1; });
      if (!terms.length) return [];
      var hits = [];
      pages.forEach(function (p) {
        var score = 0;
        terms.forEach(function (t, idx) {
          var m = p.norm.match(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
          if (m) score += (idx < ex.base.length ? 2 : 0.7) + Math.min(m.length, 5) * 0.2;
        });
        if (score > 0) hits.push({ doc: p.doc, page: p.page, score: score, orig: p.orig });
      });
      hits.sort(function (a, b) { return b.score - a.score; });
      return hits.slice(0, limit || 5).map(function (h) {
        // Show the passage in its original wording, around the first query word found.
        var at = -1;
        for (var i = 0; i < ex.base.length && at < 0; i++) {
          at = h.orig.search(new RegExp('\\b' + ex.base[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        }
        var start = Math.max(0, (at < 0 ? 0 : at) - 140);
        var snippet = h.orig.slice(start, start + 420).trim();
        return { doc: h.doc, page: h.page, snippet: (start > 0 ? '... ' : '') + snippet + ' ...', terms: ex.base };
      });
    }

    return { search: search, searchPages: searchPages, correctQuery: correctQuery, expand: function (q) { return expandQuery(q, gloss); }, tokens: tokens, normaliseNumbers: normaliseNumbers, size: docs.length };
  }

  return { create: create, tokens: tokens, normaliseNumbers: normaliseNumbers, fold: fold };
})();
