// Help center (module "helpcenter"): customer-facing articles in Arabic and English, published on a public site
// at /help (before the login wall; see helpcenterroutes.js). The internal AI Support knowledge base
// (support_articles) stays internal: a help article may link to one, but nothing from support_articles is shown
// publicly unless a person copies it into a help article and a reviewer publishes it.
// Lifecycle: draft → in review → published → archived. Publishing needs Edit and a reviewer who is not the author
// (the Owner may publish their own article unless the setting says otherwise). The AI Help writer (level 1) only
// drafts: from a support article, from resolved tickets, or a translation; a person reviews and publishes.
import crypto from "node:crypto";
import { withAgent } from "./agents.js";
import { riyadhDay } from "./crm.js";
import { PLANS, SAR_PER_USD } from "./sales.js";

export const COLL = { articles: "help_articles", votes: "help_votes" };
export const AGENT_ID = "help_writer";
export function ensureHelp(store) {
  for (const c of Object.values(COLL)) store.db[c] ||= [];
  if (!store.db.help_site || typeof store.db.help_site !== "object") store.db.help_site = { workspace_id: null };
}

// Category ids are also their public URL segment (/help/<id>).
export const CATEGORIES = [
  { id: "getting-started", ar: "البداية", en: "Getting started" },
  { id: "connecting-salla", ar: "ربط متجر سلة", en: "Connecting Salla" },
  { id: "connecting-zid", ar: "ربط متجر زد", en: "Connecting Zid" },
  { id: "catalogs-and-feeds", ar: "الكتالوج وملفات المنتجات", en: "Catalogs and feeds" },
  { id: "ad-designs", ar: "تصاميم الإعلانات والقوالب", en: "Ad designs and templates" },
  { id: "video-ads", ar: "إعلانات الفيديو", en: "Video ads" },
  { id: "publishing", ar: "النشر على ميتا وسناب وتيك توك وقوقل", en: "Publishing to Meta, Snap, TikTok and Google" },
  { id: "billing", ar: "الاشتراك والفواتير", en: "Billing and invoices" },
  { id: "account-and-team", ar: "الحساب والفريق", en: "Account and team" },
  { id: "privacy-and-security", ar: "الخصوصية والأمان", en: "Privacy and security" },
  { id: "troubleshooting", ar: "حل المشاكل", en: "Troubleshooting" },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const STATUSES = [{ id: "draft", name: "Draft" }, { id: "in_review", name: "In review" }, { id: "published", name: "Published" }, { id: "archived", name: "Archived" }];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const NEXT = { draft: ["in_review", "archived"], in_review: ["draft", "published", "archived"], published: ["draft", "archived"], archived: ["draft"] };
// "customers" (signed-in customers only) is a placeholder until DPA AD has customer logins: treated as unpublished.
export const VISIBILITY = [{ id: "public", name: "Public" }, { id: "customers", name: "Customers only (not shown yet: no customer logins)" }];
export const DEFAULT_SETTINGS = { contact_email: "", owner_self_publish: true };
export const STALE_DAYS = 180, NOT_HELPFUL_MIN = 3, NOT_HELPFUL_DAYS = 30, GAP_MIN = 5, GAP_DAYS = 90;
const DAY = 864e5;
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const todayOf = (now) => riyadhDay(new Date(now));
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const catName = (id, lang = "en") => CATEGORIES.find((c) => c.id === id)?.[lang] || id;

export function settingsOf(w) { return { ...DEFAULT_SETTINGS, ...(w?.help || {}) }; }
export function cleanSettings(b = {}) {
  const out = {}, err = [];
  if (b.contact_email !== undefined) { const e = str(b.contact_email, 200).toLowerCase(); if (e && !/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(e)) err.push("contact_email is not a valid email"); else out.contact_email = e; }
  if (b.owner_self_publish !== undefined) out.owner_self_publish = !!b.owner_self_publish;
  return { out, err };
}
// The public site serves one workspace: the one chosen in Help center → Settings (db.help_site.workspace_id), else the first.
export function siteWorkspace(store) {
  ensureHelp(store);
  return (store.db.help_site.workspace_id && store.getWorkspace(store.db.help_site.workspace_id)) || store.listWorkspaces()[0] || null;
}

// ---- slugs
export const cleanSlug = (v) => { const s = String(v ?? "").trim().toLowerCase(); return /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(s) && !s.includes("--") ? s : ""; };
export function slugFrom(text) { return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, ""); }
export function uniqueSlug(store, wsId, base, exceptId = null) {
  const taken = (s) => store.listOps(COLL.articles, wsId).some((a) => a.slug === s && a.id !== exceptId);
  let s = cleanSlug(base) || cleanSlug(slugFrom(base)) || `article-${crypto.randomBytes(3).toString("hex")}`;
  if (!taken(s)) return s;
  for (let i = 2; i < 50; i++) { const c = cleanSlug(`${s.slice(0, 70)}-${i}`); if (c && !taken(c)) return c; }
  return `article-${crypto.randomBytes(4).toString("hex")}`;
}

