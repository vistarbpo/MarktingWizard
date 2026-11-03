// Paid Ads: the ad platforms' APIs (Meta Marketing API, Snapchat Marketing API, TikTok Business API,
// Google Ads behind a flag). Every call goes through an injected fetchImpl, so tests mock all of it.
// Written from the platforms' public docs; every detail likely to drift is marked "verify against current docs".
// Rules: campaigns are only ever created PAUSED (TikTok: DISABLE); activation is a separate, explicit call.
import { publicBase } from "./media.js";
import { tokenKey } from "./social.js";

// ---- configuration (env vars, never in git)
export function adsConfig(env = process.env, password = "") {
  const v = env.META_GRAPH_VERSION || "v23.0"; // verify against current docs: Meta retires Graph/Marketing API versions about 2 years after release
  return {
    public_url: publicBase(env),
    graph: `https://graph.facebook.com/${v}`,
    fb_dialog: `https://www.facebook.com/${v}/dialog/oauth`,
    // One Meta app for Creative Studio and Paid Ads: the same META_APP_ID / META_APP_SECRET, with the Marketing API product added.
    meta: { id: env.META_APP_ID || "", secret: env.META_APP_SECRET || "" },
    snap: { id: env.SNAP_CLIENT_ID || "", secret: env.SNAP_CLIENT_SECRET || "", base: "https://adsapi.snapchat.com/v1" },
    tiktok: { id: env.TIKTOK_ADS_APP_ID || "", secret: env.TIKTOK_ADS_SECRET || "", base: "https://business-api.tiktok.com/open_api/v1.3" }, // verify: v1.3 is current; TikTok versions the Business API in the path
    google: { enabled: env.ADS_GOOGLE === "1", id: env.GOOGLE_CLIENT_ID || "", secret: env.GOOGLE_CLIENT_SECRET || "", dev_token: env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      login_customer: String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, ""), version: env.GOOGLE_ADS_VERSION || "v21" }, // verify: Google Ads API versions sunset roughly yearly
    key: tokenKey(env.TOKEN_KEY, password || env.DASHBOARD_PASSWORD || env.MWIZ_PASSWORD || ""),
    lead_secret: env.ADS_LEAD_SECRET || "",
  };
}

