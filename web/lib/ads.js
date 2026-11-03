// Paid Ads: DPA AD's own campaigns on Meta, Snapchat, TikTok (Google optional), run to win store owners
// at a known cost per lead / trial / paying store. Pure logic here (CSV import, metrics, pacing, guardrails,
// UTMs, attribution, Finance push, creative rotation, the campaign planner's prompt and plan clean-up);
// platform calls live in adsapi.js and HTTP routes in adsroutes.js.
// Rule: Test mode by default. Nothing on a platform changes until a person switches to Live, campaigns are
// created PAUSED, and only an approver activates them.
import { riyadhDay, splitCsv } from "./crm.js";
import { seasonsBetween } from "./creative.js";

export const COLL = { accounts: "ads_accounts", rows: "ads_insights", plans: "ads_plans", rules: "ads_rules", actions: "ads_actions", log: "ads_log", batches: "ads_batches", links: "ads_links" };
export function ensureAdsCollections(store) { for (const c of Object.values(COLL)) store.db[c] ||= []; }

// Channels (names match ROAS results) and the platform behind each.
export const CHANNELS = [
  { id: "Meta", platform: "meta", vendor: "Meta Ads", utm_source: "meta", utm_medium: "paid_social", color: "#4f7cff" },
  { id: "Snapchat", platform: "snap", vendor: "Snapchat Ads", utm_source: "snapchat", utm_medium: "paid_social", color: "#e5c400" },
  { id: "TikTok", platform: "tiktok", vendor: "TikTok Ads", utm_source: "tiktok", utm_medium: "paid_social", color: "#ff3b6b" },
  { id: "Google", platform: "google", vendor: "Google Ads", utm_source: "google", utm_medium: "cpc", color: "#34a853" },
];
export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
export const channelOf = (id) => CHANNELS.find((c) => c.id === id) || null;
export const channelOfPlatform = (p) => CHANNELS.find((c) => c.platform === p)?.id || null;
export const RESULT_TYPES = [
  { id: "signups", name: "Signups (complete registration)" },
  { id: "leads", name: "Leads (forms)" },
  { id: "purchases", name: "Paying (purchases)" },
];
const RESULT_IDS = RESULT_TYPES.map((r) => r.id);

export const DEFAULT_ADS = {
  mode: "test", result: "signups", tolerance_pct: 10,
  budgets: { total: 0, Meta: 0, Snapchat: 0, TikTok: 0, Google: 0 }, // SAR per month; 0 = not set
  fx: { SAR: 1, USD: 3.75 }, // SAR per 1 unit of the account currency (the riyal is pegged to the dollar)
  landing_url: "https://dpa.ad", meta_page_id: "", meta_pixel_id: "", snap_pixel_id: "", tiktok_pixel_id: "",
};
export function adsSettings(w) {
  const s = w?.ads || {};
  return { ...DEFAULT_ADS, ...s, budgets: { ...DEFAULT_ADS.budgets, ...(s.budgets || {}) }, fx: { ...DEFAULT_ADS.fx, ...(s.fx || {}) } };
}
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const money = (v) => { const x = Math.round(Number(v) * 100) / 100; return Number.isFinite(x) && x >= 0 ? x : null; };
export function cleanAdsSettings(b = {}, cur = DEFAULT_ADS) {
  const o = {};
  if (b.mode !== undefined) o.mode = b.mode === "live" ? "live" : "test";
  if (b.result !== undefined) o.result = RESULT_IDS.includes(b.result) ? b.result : cur.result;
  if (b.tolerance_pct !== undefined) o.tolerance_pct = Math.max(1, Math.min(50, Math.round(Number(b.tolerance_pct) || 10)));
  if (b.budgets) o.budgets = { ...cur.budgets, ...Object.fromEntries(Object.entries(b.budgets).filter(([k]) => k === "total" || CHANNEL_IDS.includes(k)).map(([k, v]) => [k, money(v) ?? 0])) };
  if (b.fx) {
    o.fx = { ...cur.fx };
    for (const [k, v] of Object.entries(b.fx)) { const c = String(k).toUpperCase(); if (!/^[A-Z]{3}$/.test(c) || c === "SAR") continue; const r = Number(v); if (r > 0 && r < 10000) o.fx[c] = Math.round(r * 1e6) / 1e6; else if (v === null || v === "") delete o.fx[c]; }
  }
  if (b.landing_url !== undefined) o.landing_url = /^https?:\/\/[^\s"'<>]+$/i.test(str(b.landing_url, 500)) ? str(b.landing_url, 500) : cur.landing_url;
  for (const k of ["meta_page_id", "meta_pixel_id", "snap_pixel_id", "tiktok_pixel_id"]) if (b[k] !== undefined) o[k] = str(b[k], 60).replace(/[^\w-]/g, "");
  return o;
}

// ---- money: SAR per unit of a currency (null when the person hasn't typed a rate yet)
export const fxRate = (settings, currency) => { const c = String(currency || "SAR").toUpperCase(); return c === "SAR" ? 1 : Number(settings.fx?.[c]) > 0 ? Number(settings.fx[c]) : null; };
// Rows with spend in SAR at today's typed rate. Rows in a currency without a rate get spend_sar = null.
export function withSar(rows, settings) {
  return rows.map((r) => { const fx = fxRate(settings, r.currency); return { ...r, spend_sar: fx == null ? null : Math.round(r.spend * fx * 100) / 100 }; });
}
export const missingFx = (rows, settings) => [...new Set(rows.filter((r) => fxRate(settings, r.currency) == null).map((r) => String(r.currency || "").toUpperCase()))];

// ---- dates (Riyadh)
export const riyadhMonth = (now = new Date()) => riyadhDay(now).slice(0, 7);
export const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const addDays = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);

