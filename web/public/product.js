/* Product module: roadmap (Now / Next / Later), impact-vs-effort matrix, customer feedback
   with AI clustering, releases with AI changelogs (EN + AR). Uses app.js globals
   (S, $, api, esc, md, toast, fmtDate, ROUTES). AI collects, groups, scores and writes;
   people decide what gets built and approve each release. */

const PRD = { meta: null, d: null, tab: "roadmap", open: null, clusters: null };
const P_COL = { building: "var(--accent)", planned: "#8a7cf0", idea: "var(--text-3)", released: "var(--good)", not_doing: "var(--bad)" };
const TYPE_TONE = { feature: "accent", integration: "warn", improvement: "", bug: "bad" };

ROUTES.product = { title: "Product", crumb: "Product", render: renderProduct };

async function prdLoad() {
  if (!PRD.meta) PRD.meta = await api("/api/product/meta");
  PRD.d = await api(`/api/workspaces/${S.ws.id}/product`);
}
const prdItem = (id) => PRD.d.snapshot.items.find((i) => i.id === id);

async function renderProduct(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await prdLoad();
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Product views">
    ${[["roadmap", "Roadmap"], ["feedback", "Feedback"], ["releases", "Releases"]].map(([k, l]) => `<button role="tab" data-ptab="${k}" aria-selected="${PRD.tab === k}">${l}</button>`).join("")}</div>
    <button class="btn btn-primary" data-paction="new-item">Add idea</button>`;
  view.innerHTML = `<section class="s-kpis" id="pKpis"></section><div id="pBody" style="margin-top:20px"></div>`;
  prdRerender();
}

function prdRerender() {
  if (S.route !== "product") return;
  const s = PRD.d.snapshot;
  const tile = (label, val, sub, tone = "", tab = "") => `<div class="card s-kpi ${tone} ${tab ? "clickable" : ""}" ${tab ? `data-ptab="${tab}"` : ""}><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#pKpis").innerHTML = [
    tile("Now", s.counts.now, "being built", "", "roadmap"),
    tile("Next", s.counts.next, "approved, not started", "", "roadmap"),
    tile("Later", s.counts.later, "ideas and requests", "", "roadmap"),
    tile("Feedback", s.feedback.total, `${s.feedback.unlinked} not grouped · ${s.feedback.week} this week`, s.feedback.unlinked >= 5 ? "warn" : "", "feedback"),
    tile("Top request", s.top_requested[0] ? s.top_requested[0].votes : "–", s.top_requested[0] ? esc(s.top_requested[0].title) : "link feedback to items"),
    tile("Last release", s.last_release ? esc(s.last_release.version) : "–", s.last_release ? s.last_release.date : `${s.counts.released} items released`, "", "releases"),
  ].join("");
  ({ roadmap: prdRoadmap, feedback: prdFeedback, releases: prdReleases })[PRD.tab]();
}

/* ------------------------------------------------ Roadmap */
function prdCard(i) {
  return `<button type="button" class="s-card p-card" data-pitem="${i.id}">
    <div class="row between gap-8"><b class="o-title">${esc(i.title)}</b><span class="p-score num" title="Priority score">${i.score}</span></div>
    <div class="s-meta"><span class="badge ${TYPE_TONE[i.type]}">${i.type}</span><span>${esc(i.area)}</span><span>· effort ${i.effort}</span>${i.votes ? `<span class="p-votes">▲ ${i.votes}</span>` : ""}${i.target ? `<span class="s-age">${i.target}</span>` : ""}</div>
    ${i.source === "ai" && !i.reviewed ? `<div class="s-next warm"><span class="s-owner ai">AI</span><span>Suggested from feedback: approve or decline</span></div>` : i.starter ? `<span class="subtle s-small">Starter item: confirm the status</span>` : ""}
  </button>`;
}

