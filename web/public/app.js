"use strict";

/* ---------------------------------------------------------------- utils */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = (k) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtNum = (v) => (v === null || v === undefined || v === "" ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - y0) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in again."); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return (res.headers.get("content-type") || "").includes("json") ? res.json() : res.text();
}

marked.use({ gfm: true, breaks: false, renderer: { html: ({ text }) => esc(text) } });
const md = (text) => marked.parse(String(text || ""));

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3200);
}

/* ---------------------------------------------------------------- state */
const S = { health: null, playbooks: [], categories: [], workspaces: [], ws: null, route: "overview", param: null };

const BRIEF_SECTIONS = [
  { title: "Company", fields: [
    ["company_name", "Company name", "input", "Required"],
    ["product_name", "Product name", "input"],
    ["website", "Website", "input"],
    ["business_model", "Business model", "select", "", ["saas", "agency", "other"]],
    ["category", "Category", "input", "e.g. AI ad creatives for ecommerce"],
    ["one_liner", "One-liner", "textarea", "What the product does, in one sentence", null, true],
  ]},
  { title: "Market", fields: [
    ["target_customers", "Target customers", "textarea", "Store type, catalog size, country, buyer role", null, true],
    ["markets", "Markets & languages", "textarea", "Launch order, e.g. GCC (Arabic) first, then global"],
    ["integrations", "Integrations", "textarea", "Live vs planned: custom feed, Salla, Shopify, API"],
  ]},
  { title: "Product", fields: [
    ["problems_solved", "Problems solved", "textarea"],
    ["key_features", "Key features", "textarea"],
    ["differentiators", "Differentiators", "textarea"],
    ["competitors", "Competitors & alternatives", "textarea"],
    ["pricing", "Pricing", "textarea", "Plans by SKU count, credits for rendering and AI", null, true],
  ]},
  { title: "Go-to-market", fields: [
    ["proof_points", "Proof points", "textarea", "Real results only: ROAS, CTR, time saved, customers"],
    ["brand_voice", "Brand voice", "textarea"],
    ["goals", "Goals", "textarea", "Numbers and dates"],
    ["budget", "Monthly budget", "input"],
    ["extra_notes", "Anything else", "textarea", "", null, true],
  ]},
];

const ROUTES = {
  overview: { title: "Overview", crumb: "Workspace", render: renderOverview },
  brief: { title: "Brief", crumb: "Company data", render: renderBrief },
  knowledge: { title: "Knowledge", crumb: "Company data", render: renderKnowledge },
  kpis: { title: "KPIs", crumb: "Company data", render: renderKpis },
  playbooks: { title: "Playbooks", crumb: "Execution", render: renderPlaybooks },
  library: { title: "Library", crumb: "Execution", render: renderLibrary },
};

/* ---------------------------------------------------------------- routing */
function go(route, param = null) {
  const id = S.ws ? S.ws.id : "";
  location.hash = `#/${id}/${route}${param ? "/" + encodeURIComponent(param) : ""}`;
}

async function onRoute() {
  const [, wsId, route, param] = location.hash.split("/");
  if (wsId && (!S.ws || String(S.ws.id) !== wsId)) {
    try { S.ws = await api(`/api/workspaces/${wsId}`); } catch { S.ws = null; }
  }
  S.route = ROUTES[route] ? route : "overview";
  S.param = param ? decodeURIComponent(param) : null;
  render();
}

function render() {
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === S.route));
  $("#wsSelect").innerHTML = S.workspaces.map((w) => `<option value="${w.id}" ${S.ws && S.ws.id === w.id ? "selected" : ""}>${esc(w.brief.company_name)}</option>`).join("")
    || `<option value="">No workspaces</option>`;
  $("#pageActions").innerHTML = "";
  if (!S.ws) {
    $("#crumb").textContent = "";
    $("#pageTitle").textContent = "Welcome";
    $("#view").innerHTML = `<div class="card empty">
      <h2>Set up your first workspace</h2>
      <p>Add your company once. Every playbook, report and KPI analysis reads from it, so the more data you add, the sharper the output.</p>
      <button class="btn btn-primary" data-action="new-ws">Create workspace</button></div>`;
    return;
  }
  const r = ROUTES[S.route];
  $("#crumb").textContent = `${S.ws.brief.company_name} · ${r.crumb}`;
  $("#pageTitle").textContent = r.title;
  r.render($("#view"));
}

