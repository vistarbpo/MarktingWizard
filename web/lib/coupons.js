// Coupons (Partners & referrals, module "partners"): a code a partner gives to stores (or a company promo code with no
// partner, e.g. Ramadan) that (1) gives the customer a discount on its subscription invoices and (2) attributes the
// customer to the partner (attribution source "coupon": after a person's choice, before ref / cookie / utm_campaign).
// One redemption per customer, no stacking. The discount is the invoice's document discount ("Coupon <CODE>"), so VAT
// and the ZATCA totals are worked out by Billing's invoiceTotals() on the amount after it; commissions read what the
// customer actually paid. Every rule and default is in docs/partners.md (section "Coupons") and docs/billing-zatca.md.
import { PLANS } from "./sales.js";
import { PAYING, invoiceTotals, mrrSar, periodPrice, r2, toSar } from "./billing.js";
import { normDomain } from "./crm.js";
import { COLL, ensurePartners, logPush, todayOf } from "./partners.js";

export const DISCOUNT_TYPES = ["percent", "fixed"];
export const DURATIONS = [
  { id: "once", name: "Once (first invoice)" },
  { id: "months", name: "N billing months" },
  { id: "forever", name: "Forever" },
];
export const DURATION_IDS = DURATIONS.map((d) => d.id);
export const CYCLE_CHOICES = ["both", "monthly", "yearly"];
export const COUPON_CURRENCIES = ["SAR", "USD"];
export const PLAN_NAMES = PLANS.map((p) => p.name);
// Defaults to confirm with the founder: above this percent, or "forever", only the Owner may create or set a coupon.
export const OWNER_PCT = 50;
export const MAX_MONTHS = 36;
export const EXPIRING_DAYS = 7, NEAR_LIMIT = 0.9;
const DAY = 864e5;
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// ---- codes: uppercase A–Z, 0–9 and "-", 4–20 characters; typed in any case, Arabic-Indic digits accepted
export function normCouponCode(v) {
  return String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).trim().toUpperCase();
}
export const cleanCouponCode = (v) => { const c = normCouponCode(v); return /^[A-Z0-9][A-Z0-9-]{3,19}$/.test(c) ? c : ""; };
// Unique across the dashboard, referral codes included (case-insensitive). A coupon may repeat its own partner's
// referral code (same partner, so attribution can't be confused): that is how the default suggestion works.
export function couponCodeTaken(store, code, { exceptId = null, partnerId = null } = {}) {
  const c = cleanCouponCode(code); if (!c) return null;
  if ((store.db[COLL.coupons] || []).some((x) => x.code === c && x.id !== exceptId)) return "coupon";
  const ref = (store.db[COLL.codes] || []).find((x) => x.code === c.toLowerCase());
  if (ref && !(partnerId && ref.partner_id === partnerId)) return "referral";
  return null;
}
export function suggestCoupon(store, partnerId) {
  const ref = (store.db[COLL.codes] || []).find((x) => x.partner_id === partnerId && x.active !== false) || (store.db[COLL.codes] || []).find((x) => x.partner_id === partnerId);
  const base = (ref ? ref.code.toUpperCase() : `P${partnerId}`).replace(/[^A-Z0-9-]/g, "").slice(0, 20).replace(/-+$/, "").padEnd(4, "0");
  if (!couponCodeTaken(store, base, { partnerId })) return base;
  for (let i = 2; i < 100; i++) { const c = `${base.slice(0, 20 - String(i).length - 1).replace(/-+$/, "")}-${i}`; if (!couponCodeTaken(store, c, { partnerId })) return c; }
  return `P${partnerId}-${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
}
export const findCoupon = (store, code, wsId = null) => { const c = cleanCouponCode(code); return c ? (store.db[COLL.coupons] || []).find((x) => x.code === c && (!wsId || x.workspace_id === String(wsId))) || null : null; };

// ---- cleaning (partner existence, uniqueness and the Owner-only rule are checked by the route)
export function cleanCoupon(b = {}, { partial = false, cur = null } = {}) {
  const out = {}, err = [];
  const has = (k) => b[k] !== undefined || !partial;
  if (has("code")) { const c = cleanCouponCode(b.code); if (!c) err.push("Codes are 4–20 characters: letters A–Z, digits and dashes (e.g. NAJD-10)"); else out.code = c; }
  if (b.partner_id !== undefined) out.partner_id = b.partner_id ? str(b.partner_id, 40) : null;
  else if (!partial) out.partner_id = null;
  if (has("discount_type")) { const t = b.discount_type ?? "percent"; if (!DISCOUNT_TYPES.includes(t)) err.push("discount_type must be percent or fixed"); else out.discount_type = t; }
  const type = out.discount_type || cur?.discount_type || "percent";
  if (has("value") || out.discount_type) {
    const v = Number(b.value ?? cur?.value);
    if (type === "percent" ? !(Number.isInteger(v) && v >= 1 && v <= 100) : !(v > 0 && v <= 1_000_000)) err.push(type === "percent" ? "A percent discount is a whole number 1–100" : "A fixed discount is an amount above 0");
    else out.value = r2(v);
  }
  if (type === "fixed" && (has("currency") || out.discount_type)) { const c = String(b.currency ?? cur?.currency ?? "SAR").toUpperCase(); if (!COUPON_CURRENCIES.includes(c)) err.push("currency must be SAR or USD"); else out.currency = c; }
  if (type === "percent" && out.discount_type) out.currency = null;
  if (has("duration")) { const d = b.duration ?? "once"; if (!DURATION_IDS.includes(d)) err.push("duration must be once, months or forever"); else out.duration = d; }
  const dur = out.duration || cur?.duration || "once";
  if (dur === "months" && (has("months") || out.duration)) { const n = Number(b.months ?? cur?.months); if (!(Number.isInteger(n) && n >= 1 && n <= MAX_MONTHS)) err.push(`months must be a whole number 1–${MAX_MONTHS}`); else out.months = n; }
  if (dur !== "months" && out.duration) out.months = null;
  if (has("plans")) {
    const raw = b.plans === "all" || b.plans == null || b.plans === "" ? [] : Array.isArray(b.plans) ? b.plans : String(b.plans).split(/\s*,\s*/);
    const plans = [...new Set(raw.map((p) => PLAN_NAMES.find((n) => n.toLowerCase() === String(p).trim().toLowerCase())).filter(Boolean))];
    if (raw.filter((p) => String(p).trim()).length !== plans.length) err.push(`plans must be from ${PLAN_NAMES.join(", ")} (or all)`); else out.plans = plans.length === PLAN_NAMES.length ? [] : plans;
  }
  if (has("cycles")) { const c = b.cycles ?? "both"; if (!CYCLE_CHOICES.includes(c)) err.push("cycles must be both, monthly or yearly"); else out.cycles = c; }
  if (has("first_time_only")) out.first_time_only = b.first_time_only === undefined ? true : !!b.first_time_only;
  if (has("max_redemptions")) { const v = b.max_redemptions; if (v === null || v === "" || v === undefined) out.max_redemptions = null; else { const n = Number(v); if (!(Number.isInteger(n) && n >= 1 && n <= 1_000_000)) err.push("max_redemptions must be a whole number of 1 or more (or empty)"); else out.max_redemptions = n; } }
  for (const k of ["valid_from", "valid_until"]) if (has(k)) { const v = b[k]; if (v === null || v === "" || v === undefined) out[k] = null; else if (!isDate(v)) err.push(`${k} must be YYYY-MM-DD (a Riyadh day)`); else out[k] = v; }
  const from = out.valid_from !== undefined ? out.valid_from : cur?.valid_from, until = out.valid_until !== undefined ? out.valid_until : cur?.valid_until;
  if (from && until && until < from) err.push("valid_until must be on or after valid_from");
  if (has("status")) { const s = b.status ?? "active"; if (!["active", "paused"].includes(s)) err.push("status must be active or paused (expired is worked out from valid_until)"); else out.status = s; }
  if (b.note !== undefined) out.note = String(b.note ?? "").slice(0, 1000);
  else if (!partial) out.note = "";
  return { out, err };
}
export const needsOwner = (c) => (c.discount_type === "percent" && Number(c.value) > OWNER_PCT) || c.duration === "forever";
const FIELD = { code: "code", partner_id: "partner", discount_type: "type", value: "value", currency: "currency", duration: "duration", months: "months", plans: "plans", cycles: "cycles", first_time_only: "first-time only", max_redemptions: "max redemptions", valid_from: "valid from", valid_until: "valid until", status: "status", note: "note" };
export function couponChanges(before, after) {
  const show = (v) => (v === null || v === undefined || v === "" ? "–" : Array.isArray(v) ? (v.length ? v.join(", ") : "all") : String(v).slice(0, 60));
  return Object.entries(after).filter(([k, v]) => FIELD[k] && JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)).map(([k, v]) => (k === "note" ? "note edited" : `${FIELD[k]}: ${show(before[k])} → ${show(v)}`));
}

// ---- state and what the discount looks like
export function couponState(cp, today) {
  if (cp.status === "paused") return "paused";
  if (cp.valid_until && today > cp.valid_until) return "expired";
  return "active";
}
export const termsOf = (cp) => ({ type: cp.discount_type, value: cp.value, currency: cp.discount_type === "fixed" ? cp.currency : null, duration: cp.duration, months: cp.duration === "months" ? cp.months : null, plans: [...(cp.plans || [])], cycles: cp.cycles || "both" });
export function termsText(t) {
  const amt = t.type === "percent" ? `${t.value}%` : `${t.currency} ${Number(t.value).toFixed(2)}`;
  const dur = t.duration === "once" ? "on the first invoice" : t.duration === "months" ? `for ${t.months} billing month${t.months === 1 ? "" : "s"}` : "on every invoice";
  return `${amt} off ${dur}`;
}
export function termsTextAr(t) {
  const amt = t.type === "percent" ? `خصم ${t.value}%` : `خصم ${Number(t.value).toFixed(2)} ${t.currency === "USD" ? "دولار" : "ريال"}`;
  const dur = t.duration === "once" ? "على أول فاتورة" : t.duration === "months" ? `لمدة ${t.months} شهر` : "على كل فاتورة";
  return `${amt} ${dur}`;
}
const redemptionsOf = (store, cp) => (store.db[COLL.redemptions] || []).filter((r) => r.coupon_id === cp.id && r.status !== "removed");

// ---- refusals (clear reasons in English and Arabic)
export const REASONS = {
  unknown: ["This code doesn't exist.", "الكود غير صحيح."],
  paused: ["This coupon is paused.", "هذا الكوبون موقوف حالياً."],
  sample: ["Sample coupons are only for sample customers.", "كوبونات العينة للعملاء التجريبيين فقط."],
  expired: ["This coupon has expired.", "انتهت صلاحية هذا الكوبون."],
  not_yet_valid: ["This coupon isn't valid yet.", "هذا الكوبون لم يبدأ بعد."],
  limit_reached: ["This coupon has reached its limit of redemptions.", "وصل هذا الكوبون للحد الأقصى من الاستخدام."],
  plan: ["This coupon doesn't cover the customer's plan.", "الكوبون لا يشمل باقة العميل."],
  cycle: ["This coupon doesn't cover the customer's billing cycle.", "الكوبون لا يشمل دورة الفوترة للعميل."],
  currency: ["This fixed-amount coupon is in another currency than the customer's invoices (no exchange rate is applied): use a coupon in the customer's currency.", "مبلغ الكوبون بعملة مختلفة عن عملة فواتير العميل."],
  already_used: ["This customer has already used this coupon.", "العميل استخدم هذا الكوبون من قبل."],
  not_first_time: ["This coupon is for first-time customers only, and this store has been billed before.", "الكوبون للعملاء الجدد فقط."],
  has_coupon: ["This customer already has a coupon (coupons don't stack).", "العميل عنده كوبون مسبقاً (لا يمكن الجمع بين كوبونين)."],
};
const refuse = (code) => ({ ok: false, reason_code: code, reason: REASONS[code][0], reason_ar: REASONS[code][1] });
// The public endpoint only ever says one of these (no enumeration beyond them).
export const PUBLIC_CODE = { unknown: "unknown_or_inactive", paused: "unknown_or_inactive", sample: "unknown_or_inactive", expired: "expired", not_yet_valid: "not_yet_valid", limit_reached: "limit_reached" };
export function couponLive(store, cp, today) {
  if (!cp) return refuse("unknown");
  const st = couponState(cp, today);
  if (st === "paused") return refuse("paused");
  if (st === "expired") return refuse("expired");
  if (cp.valid_from && today < cp.valid_from) return refuse("not_yet_valid");
  if (cp.max_redemptions && redemptionsOf(store, cp).length >= cp.max_redemptions) return refuse("limit_reached");
  return { ok: true };
}
// A first-time customer has never been billed: no issued invoice, not marked "already billed", and no other customer
// record with the same domain that was billed or used a coupon.
export function firstTime(store, wsId, c) {
  const id = String(wsId), invs = store.db.billing_invoices || [];
  const billed = (x) => invs.some((i) => i.customer_id === x.id && i.kind === "invoice" && i.number && i.status !== "void");
  if (c.id && billed(c)) return false;
  if (c.first_invoiced || c.already_billed) return false;
  const dom = normDomain(c.domain || "");
  if (dom) for (const o of (store.db.billing_customers || []).filter((x) => x.workspace_id === id && x.id !== c.id && normDomain(x.domain || "") === dom)) {
    if (billed(o) || o.first_invoiced) return false;
    if ((store.db[COLL.redemptions] || []).some((r) => r.customer_id === o.id && r.status !== "removed")) return false;
  }
  return true;
}
// Can this coupon be redeemed by this customer (an existing one, or the fields of one about to be created)?
export function checkRedeem(store, w, c, cp, today) {
  const live = couponLive(store, cp, today);
  if (!live.ok) return live;
  if (cp.workspace_id !== String(w.id)) return refuse("unknown");
  if (cp.sample && !c.sample) return refuse("sample");
  const t = termsOf(cp), plan = c.plan || "Starter", cycle = c.cycle || "monthly", currency = c.currency || "SAR";
  if (t.plans.length && !t.plans.includes(plan)) return refuse("plan");
  if (t.cycles !== "both" && t.cycles !== cycle) return refuse("cycle");
  if (t.type === "fixed" && t.currency !== currency) return refuse("currency");
  if (c.id) {
    const mine = (store.db[COLL.redemptions] || []).filter((r) => r.workspace_id === String(w.id) && r.customer_id === c.id && r.status !== "removed");
    if (mine.some((r) => r.coupon_id === cp.id)) return refuse("already_used");
    if (mine.length) return refuse("has_coupon");
  }
  if (cp.first_time_only !== false && !firstTime(store, w.id, c)) return refuse("not_first_time");
  return { ok: true };
}

// ---- the discount on an invoice (pure): base = the subscription (or proration) lines before VAT
// once: the whole first subscription invoice. months: N billing months from the first discounted invoice; a monthly
// invoice uses 1, a yearly invoice 12 (if fewer are left, a percent discount is scaled to them and a fixed amount is
// given per month left). forever: every subscription invoice. Fixed amounts are per invoice for "once" and per
// billing month otherwise. Proration (upgrade) invoices get a percent coupon while it still has months left, without
// using a month; fixed coupons and overage lines are never discounted. Never more than the base (never below 0).
export function computeDiscount(t, cust, base, { used = 0, count = 0 } = {}, kind = "subscription") {
  base = r2(base);
  if (!(base > 0)) return null;
  if (t.plans?.length && !t.plans.includes(cust.plan)) return null;
  if (t.cycles && t.cycles !== "both" && t.cycles !== cust.cycle) return null;
  if (t.type === "fixed" && t.currency !== cust.currency) return null;
  const per = cust.cycle === "yearly" ? 12 : 1;
  let cover = per;
  if (t.duration === "once") { if (count > 0) return null; }
  else if (t.duration === "months") { const left = (t.months || 0) - used; if (left <= 0) return null; cover = Math.min(per, left); }
  let amount;
  if (kind === "proration") {
    if (t.type !== "percent" || t.duration === "once") return null;
    amount = (base * t.value) / 100; cover = 0;
  } else if (t.type === "percent") amount = ((base * t.value) / 100) * (t.duration === "months" ? cover / per : 1);
  else amount = t.duration === "once" ? t.value : t.value * cover;
  amount = Math.min(r2(amount), base);
  return amount > 0 ? { amount, months_used: cover } : null;
}
const discountedInvoices = (store, r, exceptId = null) => (store.db.billing_invoices || []).filter((i) => i.coupon?.redemption_id === r.id && i.kind === "invoice" && i.status !== "void" && i.id !== exceptId);
export function usageOf(store, r, exceptId = null) {
  const invs = discountedInvoices(store, r, exceptId).filter((i) => i.coupon.kind !== "proration");
  return { used: invs.reduce((a, i) => a + (i.coupon.months_used || 0), 0), count: invs.length };
}
export function redemptionState(store, r) {
  if (r.status !== "active") return r.status; // removed | stopped
  const u = usageOf(store, r), t = r.terms;
  if ((t.duration === "once" && u.count > 0) || (t.duration === "months" && u.used >= t.months)) return "ended";
  return "active";
}
export const activeRedemption = (store, wsId, cid) => (store.db[COLL.redemptions] || []).find((r) => r.workspace_id === String(wsId) && r.customer_id === cid && r.status === "active") || null;
// Billing's hook: called when Billing drafts a subscription or proration invoice.
export function couponDiscount(store, w, c, inv, kind) {
  const r = activeRedemption(store, w.id, c.id);
  if (!r) return null;
  const base = r2(inv.lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.net, 0));
  const d = computeDiscount(r.terms, c, base, usageOf(store, r, inv.id), kind);
  if (!d) return null;
  return { amount: d.amount, reason: `Coupon ${r.code}`, meta: { redemption_id: r.id, coupon_id: r.coupon_id, code: r.code, kind, months_used: d.months_used, amount: d.amount } };
}
// The next subscription invoice with the coupon (for the "Apply coupon" preview).
export function previewNext(store, w, c, t, vatRate, { used = 0, count = 0 } = {}) {
  const base = periodPrice({ plan: c.plan || "Starter", cycle: c.cycle || "monthly", currency: c.currency || "SAR", custom_price_usd: c.custom_price_usd ?? null });
  const d = computeDiscount(t, { plan: c.plan || "Starter", cycle: c.cycle || "monthly", currency: c.currency || "SAR" }, base, { used, count });
  const { totals } = invoiceTotals([{ kind: "subscription", description: "Plan", qty: 1, unit_price: base }], d?.amount || 0, vatRate);
  return { currency: c.currency || "SAR", base, discount: totals.discount, taxable: totals.taxable, vat: totals.vat, total: totals.total, vat_rate: vatRate, next_date: c.status === "trial" ? c.trial_end || null : c.first_invoiced ? c.period_end || null : c.period_start || null,
    terms: termsText(t), terms_ar: termsTextAr(t), credit_note: c.credit_balance > 0 ? `Account credit ${c.currency} ${Number(c.credit_balance).toFixed(2)} still comes off after the coupon.` : "" };
}

// ---- redeem and remove
export function redeem(store, w, c, cp, { by = "you", source = "billing", now = Date.now() } = {}) {
  ensurePartners(store);
  const r = store.addOps(COLL.redemptions, w.id, { coupon_id: cp.id, code: cp.code, partner_id: cp.partner_id || null, customer_id: c.id, terms: termsOf(cp), status: "active", source,
    redeemed_at: new Date(now).toISOString(), redeemed_day: todayOf(now), by, log: [], ...(c.sample || cp.sample ? { sample: true } : {}) }, false);
  logPush(r, by, `Coupon ${cp.code} applied (${termsText(r.terms)}) from ${source}`, now);
  logPush(cp, by, `Redeemed by customer #${c.id} (${source})`, now);
  store.save();
  return r;
}
// Before the first discounted invoice is issued: the redemption is removed (as if it never happened; drafts lose the
// discount). After it: future invoices are no longer discounted ("stopped"); issued invoices are never changed.
export function removeRedemption(store, w, r, billing, { by = "you", reason = "", now = Date.now() } = {}) {
  const invs = discountedInvoices(store, r);
  for (const inv of invs.filter((i) => i.status === "draft")) {
    inv.discount = r2(Math.max(0, (inv.discount || 0) - (inv.coupon.amount || 0)));
    inv.discount_reason = String(inv.discount_reason || "").split("; ").filter((x) => x !== `Coupon ${r.code}`).join("; ");
    delete inv.coupon;
    billing?.recalc(w, inv);
  }
  const issued = invs.filter((i) => i.number);
  r.status = issued.length ? "stopped" : "removed";
  r.ended_at = new Date(now).toISOString();
  logPush(r, by, r.status === "removed" ? `Removed before any discounted invoice${reason ? `: ${reason}` : ""}` : `Stopped: no more discounts after ${issued.length} discounted invoice${issued.length === 1 ? "" : "s"}${reason ? ` (${reason})` : ""}`, now);
  const cp = store.getOps(COLL.coupons, w.id, r.coupon_id);
  if (cp) logPush(cp, by, `${r.status === "removed" ? "Removed from" : "Stopped for"} customer #${r.customer_id}`, now);
  store.save();
  return r;
}

