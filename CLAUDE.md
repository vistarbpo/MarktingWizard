# Marketing Wizard: DPA AD's company dashboard

Internal operating system for **DPA AD** (dpa.ad): a pre-launch Saudi SaaS that turns ecommerce catalogs into designed image and video ads for Meta, Snap, TikTok and Google. Arabic-first, Salla/Zid stores first, goal $100M ARR. Live at **https://wizard.dpa.ad**. This repo is the dashboard, not the DPA AD product itself.

Principle across every module: **AI does every step it can; people do only what must be human** (approvals, live calls, contracts, anything the AI flags). AI drafts are reviewed before anything reaches a customer.

## Run, test, deploy

```bash
cd web && npm install
DASHBOARD_PASSWORD=test-pass PORT=3000 node server.js   # open http://localhost:3000, leave email empty, password test-pass
npm test                                                 # node:test, web/test/app.test.js, all must pass
npm run sop:md                                           # regenerate docs/SOP.md after editing lib/sop.js
```

- **Deploy:** push to `main` on GitHub `vistarbpo/MarktingWizard`. Hostinger auto-deploys `main` (root dir `web`, entry `server.js`, Node 22, Express). Check a deploy by fetching `https://wizard.dpa.ad/app.css` for a new CSS rule, plus `/healthz`. Other pages need a login.
- **Env vars** live in hPanel (Websites → wizard.dpa.ad → Node.js → Environment variables), never in git: `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`, optional `MWIZ_MODEL`, `DATA_DIR`, and the Store CRM channels (`SMTP_*`, `MAIL_FROM`, `MAIL_REPLY_TO`, `IMAP_*`, `WA_TOKEN`, `WA_PHONE_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `PUBLIC_URL`, `COMPANY_ADDRESS`, `INBOUND_SECRET`) and Creative Studio publishing (`TOKEN_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, optional `META_GRAPH_VERSION`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, optional `LINKEDIN_ORG_ID` and `LINKEDIN_VERSION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_AUDITED`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_AUDITED`), Paid Ads (Meta reuses `META_APP_ID`/`META_APP_SECRET`; `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`, `TIKTOK_ADS_APP_ID`, `TIKTOK_ADS_SECRET`, optional `ADS_GOOGLE=1` with `GOOGLE_ADS_DEVELOPER_TOKEN` and `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `ADS_LEAD_SECRET`; review flags `META_ADS_REVIEWED`, `SNAP_ADS_APPROVED`, `TIKTOK_ADS_APPROVED`, `GOOGLE_ADS_BASIC_ACCESS`), backups (`BACKUP_KEY`, required to encrypt and to send off-site; optional `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`, `BACKUP_S3_PATH_STYLE`, `BACKUP_EMAIL_TO`, `BACKUP_EMAIL_MAX_MB`, `BACKUP_MEDIA`, `BACKUP_MEDIA_MAX_MB`) and Billing (`MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`, `BILLING_USAGE_TOKEN`, optional `ZATCA_ENV`, `ZATCA_CSID`, `ZATCA_CSID_SECRET`). Set `TOKEN_KEY` before connecting accounts: without it the token key comes from `DASHBOARD_PASSWORD`, and rotating the password means reconnecting every account. The full list is commented at the top of `web/server.js`.
- **Data** is not in git: `DATA_DIR` (default `~/marketing-wizard-data`) holds `db.json` (everything except the CRM, including employees, punches, leave and payroll runs) and `crm.json` (stores, campaigns, messages; batched writes, flushed on SIGTERM), plus `media/` (Creative Studio uploads and renders, served publicly at `/media/<random>.<ext>`). **Backups** run nightly at 02:00 Riyadh into `DATA_DIR/backups/` (encrypted with `BACKUP_KEY`, last 14 nightly + 8 weekly + 10 manual, optional S3/email copy); restore with `web/scripts/restore-backup.js`, steps in `docs/security-compliance.md`.
- Without `ANTHROPIC_API_KEY` the app runs a demo provider (sidebar shows "Demo mode").
- To stop a local server: `for p in $(pgrep -f "^node server.js"); do kill $p; done`. Don't use `pkill -f "node server.js"`: it kills the shell running it.

## Code map

Node 22 + Express, plain JS ES modules, no build step, no frontend framework.

