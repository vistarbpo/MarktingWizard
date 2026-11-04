// HTTP routes for Billing & customers (module "billing" in Teams & roles), the public Moyasar webhook and
// usage API, the printable invoice, and the small hooks Finance and the Command Center use.
import crypto from "node:crypto";
import { CURRENCIES, CUSTOMER_STATUS, CYCLES, METHODS, METHOD_IDS, LINE_KINDS, ZATCA_STATUSES, amountDue, createBilling, dunningPrompt, dunningState, explainPrompt,
  mrrMetrics, overage, parsePayouts, planDef, planTable, proration, r2, reconcilePayouts, toSar } from "./billing.js";
import { createMoyasar, moyasarConfig, parseWebhook, verifyWebhook } from "./moyasar.js";
import { createZatca, decodeTlv, invoiceHash, ublXml, zatcaConfig } from "./zatca.js";
import { qrSvg } from "./qr.js";
import { makeSenders } from "./outreach.js";
import { ONBOARDING_STEPS, normDomain, normEmail, riyadhDay } from "./crm.js";
import { PLATFORMS } from "./platforms.js";
import { planFor } from "./sales.js";
import { LLMError } from "./engine.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const VAT_NUMBER = /^3\d{13}3$/; // ZATCA: 15 digits, first and last are 3 (verify with your accountant)

// Wires the billing engine to the real gateway, ZATCA adapter and the CRM's email sender; tests pass their own.
export function createBillingService({ store, crm, outreach, env = process.env, fetchImpl = (...a) => fetch(...a), senders = null, log = console, now }) {
  const gateway = createMoyasar({ cfg: moyasarConfig(env), fetchImpl });
  const zatca = createZatca({ cfg: zatcaConfig(env), fetchImpl });
  const billing = createBilling({ store, crm, senders: senders || makeSenders(outreach.cfg), emailReady: () => !!(senders || outreach.cfg.email.ready), gateway, zatca, log, ...(now ? { now } : {}) });
  billing.gateway = gateway; billing.zatca = zatca; billing.usageToken = env.BILLING_USAGE_TOKEN || "";
  billing.emailReadyNow = () => !!(senders || outreach.cfg.email.ready);
  return billing;
}

export function mountBillingPublic(app, { store, billing }) {
  // Moyasar webhook: payment_paid marks the invoice paid; payment_failed starts dunning.
  app.post("/hooks/moyasar", async (req, res) => {
    if (!verifyWebhook(req.body, billing.gateway.cfg.webhook_secret)) return res.status(401).json({ detail: "Bad webhook secret" });
    try { const r = await billing.webhook(parseWebhook(req.body)); res.json({ ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) }); }
    catch (e) { console.error("[billing] moyasar webhook:", e?.message); res.status(500).json({ detail: "Could not process the event" }); }
  });
  // Usage API: the DPA AD product posts renders per store per month. Authorization: Bearer BILLING_USAGE_TOKEN.
  app.post("/hooks/billing/usage", (req, res) => {
    if (!billing.usageToken) return res.status(403).json({ detail: "The usage API is off: set BILLING_USAGE_TOKEN" });
    const got = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")), want = Buffer.from(billing.usageToken);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ detail: "Bad token" });
    const b = req.body || {}, dom = normDomain(b.domain);
    const c = store.db.billing_customers.find((x) => !x.archived && ((b.customer_id && x.id === String(b.customer_id)) || (dom && normDomain(x.domain) === dom)) && (!b.workspace_id || x.workspace_id === String(b.workspace_id)));
    if (!c) return res.status(404).json({ detail: "No customer with that id or domain" });
    const month = /^\d{4}-\d{2}$/.test(String(b.month || "")) ? b.month : riyadhDay().slice(0, 7);
    const n = Number(b.renders);
    if (!(n >= 0)) return res.status(422).json({ detail: "renders must be a number" });
    const u = billing.setUsage(store.getWorkspace(c.workspace_id), c, month, n, { mode: b.mode === "add" ? "add" : "set", source: "api" });
    res.json({ customer_id: c.id, month, renders: u.renders });
  });
  app.get("/billing/thanks", (req, res) => res.send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>شكراً · Thank you</title><style>body{font-family:system-ui,Tahoma,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f6f6f4;color:#111}div{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:32px;max-width:440px;text-align:center}p{color:#555}</style></head><body><div><h2>شكراً لكم</h2><p>استلمنا عملية الدفع، وبتوصلكم رسالة التأكيد.</p><p dir="ltr">Thank you. We received your payment; a confirmation will follow.</p></div></body></html>`));
}

// ---- printable invoice (Arabic + English), with the ZATCA phase 1 QR
const num = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur) => `${cur} ${num(n)}`;
// The discount reason in Arabic for the printed invoice ("Coupon RAMADAN-20; Account credit SAR 10.00").
// Escaped first; Latin codes and amounts are isolated left-to-right inside the Arabic label so they never break apart.
const arReason = (r) => esc(r).replace(/\bCoupon ([A-Z0-9-]+)/g, "كوبون <bdi dir=\"ltr\" class=\"nw\">$1</bdi>").replace(/\bAccount credit ([A-Z]{3} [\d.,]+)/g, "رصيد الحساب <bdi dir=\"ltr\" class=\"nw\">$1</bdi>");
const dayBefore = (d) => new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
export function invoiceHtml(inv, c, w, billing) {
  const s = billing.settings(w), seller = inv.seller || billing.sellerOf(w), buyer = inv.buyer || billing.buyerOf(c);
  const credit = inv.kind === "credit_note", vat = inv.vat_rate > 0;
  const title = credit ? ["إشعار دائن", "Credit note"] : !vat ? ["فاتورة", "Invoice"] : inv.zatca_type === "standard" ? ["فاتورة ضريبية", "Tax invoice"] : ["فاتورة ضريبية مبسطة", "Simplified tax invoice"];
  const usd = inv.currency !== "SAR", t = inv.totals, ts = inv.totals_sar;
  // With a document discount (coupon, account credit) VAT is worked out on the total after it, so per-line VAT and
  // totals would not add up: lines then show their net only and the summary carries the discount and VAT.
  const lineTotals = !(t.discount > 0);
  const addr = (a = {}) => [a.building && a.street ? `${a.building} ${a.street}` : a.street, a.district, a.city, a.postal_code, a.country].filter(Boolean).map(esc).join("، ");
  const row = (ar, en, v) => `<tr><th><span lang="ar">${ar}</span><span>${en}</span></th><td dir="auto">${v}</td></tr>`;
  const qr = inv.zatca?.qr ? qrSvg(inv.zatca.qr, { px: 150, label: "ZATCA QR" }) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv.number || "Draft")} · ${esc(title[1])}</title>
