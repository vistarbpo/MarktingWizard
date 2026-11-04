// HTTP routes for Partners & referrals (module "partners"): /api/workspaces/:ws/partners/...
// Before the login wall (mountPartnersPublic): /r/<code> (click, cookie, redirect to an allowlisted host only) and the
// read-only partner portal /p/<token> (rate-limited, counts only unless the setting allows customer names).
// Money (MRR, commissions, statements) is shown only to roles with Billing or Finance view; MRR only with Billing view.
// Approving and paying a statement needs Finance Edit or the Owner. A paid statement posts one Finance expense
// (source "partners"). Partner emails are drafted by the AI Partnerships manager and sent, if at all, only through
// the Store CRM's sendOne() (Test mode, opt-outs, sample stores, Saudi hours).
import crypto from "node:crypto";
import { levelOk } from "./access.js";
import { inWindow } from "./crm.js";
import { mediaView, publicBase } from "./media.js";
import { AGENT_ID, COLL, DEFAULT_SETTINGS, DRAFT_KINDS, DRAFT_KIND_IDS, STATUSES, TAX_NOTE, TYPES, attribution, changeLines, cleanCode, cleanPartner, cleanSettings, codeTaken,
  ensurePartners, findCode, funnel, hostAllowed, isDate, isMonth, logPush, partnerLines, people, portalHtml, recordClick, redirectFor, settingsOf, statementLines, suggestCode, todayOf, totalOf, draftFacts } from "./partners.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function mountPartnersPublic(app, { store, partners, env = process.env }) {
  ensurePartners(store);
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return list.length > max;
  };
  const secure = !/^http:\/\//i.test(env.PUBLIC_URL || "https://");
  app.get("/r/:code", (req, res) => {
    const code = findCode(store, req.params.code);
    const w = code ? store.getWorkspace(code.workspace_id) : null;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Robots-Tag", "noindex");
    if (!code || !w || code.active === false) return res.redirect(302, redirectFor(w || null, null));
    if (!limited("r:" + req.ip, 60, 60e3)) recordClick(store, code, { ip: req.ip, ua: req.headers["user-agent"], now: partners.now() });
    const days = settingsOf(w).cookie_days || DEFAULT_SETTINGS.cookie_days;
    res.setHeader("Set-Cookie", `dpa_ref=${code.code}; Path=/; Max-Age=${days * 86400}; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`);
    res.redirect(302, redirectFor(w, code));
  });
  app.get("/p/:token", (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Robots-Tag", "noindex");
    if (limited("p:" + req.ip, 30, 10 * 60e3)) return res.status(429).send("Too many requests. Please try again in a few minutes.");
    const t = String(req.params.token || "");
    const p = t.length >= 20 ? store.db[COLL.partners].find((x) => x.portal_token && x.portal_token.length === t.length && crypto.timingSafeEqual(Buffer.from(x.portal_token), Buffer.from(t))) : null;
    const w = p ? store.getWorkspace(p.workspace_id) : null;
    if (!p || !w) return res.status(404).send("This partner page is not available.");
    const crm = app.locals.crm, attr = attribution(store, crm, w.id), s = settingsOf(w);
    const stats = funnel(store, crm, w, p.id, attr);
    const links = store.listOps(COLL.codes, w.id).filter((c) => c.partner_id === p.id && c.active !== false).map((c) => `${publicBase(env)}/r/${c.code}`);
    const statements = store.listOps(COLL.statements, w.id).filter((x) => x.partner_id === p.id && ["approved", "paid"].includes(x.status)).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 24);
    const ids = new Set([...attr.customers].filter(([, a]) => a.partner_id === p.id).map(([k]) => k));
    const names = s.portal_show_names ? (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && ids.has(c.id)).map((c) => c.store_name) : null;
    res.type("html").send(portalHtml({ company: w.brief?.company_name || "DPA AD", partner: p, links, stats, statements, names }));
  });
}