// ---- CSV import fallback: spend and results exported from each Ads Manager (any level, by day).
const COLS = {
  date: [/^day$/, /^date$/, /reporting starts/, /reporting_start/, /stat_time_day/, /^start time/, /^time$/, /^التاريخ$/, /^اليوم$/],
  campaign: [/^campaign name$/, /^campaign$/, /^campaign_name$/, /اسم الحملة/, /^الحملة$/],
  adset: [/^ad set name$/, /^ad set$/, /^ad squad name$/, /^ad squad$/, /^ad group name$/, /^ad group$/, /^adgroup name$/, /^adgroup_name$/, /^ad_set_name$/],
  ad: [/^ad name$/, /^ad$/, /^ad_name$/, /^creative name$/],
  currency: [/^currency$/, /^العملة$/],
  spend: [/amount spent/, /^spend/, /^cost$/, /total cost/, /^المبلغ المنفق/],
  impressions: [/^impressions/, /^impr/, /^مرات الظهور/],
  clicks: [/^link clicks/, /^clicks/, /^swipe ups?/, /^swipes/, /^النقرات/],
  reach: [/^reach$/, /^uniques$/, /^reach /, /^paid reach/],
  frequency: [/^frequency/],
  leads: [/^leads?$/, /^leads? \(/, /^on-facebook leads/, /^form submissions?/, /^total form/],
  signups: [/registrations? completed/, /complete registration/, /^sign ?ups?/, /^registrations?$/, /^complete_registration$/],
  purchases: [/^purchases?$/, /^website purchases/, /^complete payment$/, /^purchases \(/, /^conversions? \(purchase\)/],
  results: [/^results$/, /^conversions$/],
};
const num = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/[^\d.,-]/g, "");
  const t = /,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const f = parseFloat(t);
  return Number.isFinite(f) ? f : 0;
};
const csvId = (s) => "csv:" + slug(s || "untitled");
// Returns { channel, currency, rows, found } or { error }. "Results" fills the configured result type when its own column is missing.
export function parseAdsInsightsCsv(text, { channel = "", currency = "", result = "signups" } = {}) {
  const rows = splitCsv(String(text || ""));
  if (rows.length < 2) return { error: "Paste the CSV with its header row and at least one row." };
  const header = rows[0].map((h) => String(h || "").toLowerCase().trim());
  const idx = {}, used = new Set();
  for (const [k, pats] of Object.entries(COLS)) for (const p of pats) { const i = header.findIndex((h, j) => !used.has(j) && p.test(h)); if (i >= 0) { idx[k] = i; used.add(i); break; } }
  if (idx.spend == null) return { error: "Couldn't find the spend column (Amount spent / Spend / Cost). Export with spend included." };
  if (idx.campaign == null && idx.ad == null && idx.adset == null) return { error: "Couldn't find a Campaign name, Ad set name or Ad name column." };
  const guess = channel || (header.some((h) => /swipe|ad squad/.test(h)) ? "Snapchat" : header.some((h) => /complete payment|ad group|adgroup|stat_time_day/.test(h)) ? "TikTok" : header.some((h) => /amount spent|ad set/.test(h)) ? "Meta" : "");
  if (!CHANNEL_IDS.includes(guess)) return { error: "Pick the channel: the columns don't say which Ads Manager this came from." };
  const curCol = idx.currency != null ? String(rows[1][idx.currency] || "").toUpperCase() : "";
  const cur = (currency || curCol || "SAR").toUpperCase().slice(0, 3);
  const today = riyadhDay();
  const out = [];
  for (const r of rows.slice(1)) {
    const camp = idx.campaign != null ? str(r[idx.campaign]) : "", set = idx.adset != null ? str(r[idx.adset]) : "", ad = idx.ad != null ? str(r[idx.ad]) : "";
    if (!camp && !set && !ad) continue;
    if (/^total|^الإجمالي/i.test(camp || set || ad)) continue;
    const rawDate = idx.date != null ? String(r[idx.date] || "") : "";
    const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : /^\d{1,2}\/\d{1,2}\/\d{4}/.test(rawDate) ? (() => { const [a, b, y] = rawDate.split(/[/ ]/); return `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`; })() : today; // verify: US-style M/D/YYYY exports
    const row = {
      channel: guess, date, currency: cur,
      campaign_id: csvId(camp || set || ad), campaign_name: camp || set || ad, adset_id: set ? csvId(`${camp}|${set}`) : "", adset_name: set, ad_id: ad ? csvId(`${camp}|${set}|${ad}`) : "", ad_name: ad,
      spend: Math.round(num(r[idx.spend]) * 100) / 100, impressions: Math.round(num(r[idx.impressions])), clicks: Math.round(num(r[idx.clicks])),
      reach: Math.round(num(r[idx.reach])), frequency: Math.round(num(r[idx.frequency]) * 100) / 100,
      leads: Math.round(num(r[idx.leads])), signups: Math.round(num(r[idx.signups])), purchases: Math.round(num(r[idx.purchases])),
    };
    if (idx.results != null && idx[result] == null) row[result] = Math.round(num(r[idx.results]));
    out.push(row);
  }
  if (!out.length) return { error: "No rows found under the header." };
  return { channel: guess, currency: cur, rows: out, found: Object.keys(idx) };
}
// One key per entity per day, so re-importing or re-pulling replaces instead of adding.
export const rowKey = (r) => [r.channel, r.source, r.ad_id || r.adset_id || r.campaign_id, r.date].join("|");
// Upsert rows into the store; returns { added, updated }.
export function saveRows(store, wsId, rows, { source, batch_id = null, account_id = "" }) {
  const all = store.db[COLL.rows], ws = String(wsId);
  const byKey = new Map(all.filter((r) => r.workspace_id === ws).map((r) => [r.key, r]));
  let added = 0, updated = 0;
  for (const r0 of rows) {
    const r = { ...r0, source, account_id: r0.account_id || account_id, ...(batch_id ? { batch_id } : {}) };
    r.key = rowKey(r);
    const cur = byKey.get(r.key);
    if (cur) { Object.assign(cur, r, { updated_at: new Date().toISOString() }); updated++; }
    else { const x = store.addOps(COLL.rows, ws, r, false); byKey.set(r.key, x); added++; }
  }
  return { added, updated };
}
// Where API rows exist for a channel and day, CSV rows for the same channel and day are ignored (no double count).
export function effectiveRows(rows) {
  const api = new Set(rows.filter((r) => r.source === "api").map((r) => `${r.channel}|${r.date}`));
  return rows.filter((r) => r.source === "api" || !api.has(`${r.channel}|${r.date}`));
}

