// Billing & customers: paying and trialling stores, subscriptions with proration and render overage,
// invoices (sequential, VAT, credit notes, ZATCA QR + XML), payments (manual, Moyasar card, app-store payouts),
// dunning, MRR movements and a rule-based customer health score.
// AI does every step it can (the billing run, reminders, reconciliation); people approve money decisions:
// voids, credit notes, plan changes and anything the AI Billing assistant drafts.
// Every tax rule is listed with its source in docs/billing-zatca.md: verify with your accountant.
import crypto from "node:crypto";
import { PLANS, SAR_PER_USD } from "./sales.js";
import { DEFAULT_PRICING, cleanPricing } from "./pricing.js";
import { VAT_RATE } from "./finance.js";
import { ONBOARDING_STEPS, inWindow, normDomain, normEmail, riyadhDay, splitCsv } from "./crm.js";
import { INITIAL_PIH, invoiceHash, qrBase64, ublXml } from "./zatca.js";

export const CUSTOMER_STATUS = [
  { id: "trial", name: "Trial", hint: "Free trial; first invoice when it ends" },
  { id: "active", name: "Active", hint: "Paying" },
  { id: "past_due", name: "Past due", hint: "An invoice is overdue; reminders are going out" },
  { id: "paused", name: "Paused", hint: "No invoices while paused" },
  { id: "cancelled", name: "Cancelled", hint: "No longer billed" },
];
export const STATUS_IDS = CUSTOMER_STATUS.map((s) => s.id);
export const CYCLES = ["monthly", "yearly"];
export const CURRENCIES = ["SAR", "USD"];
export const METHODS = [
  { id: "bank_transfer", name: "Bank transfer" }, { id: "card", name: "Card (Moyasar)" }, { id: "app_store", name: "Salla / Zid app-store payout" },
  { id: "cash", name: "Cash" }, { id: "other", name: "Other" },
];
export const METHOD_IDS = METHODS.map((m) => m.id);
export const LINE_KINDS = ["subscription", "proration", "overage", "setup", "other"];
export const ZATCA_STATUSES = [
  { id: "not_started", name: "Not started", hint: "No ZATCA onboarding yet. Phase 1 QR codes still print on every invoice." },
  { id: "csr", name: "CSR generated", hint: "Certificate signing request made for this dashboard (the EGS unit)." },
  { id: "compliance", name: "Compliance CSID", hint: "Compliance checks passing in ZATCA's sandbox or simulation." },
  { id: "production", name: "Production CSID", hint: "Production certificate issued; signing must be built before Live." },
];
export const DEFAULT_SETTINGS = {
  legal_name: "", legal_name_ar: "", vat_number: "", cr_number: "",
  address: { street: "", building: "", district: "", city: "Riyadh", postal_code: "", country: "SA" },
  bank_details: "", invoice_prefix: "INV-", credit_prefix: "CN-", next_invoice_no: 1, next_credit_no: 1, icv: 0, last_hash: "",
  terms_days: 7, mode: "test", auto_issue: true, dunning_days: [1, 3, 7], pause_after_days: 14,
  zatca_mode: "test", zatca_status: "not_started",
};
export const COLLECTIONS = ["billing_customers", "billing_invoices", "billing_payments", "billing_usage", "billing_log", "billing_drafts"];

// ---- money and dates
export const r2 = (n) => Math.round((Number(n) || 0) * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
export const toSar = (amount, currency) => r2(currency === "USD" ? amount * SAR_PER_USD : amount);
const DAY = 864e5;
const dnum = (d) => Math.round(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / DAY);
export const daysBetween = (a, b) => dnum(b) - dnum(a);
export const addDays = (d, n) => new Date((dnum(d) + n) * DAY).toISOString().slice(0, 10);
export function addMonths(d, n, anchor = null) {
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(anchor || day, last));
  return t.toISOString().slice(0, 10);
}
export const periodEnd = (start, cycle, anchor) => addMonths(start, cycle === "yearly" ? 12 : 1, anchor);
const ym = (d) => String(d).slice(0, 7);
const prevMonth = (m) => addMonths(m + "-01", -1).slice(0, 7);
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

// ---- plans (prices come from PLANS in sales.js; yearly = 10 × monthly)
export const planDef = (name) => PLANS.find((p) => p.name === name) || null;
export function monthlyUsd(c) {
  const p = planDef(c.plan);
  if (!p) return 0;
  if (p.name === "Enterprise" && Number(c.custom_price_usd) >= p.usd) return Number(c.custom_price_usd); // Enterprise is "from" its list price
  return p.usd;
}
export const periodPriceUsd = (c) => monthlyUsd(c) * (c.cycle === "yearly" ? 10 : 1);
export const periodPrice = (c) => r2(c.currency === "USD" ? periodPriceUsd(c) : periodPriceUsd(c) * SAR_PER_USD);
export const PAYING = ["active", "past_due"];
// MRR in SAR, without VAT: yearly plans count a twelfth of the yearly price. Trials, paused and cancelled count 0.
export const mrrSar = (c) => (PAYING.includes(c.status) ? r2(periodPriceUsd(c) * SAR_PER_USD / (c.cycle === "yearly" ? 12 : 1)) : 0);
export function planTable() {
  return PLANS.map((p) => ({ name: p.name, max_skus: Number.isFinite(p.max) ? p.max : null, monthly_usd: p.usd, yearly_usd: p.usd * 10,
    monthly_sar: r2(p.usd * SAR_PER_USD), yearly_sar: r2(p.usd * 10 * SAR_PER_USD), from: p.name === "Enterprise" }));
}

// ---- proration: credit the unused part of the old plan, charge the new plan for the remaining days
export function proration(c, newPlan, today, customPriceUsd = null) {
  const total = Math.max(1, daysBetween(c.period_start, c.period_end));
  const remaining = Math.max(0, Math.min(total, daysBetween(today, c.period_end)));
  const old = periodPrice(c), neu = periodPrice({ ...c, plan: newPlan, custom_price_usd: customPriceUsd ?? c.custom_price_usd });
  if (c.status === "trial") return { from: c.plan, to: newPlan, direction: "trial", total_days: total, remaining_days: remaining, old_price: old, new_price: neu, credit: 0, charge: 0, net: 0, currency: c.currency,
    explain: "During the trial the plan changes with no charge. The first invoice uses the new plan." };
  const credit = r2((old * remaining) / total), charge = r2((neu * remaining) / total), net = r2(charge - credit);
  const direction = net > 0 ? "upgrade" : net < 0 ? "downgrade" : "same";
  return { from: c.plan, to: newPlan, direction, period_start: c.period_start, period_end: c.period_end, total_days: total, remaining_days: remaining,
    old_price: old, new_price: neu, credit, charge, net, currency: c.currency,
    explain: `${remaining} of ${total} days left in this ${c.cycle} period. Unused ${c.plan}: ${c.currency} ${credit.toFixed(2)} credit. ${newPlan} for the rest: ${c.currency} ${charge.toFixed(2)}. ` +
      (direction === "upgrade" ? `Charged now: ${c.currency} ${net.toFixed(2)} + VAT on a proration invoice.` : direction === "downgrade" ? `${c.currency} ${(-net).toFixed(2)} goes to the store's account credit and comes off the next invoice.` : "Nothing to charge or credit.") };
}

// ---- render overage (limits from Finance → Pricing; defaults: Scale 15,000/month then $10 per extra 1,000,
// Enterprise 50,000/month then $8 per extra 1,000). Billed per started 1,000 renders, in arrears.
export function overage(planName, renders, pricing = DEFAULT_PRICING) {
  const p = (pricing.plans || []).find((x) => x.name === planName) || {};
  const limit = Number(p.render_limit) || 0, rate = Number(p.overage_per_1k) || 0;
  const extra = limit > 0 ? Math.max(0, (Number(renders) || 0) - limit) : 0;
  const blocks = rate > 0 ? Math.ceil(extra / 1000) : 0;
  return { limit, rate_usd: rate, renders: Number(renders) || 0, extra, blocks, amount_usd: r2(blocks * rate), hard_stop: extra > 0 && !rate };
}

