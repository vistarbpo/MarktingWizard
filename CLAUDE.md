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
- **Env vars** live in hPanel (Websites → wizard.dpa.ad → Node.js → Environment variables), never in git: `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`, optional `MWIZ_MODEL`, `DATA_DIR`, and the Store CRM channels (`SMTP_*`, `MAIL_FROM`, `MAIL_REPLY_TO`, `IMAP_*`, `WA_TOKEN`, `WA_PHONE_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `PUBLIC_URL`, `COMPANY_ADDRESS`, `INBOUND_SECRET`). The full list is commented at the top of `web/server.js`.
- **Data** is not in git: `DATA_DIR` (default `~/marketing-wizard-data`) holds `db.json` (everything except the CRM) and `crm.json` (stores, campaigns, messages; batched writes, flushed on SIGTERM). There are **no backups yet**.
- Without `ANTHROPIC_API_KEY` the app runs a demo provider (sidebar shows "Demo mode").
- To stop a local server: `for p in $(pgrep -f "^node server.js"); do kill $p; done`. Don't use `pkill -f "node server.js"`: it kills the shell running it.

## Code map

Node 22 + Express, plain JS ES modules, no build step, no frontend framework.

- `web/server.js`: entry. Creates `Store`, provider (Claude via `@anthropic-ai/sdk`, or demo) and the app, and starts the CRM scheduler.
- `web/lib/app.js`: `createApp({ store, provider, password, crm, outreachOptions })` holds all routes. Order:
  1. login
  2. public routes (support chat, CRM unsubscribe and webhooks)
  3. auth middleware (session, per-module permission, audit log)
  4. API routes

  Streaming AI responses end with `\n\n[[MWIZ_SAVED]]id` or `[[MWIZ_ERROR]]msg`.
- `web/lib/store.js`: JSON-file store (`db.json`). Generic per-workspace collections via `listOps`/`addOps`/`updateOps`/`deleteOps`.
- **Business logic, one file per module:**

  | File | Module |
  |---|---|
  | `sales.js` | Plans, stages, next actions, close rate, AI tasks |
  | `finance.js` | Snapshot, unit economics, LTV:CAC, VAT |
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
- **Creative Studio:**
  - `creative.js`: channels and their limits, statuses, pillars, the Saudi season calendar, brand kit, content items and variants, rule-based checks before approval, the email renderer (blocks → table HTML, RTL; the `store_products` block draws each recipient's own products from `vars.contact.products_sample`), AI prompts.
  - `creativeroutes.js`: routes, approvals (approver roles in the brand kit), "download and post" log, and `emailDesign()` which Store CRM uses to send approved designed emails.
- **AI Workforce:** `agents.js` (agent registry `AGENTS`, autonomy levels, prices, the `Workforce` class: `wrap(provider)` attributes every AI call to an agent via AsyncLocalStorage, enforces pause and monthly budget, records tokens and cost; `event()` logs outcomes and auto-demotes; `level(id)` is what modules check before acting alone), `agentroutes.js` (`/api/workforce`). `agentFor()` maps API paths to agents. New AI features must register an agent and record outcomes. Plan: `docs/ai-workforce-plan.md`.
- **Ask DPA AD** (`assistant.js` + `public/assistant.js`): Claude with tools (`TOOLS`) that call the app's own API over HTTP with the user's cookie, so permissions, validation and the audit log apply. Write tools pause for a Confirm card (`/api/assistant/confirm`); the thread lives in memory. Add a tool by adding an entry to `TOOLS` (with `module`, `write`, `risk`, `preview` for writes). Tests inject `assistantClient`.
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

- **Pricing is a draft** until real costs are in (Finance → Pricing):
  - Starter $199, Growth $449, Scale $1,299, Enterprise from $4,000, by SKU count; yearly billing at 2 months free.
  - Draft render limits: Scale 15,000/month then $10 per extra 1,000; Enterprise 50,000/month then $8 per extra 1,000.
  - Prices live in `PLANS` in `web/lib/sales.js` and in `docs/dpa-ad-pricing.md`; when they're final, change both and the CRM call script in `crm.js`.
- **AI-first plan** (`docs/ai-workforce-plan.md`): AI Workforce, the office view and the "Ask DPA AD" assistant are built; next are Paid Ads, Customer Success, Market Intelligence.
- **Creative Studio** (`docs/creative-studio-plan.md`): **phase 1 is built**: calendar, board, ideas, email designer used by CRM campaigns, brand kit, approvals, download-and-post. **Phase 4a is built** (best effort): product samples per store (Store CRM drawer and bulk "Fetch products"), the "Store's own products as ads" email block, and the WhatsApp header image from the store's first product photo. Real rendered ads replace the cards when DPA AD's render engine accepts a store link. Phases 2–3 and the rest of 4 (rendering images and reels, direct publishing, comments) wait on the founder decisions in section 7 of that doc.
- **Sales system:** `docs/dpa-ad-sales-system.md`, DPA AD's own funnel targets (editable in Store CRM → Settings). External masterclass notes were only a reference.
- **Still to do:**
  1. Nightly backups of `DATA_DIR` and a download-backup button.
  2. Make sure the scheduler keeps running on Hostinger (external ping or cron to `/healthz`).
  3. Live end-to-end test of SMTP, IMAP replies, bounces and the WhatsApp webhook once credentials exist.
  4. Error alerts (e.g. Sentry).
  5. Password-reset email and two-step login.
  6. Move to MySQL if the CRM grows past a few hundred thousand messages.
- **The owner's own to-dos:**
  - create a personal Owner login and rotate `DASHBOARD_PASSWORD`
  - set up the cold-email domain, mailbox, SPF/DKIM/DMARC and warm-up
  - set up WhatsApp Business (Cloud API) and get the templates approved
  - import the 30k Salla store list after confirming its source and consent under PDPL
  - remove the sample data
  - enter real finance data and costs
  - finalize pricing
  - switch the CRM to Live after a week in Test mode
