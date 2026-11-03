// Investor room (access module "investors", route "investors"): a light investors CRM (funds and angels with stage,
// check size, thesis, warm-intro path, owner, next step, linked Meetings and data-room documents), the round tracker,
// the metrics pack (live metrics read from the modules' own functions, frozen by a person into a snapshot that never
// changes afterwards), the data room (folders of items that point at Legal documents, frozen snapshots, approved
// investor updates, uploaded files and links), per-investor share links /i/<token> (expiry, optional hashed passcode,
// allowed folders and items, download yes/no, revocable; every view logged with a hashed IP + day and the browser
// family only), engagement, Command Center needs and the monthly investor update drafted by the AI Investor relations
// agent (level 1, drafts only: every number must come from the cited sources, otherwise a factual draft with [ADD]).
//
// Never invent numbers, customers, quotes or traction: a metric with no data says "No data yet" (never 0 or an
// estimate); valuation and cap fields are typed by a person and stay marked [CONFIRM] until a person confirms them;
// the lowlights are always written by the founder.
// Uploaded data-room files use the Legal module's private storage (DATA_DIR/legal, saveLegalUpload), so they are in
// every backup and are never under the public /media/ path.
import crypto from "node:crypto";
import fs from "node:fs";
import { checkPassword, hashPassword } from "./access.js";
import { withAgent } from "./agents.js";
import { addDays } from "./billing.js";
import { riyadhDay } from "./crm.js";
import { CATEGORIES } from "./finance.js";
import { numbersIn, parseJson } from "./helpcenter.js";
import { COLL as LEGAL, canSeeRestricted, currentVersion, legalPath } from "./legal.js";
import { COLL as OKR, METRICS as OKR_METRICS, metricContext, objectiveView, quarterOf } from "./okr.js";
import { ipHash, uaFamily } from "./partners.js";
import { SAR_PER_USD, summary as salesSummary } from "./sales.js";
import { hasSampleData } from "./samples.js";
import { npsOf } from "./success.js";

export const COLL = { investors: "investors_investors", rounds: "investors_rounds", snapshots: "investors_snapshots", items: "investors_items", links: "investors_links", views: "investors_views", updates: "investors_updates" };
export function ensureInvestors(store) {
  for (const c of Object.values(COLL)) store.db[c] ||= [];
  if (!store.db.investors_salt) store.db.investors_salt = crypto.randomBytes(18).toString("base64url"); // for hashed IPs and passcode cookies
}
export const AGENT_ID = "investor_relations";
export const NO_DATA = "No data yet";
export const CONFIRM = "[CONFIRM]";

export const STAGES = [
  { id: "target", name: "Target" }, { id: "intro", name: "Intro" }, { id: "first_call", name: "First call" }, { id: "diligence", name: "Diligence" },
  { id: "term_sheet", name: "Term sheet" }, { id: "committed", name: "Committed" }, { id: "passed", name: "Passed" },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const CLOSED = ["committed", "passed"];
export const KINDS = [{ id: "fund", name: "VC fund" }, { id: "angel", name: "Angel" }, { id: "corporate", name: "Corporate / CVC" }, { id: "accelerator", name: "Accelerator" }, { id: "family_office", name: "Family office" }, { id: "other", name: "Other" }];
export const KIND_IDS = KINDS.map((k) => k.id);
export const FOLDERS = [{ id: "company", name: "Company" }, { id: "financials", name: "Financials" }, { id: "product", name: "Product" }, { id: "legal", name: "Legal" }, { id: "team", name: "Team" }, { id: "market", name: "Market" }];
export const FOLDER_IDS = FOLDERS.map((f) => f.id);
export const ITEM_KINDS = [{ id: "legal_doc", name: "Legal document" }, { id: "snapshot", name: "Metrics snapshot" }, { id: "update", name: "Investor update" }, { id: "file", name: "Uploaded file" }, { id: "link", name: "Link" }];
export const ITEM_KIND_IDS = ITEM_KINDS.map((k) => k.id);
export const INSTRUMENTS = [{ id: "safe", name: "SAFE" }, { id: "convertible", name: "Convertible note" }, { id: "priced", name: "Priced equity round" }, { id: "other", name: "Other" }];
export const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id);
export const ROUND_STATUS = [{ id: "planning", name: "Planning" }, { id: "open", name: "Open" }, { id: "closed", name: "Closed" }];
export const ROUND_STATUS_IDS = ROUND_STATUS.map((s) => s.id);
export const TERM_FIELDS = ["valuation_cap_usd", "pre_money_usd", "discount_pct"]; // typed by a person, [CONFIRM] until confirmed
export const LINK_MAX_DAYS = 365, EXPIRING_DAYS = 3, VIEWS_MAX = 20000;
export const VIEWER_INLINE = ["pdf", "png", "jpg", "txt"];

