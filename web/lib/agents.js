// AI Workforce: every AI agent in the dashboard, managed like an employee. Each has a job, a named person
// responsible, an autonomy level it earns from its track record, a monthly budget, and a log of every run
// (tokens, cost, errors) and every outcome (accepted unchanged, edited, rejected, escalated).
import { AsyncLocalStorage } from "node:async_hooks";
import { LLMError } from "./engine.js";

// Autonomy ladder. Agents move up only on a track record and drop back on mistakes.
export const LEVELS = [
  { id: 0, name: "Off", hint: "Paused: does nothing." },
  { id: 1, name: "Drafts", hint: "Prepares work; a person approves every item before anything happens." },
  { id: 2, name: "Auto + spot-check", hint: "Handles routine items by itself; anything unusual, and a sample of the rest, goes to a person." },
  { id: 3, name: "Fully automatic", hint: "Acts on its own; people review the log and the exceptions." },
];

// The agents. `max` is the highest level the dashboard supports for that job today.
// `levels` says what each level actually changes for this agent.
export const AGENTS = [
  { id: "coordinator", name: "Ask DPA AD (Coordinator)", team: "Leadership", module: "command", route: "command", max: 2, level: 1, budget: 60,
    job: "The assistant on every page: answers questions from the dashboard's data and makes changes for the signed-in person.",
    levels: { 1: "Asks before every change.", 2: "Makes low-risk changes (notes, tasks, content ideas) without asking; bulk store changes, deals and campaigns still need a yes." } },
  { id: "support_agent", name: "AI Support agent", team: "Customer Success", module: "support", route: "support", max: 3, level: 2, budget: 60,
    job: "Answers store questions in the website chat from the help center; hands over to a person when unsure.",
    levels: { 1: "Drafts answers; a person sends every reply.", 2: "Answers checked questions live; escalates anything unsure.", 3: "Same as 2 (escalation rules always apply)." } },
  { id: "crm_triage", name: "AI Inbox triage", team: "Sales", module: "crm", route: "crm", max: 3, level: 2, budget: 40,
    job: "Reads store replies, sets the intent, moves stores in the pipeline, creates Sales deals, honours unsubscribes.",
    levels: { 1: "Only labels the intent; a person moves the store.", 2: "Moves stores and creates deals; unclear replies go to a person.", 3: "Same as 2." } },
  { id: "crm_replier", name: "AI Reply writer", team: "Sales", module: "crm", route: "crm", max: 2, level: 1, budget: 30,
    job: "Drafts the answer to every store reply in the CRM inbox.",
    levels: { 1: "Drafts; a person sends.", 2: "Sends answers to simple questions and interested stores when it's confident; the rest wait for a person." } },
  { id: "crm_sequence_writer", name: "AI Sequence writer", team: "Marketing", module: "crm", route: "crm", max: 1, level: 1, budget: 20,
    job: "Writes outreach, newsletter and onboarding sequences per category.", levels: { 1: "Writes; a person launches the campaign." } },
  { id: "sales_assistant", name: "AI Sales assistant", team: "Sales", module: "sales", route: "pipeline", max: 1, level: 1, budget: 30,
    job: "Prospect pages, WhatsApp openers, follow-ups, objection answers and call prep for each deal.", levels: { 1: "Drafts; a person sends and does the calls." } },
  { id: "creative_strategist", name: "AI Content strategist", team: "Marketing", module: "creative", route: "studio", max: 1, level: 1, budget: 20,
    job: "Plans the monthly content calendar around Saudi seasons and finds ideas in real material.", levels: { 1: "Suggests; a person keeps or drops ideas." } },
  { id: "creative_copywriter", name: "AI Copywriter", team: "Marketing", module: "creative", route: "studio", max: 3, level: 1, budget: 40,
    job: "Writes every channel version in Arabic and English: captions, scripts, slides, emails.",
    levels: { 1: "Writes; a person approves every piece.", 2: "Its pieces that pass every check are approved automatically, except 1 in 5 spot-checked and anything with a number claim.", 3: "Approves its own pieces that pass every check; number claims still go to a person." } },
  { id: "creative_publisher", name: "AI Publisher", team: "Marketing", module: "creative", route: "studio", max: 2, level: 1, budget: 5,
    job: "Publishes approved, scheduled content at the planned time on connected platforms.",
    levels: { 1: "Waits for a person to press Publish.", 2: "Publishes approved content on schedule." } },
  { id: "marketing_strategist", name: "AI Marketing strategist", team: "Marketing", module: "marketing", route: "playbooks", max: 1, level: 1, budget: 40,
    job: "Runs the playbooks: positioning, ICP, messaging, landing pages, ads, GTM plans.", levels: { 1: "Writes; a person decides." } },
  { id: "finance_cfo", name: "AI CFO", team: "Finance", module: "finance", route: "finance", max: 1, level: 1, budget: 20,
    job: "Monthly reports, cost reviews, investor updates, sorting bank-statement lines.", levels: { 1: "Drafts and sorts; a person approves payments and filings." } },
  { id: "ops_planner", name: "AI Operations planner", team: "Operations", module: "ops", route: "ops", max: 1, level: 1, budget: 20,
    job: "Turns goals into tasks, writes incident summaries and weekly ops reports.", levels: { 1: "Plans; a person assigns and closes." } },
  { id: "product_analyst", name: "AI Product analyst", team: "Product", module: "product", route: "product", max: 1, level: 1, budget: 20,
    job: "Groups feedback into requests, writes specs and release notes.", levels: { 1: "Drafts; a person decides the roadmap." } },
  { id: "recruiter", name: "AI Recruiter", team: "People", module: "team", route: "team", max: 1, level: 1, budget: 20,
    job: "Writes job posts, screens candidates against the role, drafts messages.", levels: { 1: "Screens and drafts; a person interviews and decides." } },
  { id: "roas_analyst", name: "AI Results analyst", team: "Customer Success", module: "results", route: "results", max: 1, level: 1, budget: 10,
    job: "Turns ROAS results into case studies (real numbers only).", levels: { 1: "Drafts; a person gets the store's permission and publishes." } },
];
export const AGENT_IDS = AGENTS.map((a) => a.id);
export const agentDef = (id) => AGENTS.find((a) => a.id === id);

