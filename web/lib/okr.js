// OKRs & Weekly business review (module "okr"): quarterly objectives (company and per team) with 2–5 key results,
// each either LINKED to a metric the dashboard already computes (read through the modules' own functions) or MANUAL
// (a person types the value with a note). Draft → active → closed with a 0–1.0 score and a retro, graded by a person.
// Every Monday (Riyadh) a weekly business review (WBR) is drafted from the same metrics: this week vs last week vs the
// 4-week average, OKR changes, Command Center needs, wins/losses, incidents and runway. The AI Chief of staff writes a
// short narrative that only summarizes those rows, cites each one ([M1], [K7]…) and writes [ADD] where context is
// missing; a narrative that cites unknown rows or numbers not in the data is replaced by a factual one built from the rows.
import { levelOk } from "./access.js";
import { withAgent } from "./agents.js";
import { COLL as ADS_COLL, adsSettings, effectiveRows, metricsOf, withSar } from "./ads.js";
import { addDays, billingForFinance, mrrAt, r2 } from "./billing.js";
import { riyadhDay } from "./crm.js";
import { financeSnapshot } from "./finance.js";
import { winLoss } from "./intel.js";
import { SAR_PER_USD } from "./sales.js";
import { periodFor } from "./sop.js";
import { npsOf } from "./success.js";

export const COLL = { objectives: "okr_objectives", krs: "okr_krs", checkins: "okr_checkins", log: "okr_log", wbrs: "okr_wbrs" };
export function ensureOkr(store) { for (const c of Object.values(COLL)) store.db[c] ||= []; }
export const AGENT_ID = "chief_of_staff";
export const MANAGER_ROLES = ["owner", "admin", "manager"]; // Owner, Admin, Team lead: create and edit any objective
export const REVIEWER_ROLES = ["owner", "admin"]; // mark a weekly business review reviewed
export const STATUSES = [{ id: "draft", name: "Draft" }, { id: "active", name: "Active" }, { id: "closed", name: "Closed" }];
export const CONFIDENCE = [{ id: "on_track", name: "On track" }, { id: "at_risk", name: "At risk" }, { id: "off_track", name: "Off track" }];
export const CONFIDENCE_IDS = CONFIDENCE.map((c) => c.id);
export const KR_MIN = 2, KR_MAX = 5, STALE_DAYS = 7, WBR_HOUR = 7; // WBR drafted from 07:00 Riyadh on Monday
export const SECTIONS = [["metrics", "Metrics"], ["okrs", "Goals"], ["needs", "Needs attention"], ["winloss", "Wins and losses"], ["incidents", "Incidents"], ["cash", "Cash"], ["narrative", "Chief of staff notes"]];
export const SECTION_IDS = SECTIONS.map(([id]) => id);
const DAY = 864e5, RIYADH_MS = 3 * 3600e3;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---- Riyadh dates (UTC+3, no daylight saving)
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`) - RIYADH_MS; // Riyadh midnight
const isoOf = (day) => new Date(dayStartMs(day)).toISOString();
export const todayOf = (now) => riyadhDay(new Date(now));
export function mondayOf(now) { const d = todayOf(now); const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, -((dow + 6) % 7)); }
export function quarterOf(now) { const d = todayOf(now); return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`; }
export function quarterRange(q) {
  const y = Number(q.slice(0, 4)), n = Number(q.slice(-1)), m = (n - 1) * 3 + 1;
  return { start: `${y}-${String(m).padStart(2, "0")}-01`, end: n === 4 ? `${y + 1}-01-01` : `${y}-${String(m + 3).padStart(2, "0")}-01` };
}
export const shiftQuarter = (q, k) => { let y = Number(q.slice(0, 4)), n = Number(q.slice(-1)) + k; while (n > 4) { n -= 4; y++; } while (n < 1) { n += 4; y--; } return `${y}-Q${n}`; };
export const QUARTER_RE = /^\d{4}-Q[1-4]$/;

// ---- metric sources. Each value is read through the owning module's own functions; nothing is re-derived here.
// kind "stock": a value at a moment (`at(ctx, to)`, `to` = exclusive Riyadh day). kind "flow": a total or rate over
// a window (`over(ctx, from, to)`). `modules`: the person needs View on at least one of them to see the metric.
export function metricContext({ store, crm = null, w, now = Date.now() }) {
  const memo = {}, once = (k, f) => () => (k in memo ? memo[k] : (memo[k] = f()));
  const id = String(w.id);
  const ctx = { store, crm, w, now, today: todayOf(now) };
  ctx.customers = once("c", () => (store.db.billing_customers || []).filter((c) => c.workspace_id === id && !c.archived));
  ctx.deals = once("d", () => store.listDeals(id));
  ctx.fin = once("f", () => financeSnapshot({ expenses: store.listExpenses(id), income: store.listOps("finance_income", id), cash: store.listCash(id), deals: ctx.deals(), roles: store.listHrRoles(id), settings: w.finance, now: new Date(now), billing: billingForFinance(store, id, new Date(now)) }));
  ctx.adsRows = once("a", () => withSar(effectiveRows(store.listOps(ADS_COLL.rows, id)), adsSettings(w)).filter((r) => r.spend_sar != null));
  ctx.messages = once("m", () => (crm ? crm.db.messages.filter((m) => m.workspace_id === id) : []));
  return ctx;
}
const inWin = (iso, from, to) => !!iso && iso >= isoOf(from) && iso < isoOf(to);
const mrrSum = (ctx, day) => r2(ctx.customers().reduce((a, c) => a + mrrAt(c, day), 0));
// MRR: Billing's subscription event log (history per day). Without Billing customers, Finance's current MRR (no history).
const mrrValue = (ctx, to) => (ctx.customers().length ? mrrSum(ctx, to) : to >= ctx.today ? ctx.fin().revenue.mrr_sar : null);
const cohort = (ctx, to, days = 30) => { const from = addDays(to, -days); return ctx.customers().filter((c) => mrrAt(c, from) > 0).map((c) => ({ a: mrrAt(c, from), b: mrrAt(c, to) })); };

