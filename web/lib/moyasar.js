// Card payments through Moyasar (Saudi payment gateway): an invoice (payment link) per DPA AD invoice,
// and a webhook that marks it paid. Test mode (the default) logs instead of calling the API.
// Env: MOYASAR_SECRET_KEY (sk_test_… or sk_live_…), MOYASAR_WEBHOOK_SECRET (the shared secret set on the
// webhook in the Moyasar dashboard; Moyasar puts it in each event's body as `secret_token`).
import crypto from "node:crypto";

export const MOYASAR_API = "https://api.moyasar.com/v1"; // verify against current docs

export function moyasarConfig(env = process.env) {
  return { secret: env.MOYASAR_SECRET_KEY || "", webhook_secret: env.MOYASAR_WEBHOOK_SECRET || "", ready: !!env.MOYASAR_SECRET_KEY,
    public_url: (env.PUBLIC_URL || "https://wizard.dpa.ad").replace(/\/$/, "") };
}

// Amounts go to Moyasar in the smallest unit (halalas for SAR, cents for USD).
export const minorUnits = (amount) => Math.round((Number(amount) || 0) * 100);

export function createMoyasar({ cfg = moyasarConfig(), fetchImpl = (...a) => fetch(...a) } = {}) {
  const auth = () => "Basic " + Buffer.from(cfg.secret + ":").toString("base64"); // secret key as the username, empty password
  async function call(method, p, body) {
    const res = await fetchImpl(MOYASAR_API + p, { method, headers: { Authorization: auth(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.message || j?.errors ? `Moyasar: ${j.message || JSON.stringify(j.errors).slice(0, 200)}` : `Moyasar error ${res.status}`);
    return j;
  }
  return {
    cfg,
    // POST /invoices → { id, status: "initiated", url, … } // verify against current docs
    createInvoice: ({ amount, currency, description, metadata, expired_at }) => call("POST", "/invoices", {
      amount: minorUnits(amount), currency, description: String(description).slice(0, 250),
      callback_url: `${cfg.public_url}/billing/thanks`, // where the customer lands after paying; verify field name against current docs
      expired_at, metadata }),
    getPayment: (id) => call("GET", `/payments/${encodeURIComponent(id)}`), // verify against current docs
  };
}

// Webhook check: the event's secret_token must equal MOYASAR_WEBHOOK_SECRET (compared in constant time).
// With no secret configured every event is refused. // verify against current docs (Moyasar may add a signature header)
export function verifyWebhook(body, secret) {
  if (!secret) return false;
  const got = Buffer.from(String(body?.secret_token || "")), want = Buffer.from(String(secret));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// { type: "payment_paid" | "payment_failed" | …, data: payment } // verify against current docs
export function parseWebhook(body) {
  const p = body?.data || {};
  return { type: String(body?.type || ""), event_id: String(body?.id || ""), live: !!body?.live, payment_id: String(p.id || ""), moyasar_invoice_id: String(p.invoice_id || ""),
    status: String(p.status || ""), amount_minor: Number(p.amount) || 0, currency: String(p.currency || "").toUpperCase(), metadata: p.metadata || {}, message: String(p.source?.message || p.message || "").slice(0, 200) };
}
