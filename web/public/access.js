/* Teams & roles: people with their own logins, roles with None / View / Edit per module,
   teams, and an activity log of every change. The server enforces access; this page manages it. */

const ACC = { d: null, tab: "people" };
const LVL_TONE = { edit: "good", view: "accent", none: "" };

ROUTES.access = { title: "Teams & roles", crumb: "Teams & roles", render: renderAccess };

async function accLoad() { ACC.d = await api("/api/admin"); }

async function renderAccess(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await accLoad();
  const canEdit = levelFor("access") === "edit";
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Teams and roles views">
    ${[["people", "People"], ["roles", "Roles"], ["teams", "Teams"], ["activity", "Activity"]].map(([k, l]) => `<button role="tab" data-acctab="${k}" aria-selected="${ACC.tab === k}">${l}</button>`).join("")}</div>
    ${canEdit ? `<button class="btn btn-primary" data-accact="add-person">Add person</button>` : ""}`;
  view.innerHTML = `<section class="s-kpis" id="accKpis"></section><div id="accBody" style="margin-top:20px"></div>`;
  accRerender();
}

const roleName = (id) => ACC.d.roles.find((r) => r.id === id)?.name || id;
const teamName = (id) => ACC.d.teams.find((t) => t.id === id)?.name || "";
const userName = (id) => ACC.d.users.find((u) => u.id === id)?.name || "";

function accRerender() {
  if (S.route !== "access") return;
  const d = ACC.d, active = d.users.filter((u) => u.active);
  const tile = (label, val, sub, tab) => `<div class="card s-kpi clickable" data-acctab="${tab}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#accKpis").innerHTML = [
    tile("People", active.length, `${d.users.length - active.length} deactivated`, "people"),
    tile("Owners", active.filter((u) => u.role_id === "owner").length, S.me.shared_login ? "you're on the team password" : "keep at least one", "people"),
    tile("Roles", d.roles.length, `${d.roles.filter((r) => !r.builtin && !DEFAULT_ROLE_IDS.includes(r.id)).length} custom`, "roles"),
    tile("Teams", d.teams.length, d.teams.length ? d.teams.map((t) => t.name).slice(0, 2).join(", ") : "load the starter teams", "teams"),
    tile("Changes logged", d.audit.length, d.audit[0] ? `last: ${esc(d.audit[0].user_name)}` : "nothing yet", "activity"),
  ].join("");
  document.querySelectorAll("[data-acctab]").forEach((b) => b.getAttribute("role") === "tab" && b.setAttribute("aria-selected", b.dataset.acctab === ACC.tab));
  const body = $("#accBody");
  const notice = S.me.shared_login ? `<div class="card" style="padding:14px 18px;margin-bottom:16px;border-color:var(--warn)"><b>You're signed in with the shared team password.</b> <span class="muted">Add yourself as an Owner below, sign out, and sign in with your email. Then give every teammate their own login, so access and the activity log are per person.</span></div>` : "";
  body.innerHTML = notice + ({ people: accPeople, roles: accRoles, teams: accTeams, activity: accActivity }[ACC.tab])();
}
const DEFAULT_ROLE_IDS = ["owner", "admin", "manager", "member", "finance", "viewer"];

