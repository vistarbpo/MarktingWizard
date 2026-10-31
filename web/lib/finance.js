// Finance: cash, burn, runway, budgets, a 12-month cash forecast, unit economics and VAT.
// AI keeps the books (reads bank lines, writes the monthly report and investor update);
// people approve payments, file VAT with ZATCA, run payroll and sign.
import { BRIEF_FIELDS } from "./catalog.js";
import { OPEN, SAR_PER_USD, STAGES, planFor } from "./sales.js";

export const CATEGORIES = [
  { id: "payroll", name: "Payroll & GOSI", cogs: false },
  { id: "freelancers", name: "Freelancers", cogs: false },
  { id: "ai_api", name: "AI & APIs", cogs: true },
  { id: "hosting", name: "Hosting & rendering", cogs: true },
  { id: "tools", name: "Software & tools", cogs: false },
  { id: "marketing", name: "Marketing & ads", cogs: false },
  { id: "legal_gov", name: "Legal & government", cogs: false },
  { id: "office", name: "Office & travel", cogs: false },
  { id: "other", name: "Other", cogs: false },
];
export const CAT_IDS = CATEGORIES.map((c) => c.id);
export const VAT_RATE = 0.15;
// ZATCA thresholds (check with your accountant): mandatory above SAR 375,000 taxable supplies in 12 months.
export const VAT_MANDATORY_SAR = 375000;
export const VAT_VOLUNTARY_SAR = 187500;

export const DEFAULT_SETTINGS = { vat_registered: false, mrr_growth_pct: 15, include_hires: true, budgets: { marketing: 11250 } };