function prdMatrix(items) {
  const pts = items.filter((i) => ["idea", "planned", "building"].includes(i.status));
  if (!pts.length) return "";
  const W = 560, H = 300, L = 44, R = 16, T = 16, B = 36;
  const ex = { S: 0, M: 1, L: 2 };
  const X = (e) => L + ((ex[e] + 0.5) / 3) * (W - L - R), Y = (v) => T + (H - T - B) * (1 - (v - 0.5) / 10);
  let svg = `<rect x="${L}" y="${T}" width="${(W - L - R) / 3 * 1.5}" height="${(H - T - B) / 2}" fill="var(--good-soft)" opacity=".6"></rect>
    <text class="s-svg-mono" x="${L + 8}" y="${T + 16}">Quick wins</text><text class="s-svg-mono" x="${W - R - 8}" y="${T + 16}" text-anchor="end">Big bets</text>
    <text class="s-svg-mono" x="${L + 8}" y="${H - B - 8}">Fill-ins</text><text class="s-svg-mono" x="${W - R - 8}" y="${H - B - 8}" text-anchor="end">Think twice</text>`;
  for (let v = 2; v <= 10; v += 2) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"></line><text class="s-svg-mono" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  ["S", "M", "L"].forEach((e) => { svg += `<text class="s-svg-text" x="${X(e)}" y="${H - 12}" text-anchor="middle">Effort ${e}</text>`; });
  svg += `<text class="s-svg-mono" x="12" y="${T + (H - T - B) / 2}" transform="rotate(-90 12 ${T + (H - T - B) / 2})" text-anchor="middle">Impact</text>`;
  const jit = {};
  for (const i of pts) {
    const k = i.effort + Math.round(i.impact);
    const n = (jit[k] = (jit[k] || 0) + 1) - 1;
    const x = X(i.effort) + ((n % 5) - 2) * 22, y = Y(i.impact) + Math.floor(n / 5) * 10;
    const r = 6 + Math.min(10, i.votes * 2);
    svg += `<g class="p-dot" data-pitem="${i.id}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${r}" fill="${P_COL[i.status]}" fill-opacity=".75" stroke="var(--surface)" stroke-width="1.5"></circle><title>${esc(i.title)}: impact ${i.impact}, effort ${i.effort}, ${i.votes} requests, score ${i.score}</title></g>`;
  }
  return `<section class="card card-pad cc-span-6"><div class="row between"><span class="eyebrow">Impact vs effort</span><div class="s-legend" style="margin:0">${[["building", "Now"], ["planned", "Next"], ["idea", "Later"]].map(([k, l]) => `<span><i class="s-dot" style="background:${P_COL[k]}"></i>${l}</span>`).join("")}</div></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:8px" role="img" aria-label="Impact versus effort">${svg}</svg>
    <p class="subtle s-small">Bubble size = customer requests. Click a bubble to open it.</p></section>`;
}

