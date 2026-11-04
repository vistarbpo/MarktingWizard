// Partners & referrals (module "partners"): agencies, freelancers/creators, platform partners (Salla/Zid app stores,
// Salla Partners), tech partners, resellers and customers who refer customers. Each partner has an agreement
// (commission % for N recurring months, or a flat bounty on the first payment), referral codes with a link
// /r/<code> (served before the login wall: hashed IP + day for dedup, user agent family, a first-party cookie,
// a redirect only to allowlisted hosts), attribution of CRM stores, Sales deals and Billing customers (chosen by a
// person, or matched from the lead hook's `ref` field or utm_campaign), commissions computed only from Billing
// payments and credit notes, monthly statements (draft → approved by Owner/Finance → paid, posted to Finance once),
// a light read-only portal /p/<token>, and the AI Partnerships manager (level 1, drafts only).
import crypto from "node:crypto";
import { withAgent } from "./agents.js";
import { PAYING, mrrSar } from "./billing.js";
import { normEmail, normPhone, riyadhDay } from "./crm.js";

export const COLL = { partners: "partners_partners", codes: "partners_codes", clicks: "partners_clicks", attr: "partners_attributions", statements: "partners_statements", drafts: "partners_drafts", coupons: "partners_coupons", redemptions: "partners_redemptions" };
export function ensurePartners(store) {
  for (const c of Object.values(COLL)) store.db[c] ||= [];
  if (!store.db.partners_salt || typeof store.db.partners_salt !== "string") store.db.partners_salt = crypto.randomBytes(16).toString("base64url");
}
export const AGENT_ID = "partnerships_manager";
export const TYPES = [
  { id: "agency", name: "Agency" },
  { id: "freelancer", name: "Freelancer / creator" },
  { id: "platform", name: "Platform partner (Salla/Zid app store, Salla Partners)" },
  { id: "tech", name: "Tech partner" },
  { id: "reseller", name: "Reseller" },
  { id: "customer", name: "Customer referrer (customer refers customer)" },
];
export const TYPE_IDS = TYPES.map((t) => t.id);
export const STATUSES = [
  { id: "prospect", name: "Prospect" }, { id: "talking", name: "Talking" }, { id: "signed", name: "Signed" },
  { id: "active", name: "Active" }, { id: "paused", name: "Paused" }, { id: "ended", name: "Ended" },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const ST_STATUSES = ["draft", "approved", "paid", "void"];
export const DRAFT_KINDS = [
  { id: "outreach", name: "Partner outreach email" },
  { id: "onboarding", name: "Onboarding email (signed partner)" },
  { id: "update", name: "Monthly partner update" },
];
export const DRAFT_KIND_IDS = DRAFT_KINDS.map((k) => k.id);
export const DEFAULT_SETTINGS = { landing_url: "https://dpa.ad", allowed_hosts: ["dpa.ad"], cookie_days: 60, portal_show_names: false };
export const QUIET_DAYS = 30, UNPAID_DAYS = 14, CLICKS_MAX = 50000;
export const TAX_NOTE = "VAT and withholding tax on partner commissions: [CONFIRM] with the accountant (not computed here).";
const DAY = 864e5;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));
export const todayOf = (now) => riyadhDay(new Date(now));
export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// ---- settings and the redirect allowlist (no open redirect)
export function settingsOf(w) {
  const s = { ...DEFAULT_SETTINGS, ...(w?.partners || {}) };
  s.allowed_hosts = Array.isArray(s.allowed_hosts) && s.allowed_hosts.length ? s.allowed_hosts : DEFAULT_SETTINGS.allowed_hosts;
  return s;
}
export const cleanHost = (h) => { const v = String(h || "").trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, ""); return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v) ? v : ""; };
// https only, no user:password@, host equal to an allowed host or one of its subdomains.
export function hostAllowed(url, hosts) {
  let u; try { u = new URL(String(url || "")); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return (hosts || []).some((x) => { const a = cleanHost(x); return a && (h === a || h.endsWith("." + a)); });
}
export function cleanSettings(b = {}, cur = DEFAULT_SETTINGS) {
  const out = {}, err = [];
  if (b.allowed_hosts !== undefined) {
    const raw = Array.isArray(b.allowed_hosts) ? b.allowed_hosts : String(b.allowed_hosts || "").split(/[\s,]+/);
    const hosts = [...new Set(raw.map(cleanHost).filter(Boolean))].slice(0, 20);
    if (!hosts.length) err.push("allowed_hosts needs at least one host, e.g. dpa.ad"); else out.allowed_hosts = hosts;
  }
  const hosts = out.allowed_hosts || cur.allowed_hosts;
  if (b.landing_url !== undefined) { const v = str(b.landing_url, 500); if (!hostAllowed(v, hosts)) err.push("landing_url must be an https link on an allowed host"); else out.landing_url = v; }
  else if (out.allowed_hosts && !hostAllowed(cur.landing_url, hosts)) err.push("The current landing_url is not on the new allowed hosts: change it too");
  if (b.cookie_days !== undefined) { const n = Math.round(Number(b.cookie_days)); if (!(n >= 1 && n <= 365)) err.push("cookie_days must be 1–365"); else out.cookie_days = n; }
  if (b.portal_show_names !== undefined) out.portal_show_names = !!b.portal_show_names;
  return { out, err };
}
export function buildRedirect(landing, code) {
  const u = new URL(landing);
  u.searchParams.set("utm_source", "partner"); u.searchParams.set("utm_medium", "referral"); u.searchParams.set("utm_campaign", code);
  return u.toString();
}
// Where /r/<code> goes: the code's own landing page if it is still allowed, else the workspace default, else https://dpa.ad.
export function redirectFor(w, code) {
  const s = settingsOf(w);
  const target = [code?.landing_url, s.landing_url].find((u) => u && hostAllowed(u, s.allowed_hosts)) || DEFAULT_SETTINGS.landing_url;
  return code ? buildRedirect(target, code.code) : target;
}

// ---- codes
export const cleanCode = (v) => { const c = String(v ?? "").trim().toLowerCase(); return /^[a-z0-9][a-z0-9-]{2,31}$/.test(c) ? c : ""; };
export function suggestCode(name, taken = () => false) {
  const base = String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^sample-/, "").slice(0, 20) || "partner";
  for (let i = 0; i < 20; i++) { const c = cleanCode(`${base}-${crypto.randomBytes(2).toString("hex")}`) || `p-${crypto.randomBytes(3).toString("hex")}`; if (!taken(c)) return c; }
  return `p-${crypto.randomBytes(6).toString("hex")}`;
}
// Unique across the dashboard, coupon codes included (case-insensitive); a partner's own coupon may repeat its referral code.
export const codeTaken = (store, code, partnerId = null) => store.db[COLL.codes].some((c) => c.code === code)
  || (store.db[COLL.coupons] || []).some((c) => c.code.toLowerCase() === code && !(partnerId && c.partner_id === partnerId));
