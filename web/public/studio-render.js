/* Creative Studio rendering, in the browser (Hostinger can't run headless Chrome or ffmpeg).
   Images: HTML canvas → JPEG (Instagram only accepts JPEG). Reels: canvas + WebCodecs H.264 (+ AAC audio),
   muxed to MP4 with mp4-muxer from jsDelivr at a pinned version. No DOM UI here: studio-media.js uses it. */

const CSR_MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs";
const CSR_NO_CODECS = "This browser can't make MP4 video (it needs WebCodecs with H.264). Use Chrome or Edge on a computer.";

// The 8 built-in templates. "style" is the layout; sizes adapt when one design renders for several channels.
const CSR_TEMPLATES = [
  { id: "post", name: "Post 4:5", w: 1080, h: 1350, style: "classic", hint: "Instagram and Facebook feed" },
  { id: "square", name: "Square 1:1", w: 1080, h: 1080, style: "classic", hint: "LinkedIn, X, feed" },
  { id: "story", name: "Story 9:16", w: 1080, h: 1920, style: "classic", hint: "Stories; text kept in the middle 80%" },
  { id: "carousel", name: "Carousel slide", w: 1080, h: 1350, style: "carousel", hint: "One slide per line of the carousel" },
  { id: "before_after", name: "Before / after", w: 1080, h: 1350, style: "before_after", hint: "Plain packshot vs designed ad" },
  { id: "price", name: "Price / offer card", w: 1080, h: 1350, style: "price", hint: "Big price or discount badge" },
  { id: "yt_thumb", name: "YouTube thumbnail 16:9", w: 1280, h: 720, style: "thumb", hint: "Few big words" },
  { id: "wa_header", name: "WhatsApp header 1.91:1", w: 1200, h: 628, style: "classic", hint: "Image header for WhatsApp templates" },
];
// What each channel needs. yt_video gets a thumbnail (its cover); video channels use the reel builder.
const CSR_CHANNEL_SIZE = { ig_post: [1080, 1350], fb_post: [1080, 1350], ig_story: [1080, 1920], ig_carousel: [1080, 1350], linkedin: [1080, 1080], x: [1600, 900], whatsapp: [1200, 628], yt_video: [1280, 720] };
const CSR_VIDEO_CHANNELS = ["ig_reel", "tiktok", "yt_short", "snapchat"];

