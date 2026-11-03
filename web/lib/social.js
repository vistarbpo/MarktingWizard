// Connected accounts and the platform APIs for Creative Studio (phases 2-3, plus comments and DMs).
// Every call goes through an injected fetchImpl, so tests mock all of it and nothing here needs an SDK.
// Endpoint details are written from the platforms' public docs; spots marked "verify against current docs"
// are the ones most likely to drift (versions, field names, limits).
import crypto from "node:crypto";
import fs from "node:fs";
import { channelInfo } from "./creative.js";
import { publicBase } from "./media.js";

// ---- configuration (env vars, never in git)
export function socialConfig(env = process.env, password = "") {
  const v = env.META_GRAPH_VERSION || "v23.0"; // verify against current docs: Meta retires versions about 2 years after release
  return {
    public_url: publicBase(env),
    graph: `https://graph.facebook.com/${v}`,
    graph_video: `https://graph-video.facebook.com/${v}`,
    fb_dialog: `https://www.facebook.com/${v}/dialog/oauth`,
    meta: { id: env.META_APP_ID || "", secret: env.META_APP_SECRET || "", verify: env.META_VERIFY_TOKEN || "" },
    linkedin: { id: env.LINKEDIN_CLIENT_ID || "", secret: env.LINKEDIN_CLIENT_SECRET || "", org_id: env.LINKEDIN_ORG_ID || "", version: env.LINKEDIN_VERSION || "202510" }, // verify: LinkedIn-Version is YYYYMM and each lasts ~1 year
    google: { id: env.GOOGLE_CLIENT_ID || "", secret: env.GOOGLE_CLIENT_SECRET || "", audited: env.YOUTUBE_AUDITED === "1" },
    tiktok: { key: env.TIKTOK_CLIENT_KEY || "", secret: env.TIKTOK_CLIENT_SECRET || "", audited: env.TIKTOK_AUDITED === "1" },
    key: tokenKey(env.TOKEN_KEY, password || env.DASHBOARD_PASSWORD || env.MWIZ_PASSWORD || ""),
  };
}

// ---- tokens at rest: AES-256-GCM. TOKEN_KEY (64 hex chars, or any passphrase) or derived from the password.
export function tokenKey(tokenKeyEnv, password) {
  if (tokenKeyEnv && /^[0-9a-f]{64}$/i.test(tokenKeyEnv)) return Buffer.from(tokenKeyEnv, "hex");
  return crypto.createHash("sha256").update("mwiz-tokens:" + (tokenKeyEnv || password || "")).digest();
}
export function seal(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function unseal(s, key) {
  try {
    const [v, iv, tag, ct] = String(s || "").split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8"));
  } catch { return null; } // wrong key (e.g. password rotated without TOKEN_KEY) or tampered: reconnect
}

// ---- OAuth state: signed, short-lived, bound to the signed-in person and to a cookie in their browser (CSRF).
const hmac = (key, s) => crypto.createHmac("sha256", key).update("oauth:" + s).digest("base64url");
export function makeState(key, { ws, provider, uid }, now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const body = Buffer.from(JSON.stringify({ w: String(ws), p: provider, u: uid, n: nonce, e: now + 15 * 60e3 })).toString("base64url");
  return { state: `${body}.${hmac(key, body)}`, nonce };
}
export function checkState(key, state, { uid, nonce, provider }, now = Date.now()) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = hmac(key, body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p || p.e < now || p.u !== uid || p.p !== provider || !nonce || p.n !== nonce) return null;
  return { ws: p.w, provider: p.p };
}

