// India payroll: every statutory rate in one place, plus the pure maths that uses them.
// Rates are for FY 2025-26 (1 Apr 2025 – 31 Mar 2026) unless noted. They change with each Budget,
// EPFO/ESIC notification and state amendment, so every value is flagged "verify with your CA".
// Each workspace can override them in Attendance & payroll → Settings (stored on ws.people.rates).
// docs/hr-india.md explains each rule and source.

export const RATES_META = {
  fy: "2025-26",
  fy_start: "2025-04-01",
  verify: true,
  note: "Typical statutory rates for FY 2025-26. Not legal or tax advice: confirm every value with your CA before paying salaries or filing returns. The CA files Form 24Q (TDS) and the PF ECR / ESI returns.",
};

// Defaults; Settings may override any key (see cleanRates).
export const DEFAULT_RATES = {
  // Salary structure (company policy, not a statute except the 50% wage floor)
  basic_pct: 50,           // Basic (+DA) as % of monthly gross. Labour Codes: excluded pay over 50% counts back into "wages".
  hra_pct: 40,             // HRA as % of basic, non-metro
  hra_metro_pct: 50,       // HRA as % of basic, metro (Delhi, Mumbai, Kolkata, Chennai for the s.10(13A) exemption)
  ctc_includes_gratuity: true, // CTC = gross + employer PF + employer ESI + gratuity provision
  // EPF (Employees' Provident Funds & Misc. Provisions Act 1952)
  pf_employee_pct: 12,
  pf_employer_pct: 12,     // split into EPS 8.33% (capped) and EPF (the rest, 3.67% at the ceiling)
  eps_pct: 8.33,
  pf_wage_ceiling: 15000,  // statutory wage ceiling per month
  eps_cap: 1250,           // 8.33% of 15,000
  pf_on_full_basic: false, // true = 12% on full basic (EPS still capped)
  edli_on: false, edli_pct: 0.5, edli_wage_cap: 15000,
  admin_on: false, admin_pct: 0.5, admin_min: 500, // EPF admin charges; ₹500/month minimum per establishment
  // ESI (Employees' State Insurance Act 1948)
  esi_threshold: 21000,    // covered when monthly gross wages ≤ this
  esi_employee_pct: 0.75,
  esi_employer_pct: 3.25,
  // Gratuity (Payment of Gratuity Act 1972 / Code on Social Security 2020)
  gratuity_pct: 4.81,      // monthly provision = 15/26/12 of basic
  gratuity_years: 5,       // continuous service before it is payable (fixed-term: 1 year under the Code; verify)
  gratuity_cap: 2000000,   // ₹20 lakh ceiling
  // Leave encashment on exit (company policy)
  encash_divisor: 30,      // one day's pay = monthly basic / this
};
export const RATE_KEYS = Object.keys(DEFAULT_RATES);

export const RATE_SOURCES = [
  { key: "pf", label: "EPF / EPS / EDLI", rule: "Employee 12% of PF wages (basic + DA); employer 12% = EPS 8.33% (on wages up to ₹15,000, so max ₹1,250) + EPF 3.67%. Wage ceiling ₹15,000 a month; above it PF is voluntary. EDLI 0.5% (wages capped at ₹15,000), admin 0.5% (min ₹500).", source: "EPF & MP Act 1952; EPF Scheme 1952; EPS 1995; EDLI 1976; EPFO notifications (ceiling ₹15,000 from 1 Sep 2014; admin 0.5% from 1 Jun 2018).", fy: "2025-26" },
  { key: "esi", label: "ESI", rule: "Applies when gross wages ≤ ₹21,000 a month. Employee 0.75%, employer 3.25%, rounded up to the next rupee.", source: "ESI Act 1948; ESIC rates from 1 Jul 2019; wage limit ₹21,000 from 1 Jan 2017.", fy: "2025-26" },
  { key: "pt", label: "Professional Tax", rule: "State tax on employment, max ₹2,500 a year (Article 276). Presets only for states listed below; enter others yourself.", source: "Each state's Professional Tax Act.", fy: "2025-26" },
  { key: "tds", label: "TDS on salary (new regime)", rule: "Slabs 0 / 5 / 10 / 15 / 20 / 25 / 30% at ₹4, 8, 12, 16, 20, 24 lakh. Standard deduction ₹75,000. Section 87A rebate up to ₹60,000: nil tax up to ₹12 lakh taxable income, with marginal relief just above. 4% health & education cess. Surcharge (over ₹50 lakh) is not computed.", source: "Income-tax Act 1961 s.115BAC, s.87A, s.16(ia), s.192 as amended by the Finance Act 2025.", fy: "2025-26" },
  { key: "tds_old", label: "TDS on salary (old regime)", rule: "Slabs 0 / 5 / 20 / 30% at ₹2.5, 5, 10 lakh (below 60). Standard deduction ₹50,000. 87A rebate up to ₹12,500 when taxable income ≤ ₹5 lakh. 4% cess. Other deductions (80C, HRA exemption…) are entered per employee.", source: "Income-tax Act 1961, Finance Act 2025.", fy: "2025-26" },
  { key: "gratuity", label: "Gratuity", rule: "Payable on leaving after 5 years' continuous service: 15/26 × last basic + DA × completed years (6+ months rounds up), capped at ₹20 lakh. Monthly provision 4.81% of basic.", source: "Payment of Gratuity Act 1972 s.4; ceiling ₹20 lakh from 29 Mar 2018; Code on Social Security 2020 (fixed-term employees after 1 year).", fy: "2025-26" },
  { key: "wage", label: "50% wage rule", rule: "Under the Labour Codes, allowances excluded from 'wages' above 50% of total pay are added back, so Basic + DA is set to at least 50% of gross by default.", source: "Code on Wages 2019 s.2(y); Code on Social Security 2020 s.2(88).", fy: "2025-26" },
];

