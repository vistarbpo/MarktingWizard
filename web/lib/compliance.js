// Security & compliance (Saudi PDPL + good SaaS practice): the data register (records of processing),
// data subject requests (find, export, delete across modules), sub-processors, policy templates,
// quarterly access reviews, live security checks and the personal-data-breach checklist.
// Every legal number here is a configurable default to verify with a lawyer: see docs/security-compliance.md.
import { normEmail, normPhone } from "./crm.js";

export const SETTINGS_DEFAULTS = {
  dsr_days: 30, // PDPL Implementing Regulations: respond within 30 days (verify the current rule)
  breach_regulator_hours: 72, // notify SDAIA within 72 hours of becoming aware (verify)
  breach_subjects_hours: 72, // affected people: "without undue delay" where harm is likely; target set here (verify)
  inactive_days: 90,
  min_password: 16,
};
export const VERIFY_NOTE = "Verify the current PDPL rule with your lawyer before relying on this number.";

export const DSR_TYPES = [
  { id: "access", name: "Access (what data do you hold?)" },
  { id: "export", name: "Copy / export of my data" },
  { id: "correction", name: "Correction" },
  { id: "deletion", name: "Deletion (destruction)" },
  { id: "objection", name: "Withdraw consent / stop marketing" },
];
export const DSR_TYPE_IDS = DSR_TYPES.map((t) => t.id);
export const DSR_STATUS = ["open", "in_progress", "completed", "rejected"];

const DAY = 864e5;
export function dsrDue(receivedIso, days = SETTINGS_DEFAULTS.dsr_days) {
  const t = Date.parse(String(receivedIso).length === 10 ? receivedIso + "T00:00:00Z" : receivedIso);
  return new Date(t + Number(days) * DAY).toISOString().slice(0, 10);
}
export function dsrState(r, days, now = Date.now()) {
  const due = dsrDue(r.received_at, days);
  const daysLeft = Math.ceil((Date.parse(due + "T00:00:00Z") - now) / DAY);
  const closed = ["completed", "rejected"].includes(r.status);
  return { due, days_left: daysLeft, overdue: !closed && daysLeft < 0, due_soon: !closed && daysLeft >= 0 && daysLeft <= 7 };
}

