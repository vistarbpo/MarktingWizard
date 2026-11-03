// Market Intelligence (module "intel"): competitors with a change log and an optional weekly watch of their public
// pricing/landing page, a feed of market signals (typed in or imported from Sales, Support, Product and Store CRM),
// win/loss from Sales deals, a TAM/SAM/SOM calculator whose every input a person types (with a source), and an
// AI-drafted weekly market brief that only summarizes what is in the data, cites each item and uses [ADD] for gaps.
// Competitor pages are fetched ONLY through products.js `safeGet` (public addresses, 8 s, ~2 MB, 2 at a time).
import crypto from "node:crypto";
import { FETCH_LIMITS, FetchRefused, safeGet } from "./products.js";
import { PLANS, STATUS_QUO } from "./sales.js";

export const COLL = { competitors: "intel_competitors", changes: "intel_changes", signals: "intel_signals", briefs: "intel_briefs" };
export function ensureIntel(store) { for (const c of Object.values(COLL)) store.db[c] ||= []; }
export const AGENT_ID = "market_analyst";

export const SIGNAL_TYPES = [
  { id: "competitor_move", name: "Competitor move" },
  { id: "platform_change", name: "Platform change" },
  { id: "regulation", name: "Regulation" },
  { id: "customer_request", name: "Customer request" },
  { id: "win_loss", name: "Win/loss reason" },
  { id: "trend", name: "Trend" },
];
export const SIGNAL_TYPE_IDS = SIGNAL_TYPES.map((t) => t.id);
export const SIGNAL_PLATFORMS = ["Meta", "Snap", "TikTok", "Google", "Salla", "Zid"];
export const IMPACTS = ["low", "med", "high"];
// Modules a signal can be linked to (where someone should act on it).
export const LINK_MODULES = [["", "None"], ["sales", "Sales"], ["product", "Product"], ["crm", "Store CRM"], ["creative", "Creative Studio"], ["ads", "Paid Ads"], ["marketing", "Marketing"], ["support", "Support"], ["success", "Customer success"], ["finance", "Finance"], ["compliance", "Compliance"]];
export const SEGMENTS = ["Catalog ad creatives (DPA)", "AI ad generator", "Design tool (DIY)", "Design agency / freelancers", "Platform-native tool", "Other"];
export const COMPETITOR_PLATFORMS = ["Meta", "Snap", "TikTok", "Google", "Pinterest", "Salla", "Zid", "Shopify", "WooCommerce", "Custom feed"];
export const IMPORT_SOURCES = [
  { id: "deals", name: "Sales: lost deals with a reason" },
  { id: "tickets", name: "Support: tickets tagged feature-request" },
  { id: "feedback", name: "Product: feedback" },
  { id: "crm", name: "Store CRM: reply triage labels (question, not now, not interested)" },
];
export const WATCH_DAYS = 7; // a watched page is fetched at most once a week
export const ARR_GOAL_USD = 100_000_000;
const DAY = 864e5;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));
export const todayOf = (now = Date.now()) => new Date(+new Date(now) + 3 * 3600e3).toISOString().slice(0, 10); // Riyadh day (UTC+3)
export function cleanUrl(v) {
  let s = str(v, 500);
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
const slug = (v) => str(v, 40).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
export const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map(slug).filter(Boolean))].slice(0, 10);

// ---- competitors -------------------------------------------------------------------------------------------
const COMP_TEXT = { name: 120, segment: 80, positioning: 1500, strengths: 1500, weaknesses: 1500, notes: 3000, pricing_notes: 1000 };
export function cleanCompetitor(b = {}, partial = false) {
  const out = {}, err = [];
  for (const [k, max] of Object.entries(COMP_TEXT)) if (b[k] !== undefined) out[k] = str(b[k], max);
  if (b.site !== undefined) { const u = cleanUrl(b.site); if (u === null) err.push("site must be a web link"); else out.site = u; }
  if (b.platforms !== undefined) out.platforms = [...new Set((Array.isArray(b.platforms) ? b.platforms : []).map((p) => str(p, 40)).filter(Boolean))].slice(0, 20);
  // Pricing tiers exactly as a person read them on the competitor's site: text, never computed.
  if (b.pricing !== undefined) out.pricing = (Array.isArray(b.pricing) ? b.pricing : []).map((t) => ({ tier: str(t?.tier, 80), price: str(t?.price, 80), notes: str(t?.notes, 300) })).filter((t) => t.tier || t.price).slice(0, 12);
  if (b.pricing_source_url !== undefined) { const u = cleanUrl(b.pricing_source_url); if (u === null) err.push("pricing source must be a web link"); else out.pricing_source_url = u; }
  for (const k of ["pricing_checked_on", "last_checked"]) if (b[k] !== undefined) { if (b[k] && !isoDate(b[k])) err.push(`${k} must be YYYY-MM-DD`); else out[k] = b[k] || ""; }
  if (b.pricing?.length && !(out.pricing_source_url ?? b._current?.pricing_source_url)) err.push("Add the source link for the pricing (where a person read it)");
  if (b.watch_url !== undefined) { const u = cleanUrl(b.watch_url); if (u === null) err.push("watched page must be a web link"); else out.watch_url = u; }
  if (b.watch_enabled !== undefined) out.watch_enabled = !!b.watch_enabled;
  if (!partial && !out.name) err.push("name is required");
  if (partial && b.name !== undefined && !out.name) err.push("name cannot be empty");
  return { out, err };
}
const FIELD_LABEL = { name: "Name", site: "Site", segment: "Segment", platforms: "Platforms", pricing: "Pricing", pricing_source_url: "Pricing source", pricing_checked_on: "Pricing checked on",
  pricing_notes: "Pricing notes", positioning: "Positioning", strengths: "Strengths", weaknesses: "Weaknesses", last_checked: "Last checked", notes: "Notes", watch_url: "Watched page", watch_enabled: "Watch" };
