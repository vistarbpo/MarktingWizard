// HTTP routes for coupons (Partners & referrals, module "partners"; applying them is Billing, module "billing").
// Before the login wall (mountCouponsPublic): GET /hooks/coupon/<code> for the dpa.ad signup form: rate-limited,
// CORS only for the partners allowlist (default dpa.ad and its subdomains), discount terms only.
// mountCoupons: /api/workspaces/:ws/partners/coupons/... (list, create, edit, pause, delete, redemptions, reports) and
// /api/workspaces/:ws/billing/customers/:id/coupon (preview, apply, remove). Percent above 50 or "forever" needs the
// Owner. Money (discount given, MRR at list price vs paid) only with Billing or Finance view.
import { levelOk } from "./access.js";
import { COLL, ensurePartners, hostAllowed, logPush, settingsOf, todayOf } from "./partners.js";
import { DURATIONS, OWNER_PCT, PLAN_NAMES, REASONS, activeRedemption, checkRedeem, cleanCoupon, cleanCouponCode, couponChanges, couponCodeTaken, couponReport, couponState, findCoupon, needsOwner,
  previewNext, publicAnswer, redeem, redemptionRow, removeRedemption, suggestCoupon, termsOf, termsText, usageOf } from "./coupons.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isOwner = (req) => req.user?.id === "owner" || req.user?.role_id === "owner";

// What Billing's routes use to redeem a coupon when a customer is created (typed in, or the CRM store's coupon_code).
export function createCouponService({ store, billing, partners }) {
  ensurePartners(store);
  const today = () => todayOf(partners.now());
  const check = (w, cust, code) => {
    const cp = findCoupon(store, code, w.id);
    const r = checkRedeem(store, w, cust, cp, today());
    return r.ok ? { ok: true, coupon: cp } : r;
  };
  const apply = (w, c, cp, { by = "you", source = "billing" } = {}) => redeem(store, w, c, cp, { by, source, now: partners.now() });
  function summary(w, c) {
    const all = store.listOps(COLL.redemptions, w.id).filter((r) => r.customer_id === c.id && r.status !== "removed");
    const r = all.find((x) => x.status === "active") || all.at(-1);
    if (!r) return null;
    const row = redemptionRow(store, w, r, { money: true }), p = r.partner_id ? store.getOps(COLL.partners, w.id, r.partner_id) : null;
    const u = usageOf(store, r);
    return { ...row, partner: p ? p.name : null, preview: row.status === "active" ? previewNext(store, w, c, r.terms, billing.vatRate(w), u) : null,
      can_remove: ["active", "ended"].includes(row.status), first_invoice_done: u.count > 0 };
  }
  return { check, apply, summary, today };
}

