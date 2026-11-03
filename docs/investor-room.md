# Investor room

Settings → Investor room (route `investors`, access module `investors`). It runs the fundraise: the investors you talk to, the round, a metrics pack built from the dashboard's own numbers, a data room you share one investor at a time, who looked at what, and the monthly investor update.

The rule matters more here than anywhere else: **no invented numbers, customers, quotes or traction.** A metric with no data says "No data yet" (never 0 and never an estimate). Valuation and cap terms stay marked `[CONFIRM]` until a person confirms them. The founder always writes the lowlights.

## Who can use it

| Role | Default |
|---|---|
| Owner | Edit |
| Admin | View (change it in Teams & roles) |
| Team lead, Team member, Finance, Creative, Viewer | None |

Roles without the module get **404** on every investor route, so the module looks like it isn't there. The menu hides it and the Command Center leaves its items out. Restricted Legal documents can only be added by an Owner or Admin (and only when they tick "share restricted"). The activity log records every share-link creation, change and revocation, and every data-room change.

## Pipeline

Each investor has a name, kind (VC fund, angel, corporate, accelerator, family office, other), firm, contact, stage (target → intro → first call → diligence → term sheet → committed, or passed), check size range, thesis notes, warm-intro path, owner and next step with a date. You can also link meetings from Meetings and documents from the data room. Notes and a change log are kept. The board shows one column per stage.

## Round

Each round has a name, instrument (SAFE, convertible note, priced round), status, target and close date. **Committed** adds up the amounts a person typed on investors at the Committed stage. An investor at Committed with no amount is counted separately as "without an amount". Valuation cap, pre-money and discount are typed by a person and show `[CONFIRM]` until someone presses "Confirm the terms". Changing a term asks for confirmation again.

## Metrics pack

The pack reads live values from each module's own functions. No logic is copied: it uses the OKR metric definitions (`okr.js` `METRICS`, `metricContext`), `financeSnapshot()` and the Sales `summary()`.

| Metric | Source | No data yet when |
|---|---|---|
| MRR, ARR | Billing subscriptions, or Finance recurring income logged | neither exists. If Sales only has an estimate from paying deals, it isn't shown |
| MRR growth (MoM) | Billing MRR today vs 30 days ago | no Billing customers, or no MRR 30 days ago |
| Paying stores | Billing, or Sales deals at Paying | none |
| NRR, logo churn (30 days) | Billing | no stores paying 30 days ago |
| NPS (90 days) | Customer success answers | no answers |
| Gross margin | Finance | no MRR, or no cost of revenue logged |
| CAC | Finance unit economics | no marketing spend this month, or no new paying store in 30 days |
| LTV, LTV:CAC | Finance unit economics (uses the churn % set in Finance settings, as its note says) | no MRR or cost of revenue |
| Cash, gross burn, net burn, runway | Finance | no bank balance or no expenses. "Not burning" when revenue covers costs |
| Sales pipeline | Sales open deals at list price (not weighted) | no open deals |
| Releases shipped (30 days) | Product releases marked released (plus changelog entries published, in the note) | no release ever |
| Team | Team & hiring active human roles, AI Workforce active agents, India payroll count | no active human role |

Every metric shows its source and an as-of date. Tick the metrics you want and press **Freeze**. A frozen snapshot is a stored copy: later changes never alter it, and the API refuses to edit it (409). It can only be deleted while it isn't in the data room or an update. If sample data is loaded, the snapshot's label says "(includes sample data)".

## Data room

There are six folders: Company, Financials, Product, Legal, Team and Market. Each item is one of these:
- **Legal document:** points at a Legal vault document with a file. A restricted document needs the Owner or Admin and the "share restricted" tick. If a shared document later becomes restricted, it is no longer served until someone adds it again on purpose.
- **Metrics snapshot:** a frozen snapshot.
- **Investor update:** only an approved update.
- **Uploaded file:** PDF, Word, PNG, JPEG or text, up to 20 MB, checked by its bytes. Stored in the Legal module's private folder `DATA_DIR/legal` (same `saveLegalUpload`), so it is in every backup. Never under the public `/media/` path.
- **Link:** `https://` only.

## Share links `/i/<token>`