const csrAr = (s) => /[؀-ۿ]/.test(String(s || ""));
let csrFontsKey = "";
async function csrFonts(brand) {
  const key = brand.font_ar + "|" + brand.font_en;
  if (csrFontsKey !== key) {
    csrFontsKey = key;
    const fam = (f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700;800`;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = `https://fonts.googleapis.com/css2?${fam(brand.font_ar)}&${fam(brand.font_en)}&display=swap`;
    document.head.appendChild(link);
    await new Promise((r) => { link.onload = r; link.onerror = r; setTimeout(r, 4000); });
  }
  // Canvas only uses a web font once it's loaded: wait for both scripts' glyphs (or give up after 4 s).
  await Promise.race([Promise.all([document.fonts.load(`800 64px "${brand.font_ar}"`, "عربي"), document.fonts.load(`700 64px "${brand.font_en}"`, "Ab1")]).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
}
function csrImg(url) {
  return new Promise((res) => {
    if (!url) return res(null);
    const im = new Image();
    im.crossOrigin = "anonymous"; // a logo on another site must allow CORS, or it's skipped (a tainted canvas can't export)
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = url;
  });
}
const csrFont = (brand, text, weight, size) => `${weight} ${Math.round(size)}px "${csrAr(text) ? brand.font_ar : brand.font_en}", "${brand.font_ar}", Tahoma, Arial, sans-serif`;

function csrWrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}
// Largest size where the text fits the box. Returns { size, lines }.
function csrFit(ctx, brand, text, { w, h, max, min = 18, weight = 800, lh = 1.25, maxLines = 6 }) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = csrFont(brand, text, weight, size);
    const lines = csrWrap(ctx, text, w);
    if (lines.length <= maxLines && lines.length * size * lh <= h && lines.every((l) => ctx.measureText(l).width <= w)) return { size, lines };
  }
  ctx.font = csrFont(brand, text, weight, min);
  return { size: min, lines: csrWrap(ctx, text, w).slice(0, maxLines) };
}
// Draws text in a box. align: "center" or "start" (start = right edge for Arabic). Returns the height used.
function csrText(ctx, brand, text, { x, y, w, h, max, min, weight = 800, color, align = "start", lh = 1.25, maxLines, valign = "top", shadow = false }) {
  if (!text) return 0;
  const { size, lines } = csrFit(ctx, brand, text, { w, h, max, min, weight, lh, maxLines });
  const rtl = csrAr(text);
  ctx.save();
  ctx.font = csrFont(brand, text, weight, size);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.fillStyle = color; ctx.textBaseline = "top";
  if (shadow) { ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = size * 0.25; }
  const ax = align === "center" ? x + w / 2 : rtl ? x + w : x;
  ctx.textAlign = align === "center" ? "center" : rtl ? "right" : "left";
  const used = lines.length * size * lh;
  const y0 = valign === "middle" ? y + (h - used) / 2 : valign === "bottom" ? y + h - used : y;
  lines.forEach((l, n) => ctx.fillText(l, ax, y0 + n * size * lh + size * (lh - 1) / 2));
  ctx.restore();
  return used;
}
function csrRound(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function csrDrawImage(ctx, img, x, y, w, h, { mode = "contain", r = 0, bg = null } = {}) {
  ctx.save();
  csrRound(ctx, x, y, w, h, r); ctx.clip();
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); }
  if (img) {
    const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height;
    const s = mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
  }
  ctx.restore();
}
function csrPill(ctx, brand, text, { x, y, h, bg, color, align = "start", rtl, maxW }) {
  if (!text) return 0;
  ctx.save();
  let size = h * 0.42;
  ctx.font = csrFont(brand, text, 800, size);
  while (ctx.measureText(text).width > maxW - h && size > 14) { size -= 2; ctx.font = csrFont(brand, text, 800, size); }
  const w = Math.min(maxW, ctx.measureText(text).width + h);
  const left = align === "center" ? x - w / 2 : rtl ? x - w : x;
  ctx.fillStyle = bg; csrRound(ctx, left, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = csrAr(text) ? "rtl" : "ltr";
  ctx.fillText(text, left + w / 2, y + h / 2 + size * 0.05);
  ctx.restore();
  return w;
}
function csrBadge(ctx, brand, text, cx, cy, r) {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = brand.colors.accent; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  csrText(ctx, brand, text, { x: cx - r * 0.78, y: cy - r * 0.7, w: r * 1.56, h: r * 1.4, max: r * 0.62, min: 14, color: "#ffffff", align: "center", valign: "middle", maxLines: 3, lh: 1.1 });
}

// Draws one design. f = { headline, subline, badge, cta, slide, slideNo, slideCount }, imgs = [Image...], logo = Image.
function csrDraw(ctx, W, H, style, f, brand, imgs = [], logo = null) {
  const C = brand.colors, rtl = csrAr(f.headline || f.subline || f.slide || "ع");
  const land = W / H > 1.3, tall = H / W > 1.5, pad = Math.round(Math.min(W, H) * 0.07);
  ctx.save();
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  // Brand shape: a primary-colour block behind the product.
  ctx.fillStyle = C.primary; ctx.globalAlpha = 0.1;
  ctx.beginPath(); ctx.arc(rtl ? W * 0.15 : W * 0.85, H * 0.12, Math.max(W, H) * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  const logoBox = () => { if (logo) { const lh = Math.round(Math.min(W, H) * 0.06), lw = lh * (logo.naturalWidth / logo.naturalHeight); ctx.drawImage(logo, rtl ? W - pad - lw : pad, pad * 0.8, lw, lh); } };
  const start = rtl ? W - pad : pad;
  if (style === "thumb") {
    csrDrawImage(ctx, imgs[0], 0, 0, W, H, { mode: "cover", bg: C.ink });
    const g = ctx.createLinearGradient(rtl ? W : 0, 0, rtl ? 0 : W, 0); g.addColorStop(0, "rgba(0,0,0,.78)"); g.addColorStop(0.65, "rgba(0,0,0,.1)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    csrText(ctx, brand, f.headline, { x: rtl ? W * 0.38 : pad, y: pad, w: W * 0.62 - pad, h: H - pad * 2.6, max: H * 0.22, min: 30, color: "#ffffff", valign: "middle", maxLines: 3, lh: 1.1, shadow: true });
    if (f.badge) csrPill(ctx, brand, f.badge, { x: start, y: H - pad * 2, h: pad * 1.3, bg: C.accent, color: "#fff", rtl, maxW: W * 0.5 });
    logoBox(); return;
  }
  if (style === "before_after") {
    const gap = pad * 0.5, top = pad * 2.6, cap = H * (land ? 0.16 : 0.12), boxH = land ? H - top - cap - pad * 1.6 : (H - top - cap - pad * 2 - gap) / 2, boxW = land ? (W - pad * 2 - gap) / 2 : W - pad * 2;
    csrText(ctx, brand, f.headline, { x: pad, y: pad * 0.9, w: W - pad * 2, h: top - pad * 1.1, max: H * 0.06, min: 20, color: C.ink, align: "center", maxLines: 2, valign: "middle" });
    const pos = [[pad, top], land ? [pad + boxW + gap, top] : [pad, top + boxH + gap + cap / 2]];
    const labels = rtl ? ["قبل: صورة الكتالوج", "بعد: إعلان مصمم"] : ["Before: plain packshot", "After: designed ad"];
    if (rtl && land) pos.reverse();
    pos.forEach(([x, y], n) => {
      csrDrawImage(ctx, imgs[n] || null, x, y, boxW, boxH, { r: pad * 0.4, bg: n ? C.primary + "22" : "#f1f1f1" });
      if (!imgs[n]) csrText(ctx, brand, n ? (rtl ? "اختر صورة الإعلان المصمم" : "Pick the designed ad") : (rtl ? "اختر صورة المنتج العادية" : "Pick the plain packshot"), { x, y, w: boxW, h: boxH, max: 30, min: 16, color: "#999", align: "center", valign: "middle", weight: 400 });
      csrPill(ctx, brand, labels[n], { x: x + boxW / 2, y: y + boxH - pad * 1.1, h: pad * 0.8, bg: n ? C.primary : "#555", color: "#fff", align: "center", maxW: boxW - pad });
    });
    csrText(ctx, brand, f.subline, { x: pad, y: H - pad - cap, w: W - pad * 2, h: cap, max: H * 0.035, min: 16, color: "#444", align: "center", weight: 400, maxLines: 2, valign: "middle" });
    logoBox(); return;
  }
  if (style === "carousel") {
    ctx.fillStyle = C.primary; ctx.fillRect(0, 0, W, Math.round(H * 0.012));
    const n = `${f.slideNo || 1}/${f.slideCount || 1}`;
    ctx.save(); ctx.font = csrFont(brand, "1", 700, H * 0.03); ctx.fillStyle = C.primary; ctx.textBaseline = "top"; ctx.textAlign = rtl ? "left" : "right"; ctx.fillText(n, rtl ? pad : W - pad, pad); ctx.restore();
    const imgH = imgs[0] ? H * 0.36 : 0;
    csrText(ctx, brand, f.slide || f.headline, { x: pad, y: pad * 2.4, w: W - pad * 2, h: H - pad * 4.4 - imgH, max: H * 0.075, min: 22, color: C.ink, valign: "middle", maxLines: 7 });
    if (imgs[0]) csrDrawImage(ctx, imgs[0], pad, H - pad * 1.9 - imgH, W - pad * 2, imgH, { r: pad * 0.4 });
    const last = (f.slideNo || 1) === (f.slideCount || 1);
    csrPill(ctx, brand, last ? (f.cta || (rtl ? "احفظ المنشور" : "Save this post")) : (rtl ? "اسحب ←" : "Swipe →"), { x: start, y: H - pad * 1.5, h: pad * 0.9, bg: last ? C.primary : C.ink, color: "#fff", rtl, maxW: W * 0.6 });
    logoBox(); return;
  }
  // classic and price: product image + headline + subline + badge + CTA, laid out by aspect ratio.
  const priceStyle = style === "price";
  if (land) {
    const iw = W * 0.44;
    csrDrawImage(ctx, imgs[0], rtl ? pad : W - pad - iw, pad, iw, H - pad * 2, { r: pad * 0.5, bg: "#f4f4f4" });
    const tx = rtl ? pad * 2 + iw : pad, tw = W - iw - pad * 3;
    const hh = csrText(ctx, brand, f.headline, { x: tx, y: pad * 1.8, w: tw, h: H * 0.42, max: H * 0.12, min: 22, color: C.ink, maxLines: 3 });
    csrText(ctx, brand, f.subline, { x: tx, y: pad * 2 + hh, w: tw, h: H * 0.2, max: H * 0.055, min: 14, color: "#555", weight: 400, maxLines: 2 });
    if (f.cta) csrPill(ctx, brand, f.cta, { x: rtl ? tx + tw : tx, y: H - pad - H * 0.12, h: H * 0.12, bg: C.primary, color: "#fff", rtl, maxW: tw });
    const br = H * (priceStyle ? 0.15 : 0.11); // inside the image's inner top corner, clear of the text
    if (f.badge) csrBadge(ctx, brand, f.badge, rtl ? pad + iw - br * 0.85 : W - pad - iw + br * 0.85, pad + br * 0.85, br);
    logoBox(); return;
  }
  const safeTop = tall ? H * 0.1 : pad * 2.2, safeBottom = tall ? H * 0.1 : pad;
  const imgH = (H - safeTop - safeBottom) * (priceStyle ? 0.5 : 0.55);
  csrDrawImage(ctx, imgs[0], pad, safeTop, W - pad * 2, imgH, { r: pad * 0.5, bg: "#f4f4f4" });
  if (!imgs[0]) csrText(ctx, brand, rtl ? "اختر صورة المنتج" : "Pick a product image", { x: pad, y: safeTop, w: W - pad * 2, h: imgH, max: 34, min: 16, color: "#aaa", align: "center", valign: "middle", weight: 400 });
  if (f.badge) csrBadge(ctx, brand, f.badge, rtl ? pad + W * 0.14 : W - pad - W * 0.14, safeTop + W * 0.14, W * (priceStyle ? 0.17 : 0.12));
  let y = safeTop + imgH + pad * 0.6;
  const rest = H - safeBottom - y, ctaH = Math.round(Math.min(W, H) * 0.1);
  y += csrText(ctx, brand, f.headline, { x: pad, y, w: W - pad * 2, h: rest * 0.48, max: W * 0.085, min: 22, color: C.ink, maxLines: 3 }) + pad * 0.25;
  csrText(ctx, brand, f.subline, { x: pad, y, w: W - pad * 2, h: Math.max(0, H - safeBottom - ctaH - pad * 0.6 - y), max: W * 0.042, min: 14, color: "#555", weight: 400, maxLines: 3 });
  if (f.cta) csrPill(ctx, brand, f.cta, { x: start, y: H - safeBottom - ctaH, h: ctaH, bg: C.primary, color: "#fff", rtl, maxW: W - pad * 2 });
  logoBox();
}

// Renders to a canvas and returns { canvas, blob } (JPEG).
async function csrRender({ w, h, style, fields, brand, imageUrls = [], quality = 0.9 }) {
  await csrFonts(brand);
  const [logo, ...imgs] = await Promise.all([csrImg(brand.logo_url), ...imageUrls.map(csrImg)]);
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  csrDraw(canvas.getContext("2d"), w, h, style, fields, brand, imgs, logo);
  const blob = await new Promise((r, j) => { try { canvas.toBlob((b) => (b ? r(b) : j(new Error("Couldn't export the image (a logo from another site may block it)."))), "image/jpeg", quality); } catch (e) { j(e); } });
  return { canvas, blob };
}
// The style to use for a channel when one template renders every size.
function csrStyleFor(templateStyle, ch) {
  if (ch === "ig_carousel") return "carousel";
  if (ch === "yt_video") return "thumb";
  return templateStyle === "carousel" || templateStyle === "thumb" ? "classic" : templateStyle;
}

/* ------------------------------------------------ Reels: 1080×1920, 30 fps, max 60 s */
const CSR_REEL = { W: 1080, H: 1920, fps: 30, max: 60 };
async function csrCodecSupport() {
  if (!("VideoEncoder" in window) || !("VideoFrame" in window)) return { ok: false, reason: CSR_NO_CODECS };
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
    try { if ((await VideoEncoder.isConfigSupported({ codec, width: CSR_REEL.W, height: CSR_REEL.H, bitrate: 8e6, framerate: CSR_REEL.fps, avc: { format: "avc" } })).supported) return { ok: true, codec }; } catch {}
  }
  return { ok: false, reason: CSR_NO_CODECS };
}
async function csrAudioSupport() {
  if (!("AudioEncoder" in window)) return false;
  try { return (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch { return false; }
}
// Script → scenes: one per line, numbering removed, 3 s each, alternating motion.
function csrScenesFromScript(script, mediaIds = []) {
  const lines = String(script || "").split("\n").map((l) => l.replace(/^\s*(\d+|[٠-٩]+|scene\s*\d+|مشهد\s*[\d٠-٩]*)\s*[.:)\-–—]\s*/i, "").trim()).filter(Boolean).slice(0, 20);
  return lines.map((text, n) => ({ media_id: mediaIds.length ? mediaIds[n % mediaIds.length] : "", text: text.slice(0, 300), duration: 3, motion: ["zoom_in", "zoom_out", "slide_left", "slide_right"][n % 4] }));
}
function csrScene(ctx, brand, sc, src, p, logo) {
  const { W, H } = CSR_REEL, C = brand.colors;
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  if (src) {
    const e = p * p * (3 - 2 * p); // ease in-out
    const m = sc.motion, s = m === "zoom_in" ? 1 + 0.12 * e : m === "zoom_out" ? 1.12 - 0.12 * e : m === "none" ? 1 : 1.12;
    const dx = m === "slide_left" ? (0.05 - 0.1 * e) * W : m === "slide_right" ? (-0.05 + 0.1 * e) * W : 0;
    ctx.save(); ctx.translate(W / 2 + dx, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    csrDrawImage(ctx, src, 0, 0, W, H, { mode: "cover" });
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, C.primary); g.addColorStop(1, C.ink);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (sc.text) {
    // Inside the safe area: platform buttons cover the bottom ~20% and the top ~12%.
    const a = Math.min(1, p * sc.duration / 0.35);
    ctx.save(); ctx.globalAlpha = a;
    const boxY = src ? H * 0.52 : H * 0.3, boxH = src ? H * 0.26 : H * 0.4;
    if (src) { ctx.fillStyle = "rgba(0,0,0,.55)"; csrRound(ctx, W * 0.07, boxY - 30, W * 0.86, boxH + 60, 36); ctx.fill(); }
    csrText(ctx, brand, sc.text, { x: W * 0.11, y: boxY, w: W * 0.78, h: boxH, max: 92, min: 34, color: "#ffffff", align: "center", valign: "middle", maxLines: 5, lh: 1.3 });
    ctx.restore();
  }
  if (logo) { const lh = 64, lw = lh * (logo.naturalWidth / logo.naturalHeight); ctx.drawImage(logo, (W - lw) / 2, H * 0.12, lw, lh); }
}
function csrVideoEl(url) {
  return new Promise((res) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous"; v.preload = "auto"; v.src = url;
    v.onloadeddata = () => res(v); v.onerror = () => res(null);
    setTimeout(() => res(v.readyState >= 2 ? v : null), 15000);
  });
}
const csrSeek = (v, t) => new Promise((r) => { if (Math.abs(v.currentTime - t) < 0.001) return r(); v.onseeked = () => r(); v.currentTime = t; setTimeout(r, 1500); });

// scenes: [{ url, kind: "image"|"video", text, duration, motion }]; audio: { url, volume } or null.
// Returns { mp4: Blob, cover: Blob, duration }.
async function csrEncodeReel({ scenes, audio = null, brand, coverScene = 0, onProgress = () => {} }) {
  const { W, H, fps } = CSR_REEL;
  const sup = await csrCodecSupport();
  if (!sup.ok) throw new Error(sup.reason);
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  if (!scenes.length || total <= 0) throw new Error("Add at least one scene.");
  if (total > CSR_REEL.max) throw new Error(`Reels here are up to ${CSR_REEL.max} seconds; this one is ${total} s.`);
  if (audio && !(await csrAudioSupport())) throw new Error("This browser can't encode AAC audio, which Instagram and TikTok need. Chrome and Edge on Windows or Mac can; on Linux, make the reel without audio.");
  await csrFonts(brand);
  const { Muxer, ArrayBufferTarget } = await import(CSR_MUXER_URL);
  const logo = await csrImg(brand.logo_url);
  const srcs = await Promise.all(scenes.map((s) => (s.kind === "video" ? csrVideoEl(s.url) : csrImg(s.url))));
  // Audio: decode, fit to the reel's length with a 1 s fade-out, 48 kHz stereo.
  let pcm = null;
  if (audio?.url) {
    const buf = await (await fetch(audio.url)).arrayBuffer();
    const decoded = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf);
    const off = new OfflineAudioContext(2, Math.ceil(48000 * total), 48000);
    const src = off.createBufferSource(); src.buffer = decoded;
    const gain = off.createGain(); gain.gain.setValueAtTime(audio.volume ?? 0.8, 0); gain.gain.setValueAtTime(audio.volume ?? 0.8, Math.max(0, total - 1)); gain.gain.linearRampToValueAtTime(0, total);
    src.connect(gain).connect(off.destination); src.start(0);
    pcm = await off.startRendering();
  }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: W, height: H, frameRate: fps }, ...(pcm ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  venc.configure({ codec: sup.codec, width: W, height: H, bitrate: 8_000_000, framerate: fps, avc: { format: "avc" } });
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const frames = Math.round(total * fps);
  let sceneStart = 0, si = 0;
  for (let f = 0; f < frames; f++) {
    if (failure) throw failure;
    const t = f / fps;
    while (si < scenes.length - 1 && t >= sceneStart + scenes[si].duration) { sceneStart += scenes[si].duration; si++; }
    const sc = scenes[si], src = srcs[si], local = t - sceneStart;
    if (src && sc.kind === "video") await csrSeek(src, Math.min(local, Math.max(0, (src.duration || 0) - 0.05)));
    csrScene(ctx, brand, sc, src, Math.min(1, local / sc.duration), logo);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (f % 10 === 0) onProgress(f / frames * (pcm ? 0.9 : 1));
  }
  await venc.flush();
  if (failure) throw failure;
  if (pcm) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    const L = pcm.getChannelData(0), R = pcm.getChannelData(1), N = 1024;
    for (let i = 0; i < L.length; i += N) {
      const n = Math.min(N, L.length - i), data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / 48000), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush();
    if (failure) throw failure;
  }
  muxer.finalize();
  onProgress(1);
  // Cover frame: the chosen scene, a third of the way in.
  const ci = Math.min(coverScene, scenes.length - 1);
  if (srcs[ci] && scenes[ci].kind === "video") await csrSeek(srcs[ci], Math.min(scenes[ci].duration / 3, Math.max(0, (srcs[ci].duration || 0) - 0.05)));
  csrScene(ctx, brand, scenes[ci], srcs[ci], 0.99, logo);
  const cover = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  return { mp4: new Blob([target.buffer], { type: "video/mp4" }), cover, duration: total };
}
