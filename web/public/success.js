/* Customer success: health bands and trend, churn alerts as owned tasks, expansion signals, renewals,
   onboarding progress, NPS / CSAT surveys and playbooks. Uses app.js globals (S, $, api, esc, toast, fmtDate,
   ROUTES, levelFor, go). Rules and snapshots run by themselves; people own alerts, talk to customers and
   approve every AI draft. Money (MRR, prices) only shows for roles that can see Billing. */

const SX = { meta: null, d: null, tab: "overview", alertStatus: "open", alertType: "", openId: null, surveyOpen: null };
const sxP = () => `/api/workspaces/${S.ws.id}/success`;
const sxEdit = () => levelFor("success") === "edit";
const sxMoney = () => !S.me || ["view", "edit"].includes(S.me.perms.billing);
const sxSar = (n) => (n == null ? "–" : "SAR " + Math.round(n).toLocaleString("en-US"));
const SX_TONE = { healthy: "good", watch: "warn", at_risk: "bad", open: "warn", snoozed: "", done: "good", not_started: "", in_talks: "accent", renewed: "good", lost: "bad", sent: "good", test: "", link: "accent", queued: "warn", skipped: "bad", failed: "bad", new: "" };
const sxBadge = (s, label) => `<span class="badge ${SX_TONE[s] || ""}">${esc(label || String(s).replace(/_/g, " "))}</span>`;
const sxType = (id) => (SX.meta?.alert_types.find((t) => t.id === id) || {}).name || id;
const sxUser = (id) => (SX.d?.users.find((u) => u.id === id) || {}).name || "";
const sxOwnerSel = (attr, cur) => `<select class="input input-sm" ${attr} aria-label="Owner" style="width:auto;max-width:180px" ${sxEdit() ? "" : "disabled"}><option value="">No owner</option>${(SX.d?.users || []).map((u) => `<option value="${esc(u.id)}" ${u.id === cur ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`;
const sxDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

// Small trend line (0–100 scale) with the 50 and 75 band lines.
function sxSpark(points, w = 96, h = 26) {
  if (!points || points.length < 2) return `<span class="subtle s-small">${points?.length === 1 ? points[0].score : "–"}</span>`;
  const X = (i) => 1 + (i * (w - 2)) / (points.length - 1), Y = (v) => h - 1 - ((h - 2) * v) / 100;
  const last = points.at(-1).score, tone = last >= 75 ? "var(--good)" : last >= 50 ? "var(--warn)" : "var(--bad)";
  return `<svg class="sx-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Health trend, now ${last}"><line x1="0" x2="${w}" y1="${Y(75)}" y2="${Y(75)}" stroke="var(--border)" stroke-dasharray="2 2"/><line x1="0" x2="${w}" y1="${Y(50)}" y2="${Y(50)}" stroke="var(--border)" stroke-dasharray="2 2"/>
    <polyline points="${points.map((p, i) => `${X(i).toFixed(1)},${Y(p.score).toFixed(1)}`).join(" ")}" fill="none" stroke="${tone}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${X(points.length - 1)}" cy="${Y(last)}" r="2" fill="${tone}"/></svg>`;
}

ROUTES.success = { title: "Customer success", crumb: "Customers", render: renderSuccess };

async function renderSuccess(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  if (!SX.meta) SX.meta = await api("/api/success/meta");
  SX.d = await api(sxP());
  if (S.route !== "success") return;
  const p = S.param || "";
  if (["overview", "alerts", "renewals", "onboarding", "surveys", "playbooks", "settings"].includes(p)) SX.tab = p;
  const tabs = [["overview", "Overview"], ["alerts", `Alerts${SX.d.alerts.open ? ` (${SX.d.alerts.open})` : ""}`], ["renewals", "Renewals"], ["onboarding", "Onboarding"], ["surveys", "NPS & CSAT"], ["playbooks", "Playbooks"], ["settings", "Settings"]];
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Customer success views">${tabs.map(([k, l]) => `<button role="tab" data-sxtab="${k}" aria-selected="${SX.tab === k}">${l}</button>`).join("")}</div>
    ${sxEdit() ? `<button class="btn" data-sx="run" title="Take today's health snapshots and check every alert rule now">Check now</button>` : ""}`;
  view.innerHTML = `<section class="s-kpis" id="sxKpis"></section><div id="sxBody" style="margin-top:20px"></div>`;
  sxRerender();
  if (p.startsWith("c-")) sxOpen(p.slice(2));
}
async function sxReload() { SX.d = await api(sxP()); sxRerender(); if (SX.openId) sxOpen(SX.openId); }

function sxRerender() {
  if (S.route !== "success" || !SX.d) return;
  const d = SX.d, b = d.bands, total = d.customers.length;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#sxKpis").innerHTML = [
    tile("Healthy", b.healthy, `of ${total} customer${total === 1 ? "" : "s"} · score 75+`, ""),
    tile("Watch", b.watch, "score 50–74", b.watch ? "warn" : ""),
    tile("At risk", b.at_risk, sxMoney() ? `${sxSar(d.at_risk_mrr_sar)} MRR at risk` : "score under 50", b.at_risk ? "bad" : ""),
    tile("Renewals", `${d.renewals.d30} · ${d.renewals.d60} · ${d.renewals.d90}`, "in 30 · 60 · 90 days (yearly + trials)"),
    tile("NPS", d.nps.nps == null ? "–" : (d.nps.nps > 0 ? "+" : "") + d.nps.nps, d.nps.n ? `${d.nps.n} answers · ${d.nps.detractors} detractor${d.nps.detractors === 1 ? "" : "s"}` : "no answers yet", d.nps.nps != null && d.nps.nps < 0 ? "warn" : ""),
    tile("Open alerts", d.alerts.open, `${d.alerts.snoozed} snoozed`, d.alerts.open ? "warn" : ""),
  ].join("");
  if (d.settings.mode !== "live" && !$("#sxMode")) $("#sxKpis").insertAdjacentHTML("afterend", `<div class="notice" id="sxMode" style="margin-top:12px">Test mode: surveys and emails are logged, not sent. Switch to Live in Settings once the Store CRM's email or WhatsApp is connected. Sample stores are never sent for real.</div>`);
  if (d.settings.mode === "live") $("#sxMode")?.remove();
  ({ overview: sxOverview, alerts: sxAlerts, renewals: sxRenewals, onboarding: sxOnboarding, surveys: sxSurveys, playbooks: sxPlaybooks, settings: sxSettings })[SX.tab]();
}

