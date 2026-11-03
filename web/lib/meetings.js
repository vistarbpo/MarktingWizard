// Meetings → tasks (module "meetings"): meetings with Riyadh date/time, type, attendees (team users and outside
// people), links to a Sales deal, a Store CRM store, a Billing / Customer Success customer or a hiring candidate,
// and an agenda. Notes come in as pasted text or a .txt / .vtt / .srt / .docx file (VTT/SRT become plain
// "Speaker: line" text; .docx is read with zlib, no new dependency). No audio transcription on the server.
// The AI Meeting secretary (level 1, drafts only) drafts a summary, decisions, open questions and action items
// from the notes only; the JSON is checked (no numbers or quotes that aren't in the notes, every item grounded in a
// line of the notes) and, when it fails or the AI is off, a factual draft is built by fixed rules from the lines
// that start with "Action:", "TODO", "- [ ]", "سوف", "المطلوب"… A person reviews, edits owner/date/module and ticks
// which items to create; each one goes to its home module (meetingsroutes.js) and links back to the meeting.
// Investor and hiring meetings are seen only by Owner/Admin, their attendees and whoever created them.
import { inflateRawSync } from "node:zlib";
import { withAgent } from "./agents.js";
import { normEmail, riyadhDay } from "./crm.js";

export const COLL = { meetings: "meetings_meetings", items: "meetings_items" };
export function ensureMeetings(store) { for (const c of Object.values(COLL)) store.db[c] ||= []; }
export const AGENT_ID = "meeting_secretary";
export const TYPES = [
  { id: "internal", name: "Internal" },
  { id: "sales_call", name: "Sales call" },
  { id: "customer", name: "Customer" },
  { id: "partner", name: "Partner" },
  { id: "investor", name: "Investor" },
  { id: "hiring", name: "Hiring" },
];
export const TYPE_IDS = TYPES.map((t) => t.id);
export const RESTRICTED = ["investor", "hiring"]; // seen only by Owner/Admin, attendees and the creator
export const SEE_ALL_ROLES = ["owner", "admin"];
export const MANAGER_ROLES = ["owner", "admin", "manager"];
// Where an action item can go. `link` is the meeting link it needs; `module` is the access module checked (Edit).
export const TARGETS = [
  { id: "ops", name: "Operations task", module: "ops", link: null, route: "ops" },
  { id: "deal", name: "Sales next action (linked deal)", module: "sales", link: "deal_id", route: "pipeline" },
  { id: "crm", name: "Store CRM note (linked store)", module: "crm", link: "store_id", route: "crm" },
  { id: "success", name: "Customer Success task (linked customer)", module: "success", link: "customer_id", route: "success" },
  { id: "hiring", name: "Hiring activity (linked candidate)", module: "team", link: "candidate_id", route: "team" },
  { id: "okr", name: "Goals check-in note (pick a key result)", module: "okr", link: null, route: "okr" },
];
export const TARGET_IDS = TARGETS.map((t) => t.id);
export const LINK_KEYS = ["deal_id", "store_id", "customer_id", "candidate_id"];
export const NOTES_MAX = 200_000, AGENDA_MAX = 4000, ATTENDEES_MAX = 40, ITEMS_MAX = 40, REVIEW_DAYS = 2;
const RIYADH_MS = 3 * 3600e3, DAY = 864e5;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""));
export const todayOf = (now) => riyadhDay(new Date(now));
export const startsAt = (date, time) => new Date(Date.parse(`${date}T${time}:00Z`) - RIYADH_MS).toISOString();
const daysSince = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0);

// ---- people and visibility
export function people(store) {
  return [{ id: "owner", name: "Owner" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, email: u.email || "" }))];
}
export function canSee(user, m) {
  if (!m) return false;
  if (!RESTRICTED.includes(m.type)) return true;
  if (!user) return false;
  if (SEE_ALL_ROLES.includes(user.role_id)) return true;
  if (m.created_by_id && m.created_by_id === user.id) return true;
  return (m.attendees || []).some((a) => a.user_id && a.user_id === user.id);
}
export const isExternal = (m) => m.type !== "internal" || (m.attendees || []).some((a) => a.kind === "external");

