// HTTP routes for Security & compliance (module "compliance" in Teams & roles), backups and the status page.
// Public: /status and /status.json. Private: /api/compliance/*. Backup download is Owner only;
// data-request deletion needs Edit plus a typed confirmation.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLMError, SYSTEM } from "./engine.js";
import { MODULES, levelOk } from "./access.js";
import { COMPONENT_IDS } from "./status.js";
import {
  DPA_STATUS, DSR_STATUS, DSR_TYPES, DSR_TYPE_IDS, POLICY_STARTER, REGISTER_FIELDS, REGISTER_STARTER, SETTINGS_DEFAULTS, VENDOR_STARTER, VERIFY_NOTE,
  accessRows, breachChecklist, deleteSubject, matcher, dsrState, exportSubject, findSubject, parseStatusDraft, policyPrompt, quarterOf, securityChecks, statusPrompt,
} from "./compliance.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const COLLS = ["compliance_register", "compliance_vendors", "compliance_policies", "compliance_requests", "compliance_reviews"];
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const AGENT = "compliance_officer";

export function complianceSettings(store) { return { ...SETTINGS_DEFAULTS, ...(store.db.compliance_settings || {}) }; }

// What the Command Center shows under "Needs you" (also used by the page's own banner).
export function complianceNeeds({ store, backups, now = Date.now() }) {
  const s = complianceSettings(store), out = [];
  const b = backups?.status();
  if (b && !b.fresh) out.push({ module: "Compliance", route: "compliance", param: null, title: "Backups", text: b.last_ok ? `No successful backup in ${b.fresh_hours} hours (last ${b.last_ok.at.slice(0, 10)}): back up now` : "No backup yet: back up now and set BACKUP_KEY" });
  for (const r of store.db.compliance_requests || []) {
    const st = dsrState(r, s.dsr_days, now);
    if (st.overdue) out.push({ module: "Compliance", route: "compliance", param: null, title: r.ref, text: `Data request ${r.ref} (${r.type}) is overdue: due ${st.due}` });
    else if (st.due_soon) out.push({ module: "Compliance", route: "compliance", param: null, title: r.ref, text: `Data request ${r.ref} (${r.type}) due in ${st.days_left}d` });
  }
  for (const inc of store.db.ops_incidents || []) for (const it of inc.breach?.checklist || []) {
    if (!it.done_at && Date.parse(it.due_at) - now < 12 * 3600e3) out.push({ module: "Compliance", route: "compliance", param: null, title: inc.title, text: `Breach checklist${Date.parse(it.due_at) < now ? " overdue" : " due soon"}: ${it.text.split(".")[0]}` });
  }
  return out;
}

export function mountCompliancePublic(app, { status }) {
  app.get("/status", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "status.html")));
  app.get("/status.json", (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.setHeader("Access-Control-Allow-Origin", "*"); res.json(status.view()); });
}