// ---- metrics
export const resultOf = (r, type) => Number(r[type]) || 0;
export function metricsOf(list, type = "signups") {
  const m = { spend_sar: 0, impressions: 0, clicks: 0, reach: 0, results: 0, leads: 0, signups: 0, purchases: 0, days: new Set() };
  for (const r of list) {
    m.spend_sar += r.spend_sar || 0; m.impressions += r.impressions || 0; m.clicks += r.clicks || 0; m.reach += r.reach || 0;
    m.results += resultOf(r, type); m.leads += r.leads || 0; m.signups += r.signups || 0; m.purchases += r.purchases || 0; m.days.add(r.date);
  }
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return { spend_sar: r2(m.spend_sar), impressions: m.impressions, clicks: m.clicks, results: m.results, leads: m.leads, signups: m.signups, purchases: m.purchases, days: m.days.size,
    ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 1e5) / 1e5 : null,
    cpc: m.clicks ? r2(m.spend_sar / m.clicks) : null,
    cpm: m.impressions ? r2((m.spend_sar / m.impressions) * 1000) : null,
    cpa: m.results ? r2(m.spend_sar / m.results) : null,
    // Daily reach is summed, so this is a floor for the real frequency; fine for comparing two windows.
    frequency: m.reach ? Math.round((m.impressions / m.reach) * 100) / 100 : null };
}
const LEVEL_KEYS = {
  campaign: (r) => `${r.channel}|${r.campaign_id || r.campaign_name}`,
  adset: (r) => `${r.channel}|${r.adset_id || r.adset_name || r.campaign_id}`,
  ad: (r) => `${r.channel}|${r.ad_id || r.ad_name || r.adset_id || r.campaign_id}`,
};
export function aggregate(rows, level, type) {
  const groups = new Map();
  for (const r of rows) { const k = LEVEL_KEYS[level](r); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  return [...groups.entries()].map(([key, list]) => {
    const f = list[0];
    return { key, level, channel: f.channel, source: f.source, account_id: f.account_id || "", campaign_id: f.campaign_id, campaign_name: f.campaign_name, adset_id: level !== "campaign" ? f.adset_id : "", adset_name: level !== "campaign" ? f.adset_name : "",
      ad_id: level === "ad" ? f.ad_id : "", ad_name: level === "ad" ? f.ad_name : "", first: list.reduce((a, r) => (r.date < a ? r.date : a), f.date), last: list.reduce((a, r) => (r.date > a ? r.date : a), f.date), ...metricsOf(list, type) };
  }).sort((a, b) => (b.spend_sar || 0) - (a.spend_sar || 0));
}
// Daily series per channel for trend charts.
export function dailySeries(rows, from, to, type) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days.map((d) => {
    const list = rows.filter((r) => r.date === d);
    return { date: d, spend_sar: Math.round(list.reduce((a, r) => a + (r.spend_sar || 0), 0) * 100) / 100, results: list.reduce((a, r) => a + resultOf(r, type), 0),
      by: Object.fromEntries(CHANNEL_IDS.map((c) => [c, Math.round(list.filter((r) => r.channel === c).reduce((a, r) => a + (r.spend_sar || 0), 0) * 100) / 100])) };
  });
}

// ---- budgets and pacing
// day: days elapsed this month (may be fractional), days: days in the month.
export function pacing({ budget = 0, spent = 0, day, days, tolerance = 10 }) {
  const d = Math.max(0, Math.min(day, days)), tol = tolerance / 100;
  const projected = d > 0 ? Math.round((spent / d) * days * 100) / 100 : spent;
  const base = { budget: budget || 0, spent: Math.round(spent * 100) / 100, projected, day: Math.round(d * 10) / 10, days };
  if (!(budget > 0)) return { ...base, status: "no_budget", expected: null, daily_target: null, pct: null, projected_pct: null };
  const expected = Math.round(((budget * d) / days) * 100) / 100;
  const daysLeft = Math.max(0, days - d);
  const daily_target = daysLeft > 0 ? Math.round((Math.max(0, budget - spent) / daysLeft) * 100) / 100 : 0;
  const ratio = projected / budget;
  // Over can be called any day; under only after 3 days of data, so a slow first morning isn't an alarm.
  const status = spent >= budget || ratio > 1 + tol ? "over" : d >= 3 && ratio < 1 - tol ? "under" : "on_track";
  return { ...base, status, expected, daily_target, pct: Math.round((spent / budget) * 1000) / 10, projected_pct: Math.round(ratio * 1000) / 10 };
}
export function budgetPacing(rows, settings, now = new Date()) {
  const month = riyadhMonth(now), days = daysInMonth(month);
  const riyadhNow = new Date(now.getTime() + 3 * 3600e3);
  const day = (riyadhNow.getUTCDate() - 1) + (riyadhNow.getUTCHours() * 60 + riyadhNow.getUTCMinutes()) / 1440;
  const m = rows.filter((r) => r.date.startsWith(month) && r.spend_sar != null);
  const tol = settings.tolerance_pct;
  const channels = CHANNELS.map((c) => {
    const list = m.filter((r) => r.channel === c.id);
    return { channel: c.id, ...pacing({ budget: settings.budgets[c.id], spent: list.reduce((a, r) => a + r.spend_sar, 0), day, days, tolerance: tol }), results: list.reduce((a, r) => a + resultOf(r, settings.result), 0) };
  });
  const channelBudgets = CHANNEL_IDS.reduce((a, c) => a + (settings.budgets[c] || 0), 0);
  const totalBudget = settings.budgets.total > 0 ? settings.budgets.total : channelBudgets;
  const total = { channel: "Total", ...pacing({ budget: totalBudget, spent: m.reduce((a, r) => a + r.spend_sar, 0), day, days, tolerance: tol }), results: m.reduce((a, r) => a + resultOf(r, settings.result), 0) };
  return { month, channels, total, warnings: settings.budgets.total > 0 && channelBudgets > settings.budgets.total ? [`Channel budgets add up to SAR ${channelBudgets.toLocaleString("en-US")}, more than the SAR ${settings.budgets.total.toLocaleString("en-US")} total.`] : [] };
}

