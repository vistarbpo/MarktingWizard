/* AI Workforce: every AI agent managed like an employee. Job, person responsible, autonomy level
   (earned from its track record), monthly budget, cost, quality and a log of everything it did.
   Uses app.js globals (S, $, api, esc, toast, fmtDate, ROUTES, levelFor). */

const WF = { d: null, openId: null, team: "", view: "office3d", timer: null };
const WF_TEAM_COLOR = { Leadership: "#7c3aed", Marketing: "#c026d3", Sales: "#1f5eff", "Customer Success": "#0f9d58", Finance: "#0e7490", Operations: "#be123c", Product: "#4d7c0f", People: "#d97706" };
const WF_ICON = { coordinator: "✦", support_agent: "💬", crm_triage: "📥", crm_replier: "✉️", crm_sequence_writer: "🧭", sales_assistant: "🤝", creative_strategist: "🗓️", creative_copywriter: "✍️", creative_publisher: "🚀", marketing_strategist: "🎯", finance_cfo: "📊", ops_planner: "🗂️", product_analyst: "🧪", recruiter: "🧑‍💼", roas_analyst: "📈" };
// What an agent is doing right now, from its last run.
function wfState(a) {
  if (a.config.paused || a.config.level === 0) return { id: "off", label: "Paused" };
  const last = a.stats.last_run ? Date.now() - Date.parse(a.stats.last_run) : Infinity;
  if (a.stats.last_ok === false && last < 864e5) return { id: "error", label: "Needs a look" };
  if (last < 10 * 60e3) return { id: "busy", label: "Working now" };
  if (last < 864e5) return { id: "today", label: `Active today · ${a.stats.runs_today} run${a.stats.runs_today === 1 ? "" : "s"}` };
  return { id: "idle", label: a.stats.last_run ? "Idle" : "Waiting for first job" };
}
function wfOffice(d) {
  const teams = ["Leadership", ...new Set(d.agents.map((a) => a.team).filter((t) => t !== "Leadership"))];
  const initials = (n) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const rooms = teams.map((tm) => {
    const ag = d.agents.filter((a) => a.team === tm);
    const people = d.people.filter((p) => p.room === tm);
    const color = WF_TEAM_COLOR[tm] || "var(--accent)";
    const desks = [
      ...people.map((p) => `<div class="of-desk human" title="${esc(p.name)} · ${esc(p.role)}"><div class="of-av" style="background:${color}">${esc(initials(p.name))}</div><div class="of-table"><i class="of-screen"></i></div><span class="of-name">${esc(p.name.split(" ")[0])}</span><span class="of-role">${esc(p.role)}</span></div>`),
      ...ag.map((a) => { const st = wfState(a), note = a.stats.last_note;
        return `<button class="of-desk agent st-${st.id}" data-wfopen="${a.id}" title="${esc(a.name)}: ${esc(st.label)}">
          ${st.id === "busy" || (note && Date.now() - Date.parse(note.at) < 864e5 && note.note) ? `<span class="of-bubble" dir="auto">${esc(st.id === "busy" ? "…" : (note.note || note.outcome).slice(0, 38))}</span>` : ""}
          <div class="of-av bot" style="--c:${color}">${WF_ICON[a.id] || "✦"}${st.id === "off" ? `<em>z</em>` : ""}</div>
          <div class="of-table"><i class="of-screen"></i></div>
          <span class="of-name">${esc(a.name.replace(/^AI |^Ask DPA AD \(|\)$/g, ""))}</span><span class="of-role">L${a.config.paused ? 0 : a.config.level} · ${esc(st.label)}</span></button>`; }),
    ];
    return `<section class="of-room" style="--c:${color}"><div class="of-plate"><b>${esc(tm)}</b><span>${people.length} 👤 · ${ag.length} ✦</span></div><div class="of-floor">${desks.join("")}</div></section>`;
  });
  return `<div class="card" style="margin-top:16px"><div class="card-head"><div><h2>The office</h2><p class="subtle s-small">Every desk is an AI agent (✦) or a person who owns agents in that team. Glowing screens are working right now. Click a desk to open it.</p></div>
    <div class="of-legend"><span><i class="lg busy"></i>Working now</span><span><i class="lg today"></i>Active today</span><span><i class="lg idle"></i>Idle</span><span><i class="lg off"></i>Paused</span><span><i class="lg error"></i>Needs a look</span></div></div>
    <div class="of-plan">${rooms.join("")}</div></div>`;
}
const wfEdit = () => levelFor("workforce") === "edit";
const wfUsd = (n) => "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n || 0).toFixed(2));
const WF_TONE = ["", "", "accent", "good"];

