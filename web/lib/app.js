// The Express app: login, JSON API and streaming generation. server.js starts it.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_KPIS, GAP_TOTAL, LAUNCH_KIT, NOTE_CATEGORIES, PLAYBOOKS, dataGaps } from "./catalog.js";
import { LLMError, SYSTEM, buildPrompt } from "./engine.js";
import { SOP, periodFor } from "./sop.js";
import { commandSnapshot } from "./command.js";
import { LEVELS, MODULES, MODULE_IDS, STARTER_TEAMS, checkPassword, describe, hashPassword, levelOk, moduleFor } from "./access.js";
import { CHANNELS as AD_CHANNELS, CREATIVE_TYPES, caseStudyPrompt, classifyAd, parseAdsCsv, roasSummary } from "./roas.js";
import { CrmStore } from "./crmstore.js";
import { COST_FIELDS, DEFAULT_PRICING, PLAN_FIELDS, cleanPricing, pricingModel } from "./pricing.js";
import { createOutreach } from "./outreach.js";
import { mountCrm, mountCrmPublic } from "./crmroutes.js";
import { mountCreative } from "./creativeroutes.js";
import { mountPeople, peopleNeeds } from "./peopleroutes.js";
import { Workforce, agentFor, withAgent } from "./agents.js";
import { mountWorkforce, workforceSummary } from "./agentroutes.js";
import { claudeAssistantClient, createAssistant } from "./assistant.js";
import { createProducts } from "./products.js";
import { createPublisher } from "./publisher.js";
import { socialConfig } from "./social.js";
import { mountStudio, mountStudioPublic } from "./studioroutes.js";
import { billingForFinance } from "./billing.js";
import { billingCommandHook, createBillingService, mountBilling, mountBillingPublic, mountCustomersLite } from "./billingroutes.js";
import { hasSampleData, loadSampleData, removeSampleData } from "./samples.js";
import { createBackups } from "./backup.js";
import { createStatus } from "./status.js";
import { complianceNeeds, mountCompliance, mountCompliancePublic } from "./complianceroutes.js";
import { EFFORT, ITEM_STATUS, ITEM_STATUS_IDS, ITEM_TYPES, PRODUCT_AREAS, STARTER_ROADMAP, cleanItem, clusterPrompt, parseClusters, productSnapshot, releasePrompt, specPrompt } from "./product.js";
import { AREAS, INCIDENT_STATUS, OPS_TASKS, REPEATS, SEVERITY, TASK_STATUS, TASK_STATUS_IDS, incidentPrompt, opsReportPrompt, opsSnapshot, parsePlan, planPrompt, rollForward, saudiStarter } from "./ops.js";
import { CATEGORIES as FIN_CATEGORIES, CAT_IDS, FIN_TASKS, INCOME_IDS, INCOME_TYPES, financePrompt, financeSnapshot, importPrompt, parseImport } from "./finance.js";
import { CATEGORIES as SUPPORT_CATEGORIES, CHANNELS, ESCALATION_RULES, SYSTEM_SUPPORT, TICKET_STATUS, parseArticles, parseReply, replyPrompt, starterKbPrompt, supportSummary } from "./support.js";
import { CANDIDATE_TASKS, CAND_STAGES, CAND_STAGE_IDS, DEPARTMENTS, EMPLOYMENT, ROLE_STATUS, ROLE_TASKS, SUGGESTED_ORG, SAMPLE_TEAM, candidatePrompt, enrichCandidate, hrSummary, parseScore, rolePrompt } from "./hr.js";
import { AI_TASKS, CITIES, OPEN, PLANS, PLATFORMS, STAGES, STAGE_IDS, enrich, salesPrompt, summary } from "./sales.js";

