// Operations: the company's work board, deadlines (Saudi compliance + renewals), tool stack and incidents.
// AI plans goals into tasks and owns every task it can; people own approvals, filings, signatures,
// customer calls and incident decisions.
import { BRIEF_FIELDS } from "./catalog.js";

export const AREAS = ["Marketing", "Sales", "Support", "Finance", "People", "Product", "Operations"];
export const TASK_STATUS = [
  { id: "todo", name: "To do" }, { id: "doing", name: "Doing" }, { id: "waiting", name: "Waiting" }, { id: "done", name: "Done" },
];
export const TASK_STATUS_IDS = TASK_STATUS.map((s) => s.id);
export const REPEATS = ["none", "monthly", "quarterly", "yearly"];
export const SEVERITY = ["SEV1", "SEV2", "SEV3"];
export const INCIDENT_STATUS = ["open", "monitoring", "resolved"];

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
export function rollForward(due, repeats) {
  const d = new Date(due + "T00:00:00Z");
  if (repeats === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (repeats === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (repeats === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else return null;
  return iso(d);
}

// Starter Saudi compliance calendar. Dates are placeholders to confirm with your accountant / PRO.
export function saudiStarter(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const nextMonth15 = iso(new Date(Date.UTC(y, m + 1, 15)));
  const nextMonth10 = iso(new Date(Date.UTC(y, m + 1, 10)));
  const qEnd = new Date(Date.UTC(y, Math.floor(m / 3) * 3 + 3, 0));
  const vatDue = iso(new Date(Date.UTC(qEnd.getUTCFullYear(), qEnd.getUTCMonth() + 2, 0)));
  return [
    { title: "GOSI contributions for last month", category: "compliance", due: nextMonth15, repeats: "monthly", owner: "Founder", notes: "Social insurance for Saudi and non-Saudi staff. Confirm the exact due day in the GOSI portal." },
    { title: "Payroll via Mudad / WPS", category: "compliance", due: nextMonth10, repeats: "monthly", owner: "Founder", notes: "Wage Protection System upload once you have employees. Confirm timing." },
    { title: "VAT return to ZATCA (if registered)", category: "tax", due: vatDue, repeats: "quarterly", owner: "Bookkeeping & VAT (outsourced)", notes: "Only once VAT-registered. See Finance → Reports & VAT." },
    { title: "Zakat & income tax return to ZATCA", category: "tax", due: `${y + 1}-04-30`, repeats: "yearly", owner: "Bookkeeping & VAT (outsourced)", notes: "Usually within 120 days of the financial year end. Confirm with your accountant." },
    { title: "Commercial Registration (CR) renewal", category: "compliance", due: iso(addDays(now, 90)), repeats: "yearly", owner: "Founder", notes: "Set the real date from your CR certificate." },
    { title: "Chamber of Commerce membership renewal", category: "compliance", due: iso(addDays(now, 90)), repeats: "yearly", owner: "Founder", notes: "Usually renewed with the CR. Set the real date." },
    { title: "Personal data protection (PDPL) review", category: "compliance", due: iso(addDays(now, 60)), repeats: "yearly", owner: "Founder", notes: "Review privacy notice, data processing records and merchant data handling under the PDPL." },
    { title: "dpa.ad domain renewal", category: "renewal", due: iso(addDays(now, 120)), repeats: "yearly", owner: "Founder", notes: "Set the real expiry date from your registrar." },
  ].map((x) => ({ ...x, starter: true }));
}

const daysUntil = (date, now) => Math.ceil((Date.parse(date + "T00:00:00Z") - now.getTime()) / 864e5);

export function opsSnapshot({ tasks, deadlines, vendors, incidents, now = new Date() }) {
  const today = iso(now);
  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.due && t.due < today);
  const vendorDeadlines = vendors.filter((v) => v.renewal_date).map((v) => ({ id: "v" + v.id, vendor_id: v.id, title: `Renew ${v.name}`, category: "renewal", due: v.renewal_date, repeats: "yearly", owner: v.owner || "Founder", notes: v.cost_sar ? `SAR ${v.cost_sar}/month` : "", from_vendor: true }));
  const upcoming = [...deadlines.filter((d) => !d.done_at), ...vendorDeadlines]
    .map((d) => ({ ...d, days: daysUntil(d.due, now) })).sort((a, b) => a.due.localeCompare(b.due));
  const openInc = incidents.filter((i) => i.status !== "resolved");
  const needs = [
    ...openInc.filter((i) => i.severity !== "SEV3").map((i) => ({ tab: "incidents", text: `${i.severity} open: ${i.title}`, id: i.id })),
    ...upcoming.filter((d) => d.days <= 14).map((d) => ({ tab: "deadlines", text: `${d.days < 0 ? `Overdue by ${-d.days}d` : d.days === 0 ? "Due today" : `Due in ${d.days}d`}: ${d.title}`, id: d.id })),
    ...overdue.filter((t) => t.owner_kind === "human").map((t) => ({ tab: "board", text: `Overdue task: ${t.title} (${t.owner || "unassigned"})`, id: t.id })),
    ...openTasks.filter((t) => t.status === "waiting" && t.owner_kind === "human" && !overdue.includes(t)).map((t) => ({ tab: "board", text: `Waiting on a person: ${t.title}`, id: t.id })),
  ];
  const stackCost = vendors.reduce((a, v) => a + (Number(v.cost_sar) || 0), 0);
  const weekAgo = iso(addDays(now, -7));
  return {
    tasks: {
      open: openTasks.length, overdue: overdue.length,
      ai_owned_pct: openTasks.length ? Math.round((openTasks.filter((t) => t.owner_kind === "ai").length / openTasks.length) * 100) : null,
      done_week: tasks.filter((t) => t.status === "done" && t.done_at && t.done_at.slice(0, 10) >= weekAgo).length,
      by_area: AREAS.map((a) => ({ area: a, open: openTasks.filter((t) => t.area === a).length, ai: openTasks.filter((t) => t.area === a && t.owner_kind === "ai").length })).filter((x) => x.open),
    },
    deadlines: upcoming,
    next_deadline: upcoming[0] || null,
    stack: { count: vendors.length, cost_sar: Math.round(stackCost), critical: vendors.filter((v) => v.critical).length },
    incidents: { open: openInc.length, last: [...incidents].sort((a, b) => b.started_at.localeCompare(a.started_at))[0] || null },
    needs,
  };
}

// ---- AI
export function planPrompt(ws, goal, roles) {
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");
  const agents = roles.filter((r) => r.kind === "ai").map((r) => `${r.title} (${r.duties || r.department})`);
  const people = roles.filter((r) => r.kind === "human").map((r) => `${r.title}${r.holder ? " – " + r.holder : ""}`);
  return `<company>\n${brief}\n</company>
<ai_agents>\n${agents.join("\n") || "AI Marketer, AI Prospector, AI Follow-up, AI Support, AI Recruiter, AI CFO"}\n</ai_agents>
<people>\n${people.join("\n") || "Founder & CEO"}\n</people>
<goal>${goal}</goal>
Break this goal into 5-12 concrete tasks. Assign each to an AI agent whenever AI can do it (writing, research, analysis, drafting, monitoring); assign it to a person only when it must be human (approvals, payments, filings, signatures, live calls, partnerships, final decisions). Return ONLY a JSON array, no prose, items:
{"title":"verb-first task","owner_kind":"ai|human","owner":"exact agent or role name from the lists","area":"one of ${AREAS.join("|")}","priority":1|2|3,"due_in_days":number,"why":"one line"}`;
}

export function parsePlan(text) {
  const raw = String(text || ""), s = raw.indexOf("["), e = raw.lastIndexOf("]");
  if (s < 0 || e <= s) return null;
  let arr; try { arr = JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 20).map((x) => ({
    title: String(x?.title || "").trim().slice(0, 200),
    owner_kind: x?.owner_kind === "human" ? "human" : "ai",
    owner: String(x?.owner || "").slice(0, 120),
    area: AREAS.includes(x?.area) ? x.area : "Operations",
    priority: [1, 2, 3].includes(Number(x?.priority)) ? Number(x.priority) : 2,
    due_in_days: Math.max(0, Math.min(365, Math.round(Number(x?.due_in_days) || 7))),
    why: String(x?.why || "").slice(0, 300),
  })).filter((x) => x.title);
}

export const OPS_TASKS = {
  automation_review: { title: "Automation review", task: (ctx) => `Review the open tasks, recurring deadlines and tool stack below. List what a person is still doing that an AI agent could take over (with the agent, the change, and the hours/month saved), what must stay human and why, and the 5 changes to make first.\n\n${ctx}` },
  weekly_ops: { title: "Weekly operations brief", task: (ctx) => `Write a one-page weekly operations brief for the founder: what's overdue, deadlines in the next 30 days, incidents, tool costs, and the top 5 priorities for the week with owners (AI agent or person).\n\n${ctx}` },
};

export function opsReportPrompt(ws, task, ctx) {
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");
  return `<company>\n${brief}\n</company>\n\n<task title="${OPS_TASKS[task].title}">\n${OPS_TASKS[task].task(ctx)}\n</task>\n\nYou are DPA AD's AI Operations agent. Use only the data given. Markdown, no preamble.`;
}

export function incidentPrompt(ws, inc) {
  const brief = BRIEF_FIELDS.filter(([k]) => ws.brief[k]).map(([k, l]) => `- ${l}: ${ws.brief[k]}`).join("\n");
  const updates = (inc.updates || []).map((u) => `- ${u.at}: ${u.text}`).join("\n") || "none";
  return `<company>\n${brief}\n</company>
<incident>\n- Title: ${inc.title}\n- Severity: ${inc.severity}\n- Status: ${inc.status}\n- Started: ${inc.started_at}\n- Resolved: ${inc.resolved_at || "not yet"}\n- Impact: ${inc.impact || "unknown"}\n- Notes: ${inc.notes || "-"}\n- Timeline:\n${updates}\n</incident>
Write two things:
## Customer notice
A short, honest status message for affected merchants in English, then Arabic. What happened, who is affected, what we're doing, when the next update comes. No blame, no speculation beyond the facts.
## Postmortem
Summary, timeline, impact, root cause (or "unknown yet"), what went well, what went wrong, and action items with an owner type (AI agent or person). Use only the facts given; mark guesses as [TO CONFIRM].
Markdown, no preamble. A person reviews and decides before anything is published.`;
}