// ---- people
export function people(store) { return [{ id: "owner", name: "Owner" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))]; }
export const isOwner = (user) => user?.id === "owner" || user?.role_id === "owner";

// ---- article cleaning
export function cleanArticle(b = {}, { store, wsId, partial = false, selfId = null } = {}) {
  const out = {}, err = [];
  for (const k of ["title_ar", "title_en"]) if (b[k] !== undefined) out[k] = str(b[k], 200);
  for (const k of ["body_ar", "body_en"]) if (b[k] !== undefined) out[k] = String(b[k] ?? "").replace(/\r\n?/g, "\n").slice(0, 40000);
  if (!partial && !out.title_ar && !out.title_en) err.push("Give the article a title (Arabic or English)");
  if (b.category !== undefined || !partial) { const c = b.category ?? "getting-started"; if (!CATEGORY_IDS.includes(c)) err.push(`category must be one of ${CATEGORY_IDS.join(", ")}`); else out.category = c; }
  if (b.visibility !== undefined || !partial) { const v = b.visibility ?? "public"; if (!VISIBILITY.some((x) => x.id === v)) err.push("visibility must be public or customers"); else out.visibility = v; }
  if (b.slug !== undefined && b.slug !== "") { const s = cleanSlug(b.slug); if (!s) err.push("slug: 3–80 lowercase letters, digits and single hyphens"); else if (store.listOps(COLL.articles, wsId).some((a) => a.slug === s && a.id !== selfId)) err.push("That slug is already used by another article"); else out.slug = s; }
  if (b.related_ids !== undefined) {
    const ids = [...new Set((Array.isArray(b.related_ids) ? b.related_ids : String(b.related_ids || "").split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean))].filter((x) => x !== selfId);
    const bad = ids.filter((x) => !store.getOps(COLL.articles, wsId, x));
    if (bad.length) err.push(`Unknown related article${bad.length === 1 ? "" : "s"}: ${bad.slice(0, 5).join(", ")}`);
    else if (ids.length > 6) err.push("At most 6 related articles"); else out.related_ids = ids;
  }
  if (b.support_article_id !== undefined) {
    const id = b.support_article_id ? String(b.support_article_id) : null;
    if (id && !store.listArticles(wsId).some((a) => a.id === id)) err.push("Unknown support article"); else out.support_article_id = id;
  }
  return { out, err };
}
export const CONTENT_KEYS = ["title_ar", "title_en", "body_ar", "body_en"];
export const hasLang = (a, l) => !!(str(a[`title_${l}`]) && str(a[`body_${l}`]));
export const contentHash = (a) => crypto.createHash("sha256").update(CONTENT_KEYS.map((k) => a[k] || "").join("\u0000")).digest("base64url").slice(0, 22);
export function logPush(a, by, text, now = Date.now()) {
  a.log ||= [];
  a.log.push({ at: new Date(now).toISOString(), by, text: String(text).slice(0, 300) });
  if (a.log.length > 100) a.log.splice(0, a.log.length - 100);
}
// Publishing needs a reviewer who isn't the author (the Owner may self-publish unless switched off in settings).
export function reviewBlock(article, user, settings = DEFAULT_SETTINGS) {
  if (!user) return "Sign in first.";
  if (String(article.author_id || "") !== String(user.id)) return null;
  if (isOwner(user) && settings.owner_self_publish !== false) return null;
  return "The reviewer must be a different person than the author. Ask someone else with Help center Edit to review and publish it.";
}
export const isLive = (a) => a.status === "published" && a.visibility === "public" && (hasLang(a, "ar") || hasLang(a, "en"));

