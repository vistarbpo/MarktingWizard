# Customer Success

Customer Success (sidebar: Customers → Customer success, route `success`, access module `success`) follows every store in **Billing & customers** after it pays or starts a trial: how healthy it is, why it might leave, when it renews, where onboarding is stuck, what it says in surveys, and when it is ready for a bigger plan.

AI does every step it can: it takes the daily health snapshots, checks every alert rule, sends surveys inside Saudi hours, and drafts save plans and emails. People own each alert, talk to the store, close the alert with what happened, and approve every AI draft. Nothing reaches a customer without a person, and nothing is sent while the module is in Test mode.

Code: `web/lib/success.js` (rules, signals, renewals, surveys, the daily job), `web/lib/successroutes.js` (API, public survey page, sample customers, Command Center needs), `web/public/success.js` (the page). Tests: the `success…` tests at the end of `web/test/app.test.js`.

## Where the data comes from

Customer Success adds no second copy of customer data. It reads:

| Data | From |
|---|---|
| Customers, plan, cycle, status, cancel at period end | `billing_customers` (Billing) |
| Health score and its five parts | Billing's `healthScore()`: payment 30, usage 25, tickets 15, onboarding 15, activity 15 |
| Renders per month | `billing_usage` (typed in Billing or posted by the product to `/hooks/billing/usage`) |
| Overdue invoices | `billing_invoices` |
| Render limits and overage prices | Finance → Pricing (`pricing.js`, `render_limit`, `overage_per_1k`) |
| Plan prices and SKU bands | `PLANS` in `web/lib/sales.js` |
| Support tickets | `support_tickets`, matched to the customer by email or domain (Billing's `ticketsFor()`) |
| Onboarding checklist | The Store CRM store linked in Billing (`crm_contact_id`), or the CRM store with the same domain |
| Catalog size (SKUs) | `skus` on the customer, else the CRM store's `products`, else the Sales deal's `skus` |

Its own collections in `db.json` (all `success_*`, removed with their workspace):

| Collection | What |
|---|---|
| `success_health` | One snapshot per customer per day: `score`, `label`, `parts` (the five factor points). Kept about 13 months. |
| `success_alerts` | Churn alerts as tasks: type, reason, owner, status (open / snoozed / done), playbook checklist, outcome and note, history. |
| `success_renewals` | A person's status for a renewal date: not started / in talks / renewed / lost (with reason), owner, note. |
| `success_surveys` | NPS or CSAT surveys: question in Saudi Arabic and English, channel. |
| `success_responses` | One row and one unguessable token per customer per survey: send status, score, comment. |
| `success_drafts` | AI drafts (save plans, upgrade and renewal emails) and what a person did with them. |
| `success_log` | What the daily job and the senders did. |

Settings and playbooks live on the workspace (`ws.success.settings`, `ws.success.playbooks`).

## The daily job

`app.locals.success.start()` (started in `server.js`) runs every hour. It is safe to repeat: the snapshot is keyed by day, so a second run the same day only refreshes today's row, and an alert that is already open is refreshed, never doubled. Each run, for every workspace with Billing customers:

1. Snoozed alerts whose date has come are opened again.
2. Each customer that isn't cancelled gets today's snapshot (Billing's health score, computed live).
3. Every churn rule below is checked; a hit becomes an alert (or refreshes the open one).
4. Survey messages that were waiting for Saudi hours are sent if it is now 09:00–21:00 Riyadh time and not Friday.

"Check now" on the page (`POST /api/workspaces/:ws/success/run`) does steps 1–3 at once. Tests set the clock with `createApp({ successOptions: { now } })` or by replacing `success.clock`.

## Health bands

Same cut-offs as Billing: **75+ healthy**, **50–74 watch**, **under 50 at risk**. The overview shows the count in each band, the average snapshot score per day for the last 30 days, a 30-day sparkline per customer, and the MRR of at-risk customers (only for roles that can see Billing).

## Churn alert rules

Every rule is a fixed, explainable check. Each alert carries the reason in plain words (no money in the reason text, so it is safe to show to roles without Billing).

| Alert | Fires when | Default threshold | Setting |
|---|---|---|---|
| Health dropped (`health_drop`) | Today's score is at least N points below the best snapshot of the last D days. The reason lists which parts fell (e.g. "payment -30, usage -15"). | 15 points within 14 days | `health_drop_points`, `health_drop_days` |
| Usage down (`usage_drop`) | Renders in the last full month are down at least P% vs the month before. Only complete months count, so the current half month never looks like a drop. | 40% | `usage_drop_pct` |
| Payment past due (`past_due`) | Billing marked the store past due, or paused it for non-payment. The reason names the most overdue invoice and its days. | Billing's dunning (day 1 past due, pause after 14 days) | Billing → Settings |
| No activity (`inactive`) | No renders reported, payment, support ticket, CRM reply (or the product's `last_seen_at` on the customer) for N days; for a store with no activity at all, N days since the start. Paused and cancelled stores are skipped. | 14 days | `inactive_days` |
| Many open tickets (`tickets`) | More than N support tickets that aren't resolved. | more than 2 | `open_tickets_max` |
| Unhappy ticket (`negative_ticket`) | An open ticket's customer messages (or its escalation reason) mention a refund, cancelling, a complaint and similar words in English or Arabic (the `NEGATIVE` list in `success.js`). One alert per ticket. | — | edit `NEGATIVE` in `web/lib/success.js` |
| Cancellation scheduled (`cancel_scheduled`) | "Cancel at period end" is set in Billing. One alert per end date. | — | — |
| Detractor answer (`detractor`) | A survey answer of NPS 0–6 or CSAT 1–2. Raised the moment the answer arrives, one per answer, with the comment quoted. | — | `SURVEY_KINDS` in `success.js` |

Dedupe and cool-down: an alert is identified by customer + key. While one is open or snoozed, a new hit only updates its reason. After it is closed, the same general alert (health drop, usage, past due, no activity, tickets) doesn't come back for `reopen_days` (default 14). Alerts tied to one thing (a ticket, a survey answer, a cancellation date) never come back once closed.

### Alerts are tasks

Each alert has an owner (the customer's success owner by default, set in the customer panel), a checklist copied from the playbook for its type, and a status:

- **Open**: needs someone.
- **Snoozed** until a date after today; it opens again on that date.
- **Done** with an outcome (saved, problem fixed, no action needed, churned anyway, other) and a note on what happened. Both are required.

Every change is kept in the alert's history with who made it.

## Playbooks

Success → Playbooks holds a short checklist per alert type (one step per line). A new alert copies its playbook as a checklist; changing a playbook affects new alerts only. "Reset to default" brings back `DEFAULT_PLAYBOOKS` from `success.js`.

## Expansion and upgrade signals

| Signal | Fires when | Suggested plan |
|---|---|---|
| Render usage near the limit (`render_usage`) | Renders this month so far, or last month, are at least 80% of the plan's render limit. Only plans with a limit in Finance → Pricing (by default Scale 15,000 and Enterprise 50,000). | The next plan up |
| Catalog bigger than the plan (`sku_band`) | The store's SKU count is over the plan's band in `PLANS` (Starter up to 500, Growth up to 5,000, Scale up to 50,000). | The plan whose band fits (`planFor()`) |
| Overage two months running (`overage_2m`) | Both of the last two complete months went over the render limit. The extra renders and the overage at Pricing's rate are shown. | The next plan up |

Setting: `render_pct` (default 80). The suggestion is the biggest plan any signal points to. The price difference is the list monthly price in `PLANS` (USD, and SAR at 3.75), before VAT; Enterprise is marked as "from" its list price. An Enterprise customer has no plan above it, so the suggestion is a larger custom allowance with an `[ADD]` price agreed with Finance. Prices and differences are only shown to roles that can see Billing. Nothing is invented: every number comes from `PLANS`, Pricing or the usage rows.

## Renewals

Yearly plans renew at the end of their period; trials end on their trial date. Monthly plans renew every month and are watched through alerts instead. The list covers the next 90 days (overview counts 30 / 60 / 90) plus the last 30 days:

- A person sets the status: not started, in talks, renewed, or lost (a reason is required), plus an owner and a note.
- Without a status, a date that has passed shows as **renewed** if the store still pays, **lost** if it was cancelled; "cancel at period end" shows as lost. These are marked "(auto)".

## Onboarding view

From each customer's onboarding checklist in the Store CRM (the seven `ONBOARDING_STEPS` in `crm.js`): steps done, days since the customer started, the date of the last progress, and the next step when it is **stuck**: nothing ticked for `stuck_days` (default 7). The CRM now records when each step was ticked (`onboarding_at` on the CRM store); before that, the customer's start date counts as the last progress. A customer not linked to a CRM store (by `crm_contact_id` or the same domain) shows "not linked".

## NPS and CSAT surveys

- **Create** a survey: NPS (0–10) or CSAT (1–5), with the question in Saudi Arabic and English (defaults in `DEFAULT_QUESTIONS`) and a channel: email, WhatsApp, or link only.
- **Send** creates one response row and one random 24-character token per customer per survey. Sending again only sends to customers who don't have it yet or weren't sent (opt-outs and skips stay as they are). Cancelled customers are left out.
- **Every safety rule applies** (the same rules as the Store CRM), checked in this order:
  1. Not linked to a CRM store: "link" (a person shares the link).
  2. Do-not-contact, email opt-out or bounce, WhatsApp opt-out, no WhatsApp opt-in, or no approved WhatsApp template: skipped, with the reason.
  3. Sample stores: logged, never sent.
  4. **Test mode (default)**: logged, not sent.
  5. Outside 09:00–21:00 Riyadh time or on a Friday: queued until the next run inside the window.
  6. Live: sent through the Store CRM's `sendOne()`, which adds the unsubscribe link and the `List-Unsubscribe` header, checks every rule again and respects the CRM's own Test mode.
- **WhatsApp** needs an approved template named in Success → Settings (`wa_template`); its body parameters are the owner's name and the survey link.
- **The public page** `/s/:token` needs no login (it is mounted before the login wall). It is Arabic first (right to left) with English, works on phones, and accepts one answer per token: a second answer gets "we already have your answer". It is rate-limited: 60 page views and 10 answers per IP per 10 minutes, and 5 answers per token. Answers are plain form posts; the page has no scripts.
- **Scores**: NPS = % promoters (9–10) − % detractors (0–6); CSAT = average and % satisfied (4–5). Shown per survey, per customer (last answer) and overall.
- A **detractor** answer raises a `detractor` alert with the comment quoted.

## AI agents

Both are registered in `AGENTS` (`web/lib/agents.js`), max level 1 (drafts only), budget $15/month each, team Customer Success. `agentFor()` sends `/success/…/ai/expansion` and `/ai/renewal` to the writer and every other Success call to the watcher, so every AI run is attributed and budgeted. Before drafting, the route refuses when the agent is switched off (`workforce.level(id) < 1`).

- **AI Retention watcher** (`retention_watcher`): "why at risk" (each point tied to a fact: health factors, open alerts, usage, tickets, onboarding) and a save plan with a first WhatsApp to the owner in Saudi Arabic and English. Approving keeps the plan on the alert.
- **AI Expansion & renewal writer** (`success_writer`): upgrade emails (from the expansion signals) and renewal emails (from the renewal date), Saudi Arabic first, then English. Only the facts given are used; any missing number or proof is written as `[ADD]`. Prices are only put in the prompt for people who can see Billing; others get `[ADD price]`. A person approves; "Approve and send" goes through the same safe sender as surveys (Test mode logs it).

Outcomes go to AI Workforce: approved unchanged = accepted, approved after editing = edited, rejected = rejected.

## Command Center

For roles that can see Customer success:

- "N customers at risk" (with their MRR only for roles that can see Billing),
- "N renewals in the next 14 days with no status" (yearly renewals and trials nobody has touched),
- "N unanswered detractors" (detractor alerts still open).

## Customer 360

Billing's customer drawer shows a small Customer success section (health sparkline, open alerts, last survey answer) for roles that can see the module, with a link to the customer's panel on the Success page (`#/<ws>/success/c-<customer id>`).

## Permissions

Module `success`. Defaults: Owner, Admin, Team lead and Team member edit; Finance and Viewer view; Creative none. `ensureRoles()` adds it to roles saved before it existed. Money fields (MRR, at-risk MRR, prices and differences) are stripped from every Success API response for roles without Billing view, and drafts that include prices can only be read and handled by people who can see Billing.

## Sample data

Loading sample data (Home, or `POST /api/workspaces/:ws/sample-data`) adds six sample Billing customers in different states (healthy yearly, Scale near its render limit, a store with falling usage and an unhappy ticket, a past-due store, a yearly store cancelling, a trial ending), three months of usage, three weeks of sample health snapshots, CRM onboarding progress, and a sample NPS survey with three answers. Load the Store CRM's sample stores first (`/crm/sample`) so the customers link to CRM stores. The past-due store's invoice is numbered `SAMPLE-…`, outside the real invoice sequence. Removing sample data removes all of it.

## For the founder to confirm

- The thresholds above are starting points, not benchmarks: adjust them in Success → Settings after a few months of real data.
- The unhappy-ticket word list (`NEGATIVE` in `success.js`) is a first version in English and Saudi Arabic; add the words your customers really use.
- Survey wording (Saudi dialect) and how often to survey (suggested: once a quarter).
- The WhatsApp survey template must be created and approved in WhatsApp Manager before WhatsApp surveys can go out.
- "No activity" counts renders, payments, tickets and CRM replies. A real product login signal needs the DPA AD product to report it: the rule already reads `last_seen_at` on the customer, but nothing sets it yet (a small addition to the usage API).
