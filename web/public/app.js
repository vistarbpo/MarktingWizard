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
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); if (j.enrol_required) location.href = "/login/enrol"; } catch {}
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
  sop: { title: "Operating SOP", crumb: "Run the system", render: renderSop },
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

/* ---------------------------------------------------------------- access */
const ROUTE_MODULE = { command: "command", okr: "okr", meetings: "meetings", sop: "sop",overview: "marketing", brief: "marketing", knowledge: "marketing", kpis: "marketing", playbooks: "marketing", library: "marketing",
  pipeline: "sales", crm: "crm", studio: "creative", ads: "ads", intel: "intel", partners: "partners", workforce: "workforce", product: "product", support: "support", results: "results", finance: "finance", billing: "billing", success: "success", ops: "ops", team: "team", people: "team", access: "admin", compliance: "compliance", legal: "legal", helpcenter: "helpcenter", changelog: "product", investors: "investors" };
// Pages that open for more than one module: the best level among them (each tab checks its own module).
const ROUTE_ANY = { people: ["team", "payroll"] };
const LEVEL_RANK = { none: 0, view: 1, edit: 2 };
const levelFor = (route) => (S.me ? (ROUTE_ANY[route] || [ROUTE_MODULE[route] || "command"]).map((m) => S.me.perms[m] || "none").sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] : "edit");
const canSee = (route) => levelFor(route) !== "none";
/* ---------------------------------------------------------------- sidebar menu
   One list drives the menu. A group folds open; the group holding the current page opens itself.
   Pages that aren't loaded (module not built) or that the role can't see are left out. */