// ---- the data register: what the dashboard actually holds. Retention and legal bases are starting points.
export const REGISTER_STARTER = [
  { key: "crm_contacts", name: "Store CRM contacts", module: "crm",
    data: "Store name, website, contact person name, business email, phone/WhatsApp number, city, platform, notes, every email/WhatsApp message sent and received, unsubscribe status.",
    subjects: "Online store owners and their staff (prospects and customers).",
    purpose: "B2B outreach, sales follow-up and onboarding of DPA AD customers.",
    legal_basis: "[CONFIRM] Consent for marketing messages (opt-in for WhatsApp); legitimate interest or pre-contract steps for business contacts. Check PDPL direct-marketing rules before cold email.",
    where: "crm.json in DATA_DIR on Hostinger [CONFIRM data-centre country]; copies in encrypted backups.",
    retention: "[CONFIRM] Until the store asks to stop or 24 months after the last contact; unsubscribed stores keep only the opt-out flag.",
    source: "CSV imports (confirm source and consent of each list), replies, website forms." },
  { key: "support_tickets", name: "Support tickets & website chat", module: "support",
    data: "Customer name, contact (email or WhatsApp), store, the conversation text.",
    subjects: "Customers and website visitors who write to support.",
    purpose: "Answer questions and fix problems; improve the help center.",
    legal_basis: "[CONFIRM] Performance of the contract / the person's request.",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM]; question text is sent to Anthropic to draft answers.",
    retention: "[CONFIRM] 24 months after the ticket is closed.", source: "Website chat, email, WhatsApp." },
  { key: "hr_candidates", name: "HR candidates", module: "team",
    data: "Name, email, phone, CV text, interview notes, scores, stage.",
    subjects: "Job applicants.", purpose: "Recruitment.",
    legal_basis: "[CONFIRM] Pre-contract steps at the applicant's request; consent to keep a CV for future roles.",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM]; CV text may be sent to Anthropic for screening.",
    retention: "[CONFIRM] 12 months after the role closes unless the applicant agrees to longer.", source: "Applications, referrals." },
  { key: "team_users", name: "Team users (dashboard logins)", module: "admin",
    data: "Name, work email, password hash (scrypt), role, teams, last sign-in time, activity log of changes.",
    subjects: "Employees, contractors, advisers with a login.", purpose: "Access control and accountability.",
    legal_basis: "[CONFIRM] Employment / service contract; legitimate interest in security.",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM].", retention: "[CONFIRM] Account removed when the person leaves; activity log keeps the last 2,000 changes.", source: "Added by an Owner or Admin." },
  { key: "sales_deals", name: "Sales deals", module: "sales",
    data: "Store name, contact name, email, phone, notes, AI drafts and activity.",
    subjects: "Prospect and customer contacts.", purpose: "Sales pipeline.",
    legal_basis: "[CONFIRM] Legitimate interest / pre-contract steps.", where: "db.json in DATA_DIR on Hostinger [CONFIRM].",
    retention: "[CONFIRM] 24 months after the deal is closed or lost.", source: "Entered by the team, CRM hand-off." },
  { key: "meetings_notes", name: "Meeting notes and transcripts", module: "meetings",
    data: "Meeting title, date, attendees (team users; outside people's names, emails and organisation), agenda, pasted notes or transcripts (may include anything said), AI drafts (summary, decisions, action items) and follow-up emails.",
    subjects: "Team members, prospects, customers, partners, investors and job candidates who attend meetings.",
    purpose: "Record what was agreed and turn it into owned tasks; follow up with the people met.",
    legal_basis: "[CONFIRM] Legitimate interest (running the business) / pre-contract steps; tell outside attendees before recording or transcribing a call.",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM]; notes are sent to Anthropic to draft the action items. Investor and hiring meetings are visible only to Owner/Admin and their attendees.",
    retention: "[CONFIRM] 24 months after the meeting, sooner for hiring meetings (with the candidate's record).", source: "Notes and transcripts pasted or uploaded by the team." },
  { key: "partner_contacts", name: "Partner contacts and referral clicks", module: "partners",
    data: "Partner name, type, contact name, email and phone, city, agreement and contract link, notes, change log, AI email drafts; referral clicks as a hashed IP + day and the browser family only; commission statements (kept for accounting).",
    subjects: "People at agencies, freelancers, creators, platform and tech partners, resellers, and customers who refer customers; visitors of referral links (no identity).",
    purpose: "Run the partner program: referral links, attribution, commission statements and payments.",
    legal_basis: "[CONFIRM] Contract with the partner; legitimate interest for prospects and click counting.",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM]; partner details are sent to Anthropic when an email is drafted. The /r/ link sets a first-party referral cookie (dpa_ref) for 60 days [CONFIRM cookie notice].",
    retention: "[CONFIRM] Contacts 24 months after the partnership ends; statements as long as accounting records must be kept; clicks 24 months.", source: "Entered by the team; referral link visits." },
  { key: "finance_records", name: "Finance records", module: "finance",
    data: "Expenses, income, vendors, bank-balance snapshots. May include names of payees and payroll amounts.",
    subjects: "Vendors, employees (payroll), customers (income).", purpose: "Bookkeeping, VAT and Zakat.",
    legal_basis: "Legal obligation (accounting, VAT/Zakat record keeping) [CONFIRM retention period with your accountant].",
    where: "db.json in DATA_DIR on Hostinger [CONFIRM].", retention: "[CONFIRM] As required by ZATCA / accounting law.", source: "Entered by the team, bank statements." },
  { key: "media", name: "Media files (Creative Studio)", module: "creative",
    data: "Images and videos uploaded for content, which may show people (staff, customers, models).",
    subjects: "People who appear in photos or videos.", purpose: "Marketing content.",
    legal_basis: "[CONFIRM] Consent / release from each person shown.", where: "DATA_DIR/media on Hostinger [CONFIRM]; published copies on social platforms.",
    retention: "[CONFIRM] While used in content; delete when consent is withdrawn.", source: "Uploads by the team." },
];
export const REGISTER_FIELDS = ["name", "data", "subjects", "purpose", "legal_basis", "where", "retention", "source", "module", "notes"];

