// Quick drawdown calculator: the same arithmetic as the Excel workbook, so a consultant can
// answer without opening Excel. Plain script; exposes `CompanionDrawdown`. Needs CompanionDates.
var CompanionDrawdown = (function () {
  'use strict';
  var D = typeof CompanionDates !== 'undefined' ? CompanionDates : null;

  function ageOn(dob, on) {
    var a = on.getFullYear() - dob.getFullYear();
    if (on.getMonth() < dob.getMonth() || (on.getMonth() === dob.getMonth() && on.getDate() < dob.getDate())) a--;
    return a;
  }
  function band(bands, age) {
    var b = bands[0];
    for (var i = 0; i < bands.length; i++) if (age >= bands[i].from_age) b = bands[i];
    return b;
  }
  function round10(x) { return Math.round(x / 10) * 10; }
  function preservationAge(rows, dob) {
    var iso = D.ymd(dob);
    for (var i = 0; i < rows.length; i++) if (iso < rows[i].born_before) return rows[i].age;
    return rows[rows.length - 1].age;
  }

  // Payments left in the financial year from `start`, by frequency (matches the workbook).
  function paymentsLeft(freq, start, fyEnd, anchor) {
    var pos = ((start.getMonth() + 1 - 7 + 12) % 12) + 1; // Jul = 1 ... Jun = 12
    if (freq === 'Monthly') return 13 - pos;
    if (freq === 'Quarterly') return 4 - Math.floor((pos - 1) / 3);
    if (freq === 'Half-yearly') return 2 - Math.floor((pos - 1) / 6);
    if (freq === 'Annual') return 1;
    if (freq === 'Fortnightly') {
      // Without a known payment date, assume one payment every 14 days.
      if (!anchor) return Math.round(D.daysBetweenInclusive(start, fyEnd) / 14);
      var diff = Math.round((Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 864e5);
      var first = D.addDays(anchor, -14 * Math.floor(diff / 14));
      if (first > fyEnd) return 0;
      var span = Math.round((Date.UTC(fyEnd.getFullYear(), fyEnd.getMonth(), fyEnd.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 864e5);
      return Math.floor(span / 14) + 1;
    }
    return null;
  }

  function calculate(input, rates) {
    var bands = rates.tables.minimum_drawdown.rows;
    var r = {};
    rates.rates.forEach(function (x) { r[x.id] = x.value; });
    var dob = input.dob, start = input.start, bal = input.balance;
    var out = { warnings: [] };
    // A date of birth gives exact ages; an age on its own is taken as the age at the start date.
    out.age = dob ? ageOn(dob, start) : input.age;
    out.preservationAge = dob ? preservationAge(rates.tables.preservation_age.rows, dob) : null;
    var b = band(bands, out.age);
    out.band = b.label;
    out.pct = b.pct;
    var fyEnd = D.financialYearEnd(start);
    var fyStart = new Date(fyEnd.getFullYear() - 1, 6, 1);
    out.fyStart = fyStart; out.fyEnd = fyEnd;
    out.daysYear = D.daysBetweenInclusive(fyStart, fyEnd);
    out.daysLeft = D.daysBetweenInclusive(start, fyEnd);
    out.fullMin = round10(bal * b.pct);
    out.unrounded = bal * b.pct * out.daysLeft / out.daysYear;
    out.proMin = round10(out.unrounded);
    out.max = input.type === 'TTR' ? bal * r.ttr_max_pct : null;
    var n = input.paymentsOverride != null && input.paymentsOverride !== '' ? Number(input.paymentsOverride) : paymentsLeft(input.freq, start, fyEnd, input.anchor);
    out.payments = n;
    if (n && n > 0) {
      out.perMin = Math.ceil(out.proMin / n / 10) * 10;
      out.perMax = out.max != null ? Math.floor(out.max / n / 10) * 10 : null;
      out.perChosen = input.chosen ? round10(input.chosen / n) : null;
    }
    var nextJuly = new Date(fyEnd.getFullYear(), 6, 1);
    out.ageNext = dob ? ageOn(dob, nextJuly) : null;
    out.pctNext = dob ? band(bands, out.ageNext).pct : null;
    if (!dob) out.warnings.push("{{age-only:Age entered without a date of birth}}: next 1 July’s percentage and the preservation age can’t be checked.");

    if (bal < r.pension_min_start) out.warnings.push('Below the $' + r.pension_min_start.toLocaleString('en-AU') + ' minimum to start a Flexi Pension.');
    if (dob && start <= dob) out.warnings.push('Start date is before the date of birth.');
    if (start.getMonth() === 5) out.warnings.push('Starts in June: the member can choose no payment until the next financial year.');
    if (input.type === 'TTR' && dob && out.age < out.preservationAge) out.warnings.push('Under preservation age (' + out.preservationAge + '): a TTR pension cannot start yet.');
    if (input.type === 'TTR' && out.age >= 65) out.warnings.push('65 or over: TTR converts to Retirement Phase, so the 10% maximum no longer applies.');
    if (input.chosen && input.chosen < out.proMin) out.warnings.push('Chosen amount is below the pro-rata minimum.');
    if (input.chosen && out.max != null && input.chosen > out.max) out.warnings.push('Chosen amount is above the TTR maximum.');
    if (input.freq === 'Fortnightly' && !input.anchor && (input.paymentsOverride == null || input.paymentsOverride === '')) out.warnings.push('{{fortnightly:Fortnightly payments left is an estimate (one every 14 days)}}. For an exact count, enter the date of any fortnightly payment from the member’s account.');
    if (input.freq === 'Fortnightly' && input.anchor && input.anchor.getDay() !== 5) out.warnings.push('The pay date entered is not a Friday.');
    if (out.daysYear === 366) out.warnings.push('{{day-count:This financial year has 366 days}}. Confirm the admin system also divides by 366.');
    if (out.pctNext != null && out.pctNext > out.pct) out.warnings.push('From 1 July the minimum steps up from ' + Math.round(out.pct * 100) + '% to ' + Math.round(out.pctNext * 100) + '%.');
    return out;
  }

  return { calculate: calculate, paymentsLeft: paymentsLeft, ageOn: ageOn };
})();