const NAV = [
  { route: "command", label: "Home", icon: "home" },
  { route: "sop", label: "SOP", icon: "check" },
  { route: "okr", label: "Goals & review", icon: "target" },
  { route: "meetings", label: "Meetings", icon: "cal" },
  { group: "grow", label: "Grow", icon: "trend", items: [["crm", "Store CRM"], ["pipeline", "Sales pipeline"], ["studio", "Creative Studio"], ["ads", "Paid Ads"], ["intel", "Market intel"], ["partners", "Partners & referrals"], ["results", "ROAS results"]] },
  { group: "customers", label: "Customers", icon: "chat", items: [["support", "AI Support"], ["billing", "Billing & customers"], ["success", "Customer success"], ["helpcenter", "Help center"]] },
  { group: "brain", label: "Marketing brain", icon: "spark", items: [["overview", "Overview"], ["brief", "Brief"], ["knowledge", "Knowledge"], ["kpis", "KPIs"], ["playbooks", "Playbooks"], ["library", "Library"]] },
  { group: "product", label: "Product", icon: "box", items: [["product", "Roadmap & releases"], ["changelog", "Changelog"]] },
  { route: "finance", label: "Finance", icon: "coin" },
  { route: "ops", label: "Operations", icon: "gear" },
  { group: "team", label: "Team", icon: "people", items: [["workforce", "AI Workforce"], ["team", "Hiring"], ["people", "Attendance & payroll"]] },
  { group: "settings", label: "Settings", icon: "lock", items: [["access", "Teams & roles"], ["compliance", "Security & compliance"], ["legal", "Legal & documents"], ["investors", "Investor room"]] },
];
const NAV_ICON = {
  cal: "M4 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm-1 4h14M7 3v4m6-4v4M6.5 12.5h3",
  home: "M3 8.5 10 3l7 5.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z", target: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0 3.5h.01",check: "M4 10.5 8 14l8-8", trend: "M3 14l5-5 3 3 6-6M13 6h4v4",
  chat: "M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", spark: "M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8z",
  box: "M3 6.5 10 3l7 3.5v7L10 17l-7-3.5zM3 6.5 10 10l7-3.5M10 10v7", coin: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3v8m-2.5-6h3.75a1.5 1.5 0 0 1 0 3h-2.5a1.5 1.5 0 0 0 0 3H12.5",
  gear: "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0-4v2m0 10v2m7-7h-2M5 10H3m11.9-4.9-1.4 1.4M6.5 13.5l-1.4 1.4m0-9.8 1.4 1.4m7 7 1.4 1.4",
  people: "M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-4.5 8a4.5 4.5 0 0 1 9 0M13.5 9a2.5 2.5 0 1 0 0-5M14 12.5a4 4 0 0 1 3.5 4.5", lock: "M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9",
};
const navOpen = () => { try { return JSON.parse(localStorage.getItem("nav.open") || "{}"); } catch { return {}; } };
function buildNav() {
  const nav = $("#nav"); if (!nav) return;
  const ok = (r) => ROUTES[r] && canSee(r), open = navOpen();
  const icon = (k) => `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="${NAV_ICON[k] || ""}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  nav.innerHTML = NAV.map((n) => {
    if (n.route) return ok(n.route) ? `<a data-route="${n.route}" class="nav-top">${icon(n.icon)}<span>${esc(n.label)}</span></a>` : "";
    const items = n.items.filter(([r]) => ok(r));
    if (!items.length) return "";
    if (items.length === 1) return `<a data-route="${items[0][0]}" class="nav-top">${icon(n.icon)}<span>${esc(items[0][1])}</span></a>`;
    const here = items.some(([r]) => r === S.route), isOpen = here || open[n.group];
    return `<div class="nav-sec ${isOpen ? "open" : ""} ${here ? "here" : ""}" data-navsec="${n.group}"><button type="button" class="nav-g" aria-expanded="${!!isOpen}">${icon(n.icon)}<span>${esc(n.label)}</span><i class="nav-chev"></i></button>
      <div class="nav-items">${items.map(([r, l]) => `<a data-route="${r}">${esc(l)}</a>`).join("")}</div></div>`;
  }).join("");
  nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.route === S.route));
}
document.addEventListener("click", (e) => {
  const g = e.target.closest(".nav-g"); if (!g) return;
  const sec = g.parentElement, open = navOpen(), on = !sec.classList.contains("open");
  sec.classList.toggle("open", on); g.setAttribute("aria-expanded", on);
  open[sec.dataset.navsec] = on; try { localStorage.setItem("nav.open", JSON.stringify(open)); } catch {}
});

function applyAccess() {
  buildNav();
  const who = $("#whoami");
  if (who && S.me) who.innerHTML = `<button class="btn btn-sm btn-ghost who-btn" data-action="account" title="Your account">${esc(S.me.user.name)}<span class="subtle">${esc(S.me.role)}</span></button>`;
}

async function onRoute() {
  const [, wsId, route, param] = location.hash.split("/");
  if (wsId && (!S.ws || String(S.ws.id) !== wsId)) {
    try { S.ws = await api(`/api/workspaces/${wsId}`); } catch { S.ws = null; }
  }
  S.route = ROUTES[route] ? route : "command";
  if (S.me && !canSee(S.route)) { const first = Object.keys(ROUTE_MODULE).find((r) => ROUTES[r] && canSee(r)); if (first && !route) S.route = first; }
  S.param = param ? decodeURIComponent(param) : null;
  render();
}

function render() {
  buildNav();
  $("#wsSelect").innerHTML = S.workspaces.map((w) => `<option value="${w.id}" ${S.ws && S.ws.id === w.id ? "selected" : ""}>${esc(w.brief.company_name)}</option>`).join("")
    || `<option value="">No workspaces</option>`;
  $("#pageActions").innerHTML = "";
  if (!S.ws) {
    gdSync();
    $("#crumb").textContent = "";
    $("#pageTitle").textContent = "Welcome";
    $("#view").innerHTML = `<div class="card empty">
      <h2>Set up your first workspace</h2>
      <p>Add your company once. Every playbook, report and KPI analysis reads from it, so the more data you add, the sharper the output.</p>
      <button class="btn btn-primary" data-action="new-ws">Create workspace</button></div>`;
    return;
  }
  const r = ROUTES[S.route];
  $("#crumb").textContent = `${S.ws.brief.company_name} · ${r.crumb}${levelFor(S.route) === "view" ? " · view only" : ""}`;
  $("#pageTitle").textContent = r.title;
  gdSync(); // the "i" guide button (guide-ui.js)
  if (!canSee(S.route)) {
    $("#view").innerHTML = `<div class="card empty"><h2>No access</h2><p>Your role (${esc(S.me.role)}) can't open ${esc(r.title)}. Ask an Owner or Admin to change your role in Teams & roles.</p></div>`;
    return;
  }
  r.render($("#view"));
}

