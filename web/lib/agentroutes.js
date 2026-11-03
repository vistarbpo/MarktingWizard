// HTTP routes for AI Workforce (module "workforce" in Teams & roles).
import { AGENTS, LEVELS, PRICES, agentDef } from "./agents.js";

// Which office room a person or a hiring role sits in, from their team or department name.
const roomFor = (t) => {
  const s = String(t || "").toLowerCase();
  return /customer|support|success/.test(s) ? "Customer Success" : /leadership|founder|\bceo\b|chief/.test(s) ? "Leadership" : /sales|growth/.test(s) ? "Sales"
    : /market|creative|content|design/.test(s) ? "Marketing" : /product|engineer|develop|tech/.test(s) ? "Product" : /financ|account/.test(s) ? "Finance"
    : /oper|ops|admin/.test(s) ? "Operations" : /people|hr|recruit|hiring/.test(s) ? "People" : null;
};

export function workforceSummary(store, wf) {
  const users = store.db.users.filter((u) => u.active);
  const agents = AGENTS.map((d) => ({ ...d, config: wf.config(d.id), stats: wf.stats(d.id) }));
  const active = agents.filter((a) => a.config.level > 0 && !a.config.paused);
  const cost = agents.reduce((s, a) => s + a.stats.cost_month, 0), budget = agents.reduce((s, a) => s + (a.config.budget_usd || 0), 0);
  const judged = agents.reduce((s, a) => s + a.stats.judged, 0), accepted = agents.reduce((s, a) => s + a.stats.outcomes.accepted, 0);
  const plannedHumans = (store.db.hr_roles || []).filter((r) => r.kind === "human" && ["open", "planned"].includes(r.status)).length;
  const needs = [];
  for (const a of agents) {
    const nm = a.name;
    if (a.stats.can_promote) needs.push({ agent: a.id, kind: "promote", text: `${nm} earned a higher level: 95%+ of its last 50 items were used unchanged.` });
    if (a.stats.budget_pct >= 80) needs.push({ agent: a.id, kind: "budget", text: `${nm} has used ${a.stats.budget_pct}% of its $${a.config.budget_usd} monthly budget.` });
    if (a.stats.errors_month >= 3) needs.push({ agent: a.id, kind: "errors", text: `${nm} failed ${a.stats.errors_month} times this month: check the log.` });
    if (!a.config.owner_id && users.length) needs.push({ agent: a.id, kind: "owner", text: `${nm} has no person responsible.`, soft: true });
    const demoted = store.db.agents[a.id]?.demoted_at;
    if (demoted && Date.now() - Date.parse(demoted) < 7 * 864e5) needs.push({ agent: a.id, kind: "demoted", text: `${nm} was moved down a level after mistakes: review its recent work.` });
  }
  return {
    agents, levels: LEVELS,
    totals: { agents: AGENTS.length, active: active.length, autonomous: agents.filter((a) => a.config.level >= 2).length, people: users.length, planned_people: plannedHumans,
      cost_month: Math.round(cost * 100) / 100, budget_month: Math.round(budget), runs_month: agents.reduce((s, a) => s + a.stats.runs_month, 0),
      quality: judged ? Math.round((accepted / judged) * 1000) / 10 : null, judged },
    needs, prices: PRICES,
    people: users.map((u) => {
      const owns = AGENTS.filter((d) => wf.config(d.id).owner_id === u.id);
      const teams = (u.team_ids || []).map((t) => store.db.teams.find((x) => x.id === t)?.name).filter(Boolean);
      return { id: u.id, name: u.name, role: store.db.roles.find((r) => r.id === u.role_id)?.name || u.role_id, owns: owns.map((d) => d.name),
        room: owns[0]?.team || roomFor(teams.join(" ")) || ({ owner: "Leadership", admin: "Leadership", finance: "Finance", creative: "Marketing", manager: "Sales" })[u.role_id] || "People" };
    }),
    // Open and planned human roles from Team & hiring, shown as empty desks in their room.
    hiring: (store.db.hr_roles || []).filter((r) => r.kind === "human" && ["open", "planned"].includes(r.status)).slice(0, 20)
      .map((r) => ({ id: r.id, title: r.title, status: r.status, room: roomFor(`${r.department || ""} ${r.title || ""}`) || "People" })),
  };
}

export function mountWorkforce(app, { store, workforce: wf }) {
  const by = (req) => req.user?.name || "you";
  app.get("/api/workforce", (req, res) => res.json(workforceSummary(store, wf)));
  app.get("/api/workforce/agents/:id", (req, res) => {
    const d = agentDef(req.params.id);
    if (!d) return res.status(404).json({ detail: "Agent not found" });
    res.json({ ...d, config: wf.config(d.id), stats: wf.stats(d.id),
      runs: store.db.agent_runs.filter((r) => r.agent_id === d.id).slice(-60).reverse(),
      events: store.db.agent_events.filter((e) => e.agent_id === d.id).slice(-60).reverse() });
  });
  app.put("/api/workforce/agents/:id", (req, res) => {
    const d = agentDef(req.params.id);
    if (!d) return res.status(404).json({ detail: "Agent not found" });
    const b = req.body || {};
    if (b.level !== undefined && (Number(b.level) > d.max || Number(b.level) < 0)) return res.status(422).json({ detail: `${d.name} supports levels 0–${d.max}.` });
    if (b.owner_id && !store.db.users.some((u) => u.id === String(b.owner_id) && u.active)) return res.status(422).json({ detail: "Pick an active person." });
    res.json(wf.set(d.id, b, by(req)));
  });
  app.post("/api/workforce/agents/:id/promote", (req, res) => {
    const d = agentDef(req.params.id);
    if (!d) return res.status(404).json({ detail: "Agent not found" });
    const s = wf.stats(d.id);
    if (!s.can_promote) return res.status(422).json({ detail: s.promote_hint });
    res.json(wf.set(d.id, { level: wf.config(d.id).level + 1 }, by(req)));
  });
}
