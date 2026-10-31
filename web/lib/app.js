// The Express app: login, JSON API and streaming generation. server.js starts it.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_KPIS, GAP_TOTAL, LAUNCH_KIT, NOTE_CATEGORIES, PLAYBOOKS, dataGaps } from "./catalog.js";
import { LLMError, SYSTEM, buildPrompt } from "./engine.js";
import { SOP, periodFor } from "./sop.js";
import { CATEGORIES as SUPPORT_CATEGORIES, CHANNELS, ESCALATION_RULES, SYSTEM_SUPPORT, TICKET_STATUS, parseArticles, parseReply, replyPrompt, starterKbPrompt, supportSummary } from "./support.js";
import { CANDIDATE_TASKS, CAND_STAGES, CAND_STAGE_IDS, DEPARTMENTS, EMPLOYMENT, ROLE_STATUS, ROLE_TASKS, SUGGESTED_ORG, SAMPLE_TEAM, candidatePrompt, enrichCandidate, hrSummary, parseScore, rolePrompt } from "./hr.js";
import { AI_TASKS, CITIES, OPEN, PLANS, PLATFORMS, STAGES, STAGE_IDS, enrich, salesPrompt, summary } from "./sales.js";

const __dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export function createApp({ store, provider, password }) {
  // Session cookies are signed with a key derived from the password, so changing it logs everyone out.
  const secret = crypto.createHash("sha256").update("mwiz:" + password).digest();
  const sign = (v) => v + "." + crypto.createHmac("sha256", secret).update(v).digest("base64url");
  const validSession = (req) => {
    const m = /(?:^|;\s*)mwiz=([^;]+)/.exec(req.headers.cookie || "");
    if (!m || !password) return false;
    const value = m[1].slice(0, m[1].lastIndexOf("."));
    const expected = sign(value);
    if (expected.length !== m[1].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[1]))) return false;
    return Number(value) > Date.now();
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  // ---- login (with a simple brute-force brake)
  const attempts = new Map();
  app.post("/login", (req, res) => {
    const ip = req.ip;
    const a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) return res.redirect("/login?e=locked");
    const given = String(req.body.password || "");
    const ok = password && given.length === password.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password));
    if (!ok) { a.n++; attempts.set(ip, a); return res.redirect("/login?e=" + (password ? "bad" : "unset")); }
    attempts.delete(ip);
    const expires = Date.now() + 30 * 864e5;
    res.setHeader("Set-Cookie", `mwiz=${sign(String(expires))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
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
      if (r.checked) store.addTicketMessage(w.id, t.id, { from: "ai", text: r.reply, sent: true });
      store.updateTicket(w.id, t.id, { category: r.category, language: r.language, status: r.escalate ? "needs_human" : "ai_answered", escalation_reason: r.escalate ? r.reason : "" });
      res.json({ token: t.public_token, reply: r.checked ? r.reply : null, handed_over: r.escalate });
    } catch (e) {
      store.updateTicket(w.id, t.id, { status: "needs_human", escalation_reason: "AI could not answer: " + (e?.message || "error") });
      res.json({ token: t.public_token, reply: null, handed_over: true });
    }
  });

  // Everything below needs a session.
  app.use((req, res, next) => {
    if (validSession(req)) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ detail: "Please log in again." });
    res.redirect("/login");
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
    res.json({ deals: deals.map((d) => enrich(d)), summary: summary(deals, store.listWorkspaceActivities(req.params.ws)) });
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
      store.updateHrCandidate(wsId, cand.id, { stage: c.stage, score: c.score });
      if (c.screen) store.addHrActivity(wsId, "candidate", cand.id, { type: "ai_draft", by: "ai", task: "screen", text: c.screen });
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
