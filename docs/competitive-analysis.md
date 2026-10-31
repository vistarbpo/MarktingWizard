# DPA AD: who earns more than us, and why

*Research date: 31 Oct 2026. Sources are listed per company. Figures marked **(unverified)** come from third-party sites or estimates, not the company itself; check them before quoting. Several vendor sites could not be opened directly, so some prices come from search extracts.*

## The short answer

The companies that capture far more value per customer than a design tool do three things:

1. **They charge on the customer's ad spend, not just product count.** Smartly charges a % of media spend (G2 lists "% fee of media spend"; ~2–5% with a ~$5k/month minimum per third parties, **unverified**) and manages $6–7B+ of spend for 700–800+ brands. Their revenue grows every time a client's budget grows, with no new sale.
2. **They prove ROAS, not just looks.** Creative testing and performance analytics (Marpipe multivariate tests, Hunch "Insights" ranking products by ROAS, Smartly predictive pre-testing, Socioh A/B tests). This turns "nice design" into "more sales", which justifies higher prices.
3. **They become infrastructure in a platform or channel.** Feedonomics sold to BigCommerce for ~$145M; Shopify invested in Triple Whale; Salla bought Sweply and launched **Salla Ads**. The commerce platform is both the best channel and the likely buyer.

On top of that they:
- monetise add-ons (Marpipe charges for hourly sync, languages, product video and design support)
- sell to agencies with unlimited seats and accounts
- become official Meta / TikTok / Snap partners

## Company comparison

| Company | What it sells | Pricing (basis) | Scale | Sources |
|---|---|---|---|---|
| **Smartly** | Enterprise ad automation + creative + media | % of media spend; ~$4–5k/mo minimum **(unverified)** | 700–800+ brands, $6–7B+ spend managed; ~$101M revenue 2025 **(unverified)** | smartly.io, businesswire.com/news/home/20250903884575/en/, g2.com/products/smartly/pricing, admanage.ai/blog/smartly-io-pricing |
| **Celtra** | Enterprise creative automation incl. DPA on Meta/TikTok/Snap/Pinterest/X | Not public; seats / impression volume | >$50M revenue (2021), profitable since 2017 | goodwinlaw.com (2021 STG deal), celtra.com/platform/dpa/ |
| **Productsup** | Enterprise feed infrastructure | Not public | 60% ARR growth, 120% net revenue retention (2022) | venturebeat.com (Productsup $70M) |
| **Feedonomics** | Managed feed service | Not public | Acquired by BigCommerce ~$145M (2021) | wsgr.com |
| **Hunch** | Dynamic creative + media buying; mid-market/enterprise | ~€2–2.5k/mo, scales with spend **(unverified)** | 100+ customers (2022); €4M round 2022 | hunchads.com, seedblink.com |
| **Confect** | Catalog-ad design for Meta/TikTok/Snap; SMB–mid | Local $299 / Pro $499 / Global $999 per month (G2); 50% off Local under $5k Meta spend | 7,500+ marketers (claim) | g2.com/products/confect/pricing, confect.io |
| **Marpipe** | Feed management + catalog creative + testing | Free feed management; Startup $199/mo for 500 SKUs; Enterprise $999–1,499 **(conflicting)**; paid add-ons | $8M Series A (2021) | apps.shopify.com/marpipe |
| **AdCreative.ai** | AI ad creatives; SMB/agencies | Starter $39, Professional $249 (credits; video only on $249+) | Acquired by Appier for $38.7M (2025) | appier.com press release |
| **Channable** | Feed management; SMB–enterprise | Packages by items/channels | 6,000+ customers; €55M Series B | helpcenter.channable.com, tech.eu |
| **Meta Advantage+ catalog** | Native | **Free**: price/shipping overlays, catalog video | — | developers.facebook.com, searchengineland.com |
| **Salla native tools** | Platform | **Free**: catalog feed link, Snap Business Extension, TikTok catalog app | 80,000+ merchants; Salla Ads launched 2025 | help.salla.sa, wamda.com |

## What it means for DPA AD

**Our opening.**
- I found no evidence that any catalog-ad vendor supports Arabic/RTL designed catalog creative, or integrates with Salla or Zid (this absence is **unverified**).
- Snap reaches 24–26M Saudis and >90% of 13–34-year-olds. TikTok is still secondary for most vendors.
- Catalog video is gated or an add-on almost everywhere.

**Our threats.**
- Meta's free overlays: we must show ROAS lift, or "designed" isn't worth paying for.
- Salla's own free feeds and **Salla Ads**. Position as the creative layer on top of Salla, not a replacement.
- Being too cheap: our Starter was $149, below Marpipe ($199) and Confect ($299) for 500 SKUs. **Raised to $199 on 31 Oct 2026.**

**The $100M ARR reality.** Pure creative tools have mostly exited at $30–150M (AdCreative.ai, Feedonomics). Salla and Zid together have ~90k merchants. $100M ARR needs spend-based or enterprise revenue and markets beyond KSA, the way Smartly and Celtra grew, not SMB subscriptions alone.

## Changes made in the dashboard

The **DPA AD starter roadmap** (Product → Load starter roadmap) now includes:
- ROAS-by-template and creative testing
- a free feed-health checker as a sign-up funnel
- Salla catalog-feed + Snap Business Extension integration
- a Snap-first template library and partner application
- GCC multi-market catalogs (SAR/AED/KWD, Arabic/English)
- seasonal template packs (Ramadan, White Friday, National Day)
- an agency workspace
- a managed tier priced on ad spend

The pricing recommendation (`docs/dpa-ad-pricing.md`) has a new section with the proposed changes.

## Decisions for the founder

1. **Done: Starter raised from $149 to $199** (equal to Marpipe Startup, still below Confect). Offer founding stores 30% off for 12 months instead of a low list price.
2. **Add a Performance tier for large retailers and agencies:** ~2% of catalog ad spend managed through DPA AD, minimum $2,000/month. Mirrors Smartly/Hunch; their numbers are unverified, so test with 3 accounts first.
3. **Keep video in Growth.** Competitors gate it, so it's our clearest upgrade reason.
4. **ROAS proof:** the dashboard now has ROAS reporting from exported ad results (Results page); build it into the DPA AD app next, after the Salla app. Without it, Meta's free overlays are "good enough" for many stores.
5. **Distribution: Salla/Zid app stores first, GCC agencies second, enterprise retailers third.** Apply to Snap's partner program and TikTok Marketing Partners (Creative) early. Treat Salla as partner, channel and possible acquirer.

## To verify before acting

- Confect plan limits
- Hunch and Smartly spend-based pricing
- Marpipe Enterprise price
- whether any competitor supports Arabic text
- the Salla/Zid app revenue share for developers
- Meta, TikTok and Snap partner-programme requirements (official pages were blocked during research)
