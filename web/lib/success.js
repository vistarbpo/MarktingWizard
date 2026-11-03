// Customer Success: daily health snapshots per customer, rule-based churn alerts that become owned tasks,
// expansion and upgrade signals, renewals, the onboarding view, NPS / CSAT surveys and per-alert playbooks.
// It reads Billing (customers, usage, invoices, the health score) and the Store CRM (onboarding checklist,
// senders with every outreach safety rule); it never duplicates them.
// AI does every step it can (snapshots, alerts, survey sending, drafts); people own the alerts, talk to the
// customer and approve every AI draft. Every threshold is in DEFAULT_SETTINGS and editable in Success → Settings.
// What each rule does and where to change it: docs/customer-success.md.
import crypto from "node:crypto";
import { PLANS, SAR_PER_USD, planFor } from "./sales.js";
import { DEFAULT_PRICING } from "./pricing.js";
import { PAYING, addDays, addMonths, amountDue, daysBetween, monthlyUsd, mrrSar, overage, planDef, r2 } from "./billing.js";
import { ONBOARDING_STEPS, inWindow, normDomain, riyadhDay } from "./crm.js";

export const COLLECTIONS = ["success_health", "success_alerts", "success_renewals", "success_surveys", "success_responses", "success_drafts", "success_log"];

export const BANDS = [
  { id: "healthy", name: "Healthy", min: 75 },
  { id: "watch", name: "Watch", min: 50 },
  { id: "at_risk", name: "At risk", min: 0 },
];
export const bandOf = (score) => (score >= 75 ? "healthy" : score >= 50 ? "watch" : "at_risk"); // same cut-offs as Billing's healthScore()

export const ALERT_TYPES = [
  { id: "health_drop", name: "Health dropped", hint: "The health score fell by the set points within the set days" },
  { id: "usage_drop", name: "Usage down", hint: "Renders in the last full month are down by the set % vs the month before" },
  { id: "past_due", name: "Payment past due", hint: "Billing marked the store past due (or paused it for non-payment)" },
  { id: "inactive", name: "No activity", hint: "No usage, payment, support ticket or reply for the set days" },
  { id: "tickets", name: "Many open tickets", hint: "More open support tickets than the set number" },
  { id: "negative_ticket", name: "Unhappy ticket", hint: "An open ticket asks for a refund, to cancel, or is a complaint" },
  { id: "cancel_scheduled", name: "Cancellation scheduled", hint: "The subscription cancels at the end of its period" },
  { id: "detractor", name: "Detractor answer", hint: "NPS 0–6 or CSAT 1–2 on a survey" },
  { id: "meeting_action", name: "Meeting action item", hint: "An action item from a meeting with this customer (Meetings → review and create)" },
];
export const ALERT_IDS = ALERT_TYPES.map((a) => a.id);
export const ALERT_STATUS = ["open", "snoozed", "done"];
export const OUTCOMES = [
  { id: "saved", name: "Saved: the store stays" },
  { id: "fixed", name: "Problem fixed" },
  { id: "no_action", name: "No action needed" },
  { id: "churned", name: "Churned anyway" },
  { id: "other", name: "Other" },
];
export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);
export const RENEWAL_STATUS = [
  { id: "not_started", name: "Not started" },
  { id: "in_talks", name: "In talks" },
  { id: "renewed", name: "Renewed" },
  { id: "lost", name: "Lost" },
];
export const RENEWAL_IDS = RENEWAL_STATUS.map((r) => r.id);
export const SURVEY_KINDS = [
  { id: "nps", name: "NPS (0–10)", min: 0, max: 10, negative: 6 },
  { id: "csat", name: "CSAT (1–5)", min: 1, max: 5, negative: 2 },
];
export const SURVEY_CHANNELS = ["email", "whatsapp", "link"];

// Every threshold in one place (Success → Settings changes them per workspace).
export const DEFAULT_SETTINGS = {
  mode: "test",              // test: surveys are logged, never sent. live: sent through the Store CRM's senders
  health_drop_points: 15,    // alert when the score falls this much…
  health_drop_days: 14,      // …within this many days
  usage_drop_pct: 40,        // alert when last full month's renders are down this much vs the month before
  inactive_days: 14,         // alert after this many days without activity
  open_tickets_max: 2,       // alert when open tickets are more than this
  render_pct: 80,            // expansion signal at this % of the plan's render limit
  stuck_days: 7,             // onboarding step is stuck after this many days without progress
  reopen_days: 14,           // a closed alert of the same kind doesn't come back for this many days
  wa_template: "",           // approved WhatsApp template for surveys (needs the link as a body parameter)
};
const LIMITS = { health_drop_points: [1, 100], health_drop_days: [1, 90], usage_drop_pct: [5, 100], inactive_days: [3, 120], open_tickets_max: [0, 50], render_pct: [10, 100], stuck_days: [1, 60], reopen_days: [0, 120] };