/* ---------------------------------------------------------------- SOP */
const PB_TITLE = (key) => (S.playbooks.find((p) => p.key === key) || {}).title || key;
const PERIOD_LABEL = { setup: "Do once", weekly: "This week", monthly: "This month", quarterly: "This quarter" };

async function renderSop(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const { sop, periods, checks } = await api(`/api/workspaces/${S.ws.id}/sop`);
  const done = new Set(checks.map((c) => c.step));
  const counts = sop.map((s) => ({ s, n: s.steps.filter((st) => done.has(`${s.cadence}:${st.id}`)).length }));
  $("#pageActions").innerHTML = `<button class="btn" data-go="kpis">Log KPIs</button><button class="btn btn-primary" data-go="playbooks" data-param="kpi_report">Weekly KPI report</button>`;
  view.innerHTML = `
    <p class="muted" style="max-width:70ch;margin:0 0 20px">One procedure for running ${esc(S.ws.brief.company_name)}'s marketing, all inside this dashboard. Each step opens the page or playbook that does the work. Tick steps as you finish them; the team shares the ticks, and they reset each week, month and quarter.</p>
    <div class="grid-4">${counts.map(({ s, n }) => {
      const pct = Math.round((n / s.steps.length) * 100);
      return `<button type="button" class="card stat clickable" data-scroll="sop-${s.cadence}" style="text-align:left;font:inherit;color:inherit;cursor:pointer">
        <div class="eyebrow">${esc(s.title)}</div>
        <div class="value">${n}<span class="subtle" style="font-size:16px"> / ${s.steps.length}</span></div>
        <div class="meter" style="margin-top:8px"><span style="width:${pct}%"></span></div>
        <div class="subtle" style="margin-top:6px">${PERIOD_LABEL[s.cadence]} · <span class="mono">${esc(periods[s.cadence])}</span></div></button>`;
    }).join("")}</div>
    <div class="stack-lg" style="margin-top:24px">${counts.map(({ s, n }) => `
      <section class="card" id="sop-${s.cadence}">
        <div class="card-head"><div><h2>${esc(s.title)}</h2><p class="subtle" style="font-size:13px">${esc(s.when)} · ${esc(s.goal)}</p></div>
          <span class="badge ${n === s.steps.length ? "good" : n ? "warn" : ""}">${n === s.steps.length ? "Done" : `${n} of ${s.steps.length}`}</span></div>
        <ul class="list">${s.steps.map((st, i) => {
          const key = `${s.cadence}:${st.id}`, checked = done.has(key);
          const target = st.param ? `Open ${esc(PB_TITLE(st.param))}` : st.go ? `Open ${esc(ROUTES[st.go]?.title || st.go)}` : "";
          return `<li style="align-items:flex-start">
            <input type="checkbox" id="sop-${esc(key)}" data-sop="${esc(s.cadence)}" data-step="${esc(st.id)}" ${checked ? "checked" : ""} style="margin-top:3px;width:18px;height:18px;flex:none">
            <label for="sop-${esc(key)}" class="grow" style="cursor:pointer;${checked ? "text-decoration:line-through;opacity:.6" : ""}">
              <span class="subtle num">${i + 1}.</span> ${esc(st.text)}<br><span class="subtle" style="font-size:12px">Owner: ${esc(st.owner)}</span></label>
            ${target ? `<button class="btn btn-sm" data-go="${esc(st.go)}"${st.param ? ` data-param="${esc(st.param)}"` : ""}>${target}</button>` : ""}
          </li>`;
        }).join("")}</ul>
      </section>`).join("")}</div>`;
}