export const METRICS = [
  { id: "arr_usd", name: "ARR (USD)", unit: "USD", kind: "stock", higher_is_better: true, modules: ["finance", "billing"], source: "Billing MRR × 12 ÷ 3.75 (Finance MRR without Billing customers)",
    at: (ctx, to) => { const m = mrrValue(ctx, to); return m == null ? null : Math.round((m * 12) / SAR_PER_USD); } },
  { id: "mrr_sar", name: "MRR (SAR)", unit: "SAR", kind: "stock", higher_is_better: true, modules: ["finance", "billing"], source: "Billing subscriptions (Finance without Billing customers)", at: mrrValue },
  { id: "paying_stores", name: "Paying stores", unit: "count", kind: "stock", higher_is_better: true, modules: ["finance", "billing"], source: "Billing customers with MRR",
    at: (ctx, to) => (ctx.customers().length ? ctx.customers().filter((c) => mrrAt(c, to) > 0).length : to >= ctx.today ? ctx.fin().revenue.paying : null) },
  { id: "nrr_30d_pct", name: "NRR (last 30 days)", unit: "%", kind: "stock", higher_is_better: true, modules: ["billing", "success"], source: "Billing: MRR now of stores paying 30 days ago ÷ their MRR then",
    at: (ctx, to) => { const c = cohort(ctx, to), base = c.reduce((s, x) => s + x.a, 0); return base ? round((c.reduce((s, x) => s + x.b, 0) / base) * 100, 1) : null; } },
  { id: "logo_churn_30d_pct", name: "Logo churn (last 30 days)", unit: "%", kind: "stock", higher_is_better: false, modules: ["billing", "success"], source: "Billing: stores paying 30 days ago that pay nothing now",
    at: (ctx, to) => { const c = cohort(ctx, to); return c.length ? round((c.filter((x) => x.b === 0).length / c.length) * 100, 1) : null; } },
  { id: "crm_replies", name: "Store CRM replies", unit: "count", kind: "flow", higher_is_better: true, modules: ["crm"], source: "Store CRM: messages received from stores",
    over: (ctx, from, to) => (ctx.crm ? ctx.messages().filter((m) => m.direction === "in" && inWin(m.at, from, to)).length : null) },
  { id: "meetings_booked", name: "Meetings booked (Store CRM)", unit: "count", kind: "flow", higher_is_better: true, modules: ["crm"], source: "Store CRM stores whose Sales deal was created in the period (call booked or reply qualified)",
    over: (ctx, from, to) => { if (!ctx.crm) return null; const ds = new Map(ctx.deals().map((d) => [d.id, d])); return ctx.crm.contacts(ctx.w.id).filter((c) => c.deal_id && inWin(ds.get(String(c.deal_id))?.created_at, from, to)).length; } },
  { id: "deals_won", name: "Deals won", unit: "count", kind: "flow", higher_is_better: true, modules: ["sales"], source: "Sales: deals moved to Paying",
    over: (ctx, from, to) => ctx.deals().filter((d) => d.stage === "paying" && inWin(d.stage_changed_at, from, to)).length },
  { id: "cost_per_lead_sar", name: "Cost per lead (Paid Ads, SAR)", unit: "SAR", kind: "flow", higher_is_better: false, modules: ["ads"], source: "Paid Ads insights: spend ÷ leads",
    over: (ctx, from, to) => { const m = metricsOf(ctx.adsRows().filter((r) => r.date >= from && r.date < to), "leads"); return m.leads ? m.cpa : null; } },
  { id: "nps_90d", name: "NPS (last 90 days)", unit: "score", kind: "stock", higher_is_better: true, modules: ["success"], source: "Customer success: NPS answers",
    at: (ctx, to) => npsOf(ctx.store.listOps("success_responses", ctx.w.id).filter((r) => r.kind === "nps" && r.answered_at && inWin(r.answered_at, addDays(to, -90), to)).map((r) => r.score)).nps },
  { id: "support_first_response_h", name: "Support first response (hours, average)", unit: "hours", kind: "flow", higher_is_better: false, modules: ["support"], source: "AI Support: tickets opened in the period, time to the first reply sent",
    over: (ctx, from, to) => {
      const hrs = ctx.store.listTickets(ctx.w.id).filter((t) => inWin(t.created_at, from, to)).map((t) => { const m = (t.messages || []).find((x) => x.from !== "customer" && x.sent !== false); return m ? (Date.parse(m.at) - Date.parse(t.created_at)) / 3600e3 : null; }).filter((x) => x != null);
      return hrs.length ? round(hrs.reduce((a, x) => a + x, 0) / hrs.length, 1) : null;
    } },
];
// KPIs from the KPIs module: the latest value logged for a period up to the day before `to`.
export function kpiMetric(k, store) {
  return { id: `kpi:${k.id}`, name: `KPI: ${k.name}`, unit: k.unit || "", kind: "stock", higher_is_better: k.higher_is_better !== false, modules: ["marketing"], source: "KPIs (Marketing brain)", kpi_id: k.id,
    at: (ctx, to) => { const until = periodFor(k.frequency || "weekly", new Date(dayStartMs(to) - 1)); const v = store.db.kpi_values.filter((x) => x.kpi_id === k.id && x.period <= until && !/^setup$/.test(x.period)).sort((a, b) => a.period.localeCompare(b.period)).at(-1); return v ? Number(v.value) : null; } };
}
export const metricCatalog = (store, w) => [...METRICS, ...store.listKpis(w.id).map((k) => kpiMetric(k, store))];
export const metricById = (store, w, id) => metricCatalog(store, w).find((m) => m.id === id) || null;
export const canSeeMetric = (perms, def) => !perms || !def || def.modules.some((m) => levelOk(perms[m], "view"));
export const hiddenHint = (def) => `Needs View on ${def.modules.map((m) => ({ finance: "Finance", billing: "Billing", success: "Customer success", crm: "Store CRM", sales: "Sales", ads: "Paid Ads", support: "Support", marketing: "Marketing" })[m] || m).join(" or ")}`;
// The value a linked KR shows now: stocks at today (capped at the quarter's end), flows summed over the quarter so far.
export function valueForQuarter(ctx, def, quarter) {
  const { start, end } = quarterRange(quarter), tomorrow = addDays(ctx.today, 1), to = tomorrow < end ? tomorrow : end;
  if (def.kind === "stock") return def.at(ctx, to);
  return to <= start ? null : def.over(ctx, start, to);
}
export const metricValueFor = (ctx, def, to, k = 0) => (def.kind === "stock" ? def.at(ctx, addDays(to, -7 * k)) : def.over(ctx, addDays(to, -7 * (k + 1)), addDays(to, -7 * k)));