// Which agent an API call belongs to (so every AI run is attributed and budgeted).
export function agentFor(method, path) {
  const p = path.split("?")[0];
  if (p.startsWith("/api/public/support")) return "support_agent";
  const seg = p.split("/").filter(Boolean)[3] || "";
  if (seg === "creative") return /\/(plan|ideas)$/.test(p) ? "creative_strategist" : "creative_copywriter";
  if (seg === "crm") return /ai-write/.test(p) ? "crm_sequence_writer" : "crm_triage";
  return ({ run: "marketing_strategist", deals: "sales_assistant", support: "support_agent", finance: "finance_cfo", ops: "ops_planner", product: "product_analyst", hr: "recruiter", roas: "roas_analyst" })[seg] || null;
}

// Prices per million tokens (Anthropic API list prices). Unknown models are charged at the default model's rate.
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_read: 0.01 },
  "claude-fable-5-1": { input: 10, output: 50, cache_read: 0.25 },
  "claude-opus-5": { input: 5, output: 25, cache_read: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cache_read: 0.5 },
};
export function costOf(usage, model, fallbackModel = "claude-opus-5-5") {
  if (!usage) return 0;
  const p = PRICES[model] || PRICES[fallbackModel] || PRICES["claude-opus-5-5"];
  const write = (usage.cache_creation_input_tokens || 0) * p.input * 1.25;
  return ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output + (usage.cache_read_input_tokens || 0) * p.cache_read + write) / 1e6;
}

export const als = new AsyncLocalStorage();
export const withAgent = (agent, ws, fn) => als.run({ agent, ws: ws ? String(ws) : null }, fn);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

