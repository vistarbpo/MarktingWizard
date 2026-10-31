/* Sales module: AI-first pipeline. Loaded after app.js and uses its globals
   (S, $, api, esc, md, toast, go, ROUTES). AI drafts every message; a person
   reviews it and marks it sent. Steps only a human may do are tagged YOU. */

const SALES = { meta: null, deals: [], summary: null, tab: "board", openId: null };
const STAGE_COLOR = { lead: "var(--text-3)", contacted: "#8a7cf0", demo: "var(--accent)", beta: "var(--warn)", trial: "#e0703a", paying: "var(--good)", lost: "var(--bad)" };
const PLATFORM_COLOR = { Salla: "#004956", Zid: "#7b2cbf", Shopify: "#5e8e3e", WooCommerce: "#7f54b3", Other: "#6b6b66" };
const HUES = ["#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f", "#a21caf", "#0e7490"];
const LABEL_SIDE = { Makkah: "below", Khobar: "right", Jeddah: "left", Dammam: "above", Riyadh: "below", Buraidah: "above", Hail: "above", Taif: "below", "Al Ahsa": "below" };
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const hueFor = (id) => HUES[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const initials = (n) => String(n).replace(/^Sample · /, "").split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const ownerBadge = (o) => `<span class="s-owner ${o === "you" ? "you" : "ai"}">${o === "you" ? "YOU" : "AI"}</span>`;

ROUTES.pipeline = { title: "Sales pipeline", crumb: "Sales", render: renderSales };

async function salesLoad() {
  if (!SALES.meta) SALES.meta = await api("/api/sales/meta");
  const r = await api(`/api/workspaces/${S.ws.id}/deals`);
  SALES.deals = r.deals; SALES.summary = r.summary;
}

async function renderSales(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await salesLoad();
  $("#pageActions").innerHTML = `
    <div class="s-tabs" role="tablist" aria-label="Sales views">
      <button role="tab" data-stab="board" aria-selected="${SALES.tab === "board"}">Pipeline</button>
      <button role="tab" data-stab="insights" aria-selected="${SALES.tab === "insights"}">Insights</button>
    </div>
    <button class="btn btn-primary" data-saction="add">Add lead</button>`;
  view.innerHTML = `<section class="s-kpis" id="sKpis" aria-label="Pipeline summary"></section>
    <div id="sBody"></div>`;
  salesRenderKpis();
  SALES.tab === "insights" ? salesRenderInsights() : salesRenderBoard();
  if (S.param) salesOpen(S.param);
}

function salesRerender() {
  if (S.route !== "pipeline") return;
  salesRenderKpis();
  SALES.tab === "insights" ? salesRenderInsights() : salesRenderBoard();
}

/* ------------------------------------------------ KPIs + team */
function salesRenderKpis() {
  const s = SALES.summary;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#sKpis").innerHTML = [
    tile("Paying MRR", usd(s.paying_mrr), `${s.paying_count} ${s.paying_count === 1 ? "store" : "stores"}`),
    tile("Expected MRR", usd(s.expected_mrr), "paying + open deals × close chance"),
    tile("Open deals", s.open_count, `${usd(s.open_value)}/mo if all close`),
    tile("Beta and beyond", s.beta_plus, "stores in beta, trial or paying"),
    tile("Handled by AI", s.ai_share + "%", "of open deals' next steps"),
    tile("Needs you", s.needs_you.length, "only human-required steps", s.needs_you.length ? "warn" : ""),
  ].join("");
}