export function mountCompliance(app, { store, crm, provider, workforce, backups, status, password = "", env = process.env }) {
  for (const k of COLLS) store.db[k] ||= [];
  const db = store.db;
  const by = (req) => req.user?.name || "you";
  const isOwner = (req) => req.user?.role_id === "owner";
  const now = () => new Date().toISOString();
  const nextRef = () => "DSR-" + String(db.compliance_requests.length + 1).padStart(4, "0");
  const findIn = (coll, id) => db[coll].find((x) => x.id === String(id)) || null;
  const add = (coll, fields) => { const x = { id: store.newId(), created_at: now(), ...fields }; db[coll].push(x); store.save(); return x; };

  // First visit: the data register, sub-processors and policy templates are filled with starters.
  function seed() {
    if (db.compliance_seeded) {
      // Register rows for modules added after the first visit (each once, by key).
      const late = REGISTER_STARTER.filter((r) => ["meetings_notes"].includes(r.key) && !db.compliance_register.some((x) => x.key === r.key));
      if (late.length) { for (const r of late) db.compliance_register.push({ id: store.newId(), created_at: now(), starter: true, notes: "", ...r }); store.save(); }
      return;
    }
    for (const r of REGISTER_STARTER) db.compliance_register.push({ id: store.newId(), created_at: now(), starter: true, notes: "", ...r });
    const opsNames = new Set(db.ops_vendors.map((v) => v.name.toLowerCase()));
    for (const v of VENDOR_STARTER) db.compliance_vendors.push({ id: store.newId(), created_at: now(), starter: true, dpa: "unknown", transfer_outside_ksa: null, notes: "", in_tool_stack: opsNames.has(v.name.toLowerCase().split(" ")[0]), ...v });
    for (const p of POLICY_STARTER) db.compliance_policies.push({ id: store.newId(), created_at: now(), updated_at: now(), key: p.key, title: p.title, body: p.body, version: 1, owner: "", status: "draft", approved_by: "", approved_at: null, ai_draft: null, history: [] });
    db.compliance_seeded = now();
    store.save();
  }
  const rolesWith = (mod) => db.roles.filter((r) => levelOk(r.perms?.[mod], "view")).map((r) => `${r.name} (${r.perms[mod]})`);
  const opsIncidents = () => db.ops_incidents.map((i) => ({ ...i, workspace: store.getWorkspace(i.workspace_id)?.brief?.company_name || i.workspace_id,
    status_page: db.status_incidents.find((s) => s.ops && s.ops.ws === i.workspace_id && s.ops.id === i.id) || null })).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const checks = () => securityChecks({ env, password, store, crm, backupStatus: backups.status(), settings: complianceSettings(store) });
  const reqView = (r) => ({ ...r, ...dsrState(r, complianceSettings(store).dsr_days) });

  // View-only roles (Team lead, Viewer) see the work but not the people behind requests or logins.
  const mask = (v) => (v ? String(v).replace(/^(.).*?(@|$)/, "$1•••$2").replace(/(\d{2})\d+(\d{2})$/, "$1•••$2") : "");
  app.get("/api/compliance", (req, res) => {
    seed();
    const s = complianceSettings(store), canEdit = levelOk(req.perms?.compliance, "edit");
    const subj = (r) => (canEdit ? r : { ...r, subject: { name: r.subject.name ? r.subject.name[0] + "•••" : "", email: mask(r.subject.email), phone: mask(r.subject.phone) } });
    res.json({ can_edit: canEdit,
      settings: s, verify_note: VERIFY_NOTE, checks: checks(), backups: { status: backups.status(), files: backups.files(), can_download: isOwner(req) },
      register: db.compliance_register.map((r) => ({ ...r, access: rolesWith(r.module) })), vendors: db.compliance_vendors,
      policies: db.compliance_policies.map(({ history, ...p }) => ({ ...p, history_count: (history || []).length })),
      requests: db.compliance_requests.map(reqView).map(subj).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      reviews: [...db.compliance_reviews].sort((a, b) => b.created_at.localeCompare(a.created_at)), access: { quarter: quarterOf(), rows: accessRows(store, Date.now(), s.inactive_days).map((u) => (canEdit ? u : { ...u, email: mask(u.email) })), shared_login: !!password },
      incidents: opsIncidents(), status: status.admin(), needs: complianceNeeds({ store, backups }),
      meta: { dsr_types: DSR_TYPES, dsr_status: DSR_STATUS, dpa_status: DPA_STATUS, modules: MODULES, components: COMPONENT_IDS, register_fields: REGISTER_FIELDS },
    });
  });
  app.put("/api/compliance/settings", (req, res) => {
    const b = req.body || {}, cur = db.compliance_settings || {};
    for (const [k, min, max] of [["dsr_days", 1, 90], ["breach_regulator_hours", 1, 720], ["breach_subjects_hours", 1, 720], ["inactive_days", 7, 365], ["min_password", 10, 64]]) {
      if (b[k] !== undefined) { const n = Math.round(Number(b[k])); if (!(n >= min && n <= max)) return res.status(422).json({ detail: `${k} must be between ${min} and ${max}` }); cur[k] = n; }
    }
    db.compliance_settings = cur; store.save();
    res.json(complianceSettings(store));
  });

  // ---- backups
  app.post("/api/compliance/backups", async (req, res) => {
    try { res.status(201).json(await backups.create({ kind: "manual", media: req.body?.media !== false, by: by(req) })); }
    catch (e) { res.status(500).json({ detail: "Backup failed: " + (e?.message || "error") }); }
  });
  app.get("/api/compliance/backups/:name/download", (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ detail: "Only an Owner can download backups." });
    const file = backups.pathOf(req.params.name);
    if (!file) return res.status(404).json({ detail: "Backup not found" });
    store.logAudit({ user_id: req.user.id, user_name: req.user.name, method: "GET", path: "/api/compliance/backups/download", module: "compliance", summary: `downloaded backup ${req.params.name}` });
    res.download(file, req.params.name);
  });
  app.post("/api/compliance/backups/:name/verify", async (req, res) => {
    try { res.json(await backups.verify(req.params.name)); }
    catch (e) { res.status(e?.message === "Backup not found" ? 404 : 422).json({ detail: e?.message || "Could not verify" }); }
  });
  app.post("/api/compliance/backups/:name/offsite", async (req, res) => {
    try { res.json(await backups.offsite(req.params.name)); }
    catch (e) { res.status(404).json({ detail: e?.message || "Backup not found" }); }
  });

  // ---- data register
  const cleanReg = (b, cur = {}) => Object.fromEntries(REGISTER_FIELDS.map((k) => [k, k === "module" ? (MODULES.some((m) => m.id === b.module) ? b.module : cur.module || "") : str(b[k] ?? cur[k], k === "name" ? 120 : 1000)]));
  app.post("/api/compliance/register", (req, res) => { const r = cleanReg(req.body || {}); if (!r.name) return res.status(422).json({ detail: "Name the kind of data." }); res.status(201).json(add("compliance_register", r)); });
  app.put("/api/compliance/register/:id", (req, res) => {
    const r = findIn("compliance_register", req.params.id); if (!r) return res.status(404).json({ detail: "Entry not found" });
    const c = cleanReg(req.body || {}, r); if (!c.name) return res.status(422).json({ detail: "Name can't be empty." });
    Object.assign(r, c, { updated_at: now(), updated_by: by(req) }); store.save(); res.json(r);
  });
  app.delete("/api/compliance/register/:id", (req, res) => { const n = db.compliance_register.length; db.compliance_register = db.compliance_register.filter((x) => x.id !== req.params.id); store.save(); db.compliance_register.length < n ? res.status(204).end() : res.status(404).json({ detail: "Entry not found" }); });

  // ---- sub-processors / vendors
  const cleanVendor = (b, cur = {}) => ({ name: str(b.name ?? cur.name, 120), role: str(b.role ?? cur.role, 300), data: str(b.data ?? cur.data, 500), country: str(b.country ?? cur.country, 120),
    dpa: DPA_STATUS.includes(b.dpa) ? b.dpa : cur.dpa || "unknown", transfer_outside_ksa: b.transfer_outside_ksa === undefined ? cur.transfer_outside_ksa ?? null : b.transfer_outside_ksa === null ? null : !!b.transfer_outside_ksa,
    dpa_link: str(b.dpa_link ?? cur.dpa_link, 300), notes: str(b.notes ?? cur.notes, 1000) });
  app.post("/api/compliance/vendors", (req, res) => { const v = cleanVendor(req.body || {}); if (!v.name) return res.status(422).json({ detail: "Name the vendor." }); res.status(201).json(add("compliance_vendors", v)); });
  app.post("/api/compliance/vendors/from-ops", (req, res) => {
    const have = new Set(db.compliance_vendors.map((v) => v.name.toLowerCase()));
    let n = 0;
    for (const o of db.ops_vendors) {
      const k = o.name.toLowerCase();
      const match = db.compliance_vendors.find((v) => v.name.toLowerCase().split(" ")[0] === k.split(" ")[0]);
      if (match) { match.in_tool_stack = true; continue; }
      if (have.has(k)) continue;
      have.add(k);
      db.compliance_vendors.push({ id: store.newId(), created_at: now(), ...cleanVendor({ name: o.name, role: o.purpose, data: "[CONFIRM what personal data it gets]", country: "[CONFIRM]" }), in_tool_stack: true, from_ops: true }); n++;
    }
    store.save();
    res.status(201).json({ added: n });
  });
  app.put("/api/compliance/vendors/:id", (req, res) => {
    const v = findIn("compliance_vendors", req.params.id); if (!v) return res.status(404).json({ detail: "Vendor not found" });
    const c = cleanVendor(req.body || {}, v); if (!c.name) return res.status(422).json({ detail: "Name can't be empty." });
    Object.assign(v, c, { updated_at: now() }); store.save(); res.json(v);
  });
  app.delete("/api/compliance/vendors/:id", (req, res) => { const n = db.compliance_vendors.length; db.compliance_vendors = db.compliance_vendors.filter((x) => x.id !== req.params.id); store.save(); db.compliance_vendors.length < n ? res.status(204).end() : res.status(404).json({ detail: "Vendor not found" }); });

  // ---- policies (AI drafts; a person saves and approves)
  app.get("/api/compliance/policies/:id", (req, res) => { const p = findIn("compliance_policies", req.params.id); p ? res.json(p) : res.status(404).json({ detail: "Policy not found" }); });
  app.post("/api/compliance/policies", (req, res) => {
    const title = str(req.body?.title, 120); if (!title) return res.status(422).json({ detail: "Name the policy." });
    res.status(201).json(add("compliance_policies", { key: "custom", title, body: str(req.body?.body, 50000) || `# ${title}\n\n[CONFIRM]`, version: 1, owner: str(req.body?.owner, 120), status: "draft", approved_by: "", approved_at: null, ai_draft: null, history: [], updated_at: now() }));
  });
  app.put("/api/compliance/policies/:id", (req, res) => {
    const p = findIn("compliance_policies", req.params.id); if (!p) return res.status(404).json({ detail: "Policy not found" });
    const b = req.body || {};
    if (b.title !== undefined) { const t = str(b.title, 120); if (t) p.title = t; }
    if (b.owner !== undefined) p.owner = str(b.owner, 120);
    if (b.body !== undefined) {
      const body = String(b.body).slice(0, 50000);
      if (body !== p.body) {
        p.history = [...(p.history || []), { version: p.version, body: p.body, at: p.updated_at, by: p.updated_by || "" }].slice(-20);
        p.body = body; p.version += 1; p.status = "draft"; p.approved_by = ""; p.approved_at = null;
      }
      if (b.from_ai && p.ai_draft) { workforce?.event(AGENT, null, body === p.ai_draft ? "accepted" : "edited", `Policy: ${p.title}`); p.ai_draft = null; }
    }
    if (b.approve) {
      if (/\[CONFIRM/i.test(p.body) && !b.force) return res.status(422).json({ detail: "The policy still has [CONFIRM] placeholders. Fill them in first." });
      p.status = "approved"; p.approved_by = by(req); p.approved_at = now();
    }
    p.updated_at = now(); p.updated_by = by(req); store.save();
    res.json(p);
  });
  app.delete("/api/compliance/policies/:id/ai", (req, res) => {
    const p = findIn("compliance_policies", req.params.id); if (!p) return res.status(404).json({ detail: "Policy not found" });
    if (p.ai_draft) workforce?.event(AGENT, null, "rejected", `Policy: ${p.title}`);
    p.ai_draft = null; store.save(); res.status(204).end();
  });
  app.delete("/api/compliance/policies/:id", (req, res) => { const n = db.compliance_policies.length; db.compliance_policies = db.compliance_policies.filter((x) => x.id !== req.params.id); store.save(); db.compliance_policies.length < n ? res.status(204).end() : res.status(404).json({ detail: "Policy not found" }); });
  app.post("/api/compliance/policies/:id/ai", async (req, res) => {
    const p = findIn("compliance_policies", req.params.id); if (!p) return res.status(404).json({ detail: "Policy not found" });
    seed();
    const ws = db.workspaces[0];
    const facts = [
      "Security checks: " + checks().map((c) => `${c.title}: ${c.state} (${c.detail})`).join("; "),
      "Roles: " + db.roles.map((r) => r.name).join(", "),
      "Sub-processors: " + db.compliance_vendors.map((v) => `${v.name} (${v.role}; DPA ${v.dpa})`).join("; "),
      "Backups: " + backups.status().schedule + ` Encrypted: ${backups.status().encrypted ? "yes" : "no"}. Kept: 14 nightly + 8 weekly.`,
      "Data held: " + db.compliance_register.map((r) => r.name).join(", "),
    ].join("\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("X-Accel-Buffering", "no");
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const text = await provider.generate({ system: SYSTEM, prompt: policyPrompt(ws, p, facts), signal: ac.signal, onText: (d) => res.write(d) });
      p.ai_draft = text; p.ai_draft_at = now(); store.save();
      res.end("\n\n[[MWIZ_SAVED]]" + p.id);
    } catch (e) {
      if (ac.signal.aborted) return;
      res.end("\n\n[[MWIZ_ERROR]]" + (e instanceof LLMError ? e.message : "Something went wrong. Try again in a moment."));
    }
  });

  // ---- data subject requests
  const cleanSubject = (b) => ({ name: str(b?.name, 120), email: str(b?.email, 200).toLowerCase(), phone: str(b?.phone, 40) });
  app.post("/api/compliance/find", (req, res) => {
    const f = findSubject({ store, crm }, cleanSubject(req.body));
    f ? res.json(f) : res.status(422).json({ detail: "Give an email or a phone number." });
  });
  app.post("/api/compliance/requests", (req, res) => {
    const b = req.body || {};
    if (!DSR_TYPE_IDS.includes(b.type)) return res.status(422).json({ detail: "Pick the kind of request." });
    const subject = cleanSubject(b.subject || b);
    if (!subject.email && !subject.phone) return res.status(422).json({ detail: "Give the person's email or phone so their data can be found." });
    const received = /^\d{4}-\d{2}-\d{2}$/.test(b.received_at || "") ? b.received_at : now().slice(0, 10);
    const r = add("compliance_requests", { ref: nextRef(), type: b.type, status: "open", received_at: received, channel: str(b.channel, 80), subject, identity_verified: !!b.identity_verified, notes: str(b.notes, 2000),
      log: [{ at: now(), by: by(req), text: "Request logged" }], completed_at: null, completed_by: "", result: null });
    res.status(201).json(reqView(r));
  });
  app.put("/api/compliance/requests/:id", (req, res) => {
    const r = findIn("compliance_requests", req.params.id); if (!r) return res.status(404).json({ detail: "Request not found" });
    const b = req.body || {};
    if (b.status !== undefined) {
      if (!DSR_STATUS.includes(b.status)) return res.status(422).json({ detail: "Unknown status" });
      if (b.status !== r.status) r.log.push({ at: now(), by: by(req), text: `Status: ${r.status} → ${b.status}` });
      r.status = b.status;
      if (["completed", "rejected"].includes(b.status)) { r.completed_at ||= now(); r.completed_by ||= by(req); } else { r.completed_at = null; r.completed_by = ""; }
    }
    if (b.notes !== undefined) r.notes = str(b.notes, 2000);
    if (b.identity_verified !== undefined) { r.identity_verified = !!b.identity_verified; r.log.push({ at: now(), by: by(req), text: r.identity_verified ? "Identity verified" : "Identity not verified" }); }
    if (b.received_at !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.received_at)) r.received_at = b.received_at;
    if (b.subject && !r.erased) r.subject = cleanSubject(b.subject);
    store.save(); res.json(reqView(r));
  });
  app.post("/api/compliance/requests/:id/find", (req, res) => {
    const r = findIn("compliance_requests", req.params.id); if (!r) return res.status(404).json({ detail: "Request not found" });
    if (r.erased) return res.status(409).json({ detail: "This person's data was deleted; the request keeps no personal data to search with." });
    const f = findSubject({ store, crm }, r.subject);
    r.log.push({ at: now(), by: by(req), text: `Searched: ${f?.total ?? 0} records found` }); store.save();
    res.json(f);
  });
  app.post("/api/compliance/requests/:id/export", (req, res) => {
    const r = findIn("compliance_requests", req.params.id); if (!r) return res.status(404).json({ detail: "Request not found" });
    if (r.erased) return res.status(409).json({ detail: "This person's data was already deleted." });
    const out = exportSubject({ store, crm }, r.subject);
    r.log.push({ at: now(), by: by(req), text: "Exported a copy of the data (JSON)" }); store.save();
    res.setHeader("Content-Disposition", `attachment; filename="${r.ref}-export.json"`);
    res.json({ request: r.ref, ...out });
  });
  app.post("/api/compliance/requests/:id/delete", (req, res) => {
    const r = findIn("compliance_requests", req.params.id); if (!r) return res.status(404).json({ detail: "Request not found" });
    if (r.erased) return res.status(409).json({ detail: "Already deleted." });
    if (r.type !== "deletion") return res.status(422).json({ detail: "Only a deletion request deletes data. Log a deletion request for this person first." });
    if (String(req.body?.confirm || "") !== "DELETE") return res.status(422).json({ detail: 'Type DELETE to confirm. This permanently removes the person\'s data from every module.' });
    const counts = deleteSubject({ store, crm }, r.subject) || {};
    // Earlier requests from the same person (e.g. an access request) also drop their details.
    const m = matcher(r.subject);
    for (const o of db.compliance_requests) if (o !== r && !o.erased && (m.emailIs(o.subject.email) || m.phoneIs(o.subject.phone))) {
      o.subject = { name: "", email: "", phone: "" }; o.erased = true; o.notes = "";
      o.log.push({ at: now(), by: by(req), text: `Personal details removed with ${r.ref}` });
    }
    // Keep only a minimal record that the deletion happened: no name, email or phone.
    r.subject = { name: "", email: "", phone: "" };
    r.erased = true; r.result = { deleted: counts, at: now(), by: by(req), note: "Copies in backups are removed as backups rotate (14 nights + 8 weeks)." };
    r.log = [...r.log.map((l) => ({ ...l, text: l.text })), { at: now(), by: by(req), text: "Personal data deleted across modules; request record kept without personal data" }];
    r.notes = "";
    r.status = "completed"; r.completed_at = now(); r.completed_by = by(req);
    store.save();
    res.json(reqView(r));
  });

  // ---- access reviews
  app.post("/api/compliance/reviews", (req, res) => {
    const b = req.body || {}, rows = accessRows(store, Date.now(), complianceSettings(store).inactive_days);
    const decisions = rows.map((u) => { const d = (b.decisions || []).find((x) => String(x.user_id) === u.user_id) || {};
      return { user_id: u.user_id, name: u.name, role: u.role, last_login_at: u.last_login_at, decision: ["keep", "change", "remove"].includes(d.decision) ? d.decision : u.suggestion, note: str(d.note, 300) }; });
    if (b.shared_login) decisions.push({ user_id: "owner", name: "Team password (shared Owner)", role: "Owner", last_login_at: null, decision: ["keep", "change", "remove"].includes(b.shared_login) ? b.shared_login : "change", note: "Rotate DASHBOARD_PASSWORD in hPanel" });
    let applied = 0;
    if (b.apply) for (const d of decisions.filter((x) => x.decision === "remove" && x.user_id !== "owner")) {
      const u = db.users.find((x) => x.id === d.user_id);
      const owners = db.users.filter((x) => x.active && x.role_id === "owner");
      if (u && u.active && !(u.role_id === "owner" && owners.length <= 1) && !(u.role_id === "owner" && !isOwner(req)) && u.id !== req.user.id) { u.active = false; applied++; }
    }
    const r = add("compliance_reviews", { quarter: /^\d{4}-Q[1-4]$/.test(b.quarter || "") ? b.quarter : quarterOf(), reviewer: by(req), reviewer_id: req.user.id, reviewed_at: now().slice(0, 10), decisions, notes: str(b.notes, 2000), applied });
    res.status(201).json(r);
  });

  // ---- incidents: personal data breach flag on an Operations incident
  const opsInc = (req, res) => { const i = store.getOps("ops_incidents", req.params.ws, req.params.id); if (!i) res.status(404).json({ detail: "Incident not found" }); return i; };
  app.post("/api/compliance/incidents/:ws/:id/breach", (req, res) => {
    const inc = opsInc(req, res); if (!inc) return;
    if (inc.breach) return res.status(409).json({ detail: "Already flagged as a personal data breach." });
    const aware = req.body?.aware_at && !isNaN(Date.parse(req.body.aware_at)) ? new Date(req.body.aware_at).toISOString() : now();
    const s = complianceSettings(store);
    store.updateOps("ops_incidents", inc.workspace_id, inc.id, { personal_data_breach: true, breach: { flagged_at: now(), flagged_by: by(req), aware_at: aware, people_affected: str(req.body?.people_affected, 80), data_types: str(req.body?.data_types, 500), checklist: breachChecklist(aware, s), verify_note: "Verify the current PDPL breach notification timeline." },
      updates: [...(inc.updates || []), { at: now(), text: `Flagged as a personal data breach by ${by(req)}: notification checklist started.` }] });
    res.status(201).json(store.getOps("ops_incidents", inc.workspace_id, inc.id));
  });
  app.put("/api/compliance/incidents/:ws/:id/breach", (req, res) => {
    const inc = opsInc(req, res); if (!inc) return;
    if (!inc.breach) return res.status(404).json({ detail: "Not flagged as a breach." });
    const b = req.body || {};
    if (b.item) { const it = inc.breach.checklist.find((x) => x.id === b.item); if (!it) return res.status(404).json({ detail: "Checklist item not found" }); it.done_at = b.done ? now() : null; it.by = b.done ? by(req) : ""; it.note = str(b.note ?? it.note, 500); }
    for (const k of ["people_affected", "data_types"]) if (b[k] !== undefined) inc.breach[k] = str(b[k], 500);
    store.updateOps("ops_incidents", inc.workspace_id, inc.id, { breach: inc.breach });
    res.json(inc);
  });
  app.delete("/api/compliance/incidents/:ws/:id/breach", (req, res) => {
    const inc = opsInc(req, res); if (!inc) return;
    store.updateOps("ops_incidents", inc.workspace_id, inc.id, { personal_data_breach: false, breach: null, updates: [...(inc.updates || []), { at: now(), text: `Breach flag removed by ${by(req)}` }] });
    res.status(204).end();
  });

  // ---- status page (admins)
  app.put("/api/compliance/status/components/:id", (req, res) => { const c = status.setComponent(req.params.id, req.body || {}, by(req)); c ? res.json(c) : res.status(422).json({ detail: "Unknown component or state" }); });
  app.post("/api/compliance/status/incidents", (req, res) => {
    const b = req.body || {};
    if (b.ops_ws && b.ops_id && !store.getOps("ops_incidents", b.ops_ws, b.ops_id)) return res.status(404).json({ detail: "Operations incident not found" });
    const r = status.addIncident(b, by(req));
    if (r.error) return res.status(422).json({ detail: r.error });
    if (b.ai_original) { const o = b.ai_original, same = ["title_en", "title_ar", "text_en", "text_ar"].every((k) => String(o[k] || "") === String(b[k] || "")); workforce?.event(AGENT, b.ops_ws || null, same ? "accepted" : "edited", `Status update: ${r.incident.title_en || r.incident.title_ar}`); }
    if (b.published) status.updateIncident(r.incident.id, { published: true }, by(req));
    res.status(201).json(status.getIncident(r.incident.id));
  });
  app.put("/api/compliance/status/incidents/:id", (req, res) => { const i = status.updateIncident(req.params.id, req.body || {}, by(req)); i ? res.json(i) : res.status(404).json({ detail: "Status incident not found" }); });
  app.delete("/api/compliance/status/incidents/:id", (req, res) => (status.deleteIncident(req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Status incident not found" })));
  app.post("/api/compliance/status/check", async (req, res) => {
    const url = (env.PUBLIC_URL || `http://127.0.0.1:${req.socket.localPort}`).replace(/\/$/, "") + "/healthz";
    res.json({ ok: await status.selfCheck(url), url });
  });
  app.post("/api/compliance/status/draft", async (req, res) => {
    const inc = store.getOps("ops_incidents", req.body?.ops_ws, req.body?.ops_id);
    if (!inc) return res.status(404).json({ detail: "Operations incident not found" });
    try {
      const text = await provider.generate({ system: SYSTEM, prompt: statusPrompt(inc, COMPONENT_IDS), onText: () => {} });
      const d = parseStatusDraft(text);
      d.components = d.components.filter((c) => COMPONENT_IDS.includes(c));
      if (!["degraded", "outage", "maintenance"].includes(d.impact)) d.impact = inc.severity === "SEV1" ? "outage" : "degraded";
      res.json(d);
    } catch (e) { res.status(502).json({ detail: e instanceof LLMError ? e.message : "The AI draft failed. Write the update by hand." }); }
  });
}