// ---- reports: redemptions, active customers, discount given, MRR at list price vs paid
const customerOf = (store, wsId, id) => (store.db.billing_customers || []).find((c) => c.workspace_id === String(wsId) && c.id === id) || null;
export function discountGivenSar(store, r) {
  return r2(discountedInvoices(store, r).filter((i) => i.number).reduce((a, i) => a + toSar(i.coupon.amount || 0, i.currency), 0));
}
// What the coupon takes off each month while it still runs (0 once it has ended or no longer covers the plan).
export function monthlyDiscountSar(store, c, r) {
  if (redemptionState(store, r) !== "active" || !PAYING.includes(c.status)) return 0;
  const t = r.terms, list = mrrSar(c);
  if ((t.plans.length && !t.plans.includes(c.plan)) || (t.cycles !== "both" && t.cycles !== c.cycle)) return 0;
  const per = c.cycle === "yearly" ? 12 : 1;
  const v = t.type === "percent" ? (list * t.value) / 100 : t.duration === "once" ? toSar(t.value, t.currency) / per : toSar(t.value, t.currency);
  return r2(Math.min(list, v));
}
export function redemptionRow(store, w, r, { money = false } = {}) {
  const c = customerOf(store, w.id, r.customer_id), u = usageOf(store, r);
  const row = { id: r.id, coupon_id: r.coupon_id, code: r.code, customer_id: r.customer_id, customer: c ? c.store_name : "Customer removed", customer_status: c?.status || null, partner_id: r.partner_id,
    status: redemptionState(store, r), source: r.source, redeemed_at: r.redeemed_at, redeemed_day: r.redeemed_day, by: r.by, terms: r.terms, terms_text: termsText(r.terms), invoices: u.count, months_used: u.used, sample: !!r.sample, log: r.log || [] };
  if (money) Object.assign(row, { discount_sar: discountGivenSar(store, r), mrr_list_sar: c ? mrrSar(c) : 0, mrr_paid_sar: c ? r2(mrrSar(c) - monthlyDiscountSar(store, c, r)) : 0 });
  return row;
}
export function couponReport(store, w, cp, { money = false } = {}) {
  const rows = redemptionsOf(store, cp).map((r) => redemptionRow(store, w, r, { money }));
  const out = { redemptions: rows.length, active_customers: rows.filter((x) => x.status === "active" && ["trial", ...PAYING].includes(x.customer_status)).length };
  if (money) Object.assign(out, { discount_sar: r2(rows.reduce((a, x) => a + x.discount_sar, 0)), mrr_list_sar: r2(rows.filter((x) => PAYING.includes(x.customer_status)).reduce((a, x) => a + x.mrr_list_sar, 0)),
    mrr_paid_sar: r2(rows.filter((x) => PAYING.includes(x.customer_status)).reduce((a, x) => a + x.mrr_paid_sar, 0)) });
  return { stats: out, rows };
}

