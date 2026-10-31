/* Finance module: cash, burn, runway, a 12-month cash forecast, budgets, expenses
   (with AI bank-statement import), AI CFO reports and VAT. Uses app.js globals
   (S, $, api, esc, md, toast, fmtDate, ROUTES). AI keeps the books and drafts;
   people approve payments, file VAT and sign. */

const FIN = { meta: null, d: null, tab: "overview", month: "", importItems: null };
const sarFmt = (n) => (n == null ? "–" : "SAR " + Math.round(n).toLocaleString("en-US"));
const sarShort = (n) => { const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : Math.round(a).toLocaleString("en-US")); };
const today = () => new Date().toISOString().slice(0, 10);

ROUTES.finance = { title: "Finance", crumb: "Finance", render: renderFinance };

async function finLoad() {
  if (!FIN.meta) FIN.meta = await api("/api/finance/meta");
  FIN.d = await api(`/api/workspaces/${S.ws.id}/finance`);
}

async function renderFinance(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await finLoad();
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Finance views">
    ${[["overview", "Overview"], ["expenses", "Expenses"], ["reports", "Reports & VAT"]].map(([k, l]) => `<button role="tab" data-ftab="${k}" aria-selected="${FIN.tab === k}">${l}</button>`).join("")}</div>
    <button class="btn btn-primary" data-faction="add-expense">Add expense</button>`;
  view.innerHTML = `<section class="s-kpis" id="fKpis"></section><div id="fBody" style="margin-top:20px"></div>`;
  finRerender();
}

function finRerender() {
  if (S.route !== "finance") return;
  const s = FIN.d.snapshot;
  const r = s.runway_months;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#fKpis").innerHTML = [
    tile("Cash", sarFmt(s.cash.balance_sar), s.cash.as_of ? "as of " + s.cash.as_of : "add your bank balance", s.cash.as_of ? "" : "warn"),
    tile("Monthly costs", sarFmt(s.costs.month_burn_sar), `${sarFmt(s.costs.run_rate_sar)} recurring`),
    tile("Net burn", sarFmt(s.costs.net_burn_sar), "costs minus revenue, per month"),
    tile("Runway", r == null ? (s.costs.month_burn_sar ? "∞" : "–") : `${r} mo`, r == null ? (s.costs.month_burn_sar ? "revenue covers costs" : "log costs to see runway") : s.forecast.cash_zero_month ? `today's burn · with the plan, cash out ${s.forecast.cash_zero_month}` : "at current net burn", r != null && r < 3 ? "bad" : r != null && r < 6 ? "warn" : ""),
    tile("MRR", sarFmt(s.revenue.mrr_sar), `$${s.revenue.mrr_usd.toLocaleString("en-US")} · ${s.revenue.paying} paying stores`),
    tile("Gross margin", s.gross_margin == null ? "–" : s.gross_margin + "%", "after AI, APIs and hosting"),
  ].join("");
  ({ overview: finOverview, expenses: finExpenses, reports: finReports })[FIN.tab]();
}

