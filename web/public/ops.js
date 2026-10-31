/* Operations module: task board with an AI planner, Saudi compliance + renewal deadlines,
   tool stack and incidents. Uses app.js globals (S, $, api, esc, md, toast, fmtDate, ROUTES).
   AI plans goals into tasks and owns every task it can; people own approvals, filings,
   signatures, live calls and incident decisions. */

const OPS = { meta: null, d: null, tab: "board", plan: null, openInc: null };
const PRIO = { 1: ["P1", "bad"], 2: ["P2", "warn"], 3: ["P3", ""] };
const OPS_COLOR = { todo: "var(--text-3)", doing: "var(--accent)", waiting: "var(--warn)", done: "var(--good)" };
const todayIso = () => new Date().toISOString().slice(0, 10);
const opsOwner = (k) => `<span class="s-owner ${k === "human" ? "you" : "ai"}">${k === "human" ? "PERSON" : "AI"}</span>`;

ROUTES.ops = { title: "Operations", crumb: "Operations", render: renderOps };

async function opsLoad() {
  if (!OPS.meta) OPS.meta = await api("/api/ops/meta");
  OPS.d = await api(`/api/workspaces/${S.ws.id}/ops`);
}

async function renderOps(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await opsLoad();
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Operations views">
    ${[["board", "Tasks"], ["deadlines", "Deadlines"], ["stack", "Tool stack"], ["incidents", "Incidents"]].map(([k, l]) => `<button role="tab" data-otab="${k}" aria-selected="${OPS.tab === k}">${l}</button>`).join("")}</div>
    <button class="btn btn-primary" data-oaction="new-task">Add task</button>`;
  view.innerHTML = `<section class="s-kpis" id="oKpis"></section><div id="oBody" style="margin-top:20px"></div>`;
  opsRerender();
}

function opsRerender() {
  if (S.route !== "ops") return;
  const s = OPS.d.snapshot, nd = s.next_deadline;
  const tile = (label, val, sub, tone = "", tab = "") => `<div class="card s-kpi ${tone} ${tab ? "clickable" : ""}" ${tab ? `data-otab="${tab}"` : ""}><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#oKpis").innerHTML = [
    tile("Open tasks", s.tasks.open, `${s.tasks.overdue} overdue`, s.tasks.overdue ? "warn" : "", "board"),
    tile("Owned by AI", s.tasks.ai_owned_pct == null ? "–" : s.tasks.ai_owned_pct + "%", "of open tasks", "", "board"),
    tile("Done this week", s.tasks.done_week, "tasks closed"),
    tile("Next deadline", nd ? (nd.days < 0 ? `${-nd.days}d late` : nd.days === 0 ? "Today" : `${nd.days}d`) : "–", nd ? esc(nd.title) : "load the Saudi starter calendar", nd && nd.days <= 14 ? "warn" : "", "deadlines"),
    tile("Tool stack", `SAR ${s.stack.cost_sar.toLocaleString("en-US")}`, `${s.stack.count} tools · ${s.stack.critical} critical`, "", "stack"),
    tile("Open incidents", s.incidents.open, s.incidents.last ? `last: ${esc(s.incidents.last.title)}` : "none logged", s.incidents.open ? "bad" : "", "incidents"),
  ].join("");
  ({ board: opsBoard, deadlines: opsDeadlines, stack: opsStack, incidents: opsIncidents })[OPS.tab]();
}

