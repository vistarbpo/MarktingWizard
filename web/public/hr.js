/* HR module: an AI-first org chart and hiring pipeline. Loaded after app.js and
   sales.js; uses their globals (S, $, api, esc, md, toast, fmtDate, ROUTES).
   AI agents fill every role they can; human seats say why they must be human.
   In hiring, AI screens and drafts; people interview, decide and sign. */

const HR = { meta: null, roles: [], candidates: [], summary: null, tab: "org", filter: "all", open: null };
const H_STAGE_COLOR = { applied: "var(--text-3)", screened: "var(--accent)", interview: "#8a7cf0", offer: "var(--warn)", hired: "var(--good)", rejected: "var(--bad)" };
const sar = (n) => "SAR " + Math.round(n).toLocaleString("en-US");
const hBadge = (kind) => `<span class="s-owner ${kind === "ai" ? "ai" : "you"}">${kind === "ai" ? "AI" : "HUMAN"}</span>`;
const hOwner = (o) => o === "sample" ? `<span class="s-owner" style="background:var(--surface-2);color:var(--text-2)">SAMPLE</span>` : `<span class="s-owner ${o === "you" ? "you" : "ai"}">${o === "you" ? "YOU" : "AI"}</span>`;
const STATUS_LABEL = { active: "Active", open: "Hiring", planned: "Planned", paused: "Paused" };

ROUTES.team = { title: "Team & hiring", crumb: "HR", render: renderHr };

async function hrLoad() {
  if (!HR.meta) HR.meta = await api("/api/hr/meta");
  const r = await api(`/api/workspaces/${S.ws.id}/hr`);
  HR.roles = r.roles; HR.candidates = r.candidates; HR.summary = r.summary;
}

async function renderHr(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await hrLoad();
  $("#pageActions").innerHTML = `
    <div class="s-tabs" role="tablist" aria-label="HR views">
      <button role="tab" data-htab="org" aria-selected="${HR.tab === "org"}">Org chart</button>
      <button role="tab" data-htab="hiring" aria-selected="${HR.tab === "hiring"}">Hiring</button>
    </div>
    <button class="btn" data-haction="add-role">Add role</button>
    <button class="btn btn-primary" data-haction="add-cand">Add candidate</button>`;
  view.innerHTML = `<section class="s-kpis" id="hKpis" aria-label="Team summary"></section><div id="hBody"></div>`;
  hrRerender();
}

function hrRerender() {
  if (S.route !== "team") return;
  hrKpis();
  HR.tab === "hiring" ? hrHiring() : hrOrg();
}

function hrKpis() {
  const s = HR.summary;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#hKpis").innerHTML = [
    tile("AI agents", s.agents, "active, doing repeatable work"),
    tile("People", s.humans, "active human roles"),
    tile("AI share of roles", s.ai_share + "%", "of all roles in the org"),
    tile("Open + planned", `${s.open_roles} + ${s.planned_roles}`, "human roles to hire"),
    tile("Planned payroll", sar(s.planned_payroll_sar), "per month, human roles (midpoint)"),
    tile("Needs you", s.needs_you.length, "interviews, offers, contracts", s.needs_you.length ? "warn" : ""),
  ].join("");
}

/* ------------------------------------------------ Org chart */
const hrHasSamples = () => HR.roles.some((r) => r.sample_holder) || HR.candidates.some((c) => c.sample);
const sampleTag = `<span class="badge warn" title="Sample data, not a real person">Sample</span>`;
function hrRoleCard(r) {
  const cands = HR.candidates.filter((c) => c.role_id === r.id && !["hired", "rejected"].includes(c.stage)).length;
  const sal = r.kind === "human" && (r.salary_min || r.salary_max) ? `${sar(r.salary_min || r.salary_max)}${r.salary_max && r.salary_min ? "–" + Number(r.salary_max).toLocaleString("en-US") : ""}/mo` : "";
  return `<button type="button" class="h-role ${r.kind} st-${r.status}" data-hrole="${r.id}">
    <div class="row gap-8">${hBadge(r.kind)}<b class="h-title">${esc(r.title)}</b></div>
    <span class="h-holder">${r.kind === "ai" ? esc(r.holder || "AI agent") : esc(r.holder || (r.status === "open" ? "Hiring now" : "Not hired yet"))} ${r.sample_holder ? sampleTag : ""}</span>
    <div class="h-meta"><span class="h-status st-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>${r.employment && r.kind === "human" ? `<span>${esc(r.employment)}</span>` : ""}${sal ? `<span class="num">${sal}</span>` : ""}${cands ? `<span>${cands} candidate${cands === 1 ? "" : "s"}</span>` : ""}</div>
    ${r.kind === "human" && r.must_be_human ? `<span class="h-why">Human because: ${esc(r.must_be_human)}</span>` : r.duties ? `<span class="h-why">${esc(r.duties)}</span>` : ""}
  </button>`;
}

