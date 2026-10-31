// HR module: an AI-first org. Every role is either an AI agent or a human seat; a seat is
// human only when the work must be (legal signatures, live relationships, final hiring calls).
// Hiring runs the same way: AI screens and drafts, people interview, decide and sign.
import { BRIEF_FIELDS } from "./catalog.js";

export const DEPARTMENTS = ["Leadership", "Sales", "Marketing", "Customer Success", "Product & Engineering", "Operations", "Finance & Admin"];
export const ROLE_STATUS = ["active", "open", "planned", "paused"];
export const EMPLOYMENT = ["Full-time", "Part-time", "Freelance", "Contract", "AI agent"];

export const CAND_STAGES = [
  { id: "applied", name: "Applied" },
  { id: "screened", name: "AI screened" },
  { id: "interview", name: "Interview" },
  { id: "offer", name: "Offer" },
  { id: "hired", name: "Hired" },
  { id: "rejected", name: "Rejected" },
];
export const CAND_STAGE_IDS = CAND_STAGES.map((s) => s.id);

const daysSince = (iso, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : 0);

// Suggested AI-first org for DPA AD: AI agents for the repeatable work, a small human core.
export const SUGGESTED_ORG = [
  { title: "Founder & CEO", department: "Leadership", kind: "human", status: "active", employment: "Full-time", holder: "Founder", must_be_human: "Owns strategy, fundraising, partnerships, contracts and every final hiring call." },
  { title: "AI Prospector", department: "Sales", kind: "ai", status: "active", employment: "AI agent", holder: "Sales module", duties: "Finds Saudi stores and drafts first messages." },
  { title: "AI Follow-up", department: "Sales", kind: "ai", status: "active", employment: "AI agent", holder: "Sales module", duties: "Drafts every follow-up and demo invite." },
  { title: "Sales & Partnerships Lead (KSA)", department: "Sales", kind: "human", status: "planned", employment: "Full-time", location: "Riyadh", salary_min: 12000, salary_max: 18000, must_be_human: "Live calls with large stores and agencies, negotiating discounts, Salla/Zid partnerships." },
  { title: "AI Marketer", department: "Marketing", kind: "ai", status: "active", employment: "AI agent", holder: "Playbooks", duties: "Positioning, landing pages, ads, social posts, SEO and content calendar." },
  { title: "AI Analyst", department: "Marketing", kind: "ai", status: "active", employment: "AI agent", holder: "KPI report", duties: "Weekly KPI report and the bottleneck to fix." },
  { title: "Arabic Content & Creator Partnerships", department: "Marketing", kind: "human", status: "planned", employment: "Freelance", location: "Remote (KSA)", salary_min: 4000, salary_max: 7000, must_be_human: "On-camera content, creator relationships, final Saudi-dialect tone check." },
  { title: "AI Success", department: "Customer Success", kind: "ai", status: "active", employment: "AI agent", holder: "Sales module", duties: "Onboards beta stores, watches usage, prepares objection answers." },
  { title: "AI Support", department: "Customer Success", kind: "ai", status: "active", employment: "AI agent", holder: "Support module", duties: "Answers merchant questions in Arabic and English, 24/7, from the help center; hands refunds, legal, bugs and upset customers to a person." },
  { title: "Customer Success Lead (Arabic)", department: "Customer Success", kind: "human", status: "planned", employment: "Full-time", location: "Riyadh", salary_min: 9000, salary_max: 14000, must_be_human: "Onboarding calls for Scale/Enterprise stores, handles AI Support escalations, saves at-risk accounts." },
  { title: "AI Feed Doctor", department: "Product & Engineering", kind: "ai", status: "planned", employment: "AI agent", duties: "Reads failed feed imports, explains the error to the merchant in plain Arabic/English and how to fix it." },
  { title: "AI Creative QA", department: "Product & Engineering", kind: "ai", status: "planned", employment: "AI agent", duties: "Checks every rendered ad before export: wrong prices, broken Arabic text, cropped products, off-brand colours." },
  { title: "Template & Motion Designer", department: "Product & Engineering", kind: "human", status: "open", employment: "Freelance", location: "Remote", salary_min: 6000, salary_max: 10000, must_be_human: "Original ad template design, Arabic typography and motion taste that set DPA AD apart; AI then scales each template across every SKU." },
  { title: "Product Engineer (full-stack)", department: "Product & Engineering", kind: "human", status: "open", employment: "Full-time", location: "Remote", salary_min: 15000, salary_max: 25000, must_be_human: "Owns production systems, security and Salla/Zid/Shopify integrations." },
  { title: "AI Recruiter", department: "Operations", kind: "ai", status: "active", employment: "AI agent", holder: "HR module", duties: "Writes job posts, screens CVs, drafts interview kits, onboarding and rejections." },
  { title: "Bookkeeping & VAT (outsourced)", department: "Finance & Admin", kind: "human", status: "planned", employment: "Contract", must_be_human: "Licensed accountant for ZATCA VAT filing and payroll (GOSI)." },
];