// ---- what each platform is, what it needs, and what still needs the platform's app review
export const CHANNEL_PROVIDER = { ig_post: "meta", ig_carousel: "meta", ig_reel: "meta", ig_story: "meta", fb_post: "meta", linkedin: "linkedin", yt_short: "google", yt_video: "google", tiktok: "tiktok" };
export const MANUAL_CHANNELS = ["x", "snapchat"]; // no organic posting API we can use: "download and post"
export const PROVIDERS = {
  meta: {
    name: "Meta: Facebook Page + Instagram", short: "Meta", env: ["META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"], console: "https://developers.facebook.com/apps",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "instagram_manage_comments", "pages_manage_engagement", "pages_messaging", "instagram_manage_messages"],
    review: ["pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "instagram_manage_comments", "pages_manage_engagement", "pages_messaging", "instagram_manage_messages"],
    notes: "Until App Review passes, only people with a role on the Meta app (admin, developer, tester) can connect, and it works only for Pages they manage. Needs an Instagram Business or Creator account linked to the Page. Instagram allows about 50 API posts per 24 hours. Also add the webhook (Messenger + Instagram) with the /hooks/meta URL and META_VERIFY_TOKEN.",
  },
  linkedin: {
    name: "LinkedIn", short: "LinkedIn", env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], console: "https://www.linkedin.com/developers/apps",
    scopes: ["openid", "profile", "w_member_social"], review: [],
    notes: "Add the products \"Sign In with LinkedIn using OpenID Connect\" and \"Share on LinkedIn\" (self-serve). Posting as the company page needs the Community Management API (approval) and LINKEDIN_ORG_ID. Tokens last 60 days; reconnect before they expire. Post results aren't pulled (they need extra analytics access).",
  },
  google: {
    name: "YouTube", short: "YouTube", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], console: "https://console.cloud.google.com/apis/credentials",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"], review: ["https://www.googleapis.com/auth/youtube.upload"],
    notes: "Enable YouTube Data API v3. Until the API project passes Google's audit, uploads are private (set YOUTUBE_AUDITED=1 after). Each upload costs about 1,600 of the default 10,000 daily quota units. The OAuth consent screen needs verification for sensitive scopes before people outside test users can connect.",
  },
  tiktok: {
    name: "TikTok", short: "TikTok", env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], console: "https://developers.tiktok.com/apps",
    scopes: ["user.info.basic", "video.publish", "video.list"], review: ["video.publish", "video.list"],
    notes: "Add Login Kit and the Content Posting API (Direct Post). Until TikTok audits the app, every post is private (SELF_ONLY): only the account owner sees it. Set TIKTOK_AUDITED=1 after the audit. The audit also checks TikTok's posting UX rules (creator name shown, privacy chosen by the person, consent).",
  },
};
export const providerConfigured = (cfg, p) => ({ meta: !!(cfg.meta.id && cfg.meta.secret), linkedin: !!(cfg.linkedin.id && cfg.linkedin.secret), google: !!(cfg.google.id && cfg.google.secret), tiktok: !!(cfg.tiktok.key && cfg.tiktok.secret) })[p];
export const redirectUri = (cfg, p) => `${cfg.public_url}/oauth/${p}/callback`;
export function scopesFor(cfg, p) {
  if (p === "linkedin" && cfg.linkedin.org_id) return [...PROVIDERS.linkedin.scopes, "w_organization_social"];
  return PROVIDERS[p].scopes;
}

// ---- HTTP helper. Errors carry the platform's own message, never the request URL (tokens live there).
export class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
const errText = (d, status) => (typeof d?.error === "object" ? d.error.message || d.error.error_user_msg || d.error.code : d?.error_description || d?.error) || d?.message || d?.raw?.slice?.(0, 200) || `HTTP ${status}`;
async function call(fetchImpl, url, { method = "GET", headers = {}, form, json, body } = {}) {
  const h = { ...headers };
  let b = body;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; b = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString(); }
  if (json !== undefined) { h["Content-Type"] ||= "application/json; charset=UTF-8"; b = JSON.stringify(json); }
  const res = await fetchImpl(url, { method, headers: h, body: b });
  const text = await res.text().catch(() => "");
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new ApiError(String(errText(data, res.status)).slice(0, 300), res.status, data);
  return { data, res };
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")).toString();

// ---- OAuth per platform
export function authUrl(cfg, p, state) {
  const redirect_uri = redirectUri(cfg, p), scope = scopesFor(cfg, p);
  if (p === "meta") return `${cfg.fb_dialog}?${qs({ client_id: cfg.meta.id, redirect_uri, state, response_type: "code", scope: scope.join(",") })}`;
  if (p === "linkedin") return `https://www.linkedin.com/oauth/v2/authorization?${qs({ response_type: "code", client_id: cfg.linkedin.id, redirect_uri, state, scope: scope.join(" ") })}`;
  if (p === "google") return `https://accounts.google.com/o/oauth2/v2/auth?${qs({ client_id: cfg.google.id, redirect_uri, response_type: "code", scope: scope.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })}`;
  if (p === "tiktok") return `https://www.tiktok.com/v2/auth/authorize/?${qs({ client_key: cfg.tiktok.key, response_type: "code", scope: scope.join(","), redirect_uri, state })}`; // verify: TikTok web login may also require PKCE for some app types
  throw new Error("Unknown platform");
}