const show = (k, v) => {
  if (k === "pricing") return (v || []).map((t) => `${t.tier || "?"} ${t.price || ""}`.trim()).join(", ") || "none";
  if (Array.isArray(v)) return v.join(", ") || "none";
  if (typeof v === "boolean") return v ? "on" : "off";
  const s = String(v ?? ""); return s ? (s.length > 80 ? s.slice(0, 80) + "…" : s) : "empty";
};
// One line per changed field for the change log.
export function changeLines(before, after) {
  return Object.keys(after).filter((k) => FIELD_LABEL[k] && JSON.stringify(before[k] ?? (Array.isArray(after[k]) ? [] : "")) !== JSON.stringify(after[k])).map((k) => `${FIELD_LABEL[k]}: ${show(k, before[k])} → ${show(k, after[k])}`);
}

// ---- page watch: text, hash, diff ----------------------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function pageLines(html) {
  const s = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|br|tr|td|th|section|article|header|footer|main|aside|nav|table|dt|dd|button|label|option|form)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
  const out = [], seen = new Set();
  for (const raw of s.split("\n")) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (l.length < 2 || seen.has(l)) continue;
    seen.add(l); out.push(l.slice(0, 400));
    if (out.length >= 1500) break;
  }
  return out;
}
export const hashLines = (lines) => crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
export const SNAPSHOT_CHARS = 8000;
export const snapshotOf = (lines) => { let n = 0; const keep = []; for (const l of lines) { if (n + l.length + 1 > SNAPSHOT_CHARS) break; keep.push(l); n += l.length + 1; } return keep.join("\n"); };
const PRICE_RE = /(?:\$|US\$|USD|SAR|SR|ر\.?\s?س|﷼)\s?\d[\d,.]*(?:\s?\/\s?\S+)?|\d[\d,.]*\s?(?:\$|USD|SAR|SR|ر\.?\s?س\.?|ريال|﷼)(?:\s?\/\s?\S+)?/gi;
export const pricesIn = (lines) => [...new Set(lines.join("\n").match(PRICE_RE) || [])].map((p) => p.replace(/\s+/g, " ").trim()).slice(0, 30);
// What changed between the stored snapshot and the new page: lines added and removed, and the prices on each side.
export function diffSummary(oldLines, newLines) {
  const a = new Set(oldLines), b = new Set(newLines);
  const added = newLines.filter((l) => !a.has(l)), removed = oldLines.filter((l) => !b.has(l));
  const pOld = pricesIn(oldLines), pNew = pricesIn(newLines);
  const priceChanged = JSON.stringify([...pOld].sort()) !== JSON.stringify([...pNew].sort());
  const parts = [`${added.length} line${added.length === 1 ? "" : "s"} added, ${removed.length} removed`];
  if (priceChanged) parts.push(`prices on the page now: ${pNew.join(", ") || "none"} (before: ${pOld.join(", ") || "none"})`);
  return { summary: parts.join("; "), added: added.slice(0, 12).map((l) => l.slice(0, 200)), removed: removed.slice(0, 12).map((l) => l.slice(0, 200)), price_changed: priceChanged, prices_before: pOld, prices_after: pNew };
}

