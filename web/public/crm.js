/* Store CRM: the database of Salla/Zid stores, segments, AI outreach sequences (email + WhatsApp),
   newsletters, onboarding flows, an inbox of replies and the lifecycle pipeline.
   Uses app.js globals (S, $, api, esc, md, toast, fmtDate, ROUTES, levelFor). */

const CRM = { meta: null, tab: "overview", f: {}, sort: "score", page: 0, sel: new Set(), allMatching: false, list: null, editId: null, inboxAll: false, openId: null };
const CRM_STAGE_TONE = { new: "", contacted: "accent", engaged: "warn", qualified: "warn", onboarding: "accent", active: "good", churned: "bad", not_now: "", do_not_contact: "bad" };
const CRM_INTENT_TONE = { interested: "good", question: "accent", not_now: "", not_interested: "", unsubscribe: "bad", wrong_person: "", out_of_office: "", other: "" };
const crmP = () => `/api/workspaces/${S.ws.id}/crm`;
const crmEdit = () => levelFor("crm") === "edit";
const stageName = (id) => CRM.meta.stages.find((s) => s.id === id)?.name || id;
const stageBadge = (id) => `<span class="badge ${CRM_STAGE_TONE[id] || ""}">${esc(stageName(id))}</span>`;
const nf = (n) => (n == null ? "–" : Number(n).toLocaleString("en-US"));
const chIcon = (c) => (c === "whatsapp" ? "WhatsApp" : c === "call" ? "Phone call" : "Email");

ROUTES.crm = { title: "Store CRM", crumb: "Store CRM", render: renderCrm };

async function renderCrm(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  CRM.meta = await api(`${crmP()}/meta`);
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Store CRM views">
    ${[["overview", "Overview"], ["stores", "Stores"], ["pipeline", "Pipeline"], ["campaigns", "Campaigns"], ["inbox", "Inbox"], ["settings", "Settings"]].map(([k, l]) => `<button role="tab" data-ctab="${k}" aria-selected="${CRM.tab === k}">${l}</button>`).join("")}</div>
    ${crmEdit() ? `<button class="btn btn-primary" data-caction="import">Import stores</button>` : ""}`;
  view.innerHTML = `<div id="cBody"></div>`;
  crmRerender();
}

async function crmRerender() {
  if (S.route !== "crm") return;
  document.querySelectorAll("[data-ctab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ctab === CRM.tab));
  const body = $("#cBody");
  try {
    if (CRM.tab === "overview") body.innerHTML = crmOverview(await api(`${crmP()}/overview`));
    if (CRM.tab === "stores") await crmStores(body);
    if (CRM.tab === "pipeline") await crmPipeline(body);
    if (CRM.tab === "campaigns") CRM.editId ? await crmEditor(body) : body.innerHTML = crmCampaigns(await api(`${crmP()}/campaigns`));
    if (CRM.tab === "inbox") { const [calls, inbox] = await Promise.all([api(`${crmP()}/calls${CRM.myCalls ? "?mine=1" : ""}`), api(`${crmP()}/inbox${CRM.inboxAll ? "?status=all" : ""}`)]); body.innerHTML = crmCalls(calls) + crmInbox(inbox); }
    if (CRM.tab === "settings") body.innerHTML = crmSettings();
  } catch (e) { body.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ Overview */
function crmModeBanner(mode) {
  const c = CRM.meta.connections;
  if (mode === "live") return `<div class="card c-banner live"><b>Live:</b> messages are really sent. Email ${c.email ? "connected" : "not connected"} · WhatsApp ${c.whatsapp ? "connected" : "not connected"}. <button class="btn btn-sm btn-ghost" data-ctab="settings">Channels</button></div>`;
  return `<div class="card c-banner"><b>Test mode:</b> campaigns run on schedule but nothing leaves the server; every message is logged as a test so you can check wording, timing and volume first. Connect email and WhatsApp, then switch to Live in <button class="btn btn-sm btn-ghost" data-ctab="settings">Channels</button></div>`;
}
function crmOverview(o) {
  if (!o.total) return crmModeBanner(o.mode) + `<div class="card empty"><h2>Add your store database</h2><p>Import your list of Salla and Zid stores (CSV, Arabic or English headers: store name, link, email, phone, category, city, products). Duplicates are merged by link, email and phone. Or try it first with 240 sample stores.</p>
    ${crmEdit() ? `<div class="row gap-8" style="justify-content:center"><button class="btn btn-primary" data-caction="import">Import stores</button><button class="btn" data-caction="sample">Load 240 sample stores</button></div>` : ""}</div>`;
  const tile = (label, val, sub, tone = "", tab = "") => `<div class="card s-kpi ${tone} ${tab ? "clickable" : ""}" ${tab ? `data-ctab="${tab}"` : ""}><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  const st = o.by_stage, customers = (st.onboarding || 0) + (st.active || 0);
  const funnel = ["new", "contacted", "engaged", "qualified", "onboarding", "active"].map((id) => [id, st[id] || 0]);
  const maxF = Math.max(1, ...funnel.map((x) => x[1]));
  const W = 640, H = 170, pad = 24, bw = (W - pad * 2) / o.daily.length;
  const maxD = Math.max(1, ...o.daily.map((d) => d.email + d.whatsapp));
  const chart = `<svg viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Messages sent per day, last 14 days">${o.daily.map((d, i) => {
    const x = pad + i * bw + 3, w = bw - 6, he = (d.email / maxD) * (H - 30), hw = (d.whatsapp / maxD) * (H - 30);
    return `<rect x="${x}" y="${H - he}" width="${w}" height="${he}" fill="var(--accent)" rx="2"><title>${d.day}: ${d.email} email</title></rect>
      <rect x="${x}" y="${H - he - hw}" width="${w}" height="${hw}" fill="var(--good)" rx="2"><title>${d.day}: ${d.whatsapp} WhatsApp</title></rect>
      ${d.replies ? `<circle cx="${x + w / 2}" cy="${H - he - hw - 8}" r="3.5" fill="var(--warn)"><title>${d.replies} replies</title></circle>` : ""}
      ${i % 2 === 0 ? `<text class="s-svg-mono" x="${x + w / 2}" y="${H + 16}" text-anchor="middle">${d.day.slice(5)}</text>` : ""}`;
  }).join("")}</svg>`;
  return crmModeBanner(o.mode) + `<section class="s-kpis">
    ${tile("Stores", nf(o.total), `${nf(st.new || 0)} never contacted`, "", "stores")}
    ${tile("Reachable by email", nf(o.reachable.email), `${nf(o.week.unsubscribed)} unsubscribed · ${nf(o.week.bounced)} bounced`, "", "stores")}
    ${tile("WhatsApp opt-in", nf(o.reachable.whatsapp), `${nf(o.reachable.phone)} have a phone`, "", "stores")}
    ${tile("Sent this week", nf(o.week.sent), `${o.campaigns.running} campaigns running`, "", "campaigns")}
    ${tile("Reply rate", o.week.reply_rate == null ? "–" : o.week.reply_rate + "%", `${nf(o.week.replies)} replies this week`, "", "inbox")}
    ${o.calls ? tile("Calls to make", nf(o.calls), "phone steps waiting for a person", "warn", "inbox") : ""}
    ${tile("Inbox", nf(o.inbox.open), `${nf(o.inbox.needs_person)} need a person`, o.inbox.needs_person ? "warn" : "", "inbox")}
    ${tile("Customers", nf(customers), `${nf(st.onboarding || 0)} onboarding`, "good", "pipeline")}
  </section>
  <div class="grid-2" style="margin-top:20px">
    <div class="card"><div class="card-head"><h2>Funnel</h2><button class="btn btn-sm btn-ghost" data-ctab="pipeline">Pipeline</button></div><div class="card-body stack" style="padding:16px 20px">
      ${funnel.map(([id, n]) => `<div class="c-fun"><span>${esc(stageName(id))}</span><div class="c-fun-bar"><i style="width:${Math.max(1, (n / maxF) * 100)}%"></i></div><b class="num">${nf(n)}</b></div>`).join("")}
      <p class="subtle" style="font-size:12px">Not now: ${nf(st.not_now || 0)} · Churned: ${nf(st.churned || 0)} · Do not contact: ${nf(st.do_not_contact || 0)}</p></div></div>
    <div class="card"><div class="card-head"><h2>Messages, last 14 days</h2><span class="subtle" style="font-size:12px"><span style="color:var(--accent)">■</span> Email <span style="color:var(--good)">■</span> WhatsApp <span style="color:var(--warn)">●</span> Replies</span></div><div class="card-body s-grid2" style="padding:12px 16px">${chart}</div></div>
  </div>
  ${crmPlanner(o)}
  <div class="card" style="margin-top:20px"><div class="card-head"><div><h2>By category</h2><p class="subtle" style="font-size:13px">Write one sequence per category: the message fits the store, and you see which categories answer.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th>Stores</th><th>Contacted</th><th>Replied</th><th>Reply rate</th><th>Customers</th><th></th></tr></thead><tbody>
    ${o.categories.map((c) => `<tr><td><b>${esc(c.category)}</b></td><td class="num">${nf(c.stores)}</td><td class="num">${nf(c.contacted)}</td><td class="num">${nf(c.replied)}</td><td class="num">${c.contacted ? Math.round((c.replied / c.contacted) * 1000) / 10 + "%" : "–"}</td><td class="num">${nf(c.customers)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm btn-ghost" data-caction="see-cat" data-cat="${esc(c.category)}">Stores</button>${crmEdit() ? `<button class="btn btn-sm" data-caction="camp-cat" data-cat="${esc(c.category)}">Campaign</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="card" style="margin-top:20px"><div class="card-head"><div><h2>By platform</h2><p class="subtle" style="font-size:13px">Where each store's shop runs, and how DPA AD connects to its catalog.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Platform</th><th>Region</th><th>Stores</th><th>Contacted</th><th>Replied</th><th>Customers</th><th>How DPA AD connects</th><th></th></tr></thead><tbody>
    ${(o.platforms || []).map((p) => { const info = CRM.meta.platforms.find((x) => x.id === p.platform) || {}; return `<tr><td><b>${esc(p.platform)}</b></td><td class="subtle">${esc(info.region || "")}</td><td class="num">${nf(p.stores)}</td><td class="num">${nf(p.contacted)}</td><td class="num">${nf(p.replied)}</td><td class="num">${nf(p.customers)}</td><td class="subtle" style="font-size:12px">${esc(info.connect || "")}</td>
      <td style="text-align:right"><button class="btn btn-sm btn-ghost" data-caction="see-plat" data-plat="${esc(p.platform)}">Stores</button></td></tr>`; }).join("")}
    </tbody></table></div></div>
  ${o.owners.length ? `<div class="card" style="margin-top:20px"><div class="card-head"><h2>Owners</h2></div><div class="card-body row gap-8" style="padding:14px 18px;flex-wrap:wrap">${o.owners.map((x) => `<span class="badge">${esc(x.name)} · ${nf(x.stores)}</span>`).join("")}</div></div>` : ""}`;
}

/* ------------------------------------------------ Work backwards from the goal (DPA AD funnel targets) */
function crmPlannerTarget() { try { return Number(localStorage.getItem("crm.target")) || 20; } catch { return 20; } }
function crmPlanner(o) {
  const r = o.rates, B = r.bench, target = crmPlannerTarget();
  const own = r.contacted >= 200; // enough history to trust our own rates
  const rate = (num, den, b) => (own && den ? num / den : b);
  const reply = rate(r.replied, r.contacted, B.reply), meeting = rate(r.meetings, r.replied, B.meeting), close = rate(r.customers, r.meetings, B.close);
  const meetings = Math.ceil(target / Math.max(close, 0.001)), replies = Math.ceil(meetings / Math.max(meeting, 0.001)), stores = Math.ceil(replies / Math.max(reply, 0.001));
  const perDay = Math.ceil((stores * r.steps) / 22); // ~22 working days a month
  const cap = (o.settings?.email_daily_cap || 0) + (o.settings?.wa_daily_cap || 0);
  const pct = (x) => (Math.round(x * 1000) / 10) + "%";
  const cmp = (x, b) => (own ? (x >= b ? `<span style="color:var(--good)">above</span>` : `<span style="color:var(--bad)">below</span>`) + ` our ${pct(b)} target` : "our target");
  return `<div class="card" style="margin-top:20px"><div class="card-head"><div><h2>Work backwards from your goal</h2><p class="subtle" style="font-size:13px">${own ? "Using your own results so far." : `Using our targets until ${nf(200)} stores have been contacted (now ${nf(r.contacted)}); then your real rates. Set targets in Settings.`} Change one thing at a time to move a rate: test it with an A/B campaign.</p></div>
    <label class="row gap-8" style="font-size:13px">New customers / month <input class="input input-sm" type="number" min="1" id="cTarget" value="${target}" style="width:80px"></label></div>
    <div class="c-plan">
      <div><span class="eyebrow">Stores to contact / month</span><b class="num">${nf(stores)}</b><span class="subtle">${nf(perDay)} messages a working day (${r.steps} steps each)</span></div>
      <div><span class="eyebrow">Reply rate</span><b class="num">${pct(reply)}</b><span class="subtle">${cmp(reply, B.reply)} · ${nf(replies)} replies needed</span></div>
      <div><span class="eyebrow">Reply → meeting</span><b class="num">${pct(meeting)}</b><span class="subtle">${cmp(meeting, B.meeting)} · ${nf(meetings)} meetings needed</span></div>
      <div><span class="eyebrow">Meeting → customer</span><b class="num">${pct(close)}</b><span class="subtle">${cmp(close, B.close)} · under target = fix the demo and offer first</span></div>
      <div class="${perDay > cap ? "warn" : ""}"><span class="eyebrow">Sending capacity</span><b class="num">${nf(cap)}/day</b><span class="subtle">${perDay > cap ? `${Math.ceil(perDay / Math.max(cap, 1))}× short: warm up more mailboxes or lower the goal` : "enough for this goal"}</span></div>
    </div></div>`;
}

/* ------------------------------------------------ Filters (shared by Stores and campaign segments) */
function crmFilterHtml(p, f = {}) {
  const facets = CRM.list?.facets || { category: {}, city: {}, stage: {}, tags: {}, platform: {} };
  const one = (v) => (Array.isArray(v) ? v[0] || "" : v || "");
  const sel = (key, label, opts) => `<select class="input input-sm" data-f="${key}" aria-label="${label}"><option value="">${label}: all</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${one(f[key]) === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const cats = [...new Set([...CRM.meta.categories, ...Object.keys(facets.category)])];
  const cities = Object.entries(facets.city).filter(([c]) => c !== "—").sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, `${c} (${n})`]);
  return `<div class="c-filters" id="${p}">
    <input class="input input-sm" data-f="q" placeholder="Search name, link, email, phone" value="${esc(f.q || "")}" style="min-width:200px">
    ${sel("category", "Category", cats.map((c) => [c, facets.category[c] ? `${c} (${facets.category[c]})` : c]))}
    ${sel("city", "City", cities)}
    ${sel("platform", "Platform", CRM.meta.platforms.filter((p) => facets.platform?.[p.id] || ["Salla", "Zid", "Shopify"].includes(p.id)).map((p) => [p.id, `${p.id}${facets.platform?.[p.id] ? ` (${facets.platform[p.id]})` : ""}`]))}
    ${sel("stage", "Stage", CRM.meta.stages.map((s) => [s.id, `${s.name}${facets.stage[s.id] ? ` (${facets.stage[s.id]})` : ""}`]))}
    ${Object.keys(facets.tags).length ? sel("tags", "Tag", Object.entries(facets.tags).map(([t, n]) => [t, `${t} (${n})`])) : ""}
    ${sel("owner_id", "Owner", [["none", "Unassigned"], ...CRM.meta.users.map((u) => [u.id, u.name])])}
    <input class="input input-sm" type="number" min="0" data-f="min_products" placeholder="Min products" value="${f.min_products || ""}" style="width:118px">
    <input class="input input-sm" type="number" min="0" data-f="max_products" placeholder="Max products" value="${f.max_products || ""}" style="width:118px">
    <input class="input input-sm" type="number" min="0" data-f="quiet_days" placeholder="Not contacted in (days)" value="${f.quiet_days || ""}" style="width:178px">
    <label class="chip"><input type="checkbox" data-f="has_email" ${f.has_email ? "checked" : ""}> Has email</label>
    <label class="chip"><input type="checkbox" data-f="has_whatsapp" ${f.has_whatsapp ? "checked" : ""}> Has phone</label>
  </div>`;
}
function crmReadFilter(p) {
  const f = {};
  document.querySelectorAll(`#${p} [data-f]`).forEach((el) => {
    const k = el.dataset.f;
    if (el.type === "checkbox") { if (el.checked) f[k] = true; }
    else if (el.value !== "") f[k] = ["category", "city", "stage", "tags", "platform"].includes(k) ? [el.value] : el.type === "number" ? Number(el.value) : el.value;
  });
  return f;
}