// ---- guardrail rules: evaluated after every insights pull or CSV import.
export const RULE_KINDS = {
  pause_cpa: { name: "Pause an ad set when cost per result is too high", hint: "After it has spent at least the minimum in the window. Leave the cost blank to pause only ad sets with no results at all." },
  cap_daily: { name: "Cap an ad set's daily spend", hint: "When an ad set spent more than the cap on its latest day, set its daily budget to the cap." },
};
// Starter rules. Only the "no results" rule is on; the others need a number from you first.
export const DEFAULT_RULES = [
  { name: "Pause ad sets with no results", kind: "pause_cpa", channel: "all", max_cpa_sar: null, min_spend_sar: 300, window_days: 7, enabled: true },
  { name: "Pause ad sets when cost per result is too high", kind: "pause_cpa", channel: "all", max_cpa_sar: null, min_spend_sar: null, window_days: 7, enabled: false },
  { name: "Cap each ad set's daily spend", kind: "cap_daily", channel: "all", cap_sar: null, enabled: false },
];
export function cleanRule(b = {}, cur = {}) {
  const o = {}, err = [];
  if (b.name !== undefined) o.name = str(b.name, 120);
  if (b.kind !== undefined) { if (!RULE_KINDS[b.kind]) err.push("Pick a rule type."); else o.kind = b.kind; }
  if (b.channel !== undefined) o.channel = b.channel === "all" || CHANNEL_IDS.includes(b.channel) ? b.channel : "all";
  for (const k of ["max_cpa_sar", "min_spend_sar", "cap_sar"]) if (b[k] !== undefined) { if (b[k] === null || b[k] === "") o[k] = null; else { const v = money(b[k]); if (v == null || v === 0) err.push(`${k.replace(/_sar$/, "").replace(/_/g, " ")} must be a positive amount in SAR`); else o[k] = v; } }
  if (b.window_days !== undefined) o.window_days = Math.max(1, Math.min(30, Math.round(Number(b.window_days) || 7)));
  if (b.enabled !== undefined) o.enabled = !!b.enabled;
  const next = { ...cur, ...o };
  if (next.enabled && next.kind === "cap_daily" && !next.cap_sar) err.push("Set the daily cap (SAR) before turning this rule on.");
  if (next.enabled && next.kind === "pause_cpa" && !next.min_spend_sar) err.push("Set the minimum spend (SAR) before turning this rule on.");
  if (!next.name) o.name = RULE_KINDS[next.kind]?.name || "Rule";
  return { o, err };
}
// Returns the actions the rules call for. decision: "logged" (Test mode: what it would do), "apply" (Live and
// the AI Budget pacer is at level 2) or "needs_person" (Live below level 2, or nothing to act on through the API).
// done(key) says whether this action was already taken or logged recently, so nothing repeats.
export function evaluateRules({ rules, rows, now = new Date(), mode = "test", level = 1, result = "signups", done = () => false }) {
  const today = riyadhDay(now), out = [];
  const decide = (canApi) => (mode !== "live" ? "logged" : canApi && level >= 2 ? "apply" : "needs_person");
  for (const rule of rules.filter((r) => r.enabled)) {
    const scoped = rows.filter((r) => r.spend_sar != null && (rule.channel === "all" || r.channel === rule.channel) && (r.adset_id || r.adset_name));
    if (rule.kind === "pause_cpa") {
      const from = addDays(today, -(rule.window_days || 7));
      for (const s of aggregate(scoped.filter((r) => r.date >= from && r.date <= today), "adset", result)) {
        if (!(s.spend_sar >= (rule.min_spend_sar || 0)) || !rule.min_spend_sar) continue;
        const hit = rule.max_cpa_sar ? (s.results === 0 || s.cpa > rule.max_cpa_sar) : s.results === 0;
        if (!hit) continue;
        const key = `${rule.id}|pause|${s.key}`;
        if (done(key, "pause")) continue;
        const canApi = s.source === "api" && !String(s.adset_id).startsWith("csv:");
        out.push({ key, rule_id: rule.id, rule_name: rule.name, kind: "pause", channel: s.channel, account_id: s.account_id, campaign_id: s.campaign_id, campaign_name: s.campaign_name, adset_id: s.adset_id, adset_name: s.adset_name,
          spend_sar: s.spend_sar, results: s.results, cpa_sar: s.cpa, value_sar: null, decision: decide(canApi), api: canApi,
          reason: s.results === 0 ? `Spent SAR ${s.spend_sar.toLocaleString("en-US")} in ${rule.window_days || 7} days with no ${result}.` : `Cost per ${result.replace(/s$/, "")} SAR ${s.cpa} is over SAR ${rule.max_cpa_sar} after SAR ${s.spend_sar.toLocaleString("en-US")} spent in ${rule.window_days || 7} days.` });
      }
    }
    if (rule.kind === "cap_daily" && rule.cap_sar) {
      const latest = scoped.reduce((a, r) => (r.date > a ? r.date : a), "");
      if (!latest) continue;
      for (const s of aggregate(scoped.filter((r) => r.date === latest), "adset", result)) {
        if (!(s.spend_sar > rule.cap_sar)) continue;
        const key = `${rule.id}|cap|${s.key}|${latest}`;
        if (done(key, "cap")) continue;
        const canApi = s.source === "api" && !String(s.adset_id).startsWith("csv:");
        out.push({ key, rule_id: rule.id, rule_name: rule.name, kind: "cap", channel: s.channel, account_id: s.account_id, campaign_id: s.campaign_id, campaign_name: s.campaign_name, adset_id: s.adset_id, adset_name: s.adset_name,
          spend_sar: s.spend_sar, results: s.results, cpa_sar: s.cpa, value_sar: rule.cap_sar, decision: decide(canApi), api: canApi, date: latest,
          reason: `Spent SAR ${s.spend_sar.toLocaleString("en-US")} on ${latest}, over the SAR ${rule.cap_sar} daily cap.` });
      }
    }
  }
  return out;
}

// ---- UTMs
export const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_\u0600-\u06ff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
export function buildUtmUrl(base, { source, medium, campaign, content = "", term = "" } = {}) {
  const b = String(base || "").trim();
  let u;
  try { u = new URL(b); } catch { return { error: "Type the full link, starting with https://" }; }
  if (!/^https?:$/.test(u.protocol)) return { error: "The link must start with https://" };
  const utm = { source: slug(source), medium: slug(medium), campaign: slug(campaign), content: slug(content), term: slug(term) };
  if (!utm.source) return { error: "Pick the source (the channel)." };
  if (!utm.campaign) return { error: "Name the campaign." };
  for (const k of ["source", "medium", "campaign", "content", "term"]) { u.searchParams.delete(`utm_${k}`); if (utm[k]) u.searchParams.set(`utm_${k}`, utm[k]); }
  return { url: u.toString(), utm: Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) };
}
export function parseUtm(url) {
  try {
    const u = new URL(String(url || "").trim());
    const o = {};
    for (const k of ["source", "medium", "campaign", "content", "term"]) { const v = u.searchParams.get(`utm_${k}`); if (v) o[k] = slug(v); }
    return o.source || o.campaign ? o : null;
  } catch { return null; }
}
export function cleanUtm(b = {}) {
  if (b.url) return parseUtm(b.url);
  const o = {};
  for (const k of ["source", "medium", "campaign", "content", "term"]) { const v = slug(b[k] ?? b[`utm_${k}`]); if (v) o[k] = v; }
  return o.source || o.campaign ? o : null;
}
export function channelFromSource(src) {
  const s = String(src || "").toLowerCase();
  if (/^(meta|facebook|fb|instagram|ig|messenger|an)$|facebook|instagram/.test(s)) return "Meta";
  if (/snap/.test(s)) return "Snapchat";
  if (/tiktok|tik-tok/.test(s)) return "TikTok";
  if (/google|adwords|youtube|gads/.test(s)) return "Google";
  return null;
}
export const utmForCampaign = (channel, campaignName, content = "") => {
  const c = channelOf(channel) || CHANNELS[0];
  return { source: c.utm_source, medium: c.utm_medium, campaign: slug(campaignName) || "campaign", ...(content ? { content: slug(content) } : {}) };
};