function salesTeam() {
  const a = SALES.summary.agents, mine = SALES.summary.needs_you;
  const agent = (name, job, stats) => `<div class="card s-agent"><div class="row gap-8">${ownerBadge("ai")}<b>${name}</b></div>
    <span class="muted s-small">${job}</span><span class="s-small">${stats}</span></div>`;
  return `<div class="row between" style="margin:24px 0 12px;flex-wrap:wrap;gap:8px"><h2>Sales team</h2><span class="subtle s-small">AI drafts every step it can. People review, send, and do only what must be human. Counts are for the last 7 days.</span></div>
    <section class="s-team">
      ${agent("AI Prospector", "Writes the first WhatsApp message for each new lead", `<b class="num">${a.prospector.drafts}</b> drafted · <b class="num">${a.prospector.sent}</b> sent`)}
      ${agent("AI Demo", "Writes a prospect page with plan fit, cost comparison and ad angles", `<b class="num">${a.demo.pages}</b> pages · at demo: <b class="num">${a.demo.demos}</b>`)}
      ${agent("AI Follow-up", "Writes the next message for every quiet or moving deal", `<b class="num">${a.followup.drafts}</b> drafted · <b class="num">${a.followup.sent}</b> sent`)}
      ${agent("AI Success", "Watches beta and trial stores, prepares objection answers", `<b class="num">${a.success.watched}</b> watched · <b class="num">${a.success.objections}</b> objection sets`)}
      <div class="card s-agent you"><div class="row gap-8">${ownerBadge("you")}<b>You</b></div>
        <span class="muted s-small">Only what must be human: big-deal calls, discounts, contracts, partnerships</span>
        ${mine.length ? `<ul class="s-mine">${mine.map((m) => `<li><button class="s-link" data-sopen="${m.id}">${esc(m.name)}</button>: ${esc(m.text)}</li>`).join("")}</ul>` : `<span class="s-small">Nothing needs you right now.</span>`}
      </div>
    </section>`;
}

/* ------------------------------------------------ Board */
function salesCard(d) {
  const quiet = d.days_quiet >= 7 && !["paying", "lost"].includes(d.stage);
  return `<button type="button" class="s-card" draggable="true" data-sopen="${d.id}" aria-label="${esc(d.name)}, ${esc(d.stage)}">
    <div class="row gap-12"><span class="s-logo" style="background:${hueFor(d.id)}">${esc(initials(d.name))}</span>
      <div style="min-width:0"><b class="s-name">${esc(d.name)}</b><span class="subtle s-small">${esc(d.category || "Store")} · ${esc(d.city)}</span></div></div>
    <div class="s-meta"><span class="s-plat" style="background:${PLATFORM_COLOR[d.platform] || PLATFORM_COLOR.Other}">${esc(d.platform)}</span>
      <span class="num">${Number(d.skus).toLocaleString("en-US")} products</span><span>· ${d.plan} ${usd(d.plan_usd)}</span>
      <span class="s-age ${quiet ? "stale" : ""}" title="Days since last activity">${d.days_quiet}d</span></div>
    <div class="s-next ${d.next.urgent ? (d.next.owner === "you" ? "hot" : "warm") : ""}">${ownerBadge(d.next.owner)}<span>${esc(d.next.text)}</span></div>
  </button>`;
}