/* ------------------------------------------------ Stores */
async function crmStores(body) {
  CRM.list = await api(`${crmP()}/contacts?f=${encodeURIComponent(JSON.stringify(CRM.f))}&sort=${CRM.sort}&page=${CRM.page}`);
  const L = CRM.list, edit = crmEdit();
  if (!L.all) { body.innerHTML = crmOverview({ total: 0, mode: CRM.meta.settings.mode }); return; }
  const pages = Math.ceil(L.total / L.size);
  const nSel = CRM.allMatching ? L.total : CRM.sel.size;
  body.innerHTML = `<div class="card"><div class="card-body" style="padding:14px 16px">${crmFilterHtml("cStoreF", CRM.f)}</div></div>
  <div class="row gap-8" style="margin:14px 0;flex-wrap:wrap;justify-content:space-between">
    <div class="row gap-8"><b class="num">${nf(L.total)}</b><span class="muted">of ${nf(L.all)} stores</span>
      <select class="input input-sm" id="cSort" aria-label="Sort">${[["score", "Best fit first"], ["products", "Most products"], ["recent", "Recent activity"], ["name", "Name"]].map(([v, l]) => `<option value="${v}" ${CRM.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${Object.keys(CRM.f).length ? `<button class="btn btn-sm btn-ghost" data-caction="clear-f">Clear filters</button>` : ""}</div>
    <div class="row gap-8">${edit ? `<button class="btn btn-sm" data-caction="add-store">Add store</button><button class="btn btn-sm" data-caction="icp" title="Tag the best-fit stores in this view as your focus list">Build ICP list</button><button class="btn btn-sm" data-caction="seg-camp">Campaign for these ${nf(L.total)}</button>` : ""}<a class="btn btn-sm btn-ghost" href="${crmP()}/export?f=${encodeURIComponent(JSON.stringify(CRM.f))}">Export CSV</a></div>
  </div>
  ${edit && nSel ? `<div class="card c-bulk"><b>${nf(nSel)} selected</b>${!CRM.allMatching && CRM.sel.size === L.rows.length && L.total > L.rows.length ? `<button class="btn btn-sm btn-ghost" data-caction="sel-all">Select all ${nf(L.total)} matching</button>` : ""}
    <select class="input input-sm" id="cBulkAct"><option value="">Action…</option><option value="stage">Move to stage</option><option value="owner">Assign owner (round-robin)</option><option value="tag">Add tag</option><option value="untag">Remove tag</option><option value="enroll">Add to campaign</option><option value="delete">Delete</option></select>
    <span id="cBulkVal"></span><button class="btn btn-sm btn-primary" data-caction="bulk-go">Apply</button><button class="btn btn-sm btn-ghost" data-caction="sel-none">Clear</button></div>` : ""}
  <div class="card"><div class="table-wrap"><table class="c-table"><thead><tr>${edit ? `<th style="width:32px"><input type="checkbox" id="cSelPage" aria-label="Select page" ${L.rows.length && L.rows.every((r) => CRM.sel.has(r.id)) ? "checked" : ""}></th>` : ""}<th>Store</th><th>Category · platform</th><th>City</th><th>Products</th><th>Fit</th><th>Stage</th><th>Owner</th><th>Reach</th><th>Last contact</th></tr></thead><tbody>
  ${L.rows.map((c) => `<tr class="clickable" data-copen="${c.id}">${edit ? `<td><input type="checkbox" data-csel="${c.id}" ${CRM.allMatching || CRM.sel.has(c.id) ? "checked" : ""} aria-label="Select ${esc(c.store_name)}"></td>` : ""}
    <td><b dir="auto">${esc(c.store_name)}</b><div class="subtle">${esc(c.domain || "")}${c.sample ? ' <span class="badge">SAMPLE</span>' : ""}</div></td>
    <td>${esc(c.category)}<div class="subtle">${esc(c.platform || "")}</div></td><td>${esc(c.city || "–")}</td><td class="num">${nf(c.products)}</td>
    <td><span class="c-score" style="--v:${c.score}%">${c.score}</span></td><td>${stageBadge(c.stage)}</td><td>${esc(c.owner_name || "–")}</td>
    <td class="subtle" style="white-space:nowrap">${c.email ? (c.email_opt_out ? "<s>email</s>" : c.bounced ? "bounced" : "email") : ""}${c.phone ? ` · ${c.wa_opt_in ? "WA ✓" : "phone"}` : ""}</td>
    <td class="subtle">${c.last_contacted_at ? fmtDate(c.last_contacted_at) : "never"}</td></tr>`).join("") || `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">No stores match.</td></tr>`}
  </tbody></table></div>
  ${pages > 1 ? `<div class="row gap-8" style="justify-content:center;padding:12px"><button class="btn btn-sm" data-cpage="${CRM.page - 1}" ${CRM.page ? "" : "disabled"}>Previous</button><span class="subtle">Page ${CRM.page + 1} of ${pages}</span><button class="btn btn-sm" data-cpage="${CRM.page + 1}" ${CRM.page + 1 < pages ? "" : "disabled"}>Next</button></div>` : ""}</div>`;
}

/* ------------------------------------------------ Pipeline */
async function crmPipeline(body) {
  const mine = CRM.mine && S.me && S.me.user.id !== "owner" ? { owner_id: S.me.user.id } : {};
  const cols = await Promise.all(CRM.meta.board.map((st) => api(`${crmP()}/contacts?f=${encodeURIComponent(JSON.stringify({ ...mine, stage: [st] }))}&sort=${st === "new" ? "score" : "recent"}&size=25`)));
  body.innerHTML = `<div class="row gap-8" style="margin-bottom:12px;justify-content:space-between;flex-wrap:wrap"><p class="muted" style="font-size:13px">Marketing → Sales → Customer Success. Moving a store to <b>Onboarding</b> starts the onboarding flow and stops outreach. Click a store to move it.</p>
    ${S.me && S.me.user.id !== "owner" ? `<label class="chip"><input type="checkbox" data-caction="mine" ${CRM.mine ? "checked" : ""}> Only my stores</label>` : ""}</div>
  <div class="s-board">${CRM.meta.board.map((st, i) => {
    const s = CRM.meta.stages.find((x) => x.id === st), L = cols[i];
    return `<section class="s-col"><div class="s-col-head"><h3>${esc(s.name)}</h3><span class="subtle num">${nf(L.total)}</span></div><p class="subtle" style="font-size:11px;padding:0 4px">${esc(s.team)} · ${esc(s.hint)}</p>
      ${L.rows.map((c) => `<button class="s-card" data-copen="${c.id}" style="cursor:pointer"><div class="row gap-8" style="justify-content:space-between"><b dir="auto" style="font-size:13px">${esc(c.store_name)}</b><span class="c-score" style="--v:${c.score}%">${c.score}</span></div>
        <span class="subtle" style="font-size:12px">${esc(c.category)} · ${nf(c.products)} products${c.city ? " · " + esc(c.city) : ""}</span>
        ${st === "onboarding" ? `<div class="c-onb">${CRM.meta.onboarding.map((o) => `<i class="${c.onboarding?.[o.id] ? "on" : ""}" title="${esc(o.name)}"></i>`).join("")}</div>` : ""}
        ${c.owner_name ? `<span class="subtle" style="font-size:11px">${esc(c.owner_name)}</span>` : ""}</button>`).join("")}
      ${L.total > L.rows.length ? `<button class="btn btn-sm btn-ghost" data-caction="see-stage" data-stage="${st}">+ ${nf(L.total - L.rows.length)} more</button>` : ""}</section>`;
  }).join("")}</div>`;
}

/* ------------------------------------------------ Campaigns */
const STATUS_TONE = { draft: "", running: "good", paused: "warn", done: "accent" };
function crmCampaigns(list) {
  const edit = crmEdit();
  const head = `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:720px">Each campaign = a segment of stores + timed steps on email and WhatsApp. Sends only in Saudi hours (09:00–21:00, not Friday), within daily caps, and stops for a store the moment it replies.</p>
    ${edit ? `<div class="row gap-8"><button class="btn" data-caction="starter-camps">Load starter campaigns</button><button class="btn btn-primary" data-caction="new-camp">New campaign</button></div>` : ""}</div>`;
  if (!list.length) return head + `<div class="card empty"><h2>No campaigns yet</h2><p>Load the starter set: an Arabic 4-step Salla outreach (email + WhatsApp), a monthly newsletter and a 7-day onboarding flow. Edit them, or let AI write a sequence per category.</p></div>`;
  const typeName = (t) => CRM.meta.types.find((x) => x.id === t)?.name || t;
  return head + `<div class="stack">${list.map((c) => {
    const s = c.stats;
    return `<div class="card"><div class="card-head"><div style="min-width:0"><h2 dir="auto">${esc(c.name)}</h2><p class="subtle" style="font-size:13px">${esc(typeName(c.type))} · ${c.steps.length} step${c.steps.length === 1 ? "" : "s"} (${c.steps.map((x) => (x.channel === "whatsapp" ? "WA" : "Email") + (x.delay_days ? ` +${x.delay_days}d` : "")).join(" → ")})${c.type === "onboarding" ? " · starts when a store moves to Onboarding" : ` · segment: ${nf(c.audience)} stores`}</p></div>
      <div class="row gap-8"><span class="badge ${STATUS_TONE[c.status]}">${c.status}</span>${edit ? `
        ${c.status === "draft" ? `<button class="btn btn-sm btn-primary" data-caction="launch" data-id="${c.id}">Launch</button>` : ""}
        ${c.status === "running" ? `<button class="btn btn-sm" data-caction="pause" data-id="${c.id}">Pause</button>` : ""}
        ${c.status === "paused" ? `<button class="btn btn-sm btn-primary" data-caction="resume" data-id="${c.id}">Resume</button>` : ""}
        ${c.status === "draft" && !c.experiment && c.type !== "onboarding" ? `<button class="btn btn-sm btn-ghost" data-caction="ab" data-id="${c.id}">A/B test</button>` : ""}
        <button class="btn btn-sm" data-caction="edit-camp" data-id="${c.id}">Edit</button>` : ""}</div></div>
      ${c.experiment ? crmExpHtml(c) : ""}
      <div class="c-stats">${[["Enrolled", s.enrolled], ["Active", s.active], ["Sent", s.sent], ["Test (not sent)", s.test], ["Replied", s.replied], ["Reply rate", s.reply_rate == null ? "–" : s.reply_rate + "%"], ["Skipped", s.skipped], ["Failed", s.failed]].map(([l, v]) => `<div><span class="eyebrow">${l}</span><b class="num">${typeof v === "number" ? nf(v) : v}</b></div>`).join("")}</div>
      ${s.left ? `<p class="c-eta ${s.eta_days > 60 ? "warn" : ""}">${nf(s.left)} messages still to send at up to ${nf(s.per_day)}/day: about <b>${nf(s.eta_days)} days</b> to finish.${s.eta_days > 60 ? " Raise the daily limit (and the channel caps) as the mailbox warms up, or split the list by category." : ""}</p>` : ""}
      ${s.by_step.some(Boolean) ? `<div class="c-steps-bar">${s.by_step.map((n, i) => `<span>Step ${i + 1}: <b class="num">${nf(n)}</b></span>`).join("")}</div>` : ""}</div>`;
  }).join("")}</div>`;
}

function crmExpHtml(c) {
  const x = c.experiment;
  if (x.orphan) return `<p class="c-exp warn">A/B test: the other version was deleted. This campaign runs on half of its segment only.</p>`;
  const r = (v) => (v.contacted ? (Math.round((v.replied / v.contacted) * 1000) / 10) + "%" : "–");
  const many = x.changes.length > 1, none = x.changes.length === 0;
  return `<div class="c-exp ${many || none ? "warn" : ""}"><b>A/B test · ${esc(x.label)} · version ${x.part}</b><div class="subtle">Paired with “${esc(x.partner_name)}”</div>
    ${none ? `<div>The two versions are still identical: edit version B to change the ${esc(x.label.toLowerCase())}.</div>` : many ? `<div>Changes more than one thing (${x.changes_labels.map(esc).join(", ")}): you won't know which change made the difference. Keep only one.</div>` : ""}
    ${x.a.contacted || x.b.contacted ? `<div>A: ${r(x.a)} replies (${nf(x.a.replied)}/${nf(x.a.contacted)}) · B: ${r(x.b)} (${nf(x.b.replied)}/${nf(x.b.contacted)}) · <b>${esc(x.verdict)}</b>${x.p != null ? ` (p=${x.p})` : ""}</div>` : `<div class="subtle">Launching either version launches both; each gets half the segment.</div>`}</div>`;
}

async function crmEditor(body) {
  const list = await api(`${crmP()}/campaigns`);
  const c = list.find((x) => x.id === CRM.editId);
  if (!c) { CRM.editId = null; return crmRerender(); }
  if (!CRM.list) CRM.list = await api(`${crmP()}/contacts?size=1`);
  try { CRM.designs = levelFor("studio") !== "none" ? await api(`/api/workspaces/${S.ws.id}/creative/emails`) : []; } catch { CRM.designs = []; }
  const locked = c.status === "running";
  const dt = c.start_at ? new Date(new Date(c.start_at).getTime() + 3 * 3600e3).toISOString().slice(0, 16) : "";
  body.innerHTML = `<div class="row gap-8" style="margin-bottom:14px"><button class="btn btn-sm btn-ghost" data-caction="back">← Campaigns</button>${locked ? `<span class="badge warn">Running: changes apply to messages not sent yet</span>` : ""}</div>
  ${c.experiment ? crmExpHtml(c) : ""}
  <div class="c-editor">
   <div class="stack">
    <div class="card"><div class="card-body stack" style="padding:18px 20px">
      <div class="grid-2"><div class="field"><label for="ceName">Name</label><input class="input" id="ceName" value="${esc(c.name)}" dir="auto"></div>
      <div class="field"><label for="ceType">Type</label><select class="input" id="ceType" ${locked ? "disabled" : ""}>${CRM.meta.types.map((t) => `<option value="${t.id}" ${t.id === c.type ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select><span class="hint">${esc(CRM.meta.types.find((t) => t.id === c.type)?.hint || "")}</span></div></div>
    </div></div>
    ${c.type === "onboarding" ? "" : `<div class="card"><div class="card-head"><div><h2>Who gets it</h2><p class="subtle" style="font-size:13px">Unsubscribed, bounced and do-not-contact stores are always left out.</p></div><b class="num" id="ceCount">${nf(c.audience)} stores</b></div>
      <div class="card-body" style="padding:14px 16px">${crmFilterHtml("ceF", c.filter)}</div></div>`}
    <div class="card"><div class="card-head"><h2>Messages</h2>${crmEdit() ? `<button class="btn btn-sm" data-caction="ai-open">Write with AI</button>` : ""}</div>
      <div id="ceAi" hidden class="card-body stack c-ai" style="padding:14px 20px">
        <div class="grid-2"><div class="field"><label for="aiCat">For category</label><select class="input" id="aiCat"><option value="">All categories</option>${CRM.meta.categories.map((x) => `<option ${c.filter?.category?.[0] === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
          <div class="field"><label for="aiSteps">Steps</label><input class="input" id="aiSteps" type="number" min="1" max="8" value="${c.type === "newsletter" ? 1 : 4}"></div></div>
        <div class="field"><label for="aiGoal">Goal</label><input class="input" id="aiGoal" placeholder="e.g. get them to ask for 3 free sample ads; invite to a Ramadan webinar"></div>
        <div class="row gap-8" style="flex-wrap:wrap"><label class="chip"><input type="checkbox" id="aiEmail" checked> Email</label><label class="chip"><input type="checkbox" id="aiWa"> WhatsApp</label>
          <select class="input input-sm" id="aiLang" style="width:auto"><option value="ar">Saudi Arabic</option><option value="en">English</option></select>
          <button class="btn btn-primary btn-sm" data-caction="ai-write">Write sequence</button><span class="subtle" style="font-size:12px">Replaces the steps below. You review before launch.</span></div>
      </div>
      <div class="card-body stack" id="ceSteps" style="padding:14px 20px">${c.steps.map((s, i) => crmStepHtml(s, i)).join("")}</div>
      <div style="padding:0 20px 18px"><button class="btn btn-sm" data-caction="add-step">Add step</button></div></div>
    <div class="card"><div class="card-head"><h2>Schedule and limits</h2></div><div class="card-body stack" style="padding:14px 20px">
      <div class="grid-2"><div class="field"><label for="ceStart">Start (Riyadh time)</label><input class="input" type="datetime-local" id="ceStart" value="${dt}"><span class="hint">Empty = as soon as launched, in the next send window.</span></div>
        <div class="field"><label for="ceLimit">Max messages per day (this campaign)</label><input class="input" type="number" id="ceLimit" min="1" value="${c.daily_limit}"><span class="hint">New sending mailboxes: start at 30–50/day and raise weekly.</span></div></div>
      <div class="row gap-8" style="flex-wrap:wrap">Send between <input class="input input-sm" type="number" id="ceFrom" min="0" max="23" value="${c.window.from}" style="width:70px"> and <input class="input input-sm" type="number" id="ceTo" min="1" max="24" value="${c.window.to}" style="width:70px"> Riyadh time
        <label class="chip"><input type="checkbox" id="ceFri" ${c.window.skip_friday ? "checked" : ""}> Skip Friday</label><label class="chip"><input type="checkbox" id="ceStop" ${c.stop_on_reply ? "checked" : ""}> Stop when they reply</label></div>
    </div></div>
    <div class="row gap-8" style="justify-content:space-between"><button class="btn btn-ghost" data-caction="del-camp" style="color:var(--bad)">Delete campaign</button>
      <div class="row gap-8"><button class="btn" data-caction="save-camp">Save</button>${c.status === "draft" ? `<button class="btn btn-primary" data-caction="save-launch">Save and launch</button>` : ""}</div></div>
   </div>
   <aside class="card c-preview"><div class="card-head"><h2>Preview</h2><button class="btn btn-sm btn-ghost" data-caction="preview">Refresh</button></div><div class="card-body" id="cePrev" style="padding:14px 18px"><p class="muted">Save to see the messages with a real store's details.</p></div></aside>
  </div>`;
  crmPreview();
}
function crmStepHtml(s, i) {
  return `<div class="c-step" data-step="${i}"><div class="row gap-8" style="flex-wrap:wrap"><b>Step ${i + 1}</b>
    <select class="input input-sm" data-s="channel" style="width:auto"><option value="email" ${s.channel === "email" ? "selected" : ""}>Email</option><option value="whatsapp" ${s.channel === "whatsapp" ? "selected" : ""}>WhatsApp</option><option value="call" ${s.channel === "call" ? "selected" : ""}>Phone call (a person)</option></select>
    <span class="subtle">${i ? "wait" : "send after"}</span><input class="input input-sm" type="number" min="0" data-s="delay_days" value="${s.delay_days}" style="width:64px"><span class="subtle">days</span>
    ${s.channel === "whatsapp" ? `<input class="input input-sm" data-s="wa_template" placeholder="Approved template name" value="${esc(s.wa_template || "")}" style="width:200px" title="First WhatsApp to a store must be an approved template (Meta). The text below is used inside a 24h chat window.">` : ""}
    <button class="btn btn-sm btn-ghost" data-caction="del-step" data-i="${i}" style="margin-left:auto">Remove</button></div>
    ${s.channel === "email" ? `<div class="row gap-8" style="flex-wrap:wrap"><select class="input input-sm" data-s="design_id" style="width:auto" title="Designed emails approved in Creative Studio"><option value="">Plain email (text below)</option>${(CRM.designs || []).map((d) => `<option value="${esc(d.id)}" ${String(d.id) === String(s.design_id || "") ? "selected" : ""}>Design: ${esc(d.title)}</option>`).join("")}${s.design_id && !(CRM.designs || []).some((d) => String(d.id) === String(s.design_id)) ? `<option value="${esc(s.design_id)}" selected>Design #${esc(s.design_id)} (not approved: won't send)</option>` : ""}</select>
      ${s.design_id ? `<span class="subtle" style="font-size:12px">Subject and content come from the design unless you write a subject here. The text below is kept as a fallback.</span>` : ""}</div>
      <input class="input" data-s="subject" placeholder="${s.design_id ? "Subject (optional: the design has one)" : "Subject"}" value="${esc(s.subject || "")}" dir="auto">` : ""}
    ${s.channel === "call" ? `<span class="subtle" style="font-size:12px">Creates a call task with this script for the store's owner (Store CRM → Inbox → Calls). Only stores with a phone number.</span>` : ""}
    <textarea class="input" data-s="body" rows="6" dir="auto" placeholder="${s.channel === "call" ? "Call script: permission opener, 15-second hook, soft ask" : "Message."} Placeholders: {{store_name}} {{owner_name}} {{category_ar}} {{category}} {{city}} {{products}} {{sender_name}}">${esc(s.body || "")}</textarea></div>`;
}
function crmReadSteps() {
  return [...document.querySelectorAll("#ceSteps .c-step")].map((el) => {
    const g = (k) => el.querySelector(`[data-s="${k}"]`)?.value ?? "";
    return { channel: g("channel"), delay_days: Number(g("delay_days")) || 0, subject: g("subject"), body: g("body"), wa_template: g("wa_template"), design_id: g("design_id") };
  });
}
function crmReadCampaign() {
  const v = $("#ceStart").value;
  const o = { name: $("#ceName").value, type: $("#ceType").value, steps: crmReadSteps(), daily_limit: Number($("#ceLimit").value), start_at: v ? new Date(v + ":00+03:00").toISOString() : null,
    window: { from: Number($("#ceFrom").value), to: Number($("#ceTo").value), skip_friday: $("#ceFri").checked }, stop_on_reply: $("#ceStop").checked };
  if ($("#ceF")) o.filter = crmReadFilter("ceF");
  return o;
}
async function crmSaveCampaign() { return api(`${crmP()}/campaigns/${CRM.editId}`, { method: "PUT", body: JSON.stringify(crmReadCampaign()) }); }
async function crmPreview() {
  const el = $("#cePrev"); if (!el) return;
  try {
    const p = await api(`${crmP()}/campaigns/${CRM.editId}/preview`);
    el.innerHTML = `<p class="subtle" style="font-size:12px;margin-bottom:10px">As <b dir="auto">${esc(p.store)}</b> would see it</p>` + p.steps.map((s, i) => `<div class="c-msg ${s.channel}"><span class="eyebrow">Step ${i + 1} · ${chIcon(s.channel)}${s.delay_days ? ` · +${s.delay_days}d` : ""}</span>${s.subject ? `<b dir="auto">${esc(s.subject)}</b>` : ""}<div dir="auto" style="white-space:pre-wrap">${esc(s.body)}</div></div>`).join("");
  } catch (e) { el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

/* ------------------------------------------------ Calls to make */
function crmCalls(rows) {
  if (!rows.length) return "";
  const edit = crmEdit();
  return `<div class="card" style="margin-bottom:20px"><div class="card-head"><div><h2>Calls to make · ${nf(rows.length)}</h2><p class="subtle" style="font-size:13px">Phone steps from campaigns. Call, then log what happened: a booked meeting creates the deal in Sales.</p></div>
    ${S.me && S.me.user.id !== "owner" ? `<label class="chip"><input type="checkbox" data-caction="mycalls" ${CRM.myCalls ? "checked" : ""}> Only mine</label>` : ""}</div>
    <div class="stack" style="padding:14px 20px">${rows.slice(0, 50).map((m) => `<div class="c-call"><div class="row gap-8" style="justify-content:space-between;flex-wrap:wrap">
      <div><button class="linklike" data-copen="${m.store.id}"><b dir="auto">${esc(m.store.store_name)}</b></button> <span class="subtle" style="font-size:12px">· ${esc(m.store.category)} · ${nf(m.store.products)} products${m.store.owner_name ? " · " + esc(m.store.owner_name) : ""}</span></div>
      <a class="btn btn-sm" href="tel:+${esc(m.store.phone)}">Call +${esc(m.store.phone)}</a></div>
      <details><summary class="subtle" style="font-size:12px;cursor:pointer">Script</summary><div dir="auto" style="white-space:pre-wrap;font-size:13px;margin-top:6px">${esc(m.body)}</div></details>
      ${edit ? `<div class="row gap-8" style="flex-wrap:wrap">${[["meeting", "Meeting booked", "btn-primary"], ["reached", "Talked"], ["no_answer", "No answer"], ["not_interested", "Not interested"], ["wrong_number", "Wrong number"]].map(([o, l, cls]) => `<button class="btn btn-sm ${cls || ""}" data-caction="call-done" data-id="${m.id}" data-o="${o}">${l}</button>`).join("")}</div>` : ""}</div>`).join("")}
    ${rows.length > 50 ? `<p class="subtle">+ ${nf(rows.length - 50)} more</p>` : ""}</div></div>`;
}

/* ------------------------------------------------ Inbox */
function crmInbox(rows) {
  const head = `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:720px">Replies and new messages from stores. AI reads each one, sets the intent, moves the store in the pipeline (interested → Qualified + a deal in Sales; "stop" → do not contact) and drafts the answer. You check and send.</p>
    <div class="s-tabs"><button data-caction="inbox-open" aria-selected="${!CRM.inboxAll}">Open</button><button data-caction="inbox-all" aria-selected="${CRM.inboxAll}">All</button></div></div>`;
  if (!rows.length) return head + `<div class="card empty"><h2>${CRM.inboxAll ? "No messages yet" : "Inbox zero"}</h2><p>Email replies arrive from the connected mailbox every few minutes; WhatsApp replies arrive instantly through the webhook. You can also log a reply by hand from a store's page.</p></div>`;
  return head + `<div class="stack">${rows.map((m) => `<div class="card c-inmsg ${m.handled ? "done" : ""}"><div class="card-head"><div style="min-width:0">
      <button class="linklike" data-copen="${m.store?.id || ""}"><b dir="auto">${esc(m.store?.store_name || "Unknown")}</b></button>
      <span class="subtle" style="font-size:12px"> · ${chIcon(m.channel)} · ${fmtDate(m.at)}${m.store?.owner_name ? " · " + esc(m.store.owner_name) : ""}</span></div>
      <div class="row gap-8">${m.intent ? `<span class="badge ${CRM_INTENT_TONE[m.intent]}">${esc(m.intent.replace(/_/g, " "))}</span>` : ""}${m.needs_person && !m.handled ? `<span class="s-owner you">PERSON</span>` : ""}${m.store ? stageBadge(m.store.stage) : ""}</div></div>
    <div class="card-body stack" style="padding:14px 20px">
      ${m.summary ? `<p class="subtle" style="font-size:13px">AI: ${esc(m.summary)}</p>` : ""}
      ${m.subject ? `<b dir="auto">${esc(m.subject)}</b>` : ""}<div class="c-quote" dir="auto">${esc(m.body)}</div>
      ${!m.handled && crmEdit() ? `<div class="field"><label>Reply (${chIcon(m.channel)})</label><textarea class="input" rows="4" dir="auto" id="rep-${m.id}">${esc(m.ai_reply || "")}</textarea></div>
        <div class="row gap-8"><button class="btn btn-primary btn-sm" data-caction="reply" data-id="${m.id}" data-store="${m.store?.id}" data-ch="${m.channel}" data-subj="${esc(m.subject || "")}">Send reply</button><button class="btn btn-sm" data-caction="done" data-id="${m.id}">Mark done</button>${m.store?.deal_id ? `<a class="btn btn-sm btn-ghost" href="#/${S.ws.id}/pipeline">Deal in Sales →</a>` : ""}</div>` : m.handled ? `<span class="subtle" style="font-size:12px">Handled${m.reply_id ? " · replied" : ""}</span>` : ""}
    </div></div>`).join("")}</div>`;
}

/* ------------------------------------------------ Channels and settings */
function crmSettings() {
  const s = CRM.meta.settings, c = CRM.meta.connections, edit = crmEdit();
  const ok = (b) => (b ? `<span class="badge good">Connected</span>` : `<span class="badge">Not connected</span>`);
  return `<div class="grid-2">
  <div class="card"><div class="card-head"><h2>Sending</h2>${s.mode === "live" ? `<span class="badge good">LIVE</span>` : `<span class="badge warn">TEST MODE</span>`}</div><div class="card-body stack" style="padding:16px 20px">
    <div class="row gap-8" style="flex-wrap:wrap"><button class="btn ${s.mode === "test" ? "btn-primary" : ""}" data-caction="mode" data-v="test" ${edit ? "" : "disabled"}>Test mode</button><button class="btn ${s.mode === "live" ? "btn-primary" : ""}" data-caction="mode" data-v="live" ${edit ? "" : "disabled"}>Live</button></div>
    <p class="subtle" style="font-size:13px">Test mode runs every campaign on schedule and logs each message without sending. Use it to check wording and volume. Live sends through the connected channels.</p>
    <div class="grid-2"><div class="field"><label for="csSender">Sender name in messages</label><input class="input" id="csSender" value="${esc(s.sender_name || "")}" placeholder="e.g. Noura from DPA AD"></div>
      <div class="field"><label for="csTick">Max sends per minute</label><input class="input" type="number" id="csTick" value="${s.per_tick}" min="1"></div>
      <div class="field"><label for="csEmailCap">Email per day (all campaigns)</label><input class="input" type="number" id="csEmailCap" value="${s.email_daily_cap}"><span class="hint">Hostinger mailboxes allow a few hundred to ~3,000/day by plan. Start low.</span></div>
      <div class="field"><label for="csWaCap">WhatsApp per day</label><input class="input" type="number" id="csWaCap" value="${s.wa_daily_cap}"><span class="hint">New WhatsApp numbers start at 250 business-initiated chats/day.</span></div></div>
    <div class="field"><label>Our funnel targets</label><div class="row gap-8" style="flex-wrap:wrap;font-size:13px">
      Reply <input class="input input-sm" type="number" step="0.1" id="tReply" value="${s.targets.reply_pct}" style="width:70px">%
      Reply → meeting <input class="input input-sm" type="number" id="tMeet" value="${s.targets.meeting_pct}" style="width:70px">%
      Meeting → customer <input class="input input-sm" type="number" id="tClose" value="${s.targets.close_pct}" style="width:70px">%
      Focus list <input class="input input-sm" type="number" id="tFocus" value="${s.targets.focus_list}" style="width:80px"> stores</div>
      <span class="hint">Used by the planner until there's real data, and by the Sales close-rate check.</span></div>
    <label class="row gap-8"><input type="checkbox" id="csAuto" ${s.auto_reply ? "checked" : ""}> AI answers simple questions by itself (only when it's confident and no person is needed)</label>
    <label class="row gap-8"><input type="checkbox" id="csDeal" ${s.auto_deal ? "checked" : ""}> Create a deal in Sales when a store says it's interested</label>
    ${edit ? `<div class="row gap-8"><button class="btn btn-primary" data-caction="save-settings">Save</button><button class="btn" data-caction="run-now">Send due messages now</button></div>` : ""}
  </div></div>
  <div class="stack">
  <div class="card"><div class="card-head"><h2>Email</h2>${ok(c.email)}</div><div class="card-body stack" style="padding:16px 20px;font-size:13px">
    ${c.email ? `<p>Sending as <b>${esc(c.email_from)}</b>. Replies ${c.imap ? "are read from the mailbox every 3 minutes" : "aren't read automatically (IMAP off)"}.</p>` : `<p>Create a mailbox in Hostinger (e.g. <b>hello@dpa.ad</b>, or better a separate sending domain such as <b>dpa-ad.com</b> so cold email can't hurt dpa.ad), then add these in hPanel → your site → Node.js → Environment variables and redeploy:</p>
    <pre class="c-pre">SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=hello@yourdomain
SMTP_PASS=••••••
MAIL_FROM=Noura · DPA AD &lt;hello@yourdomain&gt;
COMPANY_ADDRESS=Your business address, Riyadh</pre><p>Replies are read from the same mailbox (imap.hostinger.com). Set SPF, DKIM and DMARC for the domain first.</p>`}
  </div></div>
  <div class="card"><div class="card-head"><h2>WhatsApp</h2>${ok(c.whatsapp)}</div><div class="card-body stack" style="padding:16px 20px;font-size:13px">
    ${c.whatsapp ? `<p>WhatsApp Cloud API connected. Webhook ${c.whatsapp_webhook ? "set" : "not set"}.</p>` : `<p>Needs a WhatsApp Business account on Meta's Cloud API. Add in hPanel:</p><pre class="c-pre">WA_TOKEN=••••••
WA_PHONE_ID=1234567890
WA_VERIFY_TOKEN=any-long-random-text
WA_APP_SECRET=••••••</pre>`}
    <p>Webhook URL for Meta: <code>${esc(c.public_url)}/hooks/whatsapp</code></p>
    <p><b>WhatsApp rules:</b> a business may only message people who agreed to it, and the first message must be a template Meta approved. The CRM enforces this: WhatsApp steps go only to stores marked <i>opted in</i> (or who messaged you in the last 24h); others are skipped and get the email steps. Mark opt-in on import with a <i>consent</i> column, or it's set automatically when a store writes to you.</p>
  </div></div>
  <div class="card"><div class="card-head"><h2>Rules the CRM always follows</h2></div><div class="card-body" style="padding:14px 20px;font-size:13px"><ul class="c-list">
    <li>Every email has an unsubscribe link and a one-click unsubscribe header; "stop" or "إلغاء" in any reply stops all messages.</li>
    <li>Sequences stop for a store as soon as it replies.</li><li>Sends only 09:00–21:00 Riyadh time and not on Friday (per campaign).</li>
    <li>Bounced emails are never retried. Sample stores are never sent for real.</li><li>Saudi PDPL: keep the source of your store list and delete a store's data when asked (Stores → select → Delete).</li></ul></div></div>
  </div></div>`;
}

/* ------------------------------------------------ Store drawer */
function crmDrawerEl() {
  let el = $("#cDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="cScrim" hidden></div><aside class="s-drawer" id="cDrawer" hidden aria-label="Store"></aside>`); el = $("#cDrawer"); }
  return el;
}
function crmClose() { const d = $("#cDrawer"); if (d) { d.hidden = true; $("#cScrim").hidden = true; } CRM.openId = null; }
async function crmOpen(id) {
  if (!id) return;
  let d;
  try { d = await api(`${crmP()}/contacts/${id}`); } catch (e) { return toast(e.message, true); }
  CRM.openId = id;
  const c = d.contact, edit = crmEdit(), el = crmDrawerEl();
  const timeline = [...d.messages.map((m) => ({ ...m, kind: "msg" })), ...d.notes.map((n) => ({ ...n, kind: "note" }))].sort((a, b) => b.at.localeCompare(a.at));
  el.innerHTML = `<div class="row gap-12"><div style="flex:1;min-width:0"><h2 dir="auto">${esc(c.store_name)}</h2><span class="subtle">${esc(c.category)} · ${esc(c.city || "–")} · ${esc(c.platform || "")} · ${nf(c.products)} products · fit ${c.score}</span></div><button class="btn btn-sm" data-caction="close">Close</button></div>
  <div class="grid-2">
    <div class="field"><label for="cdStage">Stage</label><select class="input" id="cdStage" ${edit ? "" : "disabled"}>${CRM.meta.stages.map((s) => `<option value="${s.id}" ${s.id === c.stage ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="cdOwner">Owner</label><select class="input" id="cdOwner" ${edit ? "" : "disabled"}><option value="">Unassigned</option>${CRM.meta.users.map((u) => `<option value="${u.id}" ${u.id === c.owner_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
  </div>
  <div class="card" style="padding:12px 16px;font-size:13px"><div class="c-kv">
    <span>Link</span><span>${c.domain ? `<a href="https://${esc(c.domain)}" target="_blank" rel="noopener">${esc(c.domain)}</a>` : "–"}</span>
    <span>Email</span><span>${esc(c.email || "–")}${c.email_opt_out ? ' <span class="badge bad">unsubscribed</span>' : ""}${c.bounced ? ' <span class="badge bad">bounced</span>' : ""}</span>
    <span>Phone</span><span>${c.phone ? "+" + esc(c.phone) : "–"} ${c.phone ? (edit ? `<label class="chip" style="height:auto"><input type="checkbox" id="cdWa" ${c.wa_opt_in ? "checked" : ""}> WhatsApp opt-in</label>` : c.wa_opt_in ? "· opted in" : "") : ""}</span>
    <span>Platform</span><span>${edit ? `<select class="input input-sm" id="cdPlat" style="width:auto">${CRM.meta.platforms.map((p) => `<option ${p.id === c.platform ? "selected" : ""}>${esc(p.id)}</option>`).join("")}</select>` : esc(c.platform || "–")} <span class="subtle" style="font-size:12px">${esc(CRM.meta.platforms.find((p) => p.id === c.platform)?.connect || "")}</span></span>
    <span>Owner name</span><span dir="auto">${esc(c.owner_name || "–")}</span><span>Instagram</span><span>${esc(c.instagram || "–")}</span>
    <span>Tags</span><span>${edit ? `<input class="input input-sm" id="cdTags" value="${esc((c.tags || []).join(", "))}" title="Intent tags raise the fit score: ${Object.keys(CRM.meta.intent_tags || {}).join(", ")}"><div class="subtle" style="font-size:11px;margin-top:2px">Intent tags: ${Object.keys(CRM.meta.intent_tags || {}).join(", ")}</div>` : esc((c.tags || []).join(", ") || "–")}</span>
    <span>Source</span><span>${esc(c.source || "–")} · added ${fmtDate(c.created_at)}</span>
    ${d.deal ? `<span>Deal</span><span><a href="#/${S.ws.id}/pipeline">${esc(d.deal.name)} · ${esc(d.deal.stage)}</a></span>` : ""}
  </div></div>
  ${["onboarding", "active"].includes(c.stage) ? `<div class="card" style="padding:12px 16px"><span class="eyebrow">Onboarding checklist</span><div class="stack" style="margin-top:8px">${CRM.meta.onboarding.map((o) => `<label class="row gap-8" style="font-size:13px"><input type="checkbox" data-onb="${o.id}" ${c.onboarding?.[o.id] ? "checked" : ""} ${edit ? "" : "disabled"}> ${esc(o.name)}</label>`).join("")}</div><p class="subtle" style="font-size:12px;margin-top:6px">All ticked moves the store to Active customer.</p></div>` : ""}
  ${edit ? `<div class="row gap-8"><button class="btn btn-primary btn-sm" data-caction="save-store">Save</button></div>` : ""}
  ${d.enrollments.length ? `<div><span class="eyebrow">Campaigns</span><div class="row gap-8" style="flex-wrap:wrap;margin-top:6px">${d.enrollments.map((e) => `<span class="badge ${e.status === "active" ? "accent" : e.status === "replied" ? "good" : ""}">${esc(e.campaign)} · step ${Math.min(e.step + 1, 99)} · ${e.status}</span>`).join("")}</div></div>` : ""}
  ${edit ? `<div class="card" style="padding:12px 16px"><span class="eyebrow">Send a message</span><div class="stack" style="margin-top:8px">
    <div class="row gap-8"><select class="input input-sm" id="cdCh" style="width:auto"><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select><input class="input input-sm" id="cdTpl" placeholder="WhatsApp template (outside 24h)" style="flex:1"></div>
    <input class="input input-sm" id="cdSubj" placeholder="Email subject" dir="auto"><textarea class="input" id="cdBody" rows="4" dir="auto" placeholder="Message ({{store_name}} etc. work here too)"></textarea>
    <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm btn-primary" data-caction="send-one">Send</button><button class="btn btn-sm" data-caction="log-reply">Log their reply</button><button class="btn btn-sm" data-caction="note">Add as note</button></div></div></div>` : ""}
  <div><span class="eyebrow">Timeline</span><div class="c-timeline">${timeline.map((t) => t.kind === "note"
    ? `<div class="c-tl note"><span class="subtle">${fmtDate(t.at)} · ${esc(t.by)}</span><div dir="auto">${esc(t.text)}</div></div>`
    : `<div class="c-tl ${t.direction}"><span class="subtle">${fmtDate(t.at)} · ${t.direction === "in" ? "Store" : esc(t.by || "AI")} · ${chIcon(t.channel)} · <b class="${t.status === "failed" ? "bad" : ""}">${esc(t.status)}</b>${t.intent ? " · " + esc(t.intent) : ""}</span>${t.subject ? `<b dir="auto">${esc(t.subject)}</b>` : ""}<div dir="auto" style="white-space:pre-wrap">${esc(t.body)}</div>${t.error ? `<span class="subtle" style="font-size:12px">${esc(t.error)}</span>` : ""}</div>`).join("") || `<p class="muted">Nothing yet.</p>`}</div></div>
  ${edit ? `<button class="btn btn-ghost btn-sm" data-caction="del-store" style="color:var(--bad);align-self:flex-start">Delete store and its data</button>` : ""}`;
  el.hidden = false; $("#cScrim").hidden = false;
}

/* ------------------------------------------------ Import dialog */
function crmImportDialog() {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" style="width:min(640px,94vw)"><div style="padding:20px 24px 0"><h2>Import stores</h2><p class="subtle" style="font-size:13px">CSV from Excel or Google Sheets, up to ~40 MB (≈100k stores). Arabic or English headers. Known stores are merged, never duplicated.</p></div>
    <div class="card-body stack" style="padding:16px 24px">
      <input type="file" id="ciFile" accept=".csv,text/csv,.txt" class="input" style="padding-top:8px">
      <div class="grid-2"><div class="field"><label for="ciPlat">Platform</label><select class="input" id="ciPlat">${CRM.meta.platforms.map((p) => `<option>${esc(p.id)}</option>`).join("")}</select><span class="hint">Used when the file has no platform column and the link doesn't show it (e.g. myshopify.com, salla.sa are detected).</span></div>
        <div class="field"><label for="ciTags">Tag this batch</label><input class="input" id="ciTags" placeholder="e.g. salla-30k, oct-2026"></div></div>
      ${CRM.meta.users.length ? `<div class="field"><label>Assign owners (round-robin)</label><div class="row gap-8" style="flex-wrap:wrap">${CRM.meta.users.map((u) => `<label class="chip"><input type="checkbox" name="ciOwn" value="${u.id}"> ${esc(u.name)}</label>`).join("")}</div></div>` : ""}
      <div id="ciPrev" class="muted" style="font-size:13px">Pick a file to see a preview.</div>
    </div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok" id="ciGo" disabled>Import</button></div></form>`;
  d.showModal();
  let text = "";
  $("#ciFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    text = await f.text();
    $("#ciPrev").innerHTML = "Reading…";
    try {
      const p = await api(`${crmP()}/import/preview?platform=${encodeURIComponent($("#ciPlat").value)}`, { method: "POST", body: text, headers: { "Content-Type": "text/csv" } });
      $("#ciPrev").innerHTML = `<p><b>${nf(p.total)}</b> stores · ${nf(p.with_email)} with email · ${nf(p.with_phone)} with phone · ${nf(p.duplicates)} already in the CRM · ${nf(p.no_contact)} with no email or phone</p>
        <p class="subtle">Columns found: ${Object.entries(p.columns).map(([k, v]) => `${esc(k)} ← "${esc(v)}"`).join(", ")}</p>
        <p class="subtle">Platforms: ${Object.entries(p.platforms || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${nf(v)}`).join(" · ")}</p>
        <p class="subtle">Categories: ${Object.entries(p.categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${nf(v)}`).join(" · ")}</p>
        <div class="table-wrap"><table><tbody>${p.sample.map((r) => `<tr><td dir="auto">${esc(r.store_name)}</td><td>${esc(r.category)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${nf(r.products)}</td></tr>`).join("")}</tbody></table></div>`;
      $("#ciGo").disabled = false;
    } catch (err) { $("#ciPrev").innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
  };
  d.onclose = async () => {
    if (d.returnValue !== "ok" || !text) return;
    const owners = [...d.querySelectorAll('input[name="ciOwn"]:checked')].map((i) => i.value).join(",");
    toast("Importing…");
    try {
      const r = await api(`${crmP()}/import?platform=${encodeURIComponent($("#ciPlat").value)}&tags=${encodeURIComponent($("#ciTags").value)}&owners=${owners}`, { method: "POST", body: text, headers: { "Content-Type": "text/csv" } });
      toast(`Imported: ${nf(r.added)} new, ${nf(r.updated)} updated, ${nf(r.skipped)} unchanged`);
      CRM.tab = "stores"; CRM.f = {}; CRM.page = 0; crmRerender();
    } catch (err) { toast(err.message, true); }
  };
}

/* ------------------------------------------------ Events */
async function crmNewCampaign(fields) {
  const c = await api(`${crmP()}/campaigns`, { method: "POST", body: JSON.stringify(fields) });
  CRM.tab = "campaigns"; CRM.editId = c.id; crmRerender();
}
function crmBulkValue() {
  const a = $("#cBulkAct")?.value, el = $("#cBulkVal");
  if (!el) return;
  el.innerHTML = a === "stage" ? `<select class="input input-sm" id="cBulkV">${CRM.meta.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>`
    : a === "owner" ? `<select class="input input-sm" id="cBulkV" multiple size="3">${CRM.meta.users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>`
    : a === "tag" || a === "untag" ? `<input class="input input-sm" id="cBulkV" placeholder="tag">`
    : a === "enroll" ? `<select class="input input-sm" id="cBulkV"><option value="">Loading…</option></select>` : "";
  if (a === "enroll") api(`${crmP()}/campaigns`).then((l) => { $("#cBulkV").innerHTML = l.filter((c) => c.type !== "onboarding").map((c) => `<option value="${c.id}">${esc(c.name)} (${c.status})</option>`).join("") || `<option value="">No campaigns yet</option>`; });
}

let crmFTimer = null;
document.addEventListener("input", (e) => {
  if (S.route !== "crm") return;
  if (e.target.closest("#cStoreF")) { clearTimeout(crmFTimer); crmFTimer = setTimeout(() => { CRM.f = crmReadFilter("cStoreF"); CRM.page = 0; CRM.sel.clear(); CRM.allMatching = false; const pos = e.target.selectionStart; const k = e.target.dataset.f; crmRerender().then(() => { const el = document.querySelector(`#cStoreF [data-f="${k}"]`); if (el && el.type !== "checkbox" && el.tagName === "INPUT") { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} } }); }, 350); }
  if (e.target.closest("#ceF")) { clearTimeout(crmFTimer); crmFTimer = setTimeout(async () => { try { const r = await api(`${crmP()}/contacts?size=1&f=${encodeURIComponent(JSON.stringify(crmReadFilter("ceF")))}`); $("#ceCount").textContent = `${nf(r.total)} stores`; } catch {} }, 300); }
});
document.addEventListener("change", async (e) => {
  if (S.route !== "crm") return;
  const t = e.target;
  if (t.id === "cTarget") { try { localStorage.setItem("crm.target", String(Math.max(1, Number(t.value) || 20))); } catch {} return crmRerender(); }
  if (t.id === "cSort") { CRM.sort = t.value; CRM.page = 0; return crmRerender(); }
  if (t.id === "cBulkAct") return crmBulkValue();
  if (t.dataset.csel) { t.checked ? CRM.sel.add(t.dataset.csel) : CRM.sel.delete(t.dataset.csel); CRM.allMatching = false; return crmRerender(); }
  if (t.id === "cSelPage") { CRM.list.rows.forEach((r) => (t.checked ? CRM.sel.add(r.id) : CRM.sel.delete(r.id))); CRM.allMatching = false; return crmRerender(); }
  if (t.closest?.(".c-step") && ["channel", "design_id"].includes(t.dataset.s)) { const steps = crmReadSteps(); $("#ceSteps").innerHTML = steps.map((s, i) => crmStepHtml(s, i)).join(""); }
  if (t.dataset.caction === "mycalls") { CRM.myCalls = t.checked; return crmRerender(); }
  if (t.dataset.caction === "mine") { CRM.mine = t.checked; return crmRerender(); }
});
document.addEventListener("click", async (e) => {
  if (S.route !== "crm" && !e.target.closest("#cDrawer")) return;
  if (e.target.closest("#cScrim")) return crmClose();
  const tab = e.target.closest("[data-ctab]");
  if (tab) { CRM.tab = tab.dataset.ctab; CRM.editId = null; crmClose(); return crmRerender(); }
  const pg = e.target.closest("[data-cpage]");
  if (pg) { CRM.page = Number(pg.dataset.cpage); return crmRerender(); }
  if (e.target.closest("[data-csel], #cSelPage, label.chip")) return;
  const b = e.target.closest("[data-caction]");
  const open = !b && e.target.closest("[data-copen]");
  if (open) return crmOpen(open.dataset.copen);
  if (!b) return;
  const act = b.dataset.caction, id = b.dataset.id;
  try {
    switch (act) {
      case "import": return crmImportDialog();
      case "sample": { const r = await api(`${crmP()}/sample`, { method: "POST" }); toast(`Added ${r.added} sample stores`); CRM.tab = "stores"; return crmRerender(); }
      case "see-cat": CRM.f = { category: [b.dataset.cat] }; CRM.page = 0; CRM.tab = "stores"; return crmRerender();
      case "see-plat": CRM.f = { platform: [b.dataset.plat] }; CRM.page = 0; CRM.tab = "stores"; return crmRerender();
      case "see-stage": CRM.f = { stage: [b.dataset.stage] }; CRM.page = 0; CRM.tab = "stores"; return crmRerender();
      case "camp-cat": return crmNewCampaign({ name: `${b.dataset.cat} · outreach`, type: "outreach", filter: { category: [b.dataset.cat], stage: ["new"], has_email: true } });
      case "seg-camp": return crmNewCampaign({ name: "Segment campaign", type: "outreach", filter: CRM.f });
      case "clear-f": CRM.f = {}; CRM.page = 0; return crmRerender();
      case "sel-all": CRM.allMatching = true; return crmRerender();
      case "sel-none": CRM.sel.clear(); CRM.allMatching = false; return crmRerender();
      case "bulk-go": {
        const action = $("#cBulkAct").value; if (!action) return toast("Pick an action", true);
        const vEl = $("#cBulkV"); const value = vEl?.multiple ? [...vEl.selectedOptions].map((o) => o.value) : vEl?.value;
        const n = CRM.allMatching ? CRM.list.total : CRM.sel.size;
        if (action === "delete" && !confirm(`Delete ${n} stores and all their messages? This can't be undone.`)) return;
        const r = await api(`${crmP()}/bulk`, { method: "POST", body: JSON.stringify(CRM.allMatching ? { filter: CRM.f, action, value } : { ids: [...CRM.sel], action, value }) });
        toast(`Done: ${nf(r.affected)} stores`); CRM.sel.clear(); CRM.allMatching = false; return crmRerender();
      }
      case "add-store": {
        const d = $("#dialog");
        d.innerHTML = `<form method="dialog" style="width:min(520px,92vw)"><div style="padding:20px 24px 0"><h2>Add a store</h2></div><div class="card-body stack" style="padding:16px 24px">
          ${[["store_name", "Store name"], ["domain", "Store link"], ["email", "Email"], ["phone", "Phone / WhatsApp"], ["city", "City"], ["products", "Products"], ["owner_name", "Owner name"]].map(([k, l]) => `<div class="field"><label for="as-${k}">${l}</label><input class="input" id="as-${k}" ${k === "store_name" ? "required" : ""} dir="auto"></div>`).join("")}
          <div class="field"><label for="as-platform">Platform</label><select class="input" id="as-platform"><option value="">Detect from link</option>${CRM.meta.platforms.map((p) => `<option>${esc(p.id)}</option>`).join("")}</select></div>
          <div class="field"><label for="as-category">Category</label><select class="input" id="as-category">${CRM.meta.categories.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div></div>
          <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Add</button></div></form>`;
        d.showModal();
        d.onclose = async () => { if (d.returnValue !== "ok") return; const body = Object.fromEntries(["store_name", "domain", "email", "phone", "city", "products", "owner_name", "category", "platform"].map((k) => [k, $("#as-" + k).value]).filter(([k, v]) => k !== "platform" || v));
          try { const c = await api(`${crmP()}/contacts`, { method: "POST", body: JSON.stringify(body) }); toast("Store added"); await crmRerender(); crmOpen(c.id); } catch (err) { toast(err.message, true); } };
        return;
      }
      case "starter-camps": { const r = await api(`${crmP()}/campaigns/starter`, { method: "POST" }); toast(r.added ? `Added ${r.added} campaigns as drafts` : "Starter campaigns are already there"); return crmRerender(); }
      case "new-camp": return crmNewCampaign({ name: "New campaign", type: "outreach", filter: { stage: ["new"], has_email: true } });
      case "edit-camp": CRM.editId = id; return crmRerender();
      case "ab": {
        const d = $("#dialog");
        d.innerHTML = `<form method="dialog" style="width:min(520px,92vw)"><div style="padding:20px 24px 0"><h2>A/B test: what's the one thing to test?</h2><p class="subtle" style="font-size:13px">Change one thing at a time. If you change the subject and the timing together, you won't know which one worked. The segment is split in half: A keeps this campaign, B gets the change.</p></div>
          <div class="card-body stack" style="padding:16px 24px">${[["subject", "Subject line"], ["message", "Message text (angle, offer, length)"], ["channel", "Channel: email vs WhatsApp"], ["timing", "Timing: days between steps or send hours"], ["steps", "Number of steps"], ["segment", "Who gets it (persona or category)"]].map(([v, l], i) => `<label class="row gap-8"><input type="radio" name="abv" value="${v}" ${i ? "" : "checked"}> ${l}</label>`).join("")}</div>
          <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Create version B</button></div></form>`;
        d.showModal();
        d.onclose = async () => { if (d.returnValue !== "ok") return;
          try { const b2 = await api(`${crmP()}/campaigns/${id}/variant`, { method: "POST", body: JSON.stringify({ variable: d.querySelector('input[name="abv"]:checked').value }) }); toast("Version B created: change only that one thing"); CRM.editId = b2.id; crmRerender(); } catch (err) { toast(err.message, true); } };
        return;
      }
      case "back": CRM.editId = null; return crmRerender();
      case "launch": case "resume": case "pause": {
        if (act === "launch" && CRM.meta.settings.mode === "live" && !confirm("Live mode is on: this campaign will really send. Launch?")) return;
        const r = await api(`${crmP()}/campaigns/${id}/${act}`, { method: "POST" });
        toast(act === "launch" && r.ab ? `A/B test launched: ${nf(r.enrolled)} stores split between A and B` : act === "launch" ? (r.enrolled ? `Launched: ${nf(r.enrolled)} stores, first sends ${fmtDate(r.starts_at)}` : "Onboarding flow is on: it starts for each store you move to Onboarding") : act === "pause" ? "Paused" : "Running again");
        return crmRerender();
      }
      case "save-camp": await crmSaveCampaign(); toast("Saved"); return crmPreview();
      case "save-launch": {
        await crmSaveCampaign();
        if (CRM.meta.settings.mode === "live" && !confirm("Live mode is on: this campaign will really send. Launch?")) return;
        const r = await api(`${crmP()}/campaigns/${CRM.editId}/launch`, { method: "POST" });
        toast(r.enrolled ? `Launched: ${nf(r.enrolled)} stores` : "Onboarding flow is on"); CRM.editId = null; return crmRerender();
      }
      case "del-camp": if (!confirm("Delete this campaign? Its send history stays on each store.")) return; await api(`${crmP()}/campaigns/${CRM.editId}`, { method: "DELETE" }); CRM.editId = null; return crmRerender();
      case "add-step": { const s = crmReadSteps(); s.push({ channel: "email", delay_days: 3, subject: "", body: "" }); $("#ceSteps").innerHTML = s.map((x, i) => crmStepHtml(x, i)).join(""); return; }
      case "del-step": { const s = crmReadSteps(); s.splice(Number(b.dataset.i), 1); $("#ceSteps").innerHTML = s.map((x, i) => crmStepHtml(x, i)).join(""); return; }
      case "ai-open": $("#ceAi").hidden = !$("#ceAi").hidden; return;
      case "ai-write": {
        await crmSaveCampaign();
        b.disabled = true; b.textContent = "Writing…";
        try {
          await api(`${crmP()}/campaigns/${CRM.editId}/ai-write`, { method: "POST", body: JSON.stringify({ category: $("#aiCat").value, goal: $("#aiGoal").value, steps: Number($("#aiSteps").value), language: $("#aiLang").value, channels: [$("#aiEmail").checked && "email", $("#aiWa").checked && "whatsapp"].filter(Boolean) }) });
          toast("Sequence written. Review it before launch."); return crmRerender();
        } finally { b.disabled = false; b.textContent = "Write sequence"; }
      }
      case "preview": await crmSaveCampaign(); return crmPreview();
      case "inbox-open": CRM.inboxAll = false; return crmRerender();
      case "inbox-all": CRM.inboxAll = true; return crmRerender();
      case "reply": {
        const body = $("#rep-" + id).value.trim(); if (!body) return toast("Write the reply", true);
        await api(`${crmP()}/contacts/${b.dataset.store}/send`, { method: "POST", body: JSON.stringify({ channel: b.dataset.ch, subject: b.dataset.subj ? "Re: " + b.dataset.subj.replace(/^re:\s*/i, "") : "رد من DPA AD", body, reply_to: id }) });
        toast(CRM.meta.settings.mode === "live" ? "Reply sent" : "Reply logged (test mode)"); return crmRerender();
      }
      case "done": await api(`${crmP()}/inbox/${id}/done`, { method: "POST" }); return crmRerender();
      case "call-done": { const note = b.dataset.o === "no_answer" ? "" : prompt("Anything to note? (optional)") || ""; await api(`${crmP()}/calls/${id}`, { method: "POST", body: JSON.stringify({ outcome: b.dataset.o, note }) }); toast(b.dataset.o === "meeting" ? "Meeting booked: deal added to Sales" : "Logged"); return crmRerender(); }
      case "icp": {
        const n = Number(prompt(`Tag the best-fit stores in this view as "icp" (your focus list: they get the full cadence including calls). How many?`, String(CRM.meta.settings.targets?.focus_list || 300))); if (!n) return;
        const r = await api(`${crmP()}/bulk`, { method: "POST", body: JSON.stringify({ filter: CRM.f, action: "icp", value: n }) });
        toast(`${nf(r.affected)} stores tagged "icp". Filter by Tag: icp to work the list.`); return crmRerender();
      }
      case "mode": {
        if (b.dataset.v === "live" && !confirm("Switch to Live? Running campaigns will start really sending emails and WhatsApp messages within the next minute.")) return;
        CRM.meta.settings = await api(`${crmP()}/settings`, { method: "PUT", body: JSON.stringify({ mode: b.dataset.v }) }); toast(b.dataset.v === "live" ? "Live" : "Test mode"); return crmRerender();
      }
      case "save-settings":
        CRM.meta.settings = await api(`${crmP()}/settings`, { method: "PUT", body: JSON.stringify({ sender_name: $("#csSender").value, per_tick: $("#csTick").value, email_daily_cap: $("#csEmailCap").value, wa_daily_cap: $("#csWaCap").value, auto_reply: $("#csAuto").checked, auto_deal: $("#csDeal").checked, targets: { reply_pct: $("#tReply").value, meeting_pct: $("#tMeet").value, close_pct: $("#tClose").value, focus_list: $("#tFocus").value } }) });
        return toast("Saved");
      case "run-now": { const r = await api(`${crmP()}/run`, { method: "POST" }); return toast(`${nf(r.sent)} sent, ${nf(r.skipped)} skipped, ${nf(r.waiting)} waiting for tomorrow's cap`); }
      // drawer
      case "close": return crmClose();
      case "save-store": {
        const onb = Object.fromEntries([...document.querySelectorAll("[data-onb]")].map((x) => [x.dataset.onb, x.checked]));
        await api(`${crmP()}/contacts/${CRM.openId}`, { method: "PUT", body: JSON.stringify({ stage: $("#cdStage").value, owner_id: $("#cdOwner").value || null, platform: $("#cdPlat")?.value, tags: $("#cdTags")?.value ?? undefined, wa_opt_in: $("#cdWa") ? $("#cdWa").checked : undefined, ...(Object.keys(onb).length ? { onboarding: onb } : {}) }) });
        toast("Saved"); await crmOpen(CRM.openId); return crmRerender();
      }
      case "send-one": case "log-reply": case "note": {
        const body = $("#cdBody").value.trim(); if (!body) return toast("Write the message first", true);
        if (act === "note") await api(`${crmP()}/contacts/${CRM.openId}/notes`, { method: "POST", body: JSON.stringify({ text: body }) });
        else if (act === "log-reply") await api(`${crmP()}/contacts/${CRM.openId}/log-reply`, { method: "POST", body: JSON.stringify({ channel: $("#cdCh").value, body }) });
        else { const m = await api(`${crmP()}/contacts/${CRM.openId}/send`, { method: "POST", body: JSON.stringify({ channel: $("#cdCh").value, subject: $("#cdSubj").value, body, wa_template: $("#cdTpl").value }) }); toast(m.status === "sent" ? "Sent" : "Logged (test mode)"); }
        return crmOpen(CRM.openId);
      }
      case "del-store": if (!confirm("Delete this store and all its messages?")) return; await api(`${crmP()}/contacts/${CRM.openId}`, { method: "DELETE" }); crmClose(); return crmRerender();
    }
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && CRM.openId && !$("#dialog").open) crmClose(); });

if (S.route === "crm" && S.ws) render();
