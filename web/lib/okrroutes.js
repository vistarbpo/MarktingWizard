// HTTP routes for OKRs & Weekly business review (module "okr" in Teams & roles).
// Owner, Admin and Team lead create, edit, activate, grade and delete objectives; anyone else with Edit (a Team member)
// only checks in on key results they own and comments on the weekly review. Only an Owner or Admin marks a weekly review reviewed (then it's locked).
// Metrics from modules a person can't view are hidden in every response (and in the printable review).
import { levelOk } from "./access.js";
import { withAgent } from "./agents.js";
import { CONFIDENCE, CONFIDENCE_IDS, COLL, KR_MAX, KR_MIN, MANAGER_ROLES, REVIEWER_ROLES, SECTIONS, SECTION_IDS, STATUSES, AGENT_ID,
  canSeeMetric, checkNarrative, cleanKr, cleanObjective, ensureOkr, fmtVal, hiddenHint, metricById, metricCatalog, metricContext, objectiveView,
  quarterOf, redactData, redactNarrative, ruleNarrative, shiftQuarter, suggestedScore, valueForQuarter, QUARTER_RE } from "./okr.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function mountOkr(app, { store, crm = null, provider, workforce = null, okr, needModule = () => null }) {
  ensureOkr(store);
  const P = "/api/workspaces/:ws/okr";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => okr.now();
  const ctxOf = (w) => metricContext({ store, crm, w, now: now() });
  const manager = (req) => MANAGER_ROLES.includes(req.user?.role_id);
  const reviewer = (req) => REVIEWER_ROLES.includes(req.user?.role_id);
  const canEdit = (req) => manager(req); // objectives and their key results: Owner, Admin, Team lead only
  const outcome = (ws, o, note) => workforce?.event(AGENT_ID, ws, o, note);
  const log = (w, f) => store.addOps(COLL.log, w.id, { kr_id: null, from: null, to: null, ...f }, false);
  const obj = (w, id) => store.getOps(COLL.objectives, w.id, id);
  const krsOf = (w, o) => store.listOps(COLL.krs, w.id).filter((k) => k.objective_id === o.id);
  const view = (req, w, o, ctx = ctxOf(w)) => ({ ...objectiveView(store, ctx, o, req.perms, { now: now() }), can_edit: o.status !== "closed" && canEdit(req, o) && levelOk(req.perms?.okr, "edit") });
  const deny = (res, text) => res.status(403).json({ detail: text });
  const NOT_YOURS = "Only an Owner, Admin or Team lead changes objectives and key results. You can check in on key results you own.";

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const q = quarterOf(now());
    res.json({ statuses: STATUSES, confidence: CONFIDENCE, sections: SECTIONS, kr_min: KR_MIN, kr_max: KR_MAX, current_quarter: q, quarters: [shiftQuarter(q, -1), q, shiftQuarter(q, 1)],
      metrics: metricCatalog(store, w).map((m) => ({ id: m.id, name: m.name, unit: m.unit, kind: m.kind, higher_is_better: m.higher_is_better, source: m.source, hidden: !canSeeMetric(req.perms, m), hint: canSeeMetric(req.perms, m) ? "" : hiddenHint(m) })),
      teams: store.db.teams.map((t) => ({ id: t.id, name: t.name })), people: [{ id: "owner", name: "Owner" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))],
      me: { id: req.user.id, manager: manager(req), reviewer: reviewer(req), edit: levelOk(req.perms?.okr, "edit") }, agent_level: okr.level() });
  });

  // ---- objectives
  app.get(`${P}/objectives`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const q = QUARTER_RE.test(String(req.query.quarter || "")) ? String(req.query.quarter) : quarterOf(now());
    const ctx = ctxOf(w);
    const list = store.listOps(COLL.objectives, w.id).filter((o) => o.quarter === q).sort((a, b) => (a.level === "company" ? 0 : 1) - (b.level === "company" ? 0 : 1) || Number(a.id) - Number(b.id));
    res.json({ quarter: q, objectives: list.map((o) => view(req, w, o, ctx)), log: store.listOps(COLL.log, w.id).filter((l) => list.some((o) => o.id === l.objective_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30) });
  });
  app.get(`${P}/objectives/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    res.json(view(req, w, o));
  });
  const addKr = (req, w, o, b, sort) => {
    const { out, err } = cleanKr(b, { store, w });
    if (err.length) return { err };
    if (out.kind === "linked" && !canSeeMetric(req.perms, metricById(store, w, out.metric))) return { err: [`You can't link this metric: ${hiddenHint(metricById(store, w, out.metric))}.`], status: 403 };
    // A linked KR starts from today's value unless a start is given.
    if (out.kind === "linked" && out.start == null) { const v = valueForQuarter(ctxOf(w), metricById(store, w, out.metric), o.quarter); out.start = v ?? 0; }
    if (out.start == null) out.start = 0;
    if (out.kind === "manual" && out.current == null) out.current = out.start;
    const k = store.addOps(COLL.krs, w.id, { objective_id: o.id, unit: "", owner_id: o.owner_id || req.user.id, confidence: "on_track", sort, last_checkin_at: null, current: null, ...out }, false);
    log(w, { objective_id: o.id, kr_id: k.id, kind: "kr_added", text: `Key result added: ${k.title}`, by: by(req) });
    return { kr: k };
  };
  app.post(`${P}/objectives`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!manager(req)) return deny(res, "Only an Owner, Admin or Team lead creates objectives. You can check in on key results you own.");
    const b = req.body || {};
    const { out, err } = cleanObjective({ quarter: quarterOf(now()), level: "company", ...b }, { store });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const krs = Array.isArray(b.krs) ? b.krs : [];
    if (krs.length > KR_MAX) return res.status(422).json({ detail: `An objective has at most ${KR_MAX} key results.` });
    for (const k of krs) { const c = cleanKr(k, { store, w }); if (c.err.length) return res.status(422).json({ detail: `Key result "${String(k.title || "").slice(0, 60)}": ${c.err.join("; ")}` }); }
    const o = store.addOps(COLL.objectives, w.id, { description: "", team_id: null, owner_id: req.user.id, status: "draft", score: null, retro: "", activated_at: null, ...out, created_by: by(req) }, false);
    log(w, { objective_id: o.id, kind: "created", text: `Objective created (${o.level === "team" ? "team" : "company"}, ${o.quarter})`, by: by(req) });
    for (const [i, k] of krs.entries()) { const r = addKr(req, w, o, k, i); if (r.err) { store.db[COLL.objectives] = store.db[COLL.objectives].filter((x) => x.id !== o.id); store.db[COLL.krs] = store.db[COLL.krs].filter((x) => x.objective_id !== o.id); store.save(); return res.status(r.status || 422).json({ detail: r.err.join("; ") }); } }
    store.save();
    res.status(201).json(view(req, w, o));
  });
  app.put(`${P}/objectives/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    if (!canEdit(req, o)) return deny(res, NOT_YOURS);
    if (o.status === "closed") return res.status(422).json({ detail: "Closed objectives are kept as graded." });
    const b = { ...(req.body || {}) };
    if (!manager(req)) delete b.owner_id; // only managers hand an objective to someone else
    const { out, err } = cleanObjective({ ...b, _level: o.level, _team_id: o.team_id }, { store, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.json(view(req, w, store.updateOps(COLL.objectives, w.id, o.id, out)));
  });
  app.delete(`${P}/objectives/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    if (!manager(req)) return deny(res, "Only an Owner, Admin or Team lead deletes objectives.");
    if (o.status === "closed") return res.status(422).json({ detail: "Closed objectives are kept as graded." });
    for (const c of [COLL.krs, COLL.checkins, COLL.log]) store.db[c] = store.db[c].filter((x) => !(x.workspace_id === w.id && x.objective_id === o.id));
    store.deleteOps(COLL.objectives, w.id, o.id);
    res.status(204).end();
  });
  app.post(`${P}/objectives/:id/activate`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    if (!canEdit(req, o)) return deny(res, NOT_YOURS);
    if (o.status !== "draft") return res.status(422).json({ detail: "Only a draft objective can be activated." });
    const n = krsOf(w, o).length;
    if (n < KR_MIN || n > KR_MAX) return res.status(422).json({ detail: `An objective needs ${KR_MIN} to ${KR_MAX} key results to start (it has ${n}).` });
    log(w, { objective_id: o.id, kind: "status", from: "draft", to: "active", text: "Draft → active", by: by(req) });
    res.json(view(req, w, store.updateOps(COLL.objectives, w.id, o.id, { status: "active", activated_at: new Date(now()).toISOString() })));
  });
  // AI suggests a grade from the KRs (the AI Chief of staff, drafts only); the person decides.
  app.post(`${P}/objectives/:id/suggest-score`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    const v = view(req, w, o), rule = suggestedScore(v.krs);
    let s = { score: rule, why: rule == null ? "No key result has progress data yet." : "Average progress of the key results you can see, rounded to 0.1.", by_ai: false };
    if (okr.level() > 0 && v.krs.length && !v.partial) {
      try {
        const rows = v.krs.map((k) => ({ ref: k.ref, key_result: k.title, start: k.start, target: k.target, current: k.current, progress_pct: k.progress, confidence: k.confidence }));
        const out = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: `<task title="Suggest an OKR grade">\nYou are DPA AD's AI Chief of staff. Suggest a grade from 0.0 to 1.0 (steps of 0.1) for the objective "${o.title}" from its key results below. Use only these rows. Reply with JSON only: {"score": 0.7, "why": "one sentence citing [K..] refs"}.\n</task>\n<rows>${JSON.stringify(rows)}</rows>`, onText: () => {} }));
        const j = JSON.parse(/\{[\s\S]*\}/.exec(String(out))?.[0] || "null");
        const sc = Number(j?.score);
        if (j && Number.isFinite(sc) && sc >= 0 && sc <= 1 && /\[K\d+\]/.test(String(j.why || ""))) s = { score: Math.round(sc * 10) / 10, why: String(j.why).slice(0, 400), by_ai: true };
      } catch (e) { if (/switched off|budget/i.test(e?.message || "")) s.note = e.message; }
    }
    store.updateOps(COLL.objectives, w.id, o.id, { suggestion: { ...s, at: new Date(now()).toISOString() } });
    res.json(s);
  });
  app.post(`${P}/objectives/:id/close`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    if (!canEdit(req, o)) return deny(res, NOT_YOURS);
    if (o.status !== "active") return res.status(422).json({ detail: "Only an active objective can be closed." });
    const score = Number(req.body?.score), retro = String(req.body?.retro || "").trim().slice(0, 3000);
    if (req.body?.score === undefined || req.body?.score === "" || !Number.isFinite(score) || score < 0 || score > 1) return res.status(422).json({ detail: "Give a score from 0 to 1.0 (a person's call)." });
    if (!retro) return res.status(422).json({ detail: "Write the retro note: what worked, what didn't, what we'll change." });
    // Freeze what each KR showed when it was graded.
    const v = objectiveView(store, ctxOf(w), o, null, { checkins: 0, now: now() });
    for (const k of v.krs) store.updateOps(COLL.krs, w.id, k.id, { final_value: k.current, final_progress: k.progress });
    const sc = Math.round(score * 100) / 100;
    if (o.suggestion?.by_ai) outcome(w.id, o.suggestion.score === Math.round(sc * 10) / 10 ? "accepted" : "edited", `Grade for "${o.title.slice(0, 80)}": suggested ${o.suggestion.score}, given ${sc} by ${by(req)}`);
    log(w, { objective_id: o.id, kind: "status", from: "active", to: "closed", text: `Closed with a score of ${sc}`, by: by(req) });
    res.json(view(req, w, store.updateOps(COLL.objectives, w.id, o.id, { status: "closed", score: sc, retro, closed_at: new Date(now()).toISOString(), closed_by: by(req) })));
  });

  // ---- key results
  const krCtx = (req, res, w) => {
    const k = store.getOps(COLL.krs, w.id, req.params.id); if (!k) { res.status(404).json({ detail: "Key result not found" }); return null; }
    const o = obj(w, k.objective_id); if (!o) { res.status(404).json({ detail: "Objective not found" }); return null; }
    return { k, o };
  };
  app.get(`${P}/krs/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = krCtx(req, res, w); if (!c) return;
    const v = view(req, w, c.o);
    res.json({ ...v.krs.find((x) => x.id === c.k.id), objective: { id: c.o.id, title: c.o.title, status: c.o.status, quarter: c.o.quarter } });
  });
  app.post(`${P}/objectives/:id/krs`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = obj(w, req.params.id); if (!o) return res.status(404).json({ detail: "Objective not found" });
    if (!canEdit(req, o)) return deny(res, NOT_YOURS);
    if (o.status === "closed") return res.status(422).json({ detail: "Closed objectives are kept as graded." });
    const list = krsOf(w, o);
    if (list.length >= KR_MAX) return res.status(422).json({ detail: `An objective has at most ${KR_MAX} key results.` });
    const r = addKr(req, w, o, req.body || {}, list.length);
    if (r.err) return res.status(r.status || 422).json({ detail: r.err.join("; ") });
    store.save();
    res.status(201).json(view(req, w, o));
  });
  app.put(`${P}/krs/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = krCtx(req, res, w); if (!c) return;
    if (!canEdit(req, c.o)) return deny(res, NOT_YOURS);
    if (c.o.status === "closed") return res.status(422).json({ detail: "Closed objectives are kept as graded." });
    const b = { ...(req.body || {}) }; delete b.current; delete b.confidence; // those change through a check-in
    const { out, err } = cleanKr(b, { store, w, partial: true, cur: c.k });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if ((out.kind ?? c.k.kind) === "linked" && !canSeeMetric(req.perms, metricById(store, w, out.metric ?? c.k.metric))) return deny(res, "You can't see the metric this key result is linked to.");
    store.updateOps(COLL.krs, w.id, c.k.id, out);
    res.json(view(req, w, c.o));
  });
  app.delete(`${P}/krs/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = krCtx(req, res, w); if (!c) return;
    if (!canEdit(req, c.o)) return deny(res, NOT_YOURS);
    if (c.o.status === "closed") return res.status(422).json({ detail: "Closed objectives are kept as graded." });
    if (c.o.status === "active" && krsOf(w, c.o).length <= KR_MIN) return res.status(422).json({ detail: `An active objective keeps at least ${KR_MIN} key results.` });
    store.db[COLL.checkins] = store.db[COLL.checkins].filter((x) => !(x.workspace_id === w.id && x.kr_id === c.k.id));
    log(w, { objective_id: c.o.id, kr_id: null, kind: "kr_removed", text: `Key result removed: ${c.k.title}`, by: by(req) });
    store.deleteOps(COLL.krs, w.id, c.k.id);
    res.json(view(req, w, c.o));
  });
  // A check-in: the value (typed for manual KRs, read live for linked ones), the owner's confidence and a note.
  app.post(`${P}/krs/:id/checkins`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = krCtx(req, res, w); if (!c) return;
    const { k, o } = c;
    if (!(manager(req) || (k.owner_id && k.owner_id === req.user.id))) return deny(res, "You can check in only on key results you own. Ask an Owner, Admin or Team lead to change the owner.");
    if (o.status !== "active") return res.status(422).json({ detail: o.status === "draft" ? "Activate the objective first." : "Closed objectives are kept as graded." });
    const b = req.body || {};
    const conf = b.confidence === undefined || b.confidence === "" ? k.confidence || "on_track" : b.confidence;
    if (!CONFIDENCE_IDS.includes(conf)) return res.status(422).json({ detail: `confidence must be one of ${CONFIDENCE_IDS.join(", ")}` });
    const note = String(b.note || "").trim().slice(0, 1000);
    let value;
    if (k.kind === "linked") {
      const def = metricById(store, w, k.metric);
      if (!canSeeMetric(req.perms, def)) return deny(res, `This key result reads a metric you can't see (${def ? hiddenHint(def) : "metric removed"}).`);
      value = def ? valueForQuarter(ctxOf(w), def, o.quarter) : null; // linked: the live metric, never a typed number
    } else {
      const n = Number(String(b.value ?? "").replace(/,/g, ""));
      if (b.value === undefined || b.value === null || b.value === "" || !Number.isFinite(n)) return res.status(422).json({ detail: "Type the current value." });
      value = n;
    }
    const at = new Date(now()).toISOString();
    const ci = store.addOps(COLL.checkins, w.id, { kr_id: k.id, objective_id: o.id, value, confidence: conf, note, by: by(req), by_id: req.user.id, via: req.headers["x-mwiz-via"] === "assistant" ? "assistant" : "" }, false);
    ci.created_at = at;
    if (conf !== (k.confidence || "on_track")) log(w, { objective_id: o.id, kr_id: k.id, kind: "confidence", from: k.confidence || "on_track", to: conf, text: `Confidence ${(k.confidence || "on_track").replace("_", " ")} → ${conf.replace("_", " ")}`, by: by(req) }).created_at = at;
    log(w, { objective_id: o.id, kr_id: k.id, kind: "checkin", text: note ? `Check-in: ${note.slice(0, 120)}` : "Check-in", by: by(req) }).created_at = at;
    store.updateOps(COLL.krs, w.id, k.id, { confidence: conf, last_checkin_at: at, ...(k.kind === "manual" ? { current: value } : {}) });
    res.status(201).json({ checkin: ci, objective: view(req, w, o) });
  });

  // ---- weekly business review
  const summary = (r, hidden) => ({ id: r.id, week_start: r.week_start, from: r.from, to: r.to, status: r.status, by_ai: r.by_ai, generated_at: r.generated_at, reviewed_at: r.reviewed_at || null, reviewed_by: r.reviewed_by || null, comments: (r.comments || []).length, partial: hidden.size > 0 });
  const wbrView = (req, r) => {
    const { hidden, data } = redactData(r.data, req.perms, needModule);
    return { ...r, data, original: undefined, narrative: redactNarrative(r.narrative, hidden), partial: hidden.size > 0, hidden_rows: hidden.size,
      can_review: r.status === "draft" && reviewer(req), can_edit: r.status === "draft" && manager(req) && !hidden.size, can_comment: r.status === "draft" && levelOk(req.perms?.okr, "edit") };
  };
  const wbrOf = (req, res, w, draftOnly = false) => {
    const r = store.getOps(COLL.wbrs, w.id, req.params.id);
    if (!r) { res.status(404).json({ detail: "Review not found" }); return null; }
    if (draftOnly && r.status !== "draft") { res.status(422).json({ detail: "This review was marked reviewed and is locked." }); return null; }
    return r;
  };
  app.get(`${P}/wbr`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json({ reviews: store.listOps(COLL.wbrs, w.id).sort((a, b) => b.week_start.localeCompare(a.week_start)).map((r) => summary(r, redactData(r.data, req.perms, needModule).hidden)), agent_level: okr.level(), can_generate: manager(req) || reviewer(req) });
  });
  app.get(`${P}/wbr/:id`, (req, res) => { const w = W(req, res); if (!w) return; const r = wbrOf(req, res, w); if (r) res.json(wbrView(req, r)); });
  app.post(`${P}/wbr`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!(manager(req) || reviewer(req))) return deny(res, "Only an Owner, Admin or Team lead drafts the weekly review.");
    const r = await okr.generate(w, { by: by(req), refresh: !!req.body?.refresh });
    if (r.busy) return res.status(409).json({ detail: "This week's review is being drafted. Try again in a minute." });
    if (!r.created && r.wbr?.status !== "draft") return res.status(409).json({ detail: "This week's review was already marked reviewed." });
    res.status(r.created ? 201 : 200).json(wbrView(req, r.wbr));
  });
  app.put(`${P}/wbr/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = wbrOf(req, res, w, true); if (!r) return;
    if (!manager(req)) return deny(res, "Only an Owner, Admin or Team lead edits the narrative. Add a comment instead.");
    if (redactData(r.data, req.perms, needModule).hidden.size) return deny(res, "You can't see every row of this review, so you can't edit its narrative. Add a comment instead.");
    const text = String(req.body?.narrative ?? "").slice(0, 20000);
    if (!text.trim()) return res.status(422).json({ detail: "The narrative can't be empty." });
    const c = checkNarrative(text, r.data);
    if (c.unknown.length) return res.status(422).json({ detail: `The narrative cites rows that aren't in this review: ${c.unknown.join(", ")}.` });
    res.json(wbrView(req, store.updateOps(COLL.wbrs, w.id, r.id, { narrative: text, issues: c.issues, edited_by: by(req) })));
  });
  app.post(`${P}/wbr/:id/factual`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = wbrOf(req, res, w, true); if (!r) return;
    if (!manager(req)) return deny(res, "Only an Owner, Admin or Team lead changes the narrative.");
    if (r.by_ai) outcome(w.id, "rejected", `WBR ${r.week_start}: AI narrative replaced by the factual summary by ${by(req)}`);
    const text = ruleNarrative(r.data);
    res.json(wbrView(req, store.updateOps(COLL.wbrs, w.id, r.id, { narrative: text, original: text, by_ai: false, issues: checkNarrative(text, r.data).issues, note: "Factual summary built from the rows (the AI narrative was set aside)." })));
  });
  app.post(`${P}/wbr/:id/comments`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = wbrOf(req, res, w, true); if (!r) return;
    const section = String(req.body?.section || ""), text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!SECTION_IDS.includes(section)) return res.status(422).json({ detail: `section must be one of ${SECTION_IDS.join(", ")}` });
    if (!text) return res.status(422).json({ detail: "Write the comment." });
    const comments = [...(r.comments || []), { id: store.newId(), section, text, by: by(req), by_id: req.user.id, at: new Date(now()).toISOString() }];
    res.status(201).json(wbrView(req, store.updateOps(COLL.wbrs, w.id, r.id, { comments })));
  });
  app.post(`${P}/wbr/:id/review`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = wbrOf(req, res, w, true); if (!r) return;
    if (!reviewer(req)) return deny(res, "Only an Owner or Admin marks the weekly review reviewed.");
    const edited = String(r.narrative).trim() !== String(r.original || "").trim();
    if (r.by_ai) outcome(w.id, edited ? "edited" : "accepted", `WBR ${r.week_start}: reviewed ${edited ? "after edits" : "unchanged"} by ${by(req)}`);
    res.json(wbrView(req, store.updateOps(COLL.wbrs, w.id, r.id, { status: "reviewed", reviewed_by: by(req), reviewed_at: new Date(now()).toISOString(), edited })));
  });
  // Printable HTML (the browser's Print → Save as PDF), redacted like the page.
  app.get(`${P}/wbr/:id/print`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = wbrOf(req, res, w); if (!r) return;
    res.type("html").send(wbrHtml(wbrView(req, r), w));
  });
}