// ---- invoice totals: line net = qty × price − line discount; VAT on the taxable total after the document discount
export function invoiceTotals(lines, discount = 0, vatRate = 0) {
  const out = lines.map((l) => ({ ...l, qty: Number(l.qty) || 1, unit_price: r2(l.unit_price), discount: r2(l.discount || 0), net: r2((Number(l.qty) || 1) * r2(l.unit_price) - r2(l.discount || 0)) }));
  const subtotal = r2(out.reduce((a, l) => a + l.net, 0));
  const disc = Math.min(r2(discount), subtotal);
  const taxable = r2(subtotal - disc), vat = r2(taxable * vatRate);
  return { lines: out, totals: { subtotal, discount: disc, taxable, vat, total: r2(taxable + vat) } };
}
const sarTotals = (t, cur) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, toSar(v, cur)]));
export const amountDue = (inv) => r2(inv.totals.total - (inv.paid_amount || 0) - (inv.credited_total || 0));
export const formatNumber = (prefix, n) => `${prefix}${String(n).padStart(6, "0")}`;

// ---- dunning: reminders on day 1, 3 and 7 after the due date (or a failed card payment), pause after N days
export function dunningState(inv, today, s = DEFAULT_SETTINGS) {
  const from = inv.dunning_from && inv.dunning_from < inv.due_date ? inv.dunning_from : inv.due_date;
  const overdue = inv.status === "issued" && amountDue(inv) > 0.005 ? daysBetween(from, today) : -1;
  const sent = new Set((inv.reminders || []).map((r) => r.step));
  const steps = [...(s.dunning_days || [1, 3, 7])].sort((a, b) => a - b);
  const dueSteps = steps.filter((d) => overdue >= d && !sent.has(d));
  const next = steps.find((d) => !sent.has(d) && d > overdue);
  return { from, days_overdue: Math.max(0, overdue), overdue: overdue >= 1, step: dueSteps.at(-1) ?? null, skipped: dueSteps.slice(0, -1),
    next_step: next ?? null, next_date: next != null ? addDays(from, next) : null, pause_on: addDays(from, s.pause_after_days || 14), should_pause: overdue >= (s.pause_after_days || 14) };
}
export function reminderText(step, { inv, c, company, link, pauseAfter }) {
  const amt = `${inv.currency} ${amountDue(inv).toFixed(2)}`, name = c.owner_name || c.store_name;
  const pay = link ? `\nرابط الدفع / Pay here: ${link}` : "";
  const ar = step >= 7
    ? `مرحباً ${name}،\nالفاتورة ${inv.number} بمبلغ ${amt} متأخرة ${step} أيام. حتى لا يتوقف حسابكم في ${company} بعد ${pauseAfter} يوم من الاستحقاق، نرجو السداد أو التواصل معنا إذا فيه أي مشكلة.`
    : step >= 3
      ? `مرحباً ${name}،\nتذكير ثاني: الفاتورة ${inv.number} بمبلغ ${amt} استحقت في ${inv.due_date}. إذا تم الدفع تجاهلوا الرسالة، وإذا تحتاجون مساعدة ردّوا علينا.`
      : `مرحباً ${name}،\nنذكّركم بلطف أن الفاتورة ${inv.number} بمبلغ ${amt} استحقت في ${inv.due_date}.`;
  const en = step >= 7
    ? `Hi ${name},\nInvoice ${inv.number} for ${amt} is ${step} days overdue. To keep your ${company} account running (it pauses ${pauseAfter} days after the due date), please pay or reply if something is wrong.`
    : step >= 3
      ? `Hi ${name},\nA second reminder: invoice ${inv.number} for ${amt} was due on ${inv.due_date}. If you've paid, please ignore this. Reply if you need help.`
      : `Hi ${name},\nA friendly reminder that invoice ${inv.number} for ${amt} was due on ${inv.due_date}.`;
  return { subject: `${step >= 7 ? "تنبيه أخير · Final reminder" : "تذكير بالدفع · Payment reminder"}: ${inv.number}`, text: `${ar}${pay}\n\n${en}${link ? `\nPay here: ${link}` : ""}\n\n${company}` };
}

// ---- health score (0–100, rule-based, every point explained)
export function healthScore({ c, invoices = [], payments = [], tickets = [], onboarding = null, usage = [], lastActivity = null, today, pricing = DEFAULT_PRICING }) {
  const f = [];
  const open = invoices.filter((i) => i.kind === "invoice" && i.status === "issued" && amountDue(i) > 0.005);
  const worst = open.reduce((a, i) => Math.max(a, daysBetween(i.dunning_from && i.dunning_from < i.due_date ? i.dunning_from : i.due_date, today)), -1);
  const failed = payments.filter((p) => p.status === "failed" && daysBetween(p.date, today) <= 30).length;
  let pay = worst <= 0 ? 30 : worst <= 7 ? 15 : 0;
  if (failed) pay = Math.max(0, pay - 10);
  f.push({ id: "payment", name: "Payment status", points: pay, max: 30, why: worst <= 0 ? (failed ? `Nothing overdue, but ${failed} failed card payment${failed === 1 ? "" : "s"} in 30 days` : "Nothing overdue") : `An invoice is ${worst} day${worst === 1 ? "" : "s"} overdue${failed ? `; ${failed} failed card payment${failed === 1 ? "" : "s"}` : ""}` });
  const month = ym(today), u = usage.find((x) => x.month === month), ov = overage(c.plan, u?.renders || 0, pricing);
  let use, why;
  if (!usage.length) { use = 10; why = "No usage reported yet (enter renders, or the product posts them to the usage API)"; }
  else if (!u || !u.renders) { use = 0; why = "No renders this month"; }
  else if (ov.limit) { const pct = Math.round((u.renders / ov.limit) * 100); use = pct >= 20 ? 25 : 15; why = `${u.renders.toLocaleString("en-US")} renders this month: ${pct}% of the ${ov.limit.toLocaleString("en-US")} included`; }
  else { use = 25; why = `${u.renders.toLocaleString("en-US")} renders this month`; }
  f.push({ id: "usage", name: "Usage vs plan", points: use, max: 25, why });
  const openT = tickets.filter((t) => !["resolved", "solved", "closed"].includes(t.status)); // support uses "resolved"
  const tp = openT.length === 0 ? 15 : openT.length === 1 ? 10 : 0;
  f.push({ id: "tickets", name: "Open support tickets", points: tp, max: 15, why: openT.length ? `${openT.length} open ticket${openT.length === 1 ? "" : "s"}` : "No open tickets" });
  const done = onboarding ? ONBOARDING_STEPS.filter((s) => onboarding[s.id]).length : 0;
  const op = onboarding ? Math.round((15 * done) / ONBOARDING_STEPS.length) : 5;
  f.push({ id: "onboarding", name: "Onboarding progress", points: op, max: 15, why: onboarding ? `${done} of ${ONBOARDING_STEPS.length} onboarding steps done` : "Not linked to a CRM store, so onboarding can't be tracked" });
  const quiet = lastActivity ? daysBetween(lastActivity, today) : null;
  const ap = quiet === null ? 0 : quiet <= 7 ? 15 : quiet <= 30 ? 8 : 0;
  f.push({ id: "activity", name: "Days since last activity", points: ap, max: 15, why: quiet === null ? "No activity recorded" : `Last activity ${quiet} day${quiet === 1 ? "" : "s"} ago (usage, payment, support or a reply)` });
  const score = f.reduce((a, x) => a + x.points, 0);
  return { score, label: score >= 75 ? "healthy" : score >= 50 ? "watch" : "at_risk", factors: f };
}