/* ---------------------------------------------------------------- overview */
async function renderOverview(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const id = S.ws.id;
  const [gapData, notes, kpiData, assets] = await Promise.all([
    api(`/api/workspaces/${id}/gaps`), api(`/api/workspaces/${id}/notes`),
    api(`/api/workspaces/${id}/kpis`), api(`/api/workspaces/${id}/assets`),
  ]);
  const { gaps, total: TOTAL } = gapData;
  const pct = Math.round(((TOTAL - gaps.length) / TOTAL) * 100);
  const tracked = new Set(kpiData.values.map((v) => v.kpi_id)).size;
  $("#pageActions").innerHTML = `<button class="btn" data-go="kpis">Log KPIs</button><button class="btn btn-primary" data-go="playbooks">Run a playbook</button>`;

  const routeFor = { brief: "brief", knowledge: "knowledge", kpis: "kpis" };
  view.innerHTML = `
    <div class="grid-4">
      <div class="card stat"><div class="eyebrow">Data completeness</div><div class="value">${pct}%</div><div class="meter" style="margin-top:8px"><span style="width:${pct}%"></span></div></div>
      <div class="card stat"><div class="eyebrow">Knowledge notes</div><div class="value">${notes.length}</div><div class="subtle">${(() => { const c = new Set(notes.map((n) => n.category)).size; return `across ${c} ${c === 1 ? "category" : "categories"}`; })()}</div></div>
      <div class="card stat"><div class="eyebrow">KPIs with data</div><div class="value">${tracked}<span class="subtle" style="font-size:16px"> / ${kpiData.kpis.length}</span></div><div class="subtle">${kpiData.values.length} values logged</div></div>
      <div class="card stat"><div class="eyebrow">Outputs</div><div class="value">${assets.length}</div><div class="subtle">generated</div></div>
    </div>

    <div class="grid-2" style="margin-top:24px;align-items:start">
      <div class="card">
        <div class="card-head"><div><h2>What the engine still needs</h2><p class="subtle" style="font-size:13px">Answer these to sharpen every output.</p></div><span class="badge ${gaps.length ? "warn" : "good"}">${gaps.length ? gaps.length + " open" : "Complete"}</span></div>
        <ul class="list">${gaps.slice(0, 10).map((g) => `
          <li class="clickable" data-go="${routeFor[g.area]}" data-param="${esc(g.field)}">
            <span class="badge">${esc(g.area)}</span><span class="grow">${esc(g.question)}</span><span class="subtle">→</span>
          </li>`).join("") || `<li><span class="muted">Everything the engine asks for is filled in.</span></li>`}
          ${gaps.length > 10 ? `<li><span class="subtle">${gaps.length - 10} more…</span></li>` : ""}
        </ul>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent outputs</h2><button class="btn btn-sm btn-ghost" data-go="library">View all</button></div>
        <ul class="list">${assets.slice(0, 8).map((a) => `
          <li class="clickable" data-go="library" data-param="${a.id}">
            <span class="grow">${esc(a.title || pbTitle(a.playbook))}</span><span class="subtle num">${fmtDate(a.created_at)}</span>
          </li>`).join("") || `<li><span class="muted">Nothing generated yet.</span></li>`}
        </ul>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- brief */
function renderBrief(view) {
  const b = S.ws.brief;
  $("#pageActions").innerHTML = `<button class="btn btn-primary" data-action="save-brief">Save changes</button>`;
  view.innerHTML = `<form id="briefForm" class="stack-lg">${BRIEF_SECTIONS.map((sec) => `
    <div class="card">
      <div class="card-head"><h2>${sec.title}</h2></div>
      <div class="card-body grid-form">${sec.fields.map(([k, l, type, hint, opts, wide]) => `
        <div class="field ${wide ? "span-2" : ""} ${S.param === k ? "highlight" : ""}" id="f-${k}">
          <label for="i-${k}">${l}</label>
          ${type === "textarea" ? `<textarea class="input" id="i-${k}" name="${k}" rows="3">${esc(b[k])}</textarea>`
            : type === "select" ? `<select class="input" id="i-${k}" name="${k}">${opts.map((o) => `<option ${o === b[k] ? "selected" : ""}>${o}</option>`).join("")}</select>`
            : `<input class="input" id="i-${k}" name="${k}" value="${esc(b[k])}">`}
          ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
        </div>`).join("")}
      </div>
    </div>`).join("")}
  </form>`;
  if (S.param) { const el = $(`#i-${S.param}`); if (el) { el.scrollIntoView({ block: "center" }); el.focus(); } }
}