function salesRenderBoard() {
  const empty = !SALES.deals.length;
  $("#sBody").innerHTML = `${salesTeam()}
    <form class="card s-add" id="sAdd" hidden>
      <div class="field"><label for="sa-name">Store name</label><input class="input" id="sa-name" required></div>
      <div class="field"><label for="sa-cat">Category</label><input class="input" id="sa-cat" placeholder="Fashion, perfume…"></div>
      <div class="field"><label for="sa-city">City</label><select class="input" id="sa-city">${Object.keys(SALES.meta.cities).map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="sa-plat">Platform</label><select class="input" id="sa-plat">${SALES.meta.platforms.map((p) => `<option>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="sa-skus">Products in catalog</label><input class="input" id="sa-skus" type="number" min="0" required></div>
      <div class="field"><label for="sa-contact">Contact (optional)</label><input class="input" id="sa-contact" placeholder="Name"></div>
      <div class="row gap-8" style="align-self:end"><button class="btn btn-primary" type="submit">Add to Lead</button><button class="btn" type="button" data-saction="add">Cancel</button></div>
    </form>
    ${empty ? `<div class="card empty" style="margin-bottom:16px"><h2>Add your first store</h2><p>Add a Saudi store you want as a customer. The AI team then drafts the first message, a prospect page and every follow-up for you to review and send.</p><button class="btn btn-primary" data-saction="add">Add lead</button></div>` : `<p class="subtle s-small" style="margin:0 0 10px">Drag a store between stages, or click it to open its page.</p>`}
    <div class="s-board" id="sBoard">${SALES.meta.stages.map((st) => {
      const list = SALES.deals.filter((d) => d.stage === st.id);
      const val = list.reduce((a, d) => a + d.plan_usd, 0);
      return `<div class="s-col" data-sstage="${st.id}">
        <div class="s-col-head"><h3><i class="s-dot" style="background:${STAGE_COLOR[st.id]}"></i>${st.name} <span class="subtle num">${list.length}</span></h3><small class="subtle num">${val ? usd(val) + "/mo" : ""}</small></div>
        ${list.map(salesCard).join("") || `<p class="subtle s-small" style="padding:4px">Drop a store here</p>`}</div>`;
    }).join("")}</div>`;
}

/* ------------------------------------------------ Insights */
function salesRenderInsights() {
  if (!SALES.deals.length) {
    $("#sBody").innerHTML = `<div class="card empty" style="margin-top:16px"><h2>No deals yet</h2><p>The funnel, city map and MRR forecast fill in as you add stores to the pipeline.</p><button class="btn btn-primary" data-saction="add">Add lead</button></div>`;
    return;
  }
  $("#sBody").innerHTML = `<div class="s-grid2" style="margin-top:16px">
    <div class="card card-pad"><div class="row between s-panel-head"><h2>Funnel</h2><span class="subtle s-small">Stores that reached each stage</span></div><svg id="sFunnel" viewBox="0 0 520 290" role="img" aria-label="Funnel chart"></svg><div id="sLeak"></div></div>
    <div class="card card-pad"><div class="row between s-panel-head"><h2>Stores across Saudi Arabia</h2><span class="subtle s-small">Bubble size = expected MRR</span></div><svg id="sMap" viewBox="0 0 520 330" role="img" aria-label="Map of stores by city"></svg>
      <div class="s-legend"><span><i class="s-dot" style="background:var(--good)"></i>Has paying stores</span><span><i class="s-dot" style="background:var(--accent)"></i>Pipeline only</span><span><i class="s-dot" style="background:var(--border-strong)"></i>No stores yet</span></div></div>
    <div class="card card-pad" style="grid-column:1/-1"><div class="row between s-panel-head"><h2>MRR forecast</h2><span class="subtle s-small">Paying MRR now, plus open deals weighted by how likely each stage is to close, by the month each stage usually closes</span></div><svg id="sForecast" viewBox="0 0 980 300" role="img" aria-label="MRR forecast chart"></svg>
      <div class="s-legend"><span><i class="s-dot" style="background:var(--good)"></i>Paying now</span><span><i class="s-dot" style="background:var(--accent)"></i>Expected from pipeline</span></div></div>
  </div>`;
  salesFunnel(); salesMap(); salesForecast();
}

function salesFunnel() {
  const order = SALES.meta.stages.filter((s) => s.id !== "lost");
  const idx = Object.fromEntries(order.map((s, i) => [s.id, i]));
  // A lost deal counts as having reached the stage it was lost from (unknown → Lead).
  const reachedIdx = (d) => d.stage === "lost" ? 0 : idx[d.stage];
  const reached = order.map((_, i) => SALES.deals.filter((d) => reachedIdx(d) >= i).length);
  const max = reached[0] || 1, W = 520, rowH = 44, labelW = 96, barMax = W - labelW - 70;
  let svg = "", worst = null;
  order.forEach((s, i) => {
    const w = Math.max(6, (reached[i] / max) * barMax), y = i * rowH + 6, x = labelW + (barMax - w) / 2;
    svg += `<text class="s-svg-text" x="0" y="${y + 21}">${s.name}</text><rect x="${x}" y="${y}" width="${w}" height="30" rx="5" fill="${STAGE_COLOR[s.id]}" opacity="${0.35 + 0.65 * (reached[i] / max)}"></rect><text class="s-svg-strong" x="${W - 60}" y="${y + 21}">${reached[i]}</text>`;
    if (i > 0 && reached[i - 1]) {
      const conv = reached[i] / reached[i - 1];
      svg += `<text class="s-svg-mono" x="${W - 32}" y="${y + 21}">${Math.round(conv * 100)}%</text>`;
      if (!worst || conv < worst.conv) worst = { conv, from: order[i - 1].name, to: s.name };
    }
  });
  $("#sFunnel").innerHTML = svg;
  $("#sLeak").innerHTML = worst && reached[0] >= 3 ? `<div class="notice" style="margin-top:12px">Biggest leak: ${Math.round(worst.conv * 100)}% of stores go from ${worst.from} to ${worst.to}. Fix this stage first.</div>` : "";
}

function salesMap() {
  const W = 520, H = 330, pad = 34, lon = [34.5, 55.7], lat = [16.3, 32.2];
  const X = (lo) => pad + ((lo - lon[0]) / (lon[1] - lon[0])) * (W - 2 * pad);
  const Y = (la) => H - pad - ((la - lat[0]) / (lat[1] - lat[0])) * (H - 2 * pad);
  let svg = "";
  for (let lo = 36; lo <= 54; lo += 3) svg += `<line x1="${X(lo)}" y1="${pad - 10}" x2="${X(lo)}" y2="${H - pad + 10}" stroke="var(--border)"></line><text class="s-svg-mono" x="${X(lo)}" y="${H - 8}" text-anchor="middle">${lo}°E</text>`;
  for (let la = 18; la <= 30; la += 3) svg += `<line x1="${pad - 10}" y1="${Y(la)}" x2="${W - pad + 10}" y2="${Y(la)}" stroke="var(--border)"></line><text class="s-svg-mono" x="4" y="${Y(la) + 4}">${la}°N</text>`;
  svg += `<text class="s-svg-mono" x="${X(37.4)}" y="${Y(18.6)}" text-anchor="middle">Red Sea</text><text class="s-svg-mono" x="${X(53.2)}" y="${Y(24.6)}" text-anchor="middle">Gulf</text>`;
  const by = {};
  for (const d of SALES.deals) if (d.stage !== "lost") { const c = (by[d.city] ||= { n: 0, mrr: 0, paying: 0 }); c.n++; c.mrr += d.weighted_usd; if (d.stage === "paying") c.paying++; }
  const maxM = Math.max(...Object.values(by).map((c) => c.mrr), 1);
  const occupied = Object.entries(SALES.meta.cities).filter(([n, pos]) => pos && by[n]).map(([, [la, lo]]) => [X(lo), Y(la)]);
  for (const [name, pos] of Object.entries(SALES.meta.cities)) {
    if (!pos) continue;
    const [la, lo] = pos, x = X(lo), y = Y(la), c = by[name];
    if (!c) {
      // Empty cities get a dot; their name only when it won't collide with an active city.
      const crowded = occupied.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 60);
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="var(--border-strong)"><title>${name}: no stores yet</title></circle>${crowded ? "" : `<text class="s-svg-mono" x="${x + 7}" y="${y + 4}">${name}</text>`}`;
      continue;
    }
    const r = 6 + 16 * Math.sqrt(c.mrr / maxM), color = c.paying ? "var(--good)" : "var(--accent)";
    const side = LABEL_SIDE[name] || "right";
    const [lx, ly, anchor] = side === "left" ? [x - r - 5, y - 2, "end"] : side === "below" ? [x, y + r + 14, "middle"] : side === "above" ? [x, y - r - 18, "middle"] : [x + r + 5, y - 2, "start"];
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width="1.5"><title>${name}: ${c.n} stores, ${usd(c.mrr)} expected MRR</title></circle>
      <text class="s-svg-strong" x="${lx}" y="${ly}" text-anchor="${anchor}">${name}</text><text class="s-svg-mono" x="${lx}" y="${ly + 14}" text-anchor="${anchor}">${c.n} · ${usd(c.mrr)}</text>`;
  }
  const other = by.Other;
  if (other) svg += `<text class="s-svg-mono" x="${W - 8}" y="16" text-anchor="end">Other cities: ${other.n} · ${usd(other.mrr)}</text>`;
  $("#sMap").innerHTML = svg;
}

function salesForecast() {
  const W = 980, H = 300, L = 64, R = 20, T = 20, B = 40;
  const stages = Object.fromEntries(SALES.meta.stages.map((s) => [s.id, s]));
  const paying = SALES.deals.filter((d) => d.stage === "paying").reduce((a, d) => a + d.plan_usd, 0);
  const open = SALES.deals.filter((d) => stages[d.stage].closesIn);
  const now = new Date(), labels = [];
  for (let m = 0; m < 6; m++) { const dt = new Date(now.getFullYear(), now.getMonth() + m, 1); labels.push(dt.toLocaleDateString("en-US", { month: "short", year: m === 0 || dt.getMonth() === 0 ? "numeric" : undefined })); }
  const exp = labels.map((_, m) => open.filter((d) => stages[d.stage].closesIn <= m).reduce((a, d) => a + d.weighted_usd, 0));
  const top = Math.max(...exp.map((e) => e + paying), 100);
  const step = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000].find((s) => top / s <= 5) || 250000;
  const max = Math.ceil(top / step) * step;
  const X = (i) => L + (i + 0.5) * ((W - L - R) / labels.length), Y = (v) => T + (H - T - B) * (1 - v / max), bw = ((W - L - R) / labels.length) * 0.46;
  let svg = "";
  for (let v = 0; v <= max; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"></line><text class="s-svg-mono" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${usd(v)}</text>`;
  labels.forEach((lab, i) => {
    const x = X(i) - bw / 2;
    svg += `<rect x="${x}" y="${Y(paying)}" width="${bw}" height="${Y(0) - Y(paying)}" fill="var(--good)" rx="3"></rect>
      <rect x="${x}" y="${Y(paying + exp[i])}" width="${bw}" height="${Y(paying) - Y(paying + exp[i])}" fill="var(--accent)" opacity=".85" rx="3"></rect>
      <text class="s-svg-strong" x="${X(i)}" y="${Y(paying + exp[i]) - 6}" text-anchor="middle">${usd(paying + exp[i])}</text>
      <text class="s-svg-text" x="${X(i)}" y="${H - 14}" text-anchor="middle">${lab}</text>`;
  });
  $("#sForecast").innerHTML = svg;
}

