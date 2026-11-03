/* Command Center: the home screen. One snapshot across Marketing, Sales, Support,
   Hiring and the SOP. Read-only; every panel links to the page that acts on it.
   Uses app.js globals (S, $, api, esc, go, fmtDate, ROUTES). */

ROUTES.command = { title: "Command Center", crumb: "Home", render: renderCommand };

const cMoney = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e4) return "$" + Math.round(n / 1e3) + "k";
  return "$" + Math.round(n).toLocaleString("en-US");
};
const cNum = (v, unit) => unit === "$" ? cMoney(v) : unit === "%" ? `${+v.toFixed(1)}%` : `${+Number(v).toFixed(2)}${unit && !["$", "%"].includes(unit) ? " " + unit : ""}`;
const MOD_COLOR = { Marketing: "#8a7cf0", Sales: "var(--accent)", Support: "var(--good)", Hiring: "var(--warn)", Finance: "#0e7490", Operations: "#be123c", Product: "#4d7c0f", "Store CRM": "#0a7fa8", Outreach: "#0a7fa8" };

async function renderCommand(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const [d, sopData] = await Promise.all([api(`/api/workspaces/${S.ws.id}/command`), api(`/api/workspaces/${S.ws.id}/sop`)]);
  $("#pageActions").innerHTML = `${d.has_samples ? `<span class="badge warn">Sample data loaded</span><button class="btn btn-sm btn-ghost btn-danger" data-cmd="unsample">Remove sample data</button>` : `<button class="btn btn-sm" data-cmd="sample">Load sample data</button>`}<span class="subtle s-small">Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><button class="btn btn-sm" data-cmd="refresh">Refresh</button>`;
  view.innerHTML = `${d.has_samples ? `<div class="notice" style="margin-bottom:16px">You're looking at sample data in every module (names start with "Sample ·"). Remove it from the top-right before entering real data, so reports and AI drafts only use your real numbers.</div>` : ""}<div class="cc">
    ${ccHello(d)}
    ${ccGoal(d)}
    ${ccNeeds(d)}
    ${ccGrowth(d)}
    ${ccTiles(d)}
    ${ccSopFull(sopData)}
    ${ccWork(d)}
    ${ccTeam(d)}
    ${ccFunnel(d)}
    ${ccKpis(d)}
    ${ccFeed(d)}
  </div>`;
}

/* ---- Greeting and the day in one line */
function ccHello(d) {
  const now = new Date(), h = (now.getUTCHours() + 3) % 24; // Riyadh, UTC+3
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
  const o = d.outreach, chips = [];
  if (d.needs.length) chips.push([`${d.needs.length} need${d.needs.length === 1 ? "s" : ""} you`, "warn", ""]);
  if (o?.calls) chips.push([`${o.calls} call${o.calls === 1 ? "" : "s"} to make`, "warn", "crm"]);
  if (o?.inbox_open) chips.push([`${o.inbox_open} store repl${o.inbox_open === 1 ? "y" : "ies"} in the inbox`, o.inbox_person ? "warn" : "", "crm"]);
  if (o) chips.push([o.mode === "live" ? `Outreach live · ${o.running} campaign${o.running === 1 ? "" : "s"}` : "Outreach in test mode", o.mode === "live" ? "good" : "", "crm"]);
  if (!d.finance.hidden && d.finance.runway_months != null) chips.push([`${d.finance.runway_months} mo runway`, d.finance.runway_months < 6 ? "bad" : "", "finance"]);
  return `<section class="cc-hello cc-span-12"><div><h2>${hello}${d.me?.name ? ", " + esc(d.me.name) : ""}</h2><span class="subtle s-small">${esc(day)} · ${esc(d.company)}</span></div>
    <div class="cc-chips">${chips.map(([t, tone, r]) => `<${r ? `button type="button" data-go="${r}"` : "span"} class="badge ${tone}">${esc(t)}</${r ? "button" : "span"}>`).join("")}${chips.length ? "" : `<span class="badge good">All clear</span>`}</div></section>`;
}

/* ---- Growth funnel: from the store database to paying customers, across CRM and Sales */
function ccGrowth(d) {
  const o = d.outreach;
  if (!o) return "";
  if (!o.stores) return `<section class="card card-pad cc-span-12 clickable" data-go="crm"><span class="eyebrow">Growth funnel</span><p class="muted s-small" style="margin-top:8px">Import your Salla / Zid store list in Store CRM to see the whole funnel here, from the database to paying stores.</p></section>`;
  const steps = [["Stores in CRM", o.stores, "crm"], ["Contacted", o.contacted, "crm"], ["Replied", o.replied, "crm"], ["Qualified", o.qualified, "pipeline"], ["Customers", o.onboarding + o.active, "crm"]];
  const max = Math.max(1, steps[0][1]);
  const pct = (a, b) => (b && a <= b ? (a / b) * 100 : null);
  const closeOk = d.close && d.close.verdict !== "too early";
  const fmt = (x) => (x == null ? "–" : x < 1 && x > 0 ? x.toFixed(1) + "%" : Math.round(x) + "%");
  return `<section class="card card-pad cc-span-12">
    <div class="row between" style="flex-wrap:wrap;gap:8px"><span class="eyebrow">Growth funnel · Store CRM → Sales</span>
      <span class="subtle s-small">${o.sent_week.toLocaleString("en-US")} messages this week · reply rate ${o.reply_rate == null ? "–" : o.reply_rate + "%"} · ${o.running} campaign${o.running === 1 ? "" : "s"} running${closeOk ? ` · close rate ${Math.round(d.close.rate * 100)}%` : ""}</span></div>
    <div class="cc-growth">${steps.map(([label, n, r], i) => `${i ? `<div class="cc-g-conv"><b class="num">${fmt(pct(n, steps[i - 1][1]))}</b><span class="subtle">→</span></div>` : ""}
      <button type="button" class="cc-g-step" data-go="${r}"><span class="s-small muted">${label}</span><b class="num">${Number(n).toLocaleString("en-US")}</b>
        <span class="cc-g-bar"><i style="width:${Math.max(2, (Math.log10(n + 1) / Math.log10(max + 1)) * 100)}%"></i></span></button>`).join("")}</div>
    <p class="subtle s-small">Stores from the CRM only; customers = onboarding + active. Bars use a log scale so small numbers stay visible; percentages are step to step.${d.revenue.paying ? ` Sales has ${d.revenue.paying} paying store${d.revenue.paying === 1 ? "" : "s"} in total, including deals added there directly.` : ""}</p>
  </section>`;
}

/* ---- Path to the ARR goal: a log-scale track from $0 to $100M ARR */
function ccGoal(d) {
  const g = d.goal, r = d.revenue;
  const W = 900, H = 96, L = 12, R = 24, y = 46;
  const lo = Math.log10(1000), hi = Math.log10(g.arr_goal);
  const X = (v) => L + (W - L - R) * Math.min(1, Math.max(0, (Math.log10(Math.max(v, 1000)) - lo) / (hi - lo)));
  const cur = X(g.arr), exp = X(r.expected_mrr * 12);
  let svg = `<rect x="${L}" y="${y - 5}" width="${W - L - R}" height="10" rx="5" fill="var(--surface-2)"></rect>`;
  if (r.expected_mrr * 12 > g.arr) svg += `<rect x="${L}" y="${y - 5}" width="${Math.max(0, exp - L)}" height="10" rx="5" fill="var(--accent)" opacity=".25"></rect>`;
  if (g.arr > 0) svg += `<rect x="${L}" y="${y - 5}" width="${Math.max(10, cur - L)}" height="10" rx="5" fill="var(--accent)"></rect>`;
  for (const m of g.milestones) {
    const x = X(m), hit = g.arr >= m;
    svg += `<line x1="${x}" x2="${x}" y1="${y - 14}" y2="${y + 14}" stroke="${hit ? "var(--accent)" : "var(--border-strong)"}" stroke-width="1.5"></line>
      <text class="s-svg-mono" x="${x}" y="${y + 32}" text-anchor="${m === g.arr_goal ? "end" : "middle"}">${cMoney(m)} ARR</text>`;
  }
  svg += `<circle cx="${Math.max(L + 6, cur)}" cy="${y}" r="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="3"></circle>
    <text class="s-svg-strong" x="${Math.max(L, Math.min(cur, W - 140))}" y="${y - 20}">Today ${cMoney(g.arr)}</text>`;
  const pct = g.pct_of_goal * 100;
  return `<section class="card cc-goal cc-span-8">
    <div class="row between" style="flex-wrap:wrap;gap:12px;align-items:flex-start">
      <div><span class="eyebrow">Path to ${cMoney(g.arr_goal)} ARR</span>
        <div class="cc-hero num">${cMoney(g.arr)}<span> ARR</span></div>
        <p class="muted s-small">${pct < 0.01 && g.arr > 0 ? "<0.01" : pct.toFixed(pct < 1 ? 3 : 1)}% of the goal · next milestone ${cMoney(g.next_milestone)} ARR (${cMoney(Math.max(0, g.next_milestone - g.arr) / 12)}/mo more MRR)</p></div>
      <div class="cc-mini-stats">
        <div><span class="eyebrow">Paying MRR</span><b class="num">${cMoney(r.paying_mrr)}</b></div>
        <div><span class="eyebrow">Expected MRR</span><b class="num">${cMoney(r.expected_mrr)}</b></div>
        <div><span class="eyebrow">Paying stores</span><b class="num">${r.paying}</b></div>
      </div>
    </div>
    <div class="cc-track-wrap"><svg viewBox="0 0 ${W} ${H}" class="cc-track" role="img" aria-label="ARR ${cMoney(g.arr)} on a log scale to ${cMoney(g.arr_goal)}">${svg}</svg></div>
    <p class="subtle s-small">Log scale: each step is 10× the last. The light bar is where expected MRR (paying + weighted pipeline) would put you.</p>
  </section>`;
}

function ccNeeds(d) {
  const n = d.needs;
  return `<section class="card cc-needs cc-span-4">
    <div class="row between"><span class="eyebrow">Needs you</span><span class="badge ${n.length ? "warn" : "good"}">${n.length ? n.length + " waiting" : "All clear"}</span></div>
    ${n.length ? `<ul class="cc-list">${n.slice(0, 7).map((x) => `<li class="clickable" data-go="${x.route}" ${x.param ? `data-param="${esc(x.param)}"` : ""}>
      <span class="cc-mod" style="background:${MOD_COLOR[x.module]}"></span><div style="min-width:0"><b>${esc(x.title)}</b><span class="subtle s-small"> · ${x.module}</span><p class="s-small muted cc-clamp">${esc(x.text)}</p></div></li>`).join("")}</ul>
      ${n.length > 7 ? `<p class="subtle s-small">${n.length - 7} more</p>` : ""}`
      : `<p class="muted s-small" style="margin-top:12px">Nothing needs a person right now. AI is handling the rest.</p>`}
  </section>`;
}

function ccTiles(d) {
  const r = d.revenue, s = d.support, t = d.team;
  const tile = (label, val, sub, route, tone = "") => `<button type="button" class="card s-kpi cc-tile ${tone}" data-go="${route}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></button>`;
  const o = d.outreach;
  return `<div class="cc-tiles cc-span-12">
    ${d.finance.hidden ? "" : tile("Runway", d.finance.runway_months == null ? (d.finance.month_costs_sar ? "∞" : "–") : d.finance.runway_months + " mo", d.finance.cash_as_of ? `SAR ${Math.round(d.finance.cash_sar).toLocaleString("en-US")} cash · burn ${Math.round(d.finance.net_burn_sar).toLocaleString("en-US")}/mo` : "add your bank balance in Finance", "finance", d.finance.runway_months != null && d.finance.runway_months < 6 ? "warn" : "")}
    ${o ? tile("Outreach", o.reply_rate == null ? "–" : o.reply_rate + "%", `reply rate · ${o.sent_week.toLocaleString("en-US")} sent this week${o.mode === "live" ? "" : " (test)"}`, "crm", o.calls || o.inbox_person ? "warn" : "") : ""}
    ${r.hidden ? "" : tile("Pipeline", r.open_deals, `open deals · ${cMoney(r.open_value)}/mo if all close${d.close && d.close.verdict !== "too early" ? ` · close ${Math.round(d.close.rate * 100)}%` : ""}`, "pipeline", d.close?.verdict === "broken" ? "bad" : "")}
    ${tile("ROAS lift", d.roas.lift == null ? "–" : `${d.roas.lift > 0 ? "+" : ""}${Math.round(d.roas.lift * 100)}%`, d.roas.stores ? `designed ${d.roas.designed ?? "–"}x vs plain ${d.roas.plain ?? "–"}x · ${esc(d.roas.verdict)}` : "import store ad results to prove it", "results", d.roas.lift != null && d.roas.lift < 0 ? "warn" : "")}
    ${tile("Support", s.open, `open · ${s.needs_you} need you · ${s.ai_resolved_pct == null ? "–" : s.ai_resolved_pct + "%"} solved by AI`, "support", s.needs_you ? "warn" : "")}
    ${tile("Operations", d.ops.open_tasks, `open tasks · ${d.ops.ai_owned_pct == null ? "–" : d.ops.ai_owned_pct + "%"} AI-owned${d.ops.open_incidents ? ` · ${d.ops.open_incidents} incident${d.ops.open_incidents === 1 ? "" : "s"}` : ""}`, "ops", d.ops.open_incidents || d.ops.overdue ? "warn" : "")}
    ${tile("Product", `${d.product.now} · ${d.product.next}`, `Now · Next${d.product.last_release ? " · last " + esc(d.product.last_release) : ""}${d.product.feedback_unlinked ? ` · ${d.product.feedback_unlinked} requests to group` : ""}`, "product")}
    ${tile("Data completeness", d.data_completeness + "%", d.gaps[0] ? esc(d.gaps[0].question) : "everything filled in", "overview", d.data_completeness < 70 ? "warn" : "")}
  </div>`;
}

