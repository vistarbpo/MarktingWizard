// The marketing operating SOP: one procedure, run entirely inside this dashboard.
// Each step links to the page or playbook that does the work. Ticks are stored per
// period (setup / ISO week / month / quarter), so every cycle starts fresh.
// docs/SOP.md is generated from this file: `npm run sop:md`.
import { PLAYBOOKS } from "./catalog.js";

const PAGE = { support: "AI Support", team: "Team & hiring", pipeline: "Sales pipeline", sop: "SOP", overview: "Overview", brief: "Brief", knowledge: "Knowledge", kpis: "KPIs", playbooks: "Playbooks", library: "Library" };

export const SOP = [
  {
    cadence: "setup",
    title: "One-time setup",
    when: "Once, before the first weekly cycle",
    goal: "Give the engine enough company data to write sharp, on-brand output.",
    steps: [
      { id: "env", text: "Set DASHBOARD_PASSWORD and ANTHROPIC_API_KEY in hPanel (Websites → wizard.dpa.ad → Node.js → Environment variables).", owner: "Founder" },
      { id: "brief", text: "Fill in the Brief completely: customers, markets, integrations, pricing, competitors, goals.", owner: "Head of Growth", go: "brief" },
      { id: "knowledge", text: "Add Knowledge notes: real results, common objections, competitor intel, sales learnings, the pricing plan.", owner: "Head of Growth", go: "knowledge" },
      { id: "kpis", text: "Load the SOP KPIs and set a target for each one.", owner: "Head of Growth", go: "kpis" },
      { id: "gaps", text: "Answer every open question on the Overview until data completeness is 100%.", owner: "Head of Growth", go: "overview" },
      { id: "launch", text: "Run the full launch kit (positioning → ICP → messaging → landing page → emails → social → ads → GTM plan).", owner: "Head of Growth", go: "playbooks" },
      { id: "helpcenter", text: "Let AI write the starter help center (English + Arabic), fill every [CONFIRM], then switch on the website chat.", owner: "Founder", go: "support" },
      { id: "pricing", text: "Run Pricing & Packaging Strategy, verify competitor prices, and decide the launch price.", owner: "Founder", go: "playbooks", param: "pricing_strategy" },
      { id: "review", text: "Review every launch-kit output in the Library; replace each [ADD …] placeholder and (verify) mark with real facts.", owner: "Founder", go: "library" },
    ],
  },
  {
    cadence: "weekly",
    title: "Weekly cycle",
    when: "Every week · Monday review, Friday wrap-up",
    goal: "Measure, learn, and ship this week's marketing from one place.",
    steps: [
      { id: "log", text: "Monday: log last week's values for every weekly KPI.", owner: "Each KPI owner", go: "kpis" },
      { id: "report", text: "Monday: run KPI Report & Analysis and agree the one bottleneck to fix this week.", owner: "Head of Growth", go: "playbooks", param: "kpi_report" },
      { id: "experiment", text: "Monday: pick 1–2 experiments that target that bottleneck and write them as a Knowledge note (hypothesis, metric, owner).", owner: "Head of Growth", go: "knowledge" },
      { id: "social", text: "Generate this week's Social Media Post Pack and schedule the posts.", owner: "Content", go: "playbooks", param: "social_posts" },
      { id: "outbound", text: "Generate or refresh an Outbound Email Sequence for the persona in focus and load it into the sending tool.", owner: "Sales", go: "playbooks", param: "cold_email_sequence" },
      { id: "sales", text: "Daily: open the Sales pipeline, review and send the AI drafts, and clear everything under \"Needs you\".", owner: "Founder", go: "pipeline" },
      { id: "support", text: "Daily: clear AI Support's \"Needs you\" list; Friday: turn repeated questions into new help articles.", owner: "Customer Success", go: "support" },
      { id: "listing", text: "Check app store listings (Salla, Shopify, Zid): reply to every review, note rating changes.", owner: "Marketplace Manager" },
      { id: "learnings", text: "Friday: add Knowledge notes for new objections, wins, lost deals and competitor moves.", owner: "Sales + Customer Success", go: "knowledge" },
      { id: "library", text: "Friday: clear the Library: everything generated this week is reviewed, used, or deleted.", owner: "Head of Growth", go: "library" },
    ],
  },
  {
    cadence: "monthly",
    title: "Monthly review",
    when: "First working day of the month",
    goal: "Check unit economics and plan next month's content and spend.",
    steps: [
      { id: "log", text: "Log the monthly KPIs: ARPA, churn, NRR, CAC, merchant ROAS, creatives per product.", owner: "Head of Growth", go: "kpis" },
      { id: "report", text: "Run KPI Report & Analysis on the month and share it with the team.", owner: "Head of Growth", go: "playbooks", param: "kpi_report" },
      { id: "calendar", text: "Generate next month's Content Calendar.", owner: "Content", go: "playbooks", param: "content_calendar" },
      { id: "ads", text: "Refresh the Paid Ads Campaign: kill losers, brief new creatives and angles.", owner: "Performance marketer", go: "playbooks", param: "ad_campaign" },
      { id: "seo", text: "Update the SEO Content Plan and publish the planned articles.", owner: "Content", go: "playbooks", param: "seo_content_plan" },
      { id: "battlecards", text: "Refresh Competitor Battlecards with this month's competitor notes.", owner: "Sales", go: "playbooks", param: "competitor_battlecards" },
      { id: "hiring", text: "Clear Team & hiring: every candidate screened by AI, interviews booked, decisions logged, rejections sent.", owner: "Founder", go: "team" },
      { id: "brief", text: "Update the Brief with anything that changed: pricing, features, markets, proof points.", owner: "Founder", go: "brief" },
    ],
  },
  {
    cadence: "quarterly",
    title: "Quarterly strategy",
    when: "Last two weeks of each quarter",
    goal: "Re-set strategy, pricing and goals for the next quarter.",
    steps: [
      { id: "positioning", text: "Re-run Positioning with the quarter's knowledge and results; adopt changes deliberately.", owner: "Founder", go: "playbooks", param: "positioning" },
      { id: "icp", text: "Re-run ICP & Buyer Personas using real customer data.", owner: "Head of Growth", go: "playbooks", param: "icp_personas" },
      { id: "messaging", text: "Re-run the Messaging Matrix and roll changes into the landing page and ads.", owner: "Head of Growth", go: "playbooks", param: "messaging_matrix" },
      { id: "pricing", text: "Re-run Pricing & Packaging Strategy; decide on any price or plan change.", owner: "Founder", go: "playbooks", param: "pricing_strategy" },
      { id: "gtm", text: "Generate the next 90-Day Go-To-Market Plan and set next quarter's KPI targets.", owner: "Founder", go: "playbooks", param: "gtm_plan" },
      { id: "team", text: "Review the org chart: move any repeatable human work to an AI agent, and confirm which roles truly must be human before hiring.", owner: "Founder", go: "team" },
      { id: "targets", text: "Update KPI targets on the KPIs page to match the new plan.", owner: "Head of Growth", go: "kpis" },
    ],
  },
];