function prdRoadmap() {
  const s = PRD.d.snapshot, items = s.items;
  if (!items.length) {
    $("#pBody").innerHTML = `<div class="card empty"><h2>Start your roadmap</h2><p>Load a starter roadmap built from your Brief (Salla, Zid and Shopify apps, public API, Arabic templates, catalog video, AI Creative QA, AI Feed Doctor, direct export). Confirm each status after.</p>
      <div class="row gap-8" style="justify-content:center"><button class="btn btn-primary" data-paction="starter">Load DPA AD starter roadmap</button><button class="btn" data-paction="new-item">Add idea</button></div></div>`;
    return;
  }
  const col = (st) => s.columns[st].map(prdItem);
  $("#pBody").innerHTML = `<div class="cc">
    ${prdMatrix(items)}
    <section class="card card-pad cc-span-6 stack">
      <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${s.needs.length ? "warn" : "good"}">${s.needs.length || "All clear"}</span></div>
      ${s.needs.length ? `<ul class="cc-list">${s.needs.map((n) => `<li class="clickable" data-ptab="${n.tab}"><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small">${esc(n.text)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Nothing waiting on a decision.</p>`}
      <div style="border-top:1px solid var(--border);padding-top:12px"><span class="eyebrow">Most requested</span>
        ${s.top_requested.length ? `<ul class="cc-list">${s.top_requested.map((t) => `<li class="clickable" data-pitem="${t.id}"><span class="p-votes">▲ ${t.votes}</span><span class="s-small">${esc(t.title)}</span></li>`).join("")}</ul>` : `<p class="muted s-small">Link customer feedback to items to see what's most requested.</p>`}</div>
    </section>
  </div>
  <div class="s-board p-board" style="margin-top:16px">${["building", "planned", "idea", "released"].map((st) => {
    const meta = PRD.meta.statuses.find((x) => x.id === st), list = col(st);
    return `<div class="s-col" data-pstage="${st}"><div class="s-col-head"><h3><i class="s-dot" style="background:${P_COL[st]}"></i>${meta.name} <span class="subtle num">${list.length}</span></h3><small class="subtle">${meta.hint}</small></div>
      ${list.slice(0, st === "released" ? 12 : 100).map(prdCard).join("") || `<p class="subtle s-small" style="padding:4px">Drop an item here</p>`}</div>`;
  }).join("")}</div>
  ${s.columns.not_doing.length ? `<details class="card card-pad" style="margin-top:16px"><summary><b>Not doing</b> <span class="subtle num">${s.columns.not_doing.length}</span></summary><ul class="cc-list">${col("not_doing").map((i) => `<li class="clickable" data-pitem="${i.id}"><span class="s-small"><b>${esc(i.title)}</b> · ${esc(i.reason || "")}</span></li>`).join("")}</ul></details>` : ""}`;
}

/* ------------------------------------------------ Feedback */
function prdFeedback() {
  const fb = [...PRD.d.feedback].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const items = PRD.d.snapshot.items.filter((i) => i.status !== "not_doing");
  const open = fb.filter((f) => !f.item_id && !f.dismissed), done = fb.filter((f) => f.item_id || f.dismissed);
  const row = (f) => `<li><span class="s-owner ${f.source === "support" ? "ai" : "you"}" style="${f.source === "manual" ? "background:var(--surface-2);color:var(--text-2)" : ""}">${f.source.toUpperCase()}</span>
    <div style="flex:1;min-width:0"><p class="s-small p-fb" dir="auto">${esc(f.text)}</p><span class="subtle s-small">${esc(f.customer || "")}${f.customer ? " · " : ""}${fmtDate(f.created_at)}${f.kind ? " · " + f.kind : ""}</span></div>
    <select class="input input-sm p-link" data-pfblink="${f.id}" aria-label="Link to roadmap item"><option value="">Link to item…</option>${items.map((i) => `<option value="${i.id}" ${i.id === f.item_id ? "selected" : ""}>${esc(i.title)}</option>`).join("")}</select>
    ${f.item_id ? "" : `<button class="btn btn-sm btn-ghost" data-pfbdismiss="${f.id}" title="Not product feedback">Dismiss</button>`}</li>`;
  $("#pBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Customer feedback</h2><p class="subtle s-small">Requests and bugs from Support, Sales and your own notes. AI groups them into themes and matches each to a roadmap item, or suggests a new one for you to approve.</p></div>
      <div class="row gap-8" style="flex-wrap:wrap"><button class="btn" data-paction="import-support">Import from Support</button><button class="btn" data-paction="cluster" ${open.length ? "" : "disabled"}>AI: group ${open.length} into themes</button></div></div>
    <form class="card card-pad row gap-8" id="pFb" style="flex-wrap:wrap;margin-bottom:16px">
      <input class="input" id="pf-text" placeholder="What did the customer ask for or complain about?" style="flex:2;min-width:220px" required>
      <input class="input" id="pf-cust" placeholder="Customer / store" style="flex:1;min-width:140px">
      <select class="input" id="pf-src" style="width:auto"><option value="manual">Manual</option><option value="sales">Sales</option><option value="support">Support</option></select>
      <button class="btn btn-primary" type="submit">Add</button></form>
    <div id="pClusters"></div>
    <section class="card" style="margin-bottom:16px"><div class="card-head" style="padding:14px 20px"><h3>Not grouped yet <span class="subtle num">${open.length}</span></h3></div>
      <ul class="list p-fblist">${open.map(row).join("") || `<li class="subtle s-small">Everything is grouped. Import from Support or add feedback from sales calls.</li>`}</ul></section>
    ${done.length ? `<details class="card"><summary style="padding:14px 20px"><b>Grouped or dismissed</b> <span class="subtle num">${done.length}</span></summary><ul class="list p-fblist">${done.map(row).join("")}</ul></details>` : ""}`;
}

function prdClusters() {
  const c = PRD.clusters, fbText = (id) => PRD.d.feedback.find((f) => f.id === id)?.text || "";
  $("#pClusters").innerHTML = `<section class="card card-pad stack" style="margin-bottom:16px"><div class="row between"><h3>AI grouped the feedback into ${c.length} theme${c.length === 1 ? "" : "s"}</h3><span class="subtle s-small">Untick anything you don't agree with</span></div>
    ${c.map((x, i) => `<label class="p-cluster"><input type="checkbox" data-pc="${i}" checked> <div style="min-width:0"><b>${esc(x.theme)}</b> · ${x.feedback_ids.length} request${x.feedback_ids.length === 1 ? "" : "s"} →
      ${x.existing_item_id ? `existing item <b>${esc(prdItem(x.existing_item_id)?.title || "")}</b>` : `<span class="s-owner ai">NEW</span> <b>${esc(x.new_item.title)}</b> <span class="subtle s-small">(${x.new_item.area}, effort ${x.new_item.effort}, impact ${x.new_item.impact})</span>`}
      <ul class="s-small muted" style="margin:4px 0 0;padding-left:18px">${x.feedback_ids.slice(0, 3).map((id) => `<li dir="auto">${esc(fbText(id).slice(0, 140))}</li>`).join("")}</ul></div></label>`).join("")}
    <div class="row gap-8"><button class="btn btn-primary" data-paction="apply-clusters">Apply selected</button><button class="btn" data-paction="discard-clusters">Discard</button><span class="subtle s-small">New items go to Later as AI suggestions for you to approve.</span></div></section>`;
}

/* ------------------------------------------------ Releases */
function prdReleases() {
  const rel = [...PRD.d.releases].sort((a, b) => (b.date || "9999").localeCompare(a.date || "9999") || b.created_at.localeCompare(a.created_at));
  const ready = PRD.d.snapshot.items.filter((i) => i.status === "building" || i.status === "planned");
  $("#pBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Releases</h2><p class="subtle s-small">Bundle items into a release. AI writes the changelog in English and Arabic, an announcement and a help-center article. A person approves go/no-go; releasing marks its items Released.</p></div>
      <button class="btn btn-primary" data-paction="new-release">New release</button></div>
    <form class="card card-pad stack" id="pRel" hidden>
      <div class="row gap-8" style="flex-wrap:wrap"><div class="field"><label for="pr-ver">Version</label><input class="input" id="pr-ver" placeholder="v0.4" required></div><div class="field"><label for="pr-date">Planned date</label><input class="input" id="pr-date" type="date"></div></div>
      <div class="field"><span class="s-small" style="font-weight:500">Items in this release</span><div class="p-pick">${ready.map((i) => `<label class="row gap-8 s-small"><input type="checkbox" data-pri="${i.id}" ${i.status === "building" ? "checked" : ""}> ${esc(i.title)} <span class="subtle">(${i.status === "building" ? "Now" : "Next"})</span></label>`).join("") || `<span class="subtle s-small">Move items to Now or Next first.</span>`}</div></div>
      <div class="row gap-8"><button class="btn btn-primary" type="submit">Create draft release</button><button class="btn" type="button" data-paction="new-release">Cancel</button></div>
    </form>
    ${rel.length ? rel.map((r) => { const its = (r.item_ids || []).map(prdItem).filter(Boolean); const docs = PRD.d.docs.filter((d) => d.release_id === r.id);
      return `<section class="card card-pad stack p-rel" style="margin-bottom:16px">
        <div class="row between" style="flex-wrap:wrap;gap:8px"><div class="row gap-12"><h2>${esc(r.version)}</h2><span class="badge ${r.status === "released" ? "good" : "warn"}">${r.status === "released" ? "Released " + r.date : "Draft" + (r.date ? " · planned " + r.date : "")}</span></div>
          <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-prelai="${r.id}">AI: changelog + notes (EN + AR)</button>${r.status === "draft" ? `<button class="btn btn-sm btn-primary" data-prelgo="${r.id}">Approve and release</button><button class="btn btn-sm btn-ghost btn-danger" data-preldel="${r.id}">Delete</button>` : ""}</div></div>
        <ul class="cc-list">${its.map((i) => `<li class="clickable" data-pitem="${i.id}"><span class="badge ${TYPE_TONE[i.type]}">${i.type}</span><span class="s-small">${esc(i.title)}</span></li>`).join("") || `<li class="subtle s-small">No items.</li>`}</ul>
        ${docs.length ? `<div class="row gap-8" style="flex-wrap:wrap">${docs.map((d) => `<button class="btn btn-sm btn-ghost" data-pdoc="${d.id}">${esc(d.title)} · ${fmtDate(d.created_at)}</button>`).join("")}</div>` : ""}
        <div class="s-draft p-draft" data-pdraftfor="${r.id}" hidden></div>
      </section>`; }).join("") : `<div class="card empty"><h2>No releases yet</h2><p>When items in Now are ready, bundle them into a release and let AI write the changelog in English and Arabic.</p></div>`}`;
}

/* ------------------------------------------------ Item drawer */
function pDrawerEl() {
  let el = $("#pDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="pScrim" hidden></div><aside class="s-drawer" id="pDrawer" hidden aria-label="Roadmap item"></aside>`); el = $("#pDrawer"); }
  return el;
}
function pClose() { const d = $("#pDrawer"); if (d) { d.hidden = true; $("#pScrim").hidden = true; } PRD.open = null; }