// ---- cleaning
export function cleanAttendees(list, store) {
  const err = [], out = [];
  if (!Array.isArray(list)) return { out, err: list === undefined || list === null || list === "" ? [] : ["attendees must be a list"] };
  const team = people(store);
  for (const a of list.slice(0, ATTENDEES_MAX)) {
    if (a?.user_id) {
      const p = team.find((x) => x.id === String(a.user_id));
      if (!p) { err.push(`Unknown team member: ${String(a.user_id).slice(0, 40)}`); continue; }
      if (!out.some((x) => x.user_id === p.id)) out.push({ kind: "user", user_id: p.id, name: p.name });
      continue;
    }
    const name = str(a?.name, 120), rawEmail = str(a?.email, 200), email = normEmail(rawEmail);
    if (!name && !email) continue;
    if (rawEmail && !email) { err.push(`Not a valid email: ${rawEmail.slice(0, 60)}`); continue; }
    out.push({ kind: "external", name: name || email, email, org: str(a?.org, 120) });
  }
  return { out, err };
}
export function cleanMeeting(b = {}, { store, partial = false } = {}) {
  const out = {}, err = [];
  if (b.title !== undefined || !partial) { out.title = str(b.title, 200); if (!out.title) err.push(partial ? "title cannot be empty" : "title is required"); }
  if (b.date !== undefined || !partial) { if (!isDate(b.date)) err.push("date must be YYYY-MM-DD (Riyadh)"); else out.date = b.date; }
  if (b.time !== undefined || !partial) { const t = b.time === undefined || b.time === "" ? "10:00" : String(b.time); if (!isTime(t)) err.push("time must be HH:MM (Riyadh, 24 h)"); else out.time = t; }
  if (b.duration_min !== undefined) { const n = Math.round(Number(b.duration_min)); if (!(n >= 5 && n <= 600)) err.push("duration_min must be 5–600"); else out.duration_min = n; }
  if (b.type !== undefined || !partial) { const t = b.type === undefined ? "internal" : b.type; if (!TYPE_IDS.includes(t)) err.push(`type must be one of ${TYPE_IDS.join(", ")}`); else out.type = t; }
  if (b.agenda !== undefined) out.agenda = String(b.agenda ?? "").slice(0, AGENDA_MAX);
  if (b.attendees !== undefined) { const a = cleanAttendees(b.attendees, store); err.push(...a.err); out.attendees = a.out; }
  if (b.links !== undefined) {
    const l = b.links && typeof b.links === "object" ? b.links : {};
    out.links = Object.fromEntries(LINK_KEYS.map((k) => [k, l[k] ? str(l[k], 40) : null]));
  }
  return { out, err };
}