export const findCode = (store, code) => store.db[COLL.codes].find((c) => c.code === cleanCode(code)) || null;

// ---- clicks: no personal data beyond a hashed IP + day (for dedup) and the user agent family
export function uaFamily(ua) {
  const s = String(ua || "");
  if (!s || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|curl|wget|python|headless|monitor/i.test(s)) return "bot";
  if (/Edg\//.test(s)) return "Edge";
  if (/SamsungBrowser/.test(s)) return "Samsung";
  if (/OPR\/|Opera/.test(s)) return "Opera";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/Chrome\/|CriOS/.test(s)) return "Chrome";
  if (/Safari\//.test(s)) return "Safari";
  return "Other";
}
export const ipHash = (salt, ip, day) => crypto.createHash("sha256").update(`${salt}|${ip}|${day}`).digest("base64url").slice(0, 16);
export function recordClick(store, code, { ip, ua, now = Date.now() }) {
  ensurePartners(store);
  const fam = uaFamily(ua);
  if (fam === "bot") return { counted: false, reason: "bot" };
  const day = todayOf(now), h = ipHash(store.db.partners_salt, String(ip || ""), day);
  const rows = store.db[COLL.clicks];
  const cur = rows.find((r) => r.code_id === code.id && r.day === day && r.ip_hash === h);
  if (cur) { cur.hits = (cur.hits || 1) + 1; store.save(); return { counted: false, reason: "repeat", row: cur }; }
  const row = { id: store.newId(), workspace_id: code.workspace_id, code_id: code.id, partner_id: code.partner_id, day, ip_hash: h, ua: fam, hits: 1, at: new Date(now).toISOString(), ...(code.sample ? { sample: true } : {}) };
  rows.push(row);
  if (rows.length > CLICKS_MAX) rows.splice(0, rows.length - CLICKS_MAX);
  store.save();
  return { counted: true, row };
}

// ---- people
export function people(store) {
  return [{ id: "owner", name: "Owner" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))];
}

// ---- partner cleaning and the change log
const FIELD_LABEL = { name: "name", type: "type", status: "status", owner_id: "owner", country: "country", city: "city", notes: "notes", customer_id: "customer", crm_store_id: "Store CRM store",
  "contact.name": "contact name", "contact.email": "contact email", "contact.phone": "contact phone", "agreement.commission_pct": "commission %", "agreement.recurring_months": "recurring months",
  "agreement.bounty_sar": "flat bounty (SAR)", "agreement.tier": "tier", "contract.media_id": "contract (Studio media)", "contract.url": "contract link" };