export const DEFAULT_PLAYBOOKS = {
  health_drop: ["Open the health factors and see which part fell", "Check usage, tickets and invoices for what changed", "Call or WhatsApp the owner within 2 working days", "Agree one next step and write it as a note"],
  usage_drop: ["Check if the catalog sync or the ad account connection broke", "Ask the owner what changed (season, budget, team)", "Offer a 20-minute session to set up new templates", "Check usage again in 7 days"],
  past_due: ["Check the invoice and the reminders already sent in Billing", "Call the owner: is it a card problem or a decision?", "Offer the bank transfer or a payment link", "Hand money questions (discounts, refunds) to Finance"],
  inactive: ["Look at the last activity and the onboarding checklist", "Send a short check-in with one useful tip for their category", "Offer a call to restart", "If no answer in 7 days, call"],
  tickets: ["Read the open tickets and close the ones already solved", "Make sure each open ticket has a person and a date", "Tell the owner what happens next on each"],
  negative_ticket: ["Read the ticket and reply personally the same day", "Fix or escalate (refunds and price changes go to Finance)", "Follow up after the fix and ask if it's resolved"],
  cancel_scheduled: ["Ask why they are cancelling (call if possible)", "Check if a lower plan or a pause fits better", "Write the reason as the outcome, even if they leave"],
  meeting_action: ["Read the meeting summary and the action item", "Do the item or hand it to the right person by its due date", "Tell the customer it's done and write the outcome"],
  detractor: ["Thank them and reply to the comment within 1 working day", "Find the cause (product, support, price, results)", "Agree a fix and follow up", "Ask again in the next survey"],
};

// ---- dates
const ym = (d) => String(d).slice(0, 7);
export const prevMonth = (m) => addMonths(m + "-01", -1).slice(0, 7);
const n = (v) => Number(v || 0).toLocaleString("en-US");

// ---- settings and playbooks
export function successSettings(w) { return { ...DEFAULT_SETTINGS, ...(w?.success?.settings || {}) }; }
export function cleanSettings(b = {}) {
  const f = {}, err = [];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) if (b[k] !== undefined) { const v = Math.round(Number(b[k])); if (!(v >= lo && v <= hi)) err.push(`${k} must be ${lo}–${hi}`); else f[k] = v; }
  if (b.mode !== undefined) { if (!["test", "live"].includes(b.mode)) err.push("mode must be test or live"); else f.mode = b.mode; }
  if (b.wa_template !== undefined) { f.wa_template = String(b.wa_template || "").trim().slice(0, 80); if (f.wa_template && !/^[a-z0-9_]+$/.test(f.wa_template)) err.push("WhatsApp template names use a–z, 0–9 and _ only"); }
  return { f, err };
}
export function playbooksOf(w) {
  const saved = w?.success?.playbooks || {};
  return Object.fromEntries(ALERT_IDS.map((t) => [t, Array.isArray(saved[t]) && saved[t].length ? saved[t] : DEFAULT_PLAYBOOKS[t]]));
}
export const cleanSteps = (steps) => (Array.isArray(steps) ? steps : String(steps || "").split("\n")).map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 12);

// ---- health snapshot parts (the five factors of Billing's healthScore)
export const partsOf = (h) => Object.fromEntries(h.factors.map((f) => [f.id, f.points]));
const PART_NAMES = { payment: "payment", usage: "usage", tickets: "tickets", onboarding: "onboarding", activity: "activity" };

// ================================================================= churn rules (pure; each hit carries its reason)
export const NEGATIVE = /(refund|charge ?back|cancel|unsubscribe|angry|complain|terrible|awful|useless|scam|disappoint|not happy|unhappy|[اأ]سترجا?ع|[اأ]سترد|[اإ]رجاع المبلغ|فلوسي|إلغاء|الغاء|[اأ]لغي|سيء|سيئ|زعلان|شكوى|اشتكي|نصب|خايس|ما يستاهل|محبط)/i;
const OPEN_TICKET = (t) => !["resolved", "solved", "closed"].includes(t.status);