function accPeople() {
  const d = ACC.d, canEdit = levelFor("access") === "edit";
  if (!d.users.length) return `<div class="card empty"><h2>No personal logins yet</h2><p>Everyone shares the team password today. Add each person with their email and a temporary password, and pick a role that limits what they can see and change.</p>${canEdit ? `<button class="btn btn-primary" data-accact="add-person">Add the first person</button>` : ""}</div>`;
  return `<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.users.map((u) => `<tr${u.active ? "" : ' style="opacity:.55"'}><td><b>${esc(u.name)}</b><div class="subtle">${esc(u.email)}</div></td>
      <td><span class="badge ${u.role_id === "owner" ? "accent" : ""}">${esc(roleName(u.role_id))}</span></td>
      <td>${(u.team_ids || []).map((t) => `<span class="badge">${esc(teamName(t))}</span>`).join(" ") || '<span class="subtle">–</span>'}</td>
      <td class="subtle">${u.last_login_at ? fmtDate(u.last_login_at) : "never"}</td>
      <td>${u.active ? '<span class="badge good">Active</span>' : '<span class="badge">Deactivated</span>'}</td>
      <td style="text-align:right">${canEdit ? `<button class="btn btn-sm" data-accact="edit-person" data-id="${u.id}">Edit</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}

function accRoles() {
  const d = ACC.d, canEdit = levelFor("access") === "edit";
  const count = (rid) => d.users.filter((u) => u.active && u.role_id === rid).length;
  return `<div class="card"><div class="card-head"><div><h2>Who can do what</h2><p class="subtle" style="font-size:13px">None hides the page. View can look. Edit can change. The server checks this on every request.</p></div>${canEdit ? `<button class="btn" data-accact="add-role">Add role</button>` : ""}</div>
  <div class="table-wrap"><table class="table acc-matrix"><thead><tr><th>Module</th>${d.roles.map((r) => `<th title="${esc(r.description || "")}">${esc(r.name)}<div class="subtle" style="font-weight:400">${count(r.id)} ${count(r.id) === 1 ? "person" : "people"}</div></th>`).join("")}</tr></thead><tbody>
  ${d.modules.map((m) => `<tr><td>${esc(m.name)}</td>${d.roles.map((r) => {
    const v = r.perms[m.id] || "none";
    return `<td>${canEdit && !r.locked ? `<select class="input input-sm acc-lvl lvl-${v}" data-role="${r.id}" data-mod="${m.id}" aria-label="${esc(r.name)} · ${esc(m.name)}">${d.levels.map((l) => `<option value="${l}" ${l === v ? "selected" : ""}>${l[0].toUpperCase() + l.slice(1)}</option>`).join("")}</select>` : `<span class="badge ${LVL_TONE[v]}">${v[0].toUpperCase() + v.slice(1)}</span>`}</td>`;
  }).join("")}</tr>`).join("")}
  </tbody>${canEdit ? `<tfoot><tr><td></td>${d.roles.map((r) => `<td>${r.builtin || DEFAULT_ROLE_IDS.includes(r.id) ? "" : `<button class="btn btn-sm btn-ghost" data-accact="del-role" data-id="${r.id}">Delete</button>`}</td>`).join("")}</tr></tfoot>` : ""}</table></div></div>
  <div class="grid-2" style="margin-top:16px">${d.roles.map((r) => `<div class="card" style="padding:14px 18px"><b>${esc(r.name)}</b>${r.locked ? ' <span class="badge">locked</span>' : ""}<p class="muted" style="font-size:13px;margin-top:4px">${esc(r.description || "Custom role.")}</p></div>`).join("")}</div>`;
}

function accTeams() {
  const d = ACC.d, canEdit = levelFor("access") === "edit";
  const head = `<div class="row gap-8" style="justify-content:flex-end;margin-bottom:12px">${canEdit ? `<button class="btn" data-accact="starter-teams">Load starter teams</button><button class="btn btn-primary" data-accact="add-team">Add team</button>` : ""}</div>`;
  if (!d.teams.length) return head + `<div class="card empty"><h2>No teams yet</h2><p>Teams group people around the work: Leadership, Growth & Sales, Customer Success, Product & Engineering. Load the starter set for DPA AD or add your own.</p></div>`;
  const modName = (id) => d.modules.find((m) => m.id === id)?.name.split(" (")[0] || id;
  return head + `<div class="grid-2">${d.teams.map((t) => {
    const members = d.users.filter((u) => (u.team_ids || []).includes(t.id));
    return `<div class="card"><div class="card-head"><div><h2>${esc(t.name)}</h2><p class="subtle" style="font-size:13px">${esc(t.description || "")}</p></div>${canEdit ? `<button class="btn btn-sm" data-accact="edit-team" data-id="${t.id}">Edit</button>` : ""}</div>
      <div class="card-body stack" style="padding:14px 18px">
        <div><span class="eyebrow">Lead</span><div>${t.lead_id ? esc(userName(t.lead_id)) : '<span class="subtle">not set</span>'}</div></div>
        <div><span class="eyebrow">Members (${members.length})</span><div>${members.map((u) => `<span class="badge">${esc(u.name)}</span>`).join(" ") || '<span class="subtle">nobody yet</span>'}</div></div>
        <div><span class="eyebrow">Owns</span><div>${(t.modules || []).map((m) => `<span class="badge accent">${esc(modName(m))}</span>`).join(" ") || '<span class="subtle">–</span>'}</div></div>
      </div></div>`;
  }).join("")}</div>`;
}

function accActivity() {
  const a = ACC.d.audit;
  if (!a.length) return `<div class="card empty"><h2>No changes yet</h2><p>Every change anyone makes (adding a deal, editing a role, logging an expense) is recorded here with who and when.</p></div>`;
  return `<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Module</th><th>What</th></tr></thead><tbody>
    ${a.map((e) => `<tr><td class="subtle" style="white-space:nowrap">${fmtDate(e.at || e.created_at)}</td><td>${esc(e.user_name)}</td><td>${e.module ? `<span class="badge">${esc(e.module)}</span>` : ""}</td><td>${esc(e.summary)}</td></tr>`).join("")}
  </tbody></table></div><p class="subtle" style="padding:10px 18px;font-size:12px">Showing the latest 300 changes.</p></div>`;
}

// ---- dialogs
function accDialog(html, onOk) {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" style="min-width:min(520px,92vw)">${html}
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try { await onOk(d); await accLoad(); accRerender(); } catch (err) { toast(err.message, true); }
  };
}
const checks = (name, items, picked) => `<div class="row gap-8" style="flex-wrap:wrap">${items.map(([id, label]) => `<label class="chip"><input type="checkbox" name="${name}" value="${id}" ${picked.includes(id) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>`;
const picked = (d, name) => [...d.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
const roleOpts = (cur) => ACC.d.roles.filter((r) => r.id !== "owner" || S.me.user.role_id === "owner").map((r) => `<option value="${r.id}" ${r.id === cur ? "selected" : ""}>${esc(r.name)}</option>`).join("");

function personDialog(u) {
  const teams = ACC.d.teams.map((t) => [t.id, t.name]);
  accDialog(`<div style="padding:20px 24px 0"><h2>${u ? "Edit " + esc(u.name) : "Add a person"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      <div class="field"><label for="ap-name">Name</label><input class="input" id="ap-name" value="${esc(u?.name || "")}" required></div>
      ${u ? `<div class="field"><label>Email</label><div class="muted">${esc(u.email)}</div></div>` : `<div class="field"><label for="ap-email">Email (they sign in with this)</label><input class="input" id="ap-email" type="email" required></div>`}
      <div class="field"><label for="ap-role">Role</label><select class="input" id="ap-role">${roleOpts(u?.role_id || "member")}</select><span class="hint">${esc(ACC.d.roles.find((r) => r.id === (u?.role_id || "member"))?.description || "")}</span></div>
      ${teams.length ? `<div class="field"><label>Teams</label>${checks("ap-team", teams, u?.team_ids || [])}</div>` : ""}
      <div class="field"><label for="ap-pw">${u ? "Reset password (leave empty to keep)" : "Temporary password (10+ characters)"}</label><input class="input" id="ap-pw" type="text" autocomplete="off" ${u ? "" : "required minlength=10"} placeholder="${u ? "" : "Share it privately; they can change it in their account"}"></div>
      ${u ? `<label class="row gap-8"><input type="checkbox" id="ap-active" ${u.active ? "checked" : ""}> Active (unticked = can't sign in)</label>` : ""}
    </div>`, async (d) => {
    const body = { name: $("#ap-name").value, role_id: $("#ap-role").value, team_ids: picked(d, "ap-team") };
    const pw = $("#ap-pw").value.trim(); if (pw) body.password = pw;
    if (u) { body.active = $("#ap-active").checked; await api(`/api/admin/users/${u.id}`, { method: "PUT", body: JSON.stringify(body) }); toast("Saved"); }
    else { body.email = $("#ap-email").value; await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) }); toast(`Added. Send ${body.email} the link wizard.dpa.ad and their temporary password.`); }
  });
}

function teamDialog(t) {
  const d0 = ACC.d;
  accDialog(`<div style="padding:20px 24px 0"><h2>${t ? "Edit team" : "Add a team"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      <div class="field"><label for="at-name">Name</label><input class="input" id="at-name" value="${esc(t?.name || "")}" required></div>
      <div class="field"><label for="at-desc">What this team owns</label><input class="input" id="at-desc" value="${esc(t?.description || "")}"></div>
      <div class="field"><label for="at-lead">Lead</label><select class="input" id="at-lead"><option value="">Not set</option>${d0.users.filter((u) => u.active).map((u) => `<option value="${u.id}" ${t?.lead_id === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
      ${d0.users.length ? `<div class="field"><label>Members</label>${checks("at-mem", d0.users.filter((u) => u.active).map((u) => [u.id, u.name]), t ? d0.users.filter((u) => (u.team_ids || []).includes(t.id)).map((u) => u.id) : [])}</div>` : ""}
      <div class="field"><label>Modules it owns</label>${checks("at-mod", d0.modules.map((m) => [m.id, m.name.split(" (")[0]]), t?.modules || [])}<span class="hint">Ownership is for clarity. Access comes from each person's role.</span></div>
      ${t ? `<button class="btn btn-ghost" type="button" data-accact="del-team" data-id="${t.id}" style="align-self:flex-start;color:var(--bad)">Delete team</button>` : ""}
    </div>`, async (d) => {
    const body = { name: $("#at-name").value, description: $("#at-desc").value, lead_id: $("#at-lead").value || null, modules: picked(d, "at-mod"), member_ids: picked(d, "at-mem") };
    if (t) await api(`/api/admin/teams/${t.id}`, { method: "PUT", body: JSON.stringify(body) });
    else { const nt = await api("/api/admin/teams", { method: "POST", body: JSON.stringify(body) }); if (body.member_ids.length) await api(`/api/admin/teams/${nt.id}`, { method: "PUT", body: JSON.stringify({ member_ids: body.member_ids }) }); }
    toast("Saved");
  });
}

document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-acctab]");
  if (tab && S.route === "access") { ACC.tab = tab.dataset.acctab; accRerender(); return; }
  const b = e.target.closest("[data-accact]");
  if (!b || S.route !== "access") return;
  const id = b.dataset.id, act = b.dataset.accact;
  try {
    if (act === "add-person") return personDialog(null);
    if (act === "edit-person") return personDialog(ACC.d.users.find((u) => u.id === id));
    if (act === "add-team") return teamDialog(null);
    if (act === "edit-team") return teamDialog(ACC.d.teams.find((t) => t.id === id));
    if (act === "add-role") {
      return accDialog(`<div style="padding:20px 24px 0"><h2>Add a role</h2><p class="subtle" style="font-size:13px">Starts as View everywhere except Finance and Teams & roles. Adjust it in the matrix.</p></div>
        <div class="card-body stack" style="padding:16px 24px"><div class="field"><label for="ar-name">Name</label><input class="input" id="ar-name" required placeholder="e.g. Agency partner"></div>
        <div class="field"><label for="ar-desc">Description</label><input class="input" id="ar-desc"></div></div>`, async () => {
        const perms = Object.fromEntries(ACC.d.modules.map((m) => [m.id, ["finance", "admin"].includes(m.id) ? "none" : "view"]));
        await api("/api/admin/roles", { method: "POST", body: JSON.stringify({ name: $("#ar-name").value, description: $("#ar-desc").value, perms }) });
        ACC.tab = "roles"; toast("Role added");
      });
    }
    if (act === "del-role") { if (!confirm("Delete this role?")) return; await api(`/api/admin/roles/${id}`, { method: "DELETE" }); }
    if (act === "del-team") { if (!confirm("Delete this team? People stay; they just leave the team.")) return; $("#dialog").close(); await api(`/api/admin/teams/${id}`, { method: "DELETE" }); }
    if (act === "starter-teams") { const r = await api("/api/admin/teams/starter", { method: "POST" }); toast(r.added ? `Added ${r.added} teams` : "Starter teams are already there"); ACC.tab = "teams"; }
    await accLoad(); accRerender();
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("change", async (e) => {
  const s = e.target.closest(".acc-lvl");
  if (!s) return;
  try {
    await api(`/api/admin/roles/${s.dataset.role}`, { method: "PUT", body: JSON.stringify({ perms: { [s.dataset.mod]: s.value } }) });
    s.className = `input input-sm acc-lvl lvl-${s.value}`;
    const r = ACC.d.roles.find((x) => x.id === s.dataset.role); r.perms[s.dataset.mod] = s.value;
    toast(`${r.name}: ${s.value} on ${ACC.d.modules.find((m) => m.id === s.dataset.mod).name.split(" (")[0]}`);
    if (r.id === S.me.user.role_id) { S.me = await api("/api/me"); applyAccess(); }
  } catch (err) { toast(err.message, true); await accLoad(); accRerender(); }
});

if (S.route === "access" && S.ws) render();
