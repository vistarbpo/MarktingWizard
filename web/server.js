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
app.locals.ads.start(); // Paid Ads: pulls insights every 6 hours for Live workspaces, then runs the guardrails and the Finance push
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { app.locals.crm.flush(); process.exit(0); });
app.listen(port, () =>
  console.log(`Marketing Wizard listening on ${port} (provider ${provider.name}, login ${password ? "on" : "NOT SET"})`));