export class Workforce {
  constructor(store) {
    this.store = store;
    const db = store.db;
    db.agent_runs ||= []; db.agent_events ||= []; db.agents ||= {};
  }
  config(id) {
    const d = agentDef(id), c = this.store.db.agents[id] || {};
    return { level: Math.min(d.max, c.level ?? d.level), owner_id: c.owner_id ?? null, budget_usd: c.budget_usd ?? d.budget, paused: !!c.paused, notes: c.notes || "", changed_at: c.changed_at || null };
  }
  level(id) { const d = agentDef(id); if (!d) return 1; const c = this.config(id); return c.paused ? 0 : c.level; }
  set(id, fields, by = "system") {
    const d = agentDef(id); if (!d) return null;
    const cur = this.store.db.agents[id] || {}, before = this.config(id).level;
    const next = { ...cur };
    if (fields.level !== undefined) next.level = Math.max(0, Math.min(d.max, Math.round(Number(fields.level) || 0)));
    if (fields.owner_id !== undefined) next.owner_id = fields.owner_id || null;
    if (fields.budget_usd !== undefined) next.budget_usd = Math.max(0, Math.min(100000, Number(fields.budget_usd) || 0));
    if (fields.paused !== undefined) next.paused = !!fields.paused;
    if (fields.notes !== undefined) next.notes = String(fields.notes).slice(0, 500);
    if (fields.level !== undefined && next.level !== before) this.event(id, null, "level", `Level ${before} → ${next.level} by ${by}`, false);
    next.changed_at = new Date().toISOString();
    this.store.db.agents[id] = next; this.store.save();
    return this.config(id);
  }
  spent(id, m = month()) { return this.store.db.agent_runs.filter((r) => r.agent_id === id && r.at.startsWith(m)).reduce((a, r) => a + (r.cost || 0), 0); }
  // Before an AI call: refuse when the agent is paused or over budget.
  check(id) {
    const d = agentDef(id); if (!d) return;
    const c = this.config(id);
    if (c.paused || c.level === 0) throw new LLMError(`${d.name} is switched off in AI Workforce. An Owner or Admin can turn it back on.`);
    if (c.budget_usd > 0 && this.spent(id) >= c.budget_usd) throw new LLMError(`${d.name} reached its monthly AI budget ($${c.budget_usd}). Raise it in AI Workforce.`);
  }
  run(id, ws, r) {
    const runs = this.store.db.agent_runs;
    runs.push({ at: new Date().toISOString(), agent_id: id || "unassigned", ws: ws || null, ...r });
    if (runs.length > 20000) runs.splice(0, runs.length - 20000);
    if (!r.ok && id) this.event(id, ws, "error", String(r.error || "").slice(0, 200), false);
    this.store.save();
  }
  // Outcomes: accepted (used unchanged), edited, rejected, escalated, auto (acted alone), error, level.
  event(id, ws, outcome, note = "", save = true) {
    if (!agentDef(id)) return;
    const ev = this.store.db.agent_events;
    ev.push({ at: new Date().toISOString(), agent_id: id, ws: ws || null, outcome, note: String(note).slice(0, 300) });
    if (ev.length > 20000) ev.splice(0, ev.length - 20000);
    if (["rejected", "error"].includes(outcome)) this.#maybeDemote(id);
    if (save) this.store.save();
  }
  #maybeDemote(id) {
    const c = this.config(id);
    if (c.level < 2) return;
    const last = this.store.db.agent_events.filter((e) => e.agent_id === id && e.outcome !== "level").slice(-20);
    if (last.filter((e) => ["rejected", "error"].includes(e.outcome)).length >= 3) {
      const cur = this.store.db.agents[id] || {};
      this.store.db.agents[id] = { ...cur, level: c.level - 1, changed_at: new Date().toISOString(), demoted_at: new Date().toISOString() };
      this.store.db.agent_events.push({ at: new Date().toISOString(), agent_id: id, outcome: "level", note: `Moved down to level ${c.level - 1} automatically: 3 rejections or errors in its last 20 items.` });
    }
  }
  stats(id, now = new Date()) {
    const d = agentDef(id), c = this.config(id), m = month(now);
    const runs = this.store.db.agent_runs.filter((r) => r.agent_id === id);
    const mRuns = runs.filter((r) => r.at.startsWith(m));
    const ev = this.store.db.agent_events.filter((e) => e.agent_id === id && e.outcome !== "level");
    const last50 = ev.slice(-50);
    const judged = last50.filter((e) => ["accepted", "edited", "rejected"].includes(e.outcome));
    const accepted = judged.filter((e) => e.outcome === "accepted").length;
    const quality = judged.length ? Math.round((accepted / judged.length) * 1000) / 10 : null;
    const errors50 = last50.filter((e) => e.outcome === "error").length;
    const spent = mRuns.reduce((a, r) => a + (r.cost || 0), 0);
    const canPromote = c.level < d.max && c.level > 0 && judged.length >= 50 && quality >= 95 && errors50 === 0;
    return {
      runs_month: mRuns.length, errors_month: mRuns.filter((r) => !r.ok).length, cost_month: Math.round(spent * 100) / 100,
      tokens_month: mRuns.reduce((a, r) => a + (r.in || 0) + (r.out || 0), 0), last_run: runs.at(-1)?.at || null,
      runs_today: runs.filter((r) => r.at.slice(0, 10) === now.toISOString().slice(0, 10)).length, last_ok: runs.at(-1) ? runs.at(-1).ok : null,
      last_note: (() => { const e = this.store.db.agent_events.filter((x) => x.agent_id === id).at(-1); return e ? { at: e.at, outcome: e.outcome, note: e.note } : null; })(),
      outcomes: Object.fromEntries(["accepted", "edited", "rejected", "escalated", "auto", "error"].map((o) => [o, last50.filter((e) => e.outcome === o).length])),
      judged: judged.length, quality, can_promote: canPromote,
      promote_hint: c.level >= d.max ? "Already at the highest level this job supports." : judged.length < 50 ? `Needs ${50 - judged.length} more reviewed items before it can move up.` : quality < 95 ? `Needs 95% used unchanged (now ${quality}%).` : errors50 ? "Needs zero errors in its last 50 items." : "Ready to move up a level.",
      budget_pct: c.budget_usd ? Math.round((spent / c.budget_usd) * 100) : null,
    };
  }
  // The provider every module uses: attributes each call to an agent, enforces pause and budget, records usage.
  wrap(provider) {
    const self = this;
    return {
      ...provider,
      async generate(args) {
        const ctx = als.getStore() || {}, id = ctx.agent && agentDef(ctx.agent) ? ctx.agent : null;
        if (id) self.check(id);
        const t0 = Date.now();
        let usage = null, model = provider.model;
        try {
          const out = await provider.generate({ ...args, onUsage: (u, m) => { usage = u; model = m || model; } });
          self.run(id, ctx.ws, { ok: true, ms: Date.now() - t0, model, in: usage?.input_tokens || 0, out: usage?.output_tokens || 0, cost: Math.round(costOf(usage, model, provider.model) * 1e6) / 1e6 });
          return out;
        } catch (e) {
          self.run(id, ctx.ws, { ok: false, ms: Date.now() - t0, model, in: usage?.input_tokens || 0, out: usage?.output_tokens || 0, cost: Math.round(costOf(usage, model, provider.model) * 1e6) / 1e6, error: e?.message || "error" });
          throw e;
        }
      },
    };
  }
}
