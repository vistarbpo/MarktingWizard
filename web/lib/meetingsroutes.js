// HTTP routes for Meetings → tasks (module "meetings" in Teams & roles): /api/workspaces/:ws/meetings/...
// Investor and hiring meetings answer 404 to anyone who isn't Owner/Admin, an attendee or the creator.
// Creating an action item checks the person's Edit level on its home module (Operations, Sales, Store CRM,
// Customer success, Team & hiring, Goals & review) and writes through that module's own store functions,
// with a link back to the meeting. The follow-up email goes only through the Store CRM's sendOne(), so its
// Test mode, opt-outs, do-not-contact and sample-store rules apply; it is only sent 09:00–21:00 Riyadh, not Friday.
import { levelOk } from "./access.js";
import { inWindow } from "./crm.js";
import { AGENT_ID, COLL, LINK_KEYS, MANAGER_ROLES, NOTES_MAX, REVIEW_DAYS, RESTRICTED, TARGETS, TARGET_IDS, TYPES,
  canSee, cleanMeeting, ensureMeetings, isExternal, itemView, myItems, notesFromFile, people, startsAt, todayOf } from "./meetings.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

export function mountMeetings(app, { store, crm = null, outreach = null, success = null, meetings }) {
  ensureMeetings(store);
  const P = "/api/workspaces/:ws/meetings";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => meetings.now();
  const can = (req, mod, lvl = "view") => levelOk(req.perms?.[mod], lvl);
  const outcome = (ws, o, note) => app.locals.workforce?.event(AGENT_ID, ws, o, note);
  const get = (req, res, w) => {
    const m = store.getOps(COLL.meetings, w.id, req.params.id);
    if (!m || !canSee(req.user, m)) { res.status(404).json({ detail: "Meeting not found" }); return null; }
    return m;
  };
  // Labels of linked records, only for modules the person can view.
  const linkInfo = (req, w, m) => {
    const l = m.links || {}, out = {};
    if (l.deal_id) { const d = store.getDeal(w.id, l.deal_id); out.deal = can(req, "sales") ? (d ? { id: d.id, label: d.name, route: "pipeline" } : { id: l.deal_id, label: "Deal removed", missing: true }) : { id: l.deal_id, hidden: true }; }
    if (l.store_id) { const c = crm?.get(w.id, l.store_id); out.store = can(req, "crm") ? (c ? { id: c.id, label: c.store_name || c.domain, route: "crm", email: !!c.email, sample: !!c.sample } : { id: l.store_id, label: "Store removed", missing: true }) : { id: l.store_id, hidden: true }; }
    if (l.customer_id) { const c = (store.db.billing_customers || []).find((x) => x.workspace_id === w.id && x.id === l.customer_id); out.customer = can(req, "success") || can(req, "billing") ? (c ? { id: c.id, label: c.store_name, route: can(req, "success") ? "success" : "billing" } : { id: l.customer_id, label: "Customer removed", missing: true }) : { id: l.customer_id, hidden: true }; }
    if (l.candidate_id) { const c = store.getHrCandidate(w.id, l.candidate_id); out.candidate = can(req, "team") ? (c ? { id: c.id, label: c.name, route: "team" } : { id: l.candidate_id, label: "Candidate removed", missing: true }) : { id: l.candidate_id, hidden: true }; }
    return out;
  };
  const checkLinks = (req, w, links) => {
    if (!links) return null;
    if (links.deal_id && (!can(req, "sales") || !store.getDeal(w.id, links.deal_id))) return "Unknown deal (or you can't see Sales).";
    if (links.store_id && (!can(req, "crm") || !crm?.get(w.id, links.store_id))) return "Unknown Store CRM store (or you can't see the Store CRM).";
    if (links.customer_id && (!(can(req, "success") || can(req, "billing")) || !(store.db.billing_customers || []).some((x) => x.workspace_id === w.id && x.id === links.customer_id))) return "Unknown customer (or you can't see Billing or Customer success).";
    if (links.candidate_id && (!can(req, "team") || !store.getHrCandidate(w.id, links.candidate_id))) return "Unknown candidate (or you can't see Team & hiring).";
    return null;
  };
  const items = (w, m) => store.listOps(COLL.items, w.id).filter((it) => it.meeting_id === m.id).map((it) => itemView(store, it));
  const summary = (m) => ({ id: m.id, title: m.title, date: m.date, time: m.time, type: m.type, restricted: RESTRICTED.includes(m.type), sample: !!m.sample,
    attendees: (m.attendees || []).map((a) => a.name), has_notes: !!m.notes, notes_chars: (m.notes || "").length,
    draft_status: m.draft ? m.draft.status : null, draft_items: m.draft?.items?.length || 0, waiting_review: !!(m.notes && m.notes_at && m.draft?.status !== "reviewed" && Date.parse(m.notes_at) < now() - REVIEW_DAYS * 864e5) });
  const view = (req, w, m) => ({ ...m, starts_at: m.starts_at, restricted: RESTRICTED.includes(m.type), external: isExternal(m), link_info: linkInfo(req, w, m), items: items(w, m),
    can_edit: can(req, "meetings", "edit"), agent_level: meetings.level() });

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const opts = {};
    if (can(req, "sales")) opts.deals = store.listDeals(w.id).map((d) => ({ id: d.id, label: d.name, stage: d.stage }));
    if (can(req, "success") || can(req, "billing")) opts.customers = (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && !c.archived).map((c) => ({ id: c.id, label: c.store_name }));
    if (can(req, "team")) opts.candidates = store.listHrCandidates(w.id).map((c) => ({ id: c.id, label: c.name }));
    if (can(req, "okr")) { const objs = new Map(store.listOps("okr_objectives", w.id).filter((o) => o.status === "active").map((o) => [o.id, o])); opts.krs = (store.db.okr_krs || []).filter((k) => k.workspace_id === w.id && objs.has(k.objective_id)).map((k) => ({ id: k.id, label: `${objs.get(k.objective_id).title.slice(0, 50)} · ${k.title}`.slice(0, 140) })); }
    opts.stores = can(req, "crm");
    res.json({ types: TYPES, restricted: RESTRICTED, targets: TARGETS.map((t) => ({ ...t, allowed: can(req, t.module, "edit") })), people: people(store).map(({ id, name }) => ({ id, name })), options: opts,
      me: { id: req.user.id, role_id: req.user.role_id, edit: can(req, "meetings", "edit") }, notes_max: NOTES_MAX, review_days: REVIEW_DAYS, today: todayOf(now()), agent_level: meetings.level() });
  });
  // Store CRM search for the link picker (the CRM can hold tens of thousands of stores).
  app.get(`${P}/stores`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!can(req, "crm")) return res.status(403).json({ detail: "Your role can't see the Store CRM." });
    const q = str(req.query.q, 80).toLowerCase();
    const list = (crm?.contacts(w.id) || []).filter((c) => !q || `${c.store_name} ${c.domain} ${c.email}`.toLowerCase().includes(q)).slice(0, 20);
    res.json({ stores: list.map((c) => ({ id: c.id, label: c.store_name || c.domain, domain: c.domain || "" })) });
  });

  // ---- my action items (before /:id)
  app.get(`${P}/my-items`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json(myItems(store, w, req.user, now()));
  });
  app.put(`${P}/items/:itemId`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const it = store.getOps(COLL.items, w.id, req.params.itemId); if (!it) return res.status(404).json({ detail: "Action item not found" });
    const m = store.getOps(COLL.meetings, w.id, it.meeting_id);
    if (!(it.owner_id === req.user.id || MANAGER_ROLES.includes(req.user.role_id) || (m && canSee(req.user, m) && m.created_by_id === req.user.id))) return res.status(403).json({ detail: "Only the item's owner, the meeting's creator or an Owner, Admin or Team lead changes it." });
    const b = req.body || {}, f = {};
    if (b.status !== undefined) { if (!["open", "done"].includes(b.status)) return res.status(422).json({ detail: "status must be open or done" }); f.status = b.status; f.done_at = b.status === "done" ? new Date(now()).toISOString() : null; }
    if (b.due !== undefined) { if (b.due && !isDate(b.due)) return res.status(422).json({ detail: "due must be YYYY-MM-DD" }); f.due = b.due || null; }
    res.json(itemView(store, store.updateOps(COLL.items, w.id, it.id, f)));
  });

  // ---- meetings
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    let list = store.listOps(COLL.meetings, w.id).filter((m) => canSee(req.user, m));
    if (req.query.type) list = list.filter((m) => m.type === req.query.type);
    const days = Number(req.query.days);
    if (days > 0) { const from = todayOf(now() - days * 864e5); list = list.filter((m) => m.date >= from); }
    list.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    res.json({ meetings: list.map(summary), today: todayOf(now()) });
  });
  app.post(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {};
    const { out, err } = cleanMeeting(b, { store });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const bad = checkLinks(req, w, out.links); if (bad) return res.status(422).json({ detail: bad });
    let notes = "";
    if (b.notes !== undefined) { notes = String(b.notes || "").replace(/\r\n?/g, "\n"); if (notes.length > NOTES_MAX) return res.status(413).json({ detail: `Notes are limited to ${NOTES_MAX / 1000} KB of text.` }); }
    const at = new Date(now()).toISOString();
    const m = store.addOps(COLL.meetings, w.id, { duration_min: 30, agenda: "", attendees: [], links: Object.fromEntries(LINK_KEYS.map((k) => [k, null])), ...out, starts_at: startsAt(out.date, out.time),
      notes, notes_source: notes ? (req.headers["x-mwiz-via"] === "assistant" ? "assistant" : "paste") : "", notes_at: notes ? at : null, draft: null, followup: null, created_by: by(req), created_by_id: req.user.id });
    res.status(201).json(view(req, w, m));
  });
  app.get(`${P}/:id`, (req, res) => { const w = W(req, res); if (!w) return; const m = get(req, res, w); if (m) res.json(view(req, w, m)); });
  app.put(`${P}/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    const { out, err } = cleanMeeting(req.body || {}, { store, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.links) { const changed = Object.fromEntries(LINK_KEYS.filter((k) => out.links[k] && out.links[k] !== m.links?.[k]).map((k) => [k, out.links[k]])); const bad = checkLinks(req, w, changed); if (bad) return res.status(422).json({ detail: bad }); }
    const next = { ...m, ...out };
    if (RESTRICTED.includes(next.type) && !canSee(req.user, next)) return res.status(422).json({ detail: "You'd lose access to this meeting: add yourself as an attendee first." });
    res.json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { ...out, starts_at: startsAt(next.date, next.time) })));
  });
  app.delete(`${P}/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    store.db[COLL.items] = store.db[COLL.items].filter((it) => !(it.workspace_id === w.id && it.meeting_id === m.id)); // created tasks, notes and alerts stay in their modules
    store.deleteOps(COLL.meetings, w.id, m.id);
    res.status(204).end();
  });

  // ---- notes in (paste or file). Replaces the notes unless `append` is set.
  app.post(`${P}/:id/notes`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    const b = req.body || {};
    let text, source = req.headers["x-mwiz-via"] === "assistant" ? "assistant" : "paste";
    if (b.filename) {
      const r = notesFromFile(String(b.filename), { text: b.text ?? null, b64: b.file_b64 ?? null });
      if (r.error) return res.status(422).json({ detail: r.error });
      text = r.text; source = `file:${str(b.filename, 120)}`;
    } else text = String(b.text ?? "").replace(/\r\n?/g, "\n");
    const all = b.append && m.notes ? `${m.notes}\n\n${text}` : text;
    if (!all.trim()) return res.status(422).json({ detail: "The notes are empty." });
    if (all.length > NOTES_MAX) return res.status(413).json({ detail: `Notes are limited to ${NOTES_MAX / 1000} KB of text (this is ${Math.ceil(all.length / 1000)} KB). Trim the transcript or split the meeting.` });
    res.json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { notes: all, notes_source: source, notes_at: new Date(now()).toISOString() })));
  });

  // ---- the draft
  app.post(`${P}/:id/draft`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.notes?.trim()) return res.status(422).json({ detail: "Add the notes or transcript first." });
    if (m.draft?.status === "reviewed" && !req.body?.force) return res.status(409).json({ detail: "This draft was reviewed and its items created. Send force to draft again." });
    const d = await meetings.draft(w, m, by(req));
    res.status(201).json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { draft: d })));
  });
  const cleanItemEdit = (w, m, src, cur) => {
    const f = {}, err = [];
    if (src.text !== undefined) { f.text = str(src.text, 300); if (!f.text) err.push("An action item needs its text."); }
    if (src.owner_id !== undefined) { if (!src.owner_id) { f.owner_id = null; f.owner_name = ""; } else { const p = people(store).find((x) => x.id === String(src.owner_id)); if (!p) err.push("Unknown owner"); else { f.owner_id = p.id; f.owner_name = p.name; } } }
    if (src.due !== undefined) { if (src.due && !isDate(src.due)) err.push("due must be YYYY-MM-DD"); else f.due = src.due || null; }
    if (src.target !== undefined) { if (!TARGET_IDS.includes(src.target)) err.push(`module must be one of ${TARGET_IDS.join(", ")}`); else f.target = src.target; }
    if (src.kr_id !== undefined) f.kr_id = src.kr_id ? String(src.kr_id) : null;
    return { f, err };
  };
  app.put(`${P}/:id/draft`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.draft) return res.status(404).json({ detail: "Draft the action items first." });
    const b = req.body || {}, d = { ...m.draft };
    if (b.summary !== undefined) d.summary = String(b.summary).slice(0, 4000);
    for (const k of ["decisions", "questions"]) if (b[k] !== undefined) d[k] = (Array.isArray(b[k]) ? b[k] : String(b[k]).split("\n")).map((x) => str(x, 300)).filter(Boolean).slice(0, 20);
    if (Array.isArray(b.items)) {
      const next = [];
      for (const src of b.items.slice(0, 60)) {
        const cur = d.items.find((x) => x.id === String(src.id));
        if (cur?.state === "created") { next.push(cur); continue; }
        const { f, err } = cleanItemEdit(w, m, src, cur);
        if (err.length) return res.status(422).json({ detail: err.join("; ") });
        next.push(cur ? { ...cur, ...f } : { id: store.newId(), text: "", owner_id: null, owner_name: "", due: null, target: "ops", kr_id: null, source: "", state: "draft", added: true, ...f });
        if (!next.at(-1).text) return res.status(422).json({ detail: "An action item needs its text." });
      }
      for (const cur of d.items) if (cur.state === "created" && !next.some((x) => x.id === cur.id)) next.push(cur); // created items can't be dropped
      d.items = next;
    }
    d.edited_by = by(req);
    res.json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { draft: d })));
  });

  // ---- review then create: each ticked item goes to its home module, if the person may edit it there.
  const linkBack = (m) => `From meeting "${m.title.slice(0, 120)}" on ${m.date} (Meetings #${m.id})`;
  function createOne(req, w, m, it) {
    const def = TARGETS.find((t) => t.id === it.target);
    if (!def) return { error: "Unknown module" };
    if (!can(req, def.module, "edit")) return { error: `Your role can't change ${def.name.replace(/ \(.*$/, "")}: ask someone who can, or send it to Operations.`, status: 403 };
    const owner = it.owner_name || "", due = it.due || null, text = it.text, tail = `${owner ? ` · Owner: ${owner}` : ""}${due ? ` · Due ${due}` : ""}`;
    const sample = m.sample ? { sample: true } : {};
    if (def.id === "ops") {
      const t = store.addOps("ops_tasks", w.id, { title: text.slice(0, 200), owner_kind: "human", owner, area: "Operations", priority: 2, due, notes: linkBack(m), status: "todo", source: "meeting", meeting_id: m.id, meeting_item_id: it.id, ...sample }, false);
      return { ref_id: t.id, ref_label: `Operations task #${t.id}` };
    }
    if (def.id === "deal") {
      const d = m.links?.deal_id && store.getDeal(w.id, m.links.deal_id);
      if (!d) return { error: "This meeting isn't linked to a deal (or the deal was removed)." };
      store.updateDeal(w.id, d.id, { next_step: { text, due, owner_id: it.owner_id || null, owner_name: owner, meeting_id: m.id, set_at: new Date(now()).toISOString(), done: false }, by: by(req) });
      const a = store.addDealActivity(d.id, { type: "note", by: by(req), text: `Next action: ${text}${tail}\n${linkBack(m)}` }, false);
      a.meeting_id = m.id;
      return { ref_id: d.id, ref_label: `Next action on ${d.name}` };
    }
    if (def.id === "crm") {
      const c = m.links?.store_id && crm?.get(w.id, m.links.store_id);
      if (!c) return { error: "This meeting isn't linked to a Store CRM store (or it was removed)." };
      const n = crm.addNote(w.id, c.id, `${text}${tail}\n${linkBack(m)}`, by(req));
      n.meeting_id = m.id; crm.save();
      return { ref_id: c.id, ref_label: `Note on ${c.store_name || c.domain}` };
    }
    if (def.id === "success") {
      const c = m.links?.customer_id && (store.db.billing_customers || []).find((x) => x.workspace_id === w.id && x.id === m.links.customer_id);
      if (!c || !success) return { error: "This meeting isn't linked to a customer (or it was removed)." };
      const r = success.raise(w, c, { type: "meeting_action", key: `meeting|${it.id}`, reason: `${text}${tail} · ${linkBack(m)}`.slice(0, 600) }, todayOf(now()), { meeting_id: m.id, due, ...(it.owner_id ? { owner_id: it.owner_id } : {}) });
      if (!r.alert) return { error: "Customer Success already has this item." };
      return { ref_id: r.alert.id, ref_label: `Success task for ${c.store_name}` };
    }
    if (def.id === "hiring") {
      const c = m.links?.candidate_id && store.getHrCandidate(w.id, m.links.candidate_id);
      if (!c) return { error: "This meeting isn't linked to a candidate (or the candidate was removed)." };
      const a = store.addHrActivity(w.id, "candidate", c.id, { type: "note", by: by(req), text: `${text}${tail}\n${linkBack(m)}` }, false);
      a.meeting_id = m.id;
      return { ref_id: c.id, ref_label: `Note on candidate ${c.name}` };
    }
    if (def.id === "okr") {
      const k = it.kr_id && (store.db.okr_krs || []).find((x) => x.workspace_id === w.id && x.id === String(it.kr_id));
      if (!k) return { error: "Pick the key result this note is for." };
      const o = store.getOps("okr_objectives", w.id, k.objective_id);
      if (!o || o.status !== "active") return { error: "That key result's objective isn't active." };
      if (!(MANAGER_ROLES.includes(req.user.role_id) || k.owner_id === req.user.id)) return { error: "You can add notes only to key results you own (or ask an Owner, Admin or Team lead).", status: 403 };
      store.addOps("okr_log", w.id, { objective_id: o.id, kr_id: k.id, kind: "note", from: null, to: null, text: `Note: ${text}${tail} · ${linkBack(m)}`.slice(0, 600), by: by(req), meeting_id: m.id }, false);
      return { ref_id: k.id, ref_label: `Note on key result ${k.title.slice(0, 60)}` };
    }
    return { error: "Unknown module" };
  }
  app.post(`${P}/:id/create`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.draft) return res.status(404).json({ detail: "Draft the action items first." });
    const b = req.body || {}, edits = Array.isArray(b.items) ? b.items : [];
    const d = { ...m.draft, items: m.draft.items.map((x) => ({ ...x })) };
    const results = [];
    for (const src of edits.slice(0, 60)) {
      const it = d.items.find((x) => x.id === String(src.id));
      if (!it) { results.push({ id: String(src.id), ok: false, error: "Not in this draft" }); continue; }
      if (it.state === "created") { results.push({ id: it.id, ok: false, error: "Already created" }); continue; }
      const { f, err } = cleanItemEdit(w, m, src, it);
      if (err.length) { results.push({ id: it.id, ok: false, error: err.join("; ") }); continue; }
      Object.assign(it, f);
      if (src.selected === false) { it.state = "skipped"; results.push({ id: it.id, ok: true, skipped: true }); continue; }
      const r = createOne(req, w, m, it);
      if (r.error) { results.push({ id: it.id, ok: false, error: r.error, status: r.status || 422 }); continue; }
      const def = TARGETS.find((t) => t.id === it.target);
      const row = store.addOps(COLL.items, w.id, { meeting_id: m.id, meeting_title: m.title, draft_item_id: it.id, text: it.text, owner_id: it.owner_id || null, owner_name: it.owner_name || "", due: it.due || null,
        target: it.target, module: def.module, route: def.route, ref_id: r.ref_id, ref_label: r.ref_label, status: "open", created_by: by(req), created_by_id: req.user.id, ...(m.sample ? { sample: true } : {}) }, false);
      Object.assign(it, { state: "created", created_item_id: row.id, ref_label: r.ref_label, route: def.route });
      results.push({ id: it.id, ok: true, item_id: row.id, ref_label: r.ref_label, route: def.route });
    }
    const pending = d.items.filter((x) => x.state === "draft");
    if (!pending.length && d.status !== "reviewed") {
      d.status = "reviewed"; d.reviewed_at = new Date(now()).toISOString(); d.reviewed_by = by(req);
      if (d.by_ai) {
        const created = d.items.filter((x) => x.state === "created");
        const orig = new Map((d.original || []).map((o) => [o.id, o]));
        const changed = d.items.some((x) => { const o = orig.get(x.id); return !o || x.state === "skipped" || o.text !== x.text || (o.owner_id || null) !== (x.owner_id || null) || (o.due || null) !== (x.due || null) || o.target !== x.target; });
        outcome(w.id, !created.length && d.items.length ? "rejected" : changed ? "edited" : "accepted", `Meeting "${m.title.slice(0, 60)}": ${created.length} of ${d.items.length} items created by ${by(req)}`);
      }
    }
    store.updateOps(COLL.meetings, w.id, m.id, { draft: d });
    res.json({ created: results.filter((r) => r.ok && !r.skipped).length, refused: results.filter((r) => !r.ok), results, meeting: view(req, w, m) });
  });
  // Mark reviewed without creating anything (nothing to act on).
  app.post(`${P}/:id/review`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.draft) return res.status(404).json({ detail: "Draft the action items first." });
    const d = { ...m.draft, items: m.draft.items.map((x) => (x.state === "draft" ? { ...x, state: "skipped" } : x)), status: "reviewed", reviewed_at: new Date(now()).toISOString(), reviewed_by: by(req) };
    if (m.draft.by_ai && m.draft.status !== "reviewed") outcome(w.id, d.items.some((x) => x.state === "created") ? "edited" : d.items.length ? "rejected" : "accepted", `Meeting "${m.title.slice(0, 60)}": reviewed by ${by(req)}`);
    res.json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { draft: d })));
  });

  // ---- follow-up email for outside attendees: drafted only; sent only through the Store CRM.
  app.post(`${P}/:id/followup`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!isExternal(m)) return res.status(422).json({ detail: "Follow-up emails are for meetings with people outside DPA AD." });
    const f = await meetings.followup(w, m);
    res.status(201).json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { followup: { ...f, at: new Date(now()).toISOString(), by: by(req), sent: m.followup?.sent || null } })));
  });
  app.put(`${P}/:id/followup`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.followup) return res.status(404).json({ detail: "Draft the follow-up first." });
    const b = req.body || {};
    const f = { ...m.followup, ...(b.subject !== undefined ? { subject: str(b.subject, 200) } : {}), ...(b.body !== undefined ? { body: String(b.body).slice(0, 6000) } : {}), edited_by: by(req) };
    res.json(view(req, w, store.updateOps(COLL.meetings, w.id, m.id, { followup: f })));
  });
  app.post(`${P}/:id/followup/send`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = get(req, res, w); if (!m) return;
    if (!m.followup) return res.status(404).json({ detail: "Draft the follow-up first." });
    if (!can(req, "crm", "edit")) return res.status(403).json({ detail: "Sending goes through the Store CRM: your role can't send there. Copy the email instead." });
    const c = m.links?.store_id && crm?.get(w.id, m.links.store_id);
    if (!c || !outreach) return res.status(422).json({ detail: "Link the meeting to a Store CRM store to send from the CRM, or copy the email and send it yourself." });
    const subject = str(req.body?.subject ?? m.followup.subject, 200), body = String(req.body?.body ?? m.followup.body).slice(0, 6000);
    if (!body.trim()) return res.status(422).json({ detail: "The email is empty." });
    if (/\[ADD/.test(`${subject} ${body}`)) return res.status(422).json({ detail: "Fill in every [ADD] before sending." });
    const live = outreach.settings(w.id).mode === "live" && !c.sample;
    if (live && !inWindow(new Date(now()), { from: 9, to: 21, skip_friday: true })) return res.status(422).json({ detail: "Emails go out only 09:00–21:00 Riyadh time, not Friday. Send it then." });
    const msg = await outreach.sendOne(w.id, c, { channel: "email", subject, body, by: by(req) });
    const sent = { status: msg.status, message_id: msg.id, error: msg.error || "", at: new Date(now()).toISOString(), by: by(req) };
    store.updateOps(COLL.meetings, w.id, m.id, { followup: { ...m.followup, subject, body, sent } });
    res.status(msg.status === "skipped" || msg.status === "failed" ? 422 : 201).json({ ...(msg.status === "skipped" || msg.status === "failed" ? { detail: msg.error } : {}), message: { id: msg.id, status: msg.status, error: msg.error || "" }, meeting: view(req, w, store.getOps(COLL.meetings, w.id, m.id)) });
  });
}