// ---- signals -------------------------------------------------------------------------------------------------
export function cleanSignal(b = {}, partial = false, now = Date.now()) {
  const out = {}, err = [];
  if (b.title !== undefined) out.title = str(b.title, 200);
  if (b.text !== undefined) out.text = str(b.text, 3000);
  if (b.source_url !== undefined) { const u = cleanUrl(b.source_url); if (u === null) err.push("source must be a web link"); else out.source_url = u; }
  if (b.date !== undefined || !partial) { const d = b.date || todayOf(now); if (!isoDate(d)) err.push("date must be YYYY-MM-DD"); else out.date = d; }
  if (b.type !== undefined || !partial) { if (!SIGNAL_TYPE_IDS.includes(b.type)) err.push(`type must be one of ${SIGNAL_TYPE_IDS.join(", ")}`); else out.type = b.type; }
  if (b.platform !== undefined) out.platform = SIGNAL_PLATFORMS.includes(b.platform) ? b.platform : "";
  if (b.tags !== undefined) out.tags = cleanTags(b.tags);
  if (b.impact !== undefined || !partial) out.impact = IMPACTS.includes(b.impact) ? b.impact : "med";
  if (b.module !== undefined) out.module = LINK_MODULES.some(([m]) => m === b.module) ? b.module : "";
  if (b.competitor_id !== undefined) out.competitor_id = b.competitor_id ? String(b.competitor_id) : null;
  if ((out.type ?? b._type) === "platform_change" && !(out.platform ?? b._platform)) err.push("Pick the platform (Meta, Snap, TikTok, Google, Salla or Zid)");
  if (!partial && !out.title) err.push("title is required");
  if (partial && b.title !== undefined && !out.title) err.push("title cannot be empty");
  return { out, err };
}
// Counts by theme (tag), type, platform and impact.
export function signalThemes(signals) {
  const tags = {}, types = {}, platforms = {}, impact = { low: 0, med: 0, high: 0 };
  for (const s of signals) {
    for (const t of s.tags || []) { const x = (tags[t] ||= { tag: t, n: 0, high: 0 }); x.n++; if (s.impact === "high") x.high++; }
    types[s.type] = (types[s.type] || 0) + 1;
    if (s.platform) platforms[s.platform] = (platforms[s.platform] || 0) + 1;
    impact[s.impact] = (impact[s.impact] || 0) + 1;
  }
  return { tags: Object.values(tags).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)), types: SIGNAL_TYPES.map((t) => ({ ...t, n: types[t.id] || 0 })), platforms, impact };
}

// Candidate signals from the other modules. Each has an origin key so an import never adds the same item twice.
export function importCandidates({ store, crm, w, sources }) {
  const out = [], skipped = {};
  const day = (iso) => String(iso || "").slice(0, 10) || todayOf();
  const want = new Set(sources);
  if (want.has("deals")) for (const d of store.listDeals(w.id).filter((x) => x.stage === "lost")) {
    if (!str(d.lost_reason)) { skipped.deals = (skipped.deals || 0) + 1; continue; }
    out.push({ origin: `deal:${d.id}`, sample: !!d.sample, title: `Lost: ${d.name}: ${str(d.lost_reason, 150)}`, text: [d.lost_reason, d.competitor ? `Competitor named: ${d.competitor}` : ""].filter(Boolean).join("\n"),
      type: "win_loss", tags: cleanTags(["lost", STATUS_QUO.test(d.lost_reason) ? "status-quo" : "", d.competitor || ""]), impact: "med", module: "sales", date: day(d.stage_changed_at || d.updated_at || d.created_at) });
  }
  if (want.has("tickets")) for (const t of store.listTickets(w.id).filter((x) => x.category === "feature-request")) {
    const first = (t.messages || []).find((m) => m.from === "customer")?.text || "";
    out.push({ origin: `ticket:${t.id}`, sample: !!t.sample, title: `Feature request (${t.channel || "support"}): ${str(first, 150) || "no message text"}`, text: first.slice(0, 1500),
      type: "customer_request", tags: ["feature-request"], impact: "med", module: "product", date: day(t.created_at) });
  }
  if (want.has("feedback")) for (const f of store.listOps("product_feedback", w.id).filter((x) => !x.dismissed)) {
    out.push({ origin: `feedback:${f.id}`, sample: !!f.sample, title: `Feedback${f.customer ? ` from ${str(f.customer, 60)}` : ""}: ${str(f.text, 150)}`, text: str(f.text, 1500),
      type: "customer_request", tags: cleanTags(["feedback", f.source || ""]), impact: "med", module: "product", date: day(f.created_at) });
  }
  if (want.has("crm") && crm) {
    const names = new Map(crm.contacts(w.id).map((c) => [c.id, c.store_name]));
    for (const m of crm.db.messages.filter((x) => x.workspace_id === String(w.id) && x.direction === "in" && ["question", "not_now", "not_interested"].includes(x.intent))) {
      const what = m.summary || str(m.body, 150);
      if (!what) continue;
      out.push({ origin: `crm:${m.id}`, sample: !!m.sample, title: `CRM reply (${m.intent.replace("_", " ")}) from ${names.get(m.contact_id) || "a store"}: ${str(what, 140)}`, text: str(m.body, 1500),
        type: m.intent === "question" ? "customer_request" : "win_loss", tags: cleanTags(["crm-reply", m.intent]), impact: "low", module: "crm", date: day(m.at) });
    }
  }
  return { candidates: out, skipped };
}