// The period a tick belongs to, so each cycle starts unticked.
export function periodFor(cadence, date = new Date()) {
  const y = date.getUTCFullYear();
  if (cadence === "setup") return "setup";
  if (cadence === "monthly") return `${y}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (cadence === "quarterly") return `${y}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  // ISO week, e.g. 2026-W44.
  const d = new Date(Date.UTC(y, date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function sopMarkdown() {
  const out = [
    "# Marketing Operating SOP",
    "",
    "One procedure for running marketing, done entirely in the Marketing Wizard dashboard (https://wizard.dpa.ad → **SOP**).",
    "Tick steps off in the dashboard; ticks reset each week, month and quarter.",
    "",
    "_Generated from `web/lib/sop.js` with `npm run sop:md`. Edit that file, not this one._",
  ];
  for (const s of SOP) {
    out.push("", `## ${s.title}`, "", `**When:** ${s.when}  `, `**Goal:** ${s.goal}`, "", "| # | Step | Owner | Where in the dashboard |", "|---|---|---|---|");
    s.steps.forEach((st, i) => {
      const pb = st.param && PLAYBOOKS.find((p) => p.key === st.param);
      const where = pb ? `Playbooks → ${pb.title}` : st.go ? PAGE[st.go] : "Outside the dashboard (hPanel / app stores)";
      out.push(`| ${i + 1} | ${st.text} | ${st.owner} | ${where} |`);
    });
  }
  return out.join("\n") + "\n";
}