const __dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export function createApp({ store, provider: baseProvider, password, crm = new CrmStore(store.dir), outreachOptions = {}, assistantClient = null, productOptions = {}, studioOptions = {}, billingOptions = {}, backupOptions = {}, statusOptions = {}, env = process.env }) {
  // AI Workforce: every AI call goes through one provider that attributes it to an agent, enforces the
  // agent's pause switch and budget, and records tokens and cost.
  const workforce = new Workforce(store);
  const provider = workforce.wrap(baseProvider);
  const triageProvider = { ...provider, generate: (a) => withAgent("crm_triage", null, () => provider.generate(a)) };
  const outreach = createOutreach({ store, crm, provider: triageProvider, levelOf: (id) => workforce.level(id), onOutcome: (id, ws, o, note) => workforce.event(id, ws, o, note), ...outreachOptions });
  const products = createProducts({ crm, ...productOptions }); // product samples per store (fetch jobs)
  const studio = createPublisher({ store, provider, cfg: socialConfig(process.env, password),
    publisherLevel: () => workforce.level("creative_publisher"), setPublisherLevel: (on, by) => workforce.set("creative_publisher", { level: on ? 2 : 1, paused: false }, by), ...studioOptions }); // Creative Studio publishing
  const backups = createBackups({ store, crm, env, ...backupOptions }); // nightly encrypted backups (Security & compliance)
  const status = createStatus({ store, ...statusOptions }); // public status page
  const billing = createBillingService({ store, crm, outreach, ...billingOptions }); // Billing & customers: subscriptions, invoices, Moyasar, ZATCA, dunning
  // Session cookies are signed with a key derived from the password, so changing it logs everyone out.
  const secret = crypto.createHash("sha256").update("mwiz:" + password).digest();
  const sign = (v) => v + "." + crypto.createHmac("sha256", secret).update(v).digest("base64url");
  // Cookie value is "<userId>~<expiry>" (signed). An older cookie with only "<expiry>" is the Owner.
  const OWNER = { id: "owner", name: "Owner (team password)", email: "", role_id: "owner", team_ids: [], active: true };
  const userById = (id) => (id === "owner" ? OWNER : store.db.users.find((u) => u.id === id && u.active) || null);
  const sessionUser = (req) => {
    const m = /(?:^|;\s*)mwiz=([^;]+)/.exec(req.headers.cookie || "");
    if (!m || !password) return null;
    const value = m[1].slice(0, m[1].lastIndexOf("."));
    const expected = sign(value);
    if (expected.length !== m[1].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[1]))) return null;
    const [a, b] = value.split("~");
    const uid = b === undefined ? "owner" : a, exp = Number(b === undefined ? a : b);
    return exp > Date.now() ? userById(uid) : null;
  };
  const validSession = (req) => !!sessionUser(req);
  const permsOf = (user) => ({ ...Object.fromEntries(MODULE_IDS.map((m) => [m, "none"])), ...(store.db.roles.find((r) => r.id === user.role_id)?.perms || {}) });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { if (req.url.startsWith("/hooks/")) req.rawBody = buf; } }));
  app.locals.crm = crm; app.locals.outreach = outreach; app.locals.workforce = workforce; app.locals.products = products; app.locals.studio = studio; app.locals.backups = backups; app.locals.status = status; app.locals.billing = billing;
  // Tag each API request with the agent whose work it is (see agentFor) so AI runs are attributed.
  app.use((req, res, next) => {
    const agent = req.path.startsWith("/api/") ? agentFor(req.method, req.path) : null;
    if (!agent) return next();
    const ws = /^\/api\/workspaces\/([^/]+)/.exec(req.path)?.[1] || null;
    withAgent(agent, ws, next);
  });
  app.use(express.urlencoded({ extended: false }));

  // ---- login (with a simple brute-force brake)
  const attempts = new Map();
  app.post("/login", (req, res) => {
    const ip = req.ip;
    const a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) return res.redirect("/login?e=locked");
    const given = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();
    let uid = null;
    if (email) {
      // A person's own login.
      const u = store.db.users.find((x) => x.email === email && x.active);
      if (password && u && checkPassword(given, u)) uid = u.id;
    } else if (password && given.length === password.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password))) uid = "owner";
    if (!uid) { a.n++; attempts.set(ip, a); return res.redirect("/login?e=" + (password ? "bad" : "unset")); }
    attempts.delete(ip);
    if (uid !== "owner") { const u = store.db.users.find((x) => x.id === uid); u.last_login_at = new Date().toISOString(); store.save(); }
    const expires = Date.now() + 30 * 864e5;
    res.setHeader("Set-Cookie", `mwiz=${sign(`${uid}~${expires}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
    res.redirect("/");
  });
  app.post("/logout", (req, res) => {
    res.setHeader("Set-Cookie", "mwiz=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    res.redirect("/login");
  });
  app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
  app.get(["/healthz", "/api/ping"], (req, res) => res.json({ ok: true }));
  app.get("/app.css", (req, res) => res.sendFile(path.join(__dirname, "public", "app.css")));

  // ---- public website chat (no login). Off until switched on in Support → Website chat.
  // Answers only from the help center; anything it can't answer goes to a person.
  const chatHits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now(), list = (chatHits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now); chatHits.set(key, list);
    return list.length > max;
  };
  const widgetWs = (req, res) => {
    const w = store.findWorkspaceByWidgetKey(String(req.params.key || ""));
    if (!w || !w.support?.widget_enabled) { res.status(404).json({ detail: "Chat is not available." }); return null; }
    return w;
  };
  app.get("/support/:key", (req, res) => {
    const w = store.findWorkspaceByWidgetKey(String(req.params.key || ""));
    if (!w || !w.support?.widget_enabled) return res.status(404).send("Chat is not available.");
    res.sendFile(path.join(__dirname, "public", "chat.html"));
  });
  app.get("/api/public/support/:key", (req, res) => {
    const w = widgetWs(req, res); if (!w) return;
    res.json({ company: w.brief.company_name, website: w.brief.website || "" });
  });
  app.post("/api/public/support/:key/chat", async (req, res) => {
    const w = widgetWs(req, res); if (!w) return;
    const text = String(req.body?.message || "").trim().slice(0, 1000);
    if (!text) return res.status(422).json({ detail: "Write a message first." });
    if (limited("ip:" + req.ip, 20, 10 * 60e3) || limited("ws:" + w.id, 400, 864e5)) return res.status(429).json({ detail: "Too many messages. Please try again in a few minutes." });
    let t = req.body?.token ? store.findTicketByToken(w.id, String(req.body.token)) : null;
    if (!t) {
      t = store.addTicket(w.id, { channel: "Website chat", customer_name: String(req.body?.name || "").trim().slice(0, 100), contact: String(req.body?.contact || "").trim().slice(0, 200), store: "", public_token: crypto.randomBytes(18).toString("base64url") });
    } else if (req.body?.contact && !t.contact) store.updateTicket(w.id, t.id, { contact: String(req.body.contact).trim().slice(0, 200) });
    if (t.messages.length >= 40) return res.status(429).json({ detail: "This chat is full. A team member will follow up.", token: t.public_token });
    store.addTicketMessage(w.id, t.id, { from: "customer", text });
    if (t.status === "needs_human") {
      // Already with a person: don't let AI talk over them.
      return res.json({ token: t.public_token, reply: null, handed_over: true });
    }
    try {
      const raw = await provider.generate({ system: SYSTEM_SUPPORT, prompt: replyPrompt(w, store.listArticles(w.id), store.getTicket(w.id, t.id)), onText: () => {} });
      const r = parseReply(raw);
      // Level 1 (drafts only): the AI's answer waits for a person instead of going to the customer.
      const live = workforce.level("support_agent") >= 2;
      if (r.checked) store.addTicketMessage(w.id, t.id, { from: "ai", text: r.reply, sent: live });
      const escalate = r.escalate || !live;
      store.updateTicket(w.id, t.id, { category: r.category, language: r.language, status: escalate ? "needs_human" : "ai_answered", escalation_reason: r.escalate ? r.reason : !live ? "AI Support is on drafts only: check and send the draft" : "" });
      workforce.event("support_agent", w.id, r.escalate || !r.checked ? "escalated" : live ? "auto" : "escalated", r.category);
      res.json({ token: t.public_token, reply: r.checked && live ? r.reply : null, handed_over: escalate });
    } catch (e) {
      store.updateTicket(w.id, t.id, { status: "needs_human", escalation_reason: "AI could not answer: " + (e?.message || "error") });
      res.json({ token: t.public_token, reply: null, handed_over: true });
    }
  });

  mountCrmPublic(app, { crm, outreach });
  mountStudioPublic(app, { store, studio });
  mountCompliancePublic(app, { status });
  mountBillingPublic(app, { store, billing });

  // Everything below needs a session, and each API call needs the right level on its module.
  app.use((req, res, next) => {
    const user = sessionUser(req);
    if (!user) {
      if (req.path.startsWith("/api/")) return res.status(401).json({ detail: "Please log in again." });
      return res.redirect("/login");
    }
    req.user = user; req.perms = permsOf(user);
    if (req.path.startsWith("/api/")) {
      const mod = moduleFor(req.method, req.path);
      const need = req.method === "GET" ? "view" : "edit";
      if (mod && !levelOk(req.perms[mod], need)) {
        const name = MODULES.find((m) => m.id === mod)?.name || mod;
        return res.status(403).json({ detail: `Your role (${store.db.roles.find((r) => r.id === user.role_id)?.name || user.role_id}) can't ${need === "view" ? "see" : "change"} ${name}. Ask an Owner or Admin.` });
      }
      if (req.method !== "GET") res.on("finish", () => {
        if (res.statusCode < 400 && !req.path.startsWith("/api/me") && !req.path.startsWith("/api/assistant")) store.logAudit({ user_id: user.id, user_name: user.name, method: req.method, path: req.path.slice(0, 200), module: mod || "", summary: (req.headers["x-mwiz-via"] === "assistant" ? "(via Ask DPA AD) " : "") + describe(req.method, req.path) });
      });
    }
    next();
  });

  mountCrm(app, { store, crm, outreach, provider, workforce, products });
  mountCreative(app, { store, provider, workforce, crm });
  mountStudio(app, { store, provider, studio });
  mountWorkforce(app, { store, workforce });
  mountPeople(app, { store });
  mountCompliance(app, { store, crm, provider, workforce, backups, status, password, env });
  mountBilling(app, { store, billing, provider, workforce, crm });
  mountCustomersLite(app, { store, billing, crm });

  // ---- Ask DPA AD: the assistant on every page
  let aiClient = assistantClient;
  const assistant = createAssistant({ store, workforce, model: baseProvider.model && baseProvider.name === "claude" ? baseProvider.model : "claude-opus-5-5",
    client: async (p) => { if (!aiClient) aiClient = await claudeAssistantClient(); return aiClient(p); } });
  const assistantReady = () => !!assistantClient || baseProvider.name === "claude";
  app.get("/api/assistant/status", (req, res) => res.json({ ready: assistantReady() }));
  app.post("/api/assistant", async (req, res) => {
    const b = req.body || {};
    if (!assistantReady()) return res.status(503).json({ detail: "Ask DPA AD needs ANTHROPIC_API_KEY on the server (hPanel → Node.js → Environment variables)." });
    if (!String(b.message || "").trim()) return res.status(422).json({ detail: "Ask something." });
    if (!store.getWorkspace(b.ws)) return res.status(404).json({ detail: "Workspace not found" });
    try { res.json(await assistant.chat(req, { thread_id: b.thread_id, message: b.message, ws: b.ws, page: String(b.page || "").slice(0, 80) })); }
    catch (e) { res.status(502).json({ detail: e?.message || "The assistant failed. Try again." }); }
  });
  app.post("/api/assistant/confirm", async (req, res) => {
    const b = req.body || {};
    try { const r = await assistant.confirm(req, { thread_id: b.thread_id, action_id: b.action_id, approve: !!b.approve }); r.error ? res.status(409).json({ detail: r.error }) : res.json(r); }
    catch (e) { res.status(502).json({ detail: e?.message || "The assistant failed. Try again." }); }
  });

  // ---- me
  app.get("/api/me", (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role_id: req.user.role_id, team_ids: req.user.team_ids || [] },
    role: store.db.roles.find((r) => r.id === req.user.role_id)?.name || req.user.role_id, perms: req.perms, modules: MODULES, shared_login: req.user.id === "owner" }));
  app.post("/api/me/password", (req, res) => {
    if (req.user.id === "owner") return res.status(422).json({ detail: "The team password is set in hPanel (DASHBOARD_PASSWORD). Create your own Owner account in Teams & roles instead." });
    const u = store.db.users.find((x) => x.id === req.user.id);
    if (!checkPassword(String(req.body?.current || ""), u)) return res.status(422).json({ detail: "Your current password is wrong." });
    const pw = String(req.body?.password || "");
    if (pw.length < 10) return res.status(422).json({ detail: "Use at least 10 characters." });
    Object.assign(u, hashPassword(pw)); store.save();
    res.json({ ok: true });
  });

  // ---- admin: people, roles, teams, activity
  const isOwner = (req) => req.user.role_id === "owner";
  const owners = () => store.db.users.filter((u) => u.active && u.role_id === "owner");
  const publicUser = ({ hash, salt, ...u }) => u;
  app.get("/api/admin", (req, res) => res.json({
    users: store.db.users.map(publicUser), roles: store.db.roles, teams: store.db.teams, modules: MODULES, levels: LEVELS,
    audit: store.db.audit.slice(-300).reverse(), me: req.user.id,
  }));
  app.post("/api/admin/users", (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 100), email = String(b.email || "").trim().toLowerCase().slice(0, 200), pw = String(b.password || "");
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ detail: "Name and a valid email are required." });
    if (store.db.users.some((u) => u.email === email)) return res.status(422).json({ detail: "Someone already uses that email." });
    if (pw.length < 10) return res.status(422).json({ detail: "Set a temporary password of at least 10 characters." });
    const role = store.db.roles.find((r) => r.id === b.role_id);
    if (!role) return res.status(422).json({ detail: "Pick a role." });
    if (role.id === "owner" && !isOwner(req)) return res.status(403).json({ detail: "Only an Owner can add another Owner." });
    const u = { id: store.newId(), name, email, role_id: role.id, team_ids: (b.team_ids || []).map(String).filter((t) => store.db.teams.some((x) => x.id === t)), active: true, created_at: store.now(), last_login_at: null, ...hashPassword(pw) };
    store.db.users.push(u); store.save();
    res.status(201).json(publicUser(u));
  });
  app.put("/api/admin/users/:id", (req, res) => {
    const u = store.db.users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ detail: "Person not found" });
    const b = req.body || {};
    const touchesOwner = u.role_id === "owner" || b.role_id === "owner";
    if (touchesOwner && !isOwner(req)) return res.status(403).json({ detail: "Only an Owner can change an Owner." });
    const losingOwner = u.role_id === "owner" && u.active && ((b.role_id && b.role_id !== "owner") || b.active === false);
    if (losingOwner && owners().length <= 1) return res.status(422).json({ detail: "Keep at least one active Owner account." });
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 100); if (!n) return res.status(422).json({ detail: "Name can't be empty." }); u.name = n; }
    if (b.role_id !== undefined) { if (!store.db.roles.some((r) => r.id === b.role_id)) return res.status(422).json({ detail: "Unknown role" }); u.role_id = b.role_id; }
    if (b.team_ids !== undefined) u.team_ids = (b.team_ids || []).map(String).filter((t) => store.db.teams.some((x) => x.id === t));
    if (b.active !== undefined) u.active = !!b.active;
    if (b.password) { if (String(b.password).length < 10) return res.status(422).json({ detail: "Use at least 10 characters." }); Object.assign(u, hashPassword(b.password)); }
    store.save();
    res.json(publicUser(u));
  });
  const cleanPerms = (p) => Object.fromEntries(MODULE_IDS.map((m) => [m, LEVELS.includes(p?.[m]) ? p[m] : "none"]));
  app.post("/api/admin/roles", (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 60);
    if (!name) return res.status(422).json({ detail: "Name the role." });
    const r = { id: "r" + store.newId(), name, description: String(req.body?.description || "").slice(0, 200), perms: cleanPerms(req.body?.perms), builtin: false };
    store.db.roles.push(r); store.save();
    res.status(201).json(r);
  });
  app.put("/api/admin/roles/:id", (req, res) => {
    const r = store.db.roles.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ detail: "Role not found" });
    if (r.locked) return res.status(422).json({ detail: "The Owner role always has full access." });
    if (req.body?.name !== undefined) { const n = String(req.body.name).trim().slice(0, 60); if (n) r.name = n; }
    if (req.body?.description !== undefined) r.description = String(req.body.description).slice(0, 200);
    if (req.body?.perms) r.perms = cleanPerms({ ...r.perms, ...req.body.perms });
    store.save();
    res.json(r);
  });
  app.delete("/api/admin/roles/:id", (req, res) => {
    const r = store.db.roles.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ detail: "Role not found" });
    if (r.builtin) return res.status(422).json({ detail: "Built-in roles can't be deleted; change their access instead." });
    if (store.db.users.some((u) => u.role_id === r.id)) return res.status(422).json({ detail: "Move the people in this role to another role first." });
    store.db.roles = store.db.roles.filter((x) => x.id !== r.id); store.save();
    res.status(204).end();
  });
  const cleanTeam = (b, cur = {}) => ({
    name: String(b.name ?? cur.name ?? "").trim().slice(0, 80), description: String(b.description ?? cur.description ?? "").slice(0, 300),
    lead_id: b.lead_id !== undefined ? (store.db.users.some((u) => u.id === String(b.lead_id)) ? String(b.lead_id) : null) : (cur.lead_id ?? null),
    modules: b.modules !== undefined ? (b.modules || []).filter((m) => MODULE_IDS.includes(m)) : (cur.modules || []),
  });
  app.post("/api/admin/teams", (req, res) => {
    const t = { id: "t" + store.newId(), ...cleanTeam(req.body || {}), created_at: store.now() };
    if (!t.name) return res.status(422).json({ detail: "Name the team." });
    store.db.teams.push(t); store.save();
    res.status(201).json(t);
  });
  app.post("/api/admin/teams/starter", (req, res) => {
    const have = new Set(store.db.teams.map((t) => t.name.toLowerCase()));
    const add = STARTER_TEAMS.filter((t) => !have.has(t.name.toLowerCase()));
    add.forEach((t) => store.db.teams.push({ id: "t" + store.newId(), ...t, lead_id: null, created_at: store.now() }));
    store.save();
    res.status(201).json({ added: add.length });
  });
  app.put("/api/admin/teams/:id", (req, res) => {
    const t = store.db.teams.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ detail: "Team not found" });
    const c = cleanTeam(req.body || {}, t);
    if (!c.name) return res.status(422).json({ detail: "Name the team." });
    Object.assign(t, c);
    // Members: set the list of people in this team.
    if (Array.isArray(req.body?.member_ids)) for (const u of store.db.users) {
      const want = req.body.member_ids.map(String).includes(u.id), has = (u.team_ids || []).includes(t.id);
      if (want && !has) u.team_ids = [...(u.team_ids || []), t.id];
      if (!want && has) u.team_ids = u.team_ids.filter((x) => x !== t.id);
    }
    store.save();
    res.json(t);
  });
  app.delete("/api/admin/teams/:id", (req, res) => {
    if (!store.db.teams.some((x) => x.id === req.params.id)) return res.status(404).json({ detail: "Team not found" });
    store.db.teams = store.db.teams.filter((x) => x.id !== req.params.id);
    for (const u of store.db.users) u.team_ids = (u.team_ids || []).filter((x) => x !== req.params.id);
    store.save();
    res.status(204).end();
  });

  // marked does not export its browser build path, so resolve it from the package root.
  const markedUmd = path.join(path.dirname(require.resolve("marked/package.json")), "lib", "marked.umd.js");
  app.get("/vendor/marked.js", (req, res) => res.sendFile(markedUmd));

  // ---- helpers
  const ws = (req, res) => {
    const w = store.getWorkspace(req.params.ws);
    if (!w) res.status(404).json({ detail: "Workspace not found" });
    return w;
  };

  app.get("/api/health", (req, res) => res.json({ ok: true, provider: provider.name, model: provider.model }));
  app.get("/api/playbooks", (req, res) => res.json({ playbooks: PLAYBOOKS.map(({ task, ...p }) => p), launch_kit: LAUNCH_KIT }));
  app.get("/api/note-categories", (req, res) => res.json(NOTE_CATEGORIES));

  // ---- workspaces
  app.get("/api/workspaces", (req, res) => res.json(store.listWorkspaces()));
  app.post("/api/workspaces", (req, res) => {
    if (!String(req.body?.company_name || "").trim()) return res.status(422).json({ detail: "company_name is required" });
    res.status(201).json(store.createWorkspace(req.body));
  });
  app.get("/api/workspaces/:ws", (req, res) => { const w = ws(req, res); if (w) res.json(w); });
  app.put("/api/workspaces/:ws", (req, res) => {
    if (!ws(req, res)) return;
    if (!String(req.body?.company_name || "").trim()) return res.status(422).json({ detail: "company_name is required" });
    res.json(store.updateWorkspace(req.params.ws, req.body));
  });
  app.delete("/api/workspaces/:ws", (req, res) => {
    if (store.getWorkspace(req.params.ws)) crm.removeWorkspace(req.params.ws);
    store.deleteWorkspace(req.params.ws) ? res.status(204).end() : res.status(404).json({ detail: "Workspace not found" });
  });

  // ---- sales
  const cleanDeal = (b, partial = false) => {
    const out = {}, err = [];
    const str = (k, max = 200) => { if (b[k] !== undefined) out[k] = String(b[k] ?? "").trim().slice(0, max); };
    ["name", "category", "contact_name", "contact_phone", "contact_email"].forEach((k) => str(k));
    str("notes", 4000); str("lost_reason", 500);
    if (b.city !== undefined) out.city = Object.hasOwn(CITIES, b.city) ? b.city : "Other";
    if (b.platform !== undefined) out.platform = PLATFORMS.includes(b.platform) ? b.platform : "Other";
    if (b.skus !== undefined) { const n = Math.round(Number(b.skus)); if (!(n >= 0 && n <= 10_000_000)) err.push("skus must be a number"); else out.skus = n; }
    if (b.stage !== undefined) { if (!STAGE_IDS.includes(b.stage)) err.push("unknown stage"); else out.stage = b.stage; }
    if (!partial && !out.name) err.push("name is required");
    if (partial && b.name !== undefined && !out.name) err.push("name cannot be empty");
    return { out, err };
  };
  app.get("/api/sales/meta", (req, res) => res.json({ stages: STAGES, plans: PLANS.map((p) => ({ ...p, max: Number.isFinite(p.max) ? p.max : null })), cities: CITIES, platforms: PLATFORMS, tasks: Object.fromEntries(Object.entries(AI_TASKS).map(([k, t]) => [k, { title: t.title, agent: t.agent }])) }));
  app.get("/api/workspaces/:ws/deals", (req, res) => {
    if (!ws(req, res)) return;
    const deals = store.listDeals(req.params.ws);
    res.json({ deals: deals.map((d) => enrich(d)), summary: summary(deals, store.listWorkspaceActivities(req.params.ws), Date.now(), outreach.settings(req.params.ws).targets.close_pct / 100) });
  });
  app.post("/api/workspaces/:ws/deals", (req, res) => {
    if (!ws(req, res)) return;
    const { out, err } = cleanDeal({ city: "Riyadh", platform: "Salla", skus: 0, ...req.body });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.status(201).json(enrich(store.addDeal(req.params.ws, out)));
  });
  app.get("/api/workspaces/:ws/deals/:id", (req, res) => {
    if (!ws(req, res)) return;
    const d = store.getDeal(req.params.ws, req.params.id);
    if (!d) return res.status(404).json({ detail: "Deal not found" });
    res.json({ deal: enrich(d), activities: store.listDealActivities(d.id) });
  });
  app.put("/api/workspaces/:ws/deals/:id", (req, res) => {
    if (!ws(req, res)) return;
    const { out, err } = cleanDeal(req.body || {}, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const d = store.updateDeal(req.params.ws, req.params.id, out);
    d ? res.json(enrich(d)) : res.status(404).json({ detail: "Deal not found" });
  });
  app.delete("/api/workspaces/:ws/deals/:id", (req, res) => {
    if (!ws(req, res)) return;
    store.deleteDeal(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Deal not found" });
  });
  app.post("/api/workspaces/:ws/deals/:id/activities", (req, res) => {
    if (!ws(req, res)) return;
    const d = store.getDeal(req.params.ws, req.params.id);
    if (!d) return res.status(404).json({ detail: "Deal not found" });
    const type = ["note", "sent", "call"].includes(req.body?.type) ? req.body.type : null;
    if (!type) return res.status(422).json({ detail: "type must be note, sent or call" });
    const task = Object.hasOwn(AI_TASKS, req.body?.task) ? req.body.task : null;
    res.status(201).json(store.addDealActivity(d.id, { type, by: "you", task, text: String(req.body?.text || "").slice(0, 8000) }));
  });
  // AI drafts stream like playbooks; the draft is logged, and a person marks it sent.
  app.post("/api/workspaces/:ws/deals/:id/ai/:task", async (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const d = store.getDeal(w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Deal not found" });
    if (!Object.hasOwn(AI_TASKS, req.params.task)) return res.status(404).json({ detail: "Unknown AI task" });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const text = await provider.generate({
        system: SYSTEM, prompt: salesPrompt(store, w, enrich(d), req.params.task), signal: ac.signal,
        onText: (delta) => res.write(delta),
      });
      const a = store.addDealActivity(d.id, { type: "ai_draft", by: "ai", task: req.params.task, text });
      res.end("\n\n[[MWIZ_SAVED]]" + a.id);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (!(e instanceof LLMError)) console.error("sales draft failed:", e?.status, e?.message);
      res.end("\n\n[[MWIZ_ERROR]]" + (e instanceof LLMError ? e.message : "Something went wrong. Try again in a moment."));
    }
  });

  // ---- HR
  const streamDraft = async (req, res, { prompt, onDone }) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const text = await provider.generate({ system: SYSTEM, prompt, signal: ac.signal, onText: (d) => res.write(d) });
      const id = onDone(text);
      res.end("\n\n[[MWIZ_SAVED]]" + id);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (!(e instanceof LLMError)) console.error("hr draft failed:", e?.status, e?.message);
      res.end("\n\n[[MWIZ_ERROR]]" + (e instanceof LLMError ? e.message : "Something went wrong. Try again in a moment."));
    }
  };
  const cleanRole = (b, partial = false) => {
    const out = {}, err = [];
    const str = (k, max = 200) => { if (b[k] !== undefined) out[k] = String(b[k] ?? "").trim().slice(0, max); };
    ["title", "holder", "location"].forEach((k) => str(k));
    ["must_be_human", "duties", "notes"].forEach((k) => str(k, 2000));
    if (b.department !== undefined) out.department = DEPARTMENTS.includes(b.department) ? b.department : "Operations";
    if (b.kind !== undefined) { if (!["ai", "human"].includes(b.kind)) err.push("kind must be ai or human"); else out.kind = b.kind; }
    if (b.status !== undefined) { if (!ROLE_STATUS.includes(b.status)) err.push("unknown status"); else out.status = b.status; }
    if (b.employment !== undefined) out.employment = EMPLOYMENT.includes(b.employment) ? b.employment : "Full-time";
    for (const k of ["salary_min", "salary_max"]) if (b[k] !== undefined) { const n = b[k] === "" || b[k] === null ? null : Math.round(Number(b[k])); if (n !== null && !(n >= 0)) err.push(`${k} must be a number`); else out[k] = n; }
    if (b.reports_to !== undefined) out.reports_to = b.reports_to ? String(b.reports_to) : null;
    if (!partial && !out.title) err.push("title is required");
    if (partial && b.title !== undefined && !out.title) err.push("title cannot be empty");
    return { out, err };
  };
  app.get("/api/hr/meta", (req, res) => res.json({ departments: DEPARTMENTS, statuses: ROLE_STATUS, employment: EMPLOYMENT, stages: CAND_STAGES,
    role_tasks: Object.fromEntries(Object.entries(ROLE_TASKS).map(([k, t]) => [k, t.title])), candidate_tasks: Object.fromEntries(Object.entries(CANDIDATE_TASKS).map(([k, t]) => [k, t.title])) }));
  app.get("/api/workspaces/:ws/hr", (req, res) => {
    if (!ws(req, res)) return;
    const roles = store.listHrRoles(req.params.ws), cands = store.listHrCandidates(req.params.ws);
    res.json({ roles, candidates: cands.map((c) => enrichCandidate(c, roles)), summary: hrSummary(roles, cands, store.listWorkspaceHrActivities(req.params.ws)) });
  });
  app.post("/api/workspaces/:ws/hr/suggested-org", (req, res) => {
    if (!ws(req, res)) return;
    res.status(201).json({ added: addSuggestedOrg(req.params.ws) });
  });
  const addSuggestedOrg = (wsId) => {
    const existing = new Set(store.listHrRoles(wsId).map((r) => r.title.toLowerCase()));
    const added = SUGGESTED_ORG.filter((r) => !existing.has(r.title.toLowerCase())).map((r) => store.addHrRole(wsId, { location: "", duties: "", must_be_human: "", notes: "", reports_to: null, ...r }, false));
    const ceo = store.listHrRoles(wsId).find((r) => r.department === "Leadership");
    if (ceo) for (const r of added) if (r.id !== ceo.id && !r.reports_to) r.reports_to = ceo.id;
    store.save();
    return added.length;
  };
  app.post("/api/workspaces/:ws/hr/sample-team", (req, res) => {
    if (!ws(req, res)) return;
    const wsId = req.params.ws;
    const roles = addSuggestedOrg(wsId);
    const byTitle = Object.fromEntries(store.listHrRoles(wsId).map((r) => [r.title, r]));
    for (const [title, name] of Object.entries(SAMPLE_TEAM.holders)) {
      const r = byTitle[title];
      if (r && !r.holder) store.updateHrRole(wsId, r.id, { holder: name, sample_holder: true, prev_status: r.status, status: "active" });
    }
    const have = new Set(store.listHrCandidates(wsId).map((c) => c.name));
    let people = 0;
    for (const c of SAMPLE_TEAM.candidates) {
      if (have.has(c.name)) continue;
      const role = byTitle[c.role];
      const cand = store.addHrCandidate(wsId, { name: c.name, role_id: role?.id || null, source: c.source, cv_text: c.cv_text, email: "", phone: "", notes: "", sample: true });
      store.updateHrCandidate(wsId, cand.id, { stage: c.stage, score: c.score, by: "sample" });
      if (c.screen) store.addHrActivity(wsId, "candidate", cand.id, { type: "ai_draft", by: "sample", task: "screen", text: c.screen });
      people++;
    }
    res.status(201).json({ roles, people: people + Object.keys(SAMPLE_TEAM.holders).length });
  });
  app.delete("/api/workspaces/:ws/hr/sample-team", (req, res) => {
    if (!ws(req, res)) return;
    const wsId = req.params.ws;
    for (const c of store.listHrCandidates(wsId).filter((c) => c.sample)) store.deleteHrCandidate(wsId, c.id);
    for (const r of store.listHrRoles(wsId).filter((r) => r.sample_holder)) store.updateHrRole(wsId, r.id, { holder: "", sample_holder: false, status: r.prev_status || "planned" });
    res.status(204).end();
  });
  app.post("/api/workspaces/:ws/hr/roles", (req, res) => {
    if (!ws(req, res)) return;
    const { out, err } = cleanRole({ department: "Operations", kind: "human", status: "planned", employment: "Full-time", ...req.body });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.status(201).json(store.addHrRole(req.params.ws, out));
  });
  app.get("/api/workspaces/:ws/hr/roles/:id", (req, res) => {
    if (!ws(req, res)) return;
    const r = store.getHrRole(req.params.ws, req.params.id);
    if (!r) return res.status(404).json({ detail: "Role not found" });
    const cands = store.listHrCandidates(req.params.ws).filter((c) => c.role_id === r.id).map((c) => enrichCandidate(c, [r]));
    res.json({ role: r, candidates: cands, activities: store.listHrActivities("role", r.id) });
  });
  app.put("/api/workspaces/:ws/hr/roles/:id", (req, res) => {
    if (!ws(req, res)) return;
    const { out, err } = cleanRole(req.body || {}, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.reports_to === req.params.id) return res.status(422).json({ detail: "A role cannot report to itself" });
    const cur = store.getHrRole(req.params.ws, req.params.id);
    if (cur?.sample_holder && out.holder !== undefined && out.holder !== cur.holder) out.sample_holder = false; // a real name replaced the sample
    const r = store.updateHrRole(req.params.ws, req.params.id, out);
    r ? res.json(r) : res.status(404).json({ detail: "Role not found" });
  });
  app.delete("/api/workspaces/:ws/hr/roles/:id", (req, res) => {
    if (!ws(req, res)) return;
    store.deleteHrRole(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Role not found" });
  });
  app.post("/api/workspaces/:ws/hr/roles/:id/ai/:task", async (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const r = store.getHrRole(w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Role not found" });
    if (!Object.hasOwn(ROLE_TASKS, req.params.task)) return res.status(404).json({ detail: "Unknown AI task" });
    await streamDraft(req, res, { prompt: rolePrompt(store, w, r, req.params.task),
      onDone: (text) => store.addHrActivity(w.id, "role", r.id, { type: "ai_draft", by: "ai", task: req.params.task, text }).id });
  });
  app.post("/api/workspaces/:ws/hr/candidates", (req, res) => {
    if (!ws(req, res)) return;
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 200);
    if (!name) return res.status(422).json({ detail: "name is required" });
    const role = b.role_id ? store.getHrRole(req.params.ws, b.role_id) : null;
    if (b.role_id && !role) return res.status(422).json({ detail: "Unknown role" });
    const c = store.addHrCandidate(req.params.ws, { name, role_id: role?.id || null, email: String(b.email || "").slice(0, 200), phone: String(b.phone || "").slice(0, 60), source: String(b.source || "").slice(0, 200), cv_text: String(b.cv_text || "").slice(0, 30000), notes: "" });
    res.status(201).json(enrichCandidate(c, store.listHrRoles(req.params.ws)));
  });
  app.get("/api/workspaces/:ws/hr/candidates/:id", (req, res) => {
    if (!ws(req, res)) return;
    const c = store.getHrCandidate(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Candidate not found" });
    res.json({ candidate: enrichCandidate(c, store.listHrRoles(req.params.ws)), activities: store.listHrActivities("candidate", c.id) });
  });
  app.put("/api/workspaces/:ws/hr/candidates/:id", (req, res) => {
    if (!ws(req, res)) return;
    const b = req.body || {}, out = {};
    for (const [k, max] of [["name", 200], ["email", 200], ["phone", 60], ["source", 200], ["notes", 4000], ["cv_text", 30000]]) if (b[k] !== undefined) out[k] = String(b[k] ?? "").trim().slice(0, max);
    if (out.name === "") return res.status(422).json({ detail: "name cannot be empty" });
    if (b.stage !== undefined) { if (!CAND_STAGE_IDS.includes(b.stage)) return res.status(422).json({ detail: "unknown stage" }); out.stage = b.stage; }
    if (b.role_id !== undefined) { if (b.role_id && !store.getHrRole(req.params.ws, b.role_id)) return res.status(422).json({ detail: "Unknown role" }); out.role_id = b.role_id || null; }
    const c = store.updateHrCandidate(req.params.ws, req.params.id, out);
    c ? res.json(enrichCandidate(c, store.listHrRoles(req.params.ws))) : res.status(404).json({ detail: "Candidate not found" });
  });
  app.delete("/api/workspaces/:ws/hr/candidates/:id", (req, res) => {
    if (!ws(req, res)) return;
    store.deleteHrCandidate(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Candidate not found" });
  });
  app.post("/api/workspaces/:ws/hr/candidates/:id/notes", (req, res) => {
    if (!ws(req, res)) return;
    const c = store.getHrCandidate(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Candidate not found" });
    const type = ["note", "sent", "interview"].includes(req.body?.type) ? req.body.type : "note";
    res.status(201).json(store.addHrActivity(req.params.ws, "candidate", c.id, { type, by: "you", task: Object.hasOwn(CANDIDATE_TASKS, req.body?.task) ? req.body.task : null, text: String(req.body?.text || "").slice(0, 8000) }));
  });
  app.post("/api/workspaces/:ws/hr/candidates/:id/ai/:task", async (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const c = store.getHrCandidate(w.id, req.params.id);
    if (!c) return res.status(404).json({ detail: "Candidate not found" });
    if (!Object.hasOwn(CANDIDATE_TASKS, req.params.task)) return res.status(404).json({ detail: "Unknown AI task" });
    if (req.params.task === "screen" && !c.cv_text) return res.status(422).json({ detail: "Add the CV text first" });
    const role = c.role_id ? store.getHrRole(w.id, c.role_id) : null;
    await streamDraft(req, res, { prompt: candidatePrompt(store, w, c, role, req.params.task),
      onDone: (text) => {
        if (req.params.task === "screen") {
          const fields = { score: parseScore(text), by: "ai" };
          if (c.stage === "applied") fields.stage = "screened";
          store.updateHrCandidate(w.id, c.id, fields);
        }
        return store.addHrActivity(w.id, "candidate", c.id, { type: "ai_draft", by: "ai", task: req.params.task, text }).id;
      } });
  });

  // ---- finance
  const listIncome = (wsId) => store.listOps("finance_income", wsId).sort((a, b) => b.date.localeCompare(a.date));
  const finSnap = (w) => financeSnapshot({ expenses: store.listExpenses(w.id), income: listIncome(w.id), cash: store.listCash(w.id), deals: store.listDeals(w.id), roles: store.listHrRoles(w.id), settings: w.finance, billing: billingForFinance(store, w.id) });
  const cleanExpense = (b, partial = false) => {
    const out = {}, err = [];
    if (b.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) err.push("date must be YYYY-MM-DD"); else out.date = String(b.date); }
    if (b.vendor !== undefined) out.vendor = String(b.vendor || "").trim().slice(0, 120);
    for (const k of ["amount_sar", "vat_sar"]) if (b[k] !== undefined) { const n = Math.round(Number(b[k]) * 100) / 100; if (!(n >= 0)) err.push(`${k} must be a positive number`); else out[k] = n; }
    if (b.category !== undefined) out.category = CAT_IDS.includes(b.category) ? b.category : "other";
    if (b.recurring !== undefined) out.recurring = ["monthly", "yearly", "one-off"].includes(b.recurring) ? b.recurring : "one-off";
    if (b.note !== undefined) out.note = String(b.note || "").slice(0, 300);
    if (!partial) { if (!out.vendor) err.push("vendor is required"); if (!out.amount_sar) err.push("amount_sar is required"); }
    return { out, err };
  };
  app.get("/api/finance/meta", (req, res) => res.json({ income_types: INCOME_TYPES, categories: FIN_CATEGORIES, tasks: Object.fromEntries(Object.entries(FIN_TASKS).map(([k, t]) => [k, t.title])) }));
  app.get("/api/workspaces/:ws/finance", (req, res) => {
    const w = ws(req, res); if (!w) return;
    res.json({ paying_stores: store.listDeals(w.id).filter((d) => d.stage === "paying").map((d) => d.name), snapshot: finSnap(w), expenses: store.listExpenses(w.id), income: listIncome(w.id), cash: store.listCash(w.id), reports: store.listFinanceReports(w.id).map(({ text, ...r }) => r) });
  });
  // income: money received. Subscriptions set billed MRR; investment, grants and loans are not revenue.
  const cleanIncome = (b, partial = false) => {
    const o = {}, err = [];
    if (b.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) err.push("date must be YYYY-MM-DD"); else o.date = String(b.date); }
    if (b.source !== undefined) o.source = String(b.source || "").trim().slice(0, 120);
    for (const k of ["amount_sar", "vat_sar"]) if (b[k] !== undefined) { const n = Math.round(Number(b[k]) * 100) / 100; if (!(n >= 0)) err.push(`${k} must be a positive number`); else o[k] = n; }
    if (b.type !== undefined) o.type = INCOME_IDS.includes(b.type) ? b.type : "other_revenue";
    if (b.recurring !== undefined) o.recurring = ["monthly", "yearly", "one-off"].includes(b.recurring) ? b.recurring : "one-off";
    if (b.note !== undefined) o.note = String(b.note || "").slice(0, 300);
    if (b.deal_id !== undefined) o.deal_id = b.deal_id ? String(b.deal_id) : null;
    if (b.ended !== undefined) o.ended_at = b.ended ? new Date().toISOString() : null;
    if (!partial) { if (!o.source) err.push("who paid is required"); if (!o.amount_sar) err.push("amount_sar is required"); }
    return { o, err };
  };
  app.post("/api/workspaces/:ws/finance/income", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { o, err } = cleanIncome({ date: new Date().toISOString().slice(0, 10), type: "subscription", recurring: "one-off", vat_sar: 0, note: "", deal_id: null, ...req.body });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.status(201).json(store.addOps("finance_income", w.id, { ...o, ended_at: null, entry: "manual" }));
  });
  app.put("/api/workspaces/:ws/finance/income/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { o, err } = cleanIncome(req.body || {}, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const i = store.updateOps("finance_income", w.id, req.params.id, o);
    i ? res.json(i) : res.status(404).json({ detail: "Income not found" });
  });
  app.delete("/api/workspaces/:ws/finance/income/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("finance_income", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Income not found" }); });
  // ---- pricing calculator: cost per store per plan, margin, lowest price for the target margin
  const pricingOf = (w) => cleanPricing(w.finance?.pricing || {}, DEFAULT_PRICING);
  const pricingOut = (w) => { const p = pricingOf(w); return { inputs: p, model: pricingModel(p, w.finance?.churn_pct ?? 3), cost_fields: COST_FIELDS, plan_fields: PLAN_FIELDS }; };
  app.get("/api/workspaces/:ws/finance/pricing", (req, res) => { const w = ws(req, res); if (w) res.json(pricingOut(w)); });
  app.put("/api/workspaces/:ws/finance/pricing", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const next = req.body?.reset ? cleanPricing({}, DEFAULT_PRICING) : cleanPricing({ ...req.body, example: false }, pricingOf(w));
    store.setFinanceSettings(w.id, { pricing: next });
    res.json(pricingOut(store.getWorkspace(w.id)));
  });
  app.put("/api/workspaces/:ws/finance/settings", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const b = req.body || {}, f = {};
    if (b.vat_registered !== undefined) f.vat_registered = !!b.vat_registered;
    if (b.include_hires !== undefined) f.include_hires = !!b.include_hires;
    if (b.mrr_growth_pct !== undefined) { const n = Number(b.mrr_growth_pct); if (!(n >= -50 && n <= 200)) return res.status(422).json({ detail: "growth must be between -50 and 200" }); f.mrr_growth_pct = n; }
    if (b.churn_pct !== undefined) { const n = Number(b.churn_pct); if (!(n >= 0.5 && n <= 50)) return res.status(422).json({ detail: "churn must be between 0.5 and 50% a month" }); f.churn_pct = n; }
    if (b.budgets && typeof b.budgets === "object") f.budgets = Object.fromEntries(Object.entries(b.budgets).filter(([k]) => CAT_IDS.includes(k)).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
    res.json(store.setFinanceSettings(w.id, f));
  });
  app.post("/api/workspaces/:ws/finance/cash", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const date = String(req.body?.date || ""), bal = Number(req.body?.balance_sar);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(bal)) return res.status(422).json({ detail: "date (YYYY-MM-DD) and balance_sar are required" });
    res.status(201).json(store.addCash(w.id, { date, balance_sar: Math.round(bal * 100) / 100, note: String(req.body?.note || "").slice(0, 200) }));
  });
  app.delete("/api/workspaces/:ws/finance/cash/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteCash(w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Not found" }); });
  app.post("/api/workspaces/:ws/finance/expenses", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { out, err } = cleanExpense({ date: new Date().toISOString().slice(0, 10), category: "other", recurring: "one-off", vat_sar: 0, note: "", ...req.body });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.status(201).json(store.addExpense(w.id, { ...out, source: "manual" }));
  });
  app.post("/api/workspaces/:ws/finance/expenses/bulk", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    const saved = [];
    let incomeSaved = 0;
    for (const it of items) {
      if (it.direction === "in") {
        const { o, err } = cleanIncome({ source: it.vendor, type: it.category, recurring: "one-off", vat_sar: 0, note: "", deal_id: null, ...it });
        if (!err.length && o.date) { store.addOps("finance_income", w.id, { ...o, ended_at: null, entry: "ai_import" }, false); incomeSaved++; }
        continue;
      }
      const { out, err } = cleanExpense({ category: "other", recurring: "one-off", vat_sar: 0, note: "", ...it });
      if (!err.length && out.date) saved.push(store.addExpense(w.id, { ...out, source: "ai_import", reviewed: true }, false));
    }
    store.save();
    res.status(201).json({ saved: saved.length + incomeSaved, expenses: saved.length, income: incomeSaved });
  });
  app.put("/api/workspaces/:ws/finance/expenses/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { out, err } = cleanExpense(req.body || {}, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const e = store.updateExpense(w.id, req.params.id, out);
    e ? res.json(e) : res.status(404).json({ detail: "Expense not found" });
  });
  app.delete("/api/workspaces/:ws/finance/expenses/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteExpense(w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Expense not found" }); });
  // AI reads pasted bank lines and proposes expenses; nothing is saved until a person confirms.
  app.post("/api/workspaces/:ws/finance/expenses/ai-import", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(422).json({ detail: "Paste some statement lines first" });
    try {
      const raw = await provider.generate({ system: "You extract accounting data precisely and return only JSON.", prompt: importPrompt(text), onText: () => {} });
      const items = parseImport(raw);
      if (!items) return res.status(422).json({ detail: "AI couldn't read those lines. Paste plain statement rows (date, description, amount) and try again." });
      res.json({ items });
    } catch (e) {
      res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." });
    }
  });
  app.get("/api/workspaces/:ws/finance/reports/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const r = store.listFinanceReports(w.id).find((x) => x.id === req.params.id);
    r ? res.json(r) : res.status(404).json({ detail: "Report not found" });
  });
  app.post("/api/workspaces/:ws/finance/ai/:task", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    if (!Object.hasOwn(FIN_TASKS, req.params.task)) return res.status(404).json({ detail: "Unknown AI task" });
    await streamDraft(req, res, { prompt: financePrompt(w, finSnap(w), store.listExpenses(w.id), req.params.task),
      onDone: (text) => store.addFinanceReport(w.id, { task: req.params.task, title: FIN_TASKS[req.params.task].title, text }).id });
  });

  // ---- operations
  const opsData = (wsId) => ({ tasks: store.listOps("ops_tasks", wsId), deadlines: store.listOps("ops_deadlines", wsId), vendors: store.listOps("ops_vendors", wsId), incidents: store.listOps("ops_incidents", wsId) });
  const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
  const cleanTask = (b, partial) => {
    const o = {};
    if (b.title !== undefined) o.title = str(b.title);
    if (b.owner_kind !== undefined) o.owner_kind = b.owner_kind === "human" ? "human" : "ai";
    if (b.owner !== undefined) o.owner = str(b.owner, 120);
    if (b.area !== undefined) o.area = AREAS.includes(b.area) ? b.area : "Operations";
    if (b.priority !== undefined) o.priority = [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 2;
    if (b.due !== undefined) o.due = isoDate(b.due) ? b.due : null;
    if (b.notes !== undefined) o.notes = str(b.notes, 2000);
    if (b.status !== undefined) { if (!TASK_STATUS_IDS.includes(b.status)) return { err: "unknown status" }; o.status = b.status; o.done_at = b.status === "done" ? new Date().toISOString() : null; }
    if (!partial && !o.title) return { err: "title is required" };
    if (partial && b.title !== undefined && !o.title) return { err: "title cannot be empty" };
    return { o };
  };
  app.get("/api/ops/meta", (req, res) => res.json({ areas: AREAS, statuses: TASK_STATUS, repeats: REPEATS, severity: SEVERITY, incident_status: INCIDENT_STATUS, reports: Object.fromEntries(Object.entries(OPS_TASKS).map(([k, t]) => [k, t.title])) }));
  app.get("/api/workspaces/:ws/ops", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = opsData(w.id);
    res.json({ ...d, snapshot: opsSnapshot(d), reports: store.listOps("ops_reports", w.id).map(({ text, ...r }) => r).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      people: store.listHrRoles(w.id).map((r) => ({ kind: r.kind, name: r.kind === "ai" ? r.title : (r.holder ? `${r.title} – ${r.holder}` : r.title) })) });
  });
  // tasks
  app.post("/api/workspaces/:ws/ops/tasks", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { o, err } = cleanTask({ owner_kind: "ai", area: "Operations", priority: 2, status: "todo", owner: "", notes: "", due: null, ...req.body }, false);
    if (err) return res.status(422).json({ detail: err });
    res.status(201).json(store.addOps("ops_tasks", w.id, { ...o, source: "manual" }));
  });
  app.post("/api/workspaces/:ws/ops/tasks/bulk", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
    let n = 0;
    for (const it of items) {
      const due = it.due_in_days != null ? new Date(Date.now() + Number(it.due_in_days) * 864e5).toISOString().slice(0, 10) : it.due;
      const { o, err } = cleanTask({ status: "todo", notes: it.why || "", ...it, due }, false);
      if (!err) { store.addOps("ops_tasks", w.id, { ...o, goal: str(req.body?.goal, 300), source: "ai_plan" }, false); n++; }
    }
    store.save();
    res.status(201).json({ saved: n });
  });
  app.put("/api/workspaces/:ws/ops/tasks/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const { o, err } = cleanTask(req.body || {}, true);
    if (err) return res.status(422).json({ detail: err });
    const t = store.updateOps("ops_tasks", w.id, req.params.id, o);
    t ? res.json(t) : res.status(404).json({ detail: "Task not found" });
  });
  app.delete("/api/workspaces/:ws/ops/tasks/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("ops_tasks", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Task not found" }); });
  app.post("/api/workspaces/:ws/ops/plan", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const goal = str(req.body?.goal, 500);
    if (!goal) return res.status(422).json({ detail: "Write the goal first" });
    try {
      const raw = await provider.generate({ system: "You plan work for an AI-first company and return only JSON.", prompt: planPrompt(w, goal, store.listHrRoles(w.id)), onText: () => {} });
      const items = parsePlan(raw);
      if (!items || !items.length) return res.status(422).json({ detail: "AI couldn't turn that into tasks. Try a more specific goal." });
      res.json({ items });
    } catch (e) { res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." }); }
  });
  // deadlines
  app.post("/api/workspaces/:ws/ops/deadlines", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const b = req.body || {};
    if (!str(b.title) || !isoDate(b.due)) return res.status(422).json({ detail: "title and due (YYYY-MM-DD) are required" });
    res.status(201).json(store.addOps("ops_deadlines", w.id, { title: str(b.title), category: ["compliance", "tax", "renewal", "other"].includes(b.category) ? b.category : "other", due: b.due, repeats: REPEATS.includes(b.repeats) ? b.repeats : "none", owner: str(b.owner, 120), notes: str(b.notes, 1000), done_at: null }));
  });
  app.post("/api/workspaces/:ws/ops/deadlines/starter", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const have = new Set(store.listOps("ops_deadlines", w.id).map((d) => d.title));
    const add = saudiStarter().filter((d) => !have.has(d.title));
    add.forEach((d) => store.addOps("ops_deadlines", w.id, { ...d, done_at: null }, false));
    store.save();
    res.status(201).json({ added: add.length });
  });
  app.put("/api/workspaces/:ws/ops/deadlines/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = store.getOps("ops_deadlines", w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Deadline not found" });
    const b = req.body || {}, o = {};
    if (b.done) {
      // A repeating deadline rolls forward to its next date; a one-off is closed.
      const next = rollForward(d.due, d.repeats);
      if (next) { o.due = next; o.last_done_at = new Date().toISOString(); } else o.done_at = new Date().toISOString();
    }
    if (b.title !== undefined && str(b.title)) o.title = str(b.title);
    if (b.due !== undefined) { if (!isoDate(b.due)) return res.status(422).json({ detail: "due must be YYYY-MM-DD" }); o.due = b.due; o.starter = false; } // a person set the real date
    if (b.repeats !== undefined) o.repeats = REPEATS.includes(b.repeats) ? b.repeats : "none";
    if (b.owner !== undefined) o.owner = str(b.owner, 120);
    if (b.notes !== undefined) o.notes = str(b.notes, 1000);
    res.json(store.updateOps("ops_deadlines", w.id, d.id, o));
  });
  app.delete("/api/workspaces/:ws/ops/deadlines/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("ops_deadlines", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Deadline not found" }); });
  // vendors (tool stack)
  const cleanVendor = (b) => ({ name: str(b.name, 120), purpose: str(b.purpose), cost_sar: Math.max(0, Number(b.cost_sar) || 0), renewal_date: isoDate(b.renewal_date) ? b.renewal_date : null, owner: str(b.owner, 120), critical: !!b.critical, notes: str(b.notes, 1000) });
  app.post("/api/workspaces/:ws/ops/vendors", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const v = cleanVendor(req.body || {});
    if (!v.name) return res.status(422).json({ detail: "name is required" });
    res.status(201).json(store.addOps("ops_vendors", w.id, v));
  });
  app.post("/api/workspaces/:ws/ops/vendors/from-finance", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const have = new Set(store.listOps("ops_vendors", w.id).map((v) => v.name.toLowerCase()));
    let n = 0;
    for (const e of store.listExpenses(w.id).filter((e) => e.recurring !== "one-off" && e.category !== "payroll")) {
      if (have.has(e.vendor.toLowerCase())) continue;
      have.add(e.vendor.toLowerCase());
      store.addOps("ops_vendors", w.id, cleanVendor({ name: e.vendor, purpose: e.category, cost_sar: e.recurring === "yearly" ? Math.round(e.amount_sar / 12) : e.amount_sar }), false); n++;
    }
    store.save();
    res.status(201).json({ added: n });
  });
  app.put("/api/workspaces/:ws/ops/vendors/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const cur = store.getOps("ops_vendors", w.id, req.params.id);
    if (!cur) return res.status(404).json({ detail: "Vendor not found" });
    const v = cleanVendor({ ...cur, ...req.body });
    if (!v.name) return res.status(422).json({ detail: "name cannot be empty" });
    res.json(store.updateOps("ops_vendors", w.id, cur.id, v));
  });
  app.delete("/api/workspaces/:ws/ops/vendors/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("ops_vendors", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Vendor not found" }); });
  // incidents
  app.post("/api/workspaces/:ws/ops/incidents", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const b = req.body || {};
    if (!str(b.title)) return res.status(422).json({ detail: "title is required" });
    res.status(201).json(store.addOps("ops_incidents", w.id, { title: str(b.title), severity: SEVERITY.includes(b.severity) ? b.severity : "SEV2", status: "open", started_at: new Date().toISOString(), resolved_at: null, impact: str(b.impact, 1000), notes: "", updates: [] }));
  });
  app.put("/api/workspaces/:ws/ops/incidents/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const inc = store.getOps("ops_incidents", w.id, req.params.id);
    if (!inc) return res.status(404).json({ detail: "Incident not found" });
    const b = req.body || {}, o = {};
    if (b.status !== undefined) { if (!INCIDENT_STATUS.includes(b.status)) return res.status(422).json({ detail: "unknown status" }); o.status = b.status; o.resolved_at = b.status === "resolved" ? new Date().toISOString() : null; }
    if (b.severity !== undefined && SEVERITY.includes(b.severity)) o.severity = b.severity;
    if (b.impact !== undefined) o.impact = str(b.impact, 1000);
    if (b.update) o.updates = [...(inc.updates || []), { at: new Date().toISOString(), text: str(b.update, 1000) }];
    res.json(store.updateOps("ops_incidents", w.id, inc.id, o));
  });
  app.delete("/api/workspaces/:ws/ops/incidents/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("ops_incidents", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Incident not found" }); });
  // AI reports
  app.get("/api/workspaces/:ws/ops/reports/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const r = store.getOps("ops_reports", w.id, req.params.id);
    r ? res.json(r) : res.status(404).json({ detail: "Report not found" });
  });
  app.post("/api/workspaces/:ws/ops/ai/:task", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = opsData(w.id);
    if (req.params.task === "incident") {
      const inc = d.incidents.find((i) => i.id === String(req.body?.incident_id || req.query.incident_id));
      if (!inc) return res.status(404).json({ detail: "Incident not found" });
      return streamDraft(req, res, { prompt: incidentPrompt(w, inc), onDone: (text) => store.addOps("ops_reports", w.id, { task: "incident", title: `Incident: ${inc.title}`, incident_id: inc.id, text }).id });
    }
    if (!Object.hasOwn(OPS_TASKS, req.params.task)) return res.status(404).json({ detail: "Unknown AI task" });
    const snap = opsSnapshot(d);
    const ctx = [`Open tasks:\n${d.tasks.filter((t) => t.status !== "done").map((t) => `- [${t.owner_kind === "ai" ? "AI" : "person"}: ${t.owner || "?"}] ${t.title} (${t.area}, due ${t.due || "-"}, ${t.status})`).join("\n") || "none"}`,
      `Deadlines:\n${snap.deadlines.slice(0, 20).map((x) => `- ${x.due} ${x.title} (${x.repeats}, owner ${x.owner || "-"})`).join("\n") || "none"}`,
      `Tool stack:\n${d.vendors.map((v) => `- ${v.name}: ${v.purpose}, SAR ${v.cost_sar}/mo${v.critical ? ", critical" : ""}`).join("\n") || "none"}`,
      `Incidents (open): ${snap.incidents.open}`].join("\n\n");
    await streamDraft(req, res, { prompt: opsReportPrompt(w, req.params.task, ctx), onDone: (text) => store.addOps("ops_reports", w.id, { task: req.params.task, title: OPS_TASKS[req.params.task].title, text }).id });
  });

  // ---- product
  const prodData = (wsId) => ({ items: store.listOps("product_items", wsId), feedback: store.listOps("product_feedback", wsId), releases: store.listOps("product_releases", wsId) });
  app.get("/api/product/meta", (req, res) => res.json({ statuses: ITEM_STATUS, types: ITEM_TYPES, areas: PRODUCT_AREAS, effort: Object.keys(EFFORT) }));
  app.get("/api/workspaces/:ws/product", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = prodData(w.id);
    res.json({ ...d, snapshot: productSnapshot(d), docs: store.listOps("product_docs", w.id).map(({ text, ...x }) => x).sort((a, b) => b.created_at.localeCompare(a.created_at)) });
  });
  app.post("/api/workspaces/:ws/product/items", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const it = cleanItem(req.body || {});
    if (!it.title) return res.status(422).json({ detail: "title is required" });
    const status = ITEM_STATUS_IDS.includes(req.body?.status) ? req.body.status : "idea";
    res.status(201).json(store.addOps("product_items", w.id, { ...it, status, target: /^\d{4}-\d{2}$/.test(req.body?.target || "") ? req.body.target : null, notes: "", source: "manual", reviewed: true }));
  });
  app.post("/api/workspaces/:ws/product/items/starter", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const have = new Set(store.listOps("product_items", w.id).map((i) => i.title.toLowerCase()));
    const add = STARTER_ROADMAP.filter((i) => !have.has(i.title.toLowerCase()));
    add.forEach((i) => store.addOps("product_items", w.id, { ...i, target: null, notes: "", source: "starter", reviewed: true }, false));
    store.save();
    res.status(201).json({ added: add.length });
  });
  app.put("/api/workspaces/:ws/product/items/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const cur = store.getOps("product_items", w.id, req.params.id);
    if (!cur) return res.status(404).json({ detail: "Item not found" });
    const b = req.body || {}, o = {};
    const merged = cleanItem({ ...cur, ...b });
    for (const k of ["title", "type", "area", "problem", "effort", "impact", "confidence"]) if (b[k] !== undefined) o[k] = merged[k];
    if (o.title === "") return res.status(422).json({ detail: "title cannot be empty" });
    if (b.status !== undefined) {
      if (!ITEM_STATUS_IDS.includes(b.status)) return res.status(422).json({ detail: "unknown status" });
      if (b.status === "not_doing" && !String(b.reason || cur.reason || "").trim()) return res.status(422).json({ detail: "Say why it's not being done" });
      o.status = b.status; o.reviewed = true; if (b.status === "released" && !cur.released_at) o.released_at = new Date().toISOString();
    }
    if (b.reason !== undefined) o.reason = String(b.reason).slice(0, 500);
    if (b.reviewed !== undefined) o.reviewed = !!b.reviewed;
    if (b.target !== undefined) o.target = /^\d{4}-\d{2}$/.test(b.target || "") ? b.target : null;
    if (b.notes !== undefined) o.notes = String(b.notes).slice(0, 4000);
    if (b.owner !== undefined) o.owner = String(b.owner).slice(0, 120);
    if (cur.starter) o.starter = false; // a person has looked at it
    res.json(store.updateOps("product_items", w.id, cur.id, o));
  });
  app.delete("/api/workspaces/:ws/product/items/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    if (!store.deleteOps("product_items", w.id, req.params.id)) return res.status(404).json({ detail: "Item not found" });
    for (const f of store.listOps("product_feedback", w.id)) if (f.item_id === req.params.id) f.item_id = null;
    for (const r of store.listOps("product_releases", w.id)) r.item_ids = (r.item_ids || []).filter((x) => x !== req.params.id);
    store.save();
    res.status(204).end();
  });
  // feedback
  app.post("/api/workspaces/:ws/product/feedback", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!text) return res.status(422).json({ detail: "Write the feedback first" });
    const item = req.body?.item_id ? store.getOps("product_items", w.id, req.body.item_id) : null;
    res.status(201).json(store.addOps("product_feedback", w.id, { text, source: ["support", "sales", "manual"].includes(req.body?.source) ? req.body.source : "manual", customer: String(req.body?.customer || "").slice(0, 120), item_id: item?.id || null, dismissed: false }));
  });
  app.post("/api/workspaces/:ws/product/feedback/import-support", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const seen = new Set(store.listOps("product_feedback", w.id).map((f) => f.source_ref).filter(Boolean));
    let n = 0;
    for (const t of store.listTickets(w.id).filter((t) => ["feature-request", "bug"].includes(t.category))) {
      for (const m of t.messages.filter((m) => m.from === "customer")) {
        const ref = `ticket:${t.id}:${m.id}`;
        if (seen.has(ref)) continue;
        store.addOps("product_feedback", w.id, { text: m.text.slice(0, 2000), source: "support", customer: t.customer_name || t.store || "", item_id: null, dismissed: false, source_ref: ref, kind: t.category }, false); n++;
      }
    }
    store.save();
    res.status(201).json({ added: n });
  });
  app.put("/api/workspaces/:ws/product/feedback/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const o = {};
    if (req.body?.item_id !== undefined) { const it = req.body.item_id ? store.getOps("product_items", w.id, req.body.item_id) : null; if (req.body.item_id && !it) return res.status(422).json({ detail: "Unknown roadmap item" }); o.item_id = it?.id || null; }
    if (req.body?.dismissed !== undefined) o.dismissed = !!req.body.dismissed;
    const f = store.updateOps("product_feedback", w.id, req.params.id, o);
    f ? res.json(f) : res.status(404).json({ detail: "Feedback not found" });
  });
  app.delete("/api/workspaces/:ws/product/feedback/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("product_feedback", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Feedback not found" }); });
  app.post("/api/workspaces/:ws/product/feedback/cluster", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const fb = store.listOps("product_feedback", w.id).filter((f) => !f.item_id && !f.dismissed).slice(0, 150), items = store.listOps("product_items", w.id);
    if (!fb.length) return res.status(422).json({ detail: "There's no ungrouped feedback to cluster." });
    try {
      const raw = await provider.generate({ system: "You are a product analyst. You group customer feedback precisely and return only JSON.", prompt: clusterPrompt(w, fb, items), onText: () => {} });
      const clusters = parseClusters(raw, fb.map((f) => f.id), items.map((i) => i.id));
      if (!clusters || !clusters.length) return res.status(422).json({ detail: "AI couldn't group that feedback. Try again, or link items by hand." });
      res.json({ clusters });
    } catch (e) { res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." }); }
  });
  app.post("/api/workspaces/:ws/product/feedback/apply-clusters", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const clusters = Array.isArray(req.body?.clusters) ? req.body.clusters.slice(0, 30) : [];
    let created = 0, linked = 0;
    for (const c of clusters) {
      let itemId = c.existing_item_id && store.getOps("product_items", w.id, c.existing_item_id) ? String(c.existing_item_id) : null;
      if (!itemId && c.new_item) {
        const it = cleanItem(c.new_item);
        if (!it.title) continue;
        itemId = store.addOps("product_items", w.id, { ...it, status: "idea", target: null, notes: `Theme: ${String(c.theme || "").slice(0, 120)}`, source: "ai", reviewed: false }, false).id; created++;
      }
      if (!itemId) continue;
      for (const fid of c.feedback_ids || []) { const f = store.getOps("product_feedback", w.id, fid); if (f && !f.item_id) { f.item_id = itemId; linked++; } }
    }
    store.save();
    res.status(201).json({ created, linked });
  });
  // releases
  app.post("/api/workspaces/:ws/product/releases", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const version = String(req.body?.version || "").trim().slice(0, 40);
    if (!version) return res.status(422).json({ detail: "version is required" });
    const ids = (Array.isArray(req.body?.item_ids) ? req.body.item_ids : []).map(String).filter((id) => store.getOps("product_items", w.id, id));
    res.status(201).json(store.addOps("product_releases", w.id, { version, date: /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || "") ? req.body.date : null, item_ids: ids, notes: String(req.body?.notes || "").slice(0, 2000), status: "draft" }));
  });
  app.put("/api/workspaces/:ws/product/releases/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const r = store.getOps("product_releases", w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Release not found" });
    const b = req.body || {}, o = {};
    if (b.item_ids !== undefined) o.item_ids = (Array.isArray(b.item_ids) ? b.item_ids : []).map(String).filter((id) => store.getOps("product_items", w.id, id));
    if (b.notes !== undefined) o.notes = String(b.notes).slice(0, 2000);
    if (b.date !== undefined) o.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : null;
    if (b.status === "released" && r.status !== "released") {
      // A person approved go: ship it and mark its items released.
      o.status = "released"; o.date = o.date || r.date || new Date().toISOString().slice(0, 10);
      for (const id of o.item_ids || r.item_ids || []) store.updateOps("product_items", w.id, id, { status: "released", released_at: new Date().toISOString(), reviewed: true });
    } else if (b.status === "draft") o.status = "draft";
    res.json(store.updateOps("product_releases", w.id, r.id, o));
  });
  app.delete("/api/workspaces/:ws/product/releases/:id", (req, res) => { const w = ws(req, res); if (!w) return; store.deleteOps("product_releases", w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Release not found" }); });
  // AI documents: specs and release notes
  app.get("/api/workspaces/:ws/product/docs/:id", (req, res) => { const w = ws(req, res); if (!w) return; const d = store.getOps("product_docs", w.id, req.params.id); d ? res.json(d) : res.status(404).json({ detail: "Not found" }); });
  app.post("/api/workspaces/:ws/product/items/:id/ai/spec", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const it = store.getOps("product_items", w.id, req.params.id);
    if (!it) return res.status(404).json({ detail: "Item not found" });
    const fb = store.listOps("product_feedback", w.id).filter((f) => f.item_id === it.id).slice(0, 40);
    await streamDraft(req, res, { prompt: specPrompt(w, it, fb), onDone: (text) => store.addOps("product_docs", w.id, { kind: "spec", item_id: it.id, title: `Spec: ${it.title}`, text }).id });
  });
  app.post("/api/workspaces/:ws/product/releases/:id/ai", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const r = store.getOps("product_releases", w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Release not found" });
    const items = (r.item_ids || []).map((id) => store.getOps("product_items", w.id, id)).filter(Boolean);
    await streamDraft(req, res, { prompt: releasePrompt(w, r, items), onDone: (text) => store.addOps("product_docs", w.id, { kind: "release", release_id: r.id, title: `Release notes ${r.version}`, text }).id });
  });
  app.post("/api/workspaces/:ws/product/docs/:id/to-help-center", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = store.getOps("product_docs", w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Not found" });
    const i = d.text.search(/^##\s*Help[- ]center/im);
    const arts = i >= 0 ? parseArticles(d.text.slice(i).replace(/^##[^\n]*\n/, "")) : [];
    if (!arts.length) return res.status(422).json({ detail: "No help-center article found in this draft." });
    arts.forEach((a) => store.addArticle(w.id, a, false));
    store.save();
    res.status(201).json({ added: arts.length });
  });

  // ---- ROAS reporting: designed vs plain catalog creative, from ad-level CSV exports
  app.get("/api/workspaces/:ws/roas", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const rows = store.listOps("roas_rows", w.id);
    res.json({ summary: roasSummary(rows), batches: store.listOps("roas_batches", w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      stores: store.listDeals(w.id).filter((d) => ["beta", "trial", "paying"].includes(d.stage)).map((d) => ({ id: d.id, name: d.name, stage: d.stage })),
      channels: AD_CHANNELS, types: CREATIVE_TYPES });
  });
  app.post("/api/workspaces/:ws/roas/parse", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const r = parseAdsCsv(String(req.body?.text || "").slice(0, 2_000_000), { currency: req.body?.currency === "USD" ? "USD" : "SAR", channel: AD_CHANNELS.includes(req.body?.channel) ? req.body.channel : "" });
    if (r.error) return res.status(422).json({ detail: r.error });
    // One line per unique ad, with a best-guess template and type for the person to check.
    const ads = new Map();
    for (const row of r.rows) {
      const a = ads.get(row.ad_name) || { ad_name: row.ad_name, ...classifyAd(row.ad_name), spend_sar: 0, revenue_sar: 0, purchases: 0, days: 0 };
      a.spend_sar += row.spend_sar; a.revenue_sar += row.revenue_sar; a.purchases += row.purchases; a.days++;
      ads.set(row.ad_name, a);
    }
    res.json({ channel: r.channel, rows: r.rows, ads: [...ads.values()].map((a) => ({ ...a, spend_sar: Math.round(a.spend_sar), revenue_sar: Math.round(a.revenue_sar) })) });
  });
  app.post("/api/workspaces/:ws/roas/import", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const b = req.body || {};
    const deal = b.deal_id ? store.getDeal(w.id, b.deal_id) : null;
    const storeName = String(deal?.name || b.store || "").trim().slice(0, 120);
    if (!storeName) return res.status(422).json({ detail: "Pick the store these results belong to" });
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 20000) : [];
    if (!rows.length) return res.status(422).json({ detail: "No rows to import" });
    const map = b.mapping && typeof b.mapping === "object" ? b.mapping : {};
    const channel = AD_CHANNELS.includes(b.channel) ? b.channel : "Other";
    const batch = store.addOps("roas_batches", w.id, { store: storeName, deal_id: deal?.id || null, channel, rows: rows.length, from: null, to: null }, false);
    let from = "9999", to = "0000";
    for (const r of rows) {
      const m = map[r.ad_name] || classifyAd(r.ad_name);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : new Date().toISOString().slice(0, 10);
      if (date < from) from = date; if (date > to) to = date;
      store.addOps("roas_rows", w.id, { batch_id: batch.id, store: storeName, deal_id: deal?.id || null, channel, date, ad_name: String(r.ad_name || "").slice(0, 200),
        template: String(m.template || "Untitled").slice(0, 80), creative_type: CREATIVE_TYPES.includes(m.creative_type) ? m.creative_type : "designed",
        spend_sar: Math.max(0, Number(r.spend_sar) || 0), revenue_sar: Math.max(0, Number(r.revenue_sar) || 0), impressions: Math.max(0, Math.round(Number(r.impressions) || 0)),
        clicks: Math.max(0, Math.round(Number(r.clicks) || 0)), purchases: Math.max(0, Math.round(Number(r.purchases) || 0)) }, false);
    }
    Object.assign(batch, { from, to });
    store.save();
    res.status(201).json({ batch_id: batch.id, rows: rows.length });
  });
  app.delete("/api/workspaces/:ws/roas/batches/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    if (!store.deleteOps("roas_batches", w.id, req.params.id)) return res.status(404).json({ detail: "Import not found" });
    store.db.roas_rows = store.db.roas_rows.filter((r) => !(r.workspace_id === String(w.id) && r.batch_id === req.params.id));
    store.save();
    res.status(204).end();
  });
  // Log the pooled ROAS of designed creatives as this month's "Merchant ROAS" KPI.
  app.post("/api/workspaces/:ws/roas/log-kpi", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const s = roasSummary(store.listOps("roas_rows", w.id));
    if (s.overall.designed.roas == null) return res.status(422).json({ detail: "No designed-creative results yet" });
    let k = store.listKpis(w.id).find((x) => x.name === "Merchant ROAS");
    if (!k) k = store.addKpi(w.id, DEFAULT_KPIS.find((x) => x.name === "Merchant ROAS") || { stage: "Value", name: "Merchant ROAS", unit: "x", frequency: "monthly" });
    const period = periodFor("monthly");
    store.logKpiValue(k.id, { period, value: s.overall.designed.roas, note: "from ROAS results (designed creatives)" });
    res.json({ kpi: k.name, period, value: s.overall.designed.roas });
  });
  app.post("/api/workspaces/:ws/roas/case-study", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const s = roasSummary(store.listOps("roas_rows", w.id));
    const st = s.stores.find((x) => x.store === String(req.body?.store || ""));
    if (!st) return res.status(404).json({ detail: "No results for that store" });
    await streamDraft(req, res, { prompt: caseStudyPrompt(w, st, s), onDone: (text) => {
      const n = store.addNote(w.id, { category: "results", title: `Case study: ${st.store}`, content: text });
      if (st.sample) { n.sample = true; store.save(); }
      return n.id;
    } });
  });

  // ---- command center + sample data for every module
  app.get("/api/workspaces/:ws/command", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const d = { ...commandSnapshot(store, w, Date.now(), crm), has_samples: hasSampleData(store, w.id) };
    // The overview only shows what this person's role may see in each module.
    const can = (m) => levelOk(req.perms[m], "view");
    const MOD = { Finance: "finance", Hiring: "team", Marketing: "marketing", Operations: "ops", Outreach: "crm", Product: "product", Sales: "sales", "Store CRM": "crm", Support: "support", Creative: "creative", People: "team", Payroll: "payroll", Compliance: "compliance", Billing: "billing" };
    d.needs = [...peopleNeeds(store, w, app.locals.peopleClock ? app.locals.peopleClock() : Date.now()), ...d.needs];
    if (!can("creative")) d.creative = null;
    if (can("workforce")) {
      const wsum = workforceSummary(store, workforce);
      d.workforce = { agents: wsum.totals.active, autonomous: wsum.totals.autonomous, people: wsum.totals.people, cost_month: wsum.totals.cost_month, budget_month: wsum.totals.budget_month, quality: wsum.totals.quality };
      d.needs = [...wsum.needs.filter((n) => !n.soft).slice(0, 3).map((n) => ({ module: "AI Workforce", route: "workforce", param: null, title: "AI Workforce", text: n.text })), ...d.needs];
    }
    if (can("compliance")) d.needs = [...complianceNeeds({ store, backups }).slice(0, 4), ...d.needs];
    billingCommandHook(d, billing, w, can("billing")); // billed MRR and overdue invoices, failed payments, trials ending
    const ok = (label) => !MOD[label] || can(MOD[label]);
    if (!can("finance")) d.finance = { hidden: true, runway_months: null, cash_sar: 0, cash_as_of: null, net_burn_sar: 0, month_costs_sar: 0, cash_zero_month: null };
    if (!can("team")) d.team = { ...d.team, payroll_sar: 0, candidates: 0, hidden: true };
    if (!can("sales")) { d.revenue = { ...d.revenue, open_value: 0, expected_mrr: 0, hidden: true }; d.close = null; }
    if (!can("crm")) d.outreach = null;
    d.me = { name: req.user.id === "owner" ? "" : req.user.name.split(" ")[0] };
    d.needs = d.needs.filter((n) => ok(n.module));
    d.feed = d.feed.filter((f) => ok(f.module));
    d.work = { ...d.work, modules: d.work.modules.filter((m) => ok(m.module)) };
    res.json(d);
  });
  app.post("/api/workspaces/:ws/sample-data", (req, res) => {
    const w = ws(req, res); if (!w) return;
    if (hasSampleData(store, w.id)) return res.status(409).json({ detail: "Sample data is already loaded. Remove it first to reload." });
    res.status(201).json(loadSampleData(store, w.id));
  });
  app.delete("/api/workspaces/:ws/sample-data", (req, res) => { const w = ws(req, res); if (w) res.json(removeSampleData(store, w.id)); });

  // ---- support (logged-in)
  app.get("/api/support/meta", (req, res) => res.json({ categories: SUPPORT_CATEGORIES, channels: CHANNELS, statuses: TICKET_STATUS, escalation_rules: ESCALATION_RULES }));
  app.get("/api/workspaces/:ws/support", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const tickets = store.listTickets(w.id), articles = store.listArticles(w.id);
    res.json({ tickets: tickets.map(({ messages, public_token, ...t }) => ({ ...t, last: messages.at(-1) || null, count: messages.length })), articles, summary: supportSummary(tickets, articles), settings: { widget_enabled: false, widget_key: null, ...(w.support || {}) } });
  });
  app.put("/api/workspaces/:ws/support/settings", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const fields = {};
    if (req.body?.widget_enabled !== undefined) fields.widget_enabled = !!req.body.widget_enabled;
    if (!w.support?.widget_key || req.body?.rotate_key) fields.widget_key = crypto.randomBytes(12).toString("base64url");
    res.json(store.setSupportSettings(w.id, fields));
  });
  app.post("/api/workspaces/:ws/support/articles", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const question = String(req.body?.question || "").trim().slice(0, 300), answer = String(req.body?.answer || "").trim().slice(0, 6000);
    if (!question || !answer) return res.status(422).json({ detail: "question and answer are required" });
    res.status(201).json(store.addArticle(w.id, { question, answer, language: req.body?.language === "ar" ? "ar" : "en", category: SUPPORT_CATEGORIES.includes(req.body?.category) ? req.body.category : "other" }));
  });
  app.put("/api/workspaces/:ws/support/articles/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const f = {};
    if (req.body?.question !== undefined) f.question = String(req.body.question).trim().slice(0, 300);
    if (req.body?.answer !== undefined) f.answer = String(req.body.answer).trim().slice(0, 6000);
    if (f.question === "" || f.answer === "") return res.status(422).json({ detail: "question and answer cannot be empty" });
    if (req.body?.language !== undefined) f.language = req.body.language === "ar" ? "ar" : "en";
    if (req.body?.category !== undefined) f.category = SUPPORT_CATEGORIES.includes(req.body.category) ? req.body.category : "other";
    const a = store.updateArticle(w.id, req.params.id, f);
    a ? res.json(a) : res.status(404).json({ detail: "Article not found" });
  });
  app.delete("/api/workspaces/:ws/support/articles/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    store.deleteArticle(w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Article not found" });
  });
  app.post("/api/workspaces/:ws/support/articles/ai-starter", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    await streamDraft(req, res, { prompt: starterKbPrompt(w, store.listArticles(w.id)), onDone: (text) => {
      const arts = parseArticles(text);
      arts.forEach((a) => store.addArticle(w.id, a, false));
      store.save();
      return String(arts.length);
    } });
  });
  app.post("/api/workspaces/:ws/support/tickets", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const text = String(req.body?.message || "").trim().slice(0, 6000);
    if (!text) return res.status(422).json({ detail: "Paste the customer's message" });
    const t = store.addTicket(w.id, { channel: CHANNELS.includes(req.body?.channel) ? req.body.channel : "Other", customer_name: String(req.body?.customer_name || "").trim().slice(0, 100), contact: String(req.body?.contact || "").trim().slice(0, 200), store: String(req.body?.store || "").trim().slice(0, 200) });
    store.addTicketMessage(w.id, t.id, { from: "customer", text });
    res.status(201).json(store.getTicket(w.id, t.id));
  });
  app.get("/api/workspaces/:ws/support/tickets/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const t = store.getTicket(w.id, req.params.id);
    if (!t) return res.status(404).json({ detail: "Conversation not found" });
    const { public_token, ...rest } = t;
    res.json(rest);
  });
  app.put("/api/workspaces/:ws/support/tickets/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const f = {};
    if (req.body?.status !== undefined) { if (!TICKET_STATUS.includes(req.body.status)) return res.status(422).json({ detail: "unknown status" }); f.status = req.body.status; if (f.status === "needs_human" && !req.body.reason) f.escalation_reason = "Handed to a person"; }
    if (req.body?.category !== undefined) f.category = SUPPORT_CATEGORIES.includes(req.body.category) ? req.body.category : "other";
    for (const k of ["customer_name", "contact", "store"]) if (req.body?.[k] !== undefined) f[k] = String(req.body[k]).trim().slice(0, 200);
    const t = store.updateTicket(w.id, req.params.id, f);
    t ? res.json({ ok: true }) : res.status(404).json({ detail: "Conversation not found" });
  });
  app.delete("/api/workspaces/:ws/support/tickets/:id", (req, res) => {
    const w = ws(req, res); if (!w) return;
    store.deleteTicket(w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Conversation not found" });
  });
  // Add a message: a new customer message, or a reply the team sent (by you, or an AI draft you approved).
  app.post("/api/workspaces/:ws/support/tickets/:id/messages", (req, res) => {
    const w = ws(req, res); if (!w) return;
    const t = store.getTicket(w.id, req.params.id);
    if (!t) return res.status(404).json({ detail: "Conversation not found" });
    const from = ["customer", "you", "ai"].includes(req.body?.from) ? req.body.from : null;
    const text = String(req.body?.text || "").trim().slice(0, 6000);
    if (!from || !text) return res.status(422).json({ detail: "from and text are required" });
    store.addTicketMessage(w.id, t.id, { from, text, sent: true });
    if (from === "customer" && t.status === "resolved") store.updateTicket(w.id, t.id, { status: "new" });
    if (from === "you") store.updateTicket(w.id, t.id, { human_touched: true });
    res.status(201).json({ ok: true });
  });
  app.post("/api/workspaces/:ws/support/tickets/:id/ai-reply", async (req, res) => {
    const w = ws(req, res); if (!w) return;
    const t = store.getTicket(w.id, req.params.id);
    if (!t) return res.status(404).json({ detail: "Conversation not found" });
    res.setHeader("Content-Type", "application/json");
    try {
      const raw = await provider.generate({ system: SYSTEM_SUPPORT, prompt: replyPrompt(w, store.listArticles(w.id), t), onText: () => {} });
      const r = parseReply(raw);
      store.updateTicket(w.id, t.id, { category: r.category, language: r.language, ...(r.escalate ? { status: "needs_human", escalation_reason: r.reason } : {}) });
      res.json(r);
    } catch (e) {
      res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." });
    }
  });

  // ---- SOP: the operating procedure and this period's ticks
  app.get("/api/workspaces/:ws/sop", (req, res) => {
    if (!ws(req, res)) return;
    const periods = Object.fromEntries(SOP.map((s) => [s.cadence, periodFor(s.cadence)]));
    const checks = store.listSopChecks(req.params.ws, Object.values(periods));
    res.json({ sop: SOP, periods, checks });
  });
  app.post("/api/workspaces/:ws/sop", (req, res) => {
    if (!ws(req, res)) return;
    const { cadence, step, done } = req.body || {};
    const section = SOP.find((s) => s.cadence === cadence);
    if (!section || !section.steps.some((st) => st.id === step)) return res.status(422).json({ detail: "Unknown SOP step" });
    store.setSopCheck(req.params.ws, { period: periodFor(cadence), step: `${cadence}:${step}`, done: !!done });
    res.json({ ok: true });
  });

  // ---- knowledge
  app.get("/api/workspaces/:ws/notes", (req, res) => { if (ws(req, res)) res.json(store.listNotes(req.params.ws)); });
  app.post("/api/workspaces/:ws/notes", (req, res) => {
    if (!ws(req, res)) return;
    const { category, title, content } = req.body || {};
    if (!NOTE_CATEGORIES.includes(category)) return res.status(422).json({ detail: `category must be one of ${NOTE_CATEGORIES.join(", ")}` });
    if (!String(title || "").trim() || !String(content || "").trim()) return res.status(422).json({ detail: "title and content are required" });
    res.status(201).json(store.addNote(req.params.ws, { category, title, content }));
  });
  app.delete("/api/workspaces/:ws/notes/:id", (req, res) => {
    store.deleteNote(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Note not found" });
  });

  // ---- KPIs
  app.get("/api/workspaces/:ws/kpis", (req, res) => {
    if (ws(req, res)) res.json({ kpis: store.listKpis(req.params.ws), values: store.listKpiValues(req.params.ws) });
  });
  app.post("/api/workspaces/:ws/kpis", (req, res) => {
    if (!ws(req, res)) return;
    if (!String(req.body?.name || "").trim()) return res.status(422).json({ detail: "name is required" });
    res.status(201).json(store.addKpi(req.params.ws, req.body));
  });
  app.post("/api/workspaces/:ws/kpis/load-defaults", (req, res) => {
    if (!ws(req, res)) return;
    const existing = new Set(store.listKpis(req.params.ws).map((k) => k.name));
    const added = DEFAULT_KPIS.filter((k) => !existing.has(k.name)).map((k) => store.addKpi(req.params.ws, k, false));
    store.save();
    res.status(201).json(added);
  });
  app.delete("/api/workspaces/:ws/kpis/:id", (req, res) => {
    store.deleteKpi(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "KPI not found" });
  });
  app.post("/api/workspaces/:ws/kpis/:id/values", (req, res) => {
    const kpi = store.getKpi(req.params.id);
    if (!kpi || kpi.workspace_id !== req.params.ws) return res.status(404).json({ detail: "KPI not found" });
    const period = String(req.body?.period || "").trim();
    const value = Number(req.body?.value);
    if (!period || !Number.isFinite(value)) return res.status(422).json({ detail: "period and a numeric value are required" });
    res.status(201).json(store.logKpiValue(kpi.id, { period, value, note: String(req.body?.note || "") }));
  });

  app.get("/api/workspaces/:ws/gaps", (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const kpis = store.listKpis(w.id);
    const withValues = new Set(store.listKpiValues(w.id).map((v) => v.kpi_id)).size;
    res.json({ total: GAP_TOTAL, gaps: dataGaps(w.brief, store.listNotes(w.id), kpis.length, withValues) });
  });

  // ---- assets
  app.get("/api/workspaces/:ws/assets", (req, res) => { if (ws(req, res)) res.json(store.listAssets(req.params.ws)); });
  app.delete("/api/workspaces/:ws/assets/:id", (req, res) => {
    store.deleteAsset(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Output not found" });
  });
  app.get("/api/workspaces/:ws/export", (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const latest = new Map();
    for (const a of store.listAssets(w.id)) if (!latest.has(a.playbook)) latest.set(a.playbook, a);
    const body = [...latest.values()].reverse().map((a) => `# ${a.title}\n\n${a.text}`).join("\n\n---\n\n");
    res.type("text/markdown").send(`# ${w.brief.company_name} - Marketing Kit\n\n${body}\n`);
  });

  // ---- generation: streams plain text, then a [[MWIZ_SAVED]]id or [[MWIZ_ERROR]]message marker.
  app.post("/api/workspaces/:ws/run/:key", async (req, res) => {
    const w = ws(req, res);
    if (!w) return;
    const pb = PLAYBOOKS.find((p) => p.key === req.params.key);
    if (!pb) return res.status(404).json({ detail: `Unknown playbook '${req.params.key}'` });
    const inputs = Object.fromEntries(pb.inputs.map((i) => [i.name, String(req.body?.inputs?.[i.name] ?? "").trim() || i.default]));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const text = await provider.generate({
        system: SYSTEM, prompt: buildPrompt(store, w, pb, inputs), signal: ac.signal,
        onText: (delta) => res.write(delta),
      });
      const asset = store.addAsset(w.id, { playbook: pb.key, title: pb.title, inputs, text, provider: provider.name });
      res.end("\n\n[[MWIZ_SAVED]]" + asset.id);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (!(e instanceof LLMError)) console.error("generate failed:", e?.status, e?.message);
      res.end("\n\n[[MWIZ_ERROR]]" + (e instanceof LLMError ? e.message : "Something went wrong. Try again in a moment."));
    }
  });

  app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
  return app;
}