export function candidateNext(c, role, now = Date.now()) {
  const quiet = daysSince(c.last_activity_at, now);
  const ai = (text, task, urgent = false) => ({ owner: "ai", text, task, urgent });
  const you = (text, urgent = true) => ({ owner: "you", text, task: null, urgent });
  switch (c.stage) {
    case "applied": return c.cv_text ? ai("Screen the CV against the role scorecard", "screen", quiet >= 2) : you("Paste the CV or LinkedIn profile so AI can screen it", quiet >= 2);
    case "screened": if (c.score == null) return you("Read the AI screen and decide: interview or not", quiet >= 3);
      return c.score >= 7
      ? ai("Strong fit: draft the interview invite and interview kit", "interview_kit", quiet >= 3)
      : ai("Weak fit: draft a kind rejection message", "rejection", quiet >= 3);
    case "interview": return you(`Interview ${c.name} and record your decision`, quiet >= 5);
    case "offer": return you("Send the offer and sign the contract");
    case "hired": return ai(`Write ${c.name}'s 30/60/90 onboarding plan`, "onboarding");
    case "rejected": return ai("Draft a kind rejection message", "rejection");
    default: return ai("Review this candidate", null);
  }
}

export function enrichCandidate(c, roles, now = Date.now()) {
  const role = roles.find((r) => r.id === c.role_id) || null;
  return { ...c, role_title: role?.title || "No role", days_quiet: daysSince(c.last_activity_at, now), next: candidateNext(c, role, now) };
}

export function hrSummary(roles, candidates, activities, now = Date.now()) {
  const enriched = candidates.map((c) => enrichCandidate(c, roles, now));
  const open = enriched.filter((c) => !["hired", "rejected"].includes(c.stage));
  const live = roles.filter((r) => r.status === "active");
  const weekAgo = now - 7 * 864e5;
  const recent = activities.filter((a) => Date.parse(a.created_at) >= weekAgo && a.by === "ai");
  const payroll = roles.filter((r) => r.kind === "human" && ["active", "open", "planned"].includes(r.status))
    .reduce((a, r) => a + ((Number(r.salary_min) || 0) + (Number(r.salary_max) || 0)) / ((r.salary_min && r.salary_max) ? 2 : 1), 0);
  return {
    humans: live.filter((r) => r.kind === "human").length,
    agents: live.filter((r) => r.kind === "ai").length,
    ai_share: roles.length ? Math.round((roles.filter((r) => r.kind === "ai").length / roles.length) * 100) : 0,
    open_roles: roles.filter((r) => r.status === "open").length,
    planned_roles: roles.filter((r) => r.status === "planned").length,
    candidates: open.length,
    planned_payroll_sar: Math.round(payroll),
    needs_you: open.filter((c) => c.next.owner === "you").map((c) => ({ id: c.id, name: c.name, text: c.next.text })),
    ai_week: { drafts: recent.length, screens: recent.filter((a) => a.task === "screen").length },
  };
}