// ---- win / loss ----------------------------------------------------------------------------------------------
const NO_REASON = "(no reason recorded)", NO_COMP = "(no competitor named)";
export function winLoss(deals, { now = Date.now(), days = 0 } = {}) {
  const since = days > 0 ? new Date(now - days * DAY).toISOString() : "";
  const rows = deals.filter((d) => (d.stage === "paying" || d.stage === "lost") && (!since || (d.stage_changed_at || d.created_at || "") >= since)).map((d) => ({
    id: d.id, name: d.name, outcome: d.stage === "paying" ? "won" : "lost", reason: str(d.stage === "paying" ? d.won_reason : d.lost_reason, 500), competitor: str(d.competitor, 120),
    date: String(d.stage_changed_at || d.created_at || "").slice(0, 10), skus: d.skus ?? null, platform: d.platform || "", city: d.city || "", sample: !!d.sample,
    status_quo: d.stage === "lost" && STATUS_QUO.test(d.lost_reason || ""),
  })).sort((a, b) => b.date.localeCompare(a.date));
  const group = (key, empty) => {
    const g = {};
    for (const r of rows) { const k = r[key] ? r[key].toLowerCase() : ""; const x = (g[k] ||= { label: r[key] || empty, won: 0, lost: 0 }); x[r.outcome]++; }
    return Object.values(g).sort((a, b) => b.won + b.lost - (a.won + a.lost) || a.label.localeCompare(b.label));
  };
  const won = rows.filter((r) => r.outcome === "won").length, lost = rows.length - won;
  return { rows, won, lost, win_rate: rows.length ? won / rows.length : null, lost_to_status_quo: rows.filter((r) => r.status_quo).length,
    missing_reason: rows.filter((r) => !r.reason).length, by_reason: group("reason", NO_REASON), by_competitor: group("competitor", NO_COMP) };
}

// ---- market sizing -------------------------------------------------------------------------------------------
// Every input is typed by a person, with its source. Nothing defaults to a number: empty inputs give no result.
export const SIZING_INPUTS = [
  { id: "stores_salla", label: "Active stores on Salla", kind: "count" },
  { id: "stores_zid", label: "Active stores on Zid", kind: "count" },
  { id: "stores_shopify", label: "Saudi stores on Shopify", kind: "count" },
  { id: "stores_other", label: "Saudi stores on other platforms", kind: "count" },
  { id: "pct_ad_spend", label: "% of those stores running paid social/search ads (TAM)", kind: "pct" },
  { id: "pct_fit", label: "% of ad-spending stores we can serve today (SAM: platforms, catalog size, categories)", kind: "pct" },
  { id: "pct_som", label: "% of SAM we can realistically win in 3 years (SOM)", kind: "pct" },
  ...PLANS.map((p) => ({ id: `mix_${p.name.toLowerCase()}`, label: `% of customers on ${p.name}`, kind: "pct", plan: p.name })),
];
export function cleanSizing(b = {}, cur = {}) {
  const out = { ...cur }, err = [];
  for (const f of SIZING_INPUTS) {
    const x = b[f.id]; if (x === undefined) continue;
    const raw = x && typeof x === "object" ? x.value : x, src = x && typeof x === "object" ? str(x.source, 300) : (cur[f.id]?.source || "");
    let value = null;
    if (raw !== "" && raw !== null && raw !== undefined) {
      const n = Number(String(raw).replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || (f.kind === "pct" && n > 100) || (f.kind === "count" && n > 1e8)) { err.push(`${f.label}: ${f.kind === "pct" ? "a percent from 0 to 100" : "a whole number"}`); continue; }
      value = f.kind === "count" ? Math.round(n) : n;
    }
    out[f.id] = { value, source: src };
  }
  return { out, err };
}
export function sizing(inputs = {}) {
  const v = (id) => { const x = inputs[id]?.value; return x === null || x === undefined || x === "" ? null : Number(x); };
  const counts = SIZING_INPUTS.filter((f) => f.kind === "count");
  const given = counts.filter((f) => v(f.id) !== null);
  const stores = given.length ? given.reduce((a, f) => a + v(f.id), 0) : null;
  const mult = (a, pct) => (a === null || pct === null ? null : Math.round((a * pct) / 100));
  const tam = mult(stores, v("pct_ad_spend")), sam = mult(tam, v("pct_fit")), som = mult(sam, v("pct_som"));
  const mixF = SIZING_INPUTS.filter((f) => f.plan), mix = mixF.map((f) => v(f.id));
  const mixSum = mix.every((x) => x === null) ? null : mix.reduce((a, x) => a + (x || 0), 0);
  // Blended ARPA from the PLANS list prices, only when the plan mix adds up to 100%.
  const arpa = mixSum !== null && Math.abs(mixSum - 100) < 0.01 ? Math.round(mixF.reduce((a, f, i) => a + ((mix[i] || 0) / 100) * PLANS.find((p) => p.name === f.plan).usd, 0) * 100) / 100 : null;
  const arr = (n) => (n === null || arpa === null ? null : Math.round(n * arpa * 12));
  const missing = SIZING_INPUTS.filter((f) => v(f.id) === null).map((f) => f.id);
  const unsourced = SIZING_INPUTS.filter((f) => v(f.id) !== null && !inputs[f.id]?.source).map((f) => f.id);
  const perPlan = PLANS.map((p) => ({ plan: p.name, usd_month: p.usd, from: !Number.isFinite(p.max), stores_needed: Math.ceil(ARR_GOAL_USD / (p.usd * 12)) }));
  const blendedNeeded = arpa ? Math.ceil(ARR_GOAL_USD / (arpa * 12)) : null;
  return {
    stores, counts_given: given.map((f) => f.id), tam_stores: tam, sam_stores: sam, som_stores: som, arpa_usd: arpa, mix_sum: mixSum,
    tam_arr_usd: arr(tam), sam_arr_usd: arr(sam), som_arr_usd: arr(som), missing, unsourced,
    goal: { arr_usd: ARR_GOAL_USD, per_plan: perPlan, blended_stores_needed: blendedNeeded,
      pct_of_sam: blendedNeeded && sam ? Math.round((blendedNeeded / sam) * 1000) / 10 : null, pct_of_tam: blendedNeeded && tam ? Math.round((blendedNeeded / tam) * 1000) / 10 : null },
  };
}

