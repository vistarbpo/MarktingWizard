// Playbooks, brief fields, default KPIs and data-gap questions.

export const NOTE_CATEGORIES = [
  "product", "pricing", "customers", "competitors", "results", "objections", "sales", "brand", "other",
];

// [field, label] in the order they appear in prompts.
export const BRIEF_FIELDS = [
  ["company_name", "Company"], ["product_name", "Product"], ["website", "Website"],
  ["one_liner", "One-liner"], ["category", "Category"], ["business_model", "Business model"],
  ["target_customers", "Target customers"], ["markets", "Markets & languages"],
  ["integrations", "Integrations"], ["problems_solved", "Problems solved"],
  ["key_features", "Key features"], ["differentiators", "Differentiators"],
  ["competitors", "Competitors"], ["pricing", "Pricing"], ["proof_points", "Proof points"],
  ["brand_voice", "Brand voice"], ["goals", "Goals"], ["budget", "Budget"], ["extra_notes", "Extra notes"],
];

export function cleanBrief(input = {}) {
  const brief = {};
  for (const [k] of BRIEF_FIELDS) brief[k] = String(input[k] ?? "").slice(0, 5000);
  if (!brief.business_model) brief.business_model = "saas";
  return brief;
}

// p(key, title, category, description, task, inputs, ctx, extra)
const p = (key, title, category, description, task, inputs = [], ctx = [], extra = {}) => ({
  key, title, category, description, task,
  inputs: inputs.map(([name, label, def = "", help = ""]) => ({ name, label, default: def, help })),
  uses_context_from: ctx, uses_kpis: false, for_agencies: false, ...extra,
});