// ---- AI drafts (reviewed by a person before anything is sent or posted)
export const ROLE_TASKS = {
  job_post: { title: "Job post (AR + EN)", task: (r) => `Write a job post for "${r.title}" (${r.employment}, ${r.location || "location flexible"}${r.salary_min ? `, SAR ${r.salary_min}-${r.salary_max}/month` : ""}). Make clear we are an AI-first company: AI agents do the repeatable work and this person owns what must be human: ${r.must_be_human || "see duties"}. Sections: About DPA AD, The role, What you'll own, What AI handles for you, You have, Nice to have, How to apply. Write it in English, then the full post in Modern Standard Arabic under "## بالعربية".` },
  scorecard: { title: "Scorecard + interview kit", task: (r) => `Create a hiring scorecard for "${r.title}": 4-6 outcomes for the first year, 6 competencies each with what a 1/5 and a 5/5 look like, 8 structured interview questions mapped to competencies, one practical take-home task (max 2 hours), and red flags. Keep it specific to an AI-first ecommerce SaaS in Saudi Arabia.` },
  plan_30_60_90: { title: "30/60/90-day plan", task: (r) => `Write a 30/60/90-day plan for a new "${r.title}". For each period: goals, concrete deliverables, which AI agents they will work with and how, and the measurable result that shows success.` },
  agent_spec: { title: "AI agent spec", task: (r) => `Write an operating spec for the AI agent "${r.title}": its job, inputs it reads, outputs it produces, what it may do on its own, what it must hand to a human (and to whom), quality checks, and the 3 KPIs that show it is working. Duties: ${r.duties || "see title"}.` },
};

export const CANDIDATE_TASKS = {
  screen: { title: "AI screen", task: (c, r) => `Screen this candidate for "${r?.title || "the role"}". First line exactly "SCORE: n/10" (fit against the role). Then: ## Summary (3 lines), ## Strengths, ## Gaps or risks, ## Questions to ask in the interview (5), ## Recommendation (interview or not, and why). Judge only on the CV text given; do not invent experience. Ignore name, gender, age, nationality and photo; judge skills and evidence only.\n\n<cv>\n${(c.cv_text || "").slice(0, 12000)}\n</cv>` },
  interview_kit: { title: "Interview invite + kit", task: (c, r) => `Write (1) a short interview invitation to ${c.name} for "${r?.title || "the role"}" in English and Arabic, with [DATE/TIME] placeholders, and (2) a 45-minute interview plan for the interviewer with timings and questions tailored to this candidate's CV and the gaps noted in the AI screen.` },
  rejection: { title: "Rejection message", task: (c, r) => `Write a short, kind and respectful rejection message to ${c.name} for "${r?.title || "the role"}" in English and Arabic. No fake reasons; thank them and keep the door open where appropriate.` },
  onboarding: { title: "Onboarding plan", task: (c, r) => `Write a first-two-weeks onboarding checklist for ${c.name}, new "${r?.title || "team member"}": accounts to create, people and AI agents to meet, documents to read (brief, SOP, pricing), first tasks, and the 30/60/90 goals. Also list the Saudi admin steps to check (contract, GOSI, Qiwa/Mudad where applicable) as a checklist for a human to complete.` },
};

function briefBlock(ws) {
  return `<brand_brief>\n${BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n")}\n</brand_brief>`;
}

export function rolePrompt(store, ws, role, task) {
  const org = store.listHrRoles(ws.id).map((r) => `- ${r.title} (${r.kind === "ai" ? "AI agent" : "human"}, ${r.department}, ${r.status})`).join("\n");
  return [briefBlock(ws), `<org_chart>\n${org}\n</org_chart>`,
    `<role>\n- Title: ${role.title}\n- Department: ${role.department}\n- Kind: ${role.kind === "ai" ? "AI agent" : "human"}\n- Employment: ${role.employment}\n- Location: ${role.location || "-"}\n- Salary SAR/month: ${role.salary_min || "-"}–${role.salary_max || "-"}\n- Why human: ${role.must_be_human || "-"}\n- Duties: ${role.duties || "-"}\n- Notes: ${role.notes || "-"}\n</role>`,
    `<task title="${ROLE_TASKS[task].title}">\n${ROLE_TASKS[task].task(role)}\n</task>`,
    "You are DPA AD's AI Recruiter. A person reviews this before it is used. Markdown, no preamble. Never invent company facts beyond the brief."].join("\n\n");
}