// ---- safe markdown subset → HTML (everything escaped first; no user HTML ever reaches the page)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const unesc = (s) => s.replace(/&amp;/g, "&");
// Links: https or this site's /help pages. Images: /media/<file> (Creative Studio media) or https.
export const okLink = (u) => /^https:\/\/[^\s<>"'`]+$/i.test(u) || /^\/help(?:\/[a-z0-9/-]*)?(?:\?[a-z0-9=&_-]*)?$/i.test(u);
export const okImage = (u) => /^\/media\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(u) || /^https:\/\/[^\s<>"'`]+$/i.test(u);
const emph = (s) => s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
function inline(raw) {
  // Generated tags are held aside as placeholders so later rules never touch their attributes.
  const keep = [], hold = (html) => { keep.push(html); return `\u0000${keep.length - 1}\u0000`; };
  let s = esc(String(raw).replace(/\u0000/g, "")).replace(/`([^`\n]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, alt, url) => (okImage(unesc(url)) ? hold(`<img src="${url}" alt="${alt}" loading="lazy">`) : alt));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => (okLink(unesc(url)) ? hold(`<a href="${url}"${/^https:/i.test(url) ? ' rel="noopener noreferrer" target="_blank"' : ""}>${emph(text)}</a>`) : text));
  s = emph(s);
  for (let i = 0; i < 3 && s.includes("\u0000"); i++) s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[Number(n)] ?? "");
  return s;
}
export function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null, code = null;
  const flushP = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const line of lines) {
    if (code) { if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flushP(); flushL(); code = []; continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) { flushP(); flushL(); const n = Math.max(2, h[1].length); /* the page title is the only h1 */ out.push(`<h${n}>${inline(h[2].trim())}</h${n}>`); continue; }
    const ul = /^\s*[-*•]\s+(.+)$/.exec(line), ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) { flushP(); const tag = ul ? "ul" : "ol"; if (list && list.tag !== tag) flushL(); list ||= { tag, items: [] }; list.items.push((ul || ol)[1]); continue; }
    if (!line.trim()) { flushP(); flushL(); continue; }
    flushL(); para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flushP(); flushL();
  return out.join("\n");
}
export const plainText = (md) => String(md || "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#*_`>]/g, " ").replace(/\s+/g, " ").trim();

// ---- search: Arabic normalisation (tashkeel and tatweel removed; أ إ آ ٱ → ا; ى → ي; ة → ه; ؤ → و; ئ → ي) and English lower case
export function normalize(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export const tokens = (s) => [...new Set(normalize(s).split(" ").filter((t) => t.length >= 2 || /\d/.test(t)))].slice(0, 12);
// Every query word must appear (title words count 3×). Arabic words also match without the "ال" prefix.
export function searchArticles(articles, q) {
  const qs = tokens(q).map((t) => (t.startsWith("ال") && t.length > 3 ? t.slice(2) : t));
  if (!qs.length) return [];
  return articles.map((a) => {
    const title = normalize(`${a.title_ar} ${a.title_en}`), body = normalize(`${plainText(a.body_ar)} ${plainText(a.body_en)}`);
    let score = 0;
    for (const t of qs) { const inT = title.includes(t), inB = body.includes(t); if (!inT && !inB) return null; score += (inT ? 3 : 0) + (inB ? 1 : 0); }
    return { a, score };
  }).filter(Boolean).sort((x, y) => y.score - x.score || String(y.a.updated_at).localeCompare(String(x.a.updated_at))).map((x) => x.a);
}

// ---- votes: one counter row per article per Riyadh day (no IP, no cookie, no personal data)
export function recordVote(store, a, helpful, now = Date.now()) {
  ensureHelp(store);
  const day = todayOf(now);
  let row = store.db[COLL.votes].find((v) => v.workspace_id === a.workspace_id && v.article_id === a.id && v.day === day);
  if (!row) { row = { id: store.newId(), workspace_id: a.workspace_id, article_id: a.id, day, yes: 0, no: 0, ...(a.sample ? { sample: true } : {}) }; store.db[COLL.votes].push(row); }
  row[helpful ? "yes" : "no"]++;
  store.save();
  return row;
}
export function voteCounts(store, wsId, articleId, now = Date.now(), days = NOT_HELPFUL_DAYS) {
  const from = todayOf(now - (days - 1) * DAY);
  const rows = store.listOps(COLL.votes, wsId).filter((v) => v.article_id === articleId);
  const recent = rows.filter((v) => v.day >= from);
  const sum = (list, k) => list.reduce((s, v) => s + (v[k] || 0), 0);
  return { yes: sum(rows, "yes"), no: sum(rows, "no"), yes_30: sum(recent, "yes"), no_30: sum(recent, "no") };
}

// ---- freshness
export function freshness(a, now = Date.now()) {
  if (a.status !== "published") return { stale: false, days: null };
  const last = a.last_reviewed || (a.published_at || a.created_at || "").slice(0, 10);
  const days = last ? daysBetween(last, todayOf(now)) : null;
  return { stale: days === null || days >= STALE_DAYS, days, last_reviewed: last || null };
}

// ---- gaps: ticket topics (last 90 days) with no published article in that topic
const TOPIC_WORDS = [
  ["connecting-salla", /سل[ةه]|salla/i], ["connecting-zid", /\bzid\b|زد/i],
  ["publishing", /\bmeta\b|facebook|instagram|snap|tiktok|google ads|ميتا|فيسبوك|انستقرام|سناب|تيك ?توك|قوقل/i],
  ["privacy-and-security", /privacy|delete my data|pdpl|خصوصي|حذف بيانات/i],
  ["video-ads", /video|reel|فيديو|ريل/i],
];
const SUPPORT_TO_HELP = { "getting-started": "getting-started", "feed-import": "catalogs-and-feeds", templates: "ad-designs", video: "video-ads", billing: "billing", account: "account-and-team", bug: "troubleshooting", other: null };
export function ticketTopic(t) {
  if (t.category === "feature-request") return null;
  const text = (t.messages || []).filter((m) => m.from === "customer").map((m) => m.text).join(" ").slice(0, 2000);
  for (const [id, re] of TOPIC_WORDS) if (re.test(text)) return id;
  return SUPPORT_TO_HELP[t.category] ?? null;
}
const redact = (s) => String(s || "").replace(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi, "[email]").replace(/\+?\d[\d\s-]{7,}\d/g, "[phone]");
export function gapList(store, w, now = Date.now()) {
  const from = now - GAP_DAYS * DAY;
  const live = store.listOps(COLL.articles, w.id).filter(isLive);
  const topics = new Map();
  for (const t of store.listTickets(w.id)) {
    if (Date.parse(t.created_at) < from) continue;
    const topic = ticketTopic(t); if (!topic) continue;
    const g = topics.get(topic) || { category: topic, tickets: 0, resolved: 0, ticket_ids: [], resolved_ids: [], examples: [] };
    g.tickets++; g.ticket_ids.push(t.id);
    if (t.status === "resolved") { g.resolved++; g.resolved_ids.push(t.id); }
    const q = (t.messages || []).find((m) => m.from === "customer")?.text;
    if (q && g.examples.length < 3) g.examples.push(redact(q).slice(0, 160));
    topics.set(topic, g);
  }
  return [...topics.values()].map((g) => ({ ...g, name: catName(g.category), name_ar: catName(g.category, "ar"), published: live.filter((a) => a.category === g.category).length }))
    .filter((g) => g.published === 0).sort((a, b) => b.tickets - a.tickets);
}

// ---- AI Help writer: drafts only
const numbersIn = (s) => (String(s || "").match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ""));
const priceFacts = () => PLANS.map((p) => `${p.name}: from USD ${p.usd}/month (SAR ${Math.round(p.usd * SAR_PER_USD)}), up to ${Number.isFinite(p.max) ? p.max : "unlimited"} products`).join("; ") + "; yearly billing = 10 × monthly. Draft prices: confirm before publishing.";
export function sourceFacts(store, w, { source, support_article_id = null, ticket_ids = [], category = null }) {
  if (source === "support_article") {
    const a = store.listArticles(w.id).find((x) => x.id === String(support_article_id || ""));
    if (!a) return { error: "Unknown support article" };
    const cat = { "getting-started": "getting-started", "feed-import": "catalogs-and-feeds", templates: "ad-designs", video: "video-ads", billing: "billing", account: "account-and-team" }[a.category] || "troubleshooting";
    return { category: category && CATEGORY_IDS.includes(category) ? category : cat, support_article_id: a.id, lang: a.language === "ar" ? "ar" : "en",
      label: `support article "${String(a.question).slice(0, 80)}"`, sources: [{ ref: `K${a.id}`, kind: "support article", language: a.language, question: a.question, answer: a.answer }] };
  }
  let ids = (Array.isArray(ticket_ids) ? ticket_ids : []).map(String);
  if (source === "gap") {
    if (!CATEGORY_IDS.includes(category)) return { error: "Pick a topic (category)" };
    ids = store.listTickets(w.id).filter((t) => t.status === "resolved" && ticketTopic(t) === category).slice(0, 8).map((t) => t.id);
    if (!ids.length) return { error: "No resolved tickets on this topic yet: resolve one first, or write the article by hand." };
  }
  if (source !== "tickets" && source !== "gap") return { error: "source must be support_article, tickets or gap" };
  const tickets = ids.slice(0, 8).map((id) => store.getTicket(w.id, id)).filter(Boolean);
  if (!tickets.length) return { error: "Pick at least one ticket" };
  if (tickets.some((t) => t.status !== "resolved")) return { error: "Only resolved tickets can be used: their answers were checked by a person." };
  const cat = category && CATEGORY_IDS.includes(category) ? category : ticketTopic(tickets[0]) || "troubleshooting";
  return { category: cat, support_article_id: null, lang: tickets.filter((t) => t.language === "en").length > tickets.length / 2 ? "en" : "ar", label: `${tickets.length} resolved ticket${tickets.length === 1 ? "" : "s"}`, ticket_ids: tickets.map((t) => t.id),
    sources: tickets.map((t) => ({ ref: `T${t.id}`, kind: "resolved ticket", category: t.category, messages: (t.messages || []).filter((m) => m.from === "customer" || ((m.from === "you" || m.from === "ai") && m.sent !== false && !m.draft)).slice(-10).map((m) => ({ from: m.from === "customer" ? "customer" : "support", text: redact(m.text).slice(0, 800) })) })) };
}
export function draftPrompt(w, f) {
  const prices = f.category === "billing" ? `\n<prices source="PLANS (draft)">${priceFacts()}</prices>` : "";
  return `<task title="Help article draft">
You are DPA AD's AI Help writer. Write ONE customer-facing help center article for ${w.brief?.company_name || "DPA AD"} (it turns Salla/Zid store catalogs into designed image and video ads for Meta, Snap, TikTok and Google).
Topic: ${catName(f.category)}. Write it first in Saudi Arabic (friendly, clear, short steps), then the same in English.
Rules: use ONLY facts in the sources below; never invent features, screens, prices, numbers, dates or promises; write [ADD] where a step or fact is missing; no customer names, emails or phone numbers; markdown only (## headings, - lists, **bold**, links only https).
Reply with JSON only: {"title_ar":"...","body_ar":"...","title_en":"...","body_en":"..."}
</task>
<sources>
${JSON.stringify(f.sources, null, 1).slice(0, 12000)}
</sources>${prices}`;
}
function parseJson(raw) { try { return JSON.parse(/\{[\s\S]*\}/.exec(String(raw || ""))?.[0] || "null"); } catch { return null; } }
const allowedNumbers = (f) => new Set([...numbersIn(JSON.stringify(f.sources)), ...(f.category === "billing" ? numbersIn(priceFacts()) : []), "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export function checkDraft(raw, f) {
  const j = parseJson(raw);
  if (!j || !["title_ar", "body_ar", "title_en", "body_en"].every((k) => typeof j[k] === "string") || !(j.body_ar.trim() || j.body_en.trim())) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const allowed = allowedNumbers(f), all = `${j.title_ar} ${j.body_ar} ${j.title_en} ${j.body_en}`;
  const bad = [...new Set(numbersIn(all))].filter((n) => !allowed.has(n) && !allowed.has(n.replace(/\.0+$/, "")));
  if (bad.length) return { ok: false, issue: `The AI's draft had numbers that aren't in the sources (${bad.slice(0, 5).join(", ")}).` };
  if (/<\s*\/?\s*(script|iframe|img|a|style)\b/i.test(all)) return { ok: false, issue: "The AI's draft had HTML in it." };
  return { ok: true, article: { title_ar: str(j.title_ar, 200), body_ar: j.body_ar.trim().slice(0, 40000), title_en: str(j.title_en, 200), body_en: j.body_en.trim().slice(0, 40000) } };
}
// The plain fallback: the source's own words, with [ADD] for what's missing. Nothing invented.
export function draftFallback(f) {
  if (f.sources[0]?.kind === "support article") {
    const s = f.sources[0], ar = s.language === "ar";
    return ar ? { title_ar: str(s.question, 200), body_ar: `${s.answer}\n\n[ADD الخطوات بالتفصيل إن لزم]`, title_en: "[ADD English title]", body_en: "[ADD English translation]" }
      : { title_en: str(s.question, 200), body_en: `${s.answer}\n\n[ADD detailed steps if needed]`, title_ar: "[ADD العنوان بالعربي]", body_ar: "[ADD الترجمة العربية]" };
  }
  const qs = f.sources.map((t) => t.messages.find((m) => m.from === "customer")?.text).filter(Boolean).slice(0, 5);
  const as = f.sources.map((t) => t.messages.filter((m) => m.from === "support").at(-1)?.text).filter(Boolean).slice(0, 5);
  return { title_ar: `${catName(f.category, "ar")}: [ADD العنوان]`, title_en: `${catName(f.category)}: [ADD title]`,
    body_ar: `## السؤال\n${qs.map((q) => `- ${q.replace(/\n+/g, " ")}`).join("\n") || "- [ADD]"}\n\n## الحل\n${as.map((a) => `- ${a.replace(/\n+/g, " ")}`).join("\n") || "- [ADD]"}\n\n[ADD الخطوات بالترتيب]`,
    body_en: `## The question\n- [ADD the question in English]\n\n## The answer\n- [ADD the steps in English]` };
}
export function translatePrompt(a, from, to) {
  return `<task title="Help article translation">
You are DPA AD's AI Help writer. Translate this help article from ${from === "ar" ? "Arabic" : "English"} to ${to === "ar" ? "Saudi Arabic (friendly, clear)" : "plain English"}, keeping the meaning, the steps, the markdown and every link exactly. Do not add or remove facts or numbers; keep [ADD] markers.
Reply with JSON only: {"title":"...","body":"..."}
</task>
<article>
${JSON.stringify({ title: a[`title_${from}`], body: a[`body_${from}`] })}
</article>`;
}
export function checkTranslation(raw, a, from) {
  const j = parseJson(raw);
  if (!j || typeof j.title !== "string" || typeof j.body !== "string" || !j.body.trim()) return { ok: false, issue: "The AI's reply wasn't the expected JSON." };
  const src = new Set(numbersIn(`${a[`title_${from}`]} ${a[`body_${from}`]}`));
  const bad = [...new Set(numbersIn(`${j.title} ${j.body}`))].filter((n) => !src.has(n));
  if (bad.length) return { ok: false, issue: `The translation had numbers that aren't in the original (${bad.slice(0, 5).join(", ")}).` };
  const links = (s) => (String(s).match(/\]\(([^)\s]+)\)/g) || []).sort().join(" ");
  if (links(j.body) !== links(a[`body_${from}`])) return { ok: false, issue: "The translation changed the links." };
  return { ok: true, title: str(j.title, 200), body: j.body.trim().slice(0, 40000) };
}