// ---- sub-processors. Countries and DPA status are for the founder to confirm; nothing is assumed signed.
export const VENDOR_STARTER = [
  { name: "Hostinger", role: "Hosting of the dashboard, db.json, crm.json, media and local backups", data: "All dashboard data", country: "[CONFIRM data-centre region chosen in hPanel]" },
  { name: "Anthropic", role: "AI drafting (Claude API)", data: "Text in prompts: brief, store and ticket text, CVs when screening", country: "United States [CONFIRM]" },
  { name: "Meta (WhatsApp Cloud API, Facebook, Instagram)", role: "WhatsApp messages, social publishing, comments", data: "Phone numbers, message text, published content", country: "[CONFIRM]" },
  { name: "Google (YouTube)", role: "Video publishing", data: "Published content, channel tokens", country: "[CONFIRM]" },
  { name: "TikTok", role: "Video publishing", data: "Published content, account tokens", country: "[CONFIRM]" },
  { name: "LinkedIn", role: "Company page publishing", data: "Published content, page tokens", country: "[CONFIRM]" },
  { name: "Moyasar", role: "Card payments (planned)", data: "Customer billing details", country: "Saudi Arabia [CONFIRM]" },
  { name: "Email provider (SMTP / IMAP)", role: "Outreach email, replies, backup emails", data: "Store emails, message text", country: "[CONFIRM provider and region]" },
  { name: "Off-site backup storage (S3-compatible)", role: "Encrypted backup copies", data: "Encrypted copy of all dashboard data", country: "[CONFIRM provider and region]" },
];
export const DPA_STATUS = ["unknown", "not_needed", "requested", "signed"];

// ---- policies: templates with [CONFIRM] placeholders. Never claims a certification.
const P = (title, purpose, body) => `# ${title}\n\n**Company:** DPA AD [CONFIRM legal entity name and CR number]\n**Owner:** [CONFIRM]\n**Applies to:** everyone with access to DPA AD systems and data.\n\n## Purpose\n${purpose}\n\n${body}\n\n## Review\nReviewed at least once a year and after any serious incident. [CONFIRM review month]\n\n> Template. DPA AD does not hold ISO 27001, SOC 2 or any other certification unless the founder adds proof here.`;
export const POLICY_STARTER = [
  { key: "infosec", title: "Information security policy", body: P("Information security policy", "How DPA AD protects the data of stores, customers and staff.",
    "## Principles\n- Least access: people get the role they need in Teams & roles, nothing more.\n- Personal logins only: the shared team password is for emergencies and is rotated [CONFIRM how often].\n- Secrets (API keys, BACKUP_KEY, TOKEN_KEY) live only in hPanel environment variables, never in git or chat.\n- Platform tokens are encrypted at rest (AES-256-GCM).\n- Backups run nightly, are encrypted and kept off-site.\n\n## Devices\n[CONFIRM: screen lock, disk encryption, updates on laptops and phones used for work]\n\n## Responsibilities\n- Owner: [CONFIRM]\n- Security contact: [CONFIRM email]") },
  { key: "access", title: "Access control policy", body: P("Access control policy", "Who may see and change what.",
    "## Rules\n- Every person has their own login; roles set None / View / Edit per module.\n- Finance and Teams & roles are limited to Owner/Admin (and Finance role for Finance).\n- Leavers are deactivated on their last day [CONFIRM process owner].\n- Quarterly access review in Security & compliance → Access review: keep / change / remove for each person, signed off by [CONFIRM reviewer].\n- Accounts with no sign-in for 90 days are removed or justified.\n\n## Passwords\n- At least 10 characters for personal logins; the team password at least 16.\n- Two-step login: [CONFIRM: planned, not yet available]") },
  { key: "incident", title: "Incident response policy", body: P("Incident response policy", "What we do when something breaks or data may be exposed.",
    "## Steps\n1. Log the incident in Operations → Incidents with severity.\n2. Contain: stop the cause, rotate any exposed secret.\n3. If personal data may be affected, flag it as a personal data breach: the checklist starts with deadlines.\n4. Notify the regulator (SDAIA) within [CONFIRM: 72 hours] of becoming aware, when the PDPL requires it.\n5. Notify affected people without undue delay where the breach may harm them [CONFIRM wording].\n6. Post a customer-facing update on the status page when customers are affected.\n7. Write the review within [CONFIRM] days: cause, fix, prevention.\n\n## Contacts\n- Incident lead: [CONFIRM]\n- Legal counsel: [CONFIRM]") },
  { key: "retention", title: "Data retention policy", body: P("Data retention policy", "How long we keep personal data and how we delete it.",
    "## Periods\nSee Security & compliance → Data register for each kind of data. [CONFIRM each period]\n\n## Deletion\n- Data subject deletion requests are handled in Security & compliance → Requests; a record that the deletion happened is kept without personal data.\n- Deleted data leaves backups as they rotate (14 nights + 8 weeks). [CONFIRM this is acceptable]\n- Unsubscribed stores keep only the opt-out so they are not contacted again.") },
  { key: "acceptable_use", title: "Acceptable use policy", body: P("Acceptable use policy", "How the team may use DPA AD systems and data.",
    "## Rules\n- Use customer and store data only for DPA AD work.\n- Do not export contact lists to personal devices or tools not listed in Sub-processors.\n- Do not paste secrets or personal data into tools that are not approved.\n- AI drafts are checked by a person before anything reaches a customer.\n- Report a lost device or suspicious email to [CONFIRM contact] at once.") },
  { key: "backup", title: "Backup and recovery policy", body: P("Backup and recovery policy", "How we make sure data can be restored.",
    "## Backups\n- Nightly at 02:00 Riyadh time: db.json, crm.json and media; encrypted with AES-256-GCM (BACKUP_KEY).\n- Kept: last 14 nightly + 8 weekly on the server; a copy off-site [CONFIRM provider].\n- BACKUP_KEY is stored by [CONFIRM: two people / password manager]; without it backups cannot be opened.\n\n## Recovery\n- Restore procedure: docs/security-compliance.md → Restore.\n- Test a restore every [CONFIRM: quarter] with \"Verify backup\" and a full restore to a test folder.\n- Recovery targets: lose at most [CONFIRM: 24 hours] of data; back online within [CONFIRM] hours.") },
];