// snaps: this customer's snapshots before today (any order); current: { score, parts }.
export function healthDropRule(snaps, current, today, s = DEFAULT_SETTINGS) {
  const from = addDays(today, -s.health_drop_days);
  const win = snaps.filter((x) => x.date >= from && x.date < today);
  if (!win.length) return null;
  const peak = win.reduce((a, x) => (x.score > a.score ? x : a), win[0]);
  const drop = peak.score - current.score;
  if (drop < s.health_drop_points) return null;
  const parts = Object.keys(PART_NAMES).map((k) => [k, (current.parts?.[k] ?? 0) - (peak.parts?.[k] ?? 0)]).filter(([, d]) => d < 0).map(([k, d]) => `${PART_NAMES[k]} ${d}`);
  return { type: "health_drop", key: "health_drop", reason: `Health fell ${drop} points, from ${peak.score} on ${peak.date} to ${current.score} today${parts.length ? ` (${parts.join(", ")})` : ""}` };
}
// Last full month vs the month before (complete months only, so a half month never looks like a drop).
export function usageDropRule(usage, today, s = DEFAULT_SETTINGS) {
  const m1 = prevMonth(ym(today)), m2 = prevMonth(m1);
  const r = (m) => usage.find((u) => u.month === m)?.renders || 0;
  const a = r(m2), b = r(m1);
  if (!(a > 0)) return null;
  const pct = Math.round(((a - b) / a) * 100);
  if (pct < s.usage_drop_pct) return null;
  return { type: "usage_drop", key: "usage_drop", reason: `Renders fell ${pct}%: ${n(a)} in ${m2}, ${n(b)} in ${m1}`, data: { m1, m2, before: a, after: b, pct } };
}
export function pastDueRule(c, invoices, today) {
  if (!(c.status === "past_due" || (c.status === "paused" && c.paused_reason === "dunning"))) return null;
  const open = invoices.filter((i) => i.kind === "invoice" && i.status === "issued" && amountDue(i) > 0.005);
  const worst = open.map((i) => ({ i, d: daysBetween(i.dunning_from && i.dunning_from < i.due_date ? i.dunning_from : i.due_date, today) })).sort((x, y) => y.d - x.d)[0];
  const why = worst ? `Invoice ${worst.i.number || "(draft)"} is ${worst.d} day${worst.d === 1 ? "" : "s"} overdue` : "Billing marked the store past due";
  return { type: "past_due", key: "past_due", reason: c.status === "paused" ? `${why}; the account is paused for non-payment` : why };
}
export function inactiveRule(c, lastActivity, today, s = DEFAULT_SETTINGS) {
  if (["cancelled", "paused"].includes(c.status)) return null;
  const days = lastActivity ? daysBetween(lastActivity, today) : daysBetween(c.start_date, today);
  if (days < s.inactive_days) return null;
  return { type: "inactive", key: "inactive", reason: lastActivity ? `No usage, payment, support or reply for ${days} days (last activity ${lastActivity})` : `No activity recorded in the ${days} days since the start (${c.start_date})` };
}
export function ticketsRule(tickets, s = DEFAULT_SETTINGS) {
  const open = tickets.filter(OPEN_TICKET);
  if (open.length <= s.open_tickets_max) return null;
  return { type: "tickets", key: "tickets", reason: `${open.length} open support tickets (more than ${s.open_tickets_max})` };
}
export function negativeTicketRules(tickets) {
  const out = [];
  for (const t of tickets.filter(OPEN_TICKET)) {
    const texts = [...(t.messages || []).filter((m) => m.from === "customer").map((m) => m.text), t.escalation_reason || ""];
    let hit = null;
    for (const x of texts) { const m = NEGATIVE.exec(String(x || "")); if (m) { hit = { word: m[0], text: String(x) }; break; } }
    if (!hit) continue;
    const i = hit.text.toLowerCase().indexOf(hit.word.toLowerCase()), start = Math.max(0, i - 50);
    out.push({ type: "negative_ticket", key: `negative_ticket|${t.id}`, ticket_id: t.id, reason: `${t.channel || "Support"} ticket mentions "${hit.word}": ${(start ? "…" : "") + hit.text.slice(start, start + 140).trim()}` });
  }
  return out;
}
export function cancelRule(c) {
  if (!c.cancel_at_period_end || c.status === "cancelled") return null;
  const end = c.status === "trial" ? c.trial_end : c.period_end;
  return { type: "cancel_scheduled", key: `cancel_scheduled|${end}`, reason: `${c.status === "trial" ? "The trial ends" : "The subscription cancels"} on ${end} (cancel at period end is set)` };
}
export function evaluateRules({ c, snaps = [], current, usage = [], invoices = [], tickets = [], lastActivity = null, today, s = DEFAULT_SETTINGS }) {
  if (c.status === "cancelled") return [];
  return [healthDropRule(snaps, current, today, s), usageDropRule(usage, today, s), pastDueRule(c, invoices, today), inactiveRule(c, lastActivity, today, s),
    ticketsRule(tickets, s), ...negativeTicketRules(tickets), cancelRule(c)].filter(Boolean);
}

// ================================================================= expansion / upgrade signals (pure)
// Render limits come from Finance → Pricing (pricing.plans[].render_limit); prices from PLANS in sales.js.
export function expansionSignals({ c, usage = [], skus = null, pricing = DEFAULT_PRICING, today, s = DEFAULT_SETTINGS }) {
  const idx = PLANS.findIndex((p) => p.name === c.plan), cur = PLANS[idx], next = idx >= 0 ? PLANS[idx + 1] || null : null;
  if (!cur || ["cancelled", "paused"].includes(c.status)) return { signals: [], suggested: null };
  const r = (m) => usage.find((u) => u.month === m)?.renders || 0;
  const month = ym(today), last = prevMonth(month), before = prevMonth(last);
  const pp = (pricing.plans || []).find((p) => p.name === c.plan) || {}, limit = Number(pp.render_limit) || 0;
  const signals = [];
  if (limit > 0) {
    const [m, v] = r(month) >= r(last) ? [month, r(month)] : [last, r(last)];
    const ratio = (v / limit) * 100, pct = Math.floor(ratio);
    if (ratio >= s.render_pct) signals.push({ id: "render_usage", name: "Render usage near the limit", reason: `${n(v)} renders in ${m}${m === month ? " so far" : ""}: ${pct}% of the ${n(limit)} included in ${c.plan}`, suggest: next?.name || null });
  }
  if (Number(skus) > 0 && Number.isFinite(cur.max) && Number(skus) > cur.max) {
    const fit = planFor(skus);
    signals.push({ id: "sku_band", name: "Catalog bigger than the plan", reason: `${n(skus)} products: over the ${c.plan} band (up to ${n(cur.max)})`, suggest: fit?.name || null });
  }
  const o1 = overage(c.plan, r(last), pricing), o2 = overage(c.plan, r(before), pricing);
  if (o1.extra > 0 && o2.extra > 0) signals.push({ id: "overage_2m", name: "Overage two months running", reason: `Over the render limit in ${before} and ${last}: ${n(o2.extra)} and ${n(o1.extra)} extra renders`, suggest: next?.name || null, overage_usd: r2(o1.amount_usd + o2.amount_usd) });
  if (!signals.length) return { signals, suggested: null };
  // The biggest plan any signal points to; Enterprise customers have nothing above, so the talk is a bigger custom allowance.
  const rank = (name) => PLANS.findIndex((p) => p.name === name);
  const best = signals.map((x) => x.suggest).filter(Boolean).sort((a, b) => rank(b) - rank(a))[0] || null;
  const sug = best ? planDef(best) : null;
  const curUsd = monthlyUsd(c);
  return { signals, suggested: sug ? { plan: sug.name, from: sug.name === "Enterprise", current_usd: curUsd, suggested_usd: sug.usd, diff_usd: r2(sug.usd - curUsd), diff_sar: r2((sug.usd - curUsd) * SAR_PER_USD) }
    : { plan: null, note: `Already on ${c.plan}: talk about a larger custom allowance ([ADD] price agreed with Finance)` } };
}