/* ---- AI vs people: who did the work this week */
function ccWork(d) {
  const w = d.work, max = Math.max(1, ...w.modules.map((m) => m.ai + m.people));
  return `<section class="card card-pad cc-span-6">
    <div class="row between" style="align-items:flex-start;gap:12px;flex-wrap:wrap"><div><span class="eyebrow">AI workforce · last 7 days</span>
      <div class="cc-big num">${w.ai_share == null ? "–" : w.ai_share + "%"}<span> of actions by AI</span></div></div>
      <div class="s-legend" style="margin:0"><span><i class="s-dot" style="background:var(--accent)"></i>AI</span><span><i class="s-dot" style="background:var(--warn)"></i>People</span></div></div>
    <div class="cc-bars">${w.modules.map((m) => `<button type="button" class="cc-bar-row" data-go="${m.route}">
      <span class="cc-bar-label">${m.module}</span>
      <span class="cc-bar"><i style="width:${(m.ai / max) * 100}%;background:var(--accent)"></i><i style="width:${(m.people / max) * 100}%;background:var(--warn)"></i></span>
      <span class="num s-small cc-bar-val">${m.ai} AI · ${m.people} you</span></button>`).join("")}</div>
    <p class="subtle s-small">AI actions: playbooks written, drafts, screens and live chat replies. People: messages you sent, stage moves, notes.</p>
  </section>`;
}

