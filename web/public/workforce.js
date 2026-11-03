/* AI Workforce: every AI agent managed like an employee. Job, person responsible, autonomy level
   (earned from its track record), monthly budget, cost, quality and a log of everything it did.
   Uses app.js globals (S, $, api, esc, toast, fmtDate, ROUTES, levelFor). */

const WF = { d: null, openId: null, team: "" };
const wfEdit = () => levelFor("workforce") === "edit";
const wfUsd = (n) => "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n || 0).toFixed(2));
const WF_TONE = ["", "", "accent", "good"];

ROUTES.workforce = { title: "AI Workforce", crumb: "AI Workforce", render: renderWorkforce };

async function renderWorkforce(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  WF.d = await api("/api/workforce");
  $("#pageActions").innerHTML = "";
  wfRerender();
}

function wfRerender() {
  if (S.route !== "workforce") return;
  const d = WF.d, t = d.totals, edit = wfEdit();
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  const teams = [...new Set(d.agents.map((a) => a.team))];
  const list = d.agents.filter((a) => !WF.team || a.team === WF.team);
  const hard = d.needs.filter((n) => !n.soft), noOwner = d.needs.filter((n) => n.kind === "owner").length;
  const needRows = [...hard.map((n) => `<li class="clickable" data-wfopen="${n.agent}"><span class="cc-mod" style="background:${n.kind === "promote" ? "var(--good)" : "var(--warn)"}"></span><span class="s-small">${esc(n.text)}</span></li>`),
    ...(noOwner ? [`<li><span class="cc-mod" style="background:var(--text-3)"></span><span class="s-small">${noOwner} agent${noOwner === 1 ? " has" : "s have"} no person responsible: pick one in the table below.</span></li>`] : [])];
  $("#view").innerHTML = `<section class="s-kpis">
      ${tile("AI agents working", `${t.active} / ${t.agents}`, `${t.autonomous} act on their own (level 2+)`, "good")}
      ${tile("People", t.people, `${t.planned_people} hires planned · ${t.people ? (t.active / Math.max(1, t.people)).toFixed(1) : "–"} agents per person`)}
      ${tile("AI cost this month", wfUsd(t.cost_month), `budget ${wfUsd(t.budget_month)}`, t.budget_month && t.cost_month / t.budget_month > 0.8 ? "warn" : "")}
      ${tile("Runs this month", t.runs_month.toLocaleString("en-US"), "AI calls across every module")}
      ${tile("Used unchanged", t.quality == null ? "–" : t.quality + "%", t.judged ? `of the last ${t.judged} reviewed items` : "no reviewed items yet", t.quality != null && t.quality < 80 ? "warn" : "")}
    </section>
    <div class="card c-banner" style="margin-top:16px"><b>How agents earn autonomy:</b> ${d.levels.map((l) => `<span class="badge ${WF_TONE[l.id] || ""}">${l.id} · ${esc(l.name)}</span>`).join(" ")}
      <span class="subtle s-small"> An agent can move up after 50 reviewed items with 95%+ used unchanged and no errors. It drops a level automatically after 3 rejections or errors in its last 20 items.</span></div>
    ${needRows.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Needs attention</h2><span class="badge ${hard.length ? "warn" : ""}">${hard.length || "–"}</span></div><ul class="cc-list" style="padding:8px 20px 16px">${needRows.join("")}</ul></div>` : ""}
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Org chart</h2><span class="subtle s-small">People own the agents in their area; agents do the repeatable work.</span></div>
      <div class="wf-org">${teams.map((tm) => { const ag = d.agents.filter((a) => a.team === tm); const owners = [...new Set(ag.map((a) => d.people.find((p) => p.id === a.config.owner_id)?.name).filter(Boolean))];
        return `<div class="wf-team"><b>${esc(tm)}</b><div class="wf-people">${owners.map((o) => `<span class="badge">👤 ${esc(o)}</span>`).join(" ") || `<span class="subtle s-small">no person assigned</span>`}</div>
          <div class="wf-agents">${ag.map((a) => `<button class="wf-chip lv${a.config.paused ? 0 : a.config.level}" data-wfopen="${a.id}" title="${esc(a.job)}"><i></i>${esc(a.name.replace(/^AI /, ""))}<small>L${a.config.paused ? 0 : a.config.level}</small></button>`).join("")}</div></div>`; }).join("")}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Agents</h2><div class="s-tabs">${["", ...teams].map((tm) => `<button data-wfteam="${esc(tm)}" aria-selected="${WF.team === tm}">${esc(tm || "All")}</button>`).join("")}</div></div>
      <div class="table-wrap"><table class="wf-table"><thead><tr><th>Agent</th><th>Level</th><th>Person responsible</th><th>This month</th><th>Used unchanged</th><th>Last run</th></tr></thead><tbody>
      ${list.map((a) => { const c = a.config, s = a.stats, pct = c.budget_usd ? Math.min(100, (s.cost_month / c.budget_usd) * 100) : 0;
        return `<tr><td><button class="linklike" data-wfopen="${a.id}"><b>${esc(a.name)}</b></button><div class="subtle s-small">${esc(a.team)} · ${esc(a.job)}</div></td>
          <td>${edit ? `<select class="input input-sm" data-wflevel="${a.id}" style="width:auto">${d.levels.filter((l) => l.id <= a.max).map((l) => `<option value="${l.id}" ${l.id === (c.paused ? 0 : c.level) ? "selected" : ""}>${l.id} · ${esc(l.name)}</option>`).join("")}</select>` : `<span class="badge ${WF_TONE[c.level]}">${c.level} · ${esc(d.levels[c.level].name)}</span>`}
            ${s.can_promote ? `<div><span class="badge good">ready to move up</span></div>` : ""}</td>
          <td>${edit ? `<select class="input input-sm" data-wfowner="${a.id}" style="width:auto"><option value="">Nobody</option>${d.people.map((p) => `<option value="${p.id}" ${p.id === c.owner_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : esc(d.people.find((p) => p.id === c.owner_id)?.name || "–")}</td>
          <td style="min-width:150px"><span class="num">${wfUsd(s.cost_month)}</span> <span class="subtle s-small">of ${wfUsd(c.budget_usd)} · ${s.runs_month} runs${s.errors_month ? ` · <span style="color:var(--bad)">${s.errors_month} errors</span>` : ""}</span><div class="c-fun-bar" style="margin-top:4px"><i style="width:${pct}%;background:${pct > 80 ? "var(--warn)" : "var(--accent)"}"></i></div></td>
          <td>${s.quality == null ? `<span class="subtle s-small">not reviewed yet</span>` : `<b class="num">${s.quality}%</b> <span class="subtle s-small">of ${s.judged}</span>`}</td>
          <td class="subtle s-small">${s.last_run ? fmtDate(s.last_run) : "never"}</td></tr>`; }).join("")}
      </tbody></table></div></div>
    <p class="subtle s-small" style="margin-top:12px">Cost uses Anthropic list prices per million tokens (Opus 5.5 $4 in / $20 out). Runs in demo mode cost nothing. An agent that hits its monthly budget stops until the budget is raised.</p>`;
}

async function wfOpen(id) {
  const a = await api(`/api/workforce/agents/${id}`);
  WF.openId = id;
  let el = $("#wfDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="wfScrim" hidden></div><aside class="s-drawer" id="wfDrawer" hidden aria-label="Agent"></aside>`); el = $("#wfDrawer"); }
  const c = a.config, s = a.stats, edit = wfEdit(), L = WF.d.levels;
  el.innerHTML = `<div class="row gap-12"><div style="flex:1;min-width:0"><h2>${esc(a.name)}</h2><span class="subtle">${esc(a.team)} · works in <button class="linklike" data-go="${a.route}">${esc(ROUTES[a.route]?.title || a.route)}</button></span></div><button class="btn btn-sm" data-wfact="close">Close</button></div>
    <p>${esc(a.job)}</p>
    <div class="card" style="padding:14px 16px"><span class="eyebrow">Autonomy for this job</span><div class="stack" style="margin-top:8px">
      ${L.filter((l) => l.id <= a.max).map((l) => `<label class="wf-lvl ${l.id === (c.paused ? 0 : c.level) ? "on" : ""}"><input type="radio" name="wfLvl" value="${l.id}" ${l.id === (c.paused ? 0 : c.level) ? "checked" : ""} ${edit ? "" : "disabled"}><div><b>${l.id} · ${esc(l.name)}</b><div class="subtle s-small">${esc(l.id === 0 ? l.hint : a.levels[l.id] || l.hint)}</div></div></label>`).join("")}
      ${a.max < 3 ? `<p class="subtle s-small">This job goes up to level ${a.max} today: the rest needs a person by design${a.max === 1 ? " (it decides, sends or signs)" : ""}.</p>` : ""}</div>
      <div class="row gap-8" style="margin-top:10px;flex-wrap:wrap">${edit && s.can_promote ? `<button class="btn btn-sm btn-primary" data-wfact="promote">Move up to level ${c.level + 1}</button>` : `<span class="subtle s-small">${esc(s.promote_hint)}</span>`}</div></div>
    <section class="s-kpis">${[["This month", wfUsd(s.cost_month), `${s.runs_month} runs · ${(s.tokens_month / 1000).toFixed(1)}k tokens`], ["Used unchanged", s.quality == null ? "–" : s.quality + "%", `${s.judged} reviewed in its last 50`], ["Edited", s.outcomes.edited, "by a person before use"], ["Rejected / errors", `${s.outcomes.rejected} / ${s.outcomes.error}`, "in its last 50"], ["Acted alone", s.outcomes.auto, `${s.outcomes.escalated} handed to a person`]]
      .map(([l, v, sub]) => `<div class="card s-kpi"><span class="eyebrow">${l}</span><b class="num">${v}</b><span class="subtle">${sub}</span></div>`).join("")}</section>
    ${edit ? `<div class="grid-2"><div class="field"><label for="wfBudget">Monthly budget (USD)</label><input class="input" type="number" min="0" step="5" id="wfBudget" value="${c.budget_usd}"></div>
      <div class="field"><label for="wfNotes">Notes</label><input class="input" id="wfNotes" value="${esc(c.notes)}" placeholder="e.g. check its Ramadan copy weekly"></div></div>
      <div class="row gap-8"><button class="btn btn-sm btn-primary" data-wfact="save">Save</button><button class="btn btn-sm ${c.paused ? "btn-primary" : "btn-ghost"}" data-wfact="pause">${c.paused ? "Turn back on" : "Pause this agent"}</button></div>` : ""}
    <div><span class="eyebrow">Track record</span><div class="c-timeline">${a.events.slice(0, 30).map((e) => `<div class="c-tl ${e.outcome === "level" ? "note" : ""}"><span class="subtle">${fmtDate(e.at)} · <b class="${["rejected", "error"].includes(e.outcome) ? "bad" : ""}">${esc(e.outcome)}</b></span>${e.note ? `<div dir="auto">${esc(e.note)}</div>` : ""}</div>`).join("") || `<p class="muted s-small">No outcomes yet.</p>`}</div></div>
    <div><span class="eyebrow">Recent runs</span><div class="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th>Tokens in / out</th><th>Cost</th><th>Time</th></tr></thead><tbody>
      ${a.runs.slice(0, 30).map((r) => `<tr><td class="subtle s-small">${fmtDate(r.at)}</td><td>${r.ok ? `<span class="badge good">ok</span>` : `<span class="badge bad" title="${esc(r.error || "")}">error</span>`}</td><td class="num">${(r.in || 0).toLocaleString("en-US")} / ${(r.out || 0).toLocaleString("en-US")}</td><td class="num">${wfUsd(r.cost || 0)}</td><td class="num">${((r.ms || 0) / 1000).toFixed(1)}s</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No runs yet.</td></tr>`}</tbody></table></div></div>`;
  el.hidden = false; $("#wfScrim").hidden = false;
}
function wfClose() { const d = $("#wfDrawer"); if (d) { d.hidden = true; $("#wfScrim").hidden = true; } WF.openId = null; }