async function saveBrief() {
  const brief = Object.fromEntries(new FormData($("#briefForm")));
  if (!brief.company_name.trim()) return toast("Company name is required", true);
  S.ws = await api(`/api/workspaces/${S.ws.id}`, { method: "PUT", body: JSON.stringify(brief) });
  await loadWorkspaces();
  toast("Brief saved");
  render();
}

/* ---------------------------------------------------------------- knowledge */
async function renderKnowledge(view) {
  const notes = await api(`/api/workspaces/${S.ws.id}/notes`);
  const filter = S.param && S.categories.includes(S.param) ? S.param : null;
  const shown = filter ? notes.filter((n) => n.category === filter) : notes;
  view.innerHTML = `
    <div class="split">
      <form class="card card-body stack" id="noteForm">
        <div><h2>Add knowledge</h2><p class="subtle" style="font-size:13px">Facts, results, objections, sales scripts. Every playbook reads all of it.</p></div>
        <div class="field"><label for="n-cat">Category</label>
          <select class="input" id="n-cat" name="category">${S.categories.map((c) => `<option ${c === (filter || "results") ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><label for="n-title">Title</label><input class="input" id="n-title" name="title" placeholder="e.g. Demo objection: we already use Canva"></div>
        <div class="field"><label for="n-content">Content</label><textarea class="input" id="n-content" name="content" rows="8" placeholder="Paste notes, numbers, call summaries, or a document"></textarea></div>
        <button class="btn btn-primary" type="submit">Save note</button>
      </form>
      <div class="stack">
        <div class="row gap-8 wrap">
          <button class="chip ${filter ? "" : "active"}" data-go="knowledge">All · ${notes.length}</button>
          ${S.categories.map((c) => { const n = notes.filter((x) => x.category === c).length; return `<button class="chip ${filter === c ? "active" : ""}" data-go="knowledge" data-param="${c}">${c}${n ? " · " + n : ""}</button>`; }).join("")}
        </div>
        <div class="card">${shown.length ? `<ul class="list">${shown.map((n) => `
          <li style="align-items:flex-start">
            <div class="grow">
              <div class="row gap-8"><span class="badge accent">${esc(n.category)}</span><h3>${esc(n.title)}</h3></div>
              <div class="doc note-body ${n.content.length > 600 ? "clamped" : ""}" style="margin-top:8px">${md(n.content)}</div>
              ${n.content.length > 600 ? `<button class="btn btn-sm btn-ghost" data-action="toggle-note" style="margin-top:4px;padding:0">Show all</button>` : ""}
            </div>
            <button class="btn btn-sm btn-ghost btn-danger" data-action="del-note" data-id="${n.id}">Delete</button>
          </li>`).join("")}</ul>`
          : `<div class="empty"><h2>No ${filter ? esc(filter) + " " : ""}notes yet</h2><p>Real results and objections make the biggest difference to output quality.</p></div>`}
        </div>
      </div>
    </div>`;
  $("#noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = Object.fromEntries(new FormData(e.target));
    if (!note.title.trim() || !note.content.trim()) return toast("Title and content are required", true);
    await api(`/api/workspaces/${S.ws.id}/notes`, { method: "POST", body: JSON.stringify(note) });
    toast("Note saved");
    go("knowledge", note.category);
    if (S.param === note.category) renderKnowledge(view);
  });
}

/* ---------------------------------------------------------------- KPIs */
async function renderKpis(view) {
  const { kpis, values } = await api(`/api/workspaces/${S.ws.id}/kpis`);
  const period = S.kpiPeriod || isoWeek();
  const byKpi = {};
  values.forEach((v) => (byKpi[v.kpi_id] = byKpi[v.kpi_id] || []).push(v));
  $("#pageActions").innerHTML = kpis.length
    ? `<button class="btn" data-action="add-kpi">Add KPI</button><button class="btn" data-go="playbooks" data-param="kpi_report">Analyze</button><button class="btn btn-primary" data-action="save-kpis">Save values</button>`
    : "";
  if (!kpis.length) {
    view.innerHTML = `<div class="card empty"><h2>No KPIs yet</h2>
      <p>Load the 20 KPIs from your growth SOP, from app store discovery to merchant ROAS. You can edit or add your own after.</p>
      <div class="row gap-8" style="justify-content:center"><button class="btn btn-primary" data-action="load-kpis">Load SOP KPIs</button><button class="btn" data-action="add-kpi">Add custom KPI</button></div></div>`;
    return;
  }
  let stage = null;
  const rows = kpis.map((k) => {
    const hist = (byKpi[k.id] || []).sort((a, b) => a.period.localeCompare(b.period));
    const cur = hist.find((v) => v.period === period);
    const prev = [...hist].reverse().find((v) => v.period < period);
    let status = "";
    if (cur && k.target !== null && k.target !== undefined) {
      const ok = k.higher_is_better ? cur.value >= k.target : cur.value <= k.target;
      const near = k.higher_is_better ? cur.value >= k.target * 0.9 : cur.value <= k.target * 1.1;
      status = ok ? `<span class="badge good">On target</span>` : near ? `<span class="badge warn">Near</span>` : `<span class="badge bad">Off</span>`;
    }
    const group = k.stage !== stage ? `<tr class="group"><td colspan="7">${esc((stage = k.stage) || "Other")}</td></tr>` : "";
    return `${group}<tr>
      <td><div style="font-weight:500">${esc(k.name)}</div><div class="subtle" style="font-size:12px">${esc(k.formula)}</div></td>
      <td class="muted">${esc(k.owner)}</td>
      <td class="right num">${fmtNum(k.target)}${k.unit && k.target != null ? ` <span class="subtle">${esc(k.unit)}</span>` : ""}</td>
      <td class="right num muted">${prev ? fmtNum(prev.value) : "–"}</td>
      <td class="right"><input class="input cell-input" type="number" step="any" data-kpi="${k.id}" value="${cur ? cur.value : ""}" aria-label="${esc(k.name)} value"></td>
      <td>${status}</td>
      <td class="right"><button class="btn btn-sm btn-ghost" data-action="del-kpi" data-id="${k.id}" aria-label="Delete ${esc(k.name)}">Remove</button></td>
    </tr>`;
  }).join("");
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="row gap-12"><label class="eyebrow" for="period">Period</label><input class="input input-sm mono" id="period" style="width:140px" value="${esc(period)}"></div>
        <span class="subtle hide-sm" style="font-size:13px">Use ISO weeks (2026-W44) for weekly KPIs and months (2026-10) for monthly ones.</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>KPI</th><th>Owner</th><th class="right">Target</th><th class="right">Previous</th><th class="right">This period</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  $("#period").addEventListener("change", (e) => { S.kpiPeriod = e.target.value.trim(); renderKpis(view); });
}

async function saveKpis() {
  const period = $("#period").value.trim();
  if (!period) return toast("Set a period first", true);
  const inputs = [...document.querySelectorAll("[data-kpi]")].filter((i) => i.value !== "");
  await Promise.all(inputs.map((i) => api(`/api/workspaces/${S.ws.id}/kpis/${i.dataset.kpi}/values`, {
    method: "POST", body: JSON.stringify({ period, value: Number(i.value) }) })));
  toast(`Saved ${inputs.length} values for ${period}`);
  renderKpis($("#view"));
}

function addKpiDialog() {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" id="kpiForm">
    <div class="card-head"><h2>Add KPI</h2></div>
    <div class="card-body grid-form">
      <div class="field span-2"><label>Name</label><input class="input" name="name" required></div>
      <div class="field"><label>Stage</label><input class="input" name="stage" placeholder="Acquisition"></div>
      <div class="field"><label>Owner</label><input class="input" name="owner"></div>
      <div class="field span-2"><label>Formula</label><input class="input" name="formula"></div>
      <div class="field"><label>Target</label><input class="input" name="target" type="number" step="any"></div>
      <div class="field"><label>Unit</label><input class="input" name="unit" placeholder="%, $, hours"></div>
      <div class="field"><label>Frequency</label><select class="input" name="frequency"><option>weekly</option><option>monthly</option><option>quarterly</option></select></div>
      <div class="field"><label>Better when</label><select class="input" name="higher_is_better"><option value="true">Higher</option><option value="false">Lower</option></select></div>
    </div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Add KPI</button></div>
  </form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    const f = Object.fromEntries(new FormData($("#kpiForm")));
    if (!f.name.trim()) return;
    f.target = f.target === "" ? null : Number(f.target);
    f.higher_is_better = f.higher_is_better === "true";
    await api(`/api/workspaces/${S.ws.id}/kpis`, { method: "POST", body: JSON.stringify(f) });
    toast("KPI added");
    renderKpis($("#view"));
  };
}

/* ---------------------------------------------------------------- playbooks */
const pbTitle = (key) => (S.playbooks.find((p) => p.key === key) || { title: key }).title;

function renderPlaybooks(view) {
  const agency = S.ws.brief.business_model === "agency";
  const list = S.playbooks.filter((p) => !p.for_agencies || agency);
  const sel = list.find((p) => p.key === S.param) || list[0];
  const cats = [...new Set(list.map((p) => p.category))];
  $("#pageActions").innerHTML = `<button class="btn" data-action="launch-kit">Run full launch kit</button>`;
  view.innerHTML = `
    <div class="split">
      <div class="card">${cats.map((c) => `
        <div class="eyebrow" style="padding:16px 20px 4px">${esc(c)}</div>
        <ul class="list">${list.filter((p) => p.category === c).map((p) => `
          <li class="clickable ${p.key === sel.key ? "selected" : ""}" data-go="playbooks" data-param="${p.key}" style="padding:8px 20px;border:0">
            <span class="grow" style="font-weight:500">${esc(p.title)}</span>
          </li>`).join("")}</ul>`).join("")}
        <div style="height:12px"></div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h2>${esc(sel.title)}</h2><p class="muted" style="font-size:13px">${esc(sel.description)}</p></div>
          </div>
          <form class="card-body stack" id="runForm">
            ${sel.uses_context_from.length || sel.uses_kpis ? `<div class="row gap-8 wrap"><span class="subtle" style="font-size:13px">Reads</span>
              <span class="badge">Brief</span><span class="badge">Knowledge</span>
              ${sel.uses_kpis ? `<span class="badge accent">KPI data</span>` : ""}
              ${sel.uses_context_from.map((k) => `<span class="badge">${esc(pbTitle(k))}</span>`).join("")}</div>` : ""}
            ${sel.inputs.length ? `<div class="grid-form">${sel.inputs.map((i) => `
              <div class="field"><label for="in-${i.name}">${esc(i.label)}</label><input class="input" id="in-${i.name}" name="${i.name}" value="${esc(i.default)}">${i.help ? `<span class="hint">${esc(i.help)}</span>` : ""}</div>`).join("")}</div>` : ""}
            <div class="row gap-12"><button class="btn btn-primary" id="runBtn" type="submit">Generate</button><span class="subtle" id="runStatus" style="font-size:13px"></span></div>
          </form>
        </div>
        <div id="result"></div>
      </div>
    </div>`;
  $("#runForm").addEventListener("submit", (e) => { e.preventDefault(); runPlaybook(sel.key); });
}

async function runPlaybook(key) {
  const btn = $("#runBtn"), status = $("#runStatus");
  const inputs = Object.fromEntries(new FormData($("#runForm")));
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Generating`;
  const t0 = Date.now();
  const timer = setInterval(() => (status.textContent = `${Math.round((Date.now() - t0) / 1000)}s · strategy work can take a minute or two`), 1000);
  try {
    $("#result").innerHTML = `<div class="card"><div class="card-head"><h2>${esc(pbTitle(key))}</h2><span class="badge accent">Writing…</span></div><div class="card-body doc" id="liveDoc"></div></div>`;
    $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
    const res = await streamRun(key, inputs, (text) => ($("#liveDoc").innerHTML = md(text)));
    status.textContent = "";
    const assets = await api(`/api/workspaces/${S.ws.id}/assets`);
    cacheAssets(assets);
    $("#result").innerHTML = assetCard(assets.find((a) => a.id === res.id));
  } catch (err) {
    status.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`;
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = "Generate";
  }
}

// POST a playbook run and read the streamed Markdown. The server ends the
// stream with [[MWIZ_SAVED]]<id> or [[MWIZ_ERROR]]<message>.
async function streamRun(key, inputs, onText) {
  const res = await fetch(`/api/workspaces/${S.ws.id}/run/${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs }),
  });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in again."); }
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "", last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (Date.now() - last > 120) { last = Date.now(); onText(text.split("\n\n[[MWIZ_")[0]); }
  }
  const err = text.split("[[MWIZ_ERROR]]")[1];
  if (err !== undefined) throw new Error(err.trim());
  const id = (text.split("[[MWIZ_SAVED]]")[1] || "").trim();
  if (!id) throw new Error("The connection closed before the output was saved. Try again.");
  return { id };
}

