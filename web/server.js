// Marketing Wizard: hosted app entry point (Hostinger runs this file).
// Env: DASHBOARD_PASSWORD (required to log in), ANTHROPIC_API_KEY (required to generate),
//      MWIZ_MODEL (default claude-opus-5-5), MWIZ_EFFORT (default high), DATA_DIR, PORT.
// Store CRM channels (optional; without them messages are logged as tests, never sent):
//      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_REPLY_TO (email out; Hostinger: smtp.hostinger.com 465)
//      IMAP_HOST, IMAP_USER, IMAP_PASS (replies in; defaults to the SMTP mailbox, IMAP_HOST=off to disable)
//      WA_TOKEN, WA_PHONE_ID, WA_VERIFY_TOKEN, WA_APP_SECRET, WA_TEMPLATE_LANG (WhatsApp Cloud API)
//      PUBLIC_URL (unsubscribe links), COMPANY_ADDRESS (email footer), INBOUND_SECRET (/hooks/email/<secret>)
import os from "node:os";
import path from "node:path";
import { createApp } from "./lib/app.js";
import { claudeProvider, demoProvider } from "./lib/engine.js";
import { Store } from "./lib/store.js";

const password = process.env.DASHBOARD_PASSWORD || process.env.MWIZ_PASSWORD || "";
const store = new Store(process.env.DATA_DIR || path.join(os.homedir(), "marketing-wizard-data"));
const provider = process.env.ANTHROPIC_API_KEY
  ? claudeProvider({ model: process.env.MWIZ_MODEL || "claude-opus-5-5", effort: process.env.MWIZ_EFFORT || "high" })
  : demoProvider();
const port = process.env.PORT || 3000;

const app = createApp({ store, provider, password });
app.locals.outreach.start(); // Store CRM: sends due messages every minute, reads the mailbox every 3 minutes
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { app.locals.crm.flush(); process.exit(0); });
app.listen(port, () =>
  console.log(`Marketing Wizard listening on ${port} (provider ${provider.name}, login ${password ? "on" : "NOT SET"})`));