// Code → tokens + who/what was connected. Returns { tokens, name, targets, selected, expires_at, scopes, refresh_expires_at }.
export async function exchangeCode(cfg, p, code, fetchImpl) {
  const redirect_uri = redirectUri(cfg, p), now = Date.now();
  if (p === "meta") {
    const G = cfg.graph;
    const short = (await call(fetchImpl, `${G}/oauth/access_token?${qs({ client_id: cfg.meta.id, redirect_uri, client_secret: cfg.meta.secret, code })}`)).data;
    const long = (await call(fetchImpl, `${G}/oauth/access_token?${qs({ grant_type: "fb_exchange_token", client_id: cfg.meta.id, client_secret: cfg.meta.secret, fb_exchange_token: short.access_token })}`)).data;
    const me = (await call(fetchImpl, `${G}/me?${qs({ fields: "id,name", access_token: long.access_token })}`)).data;
    const perms = (await call(fetchImpl, `${G}/me/permissions?${qs({ access_token: long.access_token })}`).catch(() => ({ data: { data: [] } }))).data.data || [];
    const pages = (await call(fetchImpl, `${G}/me/accounts?${qs({ fields: "name,access_token,instagram_business_account{id,username}", access_token: long.access_token })}`)).data.data || [];
    if (!pages.length) throw new Error("No Facebook Page came back. Pick at least one Page (with its Instagram account) on Meta's screen.");
    const targets = pages.map((pg) => ({ id: pg.id, page_id: pg.id, page_name: pg.name, ig_id: pg.instagram_business_account?.id || "", ig_username: pg.instagram_business_account?.username || "" }));
    return {
      tokens: { user: long.access_token, pages: Object.fromEntries(pages.map((pg) => [pg.id, pg.access_token])) }, // page tokens from a long-lived user token don't expire
      name: me.name || "Meta", targets, selected: (targets.find((t) => t.ig_id) || targets[0]).id,
      expires_at: long.expires_in ? new Date(now + long.expires_in * 1000).toISOString() : null,
      scopes: perms.filter((x) => x.status === "granted").map((x) => x.permission),
    };
  }
  if (p === "linkedin") {
    const t = (await call(fetchImpl, "https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", form: { grant_type: "authorization_code", code, redirect_uri, client_id: cfg.linkedin.id, client_secret: cfg.linkedin.secret } })).data;
    const me = (await call(fetchImpl, "https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).data;
    const targets = [{ id: `urn:li:person:${me.sub}`, author: `urn:li:person:${me.sub}`, name: me.name || "Member" }];
    if (cfg.linkedin.org_id) targets.push({ id: `urn:li:organization:${cfg.linkedin.org_id}`, author: `urn:li:organization:${cfg.linkedin.org_id}`, name: "Company page" });
    return { tokens: { access: t.access_token, refresh: t.refresh_token || "" }, name: me.name || "LinkedIn", targets, selected: targets[0].id,
      expires_at: t.expires_in ? new Date(now + t.expires_in * 1000).toISOString() : null, refresh_expires_at: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : null,
      scopes: String(t.scope || scopesFor(cfg, p).join(" ")).split(/[ ,]+/).filter(Boolean) };
  }
  if (p === "google") {
    const t = (await call(fetchImpl, "https://oauth2.googleapis.com/token", { method: "POST", form: { code, client_id: cfg.google.id, client_secret: cfg.google.secret, redirect_uri, grant_type: "authorization_code" } })).data;
    const ch = (await call(fetchImpl, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } })).data.items?.[0];
    if (!ch) throw new Error("This Google account has no YouTube channel.");
    return { tokens: { access: t.access_token, refresh: t.refresh_token || "" }, name: ch.snippet?.title || "YouTube", targets: [{ id: ch.id, channel_id: ch.id, name: ch.snippet?.title || "" }], selected: ch.id,
      expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString(), scopes: String(t.scope || "").split(" ").filter(Boolean) };
  }
  if (p === "tiktok") {
    const t = (await call(fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", form: { client_key: cfg.tiktok.key, client_secret: cfg.tiktok.secret, code, grant_type: "authorization_code", redirect_uri } })).data;
    if (!t.access_token) throw new Error(t.error_description || t.error || "TikTok didn't return a token.");
    const u = (await call(fetchImpl, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: { Authorization: `Bearer ${t.access_token}` } })).data?.data?.user || {};
    return { tokens: { access: t.access_token, refresh: t.refresh_token || "" }, name: u.display_name || "TikTok", targets: [{ id: t.open_id, open_id: t.open_id, name: u.display_name || "" }], selected: t.open_id,
      expires_at: new Date(now + (t.expires_in || 86400) * 1000).toISOString(), refresh_expires_at: t.refresh_expires_in ? new Date(now + t.refresh_expires_in * 1000).toISOString() : null,
      scopes: String(t.scope || "").split(/[ ,]+/).filter(Boolean) };
  }
  throw new Error("Unknown platform");
}