const ym = (d) => d.slice(0, 7);
const addMonths = (y, m, n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

// Monthly cost of a recurring expense, in SAR.
const monthlyOf = (e) => (e.recurring === "monthly" ? e.amount_sar : e.recurring === "yearly" ? e.amount_sar / 12 : 0);

export function financeSnapshot({ expenses, cash, deals, roles, settings, now = new Date() }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}), budgets: { ...DEFAULT_SETTINGS.budgets, ...(settings?.budgets || {}) } };
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const lastMonth = addMonths(now.getUTCFullYear(), now.getUTCMonth() + 1, -1);

  // Cash: the latest balance snapshot.
  const cashSorted = [...cash].sort((a, b) => a.date.localeCompare(b.date));
  const latestCash = cashSorted.at(-1) || null;
  const cashSar = latestCash ? latestCash.balance_sar : 0;

  // Revenue from the Sales module (USD plans → SAR).
  const paying = deals.filter((d) => d.stage === "paying");
  const mrrSar = paying.reduce((a, d) => a + planFor(d.skus).usd * SAR_PER_USD, 0);

  // Costs: recurring run-rate, and actual spend this month and last month by category.
  const recurring = expenses.filter((e) => e.recurring !== "one-off");
  const runRate = recurring.reduce((a, e) => a + monthlyOf(e), 0);
  const spentIn = (month) => expenses.filter((e) => ym(e.date) === month && e.recurring === "one-off").reduce((a, e) => a + e.amount_sar, 0);
  const monthBurn = runRate + spentIn(thisMonth);
  const byCategory = CATEGORIES.map((c) => {
    const rec = recurring.filter((e) => e.category === c.id).reduce((a, e) => a + monthlyOf(e), 0);
    const once = expenses.filter((e) => e.category === c.id && e.recurring === "one-off" && ym(e.date) === thisMonth).reduce((a, e) => a + e.amount_sar, 0);
    const budget = Number(s.budgets[c.id]) || 0;
    return { id: c.id, name: c.name, cogs: c.cogs, month: Math.round(rec + once), budget, over: budget > 0 && rec + once > budget };
  });

  const netBurn = Math.max(0, monthBurn - mrrSar);
  const runway = netBurn > 0 ? cashSar / netBurn : null; // null = not burning (profitable or no costs logged)
  const cogs = byCategory.filter((c) => c.cogs).reduce((a, c) => a + c.month, 0);
  const grossMargin = mrrSar > 0 ? (mrrSar - cogs) / mrrSar : null;

  // Planned human hires from HR add their salary midpoint from next month.
  const hires = roles.filter((r) => r.kind === "human" && ["open", "planned"].includes(r.status) && (r.salary_min || r.salary_max))
    .map((r) => ({ title: r.title, monthly: ((Number(r.salary_min) || Number(r.salary_max)) + (Number(r.salary_max) || Number(r.salary_min))) / 2 }));
  const hiresMonthly = s.include_hires ? hires.reduce((a, h) => a + h.monthly, 0) : 0;

  // 12-month cash forecast: pipeline deals close by stage, MRR grows by the set % per month.
  const stage = Object.fromEntries(STAGES.map((x) => [x.id, x]));
  const months = [];
  let bal = cashSar, mrr = mrrSar, zeroAt = null;
  for (let i = 1; i <= 12; i++) {
    const label = addMonths(now.getUTCFullYear(), now.getUTCMonth() + 1, i);
    const closing = deals.filter((d) => OPEN.includes(d.stage) && stage[d.stage].closesIn === i).reduce((a, d) => a + planFor(d.skus).usd * SAR_PER_USD * stage[d.stage].p, 0);
    mrr = mrr * (1 + (Number(s.mrr_growth_pct) || 0) / 100) + closing;
    const costs = runRate + hiresMonthly;
    bal = bal + mrr - costs;
    if (bal < 0 && !zeroAt) zeroAt = label;
    months.push({ month: label, revenue: Math.round(mrr), costs: Math.round(costs), balance: Math.round(bal) });
  }

  // Unit economics.
  const newPaying30 = paying.filter((d) => Date.parse(d.stage_changed_at || d.created_at) >= now.getTime() - 30 * 864e5).length;
  const mktSpend = byCategory.find((c) => c.id === "marketing").month;
  const arpaSar = paying.length ? mrrSar / paying.length : null;
  const cac = newPaying30 ? mktSpend / newPaying30 : null;
  const payback = cac && arpaSar && grossMargin > 0 ? cac / (arpaSar * grossMargin) : null;

  // VAT: quarter-to-date input VAT on expenses; output VAT on revenue if registered.
  const q = Math.floor(now.getUTCMonth() / 3);
  const qStart = `${now.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, "0")}`;
  const qExp = expenses.filter((e) => ym(e.date) >= qStart && ym(e.date) <= thisMonth);
  const inputVat = qExp.reduce((a, e) => a + (Number(e.vat_sar) || 0), 0);
  const qMonthsElapsed = now.getUTCMonth() - q * 3 + 1;
  const outputVat = s.vat_registered ? mrrSar * qMonthsElapsed * VAT_RATE : 0;
  const annualRevenue = mrrSar * 12;
  const qEnd = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0));
  const vatDue = new Date(Date.UTC(qEnd.getUTCFullYear(), qEnd.getUTCMonth() + 2, 0)); // end of the month after the quarter

  // What needs a person.
  const needs = [];
  if (!latestCash) needs.push({ text: "Add your current bank balance so runway can be calculated", tab: "overview" });
  else if (Date.parse(latestCash.date) < now.getTime() - 30 * 864e5) needs.push({ text: `Bank balance last updated ${latestCash.date}: add today's balance`, tab: "overview" });
  if (runway !== null && runway < 6) needs.push({ text: `Runway is ${runway.toFixed(1)} months: decide on cuts or fundraising`, tab: "overview" });
  if (zeroAt) needs.push({ text: `At the current plan, cash runs out in ${zeroAt}`, tab: "overview" });
  for (const c of byCategory.filter((x) => x.over)) needs.push({ text: `${c.name} is over budget this month (SAR ${c.month.toLocaleString("en-US")} of ${c.budget.toLocaleString("en-US")})`, tab: "expenses" });
  if (s.vat_registered) needs.push({ text: `File the Q${q + 1} VAT return with ZATCA by ${vatDue.toISOString().slice(0, 10)}`, tab: "reports", soft: true });
  else if (annualRevenue >= VAT_VOLUNTARY_SAR) needs.push({ text: `Revenue run-rate SAR ${Math.round(annualRevenue).toLocaleString("en-US")}/yr: check VAT registration with your accountant`, tab: "reports" });
  const unreviewed = expenses.filter((e) => e.source === "ai_import" && !e.reviewed).length;
  if (unreviewed) needs.push({ text: `${unreviewed} AI-imported expense${unreviewed === 1 ? "" : "s"} to review`, tab: "expenses" });

  return {
    settings: s, month: thisMonth, last_month: lastMonth,
    cash: { balance_sar: cashSar, as_of: latestCash?.date || null, history: cashSorted.slice(-12) },
    revenue: { mrr_sar: Math.round(mrrSar), mrr_usd: Math.round(mrrSar / SAR_PER_USD), paying: paying.length },
    costs: { run_rate_sar: Math.round(runRate), month_burn_sar: Math.round(monthBurn), net_burn_sar: Math.round(netBurn), by_category: byCategory, last_month_one_off_sar: Math.round(spentIn(lastMonth)) },
    runway_months: runway === null ? null : Math.round(runway * 10) / 10,
    gross_margin: grossMargin === null ? null : Math.round(grossMargin * 1000) / 10,
    hires: { list: hires, monthly_sar: Math.round(hires.reduce((a, h) => a + h.monthly, 0)), included: s.include_hires },
    forecast: { months, cash_zero_month: zeroAt },
    unit: { arpa_sar: arpaSar && Math.round(arpaSar), cac_sar: cac && Math.round(cac), payback_months: payback && Math.round(payback * 10) / 10, new_paying_30d: newPaying30 },
    vat: { registered: s.vat_registered, quarter: `Q${q + 1} ${now.getUTCFullYear()}`, input_vat_sar: Math.round(inputVat), output_vat_sar: Math.round(outputVat), net_sar: Math.round(outputVat - inputVat), due: vatDue.toISOString().slice(0, 10), annual_revenue_sar: Math.round(annualRevenue), mandatory_sar: VAT_MANDATORY_SAR, voluntary_sar: VAT_VOLUNTARY_SAR },
    needs,
  };
}

