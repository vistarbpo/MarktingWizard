// Storage for the Store CRM. Kept in its own file (crm.json) because it holds tens of thousands
// of stores and messages: writes are batched (at most once a second) instead of after every change.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cleanFilter, matches, scoreContact } from "./crm.js";

const EMPTY = () => ({ version: 1, seq: 0, contacts: [], campaigns: [], enrollments: [], messages: [], notes: [], imports: [], settings: {} });
const MAX_MESSAGES = 400000;

export class CrmStore {
  constructor(dataDir, { flushMs = 1000 } = {}) {
    this.file = path.join(dataDir, "crm.json");
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = fs.existsSync(this.file) ? { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) } : EMPTY();
    this.flushMs = flushMs; this.timer = null;
    this.#index();
    if (this.#migrate()) this.flush();
  }
  // Starter campaigns loaded before {{category_ar}} existed put English category names into Arabic
  // text. Swap the placeholder in Arabic steps of starter campaigns only; your own campaigns are untouched.
  #migrate() {
    let n = 0;
    for (const c of this.db.campaigns) {
      if (c.created_by !== "starter") continue;
      for (const st of c.steps || []) for (const k of ["subject", "body"]) {
        if (/[\u0600-\u06FF]/.test(st[k] || "") && st[k].includes("{{category}}")) { st[k] = st[k].replaceAll("{{category}}", "{{category_ar}}"); n++; }
      }
    }
    return n > 0;
  }
  #index() {
    this.byId = new Map(this.db.contacts.map((c) => [c.id, c]));
    this.byKey = new Map();
    for (const c of this.db.contacts) this.#key(c);
  }
  #key(c) {
    const ws = c.workspace_id;
    if (c.domain) this.byKey.set(`${ws}|d|${c.domain}`, c);
    if (c.email) this.byKey.set(`${ws}|e|${c.email}`, c);
    if (c.phone) this.byKey.set(`${ws}|p|${c.phone}`, c);
  }
  id() { return String(++this.db.seq); }
  now() { return new Date().toISOString(); }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.flushMs);
    this.timer.unref?.();
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }

  // ---- contacts
  find(wsId, { domain, email, phone }) {
    const ws = String(wsId);
    return (domain && this.byKey.get(`${ws}|d|${domain}`)) || (email && this.byKey.get(`${ws}|e|${email}`)) || (phone && this.byKey.get(`${ws}|p|${phone}`)) || null;
  }
  contacts(wsId) { const ws = String(wsId); return this.db.contacts.filter((c) => c.workspace_id === ws); }
  get(wsId, id) { const c = this.byId.get(String(id)); return c && c.workspace_id === String(wsId) ? c : null; }
  findByEmail(email) { for (const c of this.db.contacts) if (c.email === email) return c; return null; }
  findByPhone(phone) { for (const c of this.db.contacts) if (c.phone === phone) return c; return null; }
  findByToken(tok) { return this.db.contacts.find((c) => c.unsub_token === tok) || null; }

  add(wsId, fields) {
    const now = this.now();
    const c = { id: this.id(), workspace_id: String(wsId), stage: "new", tags: [], owner_id: null, email_opt_out: false, bounced: false, wa_opt_in: false,
      last_contacted_at: null, last_reply_at: null, deal_id: null, onboarding: {}, created_at: now, updated_at: now,
      unsub_token: crypto.randomBytes(12).toString("base64url"), ...fields };
    c.score = scoreContact(c);
    this.db.contacts.push(c); this.byId.set(c.id, c); this.#key(c);
    this.save();
    return c;
  }
  // Import: new stores are added; known stores (same link, email or phone) only get empty fields filled.
  upsertMany(wsId, rows, { tags = [], owner_ids = [] } = {}) {
    let added = 0, updated = 0, rr = 0;
    for (const r of rows) {
      const cur = this.find(wsId, r);
      if (cur) {
        let ch = false;
        for (const [k, v] of Object.entries(r)) if (v && !cur[k]) { cur[k] = v; ch = true; }
        if (r.wa_opt_in && !cur.wa_opt_in) { cur.wa_opt_in = true; ch = true; }
        for (const t of tags) if (!cur.tags.includes(t)) { cur.tags.push(t); ch = true; }
        if (ch) { cur.score = scoreContact(cur); cur.updated_at = this.now(); this.#key(cur); updated++; }
      } else {
        const owner_id = owner_ids.length ? owner_ids[rr++ % owner_ids.length] : null;
        this.add(wsId, { ...r, tags: [...tags], owner_id });
        added++;
      }
    }
    this.save();
    return { added, updated, skipped: rows.length - added - updated };
  }
  update(wsId, id, fields) {
    const c = this.get(wsId, id);
    if (!c) return null;
    Object.assign(c, fields, { updated_at: this.now() });
    c.score = scoreContact(c); this.#key(c);
    this.save();
    return c;
  }
  remove(wsId, ids) {
    const set = new Set(ids.map(String));
    const gone = this.db.contacts.filter((c) => c.workspace_id === String(wsId) && set.has(c.id));
    if (!gone.length) return 0;
    const del = new Set(gone.map((c) => c.id));
    this.db.contacts = this.db.contacts.filter((c) => !del.has(c.id));
    this.db.enrollments = this.db.enrollments.filter((e) => !del.has(e.contact_id));
    this.db.messages = this.db.messages.filter((m) => !del.has(m.contact_id));
    this.db.notes = this.db.notes.filter((n) => !del.has(n.contact_id));
    this.#index(); this.save();
    return gone.length;
  }
  query(wsId, filter) {
    const f = cleanFilter(filter), now = Date.now();
    return this.contacts(wsId).filter((c) => matches(c, f, now));
  }

  // ---- campaigns and enrollments
  campaigns(wsId) { return this.db.campaigns.filter((c) => c.workspace_id === String(wsId)); }
  campaign(wsId, id) { return this.db.campaigns.find((c) => c.workspace_id === String(wsId) && c.id === String(id)) || null; }
  addCampaign(wsId, fields) {
    const now = this.now();
    const c = { id: this.id(), workspace_id: String(wsId), status: "draft", steps: [], filter: {}, daily_limit: 150, window: { from: 9, to: 21, skip_friday: true },
      stop_on_reply: true, start_at: null, trigger: "", created_at: now, updated_at: now, launched_at: null, ...fields };
    this.db.campaigns.push(c); this.save();
    return c;
  }
  updateCampaign(wsId, id, fields) {
    const c = this.campaign(wsId, id);
    if (!c) return null;
    Object.assign(c, fields, { updated_at: this.now() }); this.save();
    return c;
  }
  deleteCampaign(wsId, id) {
    const c = this.campaign(wsId, id);
    if (!c) return false;
    this.db.campaigns = this.db.campaigns.filter((x) => x !== c);
    this.db.enrollments = this.db.enrollments.filter((e) => e.campaign_id !== c.id);
    this.save();
    return true;
  }
  enroll(campaign, contacts, startAt) {
    const active = new Set(this.db.enrollments.filter((e) => e.campaign_id === campaign.id).map((e) => e.contact_id));
    let n = 0;
    for (const c of contacts) {
      if (active.has(c.id)) continue;
      this.db.enrollments.push({ id: this.id(), campaign_id: campaign.id, workspace_id: campaign.workspace_id, contact_id: c.id, step: 0, next_at: startAt, status: "active", created_at: this.now() });
      n++;
    }
    this.save();
    return n;
  }
  enrollments(campaignId) { return this.db.enrollments.filter((e) => e.campaign_id === String(campaignId)); }
  stopEnrollments(contactId, status, { types = null } = {}) {
    let n = 0;
    for (const e of this.db.enrollments) {
      if (e.contact_id !== contactId || e.status !== "active") continue;
      if (types) { const camp = this.db.campaigns.find((c) => c.id === e.campaign_id); if (!camp || !types.includes(camp.type)) continue; }
      e.status = status; n++;
    }
    if (n) this.save();
    return n;
  }

  // ---- messages and notes
  addMessage(m) {
    const msg = { id: this.id(), at: this.now(), ...m };
    this.db.messages.push(msg);
    if (this.db.messages.length > MAX_MESSAGES) this.db.messages.splice(0, this.db.messages.length - MAX_MESSAGES);
    this.save();
    return msg;
  }
  messagesFor(contactId) { return this.db.messages.filter((m) => m.contact_id === String(contactId)); }
  message(wsId, id) { return this.db.messages.find((m) => m.workspace_id === String(wsId) && m.id === String(id)) || null; }
  addNote(wsId, contactId, text, by) { const n = { id: this.id(), workspace_id: String(wsId), contact_id: String(contactId), text, by, at: this.now() }; this.db.notes.push(n); this.save(); return n; }
  notesFor(contactId) { return this.db.notes.filter((n) => n.contact_id === String(contactId)); }

  removeWorkspace(wsId) {
    const ws = String(wsId);
    for (const k of ["contacts", "campaigns", "enrollments", "messages", "notes", "imports"]) this.db[k] = this.db[k].filter((x) => x.workspace_id !== ws);
    this.#index(); this.save();
  }
}