<style>
*{box-sizing:border-box}body{font-family:"Inter",Tahoma,Arial,sans-serif;color:#111;margin:0;background:#f4f4f2;font-size:13px;line-height:1.45}
.page{max-width:820px;margin:24px auto;background:#fff;padding:36px 40px;border:1px solid #e3e3e0;border-radius:10px}
h1{font-size:22px;margin:0}h1 span{display:block;font-size:20px}.muted{color:#666}.top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}.box{border:1px solid #e3e3e0;border-radius:8px;padding:12px 14px}.box h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666}
table{width:100%;border-collapse:collapse}.meta th,.sum th{text-align:start;font-weight:500;color:#555;padding:4px 8px 4px 0;width:46%}.meta td,.sum td{padding:4px 0;text-align:end;font-variant-numeric:tabular-nums}
th span[lang=ar]{display:block;font-family:Tahoma,Arial,sans-serif;unicode-bidi:plaintext;text-align:left}
.lines-wrap{overflow-x:auto;margin-top:8px}.lines{font-size:12px}.lines th{background:#f4f4f2;text-align:start;padding:8px 6px;font-weight:600;border-bottom:1px solid #ddd;font-size:11px}.lines td{padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top}.lines td:first-child{min-width:200px}.lines .n{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums}.lines th.n{white-space:normal}
.bottom{display:flex;gap:24px;justify-content:space-between;align-items:flex-start;margin-top:20px;flex-wrap:wrap}.sum{max-width:380px;margin-inline-start:auto}.sum tr.total td,.sum tr.total th{font-weight:700;font-size:15px;border-top:2px solid #111;padding-top:8px;color:#111}
.nw{white-space:nowrap}.stamp{display:inline-block;border:2px solid #b00;color:#b00;padding:2px 10px;border-radius:6px;font-weight:700;transform:rotate(-4deg)}.paid{border-color:#0a7a3e;color:#0a7a3e}
.actions{max-width:820px;margin:16px auto 0;display:flex;gap:8px;justify-content:flex-end;padding:0 16px}.actions button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}
@media (max-width:640px){.page{padding:20px 16px;margin:8px;border-radius:0}.parties{grid-template-columns:1fr}}
@media print{body{background:#fff}.page{border:0;margin:0;max-width:none;padding:0}.actions{display:none}}
</style></head><body>
<div class="actions"><button onclick="window.print()">Print / Save as PDF · طباعة</button></div>
<div class="page">
  <div class="top">
    <div><h1>${esc(title[1])}<span lang="ar">${esc(title[0])}</span></h1>
      <div class="muted" style="margin-top:6px">${esc(inv.number || "DRAFT · مسودة")}${inv.status === "void" ? ` <span class="stamp">VOID · ملغاة</span>` : inv.status === "paid" ? ` <span class="stamp paid">PAID · مدفوعة</span>` : ""}</div>
      ${credit ? `<div style="margin-top:6px">For invoice · للفاتورة <b>${esc(inv.credit_of_number)}</b>: <span dir="auto">${esc(inv.credit_reason)}</span></div>` : ""}</div>
    ${qr ? `<div style="text-align:center">${qr}<div class="muted" style="font-size:11px">ZATCA · هيئة الزكاة والضريبة والجمارك</div></div>` : ""}
  </div>
  <div class="parties">
    <div class="box"><h3>Seller · البائع</h3><b dir="auto">${esc(seller.name)}</b>${seller.name_ar ? `<div dir="rtl" lang="ar">${esc(seller.name_ar)}</div>` : ""}
      <div class="muted" dir="auto">${addr(seller.address)}</div>
      ${seller.vat_number ? `<div>VAT no. · الرقم الضريبي: <b>${esc(seller.vat_number)}</b></div>` : ""}${seller.cr_number ? `<div>CR · السجل التجاري: ${esc(seller.cr_number)}</div>` : ""}</div>
    <div class="box"><h3>Buyer · المشتري</h3><b dir="auto">${esc(buyer.name)}</b>${buyer.domain ? `<div class="muted">${esc(buyer.domain)}</div>` : ""}
      <div class="muted" dir="auto">${addr(buyer.address)}</div>
      ${buyer.vat_number ? `<div>VAT no. · الرقم الضريبي: <b>${esc(buyer.vat_number)}</b></div>` : ""}</div>
  </div>
  <table class="meta">
    ${row("تاريخ الإصدار", "Issue date", esc(inv.issue_date || "–"))}
    ${row("تاريخ التوريد", "Supply date", esc(inv.supply_date || inv.period_start || "–"))}
    ${credit ? "" : row("تاريخ الاستحقاق", "Due date", esc(inv.due_date || "–"))}
    ${inv.period_start && inv.period_end ? row("فترة الاشتراك", "Period", `${esc(inv.period_start)} → ${esc(dayBefore(inv.period_end))}`) : ""}
    ${row("العملة", "Currency", esc(inv.currency))}
  </table>
  <div class="lines-wrap"><table class="lines"><thead><tr><th>Description · الوصف</th><th class="n">Qty · الكمية</th><th class="n">Unit price · سعر الوحدة</th><th class="n">Discount · خصم</th><th class="n">${lineTotals ? "Taxable · الخاضع للضريبة" : "Net · الصافي"}</th>${lineTotals && vat ? `<th class="n">VAT ${Math.round(inv.vat_rate * 100)}% · الضريبة</th>` : ""}${lineTotals ? `<th class="n">Total (${esc(inv.currency)}) · الإجمالي</th>` : ""}</tr></thead><tbody>
    ${inv.lines.map((l) => { const lv = r2(l.net * inv.vat_rate); return `<tr><td dir="auto">${esc(l.description)}</td><td class="n">${l.qty}</td><td class="n">${num(l.unit_price)}</td><td class="n">${l.discount ? num(l.discount) : "–"}</td><td class="n">${num(l.net)}</td>${lineTotals && vat ? `<td class="n">${num(lv)}</td>` : ""}${lineTotals ? `<td class="n">${num(l.net + lv)}</td>` : ""}</tr>`; }).join("")}
  </tbody></table></div>
  <div class="bottom">
    <div style="max-width:340px">${s.bank_details && !credit ? `<div class="box"><h3>Bank transfer · تحويل بنكي</h3><div dir="auto" style="white-space:pre-wrap">${esc(s.bank_details)}</div></div>` : ""}
      ${inv.payment_link?.url && inv.status === "issued" ? `<p>Pay by card · ادفع بالبطاقة: <a href="${esc(inv.payment_link.url)}">${esc(inv.payment_link.url)}</a></p>` : ""}
      ${!vat ? `<p class="muted">Not VAT-registered: no VAT charged · المنشأة غير مسجلة في ضريبة القيمة المضافة</p>` : ""}</div>
    <table class="sum">
      ${row("الإجمالي قبل الخصم", "Subtotal", money(t.subtotal, inv.currency))}
      ${t.discount ? row(`الخصم${inv.discount_reason ? ` <bdi dir="rtl">(${arReason(inv.discount_reason)})</bdi>` : ""}`, `Discount${inv.discount_reason ? ` (${esc(inv.discount_reason)})` : ""}`, "− " + money(t.discount, inv.currency)) : ""}
      ${row("الإجمالي الخاضع للضريبة", "Total excl. VAT", money(t.taxable, inv.currency))}
      ${vat ? row(`ضريبة القيمة المضافة ${Math.round(inv.vat_rate * 100)}%`, `VAT ${Math.round(inv.vat_rate * 100)}%`, money(t.vat, inv.currency)) : ""}
      <tr class="total"><th><span lang="ar">الإجمالي شامل الضريبة</span><span>Total${vat ? " incl. VAT" : ""}</span></th><td>${money(t.total, inv.currency)}</td></tr>
      ${usd && vat ? row("الضريبة بالريال", "VAT in SAR", money(ts.vat, "SAR")) + row("الإجمالي بالريال", "Total in SAR", money(ts.total, "SAR")) : ""}
      ${!credit && (inv.paid_amount || inv.credited_total) ? row("المدفوع", "Paid", money(inv.paid_amount, inv.currency)) + (inv.credited_total ? row("إشعارات دائنة", "Credited", money(inv.credited_total, inv.currency)) : "") + row("المتبقي", "Amount due", money(amountDue(inv), inv.currency)) : ""}
    </table>
  </div>
  ${inv.zatca ? `<p class="muted" style="font-size:10px;margin-top:24px;word-break:break-all">UUID ${esc(inv.zatca.uuid)} · ICV ${inv.zatca.icv}</p>` : ""}
</div></body></html>`;
}

// ---- Command Center hook: prefer billed MRR when customers exist, and add billing's needs.
export function billingCommandHook(d, billing, w, canBilling) {
  if (!canBilling) return d;
  const b = billing.command(w);
  if (!b) return d;
  const mrrUsd = Math.round(b.mrr_usd);
  d.billing = { customers: b.customers, paying: b.paying, trials: b.trials, mrr_sar: b.mrr_sar };
  if (b.paying) {
    d.revenue = { ...d.revenue, paying_mrr: mrrUsd, paying: b.paying, source: "billing" };
    const arr = mrrUsd * 12;
    d.goal = { ...d.goal, arr, pct_of_goal: arr / d.goal.arr_goal, next_milestone: d.goal.milestones.find((m) => m > arr) || d.goal.arr_goal };
  }
  d.needs = [...b.needs.map((n) => ({ module: "Billing", route: "billing", param: null, title: "Billing", text: n.text })), ...d.needs];
  return d;
}

export function mountBilling(app, { store, billing, provider, workforce = null, crm = null, coupons = null }) {
  const P = "/api/workspaces/:ws/billing";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const fail = (res, e) => { if (e?.status) return res.status(e.status).json({ detail: e.message }); console.error("[billing]", e); res.status(500).json({ detail: "Something went wrong" }); };
  const C = (req, res, w) => { const c = billing.getCustomer(w.id, req.params.id); if (!c) res.status(404).json({ detail: "Customer not found" }); return c; };
  const INV = (req, res, w) => { const i = billing.getInvoice(w.id, req.params.id); if (!i) res.status(404).json({ detail: "Invoice not found" }); return i; };
  const custName = (w, id) => store.getOps("billing_customers", w.id, id)?.store_name || "";

  const cleanAddress = (a = {}) => Object.fromEntries(["street", "building", "district", "city", "postal_code", "country"].map((k) => [k, str(a?.[k], k === "country" ? 2 : 120) || (k === "country" ? "SA" : "")]));
  const cleanCustomer = (b, partial) => {
    const o = {}, err = [];
    for (const k of ["store_name", "owner_name", "legal_name", "owner_phone", "app_store_id"]) if (b[k] !== undefined) o[k] = str(b[k], 160);
    if (b.domain !== undefined) o.domain = normDomain(b.domain);
    if (b.owner_email !== undefined) { o.owner_email = normEmail(b.owner_email); if (b.owner_email && !o.owner_email) err.push("owner_email isn't a valid email"); }
    if (b.platform !== undefined) o.platform = PLATFORMS.includes(b.platform) ? b.platform : "Other";
    if (b.vat_number !== undefined) { o.vat_number = str(b.vat_number, 15).replace(/\s/g, ""); if (o.vat_number && !VAT_NUMBER.test(o.vat_number)) err.push("VAT number must be 15 digits starting and ending with 3"); }
    if (b.billing_address !== undefined) o.billing_address = cleanAddress(b.billing_address);
    if (b.crm_contact_id !== undefined) o.crm_contact_id = b.crm_contact_id ? String(b.crm_contact_id) : null;
    if (b.deal_id !== undefined) o.deal_id = b.deal_id ? String(b.deal_id) : null;
    if (b.currency !== undefined) { if (!CURRENCIES.includes(b.currency)) err.push("currency must be SAR or USD"); else o.currency = b.currency; }
    if (!partial) {
      if (b.plan !== undefined) { if (!planDef(b.plan)) err.push("unknown plan"); else o.plan = b.plan; }
      if (b.cycle !== undefined) { if (!CYCLES.includes(b.cycle)) err.push("cycle must be monthly or yearly"); else o.cycle = b.cycle; }
      if (b.status !== undefined) { if (!["trial", "active"].includes(b.status)) err.push("a new customer starts as trial or active"); else o.status = b.status; }
      for (const k of ["start_date", "trial_end"]) if (b[k]) { if (!isoDate(b[k])) err.push(`${k} must be YYYY-MM-DD`); else o[k] = b[k]; }
      if (b.already_billed !== undefined) o.already_billed = !!b.already_billed;
      if (!o.store_name) err.push("store_name is required");
    } else if (b.cycle !== undefined) { if (!CYCLES.includes(b.cycle)) err.push("cycle must be monthly or yearly"); else o.next_cycle = b.cycle; }
    if (b.custom_price_usd !== undefined) { const n = b.custom_price_usd === null || b.custom_price_usd === "" ? null : Number(b.custom_price_usd); if (n !== null && !(n >= planDef("Enterprise").usd)) err.push(`Enterprise custom price must be at least $${planDef("Enterprise").usd}`); else o.custom_price_usd = n; }
    if (partial && b.store_name !== undefined && !o.store_name) err.push("store_name cannot be empty");
    return { o, err };
  };
  const linked = (w) => { const cs = billing.customers(w.id); return { deals: new Set(cs.map((c) => c.deal_id).filter(Boolean)), contacts: new Set(cs.map((c) => c.crm_contact_id).filter(Boolean)) }; };
  const suggestions = (w) => {
    const l = linked(w);
    const deals = store.listDeals(w.id).filter((d) => d.stage === "paying" && !l.deals.has(d.id)).map((d) => ({ kind: "deal", id: d.id, name: d.name, plan: planFor(d.skus).name, platform: d.platform, sample: !!d.sample }));
    const stores = crm ? crm.contacts(w.id).filter((c) => ["onboarding", "active"].includes(c.stage) && !l.contacts.has(c.id) && !(c.deal_id && l.deals.has(c.deal_id))).slice(0, 50)
      .map((c) => ({ kind: "crm", id: c.id, name: c.store_name, plan: planFor(c.products).name, platform: c.platform, stage: c.stage, sample: !!c.sample })) : [];
    return [...deals, ...stores];
  };
  const runAfter = async (w) => { try { await billing.runWorkspace(w); } catch (e) { console.error("[billing] run:", e?.message); } };

  app.get("/api/billing/meta", (req, res) => res.json({
    statuses: CUSTOMER_STATUS, cycles: CYCLES, currencies: CURRENCIES, methods: METHODS, line_kinds: LINE_KINDS, plans: planTable(), zatca_statuses: ZATCA_STATUSES, onboarding: ONBOARDING_STEPS, platforms: PLATFORMS,
    connections: { moyasar: billing.gateway.cfg.ready, moyasar_webhook: !!billing.gateway.cfg.webhook_secret, zatca_env: billing.zatca.cfg.env, zatca_csid: !!billing.zatca.cfg.csid, usage_api: !!billing.usageToken, email: billing.emailReadyNow?.() ?? null },
  }));

  // ---- overview
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const today = riyadhDay(), s = billing.settings(w), cs = billing.customers(w.id);
    const invs = billing.invoices(w.id);
    const overdue = invs.filter((i) => i.kind === "invoice" && i.status === "issued" && dunningState(i, today, s).overdue);
    res.json({ settings: s, vat_registered: !!w.finance?.vat_registered, metrics: mrrMetrics(cs, today, 12), needs: billing.needs(w),
      counts: Object.fromEntries(CUSTOMER_STATUS.map((x) => [x.id, cs.filter((c) => c.status === x.id).length])),
      invoices: { draft: invs.filter((i) => i.status === "draft").length, open: invs.filter((i) => i.kind === "invoice" && i.status === "issued").length, overdue: overdue.length,
        overdue_sar: r2(overdue.reduce((a, i) => a + toSar(amountDue(i), i.currency), 0)), paid_30d_sar: r2(store.listOps("billing_payments", w.id).filter((p) => p.status === "paid" && p.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).reduce((a, p) => a + p.amount_sar, 0)) },
      customers: cs.map((c) => billing.enrich(w, c, today)), suggestions: suggestions(w), drafts: store.listOps("billing_drafts", w.id).filter((d) => d.status === "draft").length });
  });

  // ---- customers
  app.post(`${P}/customers`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const { o, err } = cleanCustomer(req.body || {}, false);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    // A coupon typed in when the customer is created: checked first (a refusal stops the creation), redeemed before
    // the first invoice is drafted so it is discounted.
    const code = str(req.body?.coupon, 40);
    let cp = null;
    if (code && coupons) { const r = coupons.check(w, o, code); if (!r.ok) return res.status(422).json({ detail: `Coupon: ${r.reason}`, reason_code: r.reason_code }); cp = r.coupon; }
    const c = billing.addCustomer(w, o, by(req));
    if (cp) { coupons.apply(w, c, cp, { by: by(req), source: "billing" }); billing.event(c, "coupon", `Coupon ${cp.code}`, by(req)); res.locals.audit = `added customer ${c.store_name.slice(0, 60)} with coupon ${cp.code}`; }
    await runAfter(w);
    res.status(201).json({ ...billing.enrich(w, c), coupon: coupons?.summary(w, c) || null });
  });
  // From a Sales deal or a CRM store: a typed coupon must be valid; otherwise the store's own coupon_code (typed at
  // signup, stored by the lead hook) is redeemed when it still qualifies, and the reason is returned when it doesn't.
  const fromSource = async (req, res, w, base) => {
    const stored = base.coupon_code || ""; delete base.coupon_code;
    const { o, err } = cleanCustomer({ ...base, ...(req.body || {}) }, false);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const typed = str(req.body?.coupon, 40), pseudo = { ...o, sample: !!base.sample };
    let cp = null, note = "";
    if (typed && coupons) { const r = coupons.check(w, pseudo, typed); if (!r.ok) return res.status(422).json({ detail: `Coupon: ${r.reason}`, reason_code: r.reason_code }); cp = r.coupon; }
    else if (stored && coupons) { const r = coupons.check(w, pseudo, stored); if (r.ok) cp = r.coupon; else note = `The store's coupon ${stored} wasn't applied: ${r.reason}`; }
    const c = billing.addCustomer(w, o, by(req));
    if (base.sample) { c.sample = true; store.save(); }
    if (cp) { coupons.apply(w, c, cp, { by: by(req), source: typed ? "billing" : "signup (lead hook)" }); billing.event(c, "coupon", `Coupon ${cp.code}`, by(req)); res.locals.audit = `added customer ${c.store_name.slice(0, 60)} with coupon ${cp.code}`; }
    await runAfter(w);
    res.status(201).json({ ...billing.enrich(w, c), coupon: coupons?.summary(w, c) || null, ...(note ? { coupon_note: note } : {}) });
  };
  app.post(`${P}/customers/from-deal/:dealId`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getDeal(w.id, req.params.dealId);
    if (!d) return res.status(404).json({ detail: "Deal not found" });
    if (linked(w).deals.has(d.id)) return res.status(409).json({ detail: "This deal already has a customer" });
    const ct = crm ? crm.contacts(w.id).find((x) => x.deal_id === d.id) : null;
    await fromSource(req, res, w, { store_name: d.name, platform: d.platform, owner_name: d.contact_name || ct?.owner_name || "", owner_email: normEmail(d.contact_email) || ct?.email || "", owner_phone: d.contact_phone || "",
      plan: planFor(d.skus).name, domain: ct?.domain || "", crm_contact_id: ct?.id || null, deal_id: d.id, status: d.stage === "trial" ? "trial" : "active", sample: !!d.sample, coupon_code: ct?.coupon_code || "" });
  });
  app.post(`${P}/customers/from-crm/:contactId`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const ct = crm?.get(w.id, req.params.contactId);
    if (!ct) return res.status(404).json({ detail: "Store not found" });
    if (linked(w).contacts.has(ct.id)) return res.status(409).json({ detail: "This store already has a customer" });
    await fromSource(req, res, w, { store_name: ct.store_name, platform: ct.platform, owner_name: ct.owner_name || "", owner_email: ct.email || "", owner_phone: ct.phone ? "+" + ct.phone : "",
      plan: planFor(ct.products).name, domain: ct.domain || "", crm_contact_id: ct.id, deal_id: ct.deal_id || null, status: ct.stage === "onboarding" ? "trial" : "active", sample: !!ct.sample, coupon_code: ct.coupon_code || "" });
  });
  app.get(`${P}/customers/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const today = riyadhDay(), month = today.slice(0, 7);
    const invs = billing.invoices(w.id).filter((i) => i.customer_id === c.id);
    const pays = store.listOps("billing_payments", w.id).filter((p) => p.customer_id === c.id).sort((a, b) => b.date.localeCompare(a.date));
    const usage = billing.usageOf(w.id, c.id), u = usage.find((x) => x.month === month);
    const contact = crm && c.crm_contact_id ? crm.get(w.id, c.crm_contact_id) : null;
    const deal = c.deal_id ? store.getDeal(w.id, c.deal_id) : null;
    const tickets = billing.ticketsFor(w.id, c).map((t) => ({ id: t.id, status: t.status, channel: t.channel, customer_name: t.customer_name, category: t.category, updated_at: t.updated_at, last: t.messages.at(-1)?.text?.slice(0, 160) || "" }));
    const timeline = [
      ...(c.events || []).map((e) => ({ at: e.at, date: e.date, kind: "event", type: e.type, text: e.note, by: e.by })),
      ...(c.notes || []).map((n) => ({ at: n.at, date: n.at.slice(0, 10), kind: "note", text: n.text, by: n.by })),
      ...invs.filter((i) => i.number).map((i) => ({ at: i.issued_at, date: i.issue_date, kind: "invoice", text: `${i.kind === "credit_note" ? "Credit note" : "Invoice"} ${i.number}: ${i.currency} ${i.totals.total.toFixed(2)}`, invoice_id: i.id })),
      ...pays.map((p) => ({ at: p.created_at, date: p.date, kind: "payment", text: `${p.status === "failed" ? "Failed payment" : "Payment"} ${p.currency} ${p.amount.toFixed(2)} (${p.method})`, by: p.by })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    res.json({ customer: billing.enrich(w, c, today), invoices: invs.map((i) => ({ ...i, due: amountDue(i), dunning: i.status === "issued" ? dunningState(i, today, billing.settings(w)) : null })), payments: pays, usage,
      usage_month: { month, renders: u?.renders || 0, ...overage(c.plan, u?.renders || 0, billing.pricingOf(w)) }, tickets,
      onboarding: contact ? { steps: ONBOARDING_STEPS, done: contact.onboarding || {}, contact_id: contact.id, stage: contact.stage } : null,
      contact: contact ? { id: contact.id, store_name: contact.store_name, stage: contact.stage, email: contact.email, last_reply_at: contact.last_reply_at } : null,
      deal: deal ? { id: deal.id, name: deal.name, stage: deal.stage } : null, timeline, coupon: coupons?.summary(w, c) || null });
  });
  app.put(`${P}/customers/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const { o, err } = cleanCustomer(req.body || {}, true);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (o.next_cycle === c.cycle) { delete o.next_cycle; o.next_cycle = null; }
    res.json(billing.enrich(w, billing.updateCustomer(w, c, o)));
  });
  app.delete(`${P}/customers/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    // Customers with issued documents are kept for the records (archived); others are removed.
    if (store.db.billing_invoices.some((i) => i.customer_id === c.id && i.number)) { billing.updateCustomer(w, c, { archived: true, status: "cancelled" }); return res.json({ archived: true }); }
    store.deleteOps("billing_customers", w.id, c.id);
    res.status(204).end();
  });
  app.post(`${P}/customers/:id/plan/preview`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    if (!planDef(req.body?.plan)) return res.status(422).json({ detail: "Pick a plan" });
    res.json(proration(c, req.body.plan, riyadhDay(), req.body.custom_price_usd ?? null));
  });
  app.post(`${P}/customers/:id/plan`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    if (!req.body?.confirm) return res.status(422).json({ detail: "Check the proration preview, then confirm" });
    try { const r = await billing.changePlan(w, c, req.body.plan, { custom_price_usd: req.body.custom_price_usd ?? null, by: by(req) }); res.json({ ...r, customer: billing.enrich(w, c) }); } catch (e) { fail(res, e); }
  });
  for (const action of ["pause", "resume", "cancel", "reactivate"]) app.post(`${P}/customers/:id/${action}`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    try { billing.setStatus(w, c, action, { by: by(req), at_period_end: req.body?.at_period_end !== false }); if (["resume", "reactivate"].includes(action)) await runAfter(w); res.json(billing.enrich(w, c)); } catch (e) { fail(res, e); }
  });
  app.post(`${P}/customers/:id/notes`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const text = str(req.body?.text, 2000);
    if (!text) return res.status(422).json({ detail: "Write a note first" });
    c.notes = [...(c.notes || []), { at: new Date().toISOString(), by: by(req), text }];
    store.save();
    res.status(201).json(c.notes.at(-1));
  });
  app.post(`${P}/customers/:id/usage`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || "")) ? req.body.month : riyadhDay().slice(0, 7), n = Number(req.body?.renders);
    if (!(n >= 0)) return res.status(422).json({ detail: "renders must be a number" });
    res.json(billing.setUsage(w, c, month, n, { mode: req.body?.mode === "add" ? "add" : "set", source: "manual" }));
  });

  // ---- invoices
  const cleanLines = (lines) => {
    if (!Array.isArray(lines) || !lines.length) return { err: "Add at least one line" };
    const out = [];
    for (const l of lines.slice(0, 50)) {
      const qty = Number(l.qty ?? 1), price = Number(l.unit_price), disc = Number(l.discount || 0);
      if (!str(l.description)) return { err: "Every line needs a description" };
      if (!(qty > 0) || !(price >= 0) || !(disc >= 0) || disc > qty * price) return { err: "Quantities, prices and discounts must be positive (discount up to the line amount)" };
      out.push({ kind: LINE_KINDS.includes(l.kind) ? l.kind : "other", description: str(l.description, 300), qty, unit_price: r2(price), discount: r2(disc) });
    }
    return { lines: out };
  };
  const invOut = (w, i) => ({ ...i, customer: custName(w, i.customer_id), due: amountDue(i), dunning: i.status === "issued" && i.kind === "invoice" ? dunningState(i, riyadhDay(), billing.settings(w)) : null });
  app.get(`${P}/invoices`, (req, res) => {
    const w = W(req, res); if (!w) return;
    let list = billing.invoices(w.id);
    if (req.query.status) list = list.filter((i) => i.status === req.query.status);
    if (req.query.customer) list = list.filter((i) => i.customer_id === String(req.query.customer));
    res.json(list.slice(0, 1000).map((i) => invOut(w, i)));
  });
  app.post(`${P}/customers/:id/invoices`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = C(req, res, w); if (!c) return;
    const { lines, err } = cleanLines(req.body?.lines);
    if (err) return res.status(422).json({ detail: err });
    const disc = Number(req.body?.discount || 0);
    if (!(disc >= 0)) return res.status(422).json({ detail: "discount must be positive" });
    const inv = billing.draft(w, c, { lines, discount: disc, discount_reason: str(req.body?.discount_reason, 120), note: str(req.body?.note, 300), by: by(req),
      due_days: req.body?.due_days !== undefined ? Math.max(0, Math.min(90, Math.round(Number(req.body.due_days) || 0))) : null });
    if (req.body?.issue) { try { const r = await billing.issue(w, inv, { by: by(req) }); return res.status(201).json({ ...invOut(w, r.invoice), warnings: r.warnings }); } catch (e) { return fail(res, e); } }
    res.status(201).json(invOut(w, inv));
  });
  app.get(`${P}/invoices/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    res.json({ ...invOut(w, i), credits: billing.listCredits(i).map((x) => ({ id: x.id, number: x.number, total: x.totals.total, reason: x.credit_reason })), payments: store.listOps("billing_payments", w.id).filter((p) => p.invoice_id === i.id),
      qr_fields: i.zatca?.qr ? decodeTlv(i.zatca.qr) : null });
  });
  app.put(`${P}/invoices/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (i.status !== "draft") return res.status(409).json({ detail: "Issued invoices are never edited. Issue a credit note to correct one." });
    if (req.body?.lines !== undefined) { const { lines, err } = cleanLines(req.body.lines); if (err) return res.status(422).json({ detail: err }); i.lines = lines; }
    if (req.body?.discount !== undefined) { const d = Number(req.body.discount); if (!(d >= 0)) return res.status(422).json({ detail: "discount must be positive" }); i.discount = r2(d); }
    if (req.body?.discount_reason !== undefined) i.discount_reason = str(req.body.discount_reason, 120);
    if (req.body?.note !== undefined) i.note = str(req.body.note, 300);
    i.vat_rate = billing.vatRate(w);
    billing.recalc(w, i); i.updated_at = new Date().toISOString(); store.save();
    res.json(invOut(w, i));
  });
  app.delete(`${P}/invoices/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (i.status !== "draft") return res.status(409).json({ detail: "Only drafts can be deleted. Void or credit an issued invoice instead." });
    store.deleteOps("billing_invoices", w.id, i.id);
    res.status(204).end();
  });
  app.post(`${P}/invoices/:id/issue`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    try { const r = await billing.issue(w, i, { by: by(req) }); res.json({ ...invOut(w, r.invoice), warnings: r.warnings }); } catch (e) { fail(res, e); }
  });
  app.post(`${P}/invoices/:id/void`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    try { const r = await billing.voidInvoice(w, i, req.body?.reason, by(req)); res.json({ invoice: invOut(w, r.invoice), credit: r.credit }); } catch (e) { fail(res, e); }
  });
  app.post(`${P}/invoices/:id/credit`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    try { const r = await billing.creditNote(w, i, { amount: req.body?.amount === undefined || req.body?.amount === "" ? undefined : Number(req.body.amount), reason: req.body?.reason }, by(req)); res.status(201).json({ credit: r.credit, invoice: invOut(w, r.invoice) }); } catch (e) { fail(res, e); }
  });
  app.post(`${P}/invoices/:id/payments`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    const b = req.body || {};
    if (b.method && !METHOD_IDS.includes(b.method)) return res.status(422).json({ detail: "Unknown payment method" });
    try { const r = billing.recordPayment(w, i, { amount: b.amount === undefined || b.amount === "" ? undefined : Number(b.amount), method: b.method || "bank_transfer", date: b.date, reference: b.reference || "", by: by(req), note: b.note || "" }); res.status(201).json({ payment: r.payment, invoice: invOut(w, r.invoice) }); } catch (e) { fail(res, e); }
  });
  app.post(`${P}/invoices/:id/payment-link`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (i.status !== "issued" || i.kind !== "invoice") return res.status(409).json({ detail: "Payment links are for issued invoices" });
    await billing.issueLink?.(w, i);
    res.json(invOut(w, i));
  });
  // Test mode only: pretend Moyasar sent a webhook, to try the whole flow without a card.
  app.post(`${P}/invoices/:id/simulate-card`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (billing.settings(w).mode !== "test") return res.status(409).json({ detail: "Simulation only works in Test mode" });
    if (i.status !== "issued") return res.status(409).json({ detail: "Only issued invoices" });
    const paid = req.body?.outcome !== "failed";
    const r = await billing.webhook({ type: paid ? "payment_paid" : "payment_failed", payment_id: `test_pay_${crypto.randomBytes(6).toString("hex")}`, moyasar_invoice_id: i.payment_link?.id || "", status: paid ? "paid" : "failed",
      amount_minor: Math.round(amountDue(i) * 100), currency: i.currency, metadata: { invoice_id: i.id, workspace_id: w.id }, message: paid ? "" : "Simulated decline (Test mode)" });
    res.json({ ok: r.ok, invoice: invOut(w, billing.getInvoice(w.id, i.id)) });
  });
  app.get(`${P}/invoices/:id/print`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    res.type("html").send(invoiceHtml(i, store.getOps("billing_customers", w.id, i.customer_id), w, billing));
  });
  app.get(`${P}/invoices/:id/xml`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (!i.zatca) return res.status(404).json({ detail: "No ZATCA XML: the invoice isn't issued, or the company isn't VAT-registered" });
    const xml = ublXml(i, { seller: i.seller, buyer: i.buyer, uuid: i.zatca.uuid, icv: i.zatca.icv, pih: i.zatca.pih, qr: i.zatca.qr });
    res.setHeader("X-Invoice-Hash", invoiceHash(xml));
    res.type("application/xml").send(xml);
  });

  // ---- payments, dunning, payouts, log
  app.get(`${P}/payments`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json(store.listOps("billing_payments", w.id).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id)).slice(0, 1000)
      .map((p) => ({ ...p, customer: custName(w, p.customer_id), invoice: billing.getInvoice(w.id, p.invoice_id)?.number || "" })));
  });
  app.get(`${P}/dunning`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const today = riyadhDay(), s = billing.settings(w);
    const rows = billing.invoices(w.id).filter((i) => i.kind === "invoice" && i.status === "issued" && (dunningState(i, today, s).overdue || i.dunning_from))
      .map((i) => ({ ...invOut(w, i), log: store.listOps("billing_log", w.id).filter((l) => l.invoice_id === i.id && ["dunning", "payment"].includes(l.kind)).slice(-10) }));
    res.json({ settings: { dunning_days: s.dunning_days, pause_after_days: s.pause_after_days, mode: s.mode }, invoices: rows,
      drafts: store.listOps("billing_drafts", w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50).map((d) => ({ ...d, customer: custName(w, d.customer_id), invoice: billing.getInvoice(w.id, d.invoice_id)?.number || "" })),
      sent: store.listOps("billing_log", w.id).filter((l) => l.kind === "dunning").slice(-50).reverse() });
  });
  app.post(`${P}/payouts/parse`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const platform = ["Salla", "Zid"].includes(req.body?.platform) ? req.body.platform : "Salla";
    const p = parsePayouts(req.body?.text || "", platform);
    if (p.error) return res.status(422).json({ detail: p.error });
    res.json({ rows: reconcilePayouts(p.rows, billing.customers(w.id), billing.invoices(w.id)), columns: p.columns });
  });
  app.post(`${P}/payouts/apply`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    let applied = 0, skipped = 0, fees = 0;
    for (const r of rows) {
      const inv = r.invoice_id ? billing.getInvoice(w.id, r.invoice_id) : null;
      if (!inv || inv.status !== "issued") { skipped++; continue; }
      const amount = Math.min(amountDue(inv), r2((Number(r.gross) || 0) / (inv.currency === "USD" ? 3.75 : 1)));
      try { billing.recordPayment(w, inv, { amount, method: "app_store", date: isoDate(r.date) ? r.date : undefined, reference: str(r.reference, 80), fee: Number(r.fee) || 0, by: by(req), note: `${str(r.platform, 10)} payout` }); applied++; } catch { skipped++; continue; }
      if (Number(r.fee) > 0) { store.addExpense(w.id, { date: isoDate(r.date) ? r.date : riyadhDay(), vendor: `${str(r.platform, 10) || "App store"} app-store fee`, amount_sar: r2(r.fee), vat_sar: 0, category: "other", recurring: "one-off", note: `Payout ${str(r.reference, 60)} for ${inv.number}`, source: "billing" }, false); fees = r2(fees + Number(r.fee)); }
    }
    billing.addLog(w, { kind: "payout", status: "applied", text: `App-store payouts: ${applied} matched, ${skipped} skipped, SAR ${fees} fees` });
    store.save();
    res.json({ applied, skipped, fees_sar: fees });
  });
  app.get(`${P}/log`, (req, res) => { const w = W(req, res); if (!w) return; res.json(store.listOps("billing_log", w.id).slice(-300).reverse()); });
  app.post(`${P}/run`, async (req, res) => { const w = W(req, res); if (!w) return; try { res.json(await billing.runWorkspace(w)); } catch (e) { fail(res, e); } });

  // ---- settings
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, f = {}, err = [];
    for (const k of ["legal_name", "legal_name_ar"]) if (b[k] !== undefined) f[k] = str(b[k], 160);
    if (b.bank_details !== undefined) f.bank_details = str(b.bank_details, 600);
    if (b.vat_number !== undefined) { f.vat_number = str(b.vat_number, 15).replace(/\s/g, ""); if (f.vat_number && !VAT_NUMBER.test(f.vat_number)) err.push("VAT number must be 15 digits starting and ending with 3"); }
    if (b.cr_number !== undefined) { f.cr_number = str(b.cr_number, 10).replace(/\s/g, ""); if (f.cr_number && !/^\d{10}$/.test(f.cr_number)) err.push("CR number must be 10 digits"); }
    if (b.address !== undefined) f.address = cleanAddress(b.address);
    for (const k of ["invoice_prefix", "credit_prefix"]) if (b[k] !== undefined) { f[k] = str(b[k], 12).toUpperCase(); if (!/^[A-Z0-9/-]{1,12}$/.test(f[k])) err.push(`${k} may use letters, digits, - and / only`); }
    if (b.terms_days !== undefined) { const n = Math.round(Number(b.terms_days)); if (!(n >= 0 && n <= 90)) err.push("payment terms must be 0–90 days"); else f.terms_days = n; }
    if (b.mode !== undefined) { if (!["test", "live"].includes(b.mode)) err.push("mode must be test or live"); else f.mode = b.mode; }
    if (b.zatca_mode !== undefined) { if (!["test", "live"].includes(b.zatca_mode)) err.push("ZATCA mode must be test or live"); else f.zatca_mode = b.zatca_mode; }
    if (b.zatca_status !== undefined) { if (!ZATCA_STATUSES.some((z) => z.id === b.zatca_status)) err.push("unknown ZATCA status"); else f.zatca_status = b.zatca_status; }
    if (b.auto_issue !== undefined) f.auto_issue = !!b.auto_issue;
    if (b.dunning_days !== undefined) { const d = (Array.isArray(b.dunning_days) ? b.dunning_days : String(b.dunning_days).split(",")).map((x) => Math.round(Number(x))).filter((x) => x >= 1 && x <= 60); if (!d.length) err.push("dunning days: e.g. 1, 3, 7"); else f.dunning_days = [...new Set(d)].sort((a, c) => a - c).slice(0, 6); }
    if (b.pause_after_days !== undefined) { const n = Math.round(Number(b.pause_after_days)); if (!(n >= 1 && n <= 120)) err.push("pause after must be 1–120 days"); else f.pause_after_days = n; }
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    res.json(billing.setSettings(w, f));
  });

  // ---- AI Billing assistant (level 1: drafts; a person approves before anything is sent)
  const aiDraft = async (req, res, w, inv, kind) => {
    const c = store.getOps("billing_customers", w.id, inv.customer_id);
    const hist = store.listOps("billing_log", w.id).filter((l) => l.customer_id === c.id).slice(-8).map((l) => `- ${l.at.slice(0, 10)} ${l.kind} ${l.status}: ${l.text || l.subject || ""}`).join("\n");
    const prompt = kind === "reminder" ? dunningPrompt(w, c, inv, dunningState(inv, riyadhDay(), billing.settings(w)), hist) : explainPrompt(w, c, inv);
    try {
      const text = await provider.generate({ system: "You are DPA AD's AI Billing assistant. You draft; a person reviews and sends. Never invent numbers.", prompt, onText: () => {} });
      const m = /^\s*\**Subject:\**\s*(.+)$/im.exec(text);
      const subject = m ? m[1].trim().slice(0, 200) : kind === "reminder" ? `تذكير بالدفع · Payment reminder: ${inv.number}` : `فاتورتكم ${inv.number} · About your invoice ${inv.number}`;
      const body = (m ? text.replace(m[0], "") : text).trim();
      const d = store.addOps("billing_drafts", w.id, { kind, invoice_id: inv.id, customer_id: c.id, subject, text: body, original: body, status: "draft", by: "ai" });
      res.status(201).json(d);
    } catch (e) { res.status(502).json({ detail: e instanceof LLMError ? e.message : "Something went wrong reaching Claude. Try again." }); }
  };
  app.post(`${P}/invoices/:id/ai/:kind`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = INV(req, res, w); if (!i) return;
    if (!["reminder", "explain"].includes(req.params.kind)) return res.status(404).json({ detail: "Unknown AI task" });
    if (req.params.kind === "reminder" && i.status !== "issued") return res.status(409).json({ detail: "Reminders are for unpaid issued invoices" });
    await aiDraft(req, res, w, i, req.params.kind);
  });
  app.post(`${P}/drafts/:id/:action`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getOps("billing_drafts", w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Draft not found" });
    if (d.status !== "draft") return res.status(409).json({ detail: "Already handled" });
    if (req.params.action === "reject") {
      store.updateOps("billing_drafts", w.id, d.id, { status: "rejected", handled_by: by(req) });
      workforce?.event("billing_assistant", w.id, "rejected", `${d.kind} for invoice ${d.invoice_id}`);
      return res.json(d);
    }
    if (req.params.action !== "approve") return res.status(404).json({ detail: "Unknown action" });
    const subject = str(req.body?.subject ?? d.subject, 200), text = String(req.body?.text ?? d.text).trim().slice(0, 8000);
    if (!text) return res.status(422).json({ detail: "The email is empty" });
    const c = store.getOps("billing_customers", w.id, d.customer_id);
    const logE = await billing.email(w, c, { subject, text }, { kind: d.kind === "reminder" ? "dunning" : "email", invoice_id: d.invoice_id, step: d.kind === "reminder" ? 0 : null });
    const edited = text !== d.original || subject !== d.subject;
    store.updateOps("billing_drafts", w.id, d.id, { status: "approved", subject, text, handled_by: by(req), sent_status: logE.status });
    workforce?.event("billing_assistant", w.id, edited ? "edited" : "accepted", `${d.kind} for invoice ${d.invoice_id}`);
    res.json({ ...store.getOps("billing_drafts", w.id, d.id), email: logE });
  });
}

// Customer 360 without money, for roles with AI Support access but no Billing access (module "support").
export function mountCustomersLite(app, { store, billing, crm }) {
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const lite = (w, c) => {
    const h = billing.health(w, c);
    const contact = crm && c.crm_contact_id ? crm.get(w.id, c.crm_contact_id) : null;
    return { id: c.id, store_name: c.store_name, domain: c.domain, platform: c.platform, owner_name: c.owner_name, owner_email: c.owner_email, plan: c.plan, status: c.status, trial_end: c.trial_end,
      health: { score: h.score, label: h.label, factors: h.factors.map((f) => (f.id === "payment" ? { ...f, why: "Hidden (needs Billing access)" } : f)) },
      onboarding: contact ? { steps: ONBOARDING_STEPS, done: contact.onboarding || {} } : null };
  };
  app.get("/api/workspaces/:ws/customers", (req, res) => { const w = W(req, res); if (!w) return; res.json(billing.customers(w.id).map((c) => lite(w, c))); });
  app.get("/api/workspaces/:ws/customers/:id", (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = billing.getCustomer(w.id, req.params.id);
    if (!c) return res.status(404).json({ detail: "Customer not found" });
    res.json({ ...lite(w, c), usage: billing.usageOf(w.id, c.id).map((u) => ({ month: u.month, renders: u.renders })), tickets: billing.ticketsFor(w.id, c).map((t) => ({ id: t.id, status: t.status, channel: t.channel, updated_at: t.updated_at })) });
  });
}
