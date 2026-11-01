// Sales module: pipeline stages, plan fit, AI-first next steps and AI draft tasks.
// Rule: AI does every step it can; a step is marked "you" only when a human must do it
// (live calls for large deals, discounts and custom pricing, contracts, partnerships).
import { BRIEF_FIELDS } from "./catalog.js";

export const STAGES = [
  { id: "lead", name: "Lead", p: 0.05, closesIn: 4 },
  { id: "contacted", name: "Contacted", p: 0.1, closesIn: 3 },
  { id: "demo", name: "Demo", p: 0.25, closesIn: 2 },
  { id: "beta", name: "Beta", p: 0.45, closesIn: 2 },
  { id: "trial", name: "Trial", p: 0.65, closesIn: 1 },
  { id: "paying", name: "Paying", p: 1, closesIn: 0 },
  { id: "lost", name: "Lost", p: 0, closesIn: null },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const OPEN = ["lead", "contacted", "demo", "beta", "trial"];

// Matches the DPA AD pricing plan (docs/dpa-ad-pricing.md).
export const PLANS = [
  { name: "Starter", max: 500, usd: 199 },
  { name: "Growth", max: 5000, usd: 449 },
  { name: "Scale", max: 50000, usd: 1299 },
  { name: "Enterprise", max: Infinity, usd: 4000 },
];
export const SAR_PER_USD = 3.75;
export const planFor = (skus) => PLANS.find((p) => (Number(skus) || 0) <= p.max);

export const CITIES = {
  Riyadh: [24.71, 46.68], Jeddah: [21.49, 39.19], Makkah: [21.39, 39.86], Madinah: [24.47, 39.61],
  Dammam: [26.43, 50.1], Khobar: [26.22, 50.2], Abha: [18.22, 42.5], Tabuk: [28.38, 36.57],
  Buraidah: [26.33, 43.97], Hail: [27.52, 41.69], Taif: [21.27, 40.42], Jazan: [16.89, 42.57],
  Najran: [17.49, 44.13], "Al Ahsa": [25.38, 49.59], Other: null,
};
export const PLATFORMS = ["Salla", "Zid", "Shopify", "WooCommerce", "Other"];

export const daysSince = (iso, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : 0);

// The next step for a deal and who does it ("ai" or "you").
export function nextAction(deal, now = Date.now()) {
  const quiet = daysSince(deal.last_activity_at, now);
  const plan = planFor(deal.skus);
  const big = plan.usd >= 1299;
  const ai = (text, task, urgent = false) => ({ owner: "ai", text, task, urgent });
  const you = (text, urgent = true) => ({ owner: "you", text, task: null, urgent });
  switch (deal.stage) {
    case "lead": return ai("Write the WhatsApp opener with sample creatives from their catalog", "opener", quiet >= 3);
    case "contacted": return quiet >= 5
      ? ai(`No reply for ${quiet} days: write a short follow-up with a demo offer`, "follow_up", true)
      : ai("Write the demo invite built on their own catalog", "follow_up");
    case "demo": return big
      ? you(`Live call with the decision maker: ${plan.name} deal, custom pricing`)
      : ai(quiet >= 5 ? "Demo went quiet: write the beta offer with their demo creatives" : "Write the demo recap and beta offer", "follow_up", quiet >= 5);
    case "beta": return quiet >= 7
      ? ai("Write a usage nudge: no activity this week", "follow_up", true)
      : ai("Draft the before/after results request for a case study", "follow_up");
    case "trial": return big
      ? you(`Close the ${plan.name} deal. Discount over 10%? Trade it, don't give it: case study, logo rights, a public post on why they chose DPA AD, or a yearly prepay`)
      : ai(`Write the ${plan.name} upgrade offer before the trial ends`, "follow_up", quiet >= 5);
    case "paying": return ai(quiet >= 30 ? "Write a monthly check-in with an extra-renders offer" : "Write an app store review request", "follow_up");
    case "lost": return ai("Summarize the loss reason into Knowledge → objections", null);
    default: return ai("Review this deal", null);
  }
}

export function enrich(deal, now = Date.now()) {
  const plan = planFor(deal.skus);
  const st = STAGES.find((s) => s.id === deal.stage) || STAGES[0];
  return {
    ...deal, plan: plan.name, plan_usd: plan.usd, plan_sar: Math.round(plan.usd * SAR_PER_USD),
    probability: st.p, weighted_usd: plan.usd * st.p,
    days_quiet: daysSince(deal.last_activity_at, now), next: nextAction(deal, now),
  };
}

// Close rate on real opportunities (deals that reached a demo or later), per the masterclass rule:
// above 20% is healthy, below 18% means the sales process is broken. Needs 10+ closed opportunities to judge.
export const CLOSE_RATE = { healthy: 0.2, broken: 0.18, min_closed: 10 };
const OPP_STAGES = ["demo", "beta", "trial"];
export const STATUS_QUO = /status quo|no decision|did nothing|doing nothing|not now|no budget|stay(ing)? with|manual|canva|in-house|ما قرر|لاحق/i;
export function closeRate(deals, activities) {
  const lostFrom = (d) => {
    const a = activities.filter((x) => x.deal_id === d.id && x.type === "stage" && /→\s*lost/.test(x.text || "")).at(-1);
    return a ? String(a.text).split("→")[0].trim() : "";
  };
  const won = deals.filter((d) => d.stage === "paying").length;
  const lostOpps = deals.filter((d) => d.stage === "lost" && OPP_STAGES.includes(lostFrom(d)));
  const closed = won + lostOpps.length;
  const rate = closed ? won / closed : null;
  const verdict = closed < CLOSE_RATE.min_closed ? "too early" : rate >= CLOSE_RATE.healthy ? "healthy" : rate < CLOSE_RATE.broken ? "broken" : "borderline";
  const lost = deals.filter((d) => d.stage === "lost");
  return { rate, won, lost_opportunities: lostOpps.length, closed, verdict,
    lost_to_status_quo: lost.filter((d) => STATUS_QUO.test(d.lost_reason || "")).length, lost_total: lost.length };
}

// Summary numbers for the KPI strip and the AI team cards.
export function summary(deals, activities, now = Date.now()) {
  const e = deals.map((d) => enrich(d, now));
  const open = e.filter((d) => OPEN.includes(d.stage));
  const paying = e.filter((d) => d.stage === "paying");
  const weekAgo = now - 7 * 864e5;
  const recent = activities.filter((a) => Date.parse(a.created_at) >= weekAgo);
  const count = (pred) => recent.filter(pred).length;
  return {
    paying_mrr: paying.reduce((a, d) => a + d.plan_usd, 0),
    paying_count: paying.length,
    expected_mrr: paying.reduce((a, d) => a + d.plan_usd, 0) + open.reduce((a, d) => a + d.weighted_usd, 0),
    open_count: open.length,
    open_value: open.reduce((a, d) => a + d.plan_usd, 0),
    beta_plus: e.filter((d) => ["beta", "trial", "paying"].includes(d.stage)).length,
    ai_share: open.length ? Math.round((open.filter((d) => d.next.owner === "ai").length / open.length) * 100) : 100,
    close: closeRate(deals, activities),
    needs_you: [
      ...(() => { const c = closeRate(deals, activities); return c.verdict === "broken" ? [{ id: null, name: "Sales process", text: `Close rate on opportunities is ${Math.round(c.rate * 100)}% (below 18%): review demos and lost reasons before adding more leads` }] : []; })(),
      ...open.filter((d) => d.next.owner === "you").map((d) => ({ id: d.id, name: d.name, text: d.next.text }))],
    agents: {
      prospector: { drafts: count((a) => a.type === "ai_draft" && a.task === "opener"), sent: count((a) => a.type === "sent" && a.task === "opener") },
      demo: { pages: count((a) => a.type === "ai_draft" && a.task === "prospect_page"), demos: e.filter((d) => d.stage === "demo").length },
      followup: { drafts: count((a) => a.type === "ai_draft" && a.task === "follow_up"), sent: count((a) => a.type === "sent" && a.task === "follow_up") },
      success: { watched: e.filter((d) => ["beta", "trial"].includes(d.stage)).length, objections: count((a) => a.type === "ai_draft" && a.task === "objections") },
    },
  };
}

// ---- AI drafts. Every draft is reviewed by a person before it is sent.
export const AI_TASKS = {
  prospect_page: {
    title: "Prospect page",
    agent: "AI Demo",
    task: (d) => `Write a one-page sales brief for selling to this store. Sections:
## Who they are (2-3 lines from the data given; no invented facts)
## Their likely pain with ad creatives today
## Recommended plan and why (${d.plan}, $${d.plan_usd}/mo, about SAR ${d.plan_sar}/mo)
## Value at their size: a short cost comparison table of making ${d.skus} products × 3 creatives by hand vs. DPA AD. State every assumption (e.g. designer price per design) as an assumption.
## 3 sample ad angles for their category
## Next step`,
  },
  opener: {
    title: "WhatsApp opener",
    agent: "AI Prospector",
    task: (d) => `Write a first WhatsApp message to the owner of this store, in Saudi Arabic dialect (Najdi/Hijazi neutral), max 60 words, friendly and direct, no emojis spam (at most one). Offer to send 3 free sample ads made from their own catalog (${d.skus} products). End with a simple yes/no question. Then give an English translation under "### English".`,
  },
  follow_up: {
    title: "Follow-up message",
    agent: "AI Follow-up",
    task: (d) => `Write the next message for this deal. Goal: ${d.next.text}. The deal is at stage "${d.stage}" and has been quiet for ${d.days_quiet} days. Write it in Saudi Arabic dialect for WhatsApp (max 70 words), then an English translation under "### English", then a 2-line email version in English under "### Email".`,
  },
  objections: {
    title: "Objection answers",
    agent: "AI Success",
    task: (d) => `List the 4 objections this store is most likely to raise (use the company knowledge on objections if present) and a short, honest answer to each, adapted to a ${d.category || "store"} with ${d.skus} products on ${d.platform}. Format: ### Objection, then the answer in English, then the answer in Saudi Arabic.`,
  },
};

export function salesPrompt(store, ws, deal, taskKey) {
  const t = AI_TASKS[taskKey];
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, label]) => `- ${label}: ${ws.brief[k]}`);
  const notes = store.listNotes(ws.id).filter((n) => ["objections", "customers", "competitors", "pricing", "sales", "results"].includes(n.category));
  const history = store.listDealActivities(deal.id).slice(0, 8).map((a) => `- ${a.created_at.slice(0, 10)} ${a.by}: ${a.type}${a.text ? ": " + a.text.slice(0, 300) : ""}`);
  const parts = [
    `<brand_brief>\n${brief.join("\n")}\n</brand_brief>`,
    notes.length ? `<company_knowledge>\n${notes.map((n) => `[${n.category}] ${n.title}\n${n.content}`).join("\n\n")}\n</company_knowledge>` : "",
    `<deal>\n- Store: ${deal.name}\n- Category: ${deal.category || "unknown"}\n- City: ${deal.city}\n- Platform: ${deal.platform}\n- Products in catalog: ${deal.skus}\n- Contact: ${deal.contact_name || "unknown"}\n- Stage: ${deal.stage}\n- Notes: ${deal.notes || "none"}\n</deal>`,
    history.length ? `<deal_history newest_first>\n${history.join("\n")}\n</deal_history>` : "",
    `<task title="${t.title}">\n${t.task(deal)}\n</task>`,
    "Pricing rules: price on value, not cost — compare to what designing these creatives by hand would cost the store. Never offer more than 10% off; anything more is traded for something: a case study, logo rights, a public post on why they chose DPA AD, or a yearly prepay.",
    "You are writing for DPA AD's sales team. A person reviews this before anything is sent. Never invent results, customers or prices beyond the brief. Markdown, no preamble.",
  ];
  return parts.filter(Boolean).join("\n\n");
}