// ---- funnel attribution: CRM stores and Sales deals with a UTM, matched to channels and campaigns.
const TRIAL_DEAL = ["trial", "paying"], TRIAL_CONTACT = ["onboarding", "active", "churned"];
export const utmOf = (x) => (x?.utm && (x.utm.source || x.utm.campaign) ? x.utm : parseUtm(x?.landing_url || x?.source_url || ""));
export function attribution({ contacts = [], deals = [], rows = [], month = null, result = "signups" }) {
  const inPeriod = (iso) => !month || String(iso || "").startsWith(month);
  const people = [], linked = new Set();
  const dealById = new Map(deals.map((d) => [d.id, d]));
  for (const c of contacts) {
    const d = c.deal_id ? dealById.get(c.deal_id) : null;
    const utm = utmOf(c) || utmOf(d);
    if (!utm) continue;
    if (d) linked.add(d.id);
    people.push({ kind: "store", id: c.id, name: c.store_name, utm, created_at: c.created_at, trial: TRIAL_CONTACT.includes(c.stage) || TRIAL_DEAL.includes(d?.stage), paying: c.stage === "active" || d?.stage === "paying" });
  }
  for (const d of deals) {
    if (linked.has(d.id)) continue;
    const c = d.crm_contact_id ? contacts.find((x) => x.id === d.crm_contact_id) : null;
    if (c && utmOf(c)) continue; // already counted with its CRM store
    const utm = utmOf(d);
    if (!utm) continue;
    people.push({ kind: "deal", id: d.id, name: d.name, utm, created_at: d.created_at, trial: TRIAL_DEAL.includes(d.stage), paying: d.stage === "paying" });
  }
  const leads = people.filter((p) => inPeriod(p.created_at)).map((p) => ({ ...p, channel: channelFromSource(p.utm.source) }));
  const spendRows = rows.filter((r) => r.spend_sar != null && inPeriod(r.date));
  const per = (list, spend) => ({ leads: list.length, trials: list.filter((p) => p.trial).length, paying: list.filter((p) => p.paying).length, spend_sar: Math.round(spend * 100) / 100,
    cost_per_lead: list.length ? Math.round((spend / list.length) * 100) / 100 : null,
    cost_per_trial: list.filter((p) => p.trial).length ? Math.round((spend / list.filter((p) => p.trial).length) * 100) / 100 : null,
    cost_per_paying: list.filter((p) => p.paying).length ? Math.round((spend / list.filter((p) => p.paying).length) * 100) / 100 : null });
  const channels = CHANNEL_IDS.map((ch) => ({ channel: ch, ...per(leads.filter((p) => p.channel === ch), spendRows.filter((r) => r.channel === ch).reduce((a, r) => a + r.spend_sar, 0)),
    platform_results: spendRows.filter((r) => r.channel === ch).reduce((a, r) => a + resultOf(r, result), 0) }));
  // Campaigns: utm_campaign matched to the ad campaign whose name slugs to the same value.
  const campaigns = [];
  for (const c of aggregate(spendRows, "campaign", result)) {
    const s = slug(c.campaign_name), list = leads.filter((p) => p.channel === c.channel && p.utm.campaign && p.utm.campaign === s);
    campaigns.push({ channel: c.channel, campaign_name: c.campaign_name, utm_campaign: s, ...per(list, c.spend_sar || 0) });
  }
  const matched = new Set(campaigns.flatMap((c) => leads.filter((p) => p.channel === c.channel && p.utm.campaign === c.utm_campaign).map((p) => p.kind + p.id)));
  return { month, channels, campaigns, total: per(leads.filter((p) => p.channel), spendRows.reduce((a, r) => a + r.spend_sar, 0)),
    unmatched: leads.filter((p) => !p.channel || !matched.has(p.kind + p.id)).slice(0, 50).map((p) => ({ kind: p.kind, id: p.id, name: p.name, channel: p.channel, utm: p.utm })),
    leads: leads.slice(0, 200).map((p) => ({ kind: p.kind, id: p.id, name: p.name, channel: p.channel, campaign: p.utm.campaign || "", trial: p.trial, paying: p.paying, created_at: p.created_at })) };
}

// ---- Finance: ad spend as monthly "marketing" expenses per channel, source "ads", one per month and channel.
export function spendByMonthChannel(rows) {
  const out = {};
  for (const r of rows) if (r.spend_sar != null && r.spend_sar > 0) { const k = `${r.date.slice(0, 7)}|${r.channel}`; out[k] = Math.round(((out[k] || 0) + r.spend_sar) * 100) / 100; }
  return out;
}
export function syncFinance(store, wsId, rows) {
  const want = spendByMonthChannel(rows);
  const mine = store.listExpenses(wsId).filter((e) => e.source === "ads" && e.ads_key);
  const byKey = new Map(mine.map((e) => [e.ads_key, e]));
  let added = 0, updated = 0, removed = 0;
  for (const [k, amount] of Object.entries(want)) {
    const [month, channel] = k.split("|"), ads_key = `ads:${channel}:${month}`, cur = byKey.get(ads_key);
    const fields = { date: `${month}-01`, vendor: channelOf(channel)?.vendor || `${channel} Ads`, category: "marketing", amount_sar: amount, vat_sar: 0, recurring: "one-off",
      note: `Ad spend for ${month} from Paid Ads (updated automatically). VAT: see the platform invoice.`, source: "ads", ads_key, channel, reviewed: true };
    if (!cur) { store.addExpense(wsId, fields, false); added++; }
    else if (cur.amount_sar !== amount) { Object.assign(cur, fields); updated++; }
    byKey.delete(ads_key);
  }
  for (const e of byKey.values()) { store.db.finance_expenses = store.db.finance_expenses.filter((x) => x !== e); removed++; } // spend no longer there (import deleted)
  if (added || updated || removed) store.save();
  return { added, updated, removed };
}

