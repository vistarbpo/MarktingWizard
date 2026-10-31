// ROAS reporting: proves (or disproves) that DPA AD's designed catalog creatives sell more than
// plain packshots. Reads ad-level CSV exports from Meta, Snap and TikTok Ads Manager, groups ads by
// template and creative type, and compares designed vs plain with a confidence check.
import { BRIEF_FIELDS } from "./catalog.js";
import { periodFor } from "./sop.js";

export const CREATIVE_TYPES = ["designed", "video", "plain"];
export const CHANNELS = ["Meta", "Snapchat", "TikTok", "Google", "Other"];

// ---- CSV
function splitCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0];
  const delim = [",", ";", "\t"].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const parse = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  return lines.map(parse);
}

const num = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[^\d.,-]/g, "");
  // "1,234.56" or "1.234,56" or "1234,56"
  const n = /,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const f = parseFloat(n);
  return Number.isFinite(f) ? f : 0;
};

// Column finders: the first header that matches wins. Value columns are checked before count columns.
const COLS = {
  revenue: [/purchases? conversion value/, /conversion value/, /purchase value/, /total complete payment value/, /complete payment value/, /revenue/, /sales value/],
  purchases: [/^purchases?$/, /^website purchases$/, /purchases \(all\)/, /complete payment$/, /^conversions$/, /^purchase$/, /^results$/],
  spend: [/amount spent/, /^spend/, /^cost$/, /total cost/],
  impressions: [/^impressions/, /^impr/],
  clicks: [/link clicks/, /^clicks/, /swipe ups?/, /^swipes/],
  ad: [/^ad name$/, /^ad$/, /^ad_name$/, /creative name/, /^ad name/],
  date: [/^day$/, /^date$/, /reporting starts/, /reporting_start/, /stat_time_day/, /^start time/],
};

export function parseAdsCsv(text, { currency = "SAR", channel = "" } = {}) {
  const rows = splitCsv(text);
  if (rows.length < 2) return { error: "Paste the CSV with its header row and at least one ad." };
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = {};
  for (const [k, pats] of Object.entries(COLS)) {
    for (const p of pats) { const i = header.findIndex((h, j) => p.test(h) && !Object.values(idx).includes(j)); if (i >= 0) { idx[k] = i; break; } }
  }
  const missing = ["ad", "spend", "revenue"].filter((k) => idx[k] == null);
  if (missing.length) return { error: `Couldn't find these columns: ${missing.map((m) => ({ ad: "Ad name", spend: "Amount spent", revenue: "Purchase conversion value" }[m])).join(", ")}. Export at ad level with those columns.` };
  const guess = channel || (header.some((h) => /swipe/.test(h)) ? "Snapchat" : header.some((h) => /complete payment/.test(h)) ? "TikTok" : header.some((h) => /amount spent/.test(h)) ? "Meta" : "Other");
  const fx = currency === "USD" ? 3.75 : 1;
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const r of rows.slice(1)) {
    const ad = r[idx.ad];
    if (!ad || /^total/i.test(ad)) continue;
    const date = idx.date != null && /^\d{4}-\d{2}-\d{2}/.test(r[idx.date] || "") ? r[idx.date].slice(0, 10) : today;
    out.push({
      ad_name: ad.slice(0, 200), date,
      spend_sar: Math.round(num(r[idx.spend]) * fx * 100) / 100,
      revenue_sar: Math.round(num(r[idx.revenue]) * fx * 100) / 100,
      impressions: Math.round(num(r[idx.impressions])), clicks: Math.round(num(r[idx.clicks])),
      purchases: Math.round(num(r[idx.purchases])),
    });
  }
  if (!out.length) return { error: "No ad rows found under the header." };
  return { channel: CHANNELS.includes(guess) ? guess : "Other", rows: out, found: Object.keys(idx) };
}

// Template and creative type from the ad name. Tag ads like "Abaya | [tpl:Ramadan Gold] | video"
// for exact results; otherwise this is a best guess the person can correct before saving.
export function classifyAd(name) {
  const n = String(name || "");
  const tag = /\[tpl:\s*([^\]]+)\]/i.exec(n) || /tpl:\s*([^|]+)/i.exec(n);
  const lower = n.toLowerCase();
  const type = /plain|packshot|default|original|white ?bg|catalog default/.test(lower) ? "plain" : /video|reel|story|slideshow/.test(lower) ? "video" : "designed";
  let template = tag ? tag[1].trim() : "";
  if (!template) {
    const parts = n.split(/[|\-–_/]+/).map((x) => x.trim()).filter(Boolean);
    template = type === "plain" ? "Plain packshot" : (parts.find((p) => /template|tpl|design|frame|price|sale|offer|ramadan|friday|national/i.test(p)) || parts[1] || parts[0] || "Untitled");
  }
  return { template: template.slice(0, 80), creative_type: type };
}