/* ---- Team: AI agents vs people donut */
function ccTeam(d) {
  const t = d.team, total = t.agents + t.humans;
  const C = 2 * Math.PI * 38, aiLen = total ? (t.agents / total) * C : 0;
  return `<section class="card card-pad cc-span-6 clickable" data-go="team">
    <span class="eyebrow">Team</span>
    <div class="row gap-16" style="margin-top:8px">
      <svg viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="${t.agents} AI agents, ${t.humans} people">
        <circle cx="50" cy="50" r="38" fill="none" stroke="var(--warn)" stroke-width="12" opacity="${total ? 1 : 0.2}"></circle>
        <circle cx="50" cy="50" r="38" fill="none" stroke="var(--accent)" stroke-width="12" stroke-dasharray="${aiLen} ${C}" transform="rotate(-90 50 50)"></circle>
        <text x="50" y="57" text-anchor="middle" class="s-svg-strong" style="font-size:20px">${total ? Math.round((t.agents / total) * 100) + "%" : "–"}</text></svg>
      <div class="cc-team-facts">
        <span><b class="num">${t.agents}</b> <span class="muted">AI agents</span></span>
        <span><b class="num">${t.humans}</b> <span class="muted">people</span></span>
        <span class="subtle s-small">${t.open_roles} hiring · ${t.planned_roles} planned</span>
        ${t.hidden ? "" : `<span class="subtle s-small num">SAR ${t.payroll_sar.toLocaleString("en-US")}/mo planned payroll</span>`}
      </div></div>
  </section>`;
}