// Refresh where the platform supports it. Returns new { tokens, expires_at } or null when it can't.
export async function refreshTokens(cfg, p, tokens, fetchImpl) {
  const now = Date.now();
  if (p === "google" && tokens.refresh) {
    const t = (await call(fetchImpl, "https://oauth2.googleapis.com/token", { method: "POST", form: { client_id: cfg.google.id, client_secret: cfg.google.secret, refresh_token: tokens.refresh, grant_type: "refresh_token" } })).data;
    return { tokens: { ...tokens, access: t.access_token, refresh: t.refresh_token || tokens.refresh }, expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString() };
  }
  if (p === "tiktok" && tokens.refresh) {
    const t = (await call(fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", form: { client_key: cfg.tiktok.key, client_secret: cfg.tiktok.secret, grant_type: "refresh_token", refresh_token: tokens.refresh } })).data;
    if (!t.access_token) throw new Error(t.error_description || "TikTok refresh failed");
    return { tokens: { ...tokens, access: t.access_token, refresh: t.refresh_token || tokens.refresh }, expires_at: new Date(now + (t.expires_in || 86400) * 1000).toISOString() };
  }
  if (p === "linkedin" && tokens.refresh) { // only apps LinkedIn approved for refresh tokens get one
    const t = (await call(fetchImpl, "https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", form: { grant_type: "refresh_token", refresh_token: tokens.refresh, client_id: cfg.linkedin.id, client_secret: cfg.linkedin.secret } })).data;
    return { tokens: { ...tokens, access: t.access_token, refresh: t.refresh_token || tokens.refresh }, expires_at: new Date(now + (t.expires_in || 0) * 1000).toISOString() };
  }
  return null; // Meta: page tokens don't expire; the user token can't be refreshed, only reconnected
}

// Best effort: tell the platform we're done with the token.
export async function revokeTokens(cfg, p, tokens, fetchImpl) {
  try {
    if (p === "meta") await call(fetchImpl, `${cfg.graph}/me/permissions?${qs({ access_token: tokens.user })}`, { method: "DELETE" });
    if (p === "google") await call(fetchImpl, "https://oauth2.googleapis.com/revoke", { method: "POST", form: { token: tokens.refresh || tokens.access } });
    if (p === "tiktok") await call(fetchImpl, "https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", form: { client_key: cfg.tiktok.key, client_secret: cfg.tiktok.secret, token: tokens.access } });
    if (p === "linkedin") await call(fetchImpl, "https://www.linkedin.com/oauth/v2/revoke", { method: "POST", form: { token: tokens.access, client_id: cfg.linkedin.id, client_secret: cfg.linkedin.secret } });
    return true;
  } catch { return false; }
}

// ---- captions per platform
export function captionFor(ch, v = {}) {
  const c = channelInfo(ch);
  const tags = (v.hashtags || []).join(" ");
  let text = [v.caption_ar, v.caption_en].filter(Boolean).join("\n\n");
  if (tags) text += (text ? "\n\n" : "") + tags;
  return c?.caption_max ? text.slice(0, c.caption_max) : text;
}
export function youtubeTitle(ch, v = {}) {
  const first = String(v.caption_ar || v.caption_en || "DPA AD").split("\n").find((l) => l.trim()) || "DPA AD";
  const tag = ch === "yt_short" && !/#shorts/i.test(first) ? " #Shorts" : "";
  return (first.trim().slice(0, 100 - tag.length) + tag).replace(/[<>]/g, ""); // YouTube refuses < and > in titles
}
// LinkedIn "little text": reserved characters must be escaped or the post is cut off there; hashtags use a template.
export function linkedinText(s) { // verify against current docs: "little text" format
  const RES = /[\\|{}@[\]()<>#*_~]/g, tags = [];
  const marked = String(s || "").replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, (m, sp, tag) => { tags.push(tag); return `${sp}\u0000${tags.length - 1}\u0000`; });
  return marked.replace(RES, (m) => "\\" + m).replace(/\u0000(\d+)\u0000/g, (m, n) => `{hashtag|\\#|${tags[n].replace(RES, (c) => "\\" + c)}}`);
}

// ---- publishers. ctx = { cfg, fetchImpl, sleep, pollEvery, pollMax, account, target, tokens, channel, variant, files, item }
// files: media records with .url (public) and .local (path on disk). Return { post_id, url, note }.
const readBytes = (f) => fs.promises.readFile(f.local);

