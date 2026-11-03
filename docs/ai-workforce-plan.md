# AI-first company plan: more agents than people

Goal: DPA AD runs with **about 5–6 people and 25–30 AI agents**. Agents do the repeatable work; each has a named person responsible. People do what must be human: strategy, big deals, approvals, filming, and licensed work (accounting, law).

## 1. Foundation (built first)

### AI Workforce: built (Nov 2026)
Every AI agent in the dashboard is managed like an employee (`web/lib/agents.js`, `agentroutes.js`, `public/workforce.js`, sidebar → People → AI Workforce).

- **Registry:** 14 agents across Customer Success, Sales, Marketing, Finance, Operations, Product and People. Each has a job description, a team, the page it works in, and a person responsible.
- **Autonomy ladder:** 0 Off → 1 Drafts → 2 Auto + spot-check → 3 Fully automatic. Each agent has a top level its job allows; jobs that decide, send money, sign or hire stay at 1 by design. What each level changes is enforced in code:

  | Agent | What the level controls |
  |---|---|
  | AI Support agent | Level 1 keeps every chat answer as a draft for a person; 2+ answers checked questions live. |
  | AI Inbox triage | Level 1 only labels a reply's intent; 2+ moves stores and creates deals. Unsubscribe is always honoured. |
  | AI Reply writer | Level 2 sends simple answers by itself (this replaces the CRM "auto-reply" switch). |
  | AI Copywriter | Level 2 auto-approves clean pieces, except 1 in 5 spot-checks and anything with a number claim. Level 3 approves all clean pieces; number claims still go to a person. |
  | AI Publisher | Level 2 publishes scheduled, approved content (wired to Creative Studio's auto-publish). |
- **Track record:** every outcome is logged: used unchanged, edited, rejected, escalated, acted alone, error.
  - **Move up:** allowed after 50 reviewed items with 95%+ used unchanged and no errors.
  - **Move down:** automatic, one level, after 3 rejections or errors in the last 20 items.
- **Cost:** every AI call is attributed to an agent with tokens, cost (Anthropic list prices), time and errors.
  - Each agent has a monthly budget. When it's reached, the agent stops until the budget is raised.
  - The pause switch stops an agent at once.
- **Visibility:**
  - The page shows an org chart (people and their agents), a table of every agent, and a log per agent.
  - The Command Center shows agents that are ready to move up, close to budget, failing, or were moved down.
  - Who sees it: Owner and Admin can change agents; Team lead, Team member and Creative can only view.

### "Ask DPA AD" assistant: next
One chat or command bar across the dashboard that acts within the signed-in person's permissions (Claude with tools over the dashboard's own API). Anything that changes data asks for confirmation first. Every action is logged to the activity log and attributed to a "Coordinator" agent in AI Workforce.

## 2. Modules that replace the most jobs

| Module | Agents | Replaces | Person who stays | Needs |
|---|---|---|---|---|
| **Paid Ads** | Media buyer, budget pacer, creative rotator | Performance marketer | Founder sets limits, approves new campaigns | Meta / Snap / TikTok ad accounts and Marketing API access; Creative Studio content |
| **Customer Success & Retention** | Health scores, churn alerts, upgrade prompts (plan or render limit outgrown), renewals, NPS | Customer success manager (most accounts) | Account owner for Scale/Enterprise | Usage events from the DPA AD product |
| **Market Intelligence** | Competitor prices and ads, app-store reviews, new stores, stores running ads (tagged `running-ads` in the CRM automatically), weekly brief | Analyst / researcher | — | Meta Ad Library access; public pages |
| **Partners & Agencies** | Recruit GCC agencies, referral tracking, commissions, partner kit | Partnerships manager (early) | Founder for key partners | — |

## 3. Back office

| Module | Agents | Person who stays |
|---|---|---|
| **Legal & Compliance** | Contracts, the data processing agreement (DPA) stores sign under Saudi PDPL, data-deletion requests, policies, app-store rules | External lawyer approves |
| **Finance: ZATCA e-invoicing and bills** | Read invoices from email, prepare payments for approval, Fatoora e-invoices once VAT-registered | External accountant |
| **Investor Room** | Investor CRM, monthly updates from real numbers, data room, deck drafts | Founder pitches |
| **Product Analytics** | Activation funnel, feature usage, churn signals | Product owner (needs product events) |

## 4. Target organisation

| | Today's plan | With these modules |
|---|---|---|
| People | 6–8 | **5–6**: founder/CEO, 1–2 engineers, creative lead, key-account owner, part-time external accountant and lawyer |
| AI agents | 14 | **25–30** |

## 5. Order

1. AI Workforce *(built)*
2. "Ask DPA AD" assistant
3. Paid Ads
4. Customer Success & Retention
5. Market Intelligence
6. Partners & Agencies, Legal & Compliance, ZATCA, Investor Room
7. Product Analytics, once the product sends events

Each new module registers its agents in `AGENTS` in `web/lib/agents.js` (job, team, top level, budget, what each level means) and records outcomes with `workforce.event()`, so it joins the same ladder, budget and log from day one.
