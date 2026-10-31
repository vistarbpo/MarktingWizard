// The Express app: login, JSON API and streaming generation. server.js starts it.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_KPIS, GAP_TOTAL, LAUNCH_KIT, NOTE_CATEGORIES, PLAYBOOKS, dataGaps } from "./catalog.js";
import { LLMError, SYSTEM, buildPrompt } from "./engine.js";
import { SOP, periodFor } from "./sop.js";
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