async function waitIgContainer(ctx, id, token) {
  for (let n = 0; n < (ctx.pollMax ?? 60); n++) {
    const s = (await call(ctx.fetchImpl, `${ctx.cfg.graph}/${id}?${qs({ fields: "status_code,status", access_token: token })}`)).data;
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (["ERROR", "EXPIRED"].includes(s.status_code)) throw new Error(`Instagram couldn't process the file: ${s.status || s.status_code}`);
    await ctx.sleep(ctx.pollEvery ?? 5000);
  }
  throw new Error("Instagram is still processing the video; it will be tried again.");
}

export async function publishInstagram(ctx) {
  const { cfg, fetchImpl, target, tokens, channel, variant, files } = ctx;
  const token = tokens.pages?.[target.page_id], ig = target.ig_id, G = cfg.graph;
  if (!ig) throw new Error("This Facebook Page has no Instagram Business account linked.");
  if (!files.length) throw new Error("Attach the image or video from the media library first.");
  const post = async (path, form) => (await call(fetchImpl, `${G}/${path}`, { method: "POST", form: { ...form, access_token: token } })).data;
  const one = (f, extra = {}) => (f.kind === "video" ? { media_type: channel === "ig_story" ? "STORIES" : extra.child ? "VIDEO" : "REELS", video_url: f.url } : { image_url: f.url, ...(channel === "ig_story" ? { media_type: "STORIES" } : {}) });
  const caption = captionFor(channel, variant);
  let container;
  if (channel === "ig_carousel") {
    if (files.length < 2) throw new Error("A carousel needs at least 2 files.");
    const kids = [];
    for (const f of files.slice(0, 10)) {
      const k = await post(`${ig}/media`, { ...one(f, { child: true }), is_carousel_item: "true" });
      if (f.kind === "video") await waitIgContainer(ctx, k.id, token);
      kids.push(k.id);
    }
    container = await post(`${ig}/media`, { media_type: "CAROUSEL", children: kids.join(","), caption });
  } else if (channel === "ig_reel") {
    const f = files.find((x) => x.kind === "video");
    if (!f) throw new Error("A reel needs an MP4 video.");
    container = await post(`${ig}/media`, { media_type: "REELS", video_url: f.url, caption, share_to_feed: "true", ...(ctx.cover ? { cover_url: ctx.cover.url } : {}) });
  } else if (channel === "ig_story") {
    container = await post(`${ig}/media`, one(files[0])); // stories take no caption
  } else {
    const f = files.find((x) => x.kind === "image");
    if (!f) throw new Error("An Instagram post needs a JPEG image (use a reel for video).");
    container = await post(`${ig}/media`, { image_url: f.url, caption });
  }
  if (channel !== "ig_post") await waitIgContainer(ctx, container.id, token);
  const pub = await post(`${ig}/media_publish`, { creation_id: container.id });
  const link = (await call(fetchImpl, `${G}/${pub.id}?${qs({ fields: "permalink", access_token: token })}`).catch(() => ({ data: {} }))).data;
  return { post_id: pub.id, url: link.permalink || "", kind: "ig" };
}

export async function publishFacebook(ctx) {
  const { cfg, fetchImpl, target, tokens, channel, variant, files } = ctx;
  const page = target.page_id, token = tokens.pages?.[page], G = cfg.graph;
  const message = captionFor(channel, variant);
  const post = async (base, path, form) => (await call(fetchImpl, `${base}/${path}`, { method: "POST", form: { ...form, access_token: token } })).data;
  const video = files.find((f) => f.kind === "video"), imgs = files.filter((f) => f.kind === "image");
  if (video) {
    const r = await post(cfg.graph_video, `${page}/videos`, { file_url: video.url, description: message }); // verify: graph-video host for uploads by URL
    return { post_id: r.id, url: `https://www.facebook.com/${page}/videos/${r.id}`, kind: "fb_video" };
  }
  if (imgs.length === 1) {
    const r = await post(G, `${page}/photos`, { url: imgs[0].url, message, published: "true" }); // verify: "message" vs "caption" on Page photos
    return { post_id: r.post_id || r.id, url: `https://www.facebook.com/${r.post_id || r.id}`, kind: "fb_post" };
  }
  const form = { message };
  if (imgs.length > 1) {
    const ids = [];
    for (const f of imgs.slice(0, 10)) ids.push((await post(G, `${page}/photos`, { url: f.url, published: "false" })).id);
    ids.forEach((id, n) => { form[`attached_media[${n}]`] = JSON.stringify({ media_fbid: id }); });
  }
  const r = await post(G, `${page}/feed`, form);
  return { post_id: r.id, url: `https://www.facebook.com/${r.id}`, kind: "fb_post" };
}

