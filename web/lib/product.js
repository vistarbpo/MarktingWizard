// Product: roadmap (Now / Next / Later), customer feedback, impact-vs-effort priorities and releases.
// AI collects and groups feedback, scores ideas, writes specs, changelogs and release notes;
// people decide what gets built, approve releases and own partner agreements.
import { BRIEF_FIELDS } from "./catalog.js";

export const ITEM_STATUS = [
  { id: "idea", name: "Later", hint: "Ideas and requests" },
  { id: "planned", name: "Next", hint: "Approved, not started" },
  { id: "building", name: "Now", hint: "In progress" },
  { id: "released", name: "Released", hint: "Shipped" },
  { id: "not_doing", name: "Not doing", hint: "Declined, with a reason" },
];
export const ITEM_STATUS_IDS = ITEM_STATUS.map((s) => s.id);
export const ITEM_TYPES = ["feature", "integration", "improvement", "bug"];
export const PRODUCT_AREAS = ["Feed import", "Templates", "Video", "Export & channels", "Integrations", "AI agents", "Billing & plans", "App & UX", "Other"];
export const EFFORT = { S: 1, M: 3, L: 8 };

// Starter roadmap built from the DPA AD brief. Statuses are guesses to confirm.
export const STARTER_ROADMAP = [
  { title: "Salla app", type: "integration", area: "Integrations", status: "building", effort: "L", impact: 9, confidence: 80, problem: "Most Saudi target stores run on Salla; a custom feed URL is a barrier to signing up." },
  { title: "Zid app", type: "integration", area: "Integrations", status: "planned", effort: "M", impact: 7, confidence: 70, problem: "Second-largest Saudi store platform; same sign-up barrier as Salla." },
  { title: "Shopify app", type: "integration", area: "Integrations", status: "idea", effort: "M", impact: 6, confidence: 60, problem: "Needed for GCC and global brands on Shopify." },
  { title: "Public API", type: "integration", area: "Integrations", status: "idea", effort: "L", impact: 4, confidence: 50, problem: "Agencies and large catalogs want to automate creative generation." },
  { title: "Arabic template pack (Saudi dialect, RTL typography)", type: "feature", area: "Templates", status: "planned", effort: "M", impact: 8, confidence: 70, problem: "Arabic-first is a key differentiator in the GCC." },
  { title: "Catalog-to-video templates", type: "feature", area: "Video", status: "building", effort: "L", impact: 8, confidence: 60, problem: "Catalog ads have no video today; Snap and TikTok reward video." },
  { title: "AI Creative QA before export", type: "feature", area: "AI agents", status: "idea", effort: "M", impact: 7, confidence: 60, problem: "Wrong prices or broken Arabic text in ads lose merchant trust." },
  { title: "AI Feed Doctor", type: "feature", area: "AI agents", status: "idea", effort: "S", impact: 6, confidence: 70, problem: "Failed feed imports are the first place new stores get stuck." },
  { title: "Creative A/B test reporting", type: "feature", area: "Export & channels", status: "idea", effort: "M", impact: 6, confidence: 50, problem: "Merchants need to see which creative wins to justify the Growth plan." },
  { title: "Direct export to Snap, TikTok and Meta catalogs", type: "feature", area: "Export & channels", status: "planned", effort: "L", impact: 8, confidence: 60, problem: "Downloading and re-uploading creatives is manual work." },
].map((x) => ({ ...x, starter: true }));

// Priority score: impact (1-10) × confidence (%) × reach (feedback votes + 1), divided by effort.
export function score(item, votes = 0) {
  const e = EFFORT[item.effort] || 3;
  return Math.round(((Number(item.impact) || 5) * ((Number(item.confidence) || 50) / 100) * (1 + Math.log2(1 + votes)) / e) * 10) / 10;
}

export function productSnapshot({ items, feedback, releases, now = new Date() }) {
  const votes = {};
  for (const f of feedback) if (f.item_id) votes[f.item_id] = (votes[f.item_id] || 0) + 1;
  const enriched = items.map((i) => ({ ...i, votes: votes[i.id] || 0, score: score(i, votes[i.id] || 0) }));
  const thisMonth = now.toISOString().slice(0, 7);
  const unlinked = feedback.filter((f) => !f.item_id && !f.dismissed);
  const aiIdeas = enriched.filter((i) => i.status === "idea" && i.source === "ai" && !i.reviewed);
  const late = enriched.filter((i) => ["planned", "building"].includes(i.status) && i.target && i.target < thisMonth);
  const needs = [
    ...(aiIdeas.length ? [{ tab: "roadmap", text: `${aiIdeas.length} AI-suggested idea${aiIdeas.length === 1 ? "" : "s"} to approve or decline` }] : []),
    ...(unlinked.length >= 5 ? [{ tab: "feedback", text: `${unlinked.length} feedback items not grouped yet: let AI cluster them` }] : []),
    ...late.map((i) => ({ tab: "roadmap", text: `Past target (${i.target}): ${i.title}` })),
    ...releases.filter((r) => r.status === "draft").map((r) => ({ tab: "releases", text: `Release ${r.version} is a draft: approve go/no-go` })),
  ];
  const by = (s) => enriched.filter((i) => i.status === s).sort((a, b) => b.score - a.score);
  return {
    items: enriched,
    columns: Object.fromEntries(ITEM_STATUS_IDS.map((s) => [s, by(s).map((i) => i.id)])),
    counts: { now: by("building").length, next: by("planned").length, later: by("idea").length, released: by("released").length },
    feedback: { total: feedback.length, unlinked: unlinked.length, week: feedback.filter((f) => Date.parse(f.created_at) >= now.getTime() - 7 * 864e5).length },
    top_requested: enriched.filter((i) => i.votes && i.status !== "released").sort((a, b) => b.votes - a.votes).slice(0, 5).map((i) => ({ id: i.id, title: i.title, votes: i.votes })),
    last_release: [...releases].filter((r) => r.status === "released").sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null,
    needs,
  };
}

