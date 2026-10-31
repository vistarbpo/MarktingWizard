# Marketing Wizard

**An AI marketing engine for SaaS companies and agencies, running live for DAP ADS at https://wizard.dpa.ad.**

AI made building products easy. Sales and marketing are still hard. Marketing Wizard turns your
company data into consistent, ready-to-ship marketing: positioning, personas, messaging, pricing,
landing pages, outbound emails, social posts, ad campaigns, SEO plans, a 90-day GTM plan, and KPI
reports.

## How it works

```
 Company data ─────────────┐      Playbooks (Claude)                 Library
  Brief                    ├──►   Positioning → ICP → Messaging ──►  every output saved,
  Knowledge notes          │      → Landing page, emails, ads ...    copy or export as Markdown
  KPIs + weekly values ────┘      → KPI Report & Analysis
                                  each playbook reads the brief, all knowledge,
                                  and the latest earlier strategy work
```

* **Workspaces**: one per company. Agencies create one per client. DAP ADS is created on first start.
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

On first start the app creates the DAP ADS workspace, adds the pricing plan (`web/seed/pricing.md`) as a
knowledge note, and imports history from the earlier dashboard's `assets.json` if it exists.

Claude requests use adaptive thinking, streaming, and server-side refusal fallbacks (`fallbacks: "default"`).

## Docs

* `docs/dap-ads-pricing.md`: the DAP ADS pricing recommendation.