// ---- notes in: VTT / SRT / docx / txt
const stripTags = (s) => String(s).replace(/<\/?(?:c|i|b|u|ruby|rt|lang)(?:\.[^>]*)?(?:\s[^>]*)?>/gi, "").replace(/<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "").replace(/\{\\[^}]*\}/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
const TS = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
// One cue's text lines → [speaker, text]. Speakers come from <v Name>, "Name: text" or "[Name] text".
function cueLines(lines) {
  const out = [];
  for (const raw of lines) {
    let speaker = "", s = raw;
    const v = /^<v(?:\.[^\s>]*)?\s+([^>]+)>(.*?)(?:<\/v>)?$/i.exec(s.trim());
    if (v) { speaker = v[1].trim(); s = v[2]; }
    s = stripTags(s);
    if (!speaker) { const b = /^\[([^\]]{1,60})\]\s*(.+)$/.exec(s); if (b) { speaker = b[1].trim(); s = b[2]; } }
    if (!speaker) { const c = /^([^:：]{1,40})[:：]\s+(.+)$/.exec(s); if (c && !/https?$/i.test(c[1])) { speaker = c[1].trim(); s = c[2]; } }
    if (s.trim()) out.push([speaker, s.trim()]);
  }
  return out;
}
// Consecutive lines from the same speaker are joined into one line.
function joinSpeakers(pairs) {
  const out = [];
  for (const [sp, t] of pairs) {
    const last = out[out.length - 1];
    if (last && sp && last[0] === sp) last[1] += " " + t;
    else if (last && !sp && !last[0]) last[1] += " " + t;
    else out.push([sp, t]);
  }
  return out.map(([sp, t]) => (sp ? `${sp}: ${t}` : t)).join("\n");
}
export function parseVtt(text) {
  const blocks = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const pairs = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (/^WEBVTT\b/.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const at = lines.findIndex((l) => TS.test(l));
    if (at < 0) continue;
    pairs.push(...cueLines(lines.slice(at + 1)));
  }
  return joinSpeakers(pairs);
}
export function parseSrt(text) {
  const blocks = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const pairs = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    const at = lines.findIndex((l) => TS.test(l));
    if (at < 0) continue;
    pairs.push(...cueLines(lines.slice(at + 1)));
  }
  return joinSpeakers(pairs);
}
// The text of word/document.xml inside a .docx (a zip), with paragraphs as lines. Throws on anything else.
export function docxText(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("Not a .docx file.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a .docx file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name !== "word/document.xml") continue;
    if (usize > 20e6) throw new Error("The document is too large.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    const xml = (method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 25e6 }) : null)?.toString("utf8");
    if (xml == null) throw new Error("This .docx uses a compression we can't read: save it as .txt.");
    return xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&")
      .split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  throw new Error("No document text found in this .docx.");
}
// Text from an uploaded file: { text } or { error }. Audio and video are refused (no transcription on the server).
export function notesFromFile(filename, { text = null, b64 = null } = {}) {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(filename || "")) || [])[1]?.toLowerCase() || "";
  if (["mp3", "m4a", "wav", "ogg", "webm", "mp4", "mov", "aac", "flac"].includes(ext)) return { error: "Audio and video can't be transcribed on this server. Paste the transcript from your meeting tool (Zoom, Meet, Teams) or upload its .vtt/.srt file." };
  if (ext === "docx") {
    if (!b64) return { error: "Send the .docx file content." };
    try { return { text: docxText(Buffer.from(String(b64), "base64")) }; } catch (e) { return { error: e.message }; }
  }
  if (!["txt", "vtt", "srt", "md", "text", ""].includes(ext)) return { error: "Upload a .txt, .vtt, .srt or .docx file, or paste the notes." };
  const raw = text != null ? String(text) : b64 ? Buffer.from(String(b64), "base64").toString("utf8") : "";
  if (ext === "vtt" || /^﻿?WEBVTT/.test(raw)) return { text: parseVtt(raw) };
  if (ext === "srt") return { text: parseSrt(raw) };
  return { text: raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "") };
}

