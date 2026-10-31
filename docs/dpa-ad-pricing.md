# DPA AD: Pricing Strategy

**Goal:** $100M ARR · **Current price:** $99/month flat · **ICP:** ecommerce brands with 20+ SKUs running catalog ads

## 1. Why $99 flat can't get you there

| | |
|---|---|
| $99/mo × 12 | $1,188 ARR per customer |
| Customers needed for $100M | **~84,000 paying brands**, all at once, net of churn |
| Typical SMB SaaS monthly churn | 3–5%, so you'd need to win ~30–40k new brands **every year** just to stay flat |

A flat price also leaves a lot of money on the table. A 25-SKU Shopify store and a 40,000-SKU retailer
running Meta + TikTok + Google pay the same, even though the big one gets 1,000× the value. Your
biggest customers are subsidised, and there's no natural path to expansion revenue.

**The fix:** charge on a **value metric** that grows with the customer, keep a cheap entry point,
and add tiers where the real money is.

## 2. Value metric: active SKUs (plus video renders)

Price on **active products in the synced catalog**, and meter **video renders** as the second axis.

- It grows as the brand grows (more products → more ad spend → more value from DPA AD).
- It's easy to understand and to check: "How many products do you have?"
- It lines up with your cost: video rendering is your most expensive compute, so meter it separately.
- Channels (Meta, TikTok, Google, Pinterest, Snap) gate tiers, not usage.

Avoid **% of ad spend** as the main metric: buyers dislike it and it's hard to verify. It's fine as an
enterprise option.

## 3. Recommended tiers

Annual billing = 2 months free (~17% off). Prices are in USD.

| | **Starter** | **Growth** ⭐ | **Scale** | **Enterprise** |
|---|---|---|---|---|
| Monthly | **$149** | **$449** | **$1,299** | **from $4,000** |
| Annual (per mo) | $124 | $374 | $1,083 | custom (annual only) |
| Active SKUs | up to 500 | up to 5,000 | up to 50,000 | unlimited |
| Channels | 1 (Meta) | 3 | all | all + custom feeds |
| Image templates | 5 | unlimited | unlimited | unlimited + custom design |
| Video renders / mo | 25 | 250 | 1,500 | custom pool |
| Catalogs / stores | 1 | 2 | 10 (multi-market) | unlimited |
| Creative A/B testing | – | ✓ | ✓ | ✓ |
| Auto-localisation (language/currency) | – | – | ✓ | ✓ |
| Seats | 2 | 5 | 15 | unlimited, SSO |
| Support | email | chat | dedicated CSM | CSM + SLA + API |
| **Best for** | small DTC brands, 20–500 SKUs | scaling brands on 2–3 channels | multi-market retailers | large retailers, marketplaces |
| **Upgrade trigger** | 2nd channel or >500 SKUs | video at scale, more markets | SSO, API, volume | – |

**Why these numbers:**
- **Starter at $149** (not $99): still the cheapest designed-catalog tool in the category, and the
  limits push brands that are growing up to Growth. Keep current $99 customers grandfathered for 12
  months so you don't churn them.
- **Growth at $449** is the "hero" plan. Anchor the pricing page on it.
- **Scale/Enterprise** is where $100M comes from (see §5). Brands spending $50k+/month on ads won't
  blink at $1–4k/month for creative that lifts catalog ROAS.

### Add-ons (expansion revenue)
- **Extra video renders:** $49 per 100
- **Extra SKUs:** $99 per 1,000 above the tier limit (or a prompt to upgrade)
- **Done-for-you template design:** $499 one-off per brand kit
- **Additional store/market:** $99/mo
- **Agency plan:** from $999/mo for 10 client workspaces, then $79/workspace, with white-label exports

## 4. Free trial and onboarding offer
- **14-day free trial, no card**, on the brand's real catalog (capped at 100 SKUs, watermarked video).
  Seeing their own products in designed ads is the "aha" moment, so get it in under 10 minutes.
- Skip a forever-free plan at first. It eats render costs and attracts brands under 20 SKUs that aren't your ICP.

## 5. Revenue model to $100M ARR

| Segment | Customers | ARPA / yr | ARR |
|---|---:|---:|---:|
| Starter | 3,000 | $1,600 | $4.8M |
| Growth | 3,500 | $5,000 | $17.5M |
| Scale | 2,000 | $15,000 | $30.0M |
| Enterprise | 450 | $70,000 | $31.5M |
| Agency plans | 400 | $15,000 | $6.0M |
| Add-ons & overage | – | – | $10.2M |
| **Total** | **~9,350** | **~$10.7k blended** | **$100M** |

That's **~9k customers instead of 84k**. 60%+ of ARR comes from Scale, Enterprise and agencies, so the
GTM has to add a sales-assisted motion for 5k+ SKU retailers alongside product-led self-serve.

**Health targets:** net revenue retention ≥ 115%, logo churn under 2.5%/mo on Starter and under 1%/mo
on Scale and up, CAC payback under 12 months.

## 6. Competitor price check (⚠️ verify before publishing)

These figures are from memory and change often. **Check each one on the competitor's pricing page.**

| Competitor | Model (as last known) | Your angle |
|---|---|---|
| Confect | Tiered, SMB-friendly, priced by product count | Match on entry price; win on video + more channels |
| Marpipe | Higher-priced, sales-led, aimed at mid-market/enterprise | Same "designed catalog" outcome, self-serve, a fraction of the price |
| Hunch | Enterprise, custom quotes | Faster set-up; transparent pricing |
| Canva + designer | ~$15/mo + designer hours | Doesn't scale past ~50 SKUs and doesn't auto-update prices |

## 7. Pricing experiments (first 90 days)
1. **Starter price:** $129 vs $149 vs $179 on new sign-ups. Metric: trial→paid × 6-month retention.
2. **Annual discount:** 2 months free vs 20% off. Metric: % choosing annual.
3. **Anchor:** show Scale first vs Growth first. Metric: Growth+ mix.
4. **Video as an add-on vs bundled** on Growth. Metric: ARPA and activation.
5. **Grandfathered $99 users:** offer Growth at 30% off for 12 months. Metric: upgrade rate and churn.

## 8. Pricing page copy

> **Every product. Designed. Automatically.**
> Turn your catalog into scroll-stopping image and video ads. Start free, no card needed.

- **Starter:** "Make your catalog ads look like a brand, not a spreadsheet."
- **Growth:** "Images and video across Meta, TikTok and Google. Our most popular plan."
- **Scale:** "Every market, every language, every SKU, kept in sync."
- **Enterprise:** "Custom templates, API and SSO for large catalogs."

## 9. Rollout checklist
- [ ] Verify competitor pricing (§6)
- [ ] Instrument SKU count, channels and renders per account
- [ ] Grandfather existing $99 customers for 12 months and email them 30 days ahead
- [ ] Launch the new pricing page and run experiments 1–2
- [ ] Hire or assign one AE for 5k+ SKU and agency leads

---
*Regenerate or iterate with the engine:* `mwiz new examples/dpa_ad_brief.json` then `mwiz run <id> pricing_strategy`
