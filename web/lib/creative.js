// Creative Studio: content calendar, idea bank, AI copy in Arabic and English, approvals,
// brand kit, an email designer used by Store CRM campaigns, and "download and post" for every platform.
// Phases 2-3 (media library, image templates, reels, publishing, results) live in media.js, social.js,
// publisher.js and studioroutes.js; rendering runs in the browser (public/studio-media.js).
import { renderTemplate } from "./crm.js";

// Where content goes. Limits are the platforms' own; "tip" is our house guidance.
export const CHANNELS = [
  { id: "ig_post", name: "Instagram post", platform: "Instagram", kind: "image", ratio: "4:5 (1080×1350)", caption_max: 2200, hashtags_max: 30, tip: "First line is the hook; 3–8 hashtags." },
  { id: "ig_carousel", name: "Instagram carousel", platform: "Instagram", kind: "carousel", ratio: "4:5, up to 10 slides", caption_max: 2200, hashtags_max: 30, tip: "Slide 1 promises, last slide asks to save or DM." },
  { id: "ig_reel", name: "Instagram reel", platform: "Instagram", kind: "video", ratio: "9:16 (1080×1920)", caption_max: 2200, hashtags_max: 30, tip: "Hook in the first 2 seconds, burned-in Arabic captions." },
  { id: "ig_story", name: "Instagram story", platform: "Instagram", kind: "story", ratio: "9:16", caption_max: 250, hashtags_max: 10, tip: "Keep text inside the middle 80%." },
  { id: "tiktok", name: "TikTok", platform: "TikTok", kind: "video", ratio: "9:16", caption_max: 2200, hashtags_max: 10, tip: "Native look beats polish." },
  { id: "snapchat", name: "Snapchat story / Spotlight", platform: "Snapchat", kind: "video", ratio: "9:16", caption_max: 250, hashtags_max: 3, tip: "Most Saudi merchants' buyers are here." },
  { id: "yt_short", name: "YouTube Short", platform: "YouTube", kind: "video", ratio: "9:16", caption_max: 100, hashtags_max: 3, tip: "Title is the caption (100 characters)." },
  { id: "yt_video", name: "YouTube video", platform: "YouTube", kind: "video", ratio: "16:9", caption_max: 5000, hashtags_max: 15, tip: "Title under 70 characters; chapters in the description." },
  { id: "fb_post", name: "Facebook post", platform: "Facebook", kind: "image", ratio: "4:5 or 1:1", caption_max: 5000, hashtags_max: 5, tip: "" },
  { id: "linkedin", name: "LinkedIn post", platform: "LinkedIn", kind: "text", ratio: "1:1 or 4:5 image (optional)", caption_max: 3000, hashtags_max: 5, tip: "Founder voice; agencies and investors read here." },
  { id: "x", name: "X post", platform: "X", kind: "text", ratio: "16:9 or 1:1 image (optional)", caption_max: 280, hashtags_max: 2, tip: "Saudi merchants are active on X." },
  { id: "email", name: "Email", platform: "Email", kind: "email", ratio: "600 px wide", caption_max: 0, hashtags_max: 0, tip: "Designed in the email designer; used by Store CRM campaigns." },
  { id: "whatsapp", name: "WhatsApp message", platform: "WhatsApp", kind: "whatsapp", ratio: "1:1 or 16:9 header image", caption_max: 1024, hashtags_max: 0, tip: "Opted-in stores only; first message needs an approved template." },
];
export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
export const channelInfo = (id) => CHANNELS.find((c) => c.id === id);

export const STATUSES = [
  { id: "idea", name: "Idea" }, { id: "draft", name: "Draft" }, { id: "review", name: "In review" },
  { id: "approved", name: "Approved" }, { id: "scheduled", name: "Scheduled" }, { id: "published", name: "Published" }, { id: "archived", name: "Archived" },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);

