// Command Center: one read-only snapshot across every module, for the home screen.
import { GAP_TOTAL, dataGaps } from "./catalog.js";
import { hrSummary } from "./hr.js";
import { STAGES, summary as salesSummary } from "./sales.js";
import { SOP, periodFor } from "./sop.js";
import { supportSummary } from "./support.js";

export const ARR_GOAL = 100_000_000;
export const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];

const within = (iso, days, now) => Date.parse(iso) >= now - days * 864e5;

export function commandSnapshot(store, ws, now = Date.now()) {
  const id = ws.id;
  const deals = store.listDeals(id), dealActs = store.listWorkspaceActivities(id);
  const sales = salesSummary(deals, dealActs, now);
  const roles = store.listHrRoles(id), cands = store.listHrCandidates(id), hrActs = store.listWorkspaceHrActivities(id);
  const hr = hrSummary(roles, cands, hrActs, now);
  const tickets = store.listTickets(id), articles = store.listArticles(id);
  const support = supportSummary(tickets, articles, now);
  const assets = store.listAssets(id), notes = store.listNotes(id), kpis = store.listKpis(id), values = store.listKpiValues(id);

  // Revenue and the path to the ARR goal.
  const arr = sales.paying_mrr * 12;
  const next = MILESTONES.find((m) => m > arr) || ARR_GOAL;
  const funnel = STAGES.filter((s) => s.id !== "lost").map((s) => ({ id: s.id, name: s.name, count: deals.filter((d) => d.stage === s.id).length }));

  // Work done this week, by AI vs by people, per module.
  const wk = (a) => within(a.created_at || a.at, 7, now);
  const supMsgs = tickets.flatMap((t) => t.messages.filter((m) => m.from !== "customer" && wk(m)));
  const work = [
    { module: "Marketing", route: "playbooks", ai: assets.filter(wk).length, people: 0 },
    { module: "Sales", route: "pipeline", ai: dealActs.filter((a) => wk(a) && a.by === "ai").length, people: dealActs.filter((a) => wk(a) && a.by === "you" && a.type !== "created").length },
    { module: "Support", route: "support", ai: supMsgs.filter((m) => m.from === "ai").length, people: supMsgs.filter((m) => m.from === "you").length },
    { module: "Hiring", route: "team", ai: hrActs.filter((a) => wk(a) && a.by === "ai").length, people: hrActs.filter((a) => wk(a) && a.by === "you" && a.type !== "created").length },
  ];
  const aiTotal = work.reduce((a, w) => a + w.ai, 0), peopleTotal = work.reduce((a, w) => a + w.people, 0);

  // Everything waiting on a person, across modules.
  const needs = [
    ...sales.needs_you.map((n) => ({ module: "Sales", route: "pipeline", param: n.id, title: n.name, text: n.text })),
    ...support.needs_you.map((n) => ({ module: "Support", route: "support", param: null, title: n.name, text: n.reason || "Needs a person" })),
    ...hr.needs_you.map((n) => ({ module: "Hiring", route: "team", param: null, title: n.name, text: n.text })),
  ];

  // SOP progress for the current periods.
  const periods = Object.fromEntries(SOP.map((s) => [s.cadence, periodFor(s.cadence, new Date(now))]));
  const checks = new Set(store.listSopChecks(id, Object.values(periods)).map((c) => c.step));
  const sop = SOP.map((s) => {
    const done = s.steps.filter((st) => checks.has(`${s.cadence}:${st.id}`)).length;
    const nextStep = s.steps.find((st) => !checks.has(`${s.cadence}:${st.id}`));
    return { cadence: s.cadence, title: s.title, period: periods[s.cadence], done, total: s.steps.length, next: nextStep ? nextStep.text : null };
  });

  // KPI sparklines: the KPIs with data, latest values first.
  const byKpi = {};
  for (const v of values) (byKpi[v.kpi_id] ||= []).push(v);
  const kpiCards = kpis.filter((k) => byKpi[k.id]?.length).slice(0, 8).map((k) => {
    const series = byKpi[k.id].slice(-12);
    const last = series.at(-1), prev = series.at(-2);
    return { name: k.name, stage: k.stage, unit: k.unit, target: k.target, higher_is_better: k.higher_is_better, last: last.value, period: last.period, change: prev ? last.value - prev.value : null, series: series.map((v) => v.value) };
  });

  // Recent activity across modules.
  const feed = [
    ...dealActs.filter((a) => a.type !== "created").map((a) => { const d = deals.find((x) => x.id === a.deal_id); return { at: a.created_at, module: "Sales", by: a.by, text: a.type === "stage" ? `${d?.name}: ${a.text}` : a.type === "ai_draft" ? `AI drafted a ${a.task?.replace("_", " ")} for ${d?.name}` : `${a.type === "sent" ? "Sent a message to" : "Note on"} ${d?.name}`, route: "pipeline" }; }),
    ...hrActs.filter((a) => a.type !== "created").map((a) => { const c = a.entity === "candidate" ? cands.find((x) => x.id === a.entity_id) : null; const r = a.entity === "role" ? roles.find((x) => x.id === a.entity_id) : null; return { at: a.created_at, module: "Hiring", by: a.by, text: a.type === "stage" ? `${c?.name}: ${a.text}` : a.type === "ai_draft" ? `AI drafted ${a.task?.replace(/_/g, " ")} for ${c?.name || r?.title}` : `Note on ${c?.name || r?.title}`, route: "team" }; }),
    ...tickets.flatMap((t) => t.messages.map((m) => ({ at: m.at, module: "Support", by: m.from === "customer" ? "customer" : m.from, text: m.from === "customer" ? `${t.customer_name || "A customer"} wrote via ${t.channel}` : `${m.from === "ai" ? "AI" : "You"} replied to ${t.customer_name || "a customer"}`, route: "support" }))),
    ...assets.map((a) => ({ at: a.created_at, module: "Marketing", by: "ai", text: `AI wrote ${a.title}`, route: "library" })),
  ].filter((f) => f.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);

  const gaps = dataGaps(ws.brief, notes, kpis.length, Object.keys(byKpi).length);

  return {
    company: ws.brief.company_name,
    goal: { arr_goal: ARR_GOAL, arr, next_milestone: next, milestones: MILESTONES, pct_of_goal: arr / ARR_GOAL },
    revenue: { paying_mrr: sales.paying_mrr, expected_mrr: sales.expected_mrr, paying: sales.paying_count, open_deals: sales.open_count, open_value: sales.open_value, funnel },
    work: { modules: work, ai: aiTotal, people: peopleTotal, ai_share: aiTotal + peopleTotal ? Math.round((aiTotal / (aiTotal + peopleTotal)) * 100) : null },
    team: { agents: hr.agents, humans: hr.humans, ai_share_roles: hr.ai_share, open_roles: hr.open_roles, planned_roles: hr.planned_roles, candidates: hr.candidates, payroll_sar: hr.planned_payroll_sar },
    support: { open: support.open, needs_you: support.needs_you.length, ai_resolved_pct: support.ai_resolved_pct, articles: support.articles, chat_on: !!ws.support?.widget_enabled },
    needs,
    sop,
    kpis: kpiCards,
    kpis_defined: kpis.length,
    data_completeness: Math.round(((GAP_TOTAL - gaps.length) / GAP_TOTAL) * 100),
    gaps: gaps.slice(0, 3),
    feed,
  };
}

