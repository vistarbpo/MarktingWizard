// Marketing Wizard: hosted app entry point (Hostinger runs this file).
// Env: DASHBOARD_PASSWORD (required to log in), ANTHROPIC_API_KEY (required to generate),
//      MWIZ_MODEL (default claude-opus-5-5), MWIZ_EFFORT (default high), DATA_DIR, PORT.
// Store CRM channels (optional; without them messages are logged as tests, never sent):
//      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_REPLY_TO (email out; Hostinger: smtp.hostinger.com 465)
//      IMAP_HOST, IMAP_USER, IMAP_PASS (replies in; defaults to the SMTP mailbox, IMAP_HOST=off to disable)
//      WA_TOKEN, WA_PHONE_ID, WA_VERIFY_TOKEN, WA_APP_SECRET, WA_TEMPLATE_LANG (WhatsApp Cloud API)
//      PUBLIC_URL (unsubscribe links, media URLs, OAuth redirects), COMPANY_ADDRESS (email footer), INBOUND_SECRET (/hooks/email/<secret>)
// Creative Studio publishing (optional; Test mode by default, nothing is posted until Live is switched on):
//      TOKEN_KEY (encrypts platform tokens at rest; 64 hex chars or a passphrase; default: derived from DASHBOARD_PASSWORD)
//      META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN, META_GRAPH_VERSION (Facebook Page + Instagram; webhook /hooks/meta)
//      LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_ORG_ID (company page, once approved), LINKEDIN_VERSION
//      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_AUDITED=1 (after Google's audit; until then uploads are private)
//      TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_AUDITED=1 (after TikTok's audit; until then posts are SELF_ONLY)
// Backups (Security & compliance; nightly 02:00 Riyadh into DATA_DIR/backups, last 14 nightly + 8 weekly):
//      BACKUP_KEY (required to encrypt and to send off-site; 64 hex chars from `openssl rand -hex 32`; keep a copy safe)
//      BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET, BACKUP_S3_REGION (default us-east-1),
//      BACKUP_S3_PREFIX (default marketing-wizard/), BACKUP_S3_PATH_STYLE (1/0) (Cloudflare R2, Backblaze B2, AWS S3, Hostinger…)
//      BACKUP_EMAIL_TO, BACKUP_EMAIL_MAX_MB (default 15; uses the SMTP_* mailbox), BACKUP_MEDIA=0 (leave media out), BACKUP_MEDIA_MAX_MB (default 200)
// Status page (/status, public): self-checks PUBLIC_URL/healthz every 5 minutes (localhost when PUBLIC_URL is unset).
// Billing & customers (optional; Test mode by default: no card links, no ZATCA calls, reminders logged not sent):
//      MOYASAR_SECRET_KEY (card payment links), MOYASAR_WEBHOOK_SECRET (shared secret on the /hooks/moyasar webhook)
//      BILLING_USAGE_TOKEN (Bearer token for the product to POST renders to /hooks/billing/usage)
//      ZATCA_ENV (sandbox | simulation | production), ZATCA_CSID, ZATCA_CSID_SECRET (after ZATCA onboarding; Live also needs signing)
// Paid Ads (optional; Test mode by default, nothing changes on an ad platform until an approver switches to Live; campaigns are created PAUSED):
//      Meta uses the same META_APP_ID / META_APP_SECRET (add the Marketing API product; ads_read, ads_management, business_management), META_ADS_REVIEWED=1 after App Review
//      SNAP_CLIENT_ID, SNAP_CLIENT_SECRET (Snapchat Marketing API), SNAP_ADS_APPROVED=1 once Snap approves the app
//      TIKTOK_ADS_APP_ID, TIKTOK_ADS_SECRET (TikTok Business API, a separate app from content posting), TIKTOK_ADS_APPROVED=1 after TikTok's review
//      ADS_GOOGLE=1 to show Google Ads, with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (manager account), GOOGLE_ADS_VERSION, GOOGLE_ADS_BASIC_ACCESS=1
//      ADS_LEAD_SECRET (signup / landing forms POST leads with their UTMs to /hooks/ads/lead/<secret>)
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
app.locals.studio.start(); // Creative Studio: publishes due posts every minute, comments every 15 minutes, results every 6 hours
app.locals.backups.start(); // Backups: checks every minute, runs nightly from 02:00 Riyadh (catches up after a restart)
app.locals.status.start({ url: (process.env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "") + "/healthz" }); // status page uptime self-check every 5 minutes
app.locals.billing.start(); // Billing: hourly run issues due invoices, ends trials, bills overage, sends dunning reminders
app.locals.ads.start(); // Paid Ads: pulls insights every 6 hours for Live workspaces, then runs the guardrails and the Finance push
app.locals.success.start(); // Customer Success: hourly (safe to repeat) daily health snapshots, churn alerts, queued surveys inside Saudi hours
app.locals.intel.start(); // Market intel: every 6 hours, fetches watched competitor pages that are due (each at most once a week, 2 at a time)
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { app.locals.crm.flush(); process.exit(0); });
app.listen(port, () =>
  console.log(`Marketing Wizard listening on ${port} (provider ${provider.name}, login ${password ? "on" : "NOT SET"})`));