// ---- what each platform is, what it needs, what still needs the platform's review
export const AD_PLATFORMS = {
  meta: {
    name: "Meta Ads (Facebook + Instagram)", short: "Meta", channel: "Meta", env: ["META_APP_ID", "META_APP_SECRET"], console: "https://developers.facebook.com/apps",
    scopes: ["ads_read", "ads_management", "business_management"], review: ["ads_read", "ads_management", "business_management"],
    notes: "Same Meta app as Creative Studio: add the Marketing API product and the redirect URI below. Until App Review grants Advanced Access (and the business is verified), only people with a role on the app can connect, for ad accounts they manage, at Standard Access rate limits.",
  },
  snap: {
    name: "Snapchat Ads", short: "Snapchat", channel: "Snapchat", env: ["SNAP_CLIENT_ID", "SNAP_CLIENT_SECRET"], console: "https://business.snapchat.com (Business Details → OAuth apps)",
    scopes: ["snapchat-marketing-api"], review: ["snapchat-marketing-api"],
    notes: "Create an OAuth app in Snapchat Business Manager. Snap approves Marketing API access per app; until then only the app's own organization can connect. Access tokens last 30 minutes and are refreshed automatically.",
  },
  tiktok: {
    name: "TikTok Ads (Business API)", short: "TikTok", channel: "TikTok", env: ["TIKTOK_ADS_APP_ID", "TIKTOK_ADS_SECRET"], console: "https://business-api.tiktok.com/portal/apps",
    scopes: ["Ad Account Management", "Ads Management", "Reporting"], review: ["Ad Account Management", "Ads Management", "Reporting"],
    notes: "A TikTok for Business developer app, separate from the TikTok content-posting app in Creative Studio. Pick the permission scopes on the app page; TikTok reviews the app before other advertisers can authorize it. Tokens don't expire until revoked.",
  },
  google: {
    name: "Google Ads (optional)", short: "Google", channel: "Google", env: ["ADS_GOOGLE=1", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"], console: "https://ads.google.com/aw/apicenter",
    scopes: ["https://www.googleapis.com/auth/adwords"], review: ["Developer token: Basic access"],
    notes: "Behind a flag (ADS_GOOGLE=1). Needs a developer token from a Google Ads manager account (test accounts only until Basic access is approved). Reporting only: build Google campaigns in Google Ads.",
  },
};
export const AD_PLATFORM_IDS = Object.keys(AD_PLATFORMS);
export const adsPlatformEnabled = (cfg, p) => p !== "google" || cfg.google.enabled;
export const adsConfigured = (cfg, p) => ({ meta: !!(cfg.meta.id && cfg.meta.secret), snap: !!(cfg.snap.id && cfg.snap.secret), tiktok: !!(cfg.tiktok.id && cfg.tiktok.secret),
  google: !!(cfg.google.enabled && cfg.google.id && cfg.google.secret && cfg.google.dev_token) })[p];
export const adsRedirectUri = (cfg, p) => `${cfg.public_url}/oauth/ads/${p}/callback`;

// ---- HTTP helper. Errors carry the platform's own message, never the request URL (tokens can live there).
export class AdsApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
const errText = (d, status) => (typeof d?.error === "object" ? d.error.error_user_msg || d.error.message || d.error.code : d?.error_description || d?.error)
  || d?.debug_message || d?.message || d?.raw?.slice?.(0, 200) || `HTTP ${status}`;
async function call(fetchImpl, url, { method = "GET", headers = {}, form, json } = {}) {
  const h = { ...headers };
  let body;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString(); }
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  const res = await fetchImpl(url, { method, headers: h, body });
  const text = await res.text().catch(() => "");
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  // TikTok answers HTTP 200 with {code: non-zero} on errors; Snap uses request_status "ERROR".
  const tiktokErr = typeof data?.code === "number" && data.code !== 0 && /business-api\.tiktok/.test(String(url));
  if (!res.ok || tiktokErr || data?.request_status === "ERROR") throw new AdsApiError(String(errText(data, res.status)).slice(0, 300), res.status, data);
  return data;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();
const n = (v) => { const f = Number(v); return Number.isFinite(f) ? f : 0; };
const day = (s) => String(s || "").slice(0, 10);

// ---- OAuth
export function adsAuthUrl(cfg, p, state) {
  const redirect_uri = adsRedirectUri(cfg, p);
  if (p === "meta") return `${cfg.fb_dialog}?${qs({ client_id: cfg.meta.id, redirect_uri, state, response_type: "code", scope: AD_PLATFORMS.meta.scopes.join(",") })}`;
  if (p === "snap") return `https://accounts.snapchat.com/login/oauth2/authorize?${qs({ client_id: cfg.snap.id, redirect_uri, response_type: "code", scope: AD_PLATFORMS.snap.scopes.join(" "), state })}`;
  // TikTok: the advertiser authorization page; scopes are set on the developer app, not in the URL. // verify against current docs
  if (p === "tiktok") return `https://business-api.tiktok.com/portal/auth?${qs({ app_id: cfg.tiktok.id, state, redirect_uri })}`;
  if (p === "google") return `https://accounts.google.com/o/oauth2/v2/auth?${qs({ client_id: cfg.google.id, redirect_uri, response_type: "code", scope: AD_PLATFORMS.google.scopes.join(" "), access_type: "offline", prompt: "consent", state })}`;
  throw new Error("Unknown platform");
}

// Meta account_status codes. // verify against current docs
const META_STATUS = { 1: "active", 2: "disabled", 3: "unsettled", 7: "pending risk review", 8: "pending settlement", 9: "in grace period", 100: "pending closure", 101: "closed", 201: "active", 202: "closed" };

// Code (from the callback query) → { tokens, name, accounts, scopes, expires_at }.
export async function adsExchange(cfg, p, query, fetchImpl) {
  const now = Date.now(), redirect_uri = adsRedirectUri(cfg, p);
  if (p === "meta") {
    const G = cfg.graph, code = String(query.code || "");
    const short = await call(fetchImpl, `${G}/oauth/access_token?${qs({ client_id: cfg.meta.id, redirect_uri, client_secret: cfg.meta.secret, code })}`);
    const long = await call(fetchImpl, `${G}/oauth/access_token?${qs({ grant_type: "fb_exchange_token", client_id: cfg.meta.id, client_secret: cfg.meta.secret, fb_exchange_token: short.access_token })}`);
    return metaFromUserToken(cfg, long.access_token, long.expires_in ? new Date(now + long.expires_in * 1000).toISOString() : null, fetchImpl);
  }
  if (p === "snap") {
    const t = await call(fetchImpl, "https://accounts.snapchat.com/login/oauth2/access_token", { method: "POST", form: { grant_type: "authorization_code", client_id: cfg.snap.id, client_secret: cfg.snap.secret, code: String(query.code || ""), redirect_uri } });
    const tokens = { access: t.access_token, refresh: t.refresh_token || "" };
    const me = await call(fetchImpl, `${cfg.snap.base}/me`, { headers: { Authorization: `Bearer ${tokens.access}` } }).catch(() => ({}));
    return { tokens, name: me?.me?.display_name || me?.me?.email || "Snapchat", accounts: await listAdAccounts(cfg, p, tokens, fetchImpl), scopes: String(t.scope || AD_PLATFORMS.snap.scopes.join(" ")).split(/[ ,]+/).filter(Boolean),
      expires_at: new Date(now + (t.expires_in || 1800) * 1000).toISOString() };
  }
  if (p === "tiktok") {
    // The callback carries auth_code (some app types send code). // verify against current docs
    const t = await call(fetchImpl, `${cfg.tiktok.base}/oauth2/access_token/`, { method: "POST", json: { app_id: cfg.tiktok.id, secret: cfg.tiktok.secret, auth_code: String(query.auth_code || query.code || "") } });
    const d = t.data || {};
    if (!d.access_token) throw new Error("TikTok didn't return a token.");
    const tokens = { access: d.access_token, advertiser_ids: (d.advertiser_ids || []).map(String) };
    return { tokens, name: "TikTok for Business", accounts: await listAdAccounts(cfg, p, tokens, fetchImpl), scopes: (d.scope || []).map(String), expires_at: null };
  }
  if (p === "google") {
    const t = await call(fetchImpl, "https://oauth2.googleapis.com/token", { method: "POST", form: { code: String(query.code || ""), client_id: cfg.google.id, client_secret: cfg.google.secret, redirect_uri, grant_type: "authorization_code" } });
    const tokens = { access: t.access_token, refresh: t.refresh_token || "" };
    return { tokens, name: "Google Ads", accounts: await listAdAccounts(cfg, p, tokens, fetchImpl), scopes: String(t.scope || "").split(" ").filter(Boolean), expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString() };
  }
  throw new Error("Unknown platform");
}

// Meta: a long-lived user token (from Paid Ads' own login, or Creative Studio's when it already has the ads permissions).
export async function metaFromUserToken(cfg, userToken, expires_at, fetchImpl) {
  const G = cfg.graph;
  const me = await call(fetchImpl, `${G}/me?${qs({ fields: "id,name", access_token: userToken })}`);
  const perms = (await call(fetchImpl, `${G}/me/permissions?${qs({ access_token: userToken })}`).catch(() => ({ data: [] }))).data || [];
  const tokens = { user: userToken };
  return { tokens, name: me.name || "Meta", accounts: await listAdAccounts(cfg, "meta", tokens, fetchImpl), scopes: perms.filter((x) => x.status === "granted").map((x) => x.permission), expires_at };
}

const googleHeaders = (cfg, tokens) => ({ Authorization: `Bearer ${tokens.access}`, "developer-token": cfg.google.dev_token, ...(cfg.google.login_customer ? { "login-customer-id": cfg.google.login_customer } : {}) });

// Ad accounts the login can see: [{ id, name, currency, timezone, status, active }].
export async function listAdAccounts(cfg, p, tokens, fetchImpl) {
  if (p === "meta") {
    const out = [];
    let url = `${cfg.graph}/me/adaccounts?${qs({ fields: "id,account_id,name,currency,timezone_name,account_status,disable_reason", limit: 100, access_token: tokens.user })}`;
    for (let i = 0; url && i < 10; i++) {
      const r = await call(fetchImpl, url);
      for (const a of r.data || []) out.push({ id: a.id, name: a.name || a.id, currency: a.currency || "", timezone: a.timezone_name || "", status: META_STATUS[a.account_status] || String(a.account_status ?? ""), active: [1, 201].includes(Number(a.account_status)) });
      url = r.paging?.next || null;
    }
    return out;
  }
  if (p === "snap") {
    const r = await call(fetchImpl, `${cfg.snap.base}/me/organizations?with_ad_accounts=true`, { headers: { Authorization: `Bearer ${tokens.access}` } });
    return (r.organizations || []).flatMap((o) => (o.organization?.ad_accounts || []).map((a) => ({ id: a.id, name: a.name || a.id, currency: a.currency || "", timezone: a.timezone || "", status: String(a.status || "").toLowerCase(), active: a.status === "ACTIVE", org: o.organization?.name || "" })));
  }
  if (p === "tiktok") {
    const ids = tokens.advertiser_ids || [];
    if (!ids.length) return [];
    // verify against current docs: field names on advertiser/info (status values like STATUS_ENABLE)
    const r = await call(fetchImpl, `${cfg.tiktok.base}/advertiser/info/?${qs({ advertiser_ids: ids, fields: ["advertiser_id", "name", "currency", "timezone", "display_timezone", "status"] })}`, { headers: { "Access-Token": tokens.access } });
    return (r.data?.list || []).map((a) => ({ id: String(a.advertiser_id), name: a.name || String(a.advertiser_id), currency: a.currency || "", timezone: a.display_timezone || a.timezone || "", status: String(a.status || "").replace(/^STATUS_/, "").toLowerCase(), active: a.status === "STATUS_ENABLE" }));
  }
  if (p === "google") {
    const v = cfg.google.version;
    const r = await call(fetchImpl, `https://googleads.googleapis.com/${v}/customers:listAccessibleCustomers`, { headers: googleHeaders(cfg, tokens) });
    const out = [];
    for (const rn of (r.resourceNames || []).slice(0, 20)) {
      const id = rn.split("/")[1];
      const q = await call(fetchImpl, `https://googleads.googleapis.com/${v}/customers/${id}/googleAds:search`, { method: "POST", headers: googleHeaders(cfg, tokens), json: { query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer LIMIT 1" } }).catch(() => null);
      const c = q?.results?.[0]?.customer || {};
      out.push({ id, name: c.descriptiveName || id, currency: c.currencyCode || "", timezone: c.timeZone || "", status: String(c.status || "").toLowerCase(), active: c.status === "ENABLED" });
    }
    return out;
  }
  return [];
}

// Refresh where the platform supports it. Returns { tokens, expires_at } or null.
export async function refreshAdsTokens(cfg, p, tokens, fetchImpl) {
  const now = Date.now();
  if (p === "snap" && tokens.refresh) {
    const t = await call(fetchImpl, "https://accounts.snapchat.com/login/oauth2/access_token", { method: "POST", form: { grant_type: "refresh_token", client_id: cfg.snap.id, client_secret: cfg.snap.secret, refresh_token: tokens.refresh } });
    return { tokens: { ...tokens, access: t.access_token, refresh: t.refresh_token || tokens.refresh }, expires_at: new Date(now + (t.expires_in || 1800) * 1000).toISOString() };
  }
  if (p === "google" && tokens.refresh) {
    const t = await call(fetchImpl, "https://oauth2.googleapis.com/token", { method: "POST", form: { client_id: cfg.google.id, client_secret: cfg.google.secret, refresh_token: tokens.refresh, grant_type: "refresh_token" } });
    return { tokens: { ...tokens, access: t.access_token }, expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString() };
  }
  return null; // Meta: the user token lasts ~60 days, then reconnect. TikTok: doesn't expire.
}

// ---- insights, normalised to one row shape per ad per day:
// { channel, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, clicks, reach, frequency, leads, signups, purchases }
// spend is in the ad account's currency (the caller converts to SAR).
const META_ACTIONS = {
  leads: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
  signups: ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
  purchases: ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"],
};
// Meta repeats the same conversion under several action types (aggregate + pixel): take the largest, never the sum.
const metaAction = (actions, types) => Math.max(0, ...(actions || []).filter((a) => types.includes(a.action_type)).map((a) => n(a.value)));
export function normalizeMeta(list) {
  return (list || []).map((r) => ({
    channel: "Meta", date: day(r.date_start), campaign_id: String(r.campaign_id || ""), campaign_name: r.campaign_name || "", adset_id: String(r.adset_id || ""), adset_name: r.adset_name || "",
    ad_id: String(r.ad_id || ""), ad_name: r.ad_name || "", spend: n(r.spend), impressions: Math.round(n(r.impressions)), clicks: Math.round(n(r.inline_link_clicks ?? r.clicks)),
    reach: Math.round(n(r.reach)), frequency: n(r.frequency),
    leads: metaAction(r.actions, META_ACTIONS.leads), signups: metaAction(r.actions, META_ACTIONS.signups), purchases: metaAction(r.actions, META_ACTIONS.purchases),
  }));
}
// Snap stats (breakdown=ad, granularity=DAY) + entity names. Spend is in micro-currency. // verify against current docs: stat field names
export function normalizeSnap(stats, names = {}) {
  const out = [];
  for (const ts of stats?.timeseries_stats || []) {
    for (const ad of ts.timeseries_stat?.breakdown_stats?.ad || []) {
      const a = names.ads?.[ad.id] || {}, sq = names.squads?.[a.ad_squad_id] || {}, cp = names.campaigns?.[sq.campaign_id] || {};
      for (const t of ad.timeseries || []) {
        const s = t.stats || {};
        out.push({ channel: "Snapchat", date: day(t.start_time), campaign_id: String(sq.campaign_id || ""), campaign_name: cp.name || "", adset_id: String(a.ad_squad_id || ""), adset_name: sq.name || "",
          ad_id: String(ad.id), ad_name: a.name || "", spend: n(s.spend) / 1e6, impressions: Math.round(n(s.impressions)), clicks: Math.round(n(s.swipes)), reach: Math.round(n(s.uniques)), frequency: n(s.frequency),
          leads: Math.round(n(s.conversion_leads ?? s.conversion_sign_ups_lead)), signups: Math.round(n(s.conversion_sign_ups)), purchases: Math.round(n(s.conversion_purchases)) });
      }
    }
  }
  return out.filter((r) => r.date && (r.spend || r.impressions));
}
// TikTok integrated report, data_level AUCTION_AD, dimensions ad_id + stat_time_day. Metrics come back as strings.
export function normalizeTikTok(list) {
  return (list || []).map((r) => {
    const m = r.metrics || {}, d = r.dimensions || {};
    return { channel: "TikTok", date: day(d.stat_time_day), campaign_id: String(m.campaign_id || ""), campaign_name: m.campaign_name || "", adset_id: String(m.adgroup_id || ""), adset_name: m.adgroup_name || "",
      ad_id: String(d.ad_id || m.ad_id || ""), ad_name: m.ad_name || "", spend: n(m.spend), impressions: Math.round(n(m.impressions)), clicks: Math.round(n(m.clicks)), reach: Math.round(n(m.reach)), frequency: n(m.frequency),
      // verify against current docs: web-event metric names (registration / complete_payment / form)
      leads: Math.round(n(m.form ?? m.leads)), signups: Math.round(n(m.registration ?? m.complete_registration ?? m.user_registration)), purchases: Math.round(n(m.complete_payment ?? m.purchase)) };
  }).filter((r) => r.date);
}
// Google Ads searchStream: one "conversions" number (the account's primary conversion actions) fills every result type.
export function normalizeGoogle(batches) {
  const out = [];
  for (const b of batches || []) for (const r of b.results || []) {
    const conv = n(r.metrics?.conversions);
    out.push({ channel: "Google", date: day(r.segments?.date), campaign_id: String(r.campaign?.id || ""), campaign_name: r.campaign?.name || "", adset_id: String(r.adGroup?.id || ""), adset_name: r.adGroup?.name || "",
      ad_id: String(r.adGroupAd?.ad?.id || ""), ad_name: r.adGroupAd?.ad?.name || "", spend: n(r.metrics?.costMicros) / 1e6, impressions: Math.round(n(r.metrics?.impressions)), clicks: Math.round(n(r.metrics?.clicks)),
      reach: 0, frequency: 0, leads: conv, signups: conv, purchases: conv });
  }
  return out.filter((r) => r.date);
}

// Pull ad-level daily insights for one ad account between two dates (YYYY-MM-DD, inclusive).
export async function fetchInsights(cfg, p, tokens, account, { since, until }, fetchImpl) {
  if (p === "meta") {
    const rows = [];
    let url = `${cfg.graph}/${account.id}/insights?${qs({ level: "ad", time_increment: 1, time_range: { since, until }, limit: 500, access_token: tokens.user,
      fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,reach,frequency,actions,date_start,date_stop" })}`;
    for (let i = 0; url && i < 40; i++) { const r = await call(fetchImpl, url); rows.push(...(r.data || [])); url = r.paging?.next || null; }
    return normalizeMeta(rows);
  }
  if (p === "snap") {
    const H = { headers: { Authorization: `Bearer ${tokens.access}` } }, B = cfg.snap.base;
    // verify against current docs: Snap wants start/end at hour boundaries in the account's timezone; the end is exclusive.
    const end = new Date(Date.parse(until + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
    const stats = await call(fetchImpl, `${B}/adaccounts/${account.id}/stats?${qs({ granularity: "DAY", breakdown: "ad", start_time: `${since}T00:00:00`, end_time: `${end}T00:00:00`,
      fields: "impressions,swipes,spend,uniques,frequency,conversion_sign_ups,conversion_purchases" })}`, H);
    const [ads, squads, camps] = await Promise.all([`${B}/adaccounts/${account.id}/ads`, `${B}/adaccounts/${account.id}/adsquads`, `${B}/adaccounts/${account.id}/campaigns`].map((u) => call(fetchImpl, u, H).catch(() => ({}))));
    const names = {
      ads: Object.fromEntries((ads.ads || []).map((x) => [x.ad.id, { name: x.ad.name, ad_squad_id: x.ad.ad_squad_id }])),
      squads: Object.fromEntries((squads.adsquads || []).map((x) => [x.adsquad.id, { name: x.adsquad.name, campaign_id: x.adsquad.campaign_id }])),
      campaigns: Object.fromEntries((camps.campaigns || []).map((x) => [x.campaign.id, { name: x.campaign.name }])),
    };
    return normalizeSnap(stats, names);
  }
  if (p === "tiktok") {
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const r = await call(fetchImpl, `${cfg.tiktok.base}/report/integrated/get/?${qs({ advertiser_id: account.id, report_type: "BASIC", data_level: "AUCTION_AD", dimensions: ["ad_id", "stat_time_day"],
        metrics: ["campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name", "spend", "impressions", "clicks", "reach", "frequency", "registration", "complete_payment", "form"],
        start_date: since, end_date: until, page, page_size: 1000 })}`, { headers: { "Access-Token": tokens.access } });
      rows.push(...(r.data?.list || []));
      if (page >= (r.data?.page_info?.total_page || 1)) break;
    }
    return normalizeTikTok(rows);
  }
  if (p === "google") {
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;
    const r = await call(fetchImpl, `https://googleads.googleapis.com/${cfg.google.version}/customers/${account.id}/googleAds:searchStream`, { method: "POST", headers: googleHeaders(cfg, tokens), json: { query } });
    return normalizeGoogle(Array.isArray(r) ? r : [r]);
  }
  return [];
}

// ---- campaign creation: payloads first (pure, so Test mode can show exactly what would be sent), then the calls.
// Budgets come in SAR and are converted to the account currency with the rate the caller passes (SAR per 1 unit).
const META_OBJECTIVE = { leads: "OUTCOME_LEADS", signups: "OUTCOME_LEADS", purchases: "OUTCOME_SALES", traffic: "OUTCOME_TRAFFIC" };
const META_EVENT = { leads: "LEAD", signups: "COMPLETE_REGISTRATION", purchases: "PURCHASE" };
const TIKTOK_EVENT = { leads: "FORM", signups: "COMPLETE_REGISTRATION", purchases: "COMPLETE_PAYMENT" }; // verify against current docs: optimization_event values
const SNAP_GOAL = { leads: "PIXEL_SIGNUP", signups: "PIXEL_SIGNUP", purchases: "PIXEL_PURCHASE" }; // verify against current docs
const iso = (d, end = false) => (d ? `${d}T${end ? "23:59:00" : "00:00:00"}+0300` : undefined);
const tiktokTime = (d, end = false) => (d ? `${d} ${end ? "23:59:00" : "00:00:00"}` : undefined);

// campaign: one channel's part of an approved plan (see ads.js cleanPlan). ctx: { account, fx, result, page_id, ig_user_id, pixel_id, link, images: {item_id: url}, interests: {name: id} }
export function buildCreatePayloads(p, campaign, ctx) {
  const cur = (sar) => sar / (ctx.fx || 1); // SAR → account currency
  const result = ctx.result || "signups";
  if (p === "meta") {
    const pix = ctx.pixel_id && META_EVENT[result];
    return {
      campaign: { name: campaign.name, objective: META_OBJECTIVE[campaign.objective] || META_OBJECTIVE[result] || "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: [], buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false }, // verify against current docs: required since v22 when budgets sit on ad sets
      adsets: campaign.ad_sets.map((s) => ({
        name: s.name, daily_budget: Math.max(100, Math.round(cur(s.daily_budget_sar) * 100)), // minor units (halalas / cents) // verify: min daily budget per currency
        billing_event: "IMPRESSIONS", optimization_goal: pix ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(pix ? { promoted_object: { pixel_id: ctx.pixel_id, custom_event_type: META_EVENT[result] } } : {}),
        targeting: {
          geo_locations: s.audience.cities?.length && ctx.cities ? { cities: s.audience.cities.map((c) => ctx.cities[c]).filter(Boolean).map((key) => ({ key })) } : { countries: ["SA"] },
          age_min: s.audience.age_min || 21, age_max: s.audience.age_max || 55,
          ...((s.audience.interests || []).concat(s.audience.job_titles || []).some((x) => ctx.interests?.[x]) ? { flexible_spec: [{
            interests: (s.audience.interests || []).filter((x) => ctx.interests?.[x]).map((x) => ({ id: ctx.interests[x], name: x })),
            work_positions: (s.audience.job_titles || []).filter((x) => ctx.interests?.[x]).map((x) => ({ id: ctx.interests[x], name: x })),
          }].map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v.length))) } : {}),
          ...(s.placements?.length ? { publisher_platforms: [...new Set(s.placements.map((x) => (/insta/i.test(x) ? "instagram" : /messenger/i.test(x) ? "messenger" : /audience/i.test(x) ? "audience_network" : "facebook")))] } : {}),
        },
        start_time: iso(campaign.start_date), end_time: iso(campaign.end_date, true), status: "PAUSED",
      })),
      ads: campaign.ads.map((a) => ({ adset_index: a.adset_index || 0, name: a.name,
        creative: ctx.page_id && ctx.images?.[a.creative_item_id] ? { name: a.name, object_story_spec: { page_id: ctx.page_id, ...(ctx.ig_user_id ? { instagram_user_id: ctx.ig_user_id } : {}),
          link_data: { link: a.link, message: a.primary_text_ar, name: a.headline_ar, picture: ctx.images[a.creative_item_id], call_to_action: { type: a.cta || "SIGN_UP", value: { link: a.link } } } } } : null, // verify: link_data.picture vs image_hash for your API version
        status: "PAUSED" })),
    };
  }
  if (p === "snap") {
    return {
      campaign: { name: campaign.name, ad_account_id: ctx.account.id, status: "PAUSED", start_time: iso(campaign.start_date), ...(campaign.end_date ? { end_time: iso(campaign.end_date, true) } : {}) },
      adsets: campaign.ad_sets.map((s) => ({ name: s.name, type: "SNAP_ADS", status: "PAUSED", placement_v2: { config: "AUTOMATIC" }, billing_event: "IMPRESSION", bid_strategy: "AUTO_BID",
        optimization_goal: ctx.pixel_id ? SNAP_GOAL[result] || "PIXEL_SIGNUP" : "SWIPES", ...(ctx.pixel_id ? { pixel_id: ctx.pixel_id } : {}),
        daily_budget_micro: Math.round(cur(s.daily_budget_sar) * 1e6), // verify: Snap minimum is about USD 5/day per ad squad
        targeting: { geos: [{ country_code: "sa" }], demographics: [{ min_age: String(s.audience.age_min || 21), max_age: String(s.audience.age_max || 55) }] },
        start_time: iso(campaign.start_date), ...(campaign.end_date ? { end_time: iso(campaign.end_date, true) } : {}) })),
      ads: [], // Snap ads need media uploaded to Snap first: a person adds them in Ads Manager (the plan lists which Studio media to use)
    };
  }
  if (p === "tiktok") {
    return {
      campaign: { advertiser_id: ctx.account.id, campaign_name: campaign.name, objective_type: result === "leads" ? "LEAD_GENERATION" : "WEB_CONVERSIONS", budget_mode: "BUDGET_MODE_INFINITE", operation_status: "DISABLE" },
      adsets: campaign.ad_sets.map((s) => ({ advertiser_id: ctx.account.id, adgroup_name: s.name, promotion_type: "WEBSITE", placement_type: "PLACEMENT_TYPE_AUTOMATIC",
        location_ids: ["102358"], // verify against current docs: TikTok's location id for Saudi Arabia
        budget_mode: "BUDGET_MODE_DAY", budget: Math.round(cur(s.daily_budget_sar) * 100) / 100, // verify: TikTok minimum ad group daily budget (about USD 20)
        schedule_type: campaign.end_date ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW", schedule_start_time: tiktokTime(campaign.start_date), ...(campaign.end_date ? { schedule_end_time: tiktokTime(campaign.end_date, true) } : {}),
        optimization_goal: ctx.pixel_id ? "CONVERT" : "CLICK", ...(ctx.pixel_id ? { pixel_id: ctx.pixel_id, optimization_event: TIKTOK_EVENT[result] } : {}),
        billing_event: ctx.pixel_id ? "OCPM" : "CPC", bid_type: "BID_TYPE_NO_BID", operation_status: "DISABLE" })),
      ads: [], // TikTok ads need an identity and an uploaded video: a person adds them in Ads Manager
    };
  }
  return null; // Google: reporting only
}

// Create the campaign PAUSED. Returns { campaign_id, adset_ids, ad_ids, notes }.
export async function createPausedCampaign(cfg, p, tokens, account, payloads, fetchImpl) {
  const notes = [];
  if (p === "meta") {
    const G = cfg.graph, A = account.id, tok = { access_token: tokens.user };
    const c = await call(fetchImpl, `${G}/${A}/campaigns`, { method: "POST", form: { ...payloads.campaign, status: "PAUSED", ...tok } });
    const adset_ids = [];
    for (const s of payloads.adsets) adset_ids.push((await call(fetchImpl, `${G}/${A}/adsets`, { method: "POST", form: { ...s, campaign_id: c.id, status: "PAUSED", ...tok } })).id);
    const ad_ids = [];
    for (const a of payloads.ads) {
      if (!a.creative) { notes.push(`Ad "${a.name}": no Page or approved image to use; add it in Ads Manager.`); continue; }
      const cr = await call(fetchImpl, `${G}/${A}/adcreatives`, { method: "POST", form: { ...a.creative, ...tok } });
      ad_ids.push((await call(fetchImpl, `${G}/${A}/ads`, { method: "POST", form: { name: a.name, adset_id: adset_ids[a.adset_index] || adset_ids[0], creative: { creative_id: cr.id }, status: "PAUSED", ...tok } })).id);
    }
    return { campaign_id: c.id, adset_ids, ad_ids, notes };
  }
  if (p === "snap") {
    const H = { Authorization: `Bearer ${tokens.access}` }, B = cfg.snap.base;
    const c = await call(fetchImpl, `${B}/adaccounts/${account.id}/campaigns`, { method: "POST", headers: H, json: { campaigns: [{ ...payloads.campaign, status: "PAUSED" }] } });
    const campaign_id = c.campaigns?.[0]?.campaign?.id;
    if (!campaign_id) throw new Error("Snapchat didn't return the campaign id.");
    const sq = await call(fetchImpl, `${B}/campaigns/${campaign_id}/adsquads`, { method: "POST", headers: H, json: { adsquads: payloads.adsets.map((s) => ({ ...s, campaign_id, status: "PAUSED" })) } });
    notes.push("Snapchat: add the ads (upload the Studio media) in Ads Manager; the ad squads are paused.");
    return { campaign_id, adset_ids: (sq.adsquads || []).map((x) => x.adsquad?.id).filter(Boolean), ad_ids: [], notes };
  }
  if (p === "tiktok") {
    const H = { "Access-Token": tokens.access }, B = cfg.tiktok.base;
    const c = await call(fetchImpl, `${B}/campaign/create/`, { method: "POST", headers: H, json: { ...payloads.campaign, operation_status: "DISABLE" } });
    const campaign_id = String(c.data?.campaign_id || "");
    if (!campaign_id) throw new Error("TikTok didn't return the campaign id.");
    const adset_ids = [];
    for (const s of payloads.adsets) adset_ids.push(String((await call(fetchImpl, `${B}/adgroup/create/`, { method: "POST", headers: H, json: { ...s, campaign_id, operation_status: "DISABLE" } })).data?.adgroup_id || ""));
    notes.push("TikTok: add the ads (identity + video from Studio) in Ads Manager; the ad groups are off.");
    return { campaign_id, adset_ids: adset_ids.filter(Boolean), ad_ids: [], notes };
  }
  throw new Error("Creating campaigns isn't supported on this platform: build it in the platform's Ads Manager.");
}

// Meta interest / job-title ids for names the plan uses (targeting search). // verify against current docs: type=adinterest / adworkposition
export async function metaTargetingIds(cfg, tokens, names, fetchImpl, type = "adinterest") {
  const out = {};
  for (const q of [...new Set(names)].slice(0, 20)) {
    const r = await call(fetchImpl, `${cfg.graph}/search?${qs({ type, q, limit: 1, access_token: tokens.user })}`).catch(() => null);
    if (r?.data?.[0]?.id) out[q] = String(r.data[0].id);
  }
  return out;
}

// ---- status and budget changes (guardrails and the approver's "Activate")
// target: { level: "campaign"|"adset"|"ad", id, campaign_id }
async function snapUpdate(cfg, tokens, kind, target, change, fetchImpl) {
  const H = { Authorization: `Bearer ${tokens.access}` }, B = cfg.snap.base;
  // Snap updates replace the whole entity: read it, change the field, PUT it back. // verify against current docs
  if (kind === "campaign") {
    const cur = (await call(fetchImpl, `${B}/campaigns/${target.id}`, { headers: H })).campaigns?.[0]?.campaign;
    if (!cur) throw new Error("Snapchat campaign not found.");
    return call(fetchImpl, `${B}/adaccounts/${cur.ad_account_id}/campaigns`, { method: "PUT", headers: H, json: { campaigns: [{ ...cur, ...change }] } });
  }
  const cur = (await call(fetchImpl, `${B}/adsquads/${target.id}`, { headers: H })).adsquads?.[0]?.adsquad;
  if (!cur) throw new Error("Snapchat ad squad not found.");
  return call(fetchImpl, `${B}/campaigns/${cur.campaign_id}/adsquads`, { method: "PUT", headers: H, json: { adsquads: [{ ...cur, ...change }] } });
}

export async function setAdsStatus(cfg, p, tokens, account, target, on, fetchImpl) {
  if (p === "meta") return call(fetchImpl, `${cfg.graph}/${target.id}`, { method: "POST", form: { status: on ? "ACTIVE" : "PAUSED", access_token: tokens.user } });
  if (p === "snap") return snapUpdate(cfg, tokens, target.level === "campaign" ? "campaign" : "adsquad", target, { status: on ? "ACTIVE" : "PAUSED" }, fetchImpl);
  if (p === "tiktok") {
    const path = target.level === "campaign" ? "campaign/status/update/" : target.level === "ad" ? "ad/status/update/" : "adgroup/status/update/";
    const idKey = target.level === "campaign" ? "campaign_ids" : target.level === "ad" ? "ad_ids" : "adgroup_ids";
    return call(fetchImpl, `${cfg.tiktok.base}/${path}`, { method: "POST", headers: { "Access-Token": tokens.access }, json: { advertiser_id: account.id, [idKey]: [target.id], operation_status: on ? "ENABLE" : "DISABLE" } });
  }
  throw new Error("Changing status isn't supported on this platform: do it in the platform's Ads Manager.");
}

export async function setDailyBudget(cfg, p, tokens, account, target, amount, fetchImpl) { // amount in the account currency
  if (p === "meta") return call(fetchImpl, `${cfg.graph}/${target.id}`, { method: "POST", form: { daily_budget: Math.round(amount * 100), access_token: tokens.user } });
  if (p === "snap") return snapUpdate(cfg, tokens, "adsquad", target, { daily_budget_micro: Math.round(amount * 1e6) }, fetchImpl);
  if (p === "tiktok") return call(fetchImpl, `${cfg.tiktok.base}/adgroup/budget/update/`, { method: "POST", headers: { "Access-Token": tokens.access }, json: { advertiser_id: account.id, budget: [{ adgroup_id: target.id, budget: Math.round(amount * 100) / 100 }] } });
  throw new Error("Changing budgets isn't supported on this platform: do it in the platform's Ads Manager.");
}

export async function revokeAdsTokens(cfg, p, tokens, fetchImpl) {
  try {
    if (p === "meta" && tokens.own) await call(fetchImpl, `${cfg.graph}/me/permissions/ads_management?${qs({ access_token: tokens.user })}`, { method: "DELETE" }); // only the ads permission, so Creative Studio keeps working
    if (p === "google") await call(fetchImpl, "https://oauth2.googleapis.com/revoke", { method: "POST", form: { token: tokens.refresh || tokens.access } });
    if (p === "tiktok") await call(fetchImpl, `${cfg.tiktok.base}/oauth2/revoke_token/`, { method: "POST", json: { app_id: cfg.tiktok.id, secret: cfg.tiktok.secret, access_token: tokens.access } }); // verify against current docs
    return true;
  } catch { return false; }
}