// ---- rule-based extractor (the factual fallback)
const AR_DIGITS = /[٠-٩]/g;
export const normDigits = (s) => String(s || "").replace(AR_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const norm = (s) => normDigits(s).toLowerCase().replace(/[\s‏‎]+/g, " ").replace(/[“”«»"]/g, '"').trim();
const ACTION_EN = /^(?:-\s*)?\[\s?\]\s*|^(?:action(?:\s*items?)?|todo|to-?do|next\s*steps?|follow[- ]?up|task)\s*[:：\-–]\s*/i;
const ACTION_AR = /^(?:المطلوب|مطلوب|مهمة|إجراء|اجراء|متابعة)\s*[:：\-–]?\s*|^(?:سوف|سيقوم|ستقوم|سنقوم|سأقوم|راح)\s+/;
const DECISION = /^(?:decision|decided|agreed)\s*[:：\-–]\s*|^(?:قرار|قررنا|تم الاتفاق|اتفقنا)\s*[:：\-–]?\s*/i;
const BULLET = /^\s*(?:[-*•·–]\s+|\d{1,2}[.)]\s+)/;
function firstNames(attendees) { return (attendees || []).filter((a) => a.name).map((a) => ({ a, first: a.name.split(/\s+/)[0].toLowerCase() })).filter((x) => x.first.length >= 2); }
export function guessOwner(text, attendees, speaker = "") {
  const t = ` ${String(text).toLowerCase()} `;
  for (const { a, first } of firstNames(attendees)) if (new RegExp(`(?:^|[\\s@(،,])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s:،,.)])`, "i").test(t)) return a;
  if (speaker) { const s = speaker.toLowerCase(); const hit = (attendees || []).find((a) => a.name && (a.name.toLowerCase() === s || a.name.split(/\s+/)[0].toLowerCase() === s.split(/\s+/)[0])); if (hit) return hit; }
  return null;
}
export function guessDue(text) { const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(normDigits(text)); return m && isDate(m[1]) ? m[1] : null; }
// Lines of the notes that look like action items, decisions and open questions. Never adds words of its own.
export function ruleExtract(notes, attendees = []) {
  const items = [], decisions = [], questions = [];
  for (const line of String(notes || "").split("\n")) {
    let s = line.replace(BULLET, "").trim();
    if (!s || s.length < 3) continue;
    let speaker = "";
    const test = (x) => ACTION_EN.test(x) || ACTION_AR.test(x);
    let body = null;
    if (test(s)) body = s;
    else {
      const sp = /^([^:：]{1,40})[:：]\s+(.+)$/.exec(s);
      if (sp && test(sp[2].replace(BULLET, ""))) { speaker = sp[1].trim(); body = sp[2].replace(BULLET, ""); }
    }
    if (body) {
      const keepVerb = ACTION_AR.test(body) && /^(?:سوف|سيقوم|ستقوم|سنقوم|سأقوم|راح)\s/.test(body); // "سوف أرسل…" keeps its verb
      const text = (keepVerb ? body : body.replace(ACTION_EN, "").replace(ACTION_AR, "")).trim().slice(0, 300);
      if (text.length >= 2 && items.length < ITEMS_MAX) {
        const o = guessOwner(text, attendees, speaker);
        items.push({ text, owner_id: o?.user_id || null, owner_name: o?.name || "", due: guessDue(text), source: line.trim().slice(0, 400) });
      }
      continue;
    }
    if (DECISION.test(s)) { decisions.push(s.replace(DECISION, "").trim().slice(0, 300)); continue; }
    const q = s.replace(/^[^:：]{1,40}[:：]\s+/, "");
    if (/[?؟]\s*$/.test(q) && q.length >= 6) questions.push(q.slice(0, 300));
  }
  return { items, decisions: decisions.slice(0, 20), questions: questions.slice(0, 20) };
}
export function ruleDraft(m) {
  const r = ruleExtract(m.notes, m.attendees);
  return {
    summary: `[ADD] Summary: write two or three lines on what this meeting was about. The lines below were found in the notes by fixed rules (lines starting with "Action:", "TODO", "- [ ]", "Decision:", "سوف", "المطلوب"… and questions).`,
    decisions: r.decisions, questions: r.questions,
    items: r.items.map((x) => ({ ...x, target: "ops" })),
  };
}

// ---- the AI Meeting secretary
export function secretaryPrompt(w, m, today) {
  const att = (m.attendees || []).map((a) => `- ${a.name}${a.kind === "external" ? " (outside DPA AD)" : " (team)"}`).join("\n") || "- [none listed]";
  const links = LINK_KEYS.filter((k) => m.links?.[k]).map((k) => k.replace("_id", "")).join(", ") || "none";
  return `<task title="Meeting secretary: summary and action items">
You are DPA AD's AI Meeting secretary. From the meeting notes below, draft a short summary, the decisions, the open questions and the action items.
Strict rules:
- Use only what is in the notes. Never invent numbers, prices, dates, customers, names, quotes or commitments.
- No quotation marks in the summary or decisions unless the quoted words appear exactly in the notes.
- Every action item has "source": the exact line of the notes it comes from (copied, not rewritten).
- "owner": the attendee's name exactly as listed below if the notes say who does it; otherwise "[ADD]".
- "due": a date YYYY-MM-DD only if the notes give one or a clear day (today is ${today}, Riyadh); otherwise "[ADD]".
- "module": where the item belongs: "ops" (an internal task, the default), "deal" (a sales next step; this meeting links a deal: ${m.links?.deal_id ? "yes" : "no"}), "crm" (a note on the store; links a store: ${m.links?.store_id ? "yes" : "no"}), "success" (a customer success follow-up; links a customer: ${m.links?.customer_id ? "yes" : "no"}), "hiring" (a candidate step; links a candidate: ${m.links?.candidate_id ? "yes" : "no"}).
- Write in the notes' language (Saudi Arabic or English). Keep each item one short line.
Reply with JSON only:
{"summary": "2-4 sentences", "decisions": ["..."], "open_questions": ["..."], "action_items": [{"text": "...", "owner": "name or [ADD]", "due": "YYYY-MM-DD or [ADD]", "module": "ops", "source": "exact line from the notes"}]}
</task>
<meeting title="${String(m.title).replace(/"/g, "'")}" type="${m.type}" date="${m.date}" links="${links}">
<attendees>
${att}
</attendees>
${m.agenda ? `<agenda>\n${m.agenda}\n</agenda>\n` : ""}<notes>
${m.notes}
</notes>
</meeting>`;
}
const numbersIn = (s) => (normDigits(s).match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/,/g, ""));
const quotesIn = (s) => [...String(s).matchAll(/"([^"]{3,})"|“([^”]{3,})”|«([^»]{3,})»/g)].map((x) => x[1] || x[2] || x[3]);
// Check the AI's JSON. Returns { ok, draft, issues }: ok=false means use the factual draft instead.
export function checkDraft(raw, m, today) {
  const issues = [];
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(raw || ""))?.[0] || "null"); } catch { j = null; }
  if (!j || typeof j !== "object" || typeof j.summary !== "string" || !Array.isArray(j.action_items)) return { ok: false, issues: ["The AI's reply wasn't the expected JSON."] };
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 300)).slice(0, 20) : []);
  const notes = norm(m.notes), noteNums = new Set(numbersIn(m.notes).flatMap((n) => [n, n.replace(/\.0+$/, "")]));
  const summary = j.summary.trim().slice(0, 2000), decisions = strs(j.decisions), questions = strs(j.open_questions);
  const prose = [summary, ...decisions, ...questions];
  const items = [];
  for (const it of j.action_items.slice(0, ITEMS_MAX)) {
    const text = str(it?.text, 300);
    if (!text) continue;
    const source = str(it?.source, 400);
    if (!source || !notes.includes(norm(source))) { issues.push(`Dropped "${text.slice(0, 60)}": its source line isn't in the notes.`); continue; }
    const owner = (m.attendees || []).find((a) => a.name && norm(a.name) === norm(it?.owner)) || null;
    const due = isDate(it?.due) && it.due >= "2000-01-01" ? it.due : null;
    let target = TARGET_IDS.includes(it?.module) && it.module !== "okr" ? it.module : "ops";
    const def = TARGETS.find((t) => t.id === target);
    if (def.link && !m.links?.[def.link]) target = "ops"; // no linked record: an Operations task
    items.push({ text, owner_id: owner?.user_id || null, owner_name: owner?.name || "", due, target, source });
    prose.push(text);
  }
  const badNums = [...new Set(prose.flatMap(numbersIn))].filter((n) => !noteNums.has(n) && !noteNums.has(n.replace(/\.0+$/, "")));
  if (badNums.length) return { ok: false, issues: [`The AI's draft has numbers that aren't in the notes (${badNums.slice(0, 5).join(", ")}).`] };
  const badQuotes = prose.flatMap(quotesIn).filter((q) => !notes.includes(norm(q)));
  if (badQuotes.length) return { ok: false, issues: [`The AI's draft quotes words that aren't in the notes ("${badQuotes[0].slice(0, 60)}").`] };
  if (!summary) return { ok: false, issues: ["The AI's summary was empty."] };
  return { ok: true, draft: { summary, decisions, questions, items }, issues };
}
const withIds = (store, items) => items.map((x) => ({ id: store.newId(), kr_id: null, state: "draft", ...x }));

