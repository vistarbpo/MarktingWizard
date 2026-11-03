# Market intel

Grow → **Market intel** (route `intel`, access module `intel`). It keeps DPA AD's view of the market in one place: competitors, market signals, why deals are won or lost, how big the market is, and a weekly brief. AI writes a first draft of the brief, and a person approves it. Nothing in this module makes up a number, a competitor price or a customer.

Code: `web/lib/intel.js` (rules, maths, page watch, brief checks, sample rows), `web/lib/intelroutes.js` (HTTP), `web/public/intel.js` (page). Tests: the `intel …` tests at the end of `web/test/app.test.js`.

## Tabs

### Signals
A feed of market items. Each one has a title, a source link, a date, a type, tags (themes), an impact (low/med/high) and a linked module. The types are:

- competitor move
- platform change (Meta, Snap, TikTok, Google, Salla or Zid; you must pick the platform)
- regulation
- customer request
- win/loss reason
- trend

**Quick add** is on the right of the tab. **Import** reads from four places:

- Sales: lost deals that have a reason (lost deals with no reason are counted as skipped)
- Support: tickets tagged `feature-request`
- Product: feedback that hasn't been dismissed
- Store CRM: replies the AI triage labelled `question`, `not_now` or `not_interested`

Each source item becomes a signal only once, matched by its origin (`deal:<id>`, `ticket:<id>`, …). To import from a source, your role needs view access on that module. Counts by theme (tag), type and platform are shown, and a theme can be clicked to filter the feed.

### Competitors
Each competitor record holds:

- name, site and segment
- platforms supported
- **pricing tiers exactly as read on their page**, with the source link and the date read (a tier without a source is refused)
- positioning, strengths, weaknesses, notes, and the date a person last checked them

Every edit adds a line to the competitor's **change log** (`field: before → after`). People can also add notes to the log, such as "launched in UAE", with a source link.

**Page watch:** this is optional and off for each competitor until switched on.

- **Fetching:** the watched page (their public pricing or landing page) is fetched only through `safeGet` in `products.js`. That means public addresses only, the DNS is checked on every hop and at connect time, 8 s timeout, about 2 MB, 2 pages at a time. Each page is fetched **at most once a week**, by the 6-hourly scheduler or by "Check page now".
- **What is stored:** the page's text lines, a SHA-256 hash, and a trimmed snapshot of up to 8,000 characters. The first check only saves this baseline.
- **When the hash changes:** a change is recorded with a summary (lines added and removed, and the prices on the page before and after) and waits for review. Each unreviewed change shows as a need on Home until someone presses **Mark reviewed**.
- **Changing the URL** starts a new baseline.
- **Refusals:** private, loopback or link-local addresses are refused, and the refusal is shown on the competitor.

### Win/loss
This tab reads Sales deals at **Paying** (won) and **Lost**. It shows:

- each deal's reason (`won_reason` or `lost_reason`) and the competitor named
- the win rate, the number lost to the status quo (the same rule as the Sales close rate) and how many deals have no reason
- bar charts by reason and by competitor

You can edit the reason and the competitor in the table. The edit is saved to the deal through the Sales API, so it needs Sales edit access. Without Sales view, deal names are shown as `Deal #id`.

### Market sizing
TAM, SAM and SOM in stores and in ARR. **Every input is typed by a person, with its source.** Empty inputs give no result, and nothing is estimated for you. The inputs are:

- stores on Salla, Zid, Shopify (Saudi) and other platforms
- % of those stores running ads (gives TAM)
- % of ad-spending stores we can serve today (gives SAM)
- % of SAM we can win in 3 years (gives SOM)
- the plan mix (% of customers on each plan)

The blended ARPA comes from the `PLANS` list prices in `sales.js`, and only when the plan mix adds up to 100%.

**Path to $100M ARR** shows the stores needed on each plan, using list price × 12, plus the blended mix and its share of SAM and TAM. Yearly billing at 2 months free needs about 20% more stores.

### Weekly brief
"Draft the brief" (English or Arabic) collects the last 7 days of data. Each item gets a reference:

- `S<id>`: a signal
- `C<id>`: a competitor change
- `D<id>`: a deal won or lost

The **AI Market analyst** gets only these items. It is told to summarize only them, cite each bullet with its reference and write `[ADD]` wherever something is missing.

`checkBrief()` then checks the draft for three things: references that aren't in the data, bullets with no reference, and numbers that aren't in the data. The AI's text is kept only if it cites this week's items and cites nothing that isn't there. Otherwise (and with the demo provider) the draft is the **factual list built from the data**, with `[ADD]` where the analysis is needed.

A person edits the draft and approves or rejects it. A draft that cites an unknown item can't be approved. Approved briefs are locked and kept.

## AI Workforce and Ask DPA AD
- **Agent `market_analyst`** ("AI Market analyst", team Marketing, max level 1: drafts only). All `/intel` routes are attributed to it.
  - Outcomes: **accepted** (approved unchanged), **edited** (approved after edits) or **rejected**.
  - **escalated** when its text was unusable and the factual list was used instead.
  - At level 0 (off) no brief can be drafted.
- **Ask DPA AD tools:**
  - `list_market_signals` (read, module `intel`)
  - `add_market_signal` (write, risk low, with a preview; it waits for Confirm unless the Coordinator is at level 2)

## Command Center
The intel needs on Home:

- a watched page changed and isn't reviewed yet (one need per competitor)
- a weekly brief is waiting for approval

People whose role can't see `intel` don't get them (`MOD["Market intel"] = "intel"`).

## Access
| Role | Market intel |
|---|---|
| Owner, Admin, Team lead, Team member | Edit |
| Creative, Viewer | View |
| Finance | None |

`ensureRoles` adds the module to roles saved before it existed.

## Data
- **Collections in `db.json`:** `intel_competitors` (with `watch`: hash, snapshot, last check, error), `intel_changes`, `intel_signals`, `intel_briefs`. Sizing inputs are stored on `ws.intel.sizing`.
- **Deleting a workspace** clears its `intel_*` rows.
- **Sample data** adds two "Sample ·" competitors and five "Sample ·" signals, and gives sample deals win/loss reasons. Signals imported from sample records are flagged as samples too. "Remove sample data" deletes them all.
- **Env vars:** no new ones.

## For the founder to confirm
1. Which competitors to track, and whose public pages DPA AD may fetch weekly. Check each site's terms; the bot identifies itself as `DPA-AD-bot (+https://dpa.ad)`.
2. The market sizing inputs and their sources (Salla/Zid store counts, % running ads, serviceable share, plan mix). There are no defaults.
3. Whether Creative should keep view access, and whether Finance should get view access.
4. Who reviews page changes and approves the weekly brief each week.
