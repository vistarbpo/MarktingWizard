# Arjun's masterclass rules, adapted for DPA AD

Source: notes from *Arjun's Onam Special Masterclass for Startup Founders* (27 Aug 2026, Kochi). The YouTube recording couldn't be opened from the build environment, so only the written notes were used. The numbers are Arjun's benchmarks, not DPA AD data: the dashboard swaps in our own rates once there is enough history.

## Built into the dashboard

| Rule | Where it lives now |
|---|---|
| Cold outbound: ~5% connect, ~10% of those become meetings; work backwards from the meetings you need | **Store CRM → Overview → "Work backwards from your goal"**. Enter new customers per month; it shows stores to contact, messages per working day and whether sending capacity is enough. Uses the benchmarks until 200 stores are contacted, then our own reply, meeting and close rates. |
| Opportunity-to-close must exceed 20%; below 18% the sales process is broken | **Sales pipeline → Close rate** tile (deals that reached a demo or later). Under 18% after 10+ closed opportunities, it appears in "Needs you" and on the Command Center. |
| Losing to the status quo is more common than losing to a competitor | Close rate counts deals lost to "staying with Canva / manual / not now". SOP setup step: log it as the lost reason. |
| CAC:LTV healthy at 1:3 | **Finance → unit economics**: LTV and LTV:CAC, with a monthly churn assumption you can edit (default 3%). Below 3:1 shows in Finance "needs". |
| Pricing isn't tied to cost; tie it to a KPI the customer saves | AI sales drafts compare the price with the designer cost the store saves. SOP monthly pricing review. |
| Discount over 10%: ask for a public post; trade discounts for multi-year, case study or logo rights | Big-deal "close" steps in Sales say: trade it, don't give it. Every AI sales draft follows the rule. SOP monthly check of the month's discounts. |
| Experiment one variable at a time (cadence, persona, channel, touchpoints, intent) | **Store CRM → Campaigns → A/B test**. Pick the one thing to test. Version B splits the segment with A (no store gets both), the page warns if B changes more than that one thing, and it reports reply rates with a significance check. |
| Intent signals as a proxy for buyer readiness | Intent tags raise a store's fit score: `running-ads`, `inbound`, `referral`, `visited-site`, `hiring-marketer`, `new-collection`, `seasonal`. Example: check the Meta Ad Library and tag stores already running ads. |
| Autonomous agent vs co-pilot (repeatability × judgment) | SOP quarterly org review uses the 2×2. The CRM already works this way: sends and triage are autonomous; replies stay co-pilot (a person approves) unless you switch on AI auto-answers for simple questions. |
| Founder branding is a must; LinkedIn daily, X ~3/day; be where buyers are | SOP weekly step: X and LinkedIn daily in your own voice. Saudi merchants and agencies are on X; LinkedIn reaches agencies and investors. |
| Buyers are becoming agents: docs, API pages and help center get evaluated first | SOP setup step: public help center, clear pricing page and API docs. |
| B2B validation = find the customer champion; one person ready to pay is a strong signal | SOP setup step: find the champion, then the 2nd and 3rd "yes". |

## Adapted or not adopted, and why

- **"B2C is a marketing problem; WhatsApp outreach hits spam limits."** DPA AD sells to businesses but at consumer-like volume (30k Salla stores). So we do both: outbound in the CRM, plus app-store and paid marketing. WhatsApp is limited to opted-in stores, which also avoids the spam limits.
- **"100 calls a day per SDR."** DPA AD's outbound is AI-first (email + WhatsApp), not phone. The same funnel math is used, with messages instead of calls.
- **"Seat-based pricing is under threat; platform pricing will replace it."** Already true for us: plans are priced by catalog size (SKUs), not seats. The proposed spend-based Performance tier goes further in the same direction.
- **"In the US, tie price to a cost-reduction KPI."** Applied to Saudi stores as SAR saved on design and higher ROAS, using the ROAS results page once real data exists.
- **"X ~3 posts/day."** Kept as an upper bound, not a target. Daily, in your own voice, beats volume. The note itself says AI-written content is detectable.
- **Market-size figures ($6.3T, $2.1T, 10-year adoption curve).** Context only; not used in any calculation.

## What the numbers say today

At the benchmarks, 20 new customers a month needs about 20,000 stores contacted a month (20 ÷ 20% close ÷ 10% meetings ÷ 5% replies). Your 30k Salla list would last about six weeks at that pace, and sending capacity would have to be ~9× today's caps. The useful levers are the rates, not volume: one A/B test at a time on reply rate, and a demo good enough to close 20%+ of meetings.