export function cleanPartner(b = {}, { store, partial = false } = {}) {
  const out = {}, err = [];
  if (b.name !== undefined || !partial) { out.name = str(b.name, 200); if (!out.name) err.push(partial ? "name cannot be empty" : "name is required"); }
  if (b.type !== undefined || !partial) { const t = b.type ?? "agency"; if (!TYPE_IDS.includes(t)) err.push(`type must be one of ${TYPE_IDS.join(", ")}`); else out.type = t; }
  if (b.status !== undefined || !partial) { const s = b.status ?? "prospect"; if (!STATUS_IDS.includes(s)) err.push(`status must be one of ${STATUS_IDS.join(", ")}`); else out.status = s; }
  if (b.owner_id !== undefined) { const o = b.owner_id ? String(b.owner_id) : null; if (o && !people(store).some((p) => p.id === o)) err.push("Unknown owner"); else out.owner_id = o; }
  if (b.country !== undefined || !partial) out.country = str(b.country ?? "SA", 60) || "SA";
  if (b.city !== undefined) out.city = str(b.city, 80);
  if (b.notes !== undefined) out.notes = String(b.notes ?? "").slice(0, 4000);
  if (b.customer_id !== undefined) out.customer_id = b.customer_id ? str(b.customer_id, 40) : null;
  if (b.crm_store_id !== undefined) out.crm_store_id = b.crm_store_id ? str(b.crm_store_id, 40) : null;
  if (b.contact !== undefined) {
    const c = b.contact && typeof b.contact === "object" ? b.contact : {};
    const rawE = str(c.email, 200), e = normEmail(rawE), rawP = str(c.phone, 40), p = rawP ? normPhone(rawP) : "";
    if (rawE && !e) err.push("contact email is not valid");
    if (rawP && !p) err.push("contact phone is not valid");
    out.contact = { name: str(c.name, 120), email: e, phone: p };
  }
  if (b.agreement !== undefined) {
    const a = b.agreement && typeof b.agreement === "object" ? b.agreement : {};
    const pct = a.commission_pct === "" || a.commission_pct == null ? 0 : Number(a.commission_pct);
    const months = a.recurring_months === "" || a.recurring_months == null ? 0 : Math.round(Number(a.recurring_months));
    const bounty = a.bounty_sar === "" || a.bounty_sar == null ? 0 : Number(a.bounty_sar);
    if (!(pct >= 0 && pct <= 100)) err.push("commission_pct must be 0–100");
    if (!(months >= 0 && months <= 60)) err.push("recurring_months must be 0–60");
    if (!(bounty >= 0 && bounty <= 1_000_000)) err.push("bounty_sar must be 0–1,000,000");
    if (pct > 0 && months === 0) err.push("Set recurring_months (how many months of payments earn the commission)");
    out.agreement = { commission_pct: r2(pct), recurring_months: months, bounty_sar: r2(bounty), tier: str(a.tier, 40) };
  }
  if (b.contract !== undefined) {
    const c = b.contract && typeof b.contract === "object" ? b.contract : {};
    const url = str(c.url, 1000), media = c.media_id ? str(c.media_id, 40) : null;
    if (url && !/^https:\/\//i.test(url)) err.push("contract link must start with https://");
    out.contract = { media_id: media, url };
  }
  return { out, err };
}
const flat = (o, pre = "") => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
const show = (k, v) => (v === null || v === undefined || v === "" ? "–" : k === "notes" ? "(edited)" : String(v).slice(0, 80));
export function changeLines(before, after) {
  const b = Object.fromEntries(flat(before)), out = [];
  for (const [k, v] of flat(after)) if (FIELD_LABEL[k] && (b[k] ?? "") !== (v ?? "")) out.push(k === "notes" ? "notes edited" : `${FIELD_LABEL[k]}: ${show(k, b[k])} → ${show(k, v)}`);
  return out;
}
export function logPush(p, by, text, now = Date.now()) {
  p.log ||= [];
  p.log.push({ at: new Date(now).toISOString(), by, text: String(text).slice(0, 300) });
  if (p.log.length > 200) p.log.splice(0, p.log.length - 200);
}

// ---- attribution: who brought each CRM store, Sales deal and Billing customer
// Order: a person's choice (manual) > a partner's coupon (redeemed by the customer in Billing, or typed at signup and
// stored on the CRM store as coupon_code by the lead hook) > the lead hook's `ref` field / dpa_ref cookie >
// utm_campaign equal to a code; deals inherit from a store that links to them; customers inherit from their CRM store,
// then their deal. Company coupons (no partner) attribute nobody.
export function attribution(store, crm, wsId) {
  ensurePartners(store);
  const id = String(wsId);
  const codes = new Map(store.listOps(COLL.codes, id).map((c) => [c.code, c]));
  const byId = new Map(store.listOps(COLL.codes, id).map((c) => [c.id, c]));
  const coupons = new Map(store.listOps(COLL.coupons, id).filter((c) => c.partner_id).map((c) => [c.code, c]));
  const stores = new Map(), deals = new Map(), customers = new Map();
  const put = (map, key, code, source, at, row = null) => { if (code && !map.has(key)) map.set(key, { code_id: code.coupon_id ? null : code.id, code: code.code, partner_id: code.partner_id, source, at: at || null, attr_id: row?.id || null, ...(code.coupon_id ? { coupon_id: code.coupon_id } : {}) }); };
  const asCoupon = (cp, partnerId = cp.partner_id) => ({ coupon_id: cp.id, code: cp.code, partner_id: partnerId });
  const back = (a) => (a.coupon_id ? { coupon_id: a.coupon_id, code: a.code, partner_id: a.partner_id } : byId.get(a.code_id));
  for (const a of store.listOps(COLL.attr, id)) put(a.kind === "store" ? stores : a.kind === "deal" ? deals : customers, a.ref_id, byId.get(a.code_id), "manual", a.at || a.created_at, a);
  for (const r of store.listOps(COLL.redemptions, id)) if (r.partner_id && r.status !== "removed") put(customers, r.customer_id, { coupon_id: r.coupon_id, code: r.code, partner_id: r.partner_id }, "coupon", r.redeemed_at);
  const contacts = crm ? crm.contacts(id) : [];
  for (const c of contacts) {
    if (stores.has(c.id)) continue;
    if (c.coupon_code && coupons.has(c.coupon_code)) put(stores, c.id, asCoupon(coupons.get(c.coupon_code)), "coupon", c.created_at);
    else if (c.ref_code && codes.has(c.ref_code)) put(stores, c.id, codes.get(c.ref_code), "ref", c.created_at);
    else if (c.utm?.campaign && codes.has(c.utm.campaign)) put(stores, c.id, codes.get(c.utm.campaign), "utm", c.created_at);
  }
  for (const c of contacts) if (c.deal_id && stores.has(c.id) && !deals.has(c.deal_id)) put(deals, c.deal_id, back(stores.get(c.id)), "via store", stores.get(c.id).at);
  for (const c of (store.db.billing_customers || []).filter((x) => x.workspace_id === id && !x.archived)) {
    if (customers.has(c.id)) continue;
    const via = (c.crm_contact_id && stores.get(c.crm_contact_id)) || (c.deal_id && deals.get(c.deal_id));
    if (via) put(customers, c.id, back(via), via === stores.get(c.crm_contact_id) ? "via store" : "via deal", c.created_at);
  }
  // A customer referrer never earns from its own account.
  const partnersById = new Map(store.listOps(COLL.partners, id).map((p) => [p.id, p]));
  for (const [cid, a] of customers) if (partnersById.get(a.partner_id)?.customer_id === cid) customers.delete(cid);
  return { stores, deals, customers };
}
export function funnel(store, crm, w, partnerId, attr = attribution(store, crm, w.id), { money = false } = {}) {
  const clicks = store.listOps(COLL.clicks, w.id).filter((c) => c.partner_id === partnerId);
  const mine = (m) => [...m].filter(([, a]) => a.partner_id === partnerId).map(([k]) => k);
  const st = mine(attr.stores), dl = mine(attr.deals), cs = mine(attr.customers);
  const contacts = crm ? st.map((x) => crm.get(w.id, x)).filter(Boolean) : [];
  const dealFromStore = new Set(contacts.map((c) => c.deal_id).filter(Boolean));
  const custs = cs.map((x) => (store.db.billing_customers || []).find((c) => c.workspace_id === w.id && c.id === x)).filter(Boolean);
  const out = { clicks: clicks.length, hits: clicks.reduce((a, c) => a + (c.hits || 1), 0), leads: st.length + dl.filter((d) => !dealFromStore.has(d)).length,
    stores: st.length, deals: dl.length, trials: custs.filter((c) => c.status === "trial").length, paying: custs.filter((c) => PAYING.includes(c.status)).length, customers: custs.length };
  if (money) out.mrr_sar = r2(custs.reduce((a, c) => a + mrrSar(c), 0));
  return out;
}

// ---- commissions: only from Billing payments and credit notes of attributed customers (never invented)
// Percent: commission_pct of each payment before VAT, for payments in the first recurring_months months counted from
// the month of the customer's first payment. Bounty: bounty_sar once, on the first payment. Refunds: a credit note on
// an invoice whose payment earned commission takes the same percent off its amount before VAT.
export function commissionLines({ partner, customers, payments, invoices }) {
  const a = partner.agreement || {}, pct = Number(a.commission_pct) || 0, months = Number(a.recurring_months) || 0, bounty = Number(a.bounty_sar) || 0;
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const lines = [];
  for (const c of customers) {
    const pays = payments.filter((p) => p.customer_id === c.id && p.status === "paid" && isDate(p.date)).sort((x, y) => (x.date === y.date ? Number(x.id) - Number(y.id) : x.date.localeCompare(y.date)));
    if (!pays.length) continue;
    const first = pays[0].date, earned = new Set();
    if (pct > 0) for (const p of pays) {
      if (monthsBetween(first.slice(0, 7), p.date.slice(0, 7)) >= months) continue;
      const inv = invById.get(p.invoice_id);
      const net = inv?.totals?.total ? r2((p.amount_sar ?? p.amount) * (inv.totals.taxable / inv.totals.total)) : r2(p.amount_sar ?? p.amount);
      earned.add(p.invoice_id);
      lines.push({ source_id: `pay:${p.id}`, kind: "commission", date: p.date, customer_id: c.id, customer: c.store_name, base_sar: net, rate: pct, amount_sar: r2((net * pct) / 100), note: `${pct}% of payment for ${inv?.number || "invoice"} (before VAT)` });
    }
    if (bounty > 0) lines.push({ source_id: `bounty:${c.id}`, kind: "bounty", date: first, customer_id: c.id, customer: c.store_name, base_sar: null, rate: null, amount_sar: r2(bounty), note: "Flat bounty on the first payment" });
    if (pct > 0) for (const cn of invoices.filter((i) => i.kind === "credit_note" && i.customer_id === c.id && ["issued", "paid"].includes(i.status) && earned.has(i.credit_of) && isDate(i.issue_date))) {
      const orig = invById.get(cn.credit_of);
      if (!(orig?.paid_amount > 0)) continue;
      const base = r2(cn.totals_sar?.taxable ?? cn.totals?.taxable ?? 0);
      lines.push({ source_id: `credit:${cn.id}`, kind: "refund", date: cn.issue_date, customer_id: c.id, customer: c.store_name, base_sar: -base, rate: pct, amount_sar: -r2((base * pct) / 100), note: `Credit note ${cn.number || ""} on ${cn.credit_of_number || "invoice"}` });
    }
  }
  return lines.sort((x, y) => x.date.localeCompare(y.date) || x.source_id.localeCompare(y.source_id));
}
export function partnerLines(store, crm, w, partner, attr = attribution(store, crm, w.id)) {
  const ids = new Set([...attr.customers].filter(([, a]) => a.partner_id === partner.id).map(([k]) => k));
  const customers = (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && ids.has(c.id));
  return commissionLines({ partner, customers, payments: (store.db.billing_payments || []).filter((p) => p.workspace_id === w.id && ids.has(p.customer_id)),
    invoices: (store.db.billing_invoices || []).filter((i) => i.workspace_id === w.id && ids.has(i.customer_id)) });
}
export const monthEnd = (m) => `${m}-31`;
// Lines for a month's statement: everything dated in or before that month that no other live statement holds yet
// (a payment recorded late goes on the next statement instead of being lost).
export function statementLines(store, w, partnerId, month, all, exceptId = null) {
  const held = new Set(store.listOps(COLL.statements, w.id).filter((s) => s.partner_id === partnerId && s.status !== "void" && s.id !== exceptId).flatMap((s) => s.lines.map((l) => l.source_id)));
  return all.filter((l) => l.date.slice(0, 7) <= month && !held.has(l.source_id));
}
export const totalOf = (lines) => r2(lines.reduce((a, l) => a + l.amount_sar, 0));

// ---- AI Partnerships manager: drafts only
const numbersIn = (s) => (String(s || "").match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ""));
export function draftFacts(w, p, { link, stats = null, statement = null, month = null }) {
  const a = p.agreement || {};
  const f = { company: w.brief?.company_name || "DPA AD", partner: p.name, type: TYPES.find((t) => t.id === p.type)?.name || p.type, contact: p.contact?.name || "", link,
    commission_pct: a.commission_pct || 0, recurring_months: a.recurring_months || 0, bounty_sar: a.bounty_sar || 0, tier: a.tier || "" };
  if (stats) Object.assign(f, { month, clicks: stats.clicks, leads: stats.leads, trials: stats.trials, paying: stats.paying });
  if (statement) Object.assign(f, { statement_month: statement.month, statement_total_sar: statement.total_sar, statement_status: statement.status });
  return f;
}
export function draftFallback(kind, f) {
  const name = f.contact || "[ADD الاسم]", nameEn = f.contact || "[ADD name]";
  const terms = f.commission_pct ? `${f.commission_pct}% لمدة ${f.recurring_months} شهر` : f.bounty_sar ? `${f.bounty_sar} ريال عن كل عميل يدفع أول مرة` : "[ADD الشروط]";
  const termsEn = f.commission_pct ? `${f.commission_pct}% for ${f.recurring_months} months` : f.bounty_sar ? `SAR ${f.bounty_sar} for each customer's first payment` : "[ADD terms]";
  if (kind === "outreach") return { subject: `${f.company} × ${f.partner} · شراكة / Partnership`,
    body: `هلا ${name}،\n\nأنا [ADD الاسم] من ${f.company}. نحوّل كتالوج متاجر سلة وزد إلى إعلانات صور وفيديو جاهزة لميتا وسناب وتيك توك وقوقل.\nنشوف إن ${f.partner} يخدم متاجر نقدر نفيدها، ونبي نتكلم عن شراكة إحالة.\n[ADD سبب مختصر ليش هالشريك بالذات]\n\nيناسبك مكالمة ١٥ دقيقة هالأسبوع؟\n\nتحياتي،\n[ADD الاسم]\n${f.company}\n\n---\n\nHi ${nameEn},\n\nI'm [ADD name] from ${f.company}. We turn Salla and Zid store catalogs into ready image and video ads for Meta, Snap, TikTok and Google.\n${f.partner} works with stores we can help, and we'd like to talk about a referral partnership.\n[ADD one line on why this partner]\n\nWould a 15-minute call this week work?\n\nBest regards,\n[ADD name]\n${f.company}` };
  if (kind === "onboarding") return { subject: `أهلاً بك في شركاء ${f.company} / Welcome to the ${f.company} partner program`,
    body: `هلا ${name}،\n\nحياك الله في برنامج شركاء ${f.company}.\nرابط الإحالة الخاص فيك: ${f.link}\nالشروط المتفق عليها: ${terms}.\n\nالخطوات الجاية:\n- شارك الرابط مع المتاجر اللي تخدمها\n- [ADD مواد التسويق أو العرض التقديمي]\n- كشف العمولة يوصلك كل شهر\n\nأي سؤال، رد على هذا الإيميل.\n\nتحياتي،\n[ADD الاسم]\n${f.company}\n\n---\n\nHi ${nameEn},\n\nWelcome to the ${f.company} partner program.\nYour referral link: ${f.link}\nAgreed terms: ${termsEn}.\n\nNext steps:\n- Share the link with the stores you work with\n- [ADD marketing kit or deck]\n- You'll get a commission statement every month\n\nAny question, just reply to this email.\n\nBest regards,\n[ADD name]\n${f.company}` };
  const st = f.statement_month ? `كشف ${f.statement_month}: ${f.statement_total_sar} ريال (${f.statement_status})` : "كشف هذا الشهر: [ADD]";
  const stEn = f.statement_month ? `Statement ${f.statement_month}: SAR ${f.statement_total_sar} (${f.statement_status})` : "This month's statement: [ADD]";
  return { subject: `${f.company} · تحديث الشركاء ${f.month || ""} / Partner update`.replace(/\s+/g, " "),
    body: `هلا ${name}،\n\nهذا ملخص ${f.month || "[ADD الشهر]"} لرابطك ${f.link}:\n- النقرات: ${f.clicks ?? "[ADD]"}\n- المتاجر المهتمة: ${f.leads ?? "[ADD]"}\n- تجارب مجانية: ${f.trials ?? "[ADD]"}\n- عملاء يدفعون: ${f.paying ?? "[ADD]"}\n- ${st}\n\n[ADD ملاحظة أو خطوة للشهر الجاي]\n\nتحياتي،\n[ADD الاسم]\n${f.company}\n\n---\n\nHi ${nameEn},\n\nHere is ${f.month || "[ADD month]"} for your link ${f.link}:\n- Clicks: ${f.clicks ?? "[ADD]"}\n- Interested stores: ${f.leads ?? "[ADD]"}\n- Free trials: ${f.trials ?? "[ADD]"}\n- Paying customers: ${f.paying ?? "[ADD]"}\n- ${stEn}\n\n[ADD a note or next step for next month]\n\nBest regards,\n[ADD name]\n${f.company}` };
}
export function draftPrompt(kind, f) {
  const job = { outreach: "a first partner outreach email inviting them to a referral partnership", onboarding: "an onboarding email for a partner who just signed: their link, the agreed terms, next steps",
    update: "the monthly partner update: their link's results this month and their statement" }[kind];
  return `<task title="Partner email: ${kind}">
You are DPA AD's AI Partnerships manager. Write ${job}. First in Saudi Arabic dialect (friendly, professional), then the same in English under a line "---".
DPA AD turns Salla/Zid store catalogs into designed image and video ads for Meta, Snap, TikTok and Google.
Rules: use only the facts below; never add numbers, prices, results, customer names, promises or dates that aren't there; write [ADD] where something is missing; no unsubscribe text (added when sent).
Reply with JSON only: {"subject": "...", "body": "..."}
</task>
<facts>
${Object.entries(f).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`).join("\n")}
</facts>`;
}
export function checkDraft(raw, f) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(raw || ""))?.[0] || "null"); } catch { j = null; }
  if (!j || typeof j.subject !== "string" || typeof j.body !== "string" || !j.body.trim()) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const allowed = new Set([...Object.values(f).flatMap(numbersIn), "15"]);
  const bad = [...new Set(numbersIn(`${j.subject} ${j.body}`))].filter((n) => !allowed.has(n) && !allowed.has(n.replace(/\.0+$/, "")));
  if (bad.length) return { ok: false, issue: `The AI's email had numbers that aren't in the facts (${bad.slice(0, 5).join(", ")}).` };
  return { ok: true, subject: j.subject.trim().slice(0, 200), body: j.body.trim().slice(0, 6000) };
}

export function createPartners({ store, provider, workforce = null, clock = () => Date.now() } = {}) {
  ensurePartners(store);
  const svc = { clock };
  const now = () => svc.clock();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  async function draft(w, kind, facts) {
    const fb = draftFallback(kind, facts);
    if (level() === 0) return { ...fb, by_ai: false, note: "The AI Partnerships manager is switched off in AI Workforce: this is the plain template." };
    try {
      const out = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: draftPrompt(kind, facts), onText: () => {} }));
      const c = checkDraft(out, facts);
      if (c.ok) return { subject: c.subject, body: c.body, by_ai: true, note: "" };
      workforce?.event(AGENT_ID, w.id, "escalated", `${kind} for "${String(facts.partner).slice(0, 60)}": ${c.issue} Template used.`);
      return { ...fb, by_ai: false, note: `${c.issue} This is the plain template instead: fill in every [ADD].` };
    } catch (e) { return { ...fb, by_ai: false, note: /switched off|budget/i.test(e?.message || "") ? e.message : "The AI couldn't be reached: this is the plain template." }; }
  }
  return Object.assign(svc, { now, level, draft });
}

// ---- Command Center: statements waiting for approval, signed partners quiet for 30 days, approved statements unpaid after 14 days.
export function partnersNeeds(store, crm, w, { now = Date.now() } = {}) {
  try {
    ensurePartners(store);
    const out = [], sts = store.listOps(COLL.statements, w.id);
    const drafts = sts.filter((s) => s.status === "draft");
    if (drafts.length) out.push({ module: "Partners", route: "partners", param: "statements", title: "Partner statements to approve", text: `${drafts.length} partner statement${drafts.length === 1 ? " is" : "s are"} waiting for approval by an Owner or Finance.` });
    const late = sts.filter((s) => s.status === "approved" && s.approved_at && Date.parse(s.approved_at) < now - UNPAID_DAYS * DAY);
    if (late.length) out.push({ module: "Partners", route: "partners", param: "statements", title: "Approved statements not paid", text: `${late.length} approved partner statement${late.length === 1 ? " has" : "s have"} been waiting more than ${UNPAID_DAYS} days for payment: ${late.slice(0, 3).map((s) => `${s.partner_name} ${s.month}`).join(", ")}.` });
    const cut = now - QUIET_DAYS * DAY, attr = attribution(store, crm, w.id);
    const lastAttr = new Map();
    for (const m of [attr.stores, attr.deals, attr.customers]) for (const a of m.values()) { const t = Date.parse(a.at || "") || 0; if (t > (lastAttr.get(a.partner_id) || 0)) lastAttr.set(a.partner_id, t); }
    const lastClick = new Map();
    for (const c of store.listOps(COLL.clicks, w.id)) { const t = Date.parse(c.at || "") || 0; if (t > (lastClick.get(c.partner_id) || 0)) lastClick.set(c.partner_id, t); }
    const quiet = store.listOps(COLL.partners, w.id).filter((p) => ["signed", "active"].includes(p.status) && Date.parse(p.status_at || p.created_at) < cut
      && Math.max(lastAttr.get(p.id) || 0, lastClick.get(p.id) || 0) < cut);
    if (quiet.length) out.push({ module: "Partners", route: "partners", param: "list", title: "Quiet partners", text: `${quiet.length} signed partner${quiet.length === 1 ? " has" : "s have"} had no clicks or referrals in ${QUIET_DAYS} days: ${quiet.slice(0, 3).map((p) => p.name.slice(0, 40)).join(", ")}.` });
    return out;
  } catch (e) { console.error("[partners] needs:", e?.message); return []; }
}

// ---- sample data ("Sample ·", removed with Remove sample data)
export function loadSamplePartners(store, crm, wsId, now = Date.now()) {
  ensurePartners(store);
  const id = String(wsId);
  if (store.listOps(COLL.partners, id).some((p) => p.sample)) return { partners: 0 };
  const at = (d) => new Date(now - d * DAY).toISOString();
  const mk = (f) => {
    const p = store.addOps(COLL.partners, id, { country: "SA", city: "", owner_id: "owner", notes: "", customer_id: null, crm_store_id: null, contract: { media_id: null, url: "" }, portal_token: null, sample: true, log: [], ...f }, false);
    p.created_at = at(60); p.status_at = at(45); logPush(p, "Sample", "Sample partner added", now - 60 * DAY);
    const code = store.addOps(COLL.codes, id, { partner_id: p.id, code: suggestCode(f.name, (c) => codeTaken(store, c)), landing_url: "", active: true, sample: true, created_by: "Sample" }, false);
    return { p, code };
  };
  const a = mk({ name: "Sample · Riyadh Growth Agency", type: "agency", status: "active", contact: { name: "Sample contact", email: "", phone: "" }, city: "Riyadh",
    agreement: { commission_pct: 20, recurring_months: 12, bounty_sar: 0, tier: "Gold" } });
  const b = mk({ name: "Sample · Salla Partners listing", type: "platform", status: "talking", contact: { name: "", email: "", phone: "" },
    agreement: { commission_pct: 0, recurring_months: 0, bounty_sar: 300, tier: "" } });
  // A few days of sample clicks (hashed placeholders, not real visitors).
  [[a, [5, 3, 2, 1]], [b, [2, 1]]].forEach(([x, days]) => days.forEach((d, i) => store.db[COLL.clicks].push({ id: store.newId(), workspace_id: id, code_id: x.code.id, partner_id: x.p.id, day: todayOf(now - d * DAY), ip_hash: `sample${i}${x.p.id}`, ua: i % 2 ? "Safari" : "Chrome", hits: 1, at: at(d), sample: true })));
  // One draft statement for the agency on a sample customer (a sample line, not a real payment).
  const cust = (store.db.billing_customers || []).find((c) => c.workspace_id === id && c.sample && PAYING.includes(c.status));
  if (cust) store.addOps(COLL.attr, id, { kind: "customer", ref_id: cust.id, code_id: a.code.id, partner_id: a.p.id, by: "Sample", sample: true }, false);
  const month = todayOf(now).slice(0, 7), base = cust ? r2(mrrSar(cust)) : 1000;
  const lines = [{ source_id: `sample:${a.p.id}`, kind: "commission", date: `${month}-01`, customer_id: cust?.id || null, customer: cust?.store_name || "Sample · customer", base_sar: base, rate: 20, amount_sar: r2(base * 0.2), note: "Sample line (no real payment)" }];
  store.addOps(COLL.statements, id, { partner_id: a.p.id, partner_name: a.p.name, month, status: "draft", lines, total_sar: totalOf(lines), currency: "SAR", tax_note: TAX_NOTE, created_by: "Sample", log: [{ at: at(0), by: "Sample", text: "Sample draft statement" }], sample: true }, false);
  store.save();
  return { partners: 2 };
}
export function removeSamplePartners(store, wsId) {
  ensurePartners(store);
  const id = String(wsId);
  const ps = new Set(store.db[COLL.partners].filter((p) => p.workspace_id === id && p.sample).map((p) => p.id));
  const counts = {};
  for (const [k, c] of Object.entries(COLL)) {
    const b = store.db[c].length;
    store.db[c] = store.db[c].filter((x) => !(x.workspace_id === id && (x.sample || (k !== "partners" && ps.has(x.partner_id)) || (k === "partners" && ps.has(x.id)))));
    counts[k] = b - store.db[c].length;
  }
  for (const e of (store.db.finance_expenses || []).filter((x) => x.workspace_id === id && x.source === "partners" && x.sample)) store.db.finance_expenses = store.db.finance_expenses.filter((y) => y !== e);
  return { partners: counts.partners, partner_codes: counts.codes, partner_clicks: counts.clicks, partner_statements: counts.statements, partner_coupons: counts.coupons, partner_redemptions: counts.redemptions };
}

// ---- the public portal page /p/<token> (read-only; counts only unless names are allowed)
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function portalHtml({ company, partner, links, stats, statements, names }) {
  const sar = (n) => `SAR ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const tiles = [["النقرات · Clicks", stats.clicks], ["متاجر مهتمة · Leads", stats.leads], ["تجارب · Trials", stats.trials], ["عملاء يدفعون · Paying", stats.paying]];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${h(company)} · Partner</title>