/* ---- The whole operating SOP, on the founder's home screen */
const CC_SOP = { cadence: null };
function ccSopFull(sd) {
  const done = new Set(sd.checks.map((c) => c.step));
  const secs = sd.sop.map((s) => ({ ...s, total: s.steps.length, n: s.steps.filter((st) => done.has(`${s.cadence}:${st.id}`)).length }));
  const setupDone = secs.find((s) => s.cadence === "setup");
  // Default view: setup until it's finished, then this week.
  const pick = CC_SOP.cadence || (setupDone && setupDone.n < setupDone.total ? "setup" : "weekly");
  const LABEL = { setup: "Set-up", weekly: "This week", monthly: "This month", quarterly: "This quarter" };
  const cur = secs.find((s) => s.cadence === pick) || secs[0];
  const pageName = (st) => st.param ? (S.playbooks.find((p) => p.key === st.param)?.title || st.param) : st.go ? (ROUTES[st.go]?.title || st.go) : "";
  const day = new Date().getDay(); // 0 Sun … 5 Fri
  const today = (t) => (/^Monday:/.test(t) && day === 1) || (/^Friday:/.test(t) && day === 5) || /^Daily:/.test(t);
  return `<section class="card cc-span-12 cc-sop">
    <div class="cc-sop-head">
      <div><span class="eyebrow">Operating SOP</span><p class="s-small muted">Everything the company runs on, in one list. Tick steps here; each one opens the page that does it.</p></div>
      <div class="cc-sop-tabs" role="tablist" aria-label="SOP cadence">${secs.map((s) => {
        const p = s.total ? s.n / s.total : 0, C = 2 * Math.PI * 9;
        return `<button role="tab" aria-selected="${s.cadence === cur.cadence}" data-ccsoptab="${s.cadence}">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--surface-2)" stroke-width="4"></circle><circle cx="12" cy="12" r="9" fill="none" stroke="${p === 1 ? "var(--good)" : "var(--accent)"}" stroke-width="4" stroke-dasharray="${p * C} ${C}" transform="rotate(-90 12 12)"></circle></svg>
          <span><b>${LABEL[s.cadence]}</b><span class="subtle s-small num"> ${s.n}/${s.total}</span></span></button>`;
      }).join("")}</div>
    </div>
    <p class="subtle s-small cc-sop-when">${esc(cur.when)} · ${esc(cur.goal)} · <span class="mono">${esc(sd.periods[cur.cadence])}</span></p>
    <ul class="cc-sop-list">${cur.steps.map((st, i) => {
      const key = `${cur.cadence}:${st.id}`, ok = done.has(key);
      return `<li class="${ok ? "done" : ""} ${!ok && today(st.text) ? "today" : ""}">
        <input type="checkbox" id="cc-${esc(key)}" data-ccsop="${esc(cur.cadence)}" data-step="${esc(st.id)}" ${ok ? "checked" : ""}>
        <label for="cc-${esc(key)}"><span class="subtle num">${i + 1}.</span> ${esc(st.text)}${!ok && today(st.text) ? ' <span class="badge warn">today</span>' : ""}</label>
        <span class="cc-sop-owner s-small">${esc(st.owner)}</span>
        ${st.go ? `<button class="btn btn-sm" data-go="${esc(st.go)}"${st.param ? ` data-param="${esc(st.param)}"` : ""}>${esc(pageName(st))} →</button>` : `<span class="subtle s-small">outside the dashboard</span>`}
      </li>`;
    }).join("")}</ul>
  </section>`;
}

