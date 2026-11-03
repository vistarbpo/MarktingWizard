// HTTP routes for Customer Success (module "success" in Teams & roles), the public survey page /s/:token,
// the Command Center hook and the sample customers. Money (MRR, prices, price differences) is only returned to
// people whose role can see Billing.
import { levelOk } from "./access.js";
import { ONBOARDING_STEPS, riyadhDay } from "./crm.js";
import { LLMError } from "./engine.js";
import { PLANS } from "./sales.js";
import { DEFAULT_PRICING, cleanPricing } from "./pricing.js";
import { addDays, addMonths, mrrSar } from "./billing.js";
import { ALERT_IDS, ALERT_STATUS, ALERT_TYPES, BANDS, OUTCOMES, OUTCOME_IDS, RENEWAL_IDS, RENEWAL_STATUS, SURVEY_CHANNELS, SURVEY_KINDS, cleanSettings, cleanSteps, csatOf,
  expansionSignals, kindOf, npsOf, onboardingRow, parseDraft, playbooksOf, renewalRows, savePlanPrompt, writerPrompt } from "./success.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const MONEY_KEYS = new Set(["mrr_sar", "at_risk_mrr_sar", "current_usd", "suggested_usd", "diff_usd", "diff_sar", "overage_usd", "renewal_mrr_sar"]);
// Removes every money field, at any depth, for people without Billing view.
export function stripMoney(x) {
  if (Array.isArray(x)) return x.map(stripMoney);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([k]) => !MONEY_KEYS.has(k)).map(([k, v]) => [k, stripMoney(v)]));
  return x;
}

// ---- Command Center: at-risk customers, renewals in 14 days with no status, unanswered detractors.
export function successNeeds(success, w, { money = false } = {}) {
  try { return success.needs(w, { money }); } catch (e) { console.error("[success] needs:", e?.message); return []; }
}