/* ------------------------------------------------ Overview */
function finOverview() {
  const s = FIN.d.snapshot;
  $("#fBody").innerHTML = `<div class="cc">
    <section class="card card-pad cc-span-8">
      <div class="row between" style="flex-wrap:wrap;gap:12px"><div><span class="eyebrow">12-month cash forecast</span>
        <p class="s-small muted">${s.forecast.cash_zero_month ? `<b style="color:var(--bad)">Cash runs out in ${s.forecast.cash_zero_month}</b> at this plan.` : "Cash stays positive for the next 12 months at this plan."}</p></div>
        <form class="row gap-8 f-assume" id="fAssume">
          <label class="s-small" for="f-growth">MRR growth / month</label><input class="input input-sm" id="f-growth" type="number" step="1" value="${s.settings.mrr_growth_pct}" style="width:70px"><span class="s-small">%</span>
          <label class="s-small row gap-4"><input type="checkbox" id="f-hires" ${s.settings.include_hires ? "checked" : ""}> Include planned hires (${sarShort(s.hires.monthly_sar)}/mo)</label>
          <button class="btn btn-sm" type="submit">Update</button></form></div>
      <svg id="fChart" viewBox="0 0 900 300" role="img" aria-label="Cash forecast" style="width:100%;height:auto;display:block;margin-top:8px"></svg>
      <div class="s-legend"><span><i class="s-dot" style="background:var(--good)"></i>Revenue</span><span><i class="s-dot" style="background:var(--bad)"></i>Costs</span><span><i class="s-dot" style="background:var(--accent)"></i>Cash balance</span></div>
      <p class="subtle s-small">Revenue starts from paying stores in Sales, adds open deals as they usually close (weighted by stage), and grows by the % you set. Costs are recurring expenses${s.settings.include_hires ? " plus planned hires from Team & hiring" : ""}.</p>
    </section>
    <section class="card card-pad cc-span-4 stack">
      <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${s.needs.length ? "warn" : "good"}">${s.needs.length || "All clear"}</span></div>
      ${s.needs.length ? `<ul class="cc-list">${s.needs.map((n) => `<li class="clickable" data-ftab="${n.tab}"><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small">${esc(n.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Nothing needs you in Finance right now.</p>`}
      <form class="stack f-cash" id="fCash" style="border-top:1px solid var(--border);padding-top:12px">
        <span class="eyebrow">Update bank balance</span>
        <div class="row gap-8" style="flex-wrap:wrap"><input class="input input-sm" id="fc-date" type="date" value="${today()}" aria-label="Date"><input class="input input-sm" id="fc-bal" type="number" step="0.01" placeholder="Balance in SAR" aria-label="Balance in SAR" required style="flex:1;min-width:120px"><button class="btn btn-sm btn-primary" type="submit">Save</button></div>
        ${FIN.d.cash.length ? `<span class="subtle s-small">Last: ${sarFmt(s.cash.balance_sar)} on ${s.cash.as_of}</span>` : ""}
      </form>
    </section>
    <section class="card card-pad cc-span-6">
      <div class="row between"><span class="eyebrow">This month by category vs budget</span><button class="btn btn-sm btn-ghost" data-faction="budgets">Edit budgets</button></div>
      <div class="f-cats">${finCategoryBars(s)}</div>
      <form id="fBudgets" class="f-budgets" hidden>${FIN.meta.categories.map((c) => `<label class="field"><span class="s-small">${esc(c.name)}</span><input class="input input-sm" type="number" min="0" step="100" data-budget="${c.id}" value="${s.settings.budgets[c.id] || ""}" placeholder="No budget"></label>`).join("")}<div class="row gap-8" style="grid-column:1/-1"><button class="btn btn-sm btn-primary" type="submit">Save budgets (SAR/month)</button></div></form>
    </section>
    <section class="card card-pad cc-span-6">
      <span class="eyebrow">Unit economics</span>
      <div class="f-unit">
        <div><span class="s-small muted">Revenue per store (ARPA)</span><b class="num">${sarFmt(s.unit.arpa_sar)}</b><span class="subtle s-small">per month</span></div>
        <div><span class="s-small muted">Cost to win a store (CAC)</span><b class="num">${sarFmt(s.unit.cac_sar)}</b><span class="subtle s-small">${s.unit.new_paying_30d} new paying in 30 days</span></div>
        <div><span class="s-small muted">Payback</span><b class="num">${s.unit.payback_months == null ? "–" : s.unit.payback_months + " mo"}</b><span class="subtle s-small">${s.unit.payback_months == null && s.gross_margin != null && s.gross_margin <= 0 ? "can't pay back while gross margin is negative" : "target under 12"}</span></div>
        <div><span class="s-small muted">Planned hires</span><b class="num">${sarFmt(s.hires.monthly_sar)}</b><span class="subtle s-small">${s.hires.list.length} roles, per month</span></div>
      </div>
      <p class="subtle s-small">CAC uses this month's marketing spend divided by stores that became paying in the last 30 days.</p>
    </section>
  </div>`;
  finChart(s);
}

function finCategoryBars(s) {
  const cats = s.costs.by_category.filter((c) => c.month || c.budget);
  if (!cats.length) return `<p class="muted s-small" style="margin-top:12px">No costs logged yet. Add expenses or import your bank statement.</p>`;
  const max = Math.max(...cats.map((c) => Math.max(c.month, c.budget)), 1);
  return cats.map((c) => `<div class="f-cat"><span class="s-small">${esc(c.name)}${c.cogs ? ' <span class="subtle">· COGS</span>' : ""}</span>
    <span class="f-bar"><i style="width:${(c.month / max) * 100}%;background:${c.over ? "var(--bad)" : "var(--accent)"}"></i>${c.budget ? `<b class="f-budget" style="left:${(c.budget / max) * 100}%" title="Budget ${sarFmt(c.budget)}"></b>` : ""}</span>
    <span class="s-small num" style="white-space:nowrap;color:${c.over ? "var(--bad)" : "var(--text-2)"}">${sarShort(c.month)}${c.budget ? " / " + sarShort(c.budget) : ""}</span></div>`).join("");
}

function finChart(s) {
  const m = s.forecast.months, W = 900, H = 300, L = 64, R = 16, T = 16, B = 34;
  const vals = [...m.map((x) => x.balance), ...m.map((x) => x.revenue), ...m.map((x) => x.costs), s.cash.balance_sar, 0];
  let max = Math.max(...vals), min = Math.min(...vals);
  const step = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1e6, 2.5e6, 5e6].find((x) => (max - min) / x <= 6) || 1e7;
  max = Math.ceil(max / step) * step || step; min = Math.floor(min / step) * step;
  const X = (i) => L + (i + 0.5) * ((W - L - R) / m.length), Y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1)), bw = ((W - L - R) / m.length) * 0.32;
  let svg = "";
  for (let v = min; v <= max + 1e-6; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)" ${v === 0 ? 'stroke-width="1.5" stroke="var(--border-strong)"' : ""}></line><text class="s-svg-mono" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${sarShort(v)}</text>`;
  m.forEach((x, i) => {
    svg += `<rect x="${X(i) - bw - 1}" y="${Y(x.revenue)}" width="${bw}" height="${Math.max(0, Y(0) - Y(x.revenue))}" fill="var(--good)" opacity=".75" rx="2"><title>${x.month} revenue ${sarFmt(x.revenue)}</title></rect>
      <rect x="${X(i) + 1}" y="${Y(x.costs)}" width="${bw}" height="${Math.max(0, Y(0) - Y(x.costs))}" fill="var(--bad)" opacity=".6" rx="2"><title>${x.month} costs ${sarFmt(x.costs)}</title></rect>
      <text class="s-svg-text" x="${X(i)}" y="${H - 12}" text-anchor="middle">${new Date(x.month + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</text>`;
  });
  const pts = m.map((x, i) => `${X(i)},${Y(x.balance)}`).join(" ");
  svg += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5"></polyline>`;
  m.forEach((x, i) => { svg += `<circle cx="${X(i)}" cy="${Y(x.balance)}" r="${i === m.length - 1 ? 4 : 2.5}" fill="${x.balance < 0 ? "var(--bad)" : "var(--accent)"}"><title>${x.month} cash ${sarFmt(x.balance)}</title></circle>`; });
  const last = m.at(-1);
  svg += `<text class="s-svg-strong" x="${X(m.length - 1)}" y="${Y(last.balance) - 10}" text-anchor="end">${sarShort(last.balance)}</text>`;
  $("#fChart").innerHTML = svg;
}

/* ------------------------------------------------ Expenses */
function finExpenses() {
  const all = FIN.d.expenses, cats = FIN.meta.categories;
  const months = [...new Set(all.map((e) => e.date.slice(0, 7)))];
  const list = FIN.month ? all.filter((e) => e.date.startsWith(FIN.month) || e.recurring !== "one-off") : all;
  const catName = (id) => cats.find((c) => c.id === id)?.name || id;
  $("#fBody").innerHTML = `
    <form class="card s-add" id="fAdd" hidden>
      <div class="field"><label for="fe-date">Date</label><input class="input" id="fe-date" type="date" value="${today()}" required></div>
      <div class="field"><label for="fe-vendor">Vendor</label><input class="input" id="fe-vendor" required placeholder="Anthropic, Hostinger, Snap…"></div>
      <div class="field"><label for="fe-amt">Amount (SAR, incl. VAT)</label><input class="input" id="fe-amt" type="number" step="0.01" min="0" required></div>
      <div class="field"><label for="fe-vat">VAT included (SAR)</label><input class="input" id="fe-vat" type="number" step="0.01" min="0" value="0"></div>
      <div class="field"><label for="fe-cat">Category</label><select class="input" id="fe-cat">${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="fe-rec">Repeats</label><select class="input" id="fe-rec"><option value="one-off">One-off</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
      <div class="field h-span"><label for="fe-note">Note</label><input class="input" id="fe-note"></div>
      <div class="row gap-8 h-span"><button class="btn btn-primary" type="submit">Save expense</button><button class="btn" type="button" data-faction="add-expense">Cancel</button></div>
    </form>
    <section class="card card-pad stack" style="margin-bottom:16px">
      <div class="row between" style="flex-wrap:wrap;gap:8px"><div><h2>AI bookkeeper</h2><p class="subtle s-small">Paste bank or card statement lines. AI pulls out the expenses, categories and VAT. You check the list before anything is saved.</p></div></div>
      <textarea class="input mono" id="fImportText" rows="4" placeholder="2026-10-03  ANTHROPIC*API  USD 120.00&#10;2026-10-05  HOSTINGER  SAR 89.00&#10;2026-10-09  SNAP INC ADS  SAR 1,500.00"></textarea>
      <div class="row gap-8"><button class="btn" data-faction="ai-import">AI: read these lines</button><span class="subtle s-small" id="fImportMsg"></span></div>
      <div id="fImportPreview"></div>
    </section>
    <section class="card">
      <div class="card-head" style="padding:16px 20px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><h2>Expenses</h2>
        <div class="row gap-8" style="flex-wrap:wrap"><button class="chip ${FIN.month ? "" : "active"}" data-fmonth="">All</button>${months.slice(0, 6).map((m) => `<button class="chip ${FIN.month === m ? "active" : ""}" data-fmonth="${m}">${m}</button>`).join("")}</div></div>
      ${list.length ? `<div class="table-wrap"><table class="f-table"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Repeats</th><th class="num">VAT</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${list.map((e) => `<tr><td class="num">${e.date}</td><td>${esc(e.vendor)}${e.source === "ai_import" ? ' <span class="s-owner ai">AI</span>' : ""}${e.note ? `<div class="subtle s-small">${esc(e.note)}</div>` : ""}</td>
          <td><select class="input input-sm" data-fcat="${e.id}" aria-label="Category">${cats.map((c) => `<option value="${c.id}" ${c.id === e.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></td>
          <td>${e.recurring === "one-off" ? '<span class="subtle">One-off</span>' : `<span class="badge accent">${e.recurring === "monthly" ? "Monthly" : "Yearly"}</span>`}</td>
          <td class="num">${e.vat_sar ? sarShort(e.vat_sar) : "–"}</td><td class="num"><b>${sarFmt(e.amount_sar)}</b></td>
          <td><button class="btn btn-sm btn-ghost btn-danger" data-fdel="${e.id}" aria-label="Delete ${esc(e.vendor)}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>No expenses yet</h2><p>Add your recurring costs first (tools, hosting, AI, salaries) so burn and runway are right. Then import statement lines each month.</p><button class="btn btn-primary" data-faction="add-expense">Add expense</button></div>`}
    </section>`;
}

function finImportPreview() {
  const items = FIN.importItems, cats = FIN.meta.categories;
  $("#fImportPreview").innerHTML = `<div class="table-wrap" style="margin-top:8px"><table class="f-table"><thead><tr><th><input type="checkbox" id="fi-all" checked aria-label="Select all"></th><th>Date</th><th>Vendor</th><th>Category</th><th>Repeats</th><th class="num">VAT</th><th class="num">SAR</th><th>AI note</th></tr></thead><tbody>
    ${items.map((it, i) => `<tr><td><input type="checkbox" data-fi="${i}" checked aria-label="Include ${esc(it.vendor)}"></td><td class="num">${it.date}</td><td>${esc(it.vendor)}</td>
      <td><select class="input input-sm" data-ficat="${i}">${cats.map((c) => `<option value="${c.id}" ${c.id === it.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></td>
      <td><select class="input input-sm" data-firec="${i}">${["one-off", "monthly", "yearly"].map((r) => `<option ${r === it.recurring ? "selected" : ""}>${r}</option>`).join("")}</select></td>
      <td class="num">${it.vat_sar || "–"}</td><td class="num"><b>${it.amount_sar.toLocaleString("en-US")}</b></td><td class="subtle s-small">${esc(it.note)}</td></tr>`).join("")}
  </tbody></table></div><div class="row gap-8" style="margin-top:10px"><button class="btn btn-primary" data-faction="save-import">Save selected</button><button class="btn" data-faction="cancel-import">Discard</button></div>`;
}

/* ------------------------------------------------ Reports & VAT */
function finReports() {
  const s = FIN.d.snapshot, v = s.vat;
  $("#fBody").innerHTML = `<div class="cc">
    <section class="card card-pad cc-span-8 stack">
      <div class="row between" style="flex-wrap:wrap;gap:8px"><div><h2>AI CFO</h2><p class="subtle s-small">Drafts from your real numbers only. You decide; a licensed accountant confirms tax points.</p></div>
        <div class="row gap-8" style="flex-wrap:wrap">${Object.entries(FIN.meta.tasks).map(([k, t]) => `<button class="btn btn-sm" data-fai="${k}">${esc(t)}</button>`).join("")}</div></div>
      <div id="fDraft" class="s-draft" hidden></div>
      ${FIN.d.reports.length ? `<ul class="s-timeline">${FIN.d.reports.map((r) => `<li><span class="s-owner ai">AI</span><button class="s-link" data-freport="${r.id}">${esc(r.title)}</button><span class="subtle s-small num" style="margin-left:auto">${fmtDate(r.created_at)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">No reports yet. Start with the monthly finance report.</p>`}
    </section>
    <section class="card card-pad cc-span-4 stack">
      <div class="row between"><h2>VAT (ZATCA)</h2><span class="badge ${v.registered ? "accent" : ""}">${v.registered ? "Registered" : "Not registered"}</span></div>
      <label class="row gap-8 s-small"><input type="checkbox" id="f-vatreg" ${v.registered ? "checked" : ""}> We are VAT-registered</label>
      <div class="f-vat">
        <span class="muted s-small">${v.quarter} input VAT (on expenses)</span><b class="num">${sarFmt(v.input_vat_sar)}</b>
        <span class="muted s-small">Output VAT (15% on revenue)</span><b class="num">${v.registered ? sarFmt(v.output_vat_sar) : "–"}</b>
        <span class="muted s-small">Net ${v.net_sar >= 0 ? "to pay" : "to reclaim"}</span><b class="num">${v.registered ? sarFmt(Math.abs(v.net_sar)) : "–"}</b>
        ${v.registered ? `<span class="muted s-small">Return due (estimate)</span><b class="num">${v.due}</b>` : ""}
      </div>
      <div class="notice s-small" style="display:block">${v.registered ? "Filing the return and paying is done by a person in the ZATCA portal." : `Registration is mandatory above SAR ${v.mandatory_sar.toLocaleString("en-US")} of taxable supplies in 12 months, and optional above SAR ${v.voluntary_sar.toLocaleString("en-US")}. Your current run-rate is ${sarFmt(v.annual_revenue_sar)}/year.`} Confirm with a licensed accountant.</div>
      <p class="subtle s-small">Estimate only: output VAT assumes all revenue is taxable at 15% and invoiced in SAR.</p>
    </section>
  </div>`;
}

async function finRunAi(task) {
  const box = $("#fDraft"); box.hidden = false; box.innerHTML = `<p class="subtle s-small">AI CFO is writing…</p>`;
  document.querySelectorAll("[data-fai]").forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/workspaces/${S.ws.id}/finance/ai/${task}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let text = "", last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (Date.now() - last > 150) { last = Date.now(); box.innerHTML = `<div class="doc s-draft-body">${md(text.split("\n\n[[MWIZ_")[0])}</div>`; } }
    const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
    const body = text.split("\n\n[[MWIZ_")[0];
    await finLoad(); finRerender();
    finShowReport(body);
  } catch (e) { box.innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message)}</div>`; }
  finally { document.querySelectorAll("[data-fai]").forEach((b) => (b.disabled = false)); }
}
function finShowReport(text) {
  const box = $("#fDraft"); if (!box) return; box.hidden = false; box._text = text;
  box.innerHTML = `<div class="doc s-draft-body">${md(text)}</div><div class="row gap-8"><button class="btn btn-sm" data-faction="copy-report">Copy</button><span class="subtle s-small">Draft for you to review. Nothing is sent or filed.</span></div>`;
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    const tab = t.closest("[data-ftab]");
    if (tab) { FIN.tab = tab.dataset.ftab; document.querySelectorAll("[data-ftab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ftab === FIN.tab)); finRerender(); return; }
    const mf = t.closest("[data-fmonth]"); if (mf) { FIN.month = mf.dataset.fmonth; finExpenses(); return; }
    const del = t.closest("[data-fdel]");
    if (del) { if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Sure?"; return; } await api(`/api/workspaces/${S.ws.id}/finance/expenses/${del.dataset.fdel}`, { method: "DELETE" }); await finLoad(); finRerender(); return toast("Expense deleted"); }
    const ai = t.closest("[data-fai]"); if (ai) return finRunAi(ai.dataset.fai);
    const rep = t.closest("[data-freport]"); if (rep) { const r = await api(`/api/workspaces/${S.ws.id}/finance/reports/${rep.dataset.freport}`); finShowReport(r.text); $("#fDraft").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (t.id === "fi-all") { document.querySelectorAll("[data-fi]").forEach((c) => (c.checked = t.checked)); return; }
    const a = t.closest("[data-faction]"); if (!a) return;
    const act = a.dataset.faction;
    if (act === "add-expense") { if (FIN.tab !== "expenses") { FIN.tab = "expenses"; document.querySelectorAll("[data-ftab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ftab === "expenses")); finRerender(); } const f = $("#fAdd"); f.hidden = !f.hidden; if (!f.hidden) $("#fe-vendor").focus(); return; }
    if (act === "budgets") { const f = $("#fBudgets"); f.hidden = !f.hidden; return; }
    if (act === "ai-import") {
      const text = $("#fImportText").value.trim(); if (!text) return toast("Paste some statement lines first", true);
      a.disabled = true; $("#fImportMsg").textContent = "AI is reading the lines…";
      try { const r = await api(`/api/workspaces/${S.ws.id}/finance/expenses/ai-import`, { method: "POST", body: JSON.stringify({ text }) }); FIN.importItems = r.items; $("#fImportMsg").textContent = `${r.items.length} expense${r.items.length === 1 ? "" : "s"} found. Check them, then save.`; finImportPreview(); }
      catch (err) { $("#fImportMsg").textContent = ""; toast(err.message, true); }
      finally { a.disabled = false; }
      return;
    }
    if (act === "save-import") {
      const items = FIN.importItems.map((it, i) => ({ ...it, category: $(`[data-ficat="${i}"]`).value, recurring: $(`[data-firec="${i}"]`).value })).filter((_, i) => $(`[data-fi="${i}"]`).checked);
      const r = await api(`/api/workspaces/${S.ws.id}/finance/expenses/bulk`, { method: "POST", body: JSON.stringify({ items }) });
      FIN.importItems = null; await finLoad(); finRerender(); return toast(`Saved ${r.saved} expenses`);
    }
    if (act === "cancel-import") { FIN.importItems = null; $("#fImportPreview").innerHTML = ""; $("#fImportMsg").textContent = ""; return; }
    if (act === "copy-report") { try { await navigator.clipboard.writeText($("#fDraft")._text || ""); toast("Copied"); } catch { toast("Clipboard blocked by the browser", true); } return; }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("change", async (e) => {
  try {
    const c = e.target.closest?.("[data-fcat]");
    if (c) { await api(`/api/workspaces/${S.ws.id}/finance/expenses/${c.dataset.fcat}`, { method: "PUT", body: JSON.stringify({ category: c.value }) }); await finLoad(); finRerender(); return toast("Category updated"); }
    if (e.target.id === "f-vatreg") { await api(`/api/workspaces/${S.ws.id}/finance/settings`, { method: "PUT", body: JSON.stringify({ vat_registered: e.target.checked }) }); await finLoad(); finRerender(); return; }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("submit", async (e) => {
  const id = e.target.id;
  if (!["fAdd", "fCash", "fAssume", "fBudgets"].includes(id)) return;
  e.preventDefault();
  const base = `/api/workspaces/${S.ws.id}/finance`;
  try {
    if (id === "fAdd") await api(`${base}/expenses`, { method: "POST", body: JSON.stringify({ date: $("#fe-date").value, vendor: $("#fe-vendor").value, amount_sar: $("#fe-amt").value, vat_sar: $("#fe-vat").value || 0, category: $("#fe-cat").value, recurring: $("#fe-rec").value, note: $("#fe-note").value }) });
    if (id === "fCash") await api(`${base}/cash`, { method: "POST", body: JSON.stringify({ date: $("#fc-date").value, balance_sar: $("#fc-bal").value }) });
    if (id === "fAssume") await api(`${base}/settings`, { method: "PUT", body: JSON.stringify({ mrr_growth_pct: $("#f-growth").value, include_hires: $("#f-hires").checked }) });
    if (id === "fBudgets") await api(`${base}/settings`, { method: "PUT", body: JSON.stringify({ budgets: Object.fromEntries([...document.querySelectorAll("[data-budget]")].map((i) => [i.dataset.budget, i.value || 0])) }) });
    await finLoad(); finRerender();
    toast({ fAdd: "Expense saved", fCash: "Bank balance saved", fAssume: "Forecast updated", fBudgets: "Budgets saved" }[id]);
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

if (S.route === "finance" && S.ws) render();
