/* Meetings → tasks: meetings (Riyadh date and time, type, attendees, links to a deal, store, customer or candidate),
   notes in (paste, or a .txt/.vtt/.srt/.docx file; no audio transcription on the server), the AI Meeting secretary's
   draft (summary, decisions, open questions, action items), review then create (each ticked item goes to its home
   module), the follow-up email for outside attendees (drafted only; sent through the Store CRM), and My action items.
   Uses app.js globals (S, $, api, esc, toast, ROUTES, levelFor, go). Names start with "mt". */

const MT = { tab: "list", meta: null, list: null, open: null, mine: null, editing: false, adding: false, storeHits: null };
const MT_TABS = [["list", "Meetings"], ["mine", "My action items"]];
const MT_STATE = { draft: ["To review", "warn"], created: ["Created", "good"], skipped: ["Skipped", ""] };
const mtP = () => `/api/workspaces/${S.ws.id}/meetings`;
const mtEdit = () => levelFor("meetings") === "edit";
const mtPost = (p, b) => api(`${mtP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const mtPut = (p, b) => api(`${mtP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const mtOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const mtType = (id) => MT.meta?.types.find((t) => t.id === id)?.name || id;
const mtBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;

ROUTES.meetings = { title: "Meetings", crumb: "Run the company", render: renderMeetings };

async function renderMeetings(view) {
  if (S.param === "mine" || S.param === "list") { MT.tab = S.param; MT.open = null; }
  else if (S.param && /^\d+$/.test(S.param)) { MT.tab = "list"; MT.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs mt-tabs" role="tablist" aria-label="Meetings views">${MT_TABS.map(([k, l]) => `<button role="tab" data-mttab="${k}" aria-selected="${MT.tab === k}">${l}</button>`).join("")}</div>
    <div id="mtBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { MT.meta = await api(`${mtP()}/meta`); } catch (e) { $("#mtBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await mtShow();
}
async function mtShow() {
  if (S.route !== "meetings") return;
  document.querySelectorAll("[data-mttab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.mttab === MT.tab));
  const box = $("#mtBody"); if (!box) return;
  try {
    if (MT.tab === "mine") { MT.mine = await api(`${mtP()}/my-items`); box.innerHTML = mtMine(); return; }
    if (MT.open) { const m = await api(`${mtP()}/${MT.open}`).catch(() => null); if (m) { MT.cur = m; box.innerHTML = mtDetail(m); return; } MT.open = null; }
    MT.list = await api(mtP()); box.innerHTML = mtList();
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ list + new meeting */
function mtList() {
  const d = MT.list, list = d.meetings, today = d.today;
  const waiting = list.filter((m) => m.waiting_review).length, toReview = list.filter((m) => m.draft_status === "draft").length;
  const tiles = [["Meetings", `${list.length}`, "you can see", ""], ["Upcoming", `${list.filter((m) => m.date >= today).length}`, "today and later", ""],
    ["Drafts to review", `${toReview}`, "action items waiting for a person", toReview ? "warn" : ""], ["Notes waiting 2+ days", `${waiting}`, "notes in, items not reviewed", waiting ? "warn" : ""]];
  const add = mtEdit() ? `<details class="card card-pad mt-new" ${list.length ? "" : "open"} ${MT.adding ? "open" : ""}><summary><b>New meeting</b></summary>${mtForm(null)}</details>` : "";
  const rows = list.length ? `<div class="table-wrap"><table class="f-table mt-table"><thead><tr><th>Meeting</th><th>When (Riyadh)</th><th>Type</th><th>Attendees</th><th>Notes and items</th></tr></thead><tbody>
    ${list.map((m) => `<tr><td><button class="mt-link" data-mtact="open" data-id="${esc(m.id)}" dir="auto">${esc(m.title)}</button>${m.sample ? ` ${mtBadge("sample", "warn")}` : ""}</td>
      <td class="num">${esc(m.date)} ${esc(m.time)}</td><td>${esc(mtType(m.type))}${m.restricted ? ` ${mtBadge("private")}` : ""}</td>
      <td class="s-small" dir="auto">${esc(m.attendees.slice(0, 3).join(", "))}${m.attendees.length > 3 ? ` +${m.attendees.length - 3}` : ""}</td>
      <td>${!m.has_notes ? `<span class="subtle s-small">No notes yet</span>` : m.draft_status === "reviewed" ? mtBadge("Reviewed", "good") : m.draft_status === "draft" ? mtBadge(`${m.draft_items} to review`, "warn") : mtBadge("Notes in", "accent")}${m.waiting_review ? ` ${mtBadge("waiting 2+ days", "bad")}` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><p>No meetings yet. Add one, paste the notes or transcript, and the AI Meeting secretary drafts the action items for you to review.</p></div>`;
  return `<section class="s-kpis">${tiles.map(([l, v, sub, tone]) => `<div class="card s-kpi ${tone}"><span class="eyebrow">${l}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`).join("")}</section>
    <div class="stack" style="gap:16px;margin-top:16px">${add}${rows}</div>`;
}
function mtAttRows(list) {
  const ppl = MT.meta.people;
  const users = list.filter((a) => a.kind === "user").map((a) => a.user_id), ext = list.filter((a) => a.kind === "external");
  return `<fieldset class="mt-fs mt-wide"><legend>Team attendees</legend><div class="mt-chips">${ppl.map((p) => `<label class="chip"><input type="checkbox" name="mt-user" value="${esc(p.id)}" ${users.includes(p.id) ? "checked" : ""}>${esc(p.name)}</label>`).join("")}</div></fieldset>
    <div class="field mt-wide"><label for="mtf-ext">Outside attendees</label><textarea class="input" id="mtf-ext" rows="2" dir="auto" placeholder="One per line: Name, email, organisation (email and organisation optional)">${esc(ext.map((a) => [a.name, a.email, a.org].filter(Boolean).join(", ")).join("\n"))}</textarea><span class="hint">Emails are used for the follow-up and data requests. Investor and hiring meetings are seen only by Owner/Admin, attendees and you.</span></div>`;
}
function mtForm(m) {
  const meta = MT.meta, o = meta.options, l = m?.links || {}, li = m?.link_info || {};
  const linkSel = (key, label, list, hint) => list ? `<div class="field"><label for="mtf-${key}">${label}</label><select class="input" id="mtf-${key}">${mtOpts(list.map((x) => [x.id, x.label]), l[key], "–")}</select>${hint ? `<span class="hint">${hint}</span>` : ""}</div>` : "";
  const storeLbl = li.store?.label || "";
  return `<form id="mtForm" class="mt-form" data-id="${esc(m?.id || "")}" style="margin-top:12px">
    <div class="field mt-wide"><label for="mtf-title">Title</label><input class="input" id="mtf-title" required maxlength="200" dir="auto" value="${esc(m?.title || "")}" placeholder="e.g. Demo call with Oud Anfas"></div>
    <div class="field"><label for="mtf-date">Date (Riyadh)</label><input class="input" type="date" id="mtf-date" required value="${esc(m?.date || meta.today)}"></div>
    <div class="field"><label for="mtf-time">Time (Riyadh)</label><input class="input" type="time" id="mtf-time" value="${esc(m?.time || "10:00")}"></div>
    <div class="field"><label for="mtf-type">Type</label><select class="input" id="mtf-type">${mtOpts(meta.types.map((t) => [t.id, t.name]), m?.type || "internal")}</select></div>
    <div class="field"><label for="mtf-dur">Minutes</label><input class="input" type="number" min="5" max="600" id="mtf-dur" value="${esc(m?.duration_min || 30)}"></div>
    ${mtAttRows(m?.attendees || [])}
    ${linkSel("deal_id", "Sales deal", o.deals)}
    ${o.stores ? `<div class="field"><label for="mtf-storeq">Store CRM store</label><div class="row gap-8"><input class="input" id="mtf-storeq" placeholder="Search name or link" value="${esc(storeLbl)}" autocomplete="off"><input type="hidden" id="mtf-store_id" value="${esc(l.store_id || "")}"></div><div id="mtStoreHits" class="mt-hits"></div></div>` : ""}
    ${linkSel("customer_id", "Billing / Success customer", o.customers)}
    ${linkSel("candidate_id", "Hiring candidate", o.candidates)}
    <div class="field mt-wide"><label for="mtf-agenda">Agenda</label><textarea class="input" id="mtf-agenda" rows="2" maxlength="4000" dir="auto">${esc(m?.agenda || "")}</textarea></div>
    <div class="row gap-8 mt-wide"><button class="btn btn-primary" type="submit">${m ? "Save" : "Add meeting"}</button>${m ? `<button class="btn" type="button" data-mtact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}
function mtReadForm() {
  const v = (s) => $(s)?.value ?? "";
  const attendees = [...document.querySelectorAll('input[name="mt-user"]:checked')].map((i) => ({ user_id: i.value }));
  for (const line of v("#mtf-ext").split("\n").map((x) => x.trim()).filter(Boolean)) {
    const [name, email, ...org] = line.split(",").map((x) => x.trim());
    attendees.push(/@/.test(name) && !email ? { name: "", email: name } : { name, email: email || "", org: org.join(", ") });
  }
  const links = {};
  for (const k of ["deal_id", "customer_id", "candidate_id"]) if ($(`#mtf-${k}`)) links[k] = v(`#mtf-${k}`) || null;
  if ($("#mtf-store_id")) links.store_id = v("#mtf-storeq").trim() ? v("#mtf-store_id") || null : null;
  return { title: v("#mtf-title"), date: v("#mtf-date"), time: v("#mtf-time"), type: v("#mtf-type"), duration_min: Number(v("#mtf-dur") || 30), agenda: v("#mtf-agenda"), attendees, links };
}

/* ------------------------------------------------ one meeting */
function mtDetail(m) {
  const edit = m.can_edit && mtEdit();
  const li = m.link_info, links = [["deal", "Deal"], ["store", "Store"], ["customer", "Customer"], ["candidate", "Candidate"]].filter(([k]) => li[k]).map(([k, l]) => {
    const x = li[k]; return `<span>${l}: ${x.hidden ? `<span class="subtle">hidden for your role</span>` : x.missing ? `<span class="subtle">${esc(x.label)}</span>` : `<a href="#/${S.ws.id}/${x.route}" dir="auto">${esc(x.label)}</a>`}</span>`;
  }).join("");
  const head = MT.editing && edit ? `<section class="card card-pad">${mtForm(m)}</section>` : `<section class="card card-pad mt-head">
    <div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:0"><button class="mt-link s-small" data-mtact="back">← All meetings</button>
      <h2 style="margin:6px 0 0" dir="auto">${esc(m.title)}</h2>
      <div class="mt-meta subtle s-small"><span class="num">${esc(m.date)} ${esc(m.time)} Riyadh · ${esc(m.duration_min)} min</span><span>${esc(mtType(m.type))}</span>${m.restricted ? mtBadge("Private: Owner/Admin and attendees") : ""}${m.sample ? mtBadge("sample", "warn") : ""}</div>
      <div class="mt-meta s-small"><span>Attendees: <span dir="auto">${esc(m.attendees.map((a) => a.name + (a.kind === "external" && a.org ? ` (${a.org})` : "")).join(", ") || "–")}</span></span>${links}</div>
      ${m.agenda ? `<p class="s-small mt-text" dir="auto"><b>Agenda:</b> ${esc(m.agenda)}</p>` : ""}</div>
      ${edit ? `<div class="row gap-8"><button class="btn btn-sm" data-mtact="edit">Edit</button><button class="btn btn-sm btn-ghost btn-danger" data-mtact="delete">Delete</button></div>` : ""}</div></section>`;
  return `<div class="stack" style="gap:16px">${head}${mtNotes(m, edit)}${m.notes ? mtDraft(m, edit) : ""}${m.items.length ? mtCreated(m) : ""}${m.external && m.draft ? mtFollow(m, edit) : ""}</div>`;
}
function mtNotes(m, edit) {
  const meta = MT.meta;
  const src = m.notes_source?.startsWith("file:") ? `from ${m.notes_source.slice(5)}` : m.notes_source === "assistant" ? "via Ask DPA AD" : "pasted";
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Notes or transcript</h3>${m.notes ? `<span class="subtle s-small">${esc((m.notes.length / 1000).toFixed(1))} KB · ${esc(src)}${m.notes_at ? ` · ${esc(m.notes_at.slice(0, 10))}` : ""}</span>` : ""}</div>
    ${edit ? `<form id="mtNotesForm" style="margin-top:10px"><textarea class="input mt-notes" id="mt-notes" dir="auto" maxlength="${meta.notes_max}" placeholder="Paste the notes or the transcript. Lines like &quot;Action: …&quot;, &quot;TODO …&quot;, &quot;- [ ] …&quot;, &quot;المطلوب: …&quot; or &quot;سوف …&quot; become action items even without AI.">${esc(m.notes || "")}</textarea>
      <div class="row gap-8 mt-noterow"><button class="btn btn-primary btn-sm" type="submit">Save notes</button>
      <label class="btn btn-sm mt-file">Upload .txt, .vtt, .srt or .docx<input type="file" id="mt-file" accept=".txt,.vtt,.srt,.docx,.md,text/plain,text/vtt" hidden></label>
      <span class="subtle s-small">No audio transcription on this server: export the transcript from Zoom, Meet or Teams (.vtt) and upload it. Up to ${meta.notes_max / 1000} KB of text.</span></div></form>`
      : m.notes ? `<pre class="mt-pre" dir="auto">${esc(m.notes)}</pre>` : `<p class="muted s-small">No notes yet.</p>`}</section>`;
}
function mtDraft(m, edit) {
  const d = m.draft, meta = MT.meta;
  if (!d) return `<section class="card card-pad"><h3 style="margin:0">Action items</h3><p class="muted s-small">The AI Meeting secretary drafts a summary, decisions, open questions and action items from these notes only. You review them before anything is created.</p>
    ${edit ? `<button class="btn btn-primary" data-mtact="draft">${m.agent_level > 0 ? "Draft action items" : "Find action items (AI is off: fixed rules)"}</button>` : ""}</section>`;
  const reviewed = d.status === "reviewed";
  const people = [["", "[ADD] owner"], ...meta.people.map((p) => [p.id, p.name])];
  const targets = meta.targets.map((t) => [t.id, t.name + (t.allowed ? "" : " (no access)")]);
  const krs = meta.options.krs || [];
  const rows = d.items.map((it) => {
    const done = it.state !== "draft" || reviewed || !edit;
    return `<tr data-mtitem="${esc(it.id)}" class="${it.state !== "draft" ? "mt-done" : ""}">
      <td>${done ? mtBadge(...(MT_STATE[it.state] || [it.state])) : `<input type="checkbox" class="mt-pick" aria-label="Create this item" checked>`}</td>
      <td>${done ? `<span dir="auto">${esc(it.text)}</span>` : `<input class="input input-sm mt-it-text" value="${esc(it.text)}" dir="auto" maxlength="300" aria-label="Action item">`}${it.source && !done ? `<div class="subtle s-small mt-src" dir="auto">From: ${esc(it.source.slice(0, 160))}</div>` : ""}${it.ref_label ? `<div class="s-small"><a href="#/${S.ws.id}/${esc(it.route)}">${esc(it.ref_label)}</a></div>` : ""}</td>
      <td>${done ? esc(it.owner_name || "–") : `<select class="input input-sm mt-it-owner" aria-label="Owner">${mtOpts(people, it.owner_id || "")}</select>`}</td>
      <td>${done ? `<span class="num">${esc(it.due || "–")}</span>` : `<input class="input input-sm mt-it-due" type="date" value="${esc(it.due || "")}" aria-label="Due date">`}</td>
      <td>${done ? esc(meta.targets.find((t) => t.id === it.target)?.name.replace(/ \(.*$/, "") || it.target) : `<select class="input input-sm mt-it-target" aria-label="Module">${mtOpts(targets, it.target)}</select>${krs.length ? `<select class="input input-sm mt-it-kr" aria-label="Key result" ${it.target === "okr" ? "" : "hidden"}>${mtOpts(krs.map((k) => [k.id, k.label]), it.kr_id, "Pick a key result")}</select>` : ""}`}</td></tr>`;
  }).join("");
  const list = (arr) => (arr?.length ? `<ul class="mt-ul">${arr.map((x) => `<li dir="auto">${esc(x)}</li>`).join("")}</ul>` : `<p class="subtle s-small">None found.</p>`);
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Draft: summary and action items</h3>
      <span class="s-small">${reviewed ? mtBadge(`Reviewed by ${d.reviewed_by || ""}`, "good") : mtBadge("Waiting for review", "warn")} <span class="subtle">${d.by_ai ? "Drafted by the AI Meeting secretary" : "Built by fixed rules from the notes"} · ${esc(String(d.generated_at).slice(0, 10))}</span></span></div>
    ${d.note ? `<p class="mt-note s-small">${esc(d.note)}</p>` : ""}${d.issues?.length && d.by_ai ? `<ul class="mt-issues s-small">${d.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="mt-sec"><h4>Summary</h4>${edit && !reviewed ? `<textarea class="input" id="mt-summary" rows="3" dir="auto">${esc(d.summary)}</textarea>` : `<p class="mt-text" dir="auto">${esc(d.summary)}</p>`}</div>
    <div class="grid-2 mt-grid"><div class="mt-sec"><h4>Decisions</h4>${list(d.decisions)}</div><div class="mt-sec"><h4>Open questions</h4>${list(d.questions)}</div></div>
    <div class="mt-sec"><h4>Action items</h4>${d.items.length ? `<div class="table-wrap"><table class="f-table mt-items"><thead><tr><th><span class="mt-sr">Create</span></th><th>What</th><th>Owner</th><th>Due</th><th>Goes to</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="subtle s-small">No action items found in the notes.</p>`}
    ${edit && !reviewed ? `<div class="row gap-8 mt-actions"><button class="btn btn-primary" data-mtact="create">Create ticked items</button><button class="btn btn-sm" data-mtact="add-item">Add an item</button><button class="btn btn-sm" data-mtact="save-draft">Save draft</button><button class="btn btn-sm btn-ghost" data-mtact="redraft">Draft again</button>${d.items.some((x) => x.state === "draft") ? "" : `<button class="btn btn-sm" data-mtact="review">Mark reviewed</button>`}</div>
      <p class="subtle s-small">Unticked items are skipped. Items go to their module only if your role can edit it there; each links back to this meeting.</p>` : edit ? `<div class="row gap-8 mt-actions"><button class="btn btn-sm btn-ghost" data-mtact="redraft-force">Draft again from the notes</button></div>` : ""}</div></section>`;
}
function mtCreated(m) {
  return `<section class="card card-pad"><h3 style="margin:0">Created from this meeting</h3><ul class="mt-ul">${m.items.map((it) => `<li><a href="#/${S.ws.id}/${esc(it.route)}">${esc(it.ref_label)}</a> · <span dir="auto">${esc(it.text)}</span>${it.owner_name ? ` · ${esc(it.owner_name)}` : ""}${it.due ? ` · <span class="num">${esc(it.due)}</span>` : ""} ${it.status === "done" ? mtBadge("done", "good") : ""}</li>`).join("")}</ul></section>`;
}
function mtFollow(m, edit) {
  const f = m.followup, store = m.link_info.store;
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Follow-up email</h3><span class="subtle s-small">Arabic first, then English. Drafted only: a person sends it.</span></div>
    ${!f ? (edit ? `<p class="muted s-small">Draft a short thank-you with the agreed next steps for the outside attendees.</p><button class="btn" data-mtact="followup">Draft follow-up</button>` : `<p class="muted s-small">No follow-up drafted.</p>`) : `
    ${f.note ? `<p class="mt-note s-small">${esc(f.note)}</p>` : ""}
    <div class="field"><label for="mt-fsub">Subject</label><input class="input" id="mt-fsub" dir="auto" value="${esc(f.subject)}" ${edit ? "" : "readonly"}></div>
    <div class="field" style="margin-top:8px"><label for="mt-fbody">Email</label><textarea class="input mt-fbody" id="mt-fbody" dir="auto" ${edit ? "" : "readonly"}>${esc(f.body)}</textarea></div>
    ${f.sent ? `<p class="s-small">${mtBadge(f.sent.status === "sent" ? "Sent" : f.sent.status === "test" ? "Logged in Test mode (not sent)" : f.sent.status, f.sent.status === "sent" ? "good" : "")} <span class="subtle">${esc(f.sent.at.slice(0, 16).replace("T", " "))} UTC${f.sent.error ? ` · ${esc(f.sent.error)}` : ""}</span></p>` : ""}
    <div class="row gap-8 mt-actions"><button class="btn btn-sm" data-mtact="copy">Copy</button>${edit ? `<button class="btn btn-sm" data-mtact="save-follow">Save</button><button class="btn btn-sm btn-ghost" data-mtact="followup">Draft again</button>` : ""}
      ${store && !store.hidden && !store.missing ? `<button class="btn btn-sm btn-primary" data-mtact="send" ${levelFor("crm") === "edit" ? "" : "disabled title=\"Your role can't send from the Store CRM\""}>Send to ${esc(store.label)} via Store CRM</button>` : `<span class="subtle s-small">Link a Store CRM store to send it from the CRM, or copy it.</span>`}</div>
    <p class="subtle s-small">Sending uses the Store CRM: Test mode logs it without sending, opted-out and sample stores are never sent, and live emails go out only 09:00–21:00 Riyadh time (not Friday) with the unsubscribe link.</p>`}</section>`;
}

/* ------------------------------------------------ my action items */
function mtMine() {
  const d = MT.mine, ov = new Set(d.overdue.map((x) => x.id));
  const row = (it) => `<li class="mt-mine ${ov.has(it.id) ? "mt-over" : ""}"><div style="min-width:0"><b dir="auto">${esc(it.text)}</b>
      <div class="mt-meta subtle s-small"><span>From <button class="mt-link" data-mtact="open" data-id="${esc(it.meeting_id)}" dir="auto">${esc(it.meeting_title || "a meeting")}</button></span>${it.ref_label ? `<a href="#/${S.ws.id}/${esc(it.route)}">${esc(it.ref_label)}</a>` : ""}<span class="num">${it.due ? `Due ${esc(it.due)}` : "No due date"}</span>${ov.has(it.id) ? mtBadge("overdue", "bad") : ""}</div></div>
      ${mtEdit() ? `<button class="btn btn-sm" data-mtact="${it.status === "done" ? "reopen" : "done"}" data-id="${esc(it.id)}">${it.status === "done" ? "Reopen" : "Mark done"}</button>` : ""}</li>`;
  return `<section class="s-kpis"><div class="card s-kpi"><span class="eyebrow">Open</span><b class="num">${d.open.length}</b><span class="subtle">assigned to you from meetings</span></div>
      <div class="card s-kpi ${d.overdue.length ? "warn" : ""}"><span class="eyebrow">Overdue</span><b class="num">${d.overdue.length}</b><span class="subtle">past their due date (Riyadh)</span></div></section>
    <section class="card card-pad" style="margin-top:16px"><h3 style="margin:0">Open items</h3>${d.open.length ? `<ul class="mt-mlist">${d.open.map(row).join("")}</ul>` : `<p class="muted s-small">Nothing open. Items you own appear here once they're created from a meeting.</p>`}</section>
    ${d.done.length ? `<details class="card card-pad" style="margin-top:16px"><summary><b>Done (${d.done.length})</b></summary><ul class="mt-mlist">${d.done.map(row).join("")}</ul></details>` : ""}`;
}

/* ------------------------------------------------ events */
function mtItemsFromTable() {
  return [...document.querySelectorAll("[data-mtitem]")].filter((tr) => tr.querySelector(".mt-it-text")).map((tr) => {
    const g = (c) => tr.querySelector(c);
    const target = g(".mt-it-target").value;
    return { id: tr.dataset.mtitem.startsWith("new-") ? undefined : tr.dataset.mtitem, text: g(".mt-it-text").value, owner_id: g(".mt-it-owner").value || null, due: g(".mt-it-due").value || null, target, kr_id: target === "okr" ? g(".mt-it-kr")?.value || null : null, selected: g(".mt-pick").checked };
  });
}
async function mtAct(a, id, btn) {
  const m = MT.cur;
  if (a === "open") { MT.open = id; MT.tab = "list"; MT.editing = false; go("meetings", id); return; }
  if (a === "back") { MT.open = null; MT.editing = false; go("meetings", "list"); return; }
  if (a === "edit") { MT.editing = true; return mtShow(); }
  if (a === "cancel-edit") { MT.editing = false; return mtShow(); }
  if (a === "delete") { if (!confirm("Delete this meeting and its notes? Tasks already created stay in their modules.")) return; await api(`${mtP()}/${m.id}`, { method: "DELETE" }); MT.open = null; toast("Meeting deleted"); go("meetings", "list"); return; }
  if (a === "draft" || a === "redraft" || a === "redraft-force") {
    if (a !== "draft" && !confirm("Draft again from the notes? Your edits to this draft are replaced.")) return;
    btn.disabled = true; btn.textContent = "Drafting…";
    try { const r = await mtPost(`/${m.id}/draft`, a === "redraft-force" ? { force: true } : {}); toast(r.draft.by_ai ? "Draft ready: review the items" : "Draft built from the notes: review the items"); } finally { btn.disabled = false; }
    return mtShow();
  }
  if (a === "add-item") { await mtPut(`/${m.id}/draft`, { summary: $("#mt-summary")?.value, items: [...mtItemsFromTable(), { text: "[ADD] new action item", target: "ops" }] }); return mtShow(); }
  if (a === "save-draft") { await mtPut(`/${m.id}/draft`, { summary: $("#mt-summary")?.value, items: mtItemsFromTable() }); toast("Draft saved"); return mtShow(); }
  if (a === "create") {
    const items = mtItemsFromTable();
    if ($("#mt-summary")) await mtPut(`/${m.id}/draft`, { summary: $("#mt-summary").value });
    btn.disabled = true;
    try {
      const r = await mtPost(`/${m.id}/create`, { items });
      if (r.refused.length) toast(`${r.created} created · ${r.refused.length} not created: ${r.refused[0].error}`, true);
      else toast(`${r.created} item${r.created === 1 ? "" : "s"} created`);
    } finally { btn.disabled = false; }
    return mtShow();
  }
  if (a === "review") { await mtPost(`/${m.id}/review`); toast("Marked reviewed"); return mtShow(); }
  if (a === "followup") { btn.disabled = true; btn.textContent = "Drafting…"; try { await mtPost(`/${m.id}/followup`); } finally { btn.disabled = false; } return mtShow(); }
  if (a === "save-follow") { await mtPut(`/${m.id}/followup`, { subject: $("#mt-fsub").value, body: $("#mt-fbody").value }); toast("Saved"); return mtShow(); }
  if (a === "copy") { try { await navigator.clipboard.writeText(`${$("#mt-fsub").value}\n\n${$("#mt-fbody").value}`); toast("Copied"); } catch { toast("Select the text and copy it", true); } return; }
  if (a === "send") {
    if (!confirm("Send this email through the Store CRM? In Test mode it is only logged.")) return;
    const r = await mtPost(`/${m.id}/followup/send`, { subject: $("#mt-fsub").value, body: $("#mt-fbody").value });
    toast(r.message.status === "sent" ? "Sent" : `Logged, not sent: ${r.message.error || r.message.status}`); return mtShow();
  }
  if (a === "done" || a === "reopen") { await mtPut(`/items/${id}`, { status: a === "done" ? "done" : "open" }); return mtShow(); }
}
let mtStoreTimer = null;
document.addEventListener("input", (e) => {
  if (S.route !== "meetings" || e.target.id !== "mtf-storeq") return;
  $("#mtf-store_id").value = "";
  clearTimeout(mtStoreTimer);
  const q = e.target.value.trim();
  mtStoreTimer = setTimeout(async () => {
    const box = $("#mtStoreHits"); if (!box) return;
    if (q.length < 2) { box.innerHTML = ""; return; }
    try { const r = await api(`${mtP()}/stores?q=${encodeURIComponent(q)}`); box.innerHTML = r.stores.length ? r.stores.map((s) => `<button type="button" class="mt-hit" data-mtstore="${esc(s.id)}" dir="auto">${esc(s.label)}${s.domain ? ` <span class="subtle">${esc(s.domain)}</span>` : ""}</button>`).join("") : `<span class="subtle s-small">No store found</span>`; } catch { box.innerHTML = ""; }
  }, 250);
});
document.addEventListener("click", async (e) => {
  if (S.route !== "meetings") return;
  const t = e.target.closest("[data-mttab]");
  if (t) { MT.tab = t.dataset.mttab; MT.open = null; go("meetings", MT.tab); return; }
  const h = e.target.closest("[data-mtstore]");
  if (h) { $("#mtf-store_id").value = h.dataset.mtstore; $("#mtf-storeq").value = h.textContent.trim(); $("#mtStoreHits").innerHTML = ""; return; }
  const b = e.target.closest("[data-mtact]");
  if (b) { e.preventDefault(); try { await mtAct(b.dataset.mtact, b.dataset.id, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("change", async (e) => {
  if (S.route !== "meetings") return;
  if (e.target.classList.contains("mt-it-target")) { const kr = e.target.parentElement.querySelector(".mt-it-kr"); if (kr) kr.hidden = e.target.value !== "okr"; return; }
  if (e.target.id === "mt-file") {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 700 * 1024) { toast("That file is too large: trim it or paste the text.", true); return; }
    try {
      const body = { filename: f.name };
      if (/\.docx$/i.test(f.name)) { const buf = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); body.file_b64 = btoa(bin); }
      else body.text = await f.text();
      await mtPost(`/${MT.cur.id}/notes`, body); toast("Notes saved from the file"); await mtShow();
    } catch (err) { toast(err.message, true); }
  }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "meetings") return;
  const f = e.target;
  if (!f.matches("#mtForm, #mtNotesForm")) return;
  e.preventDefault();
  try {
    if (f.id === "mtForm") {
      const body = mtReadForm();
      if (f.dataset.id) { await mtPut(`/${f.dataset.id}`, body); MT.editing = false; toast("Saved"); await mtShow(); }
      else { const m = await mtPost("", body); toast("Meeting added: paste the notes when you have them"); MT.adding = false; go("meetings", m.id); }
    }
    if (f.id === "mtNotesForm") { await mtPost(`/${MT.cur.id}/notes`, { text: $("#mt-notes").value }); toast("Notes saved"); await mtShow(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "meetings" && S.ws) render();
