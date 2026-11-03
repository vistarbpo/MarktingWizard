/* Investor room (access module "investors"; Owner edit, Admin view by default, everyone else none):
   investors and funds through a pipeline, the round (committed = what people typed on committed investors; valuation
   and cap [CONFIRM] until a person confirms), the metrics pack (live values from each module; "No data yet" when a
   source is empty) frozen into snapshots that never change, the data room (Legal documents, snapshots, approved
   updates, uploaded files, links), share links /i/<token> per investor, engagement, and the monthly update drafted by
   the AI Investor relations agent (drafts only; the founder writes the lowlights; a person approves).
   Uses app.js globals (S, $, api, esc, md, toast, ROUTES, levelFor, go). Names start with "iv". */

const IV = { tab: "pipeline", meta: null, open: null, upd: null, editing: false, linkFor: null };
const IV_TABS = [["pipeline", "Pipeline"], ["round", "Round"], ["metrics", "Metrics pack"], ["room", "Data room"], ["links", "Share links"], ["engagement", "Engagement"], ["updates", "Monthly update"]];
const IV_STATE = { active: "good", expired: "", revoked: "bad" };
const ivP = () => `/api/workspaces/${S.ws.id}/investors`;
const ivEdit = () => levelFor("investors") === "edit";
const ivPost = (p, b) => api(`${ivP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const ivPut = (p, b) => api(`${ivP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const ivDel = (p) => api(`${ivP()}${p}`, { method: "DELETE" });
const ivOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const ivBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;
const ivUsd = (n) => (n === null || n === undefined || n === "" ? "–" : `$${Number(n).toLocaleString("en-US")}`);
const ivTile = (l, v, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(l)}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`;
const ivWhen = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "–");
const ivFolder = (id) => IV.meta?.folders.find((f) => f.id === id)?.name || id;
const ivKind = (id) => IV.meta?.item_kinds.find((k) => k.id === id)?.name || id;
const ivAddDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const ivVal = (s) => $(s)?.value ?? "";

ROUTES.investors = { title: "Investor room", crumb: "Company", render: renderInvestors };

async function renderInvestors(view) {
  if (IV_TABS.some(([k]) => k === S.param)) { IV.tab = S.param; IV.open = null; IV.upd = null; }
  else if (S.param && /^\d+$/.test(S.param)) { IV.tab = "pipeline"; IV.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs iv-tabs" role="tablist" aria-label="Investor room views">${IV_TABS.map(([k, l]) => `<button role="tab" data-ivtab="${k}" aria-selected="${IV.tab === k}">${l}</button>`).join("")}</div>
    <div id="ivBody" class="iv-body"><p class="muted">Loading…</p></div>`;
  try { IV.meta = await api(`${ivP()}/meta`); } catch (e) { $("#ivBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await ivShow();
}
async function ivShow() {
  if (S.route !== "investors") return;
  document.querySelectorAll("[data-ivtab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ivtab === IV.tab));
  const box = $("#ivBody"); if (!box) return;
  try {
    const t = IV.tab;
    if (t === "pipeline") box.innerHTML = IV.open ? ivInvestor(await api(`${ivP()}/investors/${IV.open}`)) : ivPipeline(await api(`${ivP()}/investors`), await api(`${ivP()}/rounds`));
    else if (t === "round") box.innerHTML = ivRounds(await api(`${ivP()}/rounds`));
    else if (t === "metrics") box.innerHTML = ivMetrics(await api(`${ivP()}/metrics`), await api(`${ivP()}/snapshots`));
    else if (t === "room") box.innerHTML = ivRoom(await api(`${ivP()}/room`), await api(`${ivP()}/snapshots`), await api(`${ivP()}/updates`));
    else if (t === "links") box.innerHTML = ivLinks(await api(`${ivP()}/links`), await api(`${ivP()}/investors`), await api(`${ivP()}/room`));
    else if (t === "engagement") box.innerHTML = ivEngagement(await api(`${ivP()}/engagement`));
    else if (t === "updates") box.innerHTML = IV.upd ? ivUpdate(await api(`${ivP()}/updates/${IV.upd}`)) : ivUpdates(await api(`${ivP()}/updates`), await api(`${ivP()}/snapshots`));
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}
const ivNote = (text) => `<p class="iv-banner s-small" role="note">${text}</p>`;

/* ------------------------------------------------ pipeline */
function ivInvForm(i) {
  const m = IV.meta;
  return `<form id="ivInvForm" class="iv-form" data-id="${esc(i?.id || "")}">
    <div class="field"><label for="ivf-name">Name</label><input class="input" id="ivf-name" maxlength="160" dir="auto" required value="${esc(i?.name || "")}"></div>
    <div class="field"><label for="ivf-firm">Firm</label><input class="input" id="ivf-firm" maxlength="200" dir="auto" value="${esc(i?.firm || "")}"></div>
    <div class="field"><label for="ivf-kind">Kind</label><select class="input" id="ivf-kind">${ivOpts(m.kinds.map((k) => [k.id, k.name]), i?.kind || "fund")}</select></div>
    <div class="field"><label for="ivf-stage">Stage</label><select class="input" id="ivf-stage">${ivOpts(m.stages.map((s) => [s.id, s.name]), i?.stage || "target")}</select></div>
    <div class="field"><label for="ivf-min">Check size from (USD)</label><input class="input" id="ivf-min" inputmode="decimal" value="${esc(i?.check_min_usd ?? "")}"></div>
    <div class="field"><label for="ivf-max">Check size to (USD)</label><input class="input" id="ivf-max" inputmode="decimal" value="${esc(i?.check_max_usd ?? "")}"></div>
    <div class="field"><label for="ivf-com">Committed amount (USD, typed by you)</label><input class="input" id="ivf-com" inputmode="decimal" value="${esc(i?.committed_usd ?? "")}"><span class="hint">Counts toward the round only at the Committed stage.</span></div>
    <div class="field"><label for="ivf-round">Round</label><select class="input" id="ivf-round">${ivOpts((IV.rounds || []).map((r) => [r.id, r.name]), i?.round_id || "", "No round")}</select></div>
    <div class="field"><label for="ivf-owner">Owner</label><select class="input" id="ivf-owner">${ivOpts(m.people.map((p) => [p.id, p.name]), i?.owner_id || "")}</select></div>
    <div class="field"><label for="ivf-cname">Contact name</label><input class="input" id="ivf-cname" maxlength="120" dir="auto" value="${esc(i?.contact?.name || "")}"></div>
    <div class="field"><label for="ivf-cemail">Contact email</label><input class="input" id="ivf-cemail" type="email" maxlength="200" value="${esc(i?.contact?.email || "")}"></div>
    <div class="field"><label for="ivf-cphone">Contact phone</label><input class="input" id="ivf-cphone" maxlength="40" value="${esc(i?.contact?.phone || "")}"></div>
    <div class="field iv-wide"><label for="ivf-thesis">Thesis notes</label><textarea class="input iv-ta" id="ivf-thesis" rows="2" dir="auto">${esc(i?.thesis || "")}</textarea></div>
    <div class="field iv-wide"><label for="ivf-intro">Warm-intro path</label><input class="input" id="ivf-intro" maxlength="2000" dir="auto" value="${esc(i?.intro_path || "")}" placeholder="Who can introduce you, and how"></div>
    <div class="field"><label for="ivf-next">Next step</label><input class="input" id="ivf-next" maxlength="2000" dir="auto" value="${esc(i?.next_step || "")}"></div>
    <div class="field"><label for="ivf-nextd">Next step date</label><input class="input" id="ivf-nextd" type="date" value="${esc(i?.next_step_date || "")}"></div>
    ${i ? `<div class="field iv-wide"><label for="ivf-meet">Linked meetings</label><select class="input iv-multi" id="ivf-meet" multiple size="4">${m.meetings.map((x) => `<option value="${esc(x.id)}" ${(i.meeting_ids || []).includes(x.id) ? "selected" : ""}>${esc(`${x.date} · ${x.title}${x.type === "investor" ? " (investor)" : ""}`)}</option>`).join("")}</select><span class="hint">From Meetings. Ctrl/⌘-click to pick several.</span></div>
    <div class="field iv-wide"><label for="ivf-docs">Linked data room documents</label><select class="input iv-multi" id="ivf-docs" multiple size="4">${(IV.items || []).map((x) => `<option value="${esc(x.id)}" ${(i.document_ids || []).includes(x.id) ? "selected" : ""}>${esc(`${ivFolder(x.folder)} · ${x.title}`)}</option>`).join("")}</select></div>` : ""}
    <div class="row gap-8 iv-wide"><button class="btn btn-primary" type="submit">${i ? "Save" : "Add investor"}</button>${i ? `<button class="btn" type="button" data-ivact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}
function ivPipeline(d, r) {
  IV.rounds = r.rounds;
  const edit = ivEdit(), m = IV.meta, inPlay = d.investors.filter((i) => !["committed", "passed"].includes(i.stage)).length;
  const tiles = [ivTile("Investors", d.total, "in the room"), ivTile("In play", inPlay, "not committed or passed"), ivTile("Committed", d.by_stage.committed || 0, "investors at Committed"), ivTile("Next steps overdue", d.overdue, "past their date", d.overdue ? "warn" : "")];
  const board = `<div class="s-board iv-board">${m.stages.map((st) => {
    const list = d.investors.filter((i) => i.stage === st.id);
    return `<section class="s-col" aria-label="${esc(st.name)}"><div class="s-col-head"><h3 class="s-small">${esc(st.name)}</h3><span class="subtle s-small num">${list.length}</span></div>
      ${list.map((i) => `<button class="s-card iv-card" data-ivact="open" data-id="${esc(i.id)}"><b dir="auto" class="iv-wrap">${esc(i.name)}</b>
        <span class="subtle s-small">${esc(m.kinds.find((k) => k.id === i.kind)?.name || i.kind)}${i.check_min_usd != null || i.check_max_usd != null ? ` · ${ivUsd(i.check_min_usd)}–${ivUsd(i.check_max_usd)}` : ""}</span>
        ${i.next_step ? `<span class="s-small iv-wrap" dir="auto">${esc(i.next_step)}${i.next_step_date ? ` · <span class="num iv-nw">${esc(i.next_step_date)}</span>` : ""}</span>` : ""}
        <span class="row gap-4 iv-flex">${i.overdue ? ivBadge("overdue", "warn") : ""}${i.views ? ivBadge(`${i.views} view${i.views === 1 ? "" : "s"}`, "accent") : ""}${i.stage === "committed" && i.committed_usd != null ? ivBadge(ivUsd(i.committed_usd), "good") : ""}${i.sample ? ivBadge("sample", "warn") : ""}</span></button>`).join("") || `<p class="subtle s-small iv-empty">None</p>`}</section>`;
  }).join("")}</div>`;
  const add = edit ? `<details class="card card-pad" ${d.total ? "" : "open"}><summary><b>Add an investor</b></summary>${ivInvForm(null)}</details>` : "";
  return `<section class="s-kpis">${tiles.join("")}</section><div class="stack iv-stack">${add}${board}</div>`;
}
function ivInvestor(i) {
  const edit = ivEdit();
  if (IV.editing && edit) return `<section class="card card-pad"><button class="iv-link s-small" data-ivact="back">← Pipeline</button>${ivInvForm(i)}</section>`;
  const facts = [["Kind", IV.meta.kinds.find((k) => k.id === i.kind)?.name], ["Firm", i.firm], ["Check size", i.check_min_usd != null || i.check_max_usd != null ? `${ivUsd(i.check_min_usd)} – ${ivUsd(i.check_max_usd)}` : ""], ["Committed", i.committed_usd != null ? ivUsd(i.committed_usd) : ""], ["Round", i.round_name],
    ["Owner", i.owner_name], ["Contact", [i.contact?.name, i.contact?.email, i.contact?.phone].filter(Boolean).join(" · ")], ["Warm intro", i.intro_path], ["Next step", i.next_step ? `${i.next_step}${i.next_step_date ? ` (${i.next_step_date})` : ""}` : ""]].filter(([, v]) => v);
  return `<div class="stack iv-stack"><section class="card card-pad iv-head"><button class="iv-link s-small" data-ivact="back">← Pipeline</button>
    <div class="row between gap-8 iv-flex"><h2 class="iv-h" dir="auto">${esc(i.name)}</h2><span class="row gap-8 iv-flex">${ivBadge(i.stage_name, i.stage === "committed" ? "good" : i.stage === "passed" ? "" : "accent")}${i.overdue ? ivBadge("next step overdue", "warn") : ""}${i.sample ? ivBadge("sample", "warn") : ""}</span></div>
    <dl class="iv-dl">${facts.map(([k, v]) => `<div><dt class="subtle s-small">${esc(k)}</dt><dd dir="auto">${esc(v)}</dd></div>`).join("")}</dl>
    ${i.thesis ? `<p class="s-small iv-pre" dir="auto"><span class="subtle">Thesis:</span> ${esc(i.thesis)}</p>` : ""}
    ${edit ? `<div class="row gap-8 iv-flex iv-mt"><button class="btn btn-sm" data-ivact="edit">Edit</button><button class="btn btn-sm" data-ivact="link-for" data-id="${esc(i.id)}">Share the data room…</button><button class="btn btn-sm btn-ghost btn-danger" data-ivact="inv-del">Delete</button></div>` : ""}</section>
    <section class="card card-pad"><h3 class="s-small iv-h3">Notes</h3>${edit ? `<form id="ivNoteForm" class="row gap-8 iv-flex"><textarea class="input iv-ta" id="ivn-text" rows="2" dir="auto" placeholder="What was said, what you promised" aria-label="New note"></textarea><button class="btn btn-sm btn-primary" type="submit">Add note</button></form>` : ""}
      <ul class="iv-ul">${(i.notes || []).slice().reverse().map((n) => `<li class="iv-li s-small"><span dir="auto" class="iv-pre">${esc(n.text)}</span><span class="subtle">${esc(n.by)} · ${esc(ivWhen(n.at))}</span></li>`).join("") || `<li class="subtle s-small iv-li">No notes yet.</li>`}</ul></section>
    <section class="card card-pad"><h3 class="s-small iv-h3">Meetings and documents</h3><ul class="iv-ul">${i.meetings.map((x) => `<li class="iv-li s-small"><span dir="auto">${esc(x.title)}</span><span class="subtle num">${esc(x.date)}</span></li>`).join("")}
      ${i.documents.map((x) => `<li class="iv-li s-small"><span dir="auto">${esc(x.title)}</span><span class="subtle">${esc(ivFolder(x.folder))}${x.available ? "" : " · not available"}</span></li>`).join("")}</ul>${i.meetings.length + i.documents.length ? "" : `<p class="subtle s-small">Link meetings (Meetings) and data room documents with Edit.</p>`}</section>
    <section class="card card-pad"><h3 class="s-small iv-h3">Share links</h3><ul class="iv-ul">${i.links.map((l) => `<li class="iv-li s-small"><span class="iv-url">${esc(l.url)}</span><span>${ivBadge(l.state, IV_STATE[l.state])} <span class="subtle">until ${esc(l.expires_on)} · ${l.views} view${l.views === 1 ? "" : "s"}</span></span></li>`).join("") || `<li class="subtle s-small iv-li">No links yet.</li>`}</ul></section>
    <section class="card card-pad"><h3 class="s-small iv-h3">What they looked at</h3>${ivEngTable(i.engagement, false)}</section>
    <details class="card card-pad"><summary class="s-small"><b>Change log</b> (${(i.log || []).length})</summary><ul class="iv-ul">${(i.log || []).slice().reverse().map((x) => `<li class="iv-li s-small"><span dir="auto">${esc(x.text)}</span><span class="subtle">${esc(x.by)} · ${esc(ivWhen(x.at))}</span></li>`).join("")}</ul></details></div>`;
}

/* ------------------------------------------------ round */
function ivRoundForm(r) {
  const m = IV.meta;
  return `<form class="iv-form iv-roundf" data-id="${esc(r?.id || "")}">
    <div class="field"><label>Round name<input class="input" name="name" maxlength="120" required value="${esc(r?.name || "")}" placeholder="Seed"></label></div>
    <div class="field"><label>Instrument<select class="input" name="instrument">${ivOpts(m.instruments.map((x) => [x.id, x.name]), r?.instrument || "safe")}</select></label></div>
    <div class="field"><label>Status<select class="input" name="status">${ivOpts(m.round_statuses.map((x) => [x.id, x.name]), r?.status || "planning")}</select></label></div>
    <div class="field"><label>Target (USD)<input class="input" name="target_usd" inputmode="decimal" value="${esc(r?.target_usd ?? "")}"></label></div>
    <div class="field"><label>Valuation cap (USD) <span class="subtle">[CONFIRM]</span><input class="input" name="valuation_cap_usd" inputmode="decimal" value="${esc(r?.valuation_cap_usd ?? "")}"></label></div>
    <div class="field"><label>Pre-money valuation (USD) <span class="subtle">[CONFIRM]</span><input class="input" name="pre_money_usd" inputmode="decimal" value="${esc(r?.pre_money_usd ?? "")}"></label></div>
    <div class="field"><label>Discount (%) <span class="subtle">[CONFIRM]</span><input class="input" name="discount_pct" inputmode="decimal" value="${esc(r?.discount_pct ?? "")}"></label></div>
    <div class="field"><label>Target close date<input class="input" name="close_date" type="date" value="${esc(r?.close_date || "")}"></label></div>
    <div class="field iv-wide"><label>Notes<textarea class="input iv-ta" name="notes" rows="2" dir="auto">${esc(r?.notes || "")}</textarea></label></div>
    <div class="row gap-8 iv-wide"><button class="btn btn-primary btn-sm" type="submit">${r ? "Save round" : "Add round"}</button></div></form>`;
}
function ivRounds(d) {
  const edit = ivEdit(), m = IV.meta;
  const rows = d.rounds.map((r) => `<section class="card card-pad"><div class="row between gap-8 iv-flex"><h3 class="iv-h" dir="auto">${esc(r.name)}</h3><span class="row gap-8 iv-flex">${ivBadge(m.round_statuses.find((x) => x.id === r.status)?.name || r.status)}${ivBadge(m.instruments.find((x) => x.id === r.instrument)?.name || r.instrument, "accent")}</span></div>
      <section class="s-kpis iv-mt">${ivTile("Target", ivUsd(r.target_usd), "typed by a person")}${ivTile("Committed", ivUsd(r.committed_usd), `${r.committed_count} committed investor${r.committed_count === 1 ? "" : "s"}${r.committed_missing ? ` · ${r.committed_missing} without an amount` : ""}`, r.committed_missing ? "warn" : "")}${ivTile("In play", r.in_play, "investors not committed or passed")}</section>
      <p class="s-small iv-mt">Terms: valuation cap ${ivUsd(r.valuation_cap_usd)} · pre-money ${ivUsd(r.pre_money_usd)} · discount ${r.discount_pct == null ? "–" : `${r.discount_pct}%`} ${r.terms_flag ? ivBadge("[CONFIRM]", "warn") : r.terms_confirmed ? ivBadge(`confirmed by ${r.terms_confirmed_by}`, "good") : ""}</p>
      ${r.notes ? `<p class="s-small subtle iv-pre" dir="auto">${esc(r.notes)}</p>` : ""}
      ${edit ? `<div class="row gap-8 iv-flex iv-mt">${r.terms_flag ? `<button class="btn btn-sm btn-primary" data-ivact="confirm-terms" data-id="${esc(r.id)}">Confirm the terms</button>` : ""}<button class="btn btn-sm btn-ghost btn-danger" data-ivact="round-del" data-id="${esc(r.id)}">Delete</button></div>
      <details class="iv-mt"><summary class="s-small">Edit round</summary>${ivRoundForm(r)}</details>` : ""}</section>`).join("");
  return `${ivNote("Committed is the sum of the amounts you typed on investors at the Committed stage: nothing is assumed. Valuation, cap and discount stay marked [CONFIRM] until a person confirms them (with your lawyer); changing them asks again.")}
    <div class="stack iv-stack">${edit ? `<details class="card card-pad" ${d.rounds.length ? "" : "open"}><summary><b>Add a round</b></summary>${ivRoundForm(null)}</details>` : ""}${rows || `<div class="card empty"><p>No round yet.</p></div>`}</div>`;
}

/* ------------------------------------------------ metrics pack */
function ivMetrics(d, s) {
  const edit = ivEdit();
  const rows = d.metrics.map((m) => `<tr><td>${edit ? `<input type="checkbox" class="iv-pick" value="${esc(m.id)}" checked aria-label="Include ${esc(m.name)}">` : ""}</td><td><b>${esc(m.name)}</b><br><span class="subtle s-small">${esc(m.group)}</span></td>
      <td class="num">${m.no_data ? ivBadge("No data yet") : `<b>${esc(m.display)}</b>`}${m.note ? `<br><span class="subtle s-small">${esc(m.note)}</span>` : ""}</td><td class="s-small subtle">${esc(m.source || "–")}</td><td class="num s-small iv-nw">${esc(m.as_of)}</td></tr>`).join("");
  const snaps = s.snapshots.map((x) => `<details class="card card-pad"><summary class="iv-sum"><b dir="auto">${esc(x.label)}</b> <span class="subtle s-small">frozen ${esc(x.as_of)} by ${esc(x.frozen_by)} · ${x.metrics.length} metrics</span> ${x.sample || x.includes_sample ? ivBadge("sample data", "warn") : ""}${x.in_room ? ivBadge("in the data room", "accent") : ""}</summary>
      <div class="table-wrap iv-mt"><table><thead><tr><th>Metric</th><th>Value</th><th>Source</th><th>As of</th></tr></thead><tbody>${x.metrics.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${esc(m.display)}</td><td class="s-small subtle">${esc(m.source || m.note || "–")}</td><td class="num s-small iv-nw">${esc(m.as_of)}</td></tr>`).join("")}</tbody></table></div>
      ${edit && !x.in_room ? `<button class="btn btn-sm btn-ghost btn-danger iv-mt" data-ivact="snap-del" data-id="${esc(x.id)}">Delete snapshot</button>` : ""}</details>`).join("");
  return `${ivNote("Live values read from Billing, Finance, Sales, Customer success, Product, Team &amp; hiring and AI Workforce. A metric with no data says “No data yet”: never 0 or an estimate. Freezing saves today's numbers; later changes never alter a frozen snapshot.")}
    ${d.includes_sample ? ivNote("<b>Sample data is loaded:</b> these numbers include it, and a snapshot frozen now is labelled as including sample data.") : ""}
    <div class="stack iv-stack"><section class="card"><div class="table-wrap"><table class="iv-table"><thead><tr><th><span class="iv-sr">Include</span></th><th>Metric</th><th>Value</th><th>Source</th><th>As of</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${edit ? `<form id="ivFreeze" class="row gap-8 iv-flex card-pad"><input class="input" id="ivs-label" maxlength="120" placeholder="Label, e.g. Board pack · November" aria-label="Snapshot label" dir="auto"><button class="btn btn-primary" type="submit">Freeze the ticked metrics</button></form>` : ""}</section>
    <h3 class="s-small iv-h3">Frozen snapshots</h3>${snaps || `<p class="subtle s-small">None yet.</p>`}</div>`;
}

/* ------------------------------------------------ data room */
function ivRoom(d, s, u) {
  IV.items = d.folders.flatMap((f) => f.items);
  const edit = ivEdit(), m = IV.meta, fsel = (id) => `<select class="input input-sm" name="folder" id="${id}" aria-label="Folder">${ivOpts(m.folders.map((f) => [f.id, f.name]), "company")}</select>`;
  const folders = d.folders.map((f) => `<section class="card card-pad"><h3 class="s-small iv-h3">${esc(f.name)} <span class="subtle num">${f.items.length}</span></h3><ul class="iv-ul">${f.items.map((it) => `<li class="iv-li s-small"><span class="iv-wrap"><b dir="auto">${esc(it.title)}</b> <span class="subtle">${esc(ivKind(it.kind))}${it.ext ? ` · ${esc(it.ext.toUpperCase())}` : ""}</span>${it.kind === "link" ? `<br><span class="iv-url subtle">${esc(it.url)}</span>` : ""}${it.note ? `<br><span class="subtle" dir="auto">${esc(it.note)}</span>` : ""}</span>
      <span class="row gap-8 iv-flex">${it.available ? "" : ivBadge(it.reason || "not available", "bad")}${it.restricted ? ivBadge("restricted (shared on purpose)", "warn") : ""}${it.sample ? ivBadge("sample", "warn") : ""}${edit ? `<button class="btn btn-sm btn-ghost btn-danger" data-ivact="item-del" data-id="${esc(it.id)}">Remove</button>` : ""}</span></li>`).join("") || `<li class="iv-li subtle s-small">Empty</li>`}</ul></section>`).join("");
  const docs = m.legal_documents.filter((x) => x.has_file);
  const add = edit ? `<details class="card card-pad" ${d.total ? "" : "open"}><summary><b>Add to the data room</b></summary><div class="iv-adds">
    <form class="iv-add iv-form1" data-kind="legal_doc"><b class="s-small">Legal document</b>${m.me.legal ? `<select class="input input-sm" name="ref_id" aria-label="Document">${ivOpts(docs.map((x) => [x.id, `${x.title}${x.restricted ? " (restricted)" : ""}`]), "", docs.length ? "Pick a document" : "No documents with a file")}</select>
      ${m.me.restricted ? `<label class="chip"><input type="checkbox" name="share_restricted"> Share restricted (only if you mean to)</label>` : ""}` : `<p class="subtle s-small">Needs View on Legal &amp; documents.</p>`}${fsel("iva-f1")}<button class="btn btn-sm" type="submit">Add</button></form>
    <form class="iv-add iv-form1" data-kind="snapshot"><b class="s-small">Metrics snapshot</b><select class="input input-sm" name="ref_id" aria-label="Snapshot">${ivOpts(s.snapshots.map((x) => [x.id, `${x.label} (${x.as_of})`]), "", s.snapshots.length ? "Pick a snapshot" : "Freeze one in Metrics pack")}</select>${fsel("iva-f2")}<button class="btn btn-sm" type="submit">Add</button></form>
    <form class="iv-add iv-form1" data-kind="update"><b class="s-small">Approved investor update</b><select class="input input-sm" name="ref_id" aria-label="Update">${ivOpts(u.updates.filter((x) => x.status === "approved").map((x) => [x.id, x.month]), "", "Pick an approved update")}</select>${fsel("iva-f3")}<button class="btn btn-sm" type="submit">Add</button></form>
    <form class="iv-add iv-form1" data-kind="link"><b class="s-small">Link</b><input class="input input-sm" name="title" maxlength="160" placeholder="Title" aria-label="Link title" dir="auto"><input class="input input-sm" name="url" type="url" placeholder="https://" aria-label="Link URL">${fsel("iva-f4")}<button class="btn btn-sm" type="submit">Add</button></form>
    <form class="iv-add iv-form1" id="ivUpload"><b class="s-small">Upload a file</b><input class="input input-sm" type="file" name="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt" aria-label="File"><input class="input input-sm" name="title" maxlength="160" placeholder="Title (optional)" aria-label="File title" dir="auto">${fsel("iva-f5")}<button class="btn btn-sm" type="submit">Upload</button><span class="hint">PDF, Word, PNG, JPEG or text, up to 20 MB. Stored privately (never a public link).</span></form>
  </div></details>` : "";
  return `${ivNote("Investors see only the folders and items on their own share link, each page watermarked “Shared with &lt;investor&gt; · &lt;date&gt;”. Restricted Legal documents go in only when an Owner or Admin ticks “share restricted”. Files are never changed.")}<div class="stack iv-stack">${add}<div class="iv-folders">${folders}</div></div>`;
}

/* ------------------------------------------------ share links */
function ivLinks(d, inv, room) {
  IV.items = room.folders.flatMap((f) => f.items);
  const edit = ivEdit(), m = IV.meta, pre = IV.linkFor;
  const form = edit ? `<details class="card card-pad" ${pre || !d.links.length ? "open" : ""}><summary><b>New share link</b></summary><form id="ivLinkForm" class="iv-form iv-mt">
    <div class="field"><label for="ivl-inv">Investor</label><select class="input" id="ivl-inv" required>${ivOpts(inv.investors.map((i) => [i.id, i.name]), pre || "", "Pick an investor")}</select></div>
    <div class="field"><label for="ivl-exp">Expires on (Riyadh)</label><input class="input" id="ivl-exp" type="date" required min="${esc(m.today)}" max="${esc(ivAddDays(m.today, 365))}" value="${esc(ivAddDays(m.today, 14))}"></div>
    <div class="field"><label for="ivl-pass">Passcode (optional)</label><input class="input" id="ivl-pass" type="text" autocomplete="off" minlength="4" maxlength="64" placeholder="Send it separately"><span class="hint">Stored only as a hash: note it now.</span></div>
    <div class="field"><label for="ivl-label">Label (optional)</label><input class="input" id="ivl-label" maxlength="120" dir="auto"></div>
    <fieldset class="field iv-wide iv-fs"><legend class="s-small">Folders</legend>${m.folders.map((f) => `<label class="chip"><input type="checkbox" data-ivfolder="${esc(f.id)}"> ${esc(f.name)}</label>`).join("")}</fieldset>
    <div class="field iv-wide"><label for="ivl-items">Or single items</label><select class="input iv-multi" id="ivl-items" multiple size="4">${IV.items.map((x) => `<option value="${esc(x.id)}">${esc(`${ivFolder(x.folder)} · ${x.title}`)}</option>`).join("")}</select></div>
    <label class="chip iv-wide"><input type="checkbox" id="ivl-dl"> Allow downloads (otherwise view only: PDF, images and text open in the browser)</label>
    <div class="row gap-8 iv-wide"><button class="btn btn-primary" type="submit">Create link</button></div></form></details>` : "";
  const rows = d.links.map((l) => `<li class="card card-pad iv-linkrow"><div class="row between gap-8 iv-flex"><b dir="auto">${esc(l.investor_name)}${l.label ? ` · ${esc(l.label)}` : ""}</b><span class="row gap-8 iv-flex">${ivBadge(l.state, IV_STATE[l.state])}${l.state === "active" && l.days_left <= 3 ? ivBadge(`${l.days_left} day${l.days_left === 1 ? "" : "s"} left`, "warn") : ""}${l.has_passcode ? ivBadge("passcode") : ""}${ivBadge(l.download ? "downloads allowed" : "view only")}${l.sample ? ivBadge("sample", "warn") : ""}</span></div>
      <p class="iv-url s-small">${esc(l.url)}</p><p class="subtle s-small iv-m0">Until ${esc(l.expires_on)} · ${l.items_shared} item${l.items_shared === 1 ? "" : "s"}${l.folders.length ? ` (${esc(l.folders.map(ivFolder).join(", "))})` : ""} · ${l.views} view${l.views === 1 ? "" : "s"}${l.last_view_at ? ` · last ${esc(ivWhen(l.last_view_at))}` : ""} · by ${esc(l.created_by)}${l.revoked_at ? ` · revoked by ${esc(l.revoked_by)}` : ""}</p>
      ${l.state === "revoked" ? "" : `<div class="row gap-8 iv-flex iv-mt"><button class="btn btn-sm" data-ivact="copy" data-text="${esc(l.url)}">Copy link</button>${edit ? `<form class="row gap-8 iv-extend" data-id="${esc(l.id)}"><input class="input input-sm" type="date" name="expires_on" value="${esc(l.expires_on)}" min="${esc(m.today)}" aria-label="New expiry date"><button class="btn btn-sm" type="submit">Change expiry</button></form><button class="btn btn-sm" data-ivact="toggle-dl" data-id="${esc(l.id)}" data-on="${l.download ? "0" : "1"}">${l.download ? "Make view only" : "Allow downloads"}</button><button class="btn btn-sm btn-ghost btn-danger" data-ivact="revoke" data-id="${esc(l.id)}">Revoke</button>` : ""}</div>`}</li>`).join("");
  return `${ivNote("One link per investor: it expires, can have a passcode, shows only what you pick, and can be revoked at any time. Every view and download is logged (investor, item, time, a hashed IP and the browser type only). Creating, changing and revoking links is in the activity log.")}
    <div class="stack iv-stack">${form}${rows ? `<ul class="stack iv-ul0">${rows}</ul>` : `<div class="card empty"><p>No share links yet.</p></div>`}</div>`;
}

/* ------------------------------------------------ engagement */
function ivEngTable(rows, withInvestor = true) {
  if (!rows.length) return `<p class="subtle s-small">No views yet.</p>`;
  return `<div class="table-wrap"><table><thead><tr>${withInvestor ? "<th>Investor</th>" : ""}<th>Item</th><th>Views</th><th>Opens</th><th>Downloads</th><th>First</th><th>Last</th></tr></thead><tbody>${rows.map((r) => `<tr>${withInvestor ? `<td dir="auto">${esc(r.investor_name)}</td>` : ""}<td dir="auto">${esc(r.item_title)}</td><td class="num">${r.views}</td><td class="num">${r.opens}</td><td class="num">${r.downloads}</td><td class="num s-small">${esc(ivWhen(r.first_at))}</td><td class="num s-small">${esc(ivWhen(r.last_at))}</td></tr>`).join("")}</tbody></table></div>`;
}
function ivEngagement(d) {
  const per = d.investors.map((x) => `<tr><td dir="auto"><button class="iv-link" data-ivact="open-inv" data-id="${esc(x.investor_id)}">${esc(x.investor_name)}</button></td><td class="num">${x.views}</td><td class="num">${x.items_viewed}</td><td class="num">${x.downloads}</td><td class="num s-small">${esc(ivWhen(x.first_at))}</td><td class="num s-small">${esc(ivWhen(x.last_at))}</td></tr>`).join("");
  return `<div class="stack iv-stack"><section class="card card-pad"><h3 class="s-small iv-h3">By investor</h3>${per ? `<div class="table-wrap"><table><thead><tr><th>Investor</th><th>Views</th><th>Items viewed</th><th>Downloads</th><th>First view</th><th>Last view</th></tr></thead><tbody>${per}</tbody></table></div>` : `<p class="subtle s-small">Nobody has opened a share link yet.</p>`}</section>
    <section class="card card-pad"><h3 class="s-small iv-h3">By item</h3>${ivEngTable(d.items)}</section>
    <section class="card card-pad"><h3 class="s-small iv-h3">Latest views</h3><ul class="iv-ul">${d.recent.map((v) => `<li class="iv-li s-small"><span dir="auto">${esc(v.investor_name)} · ${esc(v.action)} · ${esc(v.item_title)}</span><span class="subtle">${esc(ivWhen(v.at))} · ${esc(v.ua)}</span></li>`).join("") || `<li class="iv-li subtle s-small">None yet.</li>`}</ul></section></div>`;
}

/* ------------------------------------------------ monthly update */
function ivUpdates(d, s) {
  const edit = ivEdit(), month = IV.meta.today.slice(0, 7);
  const rows = d.updates.map((u) => `<button class="card iv-row" data-ivact="open-upd" data-id="${esc(u.id)}"><span><b>${esc(u.month)}</b> <span class="subtle s-small">from “${esc(u.snapshot_label)}”</span></span><span class="row gap-8 iv-flex">${ivBadge(u.status, u.status === "approved" ? "good" : "")}${u.by_ai ? ivBadge("AI draft", "accent") : ivBadge("factual draft")}${u.has_add ? ivBadge("[ADD] left", "warn") : ""}${u.in_room ? ivBadge("in the data room", "accent") : ""}${u.sample ? ivBadge("sample", "warn") : ""}</span></button>`).join("");
  return `${ivNote(`The AI Investor relations agent${d.agent_level === 0 ? " is switched off in AI Workforce: you get the factual draft" : " drafts the highlights and asks"} from a frozen snapshot, the month's goals and weekly reviews, changelog entries, releases, hires and open roles, citing a source for every bullet. A number that isn't in its sources means the factual draft instead. You write the lowlights; a person approves. Sending: copy it, download it or open it in your email app (there is no investor email channel in the dashboard).`)}
    <div class="stack iv-stack">${edit ? `<form id="ivUpdForm" class="card card-pad row gap-8 iv-flex"><label class="field">Month<input class="input input-sm" id="ivu-month" type="month" value="${esc(month)}" required></label><label class="field">Snapshot<select class="input input-sm" id="ivu-snap" required>${ivOpts(s.snapshots.map((x) => [x.id, `${x.label} (${x.as_of})`]), s.snapshots[0]?.id || "", s.snapshots.length ? undefined : "Freeze one in Metrics pack first")}</select></label><button class="btn btn-primary btn-sm iv-self-end" type="submit">Draft the update</button></form>` : ""}
    ${rows ? `<div class="stack iv-gap8">${rows}</div>` : `<div class="card empty"><p>No investor updates yet.</p></div>`}</div>`;
}
function ivUpdate(u) {
  const edit = ivEdit() && u.status === "draft";
  const mail = `mailto:?subject=${encodeURIComponent(`${S.ws.brief.company_name} · Investor update · ${u.month}`)}&body=${encodeURIComponent(u.clean_text.slice(0, 1800))}`;
  return `<div class="stack iv-stack"><section class="card card-pad"><button class="iv-link s-small" data-ivact="back-upd">← All updates</button>
    <div class="row between gap-8 iv-flex"><h2 class="iv-h">Investor update · ${esc(u.month)}</h2><span class="row gap-8 iv-flex">${ivBadge(u.status, u.status === "approved" ? "good" : "")}${u.by_ai ? ivBadge("AI draft", "accent") : ivBadge("factual draft")}${u.sample ? ivBadge("sample", "warn") : ""}</span></div>
    <p class="subtle s-small iv-m0">From the snapshot “${esc(u.snapshot_label)}” · drafted ${esc(ivWhen(u.generated_at))} by ${esc(u.generated_by)}${u.approved_by ? ` · approved by ${esc(u.approved_by)} ${esc(ivWhen(u.approved_at))}` : ""}</p>
    ${u.note ? `<p class="iv-warn s-small">${esc(u.note)}</p>` : ""}
    <div class="row gap-8 iv-flex iv-mt">${edit ? `<button class="btn btn-sm btn-primary" data-ivact="approve" ${u.has_add ? 'disabled title="Fill in every [ADD] first"' : ""}>Approve</button><button class="btn btn-sm btn-ghost btn-danger" data-ivact="upd-del">Discard</button>` : ""}
      ${u.status === "approved" ? `<button class="btn btn-sm" data-ivact="copy" data-text="${esc(u.clean_text)}">Copy</button><a class="btn btn-sm" href="${ivP()}/updates/${esc(u.id)}/download">Download .md</a><a class="btn btn-sm" href="${esc(mail)}">Open in email</a>${ivEdit() && !u.in_room ? `<button class="btn btn-sm" data-ivact="share-upd">Add to the data room</button>` : ""}` : ""}</div></section>
    <div class="iv-two">${edit ? `<section class="card card-pad"><form id="ivUpdText"><label class="s-small" for="ivu-text"><b>Text</b> (Markdown; [S1]-style references are removed when shared)</label><textarea class="input iv-ta iv-big" id="ivu-text" rows="22" dir="auto">${esc(u.text)}</textarea><div class="row gap-8 iv-mt"><button class="btn btn-sm btn-primary" type="submit">Save</button></div></form></section>` : ""}
      <section class="card card-pad"><h3 class="s-small iv-h3">${edit ? "Preview" : "Text"}</h3><div class="doc iv-doc" dir="auto">${md(edit ? u.text : u.clean_text)}</div></section></div>
    <details class="card card-pad"><summary class="s-small"><b>Sources</b> (${u.sources.length})</summary><ul class="iv-ul">${u.sources.map((x) => `<li class="iv-li s-small"><span><b>[${esc(x.ref)}]</b> <span dir="auto">${esc(x.text)}</span></span></li>`).join("") || `<li class="iv-li subtle s-small">No sources this month.</li>`}</ul></details></div>`;
}

/* ------------------------------------------------ actions */
const ivMoney = (v) => (v.trim() === "" ? null : v.trim());
function ivReadInv() {
  const b = { name: ivVal("#ivf-name"), firm: ivVal("#ivf-firm"), kind: ivVal("#ivf-kind"), stage: ivVal("#ivf-stage"), check_min_usd: ivMoney(ivVal("#ivf-min")), check_max_usd: ivMoney(ivVal("#ivf-max")), committed_usd: ivMoney(ivVal("#ivf-com")),
    round_id: ivVal("#ivf-round") || null, owner_id: ivVal("#ivf-owner") || null, contact: { name: ivVal("#ivf-cname"), email: ivVal("#ivf-cemail"), phone: ivVal("#ivf-cphone") }, thesis: ivVal("#ivf-thesis"), intro_path: ivVal("#ivf-intro"), next_step: ivVal("#ivf-next"), next_step_date: ivVal("#ivf-nextd") || null };
  if ($("#ivf-meet")) b.meeting_ids = [...$("#ivf-meet").selectedOptions].map((o) => o.value);
  if ($("#ivf-docs")) b.document_ids = [...$("#ivf-docs").selectedOptions].map((o) => o.value);
  return b;
}
async function ivCopy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy: select the text and copy it by hand", true); } }
async function ivAct(a, el) {
  const id = el.dataset.id;
  if (a === "open" || a === "open-inv") { IV.editing = false; go("investors", id); return; }
  if (a === "back") { IV.open = null; IV.editing = false; go("investors", "pipeline"); return; }
  if (a === "edit") { IV.editing = true; if (!IV.rounds) IV.rounds = (await api(`${ivP()}/rounds`)).rounds; IV.items = (await api(`${ivP()}/room`)).folders.flatMap((f) => f.items); return ivShow(); }
  if (a === "cancel-edit") { IV.editing = false; return ivShow(); }
  if (a === "inv-del") { if (!confirm("Delete this investor, its share links and its view log?")) return; await ivDel(`/investors/${IV.open}`); toast("Deleted"); IV.open = null; go("investors", "pipeline"); return; }
  if (a === "link-for") { IV.linkFor = id; IV.open = null; go("investors", "links"); return; }
  if (a === "confirm-terms") { if (!confirm("Confirm these terms? Do it only once the founder (and lawyer) have checked them.")) return; await ivPost(`/rounds/${id}/confirm-terms`); toast("Terms confirmed"); return ivShow(); }
  if (a === "round-del") { if (!confirm("Delete this round? Investors are kept and unlinked.")) return; await ivDel(`/rounds/${id}`); toast("Deleted"); return ivShow(); }
  if (a === "snap-del") { if (!confirm("Delete this snapshot?")) return; await ivDel(`/snapshots/${id}`); toast("Deleted"); return ivShow(); }
  if (a === "item-del") { if (!confirm("Remove this from the data room? Links stop showing it.")) return; await ivDel(`/room/items/${id}`); toast("Removed"); return ivShow(); }
  if (a === "copy") return ivCopy(el.dataset.text);
  if (a === "toggle-dl") { await ivPut(`/links/${id}`, { download: el.dataset.on === "1" }); toast("Saved"); return ivShow(); }
  if (a === "revoke") { if (!confirm("Revoke this link? It stops working at once.")) return; await ivPost(`/links/${id}/revoke`); toast("Revoked"); return ivShow(); }
  if (a === "open-upd") { IV.upd = id; return ivShow(); }
  if (a === "back-upd") { IV.upd = null; return ivShow(); }
  if (a === "approve") { await ivPost(`/updates/${IV.upd}/approve`); toast("Approved"); return ivShow(); }
  if (a === "upd-del") { if (!confirm("Discard this draft?")) return; await ivDel(`/updates/${IV.upd}`); IV.upd = null; toast("Discarded"); return ivShow(); }
  if (a === "share-upd") { await ivPost(`/updates/${IV.upd}/share`, { folder: "company" }); toast("Added to the data room (Company)"); return ivShow(); }
}
document.addEventListener("click", async (e) => {
  if (S.route !== "investors") return;
  const t = e.target.closest("[data-ivtab]");
  if (t) { IV.tab = t.dataset.ivtab; IV.open = null; IV.upd = null; IV.editing = false; if (IV.tab !== "links") IV.linkFor = null; go("investors", IV.tab); return; }
  const b = e.target.closest("[data-ivact]");
  if (b) { e.preventDefault(); try { await ivAct(b.dataset.ivact, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "investors") return;
  const f = e.target;
  if (!f.matches("#ivInvForm, #ivNoteForm, .iv-roundf, #ivFreeze, .iv-add, #ivLinkForm, .iv-extend, #ivUpdForm, #ivUpdText")) return;
  e.preventDefault();
  try {
    if (f.id === "ivInvForm") {
      const body = ivReadInv();
      if (f.dataset.id) { await ivPut(`/investors/${f.dataset.id}`, body); IV.editing = false; toast("Saved"); await ivShow(); }
      else { const x = await ivPost("/investors", body); toast("Investor added"); go("investors", x.id); }
    }
    if (f.id === "ivNoteForm") { await ivPost(`/investors/${IV.open}/notes`, { text: ivVal("#ivn-text") }); toast("Note added"); await ivShow(); }
    if (f.matches(".iv-roundf")) {
      const b = Object.fromEntries(["name", "instrument", "status", "target_usd", "valuation_cap_usd", "pre_money_usd", "discount_pct", "close_date", "notes"].map((k) => [k, f.elements[k].value]));
      for (const k of ["target_usd", "valuation_cap_usd", "pre_money_usd", "discount_pct"]) b[k] = ivMoney(b[k]);
      if (f.dataset.id) await ivPut(`/rounds/${f.dataset.id}`, b); else await ivPost("/rounds", b);
      toast("Round saved"); await ivShow();
    }
    if (f.id === "ivFreeze") {
      const ids = [...document.querySelectorAll(".iv-pick:checked")].map((x) => x.value);
      const s = await ivPost("/snapshots", { label: ivVal("#ivs-label"), metric_ids: ids });
      toast(`Frozen: ${s.label}`); await ivShow();
    }
    if (f.id === "ivUpload") {
      const file = f.elements.file.files[0]; if (!file) return toast("Pick a file first", true);
      const q = new URLSearchParams({ folder: f.elements.folder.value, filename: file.name, title: f.elements.title.value });
      const res = await fetch(`${ivP()}/room/files?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).detail || msg; } catch {} throw new Error(msg); }
      toast("Uploaded"); await ivShow();
    } else if (f.matches(".iv-add")) {
      const b = { kind: f.dataset.kind, folder: f.elements.folder.value };
      for (const k of ["ref_id", "title", "url"]) if (f.elements[k]) b[k] = f.elements[k].value;
      if (f.elements.share_restricted) b.share_restricted = f.elements.share_restricted.checked;
      await ivPost("/room/items", b); toast("Added to the data room"); await ivShow();
    }
    if (f.id === "ivLinkForm") {
      const b = { investor_id: ivVal("#ivl-inv"), expires_on: ivVal("#ivl-exp"), passcode: ivVal("#ivl-pass"), label: ivVal("#ivl-label"), download: !!$("#ivl-dl")?.checked,
        folders: [...document.querySelectorAll("[data-ivfolder]:checked")].map((x) => x.dataset.ivfolder), item_ids: [...($("#ivl-items")?.selectedOptions || [])].map((o) => o.value) };
      const l = await ivPost("/links", b); IV.linkFor = null;
      await ivCopy(l.url); toast("Link created and copied"); await ivShow();
    }
    if (f.matches(".iv-extend")) { await ivPut(`/links/${f.dataset.id}`, { expires_on: f.elements.expires_on.value }); toast("Expiry changed"); await ivShow(); }
    if (f.id === "ivUpdForm") {
      const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Drafting…";
      try { const u = await ivPost("/updates", { month: ivVal("#ivu-month"), snapshot_id: ivVal("#ivu-snap") }); toast(u.by_ai ? "AI draft ready: check every line" : "Factual draft ready: fill in every [ADD]"); IV.upd = u.id; await ivShow(); }
      finally { btn.disabled = false; btn.textContent = "Draft the update"; }
    }
    if (f.id === "ivUpdText") { await ivPut(`/updates/${IV.upd}`, { text: ivVal("#ivu-text") }); toast("Saved"); await ivShow(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "investors" && S.ws) render();
