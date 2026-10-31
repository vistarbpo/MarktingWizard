// A small JSON-file database. One file, written atomically after every change.
// Fine for a single-team dashboard; swap for MySQL if many people write at once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBrief } from "./catalog.js";

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "seed");

// The DPA AD workspace (https://dpa.ad) created on first start.
export const SEED_BRIEF = {
  company_name: "DPA AD",
  product_name: "DPA AD",
  website: "https://dpa.ad",
  one_liner: "Turns an ecommerce product catalog into designed, on-brand image and video ads automatically, so every SKU gets many scroll-stopping creatives for creative testing instead of a plain packshot.",
  category: "Ecommerce SaaS - catalog / dynamic product ad creative",
  business_model: "saas",
  target_customers: "Online stores that want many ad creatives per product to find winners through creative testing; large catalogs get the most value. Growth marketers, performance agencies and in-house creative teams.",
  markets: "GCC first (Arabic, no direct competitor there), then global (English).",
  integrations: "Live: custom product feed. Planned: Salla app, Shopify app, Zid, and a public API.",
  problems_solved: "Catalog ads look like plain white-background packshots, designing creative per SKU doesn't scale, prices/promos in creatives go stale, and there's no video for catalog ads.",
  key_features: "Feed import, branded image templates with live price, discount, rating and badge overlays, catalog-to-video templates, bulk per-SKU rendering, multiple creatives per product for testing, auto-refresh when the feed changes.",
  differentiators: "Images AND video from the catalog, self-serve set-up in minutes, priced for growing brands rather than enterprise-only, Arabic-first for the GCC.",
  competitors: "Marpipe, Confect, Hunch, Pencil, in-house design + Canva (verify each).",
  pricing: "Plans based on SKU count; a small plan for a limited number of products; credits for rendering and AI usage. See the pricing note in Knowledge.",
  proof_points: "",
  brand_voice: "Friendly, confident and performance-minded: plain words, ROAS-first, no jargon.",
  goals: "$100M ARR long term.",
  budget: "",
  extra_notes: "",
};

