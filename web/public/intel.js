/* Market intel: competitors (with a change log and a weekly watch of a public page), market signals (typed in or
   imported from Sales, Support, Product and Store CRM), win/loss from Sales deals, a TAM/SAM/SOM calculator whose
   inputs a person types with a source, and the AI-drafted weekly brief a person approves.
   Uses app.js globals (S, $, api, esc, md, toast, fmtDate, ROUTES, levelFor). Names start with "mi". */

const MI = { tab: "signals", meta: null, ov: null, sig: null, comps: null, comp: null, wl: null, size: null, briefs: null, filter: { type: "", tag: "", days: "" }, openComp: null, openBrief: null };
const MI_TABS = [["signals", "Signals"], ["competitors", "Competitors"], ["winloss", "Win/loss"], ["sizing", "Market sizing"], ["brief", "Weekly brief"]];
const MI_IMPACT = { high: ["High", "bad"], med: ["Medium", "warn"], low: ["Low", ""] };
const MI_BRIEF = { draft: ["Waiting for approval", "warn"], approved: ["Approved", "good"], rejected: ["Rejected", ""] };
const miP = () => `/api/workspaces/${S.ws.id}/intel`;
const miEdit = () => levelFor("intel") === "edit";
const miDis = () => (miEdit() ? "" : "disabled");
const miBadge = (map, k) => { const [l, t] = map[k] || [k, ""]; return `<span class="badge ${t}">${esc(l)}</span>`; };
const miType = (id) => MI.meta?.signal_types.find((t) => t.id === id)?.name || id;
const miInt = (v) => (v == null ? "–" : Math.round(v).toLocaleString("en-US"));
const miUsd = (v) => (v == null ? "–" : "$" + Math.round(v).toLocaleString("en-US"));
const miLink = (u, label) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow" class="mi-link">${esc(label || u.replace(/^https?:\/\//, "").slice(0, 60))}</a>` : "");
const miPost = (p, b) => api(`${miP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const miPut = (p, b) => api(`${miP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });

ROUTES.intel = { title: "Market intel", crumb: "Grow", render: renderIntel };

