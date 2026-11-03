// Attendance & payroll routes (India). Mounted by app.js after the auth middleware.
//   /api/workspaces/:ws/people/...   employees, attendance, leave, holidays, settings  → "team" module
//   /api/workspaces/:ws/payroll/...  payroll runs, payslips, statutory dues, bank CSV  → "payroll" module
//   /api/me/people/:ws/...           self-service for the signed-in person's own employee record only
// Salary fields are stripped from employee records unless the role can view Payroll.
import { myEmploymentDocs } from "./legal.js";
import { DEFAULT_RATES, PT_PRESETS, RATES_META, RATE_SOURCES, STATES, STATE_CODES, TAX_REGIMES, dueDates, fyIndex, fyMonths, fyOf, incomeTax, stateName, structureFromCtc } from "./india-payroll.js";
import { levelOk } from "./access.js";
import {
  ADJ_KINDS, DATE_RE, DAY_STATUS, EMP_TYPES, GENDERS, LEAVE_TYPES, MONTH_RE, PAN_RE, RUN_STATUS, SALARY_KEYS, TIME_RE, UAN_RE, WEEKLY_OFF,
  bankCsv, cleanSettings, dayStatus, ecrText, employedInMonth, employedOn, holidaysFor, istDate, istParts, istTime, istToIso, leaveBalances, leaveDays, leaveOn,
  mask, monthAttendance, monthName, payLine, payslipHtml, prevMonth, runTotals, sampleEmployees, settingsJson, settingsOf, statutorySummary, validDate, ytdOf,
} from "./people.js";

const E = "people_employees", P = "people_punches", L = "people_leave", LL = "people_leave_ledger", HOL = "people_holidays", RUNS = "people_runs";

// ---- data for one workspace
function ctx(store, ws) {
  const id = ws.id;
  return { settings: settingsOf(ws), employees: store.listOps(E, id), punches: store.listOps(P, id), requests: store.listOps(L, id), ledger: store.listOps(LL, id), storedHolidays: store.listOps(HOL, id) };
}
const years = (...dates) => [...new Set(dates.map((d) => Number(String(d).slice(0, 4))))].flatMap((y) => [y - 1, y, y + 1]).filter((y, i, a) => a.indexOf(y) === i);

// Everything waiting on a person in People / Payroll, for the Command Center (filtered by role in app.js).
export function peopleNeeds(store, ws, now = Date.now()) {
  const c = ctx(store, ws), today = istDate(now), out = [];
  const active = c.employees.filter((e) => e.status !== "exited");
  if (!active.length) return out;
  const pending = c.requests.filter((r) => r.status === "pending");
  if (pending.length) out.push({ module: "People", route: "people", param: "leave", title: "Attendance & payroll", text: `${pending.length} leave request${pending.length === 1 ? "" : "s"} to approve` });
  const weekAgo = istDate(now - 7 * 864e5);
  const missing = c.punches.filter((p) => !p.deleted && !p.out_at && p.date < today && p.date >= weekAgo).length;
  if (missing) out.push({ module: "People", route: "people", param: "attendance", title: "Attendance & payroll", text: `${missing} day${missing === 1 ? "" : "s"} without a punch-out this week: regularize` });
  const last = prevMonth(today.slice(0, 7));
  const run = store.listOps(RUNS, ws.id).find((r) => r.month === last && r.status !== "reversed");
  const employed = active.some((e) => employedInMonth(e, last));
  const due = dueDates(last);
  if (employed && (!run || run.status === "draft")) out.push({ module: "Payroll", route: "people", param: "payroll", title: "Payroll", text: `${monthName(last)} payroll ${run ? "is a draft: review and approve" : "not run"}; TDS due ${due[0].due}, PF/ESI ${due[1].due} (verify)` });
  else if (run?.status === "approved") out.push({ module: "Payroll", route: "people", param: "payroll", title: "Payroll", text: `${monthName(last)} payroll approved: pay salaries and mark it paid; TDS due ${due[0].due}, PF/ESI ${due[1].due} (verify)` });
  return out;
}