export function candidatePrompt(store, ws, cand, role, task) {
  const history = store.listHrActivities("candidate", cand.id).filter((a) => a.task === "screen").slice(0, 1).map((a) => a.text.slice(0, 3000));
  return [briefBlock(ws),
    role ? `<role>\n- Title: ${role.title}\n- Department: ${role.department}\n- Why human: ${role.must_be_human || "-"}\n- Notes: ${role.notes || "-"}\n</role>` : "",
    `<candidate>\n- Name: ${cand.name}\n- Stage: ${cand.stage}\n- Notes: ${cand.notes || "-"}\n</candidate>`,
    history.length ? `<ai_screen>\n${history[0]}\n</ai_screen>` : "",
    `<task title="${CANDIDATE_TASKS[task].title}">\n${CANDIDATE_TASKS[task].task(cand, role)}\n</task>`,
    "You are DPA AD's AI Recruiter. A person reviews this before anything is sent. Be fair and evidence-based. Markdown, no preamble."].filter(Boolean).join("\n\n");
}

export const parseScore = (text) => {
  const m = /SCORE\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i.exec(text || "");
  return m ? Math.max(0, Math.min(10, Number(m[1]))) : null;
};

// Sample people for trying the module. Every name starts with "Sample ·" and can be removed in one click.
export const SAMPLE_TEAM = {
  holders: {
    "Sales & Partnerships Lead (KSA)": "Sample · Faisal Al-Otaibi",
    "Arabic Content & Creator Partnerships": "Sample · Noura Al-Qahtani",
  },
  candidates: [
    { role: "Product Engineer (full-stack)", name: "Sample · Omar Haddad", source: "LinkedIn", stage: "screened", score: 8.5,
      cv_text: "Full-stack engineer, 6 years. Node.js, React, PostgreSQL. Built and maintains two Salla apps (order sync, product feed export). Image pipeline with Sharp and FFmpeg for a print-on-demand startup. Arabic and English.",
      screen: "SCORE: 8.5/10\n## Summary\nStrong full-stack engineer with direct Salla app experience and image/video pipeline work, both core to DPA AD.\n## Strengths\n- Built two Salla apps\n- Sharp/FFmpeg rendering pipeline\n- Bilingual\n## Gaps or risks\n- No Shopify or Zid apps yet\n- No evidence of large-scale queue/rendering infrastructure\n## Questions to ask in the interview\n1. Walk through the Salla feed export: rate limits and failures?\n2. How would you render 50,000 product images per catalog?\n3. Experience with Arabic text shaping in images?\n4. How do you test an image pipeline?\n5. Tell us about a production incident you owned.\n## Recommendation\nInterview. (Sample data.)" },
    { role: "Product Engineer (full-stack)", name: "Sample · Lina Saeed", source: "Bayt", stage: "screened", score: 5.5,
      cv_text: "Front-end developer, 3 years. React, Tailwind, Figma handoff. Built landing pages and dashboards for an agency. Some Node.js. No backend production ownership.",
      screen: "SCORE: 5.5/10\n## Summary\nSolid front-end developer; limited backend and no image pipeline or ecommerce integration work.\n## Strengths\n- Clean React UI work\n## Gaps or risks\n- No production backend ownership\n- No feed or rendering experience\n## Recommendation\nNot for this role now; consider for a future front-end role. (Sample data.)" },
    { role: "Product Engineer (full-stack)", name: "Sample · Khalid Mansour", source: "Referral", stage: "applied", score: null,
      cv_text: "Backend engineer, 4 years. Python and Node.js, AWS Lambda, SQS. Built a product-catalog sync between Zid and a warehouse system. Interested in creative tech." },
    { role: "Template & Motion Designer", name: "Sample · Reem Al-Harbi", source: "Behance", stage: "interview", score: 8,
      cv_text: "Motion and brand designer, 5 years. After Effects, Figma, Lottie. Arabic typography specialist; ad templates for Saudi fashion and perfume brands on Snap and TikTok.",
      screen: "SCORE: 8/10\n## Summary\nArabic typography and Snap/TikTok ad templates match DPA AD's GCC focus.\n## Recommendation\nInterview with a paid test: one perfume template in AR and EN. (Sample data.)" },
    { role: "Customer Success Lead (Arabic)", name: "Sample · Majed Al-Shehri", source: "LinkedIn", stage: "offer", score: 7.5,
      cv_text: "Customer success at a Saudi SaaS (POS for retail), 4 years. Onboarded 200+ merchants, ran Arabic webinars, reduced churn 18%. Salla partner programme contact." },
  ],
};