ROUTES.workforce = { title: "AI Workforce", crumb: "AI Workforce", render: renderWorkforce };

async function renderWorkforce(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  WF.d = await api("/api/workforce");
  $("#pageActions").innerHTML = "";
  wfRerender();
  // Live office: refresh every 30 seconds while this page is open.
  clearInterval(WF.timer);
  WF.timer = setInterval(async () => { if (S.route !== "workforce") return clearInterval(WF.timer); if (WF.openId || document.hidden) return; try { WF.d = await api("/api/workforce"); const y = scrollY; wfRerender(); scrollTo(0, y); } catch {} }, 30e3);
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
    <div class="row gap-8" style="margin-top:16px"><div class="s-tabs"><button data-wfview="office3d" aria-selected="${WF.view === "office3d"}">3D office</button><button data-wfview="office" aria-selected="${WF.view === "office"}">Floor plan</button><button data-wfview="org" aria-selected="${WF.view === "org"}">Org chart</button></div></div>
    ${WF.view === "office" ? wfOffice(d) : WF.view === "office3d" ? wf3Office(d) : ""}
    <div class="card" style="margin-top:16px${WF.view === "org" ? "" : ";display:none"}"><div class="card-head"><h2>Org chart</h2><span class="subtle s-small">People own the agents in their area; agents do the repeatable work.</span></div>
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
  if (WF.view === "office3d") wf3Start(d);
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
  const vw = e.target.closest("[data-wfview]");
  if (vw) { WF.view = vw.dataset.wfview; return wfRerender(); }
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

/* ------------------------------------------------ 3D office: isometric floor, desks, walking agents */
const W3 = { raf: 0, sprites: {}, hits: [], scale: 1, last: 0, hover: null };
const W3T = { tw: 64, th: 32, z: 44, roomW: 7, roomD: 7, gap: 1, cols: 3 };
function wf3Iso(x, y, z = 0) { return [(x - y) * W3T.tw / 2 + W3.ox, (x + y) * W3T.th / 2 + W3.oy - z * W3T.z]; }
function wf3Layout(d) {
  const teams = ["Leadership", ...new Set([...d.agents.map((a) => a.team), ...d.people.map((p) => p.room), ...(d.hiring || []).map((h) => h.room)].filter((t) => t && t !== "Leadership"))];
  const rooms = teams.map((tm, i) => {
    const col = i % W3T.cols, row = Math.floor(i / W3T.cols);
    const x0 = col * (W3T.roomW + W3T.gap), y0 = row * (W3T.roomD + W3T.gap);
    const ag = d.agents.filter((a) => a.team === tm), people = d.people.filter((p) => p.room === tm), hires = (d.hiring || []).filter((h) => h.room === tm);
    const members = [...people.map((p) => ({ kind: "human", id: "u" + p.id, name: p.name, role: p.role })), ...ag.map((a) => ({ kind: "agent", id: a.id, a })), ...hires.map((h) => ({ kind: "hire", id: "h" + h.id, name: h.title, status: h.status }))];
    const desks = members.slice(0, 9).map((m, k) => { const dx = x0 + 0.6 + (k % 3) * 2.1, dy = y0 + 0.7 + Math.floor(k / 3) * 2.1; return { ...m, dx, dy, seat: [dx + 0.7, dy + 1.25] }; });
    return { tm, x0, y0, color: WF_TEAM_COLOR[tm] || "#1f5eff", desks, hub: [x0 + W3T.roomW - 1.1, y0 + W3T.roomD - 0.9] };
  });
  const rowsN = Math.ceil(teams.length / W3T.cols);
  const X = W3T.cols * (W3T.roomW + W3T.gap), Y = rowsN * (W3T.roomD + W3T.gap);
  return { rooms, X, Y, w: (X + Y) * W3T.tw / 2 + 40, h: (X + Y) * W3T.th / 2 + 140, ox: Y * W3T.tw / 2 + 20, oy: 90 };
}
function wf3Office(d) {
  return `<div class="card" style="margin-top:16px"><div class="card-head"><div><h2>The office</h2><p class="subtle s-small">${d.people.length} ${d.people.length === 1 ? "person" : "people"} and ${d.agents.filter((a) => !a.config.paused && a.config.level > 0).length} AI agents at work${(d.hiring || []).length ? ` · ${(d.hiring || []).length} desk${d.hiring.length === 1 ? "" : "s"} waiting for a hire` : ""}. Agents walk through doors to people and other teams; glowing screens are busy right now. Hover for who's who, click an agent to open it.</p></div>
    <div class="of-legend"><span>👤 Person</span><span>✦ AI agent</span><span><i class="lg busy"></i>Working now</span><span><i class="lg today"></i>Active today</span><span><i class="lg idle"></i>Idle</span><span><i class="lg off"></i>Paused</span><span><i class="lg error"></i>Needs a look</span><span><i class="lg" style="background:#f59e0b"></i>Hiring</span></div></div>
    <div class="o3-wrap" id="o3Wrap"><canvas id="o3Canvas" aria-label="AI Workforce office: ${d.agents.length} agents and ${d.people.length} people"></canvas><div class="o3-tip" id="o3Tip" hidden></div></div></div>`;
}
function wf3Start(d) {
  cancelAnimationFrame(W3.raf);
  const cv = $("#o3Canvas"); if (!cv) return;
  const L = wf3Layout(d); W3.ox = L.ox; W3.oy = L.oy; W3.L = L;
  const dpr = Math.min(2, window.devicePixelRatio || 1), cssW = cv.parentElement.clientWidth;
  W3.scale = Math.min(1, cssW / L.w);
  cv.style.width = L.w * W3.scale + "px"; cv.style.height = L.h * W3.scale + "px";
  cv.width = L.w * W3.scale * dpr; cv.height = L.h * W3.scale * dpr;
  const ctx = cv.getContext("2d"); ctx.setTransform(W3.scale * dpr, 0, 0, W3.scale * dpr, 0, 0);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Sprites: every agent and person, kept across refreshes so walkers don't jump.
  const all = L.rooms.flatMap((r) => r.desks.map((dk) => ({ ...dk, room: r })));
  for (const dk of all.filter((x) => x.kind !== "hire")) {
    const sp = W3.sprites[dk.id] || (W3.sprites[dk.id] = { x: dk.seat[0], y: dk.seat[1], mode: "sit", wait: 1 + Math.random() * 12, t: 0 });
    sp.desk = dk; sp.state = dk.kind === "agent" ? wf3State(dk.a) : { id: "human" };
  }
  const targetsFor = (sp) => {
    const r = sp.desk.room, owner = sp.desk.a?.config.owner_id && all.find((x) => x.id === "u" + sp.desk.a.config.owner_id);
    const other = L.rooms[Math.floor(Math.random() * L.rooms.length)];
    const pick = Math.random();
    return pick < 0.4 && owner ? { room: owner.room, pt: [owner.seat[0] - 0.6, owner.seat[1] + 0.3] } : pick < 0.75 ? { room: r, pt: [r.hub[0] - Math.random(), r.hub[1] - Math.random() * 0.6] } : { room: other, pt: [other.hub[0] - 0.5, other.hub[1] - 0.4] };
  };
  // Walk through doors and corridors, never through walls: room door → corridor → other room's door.
  const door = (r) => [r.x0 + W3T.roomW / 2, r.y0 + W3T.roomD - 0.25], out = (r) => [r.x0 + W3T.roomW / 2, r.y0 + W3T.roomD + 0.5];
  const route = (from, to, pt) => {
    if (from === to) return [pt];
    const cx = from.x0 + W3T.roomW + 0.5, a = out(from), b = out(to);
    return [door(from), a, [cx, a[1]], [cx, b[1]], b, door(to), pt];
  };
  const step = (dt) => {
    for (const sp of Object.values(W3.sprites)) {
      if (!sp.desk) continue;
      // Everyone who isn't paused or stuck moves: busy agents constantly, active ones often, idle ones now and then.
      const st = sp.state.id, mobile = !reduce && st !== "off" && st !== "error";
      if (sp.mode === "sit") {
        sp.wait -= dt;
        if (mobile && sp.wait <= 0) { const t = targetsFor(sp); sp.mode = "walk"; sp.path = route(sp.desk.room, t.room, t.pt); sp.back = [...route(t.room, sp.desk.room, sp.desk.seat)]; }
        else if (!mobile) { sp.x = sp.desk.seat[0]; sp.y = sp.desk.seat[1]; }
      } else if (sp.mode === "walk" || sp.mode === "return") {
        const path = sp.mode === "walk" ? sp.path : sp.back;
        if (!path?.length) { sp.mode = "sit"; sp.x = sp.desk.seat[0]; sp.y = sp.desk.seat[1]; continue; }
        const [tx, ty] = path[0];
        const dx = tx - sp.x, dy = ty - sp.y, dist = Math.hypot(dx, dy), v = (st === "busy" ? 1.8 : 1.1) * dt;
        sp.t += dt;
        if (dist <= v) {
          sp.x = tx; sp.y = ty; path.shift();
          if (!path.length) { if (sp.mode === "walk") { sp.mode = "pause"; sp.wait = 1.2 + Math.random() * 2; } else { sp.mode = "sit"; sp.wait = ({ busy: 2, today: 6, idle: 10, human: 18 }[st] ?? 10) + Math.random() * ({ busy: 4, today: 10, idle: 16, human: 25 }[st] ?? 15); } }
        } else { sp.x += (dx / dist) * v; sp.y += (dy / dist) * v; }
      } else if (sp.mode === "pause") { sp.wait -= dt; if (sp.wait <= 0) sp.mode = "return"; }
    }
  };
  const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))); return `rgb(${c.join(",")})`; };
  const box = (x, y, w, dd, h, top, left, right) => {
    const I = wf3Iso;
    poly([I(x, y + dd, 0), I(x + w, y + dd, 0), I(x + w, y + dd, h), I(x, y + dd, h)], left);
    poly([I(x + w, y, 0), I(x + w, y + dd, 0), I(x + w, y + dd, h), I(x + w, y, h)], right);
    poly([I(x, y, h), I(x + w, y, h), I(x + w, y + dd, h), I(x, y + dd, h)], top);
  };
  const screenColor = (st, t) => ({ busy: `rgba(74,222,128,${0.75 + 0.25 * Math.sin(t * 6)})`, today: "#93b4ff", error: Math.sin(t * 8) > 0 ? "#f87171" : "#b91c1c", off: "#15171c", idle: "#2a2f3a", human: "#3b4150" })[st] || "#2a2f3a";
  const draw = (t) => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
    ctx.clearRect(0, 0, L.w, L.h);
    // Floor of the whole office, then each room.
    poly([wf3Iso(-0.5, -0.5), wf3Iso(L.X, -0.5), wf3Iso(L.X, L.Y), wf3Iso(-0.5, L.Y)], dark ? "#1d2027" : "#eceae4");
    for (const r of L.rooms) {
      const { x0, y0 } = r, W = W3T.roomW, D = W3T.roomD;
      poly([wf3Iso(x0, y0), wf3Iso(x0 + W, y0), wf3Iso(x0 + W, y0 + D), wf3Iso(x0, y0 + D)], dark ? shade(r.color, -0.72) : shade(r.color, 0.9));
      ctx.strokeStyle = dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)";
      for (let i = 1; i < W; i++) { ctx.beginPath(); ctx.moveTo(...wf3Iso(x0 + i, y0)); ctx.lineTo(...wf3Iso(x0 + i, y0 + D)); ctx.stroke(); }
      for (let i = 1; i < D; i++) { ctx.beginPath(); ctx.moveTo(...wf3Iso(x0, y0 + i)); ctx.lineTo(...wf3Iso(x0 + W, y0 + i)); ctx.stroke(); }
      // Back walls (glass-topped), so the room reads as a space.
      poly([wf3Iso(x0, y0, 0), wf3Iso(x0 + W, y0, 0), wf3Iso(x0 + W, y0, 0.9), wf3Iso(x0, y0, 0.9)], shade(r.color, dark ? -0.45 : 0.55));
      poly([wf3Iso(x0, y0, 0), wf3Iso(x0, y0 + D, 0), wf3Iso(x0, y0 + D, 0.9), wf3Iso(x0, y0, 0.9)], shade(r.color, dark ? -0.55 : 0.7));
      poly([wf3Iso(x0, y0, 0.9), wf3Iso(x0 + W, y0, 0.9), wf3Iso(x0 + W, y0, 0.95), wf3Iso(x0, y0, 0.95)], r.color);
      // Name plate on the back wall.
      const [nx, ny] = wf3Iso(x0 + W / 2, y0, 0.45);
      ctx.save(); ctx.translate(nx, ny); ctx.transform(1, 0.5, 0, 1, 0, 0); ctx.fillStyle = dark ? "#fff" : shade(r.color, -0.35); ctx.font = "600 15px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(r.tm, 0, 0); ctx.restore();
      // Door on the front edge: a frame and a mat, so walkers clearly come and go through it.
      const dxm = x0 + W / 2;
      poly([wf3Iso(dxm - 0.6, y0 + D - 0.05), wf3Iso(dxm + 0.6, y0 + D - 0.05), wf3Iso(dxm + 0.6, y0 + D + 0.45), wf3Iso(dxm - 0.6, y0 + D + 0.45)], dark ? "#2c3038" : "#d9d3c7");
      // Hub: a round meeting table with a plant.
      const [hx, hy] = wf3Iso(r.hub[0], r.hub[1], 0.35);
      ctx.fillStyle = dark ? "#3a3f4b" : "#d9d3c7"; ctx.beginPath(); ctx.ellipse(hx, hy, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
      const [px, py] = wf3Iso(x0 + 0.5, y0 + D - 0.6, 0); ctx.fillStyle = "#7a5230"; ctx.fillRect(px - 6, py - 14, 12, 14); ctx.fillStyle = "#3f9b52"; ctx.beginPath(); ctx.arc(px, py - 22, 12, 0, Math.PI * 2); ctx.fill();
    }
    // Desks and people, painted back to front.
    W3.hits = [];
    const items = [];
    for (const r of L.rooms) for (const dk of r.desks) items.push({ k: dk.dx + dk.dy + 0.6, desk: dk, room: r });
    for (const sp of Object.values(W3.sprites)) if (sp.desk) items.push({ k: sp.x + sp.y, sp });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) {
      if (it.desk) {
        const dk = it.desk, st = dk.kind === "agent" ? wf3State(dk.a).id : dk.kind === "hire" ? "off" : "human", c = it.room.color;
        box(dk.dx, dk.dy, 1.4, 0.7, 0.36, dark ? "#4a4f5c" : "#fbfaf7", dark ? "#343842" : "#d8d4cb", dark ? "#2b2e36" : "#c8c3b8");
        const I = wf3Iso;
        poly([I(dk.dx + 0.3, dk.dy + 0.18, 0.4), I(dk.dx + 1.05, dk.dy + 0.18, 0.4), I(dk.dx + 1.05, dk.dy + 0.18, 0.86), I(dk.dx + 0.3, dk.dy + 0.18, 0.86)], screenColor(st, t), "#111");
        if (st === "busy") { ctx.fillStyle = "rgba(74,222,128,.18)"; const [gx, gy] = I(dk.dx + 0.68, dk.dy + 0.3, 0.6); ctx.beginPath(); ctx.arc(gx, gy, 22, 0, Math.PI * 2); ctx.fill(); }
        const [lx, ly] = I(dk.dx + 0.7, dk.dy + 1.95, 0);
        ctx.fillStyle = dark ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.6)"; ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(dk.kind === "agent" ? dk.a.name.replace(/^AI |^Ask DPA AD \(|\)$/g, "") : dk.kind === "hire" ? dk.name.slice(0, 20) : dk.name.split(" ")[0], lx, ly);
        if (dk.kind === "hire") { const [sx, sy] = I(dk.dx + 0.7, dk.dy + 1.25, 0.9); ctx.fillStyle = "#f59e0b"; ctx.beginPath(); ctx.roundRect(sx - 24, sy - 10, 48, 18, 5); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "700 10px Inter, system-ui, sans-serif"; ctx.fillText(dk.status === "open" ? "HIRING" : "PLANNED", sx, sy + 3); }
        W3.hits.push({ id: dk.id, x: lx, y: ly - 40, r: 34, dk, room: it.room });
      } else {
        const sp = it.sp, dk = sp.desk, st = sp.state.id, c = dk.room.color, moving = sp.mode === "walk" || sp.mode === "return";
        const bob = moving ? Math.abs(Math.sin(sp.t * 9)) * 3 : 0, sit = sp.mode === "sit" ? 6 : 0;
        const [x, y] = wf3Iso(sp.x, sp.y, 0);
        ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(x, y, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
        const by = y - 18 - bob + sit;
        if (moving) { ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = 3; const sw = Math.sin(sp.t * 9) * 4; ctx.beginPath(); ctx.moveTo(x - 3, by + 12); ctx.lineTo(x - 3 + sw, y - 1); ctx.moveTo(x + 3, by + 12); ctx.lineTo(x + 3 - sw, y - 1); ctx.stroke(); }
        ctx.globalAlpha = st === "off" ? 0.45 : 1;
        if (dk.kind === "agent") {
          ctx.fillStyle = dark ? "#e7e9ee" : "#ffffff"; ctx.strokeStyle = c; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(x - 9, by - 2, 18, 16, 5); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.roundRect(x - 12, by - 26, 24, 22, 7); ctx.fill(); ctx.stroke();
          ctx.font = "14px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji'"; ctx.textAlign = "center"; ctx.fillText(WF_ICON[dk.id] || "✦", x, by - 10);
          ctx.fillStyle = c; ctx.fillRect(x - 1, by - 32, 2, 6); ctx.beginPath(); ctx.arc(x, by - 33, 3, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x - 9, by - 2, 18, 18, 6); ctx.fill();
          ctx.fillStyle = "#e9b48a"; ctx.beginPath(); ctx.arc(x, by - 11, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#3b2a20"; ctx.beginPath(); ctx.arc(x, by - 14, 9, Math.PI, 0); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (st === "off") { ctx.fillStyle = "#8a8a8a"; ctx.font = "italic 700 12px system-ui"; ctx.fillText("z", x + 14, by - 26 - ((t * 10) % 8)); }
        if (st === "error") { ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(x + 13, by - 28, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "700 10px system-ui"; ctx.fillText("!", x + 13, by - 24); }
        if (st === "busy" && !moving) { ctx.fillStyle = dark ? "#2b2e36" : "#fff"; ctx.beginPath(); ctx.roundRect(x + 8, by - 46, 26, 14, 7); ctx.fill(); ctx.fillStyle = "#888"; for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.4 + 0.6 * ((Math.floor(t * 3) % 3) === k); ctx.beginPath(); ctx.arc(x + 15 + k * 6, by - 39, 2, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
        if (dk.kind === "agent") W3.hits.push({ id: dk.id, x, y: by - 10, r: 18, dk });
      }
    }
  };
  const rails = () => {
    for (const r of L.rooms) {
      const { x0, y0 } = r, W = W3T.roomW, D = W3T.roomD, dxm = x0 + W / 2, h = 0.32;
      ctx.globalAlpha = 0.35;
      const seg = (xa, xb) => poly([wf3Iso(xa, y0 + D, 0), wf3Iso(xb, y0 + D, 0), wf3Iso(xb, y0 + D, h), wf3Iso(xa, y0 + D, h)], shade(r.color, 0.4), r.color);
      seg(x0, dxm - 0.6); seg(dxm + 0.6, x0 + W);
      poly([wf3Iso(x0 + W, y0, 0), wf3Iso(x0 + W, y0 + D, 0), wf3Iso(x0 + W, y0 + D, h), wf3Iso(x0 + W, y0, h)], shade(r.color, 0.5), r.color);
      ctx.globalAlpha = 1;
      for (const xx of [dxm - 0.6, dxm + 0.6]) { const [a1, b1] = wf3Iso(xx, y0 + D, 0), [a2, b2] = wf3Iso(xx, y0 + D, 1.0); ctx.strokeStyle = shade(r.color, -0.2); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
    }
  };
  const loop = (ts) => {
    if (S.route !== "workforce" || !document.body.contains(cv)) return;
    const dt = Math.min(0.05, (ts - (W3.last || ts)) / 1000); W3.last = ts;
    step(dt); draw(ts / 1000); rails();
    W3.raf = requestAnimationFrame(loop);
  };
  W3.last = 0; W3.raf = requestAnimationFrame(loop);
  // Hover tooltip and click to open.
  const tip = $("#o3Tip");
  const at = (e) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / W3.scale, (e.clientY - b.top) / W3.scale]; };
  const hit = (e) => { const [mx, my] = at(e); let best = null, bd = 1e9; for (const h of W3.hits) { const dd = Math.hypot(h.x - mx, h.y - my); if (dd < h.r && dd < bd) { best = h; bd = dd; } } return best; };
  cv.onmousemove = (e) => {
    const h = hit(e); cv.style.cursor = h?.dk.kind === "agent" ? "pointer" : "default";
    if (!h) { tip.hidden = true; return; }
    const dk = h.dk, b = cv.getBoundingClientRect();
    tip.innerHTML = dk.kind === "agent" ? `<b>${esc(dk.a.name)}</b><span>${esc(dk.a.team)} · level ${dk.a.config.paused ? 0 : dk.a.config.level} · ${esc(wf3State(dk.a).label)}</span>${dk.a.stats.last_note?.note ? `<span dir="auto">Last: ${esc(dk.a.stats.last_note.note.slice(0, 60))}</span>` : ""}`
      : dk.kind === "hire" ? `<b>${esc(dk.name)}</b><span>${dk.status === "open" ? "Open role: hiring now" : "Planned role"} · ${esc(h.room?.tm || "")}</span><span>See Team → Hiring</span>`
      : `<b>${esc(dk.name)}</b><span>${esc(dk.role)} · ${esc(h.room?.tm || dk.room?.tm || "")}</span>`;
    tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 220) + "px"; tip.style.top = e.clientY - b.top + 14 + "px"; tip.hidden = false;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
  cv.onclick = (e) => { const h = hit(e); if (h?.dk.kind === "agent") wfOpen(h.dk.id); };
}
const wf3State = (a) => wfState(a);