// ---- creative rotation: rank ads and Creative Studio content by CTR and cost per result, flag fatigue.
// Ads made from a plan carry "[cs:<item id>]" in their name, so API and CSV rows both map back to Studio.
export const creativeTag = (id) => ` [cs:${id}]`;
export const creativeIdOf = (name) => /\[cs:(\d{1,12})\]/.exec(String(name || ""))?.[1] || null;
export function creativeReport({ rows, items = [], now = new Date(), result = "signups" }) {
  const today = riyadhDay(now), from30 = addDays(today, -30), from7 = addDays(today, -7), from14 = addDays(today, -14);
  const recent = rows.filter((r) => r.date >= from30 && r.spend_sar != null && (r.ad_id || r.ad_name));
  const ads = aggregate(recent, "ad", result).map((a) => {
    const mine = recent.filter((r) => LEVEL_KEYS.ad(r) === a.key);
    const now7 = metricsOf(mine.filter((r) => r.date > from7), result), prev7 = metricsOf(mine.filter((r) => r.date > from14 && r.date <= from7), result);
    const freqUp = now7.frequency != null && prev7.frequency != null && prev7.frequency > 0 ? (now7.frequency - prev7.frequency) / prev7.frequency : null;
    const ctrDown = now7.ctr != null && prev7.ctr ? (now7.ctr - prev7.ctr) / prev7.ctr : null;
    // Fatigue: the same people see it more often (frequency up 15%+) and click less (CTR down 15%+), with enough data both weeks.
    const fatigued = now7.impressions >= 1000 && prev7.impressions >= 1000 && freqUp != null && ctrDown != null && freqUp >= 0.15 && ctrDown <= -0.15;
    const item_id = creativeIdOf(a.ad_name);
    return { ...a, item_id, item_title: items.find((i) => i.id === item_id)?.title || null, ctr_7d: now7.ctr, ctr_prev_7d: prev7.ctr, freq_7d: now7.frequency, freq_prev_7d: prev7.frequency,
      freq_change: freqUp == null ? null : Math.round(freqUp * 1000) / 10, ctr_change: ctrDown == null ? null : Math.round(ctrDown * 1000) / 10, fatigued };
  });
  // Rank: cost per result first (lower is better; no results = worst), then CTR.
  const rank = (a, b) => (a.cpa == null) - (b.cpa == null) || (a.cpa ?? 0) - (b.cpa ?? 0) || (b.ctr || 0) - (a.ctr || 0);
  const ranked = ads.filter((a) => a.spend_sar > 0).sort(rank);
  const byItem = new Map();
  for (const a of ads.filter((x) => x.item_id)) (byItem.get(a.item_id) || byItem.set(a.item_id, []).get(a.item_id)).push(a);
  const studio = [...byItem.entries()].map(([id, list]) => ({ item_id: id, title: items.find((i) => i.id === id)?.title || `Studio item ${id}`, ads: list.length,
    ...metricsOf(recent.filter((r) => creativeIdOf(r.ad_name) === id), result), fatigued: list.some((a) => a.fatigued) })).sort(rank);
  return { ads: ranked, studio, fatigued: ads.filter((a) => a.fatigued), top: ranked.slice(0, 5), bottom: ranked.length > 5 ? ranked.slice(-5).reverse() : [], untagged: ads.filter((a) => !a.item_id).length };
}
// Rule-based suggestions (always there, AI or not): a fresh take on what's tiring or losing.
export function creativeSuggestions(report) {
  const out = [];
  for (const a of report.fatigued.slice(0, 5)) out.push({ key: `fatigue:${a.key}`, title: `Fresh take: ${a.item_title || a.ad_name}`.slice(0, 160), why: `Fatigue on ${a.channel}: frequency ${a.freq_change > 0 ? "+" : ""}${a.freq_change}% and CTR ${a.ctr_change}% week on week.`,
    brief: `New version of "${a.item_title || a.ad_name}" for ${a.channel}: same offer, a new hook in the first 2 seconds, a new first frame and new Arabic headline. Keep what made it work; change what people have seen too often.`, item_id: a.item_id });
  for (const a of report.bottom.slice(0, 3)) if (!out.some((x) => x.key === `fatigue:${a.key}`)) out.push({ key: `bottom:${a.key}`, title: `Replace: ${a.item_title || a.ad_name}`.slice(0, 160),
    why: a.cpa == null ? `No ${"results"} after SAR ${a.spend_sar} on ${a.channel}.` : `Among the most expensive ads: SAR ${a.cpa} per result on ${a.channel}.`,
    brief: `A different angle than "${a.item_title || a.ad_name}" for ${a.channel}: test a before/after of a Salla product ad (plain vs designed), or a founder-led reel. Arabic first, Saudi dialect.`, item_id: a.item_id });
  if (report.top[0]) out.push({ key: `winner:${report.top[0].key}`, title: `More like the winner: ${report.top[0].item_title || report.top[0].ad_name}`.slice(0, 160),
    why: `Best cost per result in the last 30 days${report.top[0].cpa != null ? ` (SAR ${report.top[0].cpa})` : ""}.`, brief: `Two variations of "${report.top[0].item_title || report.top[0].ad_name}": same structure, new product category and a new hook.`, item_id: report.top[0].item_id });
  return out;
}
export function rotatorPrompt(ws, report) {
  const lines = report.ads.slice(0, 20).map((a) => `- ${a.channel} · "${a.ad_name}"${a.item_title ? ` (Studio: ${a.item_title})` : ""}: spend SAR ${a.spend_sar}, CTR ${a.ctr == null ? "n/a" : (a.ctr * 100).toFixed(2) + "%"}, cost per result ${a.cpa == null ? "no results" : "SAR " + a.cpa}${a.fatigued ? ", FATIGUED" : ""}`).join("\n");
  return `You are DPA AD's AI Creative rotator. DPA AD (${ws.brief.company_name}) sells designed catalog ads to Saudi Salla/Zid stores. These are DPA AD's OWN ads, aimed at store owners and marketers.
<ads last_30_days="true">
${lines || "(no ad data yet)"}
</ads>
Suggest up to 4 new Creative Studio content ideas to replace fatigued or losing ads and build on winners. Arabic-first (Saudi dialect) ideas; titles in English or Arabic.
Never invent numbers, results, customers or quotes: use [ADD] where a real number or quote belongs.
Return ONLY JSON: {"ideas":[{"title":"...","brief":"what to make and why, 1-3 sentences","why":"which ad data it answers"}]}`;
}
export function parseIdeas(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  try { const j = JSON.parse(m[0]); return (j.ideas || []).slice(0, 6).map((x, i) => ({ key: `ai:${Date.now()}:${i}`, title: str(x.title, 160), brief: str(x.brief, 1000), why: str(x.why, 300) })).filter((x) => x.title); } catch { return []; }
}

