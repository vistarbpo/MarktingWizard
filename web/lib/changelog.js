// Changelog ("What's new", access module "product"): customer-facing entries in Arabic and English, published on the
// public site /changelog (before the login wall; see changelogroutes.js) with an RSS feed and a JSON Feed.
// Lifecycle: draft → in review → published → archived, the Help center's rules: publishing needs Product Edit and a
// reviewer who is not the author (the Owner may publish their own unless the setting says otherwise); [ADD] blocks it.
// The AI Release notes writer (level 1) only drafts: from a shipped release and its roadmap items, or a translation.
// Feedback loop: the stores whose feedback is linked to an entry's roadmap items can be told, one draft email per store,
// sent (if at all) by a person through the Store CRM's sendOne() with every outreach rule. Nothing is sent by itself.
import crypto from "node:crypto";
import { withAgent } from "./agents.js";
import { riyadhDay } from "./crm.js";
import { checkTranslation, cleanSlug, isOwner, logPush, numbersIn, parseJson, people, reviewBlock, slugFrom, translatePrompt } from "./helpcenter.js";

export { logPush, people, reviewBlock };
export const COLL = { entries: "changelog_entries", notices: "changelog_notices" };
export const AGENT_ID = "release_writer";
export function ensureChangelog(store) { for (const c of Object.values(COLL)) store.db[c] ||= []; }

export const TYPES = [
  { id: "new", ar: "جديد", en: "New" },
  { id: "improved", ar: "تحسين", en: "Improved" },
  { id: "fixed", ar: "إصلاح", en: "Fixed" },
  { id: "announcement", ar: "إعلان", en: "Announcement" },
];
export const TYPE_IDS = TYPES.map((t) => t.id);
// Tags: the ad platforms and store platforms first, then product areas. Ids are also the public filter (?tag=).
export const TAGS = [
  { id: "salla", ar: "سلة", en: "Salla", group: "platform" }, { id: "zid", ar: "زد", en: "Zid", group: "platform" },
  { id: "meta", ar: "ميتا", en: "Meta", group: "platform" }, { id: "snap", ar: "سناب شات", en: "Snap", group: "platform" },
  { id: "tiktok", ar: "تيك توك", en: "TikTok", group: "platform" }, { id: "google", ar: "قوقل", en: "Google", group: "platform" },
  { id: "templates", ar: "القوالب", en: "Templates", group: "area" }, { id: "video", ar: "الفيديو", en: "Video", group: "area" },
  { id: "catalogs", ar: "الكتالوج", en: "Catalogs", group: "area" }, { id: "publishing", ar: "النشر", en: "Publishing", group: "area" },
  { id: "billing", ar: "الاشتراك والفواتير", en: "Billing", group: "area" }, { id: "account", ar: "الحساب والفريق", en: "Account", group: "area" },
  { id: "ai", ar: "الذكاء الاصطناعي", en: "AI", group: "area" }, { id: "arabic", ar: "العربي", en: "Arabic", group: "area" },
];
export const TAG_IDS = TAGS.map((t) => t.id);
export const STATUSES = [{ id: "draft", name: "Draft" }, { id: "in_review", name: "In review" }, { id: "published", name: "Published" }, { id: "archived", name: "Archived" }];
export const NEXT = { draft: ["in_review", "archived"], in_review: ["draft", "published", "archived"], published: ["draft", "archived"], archived: ["draft"] };
export const DEFAULT_SETTINGS = { owner_self_publish: true };
// Command Center: a shipped release with no entry after SHIP_DAYS (releases of the last SHIP_LOOKBACK days only),
// and an entry waiting in review for REVIEW_DAYS or more.
export const SHIP_DAYS = 3, SHIP_LOOKBACK = 90, REVIEW_DAYS = 3;
const DAY = 864e5;
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const todayOf = (now) => riyadhDay(new Date(now));
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const typeName = (id, lang = "en") => TYPES.find((t) => t.id === id)?.[lang] || id;
export const tagName = (id, lang = "en") => TAGS.find((t) => t.id === id)?.[lang] || id;
// Images: Creative Studio media only (/media/<random>.<ext>).
export const okMedia = (u) => /^\/media\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(String(u || ""));
export function settingsOf(w) { return { ...DEFAULT_SETTINGS, ...(w?.changelog || {}) }; }
export function cleanSettings(b = {}) { const out = {}; if (b.owner_self_publish !== undefined) out.owner_self_publish = !!b.owner_self_publish; return { out, err: [] }; }