export function createHelp({ store, provider, workforce = null, clock = () => Date.now() } = {}) {
  ensureHelp(store);
  const svc = { clock };
  const now = () => svc.clock();
  const level = () => (workforce ? workforce.level(AGENT_ID) : 1);
  async function ask(w, prompt) {
    if (level() === 0) return { off: true };
    try { return { raw: await withAgent(AGENT_ID, w.id, () => provider.generate({ prompt, onText: () => {} })) }; }
    catch (e) { return { error: /switched off|budget/i.test(e?.message || "") ? e.message : "The AI couldn't be reached." }; }
  }
  async function draft(w, f) {
    const fb = draftFallback(f);
    const r = await ask(w, draftPrompt(w, f));
    if (r.off) return { article: fb, by_ai: false, note: "The AI Help writer is switched off in AI Workforce: this is the plain draft from the source." };
    if (r.error) return { article: fb, by_ai: false, note: `${r.error} This is the plain draft from the source.` };
    const c = checkDraft(r.raw, f);
    if (c.ok) return { article: c.article, by_ai: true, note: "" };
    workforce?.event(AGENT_ID, w.id, "escalated", `Draft from ${f.label}: ${c.issue} Plain draft used.`);
    return { article: fb, by_ai: false, note: `${c.issue} This is the plain draft from the source instead: fill in every [ADD].` };
  }
  async function translate(w, a, to) {
    const from = to === "ar" ? "en" : "ar";
    const fb = { title: `[ADD ${to === "ar" ? "العنوان بالعربي" : "English title"}]`, body: `[ADD ${to === "ar" ? "الترجمة العربية" : "English translation"}]\n\n${a[`body_${from}`] || ""}` };
    const r = await ask(w, translatePrompt(a, from, to));
    if (r.off) return { ...fb, by_ai: false, note: "The AI Help writer is switched off in AI Workforce: translate by hand." };
    if (r.error) return { ...fb, by_ai: false, note: `${r.error} Translate by hand.` };
    const c = checkTranslation(r.raw, a, from);
    if (c.ok) return { title: c.title, body: c.body, by_ai: true, note: "" };
    workforce?.event(AGENT_ID, w.id, "escalated", `Translation of "${String(a[`title_${from}`]).slice(0, 60)}": ${c.issue}`);
    return { ...fb, by_ai: false, note: `${c.issue} Translate by hand.` };
  }
  return Object.assign(svc, { now, level, draft, translate });
}

