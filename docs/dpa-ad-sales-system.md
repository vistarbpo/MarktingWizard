# DPA AD sales system

How DPA AD finds, wins and keeps online stores. Built for small Salla and Zid merchants in Saudi Arabia, not for enterprise. Everything here runs in the dashboard (wizard.dpa.ad). Targets are ours and editable; replace them with real numbers as data comes in.

## 1. Who we sell to

**Ideal customer:** a Saudi online store on Salla or Zid that already advertises and has enough products for designed catalog ads to matter.

| Signal | Why | Where it shows |
|---|---|---|
| 30+ products (best 300+) | More products = more creatives to design = more value | Fit score, "Min products" filter |
| Ad-heavy category: fashion & abayas, perfumes & oud, beauty, electronics, jewelry, home | They already buy Snap/TikTok/Meta ads | Fit score, Category filter |
| Already running ads, on Instagram, inbound, referral, new collection | Ready to buy now | Intent tags (`running-ads`, `inbound`, `referral`, `visited-site`, `new-collection`, `seasonal`) |
| Reachable: email, WhatsApp opt-in, phone | We can actually talk to them | "Reach" column |

The buyer is usually one person: the owner, sometimes with one marketer. There is no buying committee; decisions take days, not months.

**Focus list:** the best-fit stores (default 300, set in Store CRM → Settings) get the full cadence including phone calls. Everyone else gets email and, if opted in, WhatsApp. Build it with **Stores → Build ICP list**.

## 2. How each plan is sold

| Plan | Price/month | Yearly value | How it's sold |
|---|---|---|---|
| Starter | $199 | ~$2.4k | **Self-serve.** Salla/Zid app, free samples, onboarding flow. AI outreach brings them in; no sales call needed. |
| Growth | $449 | ~$5.4k | **Self-serve + help.** Same as Starter; a call only if they ask. |
| Scale | $1,299 | ~$15.6k | **Founder sells.** Discovery call, demo on their own catalog, AI prepares the call. |
| Enterprise | $4,000+ | ~$48k+ | **Founder sells.** Custom terms, case-study rights. |

The founder takes every sales call until the pitch, price and demo close reliably at target. Hire the first salesperson only after that, and only for Scale and Enterprise.

## 3. The funnel and our targets

New → Contacted → Replied → Qualified (deal in Sales) → Onboarding → Active customer.

| Step | Our starting target | Where to see it |
|---|---|---|
| Contacted → replied | 2% (cold email) | Store CRM → Overview → planner, per category and campaign |
| Replied → meeting | 10% | Planner |
| Meeting → paying | 20%+ | Sales → Close rate tile; under 90% of target goes to "Needs you" |
| Cost to win a store | at most 50% of its first-year revenue | Finance → unit economics |
| Lifetime value : cost to win | 3 : 1 or better | Finance → unit economics |
| Gross margin | 50–70% now, 80%+ at scale | Finance |

**Work backwards:** the planner turns "new customers per month" into stores to contact, messages per working day and the sending capacity needed. It uses the targets above until 200 stores have been contacted, then our real rates.

At these targets, 20 new customers a month needs about 50,000 contacted stores, more than the whole 30k list. That's why the work is on the rates, not volume: better replies, better meetings, better demos.

## 4. Outreach cadence

**All stores (starter "Salla stores · cold outreach")**: email → email (+3 days) → WhatsApp if opted in (+4) → last email (+6). Stops the moment they reply.

**Focus list (starter "Focus list (icp) · email + WhatsApp + call")**, about 10 working days:

| Day | Step |
|---|---|
| 1 | Email: one idea for their store, ask to send 3 free samples |
| 3 | Email: follow-up, offer a 1-minute video |
| 4 | WhatsApp (opted-in only, approved template) |
| 6 | **Phone call** by a person: permission opener, 15-second hook, soft ask |
| 8 | Email: short example link |
| 10 | **Phone call**: "now, or in two months?" |

Phone steps appear in **Store CRM → Inbox → Calls to make** with the script and the store's number. Log the outcome: "Meeting booked" moves the store to Qualified and creates the deal in Sales.

**Message rules:** short (under 110 words), one soft ask (samples, a 1-minute video), never "book a 30-minute meeting" in the first touch. Arabic first, Saudi dialect, the store's own name and category.

**Sending rules:** a separate domain for cold email, warmed up for 2–3 weeks, about 150 emails a day per domain. SPF, DKIM and DMARC set. Only 09:00–21:00 Riyadh time, not Friday. WhatsApp only to stores that opted in or wrote to us.

## 5. Improving: one change at a time

Every week, run one A/B test that changes **one thing**: subject, message, channel, timing, number of steps or segment. Store CRM → Campaigns → A/B test splits the segment in half and warns if version B changes more than one thing. A winner needs 100+ contacted stores per version and a clear difference.

## 6. Calls and demos

Before a call, Sales → deal → AI **Call prep** writes:
- the 15-second script (Arabic + English)
- 5 discovery questions: how they make ad creatives today, how many products and how often prices change, which ad channels and monthly spend, what they tried, their must-haves
- the 3 DPA AD features to show for their pain, and what to skip
- likely objections

Show only what solves their problem, on their own products.

## 7. Price and discounts

- Price on the value to the store (designer cost saved, more creatives tested, better ROAS), not our cost.
- Yearly prepay gets the published annual discount.
- Discounts up to 10% are fine. Above 10%, trade, don't give: a case study, logo rights, a public post on why they chose DPA AD, or a yearly prepay.
- Losing to "we'll keep doing it by hand / in Canva" is the most common loss. Log it as the lost reason so the close-rate tile counts it.

## 8. Weekly and monthly rhythm (in the SOP)

- **Weekly:** clear the CRM Inbox and Calls; compare reply rates by category; run one A/B test; founder posts on X and LinkedIn in their own voice.
- **Monthly:** newsletter; check close rate, cost to win a store and LTV:CAC; review discounts.
- **Quarterly:** review the team on a repeatability × judgment grid. Repeatable, low-judgment work goes to autonomous AI; judgment work gets an AI co-pilot that a person approves.

## References

Shaped in part by notes from Arjun Pillai's founder masterclass (Kochi, Aug 2026) and his B2B SaaS sales guide. Those are written for mid-market and enterprise software (buying committees, $12k+ contracts, sales teams). We kept what fits small merchants (work backwards from the goal, one change at a time, intent signals, soft asks, deliverability, value pricing, discount trades, founder-led sales) and left out the enterprise parts. All targets above are DPA AD's to change.