function hrOrg() {
  if (!HR.roles.length) {
    $("#hBody").innerHTML = `<div class="card empty" style="margin-top:16px"><h2>Design your AI-first team</h2>
      <p>Start from a suggested org for DPA AD: AI agents for sales follow-up, marketing, analytics, support and recruiting, plus a small human core for what must be human. Edit or delete anything after.</p>
      <div class="row gap-8" style="justify-content:center;flex-wrap:wrap"><button class="btn btn-primary" data-haction="suggest">Load suggested AI-first org</button><button class="btn" data-haction="sample">Load org + sample team</button><button class="btn" data-haction="add-role">Add a role</button></div></div>`;
    return;
  }
  const show = (r) => HR.filter === "all" || r.kind === HR.filter;
  const leaders = HR.roles.filter((r) => r.department === "Leadership" && show(r));
  const depts = HR.meta.departments.filter((d) => d !== "Leadership").map((d) => ({ d, roles: HR.roles.filter((r) => r.department === d && show(r)) })).filter((x) => x.roles.length);
  const ai = HR.roles.filter((r) => r.kind === "ai").length, hu = HR.roles.length - ai;
  $("#hBody").innerHTML = `
    <div class="row between" style="margin:24px 0 12px;flex-wrap:wrap;gap:12px">
      <div class="row gap-12" style="flex-wrap:wrap"><h2>Org chart</h2>
        <div class="h-split" role="img" aria-label="${ai} AI agents and ${hu} human roles"><span style="flex:${ai || 0.001};background:var(--accent)"></span><span style="flex:${hu || 0.001};background:var(--warn)"></span></div>
        <span class="subtle s-small">${ai} AI · ${hu} human</span></div>
      <div class="row gap-8" role="group" aria-label="Filter roles" style="flex-wrap:wrap">${hrHasSamples() ? `<button class="btn btn-sm btn-ghost btn-danger" data-haction="unsample">Remove sample data</button>` : `<button class="btn btn-sm btn-ghost" data-haction="sample">Load sample team</button>`}${[["all", "All"], ["ai", "AI agents"], ["human", "People"]].map(([k, l]) => `<button class="chip ${HR.filter === k ? "active" : ""}" data-hfilter="${k}">${l}</button>`).join("")}</div>
    </div>
    <div class="h-org">
      ${leaders.length ? `<div class="h-lead">${leaders.map(hrRoleCard).join("")}</div><div class="h-trunk" aria-hidden="true"></div>` : ""}
      <div class="h-depts">${depts.map(({ d, roles }) => `
        <section class="h-dept"><div class="h-dept-head"><h3>${esc(d)}</h3><span class="subtle s-small">${roles.filter((r) => r.kind === "ai").length} AI · ${roles.filter((r) => r.kind === "human").length} human</span></div>
          ${roles.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "human" ? -1 : 1)).map(hrRoleCard).join("")}</section>`).join("")}</div>
    </div>
    <div class="s-legend"><span>${hBadge("ai")} AI agent does the work</span><span>${hBadge("human")} Must be a person</span><span><i class="h-swatch dashed"></i>Not hired yet</span></div>`;
}