export function mountPartners(app, { store, crm = null, outreach = null, partners, env = process.env }) {
  ensurePartners(store);
  const P = "/api/workspaces/:ws/partners";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => partners.now();
  const can = (req, mod, lvl = "view") => levelOk(req.perms?.[mod], lvl);
  const money = (req) => can(req, "billing") || can(req, "finance");
  const canApprove = (req) => req.user?.id === "owner" || req.user?.role_id === "owner" || can(req, "finance", "edit");
  const outcome = (ws, o, note) => app.locals.workforce?.event(AGENT_ID, ws, o, note);
  const linkOf = (c) => `${publicBase(env)}/r/${c.code}`;
  const codesOf = (w, pid) => store.listOps(COLL.codes, w.id).filter((c) => c.partner_id === pid);
  const getP = (req, res, w) => { const p = store.getOps(COLL.partners, w.id, req.params.id); if (!p) res.status(404).json({ detail: "Partner not found" }); return p; };
  const customerOf = (w, id) => (store.db.billing_customers || []).find((c) => c.workspace_id === w.id && c.id === id && !c.archived) || null;
  const checkLinks = (req, w, out) => {
    if (out.customer_id && !customerOf(w, out.customer_id)) return "Unknown Billing customer.";
    if (out.crm_store_id && (!can(req, "crm") || !crm?.get(w.id, out.crm_store_id))) return "Unknown Store CRM store (or you can't see the Store CRM).";
    if (out.contract?.media_id && !store.getOps("creative_media", w.id, out.contract.media_id)) return "Unknown Creative Studio media id.";
    return null;
  };
  const stView = (req, s) => (money(req) ? s : { ...s, total_sar: null, lines: s.lines.map((l) => ({ ...l, base_sar: null, amount_sar: null })), hidden_money: true });
  const summary = (req, w, p, attr) => {
    const f = funnel(store, crm, w, p.id, attr, { money: can(req, "billing") });
    return { id: p.id, name: p.name, type: p.type, status: p.status, owner_id: p.owner_id, country: p.country, city: p.city, sample: !!p.sample, contact_name: p.contact?.name || "",
      agreement: money(req) ? p.agreement : { tier: p.agreement?.tier || "" }, codes: codesOf(w, p.id).map((c) => ({ id: c.id, code: c.code, active: c.active !== false, link: linkOf(c) })), stats: f, portal: !!p.portal_token };
  };
  const view = (req, w, p) => {
    const attr = attribution(store, crm, w.id);
    const mine = (m, kind) => [...m].filter(([, a]) => a.partner_id === p.id).map(([ref_id, a]) => ({ kind, ref_id, ...a, label: labelOf(req, w, kind, ref_id) }));
    const lines = money(req) ? partnerLines(store, crm, w, p, attr) : [];
    const media = p.contract?.media_id ? store.getOps("creative_media", w.id, p.contract.media_id) : null;
    return { ...summary(req, w, p, attr), ...p, agreement: money(req) ? p.agreement : { tier: p.agreement?.tier || "" },
      contract: { ...(p.contract || {}), media_url: media ? mediaView(media, publicBase(env)).url : null, media_name: media?.name || media?.original_name || null },
      portal_token: undefined, portal_url: p.portal_token ? `${publicBase(env)}/p/${p.portal_token}` : null,
      attributed: [...mine(attr.stores, "store"), ...mine(attr.deals, "deal"), ...mine(attr.customers, "customer")],
      lines, statements: store.listOps(COLL.statements, w.id).filter((s) => s.partner_id === p.id).sort((a, b) => b.month.localeCompare(a.month)).map((s) => stView(req, s)),
      drafts: store.listOps(COLL.drafts, w.id).filter((d) => d.partner_id === p.id).slice(-10).reverse(),
      store_info: p.crm_store_id && can(req, "crm") ? (() => { const c = crm?.get(w.id, p.crm_store_id); return c ? { id: c.id, label: c.store_name || c.domain, sample: !!c.sample } : { id: p.crm_store_id, label: "Store removed", missing: true }; })() : null,
      customer_info: p.customer_id ? (() => { const c = customerOf(w, p.customer_id); return c ? { id: c.id, label: c.store_name } : { id: p.customer_id, label: "Customer removed", missing: true }; })() : null,
      can_edit: can(req, "partners", "edit"), can_approve: canApprove(req), money: money(req), agent_level: partners.level() };
  };
  function labelOf(req, w, kind, id) {
    if (kind === "store") { if (!can(req, "crm")) return "Store (hidden for your role)"; const c = crm?.get(w.id, id); return c ? c.store_name || c.domain : "Store removed"; }
    if (kind === "deal") { if (!can(req, "sales")) return "Deal (hidden for your role)"; return store.getDeal(w.id, id)?.name || "Deal removed"; }
    const c = customerOf(w, id); return c ? c.store_name : "Customer removed";
  }

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json({ types: TYPES, statuses: STATUSES, draft_kinds: DRAFT_KINDS, people: people(store), settings: settingsOf(w), public_url: publicBase(env), today: todayOf(now()),
      money: money(req), mrr: can(req, "billing"), can_approve: canApprove(req), edit: can(req, "partners", "edit"), crm: can(req, "crm"), sales: can(req, "sales"), billing: can(req, "billing") || can(req, "success"),
      customers: (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && !c.archived).map((c) => ({ id: c.id, label: c.store_name })),
      tax_note: TAX_NOTE, agent_level: partners.level() });
  });
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanSettings(req.body || {}, settingsOf(w));
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    w.partners = { ...settingsOf(w), ...out }; store.save();
    res.json(settingsOf(w));
  });
  // Records a person can attribute: CRM stores (search), deals, Billing customers.
  app.get(`${P}/search`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const kind = String(req.query.kind || "store"), q = str(req.query.q, 80).toLowerCase();
    if (kind === "store") { if (!can(req, "crm")) return res.status(403).json({ detail: "Your role can't see the Store CRM." }); return res.json({ rows: (crm?.contacts(w.id) || []).filter((c) => !q || `${c.store_name} ${c.domain}`.toLowerCase().includes(q)).slice(0, 20).map((c) => ({ id: c.id, label: c.store_name || c.domain })) }); }
    if (kind === "deal") { if (!can(req, "sales")) return res.status(403).json({ detail: "Your role can't see Sales." }); return res.json({ rows: store.listDeals(w.id).filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 20).map((d) => ({ id: d.id, label: d.name })) }); }
    res.json({ rows: (store.db.billing_customers || []).filter((c) => c.workspace_id === w.id && !c.archived && (!q || c.store_name.toLowerCase().includes(q))).slice(0, 20).map((c) => ({ id: c.id, label: c.store_name })) });
  });

  // ---- attribution (all partners)
  app.get(`${P}/attribution`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const attr = attribution(store, crm, w.id), names = new Map(store.listOps(COLL.partners, w.id).map((p) => [p.id, p.name]));
    const rows = [["store", attr.stores], ["deal", attr.deals], ["customer", attr.customers]].flatMap(([kind, m]) => [...m].map(([ref_id, a]) => ({ kind, ref_id, ...a, partner: names.get(a.partner_id) || "", label: labelOf(req, w, kind, ref_id) })));
    res.json({ rows: rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))) });
  });
  app.post(`${P}/attributions`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, kind = String(b.kind || ""), ref = str(b.ref_id, 40);
    if (!["store", "deal", "customer"].includes(kind)) return res.status(422).json({ detail: "kind must be store, deal or customer" });
    const code = store.getOps(COLL.codes, w.id, b.code_id) || (b.code ? store.listOps(COLL.codes, w.id).find((c) => c.code === cleanCode(b.code)) : null);
    if (!code) return res.status(422).json({ detail: "Pick one of this workspace's referral codes." });
    const ok = kind === "store" ? can(req, "crm") && crm?.get(w.id, ref) : kind === "deal" ? can(req, "sales") && store.getDeal(w.id, ref) : customerOf(w, ref);
    if (!ok) return res.status(422).json({ detail: `Unknown ${kind} (or your role can't see it).` });
    const p = store.getOps(COLL.partners, w.id, code.partner_id);
    if (kind === "customer" && p?.customer_id === ref) return res.status(422).json({ detail: "A customer can't refer itself." });
    store.db[COLL.attr] = store.db[COLL.attr].filter((a) => !(a.workspace_id === w.id && a.kind === kind && a.ref_id === ref));
    const row = store.addOps(COLL.attr, w.id, { kind, ref_id: ref, code_id: code.id, partner_id: code.partner_id, by: by(req), created_by_id: req.user.id, at: new Date(now()).toISOString() }, false);
    if (p) logPush(p, by(req), `Attributed ${kind} "${String(labelOf(req, w, kind, ref)).slice(0, 60)}" (code ${code.code})`, now());
    store.save();
    res.status(201).json(row);
  });
  app.delete(`${P}/attributions/:aid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(COLL.attr, w.id, req.params.aid); if (!a) return res.status(404).json({ detail: "Attribution not found" });
    store.deleteOps(COLL.attr, w.id, a.id);
    res.json({ ok: true });
  });

  // ---- statements
  app.get(`${P}/statements`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const list = store.listOps(COLL.statements, w.id).sort((a, b) => b.month.localeCompare(a.month) || a.partner_name.localeCompare(b.partner_name));
    res.json({ statements: list.map((s) => stView(req, s)), money: money(req), can_approve: canApprove(req), tax_note: TAX_NOTE });
  });
  // Drafts (or refreshes) the month's statement for each partner with commission lines not yet on a statement.
  app.post(`${P}/statements/generate`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!money(req)) return res.status(403).json({ detail: "Statements need Billing or Finance view." });
    const b = req.body || {}, month = b.month || todayOf(now()).slice(0, 7);
    if (!isMonth(month)) return res.status(422).json({ detail: "month must be YYYY-MM" });
    if (month > todayOf(now()).slice(0, 7)) return res.status(422).json({ detail: "That month hasn't started yet." });
    const attr = attribution(store, crm, w.id), made = [], refreshed = [], skipped = [];
    for (const p of store.listOps(COLL.partners, w.id).filter((x) => !b.partner_id || x.id === String(b.partner_id))) {
      const cur = store.listOps(COLL.statements, w.id).find((s) => s.partner_id === p.id && s.month === month && s.status !== "void");
      if (cur && cur.status !== "draft") { skipped.push({ partner_id: p.id, reason: `Already ${cur.status}` }); continue; }
      const lines = statementLines(store, w, p.id, month, partnerLines(store, crm, w, p, attr), cur?.id);
      if (!lines.length) { if (cur && !cur.sample) { store.deleteOps(COLL.statements, w.id, cur.id); } continue; }
      if (cur) { Object.assign(cur, { lines, total_sar: totalOf(lines), updated_at: new Date(now()).toISOString() }); cur.log.push({ at: new Date(now()).toISOString(), by: by(req), text: "Draft refreshed from Billing" }); refreshed.push(cur.id); continue; }
      const s = store.addOps(COLL.statements, w.id, { partner_id: p.id, partner_name: p.name, month, status: "draft", lines, total_sar: totalOf(lines), currency: "SAR", tax_note: TAX_NOTE, created_by: by(req),
        log: [{ at: new Date(now()).toISOString(), by: by(req), text: "Draft created from Billing payments" }], ...(p.sample ? { sample: true } : {}) }, false);
      made.push(s.id);
    }
    store.save();
    res.status(201).json({ created: made.length, refreshed: refreshed.length, skipped, statements: store.listOps(COLL.statements, w.id).filter((s) => s.month === month).map((s) => stView(req, s)) });
  });
  const getS = (req, res, w) => { const s = store.getOps(COLL.statements, w.id, req.params.sid); if (!s) res.status(404).json({ detail: "Statement not found" }); return s; };
  const denyApprove = (res, what) => res.status(403).json({ detail: `Only the Owner or someone with Finance Edit can ${what} a partner statement.` });
  app.get(`${P}/statements/:sid`, (req, res) => { const w = W(req, res); if (!w) return; const s = getS(req, res, w); if (s) res.json(stView(req, s)); });
  app.post(`${P}/statements/:sid/approve`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return denyApprove(res, "approve");
    const s = getS(req, res, w); if (!s) return;
    if (s.status !== "draft") return res.status(409).json({ detail: `This statement is ${s.status}.` });
    if (!(s.total_sar > 0)) return res.status(422).json({ detail: "A statement of 0 or less can't be approved ([CONFIRM] how refunds carry forward)." });
    const at = new Date(now()).toISOString();
    Object.assign(s, { status: "approved", approved_at: at, approved_by: by(req) }); s.log.push({ at, by: by(req), text: "Approved" });
    store.save(); res.json(stView(req, s));
  });
  app.post(`${P}/statements/:sid/pay`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return denyApprove(res, "mark paid");
    const s = getS(req, res, w); if (!s) return;
    if (s.status !== "approved") return res.status(409).json({ detail: s.status === "paid" ? "Already paid." : "Approve the statement first." });
    const b = req.body || {}, date = b.date || todayOf(now()), reference = str(b.reference, 120);
    if (!isDate(date)) return res.status(422).json({ detail: "date must be YYYY-MM-DD" });
    if (!reference) return res.status(422).json({ detail: "Add the payment reference (bank transfer number)." });
    const at = new Date(now()).toISOString();
    // One Finance expense per statement, never two.
    let e = (store.db.finance_expenses || []).find((x) => x.workspace_id === w.id && x.source === "partners" && x.statement_id === s.id);
    if (!e) e = store.addExpense(w.id, { date, vendor: s.partner_name, category: "marketing", amount_sar: r2(s.total_sar), vat_sar: 0, recurring: "one-off",
      note: `Partner commission statement ${s.month} (ref ${reference}). ${TAX_NOTE}`, source: "partners", statement_id: s.id, reviewed: true, ...(s.sample ? { sample: true } : {}) }, false);
    Object.assign(s, { status: "paid", paid_at: at, paid_date: date, paid_reference: reference, paid_by: by(req), expense_id: e.id }); s.log.push({ at, by: by(req), text: `Paid ${date} (ref ${reference}); posted to Finance` });
    store.save(); res.json(stView(req, s));
  });
  app.post(`${P}/statements/:sid/void`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return denyApprove(res, "void");
    const s = getS(req, res, w); if (!s) return;
    if (!["draft", "approved"].includes(s.status)) return res.status(409).json({ detail: `A ${s.status} statement can't be voided.` });
    const reason = str(req.body?.reason, 300); if (!reason) return res.status(422).json({ detail: "A reason is required." });
    const at = new Date(now()).toISOString();
    Object.assign(s, { status: "void", void_reason: reason, voided_at: at }); s.log.push({ at, by: by(req), text: `Void: ${reason}` });
    store.save(); res.json(stView(req, s));
  });

  // ---- codes
  app.post(`${P}/:id/codes`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    const b = req.body || {};
    let code = b.code ? cleanCode(b.code) : suggestCode(p.name, (c) => codeTaken(store, c));
    if (!code) return res.status(422).json({ detail: "Codes are 3–32 characters: lowercase letters, digits and dashes." });
    if (codeTaken(store, code, p.id)) return res.status(409).json({ detail: "That code is taken. Pick another." });
    const landing = str(b.landing_url, 500);
    if (landing && !hostAllowed(landing, settingsOf(w).allowed_hosts)) return res.status(422).json({ detail: `The landing page must be an https link on ${settingsOf(w).allowed_hosts.join(", ")} (Partners → Settings).` });
    const c = store.addOps(COLL.codes, w.id, { partner_id: p.id, code, landing_url: landing, active: true, created_by: by(req), ...(p.sample ? { sample: true } : {}) }, false);
    logPush(p, by(req), `Referral code ${code} added`, now()); store.save();
    res.status(201).json({ ...c, link: linkOf(c) });
  });
  app.put(`${P}/codes/:cid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = store.getOps(COLL.codes, w.id, req.params.cid); if (!c) return res.status(404).json({ detail: "Code not found" });
    const b = req.body || {}, f = {};
    if (b.active !== undefined) f.active = !!b.active;
    if (b.landing_url !== undefined) { const l = str(b.landing_url, 500); if (l && !hostAllowed(l, settingsOf(w).allowed_hosts)) return res.status(422).json({ detail: "The landing page must be an https link on an allowed host." }); f.landing_url = l; }
    const p = store.getOps(COLL.partners, w.id, c.partner_id);
    if (p && f.active !== undefined && f.active !== (c.active !== false)) logPush(p, by(req), `Code ${c.code} ${f.active ? "switched on" : "switched off"}`, now());
    const out = store.updateOps(COLL.codes, w.id, c.id, f);
    res.json({ ...out, link: linkOf(out) });
  });

  // ---- AI drafts (drafts only)
  app.put(`${P}/drafts/:did`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getOps(COLL.drafts, w.id, req.params.did); if (!d) return res.status(404).json({ detail: "Draft not found" });
    const b = req.body || {};
    res.json(store.updateOps(COLL.drafts, w.id, d.id, { ...(b.subject !== undefined ? { subject: str(b.subject, 200) } : {}), ...(b.body !== undefined ? { body: String(b.body).slice(0, 6000) } : {}), edited_by: by(req) }));
  });
  // "Use" (copied or sent by a person) and "discard" are the outcomes the AI Workforce counts.
  const judge = (d, w, subject, body, kind) => {
    if (d.judged || !d.by_ai) return;
    const same = (subject ?? d.subject) === d.original?.subject && (body ?? d.body) === d.original?.body;
    outcome(w.id, kind === "discard" ? "rejected" : same ? "accepted" : "edited", `${d.kind} draft for "${String(d.partner_name).slice(0, 60)}"`);
    d.judged = true;
  };
  app.post(`${P}/drafts/:did/:action(use|discard)`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getOps(COLL.drafts, w.id, req.params.did); if (!d) return res.status(404).json({ detail: "Draft not found" });
    const b = req.body || {};
    if (b.subject !== undefined) d.subject = str(b.subject, 200);
    if (b.body !== undefined) d.body = String(b.body).slice(0, 6000);
    judge(d, w, d.subject, d.body, req.params.action);
    d.status = req.params.action === "use" ? "used" : "discarded"; d.done_by = by(req); d.done_at = new Date(now()).toISOString();
    store.save(); res.json(d);
  });
  app.post(`${P}/drafts/:did/send`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getOps(COLL.drafts, w.id, req.params.did); if (!d) return res.status(404).json({ detail: "Draft not found" });
    if (!can(req, "crm", "edit")) return res.status(403).json({ detail: "Sending goes through the Store CRM: your role can't send there. Copy the email instead." });
    const p = store.getOps(COLL.partners, w.id, d.partner_id);
    const c = p?.crm_store_id && crm?.get(w.id, p.crm_store_id);
    if (!c || !outreach) return res.status(422).json({ detail: "Link the partner to a Store CRM store to send from the CRM, or copy the email and send it yourself." });
    const subject = str(req.body?.subject ?? d.subject, 200), body = String(req.body?.body ?? d.body).slice(0, 6000);
    if (!body.trim()) return res.status(422).json({ detail: "The email is empty." });
    if (/\[ADD/.test(`${subject} ${body}`)) return res.status(422).json({ detail: "Fill in every [ADD] before sending." });
    const live = outreach.settings(w.id).mode === "live" && !c.sample;
    if (live && !inWindow(new Date(now()), { from: 9, to: 21, skip_friday: true })) return res.status(422).json({ detail: "Emails go out only 09:00–21:00 Riyadh time, not Friday. Send it then." });
    const msg = await outreach.sendOne(w.id, c, { channel: "email", subject, body, by: by(req) });
    Object.assign(d, { subject, body });
    if (!["skipped", "failed"].includes(msg.status)) { judge(d, w, subject, body, "use"); d.status = "used"; }
    d.sent = { status: msg.status, message_id: msg.id, error: msg.error || "", at: new Date(now()).toISOString(), by: by(req) };
    store.save();
    res.status(msg.status === "skipped" || msg.status === "failed" ? 422 : 201).json({ ...(msg.status === "skipped" || msg.status === "failed" ? { detail: msg.error } : {}), message: { id: msg.id, status: msg.status, error: msg.error || "" }, draft: d });
  });

  // ---- partners
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const attr = attribution(store, crm, w.id);
    let list = store.listOps(COLL.partners, w.id);
    if (req.query.status) list = list.filter((p) => p.status === req.query.status);
    if (req.query.type) list = list.filter((p) => p.type === req.query.type);
    const rows = list.map((p) => summary(req, w, p, attr));
    const tot = rows.reduce((a, r) => ({ clicks: a.clicks + r.stats.clicks, leads: a.leads + r.stats.leads, trials: a.trials + r.stats.trials, paying: a.paying + r.stats.paying, mrr_sar: a.mrr_sar + (r.stats.mrr_sar || 0) }), { clicks: 0, leads: 0, trials: 0, paying: 0, mrr_sar: 0 });
    if (!can(req, "billing")) delete tot.mrr_sar;
    const sts = store.listOps(COLL.statements, w.id);
    res.json({ partners: rows, totals: tot, statements: { draft: sts.filter((s) => s.status === "draft").length, approved: sts.filter((s) => s.status === "approved").length }, money: money(req), mrr: can(req, "billing") });
  });
  app.post(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanPartner(req.body || {}, { store });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const bad = checkLinks(req, w, out); if (bad) return res.status(422).json({ detail: bad });
    if (out.agreement && !money(req)) delete out.agreement;
    const at = new Date(now()).toISOString();
    const p = store.addOps(COLL.partners, w.id, { owner_id: req.user.id, city: "", notes: "", customer_id: null, crm_store_id: null, contact: { name: "", email: "", phone: "" },
      agreement: { commission_pct: 0, recurring_months: 0, bounty_sar: 0, tier: "" }, contract: { media_id: null, url: "" }, portal_token: null, ...out, status_at: at, created_by: by(req), created_by_id: req.user.id, log: [] }, false);
    logPush(p, by(req), `Partner added (${p.type}, ${p.status})${req.headers["x-mwiz-via"] === "assistant" ? " via Ask DPA AD" : ""}`, now());
    // Every partner gets a first code (and link) right away.
    if (req.body?.code !== false) { const code = suggestCode(p.name, (c) => codeTaken(store, c)); store.addOps(COLL.codes, w.id, { partner_id: p.id, code, landing_url: "", active: true, created_by: by(req) }, false); }
    store.save();
    res.status(201).json(view(req, w, p));
  });
  app.get(`${P}/:id`, (req, res) => { const w = W(req, res); if (!w) return; const p = getP(req, res, w); if (p) res.json(view(req, w, p)); });
  app.put(`${P}/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    const { out, err } = cleanPartner(req.body || {}, { store, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (out.agreement && !money(req)) return res.status(403).json({ detail: "Changing the agreement needs Billing or Finance view." });
    const bad = checkLinks(req, w, { customer_id: out.customer_id && out.customer_id !== p.customer_id ? out.customer_id : null, crm_store_id: out.crm_store_id && out.crm_store_id !== p.crm_store_id ? out.crm_store_id : null, contract: out.contract?.media_id !== p.contract?.media_id ? out.contract : null });
    if (bad) return res.status(422).json({ detail: bad });
    const lines = changeLines(p, out);
    if (out.status && out.status !== p.status) out.status_at = new Date(now()).toISOString();
    Object.assign(p, out, { updated_at: new Date(now()).toISOString() });
    for (const l of lines) logPush(p, by(req), l, now());
    store.save();
    res.json(view(req, w, p));
  });
  app.delete(`${P}/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    if (store.listOps(COLL.statements, w.id).some((s) => s.partner_id === p.id && ["approved", "paid"].includes(s.status))) return res.status(409).json({ detail: "This partner has approved or paid statements (accounting records): set the status to Ended instead." });
    if (store.listOps(COLL.redemptions, w.id).some((r) => r.partner_id === p.id && r.status !== "removed")) return res.status(409).json({ detail: "Customers redeemed this partner's coupons (they keep their discount and attribution): pause the coupons and set the status to Ended instead." });
    for (const c of [COLL.codes, COLL.clicks, COLL.attr, COLL.statements, COLL.drafts, COLL.coupons, COLL.redemptions]) store.db[c] = store.db[c].filter((x) => !(x.workspace_id === w.id && x.partner_id === p.id));
    store.deleteOps(COLL.partners, w.id, p.id);
    res.json({ ok: true });
  });
  app.post(`${P}/:id/portal`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    p.portal_token = crypto.randomBytes(24).toString("base64url");
    logPush(p, by(req), "Partner portal link created (any older link stops working)", now()); store.save();
    res.status(201).json({ portal_url: `${publicBase(env)}/p/${p.portal_token}` });
  });
  app.delete(`${P}/:id/portal`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    if (p.portal_token) { p.portal_token = null; logPush(p, by(req), "Partner portal link revoked", now()); store.save(); }
    res.json({ ok: true });
  });
  app.post(`${P}/:id/ai/:kind`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = getP(req, res, w); if (!p) return;
    const kind = req.params.kind;
    if (!DRAFT_KIND_IDS.includes(kind)) return res.status(422).json({ detail: `kind must be one of ${DRAFT_KIND_IDS.join(", ")}` });
    const code = codesOf(w, p.id).find((c) => c.active !== false);
    const link = code ? linkOf(code) : "[ADD link]";
    let stats = null, statement = null, month = null;
    if (kind === "update") {
      month = /^\d{4}-\d{2}$/.test(String(req.body?.month || "")) ? req.body.month : todayOf(now()).slice(0, 7);
      const f = funnel(store, crm, w, p.id); const clicks = store.listOps(COLL.clicks, w.id).filter((c) => c.partner_id === p.id && c.day.startsWith(month)).length;
      stats = { ...f, clicks };
      const st = store.listOps(COLL.statements, w.id).filter((s) => s.partner_id === p.id && s.status !== "void").sort((a, b) => b.month.localeCompare(a.month))[0];
      if (st && money(req)) statement = st;
    }
    const facts = draftFacts(w, money(req) ? p : { ...p, agreement: { tier: p.agreement?.tier } }, { link, stats, statement, month });
    const d = await partners.draft(w, kind, facts);
    const row = store.addOps(COLL.drafts, w.id, { partner_id: p.id, partner_name: p.name, kind, subject: d.subject, body: d.body, by_ai: d.by_ai, note: d.note, original: { subject: d.subject, body: d.body }, status: "draft", by: by(req), ...(p.sample ? { sample: true } : {}) });
    res.status(201).json(row);
  });
}