// ---- follow-up email (external meetings): Arabic first (Saudi dialect), then English. Drafted only.
export function followupFallback(m, draft, company = "DPA AD") {
  const ext = (m.attendees || []).find((a) => a.kind === "external");
  const name = ext?.name || "[ADD الاسم]";
  const items = (draft?.items || []).filter((x) => x.state !== "skipped").slice(0, 8);
  const list = items.length ? items.map((x) => `- ${x.text}${x.due ? ` (${x.due})` : ""}`).join("\n") : "- [ADD]";
  return {
    subject: `${m.title} · متابعة / Follow-up`,
    body: `هلا ${name}،\n\nشكراً على وقتك في اجتماع "${m.title}" يوم ${m.date}. هذي الخطوات اللي اتفقنا عليها:\n${list}\n\nإذا فيه شي ناقص أو تبي تعدل، رد على هذا الإيميل.\n\nتحياتي،\n[ADD الاسم]\n${company}\n\n---\n\nHi ${name},\n\nThank you for your time in "${m.title}" on ${m.date}. These are the next steps we agreed:\n${list}\n\nIf anything is missing or needs a change, just reply to this email.\n\nBest regards,\n[ADD name]\n${company}`,
  };
}
export function followupPrompt(w, m, draft) {
  return `<task title="Meeting follow-up email">
You are DPA AD's AI Meeting secretary. Write a short follow-up email to the outside attendees of this meeting: first in Saudi Arabic dialect (friendly, professional), then the same in English under a line "---".
Rules: use only the summary and next steps below; never add numbers, prices, dates, promises or names that aren't there; write [ADD] where something is missing; no unsubscribe text (it is added when sent).
Reply with JSON only: {"subject": "...", "body": "..."}
</task>
<meeting title="${String(m.title).replace(/"/g, "'")}" date="${m.date}">
<attendees>${(m.attendees || []).filter((a) => a.kind === "external").map((a) => a.name).join(", ") || "[ADD]"}</attendees>
<summary>${draft?.summary || ""}</summary>
<next_steps>
${(draft?.items || []).filter((x) => x.state !== "skipped").map((x) => `- ${x.text}${x.due ? ` (due ${x.due})` : ""}`).join("\n") || "- [ADD]"}
</next_steps>
</meeting>`;
}
export function checkFollowup(raw, m, draft) {
  let j = null;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(String(raw || ""))?.[0] || "null"); } catch { j = null; }
  if (!j || typeof j.subject !== "string" || typeof j.body !== "string" || !j.body.trim()) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const allowed = new Set([...numbersIn(m.notes), ...numbersIn(m.date), ...numbersIn(draft?.summary || ""), ...(draft?.items || []).flatMap((x) => numbersIn(`${x.text} ${x.due || ""}`)), ...numbersIn(m.title)]);
  const bad = [...new Set(numbersIn(`${j.subject} ${j.body}`))].filter((n) => !allowed.has(n));
  if (bad.length) return { ok: false, issue: `The AI's email had numbers that aren't in the meeting (${bad.slice(0, 5).join(", ")}).` };
  return { ok: true, subject: j.subject.trim().slice(0, 200), body: j.body.trim().slice(0, 6000) };
}

