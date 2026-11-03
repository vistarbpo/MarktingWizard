# Paid Ads

The Paid Ads module (sidebar: Grow → Paid Ads, access module `ads`) runs **DPA AD's own** ad campaigns on Meta (Facebook/Instagram), Snapchat and TikTok, with Google Ads optional. The goal is to win Salla/Zid store owners at a known cost per lead, trial and paying store.

Code: `web/lib/ads.js` (logic), `web/lib/adsapi.js` (platform APIs), `web/lib/adsroutes.js` (routes, OAuth, the 6-hour scheduler), `web/public/ads.js` (page). Tests: the "Paid Ads:" tests in `web/test/app.test.js`.

## Safety rules

- **Test mode by default** (per workspace). In Test mode nothing changes on any ad platform:
  - Guardrails log what they *would* do.
  - "Create" saves the exact API requests Live mode would send.
  - The 6-hour schedule doesn't pull.
  - A person can still press "Pull insights now" (read-only), and OAuth connect lists ad accounts.
- Only approvers (Owner, Admin, Team lead) can:
  - switch Test/Live
  - change budgets, FX rates and guardrail rules
  - approve or reject plans
  - create campaigns
  - activate campaigns
  - apply guardrail actions
- **Campaigns are always created PAUSED** (TikTok: `operation_status: DISABLE`). They are never activated automatically. A person turns them on in Ads Manager, or presses "Activate on <channel>…" (approver, Live, confirm dialog).
- Guardrails act on their own only in Live mode **and** when the AI Budget pacer is at level 2 in AI Workforce. At level 1 each hit becomes a "needs a person" item. It shows in Budgets & rules and in Command Center.
- Tokens are sealed at rest with AES-256-GCM, reusing Creative Studio's `seal()` and `TOKEN_KEY`. They never leave the server.
- AI never invents numbers:
  - Budgets in a plan are always derived from the typed budget × percentages.
  - Copy the AI couldn't write is `[ADD]`, and a plan with `[ADD]` can't be approved.

## Setup per platform

Register each redirect URL in the platform's developer app. The Accounts tab shows each URL with a copy button. Put env vars in hPanel → Node.js → Environment variables.

### Meta (Marketing API)

1. Use the **same Meta app** as Creative Studio (`META_APP_ID`, `META_APP_SECRET`). Add the **Marketing API** product.
2. Add the redirect URI `https://wizard.dpa.ad/oauth/ads/meta/callback` under Facebook Login → Valid OAuth Redirect URIs.
3. Permissions requested: `ads_read`, `ads_management`, `business_management`.
4. App Review: all three need **Advanced Access**, plus Business Verification.
   - Until then, only people with a role on the app (admin, developer, tester) can connect, and only for ad accounts they manage. Rate limits are at Standard Access.
   - Set `META_ADS_REVIEWED=1` after approval, to clear the "needs app review" note.
5. Two ways to connect:
   - **Connect Meta Ads** asks for the ads permissions on the same app.
   - **Use Creative Studio's Meta login** reuses Studio's token when it already carries `ads_read`. Meta permissions add up per person and app, so after one ads login both work.
6. Optional, in Accounts → Conversion setup:
   - **Meta Page id**: ad creatives post as this Page. Default: Creative Studio's selected Page.
   - **Pixel / dataset id**: ad sets then optimise for `COMPLETE_REGISTRATION`, `LEAD` or `PURCHASE`. Without it, they optimise for link clicks.
7. Disconnecting revokes only `ads_management`, so Creative Studio keeps working.

### Snapchat (Marketing API)

1. In Snapchat Business Manager → Business Details → OAuth apps, create an app with the redirect URI `…/oauth/ads/snap/callback`.
2. Set `SNAP_CLIENT_ID` and `SNAP_CLIENT_SECRET`. The scope is `snapchat-marketing-api`.
3. Snap approves Marketing API access per app. Set `SNAP_ADS_APPROVED=1` after approval.
4. Access tokens last 30 minutes and are refreshed automatically.
5. Creation makes the campaign and ad squads paused. **Ads are added by a person in Ads Manager**, because Snap media must be uploaded to Snap first. The plan lists which Studio media to use.

### TikTok (Business API, separate from content posting)

1. Create a developer app at business-api.tiktok.com/portal/apps. It is a **different app** from Creative Studio's TikTok Login Kit app.
2. Pick the scopes Ad Account Management, Ads Management and Reporting.
3. Set the advertiser redirect URL to `…/oauth/ads/tiktok/callback`.
4. Set `TIKTOK_ADS_APP_ID` and `TIKTOK_ADS_SECRET`. TikTok reviews the app before other advertisers can authorize it. Set `TIKTOK_ADS_APPROVED=1` after.
5. Tokens don't expire until revoked.
6. Creation makes the campaign and ad groups off. **Ads are added by a person in Ads Manager**, because they need an identity and an uploaded video.

### Google Ads (optional, behind a flag)

Google Ads is reporting only: build Google campaigns in Google Ads.

1. Set `ADS_GOOGLE=1`. Reuse `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (enable the Google Ads API). Add the redirect URI `…/oauth/ads/google/callback`.
2. Set `GOOGLE_ADS_DEVELOPER_TOKEN`, which comes from a manager account's API Center.
3. Optional: `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (the manager account) and `GOOGLE_ADS_VERSION` (default `v21`).
4. Until the developer token gets Basic access, only test accounts work. Set `GOOGLE_ADS_BASIC_ACCESS=1` after.
5. The scope `adwords` is sensitive, so the OAuth consent screen needs Google's verification.

