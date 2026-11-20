// Calculators beyond drawdown: contribution caps, government top-ups, the spouse contribution offset,
// Division 293 and insurance cover by age. Plain script (no modules) so it can be
// inlined into the page and loaded by the tests through node:vm. Exposes `CompanionCalcs`.
// Every figure comes from rates.json (each with its PDS, form or website quote); anything the sources
// don't spell out is named in `assumed`, which the page shows with a red underline.
var CompanionCalcs = (function () {
  'use strict';

  function R(rates) { var r = {}; rates.rates.forEach(function (x) { r[x.id] = x.value; }); return r; }
  function num(v) { return v == null || v === '' || isNaN(v) ? 0 : +v; }

  // Concessional (before-tax) and non-concessional (after-tax) contributions against this year's caps.
  // in: salary, employerRate, salarySacrifice, personal (deducted personal), otherCc, carryForward (unused,
  //     from ATO online services), tsb (total super balance last 30 June), age, ncc (after-tax so far)
  function caps(input, rates) {
    var r = R(rates), out = { assumed: [] };
    out.employer = Math.round(num(input.salary) * num(input.employerRate));
    if (input.salary) out.assumed.push('employer-estimate');
    out.cc = out.employer + num(input.salarySacrifice) + num(input.personal) + num(input.otherCc);
    out.ccCap = r.cc_cap;
    var tsbKnown = input.tsb != null && input.tsb !== '';
    out.carryAllowed = tsbKnown && num(input.tsb) < r.carry_forward_tsb;
    out.carry = out.carryAllowed ? num(input.carryForward) : 0;
    if (num(input.carryForward) > 0) out.assumed.push('carry-forward-relevance');
    out.ccAvailable = out.ccCap + out.carry;
    out.ccLeft = Math.max(0, out.ccAvailable - out.cc);
    out.ccOver = Math.max(0, out.cc - out.ccAvailable);

    // After-tax: the bring-forward table sets this year's limit from the total super balance.
    var rows = rates.tables.bring_forward.rows, row = rows[0];
    if (tsbKnown) for (var i = 0; i < rows.length; i++) { if (rows[i].tsb_below == null || num(input.tsb) < rows[i].tsb_below) { row = rows[i]; break; } }
    var under75 = input.age == null || input.age === '' || num(input.age) < r.bring_forward_age;
    out.nccGeneral = tsbKnown && row.cap === 0 ? 0 : r.ncc_cap;
    out.nccAvailable = under75 ? (tsbKnown ? row.cap : r.ncc_cap) : out.nccGeneral;
    out.period = under75 && tsbKnown ? row.period : null;
    out.ncc = num(input.ncc);
    out.nccLeft = Math.max(0, out.nccAvailable - out.ncc);
    out.nccOver = Math.max(0, out.ncc - out.nccAvailable);
    out.bringForwardUsed = out.ncc > out.nccGeneral && out.nccGeneral > 0;
    if (under75 && tsbKnown && row.cap > r.ncc_cap) out.assumed.push('bring-forward-status');
    out.tsbKnown = tsbKnown; out.under75 = under75;
    return out;
  }

  // Government co-contribution and LISTO from income and contributions.
  function coContribution(income, ncc, r) {
    if (income >= r.cocontrib_upper || ncc <= 0) return 0;
    var max = income <= r.cocontrib_lower ? r.cocontrib_max : r.cocontrib_max * (r.cocontrib_upper - income) / (r.cocontrib_upper - r.cocontrib_lower);
    return Math.max(0, Math.min(max, ncc * r.cocontrib_rate));
  }
  function listo(income, cc, r) { return income <= r.listo_income ? Math.min(r.listo_max, cc * 0.15) : 0; }
  function topups(input, rates) {
    var r = R(rates), income = num(input.income), ncc = num(input.ncc), cc = num(input.cc);
    var out = { co: Math.round(coContribution(income, ncc, r) * 100) / 100, listo: Math.round(listo(income, cc, r) * 100) / 100, assumed: ['cocontrib-estimate', 'listo-estimate'] };
    // The co-contribution at every income, for this member's after-tax contributions (or the most possible).
    var forNcc = ncc > 0 ? ncc : r.cocontrib_max / r.cocontrib_rate;
    out.coCurve = [];
    for (var x = 30000; x <= 70000; x += 500) out.coCurve.push([x, coContribution(x, forNcc, r)]);
    out.lower = r.cocontrib_lower; out.upper = r.cocontrib_upper; out.max = r.cocontrib_max; out.listoIncome = r.listo_income; out.listoMax = r.listo_max;
    return out;
  }

  // Spouse contribution tax offset: 18% of up to $3,000, reducing as the spouse's income goes from $37,000 to $40,000.
  function spouseAmount(spouseIncome, contribution, r) {
    var limit = r.spouse_offset_max / 0.18, room = Math.max(0, limit - Math.max(0, spouseIncome - r.spouse_offset_income));
    return 0.18 * Math.max(0, Math.min(limit, contribution, room));
  }
  function spouseOffset(input, rates) {
    var r = R(rates), inc = num(input.spouseIncome), c = num(input.contribution);
    var out = { offset: Math.round(spouseAmount(inc, c, r) * 100) / 100, limit: r.spouse_offset_max / 0.18, max: r.spouse_offset_max,
      from: r.spouse_offset_income, to: r.spouse_offset_cutout, assumed: ['offset-taper'], curve: [] };
    var forC = c > 0 ? c : out.limit;
    for (var x = 34000; x <= 41000; x += 100) out.curve.push([x, spouseAmount(x, forC, r)]);
    return out;
  }

  // Division 293: an extra 15% on pre-tax (concessional) contributions, on the lesser of those contributions
  // and the amount by which income plus them goes over $250,000. "Division 293 super contributions equal your
  // concessional contributions minus any excess concessional contributions" (How super works p12), so anything
  // over the cap (taxed separately) is left out.
  function div293(input, rates) {
    var r = R(rates), income = num(input.income), cc = num(input.cc), cap = r.cc_cap + num(input.carryForward);
    var counted = Math.min(cc, cap), excess = cc - counted, total = income + counted;
    var over = Math.max(0, total - r.div293_threshold), taxed = Math.min(counted, over);
    return { total: total, threshold: r.div293_threshold, counted: counted, excess: excess, over: over, taxed: taxed, tax: Math.round(taxed * 0.15),
      applies: over > 0 && counted > 0, assumed: ['div293-estimate'] };
  }

  // Unitised Death/TPD cover by age (Insurance in your super, premiums and unitised cover amounts).
  function cover(input, rates) {
    var rows = rates.tables.unit_cover.rows, units = num(input.units) || 0, age = input.age == null || input.age === '' ? null : num(input.age);
    var row = age == null ? null : rows.filter(function (x) { return x.age === age; })[0] || null;
    return {
      units: units, age: age, row: row, cover: row ? row.cover * units : null,
      premium: row ? { male: Math.round(row.death_m * units * 100) / 100, female: Math.round(row.death_f * units * 100) / 100 } : null,
      curve: rows.map(function (x) { return [x.age, x.cover * (units || 1)]; }),
      peak: rows.reduce(function (a, b) { return b.cover > a.cover ? b : a; }), minAge: rows[0].age, maxAge: rows[rows.length - 1].age
    };
  }

  // Income Protection (Insurance in your super): units of $100 a week. From salary, 85% ÷ 52 ÷ $100, rounded
  // UP to the next whole unit (the PDS examples: $120,000 -> 19.62 -> 20 units). Without health evidence, up
  // to the lesser of 23 units and that; with the Insurer's acceptance, up to the lesser of 69 units and that.
  // At claim, up to 73% of pre-disability income as cash and up to 12% into super; the
  // annual premium per unit by age, sex at birth, waiting period and benefit period. A to-age-65 benefit
  // period becomes two years from 63, so the two-year rates apply from then. Cover stops at 67.
  // in: salary, age, units (blank = the most allowed), wait ('90' | '60' | '30'), period ('2y' | '5y' | '65'), sex ('m' | 'f')
  var IP_COL = { '90m': 1, '90f': 2, '60m': 3, '60f': 4, '30m': 5, '30f': 6 };
  function ipRate(table, period, age, wait, sex, switchAge) {
    var p = period === '65' && age >= switchAge ? '2y' : period;
    var row = table.periods[p].filter(function (x) { return x[0] === age; })[0];
    return row ? row[IP_COL[wait + sex]] : null;
  }
  function ipCover(input, rates) {
    var r = R(rates), t = rates.tables.ip_premiums, salary = num(input.salary);
    var wait = input.wait || '90', period = input.period || '2y', sex = input.sex || 'm';
    var age = input.age == null || input.age === '' ? null : num(input.age);
    var bySalary = salary > 0 ? Math.ceil(Math.round(salary * r.ip_salary_pct / 52 / r.ip_unit_value * 1e6) / 1e6) : null;
    var noEvidence = bySalary == null ? r.ip_units_no_evidence : Math.min(r.ip_units_no_evidence, bySalary);
    var allowed = bySalary == null ? r.ip_units_max : Math.min(r.ip_units_max, bySalary);
    var units = input.units == null || input.units === '' ? noEvidence : num(input.units);
    var monthly = units * r.ip_unit_value * 52 / 12;
    var out = { units: units, bySalary: bySalary, noEvidence: noEvidence, allowed: allowed, overAllowed: units > allowed, needsEvidence: units > noEvidence && units <= allowed,
      noEvidenceMax: r.ip_units_no_evidence, transitionedMax: r.ip_units_transitioned, weekly: units * r.ip_unit_value, monthly: monthly,
      wait: wait, period: period, sex: sex, age: age, ceases: r.ip_ceases, switchAge: r.ip_to65_switch, maxUnits: r.ip_units_max };
    if (salary > 0) {
      var income = salary / 12;
      out.benefit = Math.min(monthly, income * r.ip_salary_pct);
      out.cash = Math.min(out.benefit, income * r.ip_cash_pct);
      out.toSuper = Math.min(out.benefit - out.cash, income * r.ip_super_pct);
      out.income = income;
    }
    var rate = age == null ? null : ipRate(t, period, age, wait, sex, r.ip_to65_switch);
    out.rate = rate;
    out.premium = rate == null ? null : Math.round(rate * units * 100) / 100;
    out.converted = period === '65' && age != null && age >= r.ip_to65_switch;
    out.curve = t.periods['2y'].map(function (row) { var a = row[0], x = ipRate(t, period, a, wait, sex, r.ip_to65_switch); return [a, (x || 0) * (units || 1)]; });
    return out;
  }

  return { caps: caps, topups: topups, spouseOffset: spouseOffset, div293: div293, cover: cover, ipCover: ipCover };
})();