// ---- weekly brief --------------------------------------------------------------------------------------------
// The items of the last 7 days, each with a reference the brief must cite: S = signal, C = competitor change, D = deal.
export function briefSources({ store, w, now = Date.now(), days = 7 }) {
  const since = new Date(now - days * DAY).toISOString(), sinceDay = since.slice(0, 10);
  const comps = new Map(store.listOps(COLL.competitors, w.id).map((c) => [c.id, c]));
  const items = [];
  for (const s of store.listOps(COLL.signals, w.id).filter((x) => (x.date || "") >= sinceDay || (x.created_at || "") >= since)) {
    items.push({ ref: `S${s.id}`, kind: "signal", date: s.date, type: s.type, platform: s.platform || undefined, impact: s.impact, tags: s.tags, title: s.title, text: str(s.text, 600) || undefined, source_url: s.source_url || undefined,
      competitor: s.competitor_id ? comps.get(s.competitor_id)?.name : undefined });
  }
  for (const ch of store.listOps(COLL.changes, w.id).filter((x) => (x.created_at || "") >= since && ["edit", "page", "note"].includes(x.kind))) {
    items.push({ ref: `C${ch.id}`, kind: ch.kind === "page" ? "competitor_page_change" : "competitor_update", date: ch.created_at.slice(0, 10), competitor: comps.get(ch.competitor_id)?.name || "(deleted competitor)",
      text: ch.kind === "page" ? `${ch.summary}${ch.added?.length ? `\nAdded: ${ch.added.slice(0, 5).join(" | ")}` : ""}${ch.removed?.length ? `\nRemoved: ${ch.removed.slice(0, 5).join(" | ")}` : ""}` : (ch.lines || [ch.text]).join("\n"),
      source_url: ch.url || undefined, reviewed: ch.kind === "page" ? !!ch.reviewed_at : undefined });
  }
  for (const r of winLoss(store.listDeals(w.id), { now, days }).rows) items.push({ ref: `D${r.id}`, kind: r.outcome === "won" ? "deal_won" : "deal_lost", date: r.date, deal: r.name, reason: r.reason || "[ADD] no reason recorded", competitor: r.competitor || undefined });
  return { since: sinceDay, until: todayOf(now), items };
}
export function briefPrompt(w, src, lang = "en") {
  const ar = lang === "ar";
  return `<task title="Weekly market brief">
You are DPA AD's AI Market analyst. Write the weekly market brief for ${str(w.brief?.company_name, 80) || "DPA AD"} (a Saudi SaaS that turns Salla/Zid store catalogs into designed image and video ads for Meta, Snap, TikTok and Google) for ${src.since} to ${src.until}.

Rules (strict):
- Only summarize the items below. Never add facts, numbers, competitors, customers, prices or quotes that are not in the items.
- Every bullet must end with the reference(s) of the item(s) it comes from in square brackets, exactly as given, e.g. [S12] or [C4][D7].
- Where something a reader would need is missing (a source, a reason, what it means for DPA AD), write [ADD] instead of guessing.
- Sections: "Headlines" (3 bullets max), "Competitors", "Platforms & regulation", "Customers & win/loss", "What we should do" (suggestions only, each tied to references; use [ADD] for owner and date).
- ${ar ? "Write in Saudi Arabic (clear, professional). Keep product and company names as written." : "Write in plain English."}
- Markdown only. No preamble.
</task>

<items count="${src.items.length}">
${JSON.stringify(src.items, null, 1)}
</items>`;
}
const REF_RE = /\[([SCD]\d+)\]/g, HAS_REF = /\[[SCD]\d+\]/;
// Checks a brief against its sources: unknown references (invented items), bullets with no reference, numbers not in the data.
export function checkBrief(text, src) {
  const refs = new Set(src.items.map((i) => i.ref)), body = String(text || "");
  const cited = [...new Set([...body.matchAll(REF_RE)].map((m) => m[1]))];
  const unknown = cited.filter((r) => !refs.has(r));
  const bullets = body.split("\n").filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
  const uncited = bullets.filter((l) => !HAS_REF.test(l) && !/\[ADD\]/.test(l)).map((l) => l.trim().slice(0, 160));
  const data = JSON.stringify(src.items) + ` ${src.since} ${src.until} 7 ${new Date(src.until).getUTCFullYear()}`;
  const nums = [...new Set((body.replace(REF_RE, " ").match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[.,]+$/, "")).filter((n) => n.length > 0))];
  const unsourced_numbers = nums.filter((n) => !data.includes(n) && !data.includes(n.replace(/,/g, ""))).slice(0, 12);
  const issues = [
    ...unknown.map((r) => `Cites ${r}, which is not in this week's data`),
    ...(uncited.length ? [`${uncited.length} bullet${uncited.length === 1 ? "" : "s"} without a reference: ${uncited.slice(0, 3).join(" / ")}`] : []),
    ...(unsourced_numbers.length ? [`Numbers not found in the data: ${unsourced_numbers.join(", ")}`] : []),
  ];
  return { cited: cited.filter((r) => refs.has(r)), unknown, uncited: uncited.length, unsourced_numbers, issues, ok: !issues.length };
}
// The factual brief built from the data alone (used when the AI's answer can't be checked, or the AI is off).
export function ruleBrief(src, lang = "en") {
  const ar = lang === "ar";
  const T = ar ? { h: "ملخص السوق الأسبوعي", none: "لا توجد عناصر مسجلة هذا الأسبوع.", head: "أهم النقاط", comp: "المنافسون", plat: "المنصات والتنظيمات", cust: "العملاء والصفقات", todo: "وش نسوي", so: "وش يعني لنا", act: "الإجراء والمسؤول والموعد" }
    : { h: "Weekly market brief", none: "Nothing was recorded this week.", head: "Headlines", comp: "Competitors", plat: "Platforms & regulation", cust: "Customers & win/loss", todo: "What we should do", so: "what it means for DPA AD", act: "action, owner and date" };
  const line = (i) => {
    const what = i.kind === "signal" ? `${i.title}${i.platform ? ` (${i.platform})` : ""}${i.competitor ? ` · ${i.competitor}` : ""}` : i.kind.startsWith("deal_") ? `${i.kind === "deal_won" ? (ar ? "فزنا بـ" : "Won") : (ar ? "خسرنا" : "Lost")} ${i.deal}: ${i.reason}${i.competitor ? ` · ${i.competitor}` : ""}` : `${i.competitor}: ${String(i.text).split("\n")[0]}`;
    return `- ${what.replace(/\s+/g, " ").slice(0, 220)} [${i.ref}]`;
  };
  const by = (f) => src.items.filter(f);
  const sec = (title, list) => (list.length ? `\n## ${title}\n${list.map(line).join("\n")}\n` : `\n## ${title}\n- [ADD]\n`);
  if (!src.items.length) return `# ${T.h} · ${src.since} – ${src.until}\n\n${T.none}\n\n- [ADD]\n`;
  const high = by((i) => i.impact === "high");
  return `# ${T.h} · ${src.since} – ${src.until}\n` +
    sec(T.head, (high.length ? high : src.items).slice(0, 3)) +
    sec(T.comp, by((i) => i.kind.startsWith("competitor") || i.type === "competitor_move")) +
    sec(T.plat, by((i) => i.type === "platform_change" || i.type === "regulation" || i.type === "trend")) +
    sec(T.cust, by((i) => i.kind.startsWith("deal_") || i.type === "customer_request" || i.type === "win_loss")) +
    `\n## ${T.todo}\n- ${T.so}: [ADD]\n- ${T.act}: [ADD]\n`;
}
export const weekStart = (now = Date.now()) => { const d = new Date(+new Date(now) + 3 * 3600e3); /* Riyadh week */ const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10); };

