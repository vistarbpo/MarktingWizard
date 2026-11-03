// Public status page: components, 90-day bars, published incidents. Admins manage it from
// Security & compliance; incidents start in Operations and a person publishes the customer-facing text.
// The dashboard's own uptime comes from a self-check every 5 minutes; other components are set by hand.
export const COMPONENTS = [
  { id: "dashboard", en: "Dashboard", ar: "لوحة التحكم" },
  { id: "rendering", en: "Ad rendering", ar: "تصميم الإعلانات" },
  { id: "publishing", en: "Publishing", ar: "النشر" },
  { id: "integrations", en: "Store integrations (Salla / Zid)", ar: "ربط المتاجر (سلة / زد)" },
  { id: "messaging", en: "Email & WhatsApp", ar: "البريد وواتساب" },
];
export const COMPONENT_IDS = COMPONENTS.map((c) => c.id);
export const STATES = ["operational", "maintenance", "degraded", "outage"]; // worst last
export const IMPACTS = ["degraded", "outage", "maintenance"];
export const INC_STATES = ["investigating", "identified", "monitoring", "resolved"];
const rank = (s) => Math.max(0, STATES.indexOf(s));
const worst = (a, b) => (rank(b) > rank(a) ? b : a);
const DAY = 864e5;
const riyadhDate = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);