const DAY = 864e5;
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const todayOf = (now) => riyadhDay(new Date(now));
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const money = (v) => { if (v === undefined) return undefined; if (v === null || v === "") return null; const n = Number(String(v).replace(/[,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };
export const stageName = (id) => STAGES.find((s) => s.id === id)?.name || id;
export const folderName = (id) => FOLDERS.find((f) => f.id === id)?.name || id;
export const monthName = (m) => { try { return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`)); } catch { return m; } };
export function people(store) { return [{ id: "owner", name: "Owner" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))]; }
export const personName = (store, id) => (id ? people(store).find((p) => p.id === id)?.name || "Removed person" : "");

// ---- investors
export function cleanInvestor(b = {}, { store, wsId, partial = false } = {}) {
  const o = {}, err = [];
  if (!partial || b.name !== undefined) { o.name = str(b.name, 160); if (!o.name) err.push("name is required"); }
  if (!partial || b.kind !== undefined) { o.kind = b.kind === undefined ? "fund" : String(b.kind); if (!KIND_IDS.includes(o.kind)) err.push(`kind must be one of ${KIND_IDS.join(", ")}`); }
  if (!partial || b.stage !== undefined) { o.stage = b.stage === undefined ? "target" : String(b.stage); if (!STAGE_IDS.includes(o.stage)) err.push(`stage must be one of ${STAGE_IDS.join(", ")}`); }
  for (const k of ["firm", "website"]) if (b[k] !== undefined) o[k] = str(b[k], 200);
  if (o.website && !/^https?:\/\/[^\s]+$/i.test(o.website)) err.push("website must start with https://");
  for (const k of ["thesis", "intro_path", "next_step", "pass_reason"]) if (b[k] !== undefined) o[k] = str(b[k], 2000);
  if (b.contact !== undefined) {
    const c = b.contact || {};
    o.contact = { name: str(c.name, 120), email: str(c.email, 200).toLowerCase(), phone: str(c.phone, 40) };
    if (o.contact.email && !emailOk(o.contact.email)) err.push("contact email is not valid");
  }
  for (const k of ["check_min_usd", "check_max_usd", "committed_usd"]) if (b[k] !== undefined) { const n = money(b[k]); if (Number.isNaN(n)) err.push(`${k} must be a number of USD (0 or more)`); else o[k] = n; }
  if (o.check_min_usd != null && o.check_max_usd != null && o.check_min_usd > o.check_max_usd) err.push("check_min_usd is more than check_max_usd");
  if (b.next_step_date !== undefined) { const v = b.next_step_date ? String(b.next_step_date) : ""; if (v && !isDay(v)) err.push("next_step_date must be YYYY-MM-DD"); else o.next_step_date = v || null; }
  if (b.owner_id !== undefined) { const id = b.owner_id ? String(b.owner_id) : null; if (id && store && !people(store).some((p) => p.id === id)) err.push("owner_id is not a person in Teams & roles"); else o.owner_id = id; }
  if (b.round_id !== undefined) { const id = b.round_id ? String(b.round_id) : null; if (id && store && !store.getOps(COLL.rounds, wsId, id)) err.push("round_id is not a round"); else o.round_id = id; }
  if (b.meeting_ids !== undefined) {
    const ids = [...new Set((Array.isArray(b.meeting_ids) ? b.meeting_ids : []).map(String))].slice(0, 50);
    const bad = store ? ids.filter((id) => !(store.db.meetings_meetings || []).some((m) => m.workspace_id === String(wsId) && m.id === id)) : [];
    if (bad.length) err.push(`meeting_ids not found: ${bad.join(", ")}`); else o.meeting_ids = ids;
  }
  if (b.document_ids !== undefined) {
    const ids = [...new Set((Array.isArray(b.document_ids) ? b.document_ids : []).map(String))].slice(0, 50);
    const bad = store ? ids.filter((id) => !store.getOps(COLL.items, wsId, id)) : [];
    if (bad.length) err.push(`document_ids must be data room items: ${bad.join(", ")}`); else o.document_ids = ids;
  }
  return { o, err };
}
// Committed = the amounts a person typed on investors at the Committed stage (nothing is computed or assumed).
export function roundTotals(store, wsId, roundId) {
  const inv = store.listOps(COLL.investors, wsId).filter((i) => i.round_id === roundId);
  const committed = inv.filter((i) => i.stage === "committed");
  return { committed_usd: Math.round(committed.reduce((a, i) => a + (Number(i.committed_usd) || 0), 0) * 100) / 100, committed_count: committed.length,
    committed_missing: committed.filter((i) => i.committed_usd == null).length, in_play: inv.filter((i) => !CLOSED.includes(i.stage)).length, investors: inv.length };
}
export function cleanRound(b = {}, { partial = false } = {}) {
  const o = {}, err = [];
  if (!partial || b.name !== undefined) { o.name = str(b.name, 120); if (!o.name) err.push("name is required"); }
  if (!partial || b.instrument !== undefined) { o.instrument = b.instrument === undefined ? "safe" : String(b.instrument); if (!INSTRUMENT_IDS.includes(o.instrument)) err.push(`instrument must be one of ${INSTRUMENT_IDS.join(", ")}`); }
  if (!partial || b.status !== undefined) { o.status = b.status === undefined ? "planning" : String(b.status); if (!ROUND_STATUS_IDS.includes(o.status)) err.push(`status must be one of ${ROUND_STATUS_IDS.join(", ")}`); }
  for (const k of ["target_usd", ...TERM_FIELDS]) if (b[k] !== undefined) { const n = money(b[k]); if (Number.isNaN(n)) err.push(`${k} must be a number (0 or more)`); else o[k] = n; }
  if (o.discount_pct != null && o.discount_pct > 100) err.push("discount_pct must be 100 or less");
  if (b.notes !== undefined) o.notes = str(b.notes, 4000);
  if (b.close_date !== undefined) { const v = b.close_date ? String(b.close_date) : ""; if (v && !isDay(v)) err.push("close_date must be YYYY-MM-DD"); else o.close_date = v || null; }
  return { o, err };
}
export function roundView(store, r) {
  const typed = TERM_FIELDS.filter((k) => r[k] != null);
  return { ...r, ...roundTotals(store, r.workspace_id, r.id), terms_confirmed: !!r.terms_confirmed && typed.length > 0, terms_flag: typed.length && !r.terms_confirmed ? CONFIRM : "" };
}

// ---- the metrics pack: live values read from each module's own functions. null = "No data yet", never 0 or an estimate.
const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const sar = (n) => `SAR ${Math.round(n).toLocaleString("en-US")}`;
const pct = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const round1 = (n) => Math.round(n * 10) / 10;
export const PACK = [
  { id: "mrr_sar", name: "MRR", unit: "SAR", group: "Revenue" },
  { id: "arr_usd", name: "ARR", unit: "USD", group: "Revenue" },
  { id: "mrr_growth_mom_pct", name: "MRR growth (month on month)", unit: "%", group: "Revenue" },
  { id: "paying_stores", name: "Paying stores", unit: "count", group: "Revenue" },
  { id: "nrr_30d_pct", name: "Net revenue retention (last 30 days)", unit: "%", group: "Retention" },
  { id: "logo_churn_30d_pct", name: "Logo churn (last 30 days)", unit: "%", group: "Retention" },
  { id: "nps_90d", name: "NPS (last 90 days)", unit: "score", group: "Retention" },
  { id: "gross_margin_pct", name: "Gross margin", unit: "%", group: "Efficiency" },
  { id: "cac_sar", name: "CAC (cost to win a store)", unit: "SAR", group: "Efficiency" },
  { id: "ltv_sar", name: "LTV (lifetime gross profit per store)", unit: "SAR", group: "Efficiency" },
  { id: "ltv_cac", name: "LTV : CAC", unit: "ratio", group: "Efficiency" },
  { id: "cash_sar", name: "Cash in bank", unit: "SAR", group: "Cash" },
  { id: "gross_burn_sar", name: "Gross burn (monthly costs)", unit: "SAR", group: "Cash" },
  { id: "net_burn_sar", name: "Net burn", unit: "SAR", group: "Cash" },
  { id: "runway_months", name: "Runway", unit: "months", group: "Cash" },
  { id: "pipeline_usd", name: "Sales pipeline (open deals)", unit: "USD", group: "Growth" },
  { id: "releases_30d", name: "Product releases shipped (last 30 days)", unit: "count", group: "Product" },
  { id: "headcount", name: "Team", unit: "people", group: "Team" },
];
export const PACK_IDS = PACK.map((m) => m.id);
export const fmtValue = (v, unit) => (v == null ? NO_DATA : unit === "SAR" ? sar(v) : unit === "USD" ? usd(v) : unit === "%" ? pct(v) : unit === "months" ? `${round1(v)} months` : unit === "ratio" ? `${round1(v)} : 1` : unit === "score" ? String(v) : Number(v).toLocaleString("en-US"));

export function liveMetrics({ store, crm = null, w, agentsActive = null, now = Date.now() }) {
  const id = String(w.id), ctx = metricContext({ store, crm, w, now }), today = ctx.today, tomorrow = addDays(today, 1);
  const okr = (mid, to = tomorrow) => { const d = OKR_METRICS.find((m) => m.id === mid); try { const v = d ? d.at(ctx, to) : null; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); } catch { return null; } };
  const fin = ctx.fin(), customers = ctx.customers(), billing = customers.length > 0;
  const source = fin.revenue.source; // billing | billed | estimated | none
  const mrrKnown = billing || source === "billed";
  const expenses = store.listExpenses(id), cash = store.listCash(id);
  const cogsIds = new Set(CATEGORIES.filter((c) => c.cogs).map((c) => c.id));
  const hasCogs = expenses.some((e) => cogsIds.has(e.category) && Number(e.amount_sar) > 0);
  const mkt = fin.costs.by_category.find((c) => c.id === "marketing")?.month || 0;
  const revSrc = billing ? "Billing: subscriptions (MRR from each customer's plan)" : "Finance: recurring income logged";
  const noRevenue = source === "estimated" ? "Sales has paying deals but no income is logged and there are no Billing customers: an estimate isn't shown here." : "No Billing customers and no recurring income logged in Finance.";
  const v = {};
  v.mrr_sar = mrrKnown ? { value: okr("mrr_sar"), source: revSrc } : { note: noRevenue };
  v.arr_usd = mrrKnown ? { value: okr("arr_usd"), source: `${revSrc}; MRR × 12 ÷ ${SAR_PER_USD}` } : { note: noRevenue };
  if (billing) {
    const cur = okr("mrr_sar"), prev = okr("mrr_sar", addDays(tomorrow, -30));
    v.mrr_growth_mom_pct = prev > 0 && cur != null ? { value: round1(((cur - prev) / prev) * 100), source: "Billing: MRR today vs 30 days ago (subscription event log)" } : { note: "No MRR 30 days ago to compare with." };
  } else v.mrr_growth_mom_pct = { note: "Needs Billing customers: only Billing keeps MRR history." };
  v.paying_stores = billing ? { value: okr("paying_stores"), source: "Billing: customers with MRR" } : fin.revenue.paying > 0 ? { value: fin.revenue.paying, source: "Sales: deals at the Paying stage" } : { note: "No paying stores in Billing or Sales yet." };
  v.nrr_30d_pct = billing ? { value: okr("nrr_30d_pct"), source: "Billing: MRR now of stores paying 30 days ago ÷ their MRR then", note: okr("nrr_30d_pct") == null ? "No stores were paying 30 days ago." : "" } : { note: "Needs Billing customers." };
  v.logo_churn_30d_pct = billing ? { value: okr("logo_churn_30d_pct"), source: "Billing: stores paying 30 days ago that pay nothing now", note: okr("logo_churn_30d_pct") == null ? "No stores were paying 30 days ago." : "" } : { note: "Needs Billing customers." };
  const answers = store.listOps("success_responses", id).filter((r) => r.kind === "nps" && r.answered_at && r.answered_at >= new Date(Date.parse(`${addDays(tomorrow, -90)}T00:00:00Z`) - 3 * 3600e3).toISOString());
  const nps = okr("nps_90d");
  v.nps_90d = nps == null ? { note: "No NPS answers in the last 90 days (Customer success)." } : { value: nps, source: `Customer success: NPS answers (${npsOf(answers.map((r) => r.score)).n || answers.length} in 90 days)` };
  v.gross_margin_pct = !mrrKnown ? { note: noRevenue } : !hasCogs ? { note: "No cost of revenue logged in Finance (hosting, rendering, AI): a margin without costs would be misleading." } : fin.gross_margin == null ? { note: "No MRR this month." } : { value: fin.gross_margin, source: "Finance: (MRR − cost of revenue this month) ÷ MRR" };
  v.cac_sar = mkt > 0 && fin.unit.cac_sar != null && fin.unit.new_paying_30d > 0 ? { value: fin.unit.cac_sar, source: "Finance unit economics: marketing spend this month ÷ stores that reached Paying in the last 30 days" } : { note: mkt > 0 ? "No store reached Paying in the last 30 days." : "No marketing spend logged in Finance this month." };
  v.ltv_sar = mrrKnown && hasCogs && fin.unit.ltv_sar != null ? { value: fin.unit.ltv_sar, source: `Finance unit economics: monthly gross profit per store ÷ monthly churn (the ${fin.unit.churn_pct}% set in Finance settings)`, note: "Uses the churn rate set in Finance settings, not measured churn." } : { note: "Needs MRR and cost of revenue in Finance." };
  v.ltv_cac = v.ltv_sar.value != null && v.cac_sar.value ? { value: round1(v.ltv_sar.value / v.cac_sar.value), source: "Finance unit economics: LTV ÷ CAC" } : { note: "Needs both LTV and CAC." };
  v.cash_sar = cash.length ? { value: fin.cash.balance_sar, source: "Finance: latest bank balance", as_of: fin.cash.as_of } : { note: "No bank balance in Finance." };
  v.gross_burn_sar = expenses.length ? { value: fin.costs.month_burn_sar, source: "Finance: recurring costs + one-off spend this month" } : { note: "No expenses logged in Finance." };
  v.net_burn_sar = !expenses.length ? { note: "No expenses logged in Finance." } : source === "estimated" ? { note: noRevenue } : { value: fin.costs.net_burn_sar, source: "Finance: monthly costs − revenue this month" };
  v.runway_months = !cash.length || !expenses.length ? { note: "Needs a bank balance and expenses in Finance." } : source === "estimated" ? { note: noRevenue }
    : fin.runway_months == null ? { display: "Not burning", source: "Finance: revenue covers monthly costs", as_of: fin.cash.as_of } : { value: fin.runway_months, source: "Finance: cash ÷ net burn", as_of: fin.cash.as_of };
  const sales = salesSummary(store.listDeals(id), [], now);
  v.pipeline_usd = sales.open_count ? { value: sales.open_value, display: `${usd(sales.open_value)} · ${sales.open_count} open deal${sales.open_count === 1 ? "" : "s"}`, source: "Sales: open deals at plan list price (not weighted by stage)" } : { note: "No open deals in Sales." };
  const rel = store.listOps("product_releases", id).filter((r) => r.status === "released" && isDay(r.date));
  const from = addDays(today, -29);
  const cl = store.listOps("changelog_entries", id).filter((e) => e.status === "published" && e.date >= from && e.date <= today).length;
  v.releases_30d = rel.length ? { value: rel.filter((r) => r.date >= from && r.date <= today).length, source: `Product: releases marked released${cl ? ` (${cl} changelog entr${cl === 1 ? "y" : "ies"} published)` : ""}` } : { note: "No releases marked released in Product yet." };
  const humans = store.listHrRoles(id).filter((r) => r.kind === "human" && r.status === "active").length;
  const payroll = store.listOps("people_employees", id).filter((e) => (!e.doj || e.doj <= today) && (!e.exit_date || e.exit_date >= today)).length;
  v.headcount = humans || payroll ? { value: humans, display: `${humans} ${humans === 1 ? "person" : "people"}${agentsActive != null ? ` · ${agentsActive} AI agent${agentsActive === 1 ? "" : "s"}` : ""}`,
    source: `Team & hiring: active human roles${agentsActive != null ? "; AI Workforce: active agents" : ""}${payroll ? `; ${payroll} on India payroll (Attendance & payroll)` : ""}` } : { note: "No active human roles in Team & hiring." };
  return PACK.map((m) => {
    const x = v[m.id] || {};
    const value = x.value == null || !Number.isFinite(Number(x.value)) ? null : Number(x.value);
    return { id: m.id, name: m.name, unit: m.unit, group: m.group, value, display: x.display || fmtValue(value, m.unit), source: x.source || "", note: x.note || "", as_of: x.as_of || today, no_data: value == null && !x.display };
  });
}
export const includesSample = (store, wsId) => hasSampleData(store, wsId) || (store.db.billing_customers || []).some((c) => c.workspace_id === String(wsId) && c.sample);

// ---- data room items
export const cleanUrl = (v) => { const s = str(v, 1000); return /^https:\/\/[^\s<>"']+$/i.test(s) ? s : ""; };
export function itemTarget(store, w, it) {
  if (it.kind === "legal_doc") {
    const d = store.getOps(LEGAL.docs, w.id, it.ref_id);
    if (!d) return { ok: false, reason: "The legal document was deleted." };
    if (d.confidentiality === "restricted" && !it.restricted) return { ok: false, reason: "The document is now restricted: add it again with \"share restricted\" ticked." };
    const v = currentVersion(d);
    if (!v || !legalPath(store, v.file) || !fs.existsSync(legalPath(store, v.file))) return { ok: false, reason: "The document has no file." };
    return { ok: true, doc: d, file: { file: v.file, ext: v.ext, mime: v.mime, size: v.size, name: v.name } };
  }
  if (it.kind === "file") return it.file && legalPath(store, it.file.file) && fs.existsSync(legalPath(store, it.file.file)) ? { ok: true, file: it.file } : { ok: false, reason: "The file is missing on the server." };
  if (it.kind === "snapshot") { const s = store.getOps(COLL.snapshots, w.id, it.ref_id); return s ? { ok: true, snapshot: s } : { ok: false, reason: "The snapshot was deleted." }; }
  if (it.kind === "update") { const u = store.getOps(COLL.updates, w.id, it.ref_id); return u && u.status === "approved" ? { ok: true, update: u } : { ok: false, reason: "The update is not approved." }; }
  if (it.kind === "link") return it.url ? { ok: true } : { ok: false, reason: "No link." };
  return { ok: false, reason: "Unknown item." };
}
export const removeItemFile = (store, it) => { if (it.kind === "file" && it.file) { const p = legalPath(store, it.file.file); if (p) fs.rmSync(p, { force: true }); } };

// ---- share links
export const newToken = () => crypto.randomBytes(24).toString("base64url");
export function cleanLink(b = {}, { store, wsId, today, partial = false } = {}) {
  const o = {}, err = [];
  if (!partial) { o.investor_id = str(b.investor_id, 40); if (!store.getOps(COLL.investors, wsId, o.investor_id)) err.push("investor_id is not an investor"); }
  if (!partial || b.expires_on !== undefined) {
    const v = String(b.expires_on || "");
    if (!isDay(v)) err.push("expires_on must be a date (YYYY-MM-DD)");
    else if (v < today) err.push("expires_on is in the past");
    else if (daysBetween(today, v) > LINK_MAX_DAYS) err.push(`a link can last at most ${LINK_MAX_DAYS} days`);
    else o.expires_on = v;
  }
  if (!partial || b.folders !== undefined) { const f = [...new Set((Array.isArray(b.folders) ? b.folders : []).map(String))]; const bad = f.filter((x) => !FOLDER_IDS.includes(x)); if (bad.length) err.push(`unknown folders: ${bad.join(", ")}`); else o.folders = f; }
  if (!partial || b.item_ids !== undefined) { const ids = [...new Set((Array.isArray(b.item_ids) ? b.item_ids : []).map(String))]; const bad = ids.filter((x) => !store.getOps(COLL.items, wsId, x)); if (bad.length) err.push(`unknown data room items: ${bad.join(", ")}`); else o.item_ids = ids; }
  if (!partial || b.download !== undefined) o.download = !!b.download;
  if (b.passcode !== undefined && b.passcode !== null && b.passcode !== "") { const p = String(b.passcode); if (p.length < 4 || p.length > 64) err.push("passcode must be 4 to 64 characters"); else o.passcode = hashPassword(p); }
  if (b.label !== undefined) o.label = str(b.label, 120);
  if (!partial && !err.length && !o.folders.length && !o.item_ids.length) err.push("pick at least one folder or item to share");
  return { o, err };
}
export const linkState = (l, today) => (l.revoked_at ? "revoked" : l.expires_on < today ? "expired" : "active");
export const linkItems = (store, wsId, l) => store.listOps(COLL.items, wsId).filter((it) => (l.folders || []).includes(it.folder) || (l.item_ids || []).includes(it.id));
export const passcodeOk = (l, given) => !l.passcode || checkPassword(String(given || ""), l.passcode);
// The cookie that remembers a passcode for one link: a keyed hash of the token and the passcode's salt, so changing the passcode or revoking ends it.
export const passCookie = (store, l) => crypto.createHmac("sha256", store.db.investors_salt).update(`${l.token}|${l.passcode?.salt || ""}`).digest("base64url").slice(0, 32);
export function logView(store, l, { item = null, action = "view", ip = "", ua = "", now = Date.now() }) {
  ensureInvestors(store);
  const day = todayOf(now);
  const row = { id: store.newId(), workspace_id: l.workspace_id, link_id: l.id, investor_id: l.investor_id, item_id: item ? item.id : null, action, at: new Date(now).toISOString(), day, ip_hash: ipHash(store.db.investors_salt, String(ip || ""), day), ua: uaFamily(ua), ...(l.sample ? { sample: true } : {}) };
  store.db[COLL.views].push(row);
  if (store.db[COLL.views].length > VIEWS_MAX) store.db[COLL.views].splice(0, store.db[COLL.views].length - VIEWS_MAX);
  l.last_view_at = row.at;
  store.save();
  return row;
}
// Per investor and per item: views (page views of the room and of items), opens and downloads of files, first and last view.
export function engagement(store, wsId, { investorId = null } = {}) {
  const views = store.listOps(COLL.views, wsId).filter((v) => !investorId || v.investor_id === investorId);
  const by = new Map();
  for (const v of views) {
    const k = `${v.investor_id}|${v.item_id || ""}`;
    const r = by.get(k) || { investor_id: v.investor_id, item_id: v.item_id, views: 0, opens: 0, downloads: 0, first_at: v.at, last_at: v.at, browsers: new Set() };
    if (v.action === "download") r.downloads++; else if (v.action === "open") r.opens++; else r.views++;
    if (v.at < r.first_at) r.first_at = v.at; if (v.at > r.last_at) r.last_at = v.at;
    r.browsers.add(v.ua); by.set(k, r);
  }
  return [...by.values()].map((r) => ({ ...r, browsers: [...r.browsers] })).sort((a, b) => b.last_at.localeCompare(a.last_at));
}

// ---- Command Center: data room viewed today, links expiring within 3 days, next steps overdue
export function investorsNeeds(store, w, { now = Date.now() } = {}) {
  try {
    ensureInvestors(store);
    const today = todayOf(now), out = [], inv = new Map(store.listOps(COLL.investors, w.id).map((i) => [i.id, i]));
    const todays = new Map();
    for (const v of store.listOps(COLL.views, w.id).filter((x) => x.day === today)) todays.set(v.investor_id, (todays.get(v.investor_id) || 0) + 1);
    for (const [id, n] of [...todays].slice(0, 3)) { const i = inv.get(id); if (i) out.push({ module: "Investors", route: "investors", param: "engagement", title: "Data room viewed", text: `${i.name} viewed the data room today (${n} view${n === 1 ? "" : "s"}).` }); }
    const soon = store.listOps(COLL.links, w.id).filter((l) => linkState(l, today) === "active" && daysBetween(today, l.expires_on) <= EXPIRING_DAYS).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
    if (soon.length) out.push({ module: "Investors", route: "investors", param: "links", title: "Share links expiring", text: `${soon.length} data room link${soon.length === 1 ? "" : "s"} expire${soon.length === 1 ? "s" : ""} within ${EXPIRING_DAYS} days: ${soon.slice(0, 3).map((l) => `${inv.get(l.investor_id)?.name || "investor"} (${l.expires_on})`).join(", ")}. Extend or let ${soon.length === 1 ? "it" : "them"} lapse.` });
    const late = [...inv.values()].filter((i) => !CLOSED.includes(i.stage) && i.next_step_date && i.next_step_date < today).sort((a, b) => a.next_step_date.localeCompare(b.next_step_date));
    if (late.length) out.push({ module: "Investors", route: "investors", param: "pipeline", title: "Investor next steps overdue", text: `${late.length} investor${late.length === 1 ? " has" : "s have"} a next step past its date: ${late.slice(0, 3).map((i) => `${i.name} (${i.next_step || "next step"}, ${i.next_step_date})`).join("; ")}.` });
    return out;
  } catch (e) { console.error("[investors] needs:", e?.message); return []; }
}

// ---- the monthly investor update (AI Investor relations agent, level 1: drafts only)
const REF_RE = /\[((?:[SOWCPHR]\d+)(?:\s*,\s*[SOWCPHR]\d+)*)\]/g;
export const stripRefs = (s) => String(s || "").replace(/\s*\[(?:[SOWCPHR]\d+)(?:\s*,\s*[SOWCPHR]\d+)*\]/g, "");
const inMonth = (iso, m) => String(iso || "").slice(0, 7) === m;
export function updateSources(store, w, { month, snapshot, now = Date.now() }) {
  const id = String(w.id), out = [];
  const add = (prefix, kind, text) => { const n = out.filter((x) => x.ref.startsWith(prefix)).length + 1; out.push({ ref: `${prefix}${n}`, kind, text: String(text).replace(/\s+/g, " ").trim().slice(0, 1500) }); };
  for (const m of snapshot.metrics) if (m.value != null || m.display !== NO_DATA) add("S", "metric", `${m.name}: ${m.display} (source: ${m.source || "–"}; as of ${m.as_of})`);
  try {
    const q = quarterOf(Date.parse(`${month}-15T12:00:00Z`)), ctx = metricContext({ store, w, now });
    for (const o of (store.db[OKR.objectives] || []).filter((x) => x.workspace_id === id && x.quarter === q && ["active", "closed"].includes(x.status) && x.level === "company")) {
      const v = objectiveView(store, ctx, o, null, { now });
      add("O", "okr", `Objective (${q}, ${o.status}): ${o.title}${v.progress != null ? `; progress ${v.progress}%` : ""}. Key results: ${v.krs.map((k) => `${k.title}: ${k.current ?? "–"} of ${k.target ?? "–"}${k.unit ? ` ${k.unit}` : ""}`).join("; ") || "none"}`);
    }
  } catch (e) { console.error("[investors] okr sources:", e?.message); }
  for (const r of (store.db[OKR.wbrs] || []).filter((x) => x.workspace_id === id && x.status !== "draft" && inMonth(x.week_start, month))) add("W", "wbr", `Weekly business review, week of ${r.week_start}: ${stripRefs(String(r.narrative || "").replace(/\[[A-Z]\d+\]/g, ""))}`);
  for (const e of store.listOps("changelog_entries", id).filter((x) => x.status === "published" && inMonth(x.date, month))) add("C", "changelog", `Changelog (${e.type}, ${e.date}): ${e.title_en || e.title_ar}`);
  for (const r of store.listOps("product_releases", id).filter((x) => x.status === "released" && inMonth(x.date, month))) add("P", "release", `Product release ${r.version} shipped on ${r.date}`);
  const roles = new Map(store.listHrRoles(id).map((r) => [r.id, r]));
  for (const c of store.listHrCandidates(id).filter((x) => x.stage === "hired" && inMonth(x.stage_changed_at, month))) add("H", "hire", `Hire: ${roles.get(String(c.role_id))?.title || "a new team member"}`);
  for (const e of store.listOps("people_employees", id).filter((x) => inMonth(x.doj, month))) add("H", "hire", `Joined on ${e.doj}: ${e.designation || "a new team member"}`);
  for (const r of store.listHrRoles(id).filter((x) => x.kind === "human" && ["open", "planned"].includes(x.status))) add("R", "role", `Open role: ${r.title}${r.location ? ` (${r.location})` : ""}`);
  return out;
}
export function updatePrompt(w, { month, snapshot, sources }) {
  return `<task title="Investor update">
You are DPA AD's AI Investor relations agent. Draft two sections of the monthly investor update of ${w.brief?.company_name || "DPA AD"} for ${monthName(month)}: HIGHLIGHTS and ASKS. The metrics table, the lowlights and every decision are written by people.
Rules:
- Use ONLY the sources below. Never invent numbers, customers, investors, deals, partnerships, quotes, plans, dates or traction.
- End every bullet with the references it comes from, in square brackets, e.g. "... [C1]" or "... [S2, O1]".
- Every number you write must be copied exactly from a source you cite. Don't compute growth, totals, averages or percentages.
- Highlights: what shipped, who joined, progress on goals, metrics, in plain English, short, factual. No hype words.
- Asks: only from the open roles [R..] (introductions to candidates). If there are none, return an empty list.
- No lowlights: the founder writes them. No HTML. No markdown headings.
- ${snapshot.sample ? "The metrics are SAMPLE data: say so in the first highlight." : "The metrics come from a frozen snapshot."}
Reply with JSON only: {"highlights":["..."],"asks":["..."]}
</task>
<sources>
${sources.map((s) => `[${s.ref}] ${s.text}`).join("\n").slice(0, 14000)}
</sources>`;
}
const normNum = (n) => n.replace(/\.0+$/, "");
// Each bullet must cite known sources and every number in it must be in the sources it cites.
export function checkUpdate(raw, sources) {
  const j = parseJson(raw);
  if (!j || !Array.isArray(j.highlights) || !Array.isArray(j.asks) || ![...j.highlights, ...j.asks].every((x) => typeof x === "string")) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const hl = j.highlights.map((x) => x.trim()).filter(Boolean).slice(0, 12), asks = j.asks.map((x) => x.trim()).filter(Boolean).slice(0, 8);
  if (!hl.length) return { ok: false, issue: "The AI wrote no highlights." };
  for (const line of [...hl, ...asks]) {
    if (/<\s*\/?\s*[a-z][^>]*>/i.test(line)) return { ok: false, issue: "The AI's update had HTML in it." };
    const refs = [...line.matchAll(REF_RE)].flatMap((m) => m[1].split(/\s*,\s*/));
    if (!refs.length) return { ok: false, issue: "A bullet in the AI's update didn't cite its source." };
    const unknown = refs.filter((r) => !byRef.has(r));
    if (unknown.length) return { ok: false, issue: `The AI's update cited sources that don't exist (${[...new Set(unknown)].join(", ")}).` };
    const allowed = new Set(refs.flatMap((r) => numbersIn(byRef.get(r).text).map(normNum)));
    const bad = numbersIn(stripRefs(line)).map(normNum).filter((n) => !allowed.has(n));
    if (bad.length) return { ok: false, issue: `The AI's update had numbers that aren't in the sources it cites (${[...new Set(bad)].slice(0, 5).join(", ")}).` };
  }
  return { ok: true, highlights: hl.map((x) => x.slice(0, 600)), asks: asks.map((x) => x.slice(0, 400)) };
}
// The factual draft: each source as it is, [ADD] where a person must write.
export function ruleUpdate(sources) {
  const of = (k) => sources.filter((s) => s.kind === k);
  const hl = [...of("release"), ...of("changelog"), ...of("hire"), ...of("okr")].map((s) => `${s.text} [${s.ref}]`);
  for (const s of of("wbr")) hl.push(`${s.text.split(":")[0]}: [ADD the takeaway] [${s.ref}]`);
  if (!hl.length) hl.push("[ADD] The month's highlights");
  const asks = of("role").map((s) => `Introductions to candidates for the ${s.text.replace(/^Open role:\s*/, "")} role [${s.ref}]`);
  asks.push("[ADD] Anything else you need from investors (introductions to customers, partners, hires or advisers)");
  return { highlights: hl, asks };
}
export function composeUpdate(w, { month, snapshot, highlights, asks }) {
  const company = w.brief?.company_name || "DPA AD";
  const metrics = snapshot.metrics.map((m) => `- **${m.name}**: ${m.display}${m.no_data ? "" : ` (${m.source || "–"}; as of ${m.as_of})`}`);
  return [`# ${company} · Investor update · ${monthName(month)}`, "",
    ...(snapshot.sample ? ["> SAMPLE: built from sample data. These are not real numbers.", ""] : []),
    "## Highlights", ...highlights.map((x) => `- ${x}`), "",
    "## Metrics", `From the frozen metrics pack "${snapshot.label}", as of ${snapshot.as_of}.`, "", ...metrics, "",
    "## Lowlights", "- [ADD] What didn't go to plan this month, and what you are changing. The founder writes this section; the AI never does.", "",
    "## Asks", ...asks.map((x) => `- ${x}`), ""].join("\n");
}
export const hasAdd = (t) => /\[ADD\b/i.test(String(t || ""));
// The parts the AI writes (highlights and asks): kept unchanged = "accepted", changed = "edited" (the lowlights are always the founder's).
export const aiParts = (t) => ["Highlights", "Asks"].map((name) => {
  const lines = String(t || "").split("\n"), i = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (i < 0) return "";
  const end = lines.findIndex((l, n) => n > i && /^## /.test(l));
  return lines.slice(i + 1, end < 0 ? undefined : end).join("\n").trim();
}).join("\n---\n");

export function createInvestors({ store, provider, workforce = null, clock = () => Date.now() } = {}) {
  ensureInvestors(store);
  const svc = { clock };
  const now = () => svc.clock();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  async function draftUpdate(w, { month, snapshot }) {
    const sources = updateSources(store, w, { month, snapshot, now: now() });
    const factual = (note) => { const r = ruleUpdate(sources); return { text: composeUpdate(w, { month, snapshot, ...r }), by_ai: false, note, sources }; };
    if (level() === 0) return factual("The AI Investor relations agent is switched off in AI Workforce: this is the factual draft from the sources. Fill in every [ADD].");
    try {
      const raw = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: updatePrompt(w, { month, snapshot, sources }), onText: () => {} }));
      const c = checkUpdate(raw, sources);
      if (!c.ok) {
        workforce?.event(AGENT_ID, w.id, "escalated", `Investor update ${month}: ${c.issue} Factual draft used.`);
        return factual(`${c.issue} This is the factual draft from the sources instead: fill in every [ADD].`);
      }
      return { text: composeUpdate(w, { month, snapshot, highlights: c.highlights, asks: c.asks }), by_ai: true, note: "", sources };
    } catch (e) {
      return factual(/switched off|budget/i.test(e?.message || "") ? `${e.message} This is the factual draft from the sources.` : "The AI couldn't be reached: this is the factual draft from the sources.");
    }
  }
  return Object.assign(svc, { now, level, draftUpdate });
}

// ---- data requests (PDPL): investor contacts by email or phone. Round records and amounts stay.
export function investorsFind(store, m) {
  return (store.db[COLL.investors] || []).filter((i) => m.emailIs(i.contact?.email) || m.phoneIs(i.contact?.phone));
}
export function investorsExport(store, ids) {
  return ids.map((id) => { const i = store.db[COLL.investors].find((x) => x.id === id); return i && { name: i.name, kind: i.kind, firm: i.firm || "", contact: i.contact || null, stage: i.stage, thesis: i.thesis || "", intro_path: i.intro_path || "", next_step: i.next_step || "", notes: (i.notes || []).map((n) => ({ at: n.at, text: n.text })) }; }).filter(Boolean);
}
export function investorsErase(store, ids, redact) {
  let n = 0;
  for (const id of ids) {
    const i = store.db[COLL.investors].find((x) => x.id === id); if (!i) continue;
    i.contact = { name: "", email: "", phone: "" };
    for (const k of ["thesis", "intro_path", "next_step"]) i[k] = redact(i[k]);
    for (const x of i.notes || []) x.text = redact(x.text);
    (i.log ||= []).push({ at: new Date().toISOString(), by: "compliance", text: "Contact details deleted on a data request" });
    n++;
  }
  return n;
}

// ---- sample data: two "Sample ·" investors and one frozen snapshot labelled sample (computed from the sample data, not typed)
export function loadSampleInvestors(store, w, { agentsActive = null, crm = null, now = Date.now() } = {}) {
  ensureInvestors(store);
  const id = String(w.id);
  if (store.listOps(COLL.investors, id).some((i) => i.sample)) return { investors: 0 };
  const today = todayOf(now), at = new Date(now).toISOString();
  const base = { firm: "", website: "", contact: { name: "", email: "", phone: "" }, check_min_usd: null, check_max_usd: null, committed_usd: null, owner_id: "owner", round_id: null, meeting_ids: [], document_ids: [], notes: [], pass_reason: "", sample: true, created_by: "Sample" };
  store.addOps(COLL.investors, id, { ...base, name: "Sample · Najd Angels", kind: "angel", stage: "first_call", thesis: "Sample: early-stage Saudi software (illustration only).", intro_path: "Sample: introduced by a founder friend [ADD the real path]", next_step: "Send the data room link", next_step_date: addDays(today, -2), log: [{ at, by: "Sample", text: "Sample investor added" }] }, false);
  store.addOps(COLL.investors, id, { ...base, name: "Sample · Gulf Seed Fund", kind: "fund", stage: "intro", thesis: "Sample: seed-stage commerce and marketing tools in the GCC (illustration only).", intro_path: "Sample: [ADD]", next_step: "Book the first call", next_step_date: addDays(today, 5), log: [{ at, by: "Sample", text: "Sample investor added" }] }, false);
  const metrics = liveMetrics({ store, crm, w, agentsActive, now });
  store.addOps(COLL.snapshots, id, { label: "Sample · Metrics pack (sample data, not real numbers)", metric_ids: PACK_IDS, metrics, as_of: today, frozen_at: at, frozen_by: "Sample", includes_sample: true, sample: true }, false);
  store.save();
  return { investors: 2, snapshots: 1 };
}
export function removeSampleInvestors(store, wsId) {
  ensureInvestors(store);
  const id = String(wsId), mine = (x) => x.workspace_id === id;
  const inv = new Set(store.db[COLL.investors].filter((i) => mine(i) && i.sample).map((i) => i.id));
  const snaps = new Set(store.db[COLL.snapshots].filter((s) => mine(s) && s.sample).map((s) => s.id));
  const items = store.db[COLL.items].filter((it) => mine(it) && (it.sample || (it.kind === "snapshot" && snaps.has(it.ref_id))));
  for (const it of items) removeItemFile(store, it);
  const itemIds = new Set(items.map((i) => i.id));
  const links = new Set(store.db[COLL.links].filter((l) => mine(l) && (l.sample || inv.has(l.investor_id))).map((l) => l.id));
  const count = (c, pred) => { const b = store.db[c].length; store.db[c] = store.db[c].filter((x) => !(mine(x) && pred(x))); return b - store.db[c].length; };
  const out = {
    investors: count(COLL.investors, (i) => inv.has(i.id)), investors_snapshots: count(COLL.snapshots, (s) => snaps.has(s.id)), investors_items: count(COLL.items, (it) => itemIds.has(it.id)),
    investors_links: count(COLL.links, (l) => links.has(l.id)), investors_views: count(COLL.views, (v) => v.sample || links.has(v.link_id) || inv.has(v.investor_id)),
    investors_updates: count(COLL.updates, (u) => u.sample || snaps.has(u.snapshot_id)),
  };
  for (const l of store.db[COLL.links].filter(mine)) l.item_ids = (l.item_ids || []).filter((x) => !itemIds.has(x));
  for (const i of store.db[COLL.investors].filter(mine)) i.document_ids = (i.document_ids || []).filter((x) => !itemIds.has(x));
  return out;
}
