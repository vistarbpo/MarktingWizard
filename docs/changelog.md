# Changelog ("What's new")

Product → Changelog (route `changelog`, access module `product`) and the public page at `https://<PUBLIC_URL>/changelog`. Code: `web/lib/changelog.js`, `web/lib/changelogroutes.js`, `web/public/changelog.js`; the shared public shell is `web/lib/publicsite.js` (also used by `/help`). Tests: the `changelog …` tests at the end of `web/test/app.test.js`.

AI does every step it can (drafting customer-facing notes from a shipped release, translating, finding who asked for it, writing the notice emails); people review, publish and press Send.

## 1. Where it lives and who can use it

- Its own page in the **Product** menu group (Roadmap & releases, Changelog). Chosen over a Product tab because entries have their own lifecycle, editor, requesters and settings, like the Help center.
- Permission reuses the **Product** module: Owner, Admin, Team lead and Team member edit; Viewer views; Finance and Creative have no access. Sending a notice also needs **Store CRM Edit**.

## 2. Entries

Fields: title and body in Arabic and English (at least one complete language to publish), type (`new`, `improved`, `fixed`, `announcement`), tags (platforms `salla`, `zid`, `meta`, `snap`, `tiktok`, `google`; areas `templates`, `video`, `catalogs`, `publishing`, `billing`, `account`, `ai`, `arabic`; at most 8), date (Riyadh day, default today), linked release, linked roadmap items (up to 20), an optional image from Creative Studio media (`/media/<file>.png|jpg|webp|gif` only), slug (`/changelog/<slug>`, from the English title, unique per workspace), author, reviewer and a change log.

Body: the Help center's safe markdown (`renderMarkdown()`: everything escaped first; links https, `/help…` or `/changelog…`; images `/media/…` or https).

**Lifecycle** (same rules as the Help center): draft → in review → published → archived; in review → draft; published → draft / archived; archived → draft.

- **Reviewer ≠ author.** Publishing needs Product Edit and a different person than the author. The Owner may publish their own entries (Changelog → Settings, on by default).
- An entry with `[ADD …]` left in it can't be published.
- Published text is locked (title, body, slug, type, date, image); move it back to draft to edit (it leaves the site until reviewed again). Tags and links still edit.
- A published entry can't be deleted: archive it first. Deleting a release or a roadmap item clears the link and keeps the entry's text.

## 3. Public page (before the login wall)

- `/changelog` (Arabic by default, `?lang=en`), filters `?type=` and `?tag=` (unknown values 404), 20 per page (`?page=`), `/changelog/<slug>`, `/changelog/rss.xml` (RSS 2.0 with `atom:link`), `/changelog/feed.json` (JSON Feed 1.1). Both feeds take `?lang=en`; the newest 30 entries; media and links made absolute with `PUBLIC_URL`.
- Only **published** entries of the public site's workspace exist; drafts, in review and archived entries answer 404 and never appear in the feeds.
- **Workspace:** the same as the public Help center (Help center → Settings, `help_site.workspace_id`, else the first).
- An entry missing the page's language shows in the other language with a note.
- `/help` pages link to "ما الجديد / What's new"; `/changelog` pages link back to the Help center.
- **Security:** the Help center's headers (CSP `default-src 'none'; style-src 'nonce-…'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, nosniff, `X-Frame-Options: DENY`, strict referrer). No scripts, no inline `style=` attributes, no tracking. Pages cached 60 s, feeds 300 s. Brand colours from the Creative Studio brand kit.

## 4. From releases

When a release is **approved and released** in Product → Releases, its card shows **Draft changelog entry** (or a link to its entry). Changelog → Entries also lists "Shipped releases without an entry". Nothing is drafted automatically.

The draft is linked to the release and its roadmap items; its type and tags come from fixed rules (only bugs → Fixed; any feature or integration → New; else Improved; tags from item areas and platform words in titles). One entry per release (the API takes `force` to redraft).

## 5. AI Release notes writer (agent `release_writer`, team Product, max level 1)

Drafts only; every call is attributed to the agent and counts against its budget. Switched off (level 0) it gives the factual draft with no AI call.

- **Sources:** the release (version, date, notes) and its roadmap items (title, type, area, problem) only. Feedback and customer names are never sent to it.
- Writes Saudi Arabic first, then English, benefit-led, markdown, JSON reply.
- **Checks:** every number must appear in the sources (dates are numbers too); no HTML; no requester name (feedback on the linked items) and no tracked competitor name (Market intel). A failed check is logged as **escalated** and the **factual draft** is used instead: the item titles with `[ADD …]` for the customer-facing words.
- **Translate** AR↔EN per language (checked: same numbers and links, else an `[ADD translation]` template); a person applies or discards it.
- "Rewrite with AI from the release" redoes a draft's text from its links.
- Outcomes: a published AI draft = accepted (unchanged) or edited; archived/deleted/rewritten = rejected; translation used = accepted/edited, discarded = rejected.

## 6. Feedback loop: telling the stores that asked

On an entry with linked roadmap items, **Who asked for this** lists the feedback (`product_feedback`, not dismissed) on those items, one row per store. A requester is matched to a Store CRM store by, in order: the feedback's `store_id` (new optional field when adding feedback), the support ticket it was imported from (contact email, store, name), or the feedback's customer text as a CRM store name, domain or email.

- **Notify** (only once the entry is published, because the email links to it) creates **one draft email per ready store** (`changelog_notices`): Arabic first, then English, with the public link. Skipped and listed with the reason: not in the Store CRM ("tell them yourself"), sample stores, do-not-contact, unsubscribed, bounced, no email, or already has a notice.
- A person edits and presses **Send through the Store CRM**: it goes through `sendOne()` with every outreach rule (Test mode by default: logged as a `test` message, not sent; opt-outs and bounces re-checked; unsubscribe link and header; sample stores never sent). In Live mode it is refused outside 09:00–21:00 Riyadh time and on Fridays. Needs Store CRM Edit. `[ADD]` blocks sending.
- Email only (WhatsApp would need an approved template).

## 7. Command Center (label "Changelog", hidden without Product View)

- **Shipped releases without a changelog entry:** released in the last 90 days, 3+ Riyadh days ago, with no entry (any status counts as handled).
- **Changelog entries waiting for review:** in review for 3+ days.

Constants `SHIP_DAYS`, `SHIP_LOOKBACK`, `REVIEW_DAYS` at the top of `changelog.js`.

Ask DPA AD: `list_changelog` (read: entries, totals, shipped releases and their entry) and `draft_changelog_entry` (write, low risk, after a Confirm: AI draft from a shipped release).

## 8. Data

Collections `changelog_entries` and `changelog_notices` in `db.json`; settings (`owner_self_publish`) on `ws.changelog`. Deleting a workspace removes its `changelog_*` rows. Sample data: three published "Sample ·" entries (Arabic and English) and one draft linked to the sample release, removed with Remove sample data (real entries keep their text; links to sample releases and items are cleared).

No new env vars (links use `PUBLIC_URL`).

## 9. To confirm (founder)

- Who reviews and publishes (default: anyone with Product Edit except the author; the Owner may self-publish).
- The 3-day thresholds and the 90-day look-back for releases.
- The tag list (platforms and areas) and the type names in Arabic.
- Whether requesters may be emailed about a feature they asked for (PDPL legal basis; they are existing contacts who gave the feedback), and the wording of the notice email.
- Whether `/changelog` should get its own domain (e.g. `changelog.dpa.ad`) and be linked from dpa.ad.
- Entries about features that are not live yet should say "coming soon" or wait until they ship.