// ---- Command Center: partner coupons expiring within 7 days (partner still signed or active); coupons at 90%+ of their limit
export function couponNeeds(store, w, { now = Date.now() } = {}) {
  try {
    ensurePartners(store);
    const today = todayOf(now), soon = addDays(today, EXPIRING_DAYS), out = [];
    const live = store.listOps(COLL.coupons, w.id).filter((cp) => couponState(cp, today) === "active");
    const partners = new Map(store.listOps(COLL.partners, w.id).map((p) => [p.id, p]));
    const exp = live.filter((cp) => cp.partner_id && cp.valid_until && cp.valid_until <= soon && ["signed", "active"].includes(partners.get(cp.partner_id)?.status));
    if (exp.length) out.push({ module: "Partners", route: "partners", param: "coupons", title: "Partner coupons expiring", text: `${exp.length} partner coupon${exp.length === 1 ? " expires" : "s expire"} within ${EXPIRING_DAYS} days while the partner is still active: ${exp.slice(0, 3).map((c) => `${c.code} (${c.valid_until})`).join(", ")}.` });
    const near = live.filter((cp) => cp.max_redemptions && redemptionsOf(store, cp).length >= Math.ceil(cp.max_redemptions * NEAR_LIMIT));
    if (near.length) out.push({ module: "Partners", route: "partners", param: "coupons", title: "Coupons near their limit", text: `${near.length} coupon${near.length === 1 ? " is" : "s are"} at 90% or more of the maximum redemptions: ${near.slice(0, 3).map((c) => `${c.code} (${redemptionsOf(store, c).length}/${c.max_redemptions})`).join(", ")}.` });
    return out;
  } catch (e) { console.error("[coupons] needs:", e?.message); return []; }
}