export function createMeetings({ store, provider, workforce = null, clock = () => Date.now() } = {}) {
  ensureMeetings(store);
  const svc = { clock };
  const now = () => svc.clock();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  // Draft from the notes. AI at level 1 (checked); rule-based when the AI is off, unreachable or its JSON fails the checks.
  async function draft(w, m, by = "you") {
    const today = todayOf(now()), base = { generated_at: new Date(now()).toISOString(), generated_by: by, status: "draft", reviewed_at: null, reviewed_by: null };
    const factual = (note, issues = []) => { const d = ruleDraft(m); const items = withIds(store, d.items); return { ...base, ...d, items, original: items.map(({ id, text, owner_id, due, target }) => ({ id, text, owner_id, due, target })), by_ai: false, note, issues }; };
    if (level() === 0) return factual("The AI Meeting secretary is switched off in AI Workforce: this draft was built by fixed rules from the notes.");
    try {
      const out = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: secretaryPrompt(w, m, today), onText: () => {} }));
      const c = checkDraft(out, m, today);
      if (!c.ok) {
        workforce?.event(AGENT_ID, w.id, "escalated", `Meeting "${m.title.slice(0, 60)}": ${c.issues[0]} Factual draft used.`);
        return factual(`${c.issues[0]} This draft was built by fixed rules from the notes instead: check it and add what's missing where it says [ADD].`, c.issues);
      }
      const items = withIds(store, c.draft.items);
      return { ...base, ...c.draft, items, original: items.map(({ id, text, owner_id, due, target }) => ({ id, text, owner_id, due, target })), by_ai: true, note: "", issues: c.issues };
    } catch (e) {
      return factual(/switched off|budget/i.test(e?.message || "") ? `${e.message} This draft was built by fixed rules from the notes.` : "The AI couldn't be reached: this draft was built by fixed rules from the notes.");
    }
  }
  async function followup(w, m) {
    const company = w.brief?.company_name || "DPA AD", fb = followupFallback(m, m.draft, company);
    if (level() === 0) return { ...fb, by_ai: false, note: "The AI Meeting secretary is switched off: this is the plain template." };
    try {
      const out = await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt: followupPrompt(w, m, m.draft), onText: () => {} }));
      const c = checkFollowup(out, m, m.draft);
      if (c.ok) return { subject: c.subject, body: c.body, by_ai: true, note: "" };
      return { ...fb, by_ai: false, note: `${c.issue} This is the plain template instead.` };
    } catch (e) { return { ...fb, by_ai: false, note: /switched off|budget/i.test(e?.message || "") ? e.message : "The AI couldn't be reached: this is the plain template." }; }
  }
  return Object.assign(svc, { now, level, draft, followup });
}