export const CONTENT_KEYS = ["title_ar", "title_en", "body_ar", "body_en"];
export const hasLang = (e, l) => !!(str(e[`title_${l}`]) && str(e[`body_${l}`]));
export const isLive = (e) => e.status === "published" && (hasLang(e, "ar") || hasLang(e, "en"));
export const hasAdd = (e) => /\[ADD\b/i.test(CONTENT_KEYS.map((k) => e[k] || "").join(" "));
export const contentHash = (e) => crypto.createHash("sha256").update(CONTENT_KEYS.map((k) => e[k] || "").join("\u0000")).digest("base64url").slice(0, 22);
export const titleOf = (e, lang = "en") => e[`title_${lang}`] || e[`title_${lang === "ar" ? "en" : "ar"}`] || "";

export function uniqueSlug(store, wsId, base, exceptId = null) {
  const taken = (s) => store.listOps(COLL.entries, wsId).some((e) => e.slug === s && e.id !== exceptId);
  let s = cleanSlug(base) || cleanSlug(slugFrom(base)) || `update-${crypto.randomBytes(3).toString("hex")}`;
  if (["rss-xml", "feed-json"].includes(s)) s = `update-${s}`;
  if (!taken(s)) return s;
  for (let i = 2; i < 50; i++) { const c = cleanSlug(`${s.slice(0, 70)}-${i}`); if (c && !taken(c)) return c; }
  return `update-${crypto.randomBytes(4).toString("hex")}`;
}
const idList = (v, max) => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean))].slice(0, max + 1);

export function cleanEntry(b = {}, { store, wsId, partial = false, selfId = null } = {}) {
  const out = {}, err = [];
  for (const k of ["title_ar", "title_en"]) if (b[k] !== undefined) out[k] = str(b[k], 200);
  for (const k of ["body_ar", "body_en"]) if (b[k] !== undefined) out[k] = String(b[k] ?? "").replace(/\r\n?/g, "\n").slice(0, 20000);
  if (!partial && !out.title_ar && !out.title_en) err.push("Give the entry a title (Arabic or English)");
  if (b.type !== undefined || !partial) { const t = b.type ?? "new"; if (!TYPE_IDS.includes(t)) err.push(`type must be one of ${TYPE_IDS.join(", ")}`); else out.type = t; }
  if (b.tags !== undefined) {
    const tags = idList(b.tags, 8).map((x) => x.toLowerCase()), bad = tags.filter((x) => !TAG_IDS.includes(x));
    if (bad.length) err.push(`Unknown tag${bad.length === 1 ? "" : "s"}: ${bad.slice(0, 5).join(", ")}`); else if (tags.length > 8) err.push("At most 8 tags"); else out.tags = tags;
  }
  if (b.date !== undefined && b.date !== "") { if (!isDay(b.date)) err.push("date must be YYYY-MM-DD"); else out.date = b.date; }
  if (b.release_id !== undefined) {
    const id = b.release_id ? String(b.release_id) : null;
    if (id && !store.getOps("product_releases", wsId, id)) err.push("Unknown release"); else out.release_id = id;
  }
  if (b.item_ids !== undefined) {
    const ids = idList(b.item_ids, 20), bad = ids.filter((x) => !store.getOps("product_items", wsId, x));
    if (bad.length) err.push(`Unknown roadmap item${bad.length === 1 ? "" : "s"}: ${bad.slice(0, 5).join(", ")}`); else if (ids.length > 20) err.push("At most 20 roadmap items"); else out.item_ids = ids;
  }
  if (b.image !== undefined) { const u = str(b.image, 200); if (u && !okMedia(u)) err.push("image must be a Creative Studio media link (/media/<file>.png, .jpg, .webp or .gif)"); else out.image = u; }
  if (b.slug !== undefined && b.slug !== "") { const s = cleanSlug(b.slug); if (!s || ["rss-xml", "feed-json"].includes(s)) err.push("slug: 3–80 lowercase letters, digits and single hyphens"); else if (store.listOps(COLL.entries, wsId).some((e) => e.slug === s && e.id !== selfId)) err.push("That slug is already used by another entry"); else out.slug = s; }
  return { out, err };
}

