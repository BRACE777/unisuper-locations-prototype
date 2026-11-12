// Forgiving input parsing so consultants can type values the way they read them off a screen.
// Plain script; exposes `CompanionParse`.
//   parseDate('14/5/59') parseDate('14 May 1959') parseDate('140559') parseDate('today')
//   parseMoney('$500,000.00') parseMoney('500k') parseMoney('1.2m')
//   parseAgeOrDate('67') parseAgeOrDate('14/05/1959')
//   parseQuick('14/5/1959 500k 1 Oct TTR fortnightly')
var CompanionParse = (function () {
  'use strict';

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function valid(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
    var dt = new Date(y, m - 1, d);
    return dt.getMonth() === m - 1 ? dt : null;
  }
  // Two-digit years: a date of birth is in the past; anything else is within the next 20 years.
  function fullYear(yy, kind) {
    if (yy >= 100) return yy;
    var cy = today().getFullYear() % 100;
    if (kind === 'past') return yy > cy ? 1900 + yy : 2000 + yy;
    return yy > cy + 20 ? 1900 + yy : 2000 + yy;
  }
  function monthIndex(word) {
    var i = MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
    return i < 0 ? null : i + 1;
  }

  // kind: 'past' (date of birth) or 'any'. Day-month order is Australian (d/m/y).
  function parseDate(text, kind) {
    var s = String(text || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ');
    if (!s) return null;
    var t = today(), m;
    if (s === 'today' || s === 'now') return t;
    if (s === 'tomorrow') return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    if (s === 'yesterday') return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return valid(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2}|\d{4})$/))) return valid(fullYear(+m[3], kind), +m[2], +m[1]);
    if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) return valid(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{2})(\d{2})(\d{2})$/))) return valid(fullYear(+m[3], kind), +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})\s*([a-z]{3,9})\.?\s*(\d{2}|\d{4})?$/))) {
      var mo = monthIndex(m[2]);
      if (!mo) return null;
      if (m[3]) return valid(fullYear(+m[3], kind), mo, +m[1]);
      return valid(t.getFullYear(), mo, +m[1]);
    }
    if ((m = s.match(/^([a-z]{3,9})\.?\s*(\d{1,2})\s+(\d{4})$/))) {
      var mo2 = monthIndex(m[1]);
      return mo2 ? valid(+m[3], mo2, +m[2]) : null;
    }
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})$/))) return valid(t.getFullYear(), +m[2], +m[1]);
    return null;
  }

  function parseMoney(text) {
    var s = String(text || '').trim().toLowerCase().replace(/aud|\$|\s/g, '').replace(/,/g, '');
    if (!s) return null;
    var m = s.match(/^(\d+(?:\.\d+)?)(k|m|mil|million|thousand)?$/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (m[2] === 'k' || m[2] === 'thousand') n *= 1000;
    if (m[2] === 'm' || m[2] === 'mil' || m[2] === 'million') n *= 1e6;
    return Math.round(n * 100) / 100;
  }

  // The member box takes an age ("67") or a date of birth in any format above.
  function parseAgeOrDate(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    if (/^\d{1,3}$/.test(s) && +s >= 10 && +s <= 120) return { age: +s };
    var d = parseDate(s, 'past');
    if (d && d < today()) return { dob: d };
    return null;
  }

  var TYPES = [[/\bttr\b|transition/, 'TTR'], [/\bbis\b|beneficiary/, 'Beneficiary (BIS)'], [/\brp\b|retirement/, 'Retirement Phase']];
  var FREQS = [[/fortnight|\bfn\b|\bfort\b/, 'Fortnightly'], [/month|\bmthly\b|\bpm\b/, 'Monthly'], [/quarter|\bqtr/, 'Quarterly'],
    [/half|6 ?month|bi-?annual|semi/, 'Half-yearly'], [/annual|yearly|\bpa\b|once a year/, 'Annual']];

  // Pull a date of birth, start date, balance, age, pension type and frequency out of one line.
  // Dates at least 15 years ago are taken as the date of birth; others as the start date.
  function parseQuick(text) {
    var s = ' ' + String(text || '').toLowerCase().replace(/,(?=\d{3}\b)/g, '') + ' ';
    var out = {}, used = [];
    TYPES.forEach(function (t) { if (!out.type && t[0].test(s)) out.type = t[1]; });
    FREQS.forEach(function (f) { if (!out.freq && f[0].test(s)) out.freq = f[1]; });
    var dateRe = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{2,4})?|\b\d{8}\b|today)/g;
    var m, cutoff = today();
    cutoff = new Date(cutoff.getFullYear() - 15, cutoff.getMonth(), cutoff.getDate());
    while ((m = dateRe.exec(s))) {
      var raw = m[1];
      var d = parseDate(raw, 'any');
      var dPast = parseDate(raw, 'past');
      if (dPast && dPast < cutoff && !out.dob) { out.dob = dPast; used.push(raw); continue; }
      if (d && !out.start) { out.start = d; used.push(raw); }
    }
    var rest = s;
    used.forEach(function (u) { rest = rest.replace(u, ' '); });
    var money = rest.match(/\$\s?\d[\d.]*\s?(?:k|m|mil|million)?\b|\b\d[\d.]*\s?(?:k|m|mil|million)\b|\b\d{5,}(?:\.\d+)?\b/);
    if (money) { out.balance = parseMoney(money[0]); rest = rest.replace(money[0], ' '); }
    var age = rest.match(/\b(?:age|aged)\s*(\d{2,3})\b|\b(\d{2})\s*(?:yo|y\/o|years? old)\b/);
    if (age) out.age = +(age[1] || age[2]);
    else if (!out.dob) { var lone = rest.match(/\b(\d{2})\b/); if (lone && +lone[1] >= 15 && +lone[1] <= 110) out.age = +lone[1]; }
    return out;
  }

  function fmt(d) { return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  return { parseDate: parseDate, parseMoney: parseMoney, parseAgeOrDate: parseAgeOrDate, parseQuick: parseQuick, fmt: fmt, iso: iso, today: today };
})();