// ---- Income tax
export const TAX_REGIMES = {
  new: {
    name: "New regime (default, s.115BAC)", fy: "2025-26",
    slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]],
    std_deduction: 75000, rebate_limit: 1200000, rebate_max: 60000, marginal_relief: true, cess_pct: 4,
  },
  old: {
    name: "Old regime (opt-in)", fy: "2025-26",
    slabs: [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]],
    std_deduction: 50000, rebate_limit: 500000, rebate_max: 12500, marginal_relief: false, cess_pct: 4,
  },
};
export const SURCHARGE_FROM = 5000000; // above this TDS needs surcharge: flagged, not computed

export function slabTax(income, slabs) {
  let tax = 0, lower = 0;
  for (const [upto, pct] of slabs) {
    if (income <= lower) break;
    tax += (Math.min(income, upto) - lower) * pct / 100;
    lower = upto;
  }
  return tax;
}

// Annual tax on taxable income (after the standard deduction), with rebate, marginal relief and cess.
export function incomeTax(taxable, regime = "new") {
  const r = TAX_REGIMES[regime] || TAX_REGIMES.new;
  taxable = Math.max(0, Math.floor(taxable));
  let tax = slabTax(taxable, r.slabs);
  let rebate = 0;
  if (taxable <= r.rebate_limit) rebate = Math.min(tax, r.rebate_max);
  else if (r.marginal_relief) rebate = Math.max(0, tax - (taxable - r.rebate_limit)); // tax can't exceed income above the limit
  tax -= rebate;
  const cess = tax * r.cess_pct / 100;
  return { taxable, slab_tax: Math.round(tax + rebate), rebate: Math.round(rebate), cess: Math.round(cess), total: Math.round(tax + cess), surcharge_missing: taxable > SURCHARGE_FROM };
}

// ---- Professional Tax: monthly slabs on gross salary. Only states we're confident about.
// Each preset: slabs [{ upto, amount }] (first slab whose upto ≥ gross applies), feb = amount in February
// for the top slab (so the year adds up to ₹2,500). by_gender when the slabs differ.
export const PT_PRESETS = {
  KA: { name: "Karnataka", slabs: [{ upto: 24999, amount: 0 }, { upto: Infinity, amount: 200 }], feb: 300,
    source: "Karnataka Tax on Professions, Trades, Callings & Employments Act 1976; ₹25,000 threshold from 1 Apr 2023; ₹300 in February from FY 2025-26 (2025 amendment) — verify.", due: "20th of the following month (verify)" },
  MH: { name: "Maharashtra", by_gender: {
    male: [{ upto: 7500, amount: 0 }, { upto: 10000, amount: 175 }, { upto: Infinity, amount: 200 }],
    female: [{ upto: 25000, amount: 0 }, { upto: Infinity, amount: 200 }],
  }, feb: 300, source: "Maharashtra State Tax on Professions, Trades, Callings & Employments Act 1975, Schedule I entry 1 (women up to ₹25,000 exempt from 2023) — verify.", due: "per the state's return schedule (verify)" },
  DL: { name: "Delhi", none: true, source: "Delhi levies no professional tax — verify." },
  HR: { name: "Haryana", none: true, source: "Haryana levies no professional tax — verify." },
  UP: { name: "Uttar Pradesh", none: true, source: "Uttar Pradesh levies no professional tax — verify." },
};