/* ------------------------------------------------ Hiring board */
function hrCandCard(c) {
  const score = c.score == null ? "" : `<span class="h-score ${c.score >= 7 ? "good" : c.score >= 5 ? "mid" : "low"}">${c.score}/10</span>`;
  return `<button type="button" class="s-card" draggable="true" data-hcand="${c.id}" aria-label="${esc(c.name)}, ${esc(c.stage)}">
    <div class="row between" style="gap:8px"><b class="s-name">${esc(c.name)}</b>${score}</div>
    <span class="subtle s-small">${esc(c.role_title)}${c.source ? " · " + esc(c.source) : ""}</span>${c.sample ? `<span>${sampleTag}</span>` : ""}
    <div class="s-next ${c.next.urgent ? (c.next.owner === "you" ? "hot" : "warm") : ""}">${hOwner(c.next.owner)}<span>${esc(c.next.text)}</span></div>
  </button>`;
}

function hrAddCandForm() {
  const roles = HR.roles.filter((r) => r.kind === "human");
  return `<form class="card s-add h-add" id="hAdd" hidden>
    <div class="field"><label for="hc-name">Name</label><input class="input" id="hc-name" required></div>
    <div class="field"><label for="hc-role">Role</label><select class="input" id="hc-role"><option value="">No role yet</option>${roles.map((r) => `<option value="${r.id}">${esc(r.title)}</option>`).join("")}</select></div>
    <div class="field"><label for="hc-email">Email</label><input class="input" id="hc-email" type="email"></div>
    <div class="field"><label for="hc-phone">Phone</label><input class="input" id="hc-phone"></div>
    <div class="field"><label for="hc-src">Source</label><input class="input" id="hc-src" placeholder="LinkedIn, Bayt, referral…"></div>
    <div class="field h-span"><label for="hc-cv">CV or profile text</label><textarea class="input" id="hc-cv" rows="5" placeholder="Paste the CV or LinkedIn profile. AI screens it against the role."></textarea></div>
    <div class="row gap-8 h-span"><button class="btn btn-primary" type="submit">Add candidate</button><button class="btn" type="button" data-haction="add-cand">Cancel</button></div>
  </form>`;
}

function hrHiring() {
  const s = HR.summary;
  $("#hBody").innerHTML = `
    <div class="row between" style="margin:24px 0 12px;flex-wrap:wrap;gap:8px"><h2>Hiring</h2><span class="subtle s-small">AI Recruiter screens every CV and drafts every message. You interview, decide and sign. AI drafts this week: ${s.ai_week.drafts} (${s.ai_week.screens} screens).</span></div>
    ${s.needs_you.length ? `<div class="card card-pad h-mine"><div class="row gap-8">${hOwner("you")}<b>Needs you</b></div><ul class="s-mine">${s.needs_you.map((m) => `<li><button class="s-link" data-hcand="${m.id}">${esc(m.name)}</button>: ${esc(m.text)}</li>`).join("")}</ul></div>` : ""}
    ${hrAddCandForm()}
    ${HR.candidates.length ? `<p class="subtle s-small" style="margin:0 0 10px">Drag a candidate between stages, or click to open.</p>` : `<div class="card empty" style="margin-bottom:16px"><h2>No candidates yet</h2><p>Open a human role, generate its job post, then add applicants here. AI screens each CV and scores the fit out of 10.</p><button class="btn btn-primary" data-haction="add-cand">Add candidate</button></div>`}
    <div class="s-board h-board">${HR.meta.stages.map((st) => {
      const list = HR.candidates.filter((c) => c.stage === st.id);
      return `<div class="s-col" data-hstage="${st.id}"><div class="s-col-head"><h3><i class="s-dot" style="background:${H_STAGE_COLOR[st.id]}"></i>${st.name} <span class="subtle num">${list.length}</span></h3></div>
        ${list.map(hrCandCard).join("") || `<p class="subtle s-small" style="padding:4px">Drop a candidate here</p>`}</div>`;
    }).join("")}</div>`;
}

