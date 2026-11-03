/* Attendance & payroll (India). Loaded after app.js; uses its globals (S, $, api, esc, toast, ROUTES).
   Everyone linked to an employee punches in from "My day" (sidebar). Admins run attendance, leave
   and settings (team module); payroll runs need the payroll module. Every rate is an estimate to
   verify with the CA; leave defaults vary by state Shops & Establishments Act. */

const PPL = { meta: null, d: null, tab: "today", month: null, att: null, leave: null, pay: null, payMonth: null, me: null, sal: null, sideWs: null };
const PPL_TABS = [["today", "Today", "team"], ["attendance", "Attendance", "team"], ["leave", "Leave", "team"], ["payroll", "Payroll", "payroll"], ["employees", "Employees", "team"], ["settings", "Settings", "team"]];
const PPL_TONE = { present: "good", late: "warn", half_day: "warn", half_leave: "accent", absent: "bad", missing_out: "bad", weekly_off: "off", holiday: "hol", leave: "accent", in: "good", out: "", not_in: "", upcoming: "", untracked: "", na: "" };
const pplInr = (n) => (n == null ? "–" : "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"));
const pplLvl = (m) => (S.me ? S.me.perms[m] || "none" : "edit");
const pplCan = (m, need = "view") => (need === "edit" ? pplLvl(m) === "edit" : pplLvl(m) !== "none");
const pplMonthNow = () => (PPL.d?.today || new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10)).slice(0, 7);
const pplPrevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const pplMonthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const pplStatus = (st) => PPL.meta?.day_status?.[st]?.name || st;
const pplBadge = (st, extra = "") => `<span class="ppl-st ppl-${PPL_TONE[st] || "none"}">${esc(pplStatus(st))}${extra}</span>`;
const pplTypeName = (id) => PPL.meta?.leave_types.find((t) => t.id === id)?.name || id;
const pplSample = (x) => (x?.sample ? ` <span class="badge warn">Sample</span>` : "");
const pplTile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(label)}</span><b class="num">${val}</b><span class="subtle">${esc(sub)}</span></div>`;

ROUTES.people = { title: "Attendance & payroll", crumb: "People", render: renderPeople };

function pplDialog(html, wide = false) {
  let d = $("#pplDialog");
  if (!d) { d = document.createElement("dialog"); d.id = "pplDialog"; d.className = "dialog"; document.body.appendChild(d); d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); }
  d.classList.toggle("ppl-wide", wide);
  d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
const pplClose = () => $("#pplDialog")?.close();
const pplHead = (title, sub = "") => `<div class="card-head" style="padding:20px 24px 0"><div><h2>${title}</h2>${sub ? `<p class="subtle" style="font-size:13px">${sub}</p>` : ""}</div><button class="btn btn-sm btn-ghost" type="button" data-pplact="close" aria-label="Close">Close</button></div>`;

async function pplMeta() { if (!PPL.meta) PPL.meta = await api("/api/people/meta"); }

async function renderPeople(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await pplMeta();
  const tabs = PPL_TABS.filter(([, , m]) => pplCan(m));
  if (S.param && tabs.some(([k]) => k === S.param)) PPL.tab = S.param;
  if (!tabs.some(([k]) => k === PPL.tab)) PPL.tab = tabs[0]?.[0] || "today";
  if (pplCan("team")) PPL.d = await api(`/api/workspaces/${S.ws.id}/people`);
  PPL.me = await api(`/api/me/people/${S.ws.id}`);
  $("#pageActions").innerHTML = `<div class="s-tabs ppl-tabs" role="tablist" aria-label="Attendance and payroll views">${tabs.map(([k, l]) => `<button role="tab" data-ptab="${k}" aria-selected="${PPL.tab === k}">${l}</button>`).join("")}</div>`;
  view.innerHTML = `<div id="pplBody"></div>`;
  await pplRerender();
}

async function pplRerender() {
  if (S.route !== "people") return;
  document.querySelectorAll("[data-ptab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ptab === PPL.tab));
  const body = $("#pplBody");
  try {
    await ({ today: pplToday, attendance: pplAttendance, leave: pplLeave, payroll: pplPayroll, employees: pplEmployees, settings: pplSettings })[PPL.tab](body);
  } catch (err) { body.innerHTML = `<div class="card empty"><p>${esc(err.message)}</p></div>`; }
}

/* ------------------------------------------------ My day (punch) */
function pplMyDayCard(me) {
  if (!me?.linked) return "";
  const st = me.status, isIn = st.status === "in";
  const t = me.month?.totals;
  return `<section class="card card-pad ppl-myday" aria-label="My day">
    <div class="row between" style="flex-wrap:wrap;gap:12px"><div><span class="eyebrow">My day · ${esc(me.today)} · IST</span><h2 style="margin-top:4px">${esc(me.employee.name)}</h2>
      <p class="subtle s-small">Shift ${esc(me.settings.shift_start)}–${esc(me.settings.shift_end)} IST · ${esc(String(me.settings.grace_min))} min grace</p></div>${pplBadge(st.status, st.late ? " · late" : "")}</div>
    <button class="ppl-punch ${isIn ? "out" : ""}" type="button" data-pplact="punch">${isIn ? "Punch out" : "Punch in"}<span>${isIn ? `In since ${esc(st.first_in)} IST` : st.hours ? `${esc(String(st.hours))} h worked today` : "Records the server time in IST"}</span></button>
    ${me.sessions.length ? `<ul class="ppl-sessions">${me.sessions.map((s) => `<li><span class="num">${esc(s.in_time)}</span> → <span class="num">${s.out_time ? esc(s.out_time) : "…"}</span>${s.source === "admin" ? ` <span class="badge">corrected</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${t ? `<div class="ppl-chips"><span>Present <b>${t.present}</b></span><span>Half days <b>${t.half_days}</b></span><span>Absent <b>${t.absent}</b></span><span>Late <b>${t.late}</b></span><span>Leave <b>${t.leave}</b></span><span>Loss of pay <b>${t.lop}</b></span></div>` : ""}
  </section>`;
}

async function pplPunch() {
  const r = await api(`/api/me/people/${S.ws.id}/punch`, { method: "POST", body: "{}" });
  toast(`Punched ${r.action} at ${r.time_ist} IST`);
  PPL.me = await api(`/api/me/people/${S.ws.id}`);
  pplSideRender();
  if ($("#pplDialog")?.open && $("#pplMyDay")) pplMyDayDialog();
  if (S.route === "people") { if (pplCan("team")) PPL.d = await api(`/api/workspaces/${S.ws.id}/people`); pplRerender(); }
}

function pplSideRender() {
  const box = $("#myPunch");
  if (!box) return;
  const me = PPL.me;
  if (!me?.linked) { box.innerHTML = ""; return; }
  const isIn = me.status.status === "in";
  box.innerHTML = `<div class="ppl-side"><button class="btn btn-sm ${isIn ? "" : "btn-primary"}" data-pplact="punch" type="button">${isIn ? "Punch out" : "Punch in"}</button><button class="btn btn-sm btn-ghost" data-pplact="myday" type="button">My day${me.approvals?.length ? ` · ${me.approvals.length}` : ""}</button></div>`;
}
async function pplSide(force = false) {
  if (!S.ws || !S.me) return;
  if (!force && PPL.sideWs === S.ws.id) return;
  PPL.sideWs = S.ws.id;
  try { await pplMeta(); PPL.me = await api(`/api/me/people/${S.ws.id}`); } catch { PPL.me = null; }
  pplSideRender();
}
const pplBoot = setInterval(() => { if (S.ws && S.me) { clearInterval(pplBoot); pplSide(); } }, 300);
window.addEventListener("hashchange", () => setTimeout(() => pplSide(), 100));

function pplLeaveForm(prefix, employees = null) {
  const types = employees ? PPL.meta.leave_types.filter((t) => PPL.d.settings.leave[t.id]?.enabled) : PPL.me.leave_types;
  return `<form class="ppl-form" id="${prefix}Leave">
    ${employees ? `<div class="field"><label for="${prefix}-emp">Employee</label><select class="input" id="${prefix}-emp" required>${employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label for="${prefix}-type">Type</label><select class="input" id="${prefix}-type">${types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="${prefix}-from">From</label><input class="input" type="date" id="${prefix}-from" required></div>
    <div class="field"><label for="${prefix}-to">To</label><input class="input" type="date" id="${prefix}-to"></div>
    <label class="row gap-4 s-small"><input type="checkbox" id="${prefix}-half"> Half day (single date)</label>
    <label class="row gap-4 s-small"><input type="checkbox" id="${prefix}-third"> Maternity: 2+ surviving children (12 weeks)</label>
    <div class="field ppl-span"><label for="${prefix}-reason">Reason</label><input class="input" id="${prefix}-reason" dir="auto" maxlength="300"></div>
    <div class="ppl-span"><button class="btn btn-primary btn-sm" type="submit">Apply</button></div></form>`;
}
const pplLeaveBody = (prefix) => {
  const v = (id) => $(`#${prefix}-${id}`);
  return { employee_id: v("emp")?.value, type: v("type").value, from: v("from").value, to: v("to").value || v("from").value, half_day: v("half").checked, third_child: v("third").checked, reason: v("reason").value };
};

function pplBalanceTable(bal) {
  return `<div class="table-wrap"><table class="f-table"><thead><tr><th>Leave</th><th class="num">Carried</th><th class="num">Accrued</th><th class="num">Adjusted</th><th class="num">Used</th><th class="num">Pending</th><th class="num">Available</th></tr></thead><tbody>
    ${bal.map((b) => `<tr><td>${esc(b.name)}${b.non_statutory ? ` <span class="badge">company policy</span>` : ""}</td>${b.accrual === "event" ? `<td colspan="6" class="subtle">${esc(String(b.entitlement_weeks))} weeks per eligible birth (${esc(String(b.entitlement_weeks_third))} from the third child)</td>`
      : b.accrual === "none" ? `<td colspan="5" class="subtle">Unpaid</td><td class="num">${esc(String(b.used))} used</td>`
      : `<td class="num">${b.carried}</td><td class="num">${b.accrued}</td><td class="num">${b.adjusted}</td><td class="num">${b.used}</td><td class="num">${b.pending}</td><td class="num"><b>${b.available}</b></td>`}</tr>`).join("")}</tbody></table></div>`;
}

function pplMyDayDialog() {
  const me = PPL.me;
  if (!me?.linked) return;
  pplDialog(`<div id="pplMyDay">${pplHead("My day: attendance, leave, payslips", esc(`${me.employee.designation || ""}${me.employee.manager_name ? " · reports to " + me.employee.manager_name : ""}`))}
    <div class="card-body stack" style="padding:16px 24px 24px">
      ${pplMyDayCard(me)}
      ${me.approvals.length ? `<section><h3>To approve (your team)</h3>${me.approvals.map((r) => pplReqRow(r, "mine-approve")).join("")}</section>` : ""}
      <section><h3>My leave balance</h3>${pplBalanceTable(me.balances)}<p class="subtle s-small">Leave year Jan–Dec. Earned leave accrues monthly. Rules follow company policy; they vary by state.</p></section>
      <section><h3>Apply for leave</h3>${pplLeaveForm("pplMe")}</section>
      ${me.requests.length ? `<section><h3>My requests</h3>${me.requests.slice(0, 10).map((r) => pplReqRow(r, "mine")).join("")}</section>` : ""}
      <section><h3>My payslips</h3>${me.payslips.length ? `<ul class="ppl-list">${me.payslips.map((p) => `<li><a href="/api/me/people/${esc(S.ws.id)}/payslips/${esc(p.run_id)}" target="_blank" rel="noopener">${esc(pplMonthName(p.month))}</a><span class="num">${pplInr(p.net)}</span></li>`).join("")}</ul>` : `<p class="subtle s-small">No approved payslips yet.</p>`}</section>
      ${me.holidays.length ? `<section><h3>Upcoming holidays</h3><ul class="ppl-list">${me.holidays.map((h) => `<li><span>${esc(h.name)}</span><span class="num">${esc(h.date)}</span></li>`).join("")}</ul></section>` : ""}
    </div></div>`, true);
}

function pplReqRow(r, mode) {
  const st = { pending: "warn", approved: "good", rejected: "bad", cancelled: "" }[r.status] || "";
  const acts = mode === "mine" && r.status === "pending" ? `<button class="btn btn-sm btn-ghost" data-pplact="me-cancel" data-id="${esc(r.id)}">Cancel</button>`
    : (mode === "admin" || mode === "mine-approve") && r.status === "pending" ? `<button class="btn btn-sm btn-primary" data-pplact="${mode === "admin" ? "decide" : "me-decide"}" data-decision="approve" data-id="${esc(r.id)}">Approve</button><button class="btn btn-sm" data-pplact="${mode === "admin" ? "decide" : "me-decide"}" data-decision="reject" data-id="${esc(r.id)}">Reject</button>`
    : mode === "admin" && r.status === "approved" ? `<button class="btn btn-sm btn-ghost" data-pplact="cancel-leave" data-id="${esc(r.id)}">Cancel</button>` : "";
  return `<div class="ppl-req">${r.name ? `<b>${esc(r.name)}</b>` : ""}<span>${esc(pplTypeName(r.type))}: ${esc(r.from)}${r.to !== r.from ? " → " + esc(r.to) : ""}${r.half_day ? " (half day)" : ""} · ${esc(String(r.days))} day${r.days === 1 ? "" : "s"}</span>
    ${r.reason ? `<span class="subtle" dir="auto">${esc(r.reason)}</span>` : ""}<span class="badge ${st}">${esc(r.status)}</span>${r.decided_by ? `<span class="subtle s-small">by ${esc(r.decided_by)}</span>` : ""}<span class="row gap-4">${acts}</span></div>`;
}

/* ------------------------------------------------ Today */
async function pplToday(body) {
  const d = PPL.d, rows = d.today_rows;
  const by = (list) => rows.filter((r) => list.includes(r.status));
  const inNow = by(["in"]), out = by(["out"]), late = rows.filter((r) => r.late && ["in", "out", "late", "half_day", "present"].includes(r.status)), leave = by(["leave"]), notIn = by(["not_in"]), off = by(["weekly_off", "holiday"]);
  const list = (items, empty, f = (r) => "") => items.length ? `<ul class="ppl-list">${items.map((r) => `<li><span>${esc(r.name)}${pplSample(r)}</span><span class="subtle">${f(r)}</span></li>`).join("")}</ul>` : `<p class="subtle s-small">${empty}</p>`;
  body.innerHTML = `
    ${pplMyDayCard(PPL.me)}
    ${!PPL.me?.linked && d.can.team_edit ? `<p class="subtle s-small" style="margin-bottom:12px">To punch in yourself, link your login to your employee record in Employees.</p>` : ""}
    <section class="s-kpis" aria-label="Today">
      ${pplTile("In now", inNow.length, `of ${rows.length} employees`)}
      ${pplTile("Late today", late.length, `after ${d.settings.shift_start} + ${d.settings.grace_min} min`, late.length ? "warn" : "")}
      ${pplTile("On leave", leave.length, "approved")}
      ${pplTile("Not in yet", notIn.length, `IST now ${d.now_ist}`)}
      ${pplTile("Leave to approve", d.pending_leave.length, "pending requests", d.pending_leave.length ? "warn" : "")}
    </section>
    ${!d.employees.length ? `<div class="card empty" style="margin-top:16px"><h2>Add your team in India</h2><p>Add employees with their joining date, work state and salary, link each person's login so they can punch in, then check Settings (state, shift, weekly offs, leave policy). Sample data in the Command Center adds four sample employees to try it.</p>${d.can.team_edit ? `<button class="btn btn-primary" data-pplact="add-emp">Add employee</button>` : ""}</div>` : `
    <div class="ppl-grid2" style="margin-top:16px">
      <section class="card card-pad"><h3>In now</h3>${list(inNow, "Nobody is punched in.", (r) => `since ${esc(r.first_in)}${r.late ? " · late" : ""}`)}</section>
      <section class="card card-pad"><h3>Late</h3>${list(late, "Nobody late today.", (r) => `in at ${esc(r.first_in)}`)}</section>
      <section class="card card-pad"><h3>On leave</h3>${list(leave, "Nobody on leave today.", (r) => esc(pplTypeName(r.leave_type)))}</section>
      <section class="card card-pad"><h3>Not in yet</h3>${list(notIn, off.length === rows.length ? "Today is a weekly off or holiday." : "Everyone is in.", () => "")}${out.length ? `<h3 style="margin-top:12px">Punched out</h3>${list(out, "", (r) => `${esc(String(r.hours))} h so far`)}` : ""}</section>
    </div>
    ${d.pending_leave.length ? `<section class="card card-pad" style="margin-top:16px"><h3>Leave to approve</h3>${d.pending_leave.map((r) => pplReqRow(r, d.can.team_edit ? "admin" : "view")).join("")}</section>` : ""}`}`;
}

/* ------------------------------------------------ Attendance grid */
async function pplAttendance(body) {
  PPL.month ||= pplMonthNow();
  PPL.att = await api(`/api/workspaces/${S.ws.id}/people/attendance?month=${PPL.month}`);
  const a = PPL.att, edit = PPL.d.can.team_edit;
  const dow = (d) => "SMTWTFS"[new Date(d + "T00:00:00Z").getUTCDay()];
  const hol = new Map(a.holidays.map((h) => [h.date, h.name]));
  const legend = ["present", "late", "half_day", "absent", "leave", "half_leave", "weekly_off", "holiday", "missing_out", "in", "out", "untracked"];
  body.innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px">
      <form class="row gap-8" id="pplMonthForm"><label class="s-small" for="ppl-month">Month</label><input class="input input-sm" type="month" id="ppl-month" value="${esc(PPL.month)}"><button class="btn btn-sm" type="submit">Show</button></form>
      <span class="subtle s-small">${edit ? "Click a day to add or correct punches. Every correction keeps who, when and why." : "View only."}</span></div>
    ${!a.rows.length ? `<div class="card empty"><p>No employees in ${esc(pplMonthName(PPL.month))}.</p></div>` : `
    <div class="card ppl-gridcard"><div class="table-wrap"><table class="ppl-att" aria-label="Attendance for ${esc(pplMonthName(PPL.month))}">
      <thead><tr><th class="ppl-namecol" scope="col">Employee</th>${a.dates.map((d) => `<th scope="col" class="${hol.has(d) ? "ppl-holcol" : ""}" title="${esc(hol.get(d) || d)}"><span>${Number(d.slice(8))}</span><small>${dow(d)}</small></th>`).join("")}</tr></thead>
      <tbody>${a.rows.map((r) => `<tr><th class="ppl-namecol" scope="row" title="${esc(r.name)}">${esc(r.name)}</th>${r.days.map((d) => {
        const short = PPL.meta.day_status[d.status]?.short || "";
        const tip = `${d.date}: ${pplStatus(d.status)}${d.leave_type ? " (" + pplTypeName(d.leave_type) + ")" : ""}${d.first_in ? ` · in ${d.first_in}` : ""}${d.last_out ? ` · out ${d.last_out}` : ""}${d.hours ? ` · ${d.hours} h` : ""}${d.holiday ? " · " + d.holiday : ""}`;
        const cls = `ppl-cell ppl-${PPL_TONE[d.status] || "none"}${d.worked_off ? " ppl-worked" : ""}`;
        return d.status === "na" ? `<td class="ppl-cell ppl-na"></td>` : edit && d.status !== "upcoming" ? `<td class="${cls}"><button type="button" data-pplact="day" data-emp="${esc(r.employee_id)}" data-date="${esc(d.date)}" title="${esc(tip)}" aria-label="${esc(r.name + " " + tip)}">${esc(short)}</button></td>` : `<td class="${cls}" title="${esc(tip)}">${esc(short)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="s-legend ppl-legend">${legend.map((s) => `<span><i class="ppl-sw ppl-${PPL_TONE[s] || "none"}">${esc(PPL.meta.day_status[s].short)}</i>${esc(pplStatus(s))}</span>`).join("")}<span><i class="ppl-sw ppl-off ppl-worked">W</i>Worked on an off day (comp-off)</span></div></div>
    <section class="card" style="margin-top:16px"><div class="card-head" style="padding:16px 16px 0"><h3>Month totals</h3></div><div class="table-wrap"><table class="f-table"><thead><tr><th>Employee</th><th class="num">Present</th><th class="num">Half days</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Leave</th><th class="num">Off days worked</th><th class="num">No punch-out</th><th class="num">Loss of pay</th></tr></thead>
      <tbody>${a.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.totals.present}</td><td class="num">${r.totals.half_days}</td><td class="num">${r.totals.absent}</td><td class="num">${r.totals.late}${r.totals.late_penalty ? ` <span class="badge warn">−${r.totals.late_penalty} d</span>` : ""}</td><td class="num">${r.totals.leave}</td><td class="num">${r.totals.worked_off}</td><td class="num">${r.totals.missing_out ? `<span class="badge bad">${r.totals.missing_out}</span>` : 0}</td><td class="num"><b>${r.totals.lop}</b></td></tr>`).join("")}</tbody></table></div>
      <p class="subtle s-small" style="padding:0 16px 16px">Loss-of-pay days = absent + half of each half day + unpaid leave${PPL.d.settings.late_rule_on ? ` + half a day for every ${PPL.d.settings.late_rule_count} lates` : ""}. Days without a punch-out are paid as present until corrected.</p></section>`}`;
}

async function pplDayDialog(empId, date) {
  const r = await api(`/api/workspaces/${S.ws.id}/people/day?employee_id=${encodeURIComponent(empId)}&date=${date}`);
  const live = r.sessions.filter((s) => !s.deleted);
  const hist = r.sessions.flatMap((s) => s.history.map((h) => ({ ...h })) ).sort((a, b) => b.at.localeCompare(a.at));
  pplDialog(`${pplHead(esc(r.name), `${esc(date)} · ${esc(pplStatus(r.status.status))}${r.status.hours ? ` · ${r.status.hours} h` : ""} · times in IST`)}
    <div class="card-body stack" style="padding:16px 24px 24px">
      ${live.map((s) => `<form class="ppl-punchrow" data-pplform="edit-punch" data-id="${esc(s.id)}">
        <label class="s-small">In <input class="input input-sm" type="time" name="in" value="${esc(s.in_time)}" required></label>
        <label class="s-small">Out <input class="input input-sm" type="time" name="out" value="${esc(s.out_time)}"></label>
        <input class="input input-sm" name="reason" placeholder="Reason (required)" required maxlength="300" dir="auto">
        <span class="row gap-4"><button class="btn btn-sm" type="submit">Save</button><button class="btn btn-sm btn-ghost btn-danger" type="button" data-pplact="del-punch" data-id="${esc(s.id)}">Remove</button></span></form>`).join("") || `<p class="subtle s-small">No punches on this day.</p>`}
      <form class="ppl-punchrow" data-pplform="add-punch" data-emp="${esc(r.employee_id)}" data-date="${esc(date)}"><b class="s-small">Add a punch</b>
        <label class="s-small">In <input class="input input-sm" type="time" name="in" value="${esc(PPL.d.settings.shift_start)}" required></label>
        <label class="s-small">Out <input class="input input-sm" type="time" name="out" value="${esc(PPL.d.settings.shift_end)}"></label>
        <input class="input input-sm" name="reason" placeholder="Reason (required)" required maxlength="300" dir="auto"><button class="btn btn-sm btn-primary" type="submit">Add</button></form>
      ${r.status.worked_off ? `<p class="notice">Worked on a ${esc(pplStatus(r.status.status).toLowerCase())}: grant a comp-off in Leave → Grant comp-off.</p>` : ""}
      ${hist.length ? `<section><h3>Corrections</h3><ul class="ppl-list">${hist.map((h) => `<li><span>${esc(h.action)}${h.before ? ` ${esc(h.before.in)}–${esc(h.before.out || "…")}` : ""}${h.after ? ` → ${esc(h.after.in)}–${esc(h.after.out || "…")}` : ""}: <span dir="auto">${esc(h.reason)}</span></span><span class="subtle s-small">${esc(h.by_name)} · ${esc(fmtDate(h.at))}</span></li>`).join("")}</ul></section>` : ""}
    </div>`);
}

/* ------------------------------------------------ Leave */
async function pplLeave(body) {
  PPL.leave = await api(`/api/workspaces/${S.ws.id}/people/leave`);
  const L = PPL.leave, edit = PPL.d.can.team_edit, emps = PPL.d.employees.filter((e) => e.status !== "exited");
  const pending = L.requests.filter((r) => r.status === "pending");
  const types = PPL.meta.leave_types.filter((t) => PPL.d.settings.leave[t.id]?.enabled && !["ml", "lop"].includes(t.id));
  body.innerHTML = `
    <p class="notice" style="margin-bottom:16px">Leave defaults are typical but vary by state Shops & Establishments Act: check your state's rules and set the policy in Settings.</p>
    <section class="card card-pad"><h3>Waiting for approval (${pending.length})</h3>${pending.length ? pending.map((r) => pplReqRow(r, edit ? "admin" : "view")).join("") : `<p class="subtle s-small">Nothing to approve.</p>`}
      <p class="subtle s-small">An employee's manager can also approve from their own My day.</p></section>
    <section class="card" style="margin-top:16px"><div class="card-head" style="padding:16px 16px 0"><h3>Balances (${esc(L.today.slice(0, 4))})</h3></div><div class="table-wrap"><table class="f-table"><thead><tr><th>Employee</th>${types.map((t) => `<th class="num">${esc(t.name.replace(/ leave$/, "").replace("Earned / privileged", "Earned"))}</th>`).join("")}<th></th></tr></thead>
      <tbody>${L.balances.map((b) => `<tr><td>${esc(b.name)}${pplSample(b)}</td>${types.map((t) => { const x = b.balances.find((y) => y.type === t.id); return `<td class="num">${x ? `${x.available}${x.pending ? ` <span class="subtle">(${x.pending} pending)</span>` : ""}` : "–"}</td>`; }).join("")}<td><button class="btn btn-sm btn-ghost" data-pplact="bal-history" data-emp="${esc(b.employee_id)}">History</button></td></tr>`).join("") || `<tr><td colspan="9" class="subtle">No employees yet.</td></tr>`}</tbody></table></div></section>
    ${edit && emps.length ? `<div class="ppl-grid2" style="margin-top:16px">
      <section class="card card-pad"><h3>Apply on someone's behalf</h3>${pplLeaveForm("pplAdm", emps)}</section>
      <section class="card card-pad"><h3>Grant comp-off or adjust a balance</h3>
        <form class="ppl-form" id="pplLedger">
          <div class="field"><label for="pl-emp">Employee</label><select class="input" id="pl-emp">${emps.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="pl-kind">What</label><select class="input" id="pl-kind"><option value="grant">Grant comp-off</option><option value="opening">Opening balance</option><option value="adjust">Adjustment (+ or −)</option></select></div>
          <div class="field"><label for="pl-type">Leave</label><select class="input" id="pl-type">${["co", "el", "cl", "sl", "pl"].map((id) => PPL.meta.leave_types.find((t) => t.id === id)).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="pl-days">Days</label><input class="input" id="pl-days" type="number" step="0.5" value="1"></div>
          <div class="field"><label for="pl-date">Date (worked / effective)</label><input class="input" id="pl-date" type="date"></div>
          <div class="field ppl-span"><label for="pl-note">Note</label><input class="input" id="pl-note" required dir="auto" placeholder="e.g. Worked on Independence Day"></div>
          <div class="ppl-span"><button class="btn btn-sm btn-primary" type="submit">Save</button></div></form></section></div>` : ""}
    <section class="card card-pad" style="margin-top:16px"><div class="row between" style="flex-wrap:wrap;gap:8px"><h3>Holidays</h3><span class="subtle s-small">Republic Day, Independence Day and Gandhi Jayanti are built in. Add state and festival holidays each year: their dates move, so none are preloaded.</span></div>
      ${edit ? `<form class="row gap-8" id="pplHoliday" style="flex-wrap:wrap;margin:8px 0"><input class="input input-sm" type="date" id="ph-date" required aria-label="Holiday date"><input class="input input-sm" id="ph-name" placeholder="Holiday name" required dir="auto" aria-label="Holiday name"><select class="input input-sm" id="ph-kind" aria-label="Kind"><option value="festival">Festival</option><option value="state">State</option><option value="company">Company</option></select><button class="btn btn-sm" type="submit">Add holiday</button></form>` : ""}
      <ul class="ppl-list">${L.holidays.filter((h) => h.date >= L.today.slice(0, 4) + "-01-01" && h.date <= (Number(L.today.slice(0, 4)) + 1) + "-12-31").map((h) => `<li><span>${esc(h.name)} <span class="badge ${h.fixed ? "accent" : ""}">${esc(h.kind)}</span></span><span class="row gap-8"><span class="num">${esc(h.date)}</span>${edit && !h.fixed ? `<button class="btn btn-sm btn-ghost" data-pplact="del-holiday" data-id="${esc(h.id)}" aria-label="Remove ${esc(h.name)}">Remove</button>` : ""}</span></li>`).join("")}</ul></section>
    <section class="card card-pad" style="margin-top:16px"><h3>Recent requests</h3>${L.requests.filter((r) => r.status !== "pending").slice(0, 30).map((r) => pplReqRow(r, edit ? "admin" : "view")).join("") || `<p class="subtle s-small">None yet.</p>`}</section>`;
}

async function pplBalHistory(empId) {
  const r = await api(`/api/workspaces/${S.ws.id}/people/employees/${encodeURIComponent(empId)}/leave`);
  pplDialog(`${pplHead(esc(r.name), "Leave balance and accrual history (this leave year)")}<div class="card-body stack" style="padding:16px 24px 24px">${pplBalanceTable(r.balances)}
    ${r.balances.filter((b) => b.history.length).map((b) => `<section><h3>${esc(b.name)}</h3><ul class="ppl-list">${b.history.map((h) => `<li><span>${esc(h.note)}${h.by ? ` <span class="subtle">· ${esc(h.by)}</span>` : ""}</span><span class="num">${esc(h.date)} · ${h.days > 0 ? "+" : ""}${esc(String(h.days))}</span></li>`).join("")}</ul></section>`).join("")}</div>`, true);
}

/* ------------------------------------------------ Payroll */
async function pplPayroll(body) {
  PPL.payMonth ||= pplPrevMonth(pplMonthNow());
  const [p, sal] = await Promise.all([api(`/api/workspaces/${S.ws.id}/payroll?month=${PPL.payMonth}`), api(`/api/workspaces/${S.ws.id}/payroll/employees`)]);
  PPL.pay = p; PPL.sal = sal;
  const run = p.run, edit = pplCan("payroll", "edit"), owner = S.me?.user.role_id === "owner";
  const st = { draft: "warn", approved: "accent", paid: "good", reversed: "bad" };
  const t = run?.totals;
  const warn = run ? [...new Set(run.lines.flatMap((l) => l.warnings.filter((w) => !w.startsWith("Tax and statutory rates")).map((w) => `${l.name}: ${w}`)))] : [];
  body.innerHTML = `
    <p class="notice" style="margin-bottom:16px">Rates are for FY ${esc(p.rates_meta.fy)} and every figure is an estimate: verify PF, ESI, PT, TDS and due dates with your CA before paying. The CA files Form 24Q and the PF/ESI returns.</p>
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px">
      <form class="row gap-8" id="pplPayMonth"><label class="s-small ppl-nowrap" for="ppl-pmonth">Payroll month</label><input class="input input-sm" type="month" id="ppl-pmonth" value="${esc(PPL.payMonth)}"><button class="btn btn-sm" type="submit">Open</button></form>
      <div class="row gap-8" style="flex-wrap:wrap">${run ? `<span class="badge ${st[run.status]}">${esc(run.status)}</span>` : ""}
        ${!run && edit ? `<button class="btn btn-primary btn-sm" data-pplact="run-create">Run ${esc(pplMonthName(PPL.payMonth))} payroll</button>` : ""}
        ${run?.status === "draft" && edit ? `<button class="btn btn-sm btn-ghost btn-danger" data-pplact="run-delete">Delete draft</button><button class="btn btn-primary btn-sm" data-pplact="run-approve">Approve and lock</button>` : ""}
        ${run?.status === "approved" && edit ? `<button class="btn btn-primary btn-sm" data-pplact="run-paid">Mark paid</button>` : ""}
        ${run && ["approved", "paid"].includes(run.status) ? `<a class="btn btn-sm" href="/api/workspaces/${esc(S.ws.id)}/payroll/runs/${esc(run.id)}/bank.csv">Bank CSV</a><a class="btn btn-sm" href="/api/workspaces/${esc(S.ws.id)}/payroll/runs/${esc(run.id)}/ecr.txt">PF ECR file</a>` : ""}
        ${run && ["approved", "paid"].includes(run.status) && owner ? `<button class="btn btn-sm btn-ghost btn-danger" data-pplact="run-reverse">Reverse</button>` : ""}</div></div>
    ${!run ? `<div class="card empty"><h2>${esc(pplMonthName(PPL.payMonth))}: not run yet</h2><p>A run reads attendance and approved leave for loss-of-pay days, prorates each salary on calendar days, and estimates PF, ESI, Professional Tax and TDS. It stays a draft you can adjust until you approve it.</p>${edit ? "" : `<p class="subtle">You can view payroll but not run it.</p>`}</div>` : `
    <section class="s-kpis" aria-label="Payroll totals">
      ${pplTile("People", t.headcount, run.status === "draft" ? "draft · recalculates live" : `${run.status} ${run.approved_at ? fmtDate(run.approved_at) : ""}`)}
      ${pplTile("Gross pay", pplInr(t.gross), "earned this month")}
      ${pplTile("Net pay", pplInr(t.net), "to transfer")}
      ${pplTile("Employer cost", pplInr(t.employer_cost), "gross + employer PF, ESI, gratuity")}
      ${pplTile("TDS (estimate)", pplInr(t.tds), "deposit by " + (run.due[0]?.due || "–"))}
      ${pplTile("PF + ESI", pplInr(run.statutory.pf.total + run.statutory.esi.total), "employee + employer")}
    </section>
    ${run.warnings.length || warn.length ? `<div class="notice ppl-warns" style="margin-top:16px"><ul>${[...run.warnings, ...warn].map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <section class="card" style="margin-top:16px"><div class="table-wrap"><table class="f-table ppl-paytable"><thead><tr><th>Employee</th><th class="num">Paid days</th><th class="num">Gross</th><th class="num">PF</th><th class="num">ESI</th><th class="num">PT</th><th class="num">TDS</th><th class="num">Other</th><th class="num">Net pay</th><th class="num">Employer cost</th><th></th></tr></thead>
      <tbody>${run.lines.map((l) => `<tr><td><b>${esc(l.name)}</b>${pplSample(l)}<br><span class="subtle s-small">${esc(l.designation)}${l.state ? " · " + esc(l.state) : ""}</span></td>
        <td class="num">${l.paid_days}/${l.days_in_month}${l.lop_days ? `<br><span class="badge warn">${l.lop_days} LOP</span>` : ""}</td><td class="num">${pplInr(l.gross)}${l.additions.length ? `<br><span class="subtle s-small">incl. ${l.additions.map((a) => esc(a.label)).join(", ")}</span>` : ""}</td>
        <td class="num">${pplInr(l.pf.employee)}</td><td class="num">${l.esi.eligible ? pplInr(l.esi.employee) : "–"}</td><td class="num">${pplInr(l.pt)}</td><td class="num">${pplInr(l.tds)}</td><td class="num">${pplInr(l.deductions_other.reduce((a, d) => a + d.amount, 0))}</td>
        <td class="num"><b>${pplInr(l.net)}</b></td><td class="num">${pplInr(l.employer.cost)}</td>
        <td><span class="row gap-4" style="justify-content:flex-end"><a class="btn btn-sm btn-ghost" href="/api/workspaces/${esc(S.ws.id)}/payroll/runs/${esc(run.id)}/payslips/${esc(l.employee_id)}" target="_blank" rel="noopener">Payslip</a>${run.status === "draft" && edit ? `<button class="btn btn-sm btn-ghost" data-pplact="adjust" data-emp="${esc(l.employee_id)}">Adjust</button>` : ""}</span></td></tr>
        ${l.fnf ? `<tr><td colspan="11" class="subtle s-small">Leaving ${esc(l.exit_date)}: gratuity ${l.fnf.gratuity.eligible ? `${pplInr(l.fnf.gratuity.amount)} (${l.fnf.gratuity.years} years)` : `not payable (${l.fnf.gratuity.service_years} of ${l.fnf.gratuity.need} years)`} · earned-leave balance ${esc(String(l.fnf.el_balance))} days${l.fnf.el_encashment ? `, encashment ${pplInr(l.fnf.el_encashment)}` : ""}. Add them with Adjust if paying in this run (estimates; confirm with the CA).</td></tr>` : ""}`).join("")}</tbody>
      <tfoot><tr><th>Total</th><th></th><th class="num">${pplInr(t.gross)}</th><th class="num">${pplInr(t.pf_employee)}</th><th class="num">${pplInr(t.esi_employee)}</th><th class="num">${pplInr(t.pt)}</th><th class="num">${pplInr(t.tds)}</th><th class="num">${pplInr(t.other_deductions)}</th><th class="num">${pplInr(t.net)}</th><th class="num">${pplInr(t.employer_cost)}</th><th></th></tr></tfoot></table></div></section>
    <div class="ppl-grid2" style="margin-top:16px">
      <section class="card card-pad"><h3>Statutory summary</h3>
        <dl class="ppl-dl">
          <dt>PF (${run.statutory.pf.members} members, wages ${pplInr(run.statutory.pf.pf_wages)})</dt><dd>Employee ${pplInr(run.statutory.pf.employee)} · EPS ${pplInr(run.statutory.pf.eps)} · Employer EPF ${pplInr(run.statutory.pf.employer_epf)}${run.statutory.pf.edli ? ` · EDLI ${pplInr(run.statutory.pf.edli)}` : ""}${run.statutory.pf.admin ? ` · Admin ${pplInr(run.statutory.pf.admin)}` : ""} · <b>${pplInr(run.statutory.pf.total)}</b></dd>
          <dt>ESI (${run.statutory.esi.members} covered, wages ${pplInr(run.statutory.esi.wages)})</dt><dd>Employee ${pplInr(run.statutory.esi.employee)} · Employer ${pplInr(run.statutory.esi.employer)} · <b>${pplInr(run.statutory.esi.total)}</b></dd>
          <dt>Professional Tax</dt><dd>${run.statutory.pt.length ? run.statutory.pt.map((x) => `${esc(PPL.meta.states.find((s) => s.code === x.state)?.name || x.state)} ${pplInr(x.amount)} (${x.employees})`).join(" · ") : "None this month"}</dd>
          <dt>TDS (${run.statutory.tds.employees} employees)</dt><dd><b>${pplInr(run.statutory.tds.total)}</b> · estimate; the CA files Form 24Q</dd></dl></section>
      <section class="card card-pad"><h3>Due dates</h3><ul class="ppl-list">${run.due.map((d) => `<li><span>${esc(d.what)}<br><span class="subtle s-small">${esc(d.note)}</span></span><span class="num">${d.due ? esc(d.due) : "–"} <span class="badge warn">verify</span></span></li>`).join("")}</ul>
        ${["approved", "paid"].includes(run.status) ? (run.finance_expense_id ? `<p class="subtle s-small">Posted to Finance as a payroll expense${run.inr_sar_rate ? ` at ${esc(String(run.inr_sar_rate))} SAR/₹` : ""}.</p>`
          : pplCan("finance", "edit") ? `<form class="row gap-8" id="pplPost" style="flex-wrap:wrap;margin-top:12px"><label class="s-small" for="ppl-rate">INR → SAR rate (SAR per ₹1)</label><input class="input input-sm" id="ppl-rate" type="number" step="0.00001" min="0" placeholder="type today's rate" required style="width:150px"><button class="btn btn-sm" type="submit">Post to Finance</button></form><p class="subtle s-small">Finance is in SAR. There is no default rate: type the one your bank gives you.</p>` : "") : ""}</section></div>
    ${run.history?.length ? `<section class="card card-pad" style="margin-top:16px"><h3>Run history</h3><ul class="ppl-list">${run.history.map((h) => `<li><span>${esc(h.action)}${h.note ? `: <span dir="auto">${esc(h.note)}</span>` : ""}</span><span class="subtle s-small">${esc(h.by_name)} · ${esc(fmtDate(h.at))}</span></li>`).join("")}</ul></section>` : ""}`}
    <section class="card" style="margin-top:16px"><div class="card-head" style="padding:16px 16px 0"><div><h3>Salaries</h3><p class="subtle s-small">Monthly structure from annual CTC: Basic ${esc(String(PPL.meta.default_rates.basic_pct))}% of gross by default (Labour Codes 50% wage rule, configurable), HRA 40% of basic (50% metro), rest special allowance.</p></div></div>
      <div class="table-wrap"><table class="f-table"><thead><tr><th>Employee</th><th class="num">Annual CTC</th><th class="num">Monthly gross</th><th class="num">Basic</th><th class="num">HRA</th><th class="num">Special</th><th>PF · ESI · regime</th><th>PAN</th><th></th></tr></thead>
      <tbody>${sal.filter((e) => e.status !== "exited").map((e) => `<tr><td>${esc(e.name)}${pplSample(e)}</td><td class="num">${pplInr(e.annual_ctc)}</td><td class="num">${e.structure ? pplInr(e.structure.gross) : "–"}</td><td class="num">${e.structure ? pplInr(e.structure.basic) : "–"}</td><td class="num">${e.structure ? pplInr(e.structure.hra) : "–"}</td><td class="num">${e.structure ? pplInr(e.structure.special) : "–"}</td>
        <td class="s-small">${e.pf_applicable === false ? "No PF" : "PF"} · ${e.esi_applicable === false ? "No ESI" : e.structure && e.structure.gross <= (PPL.meta.default_rates.esi_threshold) ? "ESI" : "ESI n/a"} · ${e.tax_regime === "old" ? "old" : "new"}${e.tds_mode === "manual" ? " (manual TDS)" : ""}</td><td class="mono s-small">${esc(e.pan_masked || "–")}</td>
        <td>${edit ? `<button class="btn btn-sm btn-ghost" data-pplact="salary" data-emp="${esc(e.id)}">Edit salary</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="subtle">No employees yet.</td></tr>`}</tbody></table></div></section>
    ${p.runs.length ? `<section class="card card-pad" style="margin-top:16px"><h3>All runs</h3><ul class="ppl-list">${p.runs.map((r) => `<li><button class="linklike" data-pplact="open-month" data-month="${esc(r.month)}">${esc(pplMonthName(r.month))}</button><span class="row gap-8"><span class="badge ${st[r.status]}">${esc(r.status)}</span>${r.totals ? `<span class="num">${pplInr(r.totals.net)} net</span>` : ""}${r.reversed_reason ? `<span class="subtle s-small" dir="auto">${esc(r.reversed_reason)}</span>` : ""}</span></li>`).join("")}</ul></section>` : ""}`;
}

function pplAdjustDialog(empId) {
  const run = PPL.pay.run, l = run.lines.find((x) => x.employee_id === empId);
  const items = [...l.additions, ...l.deductions_other];
  const row = (a = {}) => `<div class="ppl-adjrow"><select class="input input-sm" name="kind" aria-label="Kind">${PPL.meta.adj_kinds.map((k) => `<option value="${k.id}" ${a.kind === k.id ? "selected" : ""}>${esc(k.name)}${k.earning ? "" : " (deduction)"}</option>`).join("")}</select><input class="input input-sm" name="label" placeholder="Label" value="${esc(a.label || "")}" dir="auto" aria-label="Label"><input class="input input-sm" name="amount" type="number" min="1" placeholder="₹" value="${esc(a.amount || "")}" aria-label="Amount in rupees"><button class="btn btn-sm btn-ghost" type="button" data-pplact="adj-del" aria-label="Remove">×</button></div>`;
  pplDialog(`<form id="pplAdjust" data-emp="${esc(empId)}">${pplHead(`Adjust ${esc(l.name)}`, `${esc(pplMonthName(run.month))} · one-off additions (bonus, arrears, reimbursement) and deductions (advance recovery)`)}
    <div class="card-body stack" style="padding:16px 24px" id="pplAdjRows">${items.map(row).join("")}</div>
    ${l.fnf ? `<p class="subtle s-small" style="padding:0 24px">Full and final: gratuity ${l.fnf.gratuity.eligible ? pplInr(l.fnf.gratuity.amount) : "not payable"}, leave encashment ${pplInr(l.fnf.el_encashment)} (estimates).</p>` : ""}
    <div class="row between" style="padding:0 24px 24px"><button class="btn btn-sm" type="button" data-pplact="adj-add">Add a line</button><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form>`);
  PPL.adjRow = row;
}

function pplSalaryDialog(empId) {
  const e = PPL.sal.find((x) => x.id === empId);
  pplDialog(`<form id="pplSalary" data-emp="${esc(empId)}">${pplHead(`Salary: ${esc(e.name)}`, "Amounts in ₹. Verify statutory choices with your CA.")}
    <div class="card-body grid-form" style="padding:16px 24px">${pplSalaryFields(e)}</div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn btn-primary btn-sm" type="submit">Save salary</button></div></form>`, true);
  pplStructurePreview();
}
function pplSalaryFields(e = {}) {
  return `
    <div class="field"><label for="se-ctc">Annual CTC (₹)</label><input class="input" id="se-ctc" type="number" min="0" step="1000" value="${esc(e.annual_ctc ?? "")}" data-pplpreview></div>
    <div class="field"><label for="se-basic">Basic % of gross</label><input class="input" id="se-basic" type="number" min="10" max="100" step="1" value="${esc(e.basic_pct ?? "")}" placeholder="default ${esc(String(PPL.meta.default_rates.basic_pct))}" data-pplpreview><span class="hint">Labour Codes: basic + DA at least 50% of pay.</span></div>
    <label class="row gap-4 s-small"><input type="checkbox" id="se-metro" ${e.metro ? "checked" : ""} data-pplpreview> Metro city (HRA 50% of basic)</label>
    <label class="row gap-4 s-small"><input type="checkbox" id="se-pf" ${e.pf_applicable !== false ? "checked" : ""} data-pplpreview> PF applies</label>
    <label class="row gap-4 s-small"><input type="checkbox" id="se-esi" ${e.esi_applicable !== false ? "checked" : ""} data-pplpreview> ESI applies (when gross ≤ ₹21,000)</label>
    <div class="field"><label for="se-regime">Tax regime</label><select class="input" id="se-regime"><option value="new">New (default)</option><option value="old" ${e.tax_regime === "old" ? "selected" : ""}>Old</option></select></div>
    <div class="field"><label for="se-tdsmode">TDS</label><select class="input" id="se-tdsmode"><option value="auto">Estimate automatically</option><option value="manual" ${e.tds_mode === "manual" ? "selected" : ""}>Enter monthly TDS</option></select></div>
    <div class="field"><label for="se-tds">Monthly TDS if manual (₹)</label><input class="input" id="se-tds" type="number" min="0" value="${esc(e.tds_manual ?? "")}"></div>
    <div class="field"><label for="se-old">Old regime: yearly deductions (₹)</label><input class="input" id="se-old" type="number" min="0" value="${esc(e.old_deductions ?? "")}"><span class="hint">80C, HRA exemption etc. as declared</span></div>
    <div class="field"><label for="se-pt">Professional Tax per month (₹)</label><input class="input" id="se-pt" type="number" min="0" value="${esc(e.pt_manual ?? "")}" placeholder="blank = state preset or slabs"></div>
    <div class="field"><label for="se-pan">PAN</label><input class="input mono" id="se-pan" value="${esc(e.pan_masked || "")}" placeholder="ABCDE1234F" autocomplete="off"><span class="hint">Stored; shown masked. Type a new one to change it.</span></div>
    <div class="field"><label for="se-uan">UAN</label><input class="input mono" id="se-uan" value="${esc(e.uan_masked || "")}" placeholder="12 digits" autocomplete="off"></div>
    <div class="field"><label for="se-ofy">Opening YTD: financial year</label><input class="input" id="se-ofy" value="${esc(e.opening_fy || "")}" placeholder="e.g. 2026-27"><span class="hint">Salary paid this FY before the first run here (or by a previous employer).</span></div>
    <div class="field"><label for="se-otax">Opening YTD: taxable salary (₹)</label><input class="input" id="se-otax" type="number" min="0" value="${esc(e.opening_taxable ?? "")}"></div>
    <div class="field"><label for="se-otds">Opening YTD: TDS already deducted (₹)</label><input class="input" id="se-otds" type="number" min="0" value="${esc(e.opening_tds ?? "")}"></div>
    <div class="span-2" id="pplStruct"></div>`;
}
const pplSalaryBody = () => ({
  annual_ctc: $("#se-ctc").value, basic_pct: $("#se-basic").value, metro: $("#se-metro").checked, pf_applicable: $("#se-pf").checked, esi_applicable: $("#se-esi").checked,
  tax_regime: $("#se-regime").value, tds_mode: $("#se-tdsmode").value, tds_manual: $("#se-tds").value, old_deductions: $("#se-old").value, pt_manual: $("#se-pt").value, pan: $("#se-pan").value, uan: $("#se-uan").value,
  opening_fy: $("#se-ofy").value, opening_taxable: $("#se-otax").value, opening_tds: $("#se-otds").value,
});
let pplPrevTimer;
function pplStructurePreview() {
  clearTimeout(pplPrevTimer);
  pplPrevTimer = setTimeout(async () => {
    const box = $("#pplStruct"); if (!box) return;
    const b = pplSalaryBody();
    if (!(Number(b.annual_ctc) > 0)) { box.innerHTML = ""; return; }
    try {
      const s = await api(`/api/workspaces/${S.ws.id}/payroll/structure`, { method: "POST", body: JSON.stringify(b) });
      box.innerHTML = `<div class="ppl-chips"><span>Gross <b>${pplInr(s.gross)}</b>/mo</span><span>Basic <b>${pplInr(s.basic)}</b></span><span>HRA <b>${pplInr(s.hra)}</b></span><span>Special <b>${pplInr(s.special)}</b></span><span>Employer PF <b>${pplInr(s.employer.pf)}</b></span><span>Employer ESI <b>${pplInr(s.employer.esi)}</b></span><span>Gratuity <b>${pplInr(s.employer.gratuity)}</b></span></div>`;
    } catch { box.innerHTML = ""; }
  }, 250);
}

/* ------------------------------------------------ Employees */
async function pplEmployees(body) {
  const d = PPL.d, edit = d.can.team_edit;
  const st = (e) => e.status === "exited" ? `<span class="badge">exited ${esc(e.exit_date || "")}</span>` : e.exit_date ? `<span class="badge warn">leaving ${esc(e.exit_date)}</span>` : `<span class="badge good">active</span>`;
  body.innerHTML = `<div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><span class="subtle s-small">${d.employees.length} employee${d.employees.length === 1 ? "" : "s"}${d.can.payroll_view ? "" : " · salary details need Payroll access"}</span>${edit ? `<button class="btn btn-primary btn-sm" data-pplact="add-emp">Add employee</button>` : ""}</div>
    <section class="card"><div class="table-wrap"><table class="f-table"><thead><tr><th>Name</th><th>Code</th><th>Designation</th><th>Department</th><th>State</th><th>Joined</th><th>Manager</th><th>Login</th><th>Status</th></tr></thead>
    <tbody>${d.employees.map((e) => `<tr><td>${edit ? `<button class="linklike" data-pplact="edit-emp" data-id="${esc(e.id)}">${esc(e.name)}</button>` : esc(e.name)}${pplSample(e)}</td><td class="mono s-small">${esc(e.code || "")}</td><td>${esc(e.designation || "")}</td><td>${esc(e.department || "")}</td><td>${esc(e.work_state || "")}</td><td class="num">${esc(e.doj || "")}</td><td>${esc(e.manager_name || "")}</td><td>${e.user_id ? esc(e.user_name || "linked") : `<span class="subtle">not linked</span>`}</td><td>${st(e)}</td></tr>`).join("") || `<tr><td colspan="9" class="subtle">No employees yet.</td></tr>`}</tbody></table></div></section>`;
}

function pplEmpDialog(id = null) {
  const d = PPL.d, e = id ? d.employees.find((x) => x.id === id) : { work_state: d.settings.state, employment_type: "permanent", track_attendance: true };
  const pay = d.can.payroll_edit;
  const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(val ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
  pplDialog(`<form id="pplEmp" data-id="${esc(id || "")}">${pplHead(id ? esc(e.name) : "Add employee", "Employed in India. Times are IST.")}
    <div class="card-body grid-form" style="padding:16px 24px">
      <div class="field"><label for="pe-name">Full name</label><input class="input" id="pe-name" required value="${esc(e.name || "")}" dir="auto"></div>
      <div class="field"><label for="pe-code">Employee code</label><input class="input" id="pe-code" value="${esc(e.code || "")}"></div>
      <div class="field"><label for="pe-email">Email</label><input class="input" id="pe-email" type="email" value="${esc(e.email || "")}"></div>
      <div class="field"><label for="pe-phone">Phone</label><input class="input" id="pe-phone" value="${esc(e.phone || "")}"></div>
      <div class="field"><label for="pe-desig">Designation</label><input class="input" id="pe-desig" value="${esc(e.designation || "")}" dir="auto"></div>
      <div class="field"><label for="pe-dept">Department</label><input class="input" id="pe-dept" value="${esc(e.department || "")}" dir="auto"></div>
      <div class="field"><label for="pe-doj">Date of joining</label><input class="input" id="pe-doj" type="date" required value="${esc(e.doj || "")}"></div>
      <div class="field"><label for="pe-state">Work state</label><select class="input" id="pe-state">${opt(PPL.meta.states.map((s) => [s.code, s.name]), e.work_state)}</select></div>
      <div class="field"><label for="pe-gender">Gender</label><select class="input" id="pe-gender">${opt([["", "Not set"], ["female", "Female"], ["male", "Male"], ["other", "Other"]], e.gender)}</select><span class="hint">Used for maternity leave and Maharashtra PT slabs.</span></div>
      <div class="field"><label for="pe-type">Employment</label><select class="input" id="pe-type">${opt(PPL.meta.emp_types.map((t) => [t.id, t.name]), e.employment_type)}</select></div>
      <div class="field"><label for="pe-mgr">Manager</label><select class="input" id="pe-mgr"><option value="">None</option>${opt(d.employees.filter((x) => x.id !== id).map((x) => [x.id, x.name]), e.manager_id)}</select></div>
      <div class="field"><label for="pe-user">Dashboard login (to punch in)</label><select class="input" id="pe-user"><option value="">Not linked</option>${opt(d.users.map((u) => [u.id, `${u.name} (${u.email})`]), e.user_id)}</select></div>
      <label class="row gap-4 s-small"><input type="checkbox" id="pe-track" ${e.track_attendance !== false ? "checked" : ""}> Track attendance (absences become loss of pay)</label>
      <div class="field"><label for="pe-from">Attendance tracked from</label><input class="input" id="pe-from" type="date" value="${esc(e.attendance_from || "")}"></div>
      <div class="field"><label for="pe-exit">Exit date</label><input class="input" id="pe-exit" type="date" value="${esc(e.exit_date || "")}"></div>
      <div class="field"><label for="pe-reason">Exit reason</label><input class="input" id="pe-reason" value="${esc(e.exit_reason || "")}" dir="auto"></div>
      ${id ? `<label class="row gap-4 s-small"><input type="checkbox" id="pe-exited" ${e.status === "exited" ? "checked" : ""}> Exited (full and final done)</label>` : ""}
      ${pay ? `<h3 class="span-2" style="margin-top:8px">Salary</h3>${pplSalaryFields(e)}` : `<p class="span-2 subtle s-small">Salary, PAN and UAN are set by someone with Payroll access.</p>`}
    </div>
    <div class="row between" style="padding:0 24px 24px">${id ? `<button class="btn btn-sm btn-ghost btn-danger" type="button" data-pplact="del-emp" data-id="${esc(id)}">Delete</button>` : "<span></span>"}<button class="btn btn-primary btn-sm" type="submit">${id ? "Save" : "Add employee"}</button></div></form>`, true);
  if (pay) pplStructurePreview();
}

/* ------------------------------------------------ Settings */
async function pplSettings(body) {
  const s = PPL.d.settings, edit = PPL.d.can.team_edit, rEdit = pplCan("payroll", "edit"), rView = pplCan("payroll");
  const dis = edit ? "" : "disabled";
  const R = { ...PPL.meta.default_rates, ...s.rates };
  const rate = (k, label, step = "0.01") => typeof PPL.meta.default_rates[k] === "boolean"
    ? `<label class="row gap-4 s-small"><input type="checkbox" data-rate="${k}" ${R[k] ? "checked" : ""} ${rEdit ? "" : "disabled"}> ${esc(label)}</label>`
    : `<div class="field"><label>${esc(label)}</label><input class="input input-sm" type="number" step="${step}" data-rate="${k}" value="${esc(String(R[k]))}" ${rEdit ? "" : "disabled"}><span class="hint">default ${esc(String(PPL.meta.default_rates[k]))}</span></div>`;
  const pt = PPL.meta.pt_presets[s.state];
  const custom = s.pt_custom?.[s.state];
  body.innerHTML = `<form id="pplSettings" class="stack-lg">
    <section class="card card-pad"><h3>Company and shift</h3><div class="grid-form">
      <div class="field"><label for="ps-co">Company name on payslips</label><input class="input" id="ps-co" value="${esc(s.company_name || "")}" ${dis}></div>
      <div class="field"><label for="ps-state">Main work state</label><select class="input" id="ps-state" ${dis}>${PPL.meta.states.map((x) => `<option value="${x.code}" ${x.code === s.state ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><span class="hint">Default for new employees; Professional Tax follows each employee's state.</span></div>
      <div class="field"><label for="ps-start">Shift start (IST)</label><input class="input" id="ps-start" type="time" value="${esc(s.shift_start)}" ${dis}></div>
      <div class="field"><label for="ps-end">Shift end (IST)</label><input class="input" id="ps-end" type="time" value="${esc(s.shift_end)}" ${dis}></div>
      <div class="field"><label for="ps-grace">Grace minutes</label><input class="input" id="ps-grace" type="number" min="0" value="${esc(String(s.grace_min))}" ${dis}></div>
      <div class="field"><label for="ps-off">Weekly offs</label><select class="input" id="ps-off" ${dis}>${PPL.meta.weekly_off.map((w) => `<option value="${w.id}" ${w.id === s.weekly_off ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="ps-full">Full day = hours worked</label><input class="input" id="ps-full" type="number" step="0.5" min="1" value="${esc(String(s.full_day_hours))}" ${dis}></div>
      <div class="field"><label for="ps-half">Half day = hours worked</label><input class="input" id="ps-half" type="number" step="0.5" min="0.5" value="${esc(String(s.half_day_hours))}" ${dis}><span class="hint">Below this a worked day counts as absent.</span></div>
      <label class="row gap-4 s-small"><input type="checkbox" id="ps-late" ${s.late_rule_on ? "checked" : ""} ${dis}> Late rule: every <input class="input input-sm" id="ps-latecount" type="number" min="1" value="${esc(String(s.late_rule_count))}" style="width:64px" ${dis} aria-label="Number of lates"> lates in a month = half a day loss of pay</label>
      <label class="row gap-4 s-small"><input type="checkbox" id="ps-lop" ${s.lop_from_attendance ? "checked" : ""} ${dis}> Payroll takes loss-of-pay days from attendance</label>
    </div></section>
    <section class="card card-pad"><h3>Leave policy</h3><p class="notice" style="margin:8px 0">Typical defaults; they vary by state Shops & Establishments Act. Check your state's rules.</p><div class="table-wrap"><table class="f-table"><thead><tr><th>Type</th><th>On</th><th class="num">Days a year</th><th class="num">Accrual / month</th><th class="num">Carry-forward cap</th><th>Encashable</th></tr></thead><tbody>
      ${PPL.meta.leave_types.map((t) => { const p = s.leave[t.id] || {}; const n = (k) => k in p ? `<input class="input input-sm" type="number" step="0.25" min="0" data-leave="${t.id}" data-k="${k}" value="${esc(String(p[k]))}" style="width:80px" ${dis} aria-label="${esc(t.name + " " + k)}">` : "–";
        return `<tr><td>${esc(t.name)}<br><span class="subtle s-small">${esc(t.note)}</span></td><td><input type="checkbox" data-leave="${t.id}" data-k="enabled" ${p.enabled ? "checked" : ""} ${dis} aria-label="${esc(t.name)} on"></td>
          <td class="num">${t.id === "ml" ? `${n("weeks")} weeks<br>${n("weeks_third")} from 3rd child` : n("annual")}</td><td class="num">${n("per_month")}</td><td class="num">${n("carry_cap")}</td><td>${"encashable" in p ? `<input type="checkbox" data-leave="${t.id}" data-k="encashable" ${p.encashable ? "checked" : ""} ${dis} aria-label="${esc(t.name)} encashable">` : "–"}</td></tr>`; }).join("")}</tbody></table></div></section>
    <section class="card card-pad"><h3>Professional Tax: ${esc(PPL.meta.states.find((x) => x.code === s.state)?.name || s.state)}</h3>
      <p class="subtle s-small">${pt ? esc(pt.source) : "No preset for this state: enter its monthly slabs below (from the state's Act or your CA), or a monthly amount on each employee's salary."}</p>
      ${pt?.none ? "" : `<div class="field"><label for="ps-slabs">${pt ? "Override the preset with" : "Monthly"} slabs: one per line, "gross up to, amount" (leave "up to" blank for the top slab)</label><textarea class="input mono" id="ps-slabs" rows="4" ${dis} placeholder="15000, 0&#10;, 200">${esc((custom?.slabs || []).map((x) => `${x.upto == null ? "" : x.upto}, ${x.amount}`).join("\n"))}</textarea></div>
      <div class="field" style="max-width:260px"><label for="ps-feb">February amount for the top slab (optional)</label><input class="input" id="ps-feb" type="number" min="0" value="${esc(custom?.feb ?? "")}" ${dis}></div>`}</section>
    ${rView ? `<section class="card card-pad"><h3>Statutory rates (FY ${esc(PPL.meta.rates_meta.fy)})</h3><p class="notice" style="margin:8px 0">${esc(PPL.meta.rates_meta.note)}</p>
      <div class="ppl-rates">${rate("basic_pct", "Basic % of gross", "1")}${rate("hra_pct", "HRA % of basic", "1")}${rate("hra_metro_pct", "HRA % of basic (metro)", "1")}${rate("ctc_includes_gratuity", "CTC includes the gratuity provision")}
        ${rate("pf_employee_pct", "PF employee %")}${rate("pf_employer_pct", "PF employer %")}${rate("eps_pct", "EPS %")}${rate("pf_wage_ceiling", "PF wage ceiling ₹", "1")}${rate("eps_cap", "EPS cap ₹/month", "1")}${rate("pf_on_full_basic", "PF on full basic (not capped at the ceiling)")}
        ${rate("edli_on", "Employer pays EDLI")}${rate("edli_pct", "EDLI %")}${rate("admin_on", "Employer pays EPF admin charges")}${rate("admin_pct", "Admin charges %")}${rate("admin_min", "Admin charges minimum ₹", "1")}
        ${rate("esi_threshold", "ESI gross limit ₹/month", "1")}${rate("esi_employee_pct", "ESI employee %")}${rate("esi_employer_pct", "ESI employer %")}${rate("gratuity_pct", "Gratuity provision % of basic")}${rate("gratuity_years", "Gratuity after years", "1")}${rate("gratuity_cap", "Gratuity cap ₹", "1")}${rate("encash_divisor", "Leave encashment: days per month", "1")}</div>
      ${rEdit ? `<button class="btn btn-sm btn-ghost" type="button" data-pplact="reset-rates">Reset rates to defaults</button>` : `<p class="subtle s-small">Payroll edit access is needed to change rates.</p>`}
      <h3 style="margin-top:16px">Rules and sources</h3><ul class="ppl-list ppl-sources">${PPL.meta.rate_sources.map((r) => `<li><span><b>${esc(r.label)}</b>: ${esc(r.rule)}<br><span class="subtle s-small">${esc(r.source)} · FY ${esc(r.fy)} · verify with your CA</span></span></li>`).join("")}</ul></section>` : ""}
    ${edit ? `<div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save settings</button></div>` : ""}
  </form>`;
}

function pplSettingsBody() {
  const leave = {};
  document.querySelectorAll("[data-leave]").forEach((i) => { (leave[i.dataset.leave] ||= {})[i.dataset.k] = i.type === "checkbox" ? i.checked : Number(i.value); });
  const b = { company_name: $("#ps-co").value, state: $("#ps-state").value, shift_start: $("#ps-start").value, shift_end: $("#ps-end").value, grace_min: $("#ps-grace").value, weekly_off: $("#ps-off").value,
    full_day_hours: $("#ps-full").value, half_day_hours: $("#ps-half").value, late_rule_on: $("#ps-late").checked, late_rule_count: $("#ps-latecount").value, lop_from_attendance: $("#ps-lop").checked, leave };
  const slabs = $("#ps-slabs");
  if (slabs && $("#ps-state").value === PPL.d.settings.state) {
    const rows = slabs.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [u, a] = l.split(",").map((x) => x.trim()); return { upto: u === "" ? null : Number(u), amount: Number(a) }; });
    b.pt_custom = { [PPL.d.settings.state]: { slabs: rows, feb: $("#ps-feb").value } };
  }
  if (pplCan("payroll", "edit") && document.querySelector("[data-rate]")) {
    b.rates = {};
    document.querySelectorAll("[data-rate]").forEach((i) => { b.rates[i.dataset.rate] = i.type === "checkbox" ? i.checked : Number(i.value); });
  }
  return b;
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-ptab]");
  if (tab) { PPL.tab = tab.dataset.ptab; S.param = null; history.replaceState(null, "", `#/${S.ws.id}/people/${PPL.tab}`); return pplRerender(); }
  const a = e.target.closest("[data-pplact]");
  if (!a) return;
  const W = () => `/api/workspaces/${S.ws.id}`;
  try {
    switch (a.dataset.pplact) {
      case "close": return pplClose();
      case "punch": a.disabled = true; try { await pplPunch(); } finally { a.disabled = false; } return;
      case "myday": PPL.me = await api(`/api/me/people/${S.ws.id}`); return pplMyDayDialog();
      case "me-cancel": await api(`/api/me/people/${S.ws.id}/leave/${a.dataset.id}/cancel`, { method: "POST", body: "{}" }); toast("Request cancelled"); PPL.me = await api(`/api/me/people/${S.ws.id}`); return pplMyDayDialog();
      case "me-decide": await api(`/api/me/people/${S.ws.id}/approvals/${a.dataset.id}`, { method: "POST", body: JSON.stringify({ decision: a.dataset.decision }) }); toast(a.dataset.decision === "approve" ? "Approved" : "Rejected"); PPL.me = await api(`/api/me/people/${S.ws.id}`); pplSideRender(); return pplMyDayDialog();
      case "decide": {
        const note = a.dataset.decision === "reject" ? prompt("Reason for rejecting (optional)") : "";
        if (note === null) return;
        await api(`${W()}/people/leave/${a.dataset.id}/decide`, { method: "POST", body: JSON.stringify({ decision: a.dataset.decision, note }) });
        toast(a.dataset.decision === "approve" ? "Leave approved" : "Leave rejected");
        PPL.d = await api(`${W()}/people`); return pplRerender();
      }
      case "cancel-leave": if (!confirm("Cancel this approved leave? The days go back to the balance.")) return; await api(`${W()}/people/leave/${a.dataset.id}/cancel`, { method: "POST", body: "{}" }); return pplRerender();
      case "day": return pplDayDialog(a.dataset.emp, a.dataset.date);
      case "del-punch": {
        const reason = prompt("Reason for removing this punch (required)");
        if (!reason) return;
        await api(`${W()}/people/punches/${a.dataset.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
        toast("Punch removed"); pplClose(); return pplRerender();
      }
      case "bal-history": return pplBalHistory(a.dataset.emp);
      case "del-holiday": await api(`${W()}/people/holidays/${a.dataset.id}`, { method: "DELETE" }); return pplRerender();
      case "add-emp": return pplEmpDialog();
      case "edit-emp": return pplEmpDialog(a.dataset.id);
      case "del-emp":
        if (!confirm("Delete this employee and their punches and leave? Use an exit date instead if they worked here.")) return;
        await api(`${W()}/people/employees/${a.dataset.id}`, { method: "DELETE" }); pplClose(); PPL.d = await api(`${W()}/people`); return pplRerender();
      case "run-create": await api(`${W()}/payroll/runs`, { method: "POST", body: JSON.stringify({ month: PPL.payMonth }) }); toast("Draft payroll created"); return pplRerender();
      case "run-delete": if (!confirm("Delete this draft run?")) return; await api(`${W()}/payroll/runs/${PPL.pay.run.id}`, { method: "DELETE" }); return pplRerender();
      case "run-approve": if (!confirm("Approve and lock this payroll? After this only an Owner can reverse it, with a reason.")) return; await api(`${W()}/payroll/runs/${PPL.pay.run.id}/approve`, { method: "POST", body: "{}" }); toast("Payroll approved and locked"); return pplRerender();
      case "run-paid": if (!confirm("Mark salaries as paid (transferred)?")) return; await api(`${W()}/payroll/runs/${PPL.pay.run.id}/paid`, { method: "POST", body: "{}" }); toast("Marked paid"); return pplRerender();
      case "run-reverse": {
        const reason = prompt("Why reverse this payroll run? (required; it's logged)");
        if (!reason) return;
        await api(`${W()}/payroll/runs/${PPL.pay.run.id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Run reversed: you can run the month again"); return pplRerender();
      }
      case "open-month": PPL.payMonth = a.dataset.month; return pplRerender();
      case "adjust": return pplAdjustDialog(a.dataset.emp);
      case "adj-add": $("#pplAdjRows").insertAdjacentHTML("beforeend", PPL.adjRow()); return;
      case "adj-del": a.closest(".ppl-adjrow").remove(); return;
      case "salary": return pplSalaryDialog(a.dataset.emp);
      case "reset-rates": if (!confirm("Reset every statutory rate to the built-in FY defaults?")) return; await api(`${W()}/people/settings`, { method: "PUT", body: JSON.stringify({ reset_rates: true }) }); PPL.d = await api(`${W()}/people`); toast("Rates reset"); return pplRerender();
    }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("input", (e) => { if (e.target.closest?.("[data-pplpreview]")) pplStructurePreview(); });
document.addEventListener("change", (e) => { if (e.target.closest?.("[data-pplpreview]")) pplStructurePreview(); });

document.addEventListener("submit", async (e) => {
  const f = e.target;
  const W = () => `/api/workspaces/${S.ws.id}`;
  const known = ["pplMonthForm", "pplPayMonth", "pplMeLeave", "pplAdmLeave", "pplLedger", "pplHoliday", "pplAdjust", "pplSalary", "pplEmp", "pplSettings", "pplPost"];
  if (!known.includes(f.id) && !f.dataset.pplform) return;
  e.preventDefault();
  try {
    if (f.id === "pplMonthForm") { PPL.month = $("#ppl-month").value || PPL.month; return pplRerender(); }
    if (f.id === "pplPayMonth") { PPL.payMonth = $("#ppl-pmonth").value || PPL.payMonth; return pplRerender(); }
    if (f.id === "pplMeLeave") { await api(`/api/me/people/${S.ws.id}/leave`, { method: "POST", body: JSON.stringify(pplLeaveBody("pplMe")) }); toast("Leave requested"); PPL.me = await api(`/api/me/people/${S.ws.id}`); pplMyDayDialog(); if (S.route === "people" && pplCan("team")) { PPL.d = await api(`${W()}/people`); pplRerender(); } return; }
    if (f.id === "pplAdmLeave") { await api(`${W()}/people/leave`, { method: "POST", body: JSON.stringify(pplLeaveBody("pplAdm")) }); toast("Leave request added: approve it above"); PPL.d = await api(`${W()}/people`); return pplRerender(); }
    if (f.id === "pplLedger") { await api(`${W()}/people/leave-ledger`, { method: "POST", body: JSON.stringify({ employee_id: $("#pl-emp").value, kind: $("#pl-kind").value, type: $("#pl-type").value, days: $("#pl-days").value, date: $("#pl-date").value, note: $("#pl-note").value }) }); toast("Saved"); return pplRerender(); }
    if (f.id === "pplHoliday") { await api(`${W()}/people/holidays`, { method: "POST", body: JSON.stringify({ date: $("#ph-date").value, name: $("#ph-name").value, kind: $("#ph-kind").value }) }); toast("Holiday added"); return pplRerender(); }
    if (f.id === "pplAdjust") {
      const items = [...f.querySelectorAll(".ppl-adjrow")].map((r) => ({ kind: r.querySelector("[name=kind]").value, label: r.querySelector("[name=label]").value, amount: r.querySelector("[name=amount]").value })).filter((x) => x.amount);
      await api(`${W()}/payroll/runs/${PPL.pay.run.id}/adjustments`, { method: "PUT", body: JSON.stringify({ employee_id: f.dataset.emp, items }) }); pplClose(); toast("Adjustments saved"); return pplRerender();
    }
    if (f.id === "pplSalary") { await api(`${W()}/payroll/employees/${f.dataset.emp}`, { method: "PUT", body: JSON.stringify(pplSalaryBody()) }); pplClose(); toast("Salary saved"); return pplRerender(); }
    if (f.id === "pplEmp") {
      const v = (id) => $(`#${id}`)?.value;
      const b = { name: v("pe-name"), code: v("pe-code"), email: v("pe-email"), phone: v("pe-phone"), designation: v("pe-desig"), department: v("pe-dept"), doj: v("pe-doj"), work_state: v("pe-state"), gender: v("pe-gender"), employment_type: v("pe-type"),
        manager_id: v("pe-mgr") || null, user_id: v("pe-user") || null, track_attendance: $("#pe-track").checked, attendance_from: v("pe-from") || null, exit_date: v("pe-exit") || null, exit_reason: v("pe-reason") };
      if ($("#pe-exited")) b.status = $("#pe-exited").checked ? "exited" : "active";
      if (PPL.d.can.payroll_edit && $("#se-ctc")) Object.assign(b, pplSalaryBody());
      const id = f.dataset.id;
      await api(id ? `${W()}/people/employees/${id}` : `${W()}/people/employees`, { method: id ? "PUT" : "POST", body: JSON.stringify(b) });
      pplClose(); toast(id ? "Employee saved" : "Employee added");
      PPL.d = await api(`${W()}/people`); PPL.sideWs = null; pplSide(true); return pplRerender();
    }
    if (f.id === "pplSettings") { await api(`${W()}/people/settings`, { method: "PUT", body: JSON.stringify(pplSettingsBody()) }); toast("Settings saved"); PPL.d = await api(`${W()}/people`); return pplRerender(); }
    if (f.id === "pplPost") { const r = await api(`${W()}/payroll/runs/${PPL.pay.run.id}/post-finance`, { method: "POST", body: JSON.stringify({ inr_sar_rate: $("#ppl-rate").value }) }); toast(`Posted SAR ${r.expense.amount_sar.toLocaleString("en-US")} to Finance`); return pplRerender(); }
    if (f.dataset.pplform === "add-punch") { await api(`${W()}/people/punches`, { method: "POST", body: JSON.stringify({ employee_id: f.dataset.emp, date: f.dataset.date, in_time: f.in.value, out_time: f.out.value || null, reason: f.reason.value }) }); toast("Punch added"); pplClose(); return pplRerender(); }
    if (f.dataset.pplform === "edit-punch") { await api(`${W()}/people/punches/${f.dataset.id}`, { method: "PUT", body: JSON.stringify({ in_time: f.in.value, out_time: f.out.value || null, reason: f.reason.value }) }); toast("Punch corrected"); pplClose(); return pplRerender(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "people" && S.ws) render();