// Published entries, newest first (entry date, then publish time).
export function liveEntries(store, wsId) {
  return store.listOps(COLL.entries, wsId).filter(isLive).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.published_at || "").localeCompare(String(a.published_at || "")));
}
// The entry's date at midnight Riyadh (UTC+3), for the feeds.
export const dateTime = (d) => new Date(`${isDay(d) ? d : "1970-01-01"}T00:00:00+03:00`);

// ---- from a release: the facts the AI may use (the release and its roadmap items; never feedback or customers)
const AREA_TAGS = { "Feed import": ["catalogs"], Templates: ["templates"], Video: ["video"], "Export & channels": ["publishing"], "Billing & plans": ["billing"], "AI agents": ["ai"], "App & UX": ["account"] };
const WORD_TAGS = [["salla", /salla|سل[ةه]/i], ["zid", /\bzid\b|زد/i], ["meta", /\bmeta\b|facebook|instagram|ميتا/i], ["snap", /snap|سناب/i], ["tiktok", /tik ?tok|تيك ?توك/i], ["google", /google|قوقل/i], ["arabic", /arabic|rtl|عربي/i], ["video", /video|reel|فيديو/i], ["templates", /template|قالب|قوالب/i], ["catalogs", /catalog|feed|كتالوج/i]];
export function ruleTags(items, notes = "") {
  const tags = new Set();
  for (const i of items) {
    for (const t of AREA_TAGS[i.area] || []) tags.add(t);
    for (const [t, re] of WORD_TAGS) if (re.test(i.title)) tags.add(t);
  }
  for (const [t, re] of WORD_TAGS) if (re.test(notes)) tags.add(t);
  return TAG_IDS.filter((t) => tags.has(t)).slice(0, 8);
}
export function ruleType(items) {
  if (!items.length) return "improved";
  if (items.every((i) => i.type === "bug")) return "fixed";
  if (items.some((i) => i.type === "feature" || i.type === "integration")) return "new";
  return "improved";
}
export function releaseFacts(store, w, release, itemIds = null) {
  const ids = itemIds || release?.item_ids || [];
  const items = ids.map((id) => store.getOps("product_items", w.id, id)).filter(Boolean);
  const notes = String(release?.notes || "");
  return {
    release_id: release?.id || null, item_ids: items.map((i) => i.id), type: ruleType(items), tags: ruleTags(items, notes),
    label: release ? `release ${release.version}` : `${items.length} roadmap item${items.length === 1 ? "" : "s"}`,
    sources: { release: release ? { ref: `R${release.id}`, version: release.version, date: release.date || null, notes } : null,
      items: items.map((i) => ({ ref: `I${i.id}`, title: i.title, type: i.type, area: i.area, problem: String(i.problem || "").slice(0, 500) })) },
    items,
  };
}
// Names the notes must never contain: the requesters of the linked items and the tracked competitors.
export function forbiddenNames(store, w, itemIds) {
  const set = new Set(itemIds.map(String));
  const fb = store.listOps("product_feedback", w.id).filter((f) => set.has(String(f.item_id))).map((f) => f.customer);
  const comps = (store.db.intel_competitors || []).filter((c) => c.workspace_id === w.id).map((c) => c.name);
  return [...new Set([...fb, ...comps].map((n) => String(n || "").replace(/^Sample ·\s*/, "").trim()).filter((n) => n.length >= 3))];
}
export function notesPrompt(w, f) {
  return `<task title="Release notes">
You are DPA AD's AI Release notes writer. Write ONE customer-facing changelog entry ("What's new") for ${w.brief?.company_name || "DPA AD"} (it turns Salla/Zid store catalogs into designed image and video ads for Meta, Snap, TikTok and Google).
Write it first in Saudi Arabic (friendly, short, benefit-led: what the merchant can do now and why it helps them sell), then the same in English.
Rules: describe ONLY what is in the release and roadmap items below; never invent features, numbers, percentages, prices, dates, customer or store names, competitor names, results or promises; leave out internal notes (effort, impact, confidence, competitors); write [ADD] where a detail is missing; markdown only (- lists, **bold**); no HTML.
Reply with JSON only: {"title_ar":"...","body_ar":"...","title_en":"...","body_en":"..."}
</task>
<sources>
${JSON.stringify(f.sources, null, 1).slice(0, 12000)}
</sources>`;
}
const allowedNumbers = (f) => new Set([...numbersIn(JSON.stringify(f.sources)), "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export function checkNotes(raw, f, forbidden = []) {
  const j = parseJson(raw);
  if (!j || !CONTENT_KEYS.every((k) => typeof j[k] === "string") || !(j.body_ar.trim() || j.body_en.trim())) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const all = CONTENT_KEYS.map((k) => j[k]).join(" "), allowed = allowedNumbers(f);
  const bad = [...new Set(numbersIn(all))].filter((n) => !allowed.has(n) && !allowed.has(n.replace(/\.0+$/, "")));
  if (bad.length) return { ok: false, issue: `The AI's notes had numbers that aren't in the release or its items (${bad.slice(0, 5).join(", ")}).` };
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(all)) return { ok: false, issue: "The AI's notes had HTML in them." };
  const low = all.toLowerCase(), name = forbidden.find((n) => low.includes(n.toLowerCase()));
  if (name) return { ok: false, issue: `The AI's notes named a customer or competitor ("${name}").` };
  return { ok: true, entry: { title_ar: str(j.title_ar, 200), body_ar: j.body_ar.trim().slice(0, 20000), title_en: str(j.title_en, 200), body_en: j.body_en.trim().slice(0, 20000) } };
}
// The factual draft: the item titles as they are, [ADD] for the customer-facing words. Nothing invented.
export function notesFallback(f) {
  const its = f.sources.items, rel = f.sources.release, one = its.length === 1 ? its[0] : null;
  return {
    title_ar: "[ADD العنوان بالعربي]",
    title_en: one ? one.title : "[ADD title]",
    body_ar: its.length ? its.map((i) => `- ${i.title}: [ADD وش الفايدة للتاجر]`).join("\n") : "- [ADD وش الجديد]",
    body_en: its.length ? its.map((i) => `- **${i.title}**: [ADD what it means for merchants]`).join("\n") : `- ${rel?.notes ? `${rel.notes.replace(/\n+/g, " ")} ` : ""}[ADD what changed for merchants]`,
  };
}