export function wbrHtml(v, w) {
  const d = v.data, pct = (x) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x}%`);
  const md = (t) => esc(t).split("\n").map((l) => (/^##\s+/.test(l) ? `<h3>${l.replace(/^##\s+/, "")}</h3>` : /^\s*[-*]\s+/.test(l) ? `<li${/^\s{2,}/.test(l) ? ' class="sub"' : ""}>${l.replace(/^\s*[-*]\s+/, "")}</li>` : l.trim() ? `<p>${l}</p>` : "")).join("\n");
  const comments = (s) => { const list = (v.comments || []).filter((c) => c.section === s); return list.length ? `<div class="cm">${list.map((c) => `<p><b>${esc(c.by)}</b> <span>${esc(c.at.slice(0, 10))}</span>: <span dir="auto">${esc(c.text)}</span></p>`).join("")}</div>` : ""; };
  const sec = (id, title, body) => `<section><h2>${esc(title)}</h2>${body}${comments(id)}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly business review · ${esc(d.week_start)}</title>
<style>body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#111;margin:24px auto;max-width:900px;padding:0 16px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:14px 0 4px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left;vertical-align:top}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#666}.cm{background:#f6f6f6;padding:6px 10px;margin-top:8px;border-radius:6px}.cm p{margin:2px 0}li.sub{margin-left:18px}
.badge{display:inline-block;padding:0 6px;border-radius:8px;background:#eee;font-size:12px}@media print{body{margin:0}a{color:inherit}}</style></head><body>
<h1>Weekly business review · ${esc(w.brief?.company_name || "DPA AD")}</h1><p class="muted">Week ${esc(d.from)} to ${esc(d.to)} · ${v.status === "reviewed" ? `Reviewed by ${esc(v.reviewed_by)} on ${esc(String(v.reviewed_at).slice(0, 10))}` : "Draft, not reviewed yet"}${v.partial ? " · some rows are hidden for your role" : ""}</p>
${sec("metrics", "Metrics", `<table><thead><tr><th>Ref</th><th>Metric</th><th class="n">This week</th><th class="n">Last week</th><th class="n">Change</th><th class="n">4-week avg</th></tr></thead><tbody>${d.metrics.map((m) => `<tr><td>${m.ref}</td><td>${esc(m.name)}</td><td class="n">${esc(fmtVal(m.this_week, m.unit))}</td><td class="n">${esc(fmtVal(m.last_week, m.unit))}</td><td class="n">${esc(pct(m.change_pct))}</td><td class="n">${esc(fmtVal(m.avg_4w, m.unit))}</td></tr>`).join("")}</tbody></table>`)}
${sec("okrs", "Goals", d.okrs.length ? d.okrs.map((o) => `<h3>${esc(o.title)} <span class="badge">${o.progress == null ? "–" : esc(o.progress) + "%"}</span> <span class="muted">[${o.ref}]</span></h3><table><tbody>${o.krs.map((k) => `<tr><td>${k.ref}</td><td dir="auto">${esc(k.title)}</td><td>${k.hidden ? '<span class="muted">hidden for your role</span>' : `${esc(fmtVal(k.current, k.unit))} of ${esc(fmtVal(k.target, k.unit))}`}</td><td class="n">${k.hidden || k.progress == null ? "–" : esc(k.progress) + "%"}</td><td>${esc(String(k.confidence).replace("_", " "))}</td><td>${esc(k.owner_name || "")}</td></tr>`).join("")}</tbody></table>`).join("") + (d.okr_changes.length ? `<h3>Changes this week</h3><ul>${d.okr_changes.map((c) => `<li>[${c.ref}] ${esc(c.objective)}${c.kr ? " · " + esc(c.kr) : ""}: ${esc(c.text)}</li>`).join("")}</ul>` : "") : `<p class="muted">No active objectives.</p>`)}
${sec("needs", "Needs attention", d.needs.length ? `<ul>${d.needs.map((n) => `<li>[${n.ref}] <b>${esc(n.title)}</b> · ${esc(n.module)}: ${esc(n.text)}</li>`).join("")}</ul>` : `<p class="muted">Nothing waiting.</p>`)}
${d.winloss ? sec("winloss", "Wins and losses", d.winloss.length ? `<ul>${d.winloss.map((x) => `<li>[${x.ref}] ${x.outcome === "won" ? "Won" : "Lost"} <span dir="auto">${esc(x.name)}</span>: ${esc(x.reason || "[ADD] reason")}${x.competitor ? " · " + esc(x.competitor) : ""}</li>`).join("")}</ul>` : `<p class="muted">No deals won or lost this week.</p>`) : ""}
${d.incidents ? sec("incidents", "Incidents", d.incidents.length ? `<ul>${d.incidents.map((i) => `<li>[${i.ref}] ${esc(i.severity)} ${esc(i.title)} (${esc(i.status)})${i.impact ? ": " + esc(i.impact) : ""}</li>`).join("")}</ul>` : `<p class="muted">No incidents.</p>`) : ""}
${d.cash ? sec("cash", "Cash", `<p>[F1] Runway ${d.cash.runway_months == null ? "–" : esc(d.cash.runway_months) + " months"} · cash SAR ${esc(Number(d.cash.cash_sar || 0).toLocaleString("en-US"))}${d.cash.cash_as_of ? ` (as of ${esc(d.cash.cash_as_of)})` : ""} · net burn SAR ${esc(Number(d.cash.net_burn_sar || 0).toLocaleString("en-US"))}/month</p>`) : ""}
${sec("narrative", "Chief of staff notes", `${v.by_ai ? '<p class="muted">Drafted by the AI Chief of staff from the rows above; every line cites its row.</p>' : ""}${md(v.narrative)}`)}
</body></html>`;
}