// ---- breach checklist (hours after the team became aware)
export function breachChecklist(awareIso, s = SETTINGS_DEFAULTS) {
  const at = (h) => new Date(Date.parse(awareIso) + h * 3600e3).toISOString();
  return [
    { id: "contain", text: "Contain the breach: stop the cause, rotate exposed passwords and keys.", due_at: at(24) },
    { id: "assess", text: "Record the facts: what data, how many people, which categories, likely harm.", due_at: at(48) },
    { id: "regulator", text: `Notify SDAIA (the PDPL regulator) if required, within ${s.breach_regulator_hours} hours of becoming aware. Verify the current PDPL breach notification timeline.`, due_at: at(s.breach_regulator_hours) },
    { id: "subjects", text: `Notify affected people without undue delay if it may harm them (target ${s.breach_subjects_hours} hours). Verify the current PDPL breach notification timeline.`, due_at: at(s.breach_subjects_hours) },
    { id: "status", text: "Post a customer-facing update on the status page if customers are affected.", due_at: at(24) },
    { id: "review", text: "Write the post-incident review and update policies.", due_at: at(30 * 24) },
  ].map((x) => ({ ...x, done_at: null, by: "" }));
}

// ---- data subject requests: find / export / delete across modules
const digits = (v) => String(v || "").replace(/\D/g, "");
export function matcher({ email, phone }) {
  const e = normEmail(email), p = normPhone(phone) || digits(phone);
  const tail = p.length >= 9 ? p.slice(-9) : "";
  const emailIs = (v) => !!e && String(v || "").trim().toLowerCase() === e;
  const phoneIs = (v) => !!tail && digits(v).length >= 9 && digits(v).slice(-9) === tail;
  const mentions = (text) => {
    const t = String(text || "");
    return (!!e && t.toLowerCase().includes(e)) || (!!tail && digits(t).includes(tail));
  };
  return { e, tail, ok: !!(e || tail), emailIs, phoneIs, mentions, any: (v) => emailIs(v) || phoneIs(v) || mentions(v) };
}
export function findSubject({ store, crm }, subject) {
  const m = matcher(subject);
  if (!m.ok) return null;
  const contacts = (crm?.db.contacts || []).filter((c) => m.emailIs(c.email) || m.phoneIs(c.phone) || m.phoneIs(c.whatsapp));
  const tickets = store.db.support_tickets.filter((t) => m.any(t.contact) || t.messages.some((x) => x.from === "customer" && m.mentions(x.text)));
  const candidates = store.db.hr_candidates.filter((c) => m.emailIs(c.email) || m.phoneIs(c.phone));
  const deals = store.db.deals.filter((d) => m.emailIs(d.contact_email) || m.phoneIs(d.contact_phone));
  const dealMentions = store.db.deal_activities.filter((a) => m.mentions(a.text));
  // Billing customers (matched on the billing contact) and their survey answers (Customer Success).
  const billing = (store.db.billing_customers || []).filter((c) => m.emailIs(c.owner_email) || m.phoneIs(c.owner_phone));
  const billIds = new Set(billing.map((c) => c.id));
  const responses = (store.db.success_responses || []).filter((r) => billIds.has(r.customer_id));
  // Meetings: outside attendees matched by email; notes, summaries and follow-ups that mention the email or number.
  const meetingText = (x) => [x.notes, x.agenda, x.draft?.summary, ...(x.draft?.items || []).map((i) => i.text), x.followup?.body].join("\n");
  const meetings = (store.db.meetings_meetings || []).filter((x) => (x.attendees || []).some((a) => a.kind === "external" && m.emailIs(a.email)) || m.mentions(meetingText(x)));
  // Partners & referrals: the partner's contact email or phone.
  const partners = (store.db.partners_partners || []).filter((p) => m.emailIs(p.contact?.email) || m.phoneIs(p.contact?.phone));
  const ws = (id) => store.getWorkspace(id)?.brief?.company_name || id;
  return {
    crm_contacts: contacts.map((c) => ({ id: c.id, workspace_id: c.workspace_id, workspace: ws(c.workspace_id), label: c.store_name || c.domain || "Store", messages: crm.messagesFor(c.id).length, notes: crm.notesFor(c.id).length, sample: !!c.sample })),
    support_tickets: tickets.map((t) => ({ id: t.id, workspace_id: t.workspace_id, workspace: ws(t.workspace_id), label: `${t.channel || "Ticket"} · ${t.created_at.slice(0, 10)}`, messages: t.messages.length })),
    hr_candidates: candidates.map((c) => ({ id: c.id, workspace_id: c.workspace_id, workspace: ws(c.workspace_id), label: c.name || "Candidate" })),
    sales_deals: deals.map((d) => ({ id: d.id, workspace_id: d.workspace_id, workspace: ws(d.workspace_id), label: d.name || "Deal" })),
    billing_customers: billing.map((c) => ({ id: c.id, workspace_id: c.workspace_id, workspace: ws(c.workspace_id), label: c.store_name || "Customer" })),
    survey_responses: responses.map((r) => ({ id: r.id, workspace_id: r.workspace_id, customer_id: r.customer_id, label: `${r.kind || "Survey"} · ${String(r.answered_at || r.created_at || "").slice(0, 10)}` })),
    meetings: meetings.map((x) => ({ id: x.id, workspace_id: x.workspace_id, workspace: ws(x.workspace_id), label: `${x.title} · ${x.date}`, attendee: (x.attendees || []).some((a) => a.kind === "external" && m.emailIs(a.email)) })),
    partners: partners.map((p) => ({ id: p.id, workspace_id: p.workspace_id, workspace: ws(p.workspace_id), label: p.name || "Partner" })),
    mentions: { deal_activities: dealMentions.length },
    total: contacts.length + tickets.length + candidates.length + deals.length + billing.length + responses.length + meetings.length + partners.length,
  };
}
export function exportSubject({ store, crm }, subject) {
  const f = findSubject({ store, crm }, subject);
  if (!f) return null;
  const strip = ({ unsub_token, ...c }) => c;
  return {
    generated_at: new Date().toISOString(), controller: "DPA AD [CONFIRM legal entity]",
    note: "Everything the DPA AD dashboard holds that matches this email or phone number.",
    crm_contacts: f.crm_contacts.map((x) => { const c = crm.get(x.workspace_id, x.id); return { ...strip(c), messages: crm.messagesFor(c.id), notes: crm.notesFor(c.id) }; }),
    support_tickets: f.support_tickets.map((x) => store.getTicket(x.workspace_id, x.id)),
    hr_candidates: f.hr_candidates.map((x) => ({ ...store.getHrCandidate(x.workspace_id, x.id), activities: store.listHrActivities("candidate", x.id) })),
    sales_deals: f.sales_deals.map((x) => { const d = store.getDeal(x.workspace_id, x.id); return { deal: d.name, contact_name: d.contact_name, contact_email: d.contact_email, contact_phone: d.contact_phone, city: d.city, notes: d.notes }; }),
    billing_customers: f.billing_customers.map((x) => { const c = store.db.billing_customers.find((y) => y.id === x.id); const { events, ...rest } = c || {}; return { ...rest, invoices: (store.db.billing_invoices || []).filter((v) => v.customer_id === x.id).map((v) => ({ number: v.number, issue_date: v.issue_date, status: v.status, total: v.totals?.total, currency: v.currency })) }; }),
    survey_responses: f.survey_responses.map((x) => { const r = store.db.success_responses.find((y) => y.id === x.id); return { kind: r.kind, score: r.score, comment: r.comment, answered_at: r.answered_at }; }),
    meetings: (f.meetings || []).map((x) => { const mt = store.db.meetings_meetings.find((y) => y.id === x.id); const mm = matcher(subject); return { title: mt.title, date: mt.date, time: mt.time, type: mt.type,
      attendee: (mt.attendees || []).find((a) => a.kind === "external" && mm.emailIs(a.email)) || null,
      notes_lines: String(mt.notes || "").split("\n").filter((l) => mm.mentions(l)), followup_sent: mt.followup?.sent ? { subject: mt.followup.subject, body: mt.followup.body, at: mt.followup.sent.at } : null }; }),
    partners: (f.partners || []).map((x) => { const p = store.db.partners_partners.find((y) => y.id === x.id); return { name: p.name, type: p.type, status: p.status, contact: p.contact, city: p.city, country: p.country, notes: p.notes,
      drafts: (store.db.partners_drafts || []).filter((d) => d.partner_id === p.id).map((d) => ({ kind: d.kind, subject: d.subject, body: d.body, at: d.created_at, sent: d.sent || null })) }; }),
  };
}
// Uses each module's own delete function. Deals are business records: only the contact fields are cleared.
export function deleteSubject({ store, crm }, subject) {
  const f = findSubject({ store, crm }, subject);
  if (!f) return null;
  const m = matcher(subject);
  const counts = { crm_contacts: 0, crm_messages: 0, support_tickets: 0, hr_candidates: 0, deal_contacts_cleared: 0, billing_contacts_cleared: 0, survey_responses: 0, mentions_redacted: 0, meeting_attendees_redacted: 0, partner_contacts_cleared: 0 };
  const byWs = {};
  for (const c of f.crm_contacts) { (byWs[c.workspace_id] ||= []).push(c.id); counts.crm_messages += c.messages; }
  for (const [ws, ids] of Object.entries(byWs)) counts.crm_contacts += crm.remove(ws, ids);
  for (const t of f.support_tickets) if (store.deleteTicket(t.workspace_id, t.id)) counts.support_tickets++;
  for (const c of f.hr_candidates) if (store.deleteHrCandidate(c.workspace_id, c.id)) counts.hr_candidates++;
  for (const d of f.sales_deals) { store.updateDeal(d.workspace_id, d.id, { contact_name: "", contact_email: "", contact_phone: "", by: "compliance" }); counts.deal_contacts_cleared++; }
  // Billing customers: issued invoices are kept for tax record-keeping (ZATCA); only the billing contact fields are cleared.
  for (const x of f.billing_customers) { const c = store.db.billing_customers.find((y) => y.id === x.id); if (c) { Object.assign(c, { owner_name: "", owner_email: "", owner_phone: "" }); counts.billing_contacts_cleared++; } }
  const gone = new Set(f.survey_responses.map((x) => x.id));
  if (gone.size) { store.db.success_responses = store.db.success_responses.filter((r) => !gone.has(r.id)); counts.survey_responses = gone.size; }
  // Free text that mentions the email or number (AI drafts, notes): replace the identifier.
  const redact = (t) => {
    let s = String(t || "");
    if (m.e) s = s.replace(new RegExp(m.e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[removed]");
    if (m.tail) s = s.replace(/\+?\d[\d\s-]{7,}\d/g, (x) => (digits(x).slice(-9) === m.tail ? "[removed]" : x));
    return s;
  };
  for (const a of store.db.deal_activities) if (m.mentions(a.text)) { a.text = redact(a.text); counts.mentions_redacted++; }
  // Meetings are business records: the outside attendee is replaced by "[removed]" and the email or number is redacted from the text.
  for (const x of f.meetings || []) {
    const mt = store.db.meetings_meetings.find((y) => y.id === x.id); if (!mt) continue;
    for (const a of mt.attendees || []) if (a.kind === "external" && m.emailIs(a.email)) { Object.assign(a, { name: "[removed]", email: "", org: "" }); counts.meeting_attendees_redacted++; }
    const before = JSON.stringify([mt.notes, mt.agenda, mt.draft, mt.followup]);
    mt.notes = redact(mt.notes); mt.agenda = redact(mt.agenda);
    if (mt.draft) { mt.draft.summary = redact(mt.draft.summary); for (const i of mt.draft.items || []) { i.text = redact(i.text); i.source = redact(i.source); } mt.draft.decisions = (mt.draft.decisions || []).map(redact); mt.draft.questions = (mt.draft.questions || []).map(redact); }
    if (mt.followup) { mt.followup.body = redact(mt.followup.body); mt.followup.subject = redact(mt.followup.subject); }
    if (JSON.stringify([mt.notes, mt.agenda, mt.draft, mt.followup]) !== before) counts.mentions_redacted++;
  }
  // Partners: the contact fields are cleared; the partner, its codes and its statements stay (accounting records).
  for (const x of f.partners || []) {
    const p = store.db.partners_partners.find((y) => y.id === x.id); if (!p) continue;
    p.contact = { name: "", email: "", phone: "" }; p.notes = redact(p.notes); counts.partner_contacts_cleared++;
    (p.log ||= []).push({ at: new Date().toISOString(), by: "compliance", text: "Contact details deleted on a data request" });
    for (const d of (store.db.partners_drafts || []).filter((y) => y.partner_id === p.id)) { d.body = redact(d.body); d.subject = redact(d.subject); }
  }
  store.save(); crm?.flush?.();
  return counts;
}

// ---- security checks computed from the live server
export function securityChecks({ env = process.env, password = "", store, crm, backupStatus, now = Date.now(), settings = SETTINGS_DEFAULTS }) {
  const users = store.db.users.filter((u) => u.active);
  const owners = users.filter((u) => u.role_id === "owner");
  const inactiveCut = now - settings.inactive_days * DAY;
  const stale = users.filter((u) => Date.parse(u.last_login_at || u.created_at || 0) < inactiveCut);
  const liveWs = Object.entries(crm?.db.settings || {}).filter(([, s]) => s?.mode === "live").map(([id]) => store.getWorkspace(id)?.brief?.company_name || id);
  const pub = env.PUBLIC_URL || "";
  const metaUsed = !!(env.META_APP_ID || env.WA_TOKEN);
  const metaMissing = [env.META_APP_ID && !env.META_APP_SECRET ? "META_APP_SECRET" : "", env.WA_TOKEN && !env.WA_APP_SECRET ? "WA_APP_SECRET" : ""].filter(Boolean);
  const tk = env.TOKEN_KEY || "";
  const c = (id, title, state, detail, fix = "") => ({ id, title, state, detail, fix }); // state: pass | warn | fail | info
  return [
    c("password", "Team password is long", !password ? "fail" : password.length >= settings.min_password ? "pass" : password.length >= 10 ? "warn" : "fail",
      password ? `DASHBOARD_PASSWORD has ${password.length} characters (aim for ${settings.min_password}+).` : "DASHBOARD_PASSWORD is not set: nobody can log in.", "hPanel → Node.js → Environment variables: set a long random DASHBOARD_PASSWORD. Changing it signs everyone out."),
    c("owner", "A personal Owner login exists", owners.length ? "pass" : "fail", owners.length ? `${owners.length} personal Owner account${owners.length > 1 ? "s" : ""}.` : "Only the shared team password has Owner access.", "Teams & roles → Add person with the Owner role, then rotate the team password."),
    c("token_key", "TOKEN_KEY is set", /^[0-9a-f]{64}$/i.test(tk) || tk.length >= 16 ? "pass" : tk ? "warn" : "fail", tk ? (/^[0-9a-f]{64}$/i.test(tk) ? "64-hex key set." : `Passphrase of ${tk.length} characters.`) : "Platform tokens are encrypted with a key derived from the team password.", "Set TOKEN_KEY to 64 random hex characters (openssl rand -hex 32). Reconnect social accounts after changing it."),
    c("backup_key", "BACKUP_KEY is set", env.BACKUP_KEY ? (env.BACKUP_KEY.length >= 16 ? "pass" : "warn") : "fail", env.BACKUP_KEY ? "Backups are encrypted with AES-256-GCM." : "Backups are not encrypted and are never sent off-site.", "Set BACKUP_KEY (openssl rand -hex 32) and store a copy in a password manager: without it backups can't be opened."),
    c("backups", "Backups are fresh", backupStatus?.fresh ? "pass" : "fail", backupStatus?.last_ok ? `Last good backup ${backupStatus.last_ok.at.slice(0, 16).replace("T", " ")} UTC.` : "No backup yet.", "Security & compliance → Backups → Back up now. Nightly runs need the server awake (external ping to /healthz)."),
    c("offsite", "Backups are copied off-site", backupStatus?.offsite?.s3?.configured || backupStatus?.offsite?.email?.configured ? (backupStatus.encrypted ? "pass" : "warn") : "warn", backupStatus?.offsite?.s3?.configured ? "S3-compatible storage configured." : backupStatus?.offsite?.email?.configured ? "Emailed to " + backupStatus.offsite.email.to + "." : "Only on the same server as the data.", "Set BACKUP_S3_* (Cloudflare R2, Backblaze B2, AWS S3) or BACKUP_EMAIL_TO."),
    c("inactive", `No active users idle for ${settings.inactive_days}+ days`, stale.length ? "warn" : "pass", stale.length ? `${stale.length} active account${stale.length > 1 ? "s have" : " has"} not signed in for ${settings.inactive_days}+ days: ${stale.map((u) => u.name).slice(0, 5).join(", ")}.` : "Every active account signed in recently.", "Run the access review and deactivate accounts that aren't needed."),
    c("crm_mode", "Store CRM sending mode", "info", liveWs.length ? `Live in: ${liveWs.join(", ")}. Real messages are sent.` : "Test mode everywhere: nothing is sent for real.", "Switch to Live only after a week in Test mode and with consent for the list."),
    c("https", "PUBLIC_URL uses HTTPS", /^https:\/\//i.test(pub) ? "pass" : pub ? "fail" : "warn", pub ? `PUBLIC_URL is ${pub}.` : "PUBLIC_URL is not set (defaults to https://wizard.dpa.ad for links).", "Set PUBLIC_URL=https://wizard.dpa.ad"),
    c("webhook_secret", "Meta webhook secrets are set", !metaUsed ? "info" : metaMissing.length ? "fail" : "pass", !metaUsed ? "Meta / WhatsApp not connected." : metaMissing.length ? `Missing ${metaMissing.join(" and ")}: webhooks can't be verified.` : "Webhook signatures are checked.", "Copy the App Secret from developers.facebook.com into META_APP_SECRET / WA_APP_SECRET."),
  ];
}

// ---- access review rows from Teams & roles
export const quarterOf = (t = Date.now()) => { const d = new Date(t + 3 * 3600e3); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
export function accessRows(store, now = Date.now(), inactiveDays = 90) {
  const role = (id) => store.db.roles.find((r) => r.id === id)?.name || id;
  return store.db.users.filter((u) => u.active).map((u) => {
    const last = u.last_login_at || null;
    const idle = Math.floor((now - Date.parse(last || u.created_at || now)) / DAY);
    return { user_id: u.id, name: u.name, email: u.email, role: role(u.role_id), role_id: u.role_id, last_login_at: last, idle_days: idle,
      suggestion: idle >= inactiveDays ? "remove" : "keep", reason: idle >= inactiveDays ? `No sign-in for ${idle} days` : "" };
  });
}

// ---- AI prompts (AI Compliance officer). Facts come from the dashboard; gaps are [CONFIRM].
export function policyPrompt(ws, policy, facts) {
  return `<task title="Draft policy: ${policy.title}">
You are DPA AD's AI Compliance officer. Improve this policy draft for a small Saudi SaaS company (pre-launch, a handful of people) under the Saudi Personal Data Protection Law (PDPL) and good SaaS security practice.
Rules:
- Plain, short English. Keep it practical for a team of under 10.
- Use only the facts given below. Anything you don't know (names, periods, providers, countries) becomes a [CONFIRM ...] placeholder.
- Never claim a certification (ISO 27001, SOC 2, NCA ECC compliance, etc.) or an audit that is not in the facts.
- Never state legal deadlines as certain: write them as "[CONFIRM: 72 hours]" style placeholders.
- Return the full policy as Markdown, starting with "# ${policy.title}".
</task>
<company>${ws?.brief?.company_name || "DPA AD"} · ${ws?.brief?.website || ""}</company>
<facts>
${facts}
</facts>
<current_draft>
${policy.body}
</current_draft>`;
}
export function statusPrompt(inc, components) {
  return `<task title="Status page update">
You are DPA AD's AI Compliance officer drafting a customer-facing status page update from an internal incident.
Rules: no internal details (names, hostnames, secrets, root-cause guesses); no promises of times you don't have; short and calm; say what customers notice and what we're doing.
Give an English and a Saudi-dialect Arabic version. Reply ONLY with JSON:
{"title_en":"...","title_ar":"...","text_en":"...","text_ar":"...","impact":"degraded|outage|maintenance","components":["${components.join('","')}"]}
(components: only the affected ones from that list)
</task>
<incident>
Title: ${inc.title}
Severity: ${inc.severity}
Status: ${inc.status}
Impact (internal): ${inc.impact || "not written"}
Updates: ${(inc.updates || []).map((u) => `${u.at.slice(0, 16)} ${u.text}`).join(" | ") || "none"}
</incident>`;
}
export function parseStatusDraft(text) {
  const raw = /\{[\s\S]*\}/.exec(String(text || ""))?.[0];
  try { const j = JSON.parse(raw); return { title_en: String(j.title_en || ""), title_ar: String(j.title_ar || ""), text_en: String(j.text_en || ""), text_ar: String(j.text_ar || ""), impact: j.impact, components: Array.isArray(j.components) ? j.components : [] }; }
  catch { return { title_en: "", title_ar: "", text_en: String(text || "").replace(/^#+.*$/gm, "").trim().slice(0, 1000), text_ar: "", impact: null, components: [] }; }
}