// ---- MRR movements from each customer's event log (every event records the MRR after it)
export function mrrAt(c, date) {
  let v = 0;
  for (const e of c.events || []) if (e.mrr_sar !== undefined && e.date < date) v = e.mrr_sar;
  return v;
}
export function mrrMetrics(customers, today, months = 12) {
  const cur = ym(today), list = [];
  let m = cur;
  for (let i = 0; i < months - 1; i++) m = prevMonth(m);
  for (let i = 0; i < months; i++) {
    const start = m + "-01", next = addMonths(start, 1);
    const row = { month: m, start: 0, new: 0, expansion: 0, contraction: 0, churned: 0, reactivation: 0, end: 0, logos_start: 0, logos_churned: 0, logos_new: 0 };
    for (const c of customers) {
      const a = mrrAt(c, start), b = mrrAt(c, next);
      row.start += a; row.end += b;
      if (a > 0) row.logos_start++;
      if (a === 0 && b > 0) { if ((c.events || []).some((e) => e.date < start && e.mrr_sar > 0)) row.reactivation += b; else { row.new += b; row.logos_new++; } }
      else if (a > 0 && b === 0) { row.churned += a; row.logos_churned++; }
      else if (b > a) row.expansion += b - a;
      else if (b < a) row.contraction += a - b;
    }
    for (const k of ["start", "new", "expansion", "contraction", "churned", "reactivation", "end"]) row[k] = r2(row[k]);
    row.nrr_pct = row.start ? Math.round(((row.start + row.expansion - row.contraction - row.churned) / row.start) * 1000) / 10 : null;
    row.logo_churn_pct = row.logos_start ? Math.round((row.logos_churned / row.logos_start) * 1000) / 10 : null;
    list.push(row);
    m = ym(next);
  }
  // Trailing 12-month NRR: stores paying 12 months ago, their MRR now vs then.
  const then = addMonths(cur + "-01", -11), now = addMonths(cur + "-01", 1);
  const cohort = customers.filter((c) => mrrAt(c, then) > 0);
  const base = cohort.reduce((a, c) => a + mrrAt(c, then), 0);
  const nrr12 = base ? Math.round((cohort.reduce((a, c) => a + mrrAt(c, now), 0) / base) * 1000) / 10 : null;
  const mrr = r2(customers.reduce((a, c) => a + mrrSar(c), 0));
  return { mrr_sar: mrr, arr_sar: r2(mrr * 12), mrr_usd: r2(mrr / SAR_PER_USD), months: list, this_month: list.at(-1), nrr_12m_pct: nrr12,
    paying: customers.filter((c) => PAYING.includes(c.status)).length, trials: customers.filter((c) => c.status === "trial").length };
}