async function launchKit() {
  const kit = S.launchKit;
  if (!confirm(`Run all ${kit.length} launch-kit playbooks in order? Each builds on the last, so this takes several minutes. Keep this tab open.`)) return;
  const btn = document.querySelector('[data-action="launch-kit"]');
  btn.disabled = true;
  try {
    for (const [i, key] of kit.entries()) {
      btn.innerHTML = `<span class="spinner"></span> ${i + 1}/${kit.length} · ${esc(pbTitle(key))}`;
      await streamRun(key, {}, () => {});
    }
    toast("Launch kit ready");
    go("library");
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run full launch kit";
  }
}

/* ---------------------------------------------------------------- library */
async function renderLibrary(view) {
  const assets = await api(`/api/workspaces/${S.ws.id}/assets`);
  cacheAssets(assets);
  $("#pageActions").innerHTML = assets.length ? `<button class="btn" data-action="export">Export all as Markdown</button>` : "";
  if (!assets.length) {
    view.innerHTML = `<div class="card empty"><h2>No outputs yet</h2><p>Run a playbook and its output is saved here with full history.</p><button class="btn btn-primary" data-go="playbooks">Open playbooks</button></div>`;
    return;
  }
  const sel = assets.find((a) => String(a.id) === S.param) || assets[0];
  view.innerHTML = `
    <div class="split">
      <div class="card"><ul class="list">${assets.map((a) => `
        <li class="clickable ${a.id === sel.id ? "selected" : ""}" data-go="library" data-param="${a.id}">
          <div class="grow"><div style="font-weight:500">${esc(a.title || pbTitle(a.playbook))}</div><div class="subtle num" style="font-size:12px">${fmtDate(a.created_at)}</div></div>
        </li>`).join("")}</ul></div>
      <div>${assetCard(sel)}</div>
    </div>`;
}

