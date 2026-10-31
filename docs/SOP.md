# Marketing Operating SOP

One procedure for running marketing, done entirely in the Marketing Wizard dashboard (https://wizard.dpa.ad → **SOP**).
Tick steps off in the dashboard; ticks reset each week, month and quarter.

_Generated from `web/lib/sop.js` with `npm run sop:md`. Edit that file, not this one._

## One-time setup

**When:** Once, before the first weekly cycle  
**Goal:** Give the engine enough company data to write sharp, on-brand output.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Set DASHBOARD_PASSWORD and ANTHROPIC_API_KEY in hPanel (Websites → wizard.dpa.ad → Node.js → Environment variables). | Founder | Outside the dashboard (hPanel / app stores) |
| 2 | Fill in the Brief completely: customers, markets, integrations, pricing, competitors, goals. | Head of Growth | Brief |
| 3 | Add Knowledge notes: real results, common objections, competitor intel, sales learnings, the pricing plan. | Head of Growth | Knowledge |
| 4 | Load the SOP KPIs and set a target for each one. | Head of Growth | KPIs |
| 5 | Answer every open question on the Overview until data completeness is 100%. | Head of Growth | Overview |
| 6 | Run the full launch kit (positioning → ICP → messaging → landing page → emails → social → ads → GTM plan). | Head of Growth | Playbooks |
| 7 | Let AI write the starter help center (English + Arabic), fill every [CONFIRM], then switch on the website chat. | Founder | AI Support |
| 8 | Product: load the starter roadmap and confirm what's Now, Next and Later. | Founder | Product |
| 9 | Teams & roles: create your own Owner login, add every teammate with the right role, load the starter teams. | Founder | Teams & roles |
| 10 | Store CRM: import the Salla store list, connect the sending mailbox (SPF/DKIM/DMARC) and WhatsApp, run the starter campaigns in Test mode for a week, then switch to Live. | Head of Growth | Store CRM |
| 11 | Operations: load the Saudi starter calendar and confirm every date, import your tool stack from Finance, and add who owns each login. | Founder | Operations |
| 12 | Run Pricing & Packaging Strategy, verify competitor prices, and decide the launch price. | Founder | Playbooks → Pricing & Packaging Strategy |
| 13 | Review every launch-kit output in the Library; replace each [ADD …] placeholder and (verify) mark with real facts. | Founder | Library |

## Weekly cycle

**When:** Every week · Monday review, Friday wrap-up  
**Goal:** Measure, learn, and ship this week's marketing from one place.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Store CRM: clear the Inbox, compare reply rates by category and campaign, rewrite the weakest sequence with AI, and raise daily caps only if bounces and unsubscribes stay low. | Head of Growth | Store CRM |
| 2 | Monday: log last week's values for every weekly KPI. | Each KPI owner | KPIs |
| 3 | Monday: run KPI Report & Analysis and agree the one bottleneck to fix this week. | Head of Growth | Playbooks → KPI Report & Analysis |
| 4 | Monday: pick 1–2 experiments that target that bottleneck and write them as a Knowledge note (hypothesis, metric, owner). | Head of Growth | Knowledge |
| 5 | Generate this week's Social Media Post Pack and schedule the posts. | Content | Playbooks → Social Media Post Pack |
| 6 | Generate or refresh an Outbound Email Sequence for the persona in focus and load it into the sending tool. | Sales | Playbooks → Outbound Email Sequence |
| 7 | Daily: open the Sales pipeline, review and send the AI drafts, and clear everything under "Needs you". | Founder | Sales pipeline |
| 8 | Daily: clear AI Support's "Needs you" list; Friday: turn repeated questions into new help articles. | Customer Success | AI Support |
| 9 | Check app store listings (Salla, Shopify, Zid): reply to every review, note rating changes. | Marketplace Manager | Outside the dashboard (hPanel / app stores) |
| 10 | Monday: run the AI weekly operations brief, plan the week's goals with the AI planner, and clear Operations "Needs you" (deadlines, incidents, tasks waiting on a person). | Founder | Operations |
| 11 | Friday: import new requests from Support into Product, let AI group them, approve or decline AI-suggested ideas, and update what's Now / Next. | Founder | Product |
| 12 | Friday: add Knowledge notes for new objections, wins, lost deals and competitor moves. | Sales + Customer Success | Knowledge |
| 13 | Friday: clear the Library: everything generated this week is reviewed, used, or deleted. | Head of Growth | Library |

## Monthly review

**When:** First working day of the month  
**Goal:** Check unit economics and plan next month's content and spend.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Send the monthly newsletter to contacted, replied, customer and not-now stores; review Onboarding stores stuck on a checklist step. | Head of Growth | Store CRM |
| 2 | Teams & roles: deactivate anyone who left, check the activity log for unexpected changes. | Founder | Teams & roles |
| 3 | Log the monthly KPIs: ARPA, churn, NRR, CAC, merchant ROAS, creatives per product. | Head of Growth | KPIs |
| 4 | Run KPI Report & Analysis on the month and share it with the team. | Head of Growth | Playbooks → KPI Report & Analysis |
| 5 | Generate next month's Content Calendar. | Content | Playbooks → Content Calendar |
| 6 | Refresh the Paid Ads Campaign: kill losers, brief new creatives and angles. | Performance marketer | Playbooks → Paid Ads Campaign |
| 7 | Update the SEO Content Plan and publish the planned articles. | Content | Playbooks → SEO Content Plan |
| 8 | Refresh Competitor Battlecards with this month's competitor notes. | Sales | Playbooks → Competitor Battlecards |
| 9 | ROAS results: import each beta and paying store's ad results, write an AI case study for every clear win, and log Merchant ROAS to KPIs. | Customer Success | ROAS results |
| 10 | Finance: add the month-end bank balance, paste the bank statement for AI to categorise, then run the AI monthly finance report and act on its decisions. | Founder | Finance |
| 11 | Clear Team & hiring: every candidate screened by AI, interviews booked, decisions logged, rejections sent. | Founder | Team & hiring |
| 12 | Update the Brief with anything that changed: pricing, features, markets, proof points. | Founder | Brief |

## Quarterly strategy

**When:** Last two weeks of each quarter  
**Goal:** Re-set strategy, pricing and goals for the next quarter.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Re-run Positioning with the quarter's knowledge and results; adopt changes deliberately. | Founder | Playbooks → Positioning & Messaging Foundation |
| 2 | Re-run ICP & Buyer Personas using real customer data. | Head of Growth | Playbooks → ICP & Buyer Personas |
| 3 | Re-run the Messaging Matrix and roll changes into the landing page and ads. | Head of Growth | Playbooks → Messaging Matrix |
| 4 | Re-run Pricing & Packaging Strategy; decide on any price or plan change. | Founder | Playbooks → Pricing & Packaging Strategy |
| 5 | Generate the next 90-Day Go-To-Market Plan and set next quarter's KPI targets. | Founder | Playbooks → 90-Day Go-To-Market Plan |
| 6 | Finance → Reports & VAT: check the quarter's VAT position; if registered, a person files and pays the ZATCA return before the due date. | Founder | Finance |
| 7 | Product: re-score the roadmap with the quarter's feedback, decide the Now / Next / Later list, and write specs for what's Next. | Founder | Product |
| 8 | Review the org chart: move any repeatable human work to an AI agent, and confirm which roles truly must be human before hiring. | Founder | Team & hiring |
| 9 | Update KPI targets on the KPIs page to match the new plan. | Head of Growth | KPIs |