- `web/server.js`: entry. Creates `Store`, provider (Claude via `@anthropic-ai/sdk`, or demo) and the app, and starts the CRM, Creative Studio, billing and Customer Success schedulers.
- `web/lib/app.js`: `createApp({ store, provider, password, crm, outreachOptions })` holds all routes. Order:
  1. login
  2. public routes (support chat, CRM unsubscribe and webhooks, `/hooks/moyasar`, `/hooks/billing/usage`, survey answers `/s/:token`)
  3. auth middleware (session, per-module permission, audit log)
  4. API routes

  Streaming AI responses end with `\n\n[[MWIZ_SAVED]]id` or `[[MWIZ_ERROR]]msg`.
- `web/lib/store.js`: JSON-file store (`db.json`). Generic per-workspace collections via `listOps`/`addOps`/`updateOps`/`deleteOps`.
- **Business logic, one file per module:**

  | File | Module |
  |---|---|
  | `sales.js` | Plans, stages, next actions, close rate, AI tasks |
  | `finance.js` | Snapshot, unit economics, LTV:CAC, VAT (MRR and output VAT from Billing when customers exist) |
  | `pricing.js` | Cost-per-store calculator and render limits |
  | `hr.js` | Team & hiring |
  | `support.js` | AI support |
  | `ops.js` | Operations |
  | `product.js` | Roadmap, feedback, releases |
  | `roas.js` | Designed-vs-plain ROAS from ad CSVs |
  | `command.js` | Founder overview across modules |
  | `sop.js` | The SOP (one checklist system) |
  | `samples.js` | Sample data |
  | `catalog.js` | Brief fields, playbooks, KPIs |
  | `engine.js` | Claude provider |
  | `access.js` | Roles, modules, password hashing, `moduleFor()` |
  | `platforms.js` | Ecommerce platform list and detection |