const EMPTY = () => ({ version: 1, seq: 0, workspaces: [], notes: [], kpis: [], kpi_values: [], assets: [], sop_checks: [], deals: [], deal_activities: [], hr_roles: [], hr_candidates: [], hr_activities: [], support_articles: [], support_tickets: [], finance_expenses: [], finance_cash: [], finance_reports: [] });

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, "db.json");
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      if (this.#migrate()) this.save();
    } else {
      this.db = EMPTY();
      this.#seed();
      this.save();
    }
  }

  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }

  #id() { return String(++this.db.seq); }
  #now() { return new Date().toISOString(); }

  // The brand was first entered as "DAP ADS"; the real name is DPA AD (dpa.ad).
  #migrate() {
    let changed = false;
    for (const ws of this.db.workspaces) {
      for (const f of ["company_name", "product_name"]) {
        if (/^\s*DAP\s*ADS?\s*$/i.test(ws.brief[f] || "")) { ws.brief[f] = "DPA AD"; changed = true; }
      }
      if (ws.brief.company_name === "DPA AD" && !ws.brief.website) { ws.brief.website = "https://dpa.ad"; changed = true; }
    }
    return changed;
  }

  // First start: create the DPA AD workspace, import the pricing plan and any
  // history from the earlier dashboard (assets.json).
  #seed() {
    const ws = this.createWorkspace(SEED_BRIEF, false);
    const pricing = path.join(SEED_DIR, "pricing.md");
    if (fs.existsSync(pricing)) {
      this.addNote(ws.id, { category: "pricing", title: "Pricing plan proposal", content: fs.readFileSync(pricing, "utf8") }, false);
    }
    const legacy = path.join(this.dir, "assets.json");
    if (fs.existsSync(legacy)) {
      try {
        for (const a of JSON.parse(fs.readFileSync(legacy, "utf8")).reverse()) {
          this.db.assets.unshift({
            id: this.#id(), workspace_id: ws.id, playbook: a.playbook, title: a.title || a.playbook,
            inputs: a.inputs || {}, text: a.text || "", provider: "claude",
            created_at: new Date(a.createdAt || Date.now()).toISOString(),
          });
        }
      } catch (e) {
        console.error("Could not import assets.json:", e.message);
      }
    }
  }

  // ---- sales: deals and their activity log
  listDeals(wsId) { return this.db.deals.filter((d) => d.workspace_id === String(wsId)); }
  getDeal(wsId, id) { return this.db.deals.find((d) => d.workspace_id === String(wsId) && d.id === String(id)) || null; }
  addDeal(wsId, fields) {
    const now = this.#now();
    const d = { id: this.#id(), workspace_id: String(wsId), stage: "lead", created_at: now, stage_changed_at: now, last_activity_at: now, ...fields };
    this.db.deals.push(d);
    this.addDealActivity(d.id, { type: "created", by: "you", text: "" }, false);
    this.save();
    return d;
  }
  updateDeal(wsId, id, fields) {
    const d = this.getDeal(wsId, id);
    if (!d) return null;
    const now = this.#now();
    if (fields.stage && fields.stage !== d.stage) {
      this.addDealActivity(d.id, { type: "stage", by: fields.by || "you", text: `${d.stage} → ${fields.stage}` }, false);
      d.stage_changed_at = now;
    }
    const { by, ...rest } = fields;
    Object.assign(d, rest, { last_activity_at: now });
    this.save();
    return d;
  }
  deleteDeal(wsId, id) {
    const before = this.db.deals.length;
    this.db.deals = this.db.deals.filter((d) => !(d.workspace_id === String(wsId) && d.id === String(id)));
    if (this.db.deals.length === before) return false;
    this.db.deal_activities = this.db.deal_activities.filter((a) => a.deal_id !== String(id));
    this.save();
    return true;
  }
  listDealActivities(dealId) { return this.db.deal_activities.filter((a) => a.deal_id === String(dealId)).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  listWorkspaceActivities(wsId) {
    const ids = new Set(this.listDeals(wsId).map((d) => d.id));
    return this.db.deal_activities.filter((a) => ids.has(a.deal_id));
  }
  addDealActivity(dealId, { type, by, text = "", task = null }, persist = true) {
    const a = { id: this.#id(), deal_id: String(dealId), type, by, task, text, created_at: this.#now() };
    this.db.deal_activities.push(a);
    const d = this.db.deals.find((x) => x.id === String(dealId));
    if (d && type !== "ai_draft") d.last_activity_at = a.created_at;
    if (persist) this.save();
    return a;
  }

  // ---- HR: roles (human seats and AI agents), candidates, activity log
  listHrRoles(wsId) { return this.db.hr_roles.filter((r) => r.workspace_id === String(wsId)); }
  getHrRole(wsId, id) { return this.db.hr_roles.find((r) => r.workspace_id === String(wsId) && r.id === String(id)) || null; }
  addHrRole(wsId, fields, persist = true) {
    const r = { id: this.#id(), workspace_id: String(wsId), created_at: this.#now(), ...fields };
    this.db.hr_roles.push(r);
    if (persist) this.save();
    return r;
  }
  updateHrRole(wsId, id, fields) {
    const r = this.getHrRole(wsId, id);
    if (!r) return null;
    Object.assign(r, fields);
    this.save();
    return r;
  }
  deleteHrRole(wsId, id) {
    const before = this.db.hr_roles.length;
    this.db.hr_roles = this.db.hr_roles.filter((r) => !(r.workspace_id === String(wsId) && r.id === String(id)));
    if (this.db.hr_roles.length === before) return false;
    for (const r of this.db.hr_roles) if (r.reports_to === String(id)) r.reports_to = null;
    for (const c of this.db.hr_candidates) if (c.role_id === String(id)) c.role_id = null;
    this.db.hr_activities = this.db.hr_activities.filter((a) => !(a.entity === "role" && a.entity_id === String(id)));
    this.save();
    return true;
  }
  listHrCandidates(wsId) { return this.db.hr_candidates.filter((c) => c.workspace_id === String(wsId)); }
  getHrCandidate(wsId, id) { return this.db.hr_candidates.find((c) => c.workspace_id === String(wsId) && c.id === String(id)) || null; }
  addHrCandidate(wsId, fields) {
    const now = this.#now();
    const c = { id: this.#id(), workspace_id: String(wsId), stage: "applied", score: null, created_at: now, stage_changed_at: now, last_activity_at: now, ...fields };
    this.db.hr_candidates.push(c);
    this.addHrActivity(String(wsId), "candidate", c.id, { type: "created", by: "you" }, false);
    this.save();
    return c;
  }
  updateHrCandidate(wsId, id, fields) {
    const c = this.getHrCandidate(wsId, id);
    if (!c) return null;
    const now = this.#now();
    if (fields.stage && fields.stage !== c.stage) {
      this.addHrActivity(c.workspace_id, "candidate", c.id, { type: "stage", by: fields.by || "you", text: `${c.stage} → ${fields.stage}` }, false);
      c.stage_changed_at = now;
    }
    const { by, ...rest } = fields;
    Object.assign(c, rest, { last_activity_at: now });
    this.save();
    return c;
  }
  deleteHrCandidate(wsId, id) {
    const before = this.db.hr_candidates.length;
    this.db.hr_candidates = this.db.hr_candidates.filter((c) => !(c.workspace_id === String(wsId) && c.id === String(id)));
    if (this.db.hr_candidates.length === before) return false;
    this.db.hr_activities = this.db.hr_activities.filter((a) => !(a.entity === "candidate" && a.entity_id === String(id)));
    this.save();
    return true;
  }
  listHrActivities(entity, id) {
    return this.db.hr_activities.filter((a) => a.entity === entity && a.entity_id === String(id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  listWorkspaceHrActivities(wsId) { return this.db.hr_activities.filter((a) => a.workspace_id === String(wsId)); }
  addHrActivity(wsId, entity, entityId, { type, by, text = "", task = null }, persist = true) {
    const a = { id: this.#id(), workspace_id: String(wsId), entity, entity_id: String(entityId), type, by, task, text, created_at: this.#now() };
    this.db.hr_activities.push(a);
    if (entity === "candidate" && type !== "ai_draft") {
      const c = this.db.hr_candidates.find((x) => x.id === String(entityId));
      if (c) c.last_activity_at = a.created_at;
    }
    if (persist) this.save();
    return a;
  }

  // ---- support: help-center articles and tickets (messages embedded)
  listArticles(wsId) { return this.db.support_articles.filter((a) => a.workspace_id === String(wsId)); }
  addArticle(wsId, { question, answer, language = "en", category = "other" }, persist = true) {
    const a = { id: this.#id(), workspace_id: String(wsId), question, answer, language, category, created_at: this.#now(), updated_at: this.#now() };
    this.db.support_articles.push(a);
    if (persist) this.save();
    return a;
  }
  updateArticle(wsId, id, fields) {
    const a = this.db.support_articles.find((x) => x.workspace_id === String(wsId) && x.id === String(id));
    if (!a) return null;
    Object.assign(a, fields, { updated_at: this.#now() });
    this.save();
    return a;
  }
  deleteArticle(wsId, id) {
    const before = this.db.support_articles.length;
    this.db.support_articles = this.db.support_articles.filter((a) => !(a.workspace_id === String(wsId) && a.id === String(id)));
    if (before === this.db.support_articles.length) return false;
    this.save();
    return true;
  }
  listTickets(wsId) { return this.db.support_tickets.filter((t) => t.workspace_id === String(wsId)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  getTicket(wsId, id) { return this.db.support_tickets.find((t) => t.workspace_id === String(wsId) && t.id === String(id)) || null; }
  findTicketByToken(wsId, token) { return this.db.support_tickets.find((t) => t.workspace_id === String(wsId) && t.public_token && t.public_token === token) || null; }
  addTicket(wsId, fields) {
    const now = this.#now();
    const t = { id: this.#id(), workspace_id: String(wsId), status: "new", category: "other", language: "", messages: [], human_touched: false, created_at: now, updated_at: now, ...fields };
    this.db.support_tickets.push(t);
    this.save();
    return t;
  }
  updateTicket(wsId, id, fields) {
    const t = this.getTicket(wsId, id);
    if (!t) return null;
    Object.assign(t, fields, { updated_at: this.#now() });
    this.save();
    return t;
  }
  addTicketMessage(wsId, id, { from, text, sent = true, draft = false }) {
    const t = this.getTicket(wsId, id);
    if (!t) return null;
    const m = { id: this.#id(), from, text, sent, draft, at: this.#now() };
    t.messages.push(m);
    t.updated_at = m.at;
    if (from === "you") t.human_touched = true;
    this.save();
    return m;
  }
  deleteTicket(wsId, id) {
    const before = this.db.support_tickets.length;
    this.db.support_tickets = this.db.support_tickets.filter((t) => !(t.workspace_id === String(wsId) && t.id === String(id)));
    if (before === this.db.support_tickets.length) return false;
    this.save();
    return true;
  }
  setSupportSettings(wsId, fields) {
    const ws = this.getWorkspace(wsId);
    if (!ws) return null;
    ws.support = { widget_enabled: false, widget_key: null, ...(ws.support || {}), ...fields };
    this.save();
    return ws.support;
  }
  findWorkspaceByWidgetKey(key) { return this.db.workspaces.find((w) => w.support?.widget_key && w.support.widget_key === key) || null; }

  // ---- finance: expenses, bank-balance snapshots, AI CFO reports, settings on the workspace
  listExpenses(wsId) { return this.db.finance_expenses.filter((e) => e.workspace_id === String(wsId)).sort((a, b) => b.date.localeCompare(a.date)); }
  addExpense(wsId, fields, persist = true) {
    const e = { id: this.#id(), workspace_id: String(wsId), created_at: this.#now(), ...fields };
    this.db.finance_expenses.push(e);
    if (persist) this.save();
    return e;
  }
  updateExpense(wsId, id, fields) {
    const e = this.db.finance_expenses.find((x) => x.workspace_id === String(wsId) && x.id === String(id));
    if (!e) return null;
    Object.assign(e, fields);
    this.save();
    return e;
  }
  deleteExpense(wsId, id) { return this.#removeWs("finance_expenses", wsId, id); }
  listCash(wsId) { return this.db.finance_cash.filter((c) => c.workspace_id === String(wsId)); }
  addCash(wsId, { date, balance_sar, note = "" }) {
    const c = { id: this.#id(), workspace_id: String(wsId), date, balance_sar, note, created_at: this.#now() };
    this.db.finance_cash.push(c);
    this.save();
    return c;
  }
  deleteCash(wsId, id) { return this.#removeWs("finance_cash", wsId, id); }
  listFinanceReports(wsId) { return this.db.finance_reports.filter((r) => r.workspace_id === String(wsId)).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  addFinanceReport(wsId, { task, title, text }) {
    const r = { id: this.#id(), workspace_id: String(wsId), task, title, text, created_at: this.#now() };
    this.db.finance_reports.push(r);
    this.save();
    return r;
  }
  setFinanceSettings(wsId, fields) {
    const ws = this.getWorkspace(wsId);
    if (!ws) return null;
    ws.finance = { ...(ws.finance || {}), ...fields, budgets: { ...(ws.finance?.budgets || {}), ...(fields.budgets || {}) } };
    this.save();
    return ws.finance;
  }
  #removeWs(coll, wsId, id) {
    const before = this.db[coll].length;
    this.db[coll] = this.db[coll].filter((x) => !(x.workspace_id === String(wsId) && x.id === String(id)));
    if (before === this.db[coll].length) return false;
    this.save();
    return true;
  }

  // ---- SOP ticks: one row per workspace + cadence period + step
  listSopChecks(wsId, periods) {
    return this.db.sop_checks.filter((c) => c.workspace_id === String(wsId) && periods.includes(c.period));
  }
  setSopCheck(wsId, { period, step, done }) {
    wsId = String(wsId);
    const i = this.db.sop_checks.findIndex((c) => c.workspace_id === wsId && c.period === period && c.step === step);
    if (done && i < 0) this.db.sop_checks.push({ workspace_id: wsId, period, step, done_at: this.#now() });
    if (!done && i >= 0) this.db.sop_checks.splice(i, 1);
    this.save();
  }

  // ---- workspaces
  listWorkspaces() { return this.db.workspaces; }
  getWorkspace(id) { return this.db.workspaces.find((w) => w.id === String(id)) || null; }
  createWorkspace(brief, persist = true) {
    const ws = { id: this.#id(), brief: cleanBrief(brief), created_at: this.#now() };
    this.db.workspaces.push(ws);
    if (persist) this.save();
    return ws;
  }
  updateWorkspace(id, brief) {
    const ws = this.getWorkspace(id);
    if (!ws) return null;
    ws.brief = cleanBrief(brief);
    this.save();
    return ws;
  }
  deleteWorkspace(id) {
    id = String(id);
    const before = this.db.workspaces.length;
    this.db.workspaces = this.db.workspaces.filter((w) => w.id !== id);
    if (this.db.workspaces.length === before) return false;
    const kpiIds = new Set(this.db.kpis.filter((k) => k.workspace_id === id).map((k) => k.id));
    this.db.kpi_values = this.db.kpi_values.filter((v) => !kpiIds.has(v.kpi_id));
    const dealIds = new Set(this.db.deals.filter((d) => d.workspace_id === id).map((d) => d.id));
    this.db.deal_activities = this.db.deal_activities.filter((a) => !dealIds.has(a.deal_id));
    for (const c of ["notes", "kpis", "assets", "sop_checks", "deals", "hr_roles", "hr_candidates", "hr_activities", "support_articles", "support_tickets", "finance_expenses", "finance_cash", "finance_reports"]) this.db[c] = this.db[c].filter((x) => x.workspace_id !== id);
    this.save();
    return true;
  }

  // ---- knowledge notes
  listNotes(wsId) { return this.db.notes.filter((n) => n.workspace_id === String(wsId)); }
  addNote(wsId, { category, title, content }, persist = true) {
    const note = { id: this.#id(), workspace_id: String(wsId), category, title: String(title).slice(0, 300), content: String(content).slice(0, 100000), created_at: this.#now() };
    this.db.notes.push(note);
    if (persist) this.save();
    return note;
  }
  deleteNote(wsId, id) { return this.#remove("notes", wsId, id); }

  // ---- KPIs
  listKpis(wsId) { return this.db.kpis.filter((k) => k.workspace_id === String(wsId)); }
  getKpi(id) { return this.db.kpis.find((k) => k.id === String(id)) || null; }
  addKpi(wsId, kpi, persist = true) {
    const row = {
      id: this.#id(), workspace_id: String(wsId),
      stage: String(kpi.stage || ""), name: String(kpi.name), formula: String(kpi.formula || ""),
      unit: String(kpi.unit || ""), frequency: String(kpi.frequency || "weekly"), owner: String(kpi.owner || ""),
      target: kpi.target === null || kpi.target === undefined || kpi.target === "" ? null : Number(kpi.target),
      higher_is_better: kpi.higher_is_better !== false,
    };
    this.db.kpis.push(row);
    if (persist) this.save();
    return row;
  }
  deleteKpi(wsId, id) {
    const ok = this.#remove("kpis", wsId, id, false);
    if (ok) { this.db.kpi_values = this.db.kpi_values.filter((v) => v.kpi_id !== String(id)); this.save(); }
    return ok;
  }
  logKpiValue(kpiId, { period, value, note = "" }) {
    kpiId = String(kpiId);
    let row = this.db.kpi_values.find((v) => v.kpi_id === kpiId && v.period === period);
    if (row) Object.assign(row, { value, note });
    else this.db.kpi_values.push((row = { id: this.#id(), kpi_id: kpiId, period, value, note }));
    this.save();
    return row;
  }
  listKpiValues(wsId) {
    const ids = new Set(this.listKpis(wsId).map((k) => k.id));
    return this.db.kpi_values.filter((v) => ids.has(v.kpi_id)).sort((a, b) => a.period.localeCompare(b.period));
  }

  // ---- generated assets (newest first)
  listAssets(wsId) { return this.db.assets.filter((a) => a.workspace_id === String(wsId)); }
  latestAsset(wsId, playbook) { return this.listAssets(wsId).find((a) => a.playbook === playbook) || null; }
  addAsset(wsId, asset) {
    const row = { id: this.#id(), workspace_id: String(wsId), created_at: this.#now(), ...asset };
    this.db.assets.unshift(row);
    this.save();
    return row;
  }
  deleteAsset(wsId, id) { return this.#remove("assets", wsId, id); }

  #remove(coll, wsId, id, persist = true) {
    const before = this.db[coll].length;
    this.db[coll] = this.db[coll].filter((x) => !(x.id === String(id) && x.workspace_id === String(wsId)));
    const ok = this.db[coll].length < before;
    if (ok && persist) this.save();
    return ok;
  }
}
