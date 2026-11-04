/* Page guides: the round "i" button next to every page title and its pop-up (content in guides.js).
   The button lives in index.html; render() in app.js calls gdSync() on every page. "?" opens the guide for the
   current page (when not typing), Esc closes it, focus stays inside and returns to the button.
   Who can use a module and the AI agents come from GET /api/guide/meta (fetched each time the pop-up opens).
   Uses app.js globals at call time (S, $, esc, go, NAV, NAV_ICON, ROUTES, ROUTE_MODULE, ROUTE_ANY, levelFor, canSee).
   Names start with "gd". */

const GD = { meta: null, metaP: null, open: false };
const GD_ACTOR = {
  ai: { name: "AI", who: "AI", icon: "M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8z" },
  person: { name: "You / a person", who: "You", icon: "M10 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM4 17a6 6 0 0 1 12 0" },
  system: { name: "Automatic", who: "Automatic", icon: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3.5V10l2.5 2" },
};
const GD_LEVEL = { edit: "Edit", view: "View", none: "None" };
const gdIcon = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Live status lines: only from data the page already loaded (never a fetch just for the guide).
const GD_LIVE = {
  crm: () => (typeof CRM !== "undefined" ? CRM.meta?.settings?.mode : null),
  billing: () => (typeof BL !== "undefined" ? BL.d?.settings?.mode : null),
  success: () => (typeof SX !== "undefined" ? SX.d?.settings?.mode : null),
  ads: () => (typeof PA !== "undefined" ? (PA.ov?.mode || PA.camp?.mode) : null),
  studio: () => (typeof CP !== "undefined" ? CP.acc?.settings?.mode : null),
};
const GD_LIVE_NOTE = {
  crm: ["nothing leaves the server; every message is logged as a test.", "messages are really sent through the connected channels."],
  billing: ["invoices are numbered, but no card links, ZATCA calls or emails.", "Moyasar links and emails are on."],
  success: ["surveys and AI emails are only logged.", "surveys and emails go out through the Store CRM."],
  ads: ["nothing changes on any ad platform.", "insights are pulled every 6 hours and guardrails can act."],
  studio: ["publishing is simulated; nothing is posted.", "approved posts are really published."],
};

function gdName(route) {
  for (const n of typeof NAV !== "undefined" ? NAV : []) {
    if (n.route === route) return n.label;
    const it = (n.items || []).find(([r]) => r === route);
    if (it) return it[1];
  }
  return ROUTES[route]?.title || route;
}
const gdModules = (route) => ROUTE_ANY[route] || [ROUTE_MODULE[route] || "command"];
const gdSeenKey = () => `mwiz.guide.seen.${S.me?.user?.id || "anon"}`;
function gdSeen() { try { return new Set(JSON.parse(localStorage.getItem(gdSeenKey()) || "[]")); } catch { return new Set(); } }
function gdMarkSeen(route) { try { const s = gdSeen(); s.add(route); localStorage.setItem(gdSeenKey(), JSON.stringify([...s])); } catch {} }

/* ------------------------------------------------ button + first-visit hint (called by render()) */
function gdSync() {
  const btn = $("#guideBtn"); if (!btn) return;
  $("#gdTip")?.remove(); btn.classList.remove("gd-pulse");
  const ok = !!(S.ws && GUIDES[S.route] && canSee(S.route));
  btn.hidden = !ok;
  if (!ok) return;
  const name = gdName(S.route);
  btn.setAttribute("aria-label", `About ${name}`);
  btn.title = "How this works";
  if (!gdSeen().has(S.route)) {
    gdMarkSeen(S.route);
    btn.classList.add("gd-pulse");
    btn.insertAdjacentHTML("afterend", `<button type="button" class="gd-tip" id="gdTip" data-gdtip>New here? See how it works <span class="gd-x" data-gdx aria-hidden="true">×</span></button>`);
  }
}

/* ------------------------------------------------ pop-up */
// Small and read-only: fetched on each open (agent levels change in AI Workforce); the last copy shows meanwhile.
async function gdLoadMeta() {
  GD.metaP ||= api("/api/guide/meta").then((m) => (GD.meta = m)).catch(() => GD.meta).finally(() => { GD.metaP = null; });
  return GD.metaP;
}

function gdFlow(steps) {
  const items = steps.map((s, i) => {
    const a = GD_ACTOR[s.actor] || GD_ACTOR.system;
    return `${i ? `<li class="gd-arrow" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></li>` : ""}
      <li class="gd-step gd-${esc(s.actor)}"><span class="gd-num" aria-hidden="true">${i + 1}</span><span class="gd-ico">${gdIcon(a.icon, 18)}</span>
        <span class="gd-lab">${esc(s.label)}</span><span class="gd-who"><span class="gd-sr">${esc(a.name)}: </span>${esc(s.who || a.who)}</span></li>`;
  }).join("");
  const legend = Object.entries(GD_ACTOR).map(([k, a]) => `<span class="gd-leg gd-${k}">${gdIcon(a.icon, 14)}${esc(a.name)}</span>`).join("");
  return `<ol class="gd-flow" aria-label="How it works, step by step">${items}</ol><div class="gd-legend">${legend}</div>`;
}

function gdMap(map) {
  const navOf = (key) => NAV.find((n) => n.group === key || n.route === key) || {};
  return `<div class="gd-principle">${gdIcon(GD_ACTOR.ai.icon, 18)}<p><b>AI does every step it can; people do only what must be human:</b> approvals, live calls, contracts and anything the AI flags.</p></div>
    <ul class="gd-map">${map.map((m) => { const n = navOf(m.key); return `<li>${gdIcon(NAV_ICON[n.icon] || "", 18)}<div><b>${esc(n.label || m.key)}</b><span>${esc(m.line)}</span></div></li>`; }).join("")}</ul>`;
}

function gdAccess(route, meta) {
  const mods = gdModules(route), mine = levelFor(route);
  const you = `<p class="gd-you">Your access: <span class="gd-lvl gd-l-${esc(mine)}">${esc(GD_LEVEL[mine] || mine)}</span> <span class="subtle">(${esc(S.me?.role || "")})</span></p>`;
  if (!meta) return you;
  const lv = (l) => `<span class="gd-lvl gd-l-${esc(l)}">${esc(GD_LEVEL[l] || l)}</span>`;
  let grid;
  if (mods.length === 1) grid = `<ul class="gd-rolegrid">${meta.roles.map((r) => `<li${r.id === S.me?.user?.role_id ? ' class="gd-me"' : ""}><span>${esc(r.name)}</span>${lv(meta.defaults[mods[0]]?.[r.id] || "none")}</li>`).join("")}</ul>`;
  else {
    const names = Object.fromEntries((S.me?.modules || []).map((m) => [m.id, m.name]));
    grid = `<div class="gd-tablewrap"><table class="gd-roles"><thead><tr><th scope="col">Role</th>${mods.map((m) => `<th scope="col">${esc((names[m] || m).split(" (")[0])}</th>`).join("")}</tr></thead>
      <tbody>${meta.roles.map((r) => `<tr><th scope="row">${esc(r.name)}</th>${mods.map((m) => `<td>${lv(meta.defaults[m]?.[r.id] || "none")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const link = canSee("access") ? ` <button type="button" class="linklike" data-gdgo="access">Open Teams &amp; roles</button>` : "";
  return `${you}${grid}<p class="subtle s-small">Built-in defaults. An Owner or Admin can change any role.${link}</p>`;
}

function gdAgents(route, meta) {
  const list = (meta?.agents || []).filter((a) => a.route === route);
  if (!list.length) return "";
  const lvl = (a) => (a.level === undefined ? "" : ` <span class="gd-lvl gd-l-ai">${esc(meta.levels?.find((l) => l.id === a.level)?.name || `Level ${a.level}`)}</span>`);
  const more = meta.levels ? (canSee("workforce") ? ` <button type="button" class="linklike" data-gdgo="workforce">Manage in AI Workforce</button>` : "") : `<span class="subtle s-small"> Levels show for roles that can view AI Workforce.</span>`;
  return `<section class="gd-sec"><h3>AI agents here</h3><ul class="gd-agents">${list.map((a) => `<li>${gdIcon(GD_ACTOR.ai.icon, 14)}<span>${esc(a.name)}</span>${lvl(a)}</li>`).join("")}</ul><p class="s-small">${more}</p></section>`;
}

function gdStatus(route, g) {
  const out = [];
  const mode = GD_LIVE[route]?.();
  if (mode === "live" || mode === "test") out.push(`<span class="gd-chip ${mode === "live" ? "gd-live" : "gd-test"}">${esc(gdName(route))} is in ${mode === "live" ? "Live" : "Test"} mode: ${esc(GD_LIVE_NOTE[route][mode === "live" ? 1 : 0])}</span>`);
  if (S.health && S.health.provider !== "claude" && g.flow.some((s) => s.actor === "ai")) out.push(`<span class="gd-chip gd-test">Demo mode: AI steps return sample text until ANTHROPIC_API_KEY is set.</span>`);
  return out.length ? `<div class="gd-status">${out.join("")}</div>` : "";
}

function gdBody(route, meta) {
  const g = GUIDES[route], name = gdName(route);
  const tasks = g.tasks.map((t, i) => `<details class="gd-task" ${i === 0 ? "open" : ""}><summary>${esc(t.title)}</summary><ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>`).join("");
  const related = g.related.filter((r) => ROUTES[r] && canSee(r));
  return `<header class="gd-head"><div class="grow"><div class="eyebrow">How this works</div><h2 id="gdTitle">${esc(name)}</h2></div>
      <button type="button" class="btn btn-icon btn-ghost" data-gdclose aria-label="Close guide">${gdIcon("M5 5l10 10M15 5 5 15", 16)}</button></header>
    <div class="gd-body">
      ${gdStatus(route, g)}
      <section class="gd-sec"><h3>What it is</h3><p class="gd-what">${esc(g.what)}</p></section>
      <section class="gd-sec"><h3>How it works</h3>${gdFlow(g.flow)}</section>
      ${g.map ? `<section class="gd-sec"><h3>The whole system</h3>${gdMap(g.map)}</section>` : ""}
      <section class="gd-sec"><h3>How to do it</h3>${tasks}</section>
      <section class="gd-sec"><h3>Rules &amp; safety</h3><ul class="gd-rules">${g.rules.map((r) => `<li>${gdIcon("M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 7.5 3.4-.9 6-3.9 6-7.5V5z", 15)}<span>${esc(r)}</span></li>`).join("")}</ul></section>
      <div id="gdAgents">${gdAgents(route, meta)}</div>
      <section class="gd-sec"><h3>Who can use it</h3><div id="gdAccess">${gdAccess(route, meta)}</div></section>
      <section class="gd-sec"><h3>Learn more</h3>
        ${g.docs.length ? `<p class="s-small">In the repository: ${g.docs.map((d) => `<code>${esc(d)}</code>`).join(", ")}</p>` : ""}
        ${related.length ? `<div class="gd-related">${related.map((r) => `<button type="button" class="btn btn-sm" data-gdgo="${esc(r)}">${esc(gdName(r))}</button>`).join("")}</div>` : ""}
      </section>
    </div>`;
}

async function gdOpen() {
  const route = S.route, d = $("#guideDlg");
  if (!d || !GUIDES[route] || !S.ws || d.open) return;
  $("#gdTip")?.remove(); $("#guideBtn")?.classList.remove("gd-pulse");
  d.innerHTML = gdBody(route, GD.meta);
  d.showModal(); GD.open = true;
  d.querySelector("[data-gdclose]").focus();
  const had = GD.meta, meta = await gdLoadMeta();
  if (meta && meta !== had && d.open && S.route === route) { // refresh only the two parts that use it, so focus and open sections stay
    const ag = d.querySelector("#gdAgents"), ac = d.querySelector("#gdAccess");
    if (ag) ag.innerHTML = gdAgents(route, meta);
    if (ac) ac.innerHTML = gdAccess(route, meta);
  }
}
function gdClose() { const d = $("#guideDlg"); if (d?.open) d.close(); }

document.addEventListener("click", (e) => {
  const tip = e.target.closest("[data-gdtip]");
  if (tip) { tip.remove(); $("#guideBtn")?.classList.remove("gd-pulse"); if (!e.target.closest("[data-gdx]")) gdOpen(); return; }
  if (e.target.closest("#guideBtn")) { gdOpen(); return; }
  const d = $("#guideDlg"); if (!d?.open) return;
  if (e.target.closest("[data-gdclose]")) return gdClose();
  const g = e.target.closest("[data-gdgo]");
  if (g) { const r = g.dataset.gdgo; d.close(); go(r); return; }
  if (e.target === d) gdClose(); // click on the backdrop
});
document.addEventListener("keydown", (e) => {
  const d = $("#guideDlg");
  if (d?.open && e.key === "Tab") { // keep focus inside the pop-up
    const f = [...d.querySelectorAll("button, [href], summary, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || d?.open) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (document.querySelector("dialog[open]")) return; // another dialog is open
  e.preventDefault(); gdOpen();
});
document.getElementById("guideDlg")?.addEventListener("close", () => { GD.open = false; const b = document.getElementById("guideBtn"); if (b && !b.hidden) b.focus(); });