// ---- progress
export function progressOf(start, target, current) {
  if ([start, target, current].some((x) => x == null || !Number.isFinite(Number(x)))) return null;
  if (Number(target) === Number(start)) return Number(current) >= Number(target) ? 100 : 0;
  return round(Math.max(0, Math.min(1, (current - start) / (target - start))) * 100, 1);
}
export const lastTouch = (kr, o) => kr.last_checkin_at || o.activated_at || kr.created_at;
export const daysSince = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);
export const isStale = (kr, o, now) => o.status === "active" && daysSince(lastTouch(kr, o), now) >= STALE_DAYS;

// ---- input cleaning
export function cleanObjective(b = {}, { store, partial = false } = {}) {
  const out = {}, err = [];
  if (b.title !== undefined) out.title = str(b.title, 200);
  if (b.description !== undefined) out.description = str(b.description, 2000);
  if (b.quarter !== undefined) { if (!QUARTER_RE.test(String(b.quarter))) err.push("quarter must look like 2026-Q4"); else out.quarter = String(b.quarter); }
  if (b.level !== undefined) out.level = b.level === "team" ? "team" : "company";
  if (b.team_id !== undefined) out.team_id = b.team_id ? String(b.team_id) : null;
  if ((out.level ?? b._level) === "team") { const t = out.team_id ?? b._team_id; if (!t || !store.db.teams.some((x) => x.id === t)) err.push("Pick the team (Teams & roles → Teams)"); }
  else if (out.level === "company") out.team_id = null;
  if (b.owner_id !== undefined) { const o = String(b.owner_id || ""); if (o && !validPerson(store, o)) err.push("owner must be a person in Teams & roles"); else out.owner_id = o || null; }
  if (!partial && !out.title) err.push("title is required");
  if (partial && b.title !== undefined && !out.title) err.push("title cannot be empty");
  return { out, err };
}
export const validPerson = (store, id) => id === "owner" || store.db.users.some((u) => u.id === String(id) && u.active);
export const personName = (store, id) => (!id ? "" : id === "owner" ? "Owner" : store.db.users.find((u) => u.id === String(id))?.name || "Former member");
export function cleanKr(b = {}, { store, w, partial = false, cur = {} } = {}) {
  const out = {}, err = [];
  if (b.title !== undefined) out.title = str(b.title, 200);
  if (b.kind !== undefined || !partial) out.kind = b.kind === "linked" ? "linked" : "manual";
  const kind = out.kind ?? cur.kind;
  if (b.metric !== undefined || (!partial && kind === "linked")) {
    const def = b.metric ? metricById(store, w, String(b.metric)) : null;
    if (kind === "linked" && !def) err.push("Pick a metric for a linked key result"); else out.metric = kind === "linked" ? def.id : null;
  }
  if (kind === "manual" && out.kind === "manual") out.metric = null;
  for (const k of ["start", "target", "current"]) if (b[k] !== undefined) { const n = num(b[k]); if (b[k] !== "" && b[k] !== null && n === null) err.push(`${k} must be a number`); else out[k] = n; }
  if (b.unit !== undefined) out.unit = str(b.unit, 20);
  if (b.owner_id !== undefined) { const o = String(b.owner_id || ""); if (o && !validPerson(store, o)) err.push("owner must be a person in Teams & roles"); else out.owner_id = o || null; }
  if (b.confidence !== undefined) { if (!CONFIDENCE_IDS.includes(b.confidence)) err.push(`confidence must be one of ${CONFIDENCE_IDS.join(", ")}`); else out.confidence = b.confidence; }
  if (!partial && !out.title) err.push("title is required");
  if (partial && b.title !== undefined && !out.title) err.push("title cannot be empty");
  if (!partial && out.target == null) err.push("target is required");
  return { out, err };
}