// ---- Stats
const agg = (rows) => {
  const a = rows.reduce((s, r) => ({ spend: s.spend + r.spend_sar, revenue: s.revenue + r.revenue_sar, impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, purchases: s.purchases + r.purchases }), { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 });
  return { ...a, roas: a.spend ? a.revenue / a.spend : null, ctr: a.impressions ? a.clicks / a.impressions : null, cvr: a.clicks ? a.purchases / a.clicks : null, cpa: a.purchases ? a.spend / a.purchases : null };
};
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const clean = (a) => ({ spend: Math.round(a.spend), revenue: Math.round(a.revenue), impressions: a.impressions, clicks: a.clicks, purchases: a.purchases, roas: round(a.roas), ctr: round(a.ctr, 4), cvr: round(a.cvr, 4), cpa: round(a.cpa) });

// Two-proportion z-test on conversion rate (purchases per click), designed vs plain.
export function zTest(p1x, n1, p2x, n2) {
  if (!n1 || !n2) return null;
  const p1 = p1x / n1, p2 = p2x / n2, p = (p1x + p2x) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  const z = (p1 - p2) / se;
  // two-sided p-value via the normal CDF (Abramowitz-Stegun approximation)
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return { z: round(z, 2), p: round(2 * tail, 4) };
}

function lift(designedRows, plainRows) {
  const d = agg(designedRows), p = agg(plainRows);
  const test = zTest(d.purchases, d.clicks, p.purchases, p.clicks);
  const roasLift = d.roas != null && p.roas ? d.roas / p.roas - 1 : null;
  const enough = d.purchases >= 30 && p.purchases >= 30;
  const verdict = roasLift == null ? "not enough data" : !enough ? "too few purchases to be sure" : test && test.p < 0.05 ? (roasLift > 0 ? "designed wins" : "plain wins") : "no clear difference yet";
  return { designed: clean(d), plain: clean(p), roas_lift: round(roasLift, 3), cvr_lift: d.cvr != null && p.cvr ? round(d.cvr / p.cvr - 1, 3) : null, test, enough, verdict };
}

export function roasSummary(rows, now = new Date()) {
  const isDesigned = (r) => r.creative_type !== "plain";
  const groupBy = (key) => {
    const m = new Map();
    for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };
  const templates = [...groupBy((r) => `${r.creative_type}|${r.template}`)].map(([k, rs]) => {
    const [type, template] = k.split("|");
    return { template, creative_type: type, stores: new Set(rs.map((r) => r.store)).size, ...clean(agg(rs)) };
  }).sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
  const stores = [...groupBy((r) => r.store)].map(([store, rs]) => ({ store, deal_id: rs[0].deal_id || null, channels: [...new Set(rs.map((r) => r.channel))], sample: rs.every((r) => r.sample), ...lift(rs.filter(isDesigned), rs.filter((r) => !isDesigned(r))) }))
    .sort((a, b) => (b.designed.spend + b.plain.spend) - (a.designed.spend + a.plain.spend));
  const weeks = [...groupBy((r) => periodFor("weekly", new Date(r.date + "T00:00:00Z")))].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([week, rs]) => ({ week, designed: round(agg(rs.filter(isDesigned)).roas), plain: round(agg(rs.filter((r) => !isDesigned(r))).roas) }));
  const channels = [...groupBy((r) => r.channel)].map(([channel, rs]) => ({ channel, ...lift(rs.filter(isDesigned), rs.filter((r) => !isDesigned(r))) }));
  return { totals: clean(agg(rows)), overall: lift(rows.filter(isDesigned), rows.filter((r) => !isDesigned(r))), templates, stores, weeks, channels, rows: rows.length };
}

export function caseStudyPrompt(ws, store, s) {
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");
  return `<company>\n${brief}\n</company>
<results store="${store.store}" channels="${store.channels.join(", ")}">
Designed creatives (DPA AD): spend SAR ${store.designed.spend}, revenue SAR ${store.designed.revenue}, ROAS ${store.designed.roas}, CTR ${store.designed.ctr}, conversion ${store.designed.cvr}, purchases ${store.designed.purchases}
Plain packshots: spend SAR ${store.plain.spend}, revenue SAR ${store.plain.revenue}, ROAS ${store.plain.roas}, CTR ${store.plain.ctr}, conversion ${store.plain.cvr}, purchases ${store.plain.purchases}
ROAS lift: ${store.roas_lift == null ? "n/a" : Math.round(store.roas_lift * 100) + "%"} · statistical check: ${store.verdict}${store.test ? ` (p=${store.test.p})` : ""}
Best templates overall: ${s.templates.filter((t) => t.creative_type !== "plain").slice(0, 3).map((t) => `${t.template} ROAS ${t.roas}`).join("; ")}
</results>
Write a short customer case study for sales and the website: ## Headline (one result with the number), ## The store, ## What they ran (designed vs plain catalog ads), ## Results (a small table), ## What it means for similar stores, then the same case study in Arabic under "## بالعربية". Use only these numbers. If the verdict is not "designed wins", say honestly that results are early and don't claim a win. Leave [ADD QUOTE FROM STORE OWNER] where a quote belongs; never invent a quote. Markdown, no preamble.`;
}
