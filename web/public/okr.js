/* Goals & review: quarterly OKRs (company and per team; key results linked to a live dashboard metric or typed in at
   each check-in) and the Monday weekly business review (metrics this week vs last week vs the 4-week average, goals,
   needs, wins/losses, incidents, cash, and the AI Chief of staff's cited notes). Owner, Admin and Team lead set and
   grade objectives; everyone else checks in on the key results they own and comments on the review.
   Uses app.js globals (S, $, api, esc, md, toast, fmtDate, ROUTES, levelFor). Names start with "okr". */

const OKR = { tab: "okrs", meta: null, quarter: null, list: null, reviews: null, review: null, openReview: null, openCheckin: null, editObj: null, editKr: null, addKr: null, closing: null, suggestion: {} };
const OKR_TABS = [["okrs", "Goals"], ["review", "Weekly review"]];
const OKR_STATUS = { draft: ["Draft", ""], active: ["Active", "accent"], closed: ["Closed", "good"], reviewed: ["Reviewed", "good"] };
const OKR_CONF = { on_track: ["On track", "good"], at_risk: ["At risk", "warn"], off_track: ["Off track", "bad"] };
const okrP = () => `/api/workspaces/${S.ws.id}/okr`;
const okrCanEdit = () => levelFor("okr") === "edit";
const okrMgr = () => !!OKR.meta?.me?.manager && okrCanEdit();
const okrBadge = (map, k) => { const [l, t] = map[k] || [k, ""]; return `<span class="badge ${t}">${esc(l)}</span>`; };
const okrVal = (v, unit) => (v == null ? "–" : `${unit === "SAR" ? "SAR " : unit === "USD" ? "$" : ""}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit === "%" ? "%" : unit === "hours" ? " h" : unit && !["SAR", "USD", "count", "score"].includes(unit) ? " " + unit : ""}`);
const okrPct = (p) => (p == null ? "–" : `${p}%`);
const okrBar = (p, label) => `<span class="okr-bar" role="img" aria-label="${esc(label)}: ${p == null ? "no data" : p + "%"}"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></span>`;
const okrPost = (p, b) => api(`${okrP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const okrPut = (p, b) => api(`${okrP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const okrOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;

ROUTES.okr = { title: "Goals & review", crumb: "Run the company", render: renderOkr };

async function renderOkr(view) {
  if (S.param && OKR_TABS.some(([k]) => k === S.param)) OKR.tab = S.param;
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs okr-tabs" role="tablist" aria-label="Goals and review views">${OKR_TABS.map(([k, l]) => `<button role="tab" data-okrtab="${k}" aria-selected="${OKR.tab === k}">${l}</button>`).join("")}</div>
    <div id="okrBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { OKR.meta = await api(`${okrP()}/meta`); OKR.quarter ||= OKR.meta.current_quarter; } catch (e) { $("#okrBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await okrShow();
}
async function okrShow() {
  if (S.route !== "okr") return;
  document.querySelectorAll("[data-okrtab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.okrtab === OKR.tab));
  const box = $("#okrBody"); if (!box) return;
  try {
    if (OKR.tab === "okrs") { OKR.list = await api(`${okrP()}/objectives?quarter=${encodeURIComponent(OKR.quarter)}`); box.innerHTML = okrGoals(); }
    if (OKR.tab === "review") {
      OKR.reviews = await api(`${okrP()}/wbr`);
      if (!OKR.openReview && OKR.reviews.reviews[0]) OKR.openReview = OKR.reviews.reviews[0].id;
      OKR.review = OKR.openReview ? await api(`${okrP()}/wbr/${OKR.openReview}`).catch(() => null) : null;
      box.innerHTML = okrReviews();
    }
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ Goals */
function okrGoals() {
  const d = OKR.list, m = OKR.meta, mgr = okrMgr();
  const objs = d.objectives, active = objs.filter((o) => o.status === "active");
  const krs = active.flatMap((o) => o.krs);
  const prog = active.filter((o) => o.progress != null);
  const quarters = [...new Set([...m.quarters, OKR.quarter])].sort();
  const tiles = [["Objectives", `${active.length}`, `${objs.length - active.length} draft or closed`, ""],
    ["Average progress", prog.length ? `${Math.round(prog.reduce((a, o) => a + o.progress, 0) / prog.length)}%` : "–", "active objectives, metrics you can see", ""],
    ["Not on track", `${krs.filter((k) => k.confidence !== "on_track").length}`, "key results at risk or off track", krs.some((k) => k.confidence !== "on_track") ? "warn" : ""],
    ["No check-in 7+ days", `${krs.filter((k) => k.stale).length}`, "key results waiting for their owner", krs.some((k) => k.stale) ? "warn" : ""]];
  const head = `<div class="row between gap-8 okr-head"><div class="row gap-8"><label for="okr-q" class="s-small"><b>Quarter</b></label><select class="input input-sm" id="okr-q" data-okrq>${okrOpts(quarters.map((q) => [q, q === m.current_quarter ? `${q} (this quarter)` : q]), OKR.quarter)}</select></div>
    <span class="subtle s-small">${mgr ? "You set and grade objectives." : okrCanEdit() ? "You check in on the key results you own." : "View only."} Linked key results read the live metric; manual ones are typed in at each check-in.</span></div>`;
  const add = mgr ? `<details class="card card-pad okr-new" ${objs.length ? "" : "open"}><summary><b>New objective</b></summary><form id="okrObjForm" class="okr-form" style="margin-top:12px">
      <div class="field okr-wide"><label for="okn-title">Objective</label><input class="input" id="okn-title" required maxlength="200" dir="auto" placeholder="e.g. Win the first 25 paying stores on Salla and Zid"></div>
      <div class="field"><label for="okn-level">Level</label><select class="input" id="okn-level"><option value="company">Company</option><option value="team">Team</option></select></div>
      <div class="field"><label for="okn-team">Team</label><select class="input" id="okn-team">${okrOpts(m.teams.map((t) => [t.id, t.name]), "", "–")}</select><span class="hint">For team objectives (Teams & roles → Teams)</span></div>
      <div class="field"><label for="okn-owner">Owner</label><select class="input" id="okn-owner">${okrOpts(m.people.map((p) => [p.id, p.name]), m.me.id)}</select></div>
      <div class="field"><label for="okn-quarter">Quarter</label><select class="input" id="okn-quarter">${okrOpts(m.quarters.map((q) => [q, q]), OKR.quarter)}</select></div>
      <div class="field okr-wide"><label for="okn-desc">Why it matters</label><textarea class="input" id="okn-desc" rows="2" maxlength="2000" dir="auto"></textarea></div>
      <div class="row gap-8 okr-wide"><button class="btn btn-primary" type="submit">Create draft</button><span class="subtle s-small">Add ${m.kr_min} to ${m.kr_max} key results, then activate it.</span></div></form></details>` : "";
  const list = objs.length ? objs.map(okrObjCard).join("") : `<div class="card empty"><p>No objectives for ${esc(OKR.quarter)} yet.${mgr ? " Create the company objectives first, then the team ones." : " An Owner, Admin or Team lead sets them."}</p></div>`;
  return `<section class="s-kpis">${tiles.map(([l, v, sub, tone]) => `<div class="card s-kpi ${tone}"><span class="eyebrow">${l}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`).join("")}</section>
    <div style="margin-top:16px">${head}</div><div class="stack" style="gap:16px;margin-top:12px">${add}${list}</div>`;
}
function okrObjCard(o) {
  const m = OKR.meta, mgr = okrMgr() && o.status !== "closed", me = m.me.id;
  const editing = OKR.editObj === o.id && mgr;
  const header = editing ? `<form id="okrObjEdit" class="okr-form" data-id="${esc(o.id)}">
      <div class="field okr-wide"><label for="oke-title">Objective</label><input class="input" id="oke-title" value="${esc(o.title)}" required maxlength="200" dir="auto"></div>
      <div class="field"><label for="oke-owner">Owner</label><select class="input" id="oke-owner">${okrOpts(m.people.map((p) => [p.id, p.name]), o.owner_id)}</select></div>
      <div class="field okr-wide"><label for="oke-desc">Why it matters</label><textarea class="input" id="oke-desc" rows="2" dir="auto">${esc(o.description || "")}</textarea></div>
      <div class="row gap-8 okr-wide"><button class="btn btn-primary btn-sm" type="submit">Save</button><button class="btn btn-sm" type="button" data-okract="cancel-edit">Cancel</button></div></form>`
    : `<div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:0"><h3 style="margin:0" dir="auto">${esc(o.title)}</h3>
      <div class="okr-meta subtle s-small">${okrBadge(OKR_STATUS, o.status)}<span>${o.level === "team" ? `Team · ${esc(o.team_name || "")}` : "Company"}</span><span>Owner: ${esc(o.owner_name || "–")}</span>${o.sample ? `<span class="badge warn">sample</span>` : ""}${o.partial ? `<span class="badge">some metrics hidden for your role</span>` : ""}</div>
      ${o.description ? `<p class="s-small okr-text" dir="auto">${esc(o.description)}</p>` : ""}</div>
      <div class="okr-prog"><b class="num">${okrPct(o.progress)}</b>${okrBar(o.progress, "Objective progress")}</div></div>`;
  const rows = o.krs.map((k) => okrKrRow(o, k, me)).join("");
  const actions = [];
  if (mgr && !editing) actions.push(`<button class="btn btn-sm btn-ghost" data-okract="edit-obj" data-id="${esc(o.id)}">Edit</button>`);
  if (mgr && o.krs.length < m.kr_max) actions.push(`<button class="btn btn-sm" data-okract="add-kr" data-id="${esc(o.id)}">Add key result</button>`);
  if (mgr && o.status === "draft") actions.push(`<button class="btn btn-sm btn-primary" data-okract="activate" data-id="${esc(o.id)}" ${o.krs.length < m.kr_min ? "disabled" : ""} title="Needs ${m.kr_min}–${m.kr_max} key results">Activate</button>`);
  if (mgr && o.status === "active") actions.push(`<button class="btn btn-sm btn-primary" data-okract="close-start" data-id="${esc(o.id)}">Grade and close</button>`);
  if (mgr) actions.push(`<button class="btn btn-sm btn-ghost btn-danger" data-okract="del-obj" data-id="${esc(o.id)}">Delete</button>`);
  const closed = o.status === "closed" ? `<div class="okr-retro"><b>Score ${esc(o.score)}</b><span class="subtle s-small"> · graded by ${esc(o.closed_by || "")} ${o.closed_at ? esc(o.closed_at.slice(0, 10)) : ""}</span><p class="s-small okr-text" dir="auto">${esc(o.retro || "")}</p></div>` : "";
  return `<section class="card card-pad okr-obj" id="okr-o-${esc(o.id)}">${header}
    ${o.krs.length ? `<ul class="okr-krs">${rows}</ul>` : `<p class="muted s-small">No key results yet.</p>`}
    ${OKR.addKr === o.id && mgr ? okrKrForm(o, null) : ""}
    ${OKR.closing === o.id && mgr ? okrCloseForm(o) : ""}${closed}
    ${actions.length ? `<div class="row gap-8 okr-actions">${actions.join("")}</div>` : ""}</section>`;
}
function okrKrRow(o, k, me) {
  const mgr = okrMgr() && o.status !== "closed";
  const canCheck = o.status === "active" && okrCanEdit() && !k.hidden && (OKR.meta.me.manager || k.owner_id === me);
  const value = k.hidden ? `<span class="subtle s-small">${esc(k.hidden_hint || "Hidden for your role")}</span>`
    : `<span class="num">${esc(okrVal(k.current, k.unit))}</span><span class="subtle s-small"> of ${esc(okrVal(k.target, k.unit))} · from ${esc(okrVal(k.start, k.unit))}</span>`;
  const last = k.last_checkin_at ? `checked in ${esc(k.last_checkin_at.slice(0, 10))}` : "no check-in yet";
  const hist = !k.hidden && k.checkins?.length ? `<details class="okr-hist"><summary class="s-small">Check-ins (${k.checkins.length})</summary><ul class="s-small">${k.checkins.map((c) => `<li><span class="num">${esc(c.at.slice(0, 10))}</span> · ${esc(c.by || "")} · ${okrBadge(OKR_CONF, c.confidence)} ${c.value != null ? `· ${esc(okrVal(c.value, k.unit))}` : ""}${c.note ? ` · <span dir="auto">${esc(c.note)}</span>` : ""}</li>`).join("")}</ul></details>` : "";
  return `<li class="okr-kr ${k.stale ? "okr-stale" : ""}"><div class="okr-kr-main"><div style="min-width:0"><b dir="auto">${esc(k.title)}</b>
      <div class="okr-meta subtle s-small"><span>${k.kind === "linked" ? `Linked: ${esc(k.metric_name || "")}` : "Manual"}</span><span>Owner: ${esc(k.owner_name || "–")}</span><span>${last}</span>${k.stale ? `<span class="badge warn">${esc(k.days_since_checkin)} days without a check-in</span>` : ""}</div></div>
      <div class="okr-kr-val">${value}</div>
      <div class="okr-kr-prog">${k.hidden ? "" : `${okrBar(k.progress, k.title)}<span class="num s-small">${okrPct(k.progress)}</span>`}</div>
      <div class="okr-kr-act">${okrBadge(OKR_CONF, k.confidence)}${canCheck ? `<button class="btn btn-sm" data-okract="checkin" data-id="${esc(k.id)}">Check in</button>` : ""}${mgr ? `<button class="btn btn-sm btn-ghost" data-okract="edit-kr" data-id="${esc(k.id)}">Edit</button><button class="btn btn-sm btn-ghost" data-okract="del-kr" data-id="${esc(k.id)}" aria-label="Remove key result">Remove</button>` : ""}</div></div>
    ${OKR.openCheckin === k.id && canCheck ? okrCheckinForm(k) : ""}${OKR.editKr === k.id && mgr ? okrKrForm(o, k) : ""}${hist}</li>`;
}
function okrCheckinForm(k) {
  return `<form id="okrCheckin" class="okr-form okr-inline" data-id="${esc(k.id)}">
    ${k.kind === "manual" ? `<div class="field"><label for="okc-value">Current value${k.unit ? ` (${esc(k.unit)})` : ""}</label><input class="input" id="okc-value" required inputmode="decimal" value="${esc(k.current ?? "")}"></div>` : `<p class="subtle s-small okr-wide" style="margin:0">The value comes from the live metric (${esc(okrVal(k.current, k.unit))} now). Add your confidence and a note.</p>`}
    <div class="field"><label for="okc-conf">Confidence</label><select class="input" id="okc-conf">${okrOpts(OKR.meta.confidence.map((c) => [c.id, c.name]), k.confidence)}</select></div>
    <div class="field okr-wide"><label for="okc-note">Note</label><textarea class="input" id="okc-note" rows="2" maxlength="1000" dir="auto" placeholder="What moved, what's blocking, what you'll do next"></textarea></div>
    <div class="row gap-8 okr-wide"><button class="btn btn-primary btn-sm" type="submit">Save check-in</button><button class="btn btn-sm" type="button" data-okract="cancel-checkin">Cancel</button></div></form>`;
}
function okrKrForm(o, k) {
  const m = OKR.meta, isNew = !k, kind = k?.kind || "linked";
  const metrics = m.metrics.filter((x) => !x.hidden).map((x) => [x.id, `${x.name}${x.kind === "flow" ? " (quarter total)" : ""}`]);
  return `<form id="okrKrForm" class="okr-form okr-inline" data-obj="${esc(o.id)}" data-id="${esc(k?.id || "")}">
    <div class="field okr-wide"><label for="okk-title">Key result</label><input class="input" id="okk-title" required maxlength="200" dir="auto" value="${esc(k?.title || "")}" placeholder="e.g. 25 paying stores"></div>
    <div class="field"><label for="okk-kind">Kind</label><select class="input" id="okk-kind" ${isNew ? "" : "disabled"}>${okrOpts([["linked", "Linked to a live metric"], ["manual", "Manual (typed at each check-in)"]], kind)}</select></div>
    <div class="field"><label for="okk-metric">Metric</label><select class="input" id="okk-metric" ${isNew ? "" : "disabled"}>${okrOpts(metrics, k?.metric, "–")}</select><span class="hint">Only metrics your role can see. Flows add up over the quarter.</span></div>
    <div class="field"><label for="okk-start">Start</label><input class="input" id="okk-start" inputmode="decimal" value="${esc(k?.start ?? "")}" placeholder="${isNew ? "today's value" : ""}"></div>
    <div class="field"><label for="okk-target">Target</label><input class="input" id="okk-target" required inputmode="decimal" value="${esc(k?.target ?? "")}"></div>
    <div class="field"><label for="okk-unit">Unit (manual only)</label><input class="input" id="okk-unit" maxlength="20" value="${esc(k && k.kind === "manual" ? k.unit : "")}"></div>
    <div class="field"><label for="okk-owner">Owner</label><select class="input" id="okk-owner">${okrOpts(m.people.map((p) => [p.id, p.name]), k?.owner_id || o.owner_id)}</select></div>
    <div class="row gap-8 okr-wide"><button class="btn btn-primary btn-sm" type="submit">${isNew ? "Add key result" : "Save"}</button><button class="btn btn-sm" type="button" data-okract="cancel-kr">Cancel</button></div></form>`;
}
function okrCloseForm(o) {
  const s = OKR.suggestion[o.id];
  const val = s?.score ?? o.suggested_score ?? "";
  return `<form id="okrCloseForm" class="okr-form okr-inline" data-id="${esc(o.id)}">
    <p class="s-small okr-wide" style="margin:0">Grading is your call. Suggested from the key results: <b>${esc(o.suggested_score ?? "–")}</b>${s ? ` · ${s.by_ai ? "AI Chief of staff" : "rule"}: <b>${esc(s.score ?? "–")}</b> <span class="subtle" dir="auto">${esc(s.why || "")}</span>` : ""}
      <button class="btn btn-sm btn-ghost" type="button" data-okract="suggest" data-id="${esc(o.id)}">Ask the AI Chief of staff</button></p>
    <div class="field"><label for="okx-score">Score (0 to 1.0)</label><input class="input" id="okx-score" required type="number" min="0" max="1" step="0.1" value="${esc(val)}"></div>
    <div class="field okr-wide"><label for="okx-retro">Retro</label><textarea class="input" id="okx-retro" required rows="3" maxlength="3000" dir="auto" placeholder="What worked, what didn't, what we'll change next quarter"></textarea></div>
    <div class="row gap-8 okr-wide"><button class="btn btn-primary btn-sm" type="submit">Close with this score</button><button class="btn btn-sm" type="button" data-okract="cancel-close">Cancel</button></div></form>`;
}

/* ------------------------------------------------ Weekly review */
function okrReviews() {
  const d = OKR.reviews, r = OKR.review;
  const list = d.reviews.length ? `<ul class="okr-rlist">${d.reviews.map((x) => `<li><button class="okr-btnlink ${x.id === OKR.openReview ? "okr-here" : ""}" data-okract="open-review" data-id="${esc(x.id)}">Week of ${esc(x.week_start)}</button> ${okrBadge(OKR_STATUS, x.status)}<span class="subtle s-small"> ${x.comments} comment${x.comments === 1 ? "" : "s"}</span></li>`).join("")}</ul>` : `<p class="muted s-small">No reviews yet. The draft is written every Monday from 07:00 Riyadh.</p>`;
  const gen = d.can_generate && okrCanEdit() ? `<button class="btn btn-sm" data-okract="generate">Draft this week's review</button>` : "";
  return `<div class="cc"><div class="cc-span-4 stack" style="gap:16px"><section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Reviews</h3>${gen}</div>
      <p class="subtle s-small">${d.agent_level ? "The AI Chief of staff drafts the notes; it only summarizes the rows and cites each one." : "The AI Chief of staff is off: notes are the factual summary."} Reviewed weeks are locked.</p>${list}</section></div>
    <div class="cc-span-8">${r ? okrReview(r) : `<div class="card empty"><p>Pick a review.</p></div>`}</div></div>`;
}
function okrComments(r, sec) {
  const list = (r.comments || []).filter((c) => c.section === sec);
  return `<div class="okr-cm">${list.map((c) => `<p class="s-small"><b>${esc(c.by)}</b> <span class="subtle">${esc(fmtDate(c.at))}</span>: <span dir="auto">${esc(c.text)}</span></p>`).join("")}
    ${r.can_comment ? `<form class="okr-cmform row gap-8" data-okrcm="${sec}"><input class="input input-sm" required maxlength="2000" dir="auto" placeholder="Comment on this section" aria-label="Comment on this section"><button class="btn btn-sm" type="submit">Comment</button></form>` : ""}</div>`;
}
function okrReview(r) {
  const d = r.data, sec = (id, title, body) => `<section class="okr-sec"><h4>${esc(title)}</h4>${body}${okrComments(r, id)}</section>`;
  const chg = (m) => { if (m.change_pct == null) return "–"; const good = m.change_pct === 0 ? null : (m.change_pct > 0) === m.higher_is_better; return `<span style="color:${good == null ? "var(--text-3)" : good ? "var(--good)" : "var(--bad)"}">${m.change_pct > 0 ? "+" : ""}${m.change_pct}%</span>`; };
  const metrics = d.metrics.length ? `<div class="table-wrap"><table class="f-table okr-table"><thead><tr><th>Ref</th><th>Metric</th><th class="num">This week</th><th class="num">Last week</th><th class="num">Change</th><th class="num">4-week avg</th></tr></thead><tbody>
      ${d.metrics.map((m) => `<tr><td class="subtle">${esc(m.ref)}</td><td>${esc(m.name)}</td><td class="num">${esc(okrVal(m.this_week, m.unit))}</td><td class="num">${esc(okrVal(m.last_week, m.unit))}</td><td class="num">${chg(m)}</td><td class="num">${esc(okrVal(m.avg_4w, m.unit))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small">No metrics you can see.</p>`;
  const goals = d.okrs.length ? d.okrs.map((o) => `<div class="okr-wgoal"><div class="row between gap-8"><b dir="auto">${esc(o.title)}</b><span class="subtle s-small">[${esc(o.ref)}] ${okrPct(o.progress)}</span></div>
      <ul class="s-small okr-wkrs">${o.krs.map((k) => `<li><span class="subtle">[${esc(k.ref)}]</span> <span dir="auto">${esc(k.title)}</span> · ${k.hidden ? `<span class="subtle">hidden for your role</span>` : `${esc(okrVal(k.current, k.unit))} of ${esc(okrVal(k.target, k.unit))}`} · ${okrBadge(OKR_CONF, k.confidence)}${k.stale ? ` <span class="badge warn">no check-in 7+ days</span>` : ""}</li>`).join("")}</ul></div>`).join("")
    + (d.okr_changes.length ? `<p class="s-small" style="margin:8px 0 4px"><b>Changes this week</b></p><ul class="s-small okr-wkrs">${d.okr_changes.map((c) => `<li><span class="subtle">[${esc(c.ref)}]</span> <span dir="auto">${esc(c.objective)}${c.kr ? " · " + esc(c.kr) : ""}</span>: ${esc(c.text)}</li>`).join("")}</ul>` : "")
    : `<p class="muted s-small">No active objectives.</p>`;
  const ul = (rows, empty) => (rows.length ? `<ul class="s-small okr-wkrs">${rows.join("")}</ul>` : `<p class="muted s-small">${empty}</p>`);
  const needs = ul(d.needs.map((n) => `<li><span class="subtle">[${esc(n.ref)}]</span> <b>${esc(n.title)}</b> · ${esc(n.module)}: ${esc(n.text)}</li>`), "Nothing waiting.");
  const wl = d.winloss ? ul(d.winloss.map((x) => `<li><span class="subtle">[${esc(x.ref)}]</span> ${okrBadge({ won: ["Won", "good"], lost: ["Lost", "bad"] }, x.outcome)} <span dir="auto">${esc(x.name)}</span>: <span dir="auto">${esc(x.reason || "[ADD] reason")}</span>${x.competitor ? ` · ${esc(x.competitor)}` : ""}</li>`), "No deals won or lost this week.") : null;
  const inc = d.incidents ? ul(d.incidents.map((i) => `<li><span class="subtle">[${esc(i.ref)}]</span> ${esc(i.severity)} <span dir="auto">${esc(i.title)}</span> (${esc(i.status)})${i.impact ? `: <span dir="auto">${esc(i.impact)}</span>` : ""}</li>`), "No incidents.") : null;
  const cash = d.cash ? `<p class="s-small"><span class="subtle">[F1]</span> Runway <b>${d.cash.runway_months == null ? "–" : esc(d.cash.runway_months) + " months"}</b> · cash SAR ${esc(Number(d.cash.cash_sar || 0).toLocaleString("en-US"))}${d.cash.cash_as_of ? ` (as of ${esc(d.cash.cash_as_of)})` : ""} · net burn SAR ${esc(Number(d.cash.net_burn_sar || 0).toLocaleString("en-US"))}/month</p>` : null;
  const narr = r.can_edit ? `<textarea class="input okr-narr" id="okr-narr" rows="16" dir="auto" aria-label="Chief of staff notes">${esc(r.narrative)}</textarea>
      <div class="row gap-8" style="flex-wrap:wrap;margin-top:8px"><button class="btn btn-sm" data-okract="save-narr" data-id="${esc(r.id)}">Save notes</button><button class="btn btn-sm btn-ghost" data-okract="factual" data-id="${esc(r.id)}">Use the factual summary</button></div>`
    : `<div class="doc okr-doc" dir="auto">${md(r.narrative)}</div>`;
  return `<section class="card card-pad" id="okrReview"><div class="row between gap-8" style="flex-wrap:wrap"><div><h3 style="margin:0">Week of ${esc(r.week_start)} ${okrBadge(OKR_STATUS, r.status)}</h3><span class="subtle s-small">${esc(r.from)} to ${esc(r.to)} · ${r.status === "reviewed" ? `reviewed by ${esc(r.reviewed_by)} ${esc(String(r.reviewed_at).slice(0, 10))}` : "draft"}</span></div>
      <div class="row gap-8"><a class="btn btn-sm" href="${okrP()}/wbr/${encodeURIComponent(r.id)}/print" target="_blank" rel="noopener">Print</a>${r.can_review ? `<button class="btn btn-sm btn-primary" data-okract="mark-reviewed" data-id="${esc(r.id)}">Mark reviewed</button>` : ""}</div></div>
    ${r.partial ? `<p class="subtle s-small">${esc(r.hidden_rows)} row${r.hidden_rows === 1 ? " is" : "s are"} hidden for your role, with every note line that cites them.</p>` : ""}
    ${sec("metrics", "Metrics", metrics)}${sec("okrs", "Goals", goals)}${sec("needs", "Needs attention", needs)}${wl != null ? sec("winloss", "Wins and losses", wl) : ""}${inc != null ? sec("incidents", "Incidents", inc) : ""}${cash != null ? sec("cash", "Cash", cash) : ""}
    ${sec("narrative", "Chief of staff notes", `${r.note ? `<p class="s-small" style="color:var(--warn)">${esc(r.note)}</p>` : ""}${r.issues?.length && r.can_edit ? `<ul class="s-small okr-issues">${r.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${narr}`)}</section>`;
}

/* ------------------------------------------------ events */
async function okrAct(a, id, btn) {
  if (a === "edit-obj") { OKR.editObj = id; return okrShow(); }
  if (a === "cancel-edit") { OKR.editObj = null; return okrShow(); }
  if (a === "add-kr") { OKR.addKr = id; OKR.editKr = null; return okrShow(); }
  if (a === "edit-kr") { OKR.editKr = id; OKR.addKr = null; return okrShow(); }
  if (a === "cancel-kr") { OKR.addKr = OKR.editKr = null; return okrShow(); }
  if (a === "checkin") { OKR.openCheckin = id; await okrShow(); return $("#okc-value, #okc-conf")?.focus(); }
  if (a === "cancel-checkin") { OKR.openCheckin = null; return okrShow(); }
  if (a === "close-start") { OKR.closing = id; return okrShow(); }
  if (a === "cancel-close") { OKR.closing = null; return okrShow(); }
  if (a === "activate") { await okrPost(`/objectives/${id}/activate`); toast("Objective is active: owners get a reminder after 7 days without a check-in"); return okrShow(); }
  if (a === "del-obj") { if (!confirm("Delete this objective, its key results and check-ins?")) return; await api(`${okrP()}/objectives/${id}`, { method: "DELETE" }); return okrShow(); }
  if (a === "del-kr") { if (!confirm("Remove this key result and its check-ins?")) return; await api(`${okrP()}/krs/${id}`, { method: "DELETE" }); return okrShow(); }
  if (a === "suggest") {
    btn.disabled = true; btn.textContent = "Thinking…";
    try { OKR.suggestion[id] = await okrPost(`/objectives/${id}/suggest-score`); } finally { btn.disabled = false; }
    return okrShow();
  }
  if (a === "open-review") { OKR.openReview = id; return okrShow(); }
  if (a === "generate") {
    btn.disabled = true; btn.textContent = "Drafting…";
    try { const r = await okrPost("/wbr", { refresh: true }); OKR.openReview = r.id; toast("Draft ready: read it, comment and mark it reviewed"); } finally { btn.disabled = false; }
    return okrShow();
  }
  if (a === "save-narr") { await okrPut(`/wbr/${id}`, { narrative: $("#okr-narr").value }); toast("Notes saved"); return okrShow(); }
  if (a === "factual") { if (!confirm("Replace the notes with the factual summary built from the rows?")) return; await okrPost(`/wbr/${id}/factual`); return okrShow(); }
  if (a === "mark-reviewed") {
    if ($("#okr-narr")) await okrPut(`/wbr/${id}`, { narrative: $("#okr-narr").value });
    if (!confirm("Mark this review reviewed? It will be locked.")) return;
    await okrPost(`/wbr/${id}/review`); toast("Reviewed and locked"); return okrShow();
  }
}
document.addEventListener("click", async (e) => {
  if (S.route !== "okr") return;
  const t = e.target.closest("[data-okrtab]");
  if (t) { OKR.tab = t.dataset.okrtab; return okrShow(); }
  const b = e.target.closest("[data-okract]");
  if (b) { e.preventDefault(); try { await okrAct(b.dataset.okract, b.dataset.id, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("change", (e) => {
  if (S.route !== "okr") return;
  if (e.target.closest("[data-okrq]")) { OKR.quarter = e.target.value; okrShow(); }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "okr") return;
  const f = e.target, v = (s) => $(s)?.value ?? "";
  if (!f.matches("#okrObjForm, #okrObjEdit, #okrKrForm, #okrCheckin, #okrCloseForm, [data-okrcm]")) return;
  e.preventDefault();
  try {
    if (f.id === "okrObjForm") {
      const o = await okrPost("/objectives", { title: v("#okn-title"), level: v("#okn-level"), team_id: v("#okn-team") || null, owner_id: v("#okn-owner"), quarter: v("#okn-quarter"), description: v("#okn-desc") });
      OKR.quarter = o.quarter; OKR.addKr = o.id; toast("Draft created: add its key results");
    }
    if (f.id === "okrObjEdit") { await okrPut(`/objectives/${f.dataset.id}`, { title: v("#oke-title"), owner_id: v("#oke-owner"), description: v("#oke-desc") }); OKR.editObj = null; toast("Saved"); }
    if (f.id === "okrKrForm") {
      const body = { title: v("#okk-title"), start: v("#okk-start"), target: v("#okk-target"), owner_id: v("#okk-owner") };
      if (body.start === "") delete body.start; // new linked KRs start from today's value
      if (!f.dataset.id) { Object.assign(body, { kind: v("#okk-kind"), metric: v("#okk-metric") || null, unit: v("#okk-unit") }); await okrPost(`/objectives/${f.dataset.obj}/krs`, body); toast("Key result added"); }
      else { if (v("#okk-unit")) body.unit = v("#okk-unit"); await okrPut(`/krs/${f.dataset.id}`, body); toast("Saved"); }
      OKR.addKr = OKR.editKr = null;
    }
    if (f.id === "okrCheckin") {
      const body = { confidence: v("#okc-conf"), note: v("#okc-note") };
      if ($("#okc-value")) body.value = v("#okc-value");
      await okrPost(`/krs/${f.dataset.id}/checkins`, body); OKR.openCheckin = null; toast("Check-in saved");
    }
    if (f.id === "okrCloseForm") { await okrPost(`/objectives/${f.dataset.id}/close`, { score: Number(v("#okx-score")), retro: v("#okx-retro") }); OKR.closing = null; toast("Closed and graded"); }
    if (f.dataset.okrcm) { await okrPost(`/wbr/${OKR.openReview}/comments`, { section: f.dataset.okrcm, text: f.querySelector("input").value }); toast("Comment added"); }
    await okrShow();
  } catch (err) { toast(err.message, true); }
});

if (S.route === "okr" && S.ws) render();