// ---- AI
const briefOf = (ws) => BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");

export function clusterPrompt(ws, feedback, items) {
  return `<company>\n${briefOf(ws)}\n</company>
<existing_roadmap>\n${items.map((i) => `[${i.id}] ${i.title} (${i.status})`).join("\n") || "empty"}\n</existing_roadmap>
<feedback>\n${feedback.map((f) => `[${f.id}] (${f.source}${f.customer ? ", " + f.customer : ""}) ${f.text.slice(0, 400)}`).join("\n")}\n</feedback>
Group this customer feedback into themes. For each theme, either match an existing roadmap item or propose a new one. Return ONLY a JSON array, no prose, items:
{"theme":"short name","feedback_ids":["ids from the list"],"existing_item_id":"id or null","new_item":{"title":"...","type":"feature|integration|improvement|bug","area":"one of ${PRODUCT_AREAS.join("|")}","problem":"the customer problem in one sentence","effort":"S|M|L","impact":1-10,"confidence":0-100} or null}
Use only the feedback given. Prefer matching existing items over creating near-duplicates.`;
}

export function parseClusters(text, feedbackIds, itemIds) {
  const raw = String(text || ""), s = raw.indexOf("["), e = raw.lastIndexOf("]");
  if (s < 0 || e <= s) return null;
  let arr; try { arr = JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const fb = new Set(feedbackIds.map(String)), it = new Set(itemIds.map(String));
  return arr.slice(0, 30).map((c) => {
    const ni = c?.new_item && typeof c.new_item === "object" ? c.new_item : null;
    return {
      theme: String(c?.theme || "Theme").slice(0, 120),
      feedback_ids: (Array.isArray(c?.feedback_ids) ? c.feedback_ids : []).map(String).filter((x) => fb.has(x)),
      existing_item_id: c?.existing_item_id && it.has(String(c.existing_item_id)) ? String(c.existing_item_id) : null,
      new_item: ni ? cleanItem(ni) : null,
    };
  }).filter((c) => c.feedback_ids.length && (c.existing_item_id || c.new_item?.title));
}

export function cleanItem(b) {
  return {
    title: String(b.title || "").trim().slice(0, 200),
    type: ITEM_TYPES.includes(b.type) ? b.type : "feature",
    area: PRODUCT_AREAS.includes(b.area) ? b.area : "Other",
    problem: String(b.problem || "").slice(0, 1000),
    effort: Object.hasOwn(EFFORT, b.effort) ? b.effort : "M",
    impact: Math.max(1, Math.min(10, Math.round(Number(b.impact) || 5))),
    confidence: Math.max(0, Math.min(100, Math.round(Number(b.confidence) || 50))),
  };
}

export function specPrompt(ws, item, feedback) {
  return `<company>\n${briefOf(ws)}\n</company>
<roadmap_item>\n- Title: ${item.title}\n- Type: ${item.type}\n- Area: ${item.area}\n- Problem: ${item.problem || "-"}\n- Effort: ${item.effort}, impact ${item.impact}/10, confidence ${item.confidence}%\n- Notes: ${item.notes || "-"}\n</roadmap_item>
<customer_feedback>\n${feedback.map((f) => `- (${f.source}${f.customer ? ", " + f.customer : ""}) ${f.text.slice(0, 400)}`).join("\n") || "none linked"}\n</customer_feedback>
Write a one-page product spec: ## Problem (with the customers' own words where available), ## Who it's for, ## Success metric, ## Scope (in / out), ## User flow (numbered steps; note RTL/Arabic where relevant), ## Edge cases, ## What AI agents do vs what a person must do, ## Rollout and help-center article to write, ## Open questions. Don't invent data; mark guesses [TO CONFIRM]. Markdown, no preamble.`;
}

export function releasePrompt(ws, release, items) {
  return `<company>\n${briefOf(ws)}\n</company>
<release version="${release.version}" date="${release.date || "TBD"}">\n${items.map((i) => `- ${i.title} (${i.type}, ${i.area}): ${i.problem || ""}`).join("\n") || "no items"}\n${release.notes ? "Notes: " + release.notes : ""}\n</release>
Write: ## Changelog (merchant-facing bullets, English), ## سجل التغييرات (the same in Arabic), ## Release announcement (short post for LinkedIn/X, English and Arabic), ## Help-center article (### question and answer for the most important change). Only describe what's listed; no invented features. Markdown, no preamble.`;
}