// ---- AI Support: published articles the support chat may cite (never drafts, never customers-only)
export function helpForSupport(store, wsId, base) {
  try {
    ensureHelp(store);
    return store.listOps(COLL.articles, wsId).filter(isLive).slice(0, 30).map((a) => ({
      url: `${base}/help/a/${a.slug}`, title: [a.title_ar, a.title_en].filter(Boolean).join(" / "),
      excerpt: [plainText(a.body_ar).slice(0, 220), plainText(a.body_en).slice(0, 220)].filter(Boolean).join(" | ") }));
  } catch { return []; }
}

// ---- Command Center
export function helpNeeds(store, w, { now = Date.now() } = {}) {
  try {
    ensureHelp(store);
    const out = [], pub = store.listOps(COLL.articles, w.id).filter((a) => a.status === "published");
    const stale = pub.filter((a) => freshness(a, now).stale);
    if (stale.length) out.push({ module: "Help center", route: "helpcenter", param: "articles", title: "Help articles to re-review", text: `${stale.length} published help article${stale.length === 1 ? " hasn't" : "s haven't"} been reviewed in ${STALE_DAYS} days: ${stale.slice(0, 3).map((a) => (a.title_en || a.title_ar).slice(0, 50)).join(", ")}.` });
    const bad = pub.filter((a) => voteCounts(store, w.id, a.id, now).no_30 >= NOT_HELPFUL_MIN);
    if (bad.length) out.push({ module: "Help center", route: "helpcenter", param: "articles", title: "Help articles marked not helpful", text: `${bad.length} help article${bad.length === 1 ? " was" : "s were"} marked "not helpful" ${NOT_HELPFUL_MIN}+ times in ${NOT_HELPFUL_DAYS} days: ${bad.slice(0, 3).map((a) => (a.title_en || a.title_ar).slice(0, 50)).join(", ")}.` });
    const gaps = gapList(store, w, now).filter((g) => g.tickets >= GAP_MIN);
    if (gaps.length) out.push({ module: "Help center", route: "helpcenter", param: "gaps", title: "Help center gaps", text: `${gaps.length} support topic${gaps.length === 1 ? " has" : "s have"} ${GAP_MIN}+ tickets in ${GAP_DAYS} days and no published article: ${gaps.slice(0, 3).map((g) => `${g.name} (${g.tickets})`).join(", ")}.` });
    return out;
  } catch (e) { console.error("[helpcenter] needs:", e?.message); return []; }
}