// ---- views (with permission redaction)
// One objective with its KRs: current values from the live metrics (frozen when closed), progress, owner names.
export function objectiveView(store, ctx, o, perms, { checkins = 10, now = Date.now() } = {}) {
  const krs = store.listOps(COLL.krs, o.workspace_id).filter((k) => k.objective_id === o.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || Number(a.id) - Number(b.id));
  const cis = store.listOps(COLL.checkins, o.workspace_id);
  const rows = krs.map((k) => {
    const def = k.kind === "linked" ? metricById(store, ctx.w, k.metric) : null;
    const hidden = k.kind === "linked" && !canSeeMetric(perms, def);
    const current = o.status === "closed" ? k.final_value ?? null : k.kind === "linked" ? (def ? valueForQuarter(ctx, def, o.quarter) : null) : k.current;
    const base = { id: k.id, objective_id: o.id, title: k.title, kind: k.kind, metric: k.metric || null, metric_name: def?.name || (k.kind === "linked" ? "(metric removed)" : null), owner_id: k.owner_id || null, owner_name: personName(store, k.owner_id),
      confidence: k.confidence || "on_track", last_checkin_at: k.last_checkin_at || null, stale: isStale(k, o, now), days_since_checkin: daysSince(lastTouch(k, o), now), sample: !!k.sample, ref: `K${k.id}` };
    if (hidden) return { ...base, hidden: true, hidden_hint: hiddenHint(def), unit: def.unit, start: null, target: null, current: null, progress: null, checkins: [] };
    return { ...base, hidden: false, unit: def?.unit ?? k.unit ?? "", higher_is_better: def ? def.higher_is_better : Number(k.target) >= Number(k.start ?? 0), start: k.start ?? null, target: k.target ?? null, current: current ?? null,
      progress: progressOf(k.start ?? 0, k.target, current), source: def?.source || "Typed in at each check-in",
      checkins: cis.filter((c) => c.kr_id === k.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, checkins).map((c) => ({ id: c.id, at: c.created_at, value: c.value, confidence: c.confidence, note: c.note, by: c.by })) };
  });
  const vis = rows.filter((r) => !r.hidden && r.progress != null);
  return { ...o, owner_name: personName(store, o.owner_id), team_name: o.team_id ? store.db.teams.find((t) => t.id === o.team_id)?.name || "(deleted team)" : null,
    progress: vis.length ? round(vis.reduce((a, r) => a + r.progress, 0) / vis.length, 1) : null, partial: rows.some((r) => r.hidden),
    at_risk: rows.filter((r) => r.confidence !== "on_track").length, stale: rows.filter((r) => r.stale).length, krs: rows, suggested_score: suggestedScore(rows) };
}
// The rule-based suggestion a person can accept or change: average KR progress, rounded to 0.1.
export const suggestedScore = (krs) => { const p = krs.filter((k) => !k.hidden && k.progress != null); return p.length ? Math.round((p.reduce((a, k) => a + k.progress, 0) / p.length / 100) * 10) / 10 : null; };

// ---- Command Center
export function okrNeeds(store, w, { user = null, now = Date.now() } = {}) {
  try {
    ensureOkr(store);
    if (!user) return [];
    const active = new Map(store.listOps(COLL.objectives, w.id).filter((o) => o.status === "active").map((o) => [o.id, o]));
    const stale = store.listOps(COLL.krs, w.id).filter((k) => active.has(k.objective_id) && isStale(k, active.get(k.objective_id), now));
    const mine = stale.filter((k) => k.owner_id === user.id), others = stale.filter((k) => k.owner_id !== user.id);
    const out = mine.slice(0, 4).map((k) => ({ module: "Goals & review", route: "okr", param: "okrs", title: k.title, text: `No check-in for ${daysSince(lastTouch(k, active.get(k.objective_id)), now)} days: update the value and your confidence.` }));
    if (MANAGER_ROLES.includes(user.role_id) && others.length) out.push({ module: "Goals & review", route: "okr", param: "okrs", title: "Key result check-ins", text: `${others.length} key result${others.length === 1 ? " has" : "s have"} no check-in for ${STALE_DAYS}+ days (owned by others).` });
    if (REVIEWER_ROLES.includes(user.role_id)) for (const r of store.listOps(COLL.wbrs, w.id).filter((x) => x.status === "draft").slice(0, 2)) out.push({ module: "Goals & review", route: "okr", param: "review", title: "Weekly business review", text: `The review for the week of ${r.week_start} is waiting for you to read and mark reviewed.` });
    return out;
  } catch (e) { console.error("[okr] needs:", e?.message); return []; }
}
// Home card: this quarter's company objectives (active first) with progress the person may see.
export function okrHome(store, crm, w, perms, now = Date.now()) {
  ensureOkr(store);
  const q = quarterOf(now), ctx = metricContext({ store, crm, w, now });
  const list = store.listOps(COLL.objectives, w.id).filter((o) => o.quarter === q && o.level === "company" && o.status !== "closed").sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || Number(a.id) - Number(b.id));
  return { quarter: q, objectives: list.slice(0, 4).map((o) => { const v = objectiveView(store, ctx, o, perms, { checkins: 0, now }); return { id: o.id, title: o.title, status: o.status, progress: v.progress, partial: v.partial, krs: v.krs.length, at_risk: v.at_risk, stale: v.stale, sample: !!o.sample }; }), more: Math.max(0, list.length - 4) };
}