export async function publishLinkedIn(ctx) {
  const { cfg, fetchImpl, target, tokens, channel, variant, files } = ctx;
  const H = { Authorization: `Bearer ${tokens.access}`, "LinkedIn-Version": cfg.linkedin.version, "X-Restli-Protocol-Version": "2.0.0" };
  if (files.some((f) => f.kind === "video")) throw new Error("LinkedIn video posting isn't built yet: download and post this one.");
  const images = [];
  for (const f of files.filter((x) => x.kind === "image").slice(0, 9)) {
    const init = (await call(fetchImpl, "https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers: H, json: { initializeUploadRequest: { owner: target.author } } })).data.value;
    const put = await fetchImpl(init.uploadUrl, { method: "PUT", headers: { Authorization: H.Authorization, "Content-Type": f.mime }, body: await readBytes(f) });
    if (!put.ok) throw new Error(`LinkedIn image upload failed (${put.status})`);
    images.push(init.image);
  }
  const body = { author: target.author, commentary: linkedinText(captionFor(channel, variant)), visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false };
  if (images.length === 1) body.content = { media: { id: images[0], altText: "" } };
  if (images.length > 1) body.content = { multiImage: { images: images.map((id) => ({ id, altText: "" })) } };
  const { res, data } = await call(fetchImpl, "https://api.linkedin.com/rest/posts", { method: "POST", headers: H, json: body });
  const urn = res.headers.get("x-restli-id") || data.id || "";
  return { post_id: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : "", kind: "linkedin" };
}

export async function publishYouTube(ctx) {
  const { cfg, fetchImpl, tokens, channel, variant, files } = ctx;
  const f = files.find((x) => x.kind === "video");
  if (!f) throw new Error("YouTube needs an MP4 video.");
  if (channel === "yt_short" && f.duration > 60) throw new Error("Shorts here must be under 60 seconds.");
  const auth = { Authorization: `Bearer ${tokens.access}` };
  const meta = { snippet: { title: youtubeTitle(channel, variant), description: captionFor("yt_video", variant), tags: (variant.hashtags || []).map((h) => h.replace(/^#/, "")).slice(0, 15), categoryId: "22", defaultLanguage: "ar" },
    status: { privacyStatus: cfg.google.audited ? "public" : "private", selfDeclaredMadeForKids: false } };
  const { res } = await call(fetchImpl, "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { ...auth, "X-Upload-Content-Length": String(f.size), "X-Upload-Content-Type": "video/mp4" }, json: meta });
  const loc = res.headers.get("location");
  if (!loc) throw new Error("YouTube didn't return an upload address.");
  const { data } = await call(fetchImpl, loc, { method: "PUT", headers: { ...auth, "Content-Type": "video/mp4" }, body: await readBytes(f) });
  if (ctx.cover && channel === "yt_video") { // custom thumbnails need a verified channel: ignore if refused
    await call(fetchImpl, `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(data.id)}`, { method: "POST", headers: { ...auth, "Content-Type": ctx.cover.mime }, body: await readBytes(ctx.cover) }).catch(() => {});
  }
  return { post_id: data.id, url: channel === "yt_short" ? `https://www.youtube.com/shorts/${data.id}` : `https://www.youtube.com/watch?v=${data.id}`, kind: "youtube",
    note: cfg.google.audited ? "" : "Uploaded as private: YouTube keeps API uploads private until the API project passes Google's audit." };
}

// TikTok chunk rules: whole file in one chunk up to 64 MB; otherwise 5-64 MB chunks, the last one takes the rest.
export function tiktokChunks(size, chunk = 20 * 1024 * 1024) {
  if (size <= 64 * 1024 * 1024) return { chunk_size: size, count: 1 };
  return { chunk_size: chunk, count: Math.floor(size / chunk) }; // verify against current docs: chunk limits
}
export async function publishTikTok(ctx) {
  const { cfg, fetchImpl, tokens, variant, files, channel } = ctx;
  const f = files.find((x) => x.kind === "video");
  if (!f) throw new Error("TikTok needs an MP4 video.");
  const H = { Authorization: `Bearer ${tokens.access}` };
  const ok = (d) => { if (d?.error?.code && d.error.code !== "ok") throw new Error(`TikTok: ${d.error.message || d.error.code}`); return d.data || {}; };
  const info = ok((await call(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: H, json: {} })).data);
  const opts = info.privacy_level_options || [];
  const privacy = cfg.tiktok.audited && opts.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
  if (opts.length && !opts.includes(privacy)) throw new Error(`TikTok doesn't offer ${privacy} for this account.`);
  if (info.max_video_post_duration_sec && f.duration > info.max_video_post_duration_sec) throw new Error(`This account can post videos up to ${info.max_video_post_duration_sec} seconds.`);
  const { chunk_size, count } = tiktokChunks(f.size);
  const init = ok((await call(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: H, json: {
    post_info: { title: captionFor(channel, variant), privacy_level: privacy, disable_duet: false, disable_comment: !!info.comment_disabled, disable_stitch: false, video_cover_timestamp_ms: 1000, ...(files.some((x) => x.ai_generated) ? { is_aigc: true } : {}) },
    source_info: { source: "FILE_UPLOAD", video_size: f.size, chunk_size, total_chunk_count: count } } })).data);
  const bytes = await readBytes(f);
  for (let n = 0; n < count; n++) {
    const start = n * chunk_size, end = n === count - 1 ? f.size - 1 : start + chunk_size - 1;
    const r = await fetchImpl(init.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${f.size}` }, body: bytes.subarray(start, end + 1) });
    if (!r.ok) throw new Error(`TikTok upload failed on part ${n + 1} (${r.status})`);
  }
  let st = {};
  for (let n = 0; n < (ctx.pollMax ?? 60); n++) {
    st = ok((await call(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: H, json: { publish_id: init.publish_id } })).data);
    if (st.status === "PUBLISH_COMPLETE") break;
    if (st.status === "FAILED") throw new Error(`TikTok couldn't post it: ${st.fail_reason || "unknown reason"}`);
    await ctx.sleep(ctx.pollEvery ?? 5000);
  }
  if (st.status !== "PUBLISH_COMPLETE") throw new Error("TikTok is still processing the video; it will be tried again.");
  const id = (st.publicaly_available_post_id || st.publicly_available_post_id || [])[0]; // the API spells it "publicaly"
  return { post_id: id ? String(id) : init.publish_id, publish_id: init.publish_id, url: id && info.creator_username ? `https://www.tiktok.com/@${info.creator_username}/video/${id}` : "", kind: "tiktok",
    note: privacy === "SELF_ONLY" ? "Posted as private (SELF_ONLY): TikTok makes posts from unaudited apps visible only to the account owner." : "" };
}

export const PUBLISHERS = { meta: (ctx) => (ctx.channel === "fb_post" ? publishFacebook(ctx) : publishInstagram(ctx)), linkedin: publishLinkedIn, google: publishYouTube, tiktok: publishTikTok };

// ---- results. Each returns { reach, views, likes, comments, saves, shares } (missing = null) and notes.
const M = () => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null });
const IG_MAP = { reach: "reach", views: "views", likes: "likes", comments: "comments", saved: "saves", shares: "shares" };
export async function metricsInstagram({ cfg, fetchImpl }, id, token) {
  const out = M(), errors = [];
  const read = (rows) => { for (const r of rows || []) { const k = IG_MAP[r.name]; if (k) out[k] = r.total_value?.value ?? r.values?.[0]?.value ?? null; } };
  const get = (metric) => call(fetchImpl, `${cfg.graph}/${id}/insights?${qs({ metric, access_token: token })}`);
  try { read((await get(Object.keys(IG_MAP).join(","))).data.data); }
  catch { // some metrics don't exist for some media types (stories, old posts): ask one by one and keep what works
    for (const m of Object.keys(IG_MAP)) { try { read((await get(m)).data.data); } catch (e) { errors.push(`${m}: ${e.message}`); } }
  }
  if (out.likes === null || out.comments === null) { // fall back to the media's own counters
    try { const d = (await call(fetchImpl, `${cfg.graph}/${id}?${qs({ fields: "like_count,comments_count", access_token: token })}`)).data; out.likes ??= d.like_count ?? null; out.comments ??= d.comments_count ?? null; } catch {}
  }
  return { metrics: out, errors };
}
export async function metricsFacebook({ cfg, fetchImpl }, id, token) {
  const out = M(), errors = [];
  try {
    const d = (await call(fetchImpl, `${cfg.graph}/${id}?${qs({ fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)", access_token: token })}`)).data;
    out.shares = d.shares?.count ?? 0; out.comments = d.comments?.summary?.total_count ?? null; out.likes = d.reactions?.summary?.total_count ?? null;
  } catch (e) { errors.push(e.message); }
  try { // verify against current docs: Page post insight metric names change often
    const d = (await call(fetchImpl, `${cfg.graph}/${id}/insights?${qs({ metric: "post_impressions_unique", access_token: token })}`)).data;
    out.reach = d.data?.[0]?.values?.[0]?.value ?? null;
  } catch (e) { errors.push(`reach: ${e.message}`); }
  return { metrics: out, errors };
}
export async function metricsYouTube({ fetchImpl }, ids, token) {
  const d = (await call(fetchImpl, `https://www.googleapis.com/youtube/v3/videos?${qs({ part: "statistics", id: ids.join(",") })}`, { headers: { Authorization: `Bearer ${token}` } })).data;
  return Object.fromEntries((d.items || []).map((v) => [v.id, { ...M(), views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) }]));
}
export async function metricsTikTok({ fetchImpl }, ids, token) {
  const d = (await call(fetchImpl, "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { filters: { video_ids: ids.slice(0, 20) } } })).data;
  return Object.fromEntries((d.data?.videos || []).map((v) => [String(v.id), { ...M(), views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) }]));
}
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

// ---- comments and replies (Meta)
export async function listComments({ cfg, fetchImpl }, platform, objectId, token) {
  if (platform === "instagram") {
    const d = (await call(fetchImpl, `${cfg.graph}/${objectId}/comments?${qs({ fields: "id,text,username,timestamp,from{id,username}", limit: "50", access_token: token })}`)).data;
    return (d.data || []).map((c) => ({ id: c.id, text: c.text || "", from_id: c.from?.id || "", from_name: c.username || c.from?.username || "", at: c.timestamp || "" }));
  }
  const d = (await call(fetchImpl, `${cfg.graph}/${objectId}/comments?${qs({ fields: "id,message,from{id,name},created_time", order: "reverse_chronological", limit: "50", access_token: token })}`)).data; // verify: "from" needs pages_read_user_content on some Pages
  return (d.data || []).map((c) => ({ id: c.id, text: c.message || "", from_id: c.from?.id || "", from_name: c.from?.name || "", at: c.created_time || "" }));
}
export async function replyComment({ cfg, fetchImpl }, platform, commentId, text, token) {
  const path = platform === "instagram" ? `${commentId}/replies` : `${commentId}/comments`;
  return (await call(fetchImpl, `${cfg.graph}/${path}`, { method: "POST", form: { message: text, access_token: token } })).data;
}
export async function sendMessage({ cfg, fetchImpl }, pageId, recipientId, text, token) {
  // Messenger and Instagram DMs both go through the Page's Send API with the Page token. verify: IG may also accept /{ig-id}/messages
  return (await call(fetchImpl, `${cfg.graph}/${pageId}/messages?${qs({ access_token: token })}`, { method: "POST", json: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } } })).data;
}

// ---- Meta webhook: signature and events
export function checkMetaSignature(secret, raw, header) {
  if (!secret || !raw) return false;
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = String(header || "");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export function parseMetaWebhook(body = {}) {
  const platform = body.object === "instagram" ? "instagram" : body.object === "page" ? "facebook" : null;
  if (!platform) return [];
  const out = [];
  for (const e of body.entry || []) {
    for (const m of e.messaging || []) {
      if (!m.message || m.message.is_echo || !m.sender?.id || m.sender.id === e.id) continue;
      const text = m.message.text || (m.message.attachments?.length ? `[${m.message.attachments.map((a) => a.type).join(", ")}]` : "");
      if (text) out.push({ type: "dm", platform, target_id: String(e.id), sender_id: String(m.sender.id), text, mid: m.message.mid || "", at: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString() });
    }
    for (const c of e.changes || []) {
      const v = c.value || {};
      if (platform === "instagram" && c.field === "comments" && v.id) out.push({ type: "comment", platform, target_id: String(e.id), comment_id: String(v.id), object_id: String(v.media?.id || ""), from_id: String(v.from?.id || ""), from_name: v.from?.username || "", text: v.text || "" });
      if (platform === "facebook" && c.field === "feed" && v.item === "comment" && v.verb === "add" && v.comment_id) out.push({ type: "comment", platform, target_id: String(e.id), comment_id: String(v.comment_id), object_id: String(v.post_id || ""), from_id: String(v.from?.id || ""), from_name: v.from?.name || "", text: v.message || "" });
    }
  }
  return out.filter((x) => x.type === "dm" || (x.from_id !== x.target_id && x.text));
}
