// Attendance, leave and payroll for the team employed in India. Pure functions; the routes are in
// peopleroutes.js and every statutory rate is in india-payroll.js. Times are recorded by the server
// and shown in IST (UTC+5:30). Leave defaults are typical but vary by state Shops & Establishments Act.
import { DEFAULT_RATES, RATES_META, STATE_CODES, cleanRates, esiFor, fyIndex, fyMonths, fyOf, gratuityPayable, incomeTax, pfFor, professionalTax, structureFromCtc, structureFromGross, TAX_REGIMES } from "./india-payroll.js";

// ---- IST
const IST_MS = 330 * 60e3;
const pad = (n) => String(n).padStart(2, "0");
export function istParts(ms = Date.now()) {
  const d = new Date(Number(ms) + IST_MS);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), dow: d.getUTCDay() };
}
export const istDate = (ms) => istParts(ms).date;
export const istTime = (iso) => (iso ? istParts(Date.parse(iso)).time : "");
// "2026-06-03" + "09:41" (IST) → UTC ISO string
export function istToIso(date, hhmm) {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - IST_MS).toISOString();
}
const minutesOf = (hhmm) => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return h * 60 + m; };
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validDate = (s) => DATE_RE.test(String(s || "")) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const daysInMonth = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const monthDates = (month) => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);
const dowOf = (date) => new Date(date + "T00:00:00Z").getUTCDay();
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const prevMonth = (month) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
export const monthName = (month) => new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

// ---- Settings
export const WEEKLY_OFF = [
  { id: "sun", name: "Sunday" },
  { id: "sat_sun", name: "Saturday and Sunday" },
  { id: "sun_alt_sat", name: "Sunday + 2nd and 4th Saturday" },
];
export const LEAVE_TYPES = [
  { id: "el", name: "Earned / privileged leave", accrual: "monthly", annual: 15, per_month: 1.25, carry_cap: 45, encashable: true, paid: true, note: "Typical; varies by state Shops & Establishments Act (check your state's rules)." },
  { id: "cl", name: "Casual leave", accrual: "yearly", annual: 8, carry_cap: 0, encashable: false, paid: true, note: "Typical; no carry-forward. Check your state's rules." },
  { id: "sl", name: "Sick leave", accrual: "yearly", annual: 8, carry_cap: 0, encashable: false, paid: true, note: "Typical; some states allow accumulation. Check your state's rules." },
  { id: "ml", name: "Maternity leave", accrual: "event", weeks: 26, weeks_third: 12, paid: true, note: "Maternity Benefit Act 1961: 26 weeks; 12 weeks from the third child (two or more surviving children). Needs 80 days worked in the 12 months before. ESI-covered employees are paid by ESIC." },
  { id: "pl", name: "Paternity leave", accrual: "yearly", annual: 5, carry_cap: 0, encashable: false, paid: true, non_statutory: true, note: "Company policy, not a statutory leave for private employers." },
  { id: "co", name: "Comp-off", accrual: "grant", paid: true, note: "Granted for work on a holiday or weekly off." },
  { id: "lop", name: "Loss of pay", accrual: "none", paid: false, note: "Unpaid; reduces paid days in payroll." },
];
export const LEAVE_IDS = LEAVE_TYPES.map((t) => t.id);
const LEAVE_NUM_KEYS = ["annual", "per_month", "carry_cap", "weeks", "weeks_third"];

export const DEFAULT_SETTINGS = {
  company_name: "", state: "KA",
  shift_start: "09:30", shift_end: "18:30", grace_min: 15, full_day_hours: 8, half_day_hours: 4,
  weekly_off: "sun", late_rule_on: false, late_rule_count: 3,
  lop_from_attendance: true,
  leave: Object.fromEntries(LEAVE_TYPES.map(({ id, name, note, accrual, paid, non_statutory, ...rest }) => [id, { enabled: true, ...rest }])),
  pt_custom: {}, rates: {},
};

export function settingsOf(ws) {
  const s = ws.people || {};
  const leave = Object.fromEntries(LEAVE_IDS.map((id) => [id, { ...DEFAULT_SETTINGS.leave[id], ...(s.leave?.[id] || {}) }]));
  return { ...DEFAULT_SETTINGS, company_name: ws.brief?.company_name || "", ...s, leave, pt_custom: { ...(s.pt_custom || {}) }, rates: cleanRates(s.rates || {}) };
}