// ---- Command Center ------------------------------------------------------------------------------------------
export function intelNeeds(store, w) {
  try {
    ensureIntel(store);
    const comps = new Map(store.listOps(COLL.competitors, w.id).map((c) => [c.id, c]));
    const pending = store.listOps(COLL.changes, w.id).filter((c) => c.kind === "page" && !c.reviewed_at);
    const byComp = {};
    for (const c of pending) (byComp[c.competitor_id] ||= []).push(c);
    return [
      ...Object.entries(byComp).slice(0, 4).map(([id, list]) => ({ module: "Market intel", route: "intel", param: "competitors", title: comps.get(id)?.name || "Competitor", text: `Watched page changed${list.length > 1 ? ` (${list.length} times)` : ""}: ${list.at(-1).summary}. Review it.` })),
      ...store.listOps(COLL.briefs, w.id).filter((b) => b.status === "draft").slice(0, 2).map((b) => ({ module: "Market intel", route: "intel", param: "brief", title: "Weekly market brief", text: `Brief for the week of ${b.week_start} is waiting for approval.` })),
    ];
  } catch (e) { console.error("[intel] needs:", e?.message); return []; }
}

// ---- the service: page checks (at most 2 at a time, weekly at most per page) and the weekly scheduler -------
export function createIntel({ store, fetchImpl, lookup, limits = {}, clock = () => Date.now(), log = console } = {}) {
  ensureIntel(store);
  const L = { ...FETCH_LIMITS, ...limits };
  const opts = { ...(fetchImpl ? { fetchImpl } : {}), ...(lookup ? { lookup } : {}), limits: L };
  let active = 0; const queue = [];
  const slot = () => new Promise((r) => { if (active < L.concurrency) { active++; r(); } else queue.push(r); });
  const release = () => { const n = queue.shift(); if (n) n(); else active--; };
  const svc = { clock, store };
  const now = () => svc.clock();
  const nextAt = (c) => (c.watch?.last_checked_at ? new Date(Date.parse(c.watch.last_checked_at) + WATCH_DAYS * DAY).toISOString() : null);
  const due = (c, t = now()) => !c.watch?.last_checked_at || Date.parse(c.watch.last_checked_at) + WATCH_DAYS * DAY <= t;

  // Fetch a competitor's watched page and compare it with the last snapshot.
  async function check(w, c, { by = "schedule" } = {}) {
    const url = c.watch_url;
    if (!url) return { error: "Add the page to watch first (the competitor's public pricing or landing page).", status: 422 };
    if (!due(c)) return { error: `This page was checked on ${c.watch.last_checked_at.slice(0, 10)}. Pages are checked at most once a week; next check from ${nextAt(c).slice(0, 10)}.`, status: 429 };
    const at = new Date(now()).toISOString();
    const watch = { ...(c.watch || {}), last_checked_at: at, last_url: url };
    let r;
    await slot();
    try { r = await safeGet(url, opts); }
    catch (e) {
      watch.last_error = String(e?.message || e).slice(0, 200);
      store.updateOps(COLL.competitors, w.id, c.id, { watch });
      return { error: watch.last_error, refused: e instanceof FetchRefused, status: 422 };
    } finally { release(); }
    if (!r.ok) { watch.last_error = `The page answered ${r.status}`; store.updateOps(COLL.competitors, w.id, c.id, { watch }); return { error: watch.last_error, status: 422 }; }
    const lines = pageLines(r.text);
    if (!lines.length) { watch.last_error = "No readable text on the page (it may load with JavaScript)"; store.updateOps(COLL.competitors, w.id, c.id, { watch }); return { error: watch.last_error, status: 422 }; }
    const hash = hashLines(lines), snap = snapshotOf(lines);
    let change = null;
    if (!watch.hash) change = store.addOps(COLL.changes, w.id, { competitor_id: c.id, kind: "watch", text: `Started watching ${r.url} (${lines.length} lines of text saved)`, url: r.url, by, reviewed_at: at });
    else if (watch.hash !== hash) {
      const d = diffSummary(String(watch.snapshot || "").split("\n").filter(Boolean), snap.split("\n").filter(Boolean));
      change = store.addOps(COLL.changes, w.id, { competitor_id: c.id, kind: "page", url: r.url, by, reviewed_at: null, ...d, hash_before: watch.hash, hash_after: hash, truncated: !!r.truncated });
    }
    Object.assign(watch, { hash, snapshot: snap, last_error: "", last_changed_at: change?.kind === "page" ? at : watch.last_changed_at || null, lines: lines.length });
    store.updateOps(COLL.competitors, w.id, c.id, { watch });
    return { changed: change?.kind === "page", baseline: change?.kind === "watch", change, competitor: store.getOps(COLL.competitors, w.id, c.id) };
  }
  // Every watched page that's due, across workspaces. Safe to repeat: a page is fetched at most weekly.
  async function tick() {
    const out = { checked: 0, changed: 0, failed: 0 };
    const jobs = [];
    for (const w of store.listWorkspaces()) for (const c of store.listOps(COLL.competitors, w.id)) {
      if (!c.watch_enabled || !c.watch_url || !due(c)) continue;
      jobs.push(check(w, c).then((r) => { out.checked++; if (r.changed) out.changed++; if (r.error) out.failed++; }).catch((e) => { out.failed++; log.error?.("[intel] check:", e?.message || e); }));
    }
    await Promise.all(jobs);
    return out;
  }
  let timer = null;
  function start(every = 6 * 3600e3) {
    const run = async () => { try { await tick(); } catch (e) { log.error?.("[intel] run:", e?.message || e); } };
    setTimeout(run, 90e3).unref?.();
    timer = setInterval(run, every); timer.unref?.();
  }
  const stop = () => { clearInterval(timer); timer = null; };
  return Object.assign(svc, { check, tick, start, stop, due, nextAt, now, limits: L });
}