async function wfSet(id, body, msg) {
  try { await api(`/api/workforce/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }); WF.d = await api("/api/workforce"); wfRerender(); if (WF.openId) wfOpen(WF.openId); toast(msg || "Saved"); }
  catch (err) { toast(err.message, true); }
}

document.addEventListener("click", async (e) => {
  if (S.route !== "workforce" && !e.target.closest("#wfDrawer")) return;
  if (e.target.closest("#wfScrim")) return wfClose();
  const tm = e.target.closest("[data-wfteam]");
  if (tm) { WF.team = tm.dataset.wfteam; return wfRerender(); }
  const op = e.target.closest("[data-wfopen]");
  if (op) return wfOpen(op.dataset.wfopen);
  const b = e.target.closest("[data-wfact]");
  if (!b) return;
  const id = WF.openId;
  if (b.dataset.wfact === "close") return wfClose();
  if (b.dataset.wfact === "save") return wfSet(id, { budget_usd: $("#wfBudget").value, notes: $("#wfNotes").value });
  if (b.dataset.wfact === "pause") { const paused = !WF.d.agents.find((a) => a.id === id).config.paused; if (paused && !confirm("Pause this agent? Its AI features stop until you turn it back on.")) return; return wfSet(id, { paused }, paused ? "Paused" : "Back on"); }
  if (b.dataset.wfact === "promote") { try { await api(`/api/workforce/agents/${id}/promote`, { method: "POST" }); WF.d = await api("/api/workforce"); wfRerender(); wfOpen(id); toast("Moved up a level"); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("change", (e) => {
  if (S.route !== "workforce" && !e.target.closest("#wfDrawer")) return;
  const t = e.target;
  if (t.dataset.wflevel) return wfSet(t.dataset.wflevel, { level: Number(t.value), paused: Number(t.value) === 0 ? true : false }, "Level changed");
  if (t.dataset.wfowner) return wfSet(t.dataset.wfowner, { owner_id: t.value || null }, "Person responsible set");
  if (t.name === "wfLvl" && WF.openId) return wfSet(WF.openId, { level: Number(t.value), paused: Number(t.value) === 0 }, "Level changed");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && WF.openId) wfClose(); });

if (S.route === "workforce" && S.ws) render();