const assetCache = new Map();
const cacheAssets = (list) => list.forEach((a) => assetCache.set(a.id, a));

function assetCard(a) {
  if (!a) return "";
  return `<div class="card">
    <div class="card-head">
      <div><h2>${esc(a.title || pbTitle(a.playbook))}</h2><div class="subtle num" style="font-size:12px">${fmtDate(a.created_at)}</div></div>
      <div class="row gap-8">${a.provider === "demo" ? `<span class="badge warn">Demo output</span>` : ""}
        <button class="btn btn-sm" data-action="copy-md" data-id="${esc(a.id)}">Copy Markdown</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-action="del-asset" data-id="${esc(a.id)}">Delete</button></div>
    </div>
    <div class="card-body doc">${md(a.text)}</div>
  </div>`;
}

/* ---------------------------------------------------------------- workspaces */
async function loadWorkspaces() { S.workspaces = await api("/api/workspaces"); }

function newWorkspaceDialog() {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog" id="wsForm">
    <div class="card-head"><div><h2>New workspace</h2><p class="subtle" style="font-size:13px">One per company. Agencies create one per client.</p></div></div>
    <div class="card-body stack">
      <div class="field"><label>Company name</label><input class="input" name="company_name" required autofocus></div>
      <div class="field"><label>One-liner</label><input class="input" name="one_liner" placeholder="What the product does"></div>
      <div class="field"><label>Business model</label><select class="input" name="business_model"><option>saas</option><option>agency</option><option>other</option></select></div>
    </div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Create</button></div>
  </form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    const brief = Object.fromEntries(new FormData($("#wsForm")));
    if (!brief.company_name.trim()) return;
    const ws = await api("/api/workspaces", { method: "POST", body: JSON.stringify(brief) });
    await loadWorkspaces();
    S.ws = ws;
    go("brief");
  };
}