- **Store CRM:**
  - `crm.js`: stages, CSV import and parsing, scoring, segments, templates, starter campaigns, AI prompts, Saudi send hours.
  - `crmstore.js`: `crm.json` storage and its migrations.
  - `outreach.js`: senders (SMTP via nodemailer, WhatsApp Cloud API), the scheduler `tick()`, inbound handling and AI triage, IMAP polling.
  - `crmroutes.js`: CRM HTTP routes.
  - `products.js`: product samples per store for "your products as ads" (CSV, Shopify `/products.json`, schema.org JSON-LD / `og:image` from the store's pages), the SSRF-safe fetcher (`safeGet`, DNS checked on every hop and at connect time) and the background fetch jobs. Tests inject `productOptions: { fetchImpl, lookup }` into `createApp`; never hit the real internet.
- **Attendance & payroll (India)** (route `people`, docs in `docs/hr-india.md`):
  - `india-payroll.js`: every statutory rate in one place (FY 2025-26, "verify with your CA"): EPF/EPS/EDLI, ESI, Professional Tax presets (Karnataka, Maharashtra; Delhi, Haryana, UP have none; other states are entered by the company), new/old-regime income tax with 87A, gratuity, salary structure from CTC, due dates. Settings can override each rate.
  - `people.js`: IST helpers, daily attendance status rules, month grid, leave types and balances (accrual, carry-forward, comp-off ledger), payroll line (proration, PF, ESI, PT, TDS estimate, employer cost), statutory summary, bank CSV, ECR text, payslip HTML.
  - `peopleroutes.js`: `/api/workspaces/:ws/people/...` (module `team`), `/api/workspaces/:ws/payroll/...` (module `payroll`), self-service `/api/me/people/:ws/...` (own record only), plus `peopleNeeds()` for the Command Center and the sample employees. Tests can fix the clock with `app.locals.peopleClock`.
  - Collections in `db.json`: `people_employees`, `people_punches`, `people_leave`, `people_leave_ledger`, `people_holidays`, `people_runs`; settings on `ws.people`.
- **Creative Studio:**
  - `creative.js`: channels and their limits, statuses, pillars, the Saudi season calendar, brand kit, content items and variants, rule-based checks before approval, the email renderer (blocks → table HTML, RTL; the `store_products` block draws each recipient's own products from `vars.contact.products_sample`), AI prompts.
  - `creativeroutes.js`: routes, approvals (approver roles in the brand kit), "download and post" log, and `emailDesign()` which Store CRM uses to send approved designed emails.
  - `media.js`: media library (`creative_media`): streamed uploads to `DATA_DIR/media`, type allowlist plus byte sniffing, size limits (images 10 MB, video 150 MB, audio 30 MB; audio needs "I have the rights"), and `mediaChecks()` (JPEG for Instagram, Shorts under 60 s, AI label).
  - `social.js`: platform APIs behind an injected `fetchImpl`: AES-256-GCM token sealing, signed OAuth state (person + cookie), OAuth for Meta, LinkedIn, Google/YouTube and TikTok, publishers (Instagram image/carousel/reel/story, Facebook Page, LinkedIn, YouTube resumable, TikTok FILE_UPLOAD), metrics, comments, Send API, Meta webhook parsing. Uncertain endpoint details are marked `// verify against current docs`.
  - `publisher.js`: `createPublisher()` (`app.locals.studio`, started in `server.js`): scheduler every minute, results every 6 h, comments every 15 min. Test mode by default; `canAutoPublish(ws)` is the one auto-publish check (off by default); only approved or scheduled items publish; 3 tries then stop; `creative_publish_log`, `social_accounts`.
  - `studioroutes.js`: `mountStudioPublic` (`/media/*`, `/hooks/meta`) before the login wall; `mountStudio` (media, accounts, `/oauth/<provider>/start|callback`, publish now, retry, results, and support replies on comment/DM tickets sent back through Meta).
  - Browser side: `studio-render.js` (8 canvas templates, reel encoder: WebCodecs H.264 + AAC, `mp4-muxer@5.1.3` from jsDelivr), `studio-media.js` (Assets tab, attach, template designer, reel builder), `studio-publish.js` (Accounts, Publishing, Results). Rendering is in the browser because Hostinger can't run Chrome or ffmpeg. AAC audio encoding needs Chrome/Edge on Windows or Mac (Linux Chrome has none).
- **Security & compliance** (module `compliance`, route `compliance`, Settings group; details in `docs/security-compliance.md`):
  - `backup.js`: `createBackups()` (`app.locals.backups`, started in `server.js`): consistent snapshot (CRM flushed first) as tar.gz built with zlib, AES-256-GCM (`MWB1` header), retention, `verify()`, the scheduler (one check a minute, nightly from 02:00 Riyadh with catch-up), SigV4 (`signV4`, tested against AWS vectors) and `uploadS3`, email copy. Tests inject `backupOptions: { fetchImpl, mailer, now }` and `env` into `createApp`.
  - `compliance.js`: data register, sub-processor and policy starters, DSR deadline (`dsrDue`, `dsrState`), `findSubject` / `exportSubject` / `deleteSubject` across CRM, support, HR and sales, `securityChecks()`, the breach checklist, access-review rows, AI prompts. Legal numbers are configurable defaults to verify.
  - `status.js`: `createStatus()` (`app.locals.status`): components, status incidents (published or draft, linked to an Operations incident), 90-day bars, uptime self-check every 5 minutes (`status_checks`).
  - `complianceroutes.js`: `mountCompliancePublic` (`/status`, `/status.json`, before the login wall), `mountCompliance` (`/api/compliance/*`; backup download Owner only; deletion needs a deletion request + typed `DELETE`), `complianceNeeds()` for the Command Center.
  - Browser side: `public/compliance.js` (9 tabs) and the self-contained `public/status.html` (Arabic/English, light/dark).
- **Billing & customers** (route `billing`, module `billing`; rules and sources in `docs/billing-zatca.md`):
  - `billing.js`: pure maths (plan prices read from `PLANS`, yearly = 10 × monthly, `proration()`, `overage()`, `invoiceTotals()`, `dunningState()`, `healthScore()`, `mrrMetrics()`, payout CSV `parsePayouts()`/`reconcilePayouts()`, AI prompts) and `createBilling()`, the engine (`app.locals.billing`): customers with an event log (each event records the MRR after it), invoices and credit notes (sequential numbers, 15% VAT when Finance says VAT-registered, issued = immutable, void via credit note), payments → Finance income (`entry: "billing"`), the hourly billing run `tick()`/`runWorkspace()` (trials, renewals, overage in arrears, dunning day 1/3/7, pause after N days), the Moyasar webhook handler. Collections `billing_customers`, `billing_invoices`, `billing_payments`, `billing_usage`, `billing_log`, `billing_drafts` (created on start; settings on `ws.billing`).
  - `zatca.js`: phase 1 TLV QR, UBL 2.1 XML, invoice hash and PIH chain, ICV, clearance/reporting adapter (Test mode; Live blocked until XAdES signing is built). `qr.js`: dependency-free QR encoder to SVG. `moyasar.js`: payment-link API and webhook secret check (`// verify against current docs`).
  - `billingroutes.js`: `createBillingService()` (wires Moyasar, ZATCA and the CRM's SMTP sender; tests pass `billingOptions: { env, senders, fetchImpl, now }` to `createApp`), `mountBillingPublic`, `mountBilling` (`/api/workspaces/:ws/billing/...`), the printable Arabic/English invoice (`/invoices/:id/print`, `/xml`), `mountCustomersLite` (`/api/workspaces/:ws/customers`: customer 360 without money, module `support`), and `billingCommandHook()` (Command Center prefers billed MRR when customers exist; adds overdue, failed payments, trials ending). `financeSnapshot({ billing })` takes `billingForFinance()` so Finance MRR and output VAT come from subscriptions and invoices.
  - `public/billing.js`: tabs Overview, Customers (+360 drawer), Invoices, Payments (+payout import), Dunning (+AI drafts), Settings; `blCreateButton()` adds "Create customer in Billing" to the Sales deal drawer (stage Paying) and the CRM store drawer (Onboarding/Active).
- **Customer Success** (route `success`, module `success`; every rule, threshold and where to change it in `docs/customer-success.md`):
  - `success.js`: pure rules (`healthDropRule`, `usageDropRule`, `pastDueRule`, `inactiveRule`, `ticketsRule`, `negativeTicketRules`, `cancelRule`, `evaluateRules`), `expansionSignals()` (render limits from Pricing, prices from `PLANS`), `renewalRows()`, `onboardingRow()`, NPS/CSAT maths, AI prompts, `DEFAULT_SETTINGS` (all thresholds) and `DEFAULT_PLAYBOOKS`, and `createSuccess()` (`app.locals.success`, started in `server.js`): hourly and safe to repeat, one health snapshot per customer per day (Billing's `healthScore()`), alerts raised/refreshed/cooled down, snoozes reopened, surveys sent through the CRM's `sendOne()` with every outreach rule (`safeSend()`; Test mode by default, sample stores never, queued outside Saudi hours). Collections `success_health`, `success_alerts`, `success_renewals`, `success_surveys`, `success_responses`, `success_drafts`, `success_log`; settings and playbooks on `ws.success`. Tests pass `successOptions: { now }` or replace `success.clock`.
  - `successroutes.js`: `mountSuccessPublic` (`/s/:token` survey page, rate-limited, one answer per token, before the login wall), `mountSuccess` (`/api/workspaces/:ws/success/...`; money stripped by `stripMoney()` for roles without Billing view), `successNeeds()` for the Command Center, and the sample customers (`loadSampleSuccess`/`removeSampleSuccess`, called by the sample-data routes).
  - Agents `retention_watcher` and `success_writer` (level 1, drafts only). The CRM records when each onboarding step is ticked (`onboarding_at`). `public/success.js`: tabs Overview, Alerts, Renewals, Onboarding, NPS & CSAT, Playbooks, Settings, a customer drawer, and `sxBillingHook()` (the Success section in Billing's customer drawer).
- **AI Workforce:** `agents.js` (agent registry `AGENTS`, autonomy levels, prices, the `Workforce` class: `wrap(provider)` attributes every AI call to an agent via AsyncLocalStorage, enforces pause and monthly budget, records tokens and cost; `event()` logs outcomes and auto-demotes; `level(id)` is what modules check before acting alone), `agentroutes.js` (`/api/workforce`). `agentFor()` maps API paths to agents. New AI features must register an agent and record outcomes. Plan: `docs/ai-workforce-plan.md`.
- **Ask DPA AD** (`assistant.js` + `public/assistant.js`): Claude with tools (`TOOLS`) that call the app's own API over HTTP with the user's cookie, so permissions, validation and the audit log apply. Write tools pause for a Confirm card (`/api/assistant/confirm`); the thread lives in memory. Add a tool by adding an entry to `TOOLS` (with `module`, `write`, `risk`, `preview` for writes). Tests inject `assistantClient`.
- **Paid Ads** (`docs/paid-ads.md`, access module `ads`, route `ads`):
  - `ads.js`: channels, settings (SAR budgets, FX rates, result type), CSV import, metrics, pacing, guardrail rules, UTM builder, funnel attribution, the Finance push (`source: "ads"`), creative rotation and fatigue, the AI Media buyer's prompt and plan clean-up, `adsCommand()` for Command Center.
  - `adsapi.js`: Meta Marketing API, Snapchat Marketing API, TikTok Business API, Google Ads (flag): OAuth, ad accounts, insights normalisation, paused campaign creation, pause / cap / activate. Every call through an injected `fetchImpl`.
  - `adsroutes.js`: `createAds()` (connections with sealed tokens, pulls every 6 h in Live, guardrails, Finance push), the public lead hook `/hooks/ads/lead/<secret>`, OAuth at `/oauth/ads/:platform/*`, and the API routes.
- `web/public/`: one script per module sharing globals from `app.js` (`S`, `$`, `api`, `esc`, `md`, `toast`, `fmtDate`, `ROUTES`, `render`, `levelFor`). Each file registers `ROUTES.<route> = { title, crumb, render }` and ends with `if (S.route === "<route>" && S.ws) render();`. New modules need a nav link and a `<script>` tag in `index.html`, plus an entry in `ROUTE_MODULE` in `app.js`.
- **Permissions:** add a module to `MODULES` in `access.js` and map its API segment in `moduleFor()`. The server enforces None/View/Edit per role, the menu hides what's refused, and the Command Center redacts other modules.

## Rules this codebase follows

- Never invent numbers, results, customers or quotes in AI prompts or UI; use placeholders like `[ADD]`.
- Arabic-first customer copy (Saudi dialect), `dir="auto"` on user text, `esc()` everything rendered.
- Outreach safety:
  - unsubscribe link and header on every email; "stop" / "إلغاء" honoured
  - sequences stop when a store replies
  - sends only 09:00–21:00 Riyadh time, not Friday
  - WhatsApp only to opted-in numbers, with approved templates outside the 24h window
  - sample stores are never sent for real
  - store pages are fetched only by `products.js` (`safeGet`): public addresses only, 8 s, ~2 MB, 2 at a time
  - Test mode by default
- Every feature gets a test in `web/test/app.test.js`, and the whole suite must pass before pushing.
- Page scripts share one global scope: never reuse a top-level name from another `public/*.js` file (a test enforces this).
- Check UI changes in a browser (Playwright is available) at desktop and phone width, with no horizontal scroll on phones.

## Decisions and open items

- **Billing** (`docs/billing-zatca.md`) is built in **Test mode**: invoices are numbered and carry VAT and the ZATCA QR, but no card links, ZATCA calls or emails happen until Billing → Settings is switched to Live. ZATCA phase 2 (XAdES signing, C14N, clearance) is prepared, not connected. Decisions to confirm: overage per started 1,000, downgrade credit vs change at period end, VAT on app-store and non-Saudi sales.
- **Customer Success** (`docs/customer-success.md`) is built in **Test mode**: health snapshots, churn alerts (as owned tasks with playbooks), expansion signals, renewals, the onboarding view and NPS/CSAT surveys work, but surveys and AI emails are only logged until Success → Settings is Live (the Store CRM's own Test mode also applies). Every threshold is a starting point to tune with real data; WhatsApp surveys need an approved template; "no activity" has no product-login signal yet (`last_seen_at` is read but nothing sets it). No new env vars.
- **Pricing is a draft** until real costs are in (Finance → Pricing):
  - Starter $199, Growth $449, Scale $1,299, Enterprise from $4,000, by SKU count; yearly billing at 2 months free.
  - Draft render limits: Scale 15,000/month then $10 per extra 1,000; Enterprise 50,000/month then $8 per extra 1,000.
  - Prices live in `PLANS` in `web/lib/sales.js` and in `docs/dpa-ad-pricing.md`; when they're final, change both and the CRM call script in `crm.js`.
- **AI-first plan** (`docs/ai-workforce-plan.md`): AI Workforce, the office view and the "Ask DPA AD" assistant are built, and Customer Success; next are Paid Ads, Market Intelligence.
- **Creative Studio** (`docs/creative-studio-plan.md`): **phases 1–3 are built**, plus comments and DMs into AI Support:
  - phase 1: calendar, board, ideas, email designer used by CRM campaigns, brand kit, approvals, download-and-post
  - phases 2–3: media library, 8 image templates, reel builder (rendered in the browser), connected accounts by OAuth, publishing to Instagram, Facebook, LinkedIn, YouTube and TikTok, publish log with retries, results every 6 h
  - publishing is **Test mode by default** and auto-publish is off: switch to Live in Studio → Accounts only after the platforms' app reviews (listed in the plan doc, section 8)
  - phase 4a built: "your products as ads" emails and WhatsApp headers (store product samples in the CRM); still planned: content A/B tests and real rendered designs from DPA AD's render API
- **Attendance & payroll (India):** built for the team employed in India (punching in IST, leave, monthly payroll with PF/ESI/PT/TDS estimates, payslips, bank CSV, statutory dues, post to Finance at a typed INR→SAR rate). New access module `payroll` (Owner, Admin, Finance: edit; others none); attendance and leave admin use `team`. Salaries are stripped from employee records without Payroll view. Approved runs are locked; only an Owner reverses one, with a reason. All rates are FY 2025-26 defaults until the CA confirms them; see `docs/hr-india.md` for what the founder must confirm. No new env vars.
- **Paid Ads:** Test mode by default; campaigns are always created PAUSED and only an approver (Owner, Admin, Team lead) activates them; guardrails act alone only in Live with the AI Budget pacer at level 2. Meta uses the same app as Creative Studio (ads scopes added; Studio's login is reused when it has them). Snap and TikTok ads (media upload) and all Google campaigns are built by hand in Ads Manager. Platform calls are tested with mocks only (`docs/paid-ads.md` lists what to verify live).
- **Sales system:** `docs/dpa-ad-sales-system.md`, DPA AD's own funnel targets (editable in Store CRM → Settings). External masterclass notes were only a reference.
- **Still to do:**
  1. ~~Nightly backups of `DATA_DIR` and a download-backup button~~ (done: Security & compliance → Backups; set `BACKUP_KEY` and an S3 bucket).
  2. Make sure the scheduler keeps running on Hostinger (external ping or cron to `/healthz`).
  3. Live end-to-end test of SMTP, IMAP replies, bounces and the WhatsApp webhook once credentials exist.
  4. Error alerts (e.g. Sentry).
  5. Password-reset email and two-step login.
  6. Move to MySQL if the CRM grows past a few hundred thousand messages.
  7. Live end-to-end test of each platform's publishing once the developer apps exist (every API call is only tested with mocks so far).
  8. Billing: ZATCA phase 2 signing (XAdES, CSID key) and validation with the ZATCA SDK; a live Moyasar test payment; the real Salla/Zid payout CSV columns.
- **The owner's own to-dos:**
  - create a personal Owner login and rotate `DASHBOARD_PASSWORD`
  - set up the cold-email domain, mailbox, SPF/DKIM/DMARC and warm-up
  - set up WhatsApp Business (Cloud API) and get the templates approved
  - confirm every payroll rate, the state PT slabs and the leave policy with the CA (`docs/hr-india.md`), add the state and festival holidays, then add the India employees and link their logins
  - import the 30k Salla store list after confirming its source and consent under PDPL
  - remove the sample data
  - enter real finance data and costs
  - finalize pricing
  - switch the CRM to Live after a week in Test mode
  - set `BACKUP_KEY` (keep a copy in a password manager), an off-site S3 bucket and `PUBLIC_URL`; press Verify on a backup and test a restore
  - confirm the PDPL items in `docs/security-compliance.md` section 8 with a lawyer (DSR deadline, breach timeline, legal bases, cold email, cross-border transfers, DPAs)
  - Billing: enter the legal name, VAT and CR numbers, address and bank details (Billing → Settings); open a Moyasar account, set `MOYASAR_SECRET_KEY` and the webhook (`https://wizard.dpa.ad/hooks/moyasar`, secret in `MOYASAR_WEBHOOK_SECRET`); confirm the rules in `docs/billing-zatca.md` with the accountant; ZATCA onboarding on the Fatoora portal before DPA AD's phase 2 wave
  - Paid Ads: add the Marketing API to the Meta app and pass App Review; create the Snapchat and TikTok Business developer apps; set the Pixel ids and `ADS_LEAD_SECRET` (signup form posts leads with UTMs); set monthly budgets; switch Paid Ads to Live