Links are per investor. Each one has:
- an expiry date (Riyadh day, at most 365 days)
- an optional passcode, stored only as a scrypt hash. A correct passcode sets an HttpOnly cookie scoped to that link's path for 12 hours. Changing the passcode ends the cookie
- the folders and single items it shows
- download yes/no
- revocation at any time

The pages use the shared public shell (`publicsite.js`): no scripts, a CSP with `default-src 'none'`, `noindex` plus `X-Robots-Tag`, `no-store`, `no-referrer`. English by default, `?lang=ar` for Arabic.

**Watermark:** every room and item page shows "Shared with <investor> · <date>" as a banner and a faint diagonal pattern behind the content. Files themselves are never modified. PDFs open in the browser through a button. Images and text show inline. Word files need downloads switched on. "View only" means there is no download button and files are served inline. This is not DRM: a viewer can still save or screenshot.

**Logging:** every room view, item view, file open and download is stored with the investor, item, action, time, a hashed IP + day and the browser family. The raw IP is never stored.

**Rate limits:** 120 requests per address per 10 minutes, and 10 passcode tries per address per link per 15 minutes.

**Unavailable links:** an unknown link gives 404; a revoked or expired link gives 410. Both show the same neutral page.

## Engagement and Command Center

Engagement shows views, opens and downloads per investor and per item, with the first and last view. The Command Center (for people with the module) shows:
- "<Investor> viewed the data room today"
- share links that expire within 3 days
- investors whose next step is past its date (not Committed or Passed)

## Monthly investor update

The **AI Investor relations** agent (Leadership team, level 1, drafts only) drafts the **Highlights** and **Asks**. Its sources are:
- a frozen snapshot (S refs)
- the quarter's company objectives (O refs)
- reviewed weekly business reviews in the month (W)
- changelog entries published in the month (C)
- releases shipped (P)
- hires (H)
- open roles (R, the only source for asks)

Every bullet must cite its sources. Every number in a bullet must appear in the sources it cites. If a bullet has an unknown source, no citation, HTML or a number not in its sources, the agent's text is dropped: you get a factual draft built from the sources, with `[ADD]`, and the agent logs an escalation. The metrics section is built by code from the snapshot. The **Lowlights** section is always an `[ADD]` for the founder.

**Approving:** approval is blocked while any `[ADD]` is left. If the agent's highlights and asks are unchanged, the outcome is recorded as "accepted"; if they were changed, "edited"; a discarded AI draft counts as "rejected".

**After approval** the update is locked. You can then:
- add it to the data room
- copy it
- download it as Markdown (source references removed)
- open it in your email app (`mailto:`)

**Sending:** the Store CRM's `sendOne()` is for stores and is not used for investors. A proper investor email channel is out of scope for now.

## Ask DPA AD

There are two tools:
- `list_investors` (read)
- `add_investor_note` (write, low risk, preview before confirm)

Both are only available to people with the module.

## Data, privacy, samples

- **Collections:** `investors_investors`, `investors_rounds`, `investors_snapshots`, `investors_items`, `investors_links`, `investors_views`, `investors_updates`, plus `investors_salt` (used for the IP hashes and the passcode cookies).
- **Deleting a workspace** removes these rows and the uploaded files.
- **Data requests (PDPL):** an investor is found by contact email or phone. Export includes the contact and notes. Delete clears the contact fields and redacts the email or phone number from the notes. Stage, round and committed amounts are kept as company records. The data register has an "Investor contacts" entry.
- **Sample data:** two "Sample ·" investors (no amounts) and one snapshot frozen from the sample data, labelled "Sample · … not real numbers". The room shows a SAMPLE banner on it. Remove sample data deletes them with their links, items, views and updates.

## For the founder to confirm

- Who besides the Owner should see the room. Admin is View by default; Finance is None.
- Retention for investor contacts and the view log (`[CONFIRM]` in the data register), and the legal basis.
- Round terms (cap, discount, pre-money) with your lawyer before pressing Confirm.
- LTV uses the churn % in Finance settings until there is churn history. Decide whether to show it to investors before then.
- Whether investor updates need a real email channel (separate sender, tracking opt-in) later.