/* ---------------------------------------------------------------- events */
document.addEventListener("click", async (e) => {
  const nav = e.target.closest("#nav a");
  if (nav) { go(nav.dataset.route); return; }
  const g = e.target.closest("[data-go]");
  if (g) { go(g.dataset.go, g.dataset.param || null); return; }
  const a = e.target.closest("[data-action]");
  if (!a) return;
  try {
    switch (a.dataset.action) {
      case "new-ws": return newWorkspaceDialog();
      case "save-brief": return await saveBrief();
      case "save-kpis": return await saveKpis();
      case "add-kpi": return addKpiDialog();
      case "load-kpis":
        await api(`/api/workspaces/${S.ws.id}/kpis/load-defaults`, { method: "POST" });
        toast("SOP KPIs loaded");
        return renderKpis($("#view"));
      case "del-kpi":
        if (!confirm("Remove this KPI and its history?")) return;
        await api(`/api/workspaces/${S.ws.id}/kpis/${a.dataset.id}`, { method: "DELETE" });
        return renderKpis($("#view"));
      case "del-note":
        if (!confirm("Delete this note?")) return;
        await api(`/api/workspaces/${S.ws.id}/notes/${a.dataset.id}`, { method: "DELETE" });
        return renderKnowledge($("#view"));
      case "launch-kit": return await launchKit();
      case "toggle-note": {
        const body = a.previousElementSibling;
        a.textContent = body.classList.toggle("clamped") ? "Show all" : "Show less";
        return;
      }
      case "copy-md": {
        const text = assetCache.get(a.dataset.id)?.text || "";
        try { await navigator.clipboard.writeText(text); toast("Copied as Markdown"); } catch { toast("Clipboard blocked by the browser", true); }
        return;
      }
      case "del-asset":
        if (!confirm("Delete this output?")) return;
        await api(`/api/workspaces/${S.ws.id}/assets/${a.dataset.id}`, { method: "DELETE" });
        toast("Output deleted");
        if (S.route === "library") { S.param = null; return renderLibrary($("#view")); }
        $("#result").innerHTML = "";
        return;
      case "export": {
        const md = await api(`/api/workspaces/${S.ws.id}/export`);
        const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
        const link = Object.assign(document.createElement("a"), { href: url, download: `${S.ws.brief.company_name.replace(/\W+/g, "-")}-marketing-kit.md` });
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
    }
  } catch (err) { toast(err.message, true); }
});

$("#wsSelect").addEventListener("change", (e) => { location.hash = `#/${e.target.value}/overview`; });
window.addEventListener("hashchange", onRoute);

(async function init() {
  const [health, pb, cats] = await Promise.all([api("/api/health"), api("/api/playbooks"), api("/api/note-categories")]);
  S.health = health; S.playbooks = pb.playbooks; S.launchKit = pb.launch_kit; S.categories = cats;
  const live = health.provider === "claude";
  $("#providerDot").className = "status-dot " + (live ? "live" : "demo");
  $("#providerLabel").textContent = live ? `Claude · ${health.model}` : "Demo mode";
  await loadWorkspaces();
  if (!location.hash && S.workspaces.length) { location.hash = `#/${S.workspaces[0].id}/overview`; return; }
  await onRoute();
})();