export function createStatus({ store, fetchImpl = fetch, now = () => Date.now(), log = console }) {
  const db = store.db;
  db.status_components ||= {};
  db.status_incidents ||= [];
  db.status_checks ||= [];
  db.status_started_at ||= new Date(now()).toISOString();
  let timer = null;

  const componentState = (id) => db.status_components[id] || { state: "operational", note: "", updated_at: null };
  const setComponent = (id, { state, note }, by = "") => {
    if (!COMPONENT_IDS.includes(id) || (state && !STATES.includes(state))) return null;
    const cur = componentState(id);
    db.status_components[id] = { state: state || cur.state, note: note !== undefined ? String(note).slice(0, 300) : cur.note, updated_at: new Date(now()).toISOString(), by };
    store.save();
    return db.status_components[id];
  };

  // ---- incidents (shown publicly only when published)
  const nextId = () => String(db.status_incidents.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1);
  const clean = (b, cur = {}) => ({
    title_en: String(b.title_en ?? cur.title_en ?? "").trim().slice(0, 200), title_ar: String(b.title_ar ?? cur.title_ar ?? "").trim().slice(0, 200),
    impact: IMPACTS.includes(b.impact) ? b.impact : cur.impact || "degraded",
    components: Array.isArray(b.components) ? b.components.filter((c) => COMPONENT_IDS.includes(c)) : cur.components || [],
  });
  function addIncident(b, by = "") {
    const c = clean(b);
    if (!c.title_en && !c.title_ar) return { error: "Write a title (English or Arabic)." };
    if (!c.components.length) return { error: "Pick at least one affected component." };
    const t = new Date(now()).toISOString();
    const inc = { id: nextId(), ...c, state: INC_STATES.includes(b.state) ? b.state : "investigating", published: false, published_at: null, created_at: t, created_by: by,
      started_at: b.started_at && !isNaN(Date.parse(b.started_at)) ? new Date(b.started_at).toISOString() : t, resolved_at: null,
      ops: b.ops_ws && b.ops_id ? { ws: String(b.ops_ws), id: String(b.ops_id) } : null, updates: [] };
    if (b.text_en || b.text_ar) inc.updates.push({ at: t, state: inc.state, text_en: String(b.text_en || "").slice(0, 2000), text_ar: String(b.text_ar || "").slice(0, 2000), by });
    db.status_incidents.push(inc); store.save();
    return { incident: inc };
  }
  const getIncident = (id) => db.status_incidents.find((i) => i.id === String(id)) || null;
  function updateIncident(id, b, by = "") {
    const inc = getIncident(id);
    if (!inc) return null;
    Object.assign(inc, clean(b, inc));
    const t = new Date(now()).toISOString();
    if (b.state && INC_STATES.includes(b.state) && b.state !== inc.state) { inc.state = b.state; inc.resolved_at = b.state === "resolved" ? t : null; }
    if (b.text_en || b.text_ar) inc.updates.push({ at: t, state: inc.state, text_en: String(b.text_en || "").slice(0, 2000), text_ar: String(b.text_ar || "").slice(0, 2000), by });
    if (b.published !== undefined) { inc.published = !!b.published; inc.published_at = inc.published ? inc.published_at || t : null; inc.published_by = inc.published ? by : ""; }
    store.save();
    return inc;
  }
  function deleteIncident(id) { const n = db.status_incidents.length; db.status_incidents = db.status_incidents.filter((i) => i.id !== String(id)); store.save(); return db.status_incidents.length < n; }

  // ---- uptime self-check (dashboard only)
  async function selfCheck(url) {
    let ok = false;
    try { const r = await fetchImpl(url, { signal: AbortSignal.timeout(10e3) }); ok = r.ok; } catch { ok = false; }
    recordCheck(ok);
    return ok;
  }
  function recordCheck(ok, t = now()) {
    const d = riyadhDate(t);
    let row = db.status_checks.find((x) => x.d === d);
    if (!row) { row = { d, ok: 0, fail: 0 }; db.status_checks.push(row); }
    row[ok ? "ok" : "fail"]++; row.last_at = new Date(t).toISOString(); row.last_ok = ok;
    if (db.status_checks.length > 100) db.status_checks.splice(0, db.status_checks.length - 100);
    store.save();
  }
  function start({ url, every = 5 * 60e3 } = {}) {
    stop();
    if (!url) return;
    const run = () => selfCheck(url).catch((e) => log.error?.("[status] self-check:", e?.message));
    timer = setInterval(run, every); timer.unref?.();
    setTimeout(run, 30e3).unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }

  // ---- the public view
  function publicIncident(i) {
    return { id: i.id, title: { en: i.title_en, ar: i.title_ar }, impact: i.impact, state: i.state, components: i.components, started_at: i.started_at, resolved_at: i.resolved_at,
      updates: [...i.updates].reverse().map((u) => ({ at: u.at, state: u.state, text: { en: u.text_en, ar: u.text_ar } })) };
  }
  function view(t = now()) {
    const published = db.status_incidents.filter((i) => i.published);
    const active = published.filter((i) => i.state !== "resolved");
    const start = Date.parse(db.status_started_at);
    const days = Array.from({ length: 90 }, (_, k) => riyadhDate(t - (89 - k) * DAY));
    const dayStart = (d) => Date.parse(d + "T00:00:00+03:00"), dayEnd = (d) => dayStart(d) + DAY;
    const components = COMPONENTS.map((c) => {
      const mine = published.filter((i) => i.components.includes(c.id));
      let state = componentState(c.id).state;
      for (const i of active) if (i.components.includes(c.id)) state = worst(state, i.impact);
      const bar = days.map((d) => {
        if (dayEnd(d) <= start || dayStart(d) > t) return { date: d, state: "nodata" };
        let s = "operational";
        for (const i of mine) {
          const a = Date.parse(i.started_at), b = i.resolved_at ? Date.parse(i.resolved_at) : t;
          if (a < dayEnd(d) && b > dayStart(d)) s = worst(s, i.impact);
        }
        const row = c.id === "dashboard" ? db.status_checks.find((x) => x.d === d) : null;
        if (row && row.ok + row.fail) { const r = row.ok / (row.ok + row.fail); s = worst(s, r < 0.9 ? "outage" : r < 0.99 ? "degraded" : "operational"); }
        return { date: d, state: s, ...(row ? { checks: row.ok + row.fail, failed: row.fail } : {}) };
      });
      // Uptime: the dashboard from its self-checks; manual components from published outage time since tracking began.
      let uptime = null;
      if (c.id === "dashboard") {
        const rows = db.status_checks.filter((x) => days.includes(x.d)), tot = rows.reduce((a, x) => a + x.ok + x.fail, 0);
        uptime = tot ? Math.round((rows.reduce((a, x) => a + x.ok, 0) / tot) * 10000) / 100 : null;
      } else {
        const from = Math.max(start, t - 90 * DAY), span = t - from;
        if (span > 3600e3) {
          let down = 0;
          for (const i of mine.filter((x) => x.impact === "outage")) { const a = Math.max(from, Date.parse(i.started_at)), b = Math.min(t, i.resolved_at ? Date.parse(i.resolved_at) : t); if (b > a) down += b - a; }
          uptime = Math.round((1 - down / span) * 10000) / 100;
        }
      }
      return { id: c.id, name: { en: c.en, ar: c.ar }, state, note: componentState(c.id).note || "", uptime_pct: uptime, days: bar };
    });
    const overall = components.reduce((s, c) => worst(s, c.state), "operational");
    const cut = t - 90 * DAY;
    return {
      updated_at: new Date(t).toISOString(), overall, tracked_since: db.status_started_at,
      components,
      incidents: {
        active: active.map(publicIncident),
        past: published.filter((i) => i.state === "resolved" && Date.parse(i.resolved_at || i.started_at) >= cut).sort((a, b) => b.started_at.localeCompare(a.started_at)).map(publicIncident),
      },
    };
  }
  function admin() {
    return { components: COMPONENTS.map((c) => ({ ...c, ...componentState(c.id) })), incidents: [...db.status_incidents].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      checks: db.status_checks.slice(-14), states: STATES, impacts: IMPACTS, inc_states: INC_STATES };
  }

  return { view, admin, setComponent, addIncident, updateIncident, deleteIncident, getIncident, selfCheck, recordCheck, start, stop };
}