<style>:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#111;--muted:#666;--border:#e5e5e5}@media(prefers-color-scheme:dark){:root{--bg:#121212;--card:#1c1c1c;--text:#eee;--muted:#aaa;--border:#333}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Tahoma,sans-serif;background:var(--bg);color:var(--text);padding:16px}main{max-width:760px;margin:0 auto;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-width:0;overflow-wrap:anywhere}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tile b{display:block;font-size:28px;margin-top:4px}.muted{color:var(--muted);font-size:14px}code{background:var(--bg);padding:6px 8px;border-radius:8px;display:inline-block;direction:ltr;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 4px;border-top:1px solid var(--border);text-align:start}</style></head><body><main>
<div class="card"><h1 style="margin:0;font-size:22px" dir="auto">${h(partner.name)}</h1><p class="muted">بوابة الشريك من ${h(company)} · Partner portal (read-only)</p>
${links.map((l) => `<p><code>${h(l)}</code></p>`).join("") || `<p class="muted">لا يوجد رابط بعد · No link yet</p>`}</div>
<div class="tiles">${tiles.map(([l, v]) => `<div class="card tile"><span class="muted">${h(l)}</span><b>${h(v)}</b></div>`).join("")}</div>
${names && names.length ? `<div class="card"><h2 style="margin:0 0 8px;font-size:17px">العملاء · Customers</h2>${names.map((n) => `<div dir="auto">${h(n)}</div>`).join("")}</div>` : ""}
<div class="card"><h2 style="margin:0 0 8px;font-size:17px">كشوف العمولة · Statements</h2>${statements.length ? `<table><thead><tr><th>Month</th><th>Total</th><th>Status</th><th>Paid</th></tr></thead><tbody>${statements.map((s) => `<tr><td>${h(s.month)}</td><td>${h(sar(s.total_sar))}</td><td>${h(s.status)}</td><td>${h(s.paid_date || "–")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">لا توجد كشوف بعد · No statements yet</p>`}</div>
</main></body></html>`;
}