// ---- app-store payouts (Salla / Zid): CSV in, rows matched to customers and open invoices
const PAYOUT_FIELDS = {
  date: /^(date|payout date|paid at|transaction date|تاريخ|التاريخ|تاريخ التحويل)$/i,
  store: /^(store|store name|merchant|merchant name|shop|اسم المتجر|المتجر|التاجر)$/i,
  domain: /^(domain|store url|url|link|website|رابط المتجر|الرابط|الدومين)$/i,
  gross: /^(amount|gross|gross amount|total|subscription amount|المبلغ|الإجمالي|المبلغ الإجمالي)$/i,
  fee: /^(fee|fees|commission|platform fee|العمولة|عمولة|الرسوم)$/i,
  net: /^(net|net amount|payout|الصافي|صافي المبلغ)$/i,
  reference: /^(reference|ref|payout id|transaction id|id|order id|رقم العملية|المرجع|رقم)$/i,
  store_id: /^(store id|merchant id|app store id|رقم المتجر)$/i,
};
const numOf = (v) => { const n = Number(String(v ?? "").replace(/[٬,\s]/g, "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
export function parsePayouts(text, platform = "Salla") {
  const rows = splitCsv(text);
  if (rows.length < 2) return { rows: [], error: "Paste the CSV with a header row." };
  const head = rows[0].map((h) => h.trim()), idx = {};
  for (const [k, re] of Object.entries(PAYOUT_FIELDS)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) idx[k] = i; }
  if (idx.gross === undefined && idx.net === undefined) return { rows: [], error: "No amount column found (amount, gross, net, المبلغ…)." };
  if (idx.store === undefined && idx.domain === undefined && idx.store_id === undefined) return { rows: [], error: "No store column found (store, merchant, domain, اسم المتجر…)." };
  const out = rows.slice(1, 5001).map((r, n) => {
    const get = (k) => (idx[k] === undefined ? "" : String(r[idx[k]] ?? "").trim());
    const gross = r2(numOf(get("gross"))), fee = r2(Math.abs(numOf(get("fee")))), net = idx.net !== undefined ? r2(numOf(get("net"))) : r2(gross - fee);
    const d = get("date"), date = isoDate(d.slice(0, 10)) ? d.slice(0, 10) : null;
    return { row: n + 2, platform, date, store: get("store").slice(0, 120), domain: normDomain(get("domain")), store_id: get("store_id").slice(0, 60), reference: get("reference").slice(0, 80),
      gross: gross || r2(net + fee), fee, net };
  }).filter((x) => x.gross > 0 || x.net > 0);
  return { rows: out, columns: Object.keys(idx) };
}
const normName = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export function reconcilePayouts(rows, customers, invoices) {
  return rows.map((r) => {
    const c = customers.find((x) => (r.store_id && x.app_store_id && x.app_store_id === r.store_id) || (r.domain && x.domain && normDomain(x.domain) === r.domain))
      || (r.store ? customers.find((x) => normName(x.store_name) === normName(r.store)) : null);
    if (!c) return { ...r, match: "none", note: "No customer matches this store: add it as a customer, or set its domain" };
    const open = invoices.filter((i) => i.customer_id === c.id && i.kind === "invoice" && i.status === "issued" && amountDue(i) > 0.005)
      .sort((a, b) => a.issue_date.localeCompare(b.issue_date));
    const inv = open.find((i) => Math.abs(toSar(amountDue(i), i.currency) - r.gross) <= 1) || open.find((i) => Math.abs(toSar(amountDue(i), i.currency) - r.net) <= 1);
    if (inv) return { ...r, match: "invoice", customer_id: c.id, customer: c.store_name, invoice_id: inv.id, invoice: inv.number, note: `Pays ${inv.number}` };
    return { ...r, match: "customer", customer_id: c.id, customer: c.store_name, note: open.length ? `Amount doesn't match ${open.length} open invoice${open.length === 1 ? "" : "s"}: check by hand` : "No open invoice for this store" };
  });
}

// ---- AI Billing assistant prompts (drafts only; a person approves)
export function dunningPrompt(ws, c, inv, state, history) {
  return `<company>${ws.brief.company_name}</company>
<customer>store: ${c.store_name}; owner: ${c.owner_name || "unknown"}; plan: ${c.plan} (${c.cycle}); status: ${c.status}; platform: ${c.platform || "unknown"}</customer>
<invoice>number: ${inv.number}; amount due: ${inv.currency} ${amountDue(inv).toFixed(2)}; issued ${inv.issue_date}; due ${inv.due_date}; days overdue: ${state.days_overdue}; reminders already sent: ${(inv.reminders || []).map((r) => `day ${r.step}`).join(", ") || "none"}; account pauses on ${state.pause_on}</invoice>
<recent_history>\n${history || "none"}\n</recent_history>
Write the next payment reminder email for this store. First a subject line starting "Subject:", then the email in Saudi Arabic (polite, warm, short), then the same in English under "### English". Mention the invoice number, amount and due date exactly as given; never invent numbers, discounts or deadlines that aren't given. Offer help if something is wrong. A person reviews and sends it.`;
}
export function explainPrompt(ws, c, inv) {
  const lines = inv.lines.map((l) => `- ${l.description}: ${l.qty} × ${inv.currency} ${l.unit_price.toFixed(2)}${l.discount ? ` − ${l.discount.toFixed(2)} discount` : ""} = ${l.net.toFixed(2)}`).join("\n");
  return `<company>${ws.brief.company_name}</company>
<customer>${c.store_name}, plan ${c.plan} (${c.cycle})</customer>
<invoice>${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.number || "(draft)"}; issued ${inv.issue_date || "not yet"}; due ${inv.due_date || "-"}; currency ${inv.currency}
${lines}
subtotal ${inv.totals.subtotal.toFixed(2)}; discount ${inv.totals.discount.toFixed(2)}${inv.discount_reason ? ` (${inv.discount_reason})` : ""}; VAT ${Math.round(inv.vat_rate * 100)}% ${inv.totals.vat.toFixed(2)}; total ${inv.totals.total.toFixed(2)}; paid ${(inv.paid_amount || 0).toFixed(2)}; credited ${(inv.credited_total || 0).toFixed(2)}</invoice>
Explain this invoice to the store owner in plain words: what each line is for (subscription period, proration after a plan change, extra renders over the plan limit, setup), how VAT was worked out, and what they owe now. Saudi Arabic first, then English under "### English". Use only the numbers given. A person reviews it before it is sent.`;
}

// ================================================================= engine (stateful)
export function ensureCollections(store) {
  let changed = false;
  for (const k of COLLECTIONS) if (!Array.isArray(store.db[k])) { store.db[k] = []; changed = true; }
  return changed;
}
export const billingSettings = (w) => ({ ...DEFAULT_SETTINGS, ...(w?.billing || {}), address: { ...DEFAULT_SETTINGS.address, ...(w?.billing?.address || {}) } });
const pricingOf = (w) => cleanPricing(w?.finance?.pricing || {}, DEFAULT_PRICING);

// What Finance and the Command Center read: billed MRR from subscriptions and output VAT from invoices.
export function billingForFinance(store, wsId, now = new Date()) {
  if (!Array.isArray(store.db.billing_customers)) return null;
  const cs = store.db.billing_customers.filter((c) => c.workspace_id === String(wsId) && !c.archived);
  if (!cs.length) return null;
  const q = Math.floor(now.getUTCMonth() / 3), qStart = `${now.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01`, today = riyadhDay(now);
  const docs = (store.db.billing_invoices || []).filter((i) => i.workspace_id === String(wsId) && i.number && i.issue_date >= qStart && i.issue_date <= today);
  // Output VAT is due when the invoice is issued (tax point), not when it's paid. Credit notes reduce it.
  const outputVat = docs.reduce((a, i) => a + (i.kind === "credit_note" ? -1 : 1) * (i.totals_sar?.vat || 0), 0);
  return { customers: cs.filter((c) => PAYING.includes(c.status)).length, mrr_sar: r2(cs.reduce((a, c) => a + mrrSar(c), 0)), output_vat_sar: r2(outputVat), invoices_quarter: docs.length };
}

export function createBilling({ store, crm = null, senders = null, emailReady = () => false, gateway, zatca, log = console, now: clock = () => new Date() }) {
  ensureCollections(store);
  const C = "billing_customers", I = "billing_invoices", P = "billing_payments", U = "billing_usage", L = "billing_log", D = "billing_drafts";
  const list = (coll, wsId) => store.listOps(coll, wsId);
  const settings = (w) => billingSettings(w);
  const setSettings = (w, f) => { w.billing = { ...settings(w), ...f, address: { ...settings(w).address, ...(f.address || {}) } }; store.save(); return settings(w); };
  const vatRate = (w) => (w.finance?.vat_registered ? VAT_RATE : 0);
  const company = (w) => settings(w).legal_name || w.brief.company_name || "DPA AD";
  // Coupons (Partners & referrals) plug in here: hooks.discount(w, c, inv, kind) returns { amount, reason, meta } for a
  // subscription or proration invoice, or null. Overage, setup and hand-made invoices are never discounted by a coupon.
  const hooks = { discount: null };
  const addLog = (w, entry) => {
    const e = store.addOps(L, w.id, { at: new Date().toISOString(), ...entry }, false);
    const all = store.db[L]; if (all.length > 20000) all.splice(0, all.length - 20000);
    return e;
  };

  // ---- customers
  const customers = (wsId) => list(C, wsId).filter((c) => !c.archived);
  const getCustomer = (wsId, id) => { const c = store.getOps(C, wsId, id); return c && !c.archived ? c : null; };
  function event(c, type, note = "", by = "system", date = null) {
    c.events ||= [];
    c.events.push({ at: new Date().toISOString(), date: date || riyadhDay(clock()), type, note: String(note).slice(0, 300), by, mrr_sar: mrrSar(c), plan: c.plan, status: c.status });
  }
  function addCustomer(w, f, by = "you") {
    const today = riyadhDay(clock());
    const start = isoDate(f.start_date) ? f.start_date : today;
    const trial = f.status === "trial";
    const trialEnd = trial ? (isoDate(f.trial_end) ? f.trial_end : addDays(start, 14)) : null;
    const cycle = f.cycle || "monthly", anchor = Number((trial ? trialEnd : start).slice(8, 10));
    // A store that started in the past is billed from the period that contains today, not for history.
    let ps = start, pe = trial ? trialEnd : periodEnd(start, cycle, anchor);
    if (!trial) for (let g = 0; pe <= today && g < 600; g++) { ps = pe; pe = periodEnd(ps, cycle, anchor); }
    const { already_billed, ...rest } = f;
    const c = store.addOps(C, w.id, {
      store_name: "", domain: "", platform: "Salla", owner_name: "", owner_email: "", owner_phone: "", plan: "Starter", cycle: "monthly", currency: "SAR", custom_price_usd: null,
      vat_number: "", legal_name: "", billing_address: { street: "", building: "", district: "", city: "", postal_code: "", country: "SA" }, app_store_id: "",
      crm_contact_id: null, deal_id: null, cancel_at_period_end: false, paused_reason: null, credit_balance: 0, overage_billed: [], notes: [], events: [],
      ...rest, cycle, start_date: start, trial_end: trialEnd, status: f.status || "active", anchor_day: anchor,
      period_start: ps, period_end: pe, first_invoiced: !!already_billed,
    }, false);
    event(c, f.status === "trial" ? "trial_start" : "start", f.status === "trial" ? `Trial until ${trialEnd}` : `${c.plan} ${c.cycle}`, by, start);
    store.save();
    return c;
  }
  const updateCustomer = (w, c, f) => { Object.assign(c, f, { updated_at: new Date().toISOString() }); store.save(); return c; };

  // ---- documents
  const invoices = (wsId) => list(I, wsId).sort((a, b) => (b.issue_date || b.created_at).localeCompare(a.issue_date || a.created_at) || Number(b.id) - Number(a.id));
  const getInvoice = (wsId, id) => store.getOps(I, wsId, id);
  const sellerOf = (w) => { const s = settings(w); return { name: company(w), name_ar: s.legal_name_ar, vat_number: s.vat_number, cr_number: s.cr_number, address: s.address, bank_details: s.bank_details }; };
  const buyerOf = (c) => ({ name: c.legal_name || c.store_name, store_name: c.store_name, vat_number: c.vat_number || "", address: c.billing_address || {}, email: c.owner_email, domain: c.domain });
  function draft(w, c, { lines, discount = 0, discount_reason = "", period_key = null, period_start = null, period_end = null, note = "", kind = "invoice", due_days = null, by = "you", supply_date = null }) {
    const rate = vatRate(w);
    const { lines: ls, totals } = invoiceTotals(lines, discount, rate);
    const inv = store.addOps(I, w.id, {
      kind, customer_id: c.id, status: "draft", number: null, currency: c.currency, lines: ls, discount: totals.discount, discount_reason, vat_rate: rate, totals, totals_sar: sarTotals(totals, c.currency),
      period_key, period_start, period_end, supply_date, note, due_days: due_days ?? settings(w).terms_days, paid_amount: 0, credited_total: 0, reminders: [], created_by: by,
    }, false);
    store.save();
    return inv;
  }
  function recalc(w, inv) {
    const { lines, totals } = invoiceTotals(inv.lines, inv.discount, inv.vat_rate);
    inv.lines = lines; inv.totals = totals; inv.totals_sar = sarTotals(totals, inv.currency);
  }
  // Account credit (from downgrades) comes off the next invoice as a document discount.
  function applyCredit(c, inv) {
    if (!(c.credit_balance > 0) || inv.kind !== "invoice") return;
    const room = r2(inv.totals.subtotal - inv.discount), use = r2(Math.min(room, c.credit_balance));
    if (use <= 0) return;
    inv.discount = r2(inv.discount + use); inv.discount_reason = [inv.discount_reason, `Account credit ${inv.currency} ${use.toFixed(2)}`].filter(Boolean).join("; ");
    c.credit_balance = r2(c.credit_balance - use);
  }

  function applyCoupon(w, c, inv, kind) {
    if (!hooks.discount || inv.kind !== "invoice") return;
    let d = null;
    try { d = hooks.discount(w, c, inv, kind); } catch (e) { log.error?.("[billing] coupon:", e?.message || e); }
    if (!d || !(d.amount > 0)) return;
    inv.discount = r2((inv.discount || 0) + d.amount);
    inv.discount_reason = [d.reason, inv.discount_reason].filter(Boolean).join("; ");
    inv.coupon = d.meta;
    recalc(w, inv); store.save();
  }

  async function issue(w, inv, { by = "you" } = {}) {
    if (inv.status !== "draft") throw Object.assign(new Error("Only drafts can be issued"), { status: 409 });
    if (!inv.lines.length) throw Object.assign(new Error("Add at least one line"), { status: 422 });
    const s = settings(w), c = getCustomer(w.id, inv.customer_id) || store.getOps(C, w.id, inv.customer_id);
    inv.vat_rate = inv.kind === "credit_note" ? inv.vat_rate : vatRate(w);
    if (inv.kind === "invoice") applyCredit(c, inv);
    recalc(w, inv);
    // A 100% coupon may bring an invoice to 0: it is still issued (numbered, in the ZATCA chain) and is paid at once.
    if (inv.kind === "invoice" && !(inv.totals.total > 0) && !(inv.coupon && inv.totals.total === 0)) throw Object.assign(new Error("The invoice total must be more than 0"), { status: 422 });
    if (inv.vat_rate > 0 && !/^3\d{13}3$/.test(s.vat_number)) throw Object.assign(new Error("Add DPA AD's 15-digit VAT number (starts and ends with 3) in Billing → Settings before issuing tax invoices"), { status: 422 });
    const now = clock(), today = riyadhDay(now);
    const isCredit = inv.kind === "credit_note";
    const n = isCredit ? s.next_credit_no : s.next_invoice_no;
    // Sample customers get SAMPLE- numbers outside the real sequence and never touch the ZATCA counter or hash chain.
    const sample = !!c?.sample;
    inv.number = sample ? `SAMPLE-${isCredit ? "CN-" : ""}${String(inv.id).padStart(6, "0")}` : formatNumber(isCredit ? s.credit_prefix : s.invoice_prefix, n);
    if (sample) inv.sample = true;
    inv.issue_date = today; inv.issued_at = now.toISOString(); inv.supply_date ||= inv.period_start || today;
    inv.due_date = isCredit ? today : addDays(today, inv.due_days ?? s.terms_days);
    inv.status = "issued"; inv.issued_by = by;
    inv.seller = sellerOf(w); inv.buyer = buyerOf(c);
    const warnings = [];
    const f = isCredit ? { next_credit_no: n + 1 } : { next_invoice_no: n + 1 };
    if (sample) { /* no counters, no ZATCA chain */ } else if (inv.vat_rate > 0) {
      // ZATCA: standard (B2B) when the buyer has a VAT number, simplified (B2C) otherwise.
      inv.zatca_type = c.vat_number ? "standard" : "simplified";
      if (inv.zatca_type === "standard" && !(c.billing_address?.street && c.billing_address?.city)) warnings.push("Standard (B2B) invoices need the buyer's full address for ZATCA clearance");
      const uuid = crypto.randomUUID(), icv = (s.icv || 0) + 1, pih = s.last_hash || INITIAL_PIH;
      const qr = qrBase64({ seller: inv.seller.name, vat_number: s.vat_number, timestamp: inv.issued_at.slice(0, 19) + "Z", total: inv.totals_sar.total, vat: inv.totals_sar.vat });
      const xml = ublXml(inv, { seller: inv.seller, buyer: inv.buyer, uuid, icv, pih, qr });
      const hash = invoiceHash(xml);
      inv.zatca = { uuid, icv, pih, hash, qr, submission: null };
      Object.assign(f, { icv, last_hash: hash });
      setSettings(w, f);
      try {
        const sub = await zatca.submit(inv, { mode: s.zatca_mode, xml, hash, uuid });
        inv.zatca.submission = { ...sub, at: new Date().toISOString() };
        addLog(w, { kind: "zatca", status: sub.status, invoice_id: inv.id, customer_id: c.id, text: `${inv.number}: ${sub.note}` });
      } catch (e) { inv.zatca.submission = { status: "error", note: String(e.message).slice(0, 200) }; addLog(w, { kind: "zatca", status: "failed", invoice_id: inv.id, text: `${inv.number}: ${e.message}` }); }
    } else setSettings(w, f);
    if (!isCredit && amountDue(inv) <= 0.005) { inv.status = "paid"; inv.paid_at = now.toISOString(); }
    else if (!isCredit) await paymentLink(w, inv, c);
    addLog(w, { kind: "invoice", status: "issued", invoice_id: inv.id, customer_id: c.id, text: `${inv.number} issued: ${inv.currency} ${inv.totals.total.toFixed(2)}${inv.vat_rate ? ` incl. VAT ${inv.totals.vat.toFixed(2)}` : ""}` });
    if (!isCredit) await email(w, c, { subject: `فاتورة ${inv.number} · Invoice ${inv.number}`, text: `مرحباً ${c.owner_name || c.store_name}،\nفاتورتكم ${inv.number} بمبلغ ${inv.currency} ${inv.totals.total.toFixed(2)} تستحق في ${inv.due_date}.${inv.payment_link?.url ? `\nرابط الدفع: ${inv.payment_link.url}` : ""}\n\nHi ${c.owner_name || c.store_name},\nYour invoice ${inv.number} for ${inv.currency} ${inv.totals.total.toFixed(2)} is due on ${inv.due_date}.${inv.payment_link?.url ? `\nPay here: ${inv.payment_link.url}` : ""}\n\n${company(w)}` }, { kind: "invoice_email", invoice_id: inv.id });
    store.save();
    return { invoice: inv, warnings };
  }
  async function paymentLink(w, inv, c) {
    const s = settings(w);
    if (s.mode !== "live" || c.sample) {
      inv.payment_link = { provider: "moyasar", mode: "test", id: `test_${inv.id}`, url: "", status: "test" };
      addLog(w, { kind: "gateway", status: "test", invoice_id: inv.id, customer_id: c.id, text: `${inv.number}: ${c.sample ? "sample store, never charged" : "Test mode"}: no Moyasar payment link created` });
      return;
    }
    if (!gateway.cfg.ready) { inv.payment_link = null; addLog(w, { kind: "gateway", status: "skipped", invoice_id: inv.id, text: `${inv.number}: MOYASAR_SECRET_KEY isn't set: no card payment link` }); return; }
    try {
      const r = await gateway.createInvoice({ amount: amountDue(inv), currency: inv.currency, description: `${company(w)} ${inv.number}`, metadata: { invoice_id: inv.id, workspace_id: w.id }, expired_at: new Date(Date.parse(inv.due_date) + 30 * DAY).toISOString() });
      inv.payment_link = { provider: "moyasar", mode: "live", id: String(r.id || ""), url: String(r.url || ""), status: String(r.status || "initiated") };
      addLog(w, { kind: "gateway", status: "sent", invoice_id: inv.id, text: `${inv.number}: Moyasar payment link created` });
    } catch (e) { inv.payment_link = null; addLog(w, { kind: "gateway", status: "failed", invoice_id: inv.id, text: `${inv.number}: ${String(e.message).slice(0, 200)}` }); }
  }
  async function email(w, c, { subject, text }, extra = {}) {
    const s = settings(w);
    const live = s.mode === "live" && emailReady() && senders && !c.sample && normEmail(c.owner_email);
    const reason = c.sample ? "Sample store: never sent" : s.mode !== "live" ? "Test mode: not sent" : !emailReady() ? "Email isn't connected (SMTP_*): not sent" : !normEmail(c.owner_email) ? "No billing email on the customer" : "";
    if (!live) return addLog(w, { kind: extra.kind || "email", status: "test", customer_id: c.id, invoice_id: extra.invoice_id || null, subject, text, to: c.owner_email || "", note: reason, step: extra.step ?? null });
    try {
      const html = `<div dir="auto" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111;white-space:pre-wrap">${String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch])}</div>`;
      const r = await senders.email({ to: c.owner_email, subject, text, html, headers: {} });
      return addLog(w, { kind: extra.kind || "email", status: "sent", customer_id: c.id, invoice_id: extra.invoice_id || null, subject, text, to: c.owner_email, provider_id: r?.provider_id || "", step: extra.step ?? null });
    } catch (e) { return addLog(w, { kind: extra.kind || "email", status: "failed", customer_id: c.id, invoice_id: extra.invoice_id || null, subject, text, to: c.owner_email, note: String(e.message).slice(0, 200), step: extra.step ?? null }); }
  }

  // Void: a draft just closes. An issued, unpaid invoice is never edited or deleted: it is cancelled with a
  // credit note for what is still due. A paid invoice can only be credited.
  async function voidInvoice(w, inv, reason, by = "you") {
    reason = String(reason || "").trim().slice(0, 300);
    if (!reason) throw Object.assign(new Error("A reason is required to void an invoice"), { status: 422 });
    if (inv.status === "void") throw Object.assign(new Error("Already void"), { status: 409 });
    if (inv.kind !== "invoice") throw Object.assign(new Error("Credit notes can't be voided"), { status: 409 });
    if (inv.status === "paid" || inv.paid_amount > 0) throw Object.assign(new Error("Paid invoices can't be voided: issue a credit note instead"), { status: 409 });
    let credit = null;
    if (inv.status === "issued") credit = (await creditNote(w, inv, { amount: r2(inv.totals.taxable - creditedNet(inv)), reason }, by)).credit;
    inv.status = "void"; inv.void_reason = reason; inv.voided_at = new Date().toISOString(); inv.voided_by = by;
    addLog(w, { kind: "invoice", status: "void", invoice_id: inv.id, text: `${inv.number || "Draft"} void: ${reason}` });
    store.save();
    return { invoice: inv, credit };
  }
  const creditedNet = (inv) => r2(listCredits(inv).reduce((a, x) => a + x.totals.taxable, 0));
  const listCredits = (inv) => store.db[I].filter((x) => x.kind === "credit_note" && x.credit_of === inv.id && x.status !== "void");
  // Credit note: `amount` is before VAT; VAT at the original invoice's rate is added.
  async function creditNote(w, inv, { amount, reason }, by = "you") {
    reason = String(reason || "").trim().slice(0, 300);
    if (!reason) throw Object.assign(new Error("A reason is required for a credit note"), { status: 422 });
    if (inv.kind !== "invoice" || !["issued", "paid"].includes(inv.status)) throw Object.assign(new Error("Only issued or paid invoices can be credited"), { status: 409 });
    const room = r2(inv.totals.taxable - creditedNet(inv)), amt = r2(amount ?? room);
    if (!(amt > 0) || amt > room + 0.001) throw Object.assign(new Error(`Credit must be between 0 and ${inv.currency} ${room.toFixed(2)} (before VAT)`), { status: 422 });
    const c = store.getOps(C, w.id, inv.customer_id);
    const cn = draft(w, c, { kind: "credit_note", lines: [{ kind: "other", description: `Credit for ${inv.number}: ${reason}`, qty: 1, unit_price: amt }], by });
    cn.vat_rate = inv.vat_rate; cn.credit_of = inv.id; cn.credit_of_number = inv.number; cn.credit_reason = reason;
    recalc(w, cn);
    await issue(w, cn, { by });
    inv.credited_total = r2((inv.credited_total || 0) + cn.totals.total);
    if (inv.status === "issued" && amountDue(inv) <= 0.005 && inv.paid_amount <= 0) { inv.status = "void"; inv.void_reason = reason; inv.voided_at = new Date().toISOString(); }
    // Credit on money already received: Finance shows the refund owed as negative revenue.
    if (inv.paid_amount > 0) store.addOps("finance_income", w.id, { date: cn.issue_date, source: c.store_name, type: "subscription", recurring: "one-off", amount_sar: -cn.totals_sar.total, vat_sar: -cn.totals_sar.vat, note: `Credit note ${cn.number} for ${inv.number}`, deal_id: c.deal_id || null, ended_at: null, entry: "billing", invoice_id: cn.id }, false);
    store.save();
    return { credit: cn, invoice: inv };
  }

  // ---- payments. Each payment becomes Finance income (split by line type), so billed revenue is real.
  const INCOME_TYPE = { subscription: "subscription", proration: "subscription", setup: "setup", overage: "other_revenue", other: "other_revenue" };
  function financeIncome(w, c, inv, pay) {
    const groups = {};
    for (const l of inv.lines) groups[INCOME_TYPE[l.kind] || "other_revenue"] = (groups[INCOME_TYPE[l.kind] || "other_revenue"] || 0) + l.net;
    const sub = Object.values(groups).reduce((a, x) => a + x, 0) || 1;
    const totalSar = toSar(pay.amount, inv.currency), vatSar = inv.totals.total ? r2(totalSar * (inv.totals.vat / inv.totals.total)) : 0;
    const entries = Object.entries(groups).filter(([, v]) => v > 0);
    let leftA = totalSar, leftV = vatSar;
    return entries.map(([type, v], i) => {
      const last = i === entries.length - 1;
      const a = last ? r2(leftA) : r2((totalSar * v) / sub), vv = last ? r2(leftV) : r2((vatSar * v) / sub);
      leftA -= a; leftV -= vv;
      return store.addOps("finance_income", w.id, { date: pay.date, source: c.store_name, type, recurring: "one-off", amount_sar: a, vat_sar: vv, note: `Invoice ${inv.number} (${METHODS.find((m) => m.id === pay.method)?.name || pay.method})`, deal_id: c.deal_id || null, ended_at: null, entry: "billing", invoice_id: inv.id, payment_id: pay.id }, false);
    });
  }
  function recordPayment(w, inv, { amount, method = "bank_transfer", date = null, reference = "", provider = "", provider_id = "", fee = 0, by = "you", note = "" }) {
    if (inv.kind !== "invoice" || inv.status !== "issued") throw Object.assign(new Error(inv.status === "paid" ? "This invoice is already paid" : "Only issued invoices can be paid"), { status: 409 });
    if (provider_id && store.db[P].some((p) => p.provider_id === provider_id && p.status === "paid")) return { duplicate: true, invoice: inv };
    const due = amountDue(inv), amt = r2(amount ?? due);
    if (!(amt > 0)) throw Object.assign(new Error("Amount must be more than 0"), { status: 422 });
    const c = store.getOps(C, w.id, inv.customer_id);
    const pay = store.addOps(P, w.id, { invoice_id: inv.id, customer_id: c.id, amount: amt, currency: inv.currency, amount_sar: toSar(amt, inv.currency), method: METHOD_IDS.includes(method) ? method : "other",
      status: "paid", date: isoDate(date) ? date : riyadhDay(clock()), reference: String(reference).slice(0, 120), provider, provider_id, fee: r2(fee), by, note: String(note).slice(0, 300) }, false);
    inv.paid_amount = r2((inv.paid_amount || 0) + amt);
    const income = financeIncome(w, c, inv, pay);
    if (amountDue(inv) <= 0.005) { inv.status = "paid"; inv.paid_at = new Date().toISOString(); }
    addLog(w, { kind: "payment", status: "paid", invoice_id: inv.id, customer_id: c.id, text: `${inv.number}: ${inv.currency} ${amt.toFixed(2)} by ${pay.method}${inv.status === "paid" ? " (paid in full)" : ` (${inv.currency} ${amountDue(inv).toFixed(2)} still due)`}` });
    // Back to good standing when nothing else is overdue.
    const today = riyadhDay(clock());
    const stillOverdue = store.db[I].some((x) => x.workspace_id === w.id && x.customer_id === c.id && x.id !== inv.id && x.status === "issued" && x.kind === "invoice" && dunningState(x, today, settings(w)).overdue);
    if (!stillOverdue && (c.status === "past_due" || (c.status === "paused" && c.paused_reason === "dunning"))) {
      const was = c.status; c.status = "active"; c.paused_reason = null;
      event(c, "recovered", `${was === "paused" ? "Unpaused" : "Back to active"} after payment of ${inv.number}`, by);
    }
    store.save();
    return { payment: pay, invoice: inv, income };
  }
  function failPayment(w, inv, { reason = "", provider = "", provider_id = "", method = "card" }) {
    const c = store.getOps(C, w.id, inv.customer_id);
    if (provider_id && store.db[P].some((p) => p.provider_id === provider_id && p.status === "failed")) return { duplicate: true };
    const pay = store.addOps(P, w.id, { invoice_id: inv.id, customer_id: c.id, amount: amountDue(inv), currency: inv.currency, amount_sar: toSar(amountDue(inv), inv.currency), method, status: "failed", date: riyadhDay(clock()), reference: "", provider, provider_id, fee: 0, by: "gateway", note: String(reason).slice(0, 200) }, false);
    if (!inv.dunning_from || inv.dunning_from > pay.date) inv.dunning_from = pay.date; // dunning counts from the failed payment if that's earlier than the due date
    addLog(w, { kind: "payment", status: "failed", invoice_id: inv.id, customer_id: c.id, text: `${inv.number}: card payment failed${reason ? `: ${reason}` : ""}` });
    store.save();
    return { payment: pay };
  }

  // ---- subscription changes
  async function changePlan(w, c, plan, { custom_price_usd = null, by = "you" } = {}) {
    if (!planDef(plan)) throw Object.assign(new Error("Unknown plan"), { status: 422 });
    if (["cancelled"].includes(c.status)) throw Object.assign(new Error("Reactivate the customer first"), { status: 409 });
    const p = proration(c, plan, riyadhDay(clock()), custom_price_usd);
    const from = c.plan;
    c.plan = plan; c.custom_price_usd = plan === "Enterprise" ? (Number(custom_price_usd) || c.custom_price_usd || null) : null;
    let inv = null;
    if (p.direction === "upgrade") {
      inv = draft(w, c, { lines: [{ kind: "proration", description: `Upgrade ${from} → ${plan}: ${p.remaining_days} of ${p.total_days} days (${p.currency} ${p.charge.toFixed(2)} − unused ${from} ${p.credit.toFixed(2)})`, qty: 1, unit_price: p.net }], period_start: riyadhDay(clock()), period_end: c.period_end, by });
      applyCoupon(w, c, inv, "proration");
      if (settings(w).auto_issue) await issue(w, inv, { by });
    } else if (p.direction === "downgrade") c.credit_balance = r2((c.credit_balance || 0) - p.net);
    event(c, p.direction === "trial" ? "plan" : p.direction === "same" ? "plan" : p.direction, `${from} → ${plan}${p.direction === "downgrade" ? `; ${c.currency} ${(-p.net).toFixed(2)} account credit` : p.direction === "upgrade" ? `; proration ${c.currency} ${p.net.toFixed(2)}` : ""}`, by);
    store.save();
    return { proration: p, invoice: inv, customer: c };
  }
  function setStatus(w, c, action, { by = "you", at_period_end = true } = {}) {
    const today = riyadhDay(clock());
    if (action === "pause") { if (!PAYING.includes(c.status) && c.status !== "trial") throw Object.assign(new Error("Only active or trialling customers can be paused"), { status: 409 }); c.status = "paused"; c.paused_reason = "manual"; c.paused_at = today; event(c, "pause", "Paused by a person", by); }
    else if (action === "resume") {
      if (c.status !== "paused") throw Object.assign(new Error("The customer isn't paused"), { status: 409 });
      c.status = "active"; c.paused_reason = null;
      // A new period starts on the day the account resumes.
      if (c.period_end <= today) { c.period_start = today; c.period_end = periodEnd(today, c.cycle); c.anchor_day = Number(today.slice(8, 10)); c.first_invoiced = false; }
      event(c, "resume", "Resumed", by);
    } else if (action === "cancel") {
      if (c.status === "cancelled") throw Object.assign(new Error("Already cancelled"), { status: 409 });
      if (at_period_end && c.status !== "paused") { c.cancel_at_period_end = true; event(c, "cancel_scheduled", `Cancels at the end of the period (${c.period_end})`, by); }
      else { c.status = "cancelled"; c.cancel_at_period_end = false; c.cancelled_at = today; event(c, "cancel", "Cancelled now", by); }
    } else if (action === "reactivate") {
      if (c.cancel_at_period_end) { c.cancel_at_period_end = false; event(c, "cancel_undone", "Cancellation removed", by); }
      else if (c.status === "cancelled") { c.status = "active"; c.period_start = today; c.period_end = periodEnd(today, c.cycle); c.anchor_day = Number(today.slice(8, 10)); c.first_invoiced = false; event(c, "reactivate", "Reactivated", by); }
      else throw Object.assign(new Error("Nothing to reactivate"), { status: 409 });
    } else throw Object.assign(new Error("Unknown action"), { status: 404 });
    store.save();
    return c;
  }

  // ---- usage (renders per calendar month): set by a person or posted by the product
  function setUsage(w, c, month, renders, { mode = "set", source = "manual" } = {}) {
    const n = Math.max(0, Math.round(Number(renders) || 0));
    let u = store.db[U].find((x) => x.workspace_id === w.id && x.customer_id === c.id && x.month === month);
    if (!u) u = store.addOps(U, w.id, { customer_id: c.id, month, renders: 0 }, false);
    u.renders = mode === "add" ? u.renders + n : n; u.source = source; u.updated_at = new Date().toISOString();
    store.save();
    return u;
  }
  const usageOf = (wsId, cid) => store.db[U].filter((u) => u.workspace_id === String(wsId) && u.customer_id === cid).sort((a, b) => a.month.localeCompare(b.month));
  function overageLines(w, c, beforeMonth) {
    const lines = [], months = [];
    for (const u of usageOf(w.id, c.id)) {
      if (u.month >= beforeMonth || (c.overage_billed || []).includes(u.month)) continue;
      const o = overage(c.plan, u.renders, pricingOf(w));
      months.push(u.month);
      if (o.amount_usd > 0) lines.push({ kind: "overage", description: `Extra renders ${u.month}: ${o.extra.toLocaleString("en-US")} over the ${o.limit.toLocaleString("en-US")} included (${o.blocks} × 1,000 at $${o.rate_usd})`, qty: o.blocks, unit_price: c.currency === "USD" ? o.rate_usd : r2(o.rate_usd * SAR_PER_USD) });
    }
    return { lines, months };
  }

  // ---- the billing run (every hour; idempotent): trials end, periods renew, overage is billed, dunning runs
  async function runWorkspace(w, now = clock()) {
    const s = settings(w), today = riyadhDay(now), out = { invoices: 0, activated: 0, renewed: 0, cancelled: 0, reminders: 0, paused: 0 };
    const subInvoice = async (c, start, end, extra = []) => {
      const key = `${c.id}|${start}`;
      if (store.db[I].some((x) => x.workspace_id === w.id && x.period_key === key && x.status !== "void")) return;
      const label = c.cycle === "yearly" ? "yearly" : "monthly";
      const inv = draft(w, c, { lines: [{ kind: "subscription", description: `DPA AD ${c.plan} plan, ${label}: ${start} to ${addDays(end, -1)}`, qty: 1, unit_price: periodPrice(c) }, ...extra], period_key: key, period_start: start, period_end: end, by: "billing run" });
      applyCoupon(w, c, inv, "subscription");
      out.invoices++;
      if (s.auto_issue) await issue(w, inv, { by: "billing run" });
    };
    for (const c of customers(w.id)) {
      if (c.status === "trial" && c.trial_end && c.trial_end <= today) {
        if (c.cancel_at_period_end) { c.status = "cancelled"; c.cancel_at_period_end = false; c.cancelled_at = c.trial_end; event(c, "cancel", "Trial ended without converting", "billing run", c.trial_end); out.cancelled++; continue; }
        c.status = "active"; c.period_start = c.trial_end; c.period_end = periodEnd(c.trial_end, c.cycle, c.anchor_day);
        c.first_invoiced = true;
        event(c, "start", `Trial converted: ${c.plan} ${c.cycle}`, "billing run", c.trial_end); out.activated++;
        await subInvoice(c, c.period_start, c.period_end);
        continue;
      }
      if (c.status === "active" && !c.first_invoiced && c.period_start <= today) {
        c.first_invoiced = true; // a customer added as active is billed for its first period straight away
        await subInvoice(c, c.period_start, c.period_end);
      }
      for (let guard = 0; PAYING.includes(c.status) && c.period_end <= today && guard < 24; guard++) {
        if (c.cancel_at_period_end) { c.status = "cancelled"; c.cancel_at_period_end = false; c.cancelled_at = c.period_end; event(c, "cancel", "Cancelled at the end of the period", "billing run", c.period_end); out.cancelled++; break; }
        if (c.next_cycle && c.next_cycle !== c.cycle) { c.cycle = c.next_cycle; event(c, c.cycle === "yearly" ? "expansion" : "contraction", `Billing cycle changed to ${c.cycle}`, "billing run", c.period_end); }
        c.next_cycle = null;
        c.period_start = c.period_end; c.period_end = periodEnd(c.period_start, c.cycle, c.anchor_day);
        const ov = c.cycle === "monthly" ? overageLines(w, c, ym(c.period_start)) : { lines: [], months: [] };
        await subInvoice(c, c.period_start, c.period_end, ov.lines);
        c.overage_billed = [...(c.overage_billed || []), ...ov.months];
        event(c, "renew", `New ${c.cycle} period ${c.period_start}`, "billing run", c.period_start); out.renewed++;
      }
      // Yearly plans: overage for each finished month gets its own invoice.
      if (c.cycle === "yearly" && PAYING.includes(c.status)) {
        const ov = overageLines(w, c, ym(today));
        if (ov.lines.length) {
          const inv = draft(w, c, { lines: ov.lines, by: "billing run", note: "Render overage, billed in arrears" });
          out.invoices++;
          if (s.auto_issue) await issue(w, inv, { by: "billing run" });
        }
        if (ov.months.length) c.overage_billed = [...(c.overage_billed || []), ...ov.months];
      }
    }
    // Dunning: reminders on the set days, past_due after day 1, pause after N days. Emails go out 09:00–21:00 Riyadh.
    for (const inv of store.db[I].filter((x) => x.workspace_id === w.id && x.kind === "invoice" && x.status === "issued")) {
      const st = dunningState(inv, today, s), c = store.getOps(C, w.id, inv.customer_id);
      if (!c || !st.overdue) continue;
      if (c.status === "active") { c.status = "past_due"; event(c, "past_due", `${inv.number} is overdue`, "billing run"); }
      if (st.should_pause && c.status === "past_due") { c.status = "paused"; c.paused_reason = "dunning"; c.paused_at = today; event(c, "pause", `Paused: ${inv.number} unpaid ${st.days_overdue} days`, "billing run"); out.paused++; }
      if (st.step !== null && inWindow(now, { from: 9, to: 21, skip_friday: false })) {
        const r = reminderText(st.step, { inv, c, company: company(w), link: inv.payment_link?.url || "", pauseAfter: s.pause_after_days });
        const logE = await email(w, c, r, { kind: "dunning", invoice_id: inv.id, step: st.step });
        inv.reminders = [...(inv.reminders || []), ...st.skipped.map((d) => ({ step: d, at: now.toISOString(), status: "skipped" })), { step: st.step, at: now.toISOString(), status: logE.status, log_id: logE.id }];
        out.reminders++;
      }
    }
    store.save();
    return out;
  }
  async function tick(now = clock()) {
    const total = { invoices: 0, activated: 0, renewed: 0, cancelled: 0, reminders: 0, paused: 0 };
    for (const w of store.listWorkspaces()) {
      if (!store.db[C].some((c) => c.workspace_id === w.id)) continue;
      const r = await runWorkspace(w, now);
      for (const k of Object.keys(total)) total[k] += r[k];
    }
    return total;
  }
  let timer = null;
  function start(every = 3600e3) {
    const run = async () => { try { await tick(); } catch (e) { log.error("[billing] run:", e?.message || e); } };
    setTimeout(run, 30e3).unref?.();
    timer = setInterval(run, every); timer.unref?.();
  }
  const stop = () => { clearInterval(timer); timer = null; };

  // ---- Moyasar webhook
  async function webhook(ev) {
    const inv = store.db[I].find((x) => (ev.moyasar_invoice_id && x.payment_link?.id === ev.moyasar_invoice_id) || (ev.metadata?.invoice_id && x.id === String(ev.metadata.invoice_id) && x.workspace_id === String(ev.metadata.workspace_id)));
    if (!inv) return { ok: false, reason: "No invoice for this payment" };
    const w = store.getWorkspace(inv.workspace_id);
    let status = ev.status, amountMinor = ev.amount_minor;
    // Live: confirm with Moyasar's API instead of trusting the event alone.
    if (settings(w).mode === "live" && gateway.cfg.ready && ev.payment_id) {
      const p = await gateway.getPayment(ev.payment_id);
      status = String(p.status || ""); amountMinor = Number(p.amount) || 0;
    }
    if (ev.type === "payment_paid" || status === "paid") {
      if (status !== "paid") return { ok: false, reason: "Payment isn't paid at Moyasar" };
      if (inv.status !== "issued") return { ok: true, ignored: inv.status };
      return { ok: true, ...recordPayment(w, inv, { amount: amountMinor / 100, method: "card", provider: "moyasar", provider_id: ev.payment_id, reference: ev.payment_id, by: "Moyasar" }) };
    }
    if (ev.type === "payment_failed" || status === "failed") return { ok: true, ...failPayment(w, inv, { reason: ev.message, provider: "moyasar", provider_id: ev.payment_id }) };
    return { ok: true, ignored: ev.type };
  }

  // ---- the customer 360 and the overview
  const ticketsFor = (wsId, c) => {
    const dom = normDomain(c.domain), email = normEmail(c.owner_email), emDom = email.split("@")[1] || "";
    return store.listTickets(wsId).filter((t) => {
      const contact = String(t.contact || "").toLowerCase(), st = String(t.store || "").toLowerCase();
      return (email && contact.includes(email)) || (dom && (contact.endsWith("@" + dom) || st.includes(dom))) || (emDom && dom && emDom === dom && contact.endsWith("@" + emDom)) || (c.store_name && st && st === c.store_name.toLowerCase());
    });
  };
  function health(w, c, today = riyadhDay(clock())) {
    const invs = store.db[I].filter((x) => x.workspace_id === w.id && x.customer_id === c.id);
    const pays = store.db[P].filter((x) => x.workspace_id === w.id && x.customer_id === c.id);
    const tickets = ticketsFor(w.id, c), usage = usageOf(w.id, c.id), contact = crm && c.crm_contact_id ? crm.get(w.id, c.crm_contact_id) : null;
    const dates = [...usage.map((u) => u.updated_at), ...pays.filter((p) => p.status === "paid").map((p) => p.date), ...tickets.map((t) => t.updated_at), contact?.last_reply_at].filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
    return healthScore({ c, invoices: invs, payments: pays, tickets, onboarding: contact ? contact.onboarding || {} : null, usage, lastActivity: dates.at(-1) || null, today, pricing: pricingOf(w) });
  }
  function enrich(w, c, today = riyadhDay(clock())) {
    const open = store.db[I].filter((x) => x.workspace_id === w.id && x.customer_id === c.id && x.kind === "invoice" && x.status === "issued");
    return { ...c, price: periodPrice(c), mrr_sar: mrrSar(c), balance_due: r2(open.reduce((a, i) => a + amountDue(i), 0)), open_invoices: open.length,
      next_invoice: c.status === "trial" ? c.trial_end : PAYING.includes(c.status) && !c.cancel_at_period_end ? c.period_end : null, health: health(w, c, today) };
  }
  function needs(w, now = clock()) {
    const today = riyadhDay(now), s = settings(w), out = [];
    const overdue = store.db[I].filter((x) => x.workspace_id === w.id && x.kind === "invoice" && x.status === "issued" && dunningState(x, today, s).overdue);
    if (overdue.length) out.push({ tab: "dunning", kind: "overdue", text: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}: SAR ${Math.round(overdue.reduce((a, i) => a + toSar(amountDue(i), i.currency), 0)).toLocaleString("en-US")} unpaid` });
    const failed = store.db[P].filter((p) => p.workspace_id === w.id && p.status === "failed" && daysBetween(p.date, today) <= 7 && store.getOps(I, w.id, p.invoice_id)?.status === "issued");
    if (failed.length) out.push({ tab: "payments", kind: "failed", text: `${failed.length} failed card payment${failed.length === 1 ? "" : "s"} this week` });
    const trials = customers(w.id).filter((c) => c.status === "trial" && c.trial_end && daysBetween(today, c.trial_end) >= 0 && daysBetween(today, c.trial_end) <= 7);
    for (const c of trials.slice(0, 5)) out.push({ tab: "customers", kind: "trial", customer_id: c.id, text: `${c.store_name}: trial ends ${c.trial_end}${c.owner_email ? "" : " (no billing email yet)"}` });
    const drafts = store.db[I].filter((x) => x.workspace_id === w.id && x.status === "draft").length;
    if (drafts) out.push({ tab: "invoices", kind: "drafts", text: `${drafts} draft invoice${drafts === 1 ? "" : "s"} to check and issue` });
    const aiDrafts = store.db[D].filter((x) => x.workspace_id === w.id && x.status === "draft").length;
    if (aiDrafts) out.push({ tab: "dunning", kind: "ai", text: `${aiDrafts} AI Billing assistant draft${aiDrafts === 1 ? "" : "s"} waiting for approval` });
    if (w.finance?.vat_registered && !s.vat_number) out.push({ tab: "settings", kind: "settings", text: "VAT-registered in Finance but no VAT number in Billing settings: tax invoices can't be issued" });
    if (!s.legal_name && customers(w.id).length) out.push({ tab: "settings", kind: "settings", soft: true, text: "Add the company's legal name and address for invoices" });
    return out;
  }
  function command(w, now = clock()) {
    const cs = customers(w.id);
    if (!cs.length) return null;
    const m = mrrMetrics(cs, riyadhDay(now), 2);
    return { customers: cs.length, paying: m.paying, trials: m.trials, mrr_sar: m.mrr_sar, mrr_usd: m.mrr_usd, arr_sar: m.arr_sar, needs: needs(w, now).filter((n) => !n.soft && ["overdue", "failed", "trial"].includes(n.kind)) };
  }

  return { hooks, applyCoupon, settings, setSettings, customers, getCustomer, addCustomer, updateCustomer, event, invoices, getInvoice, draft, recalc, issue, voidInvoice, creditNote,
    recordPayment, failPayment, changePlan, setStatus, setUsage, usageOf, overageLines, runWorkspace, tick, start, stop, webhook, health, enrich, needs, command, ticketsFor,
    listCredits, addLog, pricingOf, vatRate, company, sellerOf, buyerOf, email,
    issueLink: async (w, inv) => { await paymentLink(w, inv, store.getOps(C, w.id, inv.customer_id)); store.save(); } };
}
