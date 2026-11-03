// HTTP routes for Market Intelligence (module "intel" in Teams & roles): competitors and their change log, the
// weekly page watch, market signals and their import, win/loss, market sizing and the weekly brief.
// The AI Market analyst only drafts the brief; a person approves it, and the outcome is recorded in AI Workforce.
import { levelOk } from "./access.js";
import { withAgent } from "./agents.js";
import { LLMError } from "./engine.js";
import { PLANS } from "./sales.js";
import { AGENT_ID, COLL, COMPETITOR_PLATFORMS, IMPACTS, IMPORT_SOURCES, LINK_MODULES, SEGMENTS, SIGNAL_PLATFORMS, SIGNAL_TYPES, SIZING_INPUTS, WATCH_DAYS,
  briefPrompt, briefSources, changeLines, checkBrief, cleanCompetitor, cleanSignal, cleanSizing, ensureIntel, importCandidates, intelNeeds, ruleBrief, signalThemes, sizing, todayOf, weekStart, winLoss } from "./intel.js";

const DAY = 864e5;

export function mountIntel(app, { store, crm = null, provider, workforce = null, intel }) {
  ensureIntel(store);
  const P = "/api/workspaces/:ws/intel";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => intel.now();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  const outcome = (ws, o, note) => workforce?.event(AGENT_ID, ws, o, note);
  const salesView = (req) => levelOk(req.perms?.sales, "view");
  const comp = (w, id) => store.getOps(COLL.competitors, w.id, id);
  const changesOf = (w, id) => store.listOps(COLL.changes, w.id).filter((c) => c.competitor_id === String(id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const compRow = (w, c, full = false) => {
    const { watch = {}, ...rest } = c;
    const ch = changesOf(w, c.id);
    return { ...rest, watch: { last_checked_at: watch.last_checked_at || null, last_changed_at: watch.last_changed_at || null, last_error: watch.last_error || "", lines: watch.lines || 0,
      next_check_at: intel.nextAt(c), due: intel.due(c, now()), ...(full ? { snapshot: watch.snapshot || "" } : {}) },
      unreviewed: ch.filter((x) => x.kind === "page" && !x.reviewed_at).length, changes_count: ch.length, ...(full ? { changes: ch } : { last_change: ch[0] || null }) };
  };

  app.get("/api/intel/meta", (req, res) => res.json({ signal_types: SIGNAL_TYPES, signal_platforms: SIGNAL_PLATFORMS, impacts: IMPACTS, modules: LINK_MODULES, segments: SEGMENTS,
    competitor_platforms: COMPETITOR_PLATFORMS, import_sources: IMPORT_SOURCES, sizing_inputs: SIZING_INPUTS, watch_days: WATCH_DAYS, plans: PLANS.map((p) => ({ name: p.name, usd: p.usd, max: Number.isFinite(p.max) ? p.max : null })) }));

  // ---- overview
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const since = todayOf(now() - 7 * DAY);
    const sig = store.listOps(COLL.signals, w.id);
    res.json({ competitors: store.listOps(COLL.competitors, w.id).length, watched: store.listOps(COLL.competitors, w.id).filter((c) => c.watch_enabled && c.watch_url).length,
      signals: sig.length, signals_7d: sig.filter((s) => s.date >= since).length, high_7d: sig.filter((s) => s.date >= since && s.impact === "high").length,
      unreviewed: store.listOps(COLL.changes, w.id).filter((c) => c.kind === "page" && !c.reviewed_at).length,
      briefs_waiting: store.listOps(COLL.briefs, w.id).filter((b) => b.status === "draft").length, analyst_level: level(), needs: intelNeeds(store, w) });
  });

  // ---- competitors
  app.get(`${P}/competitors`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json(store.listOps(COLL.competitors, w.id).sort((a, b) => a.name.localeCompare(b.name)).map((c) => compRow(w, c)));
  });
  app.get(`${P}/competitors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = comp(w, req.params.id); if (!c) return res.status(404).json({ detail: "Competitor not found" });
    res.json(compRow(w, c, true));
  });
  app.post(`${P}/competitors`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanCompetitor({ platforms: [], pricing: [], ...(req.body || {}) });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (store.listOps(COLL.competitors, w.id).some((c) => c.name.toLowerCase() === out.name.toLowerCase())) return res.status(409).json({ detail: `${out.name} is already in the list.` });
    const c = store.addOps(COLL.competitors, w.id, { site: "", segment: "", platforms: [], pricing: [], pricing_source_url: "", pricing_checked_on: "", pricing_notes: "", positioning: "", strengths: "", weaknesses: "", last_checked: "", notes: "", watch_url: "", watch_enabled: false, watch: {}, ...out, created_by: by(req) }, false);
    store.addOps(COLL.changes, w.id, { competitor_id: c.id, kind: "created", text: `Added by ${by(req)}`, by: by(req), reviewed_at: c.created_at });
    res.status(201).json(compRow(w, c, true));
  });
  app.put(`${P}/competitors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = comp(w, req.params.id); if (!c) return res.status(404).json({ detail: "Competitor not found" });
    const { out, err } = cleanCompetitor({ ...(req.body || {}), _current: c }, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.name && store.listOps(COLL.competitors, w.id).some((x) => x.id !== c.id && x.name.toLowerCase() === out.name.toLowerCase())) return res.status(409).json({ detail: `${out.name} is already in the list.` });
    const lines = changeLines(c, out);
    // A new watched page starts a new baseline.
    if (out.watch_url !== undefined && out.watch_url !== c.watch_url) out.watch = {};
    const x = store.updateOps(COLL.competitors, w.id, c.id, out);
    if (lines.length) store.addOps(COLL.changes, w.id, { competitor_id: c.id, kind: "edit", lines, text: "", by: by(req), reviewed_at: new Date().toISOString() });
    res.json(compRow(w, x, true));
  });
  app.delete(`${P}/competitors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!comp(w, req.params.id)) return res.status(404).json({ detail: "Competitor not found" });
    store.db[COLL.changes] = store.db[COLL.changes].filter((x) => !(x.workspace_id === w.id && x.competitor_id === String(req.params.id)));
    for (const s of store.listOps(COLL.signals, w.id)) if (s.competitor_id === String(req.params.id)) s.competitor_id = null;
    store.deleteOps(COLL.competitors, w.id, req.params.id);
    res.status(204).end();
  });
  // A note in the competitor's change log (something a person saw: a launch, a new market, a price heard on a call).
  app.post(`${P}/competitors/:id/changes`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = comp(w, req.params.id); if (!c) return res.status(404).json({ detail: "Competitor not found" });
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    if (!text) return res.status(422).json({ detail: "Write what changed." });
    const url = req.body?.url ? String(req.body.url).trim().slice(0, 500) : "";
    if (url && !/^https?:\/\//i.test(url)) return res.status(422).json({ detail: "The source must be a web link." });
    res.status(201).json(store.addOps(COLL.changes, w.id, { competitor_id: c.id, kind: "note", text, url, by: by(req), reviewed_at: new Date().toISOString() }));
  });
  app.post(`${P}/competitors/:id/check`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = comp(w, req.params.id); if (!c) return res.status(404).json({ detail: "Competitor not found" });
    const r = await intel.check(w, c, { by: by(req) });
    if (r.error) return res.status(r.status || 422).json({ detail: r.error, refused: !!r.refused });
    res.json({ changed: r.changed, baseline: r.baseline, change: r.change, competitor: compRow(w, r.competitor, true) });
  });
  app.post(`${P}/changes/:id/review`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const ch = store.getOps(COLL.changes, w.id, req.params.id);
    if (!ch || ch.kind !== "page") return res.status(404).json({ detail: "Page change not found" });
    const note = String(req.body?.note || "").trim().slice(0, 1000);
    res.json(store.updateOps(COLL.changes, w.id, ch.id, { reviewed_at: new Date().toISOString(), reviewed_by: by(req), review_note: note }));
  });

  // ---- signals
  const signalsView = (w, q = {}) => {
    const days = Math.max(0, Math.min(3650, Number(q.days) || 0));
    const since = days ? todayOf(now() - days * DAY) : "";
    const all = store.listOps(COLL.signals, w.id).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const list = all.filter((s) => (!since || s.date >= since) && (!q.type || s.type === q.type) && (!q.tag || (s.tags || []).includes(String(q.tag))) && (!q.impact || s.impact === q.impact) && (!q.platform || s.platform === q.platform));
    return { signals: list, total: all.length, themes: signalThemes(list) };
  };
  app.get(`${P}/signals`, (req, res) => { const w = W(req, res); if (!w) return; res.json(signalsView(w, req.query)); });
  app.post(`${P}/signals`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanSignal({ tags: [], module: "", platform: "", text: "", source_url: "", ...(req.body || {}) }, false, now());
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.competitor_id && !comp(w, out.competitor_id)) out.competitor_id = null;
    res.status(201).json(store.addOps(COLL.signals, w.id, { competitor_id: null, ...out, origin: null, by: by(req) }));
  });
  app.put(`${P}/signals/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = store.getOps(COLL.signals, w.id, req.params.id); if (!s) return res.status(404).json({ detail: "Signal not found" });
    const { out, err } = cleanSignal({ ...(req.body || {}), _type: s.type, _platform: s.platform }, true, now());
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.type && out.type !== "platform_change" && out.platform === undefined) out.platform = s.platform;
    res.json(store.updateOps(COLL.signals, w.id, s.id, out));
  });
  app.delete(`${P}/signals/:id`, (req, res) => { const w = W(req, res); if (!w) return; store.deleteOps(COLL.signals, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Signal not found" }); });
  app.post(`${P}/signals/import`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const sources = (Array.isArray(req.body?.sources) && req.body.sources.length ? req.body.sources : IMPORT_SOURCES.map((s) => s.id)).filter((s) => IMPORT_SOURCES.some((x) => x.id === s));
    if (!sources.length) return res.status(422).json({ detail: "Pick at least one source." });
    // Reading another module's records needs view access on it.
    const need = { deals: "sales", tickets: "support", feedback: "product", crm: "crm" };
    const denied = sources.filter((s) => !levelOk(req.perms?.[need[s]], "view"));
    const { candidates, skipped } = importCandidates({ store, crm, w, sources: sources.filter((s) => !denied.includes(s)) });
    const have = new Set(store.listOps(COLL.signals, w.id).map((s) => s.origin).filter(Boolean));
    const added = {};
    for (const c of candidates) {
      if (have.has(c.origin)) continue;
      have.add(c.origin);
      store.addOps(COLL.signals, w.id, { source_url: "", platform: "", competitor_id: null, ...c, by: `Import (${by(req)})` }, false);
      const k = c.origin.split(":")[0]; added[k] = (added[k] || 0) + 1;
    }
    store.save();
    res.json({ ...signalsView(w), added, imported: Object.values(added).reduce((a, n) => a + n, 0), skipped, denied });
  });

  // ---- win / loss (from Sales deals). Deal names need Sales view.
  app.get(`${P}/winloss`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const wl = winLoss(store.listDeals(w.id), { now: now(), days: Math.max(0, Math.min(3650, Number(req.query.days) || 0)) });
    if (!salesView(req)) wl.rows = wl.rows.map((r) => ({ ...r, name: `Deal #${r.id}` }));
    res.json({ ...wl, can_edit_deals: levelOk(req.perms?.sales, "edit") });
  });

  // ---- market sizing
  const sizingOf = (w) => w.intel?.sizing || {};
  app.get(`${P}/sizing`, (req, res) => { const w = W(req, res); if (!w) return; res.json({ inputs: sizingOf(w), result: sizing(sizingOf(w)), fields: SIZING_INPUTS, updated_at: w.intel?.sizing_updated_at || null }); });
  app.put(`${P}/sizing`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanSizing(req.body?.inputs || req.body || {}, sizingOf(w));
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    w.intel = { ...(w.intel || {}), sizing: out, sizing_updated_at: new Date().toISOString(), sizing_by: by(req) }; store.save();
    res.json({ inputs: out, result: sizing(out), fields: SIZING_INPUTS, updated_at: w.intel.sizing_updated_at });
  });

  // ---- weekly brief
  app.get(`${P}/briefs`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const src = briefSources({ store, w, now: now() });
    res.json({ briefs: store.listOps(COLL.briefs, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), this_week: { since: src.since, until: src.until, items: src.items.length }, analyst_level: level() });
  });
  app.get(`${P}/briefs/sources`, (req, res) => { const w = W(req, res); if (!w) return; res.json(briefSources({ store, w, now: now() })); });
  app.post(`${P}/briefs`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (level() === 0) return res.status(422).json({ detail: "The AI Market analyst is switched off in AI Workforce." });
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const src = briefSources({ store, w, now: now() });
    let text = "", note = "", checks, byAi = false;
    if (src.items.length) {
      try {
        const out = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: briefPrompt(w, src, lang), onText: () => {} }));
        checks = checkBrief(out, src);
        // Only keep the AI's text when it cites this week's items and invents none.
        if (checks.cited.length && !checks.unknown.length) { text = String(out).trim(); byAi = true; }
        else note = checks.unknown.length ? `The AI cited items that aren't in the data (${checks.unknown.join(", ")}): this is the factual list built from the data instead. Add the analysis where it says [ADD].` : "The AI's answer didn't cite this week's items: this is the factual list built from the data instead. Add the analysis where it says [ADD].";
      } catch (e) {
        if (e instanceof LLMError && /switched off|budget/i.test(e.message)) return res.status(422).json({ detail: e.message });
        note = "The AI couldn't be reached: this is the factual list built from the data. Add the analysis where it says [ADD].";
      }
    } else note = "Nothing was recorded in the last 7 days: add signals, competitor changes or win/loss reasons first.";
    if (!text) text = ruleBrief(src, lang);
    checks = checkBrief(text, src);
    if (!byAi && src.items.length) outcome(w.id, "escalated", `Brief for ${src.since}: AI text unusable, factual list used`);
    const b = store.addOps(COLL.briefs, w.id, { week_start: weekStart(now()), since: src.since, until: src.until, lang, status: "draft", text, original: text, by_ai: byAi, note,
      refs: src.items.map((i) => i.ref), sources: src.items, items: src.items.length, issues: checks.issues, cited: checks.cited, created_by: by(req) });
    res.status(201).json(b);
  });
  const draftOf = (req, res, w) => {
    const b = store.getOps(COLL.briefs, w.id, req.params.id);
    if (!b) { res.status(404).json({ detail: "Brief not found" }); return null; }
    if (b.status !== "draft") { res.status(422).json({ detail: "Only draft briefs can be changed." }); return null; }
    return b;
  };
  const recheck = (b, text = b.text) => checkBrief(text, { items: b.sources || [], since: b.since, until: b.until });
  app.put(`${P}/briefs/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = draftOf(req, res, w); if (!b) return;
    const text = String(req.body?.text ?? b.text).slice(0, 20000);
    if (!text.trim()) return res.status(422).json({ detail: "The brief can't be empty." });
    const c = recheck(b, text);
    res.json(store.updateOps(COLL.briefs, w.id, b.id, { text, issues: c.issues, cited: c.cited, edited_by: by(req) }));
  });
  app.post(`${P}/briefs/:id/approve`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = draftOf(req, res, w); if (!b) return;
    const c = recheck(b);
    if (c.unknown.length) return res.status(422).json({ detail: `The brief cites items that aren't in the data: ${c.unknown.join(", ")}. Remove them first.` });
    const edited = b.text.trim() !== String(b.original || "").trim();
    if (b.by_ai) outcome(w.id, edited ? "edited" : "accepted", `Brief ${b.since}: approved ${edited ? "after edits" : "unchanged"} by ${by(req)}`);
    res.json(store.updateOps(COLL.briefs, w.id, b.id, { status: "approved", approved_by: by(req), approved_at: new Date().toISOString(), edited }));
  });
  app.post(`${P}/briefs/:id/reject`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = draftOf(req, res, w); if (!b) return;
    const reason = String(req.body?.reason || "").trim().slice(0, 300);
    if (b.by_ai) outcome(w.id, "rejected", `Brief ${b.since}: rejected by ${by(req)}${reason ? `: ${reason}` : ""}`);
    res.json(store.updateOps(COLL.briefs, w.id, b.id, { status: "rejected", rejected_by: by(req), rejected_at: new Date().toISOString(), reject_reason: reason }));
  });
  app.delete(`${P}/briefs/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = store.getOps(COLL.briefs, w.id, req.params.id);
    if (!b) return res.status(404).json({ detail: "Brief not found" });
    if (b.status === "approved") return res.status(422).json({ detail: "Approved briefs are kept." });
    store.deleteOps(COLL.briefs, w.id, b.id); res.status(204).end();
  });
}