document.addEventListener("change", async (e) => {
  const box = e.target.closest("[data-sop]");
  if (!box) return;
  box.disabled = true;
  try {
    await api(`/api/workspaces/${S.ws.id}/sop`, { method: "POST", body: JSON.stringify({ cadence: box.dataset.sop, step: box.dataset.step, done: box.checked }) });
    if (S.route === "sop") await renderSop($("#view"));
  } catch (err) {
    box.checked = !box.checked; box.disabled = false;
    toast("Couldn't save that tick. Try again.", true);
  }
});

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
  const sc = e.target.closest("[data-scroll]");
  if (sc) { document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
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

$("#wsSelect").addEventListener("change", (e) => { location.hash = `#/${e.target.value}/command`; });
window.addEventListener("hashchange", onRoute);

(async function init() {
  const [health, pb, cats, me] = await Promise.all([api("/api/health"), api("/api/playbooks"), api("/api/note-categories"), api("/api/me")]);
  S.me = me; applyAccess();
  S.health = health; S.playbooks = pb.playbooks; S.launchKit = pb.launch_kit; S.categories = cats;
  const live = health.provider === "claude";
  $("#providerDot").className = "status-dot " + (live ? "live" : "demo");
  $("#providerLabel").textContent = live ? `Claude · ${health.model}` : "Demo mode";
  await loadWorkspaces();
  if (!location.hash && S.workspaces.length) { location.hash = `#/${S.workspaces[0].id}/command`; return; }
  await onRoute();
})();

/* ---------------------------------------------------------------- mobile menu */
(() => {
  const shell = document.querySelector(".shell"), btn = $("#menuBtn"), scrim = $("#navScrim");
  const set = (open) => { shell.classList.toggle("nav-open", open); scrim.hidden = !open; btn.setAttribute("aria-expanded", open); };
  btn.addEventListener("click", () => set(!shell.classList.contains("nav-open")));
  scrim.addEventListener("click", () => set(false));
  $("#nav").addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shell.classList.contains("nav-open")) set(false); });
  matchMedia("(min-width: 1025px)").addEventListener("change", (m) => { if (m.matches) set(false); });
})();

