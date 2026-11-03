// HTTP routes for Legal & company documents (module "legal"): /api/workspaces/:ws/legal/...
// Restricted documents answer 404 to anyone who isn't Owner/Admin, on every route (details, file, print, summary,
// obligations, signatures). Files come only from DATA_DIR/legal through these routes, never from /media/, and every
// download or print is written to the audit log. Self-service: /api/me/legal/:ws/documents/:id/file lets an employee
// download their own signed employment contract (the list is in /api/me/people/:ws).
import fs from "node:fs";
import { levelOk } from "./access.js";
import { CONFIDENTIALITY, COLL, FIELD_LABELS, LIVE, MANUAL_FIELDS, MAX_FILE, NOT_ADVICE, NOT_ADVICE_AR, OBL_KINDS, REPEATS, RESTRICTED_BY_DEFAULT, SIGNABLE, SIGN_METHODS, STATUSES, SUMMARY_FIELDS, TEMPLATES, TEXT_MAX, TYPES, UPLOAD_EXTS,
  AGENT_ID, canSee, canSeeRestricted, cleanDoc, cleanObligation, cleanSettings, currentVersion, docDates, dueItems, ensureLegal, fieldValues, fillTemplate, isDate, legalPath, myEmploymentDocs, nextDue, people,
  removeDocFiles, renderHtml, saveLegalUpload, settingsOf, signBlock, templateById, textOfVersion, todayOf, writeLegalFile } from "./legal.js";
import { publicBase } from "./media.js";
import { PLANS } from "./sales.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const fmtAddr = (a) => (a && (a.city || a.street) ? [a.building, a.street, a.district, a.city, a.postal_code, a.country].filter(Boolean).join(", ") : "");
const safeName = (s) => String(s || "document").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "document";

