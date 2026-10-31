// DAP ADS brand brief and playbook definitions (mirrors marketing_wizard/playbooks.py).
export const BRIEF = {
  "Company": "DAP ADS",
  "One-liner": "Turns an ecommerce product catalog into designed, on-brand image and video ads automatically, so every SKU gets scroll-stopping creative instead of a plain packshot.",
  "Category": "Ecommerce SaaS - catalog / dynamic product ad creative",
  "Target customers": "Ecommerce and DTC brands with 20+ products running catalog ads on Meta, TikTok, Google and Pinterest; growth marketers, performance agencies and in-house creative teams",
  "Problems solved": "Catalog ads look like plain white-background packshots, designing creative per SKU doesn't scale, prices/promos in creatives go stale, and there's no video for catalog ads",
  "Key features": "Catalog/feed sync (Shopify, WooCommerce, Meta/Google feeds), branded image templates with live price, discount, rating and badge overlays, catalog-to-video templates, bulk per-SKU rendering, auto-refresh when the feed changes, creative A/B testing",
  "Differentiators": "Images AND video from the catalog, self-serve set-up in minutes, priced for growing brands rather than enterprise-only",
  "Competitors": "Marpipe, Confect, Hunch, Pencil, in-house design + Canva",
  "Pricing": "Moving from $99/month flat to Starter $149, Growth $449, Scale $1,299, Enterprise from $4,000 per month, priced on active SKUs plus video renders",
  "Brand voice": "Friendly, confident and performance-minded: plain words, ROAS-first, no jargon",
  "Goals": "$100M ARR"
};

export const PLAYBOOKS = [
 {key:"positioning",title:"Positioning & Messaging Foundation",cat:"Strategy",desc:"Competitive alternatives, unique value, category, positioning statement and taglines.",
  task:"Build sharp positioning using the competitive-alternatives method: what customers would do without this product, unique attributes, the value they enable, who cares most, and the market category. Sections: Competitive alternatives, Unique attributes, Value themes, Best-fit customers, Market category, Positioning statement, Elevator pitch, 5 tagline options, Words to use, Words to avoid. No generic claims like 'powerful' or 'seamless'.",inputs:[]},
 {key:"icp_personas",title:"ICP & Buyer Personas",cat:"Strategy",desc:"Ideal customer profile, disqualifiers and buying-committee personas.",
  task:"Define the ideal customer profile, firmographics, disqualifiers and {persona_count} personas (economic buyer, champion, end user). For each persona: name, job title, buying role, goals, pains, objections, buying triggers, channels, messaging hooks.",inputs:[["persona_count","Number of personas","3"]],ctx:["positioning"]},
 {key:"messaging_matrix",title:"Messaging Matrix",cat:"Strategy",desc:"Master message plus persona-specific value props, proof and CTAs.",
  task:"Write one master message and a table with one row per persona: core message, value props, proof, call to action. Tie every value prop to proof.",inputs:[],ctx:["positioning","icp_personas"]},
 {key:"landing_page",title:"Landing Page Copy",cat:"Website",desc:"Hero, sections, FAQs, SEO meta and A/B headlines.",
  task:"Write conversion-focused landing page copy for {page_goal}: SEO title, meta description, hero headline and subheadline, primary CTA, 4-6 sections, social proof placeholders, 6 FAQs, 3 A/B headline variants.",inputs:[["page_goal","Page goal","Start a free 14-day trial"]],ctx:["positioning","messaging_matrix"]},
 {key:"cold_email_sequence",title:"Outbound Email Sequence",cat:"Sales",desc:"Multi-step cold email sequence for one persona.",
  task:"Write a {steps}-step cold email sequence to {persona}. Each step: send day, subject line, body under 120 words with {{first_name}} style tokens, and CTA.",inputs:[["persona","Target persona","Head of Growth at a DTC brand with 500+ SKUs"],["steps","Steps","5"]],ctx:["positioning","icp_personas"]},
 {key:"social_posts",title:"Social Media Post Pack",cat:"Content",desc:"Platform-native posts with hooks, bodies and CTAs.",
  task:"Write {count} {platform} posts about {topic}. Each: hook, body, CTA, hashtags, and a visual idea. Make them native to the platform.",inputs:[["platform","Platform","LinkedIn"],["count","Number of posts","6"],["topic","Topic","Why catalog ads with designed creative beat plain packshots"]],ctx:["positioning","messaging_matrix"]},
 {key:"ad_campaign",title:"Paid Ads Campaign",cat:"Paid",desc:"Campaign structure, targeting and ad copy for one platform.",
  task:"Plan a {platform} campaign with a {budget} monthly budget: objective, campaign/ad set structure, targeting, keywords or interests, 6 ad copy variants (headline, primary text, CTA), and what to test first.",inputs:[["platform","Platform","Meta"],["budget","Monthly budget","$5,000"]],ctx:["positioning","icp_personas"]},
 {key:"seo_content_plan",title:"SEO Content Plan",cat:"Content",desc:"Pillars, keyword-targeted article clusters and quick wins.",
  task:"Build an SEO plan: 3-4 content pillars, for each a cluster of article ideas with target keyword, search intent and a short outline, plus 5 quick wins.",inputs:[],ctx:["positioning","icp_personas"]},
 {key:"gtm_plan",title:"90-Day Go-To-Market Plan",cat:"Strategy",desc:"Phased plan with channels, weekly actions, KPIs and budget split.",
  task:"Write a 90-day GTM plan in three phases (foundation, launch, scale) for a team of {team}. Prioritise 2-3 channels that fit the ICP, list concrete weekly actions, measurable KPIs and a budget split.",inputs:[["team","Marketing team","1 marketer + founder"]],ctx:["positioning","icp_personas"]},
 {key:"competitor_battlecards",title:"Competitor Battlecards",cat:"Sales",desc:"How to win against each competitor, with objection handling.",
  task:"Create a battlecard for each listed competitor: their strengths (be fair), where we win, landmine questions, objection handling. Only claim weaknesses that are commonly known; mark anything to verify with (verify).",inputs:[],ctx:["positioning"]},
 {key:"content_calendar",title:"Content Calendar",cat:"Content",desc:"A multi-week, multi-channel publishing calendar.",
  task:"Plan a {weeks}-week content calendar across {channels} with {per_week} items per week, as a table: week, channel, topic, hook, goal (awareness/engagement/conversion).",inputs:[["weeks","Weeks","4"],["channels","Channels","LinkedIn, Instagram, blog"],["per_week","Items per week","3"]],ctx:["positioning","icp_personas"]},
 {key:"pricing_strategy",title:"Pricing & Packaging Strategy",cat:"Strategy",desc:"Value metric, tiers, add-ons and the revenue math to the goal.",
  task:"Design pricing and packaging: value metric, {tier_count} tiers with limits and upgrade triggers, add-ons, trial offer, competitor comparison (mark every competitor price as verify), revenue model from customer counts x ARPA per segment to the goal, expansion levers, risks, pricing experiments and pricing page copy.",inputs:[["tier_count","Number of tiers","4"]],ctx:["positioning","icp_personas"]}
];