export const STATES = [
  ["AN", "Andaman and Nicobar Islands"], ["AP", "Andhra Pradesh"], ["AR", "Arunachal Pradesh"], ["AS", "Assam"], ["BR", "Bihar"],
  ["CH", "Chandigarh"], ["CT", "Chhattisgarh"], ["DN", "Dadra and Nagar Haveli and Daman and Diu"], ["DL", "Delhi"], ["GA", "Goa"],
  ["GJ", "Gujarat"], ["HR", "Haryana"], ["HP", "Himachal Pradesh"], ["JK", "Jammu and Kashmir"], ["JH", "Jharkhand"],
  ["KA", "Karnataka"], ["KL", "Kerala"], ["LA", "Ladakh"], ["LD", "Lakshadweep"], ["MP", "Madhya Pradesh"],
  ["MH", "Maharashtra"], ["MN", "Manipur"], ["ML", "Meghalaya"], ["MZ", "Mizoram"], ["NL", "Nagaland"],
  ["OR", "Odisha"], ["PY", "Puducherry"], ["PB", "Punjab"], ["RJ", "Rajasthan"], ["SK", "Sikkim"],
  ["TN", "Tamil Nadu"], ["TG", "Telangana"], ["TR", "Tripura"], ["UP", "Uttar Pradesh"], ["UK", "Uttarakhand"], ["WB", "West Bengal"],
].map(([code, name]) => ({ code, name }));
export const STATE_CODES = STATES.map((s) => s.code);
export const stateName = (code) => STATES.find((s) => s.code === code)?.name || code || "—";

const slabAmount = (slabs, gross) => (slabs.find((s) => gross <= (s.upto ?? Infinity)) || slabs.at(-1) || { amount: 0 }).amount;

// Monthly PT for one employee. custom = settings.pt_custom[state] = { slabs, feb } typed in by the company.
// manual = a fixed monthly amount entered on the employee. Returns { amount, basis, warn }.
export function professionalTax({ state, gross, month, gender = "", custom = null, manual = null }) {
  if (manual != null && manual !== "") return { amount: Math.max(0, Math.round(Number(manual) || 0)), basis: "entered on the employee" };
  const feb = Number(String(month).slice(5, 7)) === 2;
  if (custom?.slabs?.length) {
    const amt = slabAmount(custom.slabs, gross);
    const top = custom.slabs.at(-1);
    return { amount: feb && custom.feb != null && amt > 0 && amt === top.amount ? Number(custom.feb) : amt, basis: "company slabs" };
  }
  const p = PT_PRESETS[state];
  if (!p) return { amount: 0, basis: "none", warn: `No Professional Tax preset for ${stateName(state)}: enter the state's slabs in Settings or an amount on the employee.` };
  if (p.none) return { amount: 0, basis: `${p.name}: no PT` };
  const slabs = p.by_gender ? p.by_gender[gender === "female" ? "female" : "male"] : p.slabs;
  const amt = slabAmount(slabs, gross);
  const top = slabs.at(-1).amount;
  return { amount: feb && p.feb && amt === top && amt > 0 ? p.feb : amt, basis: `${p.name} preset${p.by_gender && !gender ? " (gender not set: men's slabs used)" : ""}` };
}

// ---- EPF
export function pfFor(basicEarned, rates = DEFAULT_RATES) {
  const r = { ...DEFAULT_RATES, ...rates };
  const capped = Math.min(basicEarned, r.pf_wage_ceiling);
  const pfWages = r.pf_on_full_basic ? basicEarned : capped;
  const employee = Math.round(pfWages * r.pf_employee_pct / 100);
  const employerTotal = Math.round(pfWages * r.pf_employer_pct / 100);
  const eps = Math.min(Math.round(capped * r.eps_pct / 100), r.eps_cap);
  const edli = r.edli_on ? Math.round(Math.min(basicEarned, r.edli_wage_cap) * r.edli_pct / 100) : 0;
  const admin = r.admin_on ? Math.round(pfWages * r.admin_pct / 100) : 0;
  return { pf_wages: pfWages, eps_wages: capped, edli_wages: Math.min(basicEarned, r.edli_wage_cap), employee, eps, employer_epf: employerTotal - eps, employer: employerTotal, edli, admin };
}

// ---- ESI: eligibility on the employee's monthly gross (full month), contribution on wages earned.
export function esiFor(monthlyGross, earnedWages, rates = DEFAULT_RATES) {
  const r = { ...DEFAULT_RATES, ...rates };
  if (!(monthlyGross <= r.esi_threshold)) return { eligible: false, wages: 0, employee: 0, employer: 0 };
  return { eligible: true, wages: earnedWages, employee: Math.ceil(earnedWages * r.esi_employee_pct / 100), employer: Math.ceil(earnedWages * r.esi_employer_pct / 100) };
}