/* ------------------------------------------------ Tasks board + AI planner */
function opsBoard() {
  const s = OPS.d.snapshot, tasks = OPS.d.tasks, today = todayIso();
  $("#oBody").innerHTML = `
    <div class="cc">
      <section class="card card-pad cc-span-8 stack">
        <div><h2>AI planner</h2><p class="subtle s-small">Write a goal. AI breaks it into tasks and gives each one to an AI agent, or to a person only when it must be human. You check the plan before it's added.</p></div>
        <form class="row gap-8" id="oPlan" style="flex-wrap:wrap"><input class="input" id="op-goal" placeholder="e.g. Launch the Salla app to 20 beta stores in Riyadh by January" style="flex:1;min-width:220px" required><button class="btn btn-primary" type="submit" id="op-go">AI: plan it</button></form>
        <div id="oPlanPreview"></div>
      </section>
      <section class="card card-pad cc-span-4 stack">
        <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${s.needs.length ? "warn" : "good"}">${s.needs.length || "All clear"}</span></div>
        ${s.needs.length ? `<ul class="cc-list">${s.needs.slice(0, 6).map((n) => `<li class="clickable" data-otab="${n.tab}"><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small">${esc(n.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Nothing in Operations needs a person right now.</p>`}
        <div class="row gap-8" style="flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px">${Object.entries(OPS.meta.reports).map(([k, t]) => `<button class="btn btn-sm" data-oai="${k}">AI: ${esc(t)}</button>`).join("")}</div>
        <div id="oDraft" class="s-draft" hidden></div>
        ${OPS.d.reports.length ? `<ul class="s-timeline">${OPS.d.reports.slice(0, 4).map((r) => `<li><span class="s-owner ai">AI</span><button class="s-link s-small" data-oreport="${r.id}">${esc(r.title)}</button><span class="subtle s-small num" style="margin-left:auto">${fmtDate(r.created_at)}</span></li>`).join("")}</ul>` : ""}
      </section>
    </div>
    ${s.tasks.by_area.length ? `<div class="o-areas">${s.tasks.by_area.map((a) => `<span class="o-area"><b>${a.area}</b> ${a.open} open · ${a.ai} AI</span>`).join("")}</div>` : ""}
    ${tasks.length ? "" : `<div class="card empty" style="margin:16px 0"><h2>No tasks yet</h2><p>Use the AI planner above, or add a task. Every task belongs to an AI agent or a person.</p></div>`}
    <div class="s-board o-board" style="margin-top:16px">${OPS.meta.statuses.map((st) => {
      const list = tasks.filter((t) => t.status === st.id).sort((a, b) => (a.priority - b.priority) || String(a.due || "9").localeCompare(String(b.due || "9")));
      return `<div class="s-col" data-ostage="${st.id}"><div class="s-col-head"><h3><i class="s-dot" style="background:${OPS_COLOR[st.id]}"></i>${st.name} <span class="subtle num">${list.length}</span></h3></div>
        ${list.slice(0, st.id === "done" ? 15 : 200).map((t) => `<button type="button" class="s-card" draggable="true" data-otask="${t.id}">
          <div class="row between gap-8"><b class="o-title">${esc(t.title)}</b><span class="badge ${PRIO[t.priority][1]}">${PRIO[t.priority][0]}</span></div>
          <div class="s-meta">${opsOwner(t.owner_kind)}<span>${esc(t.owner || "Unassigned")}</span><span>· ${esc(t.area)}</span>${t.due ? `<span class="s-age ${t.status !== "done" && t.due < today ? "stale" : ""}">${t.due.slice(5)}</span>` : ""}</div>
        </button>`).join("") || `<p class="subtle s-small" style="padding:4px">Drop a task here</p>`}</div>`;
    }).join("")}</div>`;
}

function opsPlanPreview() {
  const items = OPS.plan.items, people = OPS.d.people;
  $("#oPlanPreview").innerHTML = `<div class="table-wrap"><table class="f-table"><thead><tr><th><input type="checkbox" id="op-all" checked aria-label="Select all"></th><th>Task</th><th>Owner</th><th>Area</th><th>Due in</th></tr></thead><tbody>
    ${items.map((it, i) => `<tr><td><input type="checkbox" data-opi="${i}" checked aria-label="Include task"></td>
      <td><b>${esc(it.title)}</b><div class="subtle s-small">${esc(it.why)}</div></td>
      <td><div class="row gap-4">${opsOwner(it.owner_kind)}<select class="input input-sm" data-opowner="${i}">${[...new Set([it.owner, ...people.map((p) => p.name)])].filter(Boolean).map((n) => `<option ${n === it.owner ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div></td>
      <td>${esc(it.area)}</td><td class="num">${it.due_in_days}d</td></tr>`).join("")}
  </tbody></table></div>
  <div class="row gap-8" style="margin-top:10px"><button class="btn btn-primary" data-oaction="save-plan">Add selected tasks</button><button class="btn" data-oaction="discard-plan">Discard</button>
    <span class="subtle s-small">${items.filter((x) => x.owner_kind === "ai").length} of ${items.length} tasks go to AI agents</span></div>`;
}

function opsTaskDialog(t) {
  const d = $("#dialog"), M = OPS.meta, people = OPS.d.people;
  d.innerHTML = `<form method="dialog" id="oTaskForm">
    <div class="card-head" style="padding:20px 24px 0"><h2>${t ? "Edit task" : "New task"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      <div class="field"><label for="ot-title">Task</label><input class="input" id="ot-title" value="${esc(t?.title || "")}" required></div>
      <div class="s-form">
        <div class="field"><label for="ot-kind">Done by</label><select class="input" id="ot-kind"><option value="ai" ${t?.owner_kind !== "human" ? "selected" : ""}>AI agent</option><option value="human" ${t?.owner_kind === "human" ? "selected" : ""}>A person</option></select></div>
        <div class="field"><label for="ot-owner">Owner</label><input class="input" id="ot-owner" list="ot-people" value="${esc(t?.owner || "")}"><datalist id="ot-people">${people.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist></div>
        <div class="field"><label for="ot-area">Area</label><select class="input" id="ot-area">${M.areas.map((a) => `<option ${a === (t?.area || "Operations") ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div class="field"><label for="ot-prio">Priority</label><select class="input" id="ot-prio">${[1, 2, 3].map((p) => `<option value="${p}" ${p === (t?.priority || 2) ? "selected" : ""}>P${p}</option>`).join("")}</select></div>
        <div class="field"><label for="ot-due">Due</label><input class="input" id="ot-due" type="date" value="${t?.due || ""}"></div>
        <div class="field"><label for="ot-status">Status</label><select class="input" id="ot-status">${M.statuses.map((s) => `<option value="${s.id}" ${s.id === (t?.status || "todo") ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="ot-notes">Notes</label><textarea class="input" id="ot-notes" rows="3">${esc(t?.notes || "")}</textarea></div>
    </div>
    <div class="row between" style="padding:0 24px 24px">${t ? `<button class="btn btn-ghost btn-danger" value="delete">Delete</button>` : "<span></span>"}<div class="row gap-8"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></div>
  </form>`;
  d.showModal();
  d.onclose = async () => {
    const base = `/api/workspaces/${S.ws.id}/ops/tasks`;
    try {
      if (d.returnValue === "delete" && t) { await api(`${base}/${t.id}`, { method: "DELETE" }); toast("Task deleted"); }
      else if (d.returnValue === "ok") {
        const body = { title: $("#ot-title").value, owner_kind: $("#ot-kind").value, owner: $("#ot-owner").value, area: $("#ot-area").value, priority: $("#ot-prio").value, due: $("#ot-due").value || null, status: $("#ot-status").value, notes: $("#ot-notes").value };
        await api(t ? `${base}/${t.id}` : base, { method: t ? "PUT" : "POST", body: JSON.stringify(body) }); toast("Task saved");
      } else return;
      await opsLoad(); opsRerender();
    } catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ Deadlines */
function opsDeadlines() {
  const dl = OPS.d.snapshot.deadlines;
  const groups = [["Overdue", dl.filter((d) => d.days < 0)], ["Next 30 days", dl.filter((d) => d.days >= 0 && d.days <= 30)], ["Later", dl.filter((d) => d.days > 30)]];
  const CAT = { compliance: "accent", tax: "warn", renewal: "", other: "" };
  $("#oBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Deadlines</h2><p class="subtle s-small">Saudi compliance, tax and renewals in one place. Tool renewals come from the Tool stack. Marking a repeating deadline done moves it to its next date.</p></div>
      <div class="row gap-8"><button class="btn" data-oaction="starter">Load Saudi starter calendar</button><button class="btn btn-primary" data-oaction="new-deadline">Add deadline</button></div></div>
    <form class="card s-add" id="oDl" hidden>
      <div class="field"><label for="od-title">What</label><input class="input" id="od-title" required></div>
      <div class="field"><label for="od-due">Due</label><input class="input" id="od-due" type="date" required></div>
      <div class="field"><label for="od-cat">Type</label><select class="input" id="od-cat"><option value="compliance">Compliance</option><option value="tax">Tax</option><option value="renewal">Renewal</option><option value="other">Other</option></select></div>
      <div class="field"><label for="od-rep">Repeats</label><select class="input" id="od-rep">${OPS.meta.repeats.map((r) => `<option>${r}</option>`).join("")}</select></div>
      <div class="field"><label for="od-owner">Owner</label><input class="input" id="od-owner" value="Founder"></div>
      <div class="row gap-8" style="align-self:end"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" data-oaction="new-deadline">Cancel</button></div>
    </form>
    ${dl.length ? groups.filter(([, l]) => l.length).map(([name, list]) => `<section class="card" style="margin-bottom:16px"><div class="card-head" style="padding:14px 20px"><h3>${name} <span class="subtle num">${list.length}</span></h3></div>
      <ul class="list">${list.map((d) => `<li style="flex-wrap:wrap"><button type="button" class="o-date ${d.days < 0 ? "late" : d.days <= 14 ? "soon" : ""}" ${d.from_vendor ? "disabled" : `data-odate="${d.id}" title="Change the date"`}><b class="num">${d.due.slice(8)}</b><span>${new Date(d.due + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}</span></button>
        <div style="flex:1;min-width:0"><div class="row gap-8" style="flex-wrap:wrap"><b>${esc(d.title)}</b><span class="badge ${CAT[d.category]}">${d.category}</span>${d.repeats !== "none" ? `<span class="subtle s-small">repeats ${d.repeats}</span>` : ""}${d.starter ? `<span class="badge warn" title="Placeholder date: confirm it">confirm date</span>` : ""}</div>
          <p class="subtle s-small">${esc(d.owner || "")}${d.notes ? " · " + esc(d.notes) : ""}</p></div>
        <span class="s-small num ${d.days < 0 ? "o-late" : ""}" style="white-space:nowrap">${d.days < 0 ? `${-d.days}d late` : d.days === 0 ? "today" : `in ${d.days}d`}</span>
        ${d.starter ? `<button class="btn btn-sm" data-odate="${d.id}">Set real date</button>` : ""}
        <form class="row gap-8 o-dateform" data-odateform="${d.id}" hidden><input class="input input-sm" type="date" value="${d.due}" aria-label="New date"><button class="btn btn-sm btn-primary" type="submit">Save date</button></form>
        ${d.from_vendor ? `<button class="btn btn-sm" data-otab="stack">Edit in stack</button>` : `<button class="btn btn-sm" data-odone="${d.id}">${d.repeats !== "none" ? "Done, roll forward" : "Done"}</button><button class="btn btn-sm btn-ghost btn-danger" data-odldel="${d.id}" aria-label="Delete">✕</button>`}</li>`).join("")}</ul></section>`).join("")
      : `<div class="card empty"><h2>No deadlines yet</h2><p>Load the Saudi starter calendar (GOSI, Mudad/WPS, ZATCA VAT and Zakat, CR and Chamber renewals, PDPL review, domain). Dates are placeholders to confirm with your accountant.</p><button class="btn btn-primary" data-oaction="starter">Load Saudi starter calendar</button></div>`}`;
}

/* ------------------------------------------------ Tool stack */
function opsStack() {
  const v = OPS.d.vendors, s = OPS.d.snapshot.stack;
  $("#oBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Tool stack</h2><p class="subtle s-small">Every tool the company runs on: what it's for, who owns the login, what it costs and when it renews. Total SAR ${s.cost_sar.toLocaleString("en-US")}/month.</p></div>
      <div class="row gap-8"><button class="btn" data-oaction="from-finance">Import from Finance</button><button class="btn btn-primary" data-oaction="new-vendor">Add tool</button></div></div>
    <form class="card s-add" id="oVendor" hidden>
      <input type="hidden" id="ov-id">
      <div class="field"><label for="ov-name">Tool</label><input class="input" id="ov-name" required></div>
      <div class="field"><label for="ov-purpose">Used for</label><input class="input" id="ov-purpose"></div>
      <div class="field"><label for="ov-cost">Cost (SAR/month)</label><input class="input" id="ov-cost" type="number" min="0"></div>
      <div class="field"><label for="ov-renew">Renews</label><input class="input" id="ov-renew" type="date"></div>
      <div class="field"><label for="ov-owner">Login owner</label><input class="input" id="ov-owner"></div>
      <label class="row gap-8 s-small" style="align-self:end"><input type="checkbox" id="ov-crit"> Critical (service stops without it)</label>
      <div class="row gap-8 h-span"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" data-oaction="new-vendor">Cancel</button></div>
    </form>
    ${v.length ? `<section class="card"><div class="table-wrap"><table class="f-table"><thead><tr><th>Tool</th><th>Used for</th><th>Login owner</th><th>Renews</th><th class="num">SAR/month</th><th></th></tr></thead><tbody>
      ${v.sort((a, b) => b.cost_sar - a.cost_sar).map((x) => `<tr><td><b>${esc(x.name)}</b>${x.critical ? ' <span class="badge bad">critical</span>' : ""}</td><td>${esc(x.purpose)}</td><td>${esc(x.owner || "–")}</td><td class="num">${x.renewal_date || "–"}</td><td class="num"><b>${Number(x.cost_sar).toLocaleString("en-US")}</b></td>
        <td style="white-space:nowrap"><button class="btn btn-sm" data-ovedit="${x.id}">Edit</button><button class="btn btn-sm btn-ghost btn-danger" data-ovdel="${x.id}" aria-label="Delete ${esc(x.name)}">✕</button></td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>No tools listed</h2><p>Import your recurring costs from Finance, then add who owns each login and when it renews. Renewals show up in Deadlines.</p><button class="btn btn-primary" data-oaction="from-finance">Import from Finance</button></div>`}`;
}

/* ------------------------------------------------ Incidents */
function opsIncidents() {
  const inc = [...OPS.d.incidents].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const sel = inc.find((i) => i.id === OPS.openInc) || inc.find((i) => i.status !== "resolved") || inc[0];
  $("#oBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Incidents</h2><p class="subtle s-small">When rendering, feed imports or the app break. Log it, post updates, and let AI draft the customer notice (EN + AR) and the postmortem. A person decides what's published.</p></div>
      <button class="btn btn-primary" data-oaction="new-incident">Log incident</button></div>
    <form class="card s-add" id="oInc" hidden>
      <div class="field h-span"><label for="oi-title">What's broken</label><input class="input" id="oi-title" required placeholder="Video renders failing for Salla stores"></div>
      <div class="field"><label for="oi-sev">Severity</label><select class="input" id="oi-sev"><option value="SEV1">SEV1: service down</option><option value="SEV2" selected>SEV2: major feature broken</option><option value="SEV3">SEV3: minor</option></select></div>
      <div class="field"><label for="oi-impact">Who is affected</label><input class="input" id="oi-impact"></div>
      <div class="row gap-8 h-span"><button class="btn btn-primary" type="submit">Log incident</button><button class="btn" type="button" data-oaction="new-incident">Cancel</button></div>
    </form>
    ${inc.length ? `<div class="su-inbox">
      <aside class="card su-list"><ul class="list">${inc.map((i) => `<li class="clickable ${sel && i.id === sel.id ? "selected" : ""}" data-oinc="${i.id}"><div style="flex:1;min-width:0"><b class="s-name">${esc(i.title)}</b><span class="subtle s-small">${fmtDate(i.started_at)}</span></div><span class="badge ${i.severity === "SEV1" ? "bad" : i.severity === "SEV2" ? "warn" : ""}">${i.severity}</span><span class="badge ${i.status === "resolved" ? "good" : "warn"}">${i.status}</span></li>`).join("")}</ul></aside>
      <section class="card card-pad stack">${sel ? `
        <div class="row between" style="flex-wrap:wrap;gap:8px"><div><h2>${esc(sel.title)}</h2><span class="subtle s-small">${sel.severity} · started ${fmtDate(sel.started_at)}${sel.resolved_at ? " · resolved " + fmtDate(sel.resolved_at) : ""}</span></div>
          <div class="row gap-8">${OPS.meta.incident_status.map((st) => `<button class="chip ${st === sel.status ? "active" : ""}" data-oincstatus="${st}">${st}</button>`).join("")}</div></div>
        ${sel.impact ? `<p class="muted">Affected: ${esc(sel.impact)}</p>` : ""}
        <ul class="s-timeline">${(sel.updates || []).map((u) => `<li><span class="s-owner you">UPDATE</span><span class="s-small" style="flex:1">${esc(u.text)}</span><span class="subtle s-small num">${fmtDate(u.at)}</span></li>`).join("") || `<li class="subtle s-small">No updates yet.</li>`}</ul>
        <form class="row gap-8" id="oIncUpd"><input class="input" id="oi-upd" placeholder="Post an update (what you found, what you did)" style="flex:1"><button class="btn btn-sm" type="submit">Post</button></form>
        <div class="row gap-8" style="flex-wrap:wrap"><button class="btn" data-oaction="inc-ai">AI: customer notice + postmortem</button><button class="btn btn-ghost btn-danger btn-sm" data-oaction="inc-del">Delete incident</button></div>
        <div id="oDraft" class="s-draft" hidden></div>` : ""}</section>
    </div>` : `<div class="card empty"><h2>No incidents</h2><p>Nothing has broken yet. When something does, log it here so customers get a clear notice and the team learns from it.</p></div>`}`;
  OPS.openInc = sel?.id || null;
}

/* ------------------------------------------------ AI streaming (reports + incident) */
async function opsStream(url, body) {
  const box = $("#oDraft"); box.hidden = false; box.innerHTML = `<p class="subtle s-small">AI is writing…</p>`;
  document.querySelectorAll("[data-oai],[data-oaction='inc-ai']").forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let text = "", last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (Date.now() - last > 150) { last = Date.now(); box.innerHTML = `<div class="doc s-draft-body">${md(text.split("\n\n[[MWIZ_")[0])}</div>`; } }
    const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
    const out = text.split("\n\n[[MWIZ_")[0];
    await opsLoad(); opsRerender(); opsShow(out);
  } catch (e) { const b2 = $("#oDraft"); if (b2) b2.innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message)}</div>`; }
  finally { document.querySelectorAll("[data-oai],[data-oaction='inc-ai']").forEach((b) => (b.disabled = false)); }
}
function opsShow(text) {
  const box = $("#oDraft"); if (!box) return; box.hidden = false; box._text = text;
  box.innerHTML = `<div class="doc s-draft-body">${md(text)}</div><div class="row gap-8"><button class="btn btn-sm" data-oaction="copy">Copy</button><span class="subtle s-small">Draft for review. Nothing is published.</span></div>`;
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target, base = () => `/api/workspaces/${S.ws.id}/ops`;
  try {
    const tab = t.closest("[data-otab]");
    if (tab && S.route === "ops") { OPS.tab = tab.dataset.otab; document.querySelectorAll("[data-otab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.otab === OPS.tab)); opsRerender(); return; }
    const task = t.closest("[data-otask]"); if (task) return opsTaskDialog(OPS.d.tasks.find((x) => x.id === task.dataset.otask));
    const ai = t.closest("[data-oai]"); if (ai) return opsStream(`${base()}/ai/${ai.dataset.oai}`);
    const rep = t.closest("[data-oreport]"); if (rep) { const r = await api(`${base()}/reports/${rep.dataset.oreport}`); return opsShow(r.text); }
    const od = t.closest("[data-odate]"); if (od) { const f = document.querySelector(`[data-odateform="${od.dataset.odate}"]`); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); return; }
    const done = t.closest("[data-odone]"); if (done) { await api(`${base()}/deadlines/${done.dataset.odone}`, { method: "PUT", body: JSON.stringify({ done: true }) }); await opsLoad(); opsRerender(); return toast("Marked done"); }
    const dd = t.closest("[data-odldel]"); if (dd) { if (dd.dataset.confirm !== "1") { dd.dataset.confirm = "1"; dd.textContent = "Sure?"; return; } await api(`${base()}/deadlines/${dd.dataset.odldel}`, { method: "DELETE" }); await opsLoad(); opsRerender(); return; }
    const ve = t.closest("[data-ovedit]"); if (ve) { const v = OPS.d.vendors.find((x) => x.id === ve.dataset.ovedit); const f = $("#oVendor"); f.hidden = false; $("#ov-id").value = v.id; $("#ov-name").value = v.name; $("#ov-purpose").value = v.purpose; $("#ov-cost").value = v.cost_sar; $("#ov-renew").value = v.renewal_date || ""; $("#ov-owner").value = v.owner; $("#ov-crit").checked = !!v.critical; f.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    const vd = t.closest("[data-ovdel]"); if (vd) { if (vd.dataset.confirm !== "1") { vd.dataset.confirm = "1"; vd.textContent = "Sure?"; return; } await api(`${base()}/vendors/${vd.dataset.ovdel}`, { method: "DELETE" }); await opsLoad(); opsRerender(); return; }
    const oi = t.closest("[data-oinc]"); if (oi) { OPS.openInc = oi.dataset.oinc; opsIncidents(); return; }
    const ist = t.closest("[data-oincstatus]"); if (ist) { await api(`${base()}/incidents/${OPS.openInc}`, { method: "PUT", body: JSON.stringify({ status: ist.dataset.oincstatus }) }); await opsLoad(); opsRerender(); return toast("Status updated"); }
    if (t.id === "op-all") { document.querySelectorAll("[data-opi]").forEach((c) => (c.checked = t.checked)); return; }
    const a = t.closest("[data-oaction]"); if (!a) return;
    const act = a.dataset.oaction;
    const toggle = (tabName, id, focus) => { if (OPS.tab !== tabName) { OPS.tab = tabName; document.querySelectorAll("[data-otab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.otab === tabName)); opsRerender(); } const f = $(id); f.hidden = !f.hidden; if (!f.hidden && focus) $(focus).focus(); };
    if (act === "new-task") return opsTaskDialog(null);
    if (act === "new-deadline") return toggle("deadlines", "#oDl", "#od-title");
    if (act === "new-vendor") { toggle("stack", "#oVendor", "#ov-name"); $("#ov-id").value = ""; return; }
    if (act === "new-incident") return toggle("incidents", "#oInc", "#oi-title");
    if (act === "starter") { const r = await api(`${base()}/deadlines/starter`, { method: "POST", body: "{}" }); await opsLoad(); opsRerender(); return toast(`Added ${r.added} deadlines. Confirm each date.`); }
    if (act === "from-finance") { const r = await api(`${base()}/vendors/from-finance`, { method: "POST", body: "{}" }); await opsLoad(); opsRerender(); return toast(r.added ? `Imported ${r.added} tools from Finance` : "No new recurring costs in Finance to import"); }
    if (act === "save-plan") {
      const items = OPS.plan.items.map((it, i) => ({ ...it, owner: $(`[data-opowner="${i}"]`).value })).filter((_, i) => $(`[data-opi="${i}"]`).checked);
      const r = await api(`${base()}/tasks/bulk`, { method: "POST", body: JSON.stringify({ items, goal: OPS.plan.goal }) });
      OPS.plan = null; await opsLoad(); opsRerender(); return toast(`Added ${r.saved} tasks`);
    }
    if (act === "discard-plan") { OPS.plan = null; $("#oPlanPreview").innerHTML = ""; return; }
    if (act === "inc-ai") return opsStream(`${base()}/ai/incident`, { incident_id: OPS.openInc });
    if (act === "inc-del") { if (a.dataset.confirm !== "1") { a.dataset.confirm = "1"; a.textContent = "Click again to delete"; return; } await api(`${base()}/incidents/${OPS.openInc}`, { method: "DELETE" }); OPS.openInc = null; await opsLoad(); opsRerender(); return; }
    if (act === "copy") { try { await navigator.clipboard.writeText($("#oDraft")._text || ""); toast("Copied"); } catch { toast("Clipboard blocked by the browser", true); } return; }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("submit", async (e) => {
  const df = e.target.closest?.("[data-odateform]");
  if (df) {
    e.preventDefault();
    try { await api(`/api/workspaces/${S.ws.id}/ops/deadlines/${df.dataset.odateform}`, { method: "PUT", body: JSON.stringify({ due: df.querySelector("input").value }) }); await opsLoad(); opsRerender(); toast("Date saved"); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const id = e.target.id;
  if (!["oPlan", "oDl", "oVendor", "oInc", "oIncUpd"].includes(id)) return;
  e.preventDefault();
  const base = `/api/workspaces/${S.ws.id}/ops`;
  try {
    if (id === "oPlan") {
      const goal = $("#op-goal").value.trim(), btn = $("#op-go"); btn.disabled = true; btn.textContent = "AI is planning…";
      try { const r = await api(`${base}/plan`, { method: "POST", body: JSON.stringify({ goal }) }); OPS.plan = { goal, items: r.items }; opsPlanPreview(); }
      finally { btn.disabled = false; btn.textContent = "AI: plan it"; }
      return;
    }
    if (id === "oDl") await api(`${base}/deadlines`, { method: "POST", body: JSON.stringify({ title: $("#od-title").value, due: $("#od-due").value, category: $("#od-cat").value, repeats: $("#od-rep").value, owner: $("#od-owner").value }) });
    if (id === "oVendor") { const vid = $("#ov-id").value; await api(`${base}/vendors${vid ? "/" + vid : ""}`, { method: vid ? "PUT" : "POST", body: JSON.stringify({ name: $("#ov-name").value, purpose: $("#ov-purpose").value, cost_sar: $("#ov-cost").value, renewal_date: $("#ov-renew").value, owner: $("#ov-owner").value, critical: $("#ov-crit").checked }) }); }
    if (id === "oInc") { const r = await api(`${base}/incidents`, { method: "POST", body: JSON.stringify({ title: $("#oi-title").value, severity: $("#oi-sev").value, impact: $("#oi-impact").value }) }); OPS.openInc = r.id; }
    if (id === "oIncUpd") { const text = $("#oi-upd").value.trim(); if (!text) return; await api(`${base}/incidents/${OPS.openInc}`, { method: "PUT", body: JSON.stringify({ update: text }) }); }
    await opsLoad(); opsRerender(); toast("Saved");
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

// Drag tasks between status columns.
let oDrag = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-otask]"); if (c) oDrag = c.dataset.otask; });
document.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-ostage]"); if (col && oDrag) { e.preventDefault(); document.querySelectorAll(".s-col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); } });
document.addEventListener("drop", async (e) => {
  const col = e.target.closest?.("[data-ostage]"); if (!col || !oDrag) return;
  e.preventDefault(); const id = oDrag; oDrag = null;
  try { await api(`/api/workspaces/${S.ws.id}/ops/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status: col.dataset.ostage }) }); await opsLoad(); opsRerender(); }
  catch (err) { toast(err.message, true); }
});

if (S.route === "ops" && S.ws) render();