export const PLAYBOOKS = [
  p("positioning", "Positioning & Messaging Foundation", "Strategy",
    "Competitive alternatives, unique value, category, positioning statement and taglines.",
    "Build sharp positioning using the competitive-alternatives method: what customers would do without this product, unique attributes, the value they enable, who cares most, and the market category. Sections: Competitive alternatives, Unique attributes, Value themes, Best-fit customers, Market category, Positioning statement, Elevator pitch, 5 tagline options, Words to use, Words to avoid. No generic claims like 'powerful' or 'seamless'."),
  p("icp_personas", "ICP & Buyer Personas", "Strategy",
    "Ideal customer profile, disqualifiers and buying-committee personas.",
    "Define the ideal customer profile, firmographics, disqualifiers and {persona_count} personas (economic buyer, champion, end user). For each persona: name, job title, buying role, goals, pains, objections, buying triggers, channels, messaging hooks.",
    [["persona_count", "Number of personas", "3"]], ["positioning"]),
  p("messaging_matrix", "Messaging Matrix", "Strategy",
    "Master message plus persona-specific value props, proof and CTAs.",
    "Write one master message and a table with one row per persona: core message, value props, proof, call to action. Tie every value prop to proof.",
    [], ["positioning", "icp_personas"]),
  p("pricing_strategy", "Pricing & Packaging Strategy", "Strategy",
    "Value metric, tiers, add-ons and the revenue math to the goal.",
    "Design pricing and packaging: value metric, {tier_count} tiers with limits and upgrade triggers, add-ons, trial offer, competitor comparison (mark every competitor price as verify), revenue model from customer counts x ARPA per segment to the goal, expansion levers, risks, pricing experiments and pricing page copy.",
    [["tier_count", "Number of tiers", "4"]], ["positioning", "icp_personas"]),
  p("gtm_plan", "90-Day Go-To-Market Plan", "Strategy",
    "Phased plan with channels, weekly actions, KPIs and budget split.",
    "Write a 90-day GTM plan in three phases (foundation, launch, scale) for a team of {team}. Prioritise 2-3 channels that fit the ICP, list concrete weekly actions, measurable KPIs and a budget split.",
    [["team", "Marketing team", "1 marketer + founder"]], ["positioning", "icp_personas"]),
  p("landing_page", "Landing Page Copy", "Website",
    "Hero, sections, FAQs, SEO meta and A/B headlines.",
    "Write conversion-focused landing page copy for {page_goal}: SEO title, meta description, hero headline and subheadline, primary CTA, 4-6 sections, social proof placeholders, 6 FAQs, 3 A/B headline variants.",
    [["page_goal", "Page goal", "Start a free trial"]], ["positioning", "messaging_matrix"]),
  p("cold_email_sequence", "Outbound Email Sequence", "Sales",
    "Multi-step cold email sequence for one persona.",
    "Write a {steps}-step cold email sequence to {persona}. Each step: send day, subject line, body under 120 words with {{first_name}} style tokens, and CTA. End with a polite breakup email.",
    [["persona", "Target persona", "Head of Growth at an online store with 500+ SKUs"], ["steps", "Steps", "5"]],
    ["positioning", "icp_personas"]),
  p("competitor_battlecards", "Competitor Battlecards", "Sales",
    "How to win against each competitor, with objection handling.",
    "Create a battlecard for each listed competitor: their strengths (be fair), where we win, landmine questions, objection handling. Only claim weaknesses that are commonly known; mark anything to verify with (verify).",
    [], ["positioning"]),
  p("social_posts", "Social Media Post Pack", "Content",
    "Platform-native posts with hooks, bodies and CTAs.",
    "Write {count} {platform} posts about {topic}. Each: hook, body, CTA, hashtags, and a visual idea. Make them native to the platform.",
    [["platform", "Platform", "LinkedIn"], ["count", "Number of posts", "6"], ["topic", "Topic", "Why designed catalog creative beats plain packshots"]],
    ["positioning", "messaging_matrix"]),
  p("seo_content_plan", "SEO Content Plan", "Content",
    "Pillars, keyword-targeted article clusters and quick wins.",
    "Build an SEO plan: 3-4 content pillars, for each a cluster of article ideas with target keyword, search intent and a short outline, plus 5 quick wins.",
    [], ["positioning", "icp_personas"]),
  p("content_calendar", "Content Calendar", "Content",
    "A multi-week, multi-channel publishing calendar.",
    "Plan a {weeks}-week content calendar across {channels} with {per_week} items per week, as a table: week, channel, topic, hook, goal (awareness/engagement/conversion).",
    [["weeks", "Weeks", "4"], ["channels", "Channels", "LinkedIn, Instagram, blog"], ["per_week", "Items per week", "3"]],
    ["positioning", "icp_personas"]),
  p("ad_campaign", "Paid Ads Campaign", "Paid",
    "Campaign structure, targeting and ad copy for one platform.",
    "Plan a {platform} campaign with a {budget} monthly budget: objective, campaign/ad set structure, targeting, keywords or interests, 6 ad copy variants (headline, primary text, CTA), and what to test first. Respect the platform's character limits.",
    [["platform", "Platform", "Meta"], ["budget", "Monthly budget", "$5,000"]], ["positioning", "icp_personas"]),
  p("kpi_report", "KPI Report & Analysis", "Reports",
    "Analyzes your logged KPIs: what happened, why, so what, now what.",
    "Write the {report_type} report from the KPI data provided, in four sections. 1) What happened: a table of each KPI vs target and previous period, marked green / yellow / red / no data. 2) Why: likely causes of red and yellow KPIs, broken down by channel, segment or funnel step. 3) So what: the effect on the north star and quarterly goals. 4) Now what: at most 3 actions, each with owner, due date and expected impact. Use only the numbers given; list missing or suspicious data under 'Data gaps' instead of guessing.",
    [["report_type", "Report type", "weekly KPI pulse", "weekly KPI pulse, monthly business review, quarterly review"]],
    ["gtm_plan"], { uses_kpis: true }),
  p("agency_proposal", "Agency Client Proposal", "Agency",
    "Win new clients: a tailored proposal written from your agency's brief.",
    "The brand brief describes OUR agency. Write a tailored proposal to win this prospect: {prospect}. Show we understand their situation, propose a scoped engagement with deliverables and a timeline, and give three pricing options (good / better / best).",
    [["prospect", "Prospect", "", "Who they are, what they need, budget if known"]], [], { for_agencies: true }),
];

export const LAUNCH_KIT = [
  "positioning", "icp_personas", "messaging_matrix", "landing_page",
  "cold_email_sequence", "social_posts", "ad_campaign", "gtm_plan",
];

const k = (stage, name, formula, owner, extra = {}) => ({
  stage, name, formula, owner, unit: "", frequency: "weekly", target: null, higher_is_better: true, ...extra,
});

