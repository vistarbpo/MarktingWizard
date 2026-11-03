/* Billing & customers: subscriptions, invoices (VAT, credit notes, ZATCA QR), payments (manual, Moyasar,
   Salla/Zid payouts), dunning and the customer 360. Uses app.js globals (S, $, api, esc, toast, fmtDate,
   ROUTES, levelFor). The billing run, reminders and reconciliation are automatic; people approve money
   decisions (voids, credit notes, plan changes) and every AI Billing assistant draft. */

const BL = { meta: null, d: null, tab: "overview", f: { q: "", status: "", plan: "" }, invFilter: "", list: null, payout: null, openId: null };
const blP = () => `/api/workspaces/${S.ws.id}/billing`;
const blEdit = () => levelFor("billing") === "edit";
const blMoney = (n, cur = "SAR") => (n == null ? "–" : `${cur} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const blSar = (n) => (n == null ? "–" : "SAR " + Math.round(n).toLocaleString("en-US"));
const blShort = (n) => { const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : Math.round(a).toLocaleString("en-US")); };
const BL_TONE = { trial: "accent", active: "good", past_due: "warn", paused: "", cancelled: "bad", draft: "", issued: "accent", paid: "good", void: "bad", failed: "bad", healthy: "good", watch: "warn", at_risk: "bad" };
const blBadge = (s, label) => `<span class="badge ${BL_TONE[s] || ""}">${esc(label || String(s).replace(/_/g, " "))}</span>`;

ROUTES.billing = { title: "Billing & customers", crumb: "Finance", render: renderBilling };

async function renderBilling(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  if (!BL.meta) BL.meta = await api("/api/billing/meta");
  BL.d = await api(blP());
  BL.list = null;
  const tabs = [["overview", "Overview"], ["customers", "Customers"], ["invoices", "Invoices"], ["payments", "Payments"], ["dunning", "Dunning"], ["settings", "Settings"]];
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Billing views">${tabs.map(([k, l]) => `<button role="tab" data-bltab="${k}" aria-selected="${BL.tab === k}">${l}</button>`).join("")}</div>
    ${blEdit() ? `<button class="btn" data-bl="run" title="Issue due invoices, end trials, bill overage and send reminders now">Run billing</button><button class="btn btn-primary" data-bl="new-customer">New customer</button>` : ""}`;
  view.innerHTML = `<section class="s-kpis" id="blKpis"></section><div id="blBody" style="margin-top:20px"></div>`;
  blRerender();
}

async function blReload() { BL.d = await api(blP()); BL.list = null; blRerender(); if (BL.openId) blOpen(BL.openId); }

function blRerender() {
  if (S.route !== "billing" || !BL.d) return;
  const m = BL.d.metrics, t = m.this_month, inv = BL.d.invoices, s = BL.d.settings;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#blKpis").innerHTML = [
    tile("MRR", blSar(m.mrr_sar), `${m.paying} paying · ${m.trials} in trial · excl. VAT`),
    tile("ARR", blSar(m.arr_sar), `MRR × 12 · $${Math.round(m.mrr_usd * 12).toLocaleString("en-US")}`),
    tile("Net MRR this month", (t.end - t.start >= 0 ? "+" : "") + blShort(t.end - t.start), `new ${blShort(t.new)} · churned ${blShort(t.churned)}`, t.end < t.start ? "warn" : ""),
    tile("NRR", t.nrr_pct == null ? "–" : t.nrr_pct + "%", m.nrr_12m_pct == null ? "this month · 12-month needs a year of data" : `this month · 12-month ${m.nrr_12m_pct}%`, t.nrr_pct != null && t.nrr_pct < 100 ? "warn" : ""),
    tile("Logo churn", t.logo_churn_pct == null ? "–" : t.logo_churn_pct + "%", `${t.logos_churned} of ${t.logos_start} stores this month`, t.logo_churn_pct > 3 ? "warn" : ""),
    tile("Overdue", blSar(inv.overdue_sar), `${inv.overdue} invoice${inv.overdue === 1 ? "" : "s"} · ${inv.open} open`, inv.overdue ? "bad" : ""),
  ].join("");
  if (s.mode !== "live" && !$("#blMode")) $("#blKpis").insertAdjacentHTML("afterend", `<div class="notice" id="blMode" style="margin-top:12px">Test mode: invoices are issued and numbered, but no card links are created, ZATCA isn't called and emails are logged, not sent. Switch to Live in Settings when Moyasar and email are set up.</div>`);
  if (s.mode === "live") $("#blMode")?.remove();
  ({ overview: blOverview, customers: blCustomers, invoices: blInvoices, payments: blPayments, dunning: blDunning, settings: blSettings })[BL.tab]();
}