// ---- sample data: a company coupon SAMPLE-RAMADAN and one on the sample agency, redeemed by one sample customer
export function loadSampleCoupons(store, wsId, now = Date.now()) {
  ensurePartners(store);
  const id = String(wsId);
  if (store.listOps(COLL.coupons, id).some((c) => c.sample)) return { coupons: 0 };
  const today = todayOf(now), free = (c) => (couponCodeTaken(store, c) ? `${c.slice(0, 20 - id.length - 1)}-${id}` : c);
  const at = new Date(now).toISOString();
  const mk = (f) => { const cp = store.addOps(COLL.coupons, id, { partner_id: null, plans: [], cycles: "both", first_time_only: true, max_redemptions: null, valid_from: today, valid_until: null, status: "active", note: "", currency: null, months: null, sample: true, created_by: "Sample", log: [], ...f }, false); logPush(cp, "Sample", "Sample coupon added", now); return cp; };
  mk({ code: free("SAMPLE-RAMADAN"), discount_type: "percent", value: 20, duration: "months", months: 3, valid_until: addDays(today, 45), max_redemptions: 100, note: "Sample company promo code (no partner)." });
  const agency = store.listOps(COLL.partners, id).find((p) => p.sample && p.type === "agency");
  if (!agency) { store.save(); return { coupons: 1 }; }
  const pc = mk({ code: free("SAMPLE-AGENCY10"), partner_id: agency.id, discount_type: "percent", value: 10, duration: "once", note: "Sample partner coupon." });
  // One sample redemption on a sample paying customer that isn't already attributed by hand.
  const manual = new Set(store.listOps(COLL.attr, id).map((a) => a.ref_id));
  const cust = (store.db.billing_customers || []).find((c) => c.workspace_id === id && c.sample && PAYING.includes(c.status) && !manual.has(c.id));
  if (cust) store.addOps(COLL.redemptions, id, { coupon_id: pc.id, code: pc.code, partner_id: agency.id, customer_id: cust.id, terms: termsOf(pc), status: "active", source: "sample", redeemed_at: at, redeemed_day: today, by: "Sample", log: [], sample: true }, false);
  store.save();
  return { coupons: 2, redemptions: cust ? 1 : 0 };
}

// ---- the public answer for the dpa.ad signup form: discount terms only (no partner, counts or notes)
export function publicAnswer(store, code, today) {
  const cp = findCoupon(store, code);
  const live = couponLive(store, cp, today);
  const ok = live.ok && !cp.sample;
  if (!ok) {
    const rc = PUBLIC_CODE[cp?.sample && live.ok ? "sample" : live.reason_code] || "unknown_or_inactive";
    const txt = { unknown_or_inactive: REASONS.unknown, expired: REASONS.expired, not_yet_valid: REASONS.not_yet_valid, limit_reached: REASONS.limit_reached }[rc];
    return { valid: false, reason_code: rc, discount: null, plans: [], cycles: [], message: { ar: txt[1], en: txt[0] } };
  }
  const t = termsOf(cp);
  return { valid: true, reason_code: null, discount: { type: t.type, value: t.value, currency: t.currency, duration: t.duration, months: t.months },
    plans: t.plans.length ? t.plans : [...PLAN_NAMES], cycles: t.cycles === "both" ? ["monthly", "yearly"] : [t.cycles], message: { ar: termsTextAr(t), en: termsText(t) } };
}