// ---- campaign planner (AI Media buyer). The AI drafts; a person approves; it's created PAUSED.
export const OBJECTIVES = ["signups", "leads", "purchases", "traffic"];
export const CTAS = ["SIGN_UP", "LEARN_MORE", "GET_STARTED", "CONTACT_US", "BOOK_NOW"];
export function approvedCreatives(store, wsId, mediaUrl = () => null) {
  return store.listOps("creative_items", wsId).filter((i) => ["approved", "scheduled", "published"].includes(i.status)).map((i) => {
    const v = Object.values(i.variants || {});
    const mediaIds = [...new Set(v.flatMap((x) => [...(x.media || []), x.cover_id].filter(Boolean)))];
    const media = mediaIds.map((id) => store.getOps("creative_media", wsId, id)).filter(Boolean);
    const caption = v.map((x) => x.caption_ar).find(Boolean) || v.map((x) => x.caption_en).find(Boolean) || "";
    return { id: i.id, title: i.title, status: i.status, pillar: i.pillar, channels: i.channels || [], caption_ar: String(caption).slice(0, 400),
      media: media.map((m) => ({ id: m.id, kind: m.kind, name: m.name, url: mediaUrl(m) })), image_url: media.filter((m) => m.kind === "image").map((m) => mediaUrl(m)).find(Boolean) || null };
  });
}
export function planPrompt(ws, { goal, budget_sar, channels, start_date, end_date, result, creatives, paying_stores, seasons, crm_categories }) {
  return `You are DPA AD's AI Media buyer. Draft a paid campaign plan for DPA AD's OWN ads (not a customer's).
<company>${ws.brief.company_name}: ${ws.brief.one_liner || "turns Salla/Zid catalogs into designed image and video ads for Meta, Snap, TikTok and Google"}. Arabic-first, Saudi market, pre-launch.</company>
<goal>${goal}</goal>
<budget_sar>${budget_sar} for ${start_date} to ${end_date}</budget_sar>
<channels>${channels.join(", ")}</channels>
<conversion>${result}</conversion>
<audience_facts>Target: Saudi ecommerce store owners and marketers on Salla and Zid. CRM categories: ${crm_categories.join(", ") || "unknown"}. Paying stores in the CRM (lookalike source): ${paying_stores}${paying_stores < 100 ? " (under 100: too few for a lookalike source; say so)" : ""}.</audience_facts>
<seasons>${seasons.map((s) => `${s.name} on ${s.date}${s.approx ? " (approx)" : ""}`).join("; ") || "none in this window"}</seasons>
<approved_creatives>
${creatives.map((c) => `- id ${c.id}: "${c.title}" (${c.channels.join(", ")}; ${c.media.length} media${c.image_url ? ", has image" : ""}) ${c.caption_ar ? `caption: ${c.caption_ar.replace(/\s+/g, " ").slice(0, 160)}` : ""}`).join("\n") || "(none approved yet: leave creative_item_id empty and say which content Creative Studio should make)"}
</approved_creatives>
Rules: never invent numbers, results, customers or quotes (use [ADD]). Split the budget only as percentages of the given budget. Schedule in Saudi time (UTC+3); avoid Friday prayer hours; if Ramadan falls in the window, shift delivery to after Iftar until Suhoor. Interests and job titles only where the platform allows them. Arabic primary text and headlines in Saudi dialect, max 125 characters primary text, 40 characters headline. Use only creative ids from approved_creatives.
Return ONLY JSON:
{"name":"...","summary":"2-3 sentences","campaigns":[{"channel":"Meta|Snapchat|TikTok|Google","name":"...","objective":"signups|leads|purchases|traffic","budget_pct":60,
"schedule":{"days":"...","hours":"...","ramadan":"..."},"placements":["..."],
"ad_sets":[{"name":"...","budget_pct":50,"audience":{"summary":"...","cities":["Riyadh"],"age_min":21,"age_max":55,"interests":["..."],"job_titles":["..."],"lookalike":false}}],
"ads":[{"name":"...","creative_item_id":"","adset_index":0,"primary_text_ar":"...","headline_ar":"...","cta":"SIGN_UP"}]}]}`;
}
// Clean an AI (or edited) plan. Budgets are always derived from the person's budget and the percentages.
export function cleanPlan(raw = {}, { budget_sar, channels, start_date, end_date, landing_url, creatives = [], result = "signups" }) {
  const days = Math.max(1, Math.round((Date.parse(end_date) - Date.parse(start_date)) / 864e5) + 1);
  const ids = new Set(creatives.map((c) => c.id));
  const camps0 = (Array.isArray(raw.campaigns) ? raw.campaigns : []).filter((c) => channels.includes(c.channel)).slice(0, 4);
  const pctSum = camps0.reduce((a, c) => a + Math.max(0, Number(c.budget_pct) || 0), 0);
  const campaigns = camps0.map((c) => {
    const share = pctSum > 0 ? Math.max(0, Number(c.budget_pct) || 0) / pctSum : 1 / camps0.length;
    const cBudget = Math.round(budget_sar * share * 100) / 100;
    const name = str(c.name, 120) || `DPA AD · ${c.channel} · ${start_date.slice(0, 7)}`;
    const sets0 = (Array.isArray(c.ad_sets) ? c.ad_sets : []).slice(0, 6);
    const sSum = sets0.reduce((a, s) => a + Math.max(0, Number(s.budget_pct) || 0), 0);
    const ad_sets = (sets0.length ? sets0 : [{ name: "Saudi store owners", audience: {} }]).map((s, i, arr) => {
      const sh = sSum > 0 ? Math.max(0, Number(s.budget_pct) || 0) / sSum : 1 / arr.length;
      const a = s.audience || {};
      return { name: str(s.name, 120) || `Ad set ${i + 1}`, budget_pct: Math.round(sh * 1000) / 10, daily_budget_sar: Math.round(((cBudget * sh) / days) * 100) / 100,
        placements: (Array.isArray(s.placements) ? s.placements : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 8),
        audience: { summary: str(a.summary, 400), cities: (a.cities || []).map((x) => str(x, 40)).filter(Boolean).slice(0, 10), age_min: Math.max(18, Math.min(65, Number(a.age_min) || 21)), age_max: Math.max(18, Math.min(65, Number(a.age_max) || 55)),
          interests: (a.interests || []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12), job_titles: (a.job_titles || []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12), lookalike: !!a.lookalike } };
    });
    const utm = utmForCampaign(c.channel, name);
    const ads = (Array.isArray(c.ads) ? c.ads : []).slice(0, 10).map((a, i) => {
      const item = ids.has(String(a.creative_item_id || "")) ? String(a.creative_item_id) : "";
      const adName = (str(a.name, 100) || `Ad ${i + 1}`).replace(/\s*\[cs:\d+\]/g, "") + (item ? creativeTag(item) : "");
      const link = buildUtmUrl(landing_url, { ...utm, content: str(a.name, 60) || `ad-${i + 1}` }).url || landing_url;
      return { name: adName, creative_item_id: item, adset_index: Math.max(0, Math.min(ad_sets.length - 1, Number(a.adset_index) || 0)), primary_text_ar: str(a.primary_text_ar, 500), headline_ar: str(a.headline_ar, 80),
        cta: CTAS.includes(a.cta) ? a.cta : "SIGN_UP", link };
    });
    return { channel: c.channel, name, objective: OBJECTIVES.includes(c.objective) ? c.objective : result, budget_sar: cBudget, budget_pct: Math.round(share * 1000) / 10,
      start_date, end_date, schedule: { days: str(c.schedule?.days, 200), hours: str(c.schedule?.hours, 200), ramadan: str(c.schedule?.ramadan, 300) },
      placements: (Array.isArray(c.placements) ? c.placements : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 10), ad_sets, ads, utm };
  });
  return { name: str(raw.name, 160) || `DPA AD · ${start_date.slice(0, 7)}`, summary: str(raw.summary, 1500), campaigns };
}
// When the AI isn't available or returns no usable plan: a starter structure from the person's own inputs.
export function skeletonPlan({ channels, creatives = [], paying_stores = 0, result = "signups", hasRamadan = false }) {
  return {
    name: "", summary: "Starter structure (the AI didn't return a plan). Fill in the [ADD] parts before approving.",
    campaigns: channels.map((ch) => ({ channel: ch, budget_pct: 1, objective: result, name: "",
      schedule: { days: "Every day except Friday before 13:00", hours: "Saudi time, evenings strongest", ramadan: hasRamadan ? "Ramadan in this window: shift delivery to after Iftar until Suhoor." : "" },
      placements: ch === "Meta" ? ["Instagram Feed", "Instagram Reels", "Instagram Stories", "Facebook Feed"] : [],
      ad_sets: [{ name: "Salla/Zid store owners", budget_pct: 1, audience: { summary: "Saudi store owners and ecommerce marketers", interests: ["Salla", "Zid", "E-commerce", "Online shopping"], job_titles: ch === "Meta" ? ["Business Owner", "Marketing Manager"] : [] } },
        ...(paying_stores >= 100 ? [{ name: "Lookalike of paying stores", budget_pct: 1, audience: { summary: `Lookalike from ${paying_stores} paying stores in the CRM (build the source list in Ads Manager)`, lookalike: true } }] : [])],
      ads: (creatives.length ? creatives.slice(0, 3) : [null]).map((c, i) => ({ name: c ? c.title : `Ad ${i + 1}`, creative_item_id: c?.id || "", adset_index: 0, primary_text_ar: "[ADD]", headline_ar: "[ADD]", cta: "SIGN_UP" })) })),
  };
}
export function parsePlanJson(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return Array.isArray(j.campaigns) && j.campaigns.length ? j : null; } catch { return null; }
}
// Did the person change the AI's plan before approving? (Outcome for the AI Workforce track record.)
const planShape = (p) => JSON.stringify((p.campaigns || []).map((c) => [c.channel, c.name, c.budget_sar, c.objective, c.ad_sets.map((s) => [s.name, s.budget_pct, s.audience]), c.ads.map((a) => [a.name, a.creative_item_id, a.primary_text_ar, a.headline_ar, a.cta])]));
export const planEdited = (plan) => !!plan.ai_shape && plan.ai_shape !== planShape(plan);
export { planShape };
export function plannerContext(store, w, { channels, start_date, end_date, mediaUrl, crm }) {
  const creatives = approvedCreatives(store, w.id, mediaUrl);
  const contacts = crm ? crm.contacts(w.id) : [];
  const paying = contacts.filter((c) => c.stage === "active").length + store.listDeals(w.id).filter((d) => d.stage === "paying" && !contacts.some((c) => c.deal_id === d.id && c.stage === "active")).length;
  const cats = [...new Set(contacts.map((c) => c.category).filter((x) => x && x !== "Other"))].slice(0, 12);
  const seasons = seasonsBetween(start_date, end_date);
  return { creatives, paying_stores: paying, crm_categories: cats, seasons, hasRamadan: seasons.some((s) => /Ramadan/.test(s.name)), channels };
}

