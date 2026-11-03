/* Legal & documents: the company's document vault (certificates, licences, India registrations, NDAs, contracts,
   policies, board resolutions, cap table) with versions, renewal and notice deadlines, obligations and reminders,
   starter templates filled from the dashboard's data, the e-signature log (no integration) and the AI Legal assistant
   (summaries with a quoted sentence for every point, drafts only). Not legal advice: every page says so.
   Uses app.js globals (S, $, api, esc, toast, ROUTES, levelFor, go). Names start with "lg". */

const LG = { tab: "docs", meta: null, list: null, cur: null, open: null, editing: false, filter: { type: "", status: "", q: "", state: "" }, days: 120, tpl: null, hits: [], sumText: false };
const LG_TABS = [["docs", "Documents"], ["due", "What's due"], ["templates", "Templates"], ["settings", "Settings"]];
const LG_TONE = { draft: "", in_review: "accent", signed: "good", active: "good", expired: "bad", terminated: "", expiring: "warn" };
const lgP = () => `/api/workspaces/${S.ws.id}/legal`;
const lgEdit = () => levelFor("legal") === "edit";
const lgPost = (p, b) => api(`${lgP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const lgPut = (p, b) => api(`${lgP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const lgOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const lgBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;
const lgType = (id) => LG.meta?.types.find((t) => t.id === id)?.name || id;
const lgStatus = (id) => LG.meta?.statuses.find((s) => s.id === id)?.name || id;
const lgTile = (l, v, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(l)}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`;
const lgSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const lgDays = (n) => (n === null || n === undefined ? "" : n < 0 ? `${-n} day${n === -1 ? "" : "s"} ago` : n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`);
const lgBanner = () => `<p class="lg-banner s-small" role="note"><b>Not legal advice.</b> Templates and AI drafts are starting points: have a qualified lawyer review them before anyone signs or relies on them. <span dir="rtl" lang="ar">${esc(LG.meta?.not_advice_ar || "")}</span></p>`;

ROUTES.legal = { title: "Legal & documents", crumb: "Settings", render: renderLegal };

async function renderLegal(view) {
  if (LG_TABS.some(([k]) => k === S.param)) { LG.tab = S.param; LG.open = null; }
  else if (S.param && /^\d+$/.test(S.param)) { LG.tab = "docs"; LG.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs lg-tabs" role="tablist" aria-label="Legal views">${LG_TABS.map(([k, l]) => `<button role="tab" data-lgtab="${k}" aria-selected="${LG.tab === k}">${l}</button>`).join("")}</div>
    <div id="lgBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { LG.meta = await api(`${lgP()}/meta`); } catch (e) { $("#lgBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await lgShow();
}
async function lgShow() {
  if (S.route !== "legal") return;
  document.querySelectorAll("[data-lgtab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.lgtab === LG.tab));
  const box = $("#lgBody"); if (!box) return;
  try {
    if (LG.tab === "due") { const d = await api(`${lgP()}/due?days=${LG.days}`); box.innerHTML = lgBanner() + lgDue(d); return; }
    if (LG.tab === "templates") { if (!LG.tpl) LG.tpl = (await api(`${lgP()}/templates`)).templates; box.innerHTML = lgBanner() + lgTemplates(); return; }
    if (LG.tab === "settings") { LG.meta = await api(`${lgP()}/meta`); box.innerHTML = lgSettings(); return; }
    if (LG.open) { const d = await api(`${lgP()}/documents/${LG.open}`).catch(() => null); if (d) { LG.cur = d; box.innerHTML = lgBanner() + lgDetail(d); return; } LG.open = null; }
    const f = LG.filter, q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    LG.list = await api(`${lgP()}/documents${q ? "?" + q : ""}`); box.innerHTML = lgBanner() + lgList();
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ vault: tiles, filters, new document, list */
function lgList() {
  const d = LG.list, t = d.totals, m = LG.meta, f = LG.filter;
  const tiles = [lgTile("Documents", t.all, `${t.restricted} restricted`), lgTile("Expiring", t.expiring, `within ${m.settings.expiring_days} days`, t.expiring ? "warn" : ""),
    lgTile("Expired", t.expired, "still marked in force or expired", t.expired ? "bad" : ""), lgTile("Drafts", t.drafts, "draft or in review")];
  const add = lgEdit() ? `<details class="card card-pad lg-new" ${t.all || f.q || f.type || f.status ? "" : "open"}><summary><b>New document</b></summary>${lgForm(null)}</details>` : "";
  const filters = `<form id="lgFilter" class="lg-filters" role="search">
    <input class="input input-sm" id="lgq" type="search" placeholder="Search title, party, number, tag" value="${esc(f.q)}" aria-label="Search">
    <select class="input input-sm" id="lgft" aria-label="Type">${lgOpts(m.types.map((x) => [x.id, x.name]), f.type, "All types")}</select>
    <select class="input input-sm" id="lgfs" aria-label="Status">${lgOpts(m.statuses.map((x) => [x.id, x.name]), f.status, "All statuses")}</select>
    <select class="input input-sm" id="lgfe" aria-label="Dates">${lgOpts([["expiring", "Expiring soon"], ["expired", "Expired"]], f.state, "Any date")}</select>
    <button class="btn btn-sm" type="submit">Filter</button></form>`;
  const rows = d.documents.map((x) => {
    const dt = x.dates, when = dt.renewal_date ? `${x.auto_renew ? "Renews" : "Expires"} ${dt.renewal_date}${["signed", "active"].includes(x.status) ? ` · ${lgDays(dt.days_left)}` : ""}` : "No expiry date";
    return `<button class="card lg-row" data-lgact="open" data-id="${esc(x.id)}">
      <span class="lg-row-main"><b dir="auto" class="lg-title">${esc(x.title)}</b>
        <span class="subtle s-small">${esc(lgType(x.type))}${x.parties.length ? ` · <span dir="auto">${esc(x.parties.slice(0, 3).join(", "))}</span>` : ""}${x.reference ? ` · ${esc(x.reference)}` : ""}</span></span>
      <span class="lg-row-side">${lgBadge(lgStatus(x.status), LG_TONE[x.status])}${dt.state === "expiring" ? lgBadge("expiring", "warn") : ""}${dt.lapsed ? lgBadge("expired by date", "bad") : ""}${x.confidentiality === "restricted" ? lgBadge("restricted", "accent") : ""}${x.sample ? lgBadge("sample", "warn") : ""}
        <span class="subtle s-small num">${esc(when)}</span>${dt.notice_deadline && dt.notice_days_left >= 0 ? `<span class="s-small num lg-notice">Notice by ${esc(dt.notice_deadline)}</span>` : ""}
        <span class="subtle s-small">${x.versions} file${x.versions === 1 ? "" : "s"}${x.signatures ? ` · ${x.signatures} signature${x.signatures === 1 ? "" : "s"}` : ""}${x.open_obligations ? ` · ${x.open_obligations} open obligation${x.open_obligations === 1 ? "" : "s"}` : ""}</span></span></button>`;
  }).join("");
  return `<section class="s-kpis">${tiles.join("")}</section>
    <div class="stack" style="gap:16px;margin-top:16px">${add}${filters}
    ${rows ? `<div class="stack lg-rows" style="gap:8px">${rows}</div>` : `<div class="card empty"><p>${t.all ? "Nothing matches these filters." : "No documents yet. Add the CR, VAT certificate and licences first, with their expiry dates, so renewals show up in time."}</p></div>`}</div>`;
}
function lgPartiesText(list) { return (list || []).map((p) => [p.name, p.email, p.role].join(", ").replace(/(, )+$/, "")).join("\n"); }
function lgForm(d) {
  const m = LG.meta, restricted = m.me.restricted;
  return `<form id="lgForm" class="lg-form" data-id="${esc(d?.id || "")}" style="margin-top:12px">
    <div class="field lg-wide"><label for="lgf-title">Title</label><input class="input" id="lgf-title" required maxlength="200" dir="auto" value="${esc(d?.title || "")}" placeholder="e.g. Commercial registration (CR)"></div>
    <div class="field"><label for="lgf-type">Type</label><select class="input" id="lgf-type">${lgOpts(m.types.map((t) => [t.id, t.name]), d?.type || "other")}</select></div>
    <div class="field"><label for="lgf-status">Status</label><select class="input" id="lgf-status">${lgOpts(m.statuses.map((s) => [s.id, s.name]), d?.status || "draft")}</select><span class="hint">Agreements become Signed when you record the signature with the signed file.</span></div>
    ${restricted ? `<div class="field"><label for="lgf-conf">Confidentiality</label><select class="input" id="lgf-conf">${lgOpts(m.confidentiality.map((c) => [c.id, c.name]), d?.confidentiality || "", d ? undefined : "Default for the type")}</select></div>` : ""}
    <div class="field"><label for="lgf-owner">Owner</label><select class="input" id="lgf-owner">${lgOpts(m.people.map((x) => [x.id, x.name]), d?.owner_id || "", "–")}</select></div>
    <div class="field"><label for="lgf-ref">Number / reference</label><input class="input" id="lgf-ref" maxlength="120" value="${esc(d?.reference || "")}" placeholder="CR, licence or policy number"></div>
    <div class="field"><label for="lgf-issue">Issue date</label><input class="input" id="lgf-issue" type="date" value="${esc(d?.issue_date || "")}"></div>
    <div class="field"><label for="lgf-exp">Expiry / renewal date</label><input class="input" id="lgf-exp" type="date" value="${esc(d?.expiry_date || "")}"></div>
    <div class="field"><label for="lgf-term">Renewal term (months)</label><input class="input" id="lgf-term" type="number" min="0" max="120" value="${esc(d?.renewal_term_months || 0)}"></div>
    <div class="field"><label for="lgf-notice">Notice period (days)</label><input class="input" id="lgf-notice" type="number" min="0" max="730" value="${esc(d?.notice_days || 0)}"><span class="hint">Termination notice deadline = renewal date − notice period.</span></div>
    <label class="chip lg-chk"><input type="checkbox" id="lgf-auto" ${d?.auto_renew ? "checked" : ""}> Renews automatically</label>
    <div class="field lg-wide"><label for="lgf-parties">Parties (one per line: name, email, role)</label><textarea class="input" id="lgf-parties" rows="2" dir="auto" placeholder="Najd Digital Agency, legal@najd.example, Counterparty">${esc(lgPartiesText(d?.parties))}</textarea></div>
    <div class="field lg-wide"><label for="lgf-pay">Payment terms</label><input class="input" id="lgf-pay" maxlength="500" dir="auto" value="${esc(d?.payment_terms || "")}"></div>
    <div class="field lg-wide"><label for="lgf-notes">Notes</label><textarea class="input" id="lgf-notes" rows="2" maxlength="4000" dir="auto">${esc(d?.notes || "")}</textarea></div>
    <div class="field lg-wide"><label for="lgf-tags">Tags</label><input class="input" id="lgf-tags" maxlength="300" value="${esc((d?.tags || []).join(", "))}" placeholder="e.g. india, hosting"></div>
    <div class="row gap-8 lg-wide"><button class="btn btn-primary" type="submit">${d ? "Save" : "Add document"}</button>${d ? `<button class="btn" type="button" data-lgact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}
function lgReadForm() {
  const v = (s) => $(s)?.value ?? "";
  const parties = v("#lgf-parties").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [name = "", email = "", ...role] = l.split(",").map((x) => x.trim()); return /@/.test(name) && !email ? { name: "", email: name, role: role.join(", ") } : { name, email, role: role.join(", ") }; });
  const b = { title: v("#lgf-title"), type: v("#lgf-type"), status: v("#lgf-status"), owner_id: v("#lgf-owner") || null, reference: v("#lgf-ref"), issue_date: v("#lgf-issue") || null, expiry_date: v("#lgf-exp") || null,
    renewal_term_months: Number(v("#lgf-term") || 0), notice_days: Number(v("#lgf-notice") || 0), auto_renew: !!$("#lgf-auto")?.checked, parties, payment_terms: v("#lgf-pay"), notes: v("#lgf-notes"), tags: v("#lgf-tags") };
  if ($("#lgf-conf") && v("#lgf-conf")) b.confidentiality = v("#lgf-conf");
  return b;
}

/* ------------------------------------------------ one document */
function lgDetail(d) {
  const edit = d.can_edit && lgEdit(), dt = d.dates;
  const head = LG.editing && edit ? `<section class="card card-pad">${lgForm(d)}</section>` : `<section class="card card-pad lg-head">
    <div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:0"><button class="lg-link s-small" data-lgact="back">← All documents</button>
      <h2 style="margin:6px 0 0" dir="auto">${esc(d.title)}</h2>
      <div class="lg-meta subtle s-small"><span>${esc(lgType(d.type))}</span>${lgBadge(lgStatus(d.status), LG_TONE[d.status])}${dt.state === "expiring" ? lgBadge("expiring", "warn") : ""}${dt.lapsed ? lgBadge("expired by date", "bad") : ""}${d.confidentiality === "restricted" ? lgBadge("restricted: Owner/Admin only", "accent") : ""}${d.sample ? lgBadge("sample", "warn") : ""}${d.reference ? `<span>No. ${esc(d.reference)}</span>` : ""}</div>
      <div class="lg-meta s-small">${d.issue_date ? `<span>Issued ${esc(d.issue_date)}</span>` : ""}${dt.renewal_date ? `<span>${d.auto_renew ? `Auto-renews every ${esc(d.renewal_term_months)} months, next` : "Expires"} <b class="num">${esc(dt.renewal_date)}</b> (${esc(lgDays(dt.days_left))})</span>` : `<span>No expiry date</span>`}
        ${dt.notice_deadline ? `<span>Notice deadline <b class="num">${esc(dt.notice_deadline)}</b> (${esc(d.notice_days)} days before)</span>` : ""}${d.owner_name ? `<span>Owner: ${esc(d.owner_name)}</span>` : ""}</div>
      ${d.parties.length ? `<div class="lg-meta s-small"><span>Parties:</span>${d.parties.map((p) => `<span dir="auto">${esc([p.name, p.email].filter(Boolean).join(" · "))}${p.role ? ` <span class="subtle">(${esc(p.role)})</span>` : ""}</span>`).join("")}</div>` : ""}
      ${d.payment_terms ? `<p class="s-small lg-text" dir="auto">Payment: ${esc(d.payment_terms)}</p>` : ""}${d.notes ? `<p class="s-small lg-text" dir="auto">${esc(d.notes)}</p>` : ""}</div>
      ${edit ? `<div class="row gap-8"><button class="btn btn-sm" data-lgact="edit">Edit</button>${d.can_delete ? `<button class="btn btn-sm btn-ghost btn-danger" data-lgact="delete">Delete</button>` : ""}</div>` : ""}</div>
    ${d.sign_block && d.signable && ["draft", "in_review"].includes(d.status) ? `<p class="lg-note s-small">${esc(d.sign_block)}</p>` : ""}</section>`;
  return `<div class="stack" style="gap:16px">${head}${lgFiles(d, edit)}${d.signable || d.signatures.length ? lgSigs(d, edit) : ""}${lgObls(d, edit)}${lgSummary(d, edit)}${lgLog(d)}</div>`;
}
function lgFiles(d, edit) {
  const rows = d.versions.map((v) => `<li class="lg-li"><div style="min-width:0"><b class="num">v${v.n}</b> <span dir="auto">${esc(v.name)}</span> ${v.n === d.current_version ? lgBadge("current", "accent") : ""} ${v.kind === "signed" ? lgBadge("signed copy", "good") : v.kind === "generated" ? lgBadge("template draft", "warn") : ""}
      <div class="subtle s-small">${esc(String(v.ext).toUpperCase())} · ${esc(lgSize(v.size))} · ${esc(v.uploaded_by)} · ${esc(String(v.uploaded_at).slice(0, 10))}${v.placeholders ? ` · ${v.placeholders.add} [ADD], ${v.placeholders.confirm} [CONFIRM] left` : ""}${v.note ? ` · <span dir="auto">${esc(v.note)}</span>` : ""}</div></div>
    <div class="row gap-8">${v.print_url ? `<a class="btn btn-sm" href="${esc(v.print_url)}" target="_blank" rel="noopener">Print view</a>` : ""}<a class="btn btn-sm" href="${esc(v.file_url)}" download>Download</a></div></li>`).join("");
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Files and versions</h3><span class="subtle s-small">Private: only people with Legal access can download, and every download is in the activity log. A new upload keeps the old versions.</span></div>
    ${rows ? `<ul class="lg-ul">${rows}</ul>` : `<p class="muted s-small">No file yet.</p>`}
    ${edit ? `<form id="lgUpForm" class="lg-inline"><input class="input input-sm" type="file" id="lgu-file" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" aria-label="File">
      <select class="input input-sm" id="lgu-kind" aria-label="Kind"><option value="upload">New version</option><option value="signed">Signed copy</option></select>
      <input class="input input-sm" id="lgu-note" maxlength="300" placeholder="Note (optional)" aria-label="Note"><button class="btn btn-sm btn-primary" type="submit">Upload</button>
      <span class="hint s-small lg-wide">PDF, Word (.docx), PNG, JPEG or text, up to ${esc(LG.meta.max_mb)} MB.</span></form>` : ""}</section>`;
}
function lgSigs(d, edit) {
  const methods = Object.fromEntries(LG.meta.sign_methods.map((m) => [m.id, m.name]));
  const files = d.versions.filter((v) => v.kind !== "generated");
  const rows = d.signatures.map((s) => `<li class="lg-li"><div style="min-width:0"><b dir="auto">${esc(s.signer_name)}</b>${s.party ? ` <span class="subtle" dir="auto">for ${esc(s.party)}</span>` : ""}
      <div class="subtle s-small">${esc(s.signed_at)} · ${esc(methods[s.method] || s.method)}${s.method_note ? ` (${esc(s.method_note)})` : ""} · file v${esc(s.version_n)} · recorded by ${esc(s.recorded_by)}</div></div>
    ${edit ? `<button class="btn btn-sm btn-ghost" data-lgact="sig-del" data-id="${esc(s.id)}">Remove</button>` : ""}</li>`).join("");
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Signatures</h3><span class="subtle s-small">A log, not an e-signature tool: sign in DocuSign or on paper, then record it here with the signed file.</span></div>
    ${rows ? `<ul class="lg-ul">${rows}</ul>` : `<p class="muted s-small">No signature recorded.</p>`}
    ${edit ? files.length ? `<form id="lgSigForm" class="lg-form" style="margin-top:12px">
      <div class="field"><label for="lgs-name">Signed by</label><input class="input" id="lgs-name" required maxlength="120" dir="auto"></div>
      <div class="field"><label for="lgs-email">Email</label><input class="input" id="lgs-email" type="email" maxlength="200"></div>
      <div class="field"><label for="lgs-party">For (party)</label><input class="input" id="lgs-party" maxlength="200" dir="auto"></div>
      <div class="field"><label for="lgs-date">Signed on</label><input class="input" id="lgs-date" type="date" required max="${esc(LG.meta.today)}" value="${esc(LG.meta.today)}"></div>
      <div class="field"><label for="lgs-method">How</label><select class="input" id="lgs-method">${lgOpts(LG.meta.sign_methods.map((m) => [m.id, m.name]), "wet")}</select></div>
      <div class="field"><label for="lgs-ver">Signed file</label><select class="input" id="lgs-ver">${lgOpts(files.map((v) => [v.n, `v${v.n} · ${v.name}`]), files.find((v) => v.kind === "signed")?.n || files[0].n)}</select></div>
      <div class="field lg-wide"><label for="lgs-note">Note</label><input class="input" id="lgs-note" maxlength="200" placeholder="e.g. DocuSign envelope id"></div>
      <div class="row gap-8 lg-wide"><button class="btn btn-primary" type="submit">Record signature</button></div></form>`
      : `<p class="subtle s-small">Upload the signed file first (Files and versions → Signed copy), then record who signed it.</p>` : ""}</section>`;
}
function lgObls(d, edit) {
  const kinds = Object.fromEntries(LG.meta.obligation_kinds.map((k) => [k.id, k.name]));
  const rows = d.obligations.map((o) => `<li class="lg-li ${o.status === "done" ? "lg-done" : ""}"><div style="min-width:0"><span dir="auto">${esc(o.title)}</span> ${lgBadge(kinds[o.kind] || o.kind)}${o.repeat && o.repeat !== "none" ? ` ${lgBadge(o.repeat)}` : ""}${o.status === "done" ? ` ${lgBadge("done", "good")}` : ""}
      <div class="subtle s-small">${o.due_date ? `Due <span class="num">${esc(o.due_date)}</span>` : "No date"}${o.owner_name ? ` · ${esc(o.owner_name)}` : ""}${o.source !== "person" ? ` · ${o.source === "ai_suggested" ? "suggested by the AI Legal assistant" : "suggested by the rules"}` : ""}${o.notes ? ` · <span dir="auto">${esc(o.notes.slice(0, 200))}</span>` : ""}</div></div>
    ${edit && o.status !== "done" ? `<div class="row gap-8"><button class="btn btn-sm" data-lgact="obl-done" data-id="${esc(o.id)}">Done</button><button class="btn btn-sm btn-ghost" data-lgact="obl-del" data-id="${esc(o.id)}">Remove</button></div>` : ""}</li>`).join("");
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Obligations and reminders</h3><span class="subtle s-small">Payment terms, notice periods, auto-renew dates, anything to do by a date. Due ones show on Home.</span></div>
    ${rows ? `<ul class="lg-ul">${rows}</ul>` : `<p class="muted s-small">None yet.</p>`}
    ${edit ? `<form id="lgOblForm" class="lg-inline"><input class="input input-sm" id="lgo-title" required maxlength="200" placeholder="e.g. Ask for the renewal quote" aria-label="Title" dir="auto">
      <select class="input input-sm" id="lgo-kind" aria-label="Kind">${lgOpts(LG.meta.obligation_kinds.map((k) => [k.id, k.name]), "reminder")}</select>
      <input class="input input-sm" id="lgo-due" type="date" aria-label="Due date"><select class="input input-sm" id="lgo-rep" aria-label="Repeat">${lgOpts(LG.meta.repeats.map((r) => [r, r === "none" ? "Once" : r]), "none")}</select>
      <button class="btn btn-sm" type="submit">Add</button></form>` : ""}</section>`;
}
function lgSummary(d, edit) {
  const s = d.summary, fields = LG.meta.summary_fields;
  const sugg = d.suggestions.filter((x) => x.status === "suggested");
  const kinds = Object.fromEntries(LG.meta.obligation_kinds.map((k) => [k.id, k.name]));
  const body = s ? `<p class="subtle s-small">${s.by_ai ? "Drafted by the AI Legal assistant" : "Found by fixed rules"} from ${esc(s.source)} · ${esc(String(s.at).slice(0, 16).replace("T", " "))} UTC · ${esc(s.by)}. Every point quotes the contract; check the quote, not the summary.</p>
      ${s.note ? `<p class="lg-note s-small">${esc(s.note)}</p>` : ""}
      <dl class="lg-sum">${fields.map((f) => { const list = s.fields[f.key] || []; return `<div class="lg-sum-row"><dt>${esc(f.name)}</dt><dd>${list.length ? list.map((x) => `<div class="lg-pt"><span dir="auto">${esc(x.value)}</span><blockquote dir="auto">${esc(x.quote)}</blockquote></div>`).join("") : `<span class="subtle">Not found in the text</span>`}</dd></div>`; }).join("")}</dl>` : `<p class="muted s-small">No summary yet.</p>`;
  const sg = sugg.length ? `<h4 class="lg-h4">Suggested obligations (accept to track them)</h4><ul class="lg-ul">${sugg.map((x) => `<li class="lg-li"><div style="min-width:0"><span dir="auto">${esc(x.title)}</span> ${lgBadge(kinds[x.kind] || x.kind)} ${lgBadge(x.source === "ai" ? "AI" : "rule", x.source === "ai" ? "accent" : "")}
      <div class="subtle s-small">${x.due_date ? `Due ${esc(x.due_date)}` : "No date"}${x.quote ? ` · <span dir="auto">“${esc(x.quote.slice(0, 160))}”</span>` : ""}</div></div>
    ${edit ? `<div class="row gap-8"><input class="input input-sm" type="date" id="lgsg-${esc(x.id)}" value="${esc(x.due_date || "")}" aria-label="Due date"><button class="btn btn-sm btn-primary" data-lgact="sg-accept" data-id="${esc(x.id)}">Accept</button><button class="btn btn-sm btn-ghost" data-lgact="sg-dismiss" data-id="${esc(x.id)}">Dismiss</button></div>` : ""}</li>`).join("")}</ul>` : "";
  const paste = LG.sumText ? `<div class="field" style="margin-top:10px"><label for="lgsum-text">Contract text</label><textarea class="input lg-paste" id="lgsum-text" dir="auto" maxlength="${esc(LG.meta.text_max)}" placeholder="Paste the contract text here"></textarea></div>` : "";
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Summary</h3><span class="subtle s-small">AI Legal assistant${LG.meta.agent_level === 0 ? " (switched off: rules only)" : ""} · drafts only · not legal advice</span></div>
    ${body}${sg}
    ${edit ? `${paste}<div class="row gap-8 lg-acts"><button class="btn btn-sm btn-primary" data-lgact="summary">${LG.sumText ? "Summarize the pasted text" : s ? "Summarize again" : "Summarize the contract"}</button>${LG.sumText ? "" : `<button class="btn btn-sm btn-ghost" data-lgact="paste">Paste the text instead</button>`}</div>
      <p class="subtle s-small">Reads text files, Word (.docx) and PDFs with a text layer. Scanned PDFs and images: paste the text.</p>` : ""}</section>`;
}
function lgLog(d) {
  const log = (d.log || []).slice().reverse();
  return `<details class="card card-pad"><summary><b>Change log (${log.length})</b></summary><ul class="lg-ul">${log.map((l) => `<li class="lg-li s-small"><span dir="auto">${esc(l.text)}</span><span class="subtle num">${esc(l.by)} · ${esc(String(l.at).slice(0, 16).replace("T", " "))} UTC</span></li>`).join("")}</ul></details>`;
}

/* ------------------------------------------------ what's due, templates, settings */
function lgDue(d) {
  const kinds = { expiry: "Expiry / renewal", notice: "Notice deadline", ...Object.fromEntries(LG.meta.obligation_kinds.map((k) => [k.id, k.name])) };
  const rows = d.items.map((x) => `<tr class="${x.days < 0 ? "lg-over" : ""}"><td class="num">${esc(x.date)}</td><td class="s-small num">${esc(lgDays(x.days))}</td><td>${lgBadge(kinds[x.kind] || x.kind, x.kind === "notice" ? "warn" : x.days < 0 ? "bad" : "")}${x.reminder ? ` <span class="subtle s-small">${esc(x.reminder)}-day reminder</span>` : ""}</td>
    <td><button class="lg-link" data-lgact="open" data-id="${esc(x.document_id)}" dir="auto">${esc(x.document)}</button>${x.restricted ? ` ${lgBadge("restricted", "accent")}` : ""}<div class="subtle s-small" dir="auto">${esc(x.title)}</div></td><td class="s-small">${esc(x.owner_name || "–")}</td></tr>`).join("");
  return `<div class="stack" style="gap:16px"><div class="row gap-8 lg-acts"><label for="lgdays" class="s-small"><b>Show the next</b></label><select class="input input-sm" id="lgdays" style="width:auto">${lgOpts([[30, "30 days"], [90, "90 days"], [120, "120 days"], [365, "12 months"]], LG.days)}</select>
      <span class="subtle s-small">Reminders at ${esc(d.settings.reminder_days.join(", "))} days before expiry; Home lists what expires within ${esc(d.settings.expiring_days)} days and notice deadlines within ${esc(d.settings.notice_window_days)} days.</span></div>
    ${rows ? `<div class="table-wrap card"><table class="f-table lg-table"><thead><tr><th>Date</th><th>When</th><th>What</th><th>Document</th><th>Owner</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="card empty"><p>Nothing due in this window. Add expiry dates and notice periods to documents so renewals show up here.</p></div>`}</div>`;
}
function lgTplFields(t) { return [...new Set([...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter((k) => LG.meta.field_labels[k]); }
function lgTemplates() {
  const m = LG.meta, list = LG.tpl, cur = list.find((t) => t.id === ($("#lgg-tpl")?.value || LG.gen?.tpl)) || list[0];
  const kinds = [["other", "Someone else (type the details)"], ...(m.sources.store ? [["store", "Store CRM store"]] : []), ...(m.sources.customer ? [["customer", "Billing customer"]] : []), ...(m.sources.partner ? [["partner", "Partner"]] : []), ...(m.sources.employee ? [["employee", "Employee (India)"]] : [])].filter(([k]) => cur.counterparty.includes(k));
  const kind = kinds.some(([k]) => k === LG.gen?.kind) ? LG.gen.kind : kinds[0][0];
  const form = lgEdit() ? `<form id="lgGenForm" class="card card-pad lg-form">
    <div class="field"><label for="lgg-tpl">Template</label><select class="input" id="lgg-tpl">${lgOpts(list.map((t) => [t.id, t.name]), cur.id)}</select></div>
    <div class="field"><label for="lgg-kind">Counterparty</label><select class="input" id="lgg-kind">${lgOpts(kinds, kind)}</select></div>
    ${kind === "other" ? `<div class="field"><label for="lgg-name">Name</label><input class="input" id="lgg-name" maxlength="200" dir="auto"></div><div class="field"><label for="lgg-email">Email</label><input class="input" id="lgg-email" type="email" maxlength="200"></div>
      <div class="field lg-wide"><label for="lgg-addr">Address</label><input class="input" id="lgg-addr" maxlength="300" dir="auto"></div>`
      : `<div class="field lg-wide"><label for="lgg-q">Search</label><input class="input" id="lgg-q" autocomplete="off" placeholder="Name or email"><input type="hidden" id="lgg-id"><div id="lgHits" class="lg-hits"></div></div>`}
    ${lgTplFields(cur).map((k) => `<div class="field"><label for="lgg-f-${esc(k)}">${esc(m.field_labels[k])}</label><input class="input" id="lgg-f-${esc(k)}" data-lgfield="${esc(k)}" maxlength="300" dir="auto" placeholder="[ADD] if empty"></div>`).join("")}
    <div class="field lg-wide"><label for="lgg-title">Document title (optional)</label><input class="input" id="lgg-title" maxlength="200" dir="auto"></div>
    <p class="subtle s-small lg-wide">Company details come from Billing → Settings (legal name, VAT and CR numbers, address)${cur.id === "offer_india" ? "; salary from the employee's CTC in Attendance & payroll (Payroll view needed)" : ""}${cur.id === "partner_referral" ? "; commission terms from the partner's agreement in Partners & referrals" : ""}. Anything missing becomes [ADD], and a draft with [ADD] or [CONFIRM] left can't be marked signed.</p>
    <div class="row gap-8 lg-wide"><button class="btn btn-primary" type="submit">Create draft</button></div></form>` : "";
  return `<div class="stack" style="gap:16px">${form}
    <div class="lg-tpls">${list.map((t) => `<details class="card card-pad"><summary><b dir="auto">${esc(t.name)}</b> <span class="subtle s-small">${esc(lgType(t.type))} · ${t.lang === "ar" ? "Arabic" : "English"}</span></summary>
      <pre class="lg-pre" dir="${t.lang === "ar" ? "rtl" : "ltr"}">${esc(t.body)}</pre></details>`).join("")}</div></div>`;
}
function lgSettings() {
  const s = LG.meta.settings, edit = lgEdit();
  return `<form id="lgSetForm" class="card card-pad lg-form">
    <div class="field"><label for="lgs-rem">Reminders (days before expiry)</label><input class="input" id="lgs-rem" value="${esc(s.reminder_days.join(", "))}" ${edit ? "" : "readonly"}><span class="hint">e.g. 90, 30, 7. Shown on each document and in What's due.</span></div>
    <div class="field"><label for="lgs-exp">Home: expiring within (days)</label><input class="input" id="lgs-exp" type="number" min="1" max="365" value="${esc(s.expiring_days)}" ${edit ? "" : "readonly"}></div>
    <div class="field"><label for="lgs-not">Home: notice deadlines within (days)</label><input class="input" id="lgs-not" type="number" min="1" max="120" value="${esc(s.notice_window_days)}" ${edit ? "" : "readonly"}></div>
    <p class="subtle s-small lg-wide">Restricted documents are visible only to the Owner and Admins, everywhere (lists, files, Home, Ask DPA AD). Files are stored privately in DATA_DIR/legal and included in every backup. An employee sees their own signed employment contract in My day.</p>
    ${edit ? `<div class="row gap-8 lg-wide"><button class="btn btn-primary" type="submit">Save settings</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ events */
async function lgUpload(file, kind, note) {
  const q = new URLSearchParams({ filename: file.name || "file", kind, ...(note ? { note } : {}) });
  const res = await fetch(`${lgP()}/documents/${LG.cur.id}/versions?${q}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in again."); }
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
  return res.json();
}
async function lgAct(a, el) {
  const d = LG.cur, id = el.dataset.id;
  if (a === "open") { LG.open = id; LG.tab = "docs"; LG.editing = false; LG.sumText = false; go("legal", id); return; }
  if (a === "back") { LG.open = null; LG.editing = false; go("legal", "docs"); return; }
  if (a === "edit") { LG.editing = true; return lgShow(); }
  if (a === "cancel-edit") { LG.editing = false; return lgShow(); }
  if (a === "delete") { if (!confirm("Delete this document with all its files and obligations? This can't be undone.")) return; await api(`${lgP()}/documents/${d.id}`, { method: "DELETE" }); LG.open = null; toast("Document deleted"); go("legal", "docs"); return; }
  if (a === "sig-del") { if (!confirm("Remove this signature from the log?")) return; await api(`${lgP()}/documents/${d.id}/signatures/${id}`, { method: "DELETE" }); return lgShow(); }
  if (a === "obl-done") { await lgPost(`/obligations/${id}/done`); toast("Done"); return lgShow(); }
  if (a === "obl-del") { await api(`${lgP()}/obligations/${id}`, { method: "DELETE" }); return lgShow(); }
  if (a === "paste") { LG.sumText = true; return lgShow(); }
  if (a === "summary") {
    const text = $("#lgsum-text")?.value.trim();
    if (LG.sumText && !text) return toast("Paste the contract text first", true);
    el.disabled = true; el.textContent = "Reading…";
    try { const r = await lgPost(`/documents/${d.id}/summary`, text ? { text } : {}); LG.sumText = false; toast(r.summary.by_ai ? "Summary drafted: check every quote" : "Sentences found by rules: read them"); }
    catch (err) { if (/Paste/i.test(err.message)) LG.sumText = true; toast(err.message, true); }
    return lgShow();
  }
  if (a === "sg-accept") { await lgPost(`/documents/${d.id}/suggestions/${id}/accept`, { due_date: $(`#lgsg-${id}`)?.value || null }); toast("Added to obligations"); return lgShow(); }
  if (a === "sg-dismiss") { await lgPost(`/documents/${d.id}/suggestions/${id}/dismiss`); return lgShow(); }
}
let lgTimer = null;
document.addEventListener("input", (e) => {
  if (S.route !== "legal" || e.target.id !== "lgg-q") return;
  $("#lgg-id").value = "";
  clearTimeout(lgTimer);
  const q = e.target.value.trim();
  lgTimer = setTimeout(async () => {
    const box = $("#lgHits"); if (!box) return;
    try { const r = await api(`${lgP()}/counterparties?kind=${encodeURIComponent($("#lgg-kind").value)}&q=${encodeURIComponent(q)}`); box.innerHTML = r.rows.length ? r.rows.map((x) => `<button type="button" class="lg-hit" data-lghit="${esc(x.id)}" dir="auto">${esc(x.label)}</button>`).join("") : `<span class="subtle s-small">Nothing found</span>`; } catch (err) { box.innerHTML = `<span class="subtle s-small">${esc(err.message)}</span>`; }
  }, 250);
});
document.addEventListener("change", (e) => {
  if (S.route !== "legal") return;
  if (e.target.id === "lgdays") { LG.days = Number(e.target.value); lgShow(); }
  if (e.target.id === "lgg-tpl" || e.target.id === "lgg-kind") { LG.gen = { tpl: $("#lgg-tpl").value, kind: $("#lgg-kind").value }; const box = $("#lgBody"); if (box) box.innerHTML = lgBanner() + lgTemplates(); }
});
document.addEventListener("click", async (e) => {
  if (S.route !== "legal") return;
  const t = e.target.closest("[data-lgtab]");
  if (t) { LG.tab = t.dataset.lgtab; LG.open = null; go("legal", LG.tab); return; }
  const h = e.target.closest("[data-lghit]");
  if (h) { $("#lgg-id").value = h.dataset.lghit; $("#lgg-q").value = h.textContent.trim(); $("#lgHits").innerHTML = ""; return; }
  const b = e.target.closest("[data-lgact]");
  if (b) { e.preventDefault(); try { await lgAct(b.dataset.lgact, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "legal") return;
  const f = e.target;
  if (!f.matches("#lgForm, #lgFilter, #lgUpForm, #lgSigForm, #lgOblForm, #lgGenForm, #lgSetForm")) return;
  e.preventDefault();
  const v = (s) => $(s)?.value ?? "";
  try {
    if (f.id === "lgFilter") { LG.filter = { q: v("#lgq").trim(), type: v("#lgft"), status: v("#lgfs"), state: v("#lgfe") }; return lgShow(); }
    if (f.id === "lgForm") {
      const body = lgReadForm();
      if (f.dataset.id) { await lgPut(`/documents/${f.dataset.id}`, body); LG.editing = false; toast("Saved"); await lgShow(); }
      else { const d = await lgPost("/documents", body); toast("Document added: upload its file next"); go("legal", d.id); }
    }
    if (f.id === "lgUpForm") {
      const file = $("#lgu-file").files[0]; if (!file) return toast("Pick a file first", true);
      if (file.size > LG.meta.max_mb * 1048576) return toast(`Too big: up to ${LG.meta.max_mb} MB`, true);
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Uploading…";
      try { await lgUpload(file, v("#lgu-kind"), v("#lgu-note").trim()); toast(v("#lgu-kind") === "signed" ? "Signed copy uploaded: record the signature below" : "New version uploaded"); } finally { btn.disabled = false; btn.textContent = "Upload"; }
      await lgShow();
    }
    if (f.id === "lgSigForm") { await lgPost(`/documents/${LG.cur.id}/signatures`, { signer_name: v("#lgs-name"), signer_email: v("#lgs-email"), party: v("#lgs-party"), signed_at: v("#lgs-date"), method: v("#lgs-method"), method_note: v("#lgs-note"), version: Number(v("#lgs-ver")) }); toast("Signature recorded"); await lgShow(); }
    if (f.id === "lgOblForm") { await lgPost(`/documents/${LG.cur.id}/obligations`, { title: v("#lgo-title"), kind: v("#lgo-kind"), due_date: v("#lgo-due") || null, repeat: v("#lgo-rep") }); toast("Added"); await lgShow(); }
    if (f.id === "lgGenForm") {
      const kind = v("#lgg-kind");
      const cp = kind === "other" ? { kind, name: v("#lgg-name"), email: v("#lgg-email"), address: v("#lgg-addr") } : { kind, id: v("#lgg-id") };
      if (kind !== "other" && !cp.id) return toast("Search and pick the counterparty first", true);
      const fields = Object.fromEntries([...f.querySelectorAll("[data-lgfield]")].map((i) => [i.dataset.lgfield, i.value.trim()]).filter(([, x]) => x));
      const d = await lgPost("/generate", { template_id: v("#lgg-tpl"), counterparty: cp, fields, title: v("#lgg-title").trim() || undefined });
      toast(`Draft created: ${d.generated.placeholders.add} [ADD] and ${d.generated.placeholders.confirm} [CONFIRM] left`); go("legal", d.id);
    }
    if (f.id === "lgSetForm") { await lgPut("/settings", { reminder_days: v("#lgs-rem"), expiring_days: Number(v("#lgs-exp")), notice_window_days: Number(v("#lgs-not")) }); toast("Settings saved"); await lgShow(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "legal" && S.ws) render();