/* ------------------------------------------------ Drawers */
function hDrawerEl() {
  let el = $("#hDrawer");
  if (!el) {
    document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="hScrim" hidden></div><aside class="s-drawer" id="hDrawer" hidden aria-label="Details"></aside>`);
    el = $("#hDrawer");
  }
  return el;
}
function hClose() { const d = $("#hDrawer"); if (d) { d.hidden = true; $("#hScrim").hidden = true; } HR.open = null; }
function hShow(html, data) { const d = hDrawerEl(); d.innerHTML = html; d._data = data; d.hidden = false; $("#hScrim").hidden = false; d.querySelector('[data-haction="close"]')?.focus(); }
const hTimeline = (acts, tasks) => `<ul class="s-timeline">${acts.map((a) => `<li>${hOwner(a.by)}<div style="min-width:0"><span class="s-small">${esc({ created: "Added", stage: "Stage: " + a.text, ai_draft: "AI Recruiter drafted: " + (tasks[a.task] || "draft"), sent: "Sent: " + (tasks[a.task] || "message"), note: "Note", interview: "Interview notes" }[a.type] || a.type)}</span>${a.text && !["ai_draft", "stage"].includes(a.type) ? `<p class="s-small muted">${esc(a.text.slice(0, 400))}</p>` : ""}${a.type === "ai_draft" ? `<button class="s-link s-small" data-hshowdraft="${a.id}">Show draft</button>` : ""}</div><span class="subtle s-small num" style="margin-left:auto;white-space:nowrap">${fmtDate(a.created_at)}</span></li>`).join("") || `<li class="subtle s-small">Nothing yet.</li>`}</ul>`;

async function hOpenRole(id) {
  let data; try { data = await api(`/api/workspaces/${S.ws.id}/hr/roles/${id}`); } catch (e) { toast(e.message, true); return; }
  HR.open = { type: "role", id };
  const r = data.role, M = HR.meta;
  const tasks = Object.entries(M.role_tasks).filter(([k]) => (r.kind === "ai" ? k === "agent_spec" : k !== "agent_spec"));
  const opt = (list, v) => list.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  hShow(`
    <div class="row gap-12">${hBadge(r.kind)}<div style="flex:1;min-width:0"><h2>${esc(r.title)}</h2><span class="subtle">${esc(r.department)} · ${STATUS_LABEL[r.status]}</span></div><button class="btn btn-sm" data-haction="close">Close</button></div>
    <div class="card card-pad stack"><h3>Status</h3><div class="s-stages">${M.statuses.map((s) => `<button class="chip ${s === r.status ? "active" : ""}" aria-pressed="${s === r.status}" data-hrolestatus="${s}">${STATUS_LABEL[s]}</button>`).join("")}</div></div>
    <div class="card card-pad stack"><div class="row between"><h3>AI Recruiter drafts</h3><span class="subtle s-small">You review before posting or using</span></div>
      <div class="row gap-8" style="flex-wrap:wrap">${tasks.map(([k, t]) => `<button class="btn btn-sm" data-hai="role:${k}">${esc(t)}${data.activities.some((a) => a.task === k) ? " ✓" : ""}</button>`).join("")}</div>
      <div id="hDraft" class="s-draft" hidden></div></div>
    ${r.kind === "human" ? `<div class="card card-pad stack"><div class="row between"><h3>Candidates</h3><button class="btn btn-sm" data-haction="add-cand" data-hrolefor="${r.id}">Add candidate</button></div>
      ${data.candidates.length ? `<ul class="s-timeline">${data.candidates.map((c) => `<li><button class="s-link" data-hcand="${c.id}">${esc(c.name)}</button><span class="subtle s-small">${esc(c.stage)}${c.score != null ? " · " + c.score + "/10" : ""}</span></li>`).join("")}</ul>` : `<p class="subtle s-small">No candidates for this role yet.</p>`}</div>` : ""}
    <form class="card card-pad stack" id="hRoleForm"><h3>Role details</h3>
      <div class="s-form">
        <div class="field"><label for="hr-title">Title</label><input class="input" id="hr-title" value="${esc(r.title)}" required></div>
        <div class="field"><label for="hr-kind">Done by</label><select class="input" id="hr-kind"><option value="ai" ${r.kind === "ai" ? "selected" : ""}>AI agent</option><option value="human" ${r.kind === "human" ? "selected" : ""}>A person</option></select></div>
        <div class="field"><label for="hr-dept">Department</label><select class="input" id="hr-dept">${opt(M.departments, r.department)}</select></div>
        <div class="field"><label for="hr-emp">Employment</label><select class="input" id="hr-emp">${opt(M.employment, r.employment)}</select></div>
        <div class="field"><label for="hr-holder">${r.kind === "ai" ? "Runs in" : "Person in the role"}</label><input class="input" id="hr-holder" value="${esc(r.holder || "")}"></div>
        <div class="field"><label for="hr-loc">Location</label><input class="input" id="hr-loc" value="${esc(r.location || "")}" placeholder="Riyadh, Remote…"></div>
        <div class="field"><label for="hr-smin">Salary min (SAR/mo)</label><input class="input" id="hr-smin" type="number" min="0" value="${r.salary_min ?? ""}"></div>
        <div class="field"><label for="hr-smax">Salary max (SAR/mo)</label><input class="input" id="hr-smax" type="number" min="0" value="${r.salary_max ?? ""}"></div>
        <div class="field"><label for="hr-rep">Reports to</label><select class="input" id="hr-rep"><option value="">Nobody</option>${HR.roles.filter((x) => x.id !== r.id).map((x) => `<option value="${x.id}" ${x.id === r.reports_to ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="hr-why">Why this must be a person</label><textarea class="input" id="hr-why" rows="2" placeholder="Leave empty if an AI agent can do it">${esc(r.must_be_human || "")}</textarea></div>
      <div class="field"><label for="hr-duties">Duties</label><textarea class="input" id="hr-duties" rows="2">${esc(r.duties || "")}</textarea></div>
      <div class="row between"><button class="btn btn-ghost btn-danger btn-sm" type="button" data-haction="delete-role">Delete role</button><button class="btn btn-primary btn-sm" type="submit">Save role</button></div>
    </form>
    <div class="card card-pad stack"><h3>History</h3>${hTimeline(data.activities, M.role_tasks)}</div>`, data);
}

async function hOpenCand(id) {
  let data; try { data = await api(`/api/workspaces/${S.ws.id}/hr/candidates/${id}`); } catch (e) { toast(e.message, true); return; }
  HR.open = { type: "cand", id };
  const c = data.candidate, M = HR.meta;
  const screen = data.activities.find((a) => a.task === "screen");
  hShow(`
    <div class="row gap-12"><span class="s-logo lg" style="background:var(--accent)">${esc(String(c.name).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
      <div style="flex:1;min-width:0"><h2>${esc(c.name)}</h2><span class="subtle">${esc(c.role_title)}${c.source ? " · " + esc(c.source) : ""}</span></div><button class="btn btn-sm" data-haction="close">Close</button></div>
    <div class="s-facts">
      <div class="card s-fact"><span class="eyebrow">AI fit score</span><b class="num">${c.score == null ? "–" : c.score + "/10"}</b></div>
      <div class="card s-fact"><span class="eyebrow">Stage</span><b>${esc(M.stages.find((s) => s.id === c.stage)?.name || c.stage)}</b></div>
      <div class="card s-fact"><span class="eyebrow">Quiet for</span><b class="num">${c.days_quiet} ${c.days_quiet === 1 ? "day" : "days"}</b></div>
    </div>
    <div class="card card-pad stack"><h3>Stage</h3><div class="s-stages">${M.stages.map((s) => `<button class="chip ${s.id === c.stage ? "active" : ""}" aria-pressed="${s.id === c.stage}" data-hcandstage="${s.id}">${s.name}</button>`).join("")}</div></div>
    <div class="card card-pad stack s-nextbox ${c.next.owner}"><span class="eyebrow">${c.next.owner === "you" ? "Next step · needs you" : "Next step · AI drafts it, you review"}</span>
      <p style="font-weight:500">${esc(c.next.text)}</p>${c.next.task ? `<div><button class="btn btn-primary btn-sm" data-hai="cand:${c.next.task}">AI: do this now</button></div>` : ""}</div>
    <div class="card card-pad stack"><div class="row between"><h3>AI Recruiter</h3><span class="subtle s-small">Judges skills and evidence only</span></div>
      <div class="row gap-8" style="flex-wrap:wrap">${Object.entries(M.candidate_tasks).map(([k, t]) => `<button class="btn btn-sm" data-hai="cand:${k}" ${k === "screen" && !c.cv_text ? "disabled title=\"Add the CV text first\"" : ""}>${esc(t)}${data.activities.some((a) => a.task === k) ? " ✓" : ""}</button>`).join("")}</div>
      <div id="hDraft" class="s-draft" hidden></div></div>
    <form class="card card-pad stack" id="hCandForm"><h3>Candidate details</h3>
      <div class="s-form">
        <div class="field"><label for="hk-name">Name</label><input class="input" id="hk-name" value="${esc(c.name)}" required></div>
        <div class="field"><label for="hk-role">Role</label><select class="input" id="hk-role"><option value="">No role</option>${HR.roles.filter((r) => r.kind === "human").map((r) => `<option value="${r.id}" ${r.id === c.role_id ? "selected" : ""}>${esc(r.title)}</option>`).join("")}</select></div>
        <div class="field"><label for="hk-email">Email</label><input class="input" id="hk-email" value="${esc(c.email || "")}"></div>
        <div class="field"><label for="hk-phone">Phone</label><input class="input" id="hk-phone" value="${esc(c.phone || "")}"></div>
      </div>
      <div class="field"><label for="hk-cv">CV or profile text</label><textarea class="input" id="hk-cv" rows="6">${esc(c.cv_text || "")}</textarea></div>
      <div class="field"><label for="hk-notes">Your notes</label><textarea class="input" id="hk-notes" rows="2">${esc(c.notes || "")}</textarea></div>
      <div class="row between"><button class="btn btn-ghost btn-danger btn-sm" type="button" data-haction="delete-cand">Delete candidate</button><button class="btn btn-primary btn-sm" type="submit">Save</button></div>
    </form>
    <div class="card card-pad stack"><h3>Interview notes and history</h3>
      <form class="row gap-8" id="hNote"><input class="input" id="hn-text" placeholder="Write interview notes or a decision…" style="flex:1"><button class="btn btn-sm" type="submit">Log</button></form>
      ${hTimeline(data.activities, M.candidate_tasks)}</div>`, data);
  if (screen && !$("#hDraft")._shown) hDraftShow(screen.text, { kind: "cand", task: "screen" });
}

function hDraftShow(text, { kind, task, streaming = false }) {
  const box = $("#hDraft"); if (!box) return;
  box.hidden = false; box._text = text; box._shown = true;
  const sendable = kind === "cand" && ["interview_kit", "rejection"].includes(task);
  box.innerHTML = `<div class="doc s-draft-body">${md(text)}</div>${streaming ? `<p class="subtle s-small">Writing…</p>` : `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-hcopy>Copy</button>${sendable ? `<button class="btn btn-primary btn-sm" data-hsent="${task}">I sent it</button>` : ""}<span class="subtle s-small">Review before using. AI never sends on its own.</span></div>`}`;
}

async function hRunAi(spec) {
  const [kind, task] = spec.split(":"), open = HR.open;
  const url = kind === "role" ? `/api/workspaces/${S.ws.id}/hr/roles/${open.id}/ai/${task}` : `/api/workspaces/${S.ws.id}/hr/candidates/${open.id}/ai/${task}`;
  hDraftShow("", { kind, task, streaming: true });
  document.querySelectorAll("[data-hai]").forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = "", last = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      text += dec.decode(value, { stream: true });
      if (Date.now() - last > 150) { last = Date.now(); hDraftShow(text.split("\n\n[[MWIZ_")[0], { kind, task, streaming: true }); }
    }
    const err = text.split("[[MWIZ_ERROR]]")[1];
    if (err !== undefined) throw new Error(err.trim());
    const body = text.split("\n\n[[MWIZ_")[0];
    await hrLoad(); hrRerender();
    kind === "role" ? await hOpenRole(open.id) : await hOpenCand(open.id);
    hDraftShow(body, { kind, task });
  } catch (e) {
    $("#hDraft").innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message || "Couldn't write the draft. Try again.")}</div>`;
  } finally { document.querySelectorAll("[data-hai]").forEach((b) => { if (!b.title) b.disabled = false; }); }
}

async function hRefreshOpen() {
  await hrLoad(); hrRerender();
  if (HR.open?.type === "role") await hOpenRole(HR.open.id);
  if (HR.open?.type === "cand") await hOpenCand(HR.open.id);
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    const tab = t.closest("[data-htab]");
    if (tab) { HR.tab = tab.dataset.htab; document.querySelectorAll("[data-htab]").forEach((b) => b.setAttribute("aria-selected", b === tab)); hrRerender(); return; }
    const f = t.closest("[data-hfilter]");
    if (f) { HR.filter = f.dataset.hfilter; hrOrg(); return; }
    const act = t.closest("[data-haction]");
    if (act) {
      const a = act.dataset.haction;
      if (a === "close") return hClose();
      if (a === "sample") { const r = await api(`/api/workspaces/${S.ws.id}/hr/sample-team`, { method: "POST", body: "{}" }); await hrLoad(); hrRerender(); return toast(`Loaded ${r.roles} roles and ${r.people} sample people`); }
      if (a === "unsample") { if (act.dataset.confirm !== "1") { act.dataset.confirm = "1"; act.textContent = "Click again to remove samples"; return; } await api(`/api/workspaces/${S.ws.id}/hr/sample-team`, { method: "DELETE" }); await hrLoad(); hrRerender(); return toast("Sample data removed"); }
      if (a === "suggest") { const r = await api(`/api/workspaces/${S.ws.id}/hr/suggested-org`, { method: "POST", body: "{}" }); await hrLoad(); hrRerender(); return toast(`Added ${r.added} roles`); }
      if (a === "add-role") {
        const r = await api(`/api/workspaces/${S.ws.id}/hr/roles`, { method: "POST", body: JSON.stringify({ title: "New role", kind: "human", status: "planned", department: "Operations" }) });
        await hrLoad(); hrRerender(); await hOpenRole(r.id); $("#hr-title")?.select(); return;
      }
      if (a === "add-cand") {
        const forRole = act.dataset.hrolefor;
        if (forRole) hClose();
        if (HR.tab !== "hiring") { HR.tab = "hiring"; document.querySelectorAll("[data-htab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.htab === "hiring")); hrRerender(); }
        const form = $("#hAdd"); form.hidden = forRole ? false : !form.hidden;
        if (forRole) $("#hc-role").value = forRole;
        if (!form.hidden) { form.scrollIntoView({ behavior: "smooth", block: "nearest" }); $("#hc-name").focus(); }
        return;
      }
      if (a === "delete-role" || a === "delete-cand") {
        if (act.dataset.confirm !== "1") { act.dataset.confirm = "1"; act.textContent = "Click again to delete"; return; }
        await api(`/api/workspaces/${S.ws.id}/hr/${a === "delete-role" ? "roles" : "candidates"}/${HR.open.id}`, { method: "DELETE" });
        hClose(); await hrLoad(); hrRerender(); return toast("Deleted");
      }
      return;
    }
    if (t.closest("#hScrim")) return hClose();
    const st = t.closest("[data-hrolestatus]");
    if (st) { await api(`/api/workspaces/${S.ws.id}/hr/roles/${HR.open.id}`, { method: "PUT", body: JSON.stringify({ status: st.dataset.hrolestatus }) }); await hRefreshOpen(); return toast("Status updated"); }
    const cs = t.closest("[data-hcandstage]");
    if (cs) { await api(`/api/workspaces/${S.ws.id}/hr/candidates/${HR.open.id}`, { method: "PUT", body: JSON.stringify({ stage: cs.dataset.hcandstage }) }); await hRefreshOpen(); return toast("Stage updated"); }
    const ai = t.closest("[data-hai]");
    if (ai) return hRunAi(ai.dataset.hai);
    const sd = t.closest("[data-hshowdraft]");
    if (sd) { const a = $("#hDrawer")._data.activities.find((x) => x.id === sd.dataset.hshowdraft); if (a) hDraftShow(a.text, { kind: HR.open.type, task: a.task }); $("#hDraft").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (t.closest("[data-hcopy]")) { try { await navigator.clipboard.writeText($("#hDraft")._text || ""); toast("Copied"); } catch { toast("Clipboard blocked by the browser", true); } return; }
    const sent = t.closest("[data-hsent]");
    if (sent) { await api(`/api/workspaces/${S.ws.id}/hr/candidates/${HR.open.id}/notes`, { method: "POST", body: JSON.stringify({ type: "sent", task: sent.dataset.hsent, text: $("#hDraft")._text || "" }) }); await hRefreshOpen(); return toast("Logged as sent"); }
    const role = t.closest("[data-hrole]");
    if (role) return hOpenRole(role.dataset.hrole);
    const cand = t.closest("[data-hcand]");
    if (cand) return hOpenCand(cand.dataset.hcand);
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("submit", async (e) => {
  const id = e.target.id;
  if (!["hAdd", "hRoleForm", "hCandForm", "hNote"].includes(id)) return;
  e.preventDefault();
  try {
    if (id === "hAdd") {
      const c = await api(`/api/workspaces/${S.ws.id}/hr/candidates`, { method: "POST", body: JSON.stringify({ name: $("#hc-name").value, role_id: $("#hc-role").value, email: $("#hc-email").value, phone: $("#hc-phone").value, source: $("#hc-src").value, cv_text: $("#hc-cv").value }) });
      await hrLoad(); hrRerender(); toast(`${c.name} added${c.cv_text ? " · AI is ready to screen" : ""}`); hOpenCand(c.id);
    }
    if (id === "hRoleForm") {
      await api(`/api/workspaces/${S.ws.id}/hr/roles/${HR.open.id}`, { method: "PUT", body: JSON.stringify({ title: $("#hr-title").value, kind: $("#hr-kind").value, department: $("#hr-dept").value, employment: $("#hr-emp").value, holder: $("#hr-holder").value, location: $("#hr-loc").value, salary_min: $("#hr-smin").value, salary_max: $("#hr-smax").value, reports_to: $("#hr-rep").value, must_be_human: $("#hr-why").value, duties: $("#hr-duties").value }) });
      await hRefreshOpen(); toast("Role saved");
    }
    if (id === "hCandForm") {
      await api(`/api/workspaces/${S.ws.id}/hr/candidates/${HR.open.id}`, { method: "PUT", body: JSON.stringify({ name: $("#hk-name").value, role_id: $("#hk-role").value, email: $("#hk-email").value, phone: $("#hk-phone").value, cv_text: $("#hk-cv").value, notes: $("#hk-notes").value }) });
      await hRefreshOpen(); toast("Saved");
    }
    if (id === "hNote") {
      const text = $("#hn-text").value.trim(); if (!text) return;
      await api(`/api/workspaces/${S.ws.id}/hr/candidates/${HR.open.id}/notes`, { method: "POST", body: JSON.stringify({ type: "interview", text }) });
      await hRefreshOpen();
    }
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#hDrawer") && !$("#hDrawer").hidden) hClose(); });

let hDragId = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-hcand].s-card"); if (!c) return; hDragId = c.dataset.hcand; c.classList.add("dragging"); });
document.addEventListener("dragend", () => { document.querySelectorAll(".s-col.over").forEach((c) => c.classList.remove("over")); });
document.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-hstage]"); if (!col || !hDragId) return; e.preventDefault(); document.querySelectorAll(".s-col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
document.addEventListener("drop", async (e) => {
  const col = e.target.closest?.("[data-hstage]"); if (!col || !hDragId) return;
  e.preventDefault(); const id = hDragId; hDragId = null;
  try { await api(`/api/workspaces/${S.ws.id}/hr/candidates/${id}`, { method: "PUT", body: JSON.stringify({ stage: col.dataset.hstage }) }); await hrLoad(); hrRerender(); toast("Stage updated"); }
  catch (err) { toast(err.message, true); }
});

if (S.route === "team" && S.ws) render();