// ---- sample data (clearly "Sample ·", removed with the other samples) ----------------------------------------
export function loadSampleIntel(store, wsId, now = Date.now()) {
  ensureIntel(store);
  const id = String(wsId), day = (d) => todayOf(now - d * DAY), ago = (d) => new Date(now - d * DAY).toISOString();
  const c1 = store.addOps(COLL.competitors, id, { name: "Sample · Catalog creative tool A", site: "https://example.com/", segment: SEGMENTS[0], platforms: ["Meta", "TikTok", "Shopify"],
    pricing: [{ tier: "Basic", price: "[ADD] as shown on their pricing page", notes: "" }], pricing_source_url: "https://example.com/pricing", pricing_checked_on: day(20),
    positioning: "Sample: templated catalog ads for Shopify stores, English only (verify).", strengths: "Sample: many templates", weaknesses: "Sample: no Arabic, no Salla or Zid", last_checked: day(20), notes: "", watch_url: "", watch_enabled: false, watch: {}, sample: true }, false);
  const c2 = store.addOps(COLL.competitors, id, { name: "Sample · Local design agency", site: "", segment: SEGMENTS[3], platforms: ["Snap", "TikTok"], pricing: [], pricing_source_url: "", pricing_checked_on: "",
    positioning: "Sample: designs per product by hand.", strengths: "Sample: Arabic copy, relationships", weaknesses: "Sample: slow, priced per design", last_checked: day(10), notes: "", watch_url: "", watch_enabled: false, watch: {}, sample: true }, false);
  const ch = store.addOps(COLL.changes, id, { competitor_id: c1.id, kind: "edit", lines: ["Weaknesses: empty → Sample: no Arabic, no Salla or Zid"], text: "", by: "Sample", reviewed_at: ago(3), sample: true }, false);
  ch.created_at = ago(3);
  let n = 0;
  for (const [type, title, platform, tags, impact, module, d, comp] of [
    ["platform_change", "Sample · Snap catalog ads: check the current catalog feed requirements", "Snap", ["catalog-feeds"], "high", "product", 2, null],
    ["customer_request", "Sample · Two stores asked for Zid support in demos", "", ["zid", "integrations"], "high", "product", 4, null],
    ["competitor_move", "Sample · Competitor A added TikTok templates (seen on their site)", "", ["video", "tiktok"], "med", "creative", 5, c1.id],
    ["regulation", "Sample · PDPL: re-check consent wording on outreach forms", "", ["pdpl"], "med", "compliance", 6, null],
    ["trend", "Sample · More Salla stores posting short product videos", "Salla", ["video"], "low", "creative", 12, null],
  ]) {
    const s = store.addOps(COLL.signals, id, { title, text: "", source_url: "", date: day(d), type, platform, tags, impact, module, competitor_id: comp, origin: null, by: "Sample", sample: true }, false);
    s.created_at = ago(d); n++;
  }
  store.save();
  return { intel_competitors: 2, intel_signals: n };
}
export function removeSampleIntel(store, wsId) {
  ensureIntel(store);
  const id = String(wsId), removed = {};
  const comps = new Set(store.db[COLL.competitors].filter((c) => c.workspace_id === id && c.sample).map((c) => c.id));
  for (const [k, coll] of Object.entries(COLL)) {
    const before = store.db[coll].length;
    store.db[coll] = store.db[coll].filter((x) => !(x.workspace_id === id && (x.sample || (coll === COLL.changes && comps.has(x.competitor_id)))));
    removed[`intel_${k}`] = before - store.db[coll].length;
  }
  for (const s of store.db[COLL.signals]) if (s.workspace_id === id && comps.has(s.competitor_id)) s.competitor_id = null;
  return removed;
}