// ---- the public survey page (no login). One token per customer per survey; one answer per token.
const page = (title, body) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,Tahoma,Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#111;padding:16px}
.box{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:24px;max-width:560px;width:100%}h1{font-size:20px;margin:0 0 6px}p{color:#444;line-height:1.6;margin:6px 0}.en{direction:ltr;text-align:left;color:#666;font-size:14px}
.scale{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 4px;direction:ltr;justify-content:center}.scale label{position:relative}.scale input{position:absolute;opacity:0;inset:0}
.scale span{display:grid;place-items:center;width:40px;height:40px;border:1px solid #ccc;border-radius:9px;font-weight:600;cursor:pointer;background:#fff}.scale input:checked+span{background:#111;color:#fff;border-color:#111}.scale input:focus-visible+span{outline:2px solid #4b6bfb;outline-offset:2px}
.ends{display:flex;justify-content:space-between;font-size:12px;color:#777;direction:ltr;margin-bottom:12px}textarea{width:100%;min-height:90px;font:inherit;padding:10px;border:1px solid #ccc;border-radius:9px}
button{margin-top:12px;font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:9px;background:#111;color:#fff;cursor:pointer;width:100%}.err{color:#b00}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style></head><body><main class="box">${body}</main></body></html>`;
function surveyPage(sv, r, company, err = "") {
  const k = kindOf(sv.kind), nums = Array.from({ length: k.max - k.min + 1 }, (_, i) => k.min + i);
  return page(`${company} · رأيك`, `<h1 dir="auto">${esc(company)}</h1>
<p dir="auto">${esc(sv.question_ar)}</p><p class="en" dir="auto">${esc(sv.question_en)}</p>
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}
<form method="post" action="/s/${esc(r.token)}">
<fieldset style="border:0;padding:0;margin:0"><legend class="sr">${esc(sv.question_en)} (${k.min}–${k.max})</legend>
<div class="scale">${nums.map((v) => `<label><input type="radio" name="score" value="${v}" required aria-label="${v}"><span>${v}</span></label>`).join("")}</div></fieldset>
<div class="ends"><span>${sv.kind === "nps" ? "مستبعد · Not likely" : "غير راضي · Not satisfied"}</span><span>${sv.kind === "nps" ? "أكيد · Very likely" : "راضي جداً · Very satisfied"}</span></div>
<label for="c">وش أهم سبب لتقييمك؟ <span class="en" style="display:inline">· What's the main reason for your score? (optional)</span></label>
<textarea id="c" name="comment" maxlength="2000" dir="auto"></textarea>
<button type="submit">إرسال · Send</button></form>`);
}
const thanksPage = (company, again = false) => page("شكراً · Thank you", `<h1>شكراً لك 🌿</h1><p>${again ? "وصلنا ردّك من قبل، شكراً على وقتك." : "وصلنا ردّك، ونقرأ كل تعليق بأنفسنا."}</p><p class="en">${again ? "We already have your answer. Thank you for your time." : "We got your answer, and a person reads every comment."}</p><p class="en">${esc(company)}</p>`);

export function mountSuccessPublic(app, { store, success }) {
  const hits = new Map();
  const limited = (key, max, windowMs = 10 * 60e3) => {
    const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return list.length > max;
  };
  const find = (token) => store.db.success_responses?.find((x) => x.token === String(token || "")) || null;
  const company = (r) => store.getWorkspace(r.workspace_id)?.brief?.company_name || "DPA AD";
  const wantsJson = (req) => (req.headers["content-type"] || "").includes("json") || (req.headers.accept || "").includes("application/json");
  app.get("/s/:token", (req, res) => {
    if (limited("get:" + req.ip, 60)) return res.status(429).send(page("Too many requests", "<p>حاول بعد شوي · Please try again in a few minutes.</p>"));
    const r = find(req.params.token), sv = r && store.getOps("success_surveys", r.workspace_id, r.survey_id);
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    if (!r || !sv) return res.status(404).send(page("Not found", "<p>الرابط غير صحيح · This survey link isn't valid.</p>"));
    if (r.answered_at) return res.send(thanksPage(company(r), true));
    if (!r.opened_at) { r.opened_at = new Date().toISOString(); store.save(); }
    res.send(surveyPage(sv, r, company(r)));
  });
  app.post("/s/:token", (req, res) => {
    const json = wantsJson(req);
    if (limited("post:" + req.ip, 10) || limited("tok:" + String(req.params.token).slice(0, 40), 5)) return json ? res.status(429).json({ detail: "Too many answers. Please try again later." }) : res.status(429).send(page("Too many requests", "<p>حاول بعد شوي · Please try again in a few minutes.</p>"));
    const out = success.respond(req.params.token, { score: req.body?.score, comment: req.body?.comment });
    const r = out.response || find(req.params.token);
    if (out.error) {
      if (json) return res.status(out.status).json({ detail: out.error });
      if (out.status === 409) return res.status(409).send(thanksPage(company(r), true));
      if (out.status === 404 || !r) return res.status(404).send(page("Not found", "<p>الرابط غير صحيح · This survey link isn't valid.</p>"));
      return res.status(422).send(surveyPage(store.getOps("success_surveys", r.workspace_id, r.survey_id), r, company(r), `اختر رقماً · ${out.error}`));
    }
    json ? res.json({ ok: true }) : res.send(thanksPage(company(r)));
  });
}

export function mountSuccess(app, { store, success, billing, crm = null, provider, workforce = null }) {
  const P = "/api/workspaces/:ws/success";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const C = (req, res, w, id = req.params.id) => { const c = billing.getCustomer(w.id, id); if (!c) res.status(404).json({ detail: "Customer not found" }); return c; };
  const by = (req) => req.user?.name || "you";
  const money = (req) => levelOk(req.perms?.billing, "view");
  const out = (req, x) => (money(req) ? x : stripMoney(x));
  const users = () => [{ id: "owner", name: "Owner (team password)" }, ...store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))];
  const validUser = (id) => id === "owner" || store.db.users.some((u) => u.id === String(id) && u.active);
  const pricing = (w) => cleanPricing(w?.finance?.pricing || {}, DEFAULT_PRICING);
  const today = () => success.today();

  // One customer's success view: live health, trend, alerts, last survey answer, expansion, onboarding, renewal.
  const skusOf = (w, c, ct) => Number(c.skus) || Number(ct?.products) || Number(c.deal_id ? store.getDeal(w.id, c.deal_id)?.skus : 0) || null;
  function view(w, c, day = today(), { full = false, req = null } = {}) {
    const h = billing.health(w, c, day), ct = success.contactFor(w, c);
    const snaps = success.snapsOf(w, c.id).filter((x) => x.date >= addDays(day, -30));
    const alerts = store.listOps("success_alerts", w.id).filter((a) => a.customer_id === c.id);
    const resp = store.listOps("success_responses", w.id).filter((r) => r.customer_id === c.id && r.answered_at).sort((a, b) => b.answered_at.localeCompare(a.answered_at));
    const exp = expansionSignals({ c, usage: billing.usageOf(w.id, c.id), skus: skusOf(w, c, ct), pricing: pricing(w), today: day, s: success.settings(w) });
    const row = { id: c.id, store_name: c.store_name, domain: c.domain, platform: c.platform, plan: c.plan, cycle: c.cycle, status: c.status, start_date: c.start_date, sample: !!c.sample,
      cancel_at_period_end: !!c.cancel_at_period_end, owner_id: c.success_owner_id || null, mrr_sar: mrrSar(c),
      health: { score: h.score, label: h.label, factors: h.factors }, trend: snaps.map((x) => ({ date: x.date, score: x.score })),
      open_alerts: alerts.filter((a) => a.status === "open").length, last_response: resp[0] ? { kind: resp[0].kind, score: resp[0].score, comment: resp[0].comment, at: resp[0].answered_at } : null,
      expansion: exp.signals.length ? exp : null, linked: !!ct };
    if (!full) return row;
    const s = success.settings(w), rec = store.listOps("success_renewals", w.id);
    return { ...row, alerts: alerts.sort((a, b) => b.created_at.localeCompare(a.created_at)), responses: resp.slice(0, 20), onboarding: onboardingRow(c, ct, day, s),
      renewal: renewalRows([c], day, rec, 400)[0] || null, last_activity: success.lastActivity(w, c),
      drafts: store.listOps("success_drafts", w.id).filter((d) => d.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10).map((d) => draftOut(req, d)) };
  }
  const draftOut = (req, d) => (d.money && req && !money(req) ? { ...d, text: "Hidden: this draft includes prices (needs Billing view)", original: "", subject: d.subject } : d);

  app.get("/api/success/meta", (req, res) => res.json({ alert_types: ALERT_TYPES, alert_status: ALERT_STATUS, outcomes: OUTCOMES, renewal_status: RENEWAL_STATUS, bands: BANDS,
    survey_kinds: SURVEY_KINDS, survey_channels: SURVEY_CHANNELS, onboarding: ONBOARDING_STEPS, plans: PLANS.map((p) => ({ name: p.name, max_skus: Number.isFinite(p.max) ? p.max : null })) }));

  // ---- overview
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const day = today(), cs = success.customers(w).filter((c) => c.status !== "cancelled");
    const rows = cs.map((c) => view(w, c, day));
    const bands = Object.fromEntries(BANDS.map((b) => [b.id, rows.filter((r) => r.health.label === b.id).length]));
    // Health trend: the average snapshot score per day, last 30 days.
    const since = addDays(day, -29), byDay = {};
    for (const x of store.listOps("success_health", w.id)) if (x.date >= since && cs.some((c) => c.id === x.customer_id)) (byDay[x.date] ||= []).push(x.score);
    const trend = Object.keys(byDay).sort().map((d) => ({ date: d, avg: Math.round(byDay[d].reduce((a, v) => a + v, 0) / byDay[d].length), n: byDay[d].length }));
    const ren = renewalRows(success.customers(w), day, store.listOps("success_renewals", w.id), 90).filter((r) => r.days >= 0);
    const win = (d) => ren.filter((r) => r.days <= d);
    const answers = store.listOps("success_responses", w.id).filter((r) => r.answered_at);
    const atRisk = rows.filter((r) => r.health.label === "at_risk");
    res.json(out(req, { settings: success.settings(w), bands, trend, customers: rows, users: users(),
      renewals: { d30: win(30).length, d60: win(60).length, d90: win(90).length, renewal_mrr_sar: Math.round(win(90).reduce((a, r) => a + r.mrr_sar, 0)) },
      at_risk_mrr_sar: Math.round(atRisk.reduce((a, r) => a + r.mrr_sar, 0)),
      expansion: rows.filter((r) => r.expansion).map((r) => ({ customer_id: r.id, store_name: r.store_name, plan: r.plan, ...r.expansion })),
      alerts: { open: store.listOps("success_alerts", w.id).filter((a) => a.status === "open").length, snoozed: store.listOps("success_alerts", w.id).filter((a) => a.status === "snoozed").length },
      nps: npsOf(answers.filter((r) => r.kind === "nps").map((r) => r.score)), csat: csatOf(answers.filter((r) => r.kind === "csat").map((r) => r.score)),
      needs: success.needs(w, { money: money(req) }), playbooks: playbooksOf(w) }));
  });
  app.get(`${P}/customers/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    res.json(out(req, view(w, c, today(), { full: true, req })));
  });
  app.put(`${P}/customers/:id/owner`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const id = req.body?.owner_id ? String(req.body.owner_id) : null;
    if (id && !validUser(id)) return res.status(422).json({ detail: "Unknown person" });
    billing.updateCustomer(w, c, { success_owner_id: id });
    // Open alerts without an owner follow the customer's owner.
    for (const a of store.listOps("success_alerts", w.id).filter((x) => x.customer_id === c.id && x.status !== "done" && !x.owner_id)) a.owner_id = id;
    store.save();
    res.json({ owner_id: id });
  });

  // ---- alerts (tasks a person owns)
  app.get(`${P}/alerts`, (req, res) => {
    const w = W(req, res); if (!w) return;
    let list = store.listOps("success_alerts", w.id);
    if (req.query.status) list = list.filter((a) => a.status === req.query.status);
    if (req.query.customer) list = list.filter((a) => a.customer_id === String(req.query.customer));
    if (req.query.type) list = list.filter((a) => a.type === req.query.type);
    res.json(list.sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : ALERT_STATUS.indexOf(a.status) - ALERT_STATUS.indexOf(b.status))).slice(0, 500));
  });
  app.put(`${P}/alerts/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps("success_alerts", w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Alert not found" });
    const b = req.body || {}, day = today(), hist = [];
    if (b.owner_id !== undefined) { const id = b.owner_id ? String(b.owner_id) : null; if (id && !validUser(id)) return res.status(422).json({ detail: "Unknown person" }); if (id !== a.owner_id) hist.push(`Owner → ${users().find((u) => u.id === id)?.name || "nobody"}`); a.owner_id = id; }
    if (Array.isArray(b.steps)) a.steps = a.steps.map((s, i) => ({ ...s, done: b.steps[i] == null ? s.done : !!b.steps[i] }));
    if (b.note !== undefined && str(b.note, 1000)) hist.push(`Note: ${str(b.note, 1000)}`);
    if (b.status !== undefined) {
      if (!ALERT_STATUS.includes(b.status)) return res.status(422).json({ detail: "status must be open, snoozed or done" });
      if (b.status === "snoozed") {
        if (!isoDate(b.snooze_until) || b.snooze_until <= day) return res.status(422).json({ detail: "Pick a snooze date after today" });
        a.snooze_until = b.snooze_until; hist.push(`Snoozed until ${b.snooze_until}`);
      }
      if (b.status === "done") {
        if (!OUTCOME_IDS.includes(b.outcome)) return res.status(422).json({ detail: "Pick an outcome" });
        const note = str(b.outcome_note, 1000);
        if (!note) return res.status(422).json({ detail: "Write what happened (outcome note)" });
        Object.assign(a, { outcome: b.outcome, outcome_note: note, done_at: new Date().toISOString(), done_by: by(req) });
        hist.push(`Done: ${OUTCOMES.find((o) => o.id === b.outcome).name}: ${note}`);
      }
      if (b.status === "open" && a.status !== "open") { a.snooze_until = null; hist.push(a.status === "done" ? "Reopened" : "Snooze removed"); if (a.status === "done") Object.assign(a, { outcome: null, done_at: null }); }
      a.status = b.status;
    }
    a.history = [...(a.history || []), ...hist.map((text) => ({ at: new Date().toISOString(), by: by(req), text }))].slice(-100);
    a.updated_at = new Date().toISOString();
    store.save();
    res.json(a);
  });
  app.post(`${P}/run`, (req, res) => { const w = W(req, res); if (!w) return; res.json(success.runWorkspace(w)); });

  // ---- renewals
  app.get(`${P}/renewals`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const day = today();
    res.json(out(req, renewalRows(success.customers(w), day, store.listOps("success_renewals", w.id), Math.min(365, Number(req.query.days) || 90))
      .map((r) => ({ ...r, health: billing.health(w, billing.getCustomer(w.id, r.customer_id), day) }))
      .map(({ health, ...r }) => ({ ...r, health: { score: health.score, label: health.label } }))));
  });
  app.put(`${P}/renewals/:customerId`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w, req.params.customerId); if (!c) return;
    const b = req.body || {};
    const row = renewalRows([c], today(), store.listOps("success_renewals", w.id), 400)[0];
    const date = isoDate(b.date) ? b.date : row?.date;
    if (!date) return res.status(422).json({ detail: "This customer has no renewal or trial end date" });
    if (b.status !== undefined && !RENEWAL_IDS.includes(b.status)) return res.status(422).json({ detail: "Unknown renewal status" });
    if (b.status === "lost" && !str(b.lost_reason, 300)) return res.status(422).json({ detail: "Write why the renewal was lost" });
    if (b.owner_id && !validUser(b.owner_id)) return res.status(422).json({ detail: "Unknown person" });
    let rec = store.listOps("success_renewals", w.id).find((x) => x.customer_id === c.id && x.date === date);
    if (!rec) rec = store.addOps("success_renewals", w.id, { customer_id: c.id, date, status: "not_started", lost_reason: "", owner_id: c.success_owner_id || null, note: "", ...(c.sample ? { sample: true } : {}) }, false);
    if (b.status !== undefined) rec.status = b.status;
    if (b.lost_reason !== undefined) rec.lost_reason = str(b.lost_reason, 300);
    if (b.owner_id !== undefined) rec.owner_id = b.owner_id ? String(b.owner_id) : null;
    if (b.note !== undefined) rec.note = str(b.note, 1000);
    rec.updated_at = new Date().toISOString(); rec.updated_by = by(req);
    store.save();
    res.json(rec);
  });

  // ---- onboarding (from the Store CRM checklist)
  app.get(`${P}/onboarding`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const day = today(), s = success.settings(w);
    res.json(success.customers(w).filter((c) => c.status !== "cancelled").map((c) => onboardingRow(c, success.contactFor(w, c), day, s))
      .sort((a, b) => (b.stuck?.length || 0) - (a.stuck?.length || 0) || (a.pct ?? 101) - (b.pct ?? 101)));
  });

  // ---- surveys
  app.get(`${P}/surveys`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const resp = store.listOps("success_responses", w.id);
    res.json(store.listOps("success_surveys", w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((sv) => {
      const rs = resp.filter((r) => r.survey_id === sv.id), ans = rs.filter((r) => r.answered_at);
      return { ...sv, recipients: rs.length, answered: ans.length, by_status: rs.reduce((a, r) => ((a[r.send_status] = (a[r.send_status] || 0) + 1), a), {}),
        score: sv.kind === "nps" ? npsOf(ans.map((r) => r.score)) : csatOf(ans.map((r) => r.score)) };
    }));
  });
  app.post(`${P}/surveys`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {};
    if (b.kind && !SURVEY_KINDS.some((k) => k.id === b.kind)) return res.status(422).json({ detail: "kind must be nps or csat" });
    if (b.channel && !SURVEY_CHANNELS.includes(b.channel)) return res.status(422).json({ detail: "channel must be email, whatsapp or link" });
    res.status(201).json(success.createSurvey(w, b, by(req)));
  });
  app.get(`${P}/surveys/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const sv = store.getOps("success_surveys", w.id, req.params.id);
    if (!sv) return res.status(404).json({ detail: "Survey not found" });
    const rs = store.listOps("success_responses", w.id).filter((r) => r.survey_id === sv.id).map((r) => ({ ...r, link: success.link(r) }));
    res.json({ ...sv, responses: rs, score: sv.kind === "nps" ? npsOf(rs.filter((r) => r.answered_at).map((r) => r.score)) : csatOf(rs.filter((r) => r.answered_at).map((r) => r.score)) });
  });
  app.post(`${P}/surveys/:id/send`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const sv = store.getOps("success_surveys", w.id, req.params.id);
    if (!sv) return res.status(404).json({ detail: "Survey not found" });
    const ids = Array.isArray(req.body?.customer_ids) && req.body.customer_ids.length ? req.body.customer_ids.map(String) : null;
    try { res.json(await success.sendSurvey(w, sv, ids, by(req))); } catch (e) { console.error("[success] send:", e); res.status(500).json({ detail: "Could not send the survey" }); }
  });
  app.delete(`${P}/surveys/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const sv = store.getOps("success_surveys", w.id, req.params.id);
    if (!sv) return res.status(404).json({ detail: "Survey not found" });
    if (sv.status !== "draft") return res.status(409).json({ detail: "Sent surveys are kept with their answers" });
    store.deleteOps("success_surveys", w.id, sv.id);
    res.status(204).end();
  });

  // ---- playbooks and settings
  app.put(`${P}/playbooks/:type`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!ALERT_IDS.includes(req.params.type)) return res.status(404).json({ detail: "Unknown alert type" });
    const steps = cleanSteps(req.body?.steps);
    res.json(success.setPlaybook(w, req.params.type, steps.length ? steps : null));
  });
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { f, err } = cleanSettings(req.body || {});
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.json(success.setSettings(w, f));
  });

  // ---- AI agents (level 1: drafts; a person approves). Retention watcher: why at risk + save plan.
  // Expansion & renewal writer: upgrade and renewal emails in Saudi Arabic and English, sent only by a person.
  const AGENT = { "save-plan": "retention_watcher", expansion: "success_writer", renewal: "success_writer" };
  app.post(`${P}/customers/:id/ai/:task`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const task = req.params.task, agent = AGENT[task];
    if (!agent) return res.status(404).json({ detail: "Unknown AI task" });
    if (workforce && workforce.level(agent) < 1) return res.status(409).json({ detail: "This agent is switched off in AI Workforce." });
    const day = today(), h = billing.health(w, c, day), ct = success.contactFor(w, c), showMoney = money(req);
    let prompt, fallback;
    if (task === "save-plan") {
      const tickets = billing.ticketsFor(w.id, c).map((t) => ({ status: t.status, channel: t.channel, last: t.messages?.filter((m) => m.from === "customer").at(-1)?.text || "" }));
      prompt = savePlanPrompt(w, c, { health: h, alerts: store.listOps("success_alerts", w.id).filter((a) => a.customer_id === c.id && a.status !== "done"), tickets, usage: billing.usageOf(w.id, c.id), onboarding: ct ? onboardingRow(c, ct, day, success.settings(w)) : null });
      fallback = `Save plan: ${c.store_name}`;
    } else {
      const exp = expansionSignals({ c, usage: billing.usageOf(w.id, c.id), skus: skusOf(w, c, ct), pricing: pricing(w), today: day, s: success.settings(w) });
      const renewal = renewalRows([c], day, store.listOps("success_renewals", w.id), 400)[0] || null;
      if (task === "expansion" && !exp.signals.length) return res.status(409).json({ detail: "No expansion signal for this customer yet" });
      if (task === "renewal" && !renewal) return res.status(409).json({ detail: "No renewal or trial end date for this customer" });
      prompt = writerPrompt(w, c, task, { exp, renewal, showMoney });
      fallback = task === "expansion" ? `خطة أكبر لمتجركم · A bigger plan for ${c.store_name}` : `تجديد اشتراككم · Your ${c.store_name} renewal`;
    }
    try {
      const text = await provider.generate({ system: "You are part of DPA AD's Customer Success team. You draft; a person reviews and sends. Never invent numbers, results or quotes: write [ADD].", prompt, onText: () => {} });
      const p = task === "save-plan" ? { subject: fallback, text: text.trim() } : parseDraft(text, fallback);
      const alertId = req.body?.alert_id && store.getOps("success_alerts", w.id, req.body.alert_id)?.customer_id === c.id ? String(req.body.alert_id) : null;
      const d = store.addOps("success_drafts", w.id, { kind: task, agent, customer_id: c.id, alert_id: alertId, subject: p.subject, text: p.text, original: p.text, status: "draft", by: "ai", money: showMoney && task !== "save-plan", ...(c.sample ? { sample: true } : {}) });
      res.status(201).json(d);
    } catch (e) { res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." }); }
  });
  app.get(`${P}/drafts`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json(store.listOps("success_drafts", w.id).filter((d) => !req.query.status || d.status === req.query.status).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100)
      .map((d) => ({ ...draftOut(req, d), store_name: store.getOps("billing_customers", w.id, d.customer_id)?.store_name || "" })));
  });
  app.post(`${P}/drafts/:id/:action`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getOps("success_drafts", w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Draft not found" });
    if (d.status !== "draft") return res.status(409).json({ detail: "Already handled" });
    if (d.money && !money(req)) return res.status(403).json({ detail: "This draft includes prices: someone with Billing view must handle it" });
    if (req.params.action === "reject") {
      store.updateOps("success_drafts", w.id, d.id, { status: "rejected", handled_by: by(req) });
      workforce?.event(d.agent, w.id, "rejected", `${d.kind} for ${d.customer_id}`);
      return res.json(store.getOps("success_drafts", w.id, d.id));
    }
    if (req.params.action !== "approve") return res.status(404).json({ detail: "Unknown action" });
    const subject = str(req.body?.subject ?? d.subject, 200), text = String(req.body?.text ?? d.text).trim().slice(0, 8000);
    if (!text) return res.status(422).json({ detail: "The draft is empty" });
    const edited = text !== d.original || subject !== d.subject, c = billing.getCustomer(w.id, d.customer_id);
    let sent = null;
    if (d.kind === "save-plan") {
      // A save plan is kept on the alert (or the customer's open alerts) for the owner to follow.
      const a = d.alert_id ? store.getOps("success_alerts", w.id, d.alert_id) : null;
      if (a) { a.save_plan = text; a.history = [...(a.history || []), { at: new Date().toISOString(), by: by(req), text: "Save plan approved" }]; }
    } else if (c && req.body?.send) {
      // A person pressed Send: through the CRM's senders, with every outreach rule (Test mode logs it).
      sent = await success.safeSend(w, c, { channel: "email", subject, body: text });
      success.addLog(w, { kind: "email", customer_id: c.id, draft_id: d.id, status: sent.status, text: `${subject}: ${sent.status}${sent.note ? ` (${sent.note})` : ""}` });
    }
    store.updateOps("success_drafts", w.id, d.id, { status: "approved", subject, text, handled_by: by(req), sent_status: sent?.status || null, sent_note: sent?.note || "" });
    workforce?.event(d.agent, w.id, edited ? "edited" : "accepted", `${d.kind} for ${d.customer_id}`);
    res.json({ ...store.getOps("success_drafts", w.id, d.id), sent });
  });
}