export function cleanSettings(b = {}, cur) {
  const out = {}, err = [];
  if (b.company_name !== undefined) out.company_name = String(b.company_name || "").trim().slice(0, 120);
  if (b.state !== undefined) { if (!STATE_CODES.includes(b.state)) err.push("unknown state"); else out.state = b.state; }
  for (const k of ["shift_start", "shift_end"]) if (b[k] !== undefined) { if (!TIME_RE.test(b[k])) err.push(`${k} must be HH:MM`); else out[k] = b[k]; }
  const num = (k, min, max) => { if (b[k] === undefined) return; const n = Number(b[k]); if (!(n >= min && n <= max)) err.push(`${k} must be ${min}–${max}`); else out[k] = n; };
  num("grace_min", 0, 240); num("full_day_hours", 1, 16); num("half_day_hours", 0.5, 12); num("late_rule_count", 1, 31);
  if (b.weekly_off !== undefined) { if (!WEEKLY_OFF.some((w) => w.id === b.weekly_off)) err.push("unknown weekly off"); else out.weekly_off = b.weekly_off; }
  for (const k of ["late_rule_on", "lop_from_attendance"]) if (b[k] !== undefined) out[k] = !!b[k];
  if (b.leave && typeof b.leave === "object") {
    out.leave = {};
    for (const id of LEAVE_IDS) {
      const v = b.leave[id]; if (!v) continue;
      const row = { ...cur.leave[id] };
      if (v.enabled !== undefined) row.enabled = !!v.enabled;
      if (v.encashable !== undefined) row.encashable = !!v.encashable;
      for (const k of LEAVE_NUM_KEYS) if (v[k] !== undefined && k in row) { const n = Number(v[k]); if (n >= 0 && n <= 400) row[k] = n; else err.push(`${id} ${k} must be 0–400`); }
      out.leave[id] = row;
    }
  }
  if (b.pt_custom && typeof b.pt_custom === "object") {
    out.pt_custom = { ...cur.pt_custom };
    for (const [st, v] of Object.entries(b.pt_custom)) {
      if (!STATE_CODES.includes(st)) continue;
      if (!v || !Array.isArray(v.slabs) || !v.slabs.length) { delete out.pt_custom[st]; continue; }
      const slabs = v.slabs.slice(0, 12).map((s) => ({ upto: s.upto === null || s.upto === "" || s.upto === undefined ? Infinity : Number(s.upto), amount: Math.round(Number(s.amount) || 0) }))
        .filter((s) => (s.upto === Infinity || s.upto >= 0) && s.amount >= 0 && s.amount <= 2500).sort((a, c) => a.upto - c.upto);
      if (slabs.length && slabs.at(-1).upto !== Infinity) slabs.push({ upto: Infinity, amount: slabs.at(-1).amount });
      out.pt_custom[st] = { slabs, feb: v.feb === null || v.feb === "" || v.feb === undefined ? null : Math.round(Number(v.feb) || 0) };
    }
  }
  if (b.rates && typeof b.rates === "object") out.rates = b.reset_rates ? {} : cleanRates(b.rates, cur.rates);
  if (b.reset_rates) out.rates = {};
  const merged = { ...cur, ...out };
  if (merged.half_day_hours >= merged.full_day_hours) err.push("half-day hours must be less than full-day hours");
  return { out, err };
}
// JSON can't hold Infinity: slabs keep null for "and above".
export const settingsJson = (s) => ({ ...s, pt_custom: Object.fromEntries(Object.entries(s.pt_custom || {}).map(([k, v]) => [k, { ...v, slabs: v.slabs.map((x) => ({ ...x, upto: x.upto === Infinity ? null : x.upto })) }])) });
export const ptFromStored = (pt) => Object.fromEntries(Object.entries(pt || {}).map(([k, v]) => [k, { ...v, slabs: (v.slabs || []).map((x) => ({ ...x, upto: x.upto == null ? Infinity : x.upto })) }]));