export function createChangelog({ store, provider, workforce = null, clock = () => Date.now() } = {}) {
  ensureChangelog(store);
  const svc = { clock };
  const now = () => svc.clock();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  async function ask(w, prompt) {
    if (level() === 0) return { off: true };
    try { return { raw: await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt, onText: () => {} })) }; }
    catch (e) { return { error: /switched off|budget/i.test(e?.message || "") ? e.message : "The AI couldn't be reached." }; }
  }
  async function draft(w, f) {
    const fb = notesFallback(f);
    const r = await ask(w, notesPrompt(w, f));
    if (r.off) return { entry: fb, by_ai: false, note: "The AI Release notes writer is switched off in AI Workforce: this is the factual draft from the release." };
    if (r.error) return { entry: fb, by_ai: false, note: `${r.error} This is the factual draft from the release.` };
    const c = checkNotes(r.raw, f, forbiddenNames(store, w, f.item_ids));
    if (c.ok) return { entry: c.entry, by_ai: true, note: "" };
    workforce?.event(AGENT_ID, w.id, "escalated", `Notes from ${f.label}: ${c.issue} Factual draft used.`);
    return { entry: fb, by_ai: false, note: `${c.issue} This is the factual draft from the release instead: fill in every [ADD].` };
  }
  async function translate(w, e, to) {
    const from = to === "ar" ? "en" : "ar";
    const fb = { title: `[ADD ${to === "ar" ? "العنوان بالعربي" : "English title"}]`, body: `[ADD ${to === "ar" ? "الترجمة العربية" : "English translation"}]\n\n${e[`body_${from}`] || ""}` };
    const r = await ask(w, translatePrompt(e, from, to, { who: "DPA AD's AI Release notes writer", what: "changelog entry", task: "Changelog translation" }));
    if (r.off) return { ...fb, by_ai: false, note: "The AI Release notes writer is switched off in AI Workforce: translate by hand." };
    if (r.error) return { ...fb, by_ai: false, note: `${r.error} Translate by hand.` };
    const c = checkTranslation(r.raw, e, from);
    if (c.ok) return { title: c.title, body: c.body, by_ai: true, note: "" };
    workforce?.event(AGENT_ID, w.id, "escalated", `Translation of "${String(e[`title_${from}`]).slice(0, 60)}": ${c.issue}`);
    return { ...fb, by_ai: false, note: `${c.issue} Translate by hand.` };
  }
  return Object.assign(svc, { now, level, draft, translate });
}