// Sample employees + a few weeks of punches and one pending leave request (all flagged sample: true).
export function loadSamplePeople(store, wsId, now = Date.now()) {
  const id = String(wsId), made = {};
  const from = istDate(now - 35 * 864e5);
  for (const s of sampleEmployees(now)) {
    const { key, manager, ...f } = s;
    made[key] = store.addOps(E, id, { status: "active", employment_type: "permanent", track_attendance: true, attendance_from: from, pf_applicable: true, esi_applicable: true, tax_regime: "new", tds_mode: "auto", user_id: null, phone: "", email: "", exit_date: null, exit_reason: "", ...f, sample: true }, false);
    made[key]._mgr = manager;
  }
  for (const e of Object.values(made)) { e.manager_id = e._mgr ? made[e._mgr].id : null; delete e._mgr; }
  // Opening YTD for the months of this FY before "now", so the sample TDS estimate isn't misleadingly low.
  const month = istDate(now).slice(0, 7);
  for (const e of Object.values(made)) {
    const st = structureFromCtc(e.annual_ctc), months = fyMonths(month).slice(0, fyIndex(month)).filter((m) => employedInMonth(e, m)).length;
    Object.assign(e, { opening_fy: fyOf(month), opening_taxable: st.gross * months, opening_tds: Math.round(incomeTax(st.gross * 12 - TAX_REGIMES.new.std_deduction).total * months / 12) });
  }
  const ws = store.getWorkspace(id), settings = settingsOf(ws);
  let punches = 0;
  const rnd = ((seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
  for (let d = 34; d >= 1; d--) {
    const date = istDate(now - d * 864e5);
    if (holidaysFor(store.listOps(HOL, id), [Number(date.slice(0, 4))]).some((h) => h.date === date)) continue;
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 0 || (dow === 6 && settings.weekly_off !== "sun")) continue;
    for (const e of Object.values(made)) {
      const r = rnd();
      if (r < 0.05) continue; // absent
      const inMin = 9 * 60 + 15 + Math.floor(rnd() * (r > 0.85 ? 50 : 25));
      const hours = r > 0.95 ? 5 : 8.5 + rnd() * 0.75;
      const t = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
      store.addOps(P, id, { employee_id: e.id, date, in_at: istToIso(date, t(inMin)), out_at: istToIso(date, t(Math.min(inMin + hours * 60, 23 * 60 + 59))), source: "self", by_id: null, history: [], sample: true }, false);
      punches++;
    }
  }
  const dev = made.dev;
  const nextWork = (n) => { let d = istDate(now + n * 864e5); while (new Date(d + "T00:00:00Z").getUTCDay() === 0) d = istDate(Date.parse(d + "T00:00:00Z") + 864e5); return d; };
  const lday = nextWork(5);
  store.addOps(L, id, { employee_id: dev.id, type: "cl", from: lday, to: lday, half_day: false, days: 1, reason: "Family function (sample)", status: "pending", applied_by: "Sample", sample: true }, false);
  store.save();
  return { employees: Object.keys(made).length, punches, leave_requests: 1 };
}

export function removeSamplePeople(store, wsId) {
  const id = String(wsId), db = store.db, removed = {};
  const ids = new Set(db[E].filter((e) => e.workspace_id === id && e.sample).map((e) => e.id));
  for (const c of [P, L, LL]) { const before = db[c].length; db[c] = db[c].filter((x) => !(x.workspace_id === id && (x.sample || ids.has(x.employee_id)))); removed[c] = before - db[c].length; }
  for (const e of db[E]) if (e.workspace_id === id && ids.has(e.manager_id)) e.manager_id = null;
  const before = db[E].length; db[E] = db[E].filter((e) => !(e.workspace_id === id && e.sample)); removed.employees = before - db[E].length;
  // Runs made only of sample employees go; real runs keep their history.
  const rb = db[RUNS].length; db[RUNS] = db[RUNS].filter((r) => !(r.workspace_id === id && (r.lines || []).length && r.lines.every((l) => ids.has(l.employee_id)))); removed.payroll_runs = rb - db[RUNS].length;
  return removed;
}

export function mountPeople(app, { store }) {
  const clock = () => (app.locals.peopleClock ? app.locals.peopleClock() : Date.now());
  const getWs = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const canPay = (req, lvl = "view") => levelOk(req.perms.payroll, lvl);
  const who = (req) => ({ by_id: req.user.id, by_name: req.user.name });
  const users = () => store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, email: u.email }));

  const publicEmployee = (e, pay, all) => {
    const { pan, uan, ...rest } = e;
    const out = { ...rest, pan_masked: mask(pan), uan_masked: mask(uan), has_pan: !!pan, has_uan: !!uan,
      user_name: e.user_id ? store.db.users.find((u) => u.id === e.user_id)?.name || "" : "", manager_name: e.manager_id ? all.find((x) => x.id === e.manager_id)?.name || "" : "" };
    if (!pay) { for (const k of SALARY_KEYS) delete out[k]; delete out.pan_masked; delete out.uan_masked; delete out.has_pan; delete out.has_uan; }
    else out.structure = e.annual_ctc ? structureFromCtc(e.annual_ctc, structureOpts(e, settingsOf(store.getWorkspace(e.workspace_id)))) : null;
    return out;
  };
  const structureOpts = (e, s) => ({ basic_pct: e.basic_pct ?? s.rates.basic_pct, metro: !!e.metro, rates: { ...DEFAULT_RATES, ...s.rates }, pf: e.pf_applicable !== false, esi: e.esi_applicable !== false });

  // ---- employee validation (salary fields only with Payroll edit)
  const cleanEmployee = (b, { cur = null, pay, all, wsId }) => {
    const o = {}, err = [];
    const str = (k, max = 120) => { if (b[k] !== undefined) o[k] = String(b[k] ?? "").trim().slice(0, max); };
    ["name", "code", "email", "phone", "designation", "department"].forEach((k) => str(k));
    str("exit_reason", 300);
    if (b.email !== undefined && o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) err.push("email is not valid");
    if (o.code && all.some((x) => x.code === o.code && x.id !== cur?.id)) err.push("another employee has that code");
    for (const k of ["doj", "exit_date", "attendance_from"]) if (b[k] !== undefined) { if (b[k] === "" || b[k] === null) o[k] = k === "doj" ? undefined : null; else if (!validDate(b[k])) err.push(`${k} must be YYYY-MM-DD`); else o[k] = b[k]; }
    if (b.work_state !== undefined) { if (!STATE_CODES.includes(b.work_state)) err.push("unknown work state"); else o.work_state = b.work_state; }
    if (b.gender !== undefined) o.gender = GENDERS.includes(b.gender) ? b.gender : "";
    if (b.employment_type !== undefined) o.employment_type = EMP_TYPES.some((t) => t.id === b.employment_type) ? b.employment_type : "permanent";
    if (b.track_attendance !== undefined) o.track_attendance = !!b.track_attendance;
    if (b.status !== undefined) o.status = b.status === "exited" ? "exited" : "active";
    if (b.user_id !== undefined) {
      const uid = b.user_id ? String(b.user_id) : null;
      if (uid && !store.db.users.some((u) => u.id === uid)) err.push("unknown dashboard user");
      else if (uid && all.some((x) => x.user_id === uid && x.id !== cur?.id)) err.push("that login is already linked to another employee");
      else o.user_id = uid;
    }
    if (b.manager_id !== undefined) {
      const mid = b.manager_id ? String(b.manager_id) : null;
      if (mid && (mid === cur?.id || !all.some((x) => x.id === mid))) err.push("manager must be another employee");
      else o.manager_id = mid;
    }
    if (pay) {
      if (b.annual_ctc !== undefined) { const n = Math.round(Number(b.annual_ctc)); if (b.annual_ctc === "" || b.annual_ctc === null) o.annual_ctc = null; else if (!(n >= 0 && n <= 1e9)) err.push("annual CTC must be a number in ₹"); else o.annual_ctc = n; }
      if (b.basic_pct !== undefined) { if (b.basic_pct === "" || b.basic_pct === null) o.basic_pct = null; else { const n = Number(b.basic_pct); if (!(n >= 10 && n <= 100)) err.push("basic % must be 10–100"); else o.basic_pct = n; } }
      for (const k of ["metro", "pf_applicable", "esi_applicable"]) if (b[k] !== undefined) o[k] = !!b[k];
      if (b.tax_regime !== undefined) o.tax_regime = b.tax_regime === "old" ? "old" : "new";
      if (b.tds_mode !== undefined) o.tds_mode = b.tds_mode === "manual" ? "manual" : "auto";
      if (b.opening_fy !== undefined) { const v = String(b.opening_fy || "").trim(); if (v && !/^\d{4}-\d{2}$/.test(v)) err.push("opening FY must look like 2026-27"); else o.opening_fy = v || null; }
      for (const k of ["tds_manual", "old_deductions", "pt_manual", "opening_taxable", "opening_tds"]) if (b[k] !== undefined) { if (b[k] === "" || b[k] === null) o[k] = null; else { const n = Math.round(Number(b[k])); if (!(n >= 0 && n <= 1e8)) err.push(`${k} must be a positive number`); else o[k] = n; } }
      // PAN/UAN: send the full value to change it; masked values coming back from the form are ignored.
      if (b.pan !== undefined && !String(b.pan).includes("•")) { const v = String(b.pan || "").trim().toUpperCase(); if (v && !PAN_RE.test(v)) err.push("PAN must look like ABCDE1234F"); else o.pan = v; }
      if (b.uan !== undefined && !String(b.uan).includes("•")) { const v = String(b.uan || "").replace(/\s/g, ""); if (v && !UAN_RE.test(v)) err.push("UAN must be 12 digits"); else o.uan = v; }
    }
    const merged = { ...(cur || {}), ...o };
    if (!merged.name) err.push("name is required");
    if (!merged.doj) err.push("date of joining is required");
    if (merged.exit_date && merged.doj && merged.exit_date < merged.doj) err.push("exit date is before the date of joining");
    if (o.status === "exited" && !merged.exit_date) err.push("set the exit date");
    return { o, err };
  };

  const holidaysOf = (c, ...dates) => holidaysFor(c.storedHolidays, years(...dates));
  const sessionsOf = (c, empId, date) => c.punches.filter((p) => p.employee_id === empId && p.date === date && !p.deleted);
  const statusToday = (c, e, now) => {
    const today = istDate(now);
    return { ...dayStatus({ emp: e, date: today, sessions: sessionsOf(c, e.id, today), leave: leaveOn(c.requests, e.id, today), holiday: holidaysOf(c, today).find((h) => h.date === today) || null, settings: c.settings, today, nowMs: now }), date: today };
  };
  const sessionOut = (p) => ({ id: p.id, date: p.date, in_at: p.in_at, out_at: p.out_at, in_time: istTime(p.in_at), out_time: istTime(p.out_at), source: p.source, history: p.history || [], deleted: !!p.deleted });

  // ---- meta (any signed-in person)
  app.get("/api/people/meta", (req, res) => res.json({
    states: STATES, weekly_off: WEEKLY_OFF, leave_types: LEAVE_TYPES, day_status: DAY_STATUS, adj_kinds: ADJ_KINDS, run_status: RUN_STATUS, emp_types: EMP_TYPES, genders: GENDERS,
    rates_meta: RATES_META, rate_sources: RATE_SOURCES, default_rates: DEFAULT_RATES, tax_regimes: Object.fromEntries(Object.entries(TAX_REGIMES).map(([k, v]) => [k, { ...v, slabs: v.slabs.map(([u, p]) => [u === Infinity ? null : u, p]) }])),
    pt_presets: Object.fromEntries(Object.entries(PT_PRESETS).map(([k, v]) => [k, { name: v.name, none: !!v.none, source: v.source, due: v.due || null }])),
  }));

  // ---- overview: settings, employees, today, pending leave
  app.get("/api/workspaces/:ws/people", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const c = ctx(store, w), now = clock(), pay = canPay(req);
    const today = istDate(now);
    const active = c.employees.filter((e) => employedOn(e, today));
    const todayRows = active.map((e) => ({ employee_id: e.id, name: e.name, code: e.code || "", designation: e.designation || "", sample: !!e.sample, ...statusToday(c, e, now) }));
    res.json({
      today, now_ist: istParts(now).time, settings: settingsJson(c.settings),
      employees: c.employees.map((e) => publicEmployee(e, pay, c.employees)).sort((a, b) => a.name.localeCompare(b.name)),
      today_rows: todayRows,
      pending_leave: c.requests.filter((r) => r.status === "pending").map((r) => ({ ...r, name: c.employees.find((e) => e.id === r.employee_id)?.name || "?" })),
      holidays: holidaysOf(c, today),
      users: levelOk(req.perms.team, "edit") ? users() : [],
      can: { team_edit: levelOk(req.perms.team, "edit"), payroll_view: pay, payroll_edit: canPay(req, "edit"), owner: req.user.role_id === "owner" },
      has_samples: c.employees.some((e) => e.sample),
    });
  });

  app.put("/api/workspaces/:ws/people/settings", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const cur = settingsOf(w);
    const b = { ...(req.body || {}) };
    if ((b.rates || b.reset_rates) && !canPay(req, "edit")) return res.status(403).json({ detail: "Changing PF, ESI, TDS and gratuity rates needs Payroll edit access." });
    const { out, err } = cleanSettings(b, cur);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    w.people = { ...(w.people || {}), ...out };
    store.save();
    res.json(settingsJson(settingsOf(w)));
  });

  // ---- employees
  app.post("/api/workspaces/:ws/people/employees", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const all = store.listOps(E, w.id), pay = canPay(req, "edit");
    const { o, err } = cleanEmployee({ status: "active", work_state: settingsOf(w).state, employment_type: "permanent", track_attendance: true, ...req.body }, { pay, all, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const e = store.addOps(E, w.id, { pf_applicable: true, esi_applicable: true, tax_regime: "new", tds_mode: "auto", attendance_from: istDate(clock()), manager_id: null, user_id: null, exit_date: null, ...o });
    res.status(201).json(publicEmployee(e, canPay(req), store.listOps(E, w.id)));
  });
  app.put("/api/workspaces/:ws/people/employees/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const all = store.listOps(E, w.id), cur = all.find((e) => e.id === req.params.id);
    if (!cur) return res.status(404).json({ detail: "Employee not found" });
    const { o, err } = cleanEmployee(req.body || {}, { cur, pay: canPay(req, "edit"), all, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (o.status === "active" && cur.status === "exited" && req.body.exit_date === undefined) o.exit_date = null;
    const e = store.updateOps(E, w.id, cur.id, o);
    res.json(publicEmployee(e, canPay(req), store.listOps(E, w.id)));
  });
  app.delete("/api/workspaces/:ws/people/employees/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const e = store.getOps(E, w.id, req.params.id);
    if (!e) return res.status(404).json({ detail: "Employee not found" });
    if (store.listOps(RUNS, w.id).some((r) => r.status !== "draft" && r.status !== "reversed" && (r.lines || []).some((l) => l.employee_id === e.id))) return res.status(422).json({ detail: "This person is in an approved payroll run. Mark them exited instead of deleting." });
    for (const c of [P, L, LL]) store.db[c] = store.db[c].filter((x) => !(x.workspace_id === w.id && x.employee_id === e.id));
    for (const x of store.listOps(E, w.id)) if (x.manager_id === e.id) x.manager_id = null;
    store.deleteOps(E, w.id, e.id);
    res.status(204).end();
  });

  // ---- attendance
  app.get("/api/workspaces/:ws/people/attendance", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const now = clock(), month = MONTH_RE.test(String(req.query.month || "")) ? req.query.month : istDate(now).slice(0, 7);
    const c = ctx(store, w);
    const holidays = holidaysOf(c, month + "-01");
    res.json({ ...monthAttendance({ employees: c.employees, month, punches: c.punches, requests: c.requests, holidays, settings: c.settings, today: istDate(now), nowMs: now }), holidays: holidays.filter((h) => h.date.startsWith(month)), today: istDate(now) });
  });
  app.get("/api/workspaces/:ws/people/day", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const c = ctx(store, w), e = c.employees.find((x) => x.id === String(req.query.employee_id));
    if (!e || !validDate(req.query.date)) return res.status(422).json({ detail: "employee_id and date are required" });
    const date = req.query.date, now = clock();
    const all = c.punches.filter((p) => p.employee_id === e.id && p.date === date);
    res.json({ employee_id: e.id, name: e.name, date, sessions: all.map(sessionOut),
      status: dayStatus({ emp: e, date, sessions: all, leave: leaveOn(c.requests, e.id, date), holiday: holidaysOf(c, date).find((h) => h.date === date) || null, settings: c.settings, today: istDate(now), nowMs: now }) });
  });
  // Regularize: add, change or remove a punch. A reason is required and every change keeps who/when/why.
  const checkTimes = (c, empId, date, inT, outT, skipId) => {
    if (!TIME_RE.test(inT || "")) return "in time must be HH:MM (IST)";
    if (outT && !TIME_RE.test(outT)) return "out time must be HH:MM (IST)";
    if (outT && outT <= inT) return "out time must be after in time (overnight shifts aren't supported)";
    const a = istToIso(date, inT), b = outT ? istToIso(date, outT) : null;
    const clash = sessionsOf(c, empId, date).filter((p) => p.id !== skipId).some((p) => { const pe = p.out_at || "9999"; return a < pe && (b || "9999") > p.in_at; });
    return clash ? "overlaps another punch that day" : null;
  };
  app.post("/api/workspaces/:ws/people/punches", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const b = req.body || {}, c = ctx(store, w);
    const e = c.employees.find((x) => x.id === String(b.employee_id));
    if (!e) return res.status(422).json({ detail: "Pick an employee" });
    if (!validDate(b.date)) return res.status(422).json({ detail: "date must be YYYY-MM-DD" });
    const reason = String(b.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(422).json({ detail: "Give a reason for the correction" });
    const bad = checkTimes(c, e.id, b.date, b.in_time, b.out_time || null);
    if (bad) return res.status(422).json({ detail: bad });
    const after = { in: b.in_time, out: b.out_time || null };
    const p = store.addOps(P, w.id, { employee_id: e.id, date: b.date, in_at: istToIso(b.date, b.in_time), out_at: b.out_time ? istToIso(b.date, b.out_time) : null, source: "admin", ...who(req), history: [{ at: new Date(clock()).toISOString(), ...who(req), action: "added", reason, before: null, after }] });
    res.status(201).json(sessionOut(p));
  });
  app.put("/api/workspaces/:ws/people/punches/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const b = req.body || {}, c = ctx(store, w);
    const p = store.getOps(P, w.id, req.params.id);
    if (!p || p.deleted) return res.status(404).json({ detail: "Punch not found" });
    const reason = String(b.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(422).json({ detail: "Give a reason for the correction" });
    const inT = b.in_time ?? istTime(p.in_at), outT = b.out_time === undefined ? (p.out_at ? istTime(p.out_at) : null) : (b.out_time || null);
    const bad = checkTimes(c, p.employee_id, p.date, inT, outT, p.id);
    if (bad) return res.status(422).json({ detail: bad });
    const before = { in: istTime(p.in_at), out: p.out_at ? istTime(p.out_at) : null };
    p.history = [...(p.history || []), { at: new Date(clock()).toISOString(), ...who(req), action: "changed", reason, before, after: { in: inT, out: outT } }];
    const out = store.updateOps(P, w.id, p.id, { in_at: istToIso(p.date, inT), out_at: outT ? istToIso(p.date, outT) : null });
    res.json(sessionOut(out));
  });
  app.delete("/api/workspaces/:ws/people/punches/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const p = store.getOps(P, w.id, req.params.id);
    if (!p || p.deleted) return res.status(404).json({ detail: "Punch not found" });
    const reason = String(req.body?.reason || req.query.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(422).json({ detail: "Give a reason for removing the punch" });
    p.history = [...(p.history || []), { at: new Date(clock()).toISOString(), ...who(req), action: "removed", reason, before: { in: istTime(p.in_at), out: p.out_at ? istTime(p.out_at) : null }, after: null }];
    res.json(sessionOut(store.updateOps(P, w.id, p.id, { deleted: true })));
  });

  // ---- leave
  const applyLeave = (w, emp, b, by) => {
    const c = ctx(store, w), s = c.settings;
    const type = String(b.type || "");
    const t = LEAVE_TYPES.find((x) => x.id === type);
    if (!t || !s.leave[type]?.enabled) return { err: "Pick a leave type" };
    const from = String(b.from || ""), to = String(b.to || b.from || "");
    if (!validDate(from) || !validDate(to) || to < from) return { err: "Pick valid from and to dates" };
    const half = !!b.half_day;
    if (half && from !== to) return { err: "A half day must be a single date" };
    if (!employedOn(emp, from) || !employedOn(emp, to)) return { err: "Those dates are outside this person's employment" };
    const holidays = holidaysOf(c, from, to);
    const days = leaveDays({ from, to, type, half_day: half, settings: s, holidays });
    if (!(days > 0)) return { err: "Those dates are all weekly offs or holidays" };
    if (c.requests.some((r) => r.employee_id === emp.id && ["pending", "approved"].includes(r.status) && r.from <= to && r.to >= from)) return { err: "Overlaps another leave request" };
    if (type === "ml") {
      if (emp.gender !== "female") return { err: "Maternity leave needs the employee's gender set to female" };
      const weeks = b.third_child ? s.leave.ml.weeks_third : s.leave.ml.weeks;
      if (days > weeks * 7) return { err: `Maternity leave is up to ${weeks} weeks (${weeks * 7} days)` };
    } else if (["el", "cl", "sl", "pl", "co"].includes(type)) {
      const bal = leaveBalances({ emp, settings: s, requests: c.requests, ledger: c.ledger, asOf: from > istDate(clock()) ? from : istDate(clock()) }).find((x) => x.type === type);
      if (!bal || bal.available < days) return { err: `Only ${bal ? bal.available : 0} day(s) of ${t.name} available: apply the rest as Loss of pay.` };
    }
    const r = store.addOps(L, w.id, { employee_id: emp.id, type, from, to, half_day: half, days, third_child: !!b.third_child, reason: String(b.reason || "").trim().slice(0, 300), status: "pending", applied_by: by.by_name, applied_by_id: by.by_id });
    return { r };
  };
  const decideLeave = (w, r, decision, note, by) => {
    if (r.status !== "pending") return { err: "Only a pending request can be decided" };
    if (!["approve", "reject"].includes(decision)) return { err: "decision must be approve or reject" };
    if (decision === "approve" && ["el", "cl", "sl", "pl", "co"].includes(r.type)) {
      const c = ctx(store, w), emp = c.employees.find((e) => e.id === r.employee_id);
      const bal = leaveBalances({ emp, settings: c.settings, requests: c.requests.filter((x) => x.id !== r.id), ledger: c.ledger, asOf: r.from > istDate(clock()) ? r.from : istDate(clock()) }).find((x) => x.type === r.type);
      if (!bal || bal.available < r.days) return { err: `Not enough balance any more (${bal ? bal.available : 0} day(s) available)` };
    }
    return { r: store.updateOps(L, w.id, r.id, { status: decision === "approve" ? "approved" : "rejected", decided_by: by.by_name, decided_by_id: by.by_id, decided_at: new Date(clock()).toISOString(), decision_note: String(note || "").slice(0, 300) }) };
  };
  app.get("/api/workspaces/:ws/people/leave", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const c = ctx(store, w), today = istDate(clock());
    res.json({
      requests: c.requests.map((r) => ({ ...r, name: c.employees.find((e) => e.id === r.employee_id)?.name || "?" })).sort((a, b) => b.from.localeCompare(a.from)),
      balances: c.employees.filter((e) => e.status !== "exited").map((e) => ({ employee_id: e.id, name: e.name, sample: !!e.sample, balances: leaveBalances({ emp: e, settings: c.settings, requests: c.requests, ledger: c.ledger, asOf: today }).map(({ history, ...x }) => x) })),
      holidays: holidaysOf(c, today), today,
    });
  });
  app.get("/api/workspaces/:ws/people/employees/:id/leave", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const c = ctx(store, w), e = c.employees.find((x) => x.id === req.params.id);
    if (!e) return res.status(404).json({ detail: "Employee not found" });
    res.json({ employee_id: e.id, name: e.name, balances: leaveBalances({ emp: e, settings: c.settings, requests: c.requests, ledger: c.ledger, asOf: istDate(clock()) }) });
  });
  app.post("/api/workspaces/:ws/people/leave", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const e = store.getOps(E, w.id, String(req.body?.employee_id || ""));
    if (!e) return res.status(422).json({ detail: "Pick an employee" });
    const { r, err } = applyLeave(w, e, req.body || {}, who(req));
    if (err) return res.status(422).json({ detail: err });
    res.status(201).json(r);
  });
  app.post("/api/workspaces/:ws/people/leave/:id/decide", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const r = store.getOps(L, w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Leave request not found" });
    const out = decideLeave(w, r, req.body?.decision, req.body?.note, who(req));
    out.err ? res.status(422).json({ detail: out.err }) : res.json(out.r);
  });
  app.post("/api/workspaces/:ws/people/leave/:id/cancel", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const r = store.getOps(L, w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Leave request not found" });
    if (!["pending", "approved"].includes(r.status)) return res.status(422).json({ detail: "Already closed" });
    res.json(store.updateOps(L, w.id, r.id, { status: "cancelled", decided_by: req.user.name, decided_at: new Date(clock()).toISOString() }));
  });
  // Comp-off grants, opening balances and manual adjustments (a ledger, so history stays visible).
  app.post("/api/workspaces/:ws/people/leave-ledger", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const b = req.body || {};
    const e = store.getOps(E, w.id, String(b.employee_id || ""));
    if (!e) return res.status(422).json({ detail: "Pick an employee" });
    const type = String(b.type || ""), kind = ["grant", "opening", "adjust"].includes(b.kind) ? b.kind : "adjust";
    if (!["el", "cl", "sl", "pl", "co"].includes(type)) return res.status(422).json({ detail: "Pick a leave type with a balance" });
    if (kind === "grant" && type !== "co") return res.status(422).json({ detail: "Only comp-off is granted; use an adjustment for other types" });
    const days = Math.round(Number(b.days) * 2) / 2;
    if (!(Math.abs(days) >= 0.5 && Math.abs(days) <= 400)) return res.status(422).json({ detail: "days must be at least 0.5" });
    const date = validDate(b.date) ? b.date : istDate(clock());
    const note = String(b.note || "").trim().slice(0, 300);
    if (!note) return res.status(422).json({ detail: kind === "grant" ? "Say which holiday or weekly off was worked" : "Give a reason" });
    res.status(201).json(store.addOps(LL, w.id, { employee_id: e.id, type, kind, days, date, note, ...who(req) }));
  });
  // ---- holidays (the three fixed national ones are built in)
  app.post("/api/workspaces/:ws/people/holidays", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const b = req.body || {};
    if (!validDate(b.date)) return res.status(422).json({ detail: "date must be YYYY-MM-DD" });
    const name = String(b.name || "").trim().slice(0, 100);
    if (!name) return res.status(422).json({ detail: "Name the holiday" });
    const c = ctx(store, w);
    if (holidaysOf(c, b.date).some((h) => h.date === b.date)) return res.status(422).json({ detail: "There's already a holiday on that date" });
    res.status(201).json(store.addOps(HOL, w.id, { date: b.date, name, kind: ["state", "festival", "company", "national"].includes(b.kind) ? b.kind : "company", states: Array.isArray(b.states) ? b.states.filter((s) => STATE_CODES.includes(s)) : [] }));
  });
  app.delete("/api/workspaces/:ws/people/holidays/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    store.deleteOps(HOL, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Holiday not found (the fixed national holidays can't be removed)" });
  });

  // ---- payroll
  const fyLinesBefore = (wsId, month, empId) => store.listOps(RUNS, wsId)
    .filter((r) => ["approved", "paid"].includes(r.status) && fyOf(r.month) === fyOf(month) && r.month < month)
    .flatMap((r) => (r.lines || []).filter((l) => l.employee_id === empId));
  const computeLines = (w, run) => {
    const c = ctx(store, w), now = clock();
    const holidays = holidaysOf(c, run.month + "-01");
    const att = monthAttendance({ employees: c.employees, month: run.month, punches: c.punches, requests: c.requests, holidays, settings: c.settings, today: istDate(now), nowMs: now });
    return c.employees.filter((e) => employedInMonth(e, run.month)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
      const line = payLine({ emp: e, month: run.month, settings: c.settings, att: att.rows.find((r) => r.employee_id === e.id) || null, adjustments: run.adjustments?.[e.id] || [], prior: fyLinesBefore(w.id, run.month, e.id) });
      if (line.fnf) {
        const el = leaveBalances({ emp: e, settings: c.settings, requests: c.requests, ledger: c.ledger, asOf: e.exit_date }).find((x) => x.type === "el");
        line.fnf.el_balance = el?.balance ?? 0;
        const rates = { ...DEFAULT_RATES, ...c.settings.rates };
        line.fnf.el_encashment = c.settings.leave.el?.encashable && el?.balance > 0 && line.structure ? Math.round(el.balance * line.structure.basic / rates.encash_divisor) : 0;
      }
      return line;
    });
  };
  const runOut = (w, run, pay = true) => {
    const settings = settingsOf(w);
    const lines = run.status === "draft" ? computeLines(w, run) : run.lines;
    const totals = run.status === "draft" ? runTotals(lines, settings.rates) : run.totals;
    const states = [...new Set(lines.filter((l) => l.pt).map((l) => l.state))];
    const out = { ...run, lines, totals, statutory: statutorySummary(lines, totals, run.month), due: dueDates(run.month, states), rates_meta: RATES_META,
      warnings: [...new Set(lines.flatMap((l) => l.warnings.filter((x) => x.startsWith("Tax and statutory rates"))))] };
    if (!pay) delete out.lines;
    return out;
  };
  const getRun = (w, id) => store.getOps(RUNS, w.id, id);
  const log = (run, req, action, note = "") => [...(run.history || []), { at: new Date(clock()).toISOString(), ...who(req), action, note }];

  app.get("/api/workspaces/:ws/payroll", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const runs = store.listOps(RUNS, w.id).sort((a, b) => b.month.localeCompare(a.month) || b.created_at.localeCompare(a.created_at));
    const month = MONTH_RE.test(String(req.query.month || "")) ? req.query.month : prevMonth(istDate(clock()).slice(0, 7));
    const run = runs.find((r) => r.month === month && r.status !== "reversed") || null;
    res.json({ month, run: run ? runOut(w, run) : null, due: dueDates(month), rates_meta: RATES_META,
      runs: runs.map((r) => ({ id: r.id, month: r.month, status: r.status, totals: r.status === "draft" ? null : r.totals, approved_at: r.approved_at || null, paid_at: r.paid_at || null, reversed_reason: r.reversed_reason || "", finance_expense_id: r.finance_expense_id || null })) });
  });
  // Salaries for the Payroll tab: a Finance role can see and set pay without team (attendance) access.
  app.get("/api/workspaces/:ws/payroll/employees", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const all = store.listOps(E, w.id);
    res.json(all.map((e) => publicEmployee(e, true, all)).sort((a, b) => a.name.localeCompare(b.name)));
  });
  app.put("/api/workspaces/:ws/payroll/employees/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const all = store.listOps(E, w.id), cur = all.find((e) => e.id === req.params.id);
    if (!cur) return res.status(404).json({ detail: "Employee not found" });
    const b = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => SALARY_KEYS.includes(k)));
    const { o, err } = cleanEmployee(b, { cur, pay: true, all, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.json(publicEmployee(store.updateOps(E, w.id, cur.id, o), true, store.listOps(E, w.id)));
  });
  app.post("/api/workspaces/:ws/payroll/structure", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const s = settingsOf(w), b = req.body || {};
    const n = Number(b.annual_ctc);
    if (!(n > 0)) return res.status(422).json({ detail: "annual_ctc is required" });
    res.json(structureFromCtc(n, structureOpts({ basic_pct: b.basic_pct === "" || b.basic_pct == null ? null : Number(b.basic_pct), metro: !!b.metro, pf_applicable: b.pf_applicable !== false, esi_applicable: b.esi_applicable !== false }, s)));
  });
  app.post("/api/workspaces/:ws/payroll/runs", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const month = String(req.body?.month || "");
    if (!MONTH_RE.test(month)) return res.status(422).json({ detail: "month must be YYYY-MM" });
    if (month > istDate(clock()).slice(0, 7)) return res.status(422).json({ detail: "That month hasn't started yet" });
    if (store.listOps(RUNS, w.id).some((r) => r.month === month && r.status !== "reversed")) return res.status(409).json({ detail: `There's already a ${monthName(month)} run. Open it, or reverse it first.` });
    if (!store.listOps(E, w.id).some((e) => employedInMonth(e, month))) return res.status(422).json({ detail: "No employees were employed that month. Add employees first." });
    const run = store.addOps(RUNS, w.id, { month, status: "draft", adjustments: {}, lines: [], totals: null, history: [] });
    run.history = log(run, req, "created"); store.save();
    res.status(201).json(runOut(w, run));
  });
  app.get("/api/workspaces/:ws/payroll/runs/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    run ? res.json(runOut(w, run)) : res.status(404).json({ detail: "Run not found" });
  });
  const locked = (run, res) => { if (run.status !== "draft") { res.status(409).json({ detail: `This run is ${run.status} and locked. An Owner can reverse it with a reason.` }); return true; } return false; };
  app.put("/api/workspaces/:ws/payroll/runs/:id/adjustments", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (locked(run, res)) return;
    const empId = String(req.body?.employee_id || "");
    if (!store.getOps(E, w.id, empId)) return res.status(422).json({ detail: "Pick an employee" });
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 20).map((a) => ({ id: store.newId(), kind: ADJ_KINDS.some((k) => k.id === a.kind) ? a.kind : null, label: String(a.label || "").trim().slice(0, 80), amount: Math.round(Number(a.amount)) }));
    if (items.some((a) => !a.kind || !(a.amount > 0) || a.amount > 1e8)) return res.status(422).json({ detail: "Each item needs a kind and a positive amount in ₹" });
    run.adjustments = { ...(run.adjustments || {}), [empId]: items.map((a) => ({ ...a, label: a.label || ADJ_KINDS.find((k) => k.id === a.kind).name })) };
    run.history = log(run, req, "adjusted", store.getOps(E, w.id, empId).name);
    store.save();
    res.json(runOut(w, run));
  });
  app.post("/api/workspaces/:ws/payroll/runs/:id/approve", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (locked(run, res)) return;
    const lines = computeLines(w, run);
    if (!lines.length) return res.status(422).json({ detail: "Nobody to pay in this run" });
    const totals = runTotals(lines, settingsOf(w).rates);
    Object.assign(run, { lines, totals, status: "approved", approved_by: req.user.name, approved_at: new Date(clock()).toISOString(), history: log(run, req, "approved") });
    store.save();
    res.json(runOut(w, run));
  });
  app.post("/api/workspaces/:ws/payroll/runs/:id/paid", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (run.status !== "approved") return res.status(409).json({ detail: "Approve the run before marking it paid" });
    Object.assign(run, { status: "paid", paid_at: new Date(clock()).toISOString(), paid_by: req.user.name, history: log(run, req, "paid", String(req.body?.note || "").slice(0, 200)) });
    store.save();
    res.json(runOut(w, run));
  });
  app.post("/api/workspaces/:ws/payroll/runs/:id/reverse", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (req.user.role_id !== "owner") return res.status(403).json({ detail: "Only an Owner can reverse an approved payroll run." });
    if (!["approved", "paid"].includes(run.status)) return res.status(409).json({ detail: "Only an approved or paid run can be reversed (delete a draft instead)" });
    const reason = String(req.body?.reason || "").trim().slice(0, 300);
    if (!reason) return res.status(422).json({ detail: "Give a reason for reversing" });
    let removedExpense = false;
    if (run.finance_expense_id) removedExpense = store.deleteExpense(w.id, run.finance_expense_id);
    Object.assign(run, { status: "reversed", reversed_by: req.user.name, reversed_at: new Date(clock()).toISOString(), reversed_reason: reason, finance_expense_id: null, history: log(run, req, "reversed", reason + (removedExpense ? " (Finance expense removed)" : "")) });
    store.save();
    res.json({ ...runOut(w, run), finance_expense_removed: removedExpense });
  });
  app.delete("/api/workspaces/:ws/payroll/runs/:id", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (locked(run, res)) return;
    store.deleteOps(RUNS, w.id, run.id);
    res.status(204).end();
  });
  app.post("/api/workspaces/:ws/payroll/runs/:id/post-finance", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    if (!levelOk(req.perms.finance, "edit")) return res.status(403).json({ detail: "Posting to Finance needs Finance edit access too." });
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (!["approved", "paid"].includes(run.status)) return res.status(409).json({ detail: "Approve the run first" });
    if (run.finance_expense_id && store.listExpenses(w.id).some((e) => e.id === run.finance_expense_id)) return res.status(409).json({ detail: "This run is already posted to Finance" });
    const rate = Number(req.body?.inr_sar_rate);
    if (!(rate > 0 && rate < 1)) return res.status(422).json({ detail: "Type today's INR → SAR rate (SAR per ₹1, e.g. from your bank). There is no default rate." });
    const inrCost = run.totals.employer_cost;
    const date = `${run.month}-${String(new Date(Date.UTC(Number(run.month.slice(0, 4)), Number(run.month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
    const e = store.addExpense(w.id, { date, vendor: `Payroll India ${run.month}`, amount_sar: Math.round(inrCost * rate * 100) / 100, vat_sar: 0, category: "payroll", recurring: "one-off",
      note: `Employer cost ₹${inrCost.toLocaleString("en-IN")} × ${rate} SAR/₹ (rate typed by ${req.user.name})`, source: "payroll", payroll_run_id: run.id });
    Object.assign(run, { finance_expense_id: e.id, inr_sar_rate: rate, history: log(run, req, "posted to Finance", `SAR ${e.amount_sar}`) });
    store.save();
    res.status(201).json({ expense: e, run: runOut(w, run) });
  });
  const payslipFor = (w, run, empId) => {
    const line = (run.status === "draft" ? computeLines(w, run) : run.lines).find((l) => l.employee_id === empId);
    if (!line) return null;
    const prior = fyLinesBefore(w.id, run.month, empId);
    return payslipHtml({ company: settingsOf(w).company_name || w.brief.company_name, line, month: run.month, status: run.status, ytd: ytdOf([...prior, line]) });
  };
  app.get("/api/workspaces/:ws/payroll/runs/:id/payslips/:emp", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    const html = payslipFor(w, run, req.params.emp);
    if (!html) return res.status(404).json({ detail: "This person isn't in the run" });
    res.type("html").send(html);
  });
  app.get("/api/workspaces/:ws/payroll/runs/:id/bank.csv", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (!["approved", "paid"].includes(run.status)) return res.status(409).json({ detail: "Approve the run before downloading the bank file" });
    res.setHeader("Content-Disposition", `attachment; filename="salary-${run.month}.csv"`);
    res.type("text/csv").send(bankCsv(run.lines, run.month));
  });
  app.get("/api/workspaces/:ws/payroll/runs/:id/ecr.txt", (req, res) => {
    const w = getWs(req, res); if (!w) return;
    const run = getRun(w, req.params.id);
    if (!run) return res.status(404).json({ detail: "Run not found" });
    if (!["approved", "paid"].includes(run.status)) return res.status(409).json({ detail: "Approve the run before downloading the ECR file" });
    res.setHeader("Content-Disposition", `attachment; filename="ecr-${run.month}.txt"`);
    res.type("text/plain").send(ecrText(run.lines));
  });

  // ---- self-service: only the signed-in person's own record
  const myEmp = (req, w) => (req.user.id === "owner" ? null : store.listOps(E, w.id).find((e) => e.user_id === req.user.id && e.status !== "exited") || null);
  const meWs = (req, res) => { const w = getWs(req, res); if (!w) return null; return w; };
  app.get("/api/me/people/:ws", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w);
    if (!e) return res.json({ linked: false });
    const c = ctx(store, w), now = clock(), today = istDate(now), month = today.slice(0, 7);
    const att = monthAttendance({ employees: [e], month, punches: c.punches, requests: c.requests, holidays: holidaysOf(c, today), settings: c.settings, today, nowMs: now }).rows[0] || null;
    const reports = c.employees.filter((x) => x.manager_id === e.id).map((x) => x.id);
    res.json({
      linked: true, today, now_ist: istParts(now).time,
      employee: { id: e.id, name: e.name, code: e.code || "", designation: e.designation || "", department: e.department || "", manager_name: c.employees.find((x) => x.id === e.manager_id)?.name || "", gender: e.gender || "" },
      settings: { shift_start: c.settings.shift_start, shift_end: c.settings.shift_end, grace_min: c.settings.grace_min, full_day_hours: c.settings.full_day_hours, weekly_off: c.settings.weekly_off },
      status: statusToday(c, e, now), sessions: sessionsOf(c, e.id, today).map(sessionOut),
      month: att, balances: leaveBalances({ emp: e, settings: c.settings, requests: c.requests, ledger: c.ledger, asOf: today }),
      requests: c.requests.filter((r) => r.employee_id === e.id).sort((a, b) => b.from.localeCompare(a.from)),
      leave_types: LEAVE_TYPES.filter((t) => c.settings.leave[t.id]?.enabled).map((t) => ({ id: t.id, name: t.name })),
      holidays: holidaysOf(c, today).filter((h) => h.date >= today).slice(0, 8),
      payslips: store.listOps(RUNS, w.id).filter((r) => ["approved", "paid"].includes(r.status) && (r.lines || []).some((l) => l.employee_id === e.id)).sort((a, b) => b.month.localeCompare(a.month))
        .map((r) => ({ run_id: r.id, month: r.month, status: r.status, net: r.lines.find((l) => l.employee_id === e.id).net })),
      approvals: c.requests.filter((r) => r.status === "pending" && reports.includes(r.employee_id)).map((r) => ({ ...r, name: c.employees.find((x) => x.id === r.employee_id)?.name || "?" })),
      documents: myEmploymentDocs(store, w.id, e.id), // Legal & documents: own signed employment contract / offer letter
    });
  });
  app.post("/api/me/people/:ws/punch", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w);
    if (!e) return res.status(403).json({ detail: "Your login isn't linked to an employee record. Ask an Admin to link it in Attendance & payroll → Employees." });
    const now = clock(), { date } = istParts(now), iso = new Date(now).toISOString();
    if (!employedOn(e, date)) return res.status(422).json({ detail: "You're not employed on this date in the records." });
    const mine = store.listOps(P, w.id).filter((p) => p.employee_id === e.id && !p.deleted);
    const lastAt = mine.map((p) => p.out_at || p.in_at).sort().at(-1);
    if (lastAt && now - Date.parse(lastAt) < 60e3) return res.status(429).json({ detail: "You punched less than a minute ago." });
    const open = mine.find((p) => p.date === date && !p.out_at);
    let p;
    if (open) p = store.updateOps(P, w.id, open.id, { out_at: iso });
    else p = store.addOps(P, w.id, { employee_id: e.id, date, in_at: iso, out_at: null, source: "self", by_id: req.user.id, history: [] });
    const c = ctx(store, w);
    res.status(open ? 200 : 201).json({ action: open ? "out" : "in", punch: sessionOut(p), time_ist: istParts(now).time, date, status: statusToday(c, e, now) });
  });
  app.post("/api/me/people/:ws/leave", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w);
    if (!e) return res.status(403).json({ detail: "Your login isn't linked to an employee record." });
    const { r, err } = applyLeave(w, e, req.body || {}, who(req));
    if (err) return res.status(422).json({ detail: err });
    res.status(201).json(r);
  });
  app.post("/api/me/people/:ws/leave/:id/cancel", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w), r = store.getOps(L, w.id, req.params.id);
    if (!e || !r || r.employee_id !== e.id) return res.status(404).json({ detail: "Leave request not found" });
    if (r.status !== "pending") return res.status(422).json({ detail: "Only a pending request can be cancelled here; ask an Admin for approved leave." });
    res.json(store.updateOps(L, w.id, r.id, { status: "cancelled", decided_by: req.user.name, decided_at: new Date(clock()).toISOString() }));
  });
  // A manager decides their direct reports' leave (never their own).
  app.post("/api/me/people/:ws/approvals/:id", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w), r = store.getOps(L, w.id, req.params.id);
    const reqEmp = r ? store.getOps(E, w.id, r.employee_id) : null;
    if (!e || !r || !reqEmp || reqEmp.manager_id !== e.id || reqEmp.id === e.id) return res.status(404).json({ detail: "Leave request not found" });
    const out = decideLeave(w, r, req.body?.decision, req.body?.note, who(req));
    out.err ? res.status(422).json({ detail: out.err }) : res.json(out.r);
  });
  app.get("/api/me/people/:ws/payslips/:run", (req, res) => {
    const w = meWs(req, res); if (!w) return;
    const e = myEmp(req, w), run = store.getOps(RUNS, w.id, req.params.run);
    if (!e || !run || !["approved", "paid"].includes(run.status) || !(run.lines || []).some((l) => l.employee_id === e.id)) return res.status(404).json({ detail: "Payslip not found" });
    res.type("html").send(payslipFor(w, run, e.id));
  });
}

export { stateName };