/* ------------------------------------------------ Deal drawer */
async function salesOpen(id) {
  let data;
  try { data = await api(`/api/workspaces/${S.ws.id}/deals/${id}`); } catch (e) { toast(e.message, true); return; }
  SALES.openId = id;
  const d = data.deal, tasks = SALES.meta.tasks;
  const drawer = salesDrawerEl();
  const latestDraft = (task) => data.activities.find((a) => a.type === "ai_draft" && a.task === task);
  drawer.innerHTML = `
    <div class="row gap-12"><span class="s-logo lg" style="background:${hueFor(d.id)}">${esc(initials(d.name))}</span>
      <div style="flex:1;min-width:0"><h2>${esc(d.name)}</h2><span class="subtle">${esc(d.category || "Store")} · ${esc(d.city)} · ${esc(d.platform)}</span></div>
      <button class="btn btn-sm" data-saction="close">Close</button></div>
    <div class="s-facts">
      <div class="card s-fact"><span class="eyebrow">Products</span><b class="num">${Number(d.skus).toLocaleString("en-US")}</b></div>
      <div class="card s-fact"><span class="eyebrow">Best plan</span><b>${d.plan}</b><span class="subtle s-small num">${usd(d.plan_usd)}/mo · SAR ${d.plan_sar.toLocaleString("en-US")}</span></div>
      <div class="card s-fact"><span class="eyebrow">Quiet for</span><b class="num">${d.days_quiet} ${d.days_quiet === 1 ? "day" : "days"}</b></div>
    </div>
    <div class="card card-pad stack"><h3>Stage</h3><div class="s-stages">${SALES.meta.stages.map((s) => `<button class="chip ${s.id === d.stage ? "active" : ""}" aria-pressed="${s.id === d.stage}" data-sstage-set="${s.id}">${s.name}</button>`).join("")}</div></div>
    <div class="card card-pad stack s-nextbox ${d.next.owner}">
      <span class="eyebrow">${d.next.owner === "you" ? "Next step · needs you" : "Next step · AI drafts it, you review and send"}</span>
      <p style="font-weight:500">${esc(d.next.text)}</p>
      ${d.next.task ? `<div><button class="btn btn-primary btn-sm" data-sai="${d.next.task}">AI: draft this now</button></div>` : ""}
    </div>
    <div class="card card-pad stack"><div class="row between"><h3>AI drafts</h3><span class="subtle s-small">Nothing is sent until you mark it sent</span></div>
      <div class="row gap-8" style="flex-wrap:wrap">${Object.entries(tasks).map(([k, t]) => `<button class="btn btn-sm" data-sai="${k}" title="${esc(t.agent)}">${esc(t.title)}${latestDraft(k) ? " ✓" : ""}</button>`).join("")}</div>
      <div id="sDraft" class="s-draft" hidden></div>
    </div>
    <form class="card card-pad stack" id="sEdit">
      <h3>Store details</h3>
      <div class="s-form">
        <div class="field"><label for="se-name">Store name</label><input class="input" id="se-name" value="${esc(d.name)}" required></div>
        <div class="field"><label for="se-cat">Category</label><input class="input" id="se-cat" value="${esc(d.category || "")}"></div>
        <div class="field"><label for="se-city">City</label><select class="input" id="se-city">${Object.keys(SALES.meta.cities).map((c) => `<option ${c === d.city ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><label for="se-plat">Platform</label><select class="input" id="se-plat">${SALES.meta.platforms.map((p) => `<option ${p === d.platform ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div class="field"><label for="se-skus">Products</label><input class="input" id="se-skus" type="number" min="0" value="${d.skus}"></div>
        <div class="field"><label for="se-contact">Contact name</label><input class="input" id="se-contact" value="${esc(d.contact_name || "")}"></div>
        <div class="field"><label for="se-phone">WhatsApp / phone</label><input class="input" id="se-phone" value="${esc(d.contact_phone || "")}" placeholder="+966…"></div>
        <div class="field"><label for="se-email">Email</label><input class="input" id="se-email" type="email" value="${esc(d.contact_email || "")}"></div>
      </div>
      <div class="field"><label for="se-notes">Notes</label><textarea class="input" id="se-notes" rows="3" placeholder="What you know about this store">${esc(d.notes || "")}</textarea></div>
      <div class="row between"><button class="btn btn-ghost btn-danger btn-sm" type="button" data-saction="delete">Delete deal</button><button class="btn btn-primary btn-sm" type="submit">Save details</button></div>
    </form>
    <div class="card card-pad stack"><h3>Activity</h3>
      <form class="row gap-8" id="sNote"><input class="input" id="sn-text" placeholder="Log a call or note…" style="flex:1"><button class="btn btn-sm" type="submit">Log</button></form>
      <ul class="s-timeline">${data.activities.map((a) => `<li>${ownerBadge(a.by)}<div style="min-width:0"><span class="s-small">${esc(salesActivityLabel(a))}</span>${a.text && a.type !== "ai_draft" ? `<p class="s-small muted">${esc(a.text.slice(0, 400))}</p>` : ""}${a.type === "ai_draft" ? `<button class="s-link s-small" data-sdraft="${a.id}">Show draft</button>` : ""}</div><span class="subtle s-small num" style="margin-left:auto;white-space:nowrap">${fmtDate(a.created_at)}</span></li>`).join("")}</ul>
    </div>`;
  drawer.hidden = false; $("#sScrim").hidden = false;
  drawer._data = data;
  drawer.querySelector('[data-saction="close"]').focus();
}

function salesActivityLabel(a) {
  const t = SALES.meta.tasks[a.task]?.title;
  return { created: "Deal created", stage: `Stage: ${a.text}`, ai_draft: `${SALES.meta.tasks[a.task]?.agent || "AI"} drafted: ${t || "message"}`, sent: `Sent: ${t || "message"}`, note: "Note", call: "Call" }[a.type] || a.type;
}

function salesDrawerEl() {
  let el = $("#sDrawer");
  if (!el) {
    document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="sScrim" hidden></div><aside class="s-drawer" id="sDrawer" hidden aria-label="Deal"></aside>`);
    el = $("#sDrawer");
  }
  return el;
}
function salesClose() { const d = $("#sDrawer"); if (d) { d.hidden = true; $("#sScrim").hidden = true; } SALES.openId = null; }

function salesShowDraft(text, { task, streaming = false, activityId = null } = {}) {
  const box = $("#sDraft");
  box.hidden = false;
  box.innerHTML = `<div class="doc s-draft-body">${md(text)}</div>
    ${streaming ? `<p class="subtle s-small">Writing…</p>` : `<div class="row gap-8" style="flex-wrap:wrap">
      <button class="btn btn-sm" data-scopy>Copy</button>
      ${task && task !== "prospect_page" && task !== "objections" ? `<button class="btn btn-primary btn-sm" data-ssent="${task}">I sent it</button>` : ""}
      <span class="subtle s-small">Review before sending. AI never sends on its own.</span></div>`}`;
  box._text = text;
}

async function salesDraft(task) {
  const id = SALES.openId;
  salesShowDraft("", { task, streaming: true });
  document.querySelectorAll("[data-sai]").forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/workspaces/${S.ws.id}/deals/${id}/ai/${task}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = "", last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (Date.now() - last > 150) { last = Date.now(); salesShowDraft(text.split("\n\n[[MWIZ_")[0], { task, streaming: true }); }
    }
    const err = text.split("[[MWIZ_ERROR]]")[1];
    if (err !== undefined) throw new Error(err.trim());
    const body = text.split("\n\n[[MWIZ_")[0];
    await salesOpen(id);
    salesShowDraft(body, { task });
    await salesLoad(); salesRerender();
  } catch (e) {
    $("#sDraft").innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message || "Couldn't write the draft. Try again.")}</div>`;
  } finally {
    document.querySelectorAll("[data-sai]").forEach((b) => (b.disabled = false));
  }
}

async function salesUpdate(id, body, msg) {
  await api(`/api/workspaces/${S.ws.id}/deals/${id}`, { method: "PUT", body: JSON.stringify(body) });
  await salesLoad(); salesRerender();
  if (SALES.openId === id) await salesOpen(id);
  if (msg) toast(msg);
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    const tab = t.closest("[data-stab]");
    if (tab) { SALES.tab = tab.dataset.stab; document.querySelectorAll("[data-stab]").forEach((b) => b.setAttribute("aria-selected", b === tab)); salesRerender(); return; }
    const act = t.closest("[data-saction]");
    if (act) {
      const a = act.dataset.saction;
      if (a === "add") {
        if (SALES.tab !== "board") { SALES.tab = "board"; salesRerender(); document.querySelectorAll("[data-stab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.stab === "board")); }
        const f = $("#sAdd"); f.hidden = !f.hidden; if (!f.hidden) $("#sa-name").focus();
      }
      if (a === "close") salesClose();
      if (a === "delete") {
        if (act.dataset.confirm !== "1") { act.dataset.confirm = "1"; act.textContent = "Click again to delete"; return; }
        await api(`/api/workspaces/${S.ws.id}/deals/${SALES.openId}`, { method: "DELETE" });
        salesClose(); await salesLoad(); salesRerender(); toast("Deal deleted");
      }
      return;
    }
    if (t.closest("#sScrim")) { salesClose(); return; }
    const st = t.closest("[data-sstage-set]");
    if (st) { await salesUpdate(SALES.openId, { stage: st.dataset.sstageSet }, "Stage updated"); return; }
    const ai = t.closest("[data-sai]");
    if (ai) { await salesDraft(ai.dataset.sai); return; }
    const sd = t.closest("[data-sdraft]");
    if (sd) { const a = $("#sDrawer")._data.activities.find((x) => x.id === sd.dataset.sdraft); if (a) salesShowDraft(a.text, { task: a.task }); $("#sDraft").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (t.closest("[data-scopy]")) {
      const text = $("#sDraft")._text || "";
      try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Clipboard blocked by the browser", true); }
      return;
    }
    const sent = t.closest("[data-ssent]");
    if (sent) {
      await api(`/api/workspaces/${S.ws.id}/deals/${SALES.openId}/activities`, { method: "POST", body: JSON.stringify({ type: "sent", task: sent.dataset.ssent, text: $("#sDraft")._text || "" }) });
      const d = SALES.deals.find((x) => x.id === SALES.openId);
      if (d && d.stage === "lead" && sent.dataset.ssent === "opener") await salesUpdate(d.id, { stage: "contacted" }, "Logged as sent · moved to Contacted");
      else { await salesLoad(); salesRerender(); await salesOpen(SALES.openId); toast("Logged as sent"); }
      return;
    }
    const open = t.closest("[data-sopen]");
    if (open && !t.closest(".s-drawer")) { salesOpen(open.dataset.sopen); return; }
    if (open) { salesOpen(open.dataset.sopen); }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("submit", async (e) => {
  try {
    if (e.target.id === "sAdd") {
      e.preventDefault();
      const body = { name: $("#sa-name").value, category: $("#sa-cat").value, city: $("#sa-city").value, platform: $("#sa-plat").value, skus: $("#sa-skus").value, contact_name: $("#sa-contact").value };
      const d = await api(`/api/workspaces/${S.ws.id}/deals`, { method: "POST", body: JSON.stringify(body) });
      await salesLoad(); salesRerender(); toast(`${d.name} added · AI is ready to draft the opener`);
      salesOpen(d.id);
    }
    if (e.target.id === "sEdit") {
      e.preventDefault();
      await salesUpdate(SALES.openId, { name: $("#se-name").value, category: $("#se-cat").value, city: $("#se-city").value, platform: $("#se-plat").value, skus: $("#se-skus").value, contact_name: $("#se-contact").value, contact_phone: $("#se-phone").value, contact_email: $("#se-email").value, notes: $("#se-notes").value }, "Saved");
    }
    if (e.target.id === "sNote") {
      e.preventDefault();
      const text = $("#sn-text").value.trim();
      if (!text) return;
      await api(`/api/workspaces/${S.ws.id}/deals/${SALES.openId}/activities`, { method: "POST", body: JSON.stringify({ type: "note", text }) });
      await salesLoad(); salesRerender(); await salesOpen(SALES.openId);
    }
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#sDrawer") && !$("#sDrawer").hidden) salesClose(); });

// Drag and drop between stages.
let sDragId = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".s-card"); if (!c) return; sDragId = c.dataset.sopen; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
document.addEventListener("dragend", (e) => { e.target.closest?.(".s-card")?.classList.remove("dragging"); document.querySelectorAll(".s-col.over").forEach((c) => c.classList.remove("over")); });
document.addEventListener("dragover", (e) => { const col = e.target.closest?.(".s-col"); if (!col || !sDragId) return; e.preventDefault(); document.querySelectorAll(".s-col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
document.addEventListener("drop", async (e) => {
  const col = e.target.closest?.(".s-col");
  if (!col || !sDragId) return;
  e.preventDefault();
  const id = sDragId; sDragId = null;
  const d = SALES.deals.find((x) => x.id === id);
  if (!d || d.stage === col.dataset.sstage) return salesRerender();
  try { await salesUpdate(id, { stage: col.dataset.sstage }, `${d.name} → ${SALES.meta.stages.find((s) => s.id === col.dataset.sstage).name}`); }
  catch (err) { toast(err.message, true); }
});

// If the page opened straight on the pipeline before this file loaded, draw it now.
if (S.route === "pipeline" && S.ws) render();