async function renderIntel(view) {
  if (S.param && MI_TABS.some(([k]) => k === S.param)) MI.tab = S.param;
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs mi-tabs" role="tablist" aria-label="Market intel views">${MI_TABS.map(([k, l]) => `<button role="tab" data-mitab="${k}" aria-selected="${MI.tab === k}">${l}</button>`).join("")}</div>
    <div id="miTop" style="margin-top:16px"></div><div id="miBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { if (!MI.meta) MI.meta = await api("/api/intel/meta"); } catch (e) { $("#miBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await miShow();
}
async function miShow() {
  if (S.route !== "intel") return;
  document.querySelectorAll("[data-mitab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.mitab === MI.tab));
  const box = $("#miBody"); if (!box) return;
  try {
    MI.ov = await api(miP());
    $("#miTop").innerHTML = miTiles();
    if (MI.tab === "signals") { const q = new URLSearchParams(Object.entries(MI.filter).filter(([, v]) => v)).toString(); [MI.sig, MI.comps] = await Promise.all([api(`${miP()}/signals${q ? "?" + q : ""}`), api(`${miP()}/competitors`)]); box.innerHTML = miSignals(); }
    if (MI.tab === "competitors") { MI.comps = await api(`${miP()}/competitors`); MI.comp = MI.openComp ? await api(`${miP()}/competitors/${MI.openComp}`).catch(() => null) : null; box.innerHTML = miCompetitors(); }
    if (MI.tab === "winloss") { MI.wl = await api(`${miP()}/winloss`); box.innerHTML = miWinLoss(); }
    if (MI.tab === "sizing") { MI.size = await api(`${miP()}/sizing`); box.innerHTML = miSizing(); }
    if (MI.tab === "brief") { MI.briefs = await api(`${miP()}/briefs`); box.innerHTML = miBriefs(); }
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}
function miTiles() {
  const o = MI.ov;
  const t = [["Signals · 7 days", miInt(o.signals_7d), `${o.high_7d} high impact · ${o.signals} in all`, o.high_7d ? "warn" : ""], ["Competitors", miInt(o.competitors), `${o.watched} page${o.watched === 1 ? "" : "s"} watched weekly`, ""],
    ["Page changes to review", miInt(o.unreviewed), o.unreviewed ? "open Competitors" : "nothing waiting", o.unreviewed ? "warn" : ""], ["Briefs waiting", miInt(o.briefs_waiting), o.analyst_level ? "AI Market analyst: drafts only" : "AI Market analyst is off", o.briefs_waiting ? "warn" : ""]];
  return `<section class="s-kpis">${t.map(([l, v, sub, tone]) => `<div class="card s-kpi ${tone}"><span class="eyebrow">${l}</span><b class="num">${v}</b><span class="subtle">${esc(sub)}</span></div>`).join("")}</section>`;
}

/* ------------------------------------------------ Signals */
function miSignals() {
  const d = MI.sig, m = MI.meta, ed = miEdit();
  const opt = (list, cur, empty) => `<option value="">${empty}</option>${list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
  const form = ed ? `<section class="card card-pad"><h3 style="margin:0 0 10px">Add a signal</h3><form id="miSigForm" class="mi-form">
      <div class="field mi-wide"><label for="mis-title">What happened</label><input class="input" id="mis-title" required maxlength="200" dir="auto" placeholder="e.g. TikTok changed catalog ad requirements"></div>
      <div class="field"><label for="mis-type">Type</label><select class="input" id="mis-type" required>${m.signal_types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="mis-platform">Platform</label><select class="input" id="mis-platform">${opt(m.signal_platforms.map((p) => [p, p]), "", "–")}</select><span class="hint">Needed for platform changes</span></div>
      <div class="field"><label for="mis-impact">Impact</label><select class="input" id="mis-impact"><option value="low">Low</option><option value="med" selected>Medium</option><option value="high">High</option></select></div>
      <div class="field"><label for="mis-date">Date</label><input class="input" id="mis-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field mi-wide"><label for="mis-url">Source link</label><input class="input" id="mis-url" type="url" placeholder="https://…" dir="ltr"></div>
      <div class="field"><label for="mis-tags">Tags (themes)</label><input class="input" id="mis-tags" placeholder="video, zid" dir="auto"></div>
      <div class="field"><label for="mis-module">Linked module</label><select class="input" id="mis-module">${m.modules.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label for="mis-comp">Competitor</label><select class="input" id="mis-comp">${opt((MI.comps || []).map((c) => [c.id, c.name]), "", "–")}</select></div>
      <div class="field mi-wide"><label for="mis-text">Notes</label><textarea class="input" id="mis-text" rows="2" maxlength="3000" dir="auto" placeholder="Only what the source says"></textarea></div>
      <div class="row gap-8 mi-wide"><button class="btn btn-primary" type="submit">Add signal</button></div></form></section>` : "";
  const imp = ed ? `<section class="card card-pad"><h3 style="margin:0 0 6px">Import from other modules</h3><p class="subtle s-small" style="margin:0 0 10px">Adds each item once. Needs view access on the module it reads.</p>
      <fieldset class="mi-checks"><legend class="mi-sr">Sources</legend>${m.import_sources.map((s) => `<label class="row gap-8"><input type="checkbox" data-misrc="${s.id}" checked> <span>${esc(s.name)}</span></label>`).join("")}</fieldset>
      <button class="btn" data-miact="import" style="margin-top:10px">Import</button></section>` : "";
  const th = d.themes;
  const themes = `<section class="card card-pad"><span class="eyebrow">Themes${MI.filter.days ? ` · last ${esc(MI.filter.days)} days` : ""}</span>
    <div class="mi-chips">${th.tags.length ? th.tags.slice(0, 24).map((t) => `<button class="chip ${MI.filter.tag === t.tag ? "active" : ""}" data-mitag="${esc(t.tag)}" dir="auto">${esc(t.tag)} · ${t.n}${t.high ? ` <span class="badge bad">${t.high} high</span>` : ""}</button>`).join("") : `<span class="subtle s-small">No tags yet.</span>`}</div>
    <div class="mi-bars" style="margin-top:12px">${miBars(th.types.map((t) => ({ label: t.name, n: t.n })))}</div>
    ${Object.keys(th.platforms).length ? `<p class="subtle s-small" style="margin:8px 0 0">Platforms: ${Object.entries(th.platforms).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>` : ""}</section>`;
  const filters = `<div class="row gap-8 mi-filters"><select class="input input-sm" data-mifilter="type" aria-label="Type">${opt(m.signal_types.map((t) => [t.id, t.name]), MI.filter.type, "All types")}</select>
    <select class="input input-sm" data-mifilter="days" aria-label="Period">${opt([["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]], MI.filter.days, "Any date")}</select>
    ${MI.filter.tag ? `<button class="btn btn-sm" data-mitag="">Tag: ${esc(MI.filter.tag)} ✕</button>` : ""}<span class="subtle s-small">${d.signals.length} of ${d.total}</span></div>`;
  const list = d.signals.length ? `<ul class="mi-list">${d.signals.map((s) => `<li class="mi-item"><div class="row between gap-8" style="flex-wrap:wrap"><b dir="auto">${esc(s.title)}</b><span class="row gap-8">${miBadge(MI_IMPACT, s.impact)}${ed ? `<button class="btn btn-sm btn-ghost" data-miact="del-signal" data-id="${esc(s.id)}" aria-label="Delete signal">Delete</button>` : ""}</span></div>
      <div class="mi-meta subtle s-small"><span>#S${esc(s.id)}</span><span>${esc(s.date)}</span><span>${esc(miType(s.type))}${s.platform ? ` · ${esc(s.platform)}` : ""}</span>${s.module ? `<span>→ ${esc((m.modules.find(([v]) => v === s.module) || [, s.module])[1])}</span>` : ""}${s.origin ? `<span>from ${esc(s.origin.split(":")[0])}</span>` : ""}${(s.tags || []).map((t) => `<span class="badge" dir="auto">${esc(t)}</span>`).join("")}${miLink(s.source_url, "source")}</div>
      ${s.text ? `<p class="s-small mi-text" dir="auto">${esc(s.text.slice(0, 400))}</p>` : ""}</li>`).join("")}</ul>` : `<p class="muted s-small">No signals${MI.filter.type || MI.filter.tag || MI.filter.days ? " match these filters" : " yet: add one or import from the other modules"}.</p>`;
  return `<div class="cc"><div class="cc-span-8 stack" style="gap:16px"><section class="card card-pad">${filters}${list}</section></div><div class="cc-span-4 stack" style="gap:16px">${themes}${form}${imp}</div></div>`;
}
function miBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return rows.map((r) => `<div class="mi-bar-row"><span class="s-small" dir="auto">${esc(r.label)}</span><span class="mi-bar" role="img" aria-label="${esc(r.label)}: ${r.n}"><i style="width:${(r.n / max) * 100}%"></i></span><b class="num s-small">${r.n}</b></div>`).join("");
}

/* ------------------------------------------------ Competitors */
function miCompetitors() {
  const ed = miEdit(), list = MI.comps;
  const rows = list.length ? `<div class="table-wrap"><table class="f-table mi-table"><thead><tr><th>Competitor</th><th>Segment</th><th>Platforms</th><th>Pricing (as read)</th><th>Watched page</th><th>Last checked</th></tr></thead><tbody>
    ${list.map((c) => `<tr class="${MI.openComp === c.id ? "mi-open" : ""}"><td><button class="mi-btnlink" data-miact="open-comp" data-id="${esc(c.id)}" dir="auto"><b>${esc(c.name)}</b></button>${c.unreviewed ? ` <span class="badge warn">${c.unreviewed} change${c.unreviewed === 1 ? "" : "s"} to review</span>` : ""}<div>${miLink(c.site)}</div></td>
      <td dir="auto">${esc(c.segment || "–")}</td><td>${esc((c.platforms || []).join(", ") || "–")}</td>
      <td>${c.pricing?.length ? c.pricing.map((t) => `<div dir="auto">${esc(t.tier)} ${esc(t.price)}</div>`).join("") + `<span class="subtle s-small">${miLink(c.pricing_source_url, "source")}${c.pricing_checked_on ? ` · ${esc(c.pricing_checked_on)}` : ""}</span>` : `<span class="subtle">[ADD]</span>`}</td>
      <td>${c.watch_url ? `${c.watch_enabled ? `<span class="badge good">weekly</span>` : `<span class="badge">off</span>`} ${c.watch.last_error ? `<span class="badge bad" title="${esc(c.watch.last_error)}">error</span>` : ""}<div class="subtle s-small">${c.watch.last_checked_at ? "checked " + esc(c.watch.last_checked_at.slice(0, 10)) : "not checked yet"}</div>` : "–"}</td>
      <td class="num">${esc(c.last_checked || "–")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small">No competitors yet. Add the ones customers name in demos and lost deals.</p>`;
  const add = ed ? `<form id="miCompAdd" class="row gap-8" style="flex-wrap:wrap;margin-top:12px"><input class="input" id="mic-new" required maxlength="120" placeholder="Competitor name" dir="auto" aria-label="Competitor name" style="flex:1;min-width:180px"><input class="input" id="mic-site" placeholder="Site (https://…)" dir="ltr" aria-label="Site" style="flex:1;min-width:180px"><button class="btn btn-primary" type="submit">Add competitor</button></form>` : "";
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Competitors</h3><span class="subtle s-small">Pricing is typed by a person from the competitor's own page, with the link and date. Watched pages are fetched at most once a week.</span></div>${rows}${add}</section>${MI.comp ? miCompPanel(MI.comp) : ""}`;
}
function miCompPanel(c) {
  const m = MI.meta, ed = miEdit(), dis = miDis();
  const txt = (k, l, rows = 2) => `<div class="field mi-wide"><label for="mic-${k}">${l}</label><textarea class="input" id="mic-${k}" rows="${rows}" dir="auto" ${dis}>${esc(c[k] || "")}</textarea></div>`;
  const tiers = [...(c.pricing || []), { tier: "", price: "", notes: "" }];
  const changes = c.changes.length ? `<ul class="mi-list">${c.changes.map((x) => `<li class="mi-item ${x.kind === "page" && !x.reviewed_at ? "mi-unreviewed" : ""}"><div class="row between gap-8" style="flex-wrap:wrap"><span class="s-small"><b>${esc({ page: "Watched page changed", edit: "Edited", note: "Note", watch: "Watch started", created: "Added" }[x.kind] || x.kind)}</b> · ${esc(fmtDate(x.created_at))} · ${esc(x.by || "")} · #C${esc(x.id)}</span>
      ${x.kind === "page" ? (x.reviewed_at ? `<span class="badge good">reviewed${x.reviewed_by ? " by " + esc(x.reviewed_by) : ""}</span>` : ed ? `<button class="btn btn-sm" data-miact="review" data-id="${esc(x.id)}">Mark reviewed</button>` : `<span class="badge warn">to review</span>`) : ""}</div>
      ${x.kind === "page" ? `<p class="s-small" style="margin:4px 0">${esc(x.summary)}</p>${x.added?.length ? `<details><summary class="s-small">Added (${x.added.length})</summary><ul class="s-small mi-diff">${x.added.map((l) => `<li dir="auto">+ ${esc(l)}</li>`).join("")}</ul></details>` : ""}${x.removed?.length ? `<details><summary class="s-small">Removed (${x.removed.length})</summary><ul class="s-small mi-diff">${x.removed.map((l) => `<li dir="auto">− ${esc(l)}</li>`).join("")}</ul></details>` : ""}${miLink(x.url, "page")}`
        : `<p class="s-small mi-text" dir="auto" style="margin:4px 0">${esc((x.lines || []).join("\n") || x.text)}</p>${miLink(x.url, "source")}`}</li>`).join("")}</ul>` : `<p class="muted s-small">No changes yet.</p>`;
  return `<section class="card card-pad" style="margin-top:16px" id="miCompPanel"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0" dir="auto">${esc(c.name)}</h3><div class="row gap-8">${ed ? `<button class="btn btn-sm btn-ghost" data-miact="del-comp" data-id="${esc(c.id)}">Delete</button>` : ""}<button class="btn btn-sm" data-miact="close-comp">Close</button></div></div>
    <div class="cc" style="margin-top:12px"><form id="miCompForm" class="mi-form cc-span-8" data-id="${esc(c.id)}">
      <div class="field"><label for="mic-name">Name</label><input class="input" id="mic-name" value="${esc(c.name)}" required dir="auto" ${dis}></div>
      <div class="field"><label for="mic-site2">Site</label><input class="input" id="mic-site2" value="${esc(c.site)}" dir="ltr" ${dis}></div>
      <div class="field"><label for="mic-segment">Segment</label><select class="input" id="mic-segment" ${dis}><option value="">–</option>${m.segments.map((s) => `<option ${s === c.segment ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      <div class="field"><label for="mic-last">Last checked by a person</label><input class="input" id="mic-last" type="date" value="${esc(c.last_checked)}" ${dis}></div>
      <fieldset class="mi-checks mi-wide"><legend class="s-small"><b>Platforms supported</b></legend>${m.competitor_platforms.map((p) => `<label class="row gap-8"><input type="checkbox" data-miplat="${esc(p)}" ${(c.platforms || []).includes(p) ? "checked" : ""} ${dis}> <span>${esc(p)}</span></label>`).join("")}</fieldset>
      <fieldset class="mi-wide mi-tiers"><legend class="s-small"><b>Pricing tiers</b> (exactly as on their page)</legend>${tiers.map((t, i) => `<div class="mi-tier"><input class="input input-sm" data-mitier="tier" data-i="${i}" value="${esc(t.tier)}" placeholder="Tier" aria-label="Tier name" dir="auto" ${dis}><input class="input input-sm" data-mitier="price" data-i="${i}" value="${esc(t.price)}" placeholder="Price as shown, e.g. $99/mo" aria-label="Price" dir="auto" ${dis}><input class="input input-sm" data-mitier="notes" data-i="${i}" value="${esc(t.notes)}" placeholder="Limits / notes" aria-label="Notes" dir="auto" ${dis}></div>`).join("")}</fieldset>
      <div class="field"><label for="mic-psrc">Pricing source link</label><input class="input" id="mic-psrc" value="${esc(c.pricing_source_url)}" dir="ltr" placeholder="https://…/pricing" ${dis}></div>
      <div class="field"><label for="mic-pdate">Pricing read on</label><input class="input" id="mic-pdate" type="date" value="${esc(c.pricing_checked_on)}" ${dis}></div>
      ${txt("positioning", "Positioning")}${txt("strengths", "Strengths")}${txt("weaknesses", "Weaknesses")}${txt("notes", "Notes")}
      <div class="field mi-wide"><label for="mic-watch">Page to watch (public pricing or landing page)</label><input class="input" id="mic-watch" value="${esc(c.watch_url)}" dir="ltr" placeholder="https://…/pricing" ${dis}><span class="hint">Fetched by the safe fetcher only: public addresses, 8 s, about 2 MB, at most once a week. A change raises a need on Home.</span></div>
      <label class="row gap-8 mi-wide"><input type="checkbox" id="mic-watchon" ${c.watch_enabled ? "checked" : ""} ${dis}> <span>Check it every week</span></label>
      ${ed ? `<div class="row gap-8 mi-wide" style="flex-wrap:wrap"><button class="btn btn-primary" type="submit">Save</button>${c.watch_url ? `<button class="btn" type="button" data-miact="check" data-id="${esc(c.id)}" ${c.watch.due ? "" : "disabled"}>${c.watch.due ? "Check page now" : "Next check " + esc((c.watch.next_check_at || "").slice(0, 10))}</button>` : ""}</div>` : ""}
      ${c.watch.last_error ? `<p class="s-small mi-wide" style="color:var(--bad);margin:0">Last check: ${esc(c.watch.last_error)}</p>` : ""}
    </form>
    <div class="cc-span-4 stack" style="gap:8px"><span class="eyebrow">Change log</span>${ed ? `<form id="miNoteForm" class="stack" style="gap:6px" data-id="${esc(c.id)}"><textarea class="input" id="mic-note" rows="2" required maxlength="1000" dir="auto" placeholder="What changed (launch, new market, price heard on a call)" aria-label="What changed"></textarea><input class="input input-sm" id="mic-noteurl" dir="ltr" placeholder="Source link (optional)" aria-label="Source link"><button class="btn btn-sm" type="submit">Add to log</button></form>` : ""}${changes}</div></div></section>`;
}

/* ------------------------------------------------ Win / loss */
function miWinLoss() {
  const d = MI.wl, ed = d.can_edit_deals;
  if (!d.rows.length) return `<div class="card empty"><h2>No won or lost deals yet</h2><p>Deals at Paying (won) and Lost in the Sales pipeline show here with their reason and the competitor named.</p></div>`;
  const chart = (title, rows) => `<section class="card card-pad cc-span-6"><span class="eyebrow">${title}</span><div class="mi-bars" style="margin-top:10px">${rows.slice(0, 10).map((r) => {
    const max = Math.max(1, ...rows.map((x) => x.won + x.lost));
    return `<div class="mi-bar-row"><span class="s-small" dir="auto">${esc(r.label)}</span><span class="mi-bar" role="img" aria-label="${esc(r.label)}: ${r.won} won, ${r.lost} lost"><i class="mi-won" style="width:${(r.won / max) * 100}%"></i><i class="mi-lost" style="width:${(r.lost / max) * 100}%"></i></span><b class="num s-small">${r.won}/${r.lost}</b></div>`; }).join("")}</div>
    <p class="subtle s-small" style="margin:8px 0 0"><i class="s-dot" style="background:var(--good)"></i> won · <i class="s-dot" style="background:var(--bad)"></i> lost</p></section>`;
  const tiles = [["Won", miInt(d.won), "deals at Paying"], ["Lost", miInt(d.lost), `${d.lost_to_status_quo} to the status quo`], ["Win rate", d.win_rate == null ? "–" : Math.round(d.win_rate * 100) + "%", "won ÷ (won + lost)"], ["No reason recorded", miInt(d.missing_reason), d.missing_reason ? "add them below" : "all recorded"]];
  return `<section class="s-kpis">${tiles.map(([l, v, s]) => `<div class="card s-kpi"><span class="eyebrow">${l}</span><b class="num">${v}</b><span class="subtle">${esc(s)}</span></div>`).join("")}</section>
    <div class="cc" style="margin-top:16px">${chart("By reason", d.by_reason)}${chart("By competitor", d.by_competitor)}
    <section class="card cc-span-12"><div class="card-head" style="padding:14px 20px"><h3>Deals</h3><span class="subtle s-small">${ed ? "Edit the reason and competitor here; it saves to the Sales deal." : "Editing needs Sales edit access."}</span></div>
    <div class="table-wrap"><table class="f-table mi-table"><thead><tr><th>Deal</th><th>Outcome</th><th>Date</th><th>Reason</th><th>Competitor</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td dir="auto">${esc(r.name)}</td><td>${r.outcome === "won" ? `<span class="badge good">Won</span>` : `<span class="badge bad">Lost</span>`}</td><td class="num">${esc(r.date)}</td>
      <td><input class="input input-sm mi-reason" data-miwl="${esc(r.id)}" data-field="${r.outcome === "won" ? "won_reason" : "lost_reason"}" value="${esc(r.reason)}" placeholder="[ADD] why" dir="auto" aria-label="Reason" ${ed ? "" : "disabled"}></td>
      <td><input class="input input-sm" data-miwl="${esc(r.id)}" data-field="competitor" value="${esc(r.competitor)}" placeholder="–" dir="auto" aria-label="Competitor" ${ed ? "" : "disabled"}></td></tr>`).join("")}</tbody></table></div></section></div>`;
}

/* ------------------------------------------------ Market sizing */
function miSizing() {
  const d = MI.size, r = d.result, dis = miDis();
  const row = (f) => { const x = d.inputs[f.id] || {}; return `<div class="mi-size-row"><label for="miz-${f.id}" class="s-small">${esc(f.label)}</label><input class="input input-sm num" id="miz-${f.id}" data-mizv="${f.id}" type="number" min="0" ${f.kind === "pct" ? 'max="100" step="any"' : 'step="1"'} value="${x.value ?? ""}" placeholder="[ADD]" ${dis}><input class="input input-sm" data-mizs="${f.id}" value="${esc(x.source || "")}" placeholder="Source (link or document)" aria-label="Source for ${esc(f.label)}" dir="auto" ${dis}></div>`; };
  const groups = [["Stores by platform", d.fields.filter((f) => f.kind === "count")], ["Funnel", d.fields.filter((f) => f.kind === "pct" && !f.plan)], ["Plan mix (must add up to 100%)", d.fields.filter((f) => f.plan)]];
  const out = (l, stores, arr, need) => `<div class="card s-kpi"><span class="eyebrow">${l}</span><b class="num">${stores == null ? "[ADD]" : miInt(stores) + " stores"}</b><span class="subtle">${arr == null ? (stores == null ? `needs: ${esc(need)}` : "ARR needs the plan mix") : miUsd(arr) + " ARR"}</span></div>`;
  const g = r.goal;
  return `<div class="cc"><section class="card card-pad cc-span-6 mi-size"><h3 style="margin:0 0 4px">Inputs</h3><p class="subtle s-small" style="margin:0 0 12px">Every number is typed by a person, with its source. Empty inputs give no result: nothing is estimated for you.</p>
    <form id="miSizeForm">${groups.map(([t, fs]) => `<fieldset class="mi-size-group"><legend class="s-small"><b>${t}</b></legend>${fs.map(row).join("")}</fieldset>`).join("")}
    ${miEdit() ? `<button class="btn btn-primary" type="submit" style="margin-top:10px">Save inputs</button>` : ""}</form>${d.updated_at ? `<p class="subtle s-small">Saved ${esc(fmtDate(d.updated_at))}</p>` : ""}
    ${r.unsourced.length ? `<p class="s-small" style="color:var(--warn)">${r.unsourced.length} input${r.unsourced.length === 1 ? " has" : "s have"} no source yet.</p>` : ""}</section>
    <div class="cc-span-6 stack" style="gap:16px"><section class="s-kpis mi-size-out">${out("TAM", r.tam_stores, r.tam_arr_usd, "store counts and % with ad spend")}${out("SAM", r.sam_stores, r.sam_arr_usd, "TAM and % we can serve")}${out("SOM", r.som_stores, r.som_arr_usd, "SAM and % we can win")}
      <div class="card s-kpi"><span class="eyebrow">Blended ARPA</span><b class="num">${r.arpa_usd == null ? "[ADD]" : miUsd(r.arpa_usd) + "/mo"}</b><span class="subtle">${r.mix_sum == null ? "type the plan mix" : r.arpa_usd == null ? `plan mix adds up to ${r.mix_sum}%` : "from the PLANS list prices"}</span></div></section>
    <section class="card card-pad"><span class="eyebrow">Path to ${miUsd(g.arr_usd)} ARR</span><div class="table-wrap"><table class="f-table"><thead><tr><th>Plan</th><th class="num">Price / month</th><th class="num">Stores needed</th></tr></thead><tbody>
      ${g.per_plan.map((p) => `<tr><td>${esc(p.plan)}</td><td class="num">${p.from ? "from " : ""}${miUsd(p.usd_month)}</td><td class="num">${miInt(p.stores_needed)}</td></tr>`).join("")}
      <tr><td><b>Blended mix</b></td><td class="num">${r.arpa_usd == null ? "[ADD]" : miUsd(r.arpa_usd)}</td><td class="num"><b>${g.blended_stores_needed == null ? "[ADD]" : miInt(g.blended_stores_needed)}</b></td></tr></tbody></table></div>
      <p class="subtle s-small" style="margin:8px 0 0">List prices × 12 (draft pricing in Finance → Pricing). Yearly billing at 2 months free needs about 20% more stores.${g.pct_of_sam != null ? ` The blended path is ${g.pct_of_sam}% of SAM.` : ""}${g.pct_of_tam != null ? ` ${g.pct_of_tam}% of TAM.` : ""}</p></section></div></div>`;
}

/* ------------------------------------------------ Weekly brief */
function miBriefs() {
  const d = MI.briefs, ed = miEdit();
  const open = d.briefs.find((b) => b.id === MI.openBrief) || d.briefs.find((b) => b.status === "draft") || null;
  const head = `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><div><h3 style="margin:0">This week: ${esc(d.this_week.since)} to ${esc(d.this_week.until)}</h3><p class="subtle s-small" style="margin:4px 0 0">${d.this_week.items} item${d.this_week.items === 1 ? "" : "s"} recorded (signals, competitor changes, won and lost deals). The AI only summarizes these, cites each one and writes [ADD] where something is missing. A person approves.</p></div>
    ${ed ? `<div class="row gap-8"><select class="input input-sm" id="mib-lang" aria-label="Language"><option value="en">English</option><option value="ar">العربية</option></select><button class="btn btn-primary" data-miact="draft-brief" ${d.analyst_level ? "" : "disabled"}>Draft the brief</button></div>` : ""}</div></section>`;
  const list = d.briefs.length ? `<section class="card card-pad"><span class="eyebrow">Briefs</span><ul class="mi-list">${d.briefs.map((b) => `<li class="mi-item"><button class="mi-btnlink" data-miact="open-brief" data-id="${esc(b.id)}">Week of ${esc(b.week_start)} · ${b.lang === "ar" ? "العربية" : "English"}</button> ${miBadge(MI_BRIEF, b.status)} <span class="subtle s-small">${esc(fmtDate(b.created_at))}${b.approved_by ? " · approved by " + esc(b.approved_by) : ""}</span></li>`).join("")}</ul></section>` : "";
  return `<div class="stack" style="gap:16px">${head}${open ? miBriefPanel(open) : ""}${list}</div>`;
}
function miBriefPanel(b) {
  const ed = miEdit() && b.status === "draft";
  const cited = (b.sources || []).filter((i) => (b.cited || []).includes(i.ref));
  return `<section class="card card-pad" id="miBriefPanel"><div class="row between gap-8" style="flex-wrap:wrap"><h3 style="margin:0">Week of ${esc(b.week_start)} ${miBadge(MI_BRIEF, b.status)}</h3><span class="subtle s-small">${b.by_ai ? "Drafted by the AI Market analyst" : "Factual list from the data"} · ${b.items} item${b.items === 1 ? "" : "s"}</span></div>
    ${b.note ? `<p class="s-small" style="color:var(--warn)">${esc(b.note)}</p>` : ""}${b.issues?.length ? `<ul class="s-small mi-issues">${b.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${ed ? `<textarea class="input mi-brief-text" id="mib-text" rows="16" dir="auto" aria-label="Brief text">${esc(b.text)}</textarea>
      <div class="row gap-8" style="flex-wrap:wrap;margin-top:10px"><button class="btn" data-miact="save-brief" data-id="${esc(b.id)}">Save edits</button><button class="btn btn-primary" data-miact="approve-brief" data-id="${esc(b.id)}">Approve</button><button class="btn btn-ghost" data-miact="reject-brief" data-id="${esc(b.id)}">Reject</button></div>`
      : `<div class="doc mi-brief" dir="auto">${md(b.text)}</div>`}
    ${cited.length ? `<details style="margin-top:12px"><summary class="s-small">Cited items (${cited.length})</summary><ul class="s-small mi-diff">${cited.map((i) => `<li dir="auto"><b>[${esc(i.ref)}]</b> ${esc(i.title || i.deal || i.competitor || "")} ${esc(i.reason || "")} ${miLink(i.source_url, "source")}</li>`).join("")}</ul></details>` : ""}</section>`;
}

/* ------------------------------------------------ events */
async function miAct(a, id, btn) {
  if (a === "import") {
    const sources = [...document.querySelectorAll("[data-misrc]")].filter((x) => x.checked).map((x) => x.dataset.misrc);
    const r = await miPost("/signals/import", { sources });
    toast(`Imported ${r.imported} signal${r.imported === 1 ? "" : "s"}${r.denied.length ? ` · no access to ${r.denied.join(", ")}` : ""}`); return miShow();
  }
  if (a === "del-signal") { if (!confirm("Delete this signal?")) return; await api(`${miP()}/signals/${id}`, { method: "DELETE" }); return miShow(); }
  if (a === "open-comp") { MI.openComp = id; await miShow(); return $("#miCompPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (a === "close-comp") { MI.openComp = null; return miShow(); }
  if (a === "del-comp") { if (!confirm("Delete this competitor and its change log?")) return; await api(`${miP()}/competitors/${id}`, { method: "DELETE" }); MI.openComp = null; return miShow(); }
  if (a === "check") {
    btn.disabled = true; btn.textContent = "Checking…";
    try { const r = await miPost(`/competitors/${id}/check`); toast(r.baseline ? "Page saved: changes show from the next weekly check" : r.changed ? "The page changed: see the change log" : "No change on the page"); }
    catch (e) { toast(e.message, true); }
    return miShow();
  }
  if (a === "review") { await miPost(`/changes/${id}/review`); toast("Marked reviewed"); return miShow(); }
  if (a === "draft-brief") {
    btn.disabled = true; btn.textContent = "Drafting…";
    try { const b = await miPost("/briefs", { lang: $("#mib-lang").value }); MI.openBrief = b.id; toast("Draft ready: check it, edit and approve"); }
    finally { btn.disabled = false; }
    return miShow();
  }
  if (a === "open-brief") { MI.openBrief = id; return miShow(); }
  if (a === "save-brief") { await miPut(`/briefs/${id}`, { text: $("#mib-text").value }); toast("Saved"); return miShow(); }
  if (a === "approve-brief") { await miPut(`/briefs/${id}`, { text: $("#mib-text").value }); await miPost(`/briefs/${id}/approve`); toast("Brief approved and saved"); return miShow(); }
  if (a === "reject-brief") { const reason = prompt("Why is it rejected? (helps the AI Market analyst's record)") ?? null; if (reason === null) return; await miPost(`/briefs/${id}/reject`, { reason }); toast("Rejected"); return miShow(); }
}
document.addEventListener("click", async (e) => {
  if (S.route !== "intel") return;
  const t = e.target.closest("[data-mitab]");
  if (t) { MI.tab = t.dataset.mitab; return miShow(); }
  const tag = e.target.closest("[data-mitag]");
  if (tag) { MI.filter.tag = MI.filter.tag === tag.dataset.mitag ? "" : tag.dataset.mitag; return miShow(); }
  const b = e.target.closest("[data-miact]");
  if (b) { e.preventDefault(); try { await miAct(b.dataset.miact, b.dataset.id, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("change", async (e) => {
  if (S.route !== "intel") return;
  const f = e.target.closest("[data-mifilter]");
  if (f) { MI.filter[f.dataset.mifilter] = f.value; return miShow(); }
  const w = e.target.closest("[data-miwl]");
  if (w) { try { await api(`/api/workspaces/${S.ws.id}/deals/${w.dataset.miwl}`, { method: "PUT", body: JSON.stringify({ [w.dataset.field]: w.value }) }); toast("Saved to the Sales deal"); MI.wl = await api(`${miP()}/winloss`); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "intel") return;
  const id = e.target.id;
  if (!["miSigForm", "miCompAdd", "miCompForm", "miNoteForm", "miSizeForm"].includes(id)) return;
  e.preventDefault();
  const v = (s) => $(s)?.value ?? "";
  try {
    if (id === "miSigForm") {
      await miPost("/signals", { title: v("#mis-title"), type: v("#mis-type"), platform: v("#mis-platform"), impact: v("#mis-impact"), date: v("#mis-date"), source_url: v("#mis-url"), tags: v("#mis-tags"), module: v("#mis-module"), competitor_id: v("#mis-comp") || null, text: v("#mis-text") });
      toast("Signal added");
    }
    if (id === "miCompAdd") { const c = await miPost("/competitors", { name: v("#mic-new"), site: v("#mic-site") }); MI.openComp = c.id; toast("Competitor added"); }
    if (id === "miCompForm") {
      const tiers = {};
      document.querySelectorAll("[data-mitier]").forEach((x) => { (tiers[x.dataset.i] ||= {})[x.dataset.mitier] = x.value; });
      await miPut(`/competitors/${e.target.dataset.id}`, { name: v("#mic-name"), site: v("#mic-site2"), segment: v("#mic-segment"), last_checked: v("#mic-last"),
        platforms: [...document.querySelectorAll("[data-miplat]")].filter((x) => x.checked).map((x) => x.dataset.miplat), pricing: Object.values(tiers),
        pricing_source_url: v("#mic-psrc"), pricing_checked_on: v("#mic-pdate"), positioning: v("#mic-positioning"), strengths: v("#mic-strengths"), weaknesses: v("#mic-weaknesses"), notes: v("#mic-notes"),
        watch_url: v("#mic-watch"), watch_enabled: $("#mic-watchon").checked });
      toast("Saved · the change log has the edits");
    }
    if (id === "miNoteForm") { await miPost(`/competitors/${e.target.dataset.id}/changes`, { text: v("#mic-note"), url: v("#mic-noteurl") }); toast("Added to the change log"); }
    if (id === "miSizeForm") {
      const inputs = {};
      for (const f of MI.size.fields) inputs[f.id] = { value: v(`[data-mizv="${f.id}"]`), source: v(`[data-mizs="${f.id}"]`) };
      await miPut("/sizing", { inputs }); toast("Inputs saved");
    }
    await miShow();
  } catch (err) { toast(err.message, true); }
});

if (S.route === "intel" && S.ws) render();