function prdOpen(id) {
  const i = prdItem(id); if (!i) return;
  PRD.open = id;
  const M = PRD.meta, fb = PRD.d.feedback.filter((f) => f.item_id === id), docs = PRD.d.docs.filter((d) => d.item_id === id);
  const el = pDrawerEl();
  el.innerHTML = `
    <div class="row gap-12"><span class="badge ${TYPE_TONE[i.type]}">${i.type}</span><div style="flex:1;min-width:0"><h2>${esc(i.title)}</h2><span class="subtle">${esc(i.area)} · score ${i.score} · ${i.votes} request${i.votes === 1 ? "" : "s"}</span></div><button class="btn btn-sm" data-paction="close">Close</button></div>
    ${i.source === "ai" && !i.reviewed ? `<div class="card card-pad s-nextbox you stack"><span class="eyebrow">AI suggested this from customer feedback</span><p>Approve it into Next, keep it in Later, or decline it with a reason.</p>
      <div class="row gap-8"><button class="btn btn-primary btn-sm" data-pset="planned">Approve to Next</button><button class="btn btn-sm" data-pkeep>Keep in Later</button></div></div>` : ""}
    <div class="card card-pad stack"><h3>Status</h3><div class="s-stages">${M.statuses.map((s) => `<button class="chip ${s.id === i.status ? "active" : ""}" data-pset="${s.id}">${s.name}</button>`).join("")}</div>
      <div class="row gap-8" id="pReasonRow" ${i.status === "not_doing" ? "" : "hidden"}><input class="input input-sm" id="p-reason" placeholder="Why not? (required)" value="${esc(i.reason || "")}" style="flex:1"><button class="btn btn-sm" data-paction="save-reason">Save reason</button></div></div>
    <div class="card card-pad stack"><div class="row between"><h3>Spec</h3><button class="btn btn-sm" data-paction="spec">AI: write the spec</button></div>
      ${docs.length ? `<div class="row gap-8" style="flex-wrap:wrap">${docs.map((d) => `<button class="btn btn-sm btn-ghost" data-pdoc="${d.id}">${esc(d.title)} · ${fmtDate(d.created_at)}</button>`).join("")}</div>` : `<p class="subtle s-small">AI writes a one-page spec from the problem and linked customer feedback: scope, user flow (with Arabic/RTL notes), edge cases, AI vs person, rollout.</p>`}
      <div id="pSpec" class="s-draft" hidden></div></div>
    <form class="card card-pad stack" id="pItemForm"><h3>Details</h3>
      <div class="field"><label for="pi-title">Title</label><input class="input" id="pi-title" value="${esc(i.title)}" required></div>
      <div class="field"><label for="pi-problem">Customer problem</label><textarea class="input" id="pi-problem" rows="2">${esc(i.problem || "")}</textarea></div>
      <div class="s-form">
        <div class="field"><label for="pi-type">Type</label><select class="input" id="pi-type">${M.types.map((t) => `<option ${t === i.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label for="pi-area">Area</label><select class="input" id="pi-area">${M.areas.map((a) => `<option ${a === i.area ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
        <div class="field"><label for="pi-effort">Effort</label><select class="input" id="pi-effort">${M.effort.map((e) => `<option ${e === i.effort ? "selected" : ""}>${e}</option>`).join("")}</select></div>
        <div class="field"><label for="pi-target">Target month</label><input class="input" id="pi-target" type="month" value="${i.target || ""}"></div>
        <div class="field"><label for="pi-impact">Impact (1-10)</label><input class="input" id="pi-impact" type="number" min="1" max="10" value="${i.impact}"></div>
        <div class="field"><label for="pi-conf">Confidence (%)</label><input class="input" id="pi-conf" type="number" min="0" max="100" value="${i.confidence}"></div>
      </div>
      <div class="field"><label for="pi-notes">Notes</label><textarea class="input" id="pi-notes" rows="2">${esc(i.notes || "")}</textarea></div>
      <div class="row between"><button class="btn btn-ghost btn-danger btn-sm" type="button" data-paction="delete-item">Delete</button><button class="btn btn-primary btn-sm" type="submit">Save</button></div>
    </form>
    <div class="card card-pad stack"><h3>Customer requests <span class="subtle num">${fb.length}</span></h3>
      ${fb.length ? `<ul class="s-timeline">${fb.map((f) => `<li><span class="s-owner ${f.source === "support" ? "ai" : "you"}">${f.source.toUpperCase()}</span><span class="s-small" dir="auto" style="flex:1">${esc(f.text.slice(0, 300))}</span><span class="subtle s-small">${esc(f.customer || "")}</span></li>`).join("")}</ul>` : `<p class="subtle s-small">No feedback linked yet. Link requests in the Feedback tab.</p>`}</div>`;
  el.hidden = false; $("#pScrim").hidden = false;
}

/* ------------------------------------------------ AI streaming */
async function prdStream(url, box, onDone) {
  box.hidden = false; box.innerHTML = `<p class="subtle s-small">AI is writing…</p>`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let text = "", last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (Date.now() - last > 150) { last = Date.now(); box.innerHTML = `<div class="doc s-draft-body">${md(text.split("\n\n[[MWIZ_")[0])}</div>`; } }
    const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
    const id = (text.split("[[MWIZ_SAVED]]")[1] || "").trim();
    await prdLoad(); onDone(text.split("\n\n[[MWIZ_")[0], id);
  } catch (e) { box.innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message)}</div>`; }
}
function prdShowDoc(box, text, docId, kind) {
  box.hidden = false; box._text = text;
  box.innerHTML = `<div class="doc s-draft-body">${md(text)}</div><div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-pcopy>Copy</button>${kind === "release" ? `<button class="btn btn-sm" data-ptohc="${docId}">Add article to help center</button>` : ""}<span class="subtle s-small">Draft for review. Nothing is published.</span></div>`;
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target, base = () => `/api/workspaces/${S.ws.id}/product`;
  try {
    const tab = t.closest("[data-ptab]");
    if (tab && S.route === "product") { PRD.tab = tab.dataset.ptab; document.querySelectorAll("[data-ptab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ptab === PRD.tab)); prdRerender(); return; }
    if (t.closest("#pScrim")) return pClose();
    const it = t.closest("[data-pitem]"); if (it && !t.closest("#pDrawer")) return prdOpen(it.dataset.pitem);
    const set = t.closest("[data-pset]");
    if (set) {
      const st = set.dataset.pset;
      if (st === "not_doing" && !prdItem(PRD.open).reason) { $("#pReasonRow").hidden = false; $("#p-reason").focus(); return toast("Say why it's not being done, then save the reason", true); }
      await api(`${base()}/items/${PRD.open}`, { method: "PUT", body: JSON.stringify({ status: st }) }); await prdLoad(); prdRerender(); prdOpen(PRD.open); return toast("Status updated");
    }
    if (t.closest("[data-pkeep]")) { await api(`${base()}/items/${PRD.open}`, { method: "PUT", body: JSON.stringify({ reviewed: true }) }); await prdLoad(); prdRerender(); prdOpen(PRD.open); return toast("Kept in Later"); }
    const doc = t.closest("[data-pdoc]");
    if (doc) { const d = await api(`${base()}/docs/${doc.dataset.pdoc}`); const box = d.kind === "spec" ? $("#pSpec") : document.querySelector(`[data-pdraftfor="${d.release_id}"]`); if (box) prdShowDoc(box, d.text, d.id, d.kind); return; }
    const relai = t.closest("[data-prelai]"); if (relai) { const box = document.querySelector(`[data-pdraftfor="${relai.dataset.prelai}"]`); relai.disabled = true; await prdStream(`${base()}/releases/${relai.dataset.prelai}/ai`, box, (text, id) => { prdRerender(); const b2 = document.querySelector(`[data-pdraftfor="${relai.dataset.prelai}"]`); prdShowDoc(b2, text, id, "release"); }); return; }
    const go = t.closest("[data-prelgo]"); if (go) { if (go.dataset.confirm !== "1") { go.dataset.confirm = "1"; go.textContent = "Click again: ship it"; return; } await api(`${base()}/releases/${go.dataset.prelgo}`, { method: "PUT", body: JSON.stringify({ status: "released" }) }); await prdLoad(); prdRerender(); return toast("Released. Items moved to Released."); }
    const rd = t.closest("[data-preldel]"); if (rd) { if (rd.dataset.confirm !== "1") { rd.dataset.confirm = "1"; rd.textContent = "Sure?"; return; } await api(`${base()}/releases/${rd.dataset.preldel}`, { method: "DELETE" }); await prdLoad(); prdRerender(); return; }
    const hc = t.closest("[data-ptohc]"); if (hc) { const r = await api(`${base()}/docs/${hc.dataset.ptohc}/to-help-center`, { method: "POST", body: "{}" }); return toast(`Added ${r.added} article${r.added === 1 ? "" : "s"} to AI Support's help center`); }
    if (t.closest("[data-pcopy]")) { const box = t.closest(".s-draft"); try { await navigator.clipboard.writeText(box._text || ""); toast("Copied"); } catch { toast("Clipboard blocked by the browser", true); } return; }
    const dis = t.closest("[data-pfbdismiss]"); if (dis) { await api(`${base()}/feedback/${dis.dataset.pfbdismiss}`, { method: "PUT", body: JSON.stringify({ dismissed: true }) }); await prdLoad(); prdRerender(); return; }
    const a = t.closest("[data-paction]"); if (!a) return;
    const act = a.dataset.paction;
    if (act === "close") return pClose();
    if (act === "new-item") { const r = await api(`${base()}/items`, { method: "POST", body: JSON.stringify({ title: "New idea", status: "idea" }) }); await prdLoad(); prdRerender(); prdOpen(r.id); $("#pi-title").select(); return; }
    if (act === "starter") { const r = await api(`${base()}/items/starter`, { method: "POST", body: "{}" }); await prdLoad(); prdRerender(); return toast(`Added ${r.added} items. Confirm each status.`); }
    if (act === "import-support") { const r = await api(`${base()}/feedback/import-support`, { method: "POST", body: "{}" }); await prdLoad(); prdRerender(); return toast(r.added ? `Imported ${r.added} requests from Support` : "No new feature requests or bug reports in Support"); }
    if (act === "cluster") { a.disabled = true; a.textContent = "AI is grouping…"; try { const r = await api(`${base()}/feedback/cluster`, { method: "POST", body: "{}" }); PRD.clusters = r.clusters; prdClusters(); } finally { a.disabled = false; a.textContent = "AI: group into themes"; } return; }
    if (act === "apply-clusters") { const clusters = PRD.clusters.filter((_, i) => $(`[data-pc="${i}"]`).checked); const r = await api(`${base()}/feedback/apply-clusters`, { method: "POST", body: JSON.stringify({ clusters }) }); PRD.clusters = null; await prdLoad(); prdRerender(); return toast(`Linked ${r.linked} requests · ${r.created} new idea${r.created === 1 ? "" : "s"} to review`); }
    if (act === "discard-clusters") { PRD.clusters = null; $("#pClusters").innerHTML = ""; return; }
    if (act === "spec") { a.disabled = true; const id = PRD.open; await prdStream(`${base()}/items/${id}/ai/spec`, $("#pSpec"), (text, docId) => { prdRerender(); prdOpen(id); prdShowDoc($("#pSpec"), text, docId, "spec"); }); return; }
    if (act === "save-reason") { const reason = $("#p-reason").value.trim(); if (!reason) return toast("Write a reason first", true); await api(`${base()}/items/${PRD.open}`, { method: "PUT", body: JSON.stringify({ status: "not_doing", reason }) }); await prdLoad(); prdRerender(); prdOpen(PRD.open); return toast("Moved to Not doing"); }
    if (act === "delete-item") { if (a.dataset.confirm !== "1") { a.dataset.confirm = "1"; a.textContent = "Click again to delete"; return; } await api(`${base()}/items/${PRD.open}`, { method: "DELETE" }); pClose(); await prdLoad(); prdRerender(); return toast("Deleted"); }
    if (act === "new-release") { if (PRD.tab !== "releases") { PRD.tab = "releases"; prdRerender(); } const f = $("#pRel"); f.hidden = !f.hidden; if (!f.hidden) $("#pr-ver").focus(); return; }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("change", async (e) => {
  const l = e.target.closest?.("[data-pfblink]");
  if (!l) return;
  try { await api(`/api/workspaces/${S.ws.id}/product/feedback/${l.dataset.pfblink}`, { method: "PUT", body: JSON.stringify({ item_id: l.value || null }) }); await prdLoad(); prdRerender(); toast(l.value ? "Linked" : "Unlinked"); }
  catch (err) { toast(err.message, true); }
});

document.addEventListener("submit", async (e) => {
  const id = e.target.id;
  if (!["pFb", "pRel", "pItemForm"].includes(id)) return;
  e.preventDefault();
  const base = `/api/workspaces/${S.ws.id}/product`;
  try {
    if (id === "pFb") await api(`${base}/feedback`, { method: "POST", body: JSON.stringify({ text: $("#pf-text").value, customer: $("#pf-cust").value, source: $("#pf-src").value }) });
    if (id === "pRel") await api(`${base}/releases`, { method: "POST", body: JSON.stringify({ version: $("#pr-ver").value, date: $("#pr-date").value, item_ids: [...document.querySelectorAll("[data-pri]:checked")].map((c) => c.dataset.pri) }) });
    if (id === "pItemForm") await api(`${base}/items/${PRD.open}`, { method: "PUT", body: JSON.stringify({ title: $("#pi-title").value, problem: $("#pi-problem").value, type: $("#pi-type").value, area: $("#pi-area").value, effort: $("#pi-effort").value, target: $("#pi-target").value, impact: $("#pi-impact").value, confidence: $("#pi-conf").value, notes: $("#pi-notes").value }) });
    await prdLoad(); prdRerender(); if (id === "pItemForm") prdOpen(PRD.open);
    toast("Saved");
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#pDrawer") && !$("#pDrawer").hidden) pClose(); });

// Drag roadmap cards between Now / Next / Later / Released.
let pDrag = null;
document.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".p-card"); if (c) pDrag = c.dataset.pitem; });
document.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-pstage]"); if (col && pDrag) { e.preventDefault(); document.querySelectorAll(".s-col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); } });
document.addEventListener("drop", async (e) => {
  const col = e.target.closest?.("[data-pstage]"); if (!col || !pDrag) return;
  e.preventDefault(); const id = pDrag; pDrag = null;
  try { await api(`/api/workspaces/${S.ws.id}/product/items/${id}`, { method: "PUT", body: JSON.stringify({ status: col.dataset.pstage }) }); await prdLoad(); prdRerender(); }
  catch (err) { toast(err.message, true); }
});

if (S.route === "product" && S.ws) render();