// ---- Holidays: the three fixed national holidays are always on; the company adds the rest.
export const FIXED_NATIONAL = [["01-26", "Republic Day"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"]];
export function holidaysFor(stored, years) {
  const out = [];
  for (const y of years) for (const [md, name] of FIXED_NATIONAL) out.push({ id: `nat-${y}-${md}`, date: `${y}-${md}`, name, kind: "national", fixed: true });
  for (const h of stored) if (years.includes(Number(h.date.slice(0, 4)))) out.push(h);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function isWeeklyOff(date, mode) {
  const dow = dowOf(date);
  if (dow === 0) return true;
  if (dow !== 6) return false;
  if (mode === "sat_sun") return true;
  if (mode === "sun_alt_sat") { const nth = Math.ceil(Number(date.slice(8, 10)) / 7); return nth === 2 || nth === 4; }
  return false;
}

// ---- Employees
export const GENDERS = ["", "female", "male", "other"];
export const EMP_TYPES = [{ id: "permanent", name: "Permanent" }, { id: "fixed_term", name: "Fixed-term" }];
export const mask = (v) => (v ? "•".repeat(Math.max(0, String(v).length - 4)) + String(v).slice(-4) : "");
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/, UAN_RE = /^\d{12}$/;
export const SALARY_KEYS = ["annual_ctc", "basic_pct", "metro", "pf_applicable", "esi_applicable", "tax_regime", "tds_mode", "tds_manual", "old_deductions", "pt_manual", "pan", "uan", "opening_fy", "opening_taxable", "opening_tds"];

export function employedOn(emp, date) { return (!emp.doj || emp.doj <= date) && (!emp.exit_date || emp.exit_date >= date); }
export function employedInMonth(emp, month) { const d = monthDates(month); return (!emp.doj || emp.doj <= d.at(-1)) && (!emp.exit_date || emp.exit_date >= d[0]); }

// The monthly structure an employee is paid on (full month, before proration).
export function structureOf(emp, settings) {
  const rates = { ...DEFAULT_RATES, ...settings.rates };
  if (!(Number(emp.annual_ctc) > 0)) return null;
  return structureFromCtc(emp.annual_ctc, { basic_pct: emp.basic_pct ?? rates.basic_pct, metro: !!emp.metro, rates, pf: emp.pf_applicable !== false, esi: emp.esi_applicable !== false });
}

// ---- Attendance: the status of one employee on one day.
export const DAY_STATUS = {
  present: { name: "Present", short: "P" }, late: { name: "Late", short: "L" }, half_day: { name: "Half day", short: "H" },
  absent: { name: "Absent", short: "A" }, weekly_off: { name: "Weekly off", short: "W" }, holiday: { name: "Holiday", short: "HO" },
  leave: { name: "On leave", short: "LV" }, half_leave: { name: "Half day + half leave", short: "HL" }, missing_out: { name: "No punch-out", short: "?" },
  in: { name: "In now", short: "IN" }, out: { name: "Punched out", short: "O" }, not_in: { name: "Not in yet", short: "–" }, upcoming: { name: "Upcoming", short: "" },
  untracked: { name: "Not tracked", short: "·" }, na: { name: "Not employed", short: "" },
};

export function sessionHours(s) { return s.out_at ? Math.max(0, (Date.parse(s.out_at) - Date.parse(s.in_at)) / 36e5) : 0; }

export function dayStatus({ emp, date, sessions = [], leave = null, holiday = null, settings, today, nowMs = Date.now() }) {
  if (!employedOn(emp, date)) return { status: "na", lop: 0 };
  const live = sessions.filter((s) => !s.deleted).sort((a, b) => a.in_at.localeCompare(b.in_at));
  const closed = live.filter((s) => s.out_at), open = live.find((s) => !s.out_at);
  let hours = closed.reduce((a, s) => a + sessionHours(s), 0);
  const firstIn = live[0] ? istTime(live[0].in_at) : "";
  const late = !!firstIn && minutesOf(firstIn) > minutesOf(settings.shift_start) + Number(settings.grace_min || 0);
  const base = { hours: Math.round(hours * 100) / 100, first_in: firstIn, last_out: closed.length ? istTime(closed.at(-1).out_at) : "", sessions: live.length };
  const off = holiday ? "holiday" : isWeeklyOff(date, settings.weekly_off) ? "weekly_off" : null;
  if (off) return { ...base, status: off, holiday: holiday?.name || null, worked_off: live.length > 0, lop: 0 };
  const lt = leave ? settings.leave?.[leave.type] : null;
  const leavePaid = leave ? leave.type !== "lop" : false;
  if (leave && !leave.half_day) return { ...base, status: "leave", leave_type: leave.type, lop: leavePaid ? 0 : 1 };
  if (date > today) return { ...base, status: "upcoming", lop: 0 };
  if (emp.track_attendance === false || (emp.attendance_from && date < emp.attendance_from)) return { ...base, status: "untracked", lop: 0 };
  const halfLeave = leave?.half_day ? (leavePaid ? 0.5 : 0) : 0;
  if (open && date === today) { const sofar = hours + (nowMs - Date.parse(open.in_at)) / 36e5; return { ...base, status: "in", late, hours_so_far: Math.round(sofar * 100) / 100, lop: 0, open_id: open.id }; }
  if (open) return { ...base, status: "missing_out", late, lop: 0, open_id: open.id };
  if (!live.length && date === today) return { ...base, status: "not_in", lop: 0, leave_type: leave?.type || null };
  const worked = hours >= settings.full_day_hours ? 1 : hours >= settings.half_day_hours ? 0.5 : 0;
  // Today isn't over: someone who punched out early (a break, an errand) isn't judged until the day ends.
  if (date === today && worked < 1) return { ...base, status: "out", late, lop: 0, leave_type: leave?.type || null };
  const credit = Math.min(1, worked + halfLeave);
  const lop = Math.round((1 - credit) * 10) / 10;
  if (leave?.half_day) return { ...base, status: worked >= 0.5 ? "half_leave" : "half_day", late: late && worked > 0, leave_type: leave.type, lop: leave.type === "lop" ? Math.max(lop, 0.5) : lop };
  if (worked === 1) return { ...base, status: late ? "late" : "present", late, lop: 0 };
  if (worked === 0.5) return { ...base, status: "half_day", late, lop: 0.5 };
  return { ...base, status: "absent", late: false, lop: 1 };
}

// Approved leave on a date for one employee (the request record, plus whether it's a half day).
export function leaveOn(requests, empId, date) {
  return requests.find((r) => r.employee_id === empId && r.status === "approved" && r.from <= date && r.to >= date) || null;
}

// Month grid + totals for a list of employees.
export function monthAttendance({ employees, month, punches, requests, holidays, settings, today, nowMs = Date.now() }) {
  const dates = monthDates(month);
  const hol = new Map(holidays.map((h) => [h.date, h]));
  const byEmpDay = new Map();
  for (const p of punches) { if (p.deleted) continue; const k = `${p.employee_id}|${p.date}`; (byEmpDay.get(k) || byEmpDay.set(k, []).get(k)).push(p); }
  const rows = employees.filter((e) => employedInMonth(e, month)).map((e) => {
    const days = dates.map((date) => ({ date, ...dayStatus({ emp: e, date, sessions: byEmpDay.get(`${e.id}|${date}`) || [], leave: leaveOn(requests, e.id, date), holiday: hol.get(date) || null, settings, today, nowMs }) }));
    const n = (st) => days.filter((d) => st.includes(d.status)).length;
    const lates = days.filter((d) => d.late && ["late", "half_day", "half_leave", "in", "out", "missing_out"].includes(d.status)).length;
    const latePenalty = settings.late_rule_on && settings.late_rule_count > 0 ? Math.floor(lates / settings.late_rule_count) * 0.5 : 0;
    const leaveDays = days.reduce((a, d) => a + (d.status === "leave" ? 1 : d.leave_type && ["half_leave", "half_day"].includes(d.status) ? 0.5 : 0), 0);
    const lop = days.reduce((a, d) => a + (d.lop || 0), 0) + latePenalty;
    return {
      employee_id: e.id, name: e.name, code: e.code || "", sample: !!e.sample, days,
      totals: { present: n(["present", "late", "missing_out", "in", "out"]), half_days: n(["half_day", "half_leave"]), absent: n(["absent"]), late: lates, late_penalty: latePenalty,
        leave: leaveDays, holidays: n(["holiday"]), weekly_off: n(["weekly_off"]), missing_out: n(["missing_out"]), worked_off: days.filter((d) => d.worked_off).length,
        lop: Math.round(lop * 10) / 10 },
    };
  });
  return { month, dates, rows };
}

// ---- Leave
// Working days in a request (calendar days for maternity), 0.5 for a half day.
export function leaveDays({ from, to, type, half_day, settings, holidays }) {
  if (half_day) return 0.5;
  const hol = new Set(holidays.map((h) => h.date));
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (type === "ml" || (!hol.has(d) && !isWeeklyOff(d, settings.weekly_off))) n++;
  return n;
}

const round2 = (n) => Math.round(n * 100) / 100;
const halfRound = (n) => Math.round(n * 2) / 2;
const monthEnd = (y, m) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

// Balance of every leave type for one employee on a date, with the history behind it (calendar leave year).
export function leaveBalances({ emp, settings, requests, ledger = [], asOf }) {
  const year = Number(asOf.slice(0, 4));
  const mine = requests.filter((r) => r.employee_id === emp.id);
  const used = (type, y) => mine.filter((r) => r.type === type && r.status === "approved" && Number(r.from.slice(0, 4)) === y).reduce((a, r) => a + r.days, 0);
  const pending = (type) => mine.filter((r) => r.type === type && r.status === "pending").reduce((a, r) => a + r.days, 0);
  const adj = (type, y) => ledger.filter((l) => l.employee_id === emp.id && l.type === type && (y == null || Number(l.date.slice(0, 4)) === y));
  const startYear = Math.min(year, Number((emp.doj || asOf).slice(0, 4)));
  const employedMid = (y, m) => { const mid = `${y}-${pad(m)}-15`; return (!emp.doj || emp.doj <= mid) && (!emp.exit_date || emp.exit_date >= mid); };
  const out = [];
  for (const t of LEAVE_TYPES) {
    const pol = settings.leave[t.id];
    if (!pol?.enabled) continue;
    if ((t.id === "ml" && emp.gender === "male") || (t.id === "pl" && emp.gender === "female")) continue;
    const row = { type: t.id, name: t.name, paid: t.paid, accrual: t.accrual, note: t.note, non_statutory: !!t.non_statutory, accrued: 0, carried: 0, adjusted: 0, used: used(t.id, year), pending: pending(t.id), balance: null, history: [] };
    if (t.accrual === "monthly" || t.accrual === "yearly") {
      let carry = 0;
      for (let y = startYear; y <= year; y++) {
        let credit = 0; const hist = [];
        if (t.accrual === "monthly") {
          for (let m = 1; m <= 12; m++) { const end = monthEnd(y, m); if (end > asOf) break; if (employedMid(y, m)) { credit += pol.per_month; hist.push({ date: end, kind: "accrual", days: pol.per_month, note: `Accrued for ${monthName(`${y}-${pad(m)}`)}` }); } }
        } else {
          const startDate = emp.doj && emp.doj > `${y}-01-01` ? emp.doj : `${y}-01-01`;
          if (startDate <= asOf && (!emp.doj || emp.doj <= `${y}-12-31`)) {
            const months = 12 - Number(startDate.slice(5, 7)) + 1;
            credit = halfRound(pol.annual * months / 12);
            hist.push({ date: startDate, kind: "credit", days: credit, note: months < 12 ? `Credited for ${months} months of ${y} (joined mid-year)` : `Credited for ${y}` });
          }
        }
        const a = adj(t.id, y).reduce((s, l) => s + l.days, 0);
        const u = used(t.id, y);
        if (y === year) {
          row.carried = carry; row.accrued = round2(credit); row.adjusted = round2(a); row.used = u;
          row.balance = round2(carry + credit + a - u);
          if (carry) row.history.push({ date: `${y}-01-01`, kind: "carry", days: carry, note: `Carried forward from ${y - 1} (cap ${pol.carry_cap})` });
          row.history.push(...hist);
        }
        carry = round2(Math.min(Number(pol.carry_cap) || 0, Math.max(0, carry + credit + a - u)));
      }
    } else if (t.accrual === "grant") {
      const grants = adj(t.id, null);
      row.adjusted = round2(grants.reduce((s, l) => s + l.days, 0));
      row.used = mine.filter((r) => r.type === t.id && r.status === "approved").reduce((a, r) => a + r.days, 0);
      row.balance = round2(row.adjusted - row.used);
    } else if (t.accrual === "event") {
      row.entitlement_weeks = pol.weeks; row.entitlement_weeks_third = pol.weeks_third;
    }
    for (const l of t.accrual === "grant" ? adj(t.id, null) : adj(t.id, year)) row.history.push({ date: l.date, kind: l.kind, days: l.days, note: l.note || (l.kind === "grant" ? "Comp-off granted" : "Adjustment"), by: l.by_name || "" });
    for (const r of mine.filter((x) => x.type === t.id && x.status === "approved" && (t.accrual === "grant" || Number(x.from.slice(0, 4)) === year))) row.history.push({ date: r.from, kind: "used", days: -r.days, note: `Leave ${r.from}${r.to !== r.from ? " → " + r.to : ""}${r.half_day ? " (half day)" : ""}` });
    row.history.sort((a, b) => a.date.localeCompare(b.date));
    row.available = row.balance == null ? null : round2(row.balance - row.pending);
    out.push(row);
  }
  return out;
}

// ---- Payroll
export const ADJ_KINDS = [
  { id: "bonus", name: "Bonus", earning: true, esi: false, taxable: true },
  { id: "arrears", name: "Arrears", earning: true, esi: true, taxable: true },
  { id: "reimbursement", name: "Reimbursement", earning: true, esi: false, taxable: false },
  { id: "other_earning", name: "Other earning", earning: true, esi: true, taxable: true },
  { id: "advance", name: "Advance recovery", earning: false },
  { id: "other_deduction", name: "Other deduction", earning: false },
];
export const RUN_STATUS = ["draft", "approved", "paid", "reversed"];

// One employee's pay for a month. att = this month's attendance totals row (or null when not tracked).
// prior = this FY's approved/paid lines for the employee before this month.
export function payLine({ emp, month, settings, att = null, adjustments = [], prior = [] }) {
  const rates = { ...DEFAULT_RATES, ...settings.rates };
  const warnings = [];
  const D = daysInMonth(month), dates = monthDates(month);
  const employedDays = dates.filter((d) => employedOn(emp, d)).length;
  const lop = settings.lop_from_attendance && att ? Math.min(employedDays, att.totals.lop) : 0;
  const paidDays = Math.max(0, employedDays - lop);
  const st = structureOf(emp, settings);
  if (!st) warnings.push("No annual CTC set: add the salary on the employee.");
  const full = st || { gross: 0, basic: 0, hra: 0, special: 0 };
  const f = paidDays / D;
  const earn = { basic: Math.round(full.basic * f), hra: Math.round(full.hra * f), special: Math.round(full.special * f) };
  const adds = adjustments.filter((a) => ADJ_KINDS.find((k) => k.id === a.kind)?.earning);
  const deds = adjustments.filter((a) => ADJ_KINDS.find((k) => k.id === a.kind && !k.earning));
  const sumKind = (pred) => adds.filter((a) => pred(ADJ_KINDS.find((k) => k.id === a.kind))).reduce((s, a) => s + a.amount, 0);
  const fixedEarned = earn.basic + earn.hra + earn.special;
  const gross = fixedEarned + adds.reduce((s, a) => s + a.amount, 0);
  const reimb = sumKind((k) => !k.taxable);
  // EPF on earned basic (basic + DA)
  const pf = emp.pf_applicable !== false && st ? pfFor(earn.basic, rates) : { pf_wages: 0, eps_wages: 0, edli_wages: 0, employee: 0, eps: 0, employer_epf: 0, employer: 0, edli: 0, admin: 0 };
  // ESI: covered on the full-month gross; contribution on wages earned (no bonus or reimbursements)
  const esiWages = fixedEarned + sumKind((k) => k.esi);
  const esi = emp.esi_applicable !== false && st ? esiFor(full.gross, esiWages, rates) : { eligible: false, wages: 0, employee: 0, employer: 0 };
  // Professional Tax on the month's gross (no reimbursements), by work state
  const ptGross = gross - reimb;
  const state = emp.work_state || settings.state;
  const ptR = st ? professionalTax({ state, gross: ptGross, month, gender: emp.gender, custom: ptFromStored(settings.pt_custom)[state] || null, manual: emp.pt_manual }) : { amount: 0, basis: "no salary" };
  if (ptR.warn) warnings.push(ptR.warn);
  // TDS estimate: annualise this FY and spread what's left over the remaining months
  const regime = emp.tax_regime === "old" ? "old" : "new";
  const taxableNow = gross - reimb;
  // Salary and TDS already paid this FY outside this dashboard (earlier months, previous employer) come from "opening YTD".
  const opening = emp.opening_fy === fyOf(month) ? { taxable: Number(emp.opening_taxable) || 0, tds: Number(emp.opening_tds) || 0, pt: 0 } : null;
  const before = [...prior, ...(opening ? [opening] : [])].reduce((a, l) => ({ taxable: a.taxable + (l.taxable || 0), tds: a.tds + (l.tds || 0), pt: a.pt + (l.pt || 0) }), { taxable: 0, tds: 0, pt: 0 });
  const missingMonths = fyMonths(month).slice(0, fyIndex(month)).filter((m) => employedInMonth(emp, m)).length - prior.length;
  let monthsAfter = 11 - fyIndex(month);
  if (emp.exit_date) { const fyEnd = fyMonths(month).at(-1); const exitM = emp.exit_date.slice(0, 7); if (exitM <= fyEnd) monthsAfter = Math.max(0, fyMonths(month).indexOf(exitM) - fyIndex(month)); }
  const r = TAX_REGIMES[regime];
  let tds = 0, tdsDetail = null;
  if (emp.tds_mode === "manual") { tds = Math.max(0, Math.round(Number(emp.tds_manual) || 0)); tdsDetail = { mode: "manual" }; }
  else if (st) {
    const projected = before.taxable + taxableNow + full.gross * monthsAfter;
    const ptYear = before.pt + ptR.amount + ptR.amount * monthsAfter;
    const deductions = r.std_deduction + (regime === "old" ? (Number(emp.old_deductions) || 0) + ptYear : 0);
    const tax = incomeTax(projected - deductions, regime);
    tds = Math.max(0, Math.round((tax.total - before.tds) / (monthsAfter + 1)));
    tdsDetail = { mode: "estimate", regime, projected_salary: Math.round(projected), deductions: Math.round(deductions), annual_taxable: tax.taxable, annual_tax: tax.total, rebate: tax.rebate, tds_before: before.tds, months_left: monthsAfter + 1 };
    if (missingMonths > 0 && !opening) warnings.push(`${missingMonths} earlier month${missingMonths === 1 ? "" : "s"} of FY ${fyOf(month)} ha${missingMonths === 1 ? "s" : "ve"} no payroll run here: enter the salary and TDS already paid this FY under Salary → Opening YTD, or the TDS estimate is too low.`);
    if (tax.surcharge_missing) warnings.push("Taxable income over ₹50 lakh: surcharge is not included in this TDS estimate. Ask the CA.");
  }
  if (tds > 0 && !emp.pan) warnings.push("No PAN on file: TDS may have to be at least 20% (s.206AA). Add the PAN.");
  if (fyOf(month) !== RATES_META.fy) warnings.push(`Tax and statutory rates are for FY ${RATES_META.fy}; this month is in FY ${fyOf(month)}. Confirm the rates with your CA.`);
  if (att?.totals.missing_out) warnings.push(`${att.totals.missing_out} day${att.totals.missing_out === 1 ? "" : "s"} without a punch-out (paid as present): regularize in Attendance.`);
  if (att?.days?.some((d) => d.leave_type === "ml") && esi.eligible) warnings.push("On maternity leave while ESI-covered: ESIC pays the maternity benefit. Check with the CA before paying salary for those days.");
  const otherDed = deds.reduce((s, a) => s + a.amount, 0);
  const totalDed = pf.employee + esi.employee + ptR.amount + tds + otherDed;
  const gratuity = st ? Math.round(earn.basic * rates.gratuity_pct / 100) : 0;
  // Exit: full-and-final estimates (added to the run only if a person adds them)
  let fnf = null;
  if (emp.exit_date && emp.exit_date.slice(0, 7) === month && st) {
    const g = gratuityPayable(full.basic, emp.doj, emp.exit_date, rates, emp.employment_type === "fixed_term");
    fnf = { gratuity: g, el_balance: null, el_encashment: null };
  }
  return {
    employee_id: emp.id, name: emp.name, code: emp.code || "", designation: emp.designation || "", department: emp.department || "", state, sample: !!emp.sample,
    pan_masked: mask(emp.pan), uan: emp.uan || "", uan_masked: mask(emp.uan), doj: emp.doj, exit_date: emp.exit_date || null,
    days_in_month: D, employed_days: employedDays, lop_days: lop, paid_days: paidDays,
    structure: st ? { gross: full.gross, basic: full.basic, hra: full.hra, special: full.special } : null,
    earnings: earn, additions: adds.map(({ id, kind, label, amount }) => ({ id, kind, label, amount })), deductions_other: deds.map(({ id, kind, label, amount }) => ({ id, kind, label, amount })),
    gross, taxable: taxableNow,
    pf, esi, pt: ptR.amount, pt_basis: ptR.basis, tds, tds_detail: tdsDetail, total_deductions: totalDed, net: gross - totalDed,
    employer: { pf: pf.employer, eps: pf.eps, epf: pf.employer_epf, edli: pf.edli, admin: pf.admin, esi: esi.employer, gratuity, cost: gross + pf.employer + pf.edli + pf.admin + esi.employer + gratuity },
    fnf, warnings,
  };
}

export function runTotals(lines, rates = DEFAULT_RATES) {
  const r = { ...DEFAULT_RATES, ...rates };
  const s = (f) => lines.reduce((a, l) => a + (f(l) || 0), 0);
  const pfMembers = lines.filter((l) => l.pf.employee > 0);
  const admin = r.admin_on && pfMembers.length ? Math.max(r.admin_min, s((l) => l.employer.admin)) : 0;
  const t = {
    headcount: lines.length, gross: s((l) => l.gross), net: s((l) => l.net), deductions: s((l) => l.total_deductions),
    pf_employee: s((l) => l.pf.employee), eps: s((l) => l.pf.eps), employer_epf: s((l) => l.pf.employer_epf), edli: s((l) => l.pf.edli), pf_admin: admin,
    esi_employee: s((l) => l.esi.employee), esi_employer: s((l) => l.esi.employer), pt: s((l) => l.pt), tds: s((l) => l.tds),
    gratuity: s((l) => l.employer.gratuity), other_deductions: s((l) => l.deductions_other.reduce((a, d) => a + d.amount, 0)),
  };
  t.employer_cost = s((l) => l.employer.cost) - s((l) => l.employer.admin) + admin;
  return t;
}

export function statutorySummary(lines, totals, month) {
  const byState = {};
  for (const l of lines) if (l.pt) (byState[l.state] ||= { state: l.state, amount: 0, employees: 0 }), byState[l.state].amount += l.pt, byState[l.state].employees++;
  return {
    pf: { members: lines.filter((l) => l.pf.employee > 0).length, pf_wages: lines.reduce((a, l) => a + l.pf.pf_wages, 0), employee: totals.pf_employee, eps: totals.eps, employer_epf: totals.employer_epf, edli: totals.edli, admin: totals.pf_admin,
      total: totals.pf_employee + totals.eps + totals.employer_epf + totals.edli + totals.pf_admin },
    esi: { members: lines.filter((l) => l.esi.eligible).length, wages: lines.reduce((a, l) => a + l.esi.wages, 0), employee: totals.esi_employee, employer: totals.esi_employer, total: totals.esi_employee + totals.esi_employer },
    pt: Object.values(byState), pt_total: totals.pt,
    tds: { total: totals.tds, employees: lines.filter((l) => l.tds > 0).length },
    month,
  };
}

// EPFO ECR 2.0 text: one line per member, fields joined by #~# (check the portal's current format before upload).
export function ecrText(lines) {
  return lines.filter((l) => l.pf.employee > 0).map((l) => [l.uan || "[ADD UAN]", l.name.replace(/#~#/g, " "), l.gross, l.pf.pf_wages, l.pf.eps_wages, l.pf.edli_wages, l.pf.employee, l.pf.eps, l.pf.employer_epf, Math.round(l.lop_days), 0].join("#~#")).join("\n") + "\n";
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
export function bankCsv(lines, month) {
  const rows = [["Employee code", "Name", "Bank account", "IFSC", "Net pay (INR)", "Narration"]];
  for (const l of lines) rows.push([l.code, l.name, "[ADD ACCOUNT NO]", "[ADD IFSC]", l.net, `Salary ${month}`]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ---- Payslip (printable HTML)
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
export function payslipHtml({ company, line, month, status, ytd }) {
  const earnRows = [["Basic", line.earnings.basic], ["HRA", line.earnings.hra], ["Special allowance", line.earnings.special], ...line.additions.map((a) => [a.label || a.kind, a.amount])];
  const dedRows = [["Provident Fund (employee)", line.pf.employee], ["ESI (employee)", line.esi.employee], ["Professional Tax", line.pt], ["Income tax (TDS, estimate)", line.tds], ...line.deductions_other.map((a) => [a.label || a.kind, a.amount])].filter(([, v]) => v);
  const rows = Math.max(earnRows.length, dedRows.length);
  const body = Array.from({ length: rows }, (_, i) => `<tr><td>${h(earnRows[i]?.[0] || "")}</td><td class="n">${earnRows[i] ? inr(earnRows[i][1]) : ""}</td><td>${h(dedRows[i]?.[0] || "")}</td><td class="n">${dedRows[i] ? inr(dedRows[i][1]) : ""}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Payslip ${h(line.name)} ${h(month)}</title>
<style>body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#171716;background:#fff;margin:0;padding:24px}main{max-width:780px;margin:0 auto}h1{font-size:20px;margin:0}h2{font-size:15px;margin:20px 0 8px}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #171716;padding-bottom:12px}.muted{color:#5c5c57}.draft{color:#c0362c;font-weight:700}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #cfcfc8;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f2ef;font-weight:600}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:4px 16px;margin-top:12px}.net{font-size:18px;font-weight:700;margin-top:12px}.foot{font-size:12px;color:#5c5c57;margin-top:20px}
@media print{body{padding:0}button{display:none}}@media (max-width:560px){td,th{padding:5px 6px;font-size:13px}}</style></head><body><main>
<div class="top"><div><h1>${h(company)}</h1><div class="muted">Payslip for ${h(monthName(month))}</div></div><div>${status === "draft" ? `<span class="draft">DRAFT: not approved</span>` : `<span class="muted">${h(status === "paid" ? "Paid" : "Approved")}</span>`}<br><button onclick="print()">Print / save as PDF</button></div></div>
<div class="facts"><div><span class="muted">Employee</span><br><b>${h(line.name)}</b>${line.code ? ` (${h(line.code)})` : ""}</div><div><span class="muted">Designation</span><br>${h(line.designation || "—")}</div><div><span class="muted">Department</span><br>${h(line.department || "—")}</div>
<div><span class="muted">Date of joining</span><br>${h(line.doj || "—")}</div><div><span class="muted">PAN</span><br>${h(line.pan_masked || "—")}</div><div><span class="muted">UAN</span><br>${h(line.uan_masked || "—")}</div>
<div><span class="muted">Days in month</span><br>${line.days_in_month}</div><div><span class="muted">Paid days</span><br>${line.paid_days}</div><div><span class="muted">Loss-of-pay days</span><br>${line.lop_days}</div></div>
<h2>Earnings and deductions</h2><table><thead><tr><th>Earnings</th><th class="n">Amount</th><th>Deductions</th><th class="n">Amount</th></tr></thead><tbody>${body}
<tr><th>Gross earnings</th><th class="n">${inr(line.gross)}</th><th>Total deductions</th><th class="n">${inr(line.total_deductions)}</th></tr></tbody></table>
<div class="net">Net pay: ${inr(line.net)}</div>
<h2>Year to date (FY ${h(fyOf(month))}, runs in this dashboard)</h2><table><tbody><tr><td>Gross earnings</td><td class="n">${inr(ytd.gross)}</td><td>Provident Fund</td><td class="n">${inr(ytd.pf)}</td></tr><tr><td>Income tax (TDS)</td><td class="n">${inr(ytd.tds)}</td><td>Professional Tax</td><td class="n">${inr(ytd.pt)}</td></tr><tr><td>Net pay</td><td class="n">${inr(ytd.net)}</td><td>ESI</td><td class="n">${inr(ytd.esi)}</td></tr></tbody></table>
<p class="foot">Employer contributions (not deducted from pay): PF ${inr(line.employer.pf)}, ESI ${inr(line.employer.esi)}, gratuity provision ${inr(line.employer.gratuity)}. TDS is an estimate under the ${line.tds_detail?.regime === "old" ? "old" : "new"} tax regime; the employer's CA files Form 24Q and issues Form 16. This is a computer-generated payslip.</p>
</main></body></html>`;
}

// YTD for the payslip: this FY's approved/paid lines for the employee up to and including this month.
export function ytdOf(lines) {
  return lines.reduce((a, l) => ({ gross: a.gross + l.gross, net: a.net + l.net, tds: a.tds + l.tds, pf: a.pf + l.pf.employee, pt: a.pt + l.pt, esi: a.esi + l.esi.employee }), { gross: 0, net: 0, tds: 0, pf: 0, pt: 0, esi: 0 });
}

// ---- Sample team (names start with "Sample ·", flagged sample: true; removed with the rest of the sample data)
export function sampleEmployees(now = Date.now()) {
  const doj = (daysAgo) => istDate(now - daysAgo * 864e5);
  return [
    { key: "lead", name: "Sample · Priya Sharma", code: "S-001", email: "", designation: "Engineering lead", department: "Product & Engineering", doj: doj(2200), work_state: "KA", gender: "female", annual_ctc: 2400000, metro: false, pan: "", uan: "" },
    { key: "dev", name: "Sample · Arjun Rao", code: "S-002", designation: "Full-stack engineer", department: "Product & Engineering", doj: doj(500), work_state: "KA", gender: "male", annual_ctc: 1200000, manager: "lead" },
    { key: "design", name: "Sample · Meera Iyer", code: "S-003", designation: "Motion designer", department: "Product & Engineering", doj: doj(300), work_state: "MH", gender: "female", annual_ctc: 780000, manager: "lead" },
    { key: "support", name: "Sample · Rahul Verma", code: "S-004", designation: "Support associate", department: "Customer Success", doj: doj(200), work_state: "KA", gender: "male", annual_ctc: 240000, manager: "lead" },
  ];
}