// ---- views
export function itemView(store, it) {
  const out = { ...it };
  if (it.target === "ops" && it.ref_id) { const t = store.getOps("ops_tasks", it.workspace_id, it.ref_id); if (t?.status === "done" && it.status !== "done") out.status = "done"; if (!t) out.ref_missing = true; }
  return out;
}
export function myItems(store, w, user, now = Date.now()) {
  ensureMeetings(store);
  const today = todayOf(now);
  const mine = store.listOps(COLL.items, w.id).filter((it) => it.owner_id && it.owner_id === user.id).map((it) => itemView(store, it));
  const open = mine.filter((it) => it.status !== "done").sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  return { open, overdue: open.filter((it) => it.due && it.due < today), done: mine.filter((it) => it.status === "done").slice(-20), today };
}
// Command Center: overdue meeting action items, and meetings with notes but no reviewed draft after 2 days.
export function meetingsNeeds(store, w, { user = null, now = Date.now() } = {}) {
  try {
    ensureMeetings(store);
    if (!user) return [];
    const today = todayOf(now), mgr = MANAGER_ROLES.includes(user.role_id);
    const open = store.listOps(COLL.items, w.id).map((it) => itemView(store, it)).filter((it) => it.status !== "done" && it.due && it.due < today);
    const mine = open.filter((it) => it.owner_id === user.id), others = open.filter((it) => it.owner_id !== user.id);
    const out = mine.slice(0, 4).map((it) => ({ module: "Meetings", route: "meetings", param: "mine", title: it.text.slice(0, 80), text: `Action item from "${String(it.meeting_title || "a meeting").slice(0, 60)}" was due ${it.due}.` }));
    if (mine.length > 4) out.push({ module: "Meetings", route: "meetings", param: "mine", title: "Your action items", text: `${mine.length - 4} more of your meeting action items are overdue.` });
    if (mgr && others.length) out.push({ module: "Meetings", route: "meetings", param: "mine", title: "Overdue meeting action items", text: `${others.length} meeting action item${others.length === 1 ? " is" : "s are"} overdue (owned by others or not assigned).` });
    const cut = now - REVIEW_DAYS * DAY;
    const waiting = store.listOps(COLL.meetings, w.id).filter((m) => m.notes && m.notes_at && Date.parse(m.notes_at) < cut && m.draft?.status !== "reviewed" && canSee(user, m)
      && (mgr || m.created_by_id === user.id || (m.attendees || []).some((a) => a.user_id === user.id)));
    if (waiting.length) out.push({ module: "Meetings", route: "meetings", param: "list", title: "Meeting notes waiting", text: `${waiting.length} meeting${waiting.length === 1 ? " has" : "s have"} notes but no reviewed action items after ${REVIEW_DAYS} days: ${waiting.slice(0, 3).map((m) => m.title.slice(0, 40)).join(", ")}.` });
    return out;
  } catch (e) { console.error("[meetings] needs:", e?.message); return []; }
}