export function mountCouponsPublic(app, { store, partners }) {
  ensurePartners(store);
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return list.length > max;
  };
  // CORS: the partners allowlist of every workspace (default dpa.ad and its subdomains), https only.
  const cors = (req, res) => {
    const origin = String(req.headers.origin || "");
    res.setHeader("Vary", "Origin");
    const hosts = [...new Set(store.listWorkspaces().flatMap((w) => settingsOf(w).allowed_hosts))];
    if (origin && hostAllowed(origin, hosts.length ? hosts : ["dpa.ad"]) && !/\/./.test(origin.replace(/^https:\/\//, ""))) {
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Access-Control-Allow-Methods", "GET"); res.setHeader("Access-Control-Max-Age", "600");
    }
  };
  app.options("/hooks/coupon/:code", (req, res) => { cors(req, res); res.status(204).end(); });
  app.get("/hooks/coupon/:code", (req, res) => {
    cors(req, res);
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex"); res.setHeader("Referrer-Policy", "no-referrer");
    if (limited("cp:" + req.ip, 30, 10 * 60e3)) return res.status(429).json({ detail: "Too many requests. Please try again in a few minutes." });
    res.json(publicAnswer(store, String(req.params.code || "").slice(0, 40), todayOf(partners.now())));
  });
}

export function mountCoupons(app, { store, billing, partners, coupons }) {
  ensurePartners(store);
  const P = "/api/workspaces/:ws/partners/coupons";
  const B = "/api/workspaces/:ws/billing/customers/:id/coupon";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const can = (req, mod, lvl = "view") => levelOk(req.perms?.[mod], lvl);
  const money = (req) => can(req, "billing") || can(req, "finance");
  const by = (req) => req.user?.name || "you";
  const now = () => partners.now();
  const today = () => todayOf(now());
  const via = (req) => (req.headers["x-mwiz-via"] === "assistant" ? " via Ask DPA AD" : "");
  const partnerName = (w, id) => (id ? store.getOps(COLL.partners, w.id, id)?.name || "Partner removed" : null);
  const view = (req, w, cp, { full = false } = {}) => {
    const rep = couponReport(store, w, cp, { money: money(req) });
    const out = { ...cp, state: couponState(cp, today()), not_yet_valid: !!(cp.valid_from && today() < cp.valid_from), terms_text: termsText(termsOf(cp)), partner_name: partnerName(w, cp.partner_id), stats: rep.stats, owner_only: needsOwner(cp) };
    if (full) out.redemptions = rep.rows; else delete out.log;
    return out;
  };
  const getC = (req, res, w) => { const c = store.getOps(COLL.coupons, w.id, req.params.cid); if (!c) res.status(404).json({ detail: "Coupon not found" }); return c; };
  const ownerRule = (req, res, c) => {
    if (needsOwner(c) && !isOwner(req)) { res.status(403).json({ detail: `Only the Owner can create or set a coupon above ${OWNER_PCT}% or one that lasts forever.` }); return false; }
    return true;
  };
  const partnerOk = (w, id) => !id || !!store.getOps(COLL.partners, w.id, id);
  const redeemed = (cp) => store.listOps(COLL.redemptions, cp.workspace_id).some((r) => r.coupon_id === cp.id && r.status !== "removed");

  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    let list = store.listOps(COLL.coupons, w.id);
    if (req.query.partner_id) list = list.filter((c) => c.partner_id === String(req.query.partner_id));
    if (req.query.state) list = list.filter((c) => couponState(c, today()) === req.query.state);
    res.json({ coupons: list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((c) => view(req, w, c)), money: money(req), owner: isOwner(req), edit: can(req, "partners", "edit"),
      plans: PLAN_NAMES, durations: DURATIONS, owner_pct: OWNER_PCT, today: today(), partners: store.listOps(COLL.partners, w.id).map((p) => ({ id: p.id, name: p.name, status: p.status })) });
  });
  app.get(`${P}/suggest`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = store.getOps(COLL.partners, w.id, req.query.partner_id);
    if (!p) return res.status(404).json({ detail: "Partner not found" });
    res.json({ code: suggestCoupon(store, p.id) });
  });
  app.post(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanCoupon(req.body || {});
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (!partnerOk(w, out.partner_id)) return res.status(422).json({ detail: "Unknown partner." });
    const taken = couponCodeTaken(store, out.code, { partnerId: out.partner_id });
    if (taken) return res.status(409).json({ detail: taken === "referral" ? "That code is another partner's referral code. Pick another." : "That code is taken. Pick another." });
    if (!ownerRule(req, res, out)) return;
    const cp = store.addOps(COLL.coupons, w.id, { currency: null, months: null, ...out, created_by: by(req), created_by_id: req.user.id, log: [] }, false);
    logPush(cp, by(req), `Coupon created: ${termsText(termsOf(cp))}${cp.partner_id ? ` for partner "${String(partnerName(w, cp.partner_id)).slice(0, 60)}"` : " (company coupon)"}${via(req)}`, now());
    if (cp.partner_id) { const p = store.getOps(COLL.partners, w.id, cp.partner_id); if (p) logPush(p, by(req), `Coupon ${cp.code} created`, now()); }
    store.save();
    res.locals.audit = `created coupon ${cp.code} (${termsText(termsOf(cp))})`;
    res.status(201).json(view(req, w, cp, { full: true }));
  });
  app.get(`${P}/:cid`, (req, res) => { const w = W(req, res); if (!w) return; const c = getC(req, res, w); if (c) res.json(view(req, w, c, { full: true })); });
  app.put(`${P}/:cid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const cp = getC(req, res, w); if (!cp) return;
    const { out, err } = cleanCoupon(req.body || {}, { partial: true, cur: cp });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const used = redeemed(cp);
    if (used && out.code !== undefined && out.code !== cp.code) return res.status(409).json({ detail: "Customers redeemed this code: it can't be renamed. Make a new coupon instead." });
    if (used && out.partner_id !== undefined && out.partner_id !== cp.partner_id) return res.status(409).json({ detail: "Customers redeemed this coupon: its partner can't change (attribution and commissions would move). Make a new coupon instead." });
    if (!partnerOk(w, out.partner_id)) return res.status(422).json({ detail: "Unknown partner." });
    if (out.code && out.code !== cp.code) { const taken = couponCodeTaken(store, out.code, { exceptId: cp.id, partnerId: out.partner_id !== undefined ? out.partner_id : cp.partner_id }); if (taken) return res.status(409).json({ detail: "That code is taken. Pick another." }); }
    const merged = { ...cp, ...out };
    const touches = ["discount_type", "value", "duration"].some((k) => out[k] !== undefined && out[k] !== cp[k]);
    if (touches && !ownerRule(req, res, merged)) return;
    const lines = couponChanges(cp, out);
    Object.assign(cp, out, { updated_at: new Date(now()).toISOString() });
    for (const l of lines) logPush(cp, by(req), l, now());
    if (used && lines.some((l) => /^(type|value|currency|duration|months|plans|cycles)/.test(l))) logPush(cp, by(req), "Customers who already redeemed keep the terms they redeemed; the change applies to new redemptions", now());
    store.save();
    res.locals.audit = `changed coupon ${cp.code}${lines.length ? `: ${lines.join("; ").slice(0, 100)}` : ""}`;
    res.json(view(req, w, cp, { full: true }));
  });
  app.delete(`${P}/:cid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const cp = getC(req, res, w); if (!cp) return;
    if (redeemed(cp)) return res.status(409).json({ detail: "Customers redeemed this coupon: pause it instead (they keep their discount)." });
    store.db[COLL.redemptions] = store.db[COLL.redemptions].filter((r) => r.coupon_id !== cp.id);
    store.deleteOps(COLL.coupons, w.id, cp.id);
    res.locals.audit = `deleted coupon ${cp.code}`;
    res.json({ ok: true });
  });

  // ---- Billing: a coupon on a customer (Billing view to preview; Billing Edit to apply or remove)
  const cust = (req, res, w) => { const c = billing.getCustomer(w.id, req.params.id); if (!c) res.status(404).json({ detail: "Customer not found" }); return c; };
  app.get(`${B}/preview`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = cust(req, res, w); if (!c) return;
    const code = cleanCouponCode(req.query.code);
    const r = coupons.check(w, c, code || "");
    if (!r.ok) return res.json({ ok: false, reason_code: r.reason_code, reason: r.reason, reason_ar: r.reason_ar, current: coupons.summary(w, c) });
    res.json({ ok: true, code: r.coupon.code, terms: termsText(termsOf(r.coupon)), partner: partnerName(w, r.coupon.partner_id), preview: previewNext(store, w, c, termsOf(r.coupon), billing.vatRate(w)), current: coupons.summary(w, c) });
  });
  app.post(B, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = cust(req, res, w); if (!c) return;
    const r = coupons.check(w, c, req.body?.code || "");
    if (!r.ok) return res.status(422).json({ detail: r.reason, reason_code: r.reason_code, reason_ar: r.reason_ar });
    const red = coupons.apply(w, c, r.coupon, { by: by(req), source: "billing" });
    billing.event(c, "coupon", `Coupon ${r.coupon.code}: ${termsText(red.terms)}`, by(req)); store.save();
    res.locals.audit = `applied coupon ${r.coupon.code} to customer ${String(c.store_name).slice(0, 60)}`;
    res.status(201).json(coupons.summary(w, c));
  });
  app.delete(B, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = cust(req, res, w); if (!c) return;
    const r = activeRedemption(store, w.id, c.id);
    if (!r) return res.status(404).json({ detail: "This customer has no active coupon." });
    const out = removeRedemption(store, w, r, billing, { by: by(req), reason: str(req.body?.reason, 200), now: now() });
    billing.event(c, "coupon", out.status === "removed" ? `Coupon ${r.code} removed` : `Coupon ${r.code} stopped (no more discounts)`, by(req)); store.save();
    res.locals.audit = `${out.status === "removed" ? "removed" : "stopped"} coupon ${r.code} on customer ${String(c.store_name).slice(0, 60)}`;
    res.json({ status: out.status, current: coupons.summary(w, c) });
  });
}
export { REASONS };