### Leads with UTMs

- Set `ADS_LEAD_SECRET`. The signup form or landing page POSTs to `https://wizard.dpa.ad/hooks/ads/lead/<ADS_LEAD_SECRET>` with:

  ```json
  {"store_name": "...", "email": "...", "phone": "...", "domain": "...", "url": "<landing URL with utm_ params>", "signup": true}
  ```

- This creates or updates the CRM store:
  - tags `inbound` and `ads`
  - stage `engaged`, or `onboarding` when `signup` is true
  - the first-touch UTM
- UTMs can also be set by API:
  - `PUT /api/workspaces/:ws/ads/attribution/contacts/:id` for a CRM store
  - `PUT /api/workspaces/:ws/ads/attribution/deals/:id` for a Sales deal
  - body: `{url}` or `{source, campaign, ...}`

## How it works

- **Insights:**
  - Ad-level, daily, normalised to one row shape: spend, impressions, clicks, reach, frequency, leads, signups, purchases.
  - The first pull goes back to the start of last month; later pulls refresh the last 7 days, for late conversions.
  - Pulled every 6 hours for Live workspaces.
  - Re-pulls and re-imports replace rows (one key per entity per day). API rows win over CSV rows for the same channel and day.
- **CSV fallback:** export from each Ads Manager by day, at campaign, ad set or ad level. The channel is detected from the columns. Meta's "Results" column fills the configured result type.
- **Money:**
  - Everything is shown in SAR.
  - USD uses 3.75 (pegged). Any other account currency needs a typed rate in Budgets & rules; until then its rows aren't counted, and a warning shows.
- **Pacing** (per channel and in total, Riyadh month):
  - projected = spend so far ÷ days elapsed × days in month
  - **Over** when spend has reached the budget, or the projection is more than the tolerance (default 10%) over it
  - **Under** when the projection is more than the tolerance under it, after day 3
- **Attribution:**
  - CRM stores and Sales deals carrying a UTM (`utm` field, or `landing_url`) are matched to a channel by `utm_source`: meta, facebook, ig and instagram → Meta; snap → Snapchat; tiktok; google.
  - They are matched to a campaign when `utm_campaign` equals the campaign name written as a UTM.
  - A deal linked to a CRM store counts once.
  - Trial: deal at Trial/Paying, or store Onboarding/Active/Churned. Paying: deal Paying, or store Active.
- **Finance:**
  - After every pull or import, spend becomes one Finance expense per month and channel, upserted by key (`ads:<channel>:<month>`).
  - Fields: category `marketing`, `source: "ads"`, one-off, VAT 0 (see the platform invoice).
  - No duplicates. Amounts update. A deleted import removes its share. Finance CAC and LTV:CAC use these.
- **Creative rotation:**
  - Ads made from a plan carry `[cs:<Studio item id>]` in their name, so results map back to Creative Studio content.
  - Ranked by cost per result, then CTR.
  - **Fatigue** = frequency up 15%+ and CTR down 15%+, this 7 days vs the previous 7, with 1,000+ impressions in each window.
  - Suggestions (rule-based, plus the AI's) become Studio "idea" items with one click.

## Guardrail defaults

The starter rules are seeded the first time Budgets & rules opens. Approvers can edit them.

| Rule | Default | State |
|---|---|---|
| Pause ad sets with no results | after SAR 300 spent in 7 days with 0 results | **on** |
| Pause ad sets when cost per result is too high | max cost and minimum spend left blank for you to set; 7-day window | off |
| Cap each ad set's daily spend | cap left blank | off |

- A rule can't be switched on without its numbers.
- The same action isn't repeated within 7 days. Caps are checked once per day.
- Ad sets that came from CSV can't be acted on through the API. They always need a person: "Done by hand" or "Dismiss".

## AI Workforce agents (team Marketing)

| Agent | Max level | Level 1 | Level 2 | Outcomes recorded |
|---|---|---|---|---|
| AI Media buyer (`ads_media_buyer`) | 1 | drafts plans; a person approves; created paused | — | plan approved unchanged → accepted, after edits → edited, rejected → rejected |
| AI Budget pacer (`ads_pacer`) | 2 | alerts / needs a person | applies pause and cap rules in Live | auto (applied alone), accepted (a person applied or did it by hand), rejected (dismissed), error |
| AI Creative rotator (`ads_rotator`) | 1 | suggests | — | idea created → accepted, dismissed → rejected |

## Tested only with mocks

Every platform call goes through an injected `fetchImpl`. The tests mock all of them, and none has run against a real account yet. Items to check live first, all marked `// verify against current docs` in `adsapi.js`:

- **Meta:**
  - `is_adset_budget_sharing_enabled` on campaign create
  - `link_data.picture` vs `image_hash`
  - minimum daily budgets per currency
  - interest / work-position search types
  - `account_status` codes
- **Snapchat:**
  - stats field names (`conversion_sign_ups`, `uniques`, a leads metric)
  - hour-aligned start/end times in the account timezone
  - PUT-whole-entity updates
  - `optimization_goal` values
  - the minimum ad squad budget
- **TikTok:**
  - advertiser auth URL and `auth_code` callback
  - report metric names (`registration`, `complete_payment`, `form`)
  - Saudi Arabia `location_ids` (`102358`)
  - `optimization_event` values
  - the minimum ad group budget
  - the revoke endpoint
- **Google:** GAQL fields and the API version.
- **Not yet tested live at all:** OAuth round-trips, token refresh, and scheduler timing on Hostinger.