// ================================================================= sample customers (flagged sample: true)
// Six Billing customers in different states, with usage history, a few weeks of health snapshots, one
// overdue invoice, CRM onboarding progress (when the sample CRM stores are loaded) and a sample NPS survey.
export function loadSampleSuccess({ store, billing, success, crm }, w, now = new Date()) {
  if (billing.customers(w.id).some((c) => c.sample)) return { customers: 0 };
  const day = riyadhDay(now), month = day.slice(0, 7);
  const m = (k) => addMonths(month + "-01", -k).slice(0, 7);
  const crmSamples = crm ? crm.contacts(w.id).filter((c) => c.sample && c.domain) : [];
  const defs = [
    // usage: renders [two months ago, last month, this month]; stale: last reported 20 days ago.
    { name: "Lamsa Abaya House", plan: "Growth", cycle: "yearly", since: 300, usage: [2400, 2300, 900], skus: 6200, onb: 7, score: [80, 82, 81] },
    { name: "Oud Anfas", plan: "Scale", cycle: "monthly", since: 200, usage: [15900, 16200, 15800], skus: 21000, onb: 7, score: [88, 90, 89] },
    { name: "Glow Beauty KSA", plan: "Starter", cycle: "monthly", since: 120, usage: [1800, 600, null], stale: true, skus: 420, onb: 3, score: [85, 80, 66], ticket: "أبي أسترجع المبلغ، الإعلانات ما اشتغلت عندي" },
    { name: "Qahwa Market", plan: "Growth", cycle: "monthly", since: 90, usage: [2100, 1900, null], stale: true, skus: 900, onb: 5, score: [76, 70, 52], past_due: true },
    { name: "Bayt Home", plan: "Growth", cycle: "yearly", since: 345, usage: [2000, 2100, 800], skus: 3100, onb: 6, score: [72, 71, 73], cancel: true },
    { name: "Farah Toys", plan: "Starter", cycle: "monthly", since: 9, usage: [null, null, 300], skus: 610, onb: 2, score: [60, 58, 55], trial: true },
  ];
  const made = [];
  defs.forEach((d, i) => {
    const ct = crmSamples[i] || null;
    const start = addDays(day, -d.since);
    const c = billing.addCustomer(w, { store_name: `Sample · ${d.name}`, domain: ct?.domain || `${d.name.toLowerCase().replace(/[^a-z]+/g, "-")}.example.com`, platform: i % 3 === 2 ? "Zid" : "Salla",
      owner_name: "", owner_email: ct?.email || "", plan: d.plan, cycle: d.cycle, currency: "SAR", status: d.trial ? "trial" : "active", start_date: start,
      already_billed: true, crm_contact_id: ct?.id || null, skus: d.skus }, "sample");
    c.sample = true;
    if (d.cancel) { c.cancel_at_period_end = true; billing.event(c, "cancel_scheduled", `Cancels at the end of the period (${c.period_end})`, "sample"); }
    [m(2), m(1), month].forEach((mm, k) => {
      if (d.usage[k] == null) return;
      const u = billing.setUsage(w, c, mm, d.usage[k], { source: "sample" }); u.sample = true;
      if (d.stale) u.updated_at = addDays(day, -20) + "T09:00:00.000Z";
    });
    // An overdue invoice for the past-due store (a sample number outside the invoice sequence).
    if (d.past_due) {
      const inv = billing.draft(w, c, { lines: [{ kind: "subscription", description: "DPA AD Growth plan, monthly (sample)", qty: 1, unit_price: 1683.75 }], by: "sample" });
      Object.assign(inv, { status: "issued", number: `SAMPLE-${String(c.id).padStart(4, "0")}`, issue_date: addDays(day, -17), due_date: addDays(day, -10), supply_date: addDays(day, -17), sample: true, reminders: [{ step: 1, at: now.toISOString(), status: "test" }, { step: 3, at: now.toISOString(), status: "test" }, { step: 7, at: now.toISOString(), status: "test" }] });
      c.status = "past_due"; billing.event(c, "past_due", `${inv.number} is overdue`, "sample");
    }
    if (d.ticket) { const t = store.addTicket(w.id, { channel: "WhatsApp", customer_name: "Sample · owner", contact: c.domain, store: c.domain, status: "needs_human", category: "billing", sample: true }); store.addTicketMessage(w.id, t.id, { from: "customer", text: d.ticket }); }
    // CRM onboarding progress (sample CRM stores only).
    if (ct) {
      const done = {}, at = {};
      ONBOARDING_STEPS.forEach((s, k) => { if (k < d.onb) { done[s.id] = true; at[s.id] = new Date(Date.parse(start) + (k + 1) * 3 * 864e5).toISOString(); } });
      crm.update(w.id, ct.id, { stage: d.onb === ONBOARDING_STEPS.length ? "active" : "onboarding", onboarding: done, onboarding_at: at, owner_name: ct.owner_name || "Sample owner" });
    }
    // A few weeks of daily health snapshots (sample values), so the trend has a shape; today is computed for real.
    for (let k = 21; k >= 1; k--) {
      const s = k > 14 ? d.score[0] : k > 7 ? d.score[1] : d.score[2];
      store.addOps("success_health", w.id, { customer_id: c.id, date: addDays(day, -k), score: s, label: s >= 75 ? "healthy" : s >= 50 ? "watch" : "at_risk", parts: { payment: 30, usage: Math.min(25, Math.max(0, s - 55)), tickets: 15, onboarding: 10, activity: Math.max(0, s - 70) }, sample: true }, false);
    }
    made.push(c);
  });
  // A sample NPS survey with three answers (one detractor).
  const sv = success.createSurvey(w, { name: "Sample · NPS check-in", kind: "nps", channel: "email", sample: true }, "sample");
  sv.status = "sent"; sv.sent_at = now.toISOString();
  for (const [i, score, comment] of [[0, 9, "الإعلانات صارت أحلى بكثير"], [1, 10, "Saves us hours every week"], [2, 4, "التصاميم حلوة بس الفيديو يتأخر"]]) {
    const r = store.addOps("success_responses", w.id, { survey_id: sv.id, customer_id: made[i].id, store_name: made[i].store_name, token: `sample-${made[i].id}-${Math.random().toString(36).slice(2, 10)}`, kind: "nps", score: null, comment: "", answered_at: null, send_status: "test", send_note: "Sample store: never sent for real", sample: true }, false);
    success.respond(r.token, { score, comment });
  }
  store.save();
  success.runWorkspace(w, now);
  return { customers: made.length };
}
export function removeSampleSuccess({ store, crm }, w) {
  const id = String(w.id), db = store.db;
  const ids = new Set((db.billing_customers || []).filter((c) => c.workspace_id === id && c.sample).map((c) => c.id));
  const before = ids.size;
  for (const k of Object.keys(db)) {
    if (!/^(billing|success)_/.test(k) || !Array.isArray(db[k])) continue;
    db[k] = db[k].filter((x) => !(x?.workspace_id === id && (x.sample || ids.has(x.customer_id) || (k === "billing_customers" && ids.has(x.id)))));
  }
  db.support_tickets = db.support_tickets.filter((t) => !(t.workspace_id === id && t.sample));
  store.save();
  return { customers: before };
}