// ---- sample data ("Sample ·", removed with Remove sample data): three published articles and one draft
export function loadSampleHelp(store, wsId, now = Date.now()) {
  ensureHelp(store);
  const id = String(wsId);
  if (store.listOps(COLL.articles, id).some((a) => a.sample)) return { articles: 0 };
  const today = todayOf(now);
  const mk = (f) => {
    const a = store.addOps(COLL.articles, id, { visibility: "public", related_ids: [], support_article_id: null, author_id: "owner", author_name: "Sample", reviewer_id: null, reviewer_name: "", last_reviewed: null, published_at: null, by_ai: false, log: [], sample: true, ...f }, false);
    a.slug = uniqueSlug(store, id, f.slug, a.id);
    if (a.status === "published") Object.assign(a, { reviewer_id: "owner", reviewer_name: "Sample", last_reviewed: today, published_at: new Date(now).toISOString() });
    logPush(a, "Sample", "Sample article added", now);
    return a;
  };
  const a1 = mk({ slug: "sample-getting-started", category: "getting-started", status: "published",
    title_ar: "Sample · وش هو DPA AD وكيف أبدأ؟", title_en: "Sample · What is DPA AD and how do I start?",
    body_ar: "DPA AD يحوّل كتالوج متجرك إلى إعلانات صور وفيديو مصممة جاهزة لميتا وسناب وتيك توك وقوقل.\n\n## الخطوات\n- اربط متجرك أو ارفع ملف المنتجات\n- اختر القالب والهوية (الشعار والألوان)\n- راجع التصاميم ثم صدّرها أو انشرها",
    body_en: "DPA AD turns your store catalog into designed image and video ads for Meta, Snap, TikTok and Google.\n\n## Steps\n- Connect your store or upload a product feed\n- Pick a template and your brand (logo and colours)\n- Review the designs, then export or publish them" });
  const a2 = mk({ slug: "sample-connect-salla", category: "connecting-salla", status: "published",
    title_ar: "Sample · ربط متجر سلة", title_en: "Sample · Connecting your Salla store",
    body_ar: "تطبيق DPA AD في سلة **قيد التجهيز**. إلى أن يتوفر، تقدر ترفع ملف المنتجات من متجرك.\n\nبنحدّث هذه المقالة بالخطوات أول ما يتوفر التطبيق.",
    body_en: "The DPA AD app for Salla is **coming soon**. Until then you can upload a product feed from your store.\n\nWe will add the steps to this article as soon as the app is live." });
  const a3 = mk({ slug: "sample-invoices-vat", category: "billing", status: "published",
    title_ar: "Sample · الفواتير وضريبة القيمة المضافة", title_en: "Sample · Invoices and VAT",
    body_ar: "كل فاتورة فيها رمز QR حسب متطلبات هيئة الزكاة والضريبة والجمارك (فاتورة).\n\nلأي سؤال عن فاتورة، تواصل معنا من رابط المساعدة أسفل الصفحة.",
    body_en: "Every invoice carries a QR code as ZATCA (Fatoora) requires.\n\nFor any question about an invoice, contact us from the link at the bottom of this page." });
  mk({ slug: "sample-video-ads", category: "video-ads", status: "draft", author_id: "owner",
    title_ar: "Sample · إعلانات الفيديو من الكتالوج", title_en: "Sample · Video ads from your catalog",
    body_ar: "[ADD كيف تختار قالب الفيديو]\n\n[ADD المقاسات المتوفرة]", body_en: "[ADD how to pick a video template]\n\n[ADD available sizes]" });
  a1.related_ids = [a2.id, a3.id]; a2.related_ids = [a1.id];
  store.save();
  return { articles: 4 };
}
export function removeSampleHelp(store, wsId) {
  ensureHelp(store);
  const id = String(wsId);
  const ids = new Set(store.db[COLL.articles].filter((a) => a.workspace_id === id && a.sample).map((a) => a.id));
  const before = store.db[COLL.articles].length, vb = store.db[COLL.votes].length;
  store.db[COLL.articles] = store.db[COLL.articles].filter((a) => !(a.workspace_id === id && a.sample));
  store.db[COLL.votes] = store.db[COLL.votes].filter((v) => !(v.workspace_id === id && (v.sample || ids.has(v.article_id))));
  for (const a of store.listOps(COLL.articles, id)) if (a.related_ids?.some((x) => ids.has(x))) a.related_ids = a.related_ids.filter((x) => !ids.has(x));
  return { help_articles: before - store.db[COLL.articles].length, help_votes: vb - store.db[COLL.votes].length };
}