// From the SaaS Marketing & Growth SOP, tailored to catalog-driven AI ad creatives.
export const DEFAULT_KPIS = [
  k("Discovery", "App listing views", "Views of our app store pages", "Marketplace Manager"),
  k("Discovery", "Rating", "Average app store star rating", "Marketplace Manager", { unit: "stars", target: 4.8 }),
  k("Acquisition", "Signups / installs", "New accounts or app installs", "Marketplace Manager"),
  k("Acquisition", "Listing conversion", "Installs / listing views", "Marketplace Manager", { unit: "%" }),
  k("Acquisition", "Demos booked", "Qualified demos booked", "Sales"),
  k("Acquisition", "Agency-sourced signups", "Signups referred by partner agencies", "Partnerships", { frequency: "monthly" }),
  k("Activation", "Feed import rate", "Stores with feed imported in 48h / signups", "Onboarding", { unit: "%" }),
  k("Activation", "Time to first creatives", "Median hours from signup to first export", "Onboarding", { unit: "hours", higher_is_better: false }),
  k("Activation", "Activation rate", "Feed imported + creatives exported in 7 days / signups", "Onboarding", { unit: "%" }),
  k("Revenue", "Trial-to-paid", "Paying stores / finished trials", "Head of Growth", { unit: "%" }),
  k("Revenue", "Net new MRR", "New + expansion - churned - contraction MRR", "Head of Growth", { unit: "$" }),
  k("Revenue", "ARPA by SKU plan", "MRR / paying stores", "Head of Growth", { unit: "$", frequency: "monthly" }),
  k("Revenue", "Credit top-up revenue", "Revenue from extra credits", "Head of Growth", { unit: "$" }),
  k("Value", "Stores running creative tests", "Paying stores that exported creatives this month", "Customer Success"),
  k("Value", "Creatives per product", "Creatives exported / products in feed", "Customer Success", { frequency: "monthly" }),
  k("Value", "Merchant ROAS", "Ad revenue / ad spend on our creatives", "Customer Success", { unit: "x", frequency: "monthly" }),
  k("Retention", "Churn rate", "Stores lost / active stores at start of month", "Customer Success", { unit: "%", frequency: "monthly", higher_is_better: false }),
  k("Retention", "Net revenue retention", "(Start MRR + expansion - contraction - churn) / start MRR", "Customer Success", { unit: "%", frequency: "monthly" }),
  k("Economics", "CAC", "Sales + marketing spend / new paying stores", "Head of Growth", { unit: "$", frequency: "monthly", higher_is_better: false }),
  k("Economics", "CAC payback", "CAC / (ARPA x gross margin)", "Head of Growth", { unit: "months", frequency: "quarterly", higher_is_better: false }),
];

const BRIEF_QUESTIONS = {
  one_liner: "What does the product do, in one sentence?",
  target_customers: "Who exactly buys it (store type, size, country, role of the buyer)?",
  problems_solved: "What problems does it solve for those customers?",
  key_features: "What are the main features?",
  differentiators: "Why do customers choose you over alternatives?",
  competitors: "Who are the competitors, or what do customers use instead today?",
  pricing: "What are the plans and prices (SKU limits, credits)?",
  markets: "Which markets and languages, in what order?",
  integrations: "How do customers connect today, and what is planned with dates?",
  proof_points: "What results can you show (customers, ROAS, time saved, case studies)?",
  brand_voice: "How should the brand sound?",
  goals: "What are the goals for this quarter, with numbers?",
  budget: "What is the monthly marketing budget?",
};

const NOTE_QUESTIONS = {
  results: "Add real customer results: before/after ROAS, CTR, time saved.",
  objections: "Add the objections you hear most in demos, and how you answer them.",
  customers: "Add 3-5 real or target customer examples (store, catalog size, why they bought).",
  competitors: "Add what you know about each competitor: pricing, strengths, weaknesses.",
  sales: "Add your sales process: demo script, trial length, who decides.",
};

export const GAP_TOTAL = Object.keys(BRIEF_QUESTIONS).length + Object.keys(NOTE_QUESTIONS).length + 1;

export function dataGaps(brief, notes, kpiCount, kpisWithValues) {
  const gaps = [];
  for (const [field, question] of Object.entries(BRIEF_QUESTIONS)) {
    if (!String(brief[field] || "").trim()) gaps.push({ area: "brief", field, question });
  }
  const have = new Set(notes.map((n) => n.category));
  for (const [cat, question] of Object.entries(NOTE_QUESTIONS)) {
    if (!have.has(cat)) gaps.push({ area: "knowledge", field: cat, question });
  }
  if (kpiCount === 0) gaps.push({ area: "kpis", field: "setup", question: "Load the SOP KPI set so you can start tracking." });
  else if (kpisWithValues === 0) gaps.push({ area: "kpis", field: "values", question: "Log this week's KPI numbers so reports can analyze them." });
  return gaps;
}
