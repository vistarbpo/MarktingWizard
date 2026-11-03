/* Paid Ads: DPA AD's own campaigns on Meta, Snapchat, TikTok (Google optional), to win store owners at a
   known cost per lead, trial and paying store. Tabs: Overview, Campaigns (plans + live), Budgets & rules,
   Creatives, Accounts (and CSV import), UTM builder. Test mode by default; campaigns are created PAUSED and
   only an approver activates them. Uses app.js globals (S, $, api, esc, toast, fmtDate, fmtNum, ROUTES, levelFor). */

const PA = { tab: "overview", ov: null, camp: null, rules: null, cr: null, acc: null, links: null, att: null, parsed: null, open: null, level: "campaign", days: 30, busy: false };
const PA_TABS = [["overview", "Overview"], ["campaigns", "Campaigns"], ["budgets", "Budgets & rules"], ["creatives", "Creatives"], ["accounts", "Accounts"], ["utm", "UTM builder"]];
const PA_COLOR = { Meta: "#4f7cff", Snapchat: "#d4b400", TikTok: "#ff3b6b", Google: "#34a853" };
const PA_PACE = { over: ["Over pace", "bad"], under: ["Under pace", "warn"], on_track: ["On track", "good"], no_budget: ["No budget", ""] };
const PA_PLAN = { draft: ["Waiting for approval", "warn"], approved: ["Approved", "accent"], rejected: ["Rejected", ""], created: ["Created · paused", "good"], active: ["Active", "good"] };
const PA_ACT = { logged: ["Test: would do", "warn"], open: ["Needs a person", "bad"], done: ["Done", "good"], failed: ["Failed", "bad"], dismissed: ["Dismissed", ""], pending: ["Applying", "accent"] };
const paP = () => `/api/workspaces/${S.ws.id}/ads`;
const paEdit = () => levelFor("ads") === "edit";
const paSar = (v) => (v == null ? "–" : "SAR " + Math.round(Number(v)).toLocaleString("en-US"));
const paSar2 = (v) => (v == null ? "–" : "SAR " + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const paPctv = (v, d = 2) => (v == null ? "–" : (v * 100).toFixed(d) + "%");
const paInt = (v) => (v == null ? "–" : Math.round(v).toLocaleString("en-US"));
const paBadge = (map, k) => { const [l, t] = map[k] || [k, ""]; return `<span class="badge ${t}">${esc(l)}</span>`; };
const paMode = (m) => `<span class="badge ${m === "live" ? "good" : "warn"}">${m === "live" ? "LIVE" : "TEST MODE"}</span>`;
const paResName = (r) => ({ signups: "signup", leads: "lead", purchases: "purchase" })[r] || "result";

ROUTES.ads = { title: "Paid Ads", crumb: "Grow", render: renderAds };

async function renderAds(view) {
  if (S.param && PA_TABS.some(([k]) => k === S.param)) PA.tab = S.param;
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs pa-tabs" role="tablist" aria-label="Paid Ads views">${PA_TABS.map(([k, l]) => `<button role="tab" data-patab="${k}" aria-selected="${PA.tab === k}">${l}</button>`).join("")}</div><div id="paBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  await paShow();
}
async function paShow() {
  if (S.route !== "ads") return;
  document.querySelectorAll("[data-patab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.patab === PA.tab));
  const box = $("#paBody"); if (!box) return;
  try {
    if (PA.tab === "overview") { PA.ov = await api(paP()); box.innerHTML = paOverview(); }
    if (PA.tab === "campaigns") { PA.camp = await api(`${paP()}/campaigns?level=${PA.level}&days=${PA.days}`); box.innerHTML = paCampaigns(); }
    if (PA.tab === "budgets") { PA.rules = await api(`${paP()}/rules`); box.innerHTML = paBudgets(); }
    if (PA.tab === "creatives") { PA.cr = await api(`${paP()}/creatives`); box.innerHTML = paCreatives(); }
    if (PA.tab === "accounts") { [PA.acc, PA.ov] = await Promise.all([api(`${paP()}/accounts`), api(paP())]); box.innerHTML = paAccounts(); }
    if (PA.tab === "utm") { [PA.links, PA.att, PA.ov] = await Promise.all([api(`${paP()}/links`), api(`${paP()}/attribution`), PA.ov ? Promise.resolve(PA.ov) : api(paP())]); box.innerHTML = paUtm(); }
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}

/* ------------------------------------------------ Overview */
function paOverview() {
  const d = PA.ov, t = d.total_month, rn = paResName(d.settings.result), a = d.attribution.total;
  const banner = `<div class="card card-pad pa-banner ${d.mode}"><div class="row gap-8" style="flex-wrap:wrap">${paMode(d.mode)}<b>${d.mode === "live" ? "Live: insights are pulled every 6 hours and guardrails can act." : "Test mode: nothing changes on any ad platform. Guardrails log what they would do."}</b></div>
    ${d.waiting.plans || d.waiting.actions ? `<div class="row gap-8" style="flex-wrap:wrap;margin-top:8px">${d.waiting.plans ? `<button class="btn btn-sm" data-patab="campaigns">${d.waiting.plans} plan${d.waiting.plans === 1 ? "" : "s"} waiting for approval</button>` : ""}${d.waiting.actions ? `<button class="btn btn-sm" data-patab="budgets">${d.waiting.actions} guardrail action${d.waiting.actions === 1 ? "" : "s"} need a person</button>` : ""}</div>` : ""}
    ${d.fx_missing.length ? `<p class="s-small" style="margin:8px 0 0;color:var(--bad)">Type the SAR rate for ${d.fx_missing.map(esc).join(", ")} in Budgets & rules: those rows aren't counted yet.</p>` : ""}</div>`;
  if (!d.has_data) return banner + `<div class="card empty" style="margin-top:16px"><h2>No ad results yet</h2><p>Connect Meta, Snapchat or TikTok in Accounts, or import a CSV exported from each Ads Manager while API access is waiting for approval. Then spend, cost per ${rn} and pacing show here.</p>
    <div class="row gap-8" style="justify-content:center;flex-wrap:wrap"><button class="btn btn-primary" data-patab="accounts">Accounts & CSV import</button><button class="btn" data-patab="campaigns">Plan a campaign</button></div></div>`;
  const tiles = [["Spend this month", paSar(t.spend_sar), d.pacing.total.budget ? `of ${paSar(d.pacing.total.budget)} · heading for ${paSar(d.pacing.total.projected)}` : "no budget set", d.pacing.total.status === "over" ? "bad" : ""],
    [`Cost per ${rn}`, paSar2(t.cpa), `${paInt(t.results)} ${rn}s on the platforms`], ["CTR", paPctv(t.ctr), `${paInt(t.clicks)} clicks · CPC ${paSar2(t.cpc)} · CPM ${paSar2(t.cpm)}`],
    ["Cost per lead", paSar2(a.cost_per_lead), `${a.leads} lead${a.leads === 1 ? "" : "s"} with a UTM (CRM + Sales)`], ["Cost per trial", paSar2(a.cost_per_trial), `${a.trials} trial${a.trials === 1 ? "" : "s"}`], ["Cost per paying store", paSar2(a.cost_per_paying), `${a.paying} paying`]];
  return banner + `<section class="s-kpis" style="margin-top:16px">${tiles.map(([l, v, sub, tone = ""]) => `<div class="card s-kpi ${tone}"><span class="eyebrow">${l}</span><b class="num">${v}</b><span class="subtle">${sub}</span></div>`).join("")}</section>
    <div class="cc" style="margin-top:16px">
      <section class="card card-pad cc-span-6"><div class="row between"><span class="eyebrow">Spend vs budget · ${esc(d.month)}</span><button class="btn btn-sm btn-ghost" data-patab="budgets">Budgets</button></div>${paPaceBars(d.pacing)}</section>
      <section class="card card-pad cc-span-6"><span class="eyebrow">Funnel by channel · this month</span>${paFunnel(d.attribution.channels, rn)}</section>
      <section class="card card-pad cc-span-12"><div class="row between" style="flex-wrap:wrap;gap:8px"><span class="eyebrow">Daily spend and ${rn}s · last 30 days</span><div class="s-legend" style="margin:0">${Object.entries(PA_COLOR).map(([k, c]) => `<span><i class="s-dot" style="background:${c}"></i>${k}</span>`).join("")}<span><i class="s-dot" style="background:var(--text)"></i>${rn}s</span></div></div>${paTrend(d.trend)}</section>
      <section class="card cc-span-6"><div class="card-head" style="padding:14px 20px"><h3>Top ads</h3><span class="subtle s-small">lowest cost per ${rn}, 30 days</span></div>${paAdTable(d.top)}</section>
      <section class="card cc-span-6"><div class="card-head" style="padding:14px 20px"><h3>Bottom ads</h3><button class="btn btn-sm btn-ghost" data-patab="creatives">Creatives</button></div>${paAdTable(d.bottom)}</section>
    </div>`;
}
function paPaceBars(p) {
  const rows = [...p.channels.filter((c) => c.budget || c.spent), p.total];
  return `<div class="stack" style="gap:12px;margin-top:12px">${rows.map((c) => {
    const max = Math.max(c.budget || 0, c.projected || 0, c.spent || 0, 1);
    return `<div class="pa-pace"><div class="row between gap-8"><b>${esc(c.channel)}</b>${paBadge(PA_PACE, c.status)}</div>
      <div class="pa-bar" role="img" aria-label="${esc(c.channel)}: spent ${paSar(c.spent)} of ${paSar(c.budget)}"><i style="width:${(c.spent / max) * 100}%;background:${PA_COLOR[c.channel] || "var(--accent)"}"></i>${c.budget ? `<em style="left:${(c.budget / max) * 100}%" title="Budget"></em>` : ""}<u style="left:${Math.min(100, (c.projected / max) * 100)}%" title="Projected"></u></div>
      <span class="subtle s-small num">${paSar(c.spent)} spent${c.budget ? ` of ${paSar(c.budget)} · expected by now ${paSar(c.expected)} · projected ${paSar(c.projected)}${c.daily_target != null ? ` · ${paSar(c.daily_target)}/day to land on budget` : ""}` : ` · projected ${paSar(c.projected)}`}</span></div>`;
  }).join("")}</div><p class="subtle s-small" style="margin-top:10px">Bar: spent. Line: budget. Dot: projected month-end at the current daily rate. "Under" is only called after 3 days.</p>`;
}
function paFunnel(chs, rn) {
  const rows = chs.filter((c) => c.spend_sar || c.leads);
  if (!rows.length) return `<p class="muted s-small" style="margin-top:12px">No leads with a UTM yet. Use the UTM builder on every ad link and post signups to the lead hook (Accounts).</p>`;
  return `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Channel</th><th class="num">Spend</th><th class="num">Leads</th><th class="num">Trials</th><th class="num">Paying</th><th class="num">Per lead</th><th class="num">Per trial</th><th class="num">Per paying</th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td><i class="s-dot" style="background:${PA_COLOR[c.channel]}"></i> ${esc(c.channel)}</td><td class="num">${paSar(c.spend_sar)}</td><td class="num">${c.leads}</td><td class="num">${c.trials}</td><td class="num">${c.paying}</td><td class="num">${paSar2(c.cost_per_lead)}</td><td class="num">${paSar2(c.cost_per_trial)}</td><td class="num">${paSar2(c.cost_per_paying)}</td></tr>`).join("")}</tbody></table></div>
    <p class="subtle s-small">Leads: CRM stores and Sales deals with a UTM from this channel. Trial: deal at Trial/Paying or store Onboarding/Active. The platforms also count ${rn}s themselves (Overview tiles).</p>`;
}
function paTrend(series) {
  const W = 900, H = 200, L = 52, R = 30, T = 12, B = 26, n = series.length;
  const maxS = Math.max(...series.map((d) => d.spend_sar), 1), maxR = Math.max(...series.map((d) => d.results), 1);
  const bw = (W - L - R) / n, X = (i) => L + i * bw, Y = (v) => T + (H - T - B) * (1 - v / maxS), YR = (v) => T + (H - T - B) * (1 - v / maxR);
  let svg = "";
  for (let k = 0; k <= 4; k++) { const v = (maxS / 4) * k; svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"></line><text class="s-svg-mono" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? Math.round(v / 100) / 10 + "k" : Math.round(v)}</text>`; }
  series.forEach((d, i) => {
    let y0 = Y(0);
    for (const [ch, c] of Object.entries(PA_COLOR)) { const v = d.by[ch] || 0; if (!v) continue; const h = (H - T - B) * (v / maxS); svg += `<rect x="${X(i) + 1}" y="${y0 - h}" width="${Math.max(1, bw - 2)}" height="${h}" fill="${c}"><title>${d.date} ${ch} SAR ${v}</title></rect>`; y0 -= h; }
    if (i % 5 === 0) svg += `<text class="s-svg-mono" x="${X(i) + bw / 2}" y="${H - 8}" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  const pts = series.map((d, i) => `${X(i) + bw / 2},${YR(d.results)}`).join(" ");
  svg += `<polyline points="${pts}" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="3 3"></polyline><text class="s-svg-mono" x="${W - R + 4}" y="${YR(maxR) + 4}">${maxR}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:8px" role="img" aria-label="Daily ad spend by channel and results, last 30 days">${svg}</svg>`;
}
function paAdTable(list) {
  if (!list?.length) return `<p class="muted s-small" style="padding:0 20px 16px">Not enough ads yet.</p>`;
  return `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Ad</th><th class="num">Spend</th><th class="num">CTR</th><th class="num">Per result</th></tr></thead><tbody>
    ${list.map((a) => `<tr><td><span class="pa-name" dir="auto" title="${esc(a.ad_name)}">${esc(a.item_title || a.ad_name)}</span><span class="subtle s-small">${esc(a.channel)}${a.fatigued ? ` · <span class="badge warn">fatigue</span>` : ""}</span></td><td class="num">${paSar(a.spend_sar)}</td><td class="num">${paPctv(a.ctr)}</td><td class="num">${a.cpa == null ? "none yet" : paSar2(a.cpa)}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ------------------------------------------------ Campaigns: plans (AI Media buyer) and live performance */
function paCampaigns() {
  const d = PA.camp, edit = paEdit(), today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const eom = (() => { const x = new Date(today + "T00:00:00Z"); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); })();
  const form = edit ? `<section class="card card-pad stack"><div><h2>Plan a campaign with the AI Media buyer</h2><p class="subtle s-small">Describe the goal; the AI drafts objective, audiences, placements, budget split, Saudi schedule (Ramadan aware), the approved Creative Studio content to use, Arabic copy and UTMs. A person approves; it's created <b>paused</b>; an approver turns it on.${d.agents.buyer === 0 ? " <b>The AI Media buyer is switched off in AI Workforce.</b>" : ""}</p></div>
      <div class="field"><label for="pa-goal">Goal</label><input class="input" id="pa-goal" dir="auto" placeholder="20 trials from Riyadh fashion stores this month, SAR 8,000"></div>
      <div class="pa-form">
        <div class="field"><label for="pa-budget">Budget (SAR)</label><input class="input" id="pa-budget" type="number" min="1" step="1" inputmode="numeric"></div>
        <div class="field"><label for="pa-start">From</label><input class="input" id="pa-start" type="date" value="${today}"></div>
        <div class="field"><label for="pa-end">To</label><input class="input" id="pa-end" type="date" value="${eom}"></div>
        <fieldset class="field pa-chans"><legend>Channels</legend><div class="row gap-8" style="flex-wrap:wrap">${Object.keys(PA_COLOR).map((c) => `<label class="chip"><input type="checkbox" data-pach="${c}" ${c === "Meta" ? "checked" : ""}> ${c}</label>`).join("")}</div></fieldset>
      </div>
      <div class="row gap-8"><button class="btn btn-primary" data-pa="plan" ${PA.busy ? "disabled" : ""}>${PA.busy ? "Drafting…" : "Draft the plan"}</button><span class="subtle s-small">Budget splits are percentages of your budget; the AI never invents results.</span></div></section>` : "";
  const plans = d.plans.length ? d.plans.map(paPlanCard).join("") : `<div class="card empty"><p>No campaign plans yet.</p></div>`;
  const perf = `<section class="card" style="margin-top:16px"><div class="card-head" style="padding:14px 20px;flex-wrap:wrap;gap:8px"><h2>Performance</h2>
      <div class="row gap-8" style="flex-wrap:wrap"><select class="input input-sm" style="width:auto" data-paset="level" aria-label="Level">${[["campaign", "Campaigns"], ["adset", "Ad sets"], ["ad", "Ads"]].map(([k, l]) => `<option value="${k}" ${PA.level === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="input input-sm" style="width:auto" data-paset="days" aria-label="Period">${[7, 30, 90].map((n) => `<option value="${n}" ${PA.days === n ? "selected" : ""}>Last ${n} days</option>`).join("")}</select></div></div>
    ${d.rows.length ? `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>${PA.level === "ad" ? "Ad" : PA.level === "adset" ? "Ad set" : "Campaign"}</th><th class="num">Spend</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">CPM</th><th class="num">${paResName(d.result)}s</th><th class="num">Per ${paResName(d.result)}</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td><span class="pa-name" dir="auto">${esc(PA.level === "ad" ? r.ad_name || r.ad_id : PA.level === "adset" ? r.adset_name || r.adset_id || r.campaign_name : r.campaign_name)}</span><span class="subtle s-small">${esc(r.channel)}${PA.level !== "campaign" ? " · " + esc(r.campaign_name) : ""} · ${r.source === "api" ? "API" : "CSV"}</span></td>
        <td class="num">${paSar(r.spend_sar)}</td><td class="num">${paInt(r.impressions)}</td><td class="num">${paInt(r.clicks)}</td><td class="num">${paPctv(r.ctr)}</td><td class="num">${paSar2(r.cpc)}</td><td class="num">${paSar2(r.cpm)}</td><td class="num">${paInt(r.results)}</td><td class="num">${paSar2(r.cpa)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small" style="padding:0 20px 16px">No results in this period. Connect an ad account or import a CSV in Accounts.</p>`}</section>`;
  return `<div class="stack">${form}<h2 class="section-title" style="margin:8px 0 0">Plans</h2>${plans}</div>${perf}`;
}
function paPlanCard(p) {
  const open = PA.open === p.id, d = PA.camp, appr = d.can_approve, draft = p.status === "draft", edit = paEdit() && draft;
  const inp = (v, attr, w = "") => edit ? `<input class="input input-sm" dir="auto" value="${esc(v)}" ${attr} ${w}>` : `<span dir="auto">${esc(v || "–")}</span>`;
  const head = `<div class="row between gap-8" style="flex-wrap:wrap"><button class="linklike pa-plan-title" data-paopen="${p.id}" aria-expanded="${open}"><b dir="auto">${esc(p.name)}</b></button>${paBadge(PA_PLAN, p.status)}</div>
    <span class="subtle s-small" dir="auto">${esc(p.inputs.goal)} · ${paSar(p.inputs.budget_sar)} · ${esc(p.inputs.start_date)} → ${esc(p.inputs.end_date)} · ${p.campaigns.map((c) => esc(c.channel)).join(", ")}${p.by_ai ? " · drafted by AI" : ""}</span>
    ${p.note ? `<span class="badge warn" style="white-space:normal;height:auto">${esc(p.note)}</span>` : ""}`;
  if (!open) return `<div class="card card-pad stack pa-plan">${head}</div>`;
  const camps = p.campaigns.map((c, ci) => `<div class="pa-camp" data-pacamp="${ci}"><div class="row between gap-8" style="flex-wrap:wrap"><h3><i class="s-dot" style="background:${PA_COLOR[c.channel]}"></i> ${esc(c.channel)}: ${edit ? "" : esc(c.name)}</h3>${c.platform ? paPlatformBadge(c.platform) : ""}</div>
      ${edit ? `<div class="field"><label>Campaign name</label>${inp(c.name, `data-paf="name"`)}</div>` : ""}
      <div class="pa-facts"><span><b>Objective</b> ${esc(c.objective)}</span><span><b>Budget</b> ${paSar(c.budget_sar)} (${c.budget_pct}%) ${edit ? `<input class="input input-sm pa-num" type="number" min="0" max="100" value="${c.budget_pct}" data-paf="budget_pct" aria-label="Budget share %">%` : ""}</span>
        <span><b>Schedule</b> <span dir="auto">${esc([c.schedule.days, c.schedule.hours].filter(Boolean).join(" · ") || "–")}</span></span>${c.schedule.ramadan ? `<span><b>Ramadan</b> <span dir="auto">${esc(c.schedule.ramadan)}</span></span>` : ""}
        <span><b>Placements</b> ${esc(c.placements.join(", ") || "automatic")}</span><span><b>UTM</b> <code>${esc(Object.entries(c.utm).map(([k, v]) => `utm_${k}=${v}`).join("&"))}</code></span></div>
      <div class="pa-sets">${c.ad_sets.map((s, si) => `<div class="pa-set" data-paset-i="${si}">${edit ? inp(s.name, `data-pas="name" aria-label="Ad set name"`) : ""}<div class="row between gap-8" style="flex-wrap:wrap"><b dir="auto">${edit ? "Ad set " + (si + 1) : esc(s.name)}</b><span class="subtle s-small num">${s.budget_pct}% · ${paSar2(s.daily_budget_sar)}/day ${edit ? `<input class="input input-sm pa-num" type="number" min="0" max="100" value="${s.budget_pct}" data-pas="budget_pct" aria-label="Ad set share %">%` : ""}</span></div>
          <span class="s-small" dir="auto">${edit ? `<input class="input input-sm" dir="auto" value="${esc(s.audience.summary)}" data-pas="summary" aria-label="Audience">` : esc(s.audience.summary || "")}</span>
          <span class="subtle s-small" dir="auto">${[s.audience.cities.length ? "Cities: " + s.audience.cities.join(", ") : "All Saudi Arabia", `Age ${s.audience.age_min}–${s.audience.age_max}`, s.audience.interests.length ? "Interests: " + s.audience.interests.join(", ") : "", s.audience.job_titles.length ? "Job titles: " + s.audience.job_titles.join(", ") : "", s.audience.lookalike ? "Lookalike of paying stores (build the source in Ads Manager)" : ""].filter(Boolean).map(esc).join(" · ")}</span></div>`).join("")}</div>
      <div class="pa-ads">${c.ads.length ? c.ads.map((a, ai) => `<div class="pa-ad" data-paad="${ai}"><div class="row between gap-8" style="flex-wrap:wrap"><b dir="auto">${esc(a.name)}</b><span class="subtle s-small">${a.creative_item_id ? `Studio #${esc(a.creative_item_id)}` : "no approved Studio content picked"} · ${esc(a.cta)} · ad set ${a.adset_index + 1}</span></div>
          <div class="field"><label>Primary text (Arabic)</label>${edit ? `<textarea class="input" dir="auto" rows="2" data-paa="primary_text_ar">${esc(a.primary_text_ar)}</textarea>` : `<p dir="auto" style="margin:0">${esc(a.primary_text_ar)}</p>`}</div>
          <div class="field"><label>Headline (Arabic)</label>${inp(a.headline_ar, `data-paa="headline_ar"`)}</div>
          <span class="subtle s-small pa-link" title="${esc(a.link)}">${esc(a.link)}</span></div>`).join("") : `<p class="subtle s-small">No ads in the plan: add them in Ads Manager with Studio content.</p>`}</div>
      ${c.platform?.payloads ? `<details><summary class="s-small">Test run: the exact requests Live mode would send</summary><pre class="pa-pre">${esc(JSON.stringify(c.platform.payloads, null, 2))}</pre></details>` : ""}
      ${c.platform?.notes?.length ? `<ul class="s-small">${c.platform.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${c.platform?.campaign_id && c.platform.status !== "ACTIVE" && appr ? `<button class="btn btn-sm" data-pa="activate" data-plan="${p.id}" data-ch="${esc(c.channel)}">Activate on ${esc(c.channel)}…</button>` : ""}</div>`).join("");
  const acts = [
    edit ? `<button class="btn btn-sm" data-pa="save-plan" data-plan="${p.id}">Save edits</button>` : "",
    draft && appr ? `<button class="btn btn-sm btn-primary" data-pa="approve" data-plan="${p.id}">Approve</button><button class="btn btn-sm btn-ghost" data-pa="reject" data-plan="${p.id}">Reject</button>` : "",
    ["approved", "created"].includes(p.status) && appr && p.campaigns.some((c) => !c.platform?.campaign_id && c.channel !== "Google") ? `<button class="btn btn-sm btn-primary" data-pa="create" data-plan="${p.id}">${d.mode === "live" ? "Create on the platforms (paused)" : "Test run (nothing is sent)"}</button>` : "",
    paEdit() && !["created", "active"].includes(p.status) ? `<button class="btn btn-sm btn-ghost btn-danger" data-pa="del-plan" data-plan="${p.id}">Delete</button>` : "",
    draft && !appr ? `<span class="subtle s-small">An approver (Owner, Admin, Team lead) approves.</span>` : "",
  ].join("");
  return `<div class="card card-pad stack pa-plan open" data-paplan="${p.id}">${head}${p.summary ? `<p class="s-small" dir="auto" style="margin:0">${esc(p.summary)}</p>` : ""}${camps}<div class="row gap-8" style="flex-wrap:wrap">${acts}</div>
    <details><summary class="s-small">History</summary><ul class="s-small">${(p.history || []).map((h) => `<li>${fmtDate(h.at)} · ${esc(h.by)}: ${esc(h.text)}</li>`).join("")}</ul></details></div>`;
}
function paPlatformBadge(pl) {
  if (pl.error) return `<span class="badge bad" style="white-space:normal;height:auto">${esc(pl.error)}</span>`;
  if (pl.mode === "test") return `<span class="badge warn">Test run saved</span>`;
  return `<span class="badge ${pl.status === "ACTIVE" ? "good" : "accent"}">${pl.status === "ACTIVE" ? "Active" : "Paused"} · ${esc(pl.campaign_id)}</span>`;
}
function paReadPlan(id) {
  const p = PA.camp.plans.find((x) => x.id === id), root = document.querySelector(`[data-paplan="${id}"]`);
  const campaigns = p.campaigns.map((c, ci) => {
    const el = root.querySelector(`[data-pacamp="${ci}"]`), v = (sel, def) => el.querySelector(sel)?.value ?? def;
    return { ...c, name: v('[data-paf="name"]', c.name), budget_pct: Number(v('[data-paf="budget_pct"]', c.budget_pct)),
      ad_sets: c.ad_sets.map((s, si) => { const se = el.querySelector(`[data-paset-i="${si}"]`); const g = (k, d0) => se.querySelector(`[data-pas="${k}"]`)?.value ?? d0;
        return { ...s, name: g("name", s.name), budget_pct: Number(g("budget_pct", s.budget_pct)), audience: { ...s.audience, summary: g("summary", s.audience.summary) } }; }),
      ads: c.ads.map((a, ai) => { const ae = el.querySelector(`[data-paad="${ai}"]`); const g = (k, d0) => ae.querySelector(`[data-paa="${k}"]`)?.value ?? d0;
        return { ...a, primary_text_ar: g("primary_text_ar", a.primary_text_ar), headline_ar: g("headline_ar", a.headline_ar) }; }) };
  });
  return { name: p.name, summary: p.summary, campaigns };
}

/* ------------------------------------------------ Budgets & rules (AI Budget pacer) */
function paBudgets() {
  const d = PA.rules, s = d.settings, appr = d.can_approve, dis = appr ? "" : "disabled";
  const chans = ["total", ...d.channels];
  return `<div class="stack">
    <section class="card card-pad stack"><div class="row between gap-8" style="flex-wrap:wrap"><h2>Monthly budgets (SAR)</h2>${appr ? "" : `<span class="subtle s-small">Only approvers (Owner, Admin, Team lead) change budgets.</span>`}</div>
      <div class="pa-form">${chans.map((c) => `<div class="field"><label for="pab-${c}">${c === "total" ? "Total (optional cap)" : esc(c)}</label><input class="input" id="pab-${c}" type="number" min="0" step="1" inputmode="numeric" value="${s.budgets[c] || ""}" ${dis}></div>`).join("")}
        <div class="field"><label for="pa-tol">Pacing tolerance %</label><input class="input" id="pa-tol" type="number" min="1" max="50" value="${s.tolerance_pct}" ${dis}></div>
        <div class="field"><label for="pa-result">Result to optimise and count</label><select class="input" id="pa-result" ${paEdit() ? "" : "disabled"}>${PA_RESULTS.map(([k, l]) => `<option value="${k}" ${s.result === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div><span class="eyebrow">Currency rates (SAR per 1 unit)</span><div class="pa-form" style="margin-top:6px">${[...new Set(["USD", ...d.currencies, ...Object.keys(s.fx).filter((k) => k !== "SAR")])].map((c) => `<div class="field"><label for="pafx-${c}">${esc(c)} → SAR</label><input class="input" id="pafx-${c}" data-pafx="${esc(c)}" type="number" min="0" step="0.0001" value="${s.fx[c] ?? ""}" ${dis}></div>`).join("")}</div>
        <span class="subtle s-small">Ad accounts in SAR need no rate. USD is pegged at 3.75. Type a rate for any other account currency, or its spend isn't counted.</span></div>
      ${paEdit() ? `<div><button class="btn btn-primary" data-pa="save-budgets">Save</button></div>` : ""}</section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Pacing · ${esc(d.pacing.month)}</h2></div>
      <div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Channel</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Expected by now</th><th class="num">Projected</th><th class="num">Per day to land</th><th>Status</th></tr></thead><tbody>
      ${[...d.pacing.channels, d.pacing.total].map((c) => `<tr><td><b>${esc(c.channel)}</b></td><td class="num">${c.budget ? paSar(c.budget) : "–"}</td><td class="num">${paSar(c.spent)}</td><td class="num">${paSar(c.expected)}</td><td class="num">${paSar(c.projected)}</td><td class="num">${paSar(c.daily_target)}</td><td>${paBadge(PA_PACE, c.status)}</td></tr>`).join("")}</tbody></table></div>
      ${d.pacing.warnings.map((w) => `<p class="s-small" style="padding:0 20px;color:var(--warn)">${esc(w)}</p>`).join("")}</section>
    <section class="card card-pad stack"><div class="row between gap-8" style="flex-wrap:wrap"><h2>Guardrail rules</h2><span class="subtle s-small">AI Budget pacer: level ${d.pacer_level} · ${d.pacer_level >= 2 ? "applies rules itself in Live mode" : d.pacer_level === 1 ? "alerts; a person applies" : "off"} · <button class="linklike" data-go="workforce">AI Workforce</button></span></div>
      <p class="subtle s-small" style="margin:0">Checked after every insights pull and CSV import. Test mode logs what it would do. Live mode acts only when the AI Budget pacer is at level 2; otherwise each hit waits here for a person.</p>
      ${d.rules.map((r) => paRuleRow(r, appr)).join("")}
      ${appr ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-pa="add-rule" data-kind="pause_cpa">+ Pause rule</button><button class="btn btn-sm" data-pa="add-rule" data-kind="cap_daily">+ Daily cap rule</button><button class="btn btn-sm btn-ghost" data-pa="evaluate">Check rules now</button></div>` : ""}</section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Guardrail actions</h2><span class="subtle s-small">Last ${d.actions.length}</span></div>
      ${d.actions.length ? `<ul class="pa-log">${d.actions.map((a) => `<li><span class="subtle s-small num">${fmtDate(a.at)}</span>${paBadge(PA_ACT, a.status)}<span class="grow" dir="auto"><b>${a.kind === "pause" ? "Pause" : `Cap at ${paSar(a.value_sar)}/day`}</b> ${esc(a.adset_name || a.adset_id)} <span class="subtle">(${esc(a.channel)} · ${esc(a.campaign_name)})</span><br><span class="s-small">${esc(a.reason)}${a.error ? ` · <span style="color:var(--bad)">${esc(a.error)}</span>` : ""}</span></span>
        ${a.status === "open" && appr ? `<span class="row gap-4" style="flex-wrap:wrap">${a.api && d.settings.mode === "live" ? `<button class="btn btn-sm btn-primary" data-pa="apply" data-id="${a.id}">Apply</button>` : ""}<button class="btn btn-sm" data-pa="resolve" data-done="1" data-id="${a.id}">Done by hand</button><button class="btn btn-sm btn-ghost" data-pa="resolve" data-id="${a.id}">Dismiss</button></span>` : a.status === "open" && paEdit() ? `<button class="btn btn-sm btn-ghost" data-pa="resolve" data-id="${a.id}">Dismiss</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted s-small" style="padding:0 20px 16px">No rule has fired yet.</p>`}</section></div>`;
}
const PA_RESULTS = [["signups", "Signups (complete registration)"], ["leads", "Leads (forms)"], ["purchases", "Paying (purchases)"]];
function paRuleRow(r, appr) {
  const dis = appr ? "" : "disabled", K = PA.rules.kinds[r.kind];
  const f = (k, label, v) => `<div class="field"><label>${label}</label><input class="input input-sm" type="number" min="0" step="1" data-par="${k}" value="${v ?? ""}" placeholder="—" ${dis}></div>`;
  return `<div class="pa-rule" data-parule="${r.id}"><div class="row between gap-8" style="flex-wrap:wrap"><label class="chip"><input type="checkbox" data-par="enabled" ${r.enabled ? "checked" : ""} ${dis}> <b>${esc(r.name)}</b></label><span class="subtle s-small">${esc(K?.hint || "")}</span></div>
    <div class="pa-form">
      <div class="field"><label>Channel</label><select class="input input-sm" data-par="channel" ${dis}>${["all", ...PA.rules.channels].map((c) => `<option value="${c}" ${r.channel === c ? "selected" : ""}>${c === "all" ? "All channels" : c}</option>`).join("")}</select></div>
      ${r.kind === "pause_cpa" ? f("max_cpa_sar", `Max cost per ${paResName(PA.rules.settings.result)} (SAR)`, r.max_cpa_sar) + f("min_spend_sar", "After spending (SAR)", r.min_spend_sar) + f("window_days", "Window (days)", r.window_days) : f("cap_sar", "Daily cap per ad set (SAR)", r.cap_sar)}
    </div>${appr ? `<div class="row gap-8"><button class="btn btn-sm" data-pa="save-rule" data-id="${r.id}">Save</button><button class="btn btn-sm btn-ghost btn-danger" data-pa="del-rule" data-id="${r.id}">Delete</button></div>` : ""}</div>`;
}

/* ------------------------------------------------ Creatives (AI Creative rotator) */
function paCreatives() {
  const d = PA.cr, edit = paEdit(), rn = paResName(d.result);
  const sug = d.suggestions.length ? `<div class="pa-sugs">${d.suggestions.map((s) => `<div class="card card-pad stack pa-sug"><b dir="auto">${esc(s.title)}</b><span class="s-small" dir="auto">${esc(s.brief)}</span><span class="subtle s-small" dir="auto">${esc(s.why || "")}</span>
      ${edit ? `<div class="row gap-8" style="margin-top:auto"><button class="btn btn-sm btn-primary" data-pa="idea" data-key="${esc(s.key)}">Create Studio idea</button><button class="btn btn-sm btn-ghost" data-pa="dismiss-idea" data-key="${esc(s.key)}">Dismiss</button></div>` : ""}</div>`).join("")}</div>`
    : `<p class="muted s-small">${d.rotator_level === 0 ? "The AI Creative rotator is switched off in AI Workforce." : "No suggestions right now: they appear when ads tire, lose, or a winner is worth repeating."}</p>`;
  const tbl = (list, studio) => list.length ? `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>${studio ? "Studio content" : "Ad"}</th><th class="num">Spend</th><th class="num">CTR</th><th class="num">Per ${rn}</th>${studio ? `<th class="num">Ads</th>` : `<th class="num">Freq. 7d</th><th class="num">CTR 7d vs prev.</th>`}<th></th></tr></thead><tbody>
    ${list.slice(0, 25).map((a) => `<tr><td><span class="pa-name" dir="auto">${esc(studio ? a.title : a.item_title || a.ad_name)}</span>${studio ? "" : `<span class="subtle s-small">${esc(a.channel)}${a.item_id ? ` · Studio #${esc(a.item_id)}` : " · not linked to Studio"}</span>`}</td><td class="num">${paSar(a.spend_sar)}</td><td class="num">${paPctv(a.ctr)}</td><td class="num">${a.cpa == null ? "none yet" : paSar2(a.cpa)}</td>
      ${studio ? `<td class="num">${a.ads}</td>` : `<td class="num">${a.freq_7d ?? "–"}${a.freq_change != null ? ` <span class="subtle">(${a.freq_change > 0 ? "+" : ""}${a.freq_change}%)</span>` : ""}</td><td class="num">${a.ctr_change == null ? "–" : `${a.ctr_change > 0 ? "+" : ""}${a.ctr_change}%`}</td>`}
      <td>${a.fatigued ? `<span class="badge warn">fatigue</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted s-small" style="padding:0 20px 16px">No ad results in the last 30 days.</p>`;
  return `<div class="stack">
    <section class="card card-pad stack"><div class="row between gap-8" style="flex-wrap:wrap"><h2>Suggestions for Creative Studio</h2>${edit && d.rotator_level > 0 ? `<button class="btn btn-sm" data-pa="suggest" ${PA.busy ? "disabled" : ""}>${PA.busy ? "Thinking…" : "AI: suggest ideas"}</button>` : ""}</div>${sug}
      <span class="subtle s-small">Fatigue: frequency up 15%+ and CTR down 15%+ this week vs last week, with 1,000+ impressions each week. Ads made from a plan carry <code>[cs:id]</code> in their name so results map back to Studio; add the tag to ads you build by hand.</span></section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Ads ranked</h2><span class="subtle s-small">by cost per ${rn}, then CTR · 30 days${d.untagged ? ` · ${d.untagged} not linked to Studio` : ""}</span></div>${tbl(d.ads, false)}</section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Creative Studio content ranked</h2><button class="btn btn-sm btn-ghost" data-go="studio">Open Studio</button></div>${tbl(d.studio, true)}</section></div>`;
}

/* ------------------------------------------------ Accounts and CSV import */
function paAccounts() {
  const d = PA.acc, edit = paEdit(), appr = d.can_approve;
  const plat = d.platforms.map((p) => {
    const c = p.connection, st = !p.configured ? ["Not set up", ""] : !c ? ["Not connected", ""] : c.status !== "connected" ? ["Reconnect", "bad"] : c.expired ? ["Login expired", "bad"] : ["Connected", "good"];
    return `<div class="card card-pad stack pa-acc"><div class="row between gap-8"><h3>${esc(p.name)}</h3><span class="badge ${st[1]}">${st[0]}</span></div>
      ${c ? `<span class="subtle s-small">${esc(c.name)} · connected by ${esc(c.connected_by || "")} ${c.connected_at ? "· " + fmtDate(c.connected_at) : ""}${c.via === "studio" ? " · using Creative Studio's Meta login" : ""}${c.last_pull_at ? ` · last pull ${fmtDate(c.last_pull_at)}` : ""}</span>
        ${c.accounts.length ? `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Ad account</th><th>Currency</th><th>Timezone</th><th>Status</th></tr></thead><tbody>${c.accounts.map((a) => `<tr><td>${edit ? `<label class="row gap-4"><input type="radio" name="paacct-${c.id}" data-paacct="${c.id}" value="${esc(a.id)}" ${a.id === c.selected ? "checked" : ""}> <span dir="auto">${esc(a.name)}</span></label>` : `<span dir="auto">${esc(a.name)}</span>${a.id === c.selected ? " ✓" : ""}`}<span class="subtle s-small mono">${esc(a.id)}</span></td><td>${esc(a.currency || "–")}</td><td class="s-small">${esc(a.timezone || "–")}</td><td><span class="badge ${a.active ? "good" : "bad"}">${esc(a.status || "unknown")}</span></td></tr>`).join("")}</tbody></table></div>` : `<span class="badge warn">No ad accounts visible to this login</span>`}
        ${c.last_error ? `<span class="badge bad" style="white-space:normal;height:auto">${esc(c.last_error)}</span>` : ""}
        ${c.missing_scopes?.length ? `<span class="s-small" style="color:var(--warn)">Not granted: ${c.missing_scopes.map(esc).join(", ")}</span>` : ""}` : ""}
      <div class="s-small"><b>Permissions:</b> ${p.scopes.map((x) => `<code>${esc(x)}</code>`).join(" ")}<br>${p.review_done ? `<span class="badge good">App review done</span>` : `<span style="color:var(--warn)">Still needs the platform's app review: ${p.review.map(esc).join(", ")}</span>`}</div>
      <details ${p.configured ? "" : "open"}><summary class="s-small">Developer app setup</summary><div class="stack s-small" style="gap:6px;margin-top:6px">
        <span>Redirect URL to register:</span><div class="row gap-8"><code class="cp-code pa-code">${esc(p.redirect_uri)}</code><button class="btn btn-sm btn-ghost" data-pacopy="${esc(p.redirect_uri)}">Copy</button></div>
        <div>Env vars in hPanel: ${p.env.map((e) => `<code>${esc(e)}</code>`).join(" ")}</div><div>Console: ${esc(p.console)}</div><div class="subtle">${esc(p.notes)}</div></div></details>
      ${edit ? `<div class="row gap-8" style="flex-wrap:wrap;margin-top:auto">${p.configured ? `<a class="btn btn-sm ${c ? "" : "btn-primary"}" href="/oauth/ads/${p.id}/start?ws=${S.ws.id}">${c ? "Reconnect" : "Connect"}</a>` : `<span class="subtle s-small">Add the env vars to connect.</span>`}
        ${p.id === "meta" && d.studio_meta && p.configured ? `<button class="btn btn-sm" data-pa="reuse-meta">Use Creative Studio's Meta login</button>` : ""}
        ${c ? `<button class="btn btn-sm btn-ghost" data-pa="refresh-acct" data-id="${c.id}">Refresh list</button><button class="btn btn-sm btn-ghost btn-danger" data-pa="disconnect" data-id="${c.id}">Disconnect</button>` : ""}</div>` : ""}</div>`;
  }).join("");
  const s = PA.ov?.settings;
  return `<div class="stack">
    ${d.notice ? `<div class="notice ${d.notice.ok ? "cp-ok" : ""}">${esc(d.notice.text)}</div>` : ""}
    <div class="card card-pad pa-banner ${d.mode}"><div class="row gap-12" style="flex-wrap:wrap;justify-content:space-between"><div class="stack" style="gap:4px;min-width:0;flex:1"><div class="row gap-8" style="flex-wrap:wrap">${paMode(d.mode)}<b>${d.mode === "live" ? "Live: insights every 6 hours; guardrails may act; approved plans can be created (paused)." : "Test mode: nothing changes on any platform. You can still pull insights by hand (read-only)."}</b></div>
      <span class="subtle s-small">Campaigns are always created paused; only an approver activates them.</span></div>
      <div class="row gap-8" style="flex-wrap:wrap">${edit && d.platforms.some((p) => p.connection) ? `<button class="btn" data-pa="pull">Pull insights now</button>` : ""}${appr ? `<button class="btn ${d.mode === "live" ? "" : "btn-primary"}" data-pa="mode">${d.mode === "live" ? "Back to Test mode" : "Switch to Live"}</button>` : `<span class="subtle s-small">Approvers switch modes.</span>`}</div></div></div>
    <div class="pa-accs">${plat}</div>
    ${d.google_flag ? "" : `<p class="subtle s-small" style="margin:0">Google Ads is optional: set <code>ADS_GOOGLE=1</code> (plus a developer token) to show it.</p>`}
    <section class="card card-pad stack"><div><h2>Import from Ads Manager (CSV)</h2><p class="subtle s-small">Until API access is approved: export by <b>day</b> at campaign, ad set or ad level with Amount spent / Spend, Impressions, Clicks (Snap: Swipe ups), Reach, and your result (Results, Leads, Registrations completed or Purchases). Re-importing the same rows replaces them; API rows win for the same day.</p></div>
      <div class="pa-form"><div class="field"><label for="pai-ch">Channel</label><select class="input" id="pai-ch"><option value="">Detect from columns</option>${d.channels.map((c) => `<option>${c}</option>`).join("")}</select></div>
        <div class="field"><label for="pai-cur">Currency in the file</label><select class="input" id="pai-cur"><option value="">From the file (else SAR)</option><option>SAR</option><option>USD</option><option>AED</option><option>EUR</option></select></div></div>
      <textarea class="input mono" id="pai-csv" rows="5" placeholder="Paste the CSV here (with its header row)"></textarea>
      <div class="row gap-8" style="flex-wrap:wrap">${edit ? `<button class="btn" data-pa="parse">Read the file</button>` : ""}<span class="subtle s-small" id="pai-msg"></span></div><div id="paiPrev"></div>
      ${d.batches.length ? `<ul class="pa-log">${d.batches.map((b) => `<li><span class="badge">${esc(b.channel)}</span><span class="grow s-small">${b.rows} rows · ${esc(b.from)} → ${esc(b.to)} · ${esc(b.currency)} ${b.spend.toLocaleString("en-US")} · by ${esc(b.by)}</span>${edit ? `<button class="btn btn-sm btn-ghost btn-danger" data-pa="del-batch" data-id="${b.id}">Delete</button>` : ""}</li>`).join("")}</ul>` : ""}</section>
    <section class="card card-pad stack"><h2>Conversion setup</h2>
      <div class="pa-form">${[["meta_page_id", "Meta Page id (for ad creatives)"], ["meta_pixel_id", "Meta Pixel / dataset id"], ["snap_pixel_id", "Snap Pixel id"], ["tiktok_pixel_id", "TikTok Pixel id"]].map(([k, l]) => `<div class="field"><label for="pas-${k}">${l}</label><input class="input" id="pas-${k}" value="${esc(s?.[k] || "")}" ${edit ? "" : "disabled"}></div>`).join("")}
        <div class="field"><label for="pas-landing_url">Landing page</label><input class="input" id="pas-landing_url" value="${esc(s?.landing_url || "")}" ${edit ? "" : "disabled"}></div></div>
      <span class="subtle s-small">Without a Page id, the Creative Studio Meta Page is used. Without a pixel, ad sets optimise for link clicks.</span>
      ${edit ? `<div><button class="btn btn-sm" data-pa="save-conv">Save</button></div>` : ""}
      <div class="s-small"><b>Lead hook</b> (signup or landing forms POST here with the page URL and its UTMs, so CRM stores carry their source): <code class="pa-code">${esc(d.lead_hook.url)}</code> ${d.lead_hook.set ? `<span class="badge good">ADS_LEAD_SECRET set</span>` : `<span class="badge warn">set ADS_LEAD_SECRET</span>`}<br><span class="subtle pa-link">Body: {"store_name","email","phone","domain","url":"https://dpa.ad/?utm_source=…","signup":true}</span></div></section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Log</h2></div>${d.log.length ? `<ul class="pa-log">${d.log.map((l) => `<li><span class="subtle s-small num">${fmtDate(l.at)}</span><span class="badge">${esc(l.kind)}</span><span class="grow s-small" dir="auto">${esc(l.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small" style="padding:0 20px 16px">Nothing yet.</p>`}</section></div>`;
}
function paPreview() {
  const p = PA.parsed;
  $("#paiPrev").innerHTML = `<div class="stack"><div class="row gap-8" style="flex-wrap:wrap"><span class="badge accent">${esc(p.channel)}</span><span class="s-small">${p.totals.rows} rows · ${esc(p.from)} → ${esc(p.to)} · ${esc(p.currency)} ${p.totals.spend.toLocaleString("en-US")} spend${p.fx == null ? ` · <b style="color:var(--bad)">type the ${esc(p.currency)} → SAR rate in Budgets & rules</b>` : ""}</span></div>
    <div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Day</th><th>Campaign</th><th>Ad set</th><th>Ad</th><th class="num">Spend</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">Leads</th><th class="num">Signups</th><th class="num">Purchases</th></tr></thead><tbody>
    ${p.preview.map((r) => `<tr><td class="num">${esc(r.date)}</td><td dir="auto">${esc(r.campaign_name)}</td><td dir="auto">${esc(r.adset_name)}</td><td dir="auto">${esc(r.ad_name)}</td><td class="num">${r.spend}</td><td class="num">${r.impressions}</td><td class="num">${r.clicks}</td><td class="num">${r.leads}</td><td class="num">${r.signups}</td><td class="num">${r.purchases}</td></tr>`).join("")}</tbody></table></div>
    <div class="row gap-8"><button class="btn btn-primary" data-pa="import">Import ${p.totals.rows} rows</button><button class="btn btn-ghost" data-pa="cancel-import">Cancel</button></div></div>`;
}

/* ------------------------------------------------ UTM builder and funnel attribution */
function paUtm() {
  const s = PA.ov.settings, edit = paEdit(), a = PA.att;
  return `<div class="stack">
    <section class="card card-pad stack"><div><h2>UTM builder</h2><p class="subtle s-small">Put a UTM on every ad link. Signups that arrive with it (lead hook, CRM stores, Sales deals) are matched back to the channel and campaign, giving cost per lead, trial and paying store.</p></div>
      <div class="pa-form"><div class="field" style="grid-column:1/-1"><label for="pau-url">Landing page</label><input class="input" id="pau-url" value="${esc(s.landing_url)}" data-pautm></div>
        <div class="field"><label for="pau-ch">Channel</label><select class="input" id="pau-ch" data-pautm>${Object.keys(PA_COLOR).map((c) => `<option>${c}</option>`).join("")}<option value="">Other (type source)</option></select></div>
        <div class="field"><label for="pau-src">utm_source</label><input class="input" id="pau-src" placeholder="from the channel" data-pautm></div>
        <div class="field"><label for="pau-med">utm_medium</label><input class="input" id="pau-med" placeholder="from the channel" data-pautm></div>
        <div class="field"><label for="pau-camp">utm_campaign</label><input class="input" id="pau-camp" dir="auto" placeholder="riyadh-fashion-nov" data-pautm></div>
        <div class="field"><label for="pau-cont">utm_content (ad)</label><input class="input" id="pau-cont" dir="auto" placeholder="reel-1" data-pautm></div>
        <div class="field"><label for="pau-term">utm_term</label><input class="input" id="pau-term" data-pautm></div></div>
      <div class="pa-out"><code id="pau-out" class="pa-code">Type the campaign name.</code></div>
      <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-pa="copy-utm">Copy link</button>${edit ? `<input class="input input-sm" id="pau-label" placeholder="Label (optional)" style="max-width:220px"><button class="btn btn-sm btn-primary" data-pa="save-utm">Save link</button>` : ""}</div>
      ${PA.links.length ? `<ul class="pa-log">${PA.links.map((l) => `<li><span class="badge">${esc(l.channel || l.utm.source)}</span><span class="grow s-small" style="min-width:0"><b dir="auto">${esc(l.label || l.utm.campaign)}</b><br><span class="pa-link">${esc(l.url)}</span></span><button class="btn btn-sm btn-ghost" data-pacopy="${esc(l.url)}">Copy</button>${edit ? `<button class="btn btn-sm btn-ghost btn-danger" data-pa="del-link" data-id="${l.id}">Delete</button>` : ""}</li>`).join("")}</ul>` : ""}</section>
    <section class="card"><div class="card-head" style="padding:14px 20px"><h2>Attribution · ${esc(a.month || "all time")}</h2><span class="subtle s-small">${a.total.leads} lead${a.total.leads === 1 ? "" : "s"} · ${a.total.trials} trial${a.total.trials === 1 ? "" : "s"} · ${a.total.paying} paying</span></div><div style="padding:0 20px">${paFunnel(a.channels, paResName(s.result))}</div>
      ${a.campaigns.length ? `<div class="table-wrap"><table class="f-table pa-table"><thead><tr><th>Campaign</th><th>utm_campaign</th><th class="num">Spend</th><th class="num">Leads</th><th class="num">Trials</th><th class="num">Paying</th><th class="num">Per lead</th><th class="num">Per paying</th></tr></thead><tbody>
        ${a.campaigns.map((c) => `<tr><td dir="auto">${esc(c.campaign_name)} <span class="subtle s-small">${esc(c.channel)}</span></td><td class="mono s-small">${esc(c.utm_campaign)}</td><td class="num">${paSar(c.spend_sar)}</td><td class="num">${c.leads}</td><td class="num">${c.trials}</td><td class="num">${c.paying}</td><td class="num">${paSar2(c.cost_per_lead)}</td><td class="num">${paSar2(c.cost_per_paying)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${a.unmatched.length ? `<p class="subtle s-small" style="padding:0 20px">Not matched to an ad campaign (utm_campaign differs from every campaign name): ${a.unmatched.slice(0, 12).map((u) => `<span dir="auto">${esc(u.name)}</span> (${esc(u.utm.source || "?")}/${esc(u.utm.campaign || "?")})`).join(", ")}</p>` : ""}
      <p class="subtle s-small" style="padding:0 20px 16px">A campaign matches when its name, written as a UTM (lowercase, dashes), equals utm_campaign. Plans from the Media buyer set this for you.</p></section></div>`;
}
function paUtmRead() {
  const ch = $("#pau-ch").value, src = { Meta: ["meta", "paid_social"], Snapchat: ["snapchat", "paid_social"], TikTok: ["tiktok", "paid_social"], Google: ["google", "cpc"] }[ch] || ["", ""];
  return { url: $("#pau-url").value.trim(), channel: ch, source: $("#pau-src").value.trim() || src[0], medium: $("#pau-med").value.trim() || src[1], campaign: $("#pau-camp").value.trim(), content: $("#pau-cont").value.trim(), term: $("#pau-term").value.trim() };
}
let paUtmTimer = null;
function paUtmPreview() {
  clearTimeout(paUtmTimer);
  paUtmTimer = setTimeout(async () => {
    const b = paUtmRead(), out = $("#pau-out"); if (!out) return;
    if (!b.campaign) { out.textContent = "Type the campaign name."; return; }
    try { out.textContent = (await api(`${paP()}/utm`, { method: "POST", body: JSON.stringify(b) })).url; } catch (e) { out.textContent = e.message; }
  }, 250);
}

/* ------------------------------------------------ events */
async function paCopy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy failed: select and copy by hand", true); } }
document.addEventListener("input", (e) => { if (S.route === "ads" && e.target.closest("[data-pautm]")) paUtmPreview(); });
document.addEventListener("change", async (e) => {
  if (S.route !== "ads") return;
  const t = e.target;
  try {
    if (t.dataset.paset) { PA[t.dataset.paset] = t.dataset.paset === "days" ? Number(t.value) : t.value; return paShow(); }
    if (t.dataset.paacct) { await api(`${paP()}/accounts/${t.dataset.paacct}`, { method: "PUT", body: JSON.stringify({ selected: t.value }) }); toast("Ad account selected"); return paShow(); }
    if (t.dataset.pautm !== undefined) paUtmPreview();
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("click", async (e) => {
  if (S.route !== "ads") return;
  const t = e.target;
  const tab = t.closest("[data-patab]");
  if (tab) { PA.tab = tab.dataset.patab; history.replaceState(null, "", `#/${S.ws.id}/ads/${PA.tab}`); S.param = PA.tab; return paShow(); }
  const cp = t.closest("[data-pacopy]"); if (cp) return paCopy(cp.dataset.pacopy);
  const op = t.closest("[data-paopen]"); if (op) { PA.open = PA.open === op.dataset.paopen ? null : op.dataset.paopen; $("#paBody").innerHTML = paCampaigns(); return; }
  const b = t.closest("[data-pa]"); if (!b) return;
  const act = b.dataset.pa, id = b.dataset.id, plan = b.dataset.plan;
  const post = (p, body = {}, method = "POST") => api(`${paP()}${p}`, { method, body: JSON.stringify(body) });
  try {
    if (act === "plan") {
      const body = { goal: $("#pa-goal").value, budget_sar: Number($("#pa-budget").value), start_date: $("#pa-start").value, end_date: $("#pa-end").value, channels: [...document.querySelectorAll("[data-pach]:checked")].map((x) => x.dataset.pach) };
      PA.busy = true; b.disabled = true; b.textContent = "Drafting…";
      try { const p = await post("/plans", body); PA.open = p.id; toast(p.by_ai ? "Plan drafted: review and approve" : "Starter plan created: fill in the [ADD] parts"); } finally { PA.busy = false; }
      return paShow();
    }
    if (act === "save-plan") { await post(`/plans/${plan}`, paReadPlan(plan), "PUT"); toast("Saved"); return paShow(); }
    if (act === "approve") { await post(`/plans/${plan}`, paReadPlan(plan), "PUT"); await post(`/plans/${plan}/approve`); toast("Approved"); return paShow(); }
    if (act === "reject") { const reason = prompt("Why? (helps the AI Media buyer learn)") ?? null; if (reason === null) return; await post(`/plans/${plan}/reject`, { reason }); toast("Rejected"); return paShow(); }
    if (act === "create") { const r = await post(`/plans/${plan}/create`); toast(r.status === "created" ? "Created on the platforms, paused" : PA.camp.mode === "live" ? "See the errors on each channel" : "Test run saved: nothing was sent"); return paShow(); }
    if (act === "activate") { if (!confirm(`Turn this campaign ON in ${b.dataset.ch}? It starts spending right away.`)) return; await post(`/plans/${plan}/activate`, { confirm: true, channel: b.dataset.ch }); toast("Activated"); return paShow(); }
    if (act === "del-plan") { if (!confirm("Delete this plan?")) return; await api(`${paP()}/plans/${plan}`, { method: "DELETE" }); return paShow(); }
    if (act === "save-budgets") {
      const budgets = Object.fromEntries(["total", ...PA.rules.channels].map((c) => [c, Number($(`#pab-${c}`).value) || 0]));
      const fx = Object.fromEntries([...document.querySelectorAll("[data-pafx]")].map((x) => [x.dataset.pafx, x.value === "" ? null : Number(x.value)]));
      const body = PA.rules.can_approve ? { budgets, fx, tolerance_pct: Number($("#pa-tol").value), result: $("#pa-result").value } : { result: $("#pa-result").value };
      await post("/settings", body, "PUT"); toast("Saved"); PA.ov = null; return paShow();
    }
    if (act === "save-rule" || act === "add-rule") {
      if (act === "add-rule") { await post("/rules", { kind: b.dataset.kind, name: b.dataset.kind === "cap_daily" ? "Cap each ad set's daily spend" : "Pause ad sets when cost per result is too high", enabled: false }); return paShow(); }
      const el = document.querySelector(`[data-parule="${id}"]`), g = (k) => el.querySelector(`[data-par="${k}"]`);
      const body = { enabled: g("enabled").checked, channel: g("channel").value };
      for (const k of ["max_cpa_sar", "min_spend_sar", "window_days", "cap_sar"]) if (g(k)) body[k] = g(k).value === "" ? null : Number(g(k).value);
      await post(`/rules/${id}`, body, "PUT"); toast("Rule saved"); return paShow();
    }
    if (act === "del-rule") { if (!confirm("Delete this rule?")) return; await api(`${paP()}/rules/${id}`, { method: "DELETE" }); return paShow(); }
    if (act === "evaluate") { const r = await post("/rules/evaluate"); toast(`Checked: ${r.logged} logged, ${r.needs_person} for a person, ${r.applied} applied`); return paShow(); }
    if (act === "apply") { if (!confirm("Apply this on the platform now?")) return; await post(`/actions/${id}/apply`); toast("Applied"); return paShow(); }
    if (act === "resolve") { await post(`/actions/${id}/resolve`, { done: b.dataset.done === "1" }); return paShow(); }
    if (act === "suggest") { PA.busy = true; b.disabled = true; b.textContent = "Thinking…"; try { PA.cr = await post("/creatives/suggest"); } finally { PA.busy = false; } $("#paBody").innerHTML = paCreatives(); return; }
    if (act === "idea" || act === "dismiss-idea") {
      const s = PA.cr.suggestions.find((x) => x.key === b.dataset.key); if (!s) return;
      if (act === "idea") { await post("/creatives/ideas", s); toast("Added to Creative Studio as an idea"); } else await post("/creatives/dismiss", { key: s.key });
      return paShow();
    }
    if (act === "mode") {
      const live = PA.acc.mode !== "live";
      if (live && !confirm("Switch Paid Ads to Live? Insights are pulled every 6 hours, guardrails may pause or cap ad sets (if the AI Budget pacer is at level 2), and approved plans can be created on the platforms (always paused).")) return;
      await post("/settings", { mode: live ? "live" : "test" }, "PUT"); PA.ov = null; return paShow();
    }
    if (act === "pull") { b.disabled = true; b.textContent = "Pulling…"; const r = await post("/pull"); toast(r.pulled.map((x) => x.error ? `${x.channel}: ${x.error}` : `${x.channel}: ${x.added} new, ${x.updated} updated`).join(" · ") || "Nothing to pull", r.pulled.some((x) => x.error)); PA.ov = null; return paShow(); }
    if (act === "reuse-meta") { await post("/accounts/meta/reuse"); toast("Meta ads connected"); return paShow(); }
    if (act === "refresh-acct") { await post(`/accounts/${id}/refresh`); toast("Ad accounts refreshed"); return paShow(); }
    if (act === "disconnect") { if (!confirm("Disconnect this ad platform? Insights stop until you reconnect.")) return; await api(`${paP()}/accounts/${id}`, { method: "DELETE" }); return paShow(); }
    if (act === "parse") { PA.parsed = await post("/import/parse", { text: $("#pai-csv").value, channel: $("#pai-ch").value, currency: $("#pai-cur").value }); if (!$("#pai-ch").value) $("#pai-ch").value = PA.parsed.channel; $("#pai-msg").textContent = ""; return paPreview(); }
    if (act === "import") { const r = await post("/import", { text: $("#pai-csv").value, channel: $("#pai-ch").value || PA.parsed.channel, currency: $("#pai-cur").value }); PA.parsed = null; PA.ov = null; toast(`Imported: ${r.added} new, ${r.updated} updated rows`); return paShow(); }
    if (act === "cancel-import") { PA.parsed = null; $("#paiPrev").innerHTML = ""; return; }
    if (act === "del-batch") { if (!confirm("Delete this import and its rows?")) return; await api(`${paP()}/import/${id}`, { method: "DELETE" }); PA.ov = null; return paShow(); }
    if (act === "save-conv") { await post("/settings", Object.fromEntries(["meta_page_id", "meta_pixel_id", "snap_pixel_id", "tiktok_pixel_id", "landing_url"].map((k) => [k, $(`#pas-${k}`).value.trim()])), "PUT"); PA.ov = null; toast("Saved"); return paShow(); }
    if (act === "copy-utm") { const v = $("#pau-out").textContent; return /^https?:/.test(v) ? paCopy(v) : toast(v, true); }
    if (act === "save-utm") { await post("/utm", { ...paUtmRead(), save: true, label: $("#pau-label").value }); toast("Link saved"); return paShow(); }
    if (act === "del-link") { await api(`${paP()}/links/${id}`, { method: "DELETE" }); return paShow(); }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});
if (S.route === "ads" && S.ws) render();
