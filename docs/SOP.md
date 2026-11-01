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
| 10 | Store CRM: import the Salla store list, send cold email from a second domain (SPF/DKIM/DMARC) warmed up for 2–3 weeks, keep about 150 emails a day per domain, connect WhatsApp, and run the starter campaigns in Test mode for a week before switching to Live. Then tag a focus list (Build ICP list) and work that first. | Head of Growth | Store CRM |
| 11 | Validation: talk to stores until you find a customer champion ready to pay, then get the 2nd and 3rd "yes". Losing to "we'll keep doing it by hand" is more common than losing to a competitor: log that as the lost reason. | Founder | Sales pipeline |
| 12 | Make DPA AD easy for AI agents to evaluate: public help center, clear pricing page and API docs (buyers increasingly send an agent to check first). | Founder | AI Support |
| 13 | Operations: load the Saudi starter calendar and confirm every date, import your tool stack from Finance, and add who owns each login. | Founder | Operations |
| 14 | Run Pricing & Packaging Strategy, verify competitor prices, and decide the launch price. | Founder | Playbooks → Pricing & Packaging Strategy |
| 15 | Review every launch-kit output in the Library; replace each [ADD …] placeholder and (verify) mark with real facts. | Founder | Library |

## Weekly cycle

**When:** Every week · Monday review, Friday wrap-up  
**Goal:** Measure, learn, and ship this week's marketing from one place.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Store CRM: clear the Inbox, compare reply rates by category and campaign, and run one A/B test that changes ONE thing (subject, message, channel, timing or segment). Raise daily caps only if bounces and unsubscribes stay low. | Head of Growth | Store CRM |
| 2 | Founder branding: post your own thinking (not company news) on X daily and LinkedIn daily, in your own voice. Be where Saudi merchants and agencies are; don't spread across every channel. | Founder | Outside the dashboard (hPanel / app stores) |
| 3 | Monday: log last week's values for every weekly KPI. | Each KPI owner | KPIs |
| 4 | Monday: run KPI Report & Analysis and agree the one bottleneck to fix this week. | Head of Growth | Playbooks → KPI Report & Analysis |
| 5 | Monday: pick 1–2 experiments that target that bottleneck and write them as a Knowledge note (hypothesis, metric, owner). | Head of Growth | Knowledge |
| 6 | Generate this week's Social Media Post Pack and schedule the posts. | Content | Playbooks → Social Media Post Pack |
| 7 | Generate or refresh an Outbound Email Sequence for the persona in focus and load it into the sending tool. | Sales | Playbooks → Outbound Email Sequence |
| 8 | Daily: open the Sales pipeline, review and send the AI drafts, and clear everything under "Needs you". | Founder | Sales pipeline |
| 9 | Daily: clear AI Support's "Needs you" list; Friday: turn repeated questions into new help articles. | Customer Success | AI Support |
| 10 | Check app store listings (Salla, Shopify, Zid): reply to every review, note rating changes. | Marketplace Manager | Outside the dashboard (hPanel / app stores) |
| 11 | Monday: run the AI weekly operations brief, plan the week's goals with the AI planner, and clear Operations "Needs you" (deadlines, incidents, tasks waiting on a person). | Founder | Operations |
| 12 | Friday: import new requests from Support into Product, let AI group them, approve or decline AI-suggested ideas, and update what's Now / Next. | Founder | Product |
| 13 | Friday: add Knowledge notes for new objections, wins, lost deals and competitor moves. | Sales + Customer Success | Knowledge |
| 14 | Friday: clear the Library: everything generated this week is reviewed, used, or deleted. | Head of Growth | Library |

## Monthly review

**When:** First working day of the month  
**Goal:** Check unit economics and plan next month's content and spend.

| # | Step | Owner | Where in the dashboard |
|---|---|---|---|
| 1 | Send the monthly newsletter to contacted, replied, customer and not-now stores; review Onboarding stores stuck on a checklist step. | Head of Growth | Store CRM |
| 2 | Check the sales engine: close rate on opportunities over 20% (below 18% = fix the demo, not the lead volume), LTV:CAC at 3:1 or better, and how many deals were lost to the status quo. | Founder | Sales pipeline |
| 3 | Pricing: price on value (designer cost saved), not on our cost. Review the month's discounts: over 10% must have been traded for a case study, logo rights, a public post or a yearly prepay. | Founder | Finance |
| 4 | Teams & roles: deactivate anyone who left, check the activity log for unexpected changes. | Founder | Teams & roles |
| 5 | Log the monthly KPIs: ARPA, churn, NRR, CAC, merchant ROAS, creatives per product. | Head of Growth | KPIs |
| 6 | Run KPI Report & Analysis on the month and share it with the team. | Head of Growth | Playbooks → KPI Report & Analysis |
| 7 | Generate next month's Content Calendar. | Content | Playbooks → Content Calendar |
| 8 | Refresh the Paid Ads Campaign: kill losers, brief new creatives and angles. | Performance marketer | Playbooks → Paid Ads Campaign |
| 9 | Update the SEO Content Plan and publish the planned articles. | Content | Playbooks → SEO Content Plan |
| 10 | Refresh Competitor Battlecards with this month's competitor notes. | Sales | Playbooks → Competitor Battlecards |
| 11 | ROAS results: import each beta and paying store's ad results, write an AI case study for every clear win, and log Merchant ROAS to KPIs. | Customer Success | ROAS results |
| 12 | Finance: add the month-end bank balance, paste the bank statement for AI to categorise, then run the AI monthly finance report and act on its decisions. | Founder | Finance |
| 13 | Clear Team & hiring: every candidate screened by AI, interviews booked, decisions logged, rejections sent. | Founder | Team & hiring |
| 14 | Update the Brief with anything that changed: pricing, features, markets, proof points. | Founder | Brief |

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
| 8 | Review the org chart on a 2×2 of repeatability × judgment: repeatable work with little judgment → autonomous AI agent; work needing judgment → AI co-pilot where a person approves each step. Confirm which roles truly must be human before hiring. | Founder | Team & hiring |
| 9 | Founder-led sales: the founder takes the sales calls until the pitch, price and demo close reliably (20%+). Starter and Growth stay self-serve (Salla app, trial, onboarding flow); people only sell Scale and Enterprise. | Founder | Sales pipeline |
| 10 | Update KPI targets on the KPIs page to match the new plan. | Head of Growth | KPIs |