/* ---- Sales funnel */
function ccFunnel(d) {
  const f = d.revenue.funnel, max = Math.max(1, ...f.map((x) => x.count));
  const colors = { lead: "var(--text-3)", contacted: "#8a7cf0", demo: "var(--accent)", beta: "var(--warn)", trial: "#e0703a", paying: "var(--good)" };
  return `<section class="card card-pad cc-span-6 clickable" data-go="pipeline">
    <div class="row between"><span class="eyebrow">Sales pipeline now</span><span class="subtle s-small">${d.revenue.open_deals} open · ${d.revenue.paying} paying</span></div>
    ${f.some((x) => x.count) ? `<div class="cc-funnel">${f.map((x) => `<div class="cc-f-col"><span class="num cc-f-n">${x.count}</span><span class="cc-f-bar" style="height:${8 + (x.count / max) * 92}px;background:${colors[x.id]}"></span><span class="s-small subtle">${x.name}</span></div>`).join("")}</div>`
      : `<p class="muted s-small" style="margin-top:12px">No deals yet. Add your first store in the Sales pipeline.</p>`}
  </section>`;
}

/* ---- KPI sparklines */
function ccKpis(d) {
  const spark = (vals, good) => {
    if (vals.length < 2) return "";
    const w = 120, h = 32, mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - mn) / span) * (h - 6)]);
    const line = pts.map((p) => p.join(",")).join(" "), c = good === false ? "var(--bad)" : "var(--accent)";
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="cc-spark" aria-hidden="true"><polygon points="0,${h} ${line} ${w},${h}" fill="${c}" opacity=".1"></polygon><polyline points="${line}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke"></polyline><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="2.5" fill="${c}"></circle></svg>`;
  };
  return `<section class="card card-pad cc-span-6 clickable" data-go="kpis">
    <div class="row between"><span class="eyebrow">KPIs</span><span class="subtle s-small">${d.kpis.length} of ${d.kpis_defined} with data</span></div>
    ${d.kpis.length ? `<div class="cc-kpis">${d.kpis.map((k) => {
      const better = k.change == null || k.change === 0 ? null : (k.change > 0) === k.higher_is_better;
      return `<div class="cc-kpi"><span class="s-small muted cc-clamp1">${esc(k.name)}</span><b class="num">${cNum(k.last, k.unit)}</b>
        <span class="s-small num" style="color:${better == null ? "var(--text-3)" : better ? "var(--good)" : "var(--bad)"}">${k.change == null ? k.period : `${k.change > 0 ? "▲" : "▼"} ${cNum(Math.abs(k.change), k.unit)} · ${k.period}`}</span>${spark(k.series, better)}</div>`;
    }).join("")}</div>` : `<p class="muted s-small" style="margin-top:12px">${d.kpis_defined ? "Log your first KPI values to see trends here." : "Load the SOP KPIs on the KPIs page, then log values weekly."}</p>`}
  </section>`;
}

/* ---- Activity feed */
function ccFeed(d) {
  return `<section class="card card-pad cc-span-12">
    <span class="eyebrow">Latest activity</span>
    ${d.feed.length ? `<ul class="cc-feed">${d.feed.map((f) => `<li class="clickable" data-go="${f.route}"><span class="cc-mod" style="background:${MOD_COLOR[f.module]}"></span>
      <span class="s-owner ${f.by === "ai" ? "ai" : "you"}" ${["customer", "sample"].includes(f.by) ? 'style="background:var(--surface-2);color:var(--text-2)"' : ""}>${{ ai: "AI", customer: "CUSTOMER", sample: "SAMPLE" }[f.by] || "YOU"}</span>
      <span class="grow cc-clamp1">${esc(f.text)}</span><span class="subtle s-small cc-feed-mod">${f.module}</span><span class="subtle s-small num" style="white-space:nowrap">${fmtDate(f.at)}</span></li>`).join("")}</ul>`
      : `<p class="muted s-small" style="margin-top:12px">Nothing yet. Run a playbook, add a lead, or answer a customer, and it shows up here.</p>`}
  </section>`;
}

document.addEventListener("change", async (e) => {
  const box = e.target.closest?.("[data-ccsop]");
  if (!box || S.route !== "command") return;
  box.disabled = true;
  try {
    await api(`/api/workspaces/${S.ws.id}/sop`, { method: "POST", body: JSON.stringify({ cadence: box.dataset.ccsop, step: box.dataset.step, done: box.checked }) });
    CC_SOP.cadence = box.dataset.ccsop;
    await renderCommand($("#view"));
  } catch (err) { box.checked = !box.checked; box.disabled = false; toast("Couldn't save that tick. Try again.", true); }
});

document.addEventListener("click", async (e) => {
  if (S.route !== "command") return;
  const tab = e.target.closest("[data-ccsoptab]");
  if (tab) { CC_SOP.cadence = tab.dataset.ccsoptab; return renderCommand($("#view")); }
  if (e.target.closest('[data-cmd="refresh"]')) return renderCommand($("#view"));
  const b = e.target.closest('[data-cmd="sample"],[data-cmd="unsample"]');
  if (!b) return;
  try {
    if (b.dataset.cmd === "sample") {
      b.disabled = true; b.textContent = "Loading…";
      const c = await api(`/api/workspaces/${S.ws.id}/sample-data`, { method: "POST", body: "{}" });
      toast(`Loaded sample data: ${c.deals} deals, ${c.tickets} conversations, ${c.candidates} candidates, ${c.expenses} expenses, ${c.tasks} tasks, ${c.feedback} requests and more`);
    } else {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Click again: remove all sample data"; return; }
      await api(`/api/workspaces/${S.ws.id}/sample-data`, { method: "DELETE" });
      toast("Sample data removed. Your own data is untouched.");
    }
    renderCommand($("#view"));
  } catch (err) { toast(err.message, true); renderCommand($("#view")); }
});

if (S.route === "command" && S.ws) render();