export const DEFAULT_PILLARS = [
  { id: "education", name: "Teach", hint: "Catalog-ad tips for Saudi stores: what makes a product ad sell" },
  { id: "proof", name: "Proof", hint: "Real results: designed vs plain ROAS, case studies (real numbers only)" },
  { id: "product", name: "Product", hint: "How DPA AD works: features, templates, before/after" },
  { id: "seasonal", name: "Seasons", hint: "Ramadan, Eid, White Friday, National Day: get ready early" },
  { id: "founder", name: "Founder", hint: "Building DPA AD in Saudi: lessons, decisions, behind the scenes" },
];

// ---- Saudi season calendar. Hijri dates move ~11 days a year and depend on the moon sighting: "approx".
const SEASONS = [
  { name: "Founding Day (يوم التأسيس)", date: "02-22", lead: 21 },
  { name: "Saudi Flag Day (يوم العلم)", date: "03-11", lead: 7 },
  { name: "National Day (اليوم الوطني)", date: "09-23", lead: 30 },
  { name: "11.11 sales", date: "11-11", lead: 14 },
  { name: "White Friday (الجمعة البيضاء)", fixed: { 2026: "2026-11-27", 2027: "2027-11-26", 2028: "2028-11-24" }, lead: 30 },
  { name: "Ramadan starts (رمضان)", fixed: { 2027: "2027-02-08", 2028: "2028-01-28" }, lead: 45, approx: true },
  { name: "Eid al-Fitr (عيد الفطر)", fixed: { 2027: "2027-03-10", 2028: "2028-02-27" }, lead: 21, approx: true },
  { name: "Eid al-Adha (عيد الأضحى)", fixed: { 2027: "2027-05-16", 2028: "2028-05-05" }, lead: 21, approx: true },
  { name: "Back to school (العودة للمدارس)", fixed: { 2027: "2027-08-22", 2028: "2028-08-20" }, lead: 21, approx: true },
];
export function seasonsBetween(from, to) {
  const out = [], y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) for (const s of SEASONS) {
    const date = s.fixed ? s.fixed[y] : `${y}-${s.date}`;
    if (!date || date < from || date > to) continue;
    const start = new Date(Date.parse(date) - s.lead * 864e5).toISOString().slice(0, 10);
    out.push({ name: s.name, date, prepare_from: start, lead_days: s.lead, approx: !!s.approx });
  }
  // Government salaries are paid on the 27th: the last days of each month are strong for offers.
  for (let d = new Date(from.slice(0, 7) + "-27T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 27))) {
    const date = d.toISOString().slice(0, 10);
    if (date >= from) out.push({ name: "Payday (الراتب)", date, prepare_from: date, lead_days: 0, approx: false, minor: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Brand kit
export const DEFAULT_BRAND = {
  colors: { primary: "#1f5eff", accent: "#ff7a1a", ink: "#111111", background: "#ffffff" },
  font_ar: "Tajawal", font_en: "Inter", logo_url: "",
  tone: "Friendly, confident and performance-minded: plain words, ROAS-first, no jargon. Saudi Arabic for merchants.",
  do: ["Show real store products", "One clear ask per piece", "Arabic first, English second"],
  dont: ["Invented numbers or results", "Guaranteed ROAS", "Competitor names in ads"],
  hashtags: ["#DPAAD", "#سلة", "#التجارة_الإلكترونية", "#إعلانات"],
  approver_roles: ["owner", "admin", "manager"],
};
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const list = (v, n, max) => (Array.isArray(v) ? v : String(v || "").split(/\n|,/)).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const isColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ""));
export const safeUrl = (u) => { const s = str(u, 1000); return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ""; };
export function cleanBrand(b = {}, cur = DEFAULT_BRAND) {
  const colors = { ...cur.colors };
  for (const k of Object.keys(DEFAULT_BRAND.colors)) if (isColor(b.colors?.[k])) colors[k] = b.colors[k];
  return {
    colors, font_ar: str(b.font_ar ?? cur.font_ar, 40) || DEFAULT_BRAND.font_ar, font_en: str(b.font_en ?? cur.font_en, 40) || DEFAULT_BRAND.font_en,
    logo_url: b.logo_url !== undefined ? safeUrl(b.logo_url) : cur.logo_url, tone: str(b.tone ?? cur.tone, 600),
    do: b.do !== undefined ? list(b.do, 12, 120) : cur.do, dont: b.dont !== undefined ? list(b.dont, 12, 120) : cur.dont,
    hashtags: b.hashtags !== undefined ? list(Array.isArray(b.hashtags) ? b.hashtags : String(b.hashtags).split(/[\s,]+/), 15, 40).map((h) => (h.startsWith("#") ? h : "#" + h)) : cur.hashtags,
    approver_roles: b.approver_roles !== undefined ? list(b.approver_roles, 10, 40) : cur.approver_roles,
  };
}

// ---- Content items. One idea, with a variant per channel.
export const BLOCK_TYPES = ["header", "hero", "text", "button", "image", "compare", "products", "quote", "divider"];
function cleanBlock(b) {
  const t = BLOCK_TYPES.includes(b?.type) ? b.type : "text";
  const o = { type: t };
  if (["hero", "text", "quote"].includes(t)) o.text = str(b.text, 2000);
  if (["hero"].includes(t)) o.title = str(b.title, 200);
  if (["header"].includes(t)) o.preheader = str(b.preheader, 150);
  if (["hero", "image"].includes(t)) { o.image_url = safeUrl(b.image_url); o.image_alt = str(b.image_alt, 150); }
  if (t === "button") { o.label = str(b.label, 60); o.url = safeUrl(b.url); }
  if (t === "image") o.link = safeUrl(b.link);
  if (t === "compare") { o.before_url = safeUrl(b.before_url); o.after_url = safeUrl(b.after_url); o.caption = str(b.caption, 300); }
  if (t === "products") o.items = (b.items || []).slice(0, 3).map((p) => ({ title: str(p.title, 80), price: str(p.price, 30), image_url: safeUrl(p.image_url), url: safeUrl(p.url) }));
  if (t === "quote") o.author = str(b.author, 100);
  return o;
}
export function cleanVariant(channel, v = {}) {
  const o = { caption_ar: str(v.caption_ar, 5000), caption_en: str(v.caption_en, 5000), hashtags: list(Array.isArray(v.hashtags) ? v.hashtags : String(v.hashtags || "").split(/[\s,]+/), 30, 40).map((h) => (h.startsWith("#") ? h : "#" + h)),
    notes: str(v.notes, 2000), asset_url: safeUrl(v.asset_url),
    // Phase 2: files from the media library (ids, in order: carousel slides follow this order).
    media: [...new Set((Array.isArray(v.media) ? v.media : []).map((x) => String(x)).filter((x) => /^\d{1,12}$/.test(x)))].slice(0, 10),
    cover_id: /^\d{1,12}$/.test(String(v.cover_id || "")) ? String(v.cover_id) : "" };
  const kind = channelInfo(channel)?.kind;
  if (kind === "video") {
    o.script = str(v.script, 4000);
    // Reel builder spec (phase 3), so the reel can be re-made after edits.
    if (v.reel && Array.isArray(v.reel.scenes)) o.reel = { scenes: v.reel.scenes.slice(0, 20).map((s) => ({ media_id: /^\d{1,12}$/.test(String(s.media_id || "")) ? String(s.media_id) : "", text: str(s.text, 300),
      duration: Math.max(1, Math.min(15, Number(s.duration) || 3)), motion: ["zoom_in", "zoom_out", "slide_left", "slide_right", "none"].includes(s.motion) ? s.motion : "zoom_in" })),
      audio_id: /^\d{1,12}$/.test(String(v.reel.audio_id || "")) ? String(v.reel.audio_id) : "", volume: Math.max(0, Math.min(1, Number(v.reel.volume ?? 0.8))), cover_scene: Math.max(0, Math.min(19, Number(v.reel.cover_scene) || 0)) };
  }
  if (kind === "carousel") o.slides = list(v.slides, 10, 400);
  if (kind === "email") { o.subject = str(v.subject, 150); o.preheader = str(v.preheader, 150); o.blocks = (v.blocks || []).slice(0, 25).map(cleanBlock); }
  if (kind === "whatsapp") { o.template_name = str(v.template_name, 80); o.button = str(v.button, 25); }
  return o;
}
export function cleanItem(b = {}, cur = {}) {
  const o = {};
  if (b.title !== undefined) o.title = str(b.title, 160);
  if (b.brief !== undefined) o.brief = str(b.brief, 3000);
  if (b.pillar !== undefined) o.pillar = str(b.pillar, 40);
  if (b.date !== undefined) o.date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : null;
  if (b.time !== undefined) o.time = /^\d{2}:\d{2}$/.test(String(b.time || "")) ? b.time : "";
  if (b.season !== undefined) o.season = str(b.season, 80);
  if (b.assignee_id !== undefined) o.assignee_id = b.assignee_id ? String(b.assignee_id) : null;
  if (b.channels !== undefined) o.channels = [...new Set((b.channels || []).filter((c) => CHANNEL_IDS.includes(c)))];
  if (b.variants !== undefined || o.channels) {
    const chans = o.channels || cur.channels || [];
    const vs = { ...(cur.variants || {}), ...(b.variants || {}) };
    o.variants = Object.fromEntries(chans.map((c) => [c, cleanVariant(c, vs[c] || {})]));
  }
  return o;
}

// ---- Checks before anything goes out. Rule-based so they always run, AI or not.
export function checkItem(item, brand = DEFAULT_BRAND) {
  const out = [];
  const add = (level, channel, text) => out.push({ level, channel, text });
  if (!item.channels?.length) add("bad", null, "Pick at least one channel.");
  if (!item.date) add("warn", null, "No date yet: it won't show on the calendar.");
  for (const ch of item.channels || []) {
    const c = channelInfo(ch), v = item.variants?.[ch] || {}, name = c.name;
    if (c.kind === "email") {
      if (!v.subject) add("bad", ch, `${name}: add a subject line.`);
      if (!(v.blocks || []).length) add("bad", ch, `${name}: the email has no content blocks.`);
      if ((v.blocks || []).some((b) => b.type === "button" && !b.url)) add("bad", ch, `${name}: a button has no link (https:// only).`);
      if ((v.blocks || []).some((b) => b.type === "quote" && !b.author)) add("bad", ch, `${name}: quotes need the real person's name, with their permission.`);
      if ((v.blocks || []).some((b) => ["image", "hero"].includes(b.type) && b.image_url && !b.image_alt)) add("warn", ch, `${name}: add alt text to images.`);
    } else {
      const text = v.caption_ar || v.caption_en || "";
      if (!text) add("bad", ch, `${name}: no caption yet.`);
      if (!v.caption_ar && c.kind !== "email") add("warn", ch, `${name}: no Arabic caption (Arabic first).`);
      const len = Math.max((v.caption_ar || "").length, (v.caption_en || "").length) + (v.hashtags || []).join(" ").length;
      if (c.caption_max && len > c.caption_max) add("bad", ch, `${name}: ${len} characters with hashtags; the limit is ${c.caption_max}.`);
      if (c.hashtags_max != null && (v.hashtags || []).length > c.hashtags_max) add("warn", ch, `${name}: ${v.hashtags.length} hashtags; keep to ${c.hashtags_max}.`);
      if (c.kind === "video" && !v.script) add("warn", ch, `${name}: no script for the video yet.`);
      if (c.kind === "carousel" && (v.slides || []).length < 2) add("warn", ch, `${name}: a carousel needs 2+ slides.`);
      if (c.kind !== "text" && c.kind !== "whatsapp" && !v.asset_url && !(v.media || []).length) add("warn", ch, `${name}: attach or link the image or video (${c.ratio}) before posting.`);
      if (c.kind === "whatsapp" && !v.template_name) add("warn", ch, `${name}: first messages need an approved WhatsApp template name.`);
    }
    // Claims: any number or % must come from real data, and nothing from the brand's "don't" list.
    const all = JSON.stringify(v);
    if (/[\d٠-٩]+\s?(%|٪|x\b|أضعاف|ضعف|مرات)/i.test(all)) add("warn", ch, `${name}: has a number or % claim. Confirm it's from real results (ROAS page) before approving.`);
    if (/مضمون|guaranteed?/i.test(all)) add("bad", ch, `${name}: never guarantee results.`);
  }
  return out;
}

// ---- Download-and-post pack (plain text) for platforms without direct publishing yet.
export function packText(item, ch, mediaUrls = []) {
  const c = channelInfo(ch), v = item.variants?.[ch] || {};
  const tags = (v.hashtags || []).join(" ");
  return [`${item.title} · ${c.name}`, `Format: ${c.ratio}`, item.date ? `Post on: ${item.date}${item.time ? " " + item.time : ""} (Riyadh)` : "", "",
    v.caption_ar ? `— Arabic —\n${v.caption_ar}${tags ? "\n\n" + tags : ""}` : "", v.caption_en ? `\n— English —\n${v.caption_en}${tags ? "\n\n" + tags : ""}` : "",
    v.slides?.length ? `\n— Slides —\n${v.slides.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "", v.script ? `\n— Script —\n${v.script}` : "",
    v.asset_url ? `\nMedia: ${v.asset_url}` : "", mediaUrls.length ? `\nFiles:\n${mediaUrls.join("\n")}` : "", v.notes ? `\nNotes: ${v.notes}` : ""].filter((x) => x !== "").join("\n").trim() + "\n";
}

// ---- Email designer: blocks → table-based HTML that works in Gmail, Outlook and phones, RTL-aware.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const para = (s) => esc(s).replace(/\n/g, "<br>");
export function renderEmail(design = {}, brand = DEFAULT_BRAND, { vars = {}, footer = null } = {}) {
  const v = (s) => renderTemplate(s || "", vars.contact || {}, vars.extra || {});
  const blocks = design.blocks || [];
  const rtl = /[؀-ۿ]/.test(JSON.stringify(blocks) + (design.subject || ""));
  const dir = rtl ? "rtl" : "ltr", align = rtl ? "right" : "left";
  const C = brand.colors || DEFAULT_BRAND.colors;
  const font = `${rtl ? `'${brand.font_ar}',` : `'${brand.font_en}',`}Tahoma,Arial,sans-serif`;
  const img = (url, alt, w = 536) => `<img src="${esc(url)}" alt="${esc(v(alt))}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:10px">`;
  const row = (inner, pad = "12px 32px") => `<tr><td style="padding:${pad};text-align:${align}">${inner}</td></tr>`;
  const parts = blocks.map((b) => {
    switch (b.type) {
      case "header": return row(`${brand.logo_url ? `<img src="${esc(brand.logo_url)}" alt="${esc(vars.company || "DPA AD")}" height="32" style="height:32px;border:0">` : `<b style="font-size:18px;color:${C.primary}">${esc(vars.company || "DPA AD")}</b>`}`, "24px 32px 8px");
      case "hero": return row(`${b.image_url ? img(b.image_url, b.image_alt) + `<div style="height:16px"></div>` : ""}<h1 style="margin:0 0 8px;font-size:24px;line-height:1.4;color:${C.ink}">${para(v(b.title))}</h1><p style="margin:0;font-size:16px;line-height:1.8;color:#444">${para(v(b.text))}</p>`, "16px 32px");
      case "text": return row(`<p style="margin:0;font-size:16px;line-height:1.8;color:#333">${para(v(b.text))}</p>`);
      case "button": return b.url ? row(`<a href="${esc(b.url)}" style="display:inline-block;background:${C.primary};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px">${esc(v(b.label) || "ابدأ الآن")}</a>`, "16px 32px") : "";
      case "image": return b.image_url ? row(b.link ? `<a href="${esc(b.link)}">${img(b.image_url, b.image_alt)}</a>` : img(b.image_url, b.image_alt)) : "";
      case "compare": return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" style="padding:0 6px;text-align:center;vertical-align:top">${b.before_url ? img(b.before_url, "قبل", 260) : ""}<div style="font-size:13px;color:#777;padding-top:6px">${rtl ? "الصورة العادية" : "Plain packshot"}</div></td>
        <td width="50%" style="padding:0 6px;text-align:center;vertical-align:top">${b.after_url ? img(b.after_url, "بعد", 260) : ""}<div style="font-size:13px;color:${C.primary};font-weight:bold;padding-top:6px">${rtl ? "إعلان مصمم من DPA AD" : "Designed by DPA AD"}</div></td></tr></table>
        ${b.caption ? `<p style="margin:10px 0 0;font-size:14px;color:#555;text-align:center">${para(v(b.caption))}</p>` : ""}`);
      case "products": return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${(b.items || []).map((p) => `<td width="${Math.floor(100 / Math.max(1, b.items.length))}%" style="padding:0 6px;vertical-align:top;text-align:center">
        ${p.image_url ? (p.url ? `<a href="${esc(p.url)}">${img(p.image_url, p.title, 170)}</a>` : img(p.image_url, p.title, 170)) : ""}<div style="font-size:14px;color:${C.ink};padding-top:6px">${esc(v(p.title))}</div>${p.price ? `<div style="font-size:14px;font-weight:bold;color:${C.accent}">${esc(p.price)}</div>` : ""}</td>`).join("")}</tr></table>`);
      case "quote": return row(`<div style="border-${rtl ? "right" : "left"}:4px solid ${C.accent};padding:4px 16px"><p style="margin:0;font-size:16px;line-height:1.8;font-style:italic;color:#333">${para(v(b.text))}</p><p style="margin:6px 0 0;font-size:13px;color:#777">— ${esc(b.author)}</p></div>`);
      case "divider": return row(`<div style="border-top:1px solid #e6e6e6"></div>`);
      default: return "";
    }
  }).join("\n");
  const foot = footer ? `<tr><td style="padding:24px 32px 32px;text-align:center;font-size:12px;line-height:1.7;color:#888">${esc(footer.company)} · ${esc(footer.address)}<br><a href="${esc(footer.unsubscribe)}" style="color:#888">لإيقاف هذه الرسائل · Unsubscribe</a></td></tr>` : "";
  const pre = blocks.find((b) => b.type === "header")?.preheader || design.preheader || "";
  const html = `<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(v(design.subject))}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6"><div style="display:none;max-height:0;overflow:hidden">${esc(v(pre))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" dir="${dir}" style="width:100%;max-width:600px;background:${C.background};border-radius:16px;font-family:${font};direction:${dir}">
${parts}
${foot}
</table></td></tr></table></body></html>`;
  const text = blocks.map((b) => ({ hero: `${v(b.title)}\n${v(b.text)}`, text: v(b.text), button: b.url ? `${v(b.label)}: ${b.url}` : "", quote: `"${v(b.text)}" — ${b.author}`, compare: v(b.caption), products: (b.items || []).map((p) => `${v(p.title)} ${p.price}`).join(" · ") })[b.type] || "").filter(Boolean).join("\n\n");
  return { html, text, subject: v(design.subject), rtl };
}

// A ready email design to start from (Arabic).
export const STARTER_EMAIL = {
  subject: "إعلانات مصممة لكل منتج في {{store_name}}",
  preheader: "شوف الفرق بين الصورة العادية والإعلان المصمم",
  blocks: [
    { type: "header", preheader: "شوف الفرق بين الصورة العادية والإعلان المصمم" },
    { type: "hero", title: "منتجاتكم تستاهل أكثر من صورة على خلفية بيضاء", text: "DPA AD يحوّل كتالوج {{store_name}} إلى إعلانات صور وفيديو مصممة بالعربي لسناب وتيك توك وميتا، والسعر والخصم يتحدّثون تلقائياً." },
    { type: "compare", before_url: "", after_url: "", caption: "نفس المنتج: صورة الكتالوج العادية مقابل إعلان مصمم" },
    { type: "text", text: "نجهّز لكم ٣ نماذج مجانية من منتجاتكم أنتم، بدون أي إعداد من طرفكم." },
    { type: "button", label: "أبي ٣ نماذج مجانية", url: "https://dpa.ad" },
    { type: "divider" },
    { type: "text", text: "{{sender_name}}\nفريق DPA AD" },
  ],
};

// ---- AI prompts. Every output is JSON so it can be reviewed and edited field by field.
const companyBlock = (ws, brand) => `<company>\n${ws.brief.company_name}: ${ws.brief.one_liner}\nCustomers: ${ws.brief.target_customers}\nVoice: ${brand.tone}\nDo: ${brand.do.join("; ")}\nDon't: ${brand.dont.join("; ")}\nCore hashtags: ${brand.hashtags.join(" ")}\n</company>`;
const RULES = "Never invent numbers, results, customers or quotes: where a real number belongs write [ADD REAL NUMBER]. Arabic is natural Saudi dialect, short and friendly. Return ONLY JSON, no prose.";

export function planPrompt(ws, brand, { month, pillars, seasons, count, knowledge }) {
  return `${companyBlock(ws, brand)}
<pillars>\n${pillars.map((p) => `- ${p.id}: ${p.name} — ${p.hint}`).join("\n")}\n</pillars>
<saudi_seasons_soon>\n${seasons.map((s) => `- ${s.name} on ${s.date}${s.approx ? " (approx)" : ""}; prepare from ${s.prepare_from}`).join("\n") || "none"}\n</saudi_seasons_soon>
${knowledge ? `<company_knowledge>\n${knowledge}\n</company_knowledge>` : ""}
<task title="Content calendar for ${month}">
Plan ${count} pieces of DPA AD marketing content for ${month}, aimed at Saudi Salla/Zid store owners (and agencies on LinkedIn). Mix the pillars; cover upcoming seasons early enough. Spread dates across the month on Sunday–Thursday mostly. Use only these channel ids: ${CHANNEL_IDS.join(", ")}.
JSON: {"items":[{"title":"short working title","pillar":"pillar id","date":"YYYY-MM-DD","channels":["ig_reel","tiktok"],"brief":"2-3 lines: angle, hook, what to show, the one ask","season":"season name or empty"}]}
${RULES}
</task>`;
}
export function ideasPrompt(ws, brand, { pillars, sources }) {
  return `${companyBlock(ws, brand)}
<pillars>\n${pillars.map((p) => `- ${p.id}: ${p.name} — ${p.hint}`).join("\n")}\n</pillars>
<sources>\n${sources}\n</sources>
<task title="Idea bank">
Turn the sources (knowledge notes, real results, support questions, store replies) into 8 content ideas DPA AD can post. Each idea uses something real from the sources.
JSON: {"items":[{"title":"...","pillar":"pillar id","channels":["..."],"brief":"angle, hook, what to show, the one ask; say which source it came from"}]}
Channel ids: ${CHANNEL_IDS.join(", ")}. ${RULES}
</task>`;
}
export function writePrompt(ws, brand, item, channels) {
  const spec = channels.map((id) => { const c = channelInfo(id); return `- ${id} (${c.name}, ${c.kind}, ${c.ratio}, caption max ${c.caption_max || "n/a"}, max ${c.hashtags_max} hashtags). ${c.tip}`; }).join("\n");
  const shape = channels.map((id) => {
    const k = channelInfo(id).kind;
    const extra = k === "video" ? `,"script":"scene-by-scene script with on-screen Arabic text, 15–45 seconds"` : k === "carousel" ? `,"slides":["slide 1 text","slide 2 text","..."]` : k === "whatsapp" ? `,"button":"button text, max 20 characters"` : "";
    return k === "email"
      ? `"${id}":{"subject":"...","preheader":"...","blocks":[{"type":"header","preheader":"..."},{"type":"hero","title":"...","text":"..."},{"type":"text","text":"..."},{"type":"button","label":"...","url":"https://dpa.ad"}]}`
      : `"${id}":{"caption_ar":"...","caption_en":"...","hashtags":["#..."]${extra}}`;
  }).join(",");
  return `${companyBlock(ws, brand)}
<content title="${item.title}" pillar="${item.pillar || ""}" season="${item.season || ""}">\n${item.brief || ""}\n</content>
<channels>\n${spec}\n</channels>
<task title="Write every version">
Write this piece for each channel, native to the platform. Arabic first (Saudi dialect), English second. Hook in the first line. One clear ask. Respect each caption limit including hashtags. Email blocks may use {{store_name}} and {{sender_name}}.
JSON: {${shape}}
${RULES}
</task>`;
}
export function parseJsonObject(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