// ---- AI CFO: drafts only. People approve payments and file.
export const FIN_TASKS = {
  monthly_report: { title: "Monthly finance report", task: "Write this month's finance report for the founder: cash, burn, runway, revenue, budget vs actual, anything unusual, and the 3 most useful decisions to make now. Plain language, numbers in SAR." },
  cost_review: { title: "Cost-cutting review", task: "Review every recurring cost. For each: keep, cut, downgrade or replace with an AI agent, with the monthly SAR saving and the risk. End with a total possible saving and the order to do it in. Respect the AI-first principle: replace human or tool cost with AI only where quality holds." },
  investor_update: { title: "Investor update", task: "Draft a short monthly investor update: highlights, key numbers (MRR, paying stores, burn, runway), what we learned, what's next, and asks. Never invent numbers; use [ADD] where data is missing." },
};

export function financePrompt(ws, snap, expenses, task) {
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");
  const rec = expenses.filter((e) => e.recurring !== "one-off").map((e) => `- ${e.vendor} | ${e.category} | SAR ${e.amount_sar} ${e.recurring}`).join("\n") || "none logged";
  const recent = expenses.filter((e) => e.recurring === "one-off").slice(-25).map((e) => `- ${e.date} ${e.vendor} | ${e.category} | SAR ${e.amount_sar}`).join("\n") || "none logged";
  const numbers = {
    cash_sar: snap.cash.balance_sar, cash_as_of: snap.cash.as_of, mrr_sar: snap.revenue.mrr_sar, paying_stores: snap.revenue.paying,
    monthly_costs_sar: snap.costs.month_burn_sar, net_burn_sar: snap.costs.net_burn_sar, runway_months: snap.runway_months, gross_margin_pct: snap.gross_margin,
    budget_vs_actual: snap.costs.by_category.filter((c) => c.month || c.budget).map((c) => ({ category: c.name, spent: c.month, budget: c.budget })),
    planned_hires: snap.hires.list, forecast_cash_zero_month: snap.forecast.cash_zero_month, unit_economics: snap.unit, vat: snap.vat,
  };
  return [`<company>\n${brief}\n</company>`, `<finance_numbers>\n${JSON.stringify(numbers, null, 1)}\n</finance_numbers>`,
    `<recurring_costs>\n${rec}\n</recurring_costs>`, `<recent_one_off_costs>\n${recent}\n</recent_one_off_costs>`,
    `<task title="${FIN_TASKS[task].title}">\n${FIN_TASKS[task].task}\n</task>`,
    "You are DPA AD's AI CFO. Use only the numbers given; never invent figures. Tax and legal points are for the founder to confirm with a licensed accountant. Markdown, no preamble."].join("\n\n");
}

export function importPrompt(text) {
  return `Extract business expenses from these bank or card statement lines. Return ONLY a JSON array, no prose, each item:
{"date":"YYYY-MM-DD","vendor":"short name","amount_sar":number (positive, in SAR; convert USD at 3.75 and note it),"vat_sar":number (VAT included in the amount if shown, else 0),"category":"one of ${CAT_IDS.join("|")}","recurring":"monthly|yearly|one-off","note":"anything uncertain"}
Skip incoming payments, transfers between own accounts and refunds. If a line is unclear, still include it with category "other" and explain in note.

<statement>
${String(text).slice(0, 15000)}
</statement>`;
}

export function parseImport(text) {
  const raw = String(text || "");
  const start = raw.indexOf("["), end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let arr;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 200).map((x) => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(x?.date) ? x.date : new Date().toISOString().slice(0, 10),
    vendor: String(x?.vendor || "Unknown").slice(0, 120),
    amount_sar: Math.max(0, Math.round((Number(x?.amount_sar) || 0) * 100) / 100),
    vat_sar: Math.max(0, Math.round((Number(x?.vat_sar) || 0) * 100) / 100),
    category: CAT_IDS.includes(x?.category) ? x.category : "other",
    recurring: ["monthly", "yearly", "one-off"].includes(x?.recurring) ? x.recurring : "one-off",
    note: String(x?.note || "").slice(0, 300),
  })).filter((x) => x.amount_sar > 0);
}