/* ---------------------------------------------------------------- my account */
// Password change and two-step login (TOTP). Security actions are done here by the person, never by Ask DPA AD.
const ACCT = { step: "", setup: null, codes: null, info: null };
document.addEventListener("click", async (e) => {
  if (!e.target.closest('[data-action="account"]')) return;
  const d = $("#dialog"), me = S.me;
  ACCT.step = ""; ACCT.setup = null; ACCT.codes = null;
  d.innerHTML = `<form method="dialog" id="acctForm" class="acct-form">
    <div class="card-head" style="padding:20px 24px 0"><div><h2>${esc(me.user.name)}</h2><p class="subtle" style="font-size:13px">${esc(me.role)}${me.user.email ? " · " + esc(me.user.email) : ""}</p></div></div>
    <div class="card-body stack" style="padding:16px 24px">${me.shared_login
      ? `<p class="muted">You're signed in with the shared team password as Owner. Create your own Owner account in <b>Teams & roles</b>, sign in with it, and give everyone else their own login. The shared login can't use two-step login.</p>`
      : `<h3 class="acct-h">Password</h3>
         <div class="field"><label for="ac-cur">Current password</label><input class="input" id="ac-cur" type="password" autocomplete="current-password"></div>
         <div class="field"><label for="ac-new">New password (10+ characters)</label><input class="input" id="ac-new" type="password" autocomplete="new-password" minlength="10"><span class="hint">Changing it signs you out on your other devices.</span></div>
         <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" value="ok">Change password</button></div>
         <h3 class="acct-h">Two-step login · الدخول بخطوتين</h3><div id="acct2fa" class="stack"><p class="muted">Loading…</p></div>`}</div>
    <div class="row gap-8" style="justify-content:flex-end;padding:0 24px 24px"><button class="btn" value="cancel">Close</button></div>
  </form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try { const r = await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: $("#ac-cur").value, password: $("#ac-new").value }) }); toast(r.sessions_ended ? `Password changed. ${r.sessions_ended} other session${r.sessions_ended > 1 ? "s" : ""} signed out.` : "Password changed"); }
    catch (err) { toast(err.message, true); }
  };
  if (!me.shared_login) { try { ACCT.info = await api("/api/me/security"); } catch { ACCT.info = null; } acctDraw(); }
});

function acctDraw() {
  const box = $("#acct2fa"); if (!box) return;
  const i = ACCT.info;
  if (!i) { box.innerHTML = `<p class="muted">Couldn't load. Close and open again.</p>`; return; }
  const req = i.required ? `<span class="badge warn">Required for your role</span>` : "";
  if (ACCT.codes) {
    box.innerHTML = `<p><b>Save these recovery codes now.</b> Each signs you in once if you lose your phone. They won't be shown again.</p>
      <ol class="acct-codes">${ACCT.codes.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
      <div class="row gap-8"><button class="btn" type="button" data-acct2fa="copy">Copy codes</button><button class="btn btn-primary" type="button" data-acct2fa="done">I've saved them</button></div>`;
    return;
  }
  if (ACCT.step === "setup" && ACCT.setup) {
    box.innerHTML = `<p class="muted">Scan with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then type the 6-digit code it shows.</p>
      <div class="acct-qr">${ACCT.setup.qr_svg}</div>
      <p class="subtle" style="font-size:13px">Can't scan? Key: <code class="acct-key">${esc(ACCT.setup.secret.replace(/(.{4})/g, "$1 ").trim())}</code></p>
      <div class="field"><label for="ac-code">Code from the app</label><input class="input acct-code" id="ac-code" inputmode="numeric" maxlength="7" autocomplete="one-time-code"></div>
      <div class="row gap-8"><button class="btn" type="button" data-acct2fa="cancel">Cancel</button><button class="btn btn-primary" type="button" data-acct2fa="confirm">Turn on</button></div>`;
    return;
  }
  if (!i.two_step.on) {
    box.innerHTML = `<p class="row gap-8" style="flex-wrap:wrap"><span class="badge">Off</span>${req}</p>
      <p class="muted">After your password, sign-in also asks for a code from your phone. Recommended for Owners and Admins.</p>
      <div><button class="btn btn-primary" type="button" data-acct2fa="start">Set up two-step login</button></div>`;
    return;
  }
  box.innerHTML = `<p class="row gap-8" style="flex-wrap:wrap"><span class="badge good">On</span>${req}<span class="subtle" style="font-size:13px">since ${fmtDate(i.two_step.enrolled_at)} · ${i.two_step.recovery_left} recovery code${i.two_step.recovery_left === 1 ? "" : "s"} left</span></p>
    <p class="muted" style="font-size:13px">To turn it off or make new recovery codes, confirm with your password and a current code (or a recovery code).${i.required ? " Your role requires it: if you turn it off you set it up again straight away (e.g. on a new phone)." : ""}</p>
    <div class="grid-2"><div class="field"><label for="ac-pw2">Password</label><input class="input" id="ac-pw2" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="ac-code2">Code or recovery code</label><input class="input" id="ac-code2" autocomplete="one-time-code"></div></div>
    <div class="row gap-8" style="flex-wrap:wrap"><button class="btn" type="button" data-acct2fa="recovery">New recovery codes</button><button class="btn" type="button" data-acct2fa="disable">Turn off</button></div>`;
}
const acctSecond = (v) => (/^\s*\d{3}\s?\d{3}\s*$/.test(v) ? { code: v.replace(/\s/g, "") } : { recovery: v });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest("#acct2fa")) e.preventDefault(); });
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acct2fa]"); if (!b) return;
  const act = b.dataset.acct2fa;
  try {
    if (act === "start") { ACCT.setup = await api("/api/me/2fa/start", { method: "POST" }); ACCT.step = "setup"; }
    if (act === "cancel") { ACCT.step = ""; ACCT.setup = null; }
    if (act === "confirm") { const r = await api("/api/me/2fa/confirm", { method: "POST", body: JSON.stringify({ code: $("#ac-code").value }) }); ACCT.codes = r.recovery_codes; ACCT.step = ""; ACCT.setup = null; toast("Two-step login is on"); }
    if (act === "copy") { try { await navigator.clipboard.writeText(ACCT.codes.join("\n")); toast("Copied"); } catch { toast("Clipboard blocked: copy them by hand", true); } return; }
    if (act === "done") ACCT.codes = null;
    if (act === "disable" || act === "recovery") {
      const body = { password: $("#ac-pw2").value, ...acctSecond($("#ac-code2").value) };
      if (act === "disable") { const r = await api("/api/me/2fa/disable", { method: "POST", body: JSON.stringify(body) }); toast("Two-step login is off"); if (r.required) { location.href = "/login/enrol"; return; } }
      else { const r = await api("/api/me/2fa/recovery", { method: "POST", body: JSON.stringify(body) }); ACCT.codes = r.recovery_codes; }
    }
    ACCT.info = await api("/api/me/security"); S.me = await api("/api/me");
    acctDraw();
  } catch (err) { toast(err.message, true); }
});
