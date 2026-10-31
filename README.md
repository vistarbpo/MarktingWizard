# Marketing Wizard

**An AI marketing engine for SaaS companies and agencies, running live for DPA AD at https://wizard.dpa.ad.**

AI made building products easy. Sales and marketing are still hard. Marketing Wizard turns your
company data into consistent, ready-to-ship marketing: positioning, personas, messaging, pricing,
landing pages, outbound emails, social posts, ad campaigns, SEO plans, a 90-day GTM plan, and KPI
reports.

## Operating SOP

The dashboard opens on **SOP**: one procedure for running marketing (one-time setup, weekly cycle,
monthly review, quarterly strategy). Every step links to the page or playbook that does it, and the
team ticks steps off together; ticks reset each week, month and quarter. The same procedure is in
[`docs/SOP.md`](docs/SOP.md), generated from `web/lib/sop.js` (`cd web && npm run sop:md`).

## Modules

| Module | What it does | AI does | Only people do |
|---|---|---|---|
| SOP | One operating procedure, ticked off per week/month/quarter | Links every step to the page that does it | Run the steps |
| Marketing | Brief, knowledge, KPIs, 14 playbooks | Writes every playbook and the KPI report | Review, decide, publish |
| Sales pipeline | Deals by stage, insights, AI drafts | Openers, prospect pages, follow-ups, objection answers | Big-deal calls, discounts, contracts |
| ROAS results | Designed vs plain catalog ROAS from Meta/Snap/TikTok ad exports, by template and store | Maps ads to templates, writes case studies (EN + AR) | Exports results, approves case studies with a real quote |
| Store CRM & outreach | Database of Salla/Zid stores (CSV import, 30k+), segments by category/city/size, email + WhatsApp sequences, newsletters, onboarding flows, inbox of replies, lifecycle pipeline | Writes sequences per category, sends on schedule in Saudi hours, reads replies, sets intent, moves stores, creates Sales deals, drafts answers | Imports the list, approves campaigns, switches to Live, answers replies that need a person |
| Teams & roles | Personal logins, roles with None/View/Edit per module, teams, activity log | — (access is enforced on every request) | Owners and Admins add people and set roles |
| AI Support | Inbox, help center, optional live website chat | Answers from the help center in Arabic/English | Refunds, cancellations, legal, data, bugs, upset customers |
| Finance | Cash, burn, runway, 12-month forecast, budgets, expenses, VAT | Reads bank statements, monthly report, cost review, investor update | Approve payments, file VAT with ZATCA, payroll, sign |
| Product | Roadmap (Now/Next/Later), impact-vs-effort chart, customer feedback, releases | Imports and groups feedback, scores ideas, writes specs, changelogs (EN + AR) and help articles | What gets built, release go/no-go, partner agreements |
| Operations | Task board, Saudi compliance + renewal deadlines, tool stack, incidents | Plans goals into tasks and owns most of them, weekly ops brief, automation review, incident notice + postmortem | Approvals, filings, signatures, live calls, incident decisions |
| Team & hiring | AI-first org chart, hiring board | Job posts, CV screening, interview kits, onboarding | Interviews, offers, contracts |

## How it works

```
 Company data ─────────────┐      Playbooks (Claude)                 Library
  Brief                    ├──►   Positioning → ICP → Messaging ──►  every output saved,
  Knowledge notes          │      → Landing page, emails, ads ...    copy or export as Markdown
  KPIs + weekly values ────┘      → KPI Report & Analysis
                                  each playbook reads the brief, all knowledge,
                                  and the latest earlier strategy work
```

* **Workspaces**: one per company. Agencies create one per client. DPA AD is created on first start.
* **Brief**: the company profile: customers, markets and languages, integrations, pricing, competitors, goals.
* **Knowledge**: notes by category (results, objections, competitors, sales, pricing...). Every playbook reads all of them.
* **KPIs**: 20 KPIs from the growth SOP load in one click. Log values per week (`2026-W44`) or month (`2026-10`).
* **Overview**: a data completeness score and the questions the engine still needs answered.
* **Playbooks**: 14 jobs, streamed live as they're written. The **launch kit** runs 8 of them in order, each building on the last.
* **No made-up proof**: the engine writes `[ADD CUSTOMER METRIC]` placeholders and marks unsure competitor facts `(verify)`.

| Playbook | What you get |
|---|---|
| Positioning & Messaging Foundation | Alternatives, unique value, category, positioning statement, taglines |
| ICP & Buyer Personas | ICP, disqualifiers, buying-committee personas |
| Messaging Matrix | Master message, per-persona value props, proof and CTAs |
| Pricing & Packaging Strategy | Value metric, tiers, add-ons, revenue math to the goal |
| 90-Day Go-To-Market Plan | Phases, channels, weekly actions, KPIs, budget split |
| Landing Page Copy | Hero, sections, FAQs, SEO meta, A/B headlines |
| Outbound Email Sequence | Multi-step sequence with personalisation tokens |
| Competitor Battlecards | Where we win, landmine questions, objection handling |
| Social Media Post Pack | Platform-native posts |
| SEO Content Plan | Pillars, keyword clusters, quick wins |
| Content Calendar | Multi-week, multi-channel calendar |
| Paid Ads Campaign | Structure, targeting, ad copy |
| KPI Report & Analysis | What happened, why, so what, now what (from logged KPIs) |
| Agency Client Proposal | *(agency workspaces)* Tailored proposal with tiered pricing |

To add a playbook, add an entry to `web/lib/catalog.js`.

## Run locally

```bash
cd web
npm install
DASHBOARD_PASSWORD=choose-one ANTHROPIC_API_KEY=sk-ant-... npm start   # http://localhost:3000
npm test
```

Without `ANTHROPIC_API_KEY` the app runs in demo mode with placeholder output.

## Deployment (Hostinger)

`wizard.dpa.ad` is a Hostinger Node.js site that auto-deploys this repository's `web/` folder on every
push to the deployed branch (Express, entry file `server.js`, Node 22). Set these in hPanel, in the
site's environment variables:

| Variable | Default | |
|---|---|---|
| `DASHBOARD_PASSWORD` | | Team password for the login page (required) |
| `ANTHROPIC_API_KEY` | | Claude API key (required to generate) |
| `MWIZ_MODEL` | `claude-opus-5-5` | Claude model |
| `MWIZ_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max`: depth vs. cost |
| `DATA_DIR` | `~/marketing-wizard-data` | Where `db.json` lives, outside the deploy folder so deploys never wipe data |

On first start the app creates the DPA AD workspace, adds the pricing plan (`web/seed/pricing.md`) as a
knowledge note, and imports history from the earlier dashboard's `assets.json` if it exists.

Claude requests use adaptive thinking, streaming, and server-side refusal fallbacks (`fallbacks: "default"`).

## Docs

* `docs/competitive-analysis.md`: who earns more in catalog/creative ad-tech and what DPA AD should change.
* `docs/SOP.md`: the marketing operating SOP (also the dashboard home page).
* `docs/dpa-ad-pricing.md`: the DPA AD pricing recommendation.