// ---- Command Center: over-pace budgets, guardrail actions, plans waiting for approval.
export function adsCommand(store, w, now = new Date()) {
  ensureAdsCollections(store);
  const s = adsSettings(w);
  const rows = withSar(effectiveRows(store.listOps(COLL.rows, w.id)), s);
  const pace = budgetPacing(rows, s, now);
  const actions = store.listOps(COLL.actions, w.id);
  const plans = store.listOps(COLL.plans, w.id);
  const needs = [
    ...[...pace.channels, pace.total].filter((c) => c.status === "over").map((c) => ({ module: "Paid Ads", route: "ads", param: "budgets", title: `${c.channel} ad budget`, text: `Over pace: SAR ${Math.round(c.spent).toLocaleString("en-US")} of SAR ${Math.round(c.budget).toLocaleString("en-US")} spent, heading for SAR ${Math.round(c.projected).toLocaleString("en-US")} this month.` })),
    ...actions.filter((a) => a.status === "open").slice(-5).map((a) => ({ module: "Paid Ads", route: "ads", param: "budgets", title: a.adset_name || a.campaign_name || "Ad set", text: `Guardrail: ${a.kind === "pause" ? "pause" : "cap"} suggested (${a.reason}) — needs a person.` })),
    ...plans.filter((p) => p.status === "draft").slice(0, 3).map((p) => ({ module: "Paid Ads", route: "ads", param: "campaigns", title: p.name || "Campaign plan", text: "Campaign plan waiting for approval." })),
  ];
  const feed = actions.filter((a) => a.status === "done").slice(-5).map((a) => ({ at: a.at, module: "Paid Ads", by: a.by === "ai" ? "ai" : "you", text: `${a.kind === "pause" ? "Paused" : "Capped"} ${a.adset_name || "an ad set"} on ${a.channel}`, route: "ads" }));
  return { needs, feed, summary: { mode: s.mode, month_spend_sar: pace.total.spent, budget_sar: pace.total.budget, status: pace.total.status, open_actions: actions.filter((a) => a.status === "open").length, plans_waiting: plans.filter((p) => p.status === "draft").length } };
}