// ================================================================= renewals (pure)
// Yearly plans (renewal = end of the period) and trials (trial end). Monthly plans renew every month and are left out.
export function renewalRows(customers, today, records = [], horizon = 90) {
  const rows = [];
  for (const c of customers) {
    let date = null, kind = null;
    if (c.status === "trial" && c.trial_end) { date = c.trial_end; kind = "trial"; }
    else if (c.cycle === "yearly" && (PAYING.includes(c.status) || (c.status === "cancelled" && c.cancelled_at))) { date = c.status === "cancelled" ? c.cancelled_at : c.period_end; kind = "yearly"; }
    if (!date) continue;
    const days = daysBetween(today, date);
    if (days > horizon || days < -30) continue;
    const rec = records.find((x) => x.customer_id === c.id && x.date === date) || null;
    let status = rec?.status || "not_started", auto = false;
    if (!rec && c.cancel_at_period_end) { status = "lost"; auto = true; }
    if (!rec && days < 0) { status = c.status === "cancelled" ? "lost" : "renewed"; auto = true; }
    rows.push({ customer_id: c.id, store_name: c.store_name, plan: c.plan, cycle: c.cycle, kind, date, days, status, auto, lost_reason: rec?.lost_reason || (auto && status === "lost" ? (c.cancel_at_period_end ? "Cancel at period end is set" : "Cancelled") : ""),
      owner_id: rec?.owner_id ?? c.success_owner_id ?? null, note: rec?.note || "", record_id: rec?.id || null, mrr_sar: mrrSar(c), sample: !!c.sample });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// ================================================================= onboarding (pure)
export function onboardingRow(c, contact, today, s = DEFAULT_SETTINGS) {
  if (!contact) return { customer_id: c.id, store_name: c.store_name, linked: false, days: daysBetween(c.start_date, today) };
  const done = contact.onboarding || {}, at = contact.onboarding_at || {};
  const steps = ONBOARDING_STEPS.map((st) => ({ id: st.id, name: st.name, done: !!done[st.id], at: at[st.id] ? (/T/.test(String(at[st.id])) && !Number.isNaN(Date.parse(at[st.id])) ? riyadhDay(new Date(at[st.id])) : String(at[st.id]).slice(0, 10)) : null }));  // Riyadh day, not the UTC date
  const count = steps.filter((x) => x.done).length;
  // Last progress: the latest step ticked (the CRM records when), else the customer's start date.
  const last = [c.start_date, ...steps.map((x) => x.at).filter(Boolean)].sort().at(-1);
  const quiet = daysBetween(last, today), complete = count === steps.length;
  const stuck = !complete && quiet >= s.stuck_days ? steps.filter((x) => !x.done).slice(0, 1).map((x) => x.name) : [];
  return { customer_id: c.id, store_name: c.store_name, contact_id: contact.id, linked: true, stage: contact.stage, days: daysBetween(c.start_date, today), done: count, total: steps.length,
    pct: Math.round((count / steps.length) * 100), last_progress: last, quiet_days: quiet, complete, stuck, steps };
}

// ================================================================= surveys (pure)
export const kindOf = (id) => SURVEY_KINDS.find((k) => k.id === id) || SURVEY_KINDS[0];
export const isNegative = (kind, score) => score <= kindOf(kind).negative;
export function npsOf(scores) {
  const xs = scores.filter((x) => Number.isFinite(x));
  if (!xs.length) return { n: 0, nps: null, promoters: 0, passives: 0, detractors: 0 };
  const p = xs.filter((x) => x >= 9).length, d = xs.filter((x) => x <= 6).length;
  return { n: xs.length, nps: Math.round(((p - d) / xs.length) * 100), promoters: p, passives: xs.length - p - d, detractors: d };
}
export function csatOf(scores) {
  const xs = scores.filter((x) => Number.isFinite(x));
  if (!xs.length) return { n: 0, avg: null, satisfied_pct: null };
  return { n: xs.length, avg: Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10, satisfied_pct: Math.round((xs.filter((x) => x >= 4).length / xs.length) * 100) };
}
export const DEFAULT_QUESTIONS = {
  nps: { ar: "من 0 إلى 10، كم تنصح صاحب متجر ثاني يستخدم DPA AD؟", en: "From 0 to 10, how likely are you to recommend DPA AD to another store owner?" },
  csat: { ar: "من 1 إلى 5، كم أنت راضي عن DPA AD هالفترة؟", en: "From 1 to 5, how satisfied are you with DPA AD lately?" },
};
export function surveyMessage(sv, { name, link, company }) {
  const ar = `مرحباً ${name}،\n${sv.question_ar}\nرأيك يهمنا ويساعدنا نتحسّن، وما ياخذ إلا دقيقة: ${link}`;
  const en = `Hi ${name},\n${sv.question_en}\nIt takes a minute and helps us improve: ${link}`;
  return { subject: `رأيك يهمنا · How are we doing? (${company})`, body: `${ar}\n\n${en}\n\n${company}` };
}
export const newToken = () => crypto.randomBytes(18).toString("base64url");

// ================================================================= AI prompts (drafts only; a person approves)
const factsOf = (h) => h.factors.map((f) => `- ${f.name}: ${f.points}/${f.max} (${f.why})`).join("\n");
export function savePlanPrompt(w, c, { health, alerts, tickets, usage, onboarding }) {
  return `<company>${w.brief.company_name}</company>
<customer>store: ${c.store_name}; plan: ${c.plan} (${c.cycle}); status: ${c.status}; platform: ${c.platform || "unknown"}; customer since ${c.start_date}</customer>
<health score="${health.score}" band="${health.label}">\n${factsOf(health)}\n</health>
<open_alerts>\n${alerts.map((a) => `- ${a.type}: ${a.reason}`).join("\n") || "none"}\n</open_alerts>
<usage>\n${usage.slice(-4).map((u) => `- ${u.month}: ${u.renders} renders`).join("\n") || "none reported"}\n</usage>
<support>\n${tickets.slice(0, 5).map((t) => `- ${t.status} ${t.channel}: ${String(t.last || "").slice(0, 160)}`).join("\n") || "no tickets"}\n</support>
<onboarding>${onboarding ? `${onboarding.done} of ${onboarding.total} steps done${onboarding.stuck.length ? `; stuck on: ${onboarding.stuck.join(", ")}` : ""}` : "not linked to a CRM store"}</onboarding>
You are DPA AD's Retention watcher. In English, for the customer success owner:
1. "## Why at risk": 2–4 bullets, each tied to one fact above. Use only the facts given; if something is unknown write [ADD].
2. "## Save plan": 3–5 numbered steps with who does what and by when (relative days). Practical: a call, a fix, a training session. Never promise discounts, refunds or prices; money questions go to Finance.
3. "## Message to the owner": a short WhatsApp in Saudi Arabic the owner can send to open the conversation, then the same in English. No invented numbers, results or quotes.
A person reviews this; nothing is sent automatically.`;
}
export function writerPrompt(w, c, kind, { exp, renewal, showMoney }) {
  const sug = exp?.suggested;
  const price = showMoney && sug?.plan ? `current plan list price $${sug.current_usd}/month; ${sug.plan} list price $${sug.suggested_usd}/month${sug.from ? " (from)" : ""}; difference $${sug.diff_usd}/month (SAR ${sug.diff_sar}), before VAT` : "prices: not given, write [ADD price]";
  const facts = kind === "expansion"
    ? `<signals>\n${(exp?.signals || []).map((x) => `- ${x.name}: ${x.reason}`).join("\n") || "none"}\n</signals>\n<suggested_plan>${sug?.plan || "none (talk about a larger allowance)"}; ${price}</suggested_plan>`
    : `<renewal>${renewal ? `${renewal.kind === "trial" ? "trial ends" : "yearly plan renews"} on ${renewal.date} (${renewal.days} days)` : "no renewal date"}; plan ${c.plan} (${c.cycle}); ${price}</renewal>`;
  return `<company>${w.brief.company_name}</company>
<customer>store: ${c.store_name}; owner: ${c.owner_name || "unknown"}; plan: ${c.plan} (${c.cycle}); status: ${c.status}</customer>
${facts}
You are DPA AD's Expansion & renewal writer. Write ${kind === "expansion" ? "an upgrade suggestion" : "a renewal"} email to the store owner. First a line starting "Subject:", then the email in Saudi Arabic (warm, short, one clear ask: a 15-minute call or a reply), then the same in English under "### English".
Rules: use only the facts and numbers given above. Never invent results, ROAS, customer names, quotes, discounts or deadlines; where a number or proof would help, write [ADD]. A person reviews, edits and sends it.`;
}
export function parseDraft(text, fallbackSubject) {
  const m = /^\s*\**Subject:\**\s*(.+)$/im.exec(text);
  return { subject: m ? m[1].trim().slice(0, 200) : fallbackSubject, text: (m ? text.replace(m[0], "") : text).trim() };
}

// ================================================================= engine (stateful)
export function ensureCollections(store) { for (const k of COLLECTIONS) if (!Array.isArray(store.db[k])) store.db[k] = []; }

export function createSuccess({ store, billing, crm = null, outreach = null, log = console, now: clock = () => new Date(), publicUrl = "" }) {
  ensureCollections(store);
  const H = "success_health", A = "success_alerts", R = "success_renewals", SV = "success_surveys", RS = "success_responses", D = "success_drafts", L = "success_log";
  const svc = { clock };
  const today = () => riyadhDay(svc.clock());
  const settings = (w) => successSettings(w);
  const setSettings = (w, f) => { w.success = { ...(w.success || {}), settings: { ...(w.success?.settings || {}), ...f } }; store.save(); return settings(w); };
  const setPlaybook = (w, type, steps) => { w.success = { ...(w.success || {}), playbooks: { ...(w.success?.playbooks || {}), [type]: steps } }; store.save(); return playbooksOf(w); };
  const addLog = (w, entry) => { const e = store.addOps(L, w.id, { at: new Date().toISOString(), ...entry }, false); const all = store.db[L]; if (all.length > 20000) all.splice(0, all.length - 20000); return e; };
  const customers = (w) => billing.customers(w.id);

  // The CRM store behind a customer: the linked one, else the store with the same domain.
  function contactFor(w, c) {
    if (!crm) return null;
    if (c.crm_contact_id) { const x = crm.get(w.id, c.crm_contact_id); if (x) return x; }
    const dom = normDomain(c.domain);
    return dom ? crm.find(w.id, { domain: dom }) : null;
  }
  const invoicesOf = (w, c) => store.db.billing_invoices.filter((i) => i.workspace_id === w.id && i.customer_id === c.id);
  // Last real activity: renders reported, a payment, a support ticket, a reply in the CRM, or the product's last_seen_at.
  function lastActivity(w, c, tickets = billing.ticketsFor(w.id, c), contact = contactFor(w, c)) {
    const pays = store.db.billing_payments.filter((p) => p.workspace_id === w.id && p.customer_id === c.id && p.status === "paid").map((p) => p.date);
    const use = billing.usageOf(w.id, c.id).filter((u) => u.renders > 0).map((u) => u.updated_at || u.created_at);
    return [...pays, ...use, ...tickets.map((t) => t.updated_at), contact?.last_reply_at, c.last_seen_at].filter(Boolean).map((d) => String(d).slice(0, 10)).sort().at(-1) || null;
  }
  const snapsOf = (w, cid) => store.db[H].filter((x) => x.workspace_id === w.id && x.customer_id === cid).sort((a, b) => a.date.localeCompare(b.date));

  // ---- daily health snapshot: one row per customer per day (re-running the same day updates it)
  function snapshot(w, c, day = today()) {
    const h = billing.health(w, c, day);
    let row = store.db[H].find((x) => x.workspace_id === w.id && x.customer_id === c.id && x.date === day);
    if (!row) row = store.addOps(H, w.id, { customer_id: c.id, date: day }, false);
    Object.assign(row, { score: h.score, label: h.label, parts: partsOf(h), ...(c.sample ? { sample: true } : {}) });
    return { row, health: h };
  }

  // ---- alerts: a rule hit becomes one task per customer and key; open ones are refreshed, never doubled
  function raise(w, c, hit, day = today(), extra = {}) {
    const s = settings(w);
    const same = store.db[A].filter((a) => a.workspace_id === w.id && a.customer_id === c.id && a.key === hit.key);
    const live = same.find((a) => a.status !== "done");
    if (live) { if (live.reason !== hit.reason) { live.reason = hit.reason; live.updated_at = new Date().toISOString(); } return { alert: live, created: false }; }
    const specific = hit.key.includes("|"); // one alert per ticket, survey answer or cancellation date, ever
    const lastDone = same.filter((a) => a.status === "done").sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))[0];
    if (lastDone && (specific || daysBetween(String(lastDone.done_at).slice(0, 10), day) < s.reopen_days)) return { alert: null, created: false };
    const steps = playbooksOf(w)[hit.type].map((text) => ({ text, done: false }));
    const a = store.addOps(A, w.id, { customer_id: c.id, store_name: c.store_name, type: hit.type, key: hit.key, reason: hit.reason, status: "open", owner_id: c.success_owner_id || null,
      snooze_until: null, outcome: null, outcome_note: "", steps, first_seen: day, history: [{ at: new Date().toISOString(), by: "rules", text: "Alert raised" }], ...(c.sample ? { sample: true } : {}), ...extra }, false);
    addLog(w, { kind: "alert", customer_id: c.id, alert_id: a.id, text: `${c.store_name}: ${hit.reason}` });
    return { alert: a, created: true };
  }
  function evaluateCustomer(w, c, day = today()) {
    if (c.status === "cancelled") return [];
    const s = settings(w), tickets = billing.ticketsFor(w.id, c), contact = contactFor(w, c);
    const before = snapsOf(w, c.id).filter((x) => x.date < day);
    const { row } = snapshot(w, c, day);
    const hits = evaluateRules({ c, snaps: before, current: row, usage: billing.usageOf(w.id, c.id), invoices: invoicesOf(w, c), tickets, lastActivity: lastActivity(w, c, tickets, contact), today: day, s });
    return hits.map((h) => raise(w, c, h, day));
  }
  function runWorkspace(w, now = svc.clock()) {
    const day = riyadhDay(now), out = { snapshots: 0, alerts: 0, reopened: 0 };
    // Snoozed alerts come back on their date.
    for (const a of store.db[A].filter((x) => x.workspace_id === w.id && x.status === "snoozed" && x.snooze_until && x.snooze_until <= day)) {
      a.status = "open"; a.snooze_until = null; a.history = [...(a.history || []), { at: new Date().toISOString(), by: "rules", text: "Snooze ended" }]; out.reopened++;
    }
    for (const c of customers(w)) {
      if (c.status === "cancelled") continue;
      out.snapshots++;
      out.alerts += evaluateCustomer(w, c, day).filter((r) => r.created).length;
    }
    // Keep about 13 months of snapshots per workspace.
    const cut = addDays(day, -400);
    store.db[H] = store.db[H].filter((x) => x.workspace_id !== w.id || x.date >= cut);
    store.save();
    return out;
  }

  // ---- surveys
  function createSurvey(w, f, by = "you") {
    const kind = kindOf(f.kind).id, q = DEFAULT_QUESTIONS[kind];
    return store.addOps(SV, w.id, { name: String(f.name || "").trim().slice(0, 120) || `${kind.toUpperCase()} ${today().slice(0, 7)}`, kind, channel: SURVEY_CHANNELS.includes(f.channel) ? f.channel : "email",
      question_ar: String(f.question_ar || q.ar).trim().slice(0, 300), question_en: String(f.question_en || q.en).trim().slice(0, 300), status: "draft", created_by: by, sent_at: null, ...(f.sample ? { sample: true } : {}) });
  }
  const link = (r) => `${(publicUrl || outreach?.cfg?.public_url || "").replace(/\/$/, "")}/s/${r.token}`;
  // One response row (with its own token) per customer per survey. Sending again only retries the ones not sent.
  async function sendSurvey(w, sv, customerIds = null, by = "you") {
    const list = customers(w).filter((c) => !["cancelled"].includes(c.status) && (!customerIds || customerIds.includes(c.id)));
    const out = { created: 0, results: {} };
    for (const c of list) {
      let r = store.db[RS].find((x) => x.workspace_id === w.id && x.survey_id === sv.id && x.customer_id === c.id);
      if (!r) { r = store.addOps(RS, w.id, { survey_id: sv.id, customer_id: c.id, store_name: c.store_name, token: newToken(), kind: sv.kind, score: null, comment: "", answered_at: null, send_status: "new", send_note: "", ...(c.sample || sv.sample ? { sample: true } : {}) }, false); out.created++; }
      if (["sent", "test", "link"].includes(r.send_status) || r.answered_at) continue;
      await deliver(w, sv, r, c);
      out.results[r.send_status] = (out.results[r.send_status] || 0) + 1;
    }
    if (!sv.sent_at) sv.sent_at = new Date().toISOString();
    sv.status = "sent"; sv.sent_by = by;
    addLog(w, { kind: "survey", survey_id: sv.id, text: `${sv.name}: ${Object.entries(out.results).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing new to send"}` });
    store.save();
    return out;
  }
  // The safety rules for every message Success sends: opt-outs, do-not-contact, WhatsApp opt-in and an approved
  // template, Saudi hours (09:00–21:00 Riyadh, not Friday), sample stores never sent, Test mode by default. Live sends
  // go through the Store CRM's sendOne, which adds the unsubscribe link and header and checks every rule again.
  async function safeSend(w, c, { channel = "email", subject = "", body = "", extra = {}, wa_params = null }, now = svc.clock()) {
    const s = settings(w), res = (status, note, message_id = null) => ({ status, note, message_id });
    const ct = contactFor(w, c);
    if (!ct) return res("link", "Not linked to a Store CRM store: send it yourself");
    if (ct.stage === "do_not_contact") return res("skipped", "Store is on do-not-contact");
    if (channel === "email") {
      if (!ct.email) return res("skipped", "No email on the CRM store");
      if (ct.email_opt_out) return res("skipped", "Unsubscribed from email");
      if (ct.bounced) return res("skipped", "Email bounced before");
    } else {
      if (!ct.phone) return res("skipped", "No WhatsApp number");
      if (ct.wa_opt_out) return res("skipped", "Asked to stop WhatsApp");
      if (!ct.wa_opt_in) return res("skipped", "No WhatsApp opt-in");
      if (!s.wa_template) return res("skipped", "Set an approved WhatsApp survey template in Success → Settings");
    }
    if (c.sample || ct.sample) return res("test", "Sample store: never sent for real");
    if (s.mode !== "live") return res("test", "Test mode: not sent");
    if (!inWindow(now, { from: 9, to: 21, skip_friday: true })) return res("queued", "Waits for 09:00–21:00 Riyadh time (not Friday)");
    if (!outreach) return res("skipped", "No sender connected");
    const m = await outreach.sendOne(w.id, { ...ct, ...extra }, { channel, subject, body, wa_template: channel === "whatsapp" ? s.wa_template : "", wa_params, by: "success" });
    return res(m.status, m.error || "", m.id);
  }
  async function deliver(w, sv, r, c = billing.getCustomer(w.id, r.customer_id), now = svc.clock()) {
    const set = (st, note) => { r.send_status = st; r.send_note = note; r.send_at = new Date().toISOString(); };
    if (!c) return set("skipped", "Customer removed");
    if (sv.channel === "link") return set("link", "Share the link yourself");
    const url = link(r), ct = contactFor(w, c);
    const msg = surveyMessage(sv, { name: ct?.owner_name || c.owner_name || c.store_name, link: url, company: w.brief?.company_name || "DPA AD" });
    const out = await safeSend(w, c, { channel: sv.channel, subject: msg.subject, body: msg.body, extra: { survey_link: url }, wa_params: ["owner_name", "survey_link"] }, now);
    set(out.status, out.note);
    r.message_id = out.message_id;
  }
  async function sendQueued(w, now = svc.clock()) {
    if (!inWindow(now, { from: 9, to: 21, skip_friday: true })) return 0;
    let k = 0;
    for (const r of store.db[RS].filter((x) => x.workspace_id === w.id && x.send_status === "queued" && !x.answered_at)) {
      const sv = store.getOps(SV, w.id, r.survey_id);
      if (!sv) continue;
      await deliver(w, sv, r, undefined, now); k++;
    }
    if (k) store.save();
    return k;
  }
  // A public answer. Returns { error, status } on refusal.
  function respond(token, { score, comment }) {
    const r = store.db[RS].find((x) => x.token === String(token || ""));
    if (!r) return { status: 404, error: "This survey link isn't valid." };
    if (r.answered_at) return { status: 409, error: "Thanks, we already have your answer.", response: r };
    const k = kindOf(r.kind), v = Number(score);
    if (!(Number.isInteger(v) && v >= k.min && v <= k.max)) return { status: 422, error: `Pick a number from ${k.min} to ${k.max}.` };
    const w = store.getWorkspace(r.workspace_id), c = w && store.getOps("billing_customers", w.id, r.customer_id);
    Object.assign(r, { score: v, comment: String(comment || "").trim().slice(0, 2000), answered_at: new Date().toISOString() });
    if (w && c && isNegative(r.kind, v)) {
      const quote = r.comment ? `: "${r.comment.slice(0, 160)}"` : " (no comment)";
      const { alert } = raise(w, c, { type: "detractor", key: `detractor|${r.id}`, reason: `${r.kind === "nps" ? "NPS" : "CSAT"} ${v}/${k.max}${quote}` }, today(), { response_id: r.id });
      if (alert) r.alert_id = alert.id;
    }
    if (w) addLog(w, { kind: "response", customer_id: r.customer_id, survey_id: r.survey_id, text: `${r.store_name}: ${r.kind.toUpperCase()} ${v}` });
    store.save();
    return { response: r };
  }

  // ---- what the Command Center shows (money only for people with Billing view)
  function needs(w, { money = false } = {}) {
    const out = [], day = today(), cs = customers(w);
    if (!cs.length) return out;
    const risk = cs.filter((c) => c.status !== "cancelled" && billing.health(w, c, day).label === "at_risk");
    if (risk.length) out.push({ module: "Success", route: "success", param: null, title: "Customer success", text: `${risk.length} customer${risk.length === 1 ? "" : "s"} at risk${money ? `: SAR ${Math.round(risk.reduce((a, c) => a + mrrSar(c), 0)).toLocaleString("en-US")} MRR` : ""}` });
    const rows = renewalRows(cs, day, store.listOps(R, w.id), 14).filter((r) => r.days >= 0 && r.status === "not_started" && !r.record_id);
    if (rows.length) out.push({ module: "Success", route: "success", param: "renewals", title: "Renewals", text: `${rows.length} renewal${rows.length === 1 ? "" : "s"} in the next 14 days with no status: ${rows.slice(0, 3).map((r) => r.store_name).join(", ")}` });
    const det = store.db[A].filter((a) => a.workspace_id === w.id && a.type === "detractor" && a.status === "open");
    if (det.length) out.push({ module: "Success", route: "success", param: "alerts", title: "Detractors", text: `${det.length} unanswered detractor${det.length === 1 ? "" : "s"} from surveys` });
    return out;
  }

  async function tick(now = svc.clock()) {
    const total = { snapshots: 0, alerts: 0, reopened: 0, sent: 0 };
    for (const w of store.listWorkspaces()) {
      if (!store.db.billing_customers.some((c) => c.workspace_id === w.id && !c.archived)) continue;
      const r = runWorkspace(w, now);
      for (const k of ["snapshots", "alerts", "reopened"]) total[k] += r[k];
      total.sent += await sendQueued(w, now);
    }
    return total;
  }
  let timer = null;
  // Hourly: the snapshot is keyed by day, so repeats only refresh today's row; queued surveys go out inside Saudi hours.
  function start(every = 3600e3) {
    const run = async () => { try { await tick(); } catch (e) { log.error("[success] run:", e?.message || e); } };
    setTimeout(run, 45e3).unref?.();
    timer = setInterval(run, every); timer.unref?.();
  }
  const stop = () => { clearInterval(timer); timer = null; };

  return Object.assign(svc, { settings, setSettings, setPlaybook, customers, contactFor, lastActivity, snapsOf, snapshot, raise, evaluateCustomer, runWorkspace, tick, start, stop,
    createSurvey, sendSurvey, deliver, safeSend, sendQueued, respond, link, needs, addLog, today });
}
