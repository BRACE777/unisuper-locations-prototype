// Calculators beyond drawdown: contribution caps, government top-ups, the spouse contribution offset,
// Division 293, the Retirement Bonus and insurance cover by age. Plain script (no modules) so it can be
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

  // Division 293: an extra 15% on the lesser of concessional contributions and the amount over $250,000.
  function div293(input, rates) {
    var r = R(rates), income = num(input.income), cc = num(input.cc), total = income + cc;
    var over = Math.max(0, total - r.div293_threshold), taxed = Math.min(cc, over);
    return { total: total, threshold: r.div293_threshold, over: over, taxed: taxed, tax: Math.round(taxed * 0.15), applies: over > 0 && cc > 0, assumed: ['div293-estimate'] };
  }

  // Retirement Bonus: 0.7% of what moves from eligible options, up to $14,700 across all bonuses.
  function retirementBonus(input, rates) {
    var r = R(rates), eligible = num(input.eligible), excluded = num(input.excluded), previous = num(input.previous);
    var room = Math.max(0, r.rb_cap - previous), raw = eligible * r.rb_rate;
    return { eligible: eligible, excluded: excluded, rate: r.rb_rate, raw: Math.round(raw), bonus: Math.round(Math.min(raw, room)), capped: raw > room, cap: r.rb_cap, previous: previous, room: room };
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

  return { caps: caps, topups: topups, spouseOffset: spouseOffset, div293: div293, retirementBonus: retirementBonus, cover: cover };
})();
