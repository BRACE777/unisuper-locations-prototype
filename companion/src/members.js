// Fictional test members: what applies to each one (insights), checklist conditions, and the
// values to pre-fill in the drawdown calculator. Plain script; exposes `CompanionMembers`.
// Every figure comes from rates.json, so the alerts follow the PDS.
var CompanionMembers = (function () {
  'use strict';
  var PRODUCT = { 'Accumulation 1': 'super', 'Accumulation 2': 'super', 'Personal Account': 'super', 'DBD': 'dbd', 'Retirement Phase': 'rp', 'TTR': 'ttr', 'BIS': 'bis' };
  var PENSION = { 'Retirement Phase': true, 'TTR': true, 'BIS': true };
  var CONDITIONS = ['under_25', 'under_55', 'under_60', 'over_60', 'age_67_74', 'age_75_plus', 'preservation_reached', 'preservation_not_reached',
    'has_pension', 'has_ttr', 'has_rp', 'has_bis', 'has_dbd', 'has_super', 'has_insurance', 'pension_planned', 'balance_under_6000', 'inactive_12m',
    'tsb_over_cap', 'tsb_under_500k', 'div293', 'div296', 'lapsing_nomination', 'temp_resident', 'spouse_known', 'last_fy_cc_known', 'cc_known', 'working'];

  function parse(iso) { var p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(d) { return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-AU'); }
  function ageOn(dob, on) {
    var a = on.getFullYear() - dob.getFullYear();
    if (on.getMonth() < dob.getMonth() || (on.getMonth() === dob.getMonth() && on.getDate() < dob.getDate())) a--;
    return a;
  }
  function addMonths(d, n) { var r = new Date(d.getFullYear(), d.getMonth() + n, 1); r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate())); return r; }
  function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0); }
  function fyStart(d) { return new Date(d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1, 6, 1); }
  function fyEnd(d) { var s = fyStart(d); return new Date(s.getFullYear() + 1, 5, 30); }
  function days(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5) + 1; }
  function round10(x) { return Math.round(x / 10) * 10; }

  function R(rates) { var r = {}; rates.rates.forEach(function (x) { r[x.id] = x.value; }); return r; }
  function band(rates, age) { var rows = rates.tables.minimum_drawdown.rows, b = rows[0]; rows.forEach(function (x) { if (age >= x.from_age) b = x; }); return b; }
  function presAge(rates, dob) { var s = iso(dob), rows = rates.tables.preservation_age.rows; for (var i = 0; i < rows.length; i++) if (s < rows[i].born_before) return rows[i].age; return 60; }

  function pensions(m) { return m.accounts.filter(function (a) { return PENSION[a.type]; }); }
  function supers(m) { return m.accounts.filter(function (a) { return !PENSION[a.type]; }); }
  function primaryProduct(m) { var p = pensions(m)[0]; return PRODUCT[(p || m.accounts[0] || {}).type] || ''; }
  function insured(m) { return supers(m).some(function (a) { return a.insurance && (a.insurance.status === 'active' || a.insurance.status === 'inbuilt'); }); }
  function lastContribution(m) {
    var ds = supers(m).map(function (a) { return a.last_contribution; }).filter(Boolean).sort();
    return ds.length ? parse(ds[ds.length - 1]) : null;
  }

  // Minimum (and TTR maximum) for a pension account this financial year.
  function pensionLimits(acc, m, rates, today) {
    var dob = parse(m.dob), opened = parse(acc.opened), s = fyStart(today), e = fyEnd(today), r = R(rates);
    var startedThisYear = opened >= s, base = startedThisYear ? acc.balance_1_july || acc.balance : acc.balance_1_july || acc.balance;
    var ageAt = ageOn(dob, startedThisYear ? opened : s), b = band(rates, ageAt);
    var min = startedThisYear ? round10(base * b.pct * days(opened, e) / days(s, e)) : round10(base * b.pct);
    return { min: min, pct: b.pct, base: base, prorated: startedThisYear, max: acc.type === 'TTR' ? base * r.ttr_max_pct : null };
  }

  function context(m, rates, today) {
    today = today || new Date();
    var r = R(rates), dob = parse(m.dob), age = ageOn(dob, today), pa = presAge(rates, dob);
    var tsb = m.tsb != null ? m.tsb : m.accounts.reduce(function (t, a) { return t + (a.balance || 0); }, 0);
    var last = lastContribution(m), inactive = last ? monthsBetween(last, today) : null;
    var superBal = supers(m).reduce(function (t, a) { return t + (a.balance || 0); }, 0);
    var nom = m.nomination || { type: 'none' }, nomExp = nom.type === 'binding-lapsing' && nom.signed ? addMonths(parse(nom.signed), 36) : null;
    var cc = m.fy ? m.fy.concessional : null, pen = pensions(m)[0];
    var lim = pen ? pensionLimits(pen, m, rates, today) : null;
    var spouseAge = m.spouse && m.spouse.dob ? ageOn(parse(m.spouse.dob), today) : null;
    var income = m.income || 0, ccForYear = Math.max(cc || 0, m.expected_concessional || 0);
    var vars = {
      name: m.name, number: m.number, age: age, presAge: pa, tsb: money(tsb),
      ccUsed: cc != null ? money(cc) : '', ccLeft: cc != null ? money(Math.max(0, r.cc_cap - cc)) : '',
      lastCc: m.last_fy_concessional ? money(m.last_fy_concessional) : '',
      splitMax: m.last_fy_concessional ? money(Math.min(m.last_fy_concessional * 0.85, r.cc_cap)) : '',
      spouseAge: spouseAge != null ? spouseAge + (m.spouse.retired ? ' and retired' : '') : '',
      monthsInactive: inactive, nomSigned: nom.signed ? fmt(parse(nom.signed)) : '', nomExpires: nomExp ? fmt(nomExp) : '',
      pensionMin: lim ? money(lim.min) : ''
    };
    var cond = {
      under_25: age < 25, under_55: age < 55, under_60: age < 60, over_60: age >= 60, age_67_74: age >= 67 && age <= 74, age_75_plus: age >= 75,
      preservation_reached: age >= pa, preservation_not_reached: age < pa,
      has_pension: !!pen, has_ttr: m.accounts.some(function (a) { return a.type === 'TTR'; }), has_rp: m.accounts.some(function (a) { return a.type === 'Retirement Phase'; }),
      has_bis: m.accounts.some(function (a) { return a.type === 'BIS'; }), has_dbd: m.accounts.some(function (a) { return a.type === 'DBD'; }),
      has_super: supers(m).length > 0, has_insurance: insured(m), pension_planned: !!m.pension_plan,
      balance_under_6000: supers(m).length > 0 && superBal < 6000, inactive_12m: inactive != null && inactive >= 12,
      tsb_over_cap: tsb >= r.tbc_general, tsb_under_500k: tsb < r.carry_forward_tsb,
      div293: income + ccForYear > r.div293_threshold, div296: tsb > r.div296_lower,
      lapsing_nomination: !!nomExp, temp_resident: !!m.temp_resident, spouse_known: spouseAge != null,
      last_fy_cc_known: !!m.last_fy_concessional, cc_known: cc != null && cc > 0, working: !!m.working
    };
    return { vars: vars, cond: cond, age: age, presAge: pa, tsb: tsb, inactive: inactive, last: last, nomExp: nomExp, limits: lim, pension: pen, income: income, ccForYear: ccForYear, r: r };
  }

  // Alerts for a member, most urgent first. tone: alarm | caution | info | positive.
  function insights(m, rates, today) {
    today = today || new Date();
    var c = context(m, rates, today), r = c.r, out = [], dob = parse(m.dob);
    function add(tone, text, link) { out.push({ tone: tone, text: text, rule: link && link.rule, checklist: link && link.checklist, calc: link && link.calc }); }

    pensions(m).forEach(function (acc) {
      var lim = pensionLimits(acc, m, rates, today);
      add('info', acc.type + ' minimum this year: ' + money(lim.min) + ' (' + Math.round(lim.pct * 100) + '% of ' + money(lim.base) + (lim.prorated ? ', pro-rated from ' + fmt(parse(acc.opened)) : ' at 1 July') + ').', { rule: 'min-pct', calc: true });
      if (lim.max != null) add('info', 'TTR maximum this year: ' + money(lim.max) + ' (10%, not pro-rated).', { rule: 'ttr-max' });
      if (acc.payment && acc.payment.annual < lim.min) add('alarm', 'Payments of ' + money(acc.payment.annual) + ' a year are below the minimum.', { checklist: 'change-payments' });
      if (acc.payment && lim.max != null && acc.payment.annual > lim.max) add('alarm', 'Payments of ' + money(acc.payment.annual) + ' a year are above the TTR maximum.', { checklist: 'change-payments' });
      if (acc.type === 'TTR') { var t65 = new Date(dob.getFullYear() + 65, dob.getMonth(), dob.getDate()); add('info', 'Turns 65 on ' + fmt(t65) + ': the TTR pension converts to Retirement Phase.', { rule: 'ttr-convert' }); }
      if (acc.type === 'BIS') add('info', 'BIS pension: no reversionary beneficiary, and it counts towards the transfer balance cap.', { rule: 'bis-rules' });
      var nextJuly = new Date(fyEnd(today).getFullYear(), 6, 1), now = band(rates, ageOn(dob, today)), next = band(rates, ageOn(dob, nextJuly));
      if (next.pct > now.pct) add('caution', 'From 1 July ' + nextJuly.getFullYear() + ' the minimum steps up to ' + Math.round(next.pct * 100) + '%.', { rule: 'min-pct' });
    });

    if (m.pension_plan) {
      var p = m.pension_plan, st = parse(p.start), b = band(rates, ageOn(dob, st)), e = fyEnd(st), s = fyStart(st);
      var min = round10(p.amount * b.pct * days(st, e) / days(s, e));
      var leftover = supers(m).reduce(function (t, a) { return t + a.balance; }, 0) - p.amount;
      add('info', 'Planned ' + p.type + ' pension from ' + fmt(st) + ' with ' + money(p.amount) + ': first-year minimum ' + money(min) + '.', { checklist: 'start-rp', calc: true });
      add(leftover >= r.pension_residual ? 'positive' : 'alarm', money(leftover) + ' would stay in super (at least ' + money(r.pension_residual) + ' must).', { rule: 'pension-residual' });
    }

    if (supers(m).length) {
      var supBal = supers(m).reduce(function (t, a) { return t + a.balance; }, 0);
      if (c.age < 25 && !c.cond.has_insurance) {
        var t25 = new Date(dob.getFullYear() + 25, dob.getMonth(), dob.getDate());
        add('info', 'No default insurance until 25 (' + fmt(t25) + ') and a $6,000 balance' + (supBal < 6000 ? ' (now ' + money(supBal) + ')' : '') + '.', { rule: 'default-cover' });
      }
      if (c.cond.inactive_12m) {
        var stop = addMonths(c.last, 16);
        if (c.cond.has_insurance) add(stop <= today ? 'alarm' : 'caution', 'No contributions for ' + c.inactive + ' months: insurance stops on ' + fmt(stop) + ' unless they elect to keep it.', { checklist: 'insurance-stopped' });
        if (supBal < 6000) add('caution', 'Under $6,000 and inactive: the account goes to the ATO after 16 months without activity.', { rule: 'ilba' });
      } else if (supBal < 6000) add('info', 'Balance under $6,000: low-balance rules and the 3% fee cap apply.', { rule: 'low-balance-cap' });
      if (c.cond.has_dbd) add('info', 'DBD member: no Income Protection, and using the defined benefit component for a pension ends DBD membership.', { rule: 'dbd-pension-db' });
      if (m.working && c.age >= c.presAge && !c.cond.has_pension) add('info', 'Past preservation age (' + c.presAge + ') and working: a TTR pension is possible.', { checklist: 'start-ttr' });
      if (c.age >= 65 && !c.cond.has_pension && !m.pension_plan) add('info', 'Aged 65+: a condition of release is met, so super can be accessed.', { rule: 'conditions-of-release' });
    }

    if (m.fy && m.fy.concessional > 0) add('info', 'Concessional contributions this year: ' + money(m.fy.concessional) + ' of ' + money(r.cc_cap) + (m.expected_concessional ? ' (on track for ' + money(m.expected_concessional) + ')' : '') + '.', { rule: 'cc-cap' });
    if (c.cond.div293) {
      var over = c.income + c.ccForYear - r.div293_threshold;
      add('caution', 'Division 293 likely: income plus concessional contributions about ' + money(c.income + c.ccForYear) + '. Extra 15% on ' + money(Math.min(over, c.ccForYear)) + ' (about ' + money(Math.min(over, c.ccForYear) * 0.15) + ').', { rule: 'div293' });
    }
    if (c.cond.div296) add('caution', 'Total super balance ' + money(c.tsb) + ' is over ' + money(r.div296_lower) + ': Division 296 tax on earnings.', { rule: 'div296' });
    if (c.cond.tsb_over_cap) add('caution', 'Total super balance at or over ' + money(r.tbc_general) + ': non-concessional cap is nil, and not all of it can go into a retirement pension.', { rule: 'ncc-cap' });
    if (c.cond.tsb_under_500k && m.working && m.fy && m.fy.concessional < r.cc_cap && (c.income >= 100000 || m.fy.non_concessional >= 10000)) add('info', 'Total super balance under ' + money(r.carry_forward_tsb) + ': unused concessional cap from the last five years may be carried forward (amount shown in ATO online services).', { rule: 'carry-forward' });
    if (m.fy && m.fy.non_concessional > 0 && c.age < 75) add('info', 'Personal contributions of ' + money(m.fy.non_concessional) + ' this year: a notice of intent is needed to claim a deduction.', { checklist: 'noi' });
    if (c.income > 0 && c.income <= r.listo_income && m.fy && m.fy.concessional > 0) add('positive', 'Income ' + money(c.income) + ': LISTO of about ' + money(Math.min(r.listo_max, m.fy.concessional * 0.15)) + ' paid by the ATO.', { rule: 'listo' });
    if (c.income > 0 && c.income <= r.cocontrib_lower && m.fy && m.fy.non_concessional > 0) add('positive', 'Income under ' + money(r.cocontrib_lower) + ': government co-contribution of about ' + money(Math.min(r.cocontrib_max, m.fy.non_concessional * r.cocontrib_rate)) + '.', { rule: 'co-contribution' });
    if (c.cond.age_67_74 && (m.working || (m.fy && m.fy.non_concessional > 0))) add('info', 'Aged ' + c.age + ': the work test applies to claiming a deduction for personal contributions.', { rule: 'work-test' });

    if (m.spouse) {
      var sa = ageOn(parse(m.spouse.dob), today), spa = presAge(rates, parse(m.spouse.dob));
      var ok = sa < 65 && (sa < spa || !m.spouse.retired);
      add(ok ? 'positive' : 'caution', 'Spouse is ' + sa + (ok ? ': contributions can be split to them' + (m.last_fy_concessional ? ', up to ' + money(Math.min(m.last_fy_concessional * 0.85, r.cc_cap)) + ' of last year’s' : '') : ': a split isn’t possible') + '.', { checklist: 'split' });
      if (m.spouse.income != null && m.spouse.income <= r.spouse_offset_income) add('positive', 'Spouse earns ' + money(m.spouse.income) + ': a $3,000 spouse contribution could give a ' + money(r.spouse_offset_max) + ' tax offset.', { rule: 'spouse-offset' });
    }

    var nom = m.nomination || { type: 'none' };
    if (c.nomExp) {
      var daysLeft = Math.round((c.nomExp - today) / 864e5);
      add(daysLeft < 0 ? 'alarm' : daysLeft <= 120 ? 'alarm' : 'info', 'Lapsing binding nomination ' + (daysLeft < 0 ? 'expired on ' : 'expires on ') + fmt(c.nomExp) + (daysLeft >= 0 && daysLeft <= 120 ? ' (' + daysLeft + ' days)' : '') + '.', { checklist: 'bdbn' });
    } else if (nom.type === 'none') add('info', 'No beneficiary nomination on file.', { rule: 'nom-types' });

    if (m.temp_resident) {
      var dep = parse(m.temp_resident.departed), due = addMonths(dep, 6);
      add(due < today ? 'alarm' : 'caution', 'Left Australia ' + fmt(dep) + ': claim a DASP by ' + fmt(due) + ' or the super goes to the ATO.', { rule: 'dasp' });
    }

    var order = { alarm: 0, caution: 1, positive: 2, info: 3 };
    return out.sort(function (a, b) { return order[a.tone] - order[b.tone]; });
  }

  // Values for the drawdown calculator.
  function prefill(m, today) {
    today = today || new Date();
    var pen = pensions(m)[0];
    if (pen) {
      var opened = parse(pen.opened), s = fyStart(today), thisYear = opened >= s;
      return { start: thisYear ? opened : s, balance: pen.balance_1_july || pen.balance, type: pen.type === 'BIS' ? 'Beneficiary (BIS)' : pen.type,
        freq: (pen.payment && pen.payment.freq) || 'Monthly', anchor: pen.payment && pen.payment.anchor ? parse(pen.payment.anchor) : null,
        chosen: pen.payment ? pen.payment.annual : null };
    }
    if (m.pension_plan) return { start: parse(m.pension_plan.start), balance: m.pension_plan.amount, type: m.pension_plan.type, freq: m.pension_plan.freq || 'Monthly', anchor: null, chosen: null };
    return null;
  }

  function fill(text, vars) { return text.replace(/\{(\w+)\}/g, function (all, k) { return vars[k] != null && vars[k] !== '' ? vars[k] : all; }); }

  // Checks an imported member list: returns a list of problems (empty if fine).
  function validate(list) {
    var errs = [], seen = {};
    if (!Array.isArray(list)) return ['Expected a "members" list.'];
    list.forEach(function (m, i) {
      var tag = 'Member ' + (i + 1);
      if (!m || typeof m !== 'object') { errs.push(tag + ' is not an object.'); return; }
      if (!/^\d{3}$/.test(m.number || '')) errs.push(tag + ': "number" must be 3 digits.');
      if (seen[m.number]) errs.push(tag + ': number ' + m.number + ' is used twice.');
      seen[m.number] = true;
      if (!m.name) errs.push(tag + ': "name" is missing.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.dob || '')) errs.push(tag + ': "dob" must be YYYY-MM-DD.');
      if (!Array.isArray(m.accounts) || !m.accounts.length) errs.push(tag + ': needs at least one account.');
      else m.accounts.forEach(function (a) { if (!PRODUCT[a.type]) errs.push(tag + ': unknown account type "' + a.type + '".'); });
    });
    return errs;
  }

  return { context: context, insights: insights, prefill: prefill, fill: fill, validate: validate, primaryProduct: primaryProduct, CONDITIONS: CONDITIONS, PRODUCT: PRODUCT, money: money };
})();