// ---- weekly business review
// The data a review shows, frozen when it's generated. `week_start` is the Monday the review is for; the review
// covers the 7 days before it ("this week"), the 7 before that ("last week") and the 4 weeks ending with this week.
export function wbrData({ store, crm, w, now = Date.now(), needs = [] }) {
  const M = mondayOf(now), from = addDays(M, -7), ctx = metricContext({ store, crm, w, now });
  const fromIso = isoOf(from), toIso = isoOf(M);
  const catalog = metricCatalog(store, w);
  const metrics = [];
  for (const def of catalog) {
    const weeks = [0, 1, 2, 3].map((k) => { try { const v = metricValueFor(ctx, def, M, k); return v == null ? null : Number(v); } catch { return null; } });
    if (def.kpi_id && weeks.every((x) => x == null)) continue; // KPIs with no data in the 4 weeks are left out
    const xs = weeks.filter((x) => x != null), [a, b] = weeks;
    metrics.push({ ref: `M${metrics.length + 1}`, id: def.id, name: def.name, unit: def.unit, kind: def.kind, higher_is_better: def.higher_is_better, modules: def.modules, source: def.source,
      this_week: a, last_week: b, avg_4w: xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length, 2) : null, weeks,
      change: a != null && b != null ? round(a - b, 2) : null, change_pct: a != null && b ? round(((a - b) / Math.abs(b)) * 100, 1) : null });
  }
  // Goals: this quarter's active objectives and their KRs as they stand, plus what changed in the week.
  const q = quarterOf(dayStartMs(from) + 3600e3);
  const objs = store.listOps(COLL.objectives, w.id).filter((o) => (o.quarter === q || o.quarter === quarterOf(now)) && o.status !== "draft");
  const okrs = objs.map((o) => { const v = objectiveView(store, ctx, o, null, { checkins: 0, now }); return { ref: `G${o.id}`, id: o.id, title: o.title, level: o.level, team_name: v.team_name, status: o.status, quarter: o.quarter, progress: v.progress, at_risk: v.at_risk, stale: v.stale, score: o.score ?? null,
    krs: v.krs.map((k) => ({ ref: k.ref, id: k.id, title: k.title, kind: k.kind, metric: k.metric, modules: k.metric ? metricById(store, w, k.metric)?.modules || [] : [], unit: k.unit, start: k.start, target: k.target, current: k.current, progress: k.progress, confidence: k.confidence, owner_name: k.owner_name, stale: k.stale })) }; });
  const titles = new Map(store.listOps(COLL.objectives, w.id).map((o) => [o.id, o.title]));
  const krTitle = new Map(store.listOps(COLL.krs, w.id).map((k) => [k.id, k]));
  const changes = store.listOps(COLL.log, w.id).filter((l) => l.created_at >= fromIso && l.created_at < toIso && l.kind !== "checkin").map((l) => {
    const kr = l.kr_id ? krTitle.get(l.kr_id) : null;
    return { ref: `O${l.id}`, kind: l.kind, objective: titles.get(l.objective_id) || "(deleted objective)", kr: kr?.title || null, from: l.from ?? null, to: l.to ?? null, text: l.text, at: l.created_at, by: l.by, modules: kr?.kind === "linked" ? metricById(store, w, kr.metric)?.modules || [] : [] };
  });
  const checkins = store.listOps(COLL.checkins, w.id).filter((c) => c.created_at >= fromIso && c.created_at < toIso).length;
  const wl = winLoss(ctx.deals(), { now: dayStartMs(M), days: 7 }).rows.filter((r) => r.date >= from && r.date < M).map((r) => ({ ref: `D${r.id}`, outcome: r.outcome, name: r.name, reason: r.reason || "", competitor: r.competitor || "", date: r.date }));
  const incidents = store.listOps("ops_incidents", w.id).filter((i) => (i.started_at >= fromIso && i.started_at < toIso) || (i.status !== "resolved" && i.started_at < toIso)).map((i) => ({ ref: `I${i.id}`, title: i.title, severity: i.severity, status: i.status, started_at: i.started_at, resolved_at: i.resolved_at || null, impact: str(i.impact, 300) }));
  const f = ctx.fin();
  const cash = { ref: "F1", runway_months: f.runway_months, cash_sar: f.cash.balance_sar, cash_as_of: f.cash.as_of, net_burn_sar: f.costs.net_burn_sar, cash_zero_month: f.forecast.cash_zero_month || null };
  return { week_start: M, from, to: addDays(M, -1), metrics, okrs, okr_changes: changes, checkins_week: checkins,
    needs: needs.filter((n) => n.module !== "Goals & review").slice(0, 8).map((n, i) => ({ ref: `N${i + 1}`, module: n.module, title: str(n.title, 160), text: str(n.text, 300) })), winloss: wl, incidents, cash };
}
// What a person may see of a review: rows from modules they can't view are dropped (and every line citing them).
const SECTION_MODULE = { winloss: ["sales"], incidents: ["ops"], cash: ["finance"] };
export function hiddenRefs(data, perms, needModule = () => null) {
  if (!perms) return new Set();
  const can = (mods) => !mods?.length || mods.some((m) => levelOk(perms[m], "view"));
  const out = new Set();
  for (const m of data.metrics) if (!can(m.modules)) out.add(m.ref);
  for (const o of data.okrs) for (const k of o.krs) if (!can(k.modules)) out.add(k.ref);
  for (const n of data.needs) { const mod = needModule(n.module); if (mod && !can([mod])) out.add(n.ref); }
  if (!can(SECTION_MODULE.winloss)) for (const d of data.winloss) out.add(d.ref);
  if (!can(SECTION_MODULE.incidents)) for (const i of data.incidents) out.add(i.ref);
  if (!can(SECTION_MODULE.cash)) out.add("F1");
  return out;
}
const REF_RE = /\[([MGKONDIF]\d+)\]/g;
// For a reader who can't see some rows: drop every line citing one, and lines with numbers that cite nothing
// (a number without its row can't be checked against what this reader may see).
export function redactNarrative(text, hidden) {
  if (!hidden.size) return String(text || "");
  return String(text || "").split("\n").filter((l) => {
    const refs = [...l.matchAll(REF_RE)].map((m) => m[1]);
    return refs.length ? !refs.some((r) => hidden.has(r)) : !/\d/.test(l.replace(/\[ADD\]/g, ""));
  }).join("\n");
}
export function redactData(data, perms, needModule) {
  const hidden = hiddenRefs(data, perms, needModule);
  const can = (mods) => !perms || !mods?.length || mods.some((m) => levelOk(perms[m], "view"));
  return { hidden, data: { ...data,
    metrics: data.metrics.filter((m) => !hidden.has(m.ref)),
    okrs: data.okrs.map((o) => { const vis = o.krs.filter((k) => !hidden.has(k.ref) && k.progress != null); return { ...o, progress: o.krs.some((k) => hidden.has(k.ref)) ? (vis.length ? round(vis.reduce((a, k) => a + k.progress, 0) / vis.length, 1) : null) : o.progress, partial: o.krs.some((k) => hidden.has(k.ref)), krs: o.krs.map((k) => (hidden.has(k.ref) ? { ref: k.ref, id: k.id, title: k.title, kind: k.kind, hidden: true, confidence: k.confidence, owner_name: k.owner_name, stale: k.stale } : k)) }; }),
    okr_changes: data.okr_changes.map((c) => (can(c.modules) ? c : { ...c, from: c.kind === "confidence" ? c.from : null, to: c.kind === "confidence" ? c.to : null })),
    needs: data.needs.filter((n) => !hidden.has(n.ref)),
    winloss: can(SECTION_MODULE.winloss) ? data.winloss : null, incidents: can(SECTION_MODULE.incidents) ? data.incidents : null, cash: can(SECTION_MODULE.cash) ? data.cash : null } };
}

