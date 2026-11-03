// Creative Studio media library (phase 2): images, videos, voice and music files.
// Files live in DATA_DIR/media under an unguessable name and are served publicly at /media/<name>,
// because Instagram, Facebook and TikTok fetch the file from our URL when we publish.
// Records (tags, AI flag, licence) are per workspace in db.json ("creative_media").
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { channelInfo } from "./creative.js";

export const MEDIA_COLL = "creative_media";
const MB = 1024 * 1024;
// Allowlist: extension → type and size limit. Anything else is refused.
export const MEDIA_TYPES = {
  png: { mime: "image/png", kind: "image", max: 10 * MB },
  jpg: { mime: "image/jpeg", kind: "image", max: 10 * MB },
  webp: { mime: "image/webp", kind: "image", max: 10 * MB },
  mp4: { mime: "video/mp4", kind: "video", max: 150 * MB },
  m4a: { mime: "audio/mp4", kind: "audio", max: 30 * MB },
  mp3: { mime: "audio/mpeg", kind: "audio", max: 30 * MB },
};
export const MAX_UPLOAD = Math.max(...Object.values(MEDIA_TYPES).map((t) => t.max));
const EXT_ALIASES = { jpeg: "jpg", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3" };
export const FILE_RE = /^[A-Za-z0-9_-]{24,40}\.(png|jpg|webp|mp4|m4a|mp3)$/;

export function extFrom(name = "", type = "") {
  const e = String(name).toLowerCase().split(".").pop();
  const fromName = EXT_ALIASES[e] || (MEDIA_TYPES[e] ? e : "");
  return fromName || EXT_ALIASES[String(type).toLowerCase().split(";")[0].trim()] || "";
}

// Checks the first bytes so a renamed file can't pass as an image or video.
export function sniff(buf) {
  if (!buf || buf.length < 12) return "";
  const h = buf.subarray(0, 12);
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "png";
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "jpg";
  if (h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (h.toString("ascii", 4, 8) === "ftyp") return /^M4A|^M4B/.test(h.toString("ascii", 8, 12)) ? "m4a" : "mp4";
  if (h.toString("ascii", 0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return "mp3";
  return "";
}

export const mediaDir = (store) => path.join(store.dir, "media");
export const mediaPath = (store, file) => (FILE_RE.test(file) ? path.join(mediaDir(store), file) : null);
export const publicBase = (env = process.env) => (env.PUBLIC_URL || "https://wizard.dpa.ad").replace(/\/$/, "");

const str = (v, max) => String(v ?? "").trim().slice(0, max);
export function cleanTags(v) {
  return [...new Set((Array.isArray(v) ? v : String(v || "").split(/[,\n]+/)).map((t) => str(t, 30).toLowerCase()).filter(Boolean))].slice(0, 15);
}
export function cleanMediaMeta(b = {}) {
  const o = {};
  if (b.name !== undefined) o.name = str(b.name, 120);
  if (b.tags !== undefined) o.tags = cleanTags(b.tags);
  if (b.ai_generated !== undefined) o.ai_generated = b.ai_generated === true || b.ai_generated === "1" || b.ai_generated === "true";
  if (b.licence !== undefined) o.licence = str(b.licence, 300);
  for (const k of ["width", "height"]) if (b[k] !== undefined) { const n = Math.round(Number(b[k])); o[k] = n > 0 && n < 20000 ? n : null; }
  if (b.duration !== undefined) { const n = Number(b.duration); o.duration = n > 0 && n < 36000 ? Math.round(n * 100) / 100 : null; }
  return o;
}

// Public shape of a record: relative path for the dashboard, absolute URL for platforms.
export function mediaView(m, base = publicBase()) {
  return { ...m, path: `/media/${m.file}`, url: `${base}/media/${m.file}` };
}

// Streams an upload to disk, enforcing the size limit while it arrives. Resolves to the saved record.
export function saveUpload(store, wsId, req, meta = {}) {
  return new Promise((resolve, reject) => {
    const declared = extFrom(meta.filename, req.headers["content-type"]);
    if (!declared) return reject(Object.assign(new Error("Only PNG, JPG, WebP, MP4, M4A or MP3 files."), { status: 415 }));
    const limit = MEDIA_TYPES[declared].max;
    const len = Number(req.headers["content-length"] || 0);
    if (len > limit) return reject(Object.assign(new Error(`Too big: ${MEDIA_TYPES[declared].kind}s can be up to ${limit / MB} MB.`), { status: 413 }));
    fs.mkdirSync(mediaDir(store), { recursive: true });
    const token = crypto.randomBytes(24).toString("base64url");
    const tmp = path.join(mediaDir(store), `.up-${token}`);
    const out = fs.createWriteStream(tmp);
    let size = 0, head = Buffer.alloc(0), failed = null;
    const fail = (err) => { if (failed) return; failed = err; req.unpipe?.(out); out.destroy(); fs.rm(tmp, { force: true }, () => reject(err)); req.resume(); };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16)]);
      if (size > limit) fail(Object.assign(new Error(`Too big: ${MEDIA_TYPES[declared].kind}s can be up to ${limit / MB} MB.`), { status: 413 }));
    });
    req.on("error", (e) => fail(e));
    out.on("error", (e) => fail(e));
    out.on("finish", () => {
      if (failed) return;
      const real = sniff(head);
      // The bytes decide; an mp4 container may carry audio only (m4a) and vice versa.
      const ok = real && (real === declared || (["mp4", "m4a"].includes(real) && ["mp4", "m4a"].includes(declared)));
      if (!size || !ok) return fs.rm(tmp, { force: true }, () => reject(Object.assign(new Error("The file doesn't look like a PNG, JPG, WebP, MP4, M4A or MP3."), { status: 415 })));
      const ext = declared, file = `${token}.${ext}`;
      fs.renameSync(tmp, path.join(mediaDir(store), file));
      const t = MEDIA_TYPES[ext];
      const rec = store.addOps(MEDIA_COLL, wsId, { file, ext, mime: t.mime, kind: t.kind, size, name: str(meta.filename || file, 120), tags: [], ai_generated: false, licence: "", rights_confirmed: !!meta.rights, width: null, height: null, duration: null,
        source: ["upload", "template", "reel", "cover"].includes(meta.source) ? meta.source : "upload", item_id: meta.item_id ? String(meta.item_id) : null, created_by: meta.by || "you", ...cleanMediaMeta(meta) });
      resolve(rec);
    });
    req.pipe(out);
  });
}

