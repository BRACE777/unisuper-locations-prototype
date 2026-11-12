// Date helpers: Victorian public holidays, Melbourne business days, adding days/months/years,
// and pension pay dates. Plain script; exposes `CompanionDates`.
var CompanionDates = (function () {
  'use strict';

  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
  function addMonths(d, n) {
    var y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  }
  function addYears(d, n) { return addMonths(d, 12 * n); }
  function nthWeekday(year, month, weekday, n) { // month 0-based, weekday 0=Sun
    var d = new Date(year, month, 1);
    var shift = (weekday - d.getDay() + 7) % 7;
    return new Date(year, month, 1 + shift + 7 * (n - 1));
  }
  function easterSunday(y) { // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  // Victorian public holidays by rule. The Friday before the AFL Grand Final is set each year by
  // the Victorian Government, so it comes from `extra` (data/holidays.json).
  function vicHolidays(year, extra) {
    var list = [];
    function add(d, name) { list.push({ date: ymd(d), name: name }); }
    var ny = new Date(year, 0, 1);
    add(ny, "New Year's Day");
    if (ny.getDay() === 6) add(new Date(year, 0, 3), "New Year's Day (additional)");
    if (ny.getDay() === 0) add(new Date(year, 0, 2), "New Year's Day (additional)");
    var aus = new Date(year, 0, 26);
    if (aus.getDay() === 6) aus = new Date(year, 0, 28);
    if (aus.getDay() === 0) aus = new Date(year, 0, 27);
    add(aus, 'Australia Day');
    add(nthWeekday(year, 2, 1, 2), 'Labour Day');
    var easter = easterSunday(year);
    add(addDays(easter, -2), 'Good Friday');
    add(addDays(easter, -1), 'Easter Saturday');
    add(easter, 'Easter Sunday');
    add(addDays(easter, 1), 'Easter Monday');
    add(new Date(year, 3, 25), 'Anzac Day');
    add(nthWeekday(year, 5, 1, 2), "King's Birthday");
    add(nthWeekday(year, 10, 2, 1), 'Melbourne Cup');
    var xmas = new Date(year, 11, 25), box = new Date(year, 11, 26);
    add(xmas, 'Christmas Day');
    add(box, 'Boxing Day');
    if (xmas.getDay() === 6) { add(new Date(year, 11, 27), 'Christmas Day (additional)'); add(new Date(year, 11, 28), 'Boxing Day (additional)'); }
    else if (xmas.getDay() === 0) add(new Date(year, 11, 27), 'Christmas Day (additional)');
    else if (box.getDay() === 6) add(new Date(year, 11, 28), 'Boxing Day (additional)');
    (extra || []).forEach(function (h) { if (h.date.slice(0, 4) === String(year)) list.push(h); });
    return list;
  }

  function makeCalendar(extra) {
    var cache = {};
    function holidayName(d) {
      var y = d.getFullYear();
      if (!cache[y]) { cache[y] = {}; vicHolidays(y, extra).forEach(function (h) { cache[y][h.date] = h.name; }); }
      return cache[y][ymd(d)] || null;
    }
    function isBusinessDay(d) { return d.getDay() !== 0 && d.getDay() !== 6 && !holidayName(d); }
    // n business days after `d` (the day of receipt itself doesn't count).
    function addBusinessDays(d, n) {
      var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()), skipped = [];
      while (n > 0) {
        r = addDays(r, 1);
        if (isBusinessDay(r)) n--;
        else if (r.getDay() !== 0 && r.getDay() !== 6) skipped.push(ymd(r) + ' ' + holidayName(r));
      }
      return { date: r, skipped: skipped };
    }
    return { holidayName: holidayName, isBusinessDay: isBusinessDay, addBusinessDays: addBusinessDays };
  }

  function apply(calc, from, cal) {
    if (calc.type === 'days') return { date: addDays(from, calc.n), skipped: [] };
    if (calc.type === 'months') return { date: addMonths(from, calc.n), skipped: [] };
    if (calc.type === 'years') return { date: addYears(from, calc.n), skipped: [] };
    if (calc.type === 'business_days') return cal.addBusinessDays(from, calc.n);
    throw new Error('Unknown calc type ' + calc.type);
  }

  function financialYearEnd(d) { return new Date(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(), 5, 30); }
  function daysBetweenInclusive(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5) + 1; }

  return {
    ymd: ymd, parse: parse, addDays: addDays, addMonths: addMonths, addYears: addYears, easterSunday: easterSunday,
    vicHolidays: vicHolidays, makeCalendar: makeCalendar, apply: apply, financialYearEnd: financialYearEnd,
    daysBetweenInclusive: daysBetweenInclusive
  };
})();