// ---- Gratuity payable on exit: 15/26 × last basic × completed years (a part year over 6 months counts).
export function gratuityPayable(lastBasic, doj, exitDate, rates = DEFAULT_RATES, fixedTerm = false) {
  const r = { ...DEFAULT_RATES, ...rates };
  if (!doj || !exitDate) return { eligible: false, years: 0, amount: 0 };
  const a = new Date(doj + "T00:00:00Z"), b = new Date(exitDate + "T00:00:00Z");
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  months = Math.max(0, months);
  const exact = months / 12;
  const years = Math.floor(exact) + (months % 12 > 6 ? 1 : 0);
  const need = fixedTerm ? 1 : r.gratuity_years;
  if (exact < need) return { eligible: false, years, service_years: Math.round(exact * 100) / 100, amount: 0, need };
  return { eligible: true, years, service_years: Math.round(exact * 100) / 100, amount: Math.min(Math.round(15 / 26 * lastBasic * years), r.gratuity_cap), need };
}

// ---- Salary structure: monthly gross → basic, HRA, special allowance.
export function structureFromGross(gross, { basic_pct, metro = false, rates = DEFAULT_RATES } = {}) {
  const r = { ...DEFAULT_RATES, ...rates };
  gross = Math.max(0, Math.round(gross));
  const basic = Math.round(gross * (basic_pct ?? r.basic_pct) / 100);
  const hra = Math.min(gross - basic, Math.round(basic * (metro ? r.hra_metro_pct : r.hra_pct) / 100));
  return { gross, basic, hra, special: gross - basic - hra };
}

// Employer's monthly cost on top of gross for a full month (used to turn CTC into gross).
export function employerExtras(st, { pf = true, esi = true, rates = DEFAULT_RATES } = {}) {
  const r = { ...DEFAULT_RATES, ...rates };
  const p = pf ? pfFor(st.basic, r) : null;
  const e = esi ? esiFor(st.gross, st.gross, r) : { employer: 0 };
  const grat = r.ctc_includes_gratuity ? Math.round(st.basic * r.gratuity_pct / 100) : 0;
  return { pf: p ? p.employer + p.edli + p.admin : 0, esi: e.employer, gratuity: grat, total: (p ? p.employer + p.edli + p.admin : 0) + e.employer + grat };
}

// Annual CTC → the monthly structure whose gross + employer costs is as close as possible to CTC / 12.
export function structureFromCtc(annualCtc, opts = {}) {
  const target = Math.max(0, Number(annualCtc) || 0) / 12;
  const cost = (g) => { const st = structureFromGross(g, opts); return st.gross + employerExtras(st, opts).total; };
  let lo = 0, hi = Math.ceil(target);
  for (let i = 0; i < 60 && hi - lo > 0.5; i++) { const mid = (lo + hi) / 2; cost(mid) > target ? (hi = mid) : (lo = mid); }
  const st = structureFromGross(Math.floor(lo), opts);
  const ex = employerExtras(st, opts);
  return { ...st, employer: ex, monthly_ctc: st.gross + ex.total, annual_ctc: Math.round(Number(annualCtc) || 0) };
}

// ---- Financial year helpers ("2026-06" → FY 2026-27 starts April)
export const fyOf = (month) => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
export const fyIndex = (month) => (Number(month.slice(5, 7)) + 8) % 12; // April = 0 … March = 11
export const fyMonths = (month) => { const s = Number(fyOf(month).slice(0, 4)); return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return `${m >= 4 ? s : s + 1}-${String(m).padStart(2, "0")}`; }); };

// Statutory due dates for a payroll month (all "verify": holidays and notifications move them).
export function dueDates(month, states = []) {
  const [y, m] = month.split("-").map(Number);
  const next = (d) => { const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1; return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  const out = [
    { what: "TDS deposit (challan ITNS 281)", due: m === 3 ? `${y}-04-30` : next(7), note: "7th of next month; March TDS by 30 April. Quarterly Form 24Q by the CA.", verify: true },
    { what: "PF (ECR + payment)", due: next(15), note: "15th of next month on the EPFO portal.", verify: true },
    { what: "ESI contribution", due: next(15), note: "15th of next month on the ESIC portal.", verify: true },
  ];
  for (const st of [...new Set(states)]) {
    const p = PT_PRESETS[st];
    if (p?.none) continue;
    out.push({ what: `Professional Tax: ${stateName(st)}`, due: st === "KA" ? next(20) : null, note: p?.due || "Per the state's rules: enter the date your CA gives you.", verify: true });
  }
  return out;
}

// Settings → rates: only known keys, numbers stay numbers, booleans stay booleans.
export function cleanRates(input = {}, base = DEFAULT_RATES) {
  const out = { ...base };
  for (const k of RATE_KEYS) {
    if (input[k] === undefined) continue;
    if (typeof DEFAULT_RATES[k] === "boolean") out[k] = !!input[k];
    else { const n = Number(input[k]); if (Number.isFinite(n) && n >= 0 && n <= 100000000) out[k] = n; }
  }
  return out;
}