// ---- sample data ("Sample ·", removed with Remove sample data). Drafts are built by the fixed rules, never invented.
export function loadSampleMeetings(store, crm, wsId, now = Date.now()) {
  ensureMeetings(store);
  const id = String(wsId);
  if (store.listOps(COLL.meetings, id).some((m) => m.sample)) return { meetings: 0 };
  const day = (d) => todayOf(now - d * DAY), at = (d) => new Date(now - d * DAY).toISOString();
  const deal = store.listDeals(id).find((d) => d.sample) || null;
  const ct = crm ? crm.contacts(id).find((c) => c.sample) : null;
  const add = (f) => {
    const m = store.addOps(COLL.meetings, id, { duration_min: 30, agenda: "", attendees: [], links: { deal_id: null, store_id: null, customer_id: null, candidate_id: null }, notes: "", notes_source: "paste", notes_at: null, draft: null, followup: null, created_by: "Sample", created_by_id: "owner", sample: true, ...f }, false);
    m.starts_at = startsAt(m.date, m.time); m.created_at = at(4);
    if (m.notes) { m.draft = ruleDraft(m); m.draft = { ...m.draft, items: withIds(store, m.draft.items), generated_at: at(3), generated_by: "Sample", status: "draft", by_ai: false, note: "Sample draft built by fixed rules from the sample notes.", issues: [], reviewed_at: null, reviewed_by: null }; m.draft.original = m.draft.items.map(({ id: i, text, owner_id, due, target }) => ({ id: i, text, owner_id, due, target })); }
    return m;
  };
  add({ title: "Sample · Weekly team sync", type: "internal", date: day(3), time: "10:00", agenda: "Pipeline, Salla app listing, support backlog",
    attendees: [{ kind: "user", user_id: "owner", name: "Owner" }], notes_at: at(3),
    notes: "Owner: Pipeline review, three demos booked this week.\nDecision: focus outreach on perfume stores this month.\nAction: Owner to send the Salla app listing screenshots to the designer\n- [ ] Update the onboarding checklist in the help center\nسوف نراجع قوالب رمضان قبل نهاية الأسبوع\nWho owns the Zid integration test?" });
  add({ title: `Sample · Demo call with ${ct?.store_name?.replace(/^Sample · /, "") || "a perfume store"}`, type: "sales_call", date: day(1), time: "14:30",
    attendees: [{ kind: "user", user_id: "owner", name: "Owner" }, { kind: "external", name: "Sample contact", email: "", org: ct?.store_name || "" }],
    links: { deal_id: deal?.id || null, store_id: ct?.id || null, customer_id: null, candidate_id: null }, notes_at: at(1),
    notes: "Sample contact: نبي نشوف إعلانات فيديو لمنتجات العود\nOwner: We showed the catalog-to-video templates.\nالمطلوب: إرسال عينات من إعلانات المتجر خلال يومين\nTODO: share the pricing page link\nهل يدعم النظام المنتجات اللي بدون صور؟" });
  store.save();
  return { meetings: 2 };
}
export function removeSampleMeetings(store, wsId) {
  ensureMeetings(store);
  const id = String(wsId);
  const ms = new Set(store.db[COLL.meetings].filter((m) => m.workspace_id === id && m.sample).map((m) => m.id));
  const b1 = store.db[COLL.meetings].length, b2 = store.db[COLL.items].length;
  store.db[COLL.meetings] = store.db[COLL.meetings].filter((m) => !ms.has(m.id));
  store.db[COLL.items] = store.db[COLL.items].filter((it) => !(it.workspace_id === id && (it.sample || ms.has(it.meeting_id))));
  return { meetings: b1 - store.db[COLL.meetings].length, meeting_items: b2 - store.db[COLL.items].length };
}