/* ------------------------------------------------ Overview */
function sxOverview() {
  const d = SX.d, money = sxMoney();
  if (!d.customers.length) {
    $("#sxBody").innerHTML = `<div class="card empty"><h2>No customers yet</h2><p>Customer success follows the stores in Billing & customers: paying and trialling stores. Add customers there (from a paying deal or a CRM store), or load the sample data from the Home page to explore.</p><a class="btn btn-primary" href="#/${S.ws.id}/billing">Open Billing & customers</a></div>`;
    return;
  }
  const rows = [...d.customers].sort((a, b) => a.health.score - b.health.score);
  $("#sxBody").innerHTML = `<div class="cc">
    <section class="card card-pad cc-span-8 sx-span">
      <div class="row between"><span class="eyebrow">Average health, last 30 days</span><span class="subtle s-small">${d.trend.length} day${d.trend.length === 1 ? "" : "s"} of snapshots</span></div>
      <svg id="sxChart" viewBox="0 0 900 220" role="img" aria-label="Average customer health by day" style="width:100%;height:auto;display:block;margin-top:8px"></svg>
      <p class="subtle s-small">One snapshot per customer per day (score and its five parts), taken by the daily check. Bands: 75+ healthy, 50–74 watch, under 50 at risk.</p>
    </section>
    <section class="card card-pad cc-span-4 sx-span stack">
      <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${d.needs.length ? "warn" : "good"}">${d.needs.length || "All clear"}</span></div>
      ${d.needs.length ? `<ul class="cc-list">${d.needs.map((n) => `<li class="clickable" data-sxtab="${esc(n.param || "alerts")}"><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small" dir="auto">${esc(n.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Nothing needs you in Customer success right now.</p>`}
      <div style="border-top:1px solid var(--border);padding-top:12px" class="stack"><span class="eyebrow">Expansion candidates</span>
        ${d.expansion.length ? `<ul class="cc-list">${d.expansion.map((x) => `<li class="clickable" data-sxopen="${esc(x.customer_id)}"><span class="s-small grow" dir="auto"><b>${esc(x.store_name)}</b> · ${esc(x.plan)}${x.suggested?.plan ? ` → ${esc(x.suggested.plan)}` : ""}${money && x.suggested?.diff_usd != null ? ` <span class="subtle">(+$${x.suggested.diff_usd.toLocaleString("en-US")}${x.suggested.from ? "+" : ""}/mo)</span>` : ""}<div class="subtle">${x.signals.map((s) => esc(s.name)).join(" · ")}</div></span></li>`).join("")}</ul>` : `<p class="muted s-small">No upgrade signals yet (renders at ${d.settings.render_pct}% of the limit, catalog over the plan band, overage two months running).</p>`}</div>
    </section>
    <section class="card cc-span-12 sx-span"><div class="table-wrap"><table class="f-table sx-table"><thead><tr><th>Store</th><th>Plan</th><th>Health</th><th>Trend</th><th class="num">Alerts</th><th>Last answer</th>${money ? `<th class="num">MRR</th>` : ""}<th>Owner</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="clickable" data-sxopen="${esc(c.id)}" tabindex="0"><td><b dir="auto">${esc(c.store_name)}</b>${c.sample ? ' <span class="badge">sample</span>' : ""}<div class="subtle s-small">${esc(c.status.replace(/_/g, " "))}${c.cancel_at_period_end ? " · cancels at period end" : ""}</div></td>
        <td>${esc(c.plan)}<div class="subtle s-small">${esc(c.cycle)}</div></td><td>${sxBadge(c.health.label, `${c.health.score} · ${c.health.label.replace("_", " ")}`)}</td><td>${sxSpark(c.trend)}</td>
        <td class="num">${c.open_alerts ? `<span class="badge warn">${c.open_alerts}</span>` : "–"}</td>
        <td class="s-small">${c.last_response ? `${c.last_response.kind.toUpperCase()} <b>${c.last_response.score}</b>` : "–"}</td>${money ? `<td class="num">${sxSar(c.mrr_sar)}</td>` : ""}
        <td class="s-small">${esc(sxUser(c.owner_id) || "–")}</td></tr>`).join("")}
    </tbody></table></div></section></div>`;
  sxChart(d.trend);
}
function sxChart(trend) {
  const W = 900, H = 220, L = 36, R = 12, T = 10, B = 26, el = $("#sxChart");
  if (!el) return;
  if (!trend.length) { el.innerHTML = `<text class="s-svg-text" x="${W / 2}" y="${H / 2}" text-anchor="middle">The first snapshot is taken by the daily check (or press Check now)</text>`; return; }
  const X = (i) => L + (trend.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (trend.length - 1)), Y = (v) => T + (H - T - B) * (1 - v / 100);
  let svg = `<rect x="${L}" y="${Y(100)}" width="${W - L - R}" height="${Y(75) - Y(100)}" fill="var(--good)" opacity=".07"/><rect x="${L}" y="${Y(50)}" width="${W - L - R}" height="${Y(0) - Y(50)}" fill="var(--bad)" opacity=".06"/>`;
  for (const v of [0, 25, 50, 75, 100]) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"/><text class="s-svg-mono" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  svg += `<polyline points="${trend.map((p, i) => `${X(i)},${Y(p.avg)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
  trend.forEach((p, i) => { svg += `<circle cx="${X(i)}" cy="${Y(p.avg)}" r="3" fill="var(--accent)"><title>${p.date}: average ${p.avg} over ${p.n} customer${p.n === 1 ? "" : "s"}</title></circle>`; });
  const every = Math.max(1, Math.ceil(trend.length / 8));
  trend.forEach((p, i) => { if (i % every === 0 || i === trend.length - 1) svg += `<text class="s-svg-text" x="${X(i)}" y="${H - 8}" text-anchor="${i === trend.length - 1 && trend.length > 1 ? "end" : i === 0 && trend.length > 1 ? "start" : "middle"}">${p.date.slice(5)}</text>`; });
  el.innerHTML = svg;
}

/* ------------------------------------------------ Alerts */
async function sxAlerts() {
  $("#sxBody").innerHTML = `<p class="muted">Loading…</p>`;
  const q = new URLSearchParams(); if (SX.alertStatus) q.set("status", SX.alertStatus); if (SX.alertType) q.set("type", SX.alertType);
  const list = await api(`${sxP()}/alerts?${q}`);
  if (S.route !== "success" || SX.tab !== "alerts") return;
  const ed = sxEdit();
  $("#sxBody").innerHTML = `<div class="row gap-8" style="flex-wrap:wrap;margin-bottom:12px;justify-content:space-between">
      <div class="s-tabs" role="tablist" aria-label="Alert status">${[["open", "Open"], ["snoozed", "Snoozed"], ["done", "Done"], ["", "All"]].map(([k, l]) => `<button role="tab" data-sxast="${k}" aria-selected="${SX.alertStatus === k}">${l}</button>`).join("")}</div>
      <select class="input input-sm" id="sxAType" aria-label="Alert type" style="width:auto"><option value="">All alert types</option>${SX.meta.alert_types.map((t) => `<option value="${t.id}" ${SX.alertType === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
    ${list.length ? `<div class="sx-alerts">${list.map((a) => sxAlertCard(a, ed)).join("")}</div>` : `<div class="card empty"><h2>No ${SX.alertStatus || ""} alerts</h2><p>Alerts come from fixed rules, each with its reason: health down ${SX.d.settings.health_drop_points}+ points in ${SX.d.settings.health_drop_days} days, renders down ${SX.d.settings.usage_drop_pct}%+, past due, no activity for ${SX.d.settings.inactive_days} days, more than ${SX.d.settings.open_tickets_max} open tickets or an unhappy one, cancel scheduled, and detractor survey answers.</p></div>`}`;
}
function sxAlertCard(a, ed) {
  const done = a.steps.filter((s) => s.done).length;
  return `<section class="card card-pad stack sx-alert ${a.status}" data-sxalert="${esc(a.id)}">
    <div class="row between gap-8" style="flex-wrap:wrap"><div style="min-width:0"><span class="eyebrow">${esc(sxType(a.type))} · since ${esc(a.first_seen || a.created_at.slice(0, 10))}</span>
      <h3 class="sx-store"><a href="#" data-sxopen="${esc(a.customer_id)}" dir="auto">${esc(a.store_name)}</a>${a.sample ? ' <span class="badge">sample</span>' : ""}</h3></div>
      <div class="row gap-8">${sxBadge(a.status, a.status === "snoozed" ? `snoozed to ${a.snooze_until}` : a.status === "done" ? `done · ${(SX.meta.outcomes.find((o) => o.id === a.outcome) || {}).name || ""}` : "open")}${sxOwnerSel(`data-sxaowner="${esc(a.id)}"`, a.owner_id)}</div></div>
    <p class="s-small sx-reason" dir="auto">${esc(a.reason)}</p>
    ${a.outcome_note ? `<p class="s-small subtle" dir="auto">Outcome: ${esc(a.outcome_note)}</p>` : ""}
    ${a.save_plan ? `<details class="s-small"><summary>Save plan (approved)</summary><div class="md sx-md" dir="auto">${md(a.save_plan)}</div></details>` : ""}
    <details class="s-small" ${a.status === "open" ? "open" : ""}><summary>Playbook · ${done}/${a.steps.length} done</summary>
      <ul class="sx-steps">${a.steps.map((s, i) => `<li><label class="row gap-8"><input type="checkbox" data-sxstep="${esc(a.id)}:${i}" ${s.done ? "checked" : ""} ${ed ? "" : "disabled"}> <span dir="auto">${esc(s.text)}</span></label></li>`).join("")}</ul></details>
    ${ed ? `<div class="row gap-8" style="flex-wrap:wrap">${a.status !== "done" ? `<button class="btn btn-sm btn-primary" data-sx="alert-done" data-id="${esc(a.id)}">Done…</button><button class="btn btn-sm" data-sx="alert-snooze" data-id="${esc(a.id)}">Snooze…</button>` : `<button class="btn btn-sm" data-sx="alert-open" data-id="${esc(a.id)}">Reopen</button>`}
      ${a.status === "snoozed" ? `<button class="btn btn-sm btn-ghost" data-sx="alert-open" data-id="${esc(a.id)}">Unsnooze</button>` : ""}
      <button class="btn btn-sm btn-ghost" data-sx="ai-save-plan" data-id="${esc(a.customer_id)}" data-alert="${esc(a.id)}" title="AI Retention watcher: why at risk and a save plan (you approve)">AI: save plan</button>
      <button class="btn btn-sm btn-ghost" data-sx="alert-note" data-id="${esc(a.id)}">Add note</button></div>` : ""}
    ${a.history?.length > 1 ? `<details class="s-small subtle"><summary>History</summary><ul class="s-timeline">${a.history.slice().reverse().map((h) => `<li><span class="grow" dir="auto">${esc(h.text)} <span class="subtle">· ${esc(h.by)}</span></span><span class="num">${fmtDate(h.at)}</span></li>`).join("")}</ul></details>` : ""}
  </section>`;
}

/* ------------------------------------------------ Renewals */
async function sxRenewals() {
  $("#sxBody").innerHTML = `<p class="muted">Loading…</p>`;
  const list = await api(`${sxP()}/renewals?days=90`);
  if (S.route !== "success" || SX.tab !== "renewals") return;
  const ed = sxEdit(), money = sxMoney();
  $("#sxBody").innerHTML = `<p class="muted s-small" style="max-width:75ch;margin:0 0 14px">Yearly plans renew at the end of their period; trials end on their trial date. Monthly plans renew every month and show in Alerts instead. Past dates stay here for 30 days: a store still paying shows as renewed, a cancelled one as lost, unless you set the status.</p>
    ${list.length ? `<section class="card"><div class="table-wrap"><table class="f-table sx-table"><thead><tr><th>Date</th><th>Store</th><th>Plan</th>${money ? `<th class="num">MRR</th>` : ""}<th>Health</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr data-sxren="${esc(r.customer_id)}" data-date="${esc(r.date)}"><td class="num">${esc(r.date)}<div class="subtle s-small">${r.days >= 0 ? `in ${r.days} day${r.days === 1 ? "" : "s"}` : `${-r.days} days ago`}</div></td>
        <td class="sx-name"><a href="#" data-sxopen="${esc(r.customer_id)}" dir="auto">${esc(r.store_name)}</a>${r.sample ? ' <span class="badge">sample</span>' : ""}<div class="subtle s-small">${r.kind === "trial" ? "trial ends" : "yearly renewal"}</div></td>
        <td>${esc(r.plan)}</td>${money ? `<td class="num">${sxSar(r.mrr_sar)}</td>` : ""}<td>${sxBadge(r.health.label, String(r.health.score))}</td>
        <td>${sxOwnerSel(`data-sxrowner="${esc(r.customer_id)}"`, r.owner_id)}</td>
        <td><select class="input input-sm" data-sxrstatus="${esc(r.customer_id)}" aria-label="Renewal status" style="width:auto" ${ed ? "" : "disabled"}>${SX.meta.renewal_status.map((s) => `<option value="${s.id}" ${r.status === s.id ? "selected" : ""}>${esc(s.name)}${r.auto && r.status === s.id ? " (auto)" : ""}</option>`).join("")}</select>
          ${r.status === "lost" || r.lost_reason ? `<input class="input input-sm" data-sxrlost="${esc(r.customer_id)}" placeholder="Why lost" value="${esc(r.lost_reason)}" dir="auto" style="margin-top:4px" aria-label="Why lost" ${ed ? "" : "disabled"}>` : ""}</td>
        <td class="bl-acts">${ed ? `<button class="btn btn-sm" data-sx="ren-save" data-id="${esc(r.customer_id)}">Save</button><button class="btn btn-sm btn-ghost" data-sx="ai-renewal" data-id="${esc(r.customer_id)}" title="AI Expansion & renewal writer: a renewal email (you edit and send)">AI: email</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>No renewals in the next 90 days</h2><p>Yearly customers and trials show here as their dates come close.</p></div>`}`;
}

/* ------------------------------------------------ Onboarding */
async function sxOnboarding() {
  $("#sxBody").innerHTML = `<p class="muted">Loading…</p>`;
  const list = await api(`${sxP()}/onboarding`);
  if (S.route !== "success" || SX.tab !== "onboarding") return;
  $("#sxBody").innerHTML = `<p class="muted s-small" style="max-width:75ch;margin:0 0 14px">From each store's onboarding checklist in the Store CRM. A step is stuck when nothing was ticked for ${SX.d.settings.stuck_days} days. Tick steps on the store in the CRM.</p>
    ${list.length ? `<section class="card"><div class="table-wrap"><table class="f-table sx-table"><thead><tr><th>Store</th><th>Progress</th><th class="num">Days since start</th><th>Last progress</th><th>Stuck on</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td><a href="#" data-sxopen="${esc(r.customer_id)}" dir="auto">${esc(r.store_name)}</a>${r.stage ? `<div class="subtle s-small">CRM: ${esc(r.stage)}</div>` : ""}</td>
        <td style="min-width:150px">${r.linked ? `<div class="row gap-8"><span class="meter grow"><span style="width:${r.pct}%"></span></span><span class="num s-small">${r.done}/${r.total}</span></div>` : `<span class="subtle s-small">Not linked to a CRM store</span>`}</td>
        <td class="num">${r.days}</td><td class="num s-small">${r.linked ? `${esc(r.last_progress)}<div class="subtle">${r.quiet_days} days ago</div>` : "–"}</td>
        <td class="s-small">${r.complete ? sxBadge("done", "complete") : r.stuck?.length ? `<span class="badge bad">stuck</span> <span dir="auto">${esc(r.stuck.join(", "))}</span>` : r.linked ? "–" : `<a href="#/${S.ws.id}/billing">Link in Billing</a>`}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>No customers to onboard</h2><p>Customers from Billing show here with their CRM checklist.</p></div>`}`;
}

/* ------------------------------------------------ Surveys */
async function sxSurveys() {
  $("#sxBody").innerHTML = `<p class="muted">Loading…</p>`;
  const list = await api(`${sxP()}/surveys`);
  if (S.route !== "success" || SX.tab !== "surveys") return;
  const ed = sxEdit();
  $("#sxBody").innerHTML = `${ed ? `<form class="card card-pad stack" id="sxNewSurvey" style="margin-bottom:16px"><h2>New survey</h2>
      <div class="s-form"><div class="field"><label for="sxs-name">Name</label><input class="input" id="sxs-name" placeholder="NPS ${esc(sxDay().slice(0, 7))}" dir="auto"></div>
        <div class="field"><label for="sxs-kind">Type</label><select class="input" id="sxs-kind">${SX.meta.survey_kinds.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="sxs-channel">Send by</label><select class="input" id="sxs-channel"><option value="email">Email (Store CRM sender)</option><option value="whatsapp">WhatsApp (opted-in, approved template)</option><option value="link">Link only (you share it)</option></select></div></div>
      <p class="subtle s-small">Each customer gets their own link (one answer per link). The question is in Saudi Arabic and English and can be edited after creating. Sends follow every outreach rule: opt-outs, WhatsApp opt-in, 09:00–21:00 Riyadh and not Friday, sample stores never sent. A detractor answer (NPS 0–6, CSAT 1–2) opens an alert.</p>
      <div><button class="btn btn-primary" type="submit">Create survey</button></div></form>` : ""}
    ${list.length ? list.map((sv) => `<section class="card card-pad stack" style="margin-bottom:12px"><div class="row between gap-8" style="flex-wrap:wrap"><div><h3 dir="auto">${esc(sv.name)}${sv.sample ? ' <span class="badge">sample</span>' : ""}</h3><span class="subtle s-small">${esc(sv.kind.toUpperCase())} · ${esc(sv.channel)} · ${sv.status === "draft" ? "draft" : `sent ${esc(String(sv.sent_at).slice(0, 10))}`} · ${sv.answered}/${sv.recipients} answered</span></div>
        <div class="row gap-8">${sv.kind === "nps" ? `<b class="num">${sv.score.nps == null ? "–" : (sv.score.nps > 0 ? "+" : "") + sv.score.nps}</b><span class="subtle s-small">NPS</span>` : `<b class="num">${sv.score.avg ?? "–"}</b><span class="subtle s-small">avg CSAT</span>`}</div></div>
      <p class="s-small" dir="rtl" lang="ar">${esc(sv.question_ar)}</p><p class="s-small subtle" dir="auto">${esc(sv.question_en)}</p>
      ${Object.keys(sv.by_status).length ? `<div class="row gap-8" style="flex-wrap:wrap">${Object.entries(sv.by_status).map(([k, v]) => sxBadge(k, `${v} ${k}`)).join("")}</div>` : ""}
      <div class="row gap-8" style="flex-wrap:wrap">${ed ? `<button class="btn btn-sm btn-primary" data-sx="survey-send" data-id="${esc(sv.id)}">${sv.status === "draft" ? "Send to all customers" : "Send to new customers / retry"}</button>` : ""}<button class="btn btn-sm" data-sx="survey-view" data-id="${esc(sv.id)}">${SX.surveyOpen === sv.id ? "Hide answers" : "Answers & links"}</button>${ed && sv.status === "draft" ? `<button class="btn btn-sm btn-ghost btn-danger" data-sx="survey-del" data-id="${esc(sv.id)}">Delete</button>` : ""}</div>
      <div id="sxSv-${esc(sv.id)}"></div></section>`).join("") : `<div class="card empty"><h2>No surveys yet</h2><p>Ask every customer one question each quarter. Scores show per customer and overall; unhappy answers become alerts with an owner.</p></div>`}`;
  if (SX.surveyOpen) sxSurveyAnswers(SX.surveyOpen);
}
async function sxSurveyAnswers(id) {
  const el = $(`#sxSv-${CSS.escape(id)}`); if (!el) return;
  const sv = await api(`${sxP()}/surveys/${id}`);
  el.innerHTML = sv.responses.length ? `<div class="table-wrap"><table class="f-table"><thead><tr><th>Store</th><th>Sent</th><th class="num">Score</th><th>Comment</th><th>Link</th></tr></thead><tbody>
    ${sv.responses.map((r) => `<tr><td dir="auto">${esc(r.store_name)}</td><td>${sxBadge(r.send_status)}${r.send_note ? `<div class="subtle s-small">${esc(r.send_note)}</div>` : ""}</td><td class="num">${r.answered_at ? `<b>${r.score}</b>` : "–"}</td><td class="s-small" dir="auto">${esc(r.comment || "")}</td>
      <td><button class="btn btn-sm btn-ghost" data-sx="copy-link" data-link="${esc(r.link)}">Copy link</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small">Not sent yet: press Send to create one link per customer.</p>`;
}

/* ------------------------------------------------ Playbooks and settings */
function sxPlaybooks() {
  const ed = sxEdit(), pb = SX.d.playbooks;
  $("#sxBody").innerHTML = `<p class="muted s-small" style="max-width:75ch;margin:0 0 14px">Each new alert copies its playbook as a checklist for the owner. One step per line. Changing a playbook affects new alerts only.</p>
    <div class="sx-pbs">${SX.meta.alert_types.map((t) => `<section class="card card-pad stack"><div><h3>${esc(t.name)}</h3><span class="subtle s-small">${esc(t.hint)}</span></div>
      <textarea class="input" rows="5" data-sxpb="${t.id}" dir="auto" aria-label="${esc(t.name)} playbook" ${ed ? "" : "disabled"}>${esc((pb[t.id] || []).join("\n"))}</textarea>
      ${ed ? `<div class="row gap-8"><button class="btn btn-sm" data-sx="pb-save" data-id="${t.id}">Save</button><button class="btn btn-sm btn-ghost" data-sx="pb-reset" data-id="${t.id}">Reset to default</button></div>` : ""}</section>`).join("")}</div>`;
}
function sxSettings() {
  const s = SX.d.settings, ed = sxEdit(), dis = ed ? "" : "disabled";
  const num = (k, l, hint) => `<div class="field"><label for="sxt-${k}">${l}</label><input class="input" id="sxt-${k}" type="number" value="${esc(s[k])}" ${dis}><span class="hint">${hint}</span></div>`;
  $("#sxBody").innerHTML = `<form class="stack-lg" id="sxSet">
    <section class="card card-pad stack"><h2>Churn alert rules</h2><div class="s-form">
      ${num("health_drop_points", "Health drop (points)", "Alert when the score falls this much…")}${num("health_drop_days", "…within (days)", "Compared with the best snapshot in this window")}
      ${num("usage_drop_pct", "Usage drop (%)", "Last full month vs the month before")}${num("inactive_days", "No activity (days)", "Usage, payment, ticket or reply")}
      ${num("open_tickets_max", "Open tickets more than", "Unhappy tickets alert on their own")}${num("reopen_days", "Quiet after done (days)", "A closed alert of the same kind waits this long")}</div></section>
    <section class="card card-pad stack"><h2>Expansion and onboarding</h2><div class="s-form">
      ${num("render_pct", "Render usage signal (%)", "Of the plan's render limit (Finance → Pricing)")}${num("stuck_days", "Onboarding stuck after (days)", "No step ticked in the CRM")}</div></section>
    <section class="card card-pad stack"><h2>Sending</h2><div class="s-form">
      <div class="field"><label for="sxt-mode">Mode</label><select class="input" id="sxt-mode" ${dis}><option value="test" ${s.mode === "test" ? "selected" : ""}>Test: log only</option><option value="live" ${s.mode === "live" ? "selected" : ""}>Live: send through the Store CRM</option></select><span class="hint">The Store CRM's own Test mode also applies</span></div>
      <div class="field"><label for="sxt-wa">WhatsApp survey template</label><input class="input" id="sxt-wa" value="${esc(s.wa_template)}" placeholder="nps_survey_ar" ${dis}><span class="hint">Approved in WhatsApp Manager; body parameters: owner name, survey link</span></div></div></section>
    <p class="subtle s-small">Every rule and threshold: docs/customer-success.md.</p>
    ${ed ? `<div><button class="btn btn-primary" type="submit">Save settings</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ customer drawer */
function sxDrawerEl() {
  let el = $("#sxDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="sxScrim" hidden></div><aside class="s-drawer bl-drawer" id="sxDrawer" hidden aria-label="Customer success"></aside>`); el = $("#sxDrawer"); }
  return el;
}
function sxClose() { const d = $("#sxDrawer"); if (d) { d.hidden = true; $("#sxScrim").hidden = true; } SX.openId = null; }
async function sxOpen(id) {
  let c;
  try { c = await api(`${sxP()}/customers/${encodeURIComponent(id)}`); } catch (e) { return toast(e.message, true); }
  if (S.route !== "success") return;
  SX.openId = id;
  const ed = sxEdit(), money = sxMoney(), el = sxDrawerEl(), h = c.health, o = c.onboarding, exp = c.expansion;
  const open = c.alerts.filter((a) => a.status !== "done");
  el.innerHTML = `<div class="row gap-12"><div style="flex:1;min-width:0"><h2 dir="auto">${esc(c.store_name)}</h2><span class="subtle">${esc(c.plan)} · ${esc(c.cycle)} · ${esc(c.status.replace(/_/g, " "))} · since ${esc(c.start_date)}</span></div><button class="btn btn-sm" data-sx="close">Close</button></div>
  <div class="s-facts">
    <div class="card s-fact"><span class="eyebrow">Health</span><b>${sxBadge(h.label, `${h.score} · ${h.label.replace("_", " ")}`)}</b>${sxSpark(c.trend, 140, 30)}</div>
    <div class="card s-fact"><span class="eyebrow">Last answer</span><b class="num">${c.last_response ? `${c.last_response.kind.toUpperCase()} ${c.last_response.score}` : "–"}</b><span class="subtle s-small" dir="auto">${c.last_response?.comment ? esc(c.last_response.comment.slice(0, 80)) : c.last_response ? esc(c.last_response.at.slice(0, 10)) : "no survey answer yet"}</span></div>
    <div class="card s-fact"><span class="eyebrow">${money ? "MRR" : "Renewal"}</span><b class="num">${money ? sxSar(c.mrr_sar) : c.renewal ? esc(c.renewal.date) : "–"}</b><span class="subtle s-small">${c.renewal ? `${c.renewal.kind === "trial" ? "trial ends" : "renews"} ${esc(c.renewal.date)} · ${esc(c.renewal.status.replace(/_/g, " "))}` : "monthly: no renewal date"}</span></div>
  </div>
  <div class="card card-pad stack"><div class="row between gap-8" style="flex-wrap:wrap"><h3>Owner</h3>${sxOwnerSel(`data-sxcowner="${esc(c.id)}"`, c.owner_id)}</div><p class="subtle s-small">New alerts go to the customer's owner. Last activity: ${esc(c.last_activity || "none recorded")}.</p></div>
  <div class="card card-pad stack"><h3>Health factors</h3><ul class="bl-factors">${h.factors.map((f) => `<li><span class="s-small"><b>${esc(f.name)}</b> · ${esc(f.id === "payment" && !money ? "Hidden (needs Billing access)" : f.why)}</span><span class="num s-small">${f.points}/${f.max}</span><span class="meter"><span style="width:${Math.round((f.points / f.max) * 100)}%"></span></span></li>`).join("")}</ul></div>
  <div class="card card-pad stack"><div class="row between"><h3>Alerts</h3><span class="badge ${open.length ? "warn" : "good"}">${open.length ? `${open.length} open` : "none open"}</span></div>
    ${c.alerts.length ? `<ul class="s-timeline">${c.alerts.slice(0, 12).map((a) => `<li><span class="s-small grow" dir="auto"><b>${esc(sxType(a.type))}</b> · ${esc(a.reason)}</span>${sxBadge(a.status)}</li>`).join("")}</ul>` : `<p class="muted s-small">No alerts for this customer.</p>`}
    ${ed ? `<div class="row gap-8"><button class="btn btn-sm" data-sx="ai-save-plan" data-id="${esc(c.id)}" data-alert="${esc(open[0]?.id || "")}">AI: why at risk + save plan</button>${open.length ? `<button class="btn btn-sm btn-ghost" data-sxtab="alerts">Open in Alerts</button>` : ""}</div>` : ""}</div>
  <div class="card card-pad stack"><h3>Expansion</h3>${exp ? `<ul class="s-timeline">${exp.signals.map((s) => `<li><span class="s-small grow"><b>${esc(s.name)}</b> · ${esc(s.reason)}</span></li>`).join("")}</ul>
      <p class="s-small">${exp.suggested?.plan ? `Suggested plan: <b>${esc(exp.suggested.plan)}</b>${money && exp.suggested.diff_usd != null ? ` · +$${exp.suggested.diff_usd.toLocaleString("en-US")}${exp.suggested.from ? "+" : ""}/month (SAR ${exp.suggested.diff_sar.toLocaleString("en-US")}) at list price, before VAT` : ""}` : esc(exp.suggested?.note || "")}</p>
      ${ed ? `<div><button class="btn btn-sm" data-sx="ai-expansion" data-id="${esc(c.id)}">AI: upgrade email</button></div>` : ""}` : `<p class="muted s-small">No upgrade signal: renders under ${SX.d.settings.render_pct}% of the limit, catalog inside the plan band, no overage two months running.</p>`}</div>
  <div class="card card-pad stack"><h3>Onboarding</h3>${o.linked ? `<div class="row gap-8"><span class="meter grow"><span style="width:${o.pct}%"></span></span><span class="num s-small">${o.done}/${o.total}</span></div>
      <ul class="bl-onb">${o.steps.map((s) => `<li class="${s.done ? "on" : ""}"><span aria-hidden="true">${s.done ? "✓" : "○"}</span> ${esc(s.name)}${s.at ? ` <span class="subtle">${esc(s.at)}</span>` : ""}</li>`).join("")}</ul>${o.stuck.length ? `<p class="s-small"><span class="badge bad">stuck</span> ${o.quiet_days} days without progress on <span dir="auto">${esc(o.stuck.join(", "))}</span></p>` : ""}`
      : `<p class="muted s-small">Not linked to a Store CRM store, so the checklist isn't available. Link it in Billing (CRM store) or use the same domain.</p>`}</div>
  ${c.drafts.length ? `<div class="card card-pad stack"><h3>AI drafts</h3>${c.drafts.map((d) => sxDraftCard(d, ed)).join("")}</div>` : ""}
  ${c.responses.length ? `<div class="card card-pad stack"><h3>Survey answers</h3><ul class="s-timeline">${c.responses.map((r) => `<li><span class="s-small grow" dir="auto"><b>${esc(r.kind.toUpperCase())} ${r.score}</b>${r.comment ? ` · ${esc(r.comment)}` : ""}</span><span class="subtle s-small num">${esc(r.answered_at.slice(0, 10))}</span></li>`).join("")}</ul></div>` : ""}
  <div class="row gap-8"><a class="btn btn-sm btn-ghost" href="#/${S.ws.id}/billing">Billing & customers</a>${ed && c.renewal ? `<button class="btn btn-sm btn-ghost" data-sx="ai-renewal" data-id="${esc(c.id)}">AI: renewal email</button>` : ""}</div>`;
  el.hidden = false; $("#sxScrim").hidden = false;
}
function sxDraftCard(d, ed) {
  const email = d.kind !== "save-plan", live = d.status === "draft" && ed;
  return `<section class="card card-pad stack bl-draft" style="border-color:${d.status === "draft" ? "var(--warn)" : "var(--border)"}"><div class="row between"><span class="eyebrow">${d.kind === "save-plan" ? "Retention watcher · save plan" : `Expansion & renewal writer · ${esc(d.kind)} email`}</span>${sxBadge(d.status === "draft" ? "open" : d.status === "approved" ? "done" : "lost", d.status === "draft" ? "needs approval" : d.status)}</div>
    ${email ? `<input class="input" data-sxdsubj="${esc(d.id)}" value="${esc(d.subject)}" dir="auto" aria-label="Subject" ${live ? "" : "disabled"}>` : ""}
    ${live ? `<textarea class="input" data-sxdtext="${esc(d.id)}" rows="10" dir="auto" aria-label="Draft text">${esc(d.text)}</textarea>` : `<div class="md sx-md s-small" dir="auto">${md(d.text)}</div>`}
    ${live ? `<div class="row gap-8" style="flex-wrap:wrap">${email ? `<button class="btn btn-primary btn-sm" data-sx="draft-send" data-id="${esc(d.id)}">Approve and send</button><button class="btn btn-sm" data-sx="draft-approve" data-id="${esc(d.id)}">Approve (I'll send it)</button>` : `<button class="btn btn-primary btn-sm" data-sx="draft-approve" data-id="${esc(d.id)}">Keep this plan</button>`}<button class="btn btn-sm btn-ghost" data-sx="draft-reject" data-id="${esc(d.id)}">Reject</button></div>
      <p class="subtle s-small">Check every [ADD] before sending: the AI never fills in numbers, results or quotes.</p>` : d.sent_status ? `<p class="subtle s-small">Sent: ${esc(d.sent_status)}${d.sent_note ? ` · ${esc(d.sent_note)}` : ""}</p>` : ""}</section>`;
}

// Billing's customer drawer shows a small Success section (trend, open alerts, last answer) when the role can see it.
async function sxBillingHook(customerId) {
  const el = $("#blSucc");
  if (!el || levelFor("success") === "none") return;
  let c;
  try { c = await api(`/api/workspaces/${S.ws.id}/success/customers/${encodeURIComponent(customerId)}`); } catch { return; }
  if (!$("#blSucc")) return;
  const open = c.alerts.filter((a) => a.status !== "done");
  el.innerHTML = `<div class="card card-pad stack"><div class="row between gap-8"><h3>Customer success</h3><a class="s-small" href="#/${S.ws.id}/success/c-${encodeURIComponent(c.id)}">Open in Customer success</a></div>
    <div class="row gap-12" style="flex-wrap:wrap;align-items:center">${sxSpark(c.trend, 140, 30)}<span class="s-small">${open.length ? `<span class="badge warn">${open.length} open alert${open.length === 1 ? "" : "s"}</span>` : `<span class="badge good">no open alerts</span>`}</span>
      <span class="s-small">${c.last_response ? `Last ${esc(c.last_response.kind.toUpperCase())}: <b>${c.last_response.score}</b>` : "No survey answer yet"}</span></div>
    ${open.length ? `<ul class="s-timeline">${open.slice(0, 3).map((a) => `<li><span class="s-small grow" dir="auto"><b>${esc(sxType(a.type))}</b> · ${esc(a.reason)}</span></li>`).join("")}</ul>` : ""}</div>`;
}

/* ------------------------------------------------ actions */
function sxDialog(title, body, okLabel, onOk) {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" style="width:min(520px,92vw)"><div style="padding:20px 24px 0"><h2>${esc(title)}</h2></div><div class="card-body stack" style="padding:16px 24px">${body}</div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">${esc(okLabel)}</button></div></form>`;
  d.showModal();
  d.onclose = async () => { if (d.returnValue !== "ok") return; try { await onOk(d); } catch (err) { toast(err.message, true); } };
}
const sxPut = (path, body) => api(`${sxP()}${path}`, { method: "PUT", body: JSON.stringify(body || {}) });
const sxPost = (path, body) => api(`${sxP()}${path}`, { method: "POST", body: JSON.stringify(body || {}) });
async function sxAfter() { SX.d = await api(sxP()); sxRerender(); if (SX.openId) sxOpen(SX.openId); }
async function sxAi(btn, path, body) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Drafting…"; }
  try { await sxPost(path, body); toast("Draft ready: review it in the customer panel"); await sxOpen(path.split("/")[2]); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}
async function sxAction(a, id, btn) {
  switch (a) {
    case "close": return sxClose();
    case "run": { const r = await sxPost("/run"); toast(`Checked ${r.snapshots} customer${r.snapshots === 1 ? "" : "s"}: ${r.alerts} new alert${r.alerts === 1 ? "" : "s"}`); return sxReload(); }
    case "alert-done": return sxDialog("Close the alert", `<div class="field"><label for="sxo-out">Outcome</label><select class="input" id="sxo-out">${SX.meta.outcomes.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="sxo-note">What happened</label><textarea class="input" id="sxo-note" rows="3" required dir="auto" placeholder="Called the owner; the catalog sync was broken and is fixed"></textarea></div>`, "Mark done", async () => {
        await sxPut(`/alerts/${id}`, { status: "done", outcome: $("#sxo-out").value, outcome_note: $("#sxo-note").value }); toast("Alert closed"); await sxAfter();
      });
    case "alert-snooze": return sxDialog("Snooze the alert", `<div class="field"><label for="sxo-until">Bring it back on</label><input class="input" id="sxo-until" type="date" required min="${new Date(Date.now() + 3 * 3600e3 + 864e5).toISOString().slice(0, 10)}" value="${new Date(Date.now() + 3 * 3600e3 + 7 * 864e5).toISOString().slice(0, 10)}"></div>`, "Snooze", async () => {
        await sxPut(`/alerts/${id}`, { status: "snoozed", snooze_until: $("#sxo-until").value }); toast("Snoozed"); await sxAfter();
      });
    case "alert-note": return sxDialog("Add a note", `<div class="field"><label for="sxo-n">Note</label><textarea class="input" id="sxo-n" rows="3" required dir="auto"></textarea></div>`, "Add note", async () => { await sxPut(`/alerts/${id}`, { note: $("#sxo-n").value }); toast("Note added"); await sxAfter(); });
    case "alert-open": await sxPut(`/alerts/${id}`, { status: "open" }); toast("Reopened"); return sxAfter();
    case "ai-save-plan": return sxAi(btn, `/customers/${id}/ai/save-plan`, btn?.dataset.alert ? { alert_id: btn.dataset.alert } : {});
    case "ai-expansion": return sxAi(btn, `/customers/${id}/ai/expansion`);
    case "ai-renewal": return sxAi(btn, `/customers/${id}/ai/renewal`);
    case "draft-approve": case "draft-send": {
      const subj = document.querySelector(`[data-sxdsubj="${id}"]`), text = document.querySelector(`[data-sxdtext="${id}"]`);
      const r = await sxPost(`/drafts/${id}/approve`, { subject: subj?.value, text: text?.value, send: a === "draft-send" });
      toast(r.sent ? `Approved · ${r.sent.status}${r.sent.note ? `: ${r.sent.note}` : ""}` : "Approved"); return sxAfter();
    }
    case "draft-reject": await sxPost(`/drafts/${id}/reject`); toast("Rejected"); return sxAfter();
    case "ren-save": {
      const st = document.querySelector(`[data-sxrstatus="${id}"]`).value, lost = document.querySelector(`[data-sxrlost="${id}"]`);
      if (st === "lost" && !lost) { const row = document.querySelector(`[data-sxrstatus="${id}"]`); row.insertAdjacentHTML("afterend", `<input class="input input-sm" data-sxrlost="${esc(id)}" placeholder="Why lost" dir="auto" style="margin-top:4px" aria-label="Why lost">`); return document.querySelector(`[data-sxrlost="${id}"]`).focus(); }
      const date = document.querySelector(`[data-sxren="${id}"]`)?.dataset.date;
      await sxPut(`/renewals/${id}`, { date, status: st, lost_reason: lost?.value ?? undefined, owner_id: document.querySelector(`[data-sxrowner="${id}"]`).value || null }); toast("Renewal saved"); return sxRenewals();
    }
    case "survey-send": {
      if (!confirm("Send this survey to every customer that hasn't got it yet? Test mode only logs it.")) return;
      const r = await sxPost(`/surveys/${id}/send`, {}); toast(Object.entries(r.results).map(([k, v]) => `${v} ${k}`).join(", ") || "Nothing new to send"); return sxSurveys();
    }
    case "survey-view": SX.surveyOpen = SX.surveyOpen === id ? null : id; return sxSurveys();
    case "survey-del": if (!confirm("Delete this draft survey?")) return; await api(`${sxP()}/surveys/${id}`, { method: "DELETE" }); return sxSurveys();
    case "copy-link": try { await navigator.clipboard.writeText(btn.dataset.link); toast("Link copied"); } catch { prompt("Copy the link", btn.dataset.link); } return;
    case "pb-save": await sxPut(`/playbooks/${id}`, { steps: document.querySelector(`[data-sxpb="${id}"]`).value }); toast("Playbook saved"); SX.d = await api(sxP()); return;
    case "pb-reset": await sxPut(`/playbooks/${id}`, { steps: [] }); toast("Back to the default"); SX.d = await api(sxP()); return sxPlaybooks();
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("#blSucc a") && typeof blClose === "function") blClose(); // leaving Billing's drawer for this page
  if (S.route !== "success") return;
  if (t.closest("#sxScrim")) return sxClose();
  const tab = t.closest("[data-sxtab]");
  if (tab) { SX.tab = tab.dataset.sxtab; if (tab.closest("#sxDrawer")) sxClose(); document.querySelectorAll("[data-sxtab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sxtab === SX.tab)); return sxRerender(); }
  const ast = t.closest("[data-sxast]");
  if (ast) { SX.alertStatus = ast.dataset.sxast; return sxAlerts(); }
  const act = t.closest("[data-sx]");
  if (act) { e.preventDefault(); try { await sxAction(act.dataset.sx, act.dataset.id, act); } catch (err) { toast(err.message, true); } return; }
  const row = t.closest("[data-sxopen]");
  if (row && !t.closest("button,select,input")) { e.preventDefault(); sxOpen(row.dataset.sxopen); }
});
document.addEventListener("keydown", (e) => {
  if (S.route !== "success") return;
  if (e.key === "Escape" && SX.openId && !$("#dialog").open) sxClose();
  if (e.key === "Enter" && e.target.matches?.("tr[data-sxopen]")) sxOpen(e.target.dataset.sxopen);
});
document.addEventListener("change", async (e) => {
  if (S.route !== "success") return;
  const t = e.target;
  try {
    if (t.id === "sxAType") { SX.alertType = t.value; return sxAlerts(); }
    if (t.dataset.sxaowner) { await sxPut(`/alerts/${t.dataset.sxaowner}`, { owner_id: t.value || null }); return toast("Owner saved"); }
    if (t.dataset.sxcowner) { await sxPut(`/customers/${t.dataset.sxcowner}/owner`, { owner_id: t.value || null }); toast("Owner saved"); SX.d = await api(sxP()); return; }
    if (t.dataset.sxstep) { const [id, i] = t.dataset.sxstep.split(":"); const steps = []; steps[Number(i)] = t.checked; await sxPut(`/alerts/${id}`, { steps }); return; }
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "success") return;
  const f = e.target;
  try {
    if (f.id === "sxSet") {
      e.preventDefault();
      const body = Object.fromEntries(["health_drop_points", "health_drop_days", "usage_drop_pct", "inactive_days", "open_tickets_max", "reopen_days", "render_pct", "stuck_days"].map((k) => [k, Number($("#sxt-" + k).value)]));
      body.mode = $("#sxt-mode").value; body.wa_template = $("#sxt-wa").value;
      await sxPut("/settings", body); toast("Settings saved"); return sxReload();
    }
    if (f.id === "sxNewSurvey") {
      e.preventDefault();
      await sxPost("/surveys", { name: $("#sxs-name").value, kind: $("#sxs-kind").value, channel: $("#sxs-channel").value }); toast("Survey created: press Send when ready"); return sxSurveys();
    }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "success" && S.ws) render();