export function mountLegal(app, { store, crm = null, legal, env = process.env }) {
  ensureLegal(store);
  const P = "/api/workspaces/:ws/legal";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => legal.now();
  const can = (req, mod, lvl = "view") => levelOk(req.perms?.[mod], lvl);
  const outcome = (ws, o, note) => app.locals.workforce?.event(AGENT_ID, ws, o, note);
  const get = (req, res, w, id = req.params.id) => {
    const d = store.getOps(COLL.docs, w.id, id);
    if (!d || !canSee(req.user, d)) { res.status(404).json({ detail: "Document not found" }); return null; }
    return d;
  };
  const log = (d, req, text) => { (d.log ||= []).push({ at: new Date(now()).toISOString(), by: by(req), text: String(text).slice(0, 300) }); };
  const nameOf = (id) => (id ? people(store).find((p) => p.id === id)?.name || "Removed person" : "");
  const obligationsOf = (w, d) => store.listOps(COLL.obligations, w.id).filter((o) => o.document_id === d.id).sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
  const versionView = (w, d, v) => ({ n: v.n, ext: v.ext, name: v.name, size: v.size, kind: v.kind, template_id: v.template_id || null, placeholders: v.placeholders || null, uploaded_at: v.uploaded_at, uploaded_by: v.uploaded_by, note: v.note || "", sha256: v.sha256,
    file_url: `/api/workspaces/${w.id}/legal/documents/${d.id}/file?v=${v.n}`, print_url: v.ext === "html" ? `/api/workspaces/${w.id}/legal/documents/${d.id}/print?v=${v.n}` : null });
  const listView = (w, d, today, s) => {
    const v = currentVersion(d);
    return { id: d.id, title: d.title, type: d.type, status: d.status, confidentiality: d.confidentiality, parties: (d.parties || []).map((p) => p.name || p.email), issue_date: d.issue_date, expiry_date: d.expiry_date,
      auto_renew: !!d.auto_renew, notice_days: d.notice_days || 0, owner_id: d.owner_id, owner_name: nameOf(d.owner_id), dates: docDates(d, today, s), versions: (d.versions || []).length,
      current: v ? { n: v.n, ext: v.ext, kind: v.kind, placeholders: v.placeholders || null } : null, signatures: (d.signatures || []).length, tags: d.tags || [], sample: !!d.sample,
      open_obligations: store.listOps(COLL.obligations, w.id).filter((o) => o.document_id === d.id && o.status !== "done").length, reference: d.reference || "" };
  };
  const view = (req, w, d) => {
    const today = todayOf(now()), s = settingsOf(w);
    return { ...listView(w, d, today, s), parties: d.parties || [], counterparty: d.counterparty || null, employee_id: d.employee_id || null, renewal_term_months: d.renewal_term_months || 0, payment_terms: d.payment_terms || "", notes: d.notes || "",
      versions: (d.versions || []).map((v) => versionView(w, d, v)).reverse(), current_version: d.current_version, signatures: d.signatures || [], obligations: obligationsOf(w, d).map((o) => ({ ...o, owner_name: nameOf(o.owner_id) })),
      summary: d.summary || null, suggestions: d.suggestions || [], log: d.log || [], sign_block: signBlock(d), signable: SIGNABLE.includes(d.type),
      can_edit: can(req, "legal", "edit"), can_delete: can(req, "legal", "edit") && (!retained(d) || req.user.role_id === "owner"), agent_level: legal.level(), created_at: d.created_at, created_by: d.created_by };
  };
  const retained = (d) => LIVE.includes(d.status) || ["expired", "terminated"].includes(d.status) || (d.signatures || []).length > 0;
  const audit = (req, d, v, what) => store.logAudit({ user_id: req.user.id, user_name: req.user.name, method: "GET", path: req.path.slice(0, 200), module: "legal", summary: `${what} legal document "${d.title.slice(0, 60)}" v${v.n}` });
  const sendFile = (req, res, d, v, { inline = false } = {}) => {
    const p = legalPath(store, v.file);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ detail: "File missing on the server" });
    audit(req, d, v, inline ? "viewed" : "downloaded");
    const viewable = inline && ["pdf", "png", "jpg"].includes(v.ext);
    res.set({ "Content-Type": v.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Content-Disposition": `${viewable ? "inline" : "attachment"}; filename="${safeName(v.name)}"` });
    fs.createReadStream(p).pipe(res);
  };

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json({ types: TYPES, statuses: STATUSES, confidentiality: CONFIDENTIALITY, obligation_kinds: OBL_KINDS, repeats: REPEATS, sign_methods: SIGN_METHODS, signable: SIGNABLE, restricted_by_default: RESTRICTED_BY_DEFAULT,
      summary_fields: SUMMARY_FIELDS, templates: TEMPLATES.map(({ body, ...t }) => t), field_labels: FIELD_LABELS, upload_exts: UPLOAD_EXTS, max_mb: MAX_FILE / 1048576, text_max: TEXT_MAX,
      people: people(store), settings: settingsOf(w), today: todayOf(now()), not_advice: NOT_ADVICE, not_advice_ar: NOT_ADVICE_AR, agent_level: legal.level(),
      me: { edit: can(req, "legal", "edit"), restricted: canSeeRestricted(req.user), owner: req.user.role_id === "owner" },
      sources: { store: can(req, "crm"), customer: can(req, "billing") || can(req, "success"), partner: can(req, "partners"), employee: can(req, "team"), payroll: can(req, "payroll") } });
  });

  // ---- documents
  app.get(`${P}/documents`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const today = todayOf(now()), s = settingsOf(w), q = str(req.query.q, 80).toLowerCase();
    let list = store.listOps(COLL.docs, w.id).filter((d) => canSee(req.user, d));
    if (req.query.type) list = list.filter((d) => d.type === String(req.query.type));
    if (req.query.status) list = list.filter((d) => d.status === String(req.query.status));
    if (q) list = list.filter((d) => `${d.title} ${(d.parties || []).map((p) => `${p.name} ${p.email}`).join(" ")} ${d.reference || ""} ${(d.tags || []).join(" ")}`.toLowerCase().includes(q));
    const rows = list.map((d) => listView(w, d, today, s));
    const state = String(req.query.state || "");
    const out = state ? rows.filter((r) => r.dates.state === state) : rows;
    out.sort((a, b) => (a.dates.renewal_date && LIVE.includes(a.status) ? a.dates.renewal_date : "9999").localeCompare(b.dates.renewal_date && LIVE.includes(b.status) ? b.dates.renewal_date : "9999") || String(b.issue_date || "").localeCompare(String(a.issue_date || "")) || a.title.localeCompare(b.title));
    res.json({ documents: out, totals: { all: rows.length, expiring: rows.filter((r) => r.dates.state === "expiring").length, expired: rows.filter((r) => r.dates.state === "expired").length, drafts: rows.filter((r) => ["draft", "in_review"].includes(r.status)).length, restricted: rows.filter((r) => r.confidentiality === "restricted").length }, today });
  });
  app.post(`${P}/documents`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {};
    const { o, err } = cleanDoc(b, { store, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (o.status === "signed" || (o.status === "active" && SIGNABLE.includes(o.type))) return res.status(422).json({ detail: "Add the document first, then record the signature with the signed file: it becomes signed then." });
    const conf = o.confidentiality || (RESTRICTED_BY_DEFAULT.includes(o.type) && canSeeRestricted(req.user) ? "restricted" : "normal");
    if (conf === "restricted" && !canSeeRestricted(req.user)) return res.status(403).json({ detail: "Only the Owner or an Admin can add a restricted document." });
    const d = store.addOps(COLL.docs, w.id, { parties: [], issue_date: null, expiry_date: null, auto_renew: false, renewal_term_months: 0, notice_days: 0, owner_id: req.user.id, employee_id: null, counterparty: null, payment_terms: "", reference: "", notes: "", tags: [],
      status: "draft", ...o, confidentiality: conf, versions: [], current_version: null, signatures: [], summary: null, suggestions: [], log: [], created_by: by(req) }, false);
    log(d, req, `Document added (${d.type}, ${d.status}${conf === "restricted" ? ", restricted" : ""})`);
    store.save();
    res.status(201).json(view(req, w, d));
  });
  app.get(`${P}/documents/:id`, (req, res) => { const w = W(req, res); if (!w) return; const d = get(req, res, w); if (d) res.json(view(req, w, d)); });
  app.put(`${P}/documents/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const { o, err } = cleanDoc(req.body || {}, { store, wsId: w.id, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const next = { ...d, ...o };
    if (next.issue_date && next.expiry_date && next.issue_date > next.expiry_date) return res.status(422).json({ detail: "expiry_date is before issue_date" });
    if (o.confidentiality && o.confidentiality !== d.confidentiality && !canSeeRestricted(req.user)) return res.status(403).json({ detail: "Only the Owner or an Admin can change a document's confidentiality." });
    if (o.status && o.status !== d.status && (o.status === "signed" || (o.status === "active" && SIGNABLE.includes(next.type)))) {
      const block = signBlock(next); if (block) return res.status(422).json({ detail: block });
    }
    const changes = Object.keys(o).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(d[k]));
    Object.assign(d, o, { updated_at: new Date(now()).toISOString() });
    if (changes.length) log(d, req, changes.map((k) => (k === "status" ? `status → ${o.status}` : k === "confidentiality" ? `confidentiality → ${o.confidentiality}` : `${k.replace(/_/g, " ")} edited`)).join(", "));
    store.save();
    res.json(view(req, w, d));
  });
  app.delete(`${P}/documents/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    if (retained(d) && req.user.role_id !== "owner") return res.status(409).json({ detail: "Signed, in-force, expired and terminated documents are kept for legal reasons. Only the Owner can delete one." });
    removeDocFiles(store, d);
    store.db[COLL.obligations] = store.db[COLL.obligations].filter((x) => !(x.workspace_id === w.id && x.document_id === d.id));
    store.deleteOps(COLL.docs, w.id, d.id);
    res.status(204).end();
  });

  // ---- versions and files
  app.post(`${P}/documents/:id/versions`, async (req, res) => {
    const w = W(req, res); if (!w) { req.resume(); return; }
    const d = get(req, res, w); if (!d) { req.resume(); return; }
    const q = req.query || {};
    const kind = q.kind === "signed" ? "signed" : "upload";
    try {
      const f = await saveLegalUpload(store, req, String(q.filename || ""));
      const n = Math.max(0, ...(d.versions || []).map((v) => v.n)) + 1;
      d.versions = [...(d.versions || []), { n, ...f, name: str(q.filename, 120) || f.file, kind, uploaded_at: new Date(now()).toISOString(), uploaded_by: by(req), note: str(q.note, 300) }];
      d.current_version = n;
      log(d, req, `Version ${n} uploaded (${f.ext}${kind === "signed" ? ", signed copy" : ""})`);
      store.save();
      res.status(201).json(view(req, w, d));
    } catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ detail: e.message || "Upload failed" }); }
  });
  const versionOf = (req, res, d) => {
    const n = req.query.v === undefined ? d.current_version : Number(req.query.v);
    const v = (d.versions || []).find((x) => x.n === n);
    if (!v) { res.status(404).json({ detail: "Version not found" }); return null; }
    return v;
  };
  app.get(`${P}/documents/:id/file`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const v = versionOf(req, res, d); if (!v) return;
    sendFile(req, res, d, v, { inline: req.query.inline === "1" });
  });
  // Generated drafts as a printable page (inline HTML under a sandbox CSP: no scripts run).
  app.get(`${P}/documents/:id/print`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const v = versionOf(req, res, d); if (!v) return;
    if (v.ext !== "html") return res.status(422).json({ detail: "Only generated drafts have a print view: download the file instead." });
    const p = legalPath(store, v.file);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ detail: "File missing on the server" });
    audit(req, d, v, "printed");
    res.set({ "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox allow-modals; default-src 'none'; style-src 'unsafe-inline'" });
    res.send(fs.readFileSync(p, "utf8"));
  });

  // ---- e-signature log (no integration): who, when, how, with the signed file attached
  app.post(`${P}/documents/:id/signatures`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const b = req.body || {}, today = todayOf(now());
    const signer = str(b.signer_name, 120), email = str(b.signer_email, 200).toLowerCase(), method = String(b.method || "");
    const err = [];
    if (!signer) err.push("signer_name is required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err.push("signer_email is not valid");
    if (!isDate(b.signed_at) || b.signed_at > today) err.push("signed_at must be a date (YYYY-MM-DD), not in the future");
    if (!SIGN_METHODS.some((m) => m.id === method)) err.push(`method must be one of ${SIGN_METHODS.map((m) => m.id).join(", ")}`);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const v = (d.versions || []).find((x) => x.n === Number(b.version));
    if (!v || v.kind === "generated") return res.status(422).json({ detail: "Attach the signed file: upload it as a new version (a scan or the signed PDF), then record the signature on that version." });
    const sig = { id: store.newId(), signer_name: signer, signer_email: email, party: str(b.party, 200), signed_at: b.signed_at, method, method_note: str(b.method_note, 200), version_n: v.n, recorded_by: by(req), recorded_at: new Date(now()).toISOString() };
    d.signatures = [...(d.signatures || []), sig];
    if (v.kind !== "signed") v.kind = "signed";
    d.current_version = v.n;
    log(d, req, `Signature recorded: ${signer} on ${b.signed_at} (${method}), file v${v.n}`);
    if (["draft", "in_review"].includes(d.status) && !signBlock(d)) { d.status = "signed"; log(d, req, "status → signed"); }
    if (!d.issue_date) d.issue_date = b.signed_at;
    store.save();
    res.status(201).json(view(req, w, d));
  });
  app.delete(`${P}/documents/:id/signatures/:sid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const s = (d.signatures || []).find((x) => x.id === req.params.sid); if (!s) return res.status(404).json({ detail: "Signature not found" });
    d.signatures = d.signatures.filter((x) => x !== s);
    log(d, req, `Signature by ${s.signer_name} removed from the log`);
    if (!d.signatures.length && d.status === "signed") { d.status = "in_review"; log(d, req, "status → in review (no signature left)"); }
    store.save();
    res.json(view(req, w, d));
  });

  // ---- obligations and reminders
  app.post(`${P}/documents/:id/obligations`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const { o, err } = cleanObligation(req.body || {}, { store });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const ob = store.addOps(COLL.obligations, w.id, { document_id: d.id, due_date: null, repeat: "none", owner_id: d.owner_id || null, notes: "", ...o, status: "open", source: "person", created_by: by(req) }, false);
    log(d, req, `Obligation added: ${ob.title}${ob.due_date ? ` (due ${ob.due_date})` : ""}`);
    store.save();
    res.status(201).json(ob);
  });
  const getObl = (req, res, w) => {
    const o = store.getOps(COLL.obligations, w.id, req.params.oid);
    const d = o && store.getOps(COLL.docs, w.id, o.document_id);
    if (!o || !d || !canSee(req.user, d)) { res.status(404).json({ detail: "Obligation not found" }); return null; }
    return { o, d };
  };
  app.put(`${P}/obligations/:oid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = getObl(req, res, w); if (!r) return;
    const { o, err } = cleanObligation(req.body || {}, { store, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if ((o.repeat || r.o.repeat) !== "none" && !(o.due_date !== undefined ? o.due_date : r.o.due_date)) return res.status(422).json({ detail: "a repeating obligation needs a due_date" });
    res.json(store.updateOps(COLL.obligations, w.id, r.o.id, o));
  });
  app.post(`${P}/obligations/:oid/done`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = getObl(req, res, w); if (!r) return;
    const o = r.o, at = new Date(now()).toISOString();
    if (o.repeat && o.repeat !== "none" && o.due_date) { o.last_done = { at, by: by(req), due_date: o.due_date }; o.due_date = nextDue(o.due_date, o.repeat); log(r.d, req, `Obligation done: ${o.title}; next due ${o.due_date}`); }
    else { o.status = "done"; o.done_at = at; o.done_by = by(req); log(r.d, req, `Obligation done: ${o.title}`); }
    store.save();
    res.json(o);
  });
  app.delete(`${P}/obligations/:oid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = getObl(req, res, w); if (!r) return;
    store.deleteOps(COLL.obligations, w.id, r.o.id);
    log(r.d, req, `Obligation removed: ${r.o.title}`); store.save();
    res.status(204).end();
  });
  app.get(`${P}/due`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const days = Math.min(730, Math.max(1, Math.round(Number(req.query.days) || 120)));
    res.json({ items: dueItems(store, w, { user: req.user, now: now(), horizon: days }).map((x) => ({ ...x, owner_name: nameOf(x.owner_id) })), days, today: todayOf(now()), settings: settingsOf(w) });
  });

  // ---- AI Legal assistant: summary with quotes, suggestions a person accepts
  app.post(`${P}/documents/:id/summary`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const pasted = req.body?.text != null ? String(req.body.text).replace(/\r\n?/g, "\n").trim() : "";
    if (pasted.length > TEXT_MAX) return res.status(413).json({ detail: `The text is over ${TEXT_MAX / 1000} KB: paste the main clauses only.` });
    let text = pasted, source = "pasted";
    if (!text) {
      const v = currentVersion(d), r = textOfVersion(store, v);
      if (r.error) return res.status(422).json({ detail: r.error, need_text: true });
      text = r.text; source = `file v${v.n}`;
    }
    if (text.length < 40) return res.status(422).json({ detail: "There is too little text to summarize: paste the contract text.", need_text: true });
    const s = await legal.summarize(w, d, text.slice(0, TEXT_MAX), { by: by(req), source });
    d.summary = { ...s, suggestions: undefined };
    delete d.summary.suggestions;
    d.suggestions = [...(d.suggestions || []).filter((x) => x.status !== "suggested"), ...s.suggestions.map((x) => ({ id: store.newId(), ...x, status: "suggested", at: s.at }))];
    log(d, req, `Summary drafted (${s.by_ai ? "AI Legal assistant" : "fixed rules"}, from ${source})${s.dropped ? `, ${s.dropped} unquoted point${s.dropped === 1 ? "" : "s"} dropped` : ""}`);
    store.save();
    res.json(view(req, w, d));
  });
  app.post(`${P}/documents/:id/suggestions/:sid/:act`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = get(req, res, w); if (!d) return;
    const sg = (d.suggestions || []).find((x) => x.id === req.params.sid);
    if (!sg) return res.status(404).json({ detail: "Suggestion not found" });
    if (sg.status !== "suggested") return res.status(409).json({ detail: `Already ${sg.status}.` });
    if (req.params.act === "dismiss") {
      sg.status = "dismissed"; sg.decided_by = by(req);
      if (sg.source === "ai") outcome(w.id, "rejected", `Obligation suggestion dismissed: ${sg.title.slice(0, 80)}`);
      store.save(); return res.json(view(req, w, d));
    }
    if (req.params.act !== "accept") return res.status(404).json({ detail: "Unknown action" });
    const b = req.body || {};
    const { o, err } = cleanObligation({ kind: b.kind ?? sg.kind, title: b.title ?? sg.title, due_date: b.due_date !== undefined ? b.due_date : sg.due_date, repeat: b.repeat, owner_id: b.owner_id ?? d.owner_id }, { store });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const edited = o.title !== sg.title || (o.due_date || null) !== (sg.due_date || null) || o.kind !== sg.kind;
    const ob = store.addOps(COLL.obligations, w.id, { document_id: d.id, due_date: null, repeat: "none", notes: sg.quote ? `From the contract: "${sg.quote.slice(0, 400)}"` : "", ...o, status: "open", source: sg.source === "ai" ? "ai_suggested" : "rule_suggested", created_by: by(req) }, false);
    sg.status = "accepted"; sg.decided_by = by(req); sg.obligation_id = ob.id;
    if (sg.source === "ai") outcome(w.id, edited ? "edited" : "accepted", `Obligation accepted${edited ? " with changes" : ""}: ${o.title.slice(0, 80)}`);
    log(d, req, `Suggested obligation accepted: ${o.title}`);
    store.save();
    res.status(201).json(view(req, w, d));
  });

  // ---- templates and generation
  app.get(`${P}/templates`, (req, res) => { if (!W(req, res)) return; res.json({ templates: TEMPLATES, not_advice: NOT_ADVICE }); });
  app.get(`${P}/counterparties`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const kind = String(req.query.kind || ""), q = str(req.query.q, 80).toLowerCase();
    const has = (s) => !q || String(s || "").toLowerCase().includes(q);
    let rows = [];
    if (kind === "store") { if (!can(req, "crm")) return res.status(403).json({ detail: "Your role can't see the Store CRM." }); rows = (crm?.contacts(w.id) || []).filter((c) => has(`${c.store_name} ${c.domain} ${c.email}`)).slice(0, 20).map((c) => ({ id: c.id, label: c.store_name || c.domain })); }
    else if (kind === "customer") { if (!(can(req, "billing") || can(req, "success"))) return res.status(403).json({ detail: "Your role can't see Billing customers." }); rows = (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && !c.archived && has(`${c.store_name} ${c.legal_name} ${c.owner_email}`)).slice(0, 20).map((c) => ({ id: c.id, label: c.legal_name || c.store_name })); }
    else if (kind === "partner") { if (!can(req, "partners")) return res.status(403).json({ detail: "Your role can't see Partners." }); rows = (store.db.partners_partners || []).filter((p) => p.workspace_id === w.id && has(`${p.name} ${p.contact?.email}`)).slice(0, 20).map((p) => ({ id: p.id, label: p.name })); }
    else if (kind === "employee") { if (!can(req, "team")) return res.status(403).json({ detail: "Your role can't see employees." }); rows = store.listOps("people_employees", w.id).filter((e) => e.status !== "exited" && has(`${e.name} ${e.email} ${e.designation}`)).slice(0, 20).map((e) => ({ id: e.id, label: `${e.name}${e.designation ? ` · ${e.designation}` : ""}` })); }
    else return res.status(422).json({ detail: "kind must be store, customer, partner or employee" });
    res.json({ rows });
  });
  // The counterparty record, read through the person's own permissions.
  const counterparty = (req, w, c = {}) => {
    const kind = String(c.kind || "other"), id = c.id ? String(c.id) : "";
    if (kind === "other") { const name = str(c.name, 200); const email = str(c.email, 200).toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { err: "counterparty email is not valid" }; return { cp: { kind, id: null, name, email, address: str(c.address, 300), signatory: str(c.signatory, 120) } }; }
    if (kind === "store") {
      if (!can(req, "crm")) return { err: "Your role can't see the Store CRM.", status: 403 };
      const s = crm?.get(w.id, id); if (!s) return { err: "Unknown Store CRM store" };
      return { cp: { kind, id: s.id, name: s.store_name || s.domain || "", email: s.email || "", address: s.city ? `${s.city}, Saudi Arabia` : "", signatory: s.owner_name || "" } };
    }
    if (kind === "customer") {
      if (!(can(req, "billing") || can(req, "success"))) return { err: "Your role can't see Billing customers.", status: 403 };
      const x = (store.db.billing_customers || []).find((y) => y.workspace_id === w.id && y.id === id); if (!x) return { err: "Unknown Billing customer" };
      return { cp: { kind, id: x.id, name: x.legal_name || x.store_name || "", email: x.owner_email || "", address: fmtAddr(x.billing_address), vat: x.vat_number || "", signatory: x.owner_name || "", plan: x.plan || "", cycle: x.cycle || "" } };
    }
    if (kind === "partner") {
      if (!can(req, "partners")) return { err: "Your role can't see Partners.", status: 403 };
      const p = (store.db.partners_partners || []).find((y) => y.workspace_id === w.id && y.id === id); if (!p) return { err: "Unknown partner" };
      const code = (store.db.partners_codes || []).find((x) => x.workspace_id === w.id && x.partner_id === p.id && x.active !== false);
      const money = can(req, "billing") || can(req, "finance");
      return { cp: { kind, id: p.id, name: p.name, email: p.contact?.email || "", address: [p.city, p.country].filter(Boolean).join(", "), signatory: p.contact?.name || "",
        partner: { agreement: money ? p.agreement || {} : { tier: p.agreement?.tier || "" }, link: code ? `${publicBase(env)}/r/${code.code}` : "" } } };
    }
    if (kind === "employee") {
      if (!can(req, "team")) return { err: "Your role can't see employees.", status: 403 };
      const e = store.getOps("people_employees", w.id, id); if (!e) return { err: "Unknown employee" };
      return { cp: { kind, id: e.id, name: e.name, email: e.email || "", address: "", signatory: e.name, employee: e } };
    }
    return { err: "counterparty.kind must be other, store, customer, partner or employee" };
  };
  app.post(`${P}/generate`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {};
    const t = templateById(String(b.template_id || "")); if (!t) return res.status(422).json({ detail: "Unknown template" });
    const r = counterparty(req, w, b.counterparty || {});
    if (r.err) return res.status(r.status || 422).json({ detail: r.err });
    const cp = r.cp;
    if (!t.counterparty.includes(cp.kind)) return res.status(422).json({ detail: `This template takes a counterparty of kind ${t.counterparty.join(", ")}.` });
    const today = todayOf(now());
    const filled = fillTemplate(t, fieldValues(w, { cp, manual: b.fields && typeof b.fields === "object" ? b.fields : {}, today, plans: PLANS.filter((p) => Number.isFinite(p.usd)), payroll: can(req, "payroll") }));
    let d;
    if (b.document_id) {
      d = get(req, res, w, String(b.document_id)); if (!d) return;
      if (!["draft", "in_review"].includes(d.status)) return res.status(409).json({ detail: "Only a draft or in-review document takes a new template draft." });
    } else {
      const title = str(b.title, 200) || `${t.name.replace(/ \(.*\)$/, "")}${cp.name ? ` · ${cp.name}` : ""}`.slice(0, 200);
      const restricted = RESTRICTED_BY_DEFAULT.includes(t.type) && canSeeRestricted(req.user);
      d = store.addOps(COLL.docs, w.id, { title, type: t.type, status: "draft", confidentiality: restricted ? "restricted" : "normal", parties: cp.name || cp.email ? [{ name: cp.name, email: cp.email, role: "Counterparty" }] : [],
        issue_date: null, expiry_date: null, auto_renew: false, renewal_term_months: 0, notice_days: 0, owner_id: req.user.id, employee_id: cp.kind === "employee" ? cp.id : null,
        counterparty: { kind: cp.kind, id: cp.id, label: cp.name }, payment_terms: "", reference: "", notes: "", tags: [], versions: [], current_version: null, signatures: [], summary: null, suggestions: [], log: [], created_by: by(req) }, false);
    }
    const n = Math.max(0, ...(d.versions || []).map((v) => v.n)) + 1;
    const f = writeLegalFile(store, "html", renderHtml(t, filled.text, { title: d.title, version: n }));
    d.versions = [...(d.versions || []), { n, ...f, name: `${safeName(d.title)}.html`, kind: "generated", template_id: t.id, placeholders: filled.placeholders, uploaded_at: new Date(now()).toISOString(), uploaded_by: by(req), note: `Generated from "${t.name}"` }];
    d.current_version = n;
    log(d, req, `Version ${n} generated from the template "${t.name}" (${filled.placeholders.add} [ADD], ${filled.placeholders.confirm} [CONFIRM] left)`);
    store.save();
    res.status(201).json({ ...view(req, w, d), generated: { version: n, used: filled.used, missing: filled.missing, placeholders: filled.placeholders } });
  });

  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanSettings(req.body || {});
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    w.legal = { ...(w.legal || {}), ...out }; store.save();
    res.json(settingsOf(w));
  });

  // ---- self-service: an employee's own signed employment contract
  app.get("/api/me/legal/:ws/documents/:id/file", (req, res) => {
    const w = store.getWorkspace(req.params.ws); if (!w) return res.status(404).json({ detail: "Workspace not found" });
    const e = req.user.id === "owner" ? null : store.listOps("people_employees", w.id).find((x) => x.user_id === req.user.id && x.status !== "exited");
    const mine = e ? myEmploymentDocs(store, w.id, e.id).find((x) => x.id === String(req.params.id)) : null;
    const d = mine && store.getOps(COLL.docs, w.id, mine.id);
    if (!d) return res.status(404).json({ detail: "Document not found" });
    const v = currentVersion(d); if (!v) return res.status(404).json({ detail: "No file" });
    sendFile(req, res, d, v);
  });
}