// ---- feedback loop: who asked for the entry's roadmap items, matched to Store CRM stores
// Match order: the feedback's store_id, then the support ticket it came from (contact email, store), then the
// feedback's customer text as a CRM store name, domain or email. Unmatched requesters are listed to contact by hand.
export function requestersFor(store, crm, w, entry) {
  const ids = new Set((entry.item_ids || []).map(String));
  if (!ids.size) return [];
  const fb = store.listOps("product_feedback", w.id).filter((f) => ids.has(String(f.item_id)) && !f.dismissed);
  if (!fb.length) return [];
  const contacts = crm ? crm.contacts(w.id) : [];
  const norm = (s) => String(s || "").trim().toLowerCase();
  const byName = new Map(), byDomain = new Map(), byEmail = new Map();
  for (const c of contacts) { if (c.store_name) byName.set(norm(c.store_name), c); if (c.domain) byDomain.set(norm(c.domain), c); if (c.email) byEmail.set(norm(c.email), c); }
  const lookup = (s) => { const k = norm(s).replace(/^https?:\/\//, "").replace(/\/.*$/, ""); return k ? byName.get(norm(s)) || byEmail.get(k) || byDomain.get(k) || byDomain.get(k.replace(/^www\./, "")) || null : null; };
  const noticeFor = new Map(store.listOps(COLL.notices, w.id).filter((n) => n.entry_id === entry.id).map((n) => [n.store_id, n]));
  const groups = new Map();
  for (const f of fb) {
    let c = f.store_id ? crm?.get(w.id, f.store_id) : null;
    const tid = /^ticket:([^:]+):/.exec(f.source_ref || "")?.[1];
    const t = !c && tid ? store.getTicket(w.id, tid) : null;
    if (!c && t) c = lookup(t.contact) || lookup(t.store) || lookup(t.customer_name);
    if (!c) c = lookup(f.customer);
    const key = c ? `s:${c.id}` : `n:${norm(f.customer) || `f${f.id}`}`;
    const g = groups.get(key) || { store_id: c?.id || null, store_name: c?.store_name || f.customer || "(no name)", stage: c?.stage || null, feedback: [], item_ids: [] };
    g.feedback.push({ id: f.id, text: String(f.text).slice(0, 200), source: f.source, item_id: f.item_id });
    if (!g.item_ids.includes(String(f.item_id))) g.item_ids.push(String(f.item_id));
    groups.set(key, g);
    g._c = c;
  }
  return [...groups.values()].map(({ _c: c, ...g }) => {
    const n = c ? noticeFor.get(c.id) : null;
    const reason = !c ? "Not in the Store CRM: tell them yourself" : c.sample ? "Sample store: never sent for real" : c.stage === "do_not_contact" ? "Store is on do-not-contact"
      : c.email_opt_out ? "Unsubscribed from email" : c.bounced ? "Email bounced before" : !c.email ? "No email on the CRM store" : n ? `Already has a ${n.status === "draft" ? "draft" : n.status} notice` : "";
    return { ...g, ready: !reason, reason, notice_id: n?.id || null, notice_status: n?.status || null };
  });
}
// The notice email (Arabic first, then English). {{owner_name}} and {{sender_name}} are filled by the Store CRM.
export function noticeText(w, e, url) {
  const company = w.brief?.company_name || "DPA AD", ar = titleOf(e, "ar"), en = titleOf(e, "en");
  return {
    subject: `صار متوفر: ${ar}`.slice(0, 200),
    body: `هلا {{owner_name}}،\n\nشكراً على اقتراحك. حبينا نبلغك إن «${ar}» صار متوفر الحين في ${company}.\n\nالتفاصيل: ${url}\n\n---\n\nHi {{owner_name}},\n\nThanks for your suggestion. "${en}" is now live in ${company}.\n\nDetails: ${url}\n\n{{sender_name}}`,
  };
}

// ---- Command Center
export function changelogNeeds(store, w, { now = Date.now() } = {}) {
  try {
    ensureChangelog(store);
    const out = [], today = todayOf(now), entries = store.listOps(COLL.entries, w.id);
    const covered = new Set(entries.map((e) => e.release_id).filter(Boolean));
    const ship = store.listOps("product_releases", w.id).filter((r) => r.status === "released" && isDay(r.date) && !covered.has(r.id)).filter((r) => { const d = daysBetween(r.date, today); return d >= SHIP_DAYS && d <= SHIP_LOOKBACK; });
    if (ship.length) out.push({ module: "Changelog", route: "changelog", param: "entries", title: "Shipped releases without a changelog entry", text: `${ship.length} shipped release${ship.length === 1 ? " has" : "s have"} no changelog entry after ${SHIP_DAYS} days: ${ship.slice(0, 3).map((r) => r.version).join(", ")}. Draft one from the release.` });
    const wait = entries.filter((e) => e.status === "in_review" && e.submitted_at && now - Date.parse(e.submitted_at) >= REVIEW_DAYS * DAY);
    if (wait.length) out.push({ module: "Changelog", route: "changelog", param: "entries", title: "Changelog entries waiting for review", text: `${wait.length} changelog entr${wait.length === 1 ? "y has" : "ies have"} been in review for ${REVIEW_DAYS}+ days: ${wait.slice(0, 3).map((e) => titleOf(e).slice(0, 50)).join(", ")}.` });
    return out;
  } catch (e) { console.error("[changelog] needs:", e?.message); return []; }
}

// ---- sample data ("Sample ·", removed with Remove sample data): three published entries and one draft for the sample release
export function loadSampleChangelog(store, wsId, now = Date.now()) {
  ensureChangelog(store);
  const id = String(wsId);
  if (store.listOps(COLL.entries, id).some((e) => e.sample)) return { entries: 0 };
  const day = (n) => todayOf(now - n * DAY);
  const items = store.listOps("product_items", id), item = (t) => items.find((i) => i.title.startsWith(t))?.id;
  const rel = store.listOps("product_releases", id).find((r) => r.sample && r.status === "released") || null;
  const mk = (f) => {
    const e = store.addOps(COLL.entries, id, { tags: [], item_ids: [], release_id: null, image: "", author_id: "owner", author_name: "Sample", reviewer_id: null, reviewer_name: "", published_at: null, by_ai: false, log: [], sample: true, ...f }, false);
    e.slug = uniqueSlug(store, id, f.slug, e.id);
    if (e.status === "published") Object.assign(e, { reviewer_id: "owner", reviewer_name: "Sample", published_at: new Date(now - 864e5).toISOString() });
    logPush(e, "Sample", "Sample entry added", now);
    return e;
  };
  mk({ slug: "sample-faster-feed-import", type: "improved", tags: ["catalogs", "salla", "zid"], date: day(2), status: "published",
    title_ar: "Sample · استيراد ملف المنتجات صار أسرع", title_en: "Sample · Faster product feed import",
    body_ar: "رفع ملف منتجات متجرك صار أسرع، فتشوف تصاميم إعلاناتك بدري.\n\n- يشتغل مع ملفات سلة وزد\n- ما تحتاج تسوي شي: التحسين مفعّل لكل المتاجر",
    body_en: "Uploading your store's product feed is faster now, so your ad designs are ready sooner.\n\n- Works with Salla and Zid feeds\n- Nothing to do: it's on for every store" });
  mk({ slug: "sample-brand-fonts", type: "new", tags: ["templates", "arabic"], date: day(9), status: "published",
    title_ar: "Sample · خطوط هويتك في القوالب", title_en: "Sample · Your brand fonts in templates",
    body_ar: "تقدر الحين ترفع خطوط هويتك وتطلع فيها إعلاناتك بالعربي والإنجليزي.\n\n- ارفع الخط من إعدادات الهوية\n- اختره في القالب",
    body_en: "You can now upload your brand fonts and use them in your Arabic and English ads.\n\n- Upload the font in brand settings\n- Pick it in the template" });
  mk({ slug: "sample-arabic-text-fix", type: "fixed", tags: ["templates", "arabic"], date: day(20), status: "published", item_ids: [item("Arabic template pack")].filter(Boolean),
    title_ar: "Sample · إصلاح اتجاه النص العربي في بعض القوالب", title_en: "Sample · Fixed Arabic text direction in some templates",
    body_ar: "صلّحنا مشكلة كانت تخلي النص العربي يطلع باتجاه غلط في بعض القوالب.",
    body_en: "We fixed an issue that showed Arabic text in the wrong direction in some templates." });
  mk({ slug: "sample-release-notes-draft", type: "improved", tags: ["catalogs", "templates"], date: rel?.date || day(14), status: "draft", release_id: rel?.id || null,
    title_ar: "Sample · [ADD العنوان بالعربي]", title_en: "Sample · [ADD title]",
    body_ar: "- [ADD وش الفايدة للتاجر]", body_en: `- ${rel?.notes || "Feed import speed-up, brand fonts"} [ADD what changed for merchants]` });
  store.save();
  return { entries: 4 };
}
export function removeSampleChangelog(store, wsId) {
  ensureChangelog(store);
  const id = String(wsId), db = store.db;
  const gone = new Set(db[COLL.entries].filter((e) => e.workspace_id === id && e.sample).map((e) => e.id));
  const before = db[COLL.entries].length, nb = db[COLL.notices].length;
  db[COLL.entries] = db[COLL.entries].filter((e) => !(e.workspace_id === id && e.sample));
  db[COLL.notices] = db[COLL.notices].filter((n) => !(n.workspace_id === id && (n.sample || gone.has(n.entry_id))));
  // Real entries keep their text; links to sample releases and sample roadmap items (removed next) are cleared.
  const rels = new Set(db.product_releases.filter((r) => r.workspace_id === id && r.sample).map((r) => r.id));
  const its = new Set(db.product_items.filter((i) => i.workspace_id === id && i.sample).map((i) => i.id));
  for (const e of db[COLL.entries].filter((x) => x.workspace_id === id)) {
    if (rels.has(e.release_id)) e.release_id = null;
    if (e.item_ids?.some((x) => its.has(x))) e.item_ids = e.item_ids.filter((x) => !its.has(x));
  }
  return { changelog_entries: before - db[COLL.entries].length, changelog_notices: nb - db[COLL.notices].length };
}
export { isOwner };