// The rows the narrative may cite, flattened for the prompt and the check.
export function citable(data) {
  const items = [];
  for (const m of data.metrics) items.push({ ref: m.ref, metric: m.name, unit: m.unit, this_week: m.this_week, last_week: m.last_week, avg_4w: m.avg_4w, change: m.change, change_pct: m.change_pct, higher_is_better: m.higher_is_better });
  for (const o of data.okrs) { items.push({ ref: o.ref, objective: o.title, level: o.level, team: o.team_name || undefined, progress_pct: o.progress, krs_not_on_track: o.at_risk, krs_without_checkin_7d: o.stale });
    for (const k of o.krs) items.push({ ref: k.ref, key_result: k.title, objective: o.title, start: k.start, target: k.target, current: k.current, unit: k.unit, progress_pct: k.progress, confidence: k.confidence, owner: k.owner_name }); }
  for (const c of data.okr_changes) items.push({ ref: c.ref, okr_change: c.kind, objective: c.objective, key_result: c.kr || undefined, from: c.from ?? undefined, to: c.to ?? undefined, text: c.text });
  for (const n of data.needs) items.push({ ref: n.ref, need: n.title, module: n.module, text: n.text });
  for (const d of data.winloss) items.push({ ref: d.ref, deal: d.name, outcome: d.outcome, reason: d.reason || "[ADD] no reason recorded", competitor: d.competitor || undefined });
  for (const i of data.incidents) items.push({ ref: i.ref, incident: i.title, severity: i.severity, status: i.status, impact: i.impact || undefined });
  if (data.cash) items.push({ ref: "F1", runway_months: data.cash.runway_months, cash_sar: data.cash.cash_sar, cash_as_of: data.cash.cash_as_of, net_burn_sar: data.cash.net_burn_sar });
  return items;
}
export function narrativePrompt(w, data) {
  return `<task title="Weekly business review">
You are DPA AD's AI Chief of staff. Write the short narrative for the weekly business review of ${str(w.brief?.company_name, 80) || "DPA AD"} (a Saudi SaaS that turns Salla/Zid store catalogs into designed image and video ads; goal: $100M ARR) for ${data.from} to ${data.to}.

Rules (strict):
- Only summarize the rows below. Never add facts, numbers, customers, stores, quotes or causes that are not in the rows.
- Every bullet must end with the reference(s) of the row(s) it comes from, exactly as given, e.g. [M3] or [K12][O40].
- Every number you write must be copied from a cited row (same value). Don't compute new numbers.
- Where a reader needs context the rows don't give (why something moved, what we'll do, who owns it), write [ADD] instead of guessing.
- Sections: "Headlines" (3 bullets max), "Goals", "Watch", "Questions for the team" (each tied to references; use [ADD] for owner and date).
- Plain English, short. Markdown only. No preamble.
</task>

<rows count="${citable(data).length}">
${JSON.stringify(citable(data), null, 1)}
</rows>`;
}
// Checks a narrative against the rows: unknown references, bullets with no reference, numbers not in the rows.
export function checkNarrative(text, data) {
  const items = citable(data), refs = new Set(items.map((i) => i.ref)), body = String(text || "");
  const cited = [...new Set([...body.matchAll(REF_RE)].map((m) => m[1]))];
  const unknown = cited.filter((r) => !refs.has(r));
  const bullets = body.split("\n").filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
  const uncited = bullets.filter((l) => !/\[[MGKONDIF]\d+\]/.test(l) && !/\[ADD\]/.test(l)).map((l) => l.trim().slice(0, 160));
  const hay = JSON.stringify(items).replace(/,(?=\d{3}\b)/g, "") + ` ${data.from} ${data.to} ${data.week_start} 4 7 30 90`;
  const nums = [...new Set((body.replace(REF_RE, " ").match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")).filter(Boolean))];
  const unsourced_numbers = nums.filter((n) => !new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(hay)).slice(0, 12);
  const issues = [
    ...unknown.map((r) => `Cites ${r}, which is not a row of this review`),
    ...(uncited.length ? [`${uncited.length} bullet${uncited.length === 1 ? "" : "s"} without a reference: ${uncited.slice(0, 3).join(" / ")}`] : []),
    ...(unsourced_numbers.length ? [`Numbers not found in the rows: ${unsourced_numbers.join(", ")}`] : []),
  ];
  return { cited: cited.filter((r) => refs.has(r)), unknown, uncited: uncited.length, unsourced_numbers, issues, ok: !issues.length };
}
export const fmtVal = (v, unit) => (v == null ? "–" : `${unit === "SAR" ? "SAR " : unit === "USD" ? "$" : ""}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit === "%" ? "%" : unit === "hours" ? " h" : ""}`);
const CONF_NAME = Object.fromEntries(CONFIDENCE.map((c) => [c.id, c.name.toLowerCase()]));
// The factual narrative built from the rows alone (used when the AI is off or its text can't be checked).
export function ruleNarrative(data) {
  const lines = [`## Headlines`];
  // The three biggest week-over-week moves (the full table sits above the notes); without moves, the first rows with data.
  const withData = data.metrics.filter((m) => m.this_week != null);
  const movers = withData.filter((m) => m.change_pct).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  const moved = (movers.length ? movers : withData).slice(0, 3);
  if (!moved.length) lines.push("- No metric has data for this week yet: [ADD]");
  for (const m of moved) lines.push(`- ${m.name}: ${fmtVal(m.this_week, m.unit)} this week${m.last_week != null ? ` vs ${fmtVal(m.last_week, m.unit)} last week${m.change_pct != null ? ` (${m.change_pct > 0 ? "+" : ""}${m.change_pct}%)` : ""}` : ""}${m.avg_4w != null ? `, 4-week average ${fmtVal(m.avg_4w, m.unit)}` : ""} [${m.ref}]`);
  lines.push("", "## Goals");
  if (!data.okrs.length) lines.push("- No active objectives this quarter: [ADD]");
  for (const o of data.okrs) {
    lines.push(`- ${o.title}: ${o.progress == null ? "no progress data" : `${o.progress}% progress`}${o.at_risk ? `, ${o.at_risk} key result${o.at_risk === 1 ? "" : "s"} not on track` : ""}${o.stale ? `, ${o.stale} without a check-in for 7+ days` : ""} [${o.ref}]`);
    for (const k of o.krs.filter((x) => x.confidence !== "on_track")) lines.push(`  - ${k.title}: ${CONF_NAME[k.confidence] || k.confidence}${k.current != null ? `, ${fmtVal(k.current, k.unit)} of ${fmtVal(k.target, k.unit)}` : ""} [${k.ref}]`);
  }
  for (const c of data.okr_changes.filter((x) => x.kind === "confidence").slice(0, 6)) lines.push(`- ${c.kr || c.objective}: confidence ${CONF_NAME[c.from] || c.from} → ${CONF_NAME[c.to] || c.to} [${c.ref}]`);
  lines.push("", "## Watch");
  const watch = [...data.needs.map((n) => `- ${n.title}: ${n.text} [${n.ref}]`), ...data.winloss.map((d) => `- ${d.outcome === "won" ? "Won" : "Lost"} ${d.name}: ${d.reason || "[ADD] reason"} [${d.ref}]`),
    ...data.incidents.map((i) => `- ${i.severity} ${i.title} (${i.status}) [${i.ref}]`), ...(data.cash && data.cash.runway_months != null ? [`- Runway: ${data.cash.runway_months} months [F1]`] : [])];
  lines.push(...(watch.length ? watch : ["- Nothing flagged this week."]));
  lines.push("", "## Questions for the team", "- What explains the biggest change this week? [ADD]", "- Owner and date for the next step: [ADD]");
  return lines.join("\n") + "\n";
}

// ---- the service: weekly generation (safe to repeat) with an injectable clock
export function createOkr({ store, crm = null, provider, workforce = null, needs = () => [], clock = () => Date.now(), log = console } = {}) {
  ensureOkr(store);
  const svc = { clock };
  const now = () => svc.clock();
  const inflight = new Set();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  async function narrate(w, data) {
    if (level() === 0) return { text: ruleNarrative(data), by_ai: false, note: "The AI Chief of staff is switched off in AI Workforce: this is the factual summary built from the rows." };
    try {
      const run = () => provider.generate({ prompt: narrativePrompt(w, data), onText: () => {} });
      const out = await withAgent(AGENT_ID, w.id, run);
      const c = checkNarrative(out, data);
      if (c.cited.length && !c.unknown.length && !c.unsourced_numbers.length && !c.uncited) return { text: String(out).trim() + "\n", by_ai: true, note: "" };
      workforce?.event(AGENT_ID, w.id, "escalated", `WBR ${data.week_start}: AI narrative failed the checks (${c.issues[0] || "no references"}); factual summary used`);
      return { text: ruleNarrative(data), by_ai: false, note: c.unknown.length || c.unsourced_numbers.length ? `The AI's narrative ${c.unknown.length ? `cited rows that don't exist (${c.unknown.join(", ")})` : `had numbers that aren't in the rows (${c.unsourced_numbers.join(", ")})`}: this is the factual summary built from the rows instead. Add context where it says [ADD].` : "The AI's narrative didn't cite the rows: this is the factual summary built from the rows instead. Add context where it says [ADD]." };
    } catch (e) {
      return { text: ruleNarrative(data), by_ai: false, note: /switched off|budget/i.test(e?.message || "") ? `${e.message} This is the factual summary built from the rows.` : "The AI couldn't be reached: this is the factual summary built from the rows. Add context where it says [ADD]." };
    }
  }
  // Draft (or, with `refresh`, rebuild) the review for the current week. Reviewed reviews are never changed.
  async function generate(w, { by = "schedule", refresh = false } = {}) {
    const t = now(), M = mondayOf(t), key = `${w.id}:${M}`;
    const cur = store.listOps(COLL.wbrs, w.id).find((r) => r.week_start === M);
    if (cur && (!refresh || cur.status !== "draft")) return { wbr: cur, created: false };
    if (inflight.has(key)) return { wbr: cur || null, created: false, busy: true };
    inflight.add(key);
    try {
      const data = wbrData({ store, crm, w, now: t, needs: (() => { try { return needs(w) || []; } catch (e) { log.error?.("[okr] needs:", e?.message); return []; } })() });
      const n = await narrate(w, data);
      const fields = { week_start: M, from: data.from, to: data.to, status: "draft", data, narrative: n.text, original: n.text, by_ai: n.by_ai, note: n.note, issues: checkNarrative(n.text, data).issues, generated_at: new Date(t).toISOString(), generated_by: by };
      const again = store.listOps(COLL.wbrs, w.id).find((r) => r.week_start === M);
      if (again) return { wbr: again.status === "draft" && refresh ? store.updateOps(COLL.wbrs, w.id, again.id, fields) : again, created: false };
      return { wbr: store.addOps(COLL.wbrs, w.id, { ...fields, comments: [] }), created: true };
    } finally { inflight.delete(key); }
  }
  // Due from Monday 07:00 Riyadh; until the week's review exists, every later tick that week drafts it (catch-up).
  const due = (t = now()) => t >= dayStartMs(mondayOf(t)) + WBR_HOUR * 3600e3;
  async function tick() {
    const out = { created: 0 };
    if (!due()) return out;
    for (const w of store.listWorkspaces()) {
      try { if ((await generate(w)).created) out.created++; } catch (e) { log.error?.("[okr] wbr:", e?.message || e); }
    }
    return out;
  }
  let timer = null;
  function start(every = 3600e3) {
    const run = async () => { try { await tick(); } catch (e) { log.error?.("[okr] run:", e?.message || e); } };
    setTimeout(run, 120e3).unref?.();
    timer = setInterval(run, every); timer.unref?.();
  }
  const stop = () => { clearInterval(timer); timer = null; };
  return Object.assign(svc, { now, generate, tick, due, start, stop, level });
}

// ---- sample data (clearly "Sample ·", removed with the other samples)
export function loadSampleOkr(store, wsId, now = Date.now()) {
  ensureOkr(store);
  const id = String(wsId), q = quarterOf(now), ago = (d) => new Date(now - d * DAY).toISOString();
  const team = store.db.teams.find((t) => /growth|sales/i.test(t.name)) || null;
  let objectives = 0, krs = 0;
  const add = (o, list) => {
    const x = store.addOps(COLL.objectives, id, { quarter: q, level: "company", team_id: null, description: "", owner_id: "owner", status: "active", score: null, retro: "", activated_at: o.status === "draft" ? null : ago(20), sample: true, ...o }, false);
    x.created_at = ago(21); objectives++;
    list.forEach((k, i) => { const r = store.addOps(COLL.krs, id, { objective_id: x.id, kind: "linked", metric: null, start: 0, current: null, unit: "", owner_id: "owner", confidence: "on_track", sort: i, last_checkin_at: null, sample: true, ...k }, false); r.created_at = ago(21); krs++; });
    store.addOps(COLL.log, id, { objective_id: x.id, kr_id: null, kind: "created", text: "Sample objective added", by: "Sample", sample: true }, false).created_at = ago(21);
    return x;
  };
  add({ title: "Sample · Win the first paying stores on Salla and Zid", description: "Sample objective: replace with the founder's real goals for the quarter." }, [
    { title: "Sample · Paying stores", metric: "paying_stores", target: 25 },
    { title: "Sample · ARR (USD)", metric: "arr_usd", target: 150000 },
    { title: "Sample · Salla app listing approved", kind: "manual", metric: null, start: 0, target: 1, current: 0, unit: "listing", confidence: "at_risk", last_checkin_at: ago(10) },
  ]);
  add({ title: "Sample · Fill the pipeline from the Store CRM", level: team ? "team" : "company", team_id: team?.id || null }, [
    { title: "Sample · Store replies", metric: "crm_replies", target: 60 },
    { title: "Sample · Meetings booked", metric: "meetings_booked", target: 30, confidence: "at_risk" },
    { title: "Sample · Deals won", metric: "deals_won", target: 10 },
  ]);
  add({ title: "Sample · Answer stores fast in Saudi Arabic", status: "draft" }, [
    { title: "Sample · Support first response (hours)", metric: "support_first_response_h", start: 24, target: 4 },
    { title: "Sample · NPS", metric: "nps_90d", target: 40 },
  ]);
  const manual = store.db[COLL.krs].find((k) => k.workspace_id === id && k.sample && k.kind === "manual");
  if (manual) {
    store.addOps(COLL.checkins, id, { kr_id: manual.id, objective_id: manual.objective_id, value: 0, confidence: "at_risk", note: "Sample: submitted, waiting for Salla's review.", by: "Sample", by_id: "owner", sample: true }, false).created_at = ago(10);
    store.addOps(COLL.log, id, { objective_id: manual.objective_id, kr_id: manual.id, kind: "confidence", from: "on_track", to: "at_risk", text: "Confidence on track → at risk", by: "Sample", sample: true }, false).created_at = ago(3);
  }
  store.save();
  return { okr_objectives: objectives, okr_krs: krs };
}
export function removeSampleOkr(store, wsId) {
  ensureOkr(store);
  const id = String(wsId), removed = {};
  const objs = new Set(store.db[COLL.objectives].filter((o) => o.workspace_id === id && o.sample).map((o) => o.id));
  for (const [k, coll] of Object.entries(COLL)) {
    if (coll === COLL.wbrs) continue; // reviews are records of what was shown; drafts built on sample data are removed below
    const before = store.db[coll].length;
    store.db[coll] = store.db[coll].filter((x) => !(x.workspace_id === id && (x.sample || objs.has(x.objective_id))));
    removed[`okr_${k}`] = before - store.db[coll].length;
  }
  const before = store.db[COLL.wbrs].length;
  store.db[COLL.wbrs] = store.db[COLL.wbrs].filter((r) => !(r.workspace_id === id && r.status === "draft"));
  removed.okr_wbrs = before - store.db[COLL.wbrs].length;
  return removed;
}
