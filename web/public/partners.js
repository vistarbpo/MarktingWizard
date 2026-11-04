/* Partners & referrals: partners (agencies, freelancers/creators, platform and tech partners, resellers, customer
   referrers) on a pipeline board by status, each with referral links (/r/<code>), its funnel (clicks, leads, trials,
   paying; MRR only with Billing view), attributed stores, deals and customers, commission lines from Billing,
   statements (draft → approved by Owner/Finance → paid), a read-only portal link, AI drafts (Partnerships manager,
   drafts only) and a change log. Uses app.js globals (S, $, api, esc, toast, ROUTES, levelFor, go). Names start with "pt". */

const PT = { tab: "list", meta: null, list: null, cur: null, open: null, att: null, sts: null, hits: [], cps: null, cpOpen: null, cpEdit: null, cpPre: null, curCps: [] };
const PT_TABS = [["list", "Partners"], ["coupons", "Coupons"], ["attribution", "Attribution"], ["statements", "Statements"], ["settings", "Settings"]];
const PT_CP_TONE = { active: "good", paused: "", expired: "bad", ended: "", stopped: "", removed: "" };
const PT_TONE = { prospect: "", talking: "accent", signed: "warn", active: "good", paused: "", ended: "bad", draft: "warn", approved: "accent", paid: "good", void: "" };
const PT_DOT = { prospect: "#94a3b8", talking: "#3b82f6", signed: "#f59e0b", active: "#16a34a", paused: "#a3a3a3", ended: "#ef4444" };
const ptP = () => `/api/workspaces/${S.ws.id}/partners`;
const ptEdit = () => levelFor("partners") === "edit";
const ptPost = (p, b) => api(`${ptP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const ptPut = (p, b) => api(`${ptP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const ptOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const ptBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;
const ptSar = (n) => (n === null || n === undefined ? "–" : `SAR ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const ptType = (id) => PT.meta?.types.find((t) => t.id === id)?.name.replace(/ \(.*$/, "") || id;
const ptStatus = (id) => PT.meta?.statuses.find((s) => s.id === id)?.name || id;
const ptTile = (l, v, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(l)}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`;

ROUTES.partners = { title: "Partners & referrals", crumb: "Grow", render: renderPartners };

async function renderPartners(view) {
  if (PT_TABS.some(([k]) => k === S.param)) { PT.tab = S.param; PT.open = null; }
  else if (S.param && /^\d+$/.test(S.param)) { PT.tab = "list"; PT.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs pt-tabs" role="tablist" aria-label="Partners views">${PT_TABS.map(([k, l]) => `<button role="tab" data-pttab="${k}" aria-selected="${PT.tab === k}">${l}</button>`).join("")}</div>
    <div id="ptBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { PT.meta = await api(`${ptP()}/meta`); } catch (e) { $("#ptBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await ptShow();
}
async function ptShow() {
  if (S.route !== "partners") return;
  document.querySelectorAll("[data-pttab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.pttab === PT.tab));
  const box = $("#ptBody"); if (!box) return;
  try {
    if (PT.tab === "attribution") { PT.att = await api(`${ptP()}/attribution`); if (!PT.list) PT.list = await api(ptP()); box.innerHTML = ptAttribution(); return; }
    if (PT.tab === "coupons") { PT.cps = await api(`${ptP()}/coupons`); if (PT.cpOpen) { const c = await api(`${ptP()}/coupons/${PT.cpOpen}`).catch(() => null); if (c) { box.innerHTML = ptCpDetail(c); return; } PT.cpOpen = null; } box.innerHTML = ptCoupons(); return; }
    if (PT.tab === "statements") { PT.sts = await api(`${ptP()}/statements`); box.innerHTML = ptStatements(PT.sts.statements, true); return; }
    if (PT.tab === "settings") { PT.meta = await api(`${ptP()}/meta`); box.innerHTML = ptSettings(); return; }
    if (PT.open) { const p = await api(`${ptP()}/${PT.open}`).catch(() => null); if (p) { PT.cur = p; PT.curCps = (await api(`${ptP()}/coupons?partner_id=${encodeURIComponent(p.id)}`).catch(() => ({ coupons: [] }))).coupons; box.innerHTML = ptDetail(p); return; } PT.open = null; }
    PT.list = await api(ptP()); box.innerHTML = ptList();
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ list: tiles, new partner, board by status */
function ptList() {
  const d = PT.list, t = d.totals, meta = PT.meta;
  const signed = d.partners.filter((p) => ["signed", "active"].includes(p.status)).length;
  const tiles = [ptTile("Partners", d.partners.length, `${signed} signed or active`), ptTile("Clicks", t.clicks, "unique per visitor and day"), ptTile("Leads", t.leads, "stores and deals attributed"),
    ptTile("Paying customers", t.paying, `${t.trials} in trial`), ...(d.mrr ? [ptTile("MRR referred", ptSar(t.mrr_sar), "from Billing")] : []),
    ...(d.money ? [ptTile("Statements to approve", d.statements.draft, `${d.statements.approved} approved, not paid`, d.statements.draft ? "warn" : "")] : [])];
  const add = ptEdit() ? `<details class="card card-pad pt-new" ${d.partners.length ? "" : "open"}><summary><b>New partner</b></summary>${ptForm(null)}</details>` : "";
  const cols = meta.statuses.map((s) => {
    const list = d.partners.filter((p) => p.status === s.id);
    return `<section class="s-col pt-col" aria-label="${esc(s.name)}"><div class="s-col-head"><h3 class="s-small" style="margin:0"><span class="s-dot" style="background:${PT_DOT[s.id]}"></span>${esc(s.name)}</h3><span class="subtle s-small num">${list.length}</span></div>
      ${list.map((p) => `<button class="s-card pt-card" data-ptact="open" data-id="${esc(p.id)}"><span class="row between gap-8" style="align-items:flex-start"><b dir="auto" class="pt-name">${esc(p.name)}</b>${p.sample ? ptBadge("sample", "warn") : ""}</span>
        <span class="subtle s-small">${esc(ptType(p.type))}${p.city ? ` · <span dir="auto">${esc(p.city)}</span>` : ""}</span>
        <span class="pt-stats s-small"><span><b class="num">${p.stats.clicks}</b> clicks</span><span><b class="num">${p.stats.leads}</b> leads</span><span><b class="num">${p.stats.paying}</b> paying</span>${p.stats.mrr_sar !== undefined ? `<span class="num">${esc(ptSar(p.stats.mrr_sar))}</span>` : ""}</span></button>`).join("") || `<p class="subtle s-small pt-empty">None</p>`}</section>`;
  }).join("");
  return `<section class="s-kpis">${tiles.join("")}</section>
    <div class="stack" style="gap:16px;margin-top:16px">${add}
    ${d.partners.length ? `<div class="pt-board">${cols}</div>` : `<div class="card empty"><p>No partners yet. Add an agency, a creator or the Salla/Zid app stores: each partner gets a referral link right away.</p></div>`}</div>`;
}
function ptForm(p) {
  const m = PT.meta, a = p?.agreement || {}, c = p?.contact || {};
  const money = m.money;
  return `<form id="ptForm" class="pt-form" data-id="${esc(p?.id || "")}" style="margin-top:12px">
    <div class="field pt-wide"><label for="ptf-name">Name</label><input class="input" id="ptf-name" required maxlength="200" dir="auto" value="${esc(p?.name || "")}" placeholder="e.g. Najd Digital Agency"></div>
    <div class="field"><label for="ptf-type">Type</label><select class="input" id="ptf-type">${ptOpts(m.types.map((t) => [t.id, t.name]), p?.type || "agency")}</select></div>
    <div class="field"><label for="ptf-status">Status</label><select class="input" id="ptf-status">${ptOpts(m.statuses.map((s) => [s.id, s.name]), p?.status || "prospect")}</select></div>
    <div class="field"><label for="ptf-owner">Owner</label><select class="input" id="ptf-owner">${ptOpts(m.people.map((x) => [x.id, x.name]), p?.owner_id || "", "–")}</select></div>
    <div class="field"><label for="ptf-city">City</label><input class="input" id="ptf-city" maxlength="80" dir="auto" value="${esc(p?.city || "")}"></div>
    <div class="field"><label for="ptf-country">Country</label><input class="input" id="ptf-country" maxlength="60" value="${esc(p?.country || "SA")}"></div>
    <div class="field"><label for="ptf-cname">Contact name</label><input class="input" id="ptf-cname" maxlength="120" dir="auto" value="${esc(c.name || "")}"></div>
    <div class="field"><label for="ptf-cemail">Contact email</label><input class="input" id="ptf-cemail" type="email" maxlength="200" value="${esc(c.email || "")}"></div>
    <div class="field"><label for="ptf-cphone">Contact phone</label><input class="input" id="ptf-cphone" maxlength="40" value="${esc(c.phone || "")}" placeholder="+966…"></div>
    ${money ? `<fieldset class="pt-fs pt-wide"><legend>Agreement</legend><div class="pt-agree">
      <div class="field"><label for="ptf-pct">Commission %</label><input class="input" id="ptf-pct" type="number" min="0" max="100" step="0.5" value="${esc(a.commission_pct ?? 0)}"></div>
      <div class="field"><label for="ptf-months">Recurring months</label><input class="input" id="ptf-months" type="number" min="0" max="60" value="${esc(a.recurring_months ?? 0)}"></div>
      <div class="field"><label for="ptf-bounty">Flat bounty (SAR)</label><input class="input" id="ptf-bounty" type="number" min="0" step="1" value="${esc(a.bounty_sar ?? 0)}"></div>
      <div class="field"><label for="ptf-tier">Tier</label><input class="input" id="ptf-tier" maxlength="40" dir="auto" value="${esc(a.tier || "")}"></div></div>
      <span class="hint">Percent of each payment before VAT, for the first N months from the customer's first payment; or a flat bounty on the first payment. ${esc(m.tax_note)}</span></fieldset>` : ""}
    ${m.billing ? `<div class="field"><label for="ptf-cust">Billing customer (customer referrers)</label><select class="input" id="ptf-cust">${ptOpts(m.customers.map((x) => [x.id, x.label]), p?.customer_id || "", "–")}</select></div>` : ""}
    <div class="field"><label for="ptf-contract">Contract link</label><input class="input" id="ptf-contract" maxlength="1000" value="${esc(p?.contract?.url || "")}" placeholder="https://…"></div>
    <div class="field"><label for="ptf-media">or Creative Studio media id</label><input class="input" id="ptf-media" maxlength="40" value="${esc(p?.contract?.media_id || "")}"></div>
    <div class="field pt-wide"><label for="ptf-notes">Notes</label><textarea class="input" id="ptf-notes" rows="2" maxlength="4000" dir="auto">${esc(p?.notes || "")}</textarea></div>
    <div class="row gap-8 pt-wide"><button class="btn btn-primary" type="submit">${p ? "Save" : "Add partner"}</button>${p ? `<button class="btn" type="button" data-ptact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}
function ptReadForm() {
  const v = (s) => $(s)?.value ?? "";
  const b = { name: v("#ptf-name"), type: v("#ptf-type"), status: v("#ptf-status"), owner_id: v("#ptf-owner") || null, city: v("#ptf-city"), country: v("#ptf-country"), notes: v("#ptf-notes"),
    contact: { name: v("#ptf-cname"), email: v("#ptf-cemail"), phone: v("#ptf-cphone") }, contract: { url: v("#ptf-contract").trim(), media_id: v("#ptf-media").trim() || null } };
  if ($("#ptf-pct")) b.agreement = { commission_pct: v("#ptf-pct"), recurring_months: v("#ptf-months"), bounty_sar: v("#ptf-bounty"), tier: v("#ptf-tier") };
  if ($("#ptf-cust")) b.customer_id = v("#ptf-cust") || null;
  return b;
}

/* ------------------------------------------------ one partner */
function ptDetail(p) {
  const edit = p.can_edit && ptEdit(), f = p.stats, a = p.agreement || {};
  const terms = !p.money ? "Hidden for your role" : a.commission_pct ? `${a.commission_pct}% for ${a.recurring_months} months` : a.bounty_sar ? `${ptSar(a.bounty_sar)} bounty on the first payment` : "No terms yet";
  const head = PT.editing && edit ? `<section class="card card-pad">${ptForm(p)}</section>` : `<section class="card card-pad pt-head">
    <div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:0"><button class="pt-link s-small" data-ptact="back">← All partners</button>
      <h2 style="margin:6px 0 0" dir="auto">${esc(p.name)}</h2>
      <div class="pt-meta subtle s-small"><span>${esc(ptType(p.type))}</span>${ptBadge(ptStatus(p.status), PT_TONE[p.status])}${p.city ? `<span dir="auto">${esc(p.city)}, ${esc(p.country)}</span>` : ""}${a.tier ? `<span>Tier: <span dir="auto">${esc(a.tier)}</span></span>` : ""}${p.sample ? ptBadge("sample", "warn") : ""}</div>
      <div class="pt-meta s-small"><span>Terms: ${esc(terms)}</span>${p.contact?.name || p.contact?.email ? `<span>Contact: <span dir="auto">${esc([p.contact.name, p.contact.email, p.contact.phone].filter(Boolean).join(" · "))}</span></span>` : ""}
        ${p.contract?.url ? `<a href="${esc(p.contract.url)}" target="_blank" rel="noopener noreferrer">Contract</a>` : ""}${p.contract?.media_url ? `<a href="${esc(p.contract.media_url)}" target="_blank" rel="noopener noreferrer">Contract (Studio media)</a>` : ""}
        ${p.customer_info ? `<span>Customer: <span dir="auto">${esc(p.customer_info.label)}</span></span>` : ""}${p.store_info ? `<span>CRM store: <span dir="auto">${esc(p.store_info.label)}</span></span>` : ""}</div>
      ${p.notes ? `<p class="s-small pt-text" dir="auto">${esc(p.notes)}</p>` : ""}</div>
      ${edit ? `<div class="row gap-8"><button class="btn btn-sm" data-ptact="edit">Edit</button><button class="btn btn-sm btn-ghost btn-danger" data-ptact="delete">Delete</button></div>` : ""}</div></section>`;
  const tiles = [ptTile("Clicks", f.clicks, `${f.hits} visits in all`), ptTile("Leads", f.leads, `${f.stores} stores, ${f.deals} deals`), ptTile("Trials", f.trials, "Billing customers in trial"), ptTile("Paying", f.paying, `${f.customers} customer${f.customers === 1 ? "" : "s"} referred`),
    ...(f.mrr_sar !== undefined ? [ptTile("MRR referred", ptSar(f.mrr_sar), "paying customers")] : [])];
  return `<div class="stack" style="gap:16px">${head}<section class="s-kpis">${tiles.join("")}</section>${ptLinks(p, edit)}${ptCpOfPartner(p, edit)}${ptAttributed(p)}${p.money ? ptLines(p) : ""}
    ${p.statements.length ? `<section class="card card-pad"><h3 style="margin:0">Statements</h3>${ptStatements(p.statements, false)}</section>` : ""}
    ${ptPortal(p, edit)}${ptDrafts(p, edit)}${ptLog(p)}</div>`;
}
function ptLinks(p, edit) {
  const rows = p.codes.map((c) => `<li class="pt-row"><div style="min-width:0"><code class="pt-code">${esc(c.link)}</code>${c.active ? "" : ` ${ptBadge("off")}`}</div>
    <div class="row gap-8"><button class="btn btn-sm" data-ptact="copy" data-text="${esc(c.link)}">Copy</button>${edit ? `<button class="btn btn-sm btn-ghost" data-ptact="code-toggle" data-id="${esc(c.id)}" data-on="${c.active ? "0" : "1"}">${c.active ? "Switch off" : "Switch on"}</button>` : ""}</div></li>`).join("");
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Referral links</h3><span class="subtle s-small">Adds utm_source=partner, utm_medium=referral, utm_campaign=&lt;code&gt; and a ${esc(PT.meta.settings.cookie_days)}-day cookie</span></div>
    ${rows ? `<ul class="pt-list">${rows}</ul>` : `<p class="muted s-small">No link yet.</p>`}
    ${edit ? `<form id="ptCodeForm" class="pt-inline"><input class="input input-sm" id="ptc-code" maxlength="32" placeholder="code (optional), e.g. najd-ramadan" aria-label="Code"><input class="input input-sm" id="ptc-land" maxlength="500" placeholder="Landing page (optional, ${esc(PT.meta.settings.allowed_hosts.join(", "))})" aria-label="Landing page"><button class="btn btn-sm" type="submit">Add link</button></form>` : ""}</section>`;
}
function ptAttributed(p) {
  const kind = { store: "Store", deal: "Deal", customer: "Customer" };
  return `<section class="card card-pad"><h3 style="margin:0">Referred</h3>${p.attributed.length ? `<div class="table-wrap"><table class="f-table pt-table"><thead><tr><th>Record</th><th>Kind</th><th>How</th><th>Code</th></tr></thead><tbody>
    ${p.attributed.map((x) => `<tr><td dir="auto">${esc(x.label)}</td><td>${esc(kind[x.kind])}</td><td>${ptBadge(x.source, x.source === "manual" ? "accent" : "")}</td><td><code>${esc(x.code)}</code></td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted s-small">Nothing attributed yet. Stores arriving with this code (the signup form's <code>ref</code> field, the referral cookie or <code>utm_campaign</code>) appear here; you can also attribute a store, deal or customer in the Attribution tab.</p>`}</section>`;
}
function ptLines(p) {
  const total = p.lines.reduce((s, l) => s + l.amount_sar, 0);
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Commission lines</h3><span class="subtle s-small">From Billing payments and credit notes only · total ${esc(ptSar(total))}</span></div>
    ${p.lines.length ? `<div class="table-wrap"><table class="f-table pt-table"><thead><tr><th>Date</th><th>Customer</th><th>What</th><th class="num">Base</th><th class="num">Commission</th></tr></thead><tbody>
    ${p.lines.map((l) => `<tr><td class="num">${esc(l.date)}</td><td dir="auto">${esc(l.customer)}</td><td class="s-small">${esc(l.note)}</td><td class="num">${esc(l.base_sar === null ? "–" : ptSar(l.base_sar))}</td><td class="num">${esc(ptSar(l.amount_sar))}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted s-small">No commission yet: lines appear when an attributed customer pays in Billing.</p>`}</section>`;
}
function ptStatements(list, full) {
  const can = PT.meta.can_approve, money = PT.meta.money;
  const gen = full && money && ptEdit() ? `<form id="ptGenForm" class="pt-inline card card-pad"><label for="ptg-month" class="s-small"><b>Month</b></label><input class="input input-sm" type="month" id="ptg-month" value="${esc(PT.meta.today.slice(0, 7))}" max="${esc(PT.meta.today.slice(0, 7))}"><button class="btn btn-sm btn-primary" type="submit">Draft statements</button>
    <span class="subtle s-small">One per partner with commission lines not on a statement yet. Approving and paying needs the Owner or Finance Edit.</span></form>` : "";
  const rows = list.map((s) => `<details class="pt-st card ${full ? "" : "pt-st-flat"}"><summary class="pt-st-sum"><span dir="auto"><b>${esc(s.partner_name)}</b> · <span class="num">${esc(s.month)}</span></span><span class="row gap-8">${ptBadge(s.status, PT_TONE[s.status])}<b class="num">${esc(ptSar(s.total_sar))}</b></span></summary>
    <div class="pt-st-body">${s.hidden_money ? `<p class="subtle s-small">Amounts are hidden for your role.</p>` : `<div class="table-wrap"><table class="f-table pt-table"><thead><tr><th>Date</th><th>Customer</th><th>What</th><th class="num">Amount</th></tr></thead><tbody>${s.lines.map((l) => `<tr><td class="num">${esc(l.date)}</td><td dir="auto">${esc(l.customer)}</td><td class="s-small">${esc(l.note)}</td><td class="num">${esc(ptSar(l.amount_sar))}</td></tr>`).join("")}</tbody></table></div>`}
      <p class="subtle s-small">${esc(s.tax_note || PT.meta.tax_note)}</p>
      ${s.status === "paid" ? `<p class="s-small">Paid ${esc(s.paid_date)} · ref <span dir="auto">${esc(s.paid_reference)}</span> · posted to Finance</p>` : ""}${s.status === "void" ? `<p class="s-small">Void: <span dir="auto">${esc(s.void_reason || "")}</span></p>` : ""}${s.approved_by ? `<p class="subtle s-small">Approved by ${esc(s.approved_by)}</p>` : ""}
      ${can && ptEdit() && ["draft", "approved"].includes(s.status) ? `<div class="row gap-8 pt-acts">${s.status === "draft" ? `<button class="btn btn-sm btn-primary" data-ptact="st-approve" data-id="${esc(s.id)}">Approve</button>` : `<input class="input input-sm" type="date" id="ptpd-${esc(s.id)}" value="${esc(PT.meta.today)}" aria-label="Paid on"><input class="input input-sm" id="ptpr-${esc(s.id)}" maxlength="120" placeholder="Bank reference" aria-label="Bank reference"><button class="btn btn-sm btn-primary" data-ptact="st-pay" data-id="${esc(s.id)}">Mark paid</button>`}<button class="btn btn-sm btn-ghost btn-danger" data-ptact="st-void" data-id="${esc(s.id)}">Void</button></div>` : ""}</div></details>`).join("");
  return `${gen}${list.length ? `<div class="stack pt-sts" style="gap:8px;margin-top:${full ? "16px" : "8px"}">${rows}</div>` : full ? `<div class="card empty" style="margin-top:16px"><p>No statements yet. Draft them at the start of each month from Billing payments of referred customers.</p></div>` : ""}`;
}
function ptPortal(p, edit) {
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Partner portal</h3><span class="subtle s-small">Read-only page: link, clicks, counts, approved and paid statements${PT.meta.settings.portal_show_names ? ", customer names" : " (no customer names)"}</span></div>
    ${p.portal_url ? `<p><code class="pt-code">${esc(p.portal_url)}</code></p>` : `<p class="muted s-small">No portal link. Anyone with the link can see this partner's page, so share it only with the partner.</p>`}
    ${edit ? `<div class="row gap-8">${p.portal_url ? `<button class="btn btn-sm" data-ptact="copy" data-text="${esc(p.portal_url)}">Copy</button><button class="btn btn-sm" data-ptact="portal">New link</button><button class="btn btn-sm btn-ghost btn-danger" data-ptact="portal-off">Revoke</button>` : `<button class="btn btn-sm" data-ptact="portal">Create portal link</button>`}</div>` : ""}</section>`;
}
function ptDrafts(p, edit) {
  const kinds = PT.meta.draft_kinds, crm = levelFor("crm") === "edit" && p.store_info && !p.store_info.missing;
  const card = (d) => `<div class="pt-draft" data-draft="${esc(d.id)}"><div class="row between gap-8" style="flex-wrap:wrap"><b class="s-small">${esc(kinds.find((k) => k.id === d.kind)?.name || d.kind)}</b>
      <span class="s-small">${ptBadge(d.status, d.status === "used" ? "good" : d.status === "discarded" ? "" : "warn")} <span class="subtle">${d.by_ai ? "AI Partnerships manager" : "Template"} · ${esc(String(d.created_at).slice(0, 10))}</span></span></div>
    ${d.note ? `<p class="pt-note s-small">${esc(d.note)}</p>` : ""}
    <input class="input input-sm pt-dsub" dir="auto" value="${esc(d.subject)}" aria-label="Subject" ${edit && d.status === "draft" ? "" : "readonly"}>
    <textarea class="input pt-dbody" dir="auto" aria-label="Email" ${edit && d.status === "draft" ? "" : "readonly"}>${esc(d.body)}</textarea>
    ${d.sent ? `<p class="s-small">${ptBadge(d.sent.status === "test" ? "Logged in Test mode (not sent)" : d.sent.status, d.sent.status === "sent" ? "good" : "")}</p>` : ""}
    ${edit && d.status === "draft" ? `<div class="row gap-8 pt-acts"><button class="btn btn-sm" data-ptact="d-copy" data-id="${esc(d.id)}">Copy and mark used</button>${crm ? `<button class="btn btn-sm btn-primary" data-ptact="d-send" data-id="${esc(d.id)}">Send via Store CRM</button>` : ""}<button class="btn btn-sm btn-ghost" data-ptact="d-discard" data-id="${esc(d.id)}">Discard</button></div>` : ""}</div>`;
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Emails</h3><span class="subtle s-small">Arabic first, then English. Drafted only; [ADD] where something is missing.</span></div>
    ${edit ? `<div class="row gap-8 pt-acts">${kinds.map((k) => `<button class="btn btn-sm" data-ptact="ai" data-kind="${esc(k.id)}">${esc(k.name)}</button>`).join("")}</div>` : ""}
    ${p.drafts.length ? `<div class="stack" style="gap:12px;margin-top:12px">${p.drafts.map(card).join("")}</div>` : ""}
    <p class="subtle s-small">${p.store_info ? "Sending uses the Store CRM: Test mode only logs it, opted-out and sample stores are never sent, live email goes out 09:00–21:00 Riyadh (not Friday)." : "Link the partner to a Store CRM store (Edit) to send from the CRM, or copy the email."}</p></section>`;
}
function ptLog(p) {
  const log = (p.log || []).slice().reverse();
  return `<details class="card card-pad"><summary><b>Change log (${log.length})</b></summary><ul class="pt-list">${log.map((l) => `<li class="pt-row s-small"><span dir="auto">${esc(l.text)}</span><span class="subtle num">${esc(l.by)} · ${esc(String(l.at).slice(0, 16).replace("T", " "))} UTC</span></li>`).join("")}</ul></details>`;
}

/* ------------------------------------------------ coupons: list, create/edit, one coupon with its redemptions */
const ptCpTerms = (c) => esc(c.terms_text || "");
const ptCpScope = (c) => `${c.plans?.length ? c.plans.map(esc).join(", ") : "All plans"} · ${c.cycles === "both" ? "monthly and yearly" : esc(c.cycles)}${c.first_time_only ? " · first-time customers" : ""}`;
const ptCpValid = (c) => (c.valid_from || c.valid_until ? `${esc(c.valid_from || "…")} → ${esc(c.valid_until || "no end")}` : "Always");
function ptCpOfPartner(p, edit) {
  const list = PT.curCps || [];
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Coupons</h3><span class="subtle s-small">A code the partner gives to stores: a discount for the store, and the customer is attributed to this partner</span></div>
    ${list.length ? `<ul class="pt-list">${list.map((c) => `<li class="pt-row"><div style="min-width:0"><button class="pt-link" data-ptact="cp-open" data-id="${esc(c.id)}"><code class="pt-code">${esc(c.code)}</code></button> ${ptBadge(c.state, PT_CP_TONE[c.state])} <span class="s-small">${ptCpTerms(c)}</span>
      <div class="subtle s-small">${ptCpScope(c)} · ${ptCpValid(c)} · ${c.stats.redemptions} redeemed${c.stats.discount_sar !== undefined ? ` · ${esc(ptSar(c.stats.discount_sar))} discount given` : ""}</div></div>
      <div class="row gap-8"><button class="btn btn-sm" data-ptact="copy" data-text="${esc(c.code)}">Copy</button></div></li>`).join("")}</ul>` : `<p class="muted s-small">No coupon yet.</p>`}
    ${edit ? `<div class="row gap-8 pt-acts"><button class="btn btn-sm" data-ptact="cp-new-for" data-id="${esc(p.id)}">New coupon for this partner</button></div>` : ""}</section>`;
}
function ptCoupons() {
  const d = PT.cps, list = d.coupons, edit = d.edit;
  const tot = list.reduce((a, c) => ({ r: a.r + c.stats.redemptions, act: a.act + c.stats.active_customers, disc: a.disc + (c.stats.discount_sar || 0), list: a.list + (c.stats.mrr_list_sar || 0), paid: a.paid + (c.stats.mrr_paid_sar || 0) }), { r: 0, act: 0, disc: 0, list: 0, paid: 0 });
  const tiles = [ptTile("Coupons", list.length, `${list.filter((c) => c.state === "active").length} active`), ptTile("Redemptions", tot.r, `${tot.act} active customers`),
    ...(d.money ? [ptTile("Discount given", ptSar(tot.disc), "on issued invoices, before VAT"), ptTile("MRR list vs paid", ptSar(tot.list), `paid ${ptSar(tot.paid)} while coupons run`)] : [])];
  const form = edit ? `<details class="card card-pad pt-new" ${PT.cpEdit || PT.cpPre || !list.length ? "open" : ""}><summary><b>${PT.cpEdit ? `Edit coupon ${esc(PT.cpEdit.code)}` : "New coupon"}</b></summary>${ptCpForm(PT.cpEdit, PT.cpPre)}</details>` : "";
  const rows = list.map((c) => `<tr><td><button class="pt-link" data-ptact="cp-open" data-id="${esc(c.id)}"><code>${esc(c.code)}</code></button>${c.sample ? ` ${ptBadge("sample", "warn")}` : ""}</td><td dir="auto">${c.partner_name ? esc(c.partner_name) : `<span class="subtle">Company coupon</span>`}</td>
    <td class="s-small">${ptCpTerms(c)}<div class="subtle">${ptCpScope(c)}</div></td><td class="num s-small">${ptCpValid(c)}</td><td>${ptBadge(c.state, PT_CP_TONE[c.state])}${c.not_yet_valid ? ` ${ptBadge("not yet valid")}` : ""}</td>
    <td class="num">${c.stats.redemptions}${c.max_redemptions ? ` / ${c.max_redemptions}` : ""}</td><td class="num">${c.stats.active_customers}</td>${d.money ? `<td class="num">${esc(ptSar(c.stats.discount_sar))}</td><td class="num s-small">${esc(ptSar(c.stats.mrr_list_sar))}<div class="subtle">paid ${esc(ptSar(c.stats.mrr_paid_sar))}</div></td>` : ""}
    <td class="bl-acts">${edit && c.state !== "expired" ? `<button class="btn btn-sm btn-ghost" data-ptact="cp-toggle" data-id="${esc(c.id)}" data-on="${c.state === "paused" ? "1" : "0"}">${c.state === "paused" ? "Resume" : "Pause"}</button>` : ""}</td></tr>`).join("");
  return `<div class="stack" style="gap:16px"><section class="s-kpis">${tiles.join("")}</section>${form}
    ${list.length ? `<div class="table-wrap card"><table class="f-table pt-table pt-cp-table"><thead><tr><th>Code</th><th>Partner</th><th>Discount</th><th>Valid (Riyadh)</th><th>State</th><th class="num">Redeemed</th><th class="num">Active</th>${d.money ? `<th class="num">Discount given</th><th class="num">MRR list / paid</th>` : ""}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="card empty"><p>No coupons yet. A coupon gives a store a discount on its subscription invoices; a partner's coupon also attributes the customer to the partner.</p></div>`}
    <p class="subtle s-small">Stores type the code at signup on dpa.ad (checked at <code>/hooks/coupon/&lt;code&gt;</code>, kept on the CRM store by the lead hook) or the team enters it in Billing. One coupon per customer, no stacking. Above ${esc(d.owner_pct)}% or forever needs the Owner. Discounts are on invoices (revenue is already net), never Finance expenses.</p></div>`;
}
function ptCpForm(c, pre) {
  const d = PT.cps, v = c || { discount_type: "percent", duration: "once", cycles: "both", first_time_only: true, plans: [], ...(pre || {}) };
  const locked = !!(c && c.stats.redemptions > 0);
  return `<form id="ptCpForm" class="pt-form" data-id="${esc(c?.id || "")}" style="margin-top:12px">
    <div class="field"><label for="ptcp-code">Code</label><input class="input pt-cp-code" id="ptcp-code" required maxlength="20" value="${esc(v.code || "")}" placeholder="e.g. NAJD-10" ${locked ? "readonly" : ""}><span class="hint">4–20 letters A–Z, digits, dashes. Unique across links and coupons.</span></div>
    <div class="field"><label for="ptcp-partner">Partner</label><select class="input" id="ptcp-partner" ${locked ? "disabled" : ""}>${ptOpts(d.partners.map((p) => [p.id, p.name]), v.partner_id || "", "No partner (company coupon)")}</select>${locked ? "" : `<button class="pt-link s-small" type="button" data-ptact="cp-suggest">Suggest a code from the partner's link</button>`}</div>
    <div class="field"><label for="ptcp-type">Discount</label><select class="input" id="ptcp-type">${ptOpts([["percent", "Percent"], ["fixed", "Fixed amount"]], v.discount_type)}</select></div>
    <div class="field"><label for="ptcp-value">Value</label><input class="input" id="ptcp-value" type="number" min="0" step="0.01" required value="${esc(v.value ?? "")}"><span class="hint">Percent: 1–100. Fixed: per invoice (once) or per billing month.</span></div>
    <div class="field"><label for="ptcp-cur">Currency (fixed only)</label><select class="input" id="ptcp-cur">${ptOpts([["SAR", "SAR"], ["USD", "USD"]], v.currency || "SAR")}</select><span class="hint">Must match the customer's invoice currency (no exchange rate is applied).</span></div>
    <div class="field"><label for="ptcp-dur">Duration</label><select class="input" id="ptcp-dur">${ptOpts(d.durations.map((x) => [x.id, x.name]), v.duration)}</select></div>
    <div class="field"><label for="ptcp-months">Billing months (for N months)</label><input class="input" id="ptcp-months" type="number" min="1" max="36" step="1" value="${esc(v.months ?? "")}"></div>
    <div class="field"><label for="ptcp-cycles">Billing cycles</label><select class="input" id="ptcp-cycles">${ptOpts([["both", "Monthly and yearly"], ["monthly", "Monthly only"], ["yearly", "Yearly only"]], v.cycles)}</select></div>
    <fieldset class="pt-fs pt-wide"><legend>Plans (none ticked = all plans)</legend><div class="row gap-8" style="flex-wrap:wrap">${d.plans.map((n) => `<label class="chip"><input type="checkbox" data-ptcp-plan="${esc(n)}" ${(v.plans || []).includes(n) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div></fieldset>
    <div class="field"><label for="ptcp-max">Max redemptions (total)</label><input class="input" id="ptcp-max" type="number" min="1" step="1" value="${esc(v.max_redemptions ?? "")}" placeholder="No limit"></div>
    <label class="chip pt-chk"><input type="checkbox" id="ptcp-first" ${v.first_time_only !== false ? "checked" : ""}> First-time customers only</label>
    <div class="field"><label for="ptcp-from">Valid from (Riyadh day)</label><input class="input" id="ptcp-from" type="date" value="${esc(v.valid_from || "")}"></div>
    <div class="field"><label for="ptcp-until">Valid until (Riyadh day)</label><input class="input" id="ptcp-until" type="date" value="${esc(v.valid_until || "")}"></div>
    <div class="field pt-wide"><label for="ptcp-note">Internal note</label><textarea class="input" id="ptcp-note" rows="2" maxlength="1000" dir="auto">${esc(v.note || "")}</textarea><span class="hint">Never shown to stores. Customers who already redeemed keep the terms they redeemed.</span></div>
    <div class="row gap-8 pt-wide"><button class="btn btn-primary" type="submit">${c ? "Save coupon" : "Create coupon"}</button>${c || pre ? `<button class="btn" type="button" data-ptact="cp-cancel">Cancel</button>` : ""}</div></form>`;
}
function ptCpRead() {
  const v = (sel) => $(sel)?.value ?? "";
  const type = v("#ptcp-type"), dur = v("#ptcp-dur");
  const b = { code: v("#ptcp-code").trim(), discount_type: type, value: Number(v("#ptcp-value")), duration: dur, cycles: v("#ptcp-cycles"), first_time_only: $("#ptcp-first").checked,
    plans: [...document.querySelectorAll("[data-ptcp-plan]")].filter((x) => x.checked).map((x) => x.dataset.ptcpPlan), max_redemptions: v("#ptcp-max") === "" ? null : Number(v("#ptcp-max")),
    valid_from: v("#ptcp-from") || null, valid_until: v("#ptcp-until") || null, note: v("#ptcp-note") };
  if (!$("#ptcp-partner").disabled) b.partner_id = v("#ptcp-partner") || null;
  if (type === "fixed") b.currency = v("#ptcp-cur");
  if (dur === "months") b.months = Number(v("#ptcp-months"));
  return b;
}
function ptCpDetail(c) {
  const d = PT.cps, edit = d.edit;
  const log = (c.log || []).slice().reverse();
  return `<div class="stack" style="gap:16px"><section class="card card-pad pt-head"><button class="pt-link s-small" data-ptact="cp-back">← All coupons</button>
    <div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start;margin-top:6px"><div style="min-width:0"><h2 style="margin:0"><code>${esc(c.code)}</code></h2>
      <div class="pt-meta s-small">${ptBadge(c.state, PT_CP_TONE[c.state])}${c.not_yet_valid ? ptBadge("not yet valid") : ""}<span>${ptCpTerms(c)}</span><span>${c.partner_name ? `Partner: <span dir="auto">${esc(c.partner_name)}</span>` : "Company coupon (no partner)"}</span></div>
      <div class="pt-meta subtle s-small"><span>${ptCpScope(c)}</span><span>Valid: ${ptCpValid(c)}</span><span>${c.max_redemptions ? `Limit ${c.max_redemptions}` : "No limit"}</span></div>
      ${c.note ? `<p class="s-small pt-text" dir="auto">${esc(c.note)}</p>` : ""}</div>
      ${edit ? `<div class="row gap-8">${c.state !== "expired" ? `<button class="btn btn-sm" data-ptact="cp-toggle" data-id="${esc(c.id)}" data-on="${c.state === "paused" ? "1" : "0"}">${c.state === "paused" ? "Resume" : "Pause"}</button>` : ""}<button class="btn btn-sm" data-ptact="cp-edit" data-id="${esc(c.id)}">Edit</button>${c.stats.redemptions ? "" : `<button class="btn btn-sm btn-ghost btn-danger" data-ptact="cp-delete" data-id="${esc(c.id)}">Delete</button>`}</div>` : ""}</div></section>
    <section class="s-kpis">${[ptTile("Redemptions", c.stats.redemptions, c.max_redemptions ? `of ${c.max_redemptions}` : "no limit"), ptTile("Active customers", c.stats.active_customers, "coupon still running"),
      ...(d.money ? [ptTile("Discount given", ptSar(c.stats.discount_sar), "issued invoices, before VAT"), ptTile("MRR list price", ptSar(c.stats.mrr_list_sar), `paid ${ptSar(c.stats.mrr_paid_sar)}`)] : [])].join("")}</section>
    <section class="card card-pad"><h3 style="margin:0">Redemptions</h3>${c.redemptions.length ? `<div class="table-wrap"><table class="f-table pt-table"><thead><tr><th>Customer</th><th>Redeemed</th><th>How</th><th>Status</th><th class="num">Invoices</th>${d.money ? `<th class="num">Discount given</th>` : ""}</tr></thead><tbody>
      ${c.redemptions.map((r) => `<tr><td dir="auto">${esc(r.customer)}${r.sample ? ` ${ptBadge("sample", "warn")}` : ""}</td><td class="num">${esc(r.redeemed_day || "")}</td><td class="s-small">${esc(r.source)}</td><td>${ptBadge(r.status, PT_CP_TONE[r.status])}</td><td class="num">${r.invoices}</td>${d.money ? `<td class="num">${esc(ptSar(r.discount_sar))}</td>` : ""}</tr>`).join("")}</tbody></table></div>`
      : `<p class="muted s-small">Not redeemed yet. Apply it from a Billing customer, or a store types it at signup.</p>`}</section>
    <details class="card card-pad"><summary><b>Change log (${log.length})</b></summary><ul class="pt-list">${log.map((l) => `<li class="pt-row s-small"><span dir="auto">${esc(l.text)}</span><span class="subtle num">${esc(l.by)} · ${esc(String(l.at).slice(0, 16).replace("T", " "))} UTC</span></li>`).join("")}</ul></details></div>`;
}

/* ------------------------------------------------ attribution and settings */
function ptAttribution() {
  const rows = PT.att.rows, kind = { store: "Store", deal: "Deal", customer: "Customer" };
  const codes = PT.list.partners.flatMap((p) => p.codes.map((c) => [c.id, `${p.name} · ${c.code}`]));
  const kinds = [["store", "Store CRM store", PT.meta.crm], ["deal", "Sales deal", PT.meta.sales], ["customer", "Billing customer", PT.meta.billing]].filter((k) => k[2]);
  const form = ptEdit() && codes.length && kinds.length ? `<form id="ptAttForm" class="card card-pad pt-form"><div class="field"><label for="pta-kind">Record</label><select class="input" id="pta-kind">${ptOpts(kinds.map(([v, l]) => [v, l]), "store")}</select></div>
    <div class="field"><label for="pta-q">Search</label><input class="input" id="pta-q" autocomplete="off" placeholder="Name or link"><input type="hidden" id="pta-id"><div id="ptHits" class="pt-hits"></div></div>
    <div class="field"><label for="pta-code">Referral code</label><select class="input" id="pta-code">${ptOpts(codes, "")}</select></div>
    <div class="row gap-8" style="align-self:end"><button class="btn btn-primary" type="submit">Attribute</button></div>
    <span class="hint pt-wide">A person's choice wins over the lead hook's <code>ref</code> and <code>utm_campaign</code>. Deals and customers inherit from their store.</span></form>` : "";
  return `<div class="stack" style="gap:16px">${form}${rows.length ? `<div class="table-wrap card"><table class="f-table pt-table"><thead><tr><th>Record</th><th>Kind</th><th>Partner</th><th>Code</th><th>How</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td dir="auto">${esc(r.label)}</td><td>${esc(kind[r.kind])}</td><td dir="auto">${esc(r.partner)}</td><td><code>${esc(r.code)}</code></td><td>${ptBadge(r.source, r.source === "manual" ? "accent" : "")}</td>
      <td>${r.attr_id && ptEdit() ? `<button class="btn btn-sm btn-ghost" data-ptact="att-del" data-id="${esc(r.attr_id)}">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty"><p>Nothing attributed yet.</p></div>`}</div>`;
}
function ptSettings() {
  const s = PT.meta.settings, edit = ptEdit();
  return `<form id="ptSetForm" class="card card-pad pt-form">
    <div class="field pt-wide"><label for="pts-land">Default landing page</label><input class="input" id="pts-land" value="${esc(s.landing_url)}" ${edit ? "" : "readonly"}><span class="hint">Where /r/&lt;code&gt; sends visitors, with the partner UTMs added.</span></div>
    <div class="field pt-wide"><label for="pts-hosts">Allowed hosts</label><input class="input" id="pts-hosts" value="${esc(s.allowed_hosts.join(", "))}" ${edit ? "" : "readonly"}><span class="hint">Redirects go only to https pages on these hosts or their subdomains. Anything else falls back to the default page (no open redirect).</span></div>
    <div class="field"><label for="pts-days">Referral cookie (days)</label><input class="input" id="pts-days" type="number" min="1" max="365" value="${esc(s.cookie_days)}" ${edit ? "" : "readonly"}></div>
    <label class="chip pt-chk"><input type="checkbox" id="pts-names" ${s.portal_show_names ? "checked" : ""} ${edit ? "" : "disabled"}> Show customer names on partner portals</label>
    <p class="subtle s-small pt-wide">Referral links: <code>${esc(PT.meta.public_url)}/r/&lt;code&gt;</code>. The signup form can send the code as <code>ref</code> to the Paid Ads lead hook. ${esc(PT.meta.tax_note)}</p>
    ${edit ? `<div class="row gap-8 pt-wide"><button class="btn btn-primary" type="submit">Save settings</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ events */
async function ptCopy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Select the text and copy it", true); } }
async function ptAct(a, el) {
  const p = PT.cur, id = el.dataset.id;
  if (a === "open") { PT.open = id; PT.tab = "list"; PT.editing = false; go("partners", id); return; }
  if (a === "back") { PT.open = null; PT.editing = false; go("partners", "list"); return; }
  if (a === "edit") { PT.editing = true; return ptShow(); }
  if (a === "cancel-edit") { PT.editing = false; return ptShow(); }
  if (a === "delete") { if (!confirm("Delete this partner with its links, clicks and draft statements?")) return; await api(`${ptP()}/${p.id}`, { method: "DELETE" }); PT.open = null; toast("Partner deleted"); go("partners", "list"); return; }
  if (a === "copy") return ptCopy(el.dataset.text);
  if (a === "code-toggle") { await ptPut(`/codes/${id}`, { active: el.dataset.on === "1" }); return ptShow(); }
  if (a === "portal") { if (p.portal_url && !confirm("Make a new portal link? The old one stops working.")) return; await ptPost(`/${p.id}/portal`); toast("Portal link ready"); return ptShow(); }
  if (a === "portal-off") { if (!confirm("Revoke the portal link?")) return; await api(`${ptP()}/${p.id}/portal`, { method: "DELETE" }); toast("Revoked"); return ptShow(); }
  if (a === "ai") { el.disabled = true; el.textContent = "Drafting…"; try { const d = await ptPost(`/${p.id}/ai/${el.dataset.kind}`); toast(d.by_ai ? "Draft ready: check it" : "Template ready: fill in every [ADD]"); } finally { el.disabled = false; } return ptShow(); }
  const box = el.closest("[data-draft]"), sub = box?.querySelector(".pt-dsub")?.value, body = box?.querySelector(".pt-dbody")?.value;
  if (a === "d-copy") { await ptCopy(`${sub}\n\n${body}`); await ptPost(`/drafts/${id}/use`, { subject: sub, body }); return ptShow(); }
  if (a === "d-discard") { await ptPost(`/drafts/${id}/discard`); return ptShow(); }
  if (a === "d-send") { if (!confirm("Send through the Store CRM? In Test mode it is only logged.")) return; const r = await ptPost(`/drafts/${id}/send`, { subject: sub, body }); toast(r.message.status === "sent" ? "Sent" : `Logged, not sent: ${r.message.error || r.message.status}`); return ptShow(); }
  if (a === "st-approve") { await ptPost(`/statements/${id}/approve`); toast("Approved"); return ptShow(); }
  if (a === "st-pay") { await ptPost(`/statements/${id}/pay`, { date: $(`#ptpd-${id}`).value, reference: $(`#ptpr-${id}`).value }); toast("Paid and posted to Finance"); return ptShow(); }
  if (a === "st-void") { const reason = prompt("Why void this statement?"); if (!reason) return; await ptPost(`/statements/${id}/void`, { reason }); return ptShow(); }
  if (a === "cp-open") { PT.tab = "coupons"; PT.cpOpen = id; PT.cpEdit = null; PT.cpPre = null; PT.open = null; if (S.param !== "coupons") { go("partners", "coupons"); return; } return ptShow(); }
  if (a === "cp-back" || a === "cp-cancel") { PT.cpOpen = null; PT.cpEdit = null; PT.cpPre = null; return ptShow(); }
  if (a === "cp-new-for") { const sg = await api(`${ptP()}/coupons/suggest?partner_id=${encodeURIComponent(id)}`); PT.cpPre = { partner_id: id, code: sg.code }; PT.cpOpen = null; PT.cpEdit = null; PT.open = null; PT.tab = "coupons"; go("partners", "coupons"); return; }
  if (a === "cp-suggest") { const pid = $("#ptcp-partner").value; if (!pid) return toast("Pick a partner first", true); const sg = await api(`${ptP()}/coupons/suggest?partner_id=${encodeURIComponent(pid)}`); $("#ptcp-code").value = sg.code; return; }
  if (a === "cp-edit") { PT.cpEdit = await api(`${ptP()}/coupons/${id}`); PT.cpOpen = null; return ptShow(); }
  if (a === "cp-toggle") { await ptPut(`/coupons/${id}`, { status: el.dataset.on === "1" ? "active" : "paused" }); toast(el.dataset.on === "1" ? "Coupon resumed" : "Coupon paused: no new redemptions"); return ptShow(); }
  if (a === "cp-delete") { if (!confirm("Delete this coupon? It was never redeemed.")) return; await api(`${ptP()}/coupons/${id}`, { method: "DELETE" }); PT.cpOpen = null; toast("Coupon deleted"); return ptShow(); }
  if (a === "att-del") { await api(`${ptP()}/attributions/${id}`, { method: "DELETE" }); return ptShow(); }
}
let ptTimer = null;
document.addEventListener("input", (e) => {
  if (S.route !== "partners" || e.target.id !== "pta-q") return;
  $("#pta-id").value = "";
  clearTimeout(ptTimer);
  const q = e.target.value.trim();
  ptTimer = setTimeout(async () => {
    const box = $("#ptHits"); if (!box) return;
    try { const r = await api(`${ptP()}/search?kind=${encodeURIComponent($("#pta-kind").value)}&q=${encodeURIComponent(q)}`); box.innerHTML = r.rows.length ? r.rows.map((x) => `<button type="button" class="pt-hit" data-pthit="${esc(x.id)}" dir="auto">${esc(x.label)}</button>`).join("") : `<span class="subtle s-small">Nothing found</span>`; } catch { box.innerHTML = ""; }
  }, 250);
});
document.addEventListener("click", async (e) => {
  if (S.route !== "partners") return;
  const t = e.target.closest("[data-pttab]");
  if (t) { PT.tab = t.dataset.pttab; PT.open = null; PT.cpOpen = null; PT.cpEdit = null; PT.cpPre = null; go("partners", PT.tab); return; }
  const h = e.target.closest("[data-pthit]");
  if (h) { $("#pta-id").value = h.dataset.pthit; $("#pta-q").value = h.textContent.trim(); $("#ptHits").innerHTML = ""; return; }
  const b = e.target.closest("[data-ptact]");
  if (b) { e.preventDefault(); try { await ptAct(b.dataset.ptact, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "partners") return;
  const f = e.target;
  if (!f.matches("#ptForm, #ptCodeForm, #ptGenForm, #ptAttForm, #ptSetForm, #ptCpForm")) return;
  e.preventDefault();
  try {
    if (f.id === "ptForm") {
      const body = ptReadForm();
      if (f.dataset.id) { await ptPut(`/${f.dataset.id}`, body); PT.editing = false; toast("Saved"); await ptShow(); }
      else { const p = await ptPost("", body); toast("Partner added with a referral link"); go("partners", p.id); }
    }
    if (f.id === "ptCpForm") {
      const body = ptCpRead();
      const c = f.dataset.id ? await ptPut(`/coupons/${f.dataset.id}`, body) : await ptPost("/coupons", body);
      toast(f.dataset.id ? "Coupon saved" : `Coupon ${c.code} created`); PT.cpEdit = null; PT.cpPre = null; PT.cpOpen = c.id; await ptShow();
    }
    if (f.id === "ptCodeForm") { await ptPost(`/${PT.cur.id}/codes`, { code: $("#ptc-code").value.trim() || undefined, landing_url: $("#ptc-land").value.trim() }); toast("Link added"); await ptShow(); }
    if (f.id === "ptGenForm") { const r = await ptPost("/statements/generate", { month: $("#ptg-month").value }); toast(`${r.created} drafted · ${r.refreshed} refreshed`); await ptShow(); }
    if (f.id === "ptAttForm") {
      if (!$("#pta-id").value) { toast("Search and pick a record first", true); return; }
      await ptPost("/attributions", { kind: $("#pta-kind").value, ref_id: $("#pta-id").value, code_id: $("#pta-code").value }); toast("Attributed"); await ptShow();
    }
    if (f.id === "ptSetForm") { await ptPut("/settings", { landing_url: $("#pts-land").value.trim(), allowed_hosts: $("#pts-hosts").value, cookie_days: Number($("#pts-days").value), portal_show_names: $("#pts-names").checked }); toast("Settings saved"); await ptShow(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "partners" && S.ws) render();