/* ------------------------------------------------ Overview */
function blOverview() {
  const d = BL.d, m = d.metrics;
  $("#blBody").innerHTML = `<div class="cc">
    <section class="card card-pad cc-span-8 bl-span">
      <span class="eyebrow">MRR movement, last 12 months</span>
      <svg id="blChart" viewBox="0 0 900 300" role="img" aria-label="MRR movement by month" style="width:100%;height:auto;display:block;margin-top:8px"></svg>
      <div class="s-legend"><span><i class="s-dot" style="background:var(--good)"></i>New</span><span><i class="s-dot" style="background:var(--accent)"></i>Expansion &amp; reactivation</span><span><i class="s-dot" style="background:var(--warn)"></i>Contraction</span><span><i class="s-dot" style="background:var(--bad)"></i>Churned</span><span><i class="s-dot" style="background:var(--text)"></i>MRR at month end</span></div>
      <p class="subtle s-small">From each customer's subscription history: trials count 0 until they convert, yearly plans count a twelfth, paused and cancelled count 0. SAR, before VAT.</p>
    </section>
    <section class="card card-pad cc-span-4 bl-span stack">
      <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${d.needs.length ? "warn" : "good"}">${d.needs.length || "All clear"}</span></div>
      ${d.needs.length ? `<ul class="cc-list">${d.needs.map((n) => `<li class="clickable" data-bltab="${esc(n.tab)}"${n.customer_id ? ` data-blopen="${esc(n.customer_id)}"` : ""}><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small">${esc(n.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Nothing needs you in Billing right now.</p>`}
      ${blSuggestHtml()}
    </section>
    <section class="card cc-span-12 bl-span"><div class="table-wrap"><table class="f-table"><thead><tr><th>Month</th><th class="num">Start</th><th class="num">New</th><th class="num">Expansion</th><th class="num">Reactivation</th><th class="num">Contraction</th><th class="num">Churned</th><th class="num">End</th><th class="num">NRR</th><th class="num">Logo churn</th></tr></thead><tbody>
      ${[...m.months].reverse().map((r) => `<tr><td class="num">${r.month}</td><td class="num">${blShort(r.start)}</td><td class="num">${r.new ? "+" + blShort(r.new) : "–"}</td><td class="num">${r.expansion ? "+" + blShort(r.expansion) : "–"}</td><td class="num">${r.reactivation ? "+" + blShort(r.reactivation) : "–"}</td><td class="num">${r.contraction ? "−" + blShort(r.contraction) : "–"}</td><td class="num">${r.churned ? "−" + blShort(r.churned) : "–"}</td><td class="num"><b>${blShort(r.end)}</b></td><td class="num">${r.nrr_pct == null ? "–" : r.nrr_pct + "%"}</td><td class="num">${r.logo_churn_pct == null ? "–" : r.logo_churn_pct + "%"}</td></tr>`).join("")}
    </tbody></table></div></section>
  </div>`;
  blChart(m.months);
}

function blChart(months) {
  const W = 900, H = 300, L = 60, R = 16, T = 16, B = 34;
  const up = months.map((r) => [r.new, r.expansion + r.reactivation]), down = months.map((r) => [r.contraction, r.churned]);
  const max = Math.max(1, ...months.map((r) => r.end), ...up.map(([a, b]) => a + b)), min = -Math.max(0, ...down.map(([a, b]) => a + b));
  const step = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6].find((x) => (max - min) / x <= 6) || 1e7;
  const top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
  const X = (i) => L + (i + 0.5) * ((W - L - R) / months.length), Y = (v) => T + (H - T - B) * (1 - (v - bot) / (top - bot || 1)), bw = ((W - L - R) / months.length) * 0.5;
  let svg = "";
  for (let v = bot; v <= top + 1e-6; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)" ${v === 0 ? 'stroke="var(--border-strong)" stroke-width="1.5"' : ""}></line><text class="s-svg-mono" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${blShort(v)}</text>`;
  months.forEach((r, i) => {
    const x = X(i) - bw / 2;
    let y0 = 0;
    for (const [v, c, l] of [[r.new, "var(--good)", "new"], [r.expansion + r.reactivation, "var(--accent)", "expansion"]]) { if (v > 0) svg += `<rect x="${x}" y="${Y(y0 + v)}" width="${bw}" height="${Y(y0) - Y(y0 + v)}" fill="${c}" rx="2"><title>${r.month} ${l} SAR ${Math.round(v).toLocaleString("en-US")}</title></rect>`; y0 += v; }
    y0 = 0;
    for (const [v, c, l] of [[r.contraction, "var(--warn)", "contraction"], [r.churned, "var(--bad)", "churned"]]) { if (v > 0) svg += `<rect x="${x}" y="${Y(y0)}" width="${bw}" height="${Y(y0 - v) - Y(y0)}" fill="${c}" rx="2"><title>${r.month} ${l} SAR ${Math.round(v).toLocaleString("en-US")}</title></rect>`; y0 -= v; }
    svg += `<text class="s-svg-text" x="${X(i)}" y="${H - 12}" text-anchor="middle">${new Date(r.month + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</text>`;
  });
  svg += `<polyline points="${months.map((r, i) => `${X(i)},${Y(r.end)}`).join(" ")}" fill="none" stroke="var(--text)" stroke-width="2"></polyline>`;
  months.forEach((r, i) => { svg += `<circle cx="${X(i)}" cy="${Y(r.end)}" r="3" fill="var(--text)"><title>${r.month} MRR SAR ${Math.round(r.end).toLocaleString("en-US")}</title></circle>`; });
  $("#blChart").innerHTML = svg;
}

function blSuggestHtml() {
  const s = BL.d.suggestions;
  if (!s.length || !blEdit()) return "";
  return `<div style="border-top:1px solid var(--border);padding-top:12px" class="stack"><span class="eyebrow">Ready to become customers</span>
    <ul class="cc-list">${s.slice(0, 6).map((x) => `<li><span class="s-small grow" dir="auto">${esc(x.name)} <span class="subtle">· ${x.kind === "deal" ? "Sales: paying" : "CRM: " + esc(x.stage)} · ${esc(x.plan)}</span></span><button class="btn btn-sm" data-bl-from="${x.kind}:${esc(x.id)}">Create customer</button></li>`).join("")}</ul></div>`;
}

/* ------------------------------------------------ Customers */
function blCustomers() {
  const f = BL.f, q = f.q.trim().toLowerCase();
  const list = BL.d.customers.filter((c) => (!f.status || c.status === f.status) && (!f.plan || c.plan === f.plan) && (!q || `${c.store_name} ${c.domain} ${c.owner_email}`.toLowerCase().includes(q)));
  $("#blBody").innerHTML = `
    <div class="row gap-8 bl-filters" style="flex-wrap:wrap;margin-bottom:12px">
      <input class="input input-sm" id="blQ" placeholder="Search store, domain or email" value="${esc(f.q)}" style="flex:1;min-width:180px" aria-label="Search customers">
      <select class="input input-sm" id="blFs" aria-label="Status" style="width:auto"><option value="">All statuses</option>${BL.meta.statuses.map((s) => `<option value="${s.id}" ${f.status === s.id ? "selected" : ""}>${esc(s.name)} (${BL.d.counts[s.id] || 0})</option>`).join("")}</select>
      <select class="input input-sm" id="blFp" aria-label="Plan" style="width:auto"><option value="">All plans</option>${BL.meta.plans.map((p) => `<option ${f.plan === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    </div>
    ${BL.d.suggestions.length && blEdit() ? `<section class="card card-pad" style="margin-bottom:12px">${blSuggestHtml().replace('style="border-top:1px solid var(--border);padding-top:12px"', "")}</section>` : ""}
    ${list.length ? `<section class="card"><div class="table-wrap"><table class="f-table bl-table"><thead><tr><th>Store</th><th>Plan</th><th>Status</th><th class="num">MRR</th><th class="num">Balance due</th><th>Health</th><th>Next invoice</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="clickable" data-blopen="${esc(c.id)}" tabindex="0"><td><b dir="auto">${esc(c.store_name)}</b>${c.sample ? ' <span class="badge">sample</span>' : ""}<div class="subtle s-small">${esc(c.domain || c.owner_email || "–")} · ${esc(c.platform || "")}</div></td>
        <td>${esc(c.plan)}<div class="subtle s-small">${esc(c.cycle)} · ${esc(c.currency)}</div></td>
        <td>${blBadge(c.status)}${c.cancel_at_period_end ? '<div class="subtle s-small">cancels at period end</div>' : ""}</td>
        <td class="num">${blSar(c.mrr_sar)}</td><td class="num">${c.balance_due ? `<b>${blMoney(c.balance_due, c.currency)}</b>` : "–"}</td>
        <td>${blBadge(c.health.label, `${c.health.score} · ${c.health.label.replace("_", " ")}`)}</td><td class="num">${esc(c.next_invoice || "–")}</td></tr>`).join("")}
    </tbody></table></div></section>`
    : `<div class="card empty"><h2>${BL.d.customers.length ? "No customers match" : "No customers yet"}</h2><p>A customer is a store that pays or is in a trial. Create one from a paying Sales deal or a CRM store in onboarding, or add it by hand. The billing run then issues its invoices.</p>${blEdit() ? `<button class="btn btn-primary" data-bl="new-customer">New customer</button>` : ""}</div>`}`;
}

/* ------------------------------------------------ 360 drawer */
function blDrawerEl() {
  let el = $("#blDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="blScrim" hidden></div><aside class="s-drawer bl-drawer" id="blDrawer" hidden aria-label="Customer"></aside>`); el = $("#blDrawer"); }
  return el;
}
function blClose() { const d = $("#blDrawer"); if (d) { d.hidden = true; $("#blScrim").hidden = true; } BL.openId = null; }
async function blOpen(id) {
  let d;
  try { d = await api(`${blP()}/customers/${id}`); } catch (e) { return toast(e.message, true); }
  BL.openId = id;
  const c = d.customer, ed = blEdit(), el = blDrawerEl(), h = c.health, um = d.usage_month;
  const act = (a, l, cls = "btn-sm") => `<button class="btn ${cls}" data-bl="${a}" data-id="${esc(c.id)}">${l}</button>`;
  el.innerHTML = `<div class="row gap-12"><div style="flex:1;min-width:0"><h2 dir="auto">${esc(c.store_name)}</h2><span class="subtle">${esc(c.domain || "no domain")} · ${esc(c.platform || "")} · customer since ${esc(c.start_date)}</span></div><button class="btn btn-sm" data-bl="close">Close</button></div>
  <div class="s-facts">
    <div class="card s-fact"><span class="eyebrow">Plan</span><b>${esc(c.plan)}</b><span class="subtle s-small num">${blMoney(c.price, c.currency)} / ${c.cycle === "yearly" ? "year" : "month"}</span></div>
    <div class="card s-fact"><span class="eyebrow">Status</span><b>${blBadge(c.status)}</b><span class="subtle s-small">${c.status === "trial" ? `trial ends ${esc(c.trial_end)}` : c.cancel_at_period_end ? `cancels ${esc(c.period_end)}` : c.next_invoice ? `next invoice ${esc(c.next_invoice)}` : ""}</span></div>
    <div class="card s-fact"><span class="eyebrow">Balance due</span><b class="num">${blMoney(c.balance_due, c.currency)}</b><span class="subtle s-small">${c.credit_balance ? `credit ${blMoney(c.credit_balance, c.currency)}` : `${c.open_invoices} open`}</span></div>
  </div>
  <div class="card card-pad stack"><div class="row between"><h3>Health score</h3>${blBadge(h.label, `${h.score} / 100 · ${h.label.replace("_", " ")}`)}</div>
    <ul class="bl-factors">${h.factors.map((f) => `<li><span class="s-small"><b>${esc(f.name)}</b> · ${esc(f.why)}</span><span class="num s-small">${f.points}/${f.max}</span><span class="meter"><span style="width:${Math.round((f.points / f.max) * 100)}%"></span></span></li>`).join("")}</ul>
    <p class="subtle s-small">Rule-based: payment 30, usage 25, tickets 15, onboarding 15, recent activity 15. 75+ healthy, 50–74 watch, under 50 at risk.</p></div>
  <div id="blSucc"></div>
  ${ed ? `<div class="card card-pad stack"><h3>Subscription</h3>
    <div class="row gap-8" style="flex-wrap:wrap"><select class="input input-sm" id="blPlan" style="width:auto" aria-label="New plan">${BL.meta.plans.map((p) => `<option ${p.name === c.plan ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <input class="input input-sm" id="blCustom" type="number" min="4000" step="1" placeholder="Enterprise $/mo" value="${c.custom_price_usd || ""}" style="width:150px" aria-label="Enterprise custom price (USD per month)">
      <button class="btn btn-sm" data-bl="plan-preview" data-id="${esc(c.id)}">Preview change</button></div>
    <div id="blProration"></div>
    <div class="row gap-8" style="flex-wrap:wrap">${c.status === "paused" ? act("resume", "Resume") : ["active", "past_due", "trial"].includes(c.status) ? act("pause", "Pause") : ""}
      ${c.status === "cancelled" || c.cancel_at_period_end ? act("reactivate", c.cancel_at_period_end ? "Keep subscription" : "Reactivate") : act("cancel", "Cancel at period end")}
      ${c.status !== "cancelled" && !c.cancel_at_period_end ? act("cancel-now", "Cancel now", "btn-sm btn-ghost btn-danger") : ""}
      ${act("new-invoice", "New invoice")}</div></div>` : ""}
  <div class="card card-pad stack"><div class="row between"><h3>Usage ${esc(um.month)}</h3><span class="subtle s-small">${um.limit ? `${um.limit.toLocaleString("en-US")} renders included` : "no render limit on this plan"}</span></div>
    <p class="s-small"><b class="num">${um.renders.toLocaleString("en-US")}</b> renders${um.extra ? ` · <b style="color:var(--warn)">${um.extra.toLocaleString("en-US")} over the limit</b>: ${um.blocks} × 1,000 at $${um.rate_usd} = $${um.amount_usd} on the next invoice` : ""}</p>
    ${ed ? `<form class="row gap-8" id="blUsage"><input class="input input-sm" id="blRenders" type="number" min="0" step="1" placeholder="Renders this month" style="flex:1" aria-label="Renders this month"><button class="btn btn-sm" type="submit">Save usage</button></form>` : ""}
    <p class="subtle s-small">The DPA AD product can post this to <span class="mono">/hooks/billing/usage</span> (Bearer BILLING_USAGE_TOKEN) instead.</p></div>
  <div class="card card-pad stack"><h3>Invoices</h3>${d.invoices.length ? `<div class="table-wrap"><table class="f-table"><tbody>${d.invoices.map((i) => `<tr><td class="num"><a href="${blP()}/invoices/${esc(i.id)}/print" target="_blank" rel="noopener">${esc(i.number || "Draft")}</a>${i.kind === "credit_note" ? ' <span class="badge">credit</span>' : ""}</td><td class="num">${esc(i.issue_date || "–")}</td><td class="num">${blMoney(i.totals.total, i.currency)}</td><td>${blBadge(i.status)}${i.dunning?.overdue ? ` <span class="badge bad">${i.dunning.days_overdue}d late</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small">No invoices yet.</p>`}</div>
  <div class="card card-pad stack"><h3>Payments</h3>${d.payments.length ? `<ul class="s-timeline">${d.payments.map((p) => `<li><span class="s-small grow">${blMoney(p.amount, p.currency)} · ${esc(p.method.replace(/_/g, " "))}${p.reference ? " · " + esc(p.reference) : ""}${p.status === "failed" ? ` · <b style="color:var(--bad)">failed</b> ${esc(p.note)}` : ""}</span><span class="subtle s-small num">${esc(p.date)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">No payments yet.</p>`}</div>
  <div class="card card-pad stack"><h3>Support tickets</h3>${d.tickets.length ? `<ul class="s-timeline">${d.tickets.map((t) => `<li><span class="s-small grow"><a href="#/${S.ws.id}/support">${esc(t.channel)} · ${esc(t.category || "")}</a> ${blBadge(t.status === "solved" ? "paid" : "issued", t.status)}<div class="subtle" dir="auto">${esc(t.last)}</div></span><span class="subtle s-small num">${fmtDate(t.updated_at)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">No tickets matched by email or domain.</p>`}</div>
  <div class="card card-pad stack"><h3>Onboarding</h3>${d.onboarding ? `<ul class="bl-onb">${d.onboarding.steps.map((s) => `<li class="${d.onboarding.done[s.id] ? "on" : ""}"><span aria-hidden="true">${d.onboarding.done[s.id] ? "✓" : "○"}</span> ${esc(s.name)}</li>`).join("")}</ul><a class="s-small" href="#/${S.ws.id}/crm">Tick steps in the Store CRM</a>` : `<p class="muted s-small">Not linked to a Store CRM store, so the onboarding checklist isn't available.</p>`}</div>
  <div class="card card-pad stack"><h3>Timeline &amp; notes</h3>
    ${ed ? `<form class="row gap-8" id="blNote"><input class="input input-sm" id="blNoteText" placeholder="Add a note…" dir="auto" style="flex:1" aria-label="Note"><button class="btn btn-sm" type="submit">Add</button></form>` : ""}
    <ul class="s-timeline">${d.timeline.slice(0, 40).map((t) => `<li><span class="s-small grow" dir="auto">${t.kind === "note" ? "📝 " : ""}${esc(t.kind === "event" ? t.type.replace(/_/g, " ") + (t.text ? ": " + t.text : "") : t.text)}${t.by ? ` <span class="subtle">· ${esc(t.by)}</span>` : ""}</span><span class="subtle s-small num">${esc(t.date || "")}</span></li>`).join("")}</ul></div>
  <form class="card card-pad stack" id="blDetails"><h3>Billing details</h3>
    <div class="s-form">
      ${[["store_name", "Store name"], ["legal_name", "Legal name (on invoices)"], ["domain", "Domain"], ["owner_name", "Owner name"], ["owner_email", "Billing email"], ["owner_phone", "Phone"], ["vat_number", "Buyer VAT number (B2B)"], ["app_store_id", "Salla/Zid store id"]].map(([k, l]) => `<div class="field"><label for="bld-${k}">${l}</label><input class="input" id="bld-${k}" value="${esc(c[k] || "")}" dir="auto" ${ed ? "" : "disabled"}></div>`).join("")}
      ${["street", "building", "district", "city", "postal_code"].map((k) => `<div class="field"><label for="bla-${k}">${k === "postal_code" ? "Postal code" : k[0].toUpperCase() + k.slice(1)}</label><input class="input" id="bla-${k}" value="${esc(c.billing_address?.[k] || "")}" dir="auto" ${ed ? "" : "disabled"}></div>`).join("")}
      <div class="field"><label for="bld-cycle">Billing cycle</label><select class="input" id="bld-cycle" ${ed ? "" : "disabled"}>${BL.meta.cycles.map((x) => `<option ${(c.next_cycle || c.cycle) === x ? "selected" : ""}>${x}</option>`).join("")}</select><span class="hint">${c.next_cycle ? `Changes to ${esc(c.next_cycle)} at the next renewal` : "A change applies from the next renewal"}</span></div>
    </div>
    <p class="subtle s-small">With a buyer VAT number, invoices are standard (B2B) tax invoices and need the full address for ZATCA; without one they are simplified (B2C).</p>
    ${ed ? `<div class="row between"><button class="btn btn-ghost btn-danger btn-sm" type="button" data-bl="delete-customer" data-id="${esc(c.id)}">Remove customer</button><button class="btn btn-primary btn-sm" type="submit">Save details</button></div>` : ""}
  </form>`;
  el.hidden = false; $("#blScrim").hidden = false;
  if (typeof sxBillingHook === "function") sxBillingHook(c.id); // Customer success: trend, open alerts, last NPS
}

/* ------------------------------------------------ Invoices */
async function blInvoices() {
  $("#blBody").innerHTML = `<p class="muted">Loading…</p>`;
  const list = await api(`${blP()}/invoices${BL.invFilter ? `?status=${BL.invFilter}` : ""}`);
  if (S.route !== "billing" || BL.tab !== "invoices") return;
  const ed = blEdit(), test = BL.d.settings.mode !== "live";
  $("#blBody").innerHTML = `<div class="row gap-8" style="flex-wrap:wrap;margin-bottom:12px;justify-content:space-between">
      <div class="s-tabs" role="tablist" aria-label="Invoice status">${[["", "All"], ["draft", "Drafts"], ["issued", "Open"], ["paid", "Paid"], ["void", "Void"]].map(([k, l]) => `<button role="tab" data-blinv="${k}" aria-selected="${BL.invFilter === k}">${l}</button>`).join("")}</div>
      <span class="subtle s-small">${BL.d.vat_registered ? `VAT 15% on (Finance → VAT registered) · ZATCA ${esc(BL.d.settings.zatca_mode)} mode` : "Not VAT-registered (Finance settings): invoices carry no VAT"}</span></div>
    ${list.length ? `<section class="card"><div class="table-wrap"><table class="f-table bl-table"><thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Due now</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((i) => `<tr><td class="num"><a href="${blP()}/invoices/${esc(i.id)}/print" target="_blank" rel="noopener">${esc(i.number || "Draft")}</a>${i.kind === "credit_note" ? `<div class="subtle s-small">credit for ${esc(i.credit_of_number)}</div>` : ""}${i.zatca ? `<div class="subtle s-small">${i.zatca_type === "standard" ? "B2B" : "B2C"} · ICV ${i.zatca.icv}</div>` : ""}</td>
        <td dir="auto">${esc(i.customer)}</td><td class="num">${esc(i.issue_date || "–")}</td><td class="num">${esc(i.kind === "invoice" ? i.due_date || "–" : "–")}</td>
        <td class="num">${blMoney(i.totals.total, i.currency)}${i.totals.vat ? `<div class="subtle s-small">VAT ${blMoney(i.totals.vat, i.currency)}</div>` : ""}</td>
        <td class="num">${i.kind === "invoice" && i.status === "issued" ? `<b>${blMoney(i.due, i.currency)}</b>` : "–"}</td>
        <td>${blBadge(i.status)}${i.dunning?.overdue ? ` <span class="badge bad">${i.dunning.days_overdue}d late</span>` : ""}${i.void_reason ? `<div class="subtle s-small" dir="auto">${esc(i.void_reason)}</div>` : ""}</td>
        <td class="bl-acts">${ed ? [
          i.status === "draft" ? `<button class="btn btn-sm btn-primary" data-bl="issue" data-id="${esc(i.id)}">Issue</button><button class="btn btn-sm btn-ghost" data-bl="del-invoice" data-id="${esc(i.id)}" aria-label="Delete draft">✕</button>` : "",
          i.kind === "invoice" && i.status === "issued" ? `<button class="btn btn-sm" data-bl="pay" data-id="${esc(i.id)}">Record payment</button>${test ? `<button class="btn btn-sm btn-ghost" data-bl="sim-paid" data-id="${esc(i.id)}" title="Test mode: pretend Moyasar confirmed a card payment">Test card</button>` : ""}` : "",
          i.kind === "invoice" && ["issued", "paid"].includes(i.status) ? `<button class="btn btn-sm btn-ghost" data-bl="credit" data-id="${esc(i.id)}">Credit note</button>` : "",
          i.kind === "invoice" && ["draft", "issued"].includes(i.status) && !i.paid_amount ? `<button class="btn btn-sm btn-ghost btn-danger" data-bl="void" data-id="${esc(i.id)}">Void</button>` : "",
          `<button class="btn btn-sm btn-ghost" data-bl="ai-explain" data-id="${esc(i.id)}" title="AI Billing assistant: explain this invoice to the store (you approve)">Explain</button>`,
        ].join("") : ""}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>No invoices${BL.invFilter ? " here" : " yet"}</h2><p>The billing run issues subscription invoices on each renewal date, adds render overage in arrears, and numbers them in order. Add a one-off invoice from a customer's page.</p></div>`}
    <p class="subtle s-small" style="margin-top:10px">Issued invoices are never edited. To correct one, issue a credit note; voiding an unpaid invoice issues the credit note for you. Each invoice opens as a printable Arabic/English page (Print → Save as PDF).</p>`;
}

/* ------------------------------------------------ Payments + app-store payouts */
async function blPayments() {
  $("#blBody").innerHTML = `<p class="muted">Loading…</p>`;
  const list = await api(`${blP()}/payments`);
  if (S.route !== "billing" || BL.tab !== "payments") return;
  const p = BL.payout;
  $("#blBody").innerHTML = `
    ${blEdit() ? `<section class="card card-pad stack" style="margin-bottom:16px"><div><h2>Salla / Zid app-store payouts</h2><p class="subtle s-small">Paste the payout CSV from the Salla or Zid partner portal (Arabic or English headers). Each row is matched to a customer by store id, domain or name, and to an open invoice by amount. Nothing is recorded until you apply.</p></div>
      <div class="row gap-8" style="flex-wrap:wrap"><select class="input input-sm" id="blPoPlat" style="width:auto" aria-label="Platform">${["Salla", "Zid"].map((x) => `<option ${BL.poPlat === x ? "selected" : ""}>${x}</option>`).join("")}</select><span class="subtle s-small">Columns: date, store, domain, amount, fee, net, reference</span></div>
      <textarea class="input mono" id="blPoText" rows="4" placeholder="date,store,domain,amount,fee,reference&#10;2026-11-02,متجر الورد,ward.sa,1683.75,50,PO-1001"></textarea>
      <div class="row gap-8"><button class="btn" data-bl="payout-parse">Match rows</button>${p ? `<button class="btn btn-primary" data-bl="payout-apply">Apply ${p.filter((r) => r.match === "invoice").length} matched payment${p.filter((r) => r.match === "invoice").length === 1 ? "" : "s"}</button>` : ""}</div>
      ${p ? `<div class="table-wrap"><table class="f-table"><thead><tr><th>Row</th><th>Store</th><th class="num">Gross</th><th class="num">Fee</th><th>Match</th></tr></thead><tbody>${p.map((r) => `<tr><td class="num">${r.row}</td><td dir="auto">${esc(r.store || r.domain || r.store_id)}</td><td class="num">${blMoney(r.gross)}</td><td class="num">${r.fee ? blMoney(r.fee) : "–"}</td><td>${blBadge(r.match === "invoice" ? "paid" : r.match === "customer" ? "past_due" : "void", r.match === "invoice" ? `${r.invoice}` : r.match)} <span class="subtle s-small" dir="auto">${esc(r.note)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
    </section>` : ""}
    ${list.length ? `<section class="card"><div class="table-wrap"><table class="f-table"><thead><tr><th>Date</th><th>Customer</th><th>Invoice</th><th>Method</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${list.map((x) => `<tr><td class="num">${esc(x.date)}</td><td dir="auto">${esc(x.customer)}</td><td class="num">${esc(x.invoice)}</td><td>${esc((BL.meta.methods.find((m) => m.id === x.method) || {}).name || x.method)}${x.reference ? `<div class="subtle s-small">${esc(x.reference)}</div>` : ""}</td><td class="num">${blMoney(x.amount, x.currency)}${x.fee ? `<div class="subtle s-small">fee ${blMoney(x.fee)}</div>` : ""}</td><td>${blBadge(x.status === "failed" ? "failed" : "paid", x.status)}${x.note ? `<div class="subtle s-small">${esc(x.note)}</div>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>No payments yet</h2><p>Record bank transfers on the invoice, let Moyasar mark card payments paid through its webhook, or import app-store payouts above. Every payment becomes Finance income automatically.</p></div>`}`;
}

/* ------------------------------------------------ Dunning */
async function blDunning() {
  $("#blBody").innerHTML = `<p class="muted">Loading…</p>`;
  const d = await api(`${blP()}/dunning`);
  if (S.route !== "billing" || BL.tab !== "dunning") return;
  const ed = blEdit();
  $("#blBody").innerHTML = `<p class="muted s-small" style="max-width:75ch;margin:0 0 14px">Reminders go out on day ${d.settings.dunning_days.join(", ")} after the due date (or after a failed card payment), 09:00–21:00 Riyadh time. A store is marked past due from day 1 and paused after ${d.settings.pause_after_days} days; paying brings it back. ${d.settings.mode === "live" ? "Live: reminders are emailed when email is connected." : "Test mode: reminders are logged here, not sent."}</p>
    ${d.drafts.filter((x) => x.status === "draft").map((x) => `<section class="card card-pad stack bl-draft" style="margin-bottom:12px"><div class="row between"><span class="eyebrow">AI Billing assistant · ${x.kind === "reminder" ? "reminder" : "invoice explanation"} for ${esc(x.invoice)} · ${esc(x.customer)}</span><span class="badge warn">needs approval</span></div>
      <input class="input" data-bldsubj="${esc(x.id)}" value="${esc(x.subject)}" dir="auto" aria-label="Subject" ${ed ? "" : "disabled"}>
      <textarea class="input" data-bldtext="${esc(x.id)}" rows="8" dir="auto" aria-label="Email text" ${ed ? "" : "disabled"}>${esc(x.text)}</textarea>
      ${ed ? `<div class="row gap-8"><button class="btn btn-primary btn-sm" data-bl="draft-approve" data-id="${esc(x.id)}">Approve and send</button><button class="btn btn-sm btn-ghost" data-bl="draft-reject" data-id="${esc(x.id)}">Reject</button></div>` : ""}</section>`).join("")}
    ${d.invoices.length ? `<section class="card"><div class="table-wrap"><table class="f-table bl-table"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Due</th><th>Overdue</th><th>Reminders</th><th>Next</th><th></th></tr></thead><tbody>
      ${d.invoices.map((i) => `<tr><td class="num"><a href="${blP()}/invoices/${esc(i.id)}/print" target="_blank" rel="noopener">${esc(i.number)}</a></td><td dir="auto">${esc(i.customer)}</td><td class="num">${blMoney(i.due, i.currency)}</td>
        <td>${i.dunning.overdue ? `<span class="badge bad">${i.dunning.days_overdue} days</span>` : `<span class="badge warn">card failed</span>`}<div class="subtle s-small">pauses ${esc(i.dunning.pause_on)}</div></td>
        <td class="s-small">${(i.reminders || []).map((r) => `day ${r.step}${r.step ? "" : " (AI)"} · ${esc(r.status)}`).join("<br>") || "–"}</td><td class="num s-small">${i.dunning.next_date ? `day ${i.dunning.next_step} · ${esc(i.dunning.next_date)}` : "–"}</td>
        <td>${ed ? `<button class="btn btn-sm" data-bl="ai-reminder" data-id="${esc(i.id)}">AI: draft reminder</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<div class="card empty"><h2>Nothing overdue</h2><p>When an invoice passes its due date, or a card payment fails, it shows here with its reminder schedule.</p></div>`}
    ${d.sent.length ? `<section class="card card-pad" style="margin-top:16px"><span class="eyebrow">Reminder log</span><ul class="s-timeline">${d.sent.map((l) => `<li><span class="s-small grow" dir="auto"><b>${esc(l.subject || "")}</b> → ${esc(l.to || "no email")} · ${blBadge(l.status === "sent" ? "paid" : l.status === "failed" ? "failed" : "draft", l.status)} ${l.note ? `<span class="subtle">${esc(l.note)}</span>` : ""}</span><span class="subtle s-small num">${fmtDate(l.at)}</span></li>`).join("")}</ul></section>` : ""}`;
}

/* ------------------------------------------------ Settings */
function blSettings() {
  const s = BL.d.settings, ed = blEdit(), c = BL.meta.connections, dis = ed ? "" : "disabled";
  const inp = (k, l, v, extra = "") => `<div class="field"><label for="bls-${k}">${l}</label><input class="input" id="bls-${k}" value="${esc(v ?? "")}" dir="auto" ${dis} ${extra}></div>`;
  $("#blBody").innerHTML = `<form class="stack-lg" id="blSet">
    <section class="card card-pad stack"><h2>Company on invoices</h2>
      <div class="s-form">${inp("legal_name", "Legal name (English)", s.legal_name)}${inp("legal_name_ar", "Legal name (Arabic)", s.legal_name_ar)}${inp("vat_number", "VAT number (15 digits)", s.vat_number, 'inputmode="numeric" maxlength="15"')}${inp("cr_number", "Commercial registration (CR)", s.cr_number, 'inputmode="numeric" maxlength="10"')}
        ${["street", "building", "district", "city", "postal_code"].map((k) => inp("a-" + k, k === "postal_code" ? "Postal code" : k === "building" ? "Building number" : k[0].toUpperCase() + k.slice(1), s.address[k])).join("")}</div>
      <div class="field"><label for="bls-bank">Bank details for transfers (printed on invoices)</label><textarea class="input" id="bls-bank" rows="3" dir="auto" ${dis} placeholder="Bank, account name, IBAN SA…">${esc(s.bank_details)}</textarea></div>
      <p class="subtle s-small">VAT is ${BL.d.vat_registered ? "<b>on</b>" : "<b>off</b>"}: it follows "VAT registered" in Finance → Reports &amp; VAT. Tax invoices need the VAT number above.</p></section>
    <section class="card card-pad stack"><h2>Invoices and payments</h2>
      <div class="s-form">${inp("invoice_prefix", "Invoice number prefix", s.invoice_prefix)}${inp("credit_prefix", "Credit note prefix", s.credit_prefix)}
        <div class="field"><label for="bls-terms">Payment terms (days)</label><input class="input" id="bls-terms" type="number" min="0" max="90" value="${s.terms_days}" ${dis}></div>
        <div class="field"><label for="bls-mode">Gateway &amp; email mode</label><select class="input" id="bls-mode" ${dis}><option value="test" ${s.mode === "test" ? "selected" : ""}>Test: log only</option><option value="live" ${s.mode === "live" ? "selected" : ""}>Live: Moyasar links and emails</option></select></div>
        <div class="field"><label for="bls-dun">Reminder days after due</label><input class="input" id="bls-dun" value="${esc(s.dunning_days.join(", "))}" ${dis}></div>
        <div class="field"><label for="bls-pause">Pause after (days overdue)</label><input class="input" id="bls-pause" type="number" min="1" max="120" value="${s.pause_after_days}" ${dis}></div></div>
      <label class="row gap-8 s-small"><input type="checkbox" id="bls-auto" ${s.auto_issue ? "checked" : ""} ${dis}> Issue renewal and proration invoices automatically (off: they wait as drafts for a person)</label>
      <p class="subtle s-small">Next invoice number: <span class="mono">${esc(s.invoice_prefix)}${String(s.next_invoice_no).padStart(6, "0")}</span> · next credit note <span class="mono">${esc(s.credit_prefix)}${String(s.next_credit_no).padStart(6, "0")}</span>. Numbers never repeat or skip.</p>
      <ul class="bl-conn s-small">
        <li>${c.moyasar ? "✓" : "○"} Moyasar secret key (MOYASAR_SECRET_KEY)</li><li>${c.moyasar_webhook ? "✓" : "○"} Moyasar webhook secret (MOYASAR_WEBHOOK_SECRET) → <span class="mono">/hooks/moyasar</span></li>
        <li>${c.email ? "✓" : "○"} Email sender (the Store CRM's SMTP_* settings)</li><li>${c.usage_api ? "✓" : "○"} Usage API token (BILLING_USAGE_TOKEN)</li></ul></section>
    <section class="card card-pad stack"><h2>ZATCA e-invoicing (Fatoora)</h2>
      <p class="subtle s-small">Phase 1: every tax invoice prints the ZATCA QR code (seller, VAT number, time, total, VAT). Phase 2: each invoice also gets a UUID, a counter (ICV, now ${s.icv}) and the previous invoice's hash, and its UBL 2.1 XML is ready. Connecting to ZATCA needs onboarding on the Fatoora portal (a founder task) and invoice signing, which isn't built yet; until then ZATCA stays in Test mode.</p>
      <div class="s-form"><div class="field"><label for="bls-zst">Onboarding status</label><select class="input" id="bls-zst" ${dis}>${BL.meta.zatca_statuses.map((z) => `<option value="${z.id}" ${s.zatca_status === z.id ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select><span class="hint">${esc((BL.meta.zatca_statuses.find((z) => z.id === s.zatca_status) || {}).hint || "")}</span></div>
        <div class="field"><label for="bls-zmode">ZATCA mode</label><select class="input" id="bls-zmode" ${dis}><option value="test" ${s.zatca_mode === "test" ? "selected" : ""}>Test: log only</option><option value="live" ${s.zatca_mode === "live" ? "selected" : ""}>Live (blocked until signing is built)</option></select><span class="hint">Environment: ${esc(c.zatca_env)} · CSID ${c.zatca_csid ? "set" : "not set"}</span></div></div>
      <p class="subtle s-small">Every rule and its source: docs/billing-zatca.md. Verify with your accountant.</p></section>
    ${ed ? `<div><button class="btn btn-primary" type="submit">Save settings</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ dialogs */
function blDialog(title, body, okLabel, onOk, width = 520) {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" style="width:min(${width}px,92vw)"><div style="padding:20px 24px 0"><h2>${esc(title)}</h2></div><div class="card-body stack" style="padding:16px 24px">${body}</div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">${esc(okLabel)}</button></div></form>`;
  d.showModal();
  d.onclose = async () => { if (d.returnValue !== "ok") return; try { await onOk(d); } catch (err) { toast(err.message, true); } };
}
function blNewCustomer() {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  blDialog("New customer", `
    <div class="s-form">
      <div class="field h-span"><label for="bn-store_name">Store name</label><input class="input" id="bn-store_name" required dir="auto"></div>
      <div class="field"><label for="bn-domain">Domain</label><input class="input" id="bn-domain" placeholder="store.sa"></div>
      <div class="field"><label for="bn-platform">Platform</label><select class="input" id="bn-platform">${BL.meta.platforms.map((p) => `<option>${esc(p)}</option>`).join("")}</select></div>
      <div class="field"><label for="bn-owner_name">Owner name</label><input class="input" id="bn-owner_name" dir="auto"></div>
      <div class="field"><label for="bn-owner_email">Billing email</label><input class="input" id="bn-owner_email" type="email"></div>
      <div class="field"><label for="bn-plan">Plan</label><select class="input" id="bn-plan">${BL.meta.plans.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} · $${p.monthly_usd.toLocaleString("en-US")}${p.from ? "+" : ""}/mo</option>`).join("")}</select></div>
      <div class="field"><label for="bn-cycle">Billing</label><select class="input" id="bn-cycle"><option value="monthly">Monthly</option><option value="yearly">Yearly (2 months free)</option></select></div>
      <div class="field"><label for="bn-currency">Currency</label><select class="input" id="bn-currency">${BL.meta.currencies.map((x) => `<option>${x}</option>`).join("")}</select></div>
      <div class="field"><label for="bn-status">Starts as</label><select class="input" id="bn-status"><option value="active">Paying now</option><option value="trial">Free trial</option></select></div>
      <div class="field"><label for="bn-start_date">Start date</label><input class="input" id="bn-start_date" type="date" value="${today}"></div>
      <div class="field"><label for="bn-trial_end">Trial ends</label><input class="input" id="bn-trial_end" type="date"></div>
      <div class="field"><label for="bn-vat_number">Buyer VAT number (B2B)</label><input class="input" id="bn-vat_number" inputmode="numeric" maxlength="15"></div>
    </div>
    <label class="row gap-8 s-small"><input type="checkbox" id="bn-already"> The current period is already paid outside the dashboard (start invoicing from the next renewal)</label>`, "Create customer", async () => {
    const body = Object.fromEntries(["store_name", "domain", "platform", "owner_name", "owner_email", "plan", "cycle", "currency", "status", "start_date", "trial_end", "vat_number"].map((k) => [k, $("#bn-" + k).value]).filter(([, v]) => v !== ""));
    body.already_billed = $("#bn-already").checked;
    const c = await api(`${blP()}/customers`, { method: "POST", body: JSON.stringify(body) });
    toast("Customer created"); BL.tab = "customers"; await renderBilling($("#view")); blOpen(c.id);
  }, 640);
}
async function blInvoiceDialog(id) {
  const c = BL.d.customers.find((x) => x.id === id);
  blDialog(`New invoice · ${c?.store_name || ""}`, `
    <p class="subtle s-small">One-off charges (setup, services, extra work). Prices in ${esc(c?.currency || "SAR")}, before VAT. Saved as a draft unless you tick Issue.</p>
    ${[0, 1, 2].map((n) => `<div class="row gap-8 bl-line" style="flex-wrap:wrap"><select class="input input-sm" id="bi-kind-${n}" style="width:auto" aria-label="Line type">${["setup", "other", "subscription", "overage"].map((k) => `<option>${k}</option>`).join("")}</select><input class="input input-sm" id="bi-desc-${n}" placeholder="Description" dir="auto" style="flex:1;min-width:140px" aria-label="Description"><input class="input input-sm" id="bi-qty-${n}" type="number" min="1" value="1" style="width:64px" aria-label="Quantity"><input class="input input-sm" id="bi-price-${n}" type="number" min="0" step="0.01" placeholder="Price" style="width:110px" aria-label="Unit price"></div>`).join("")}
    <div class="row gap-8" style="flex-wrap:wrap"><input class="input input-sm" id="bi-disc" type="number" min="0" step="0.01" placeholder="Discount" style="width:120px" aria-label="Discount"><input class="input input-sm" id="bi-dreason" placeholder="Discount reason" style="flex:1" aria-label="Discount reason"></div>
    <label class="row gap-8 s-small"><input type="checkbox" id="bi-issue"> Issue now (numbered; can't be edited after)</label>`, "Save invoice", async () => {
    const lines = [0, 1, 2].map((n) => ({ kind: $("#bi-kind-" + n).value, description: $("#bi-desc-" + n).value, qty: Number($("#bi-qty-" + n).value) || 1, unit_price: Number($("#bi-price-" + n).value) })).filter((l) => l.description.trim() && Number.isFinite(l.unit_price));
    const r = await api(`${blP()}/customers/${id}/invoices`, { method: "POST", body: JSON.stringify({ lines, discount: Number($("#bi-disc").value) || 0, discount_reason: $("#bi-dreason").value, issue: $("#bi-issue").checked }) });
    toast(r.number ? `Issued ${r.number}` : "Draft saved"); if (r.warnings?.length) toast(r.warnings.join(" "), true);
    await blReload();
  }, 640);
}

/* ------------------------------------------------ events */
async function blAction(a, id, btn) {
  const P = blP();
  const post = (p, body) => api(P + p, { method: "POST", body: JSON.stringify(body || {}) });
  switch (a) {
    case "close": return blClose();
    case "run": { const r = await post("/run"); toast(`Billing run: ${r.invoices} invoice${r.invoices === 1 ? "" : "s"}, ${r.reminders} reminder${r.reminders === 1 ? "" : "s"}, ${r.activated} trial${r.activated === 1 ? "" : "s"} converted`); return blReload(); }
    case "new-customer": return blNewCustomer();
    case "new-invoice": return blInvoiceDialog(id);
    case "plan-preview": {
      const plan = $("#blPlan").value, custom = $("#blCustom").value;
      const p = await post(`/customers/${id}/plan/preview`, { plan, custom_price_usd: custom ? Number(custom) : null });
      $("#blProration").innerHTML = `<div class="card card-pad stack bl-prorate"><span class="eyebrow">${esc(p.from)} → ${esc(p.to)} · ${esc(p.direction)}</span>
        ${p.direction === "trial" ? "" : `<div class="c-kv s-small"><span>Days left</span><span class="num">${p.remaining_days} of ${p.total_days}</span><span>Credit (unused ${esc(p.from)})</span><span class="num">${blMoney(p.credit, p.currency)}</span><span>Charge (${esc(p.to)})</span><span class="num">${blMoney(p.charge, p.currency)}</span><span>Net</span><span class="num"><b>${blMoney(p.net, p.currency)}</b> + VAT</span></div>`}
        <p class="s-small">${esc(p.explain)}</p>${p.from === p.to && !custom ? `<p class="subtle s-small">Pick a different plan to change it.</p>` : `<div><button class="btn btn-primary btn-sm" data-bl="plan-confirm" data-id="${esc(id)}" data-plan="${esc(plan)}" data-custom="${esc(custom)}">Confirm change</button></div>`}</div>`;
      return;
    }
    case "plan-confirm": {
      const r = await post(`/customers/${id}/plan`, { plan: btn.dataset.plan, custom_price_usd: btn.dataset.custom ? Number(btn.dataset.custom) : null, confirm: true });
      toast(r.invoice ? `Plan changed: proration invoice ${r.invoice.number || "draft"}` : "Plan changed"); return blReload();
    }
    case "pause": case "resume": case "reactivate": await post(`/customers/${id}/${a}`); toast("Saved"); return blReload();
    case "cancel": if (!confirm("Cancel at the end of the current period? Invoices stop after that.")) return; await post(`/customers/${id}/cancel`, { at_period_end: true }); toast("Cancels at period end"); return blReload();
    case "cancel-now": if (!confirm("Cancel now? MRR drops today and no more invoices are issued. Credit any unused time with a credit note.")) return; await post(`/customers/${id}/cancel`, { at_period_end: false }); toast("Cancelled"); return blReload();
    case "delete-customer": { if (!confirm("Remove this customer? Customers with issued invoices are archived, not deleted.")) return; const r = await api(`${P}/customers/${id}`, { method: "DELETE" }); toast(r?.archived ? "Archived (it has invoices)" : "Removed"); blClose(); return blReload(); }
    case "issue": { const r = await post(`/invoices/${id}/issue`); toast(`Issued ${r.number}`); if (r.warnings?.length) toast(r.warnings.join(" "), true); return blReload(); }
    case "del-invoice": if (!confirm("Delete this draft?")) return; await api(`${P}/invoices/${id}`, { method: "DELETE" }); return blReload();
    case "pay": {
      const methods = BL.meta.methods;
      return blDialog("Record payment", `<div class="s-form"><div class="field"><label for="bp-amount">Amount (empty = full amount due)</label><input class="input" id="bp-amount" type="number" min="0" step="0.01"></div>
        <div class="field"><label for="bp-method">Method</label><select class="input" id="bp-method">${methods.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="bp-date">Date received</label><input class="input" id="bp-date" type="date" value="${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)}"></div>
        <div class="field"><label for="bp-ref">Reference</label><input class="input" id="bp-ref" placeholder="Bank transfer ref"></div></div><p class="subtle s-small">The payment is added to Finance → Income automatically.</p>`, "Record payment", async () => {
        const amount = $("#bp-amount").value;
        await post(`/invoices/${id}/payments`, { amount: amount === "" ? undefined : Number(amount), method: $("#bp-method").value, date: $("#bp-date").value, reference: $("#bp-ref").value });
        toast("Payment recorded"); await blReload();
      });
    }
    case "sim-paid": { const r = await post(`/invoices/${id}/simulate-card`, { outcome: "paid" }); toast(r.ok ? "Test card payment: invoice paid" : "Simulation failed", !r.ok); return blReload(); }
    case "void": {
      return blDialog("Void invoice", `<p class="s-small">An issued invoice isn't deleted: a credit note for the amount due is issued and the invoice is marked void. A reason is required and kept on record.</p><div class="field"><label for="bv-reason">Reason</label><input class="input" id="bv-reason" required dir="auto"></div>`, "Void invoice", async () => {
        const r = await post(`/invoices/${id}/void`, { reason: $("#bv-reason").value }); toast(r.credit ? `Void · credit note ${r.credit.number}` : "Void"); await blReload();
      });
    }
    case "credit": {
      return blDialog("Credit note", `<p class="s-small">Credits part or all of the invoice. The amount is before VAT; VAT at the invoice's rate is added. On a paid invoice, Finance shows the refund owed.</p><div class="s-form"><div class="field"><label for="bc-amount">Amount before VAT (empty = all that's left)</label><input class="input" id="bc-amount" type="number" min="0" step="0.01"></div><div class="field"><label for="bc-reason">Reason</label><input class="input" id="bc-reason" required dir="auto"></div></div>`, "Issue credit note", async () => {
        const amt = $("#bc-amount").value;
        const r = await post(`/invoices/${id}/credit`, { amount: amt === "" ? undefined : Number(amt), reason: $("#bc-reason").value }); toast(`Credit note ${r.credit.number} issued`); await blReload();
      });
    }
    case "ai-explain": case "ai-reminder": {
      if (btn) { btn.disabled = true; btn.textContent = "Drafting…"; }
      try { await post(`/invoices/${id}/ai/${a === "ai-explain" ? "explain" : "reminder"}`); toast("Draft ready for your review in Dunning"); BL.tab = "dunning"; return renderBilling($("#view")); }
      finally { if (btn) btn.disabled = false; }
    }
    case "draft-approve": {
      const r = await post(`/drafts/${id}/approve`, { subject: document.querySelector(`[data-bldsubj="${id}"]`).value, text: document.querySelector(`[data-bldtext="${id}"]`).value });
      toast(r.email.status === "sent" ? "Approved and sent" : `Approved · ${r.email.note || "logged"}`); return blRerender();
    }
    case "draft-reject": await post(`/drafts/${id}/reject`); toast("Rejected"); return blRerender();
    case "payout-parse": {
      const r = await post("/payouts/parse", { text: $("#blPoText").value, platform: $("#blPoPlat").value });
      BL.payout = r.rows; BL.poPlat = $("#blPoPlat").value; const keep = $("#blPoText").value; await blPayments(); $("#blPoText").value = keep; return;
    }
    case "payout-apply": {
      const rows = (BL.payout || []).filter((r) => r.match === "invoice");
      if (!rows.length) return toast("No rows match an open invoice", true);
      const r = await post("/payouts/apply", { rows }); BL.payout = null; toast(`Applied ${r.applied} payment${r.applied === 1 ? "" : "s"}${r.fees_sar ? `, SAR ${r.fees_sar} fees to Expenses` : ""}`); return blReload();
    }
  }
}

// "Create customer" from a paying Sales deal or a CRM store in onboarding/active (used on those pages too).
function blCreateButton(kind, id) {
  if (levelFor("billing") !== "edit") return "";
  return `<button class="btn btn-sm" data-bl-from="${kind}:${esc(id)}" title="Billing & customers: start the subscription and invoices">Create customer in Billing</button>`;
}
async function blFrom(spec) {
  const [kind, id] = spec.split(":");
  try {
    const c = await api(`/api/workspaces/${S.ws.id}/billing/customers/from-${kind === "deal" ? "deal" : "crm"}/${encodeURIComponent(id)}`, { method: "POST", body: "{}" });
    toast(`Customer created: ${c.store_name} (${c.plan}, ${c.status})`);
    if (S.route === "billing") { await blReload(); blOpen(c.id); } else { BL.tab = "customers"; go("billing"); setTimeout(() => blOpen(c.id), 400); }
  } catch (e) { toast(e.message, true); }
}

document.addEventListener("click", async (e) => {
  const from = e.target.closest("[data-bl-from]");
  if (from) { e.preventDefault(); from.disabled = true; await blFrom(from.dataset.blFrom); from.disabled = false; return; }
  if (S.route !== "billing") return;
  const t = e.target;
  if (t.closest("#blScrim")) return blClose();
  const tab = t.closest("[data-bltab]");
  if (tab) { BL.tab = tab.dataset.bltab; document.querySelectorAll("[data-bltab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.bltab === BL.tab)); blRerender(); if (tab.dataset.blopen) blOpen(tab.dataset.blopen); return; }
  const inv = t.closest("[data-blinv]");
  if (inv) { BL.invFilter = inv.dataset.blinv; return blInvoices(); }
  const act = t.closest("[data-bl]");
  if (act) { try { await blAction(act.dataset.bl, act.dataset.id, act); } catch (err) { toast(err.message, true); } return; }
  const row = t.closest("[data-blopen]");
  if (row && !t.closest("a,button")) blOpen(row.dataset.blopen);
});
document.addEventListener("keydown", (e) => {
  if (S.route !== "billing") return;
  if (e.key === "Escape" && BL.openId && !$("#dialog").open) blClose();
  if (e.key === "Enter" && e.target.matches?.("tr[data-blopen]")) blOpen(e.target.dataset.blopen);
});
document.addEventListener("input", (e) => {
  if (S.route !== "billing") return;
  if (e.target.id === "blQ") { BL.f.q = e.target.value; clearTimeout(BL.qt); BL.qt = setTimeout(() => { blCustomers(); const q = $("#blQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200); }
});
document.addEventListener("change", (e) => {
  if (S.route !== "billing") return;
  if (e.target.id === "blFs") { BL.f.status = e.target.value; blCustomers(); }
  if (e.target.id === "blFp") { BL.f.plan = e.target.value; blCustomers(); }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "billing") return;
  const f = e.target;
  try {
    if (f.id === "blSet") {
      e.preventDefault();
      const v = (k) => $("#bls-" + k).value;
      await api(`${blP()}/settings`, { method: "PUT", body: JSON.stringify({ legal_name: v("legal_name"), legal_name_ar: v("legal_name_ar"), vat_number: v("vat_number"), cr_number: v("cr_number"),
        address: Object.fromEntries(["street", "building", "district", "city", "postal_code"].map((k) => [k, v("a-" + k)])), bank_details: v("bank"), invoice_prefix: v("invoice_prefix"), credit_prefix: v("credit_prefix"),
        terms_days: Number(v("terms")), mode: v("mode"), dunning_days: v("dun"), pause_after_days: Number(v("pause")), auto_issue: $("#bls-auto").checked, zatca_status: v("zst"), zatca_mode: v("zmode") }) });
      toast("Settings saved"); return blReload();
    }
    if (f.id === "blDetails") {
      e.preventDefault();
      const body = Object.fromEntries(["store_name", "legal_name", "domain", "owner_name", "owner_email", "owner_phone", "vat_number", "app_store_id"].map((k) => [k, $("#bld-" + k).value]));
      body.billing_address = Object.fromEntries(["street", "building", "district", "city", "postal_code"].map((k) => [k, $("#bla-" + k).value]));
      body.cycle = $("#bld-cycle").value;
      await api(`${blP()}/customers/${BL.openId}`, { method: "PUT", body: JSON.stringify(body) });
      toast("Saved"); return blReload();
    }
    if (f.id === "blUsage") { e.preventDefault(); await api(`${blP()}/customers/${BL.openId}/usage`, { method: "POST", body: JSON.stringify({ renders: Number($("#blRenders").value) }) }); toast("Usage saved"); return blReload(); }
    if (f.id === "blNote") { e.preventDefault(); const text = $("#blNoteText").value.trim(); if (!text) return; await api(`${blP()}/customers/${BL.openId}/notes`, { method: "POST", body: JSON.stringify({ text }) }); return blOpen(BL.openId); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "billing" && S.ws) render();