export function deleteMedia(store, wsId, id) {
  const m = store.getOps(MEDIA_COLL, wsId, id);
  if (!m) return false;
  const p = mediaPath(store, m.file);
  if (p) fs.rmSync(p, { force: true });
  // Unlink it from any content that used it.
  for (const i of store.listOps("creative_items", wsId)) for (const v of Object.values(i.variants || {})) {
    if (v.media?.includes(m.id)) v.media = v.media.filter((x) => x !== m.id);
    if (v.cover_id === m.id) v.cover_id = "";
  }
  return store.deleteOps(MEDIA_COLL, wsId, id);
}

// What each channel needs from its files. Rule-based, run with the other checks before approval.
export function mediaChecks(item, mediaById) {
  const out = [];
  const add = (level, channel, text) => out.push({ level, channel, text });
  for (const ch of item.channels || []) {
    const c = channelInfo(ch), v = item.variants?.[ch] || {};
    if (!c || c.kind === "email") continue;
    const files = (v.media || []).map((id) => mediaById(id));
    if (files.some((f) => !f)) add("bad", ch, `${c.name}: an attached file was deleted from the library.`);
    const ok = files.filter(Boolean);
    if (!ok.length) continue;
    const vids = ok.filter((f) => f.kind === "video"), imgs = ok.filter((f) => f.kind === "image");
    if (ok.some((f) => f.kind === "audio")) add("bad", ch, `${c.name}: audio files can't be posted on their own; use them in the reel builder.`);
    if (c.kind === "video" && !vids.length) add("warn", ch, `${c.name}: attach a video (MP4).`);
    if (c.kind === "video" && vids.length > 1) add("warn", ch, `${c.name}: only the first video is posted.`);
    if (["image", "story"].includes(c.kind) && ok.length > 1 && ch !== "fb_post") add("warn", ch, `${c.name}: only the first file is posted.`);
    if (c.kind === "carousel" && ok.length < 2) add("warn", ch, `${c.name}: a carousel needs 2 to 10 files.`);
    if (c.platform === "Instagram" && imgs.some((f) => f.ext !== "jpg")) add("bad", ch, `${c.name}: Instagram only accepts JPEG images. Re-render the design (templates export JPEG) or upload a .jpg.`);
    if (["ig_reel", "tiktok", "yt_short", "snapchat", "ig_story"].includes(ch)) for (const f of vids) {
      if (f.width && f.height && f.width > f.height) add("warn", ch, `${c.name}: the video is landscape; ${c.ratio} is expected.`);
    }
    if (ch === "yt_short" && vids.some((f) => f.duration > 60)) add("bad", ch, `${c.name}: Shorts here must be under 60 seconds.`);
    if (ch === "ig_reel" && vids.some((f) => f.duration > 90)) add("warn", ch, `${c.name}: reels over 90 seconds may not be shown as reels.`);
    if (ok.some((f) => f.ai_generated)) add("warn", ch, `${c.name}: uses AI-generated media. Turn on the platform's AI label when posting (Meta, TikTok and YouTube require it for realistic content).`);
  }
  return out;
}
