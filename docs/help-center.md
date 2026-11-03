# Help center

Customers → Help center (route `helpcenter`, access module `helpcenter`) and the public site at `https://<PUBLIC_URL>/help`. Code: `web/lib/helpcenter.js`, `web/lib/helpcenterroutes.js`, `web/public/helpcenter.js`. Tests: the `help center …` tests at the end of `web/test/app.test.js`.

AI does every step it can (drafting articles from support answers and resolved tickets, translating, finding topics with no article, flagging stale and unhelpful articles); people write, review and publish.

## 1. Help center vs the AI Support knowledge base

AI Support's knowledge base (`support_articles`, AI Support → Help center) is **internal**: it is what the support AI answers from, and it can hold internal notes. Nothing from it is ever shown on the public site. A help article can point to the support article it came from (`support_article_id`), but its text is its own and only appears publicly after a person publishes it.

## 2. Articles

Fields: title and body in Arabic and English (either language may be empty; at least one complete language to publish), slug (the link `/help/a/<slug>`, made from the English title, unique per workspace), category, visibility, related articles (up to 6; only published ones show), linked support article, author, reviewer, last reviewed date (Riyadh day), votes, and a change log.

Categories (also their public URL `/help/<id>`): `getting-started`, `connecting-salla`, `connecting-zid`, `catalogs-and-feeds`, `ad-designs`, `video-ads`, `publishing` (Meta, Snap, TikTok, Google), `billing`, `account-and-team`, `privacy-and-security`, `troubleshooting`.

Body: a small markdown subset rendered on the server by `renderMarkdown()`. Everything is HTML-escaped first, so no user HTML reaches a page. Supported: `#`–`####` headings (rendered as h2–h4; the title is the page's only h1), `-` lists, `1.` lists, `**bold**`, `*italic*`/`_italic_`, `` `code` ``, fenced code blocks, links `[text](https://…)` (or `/help/…` and `/changelog/…`; external links get `rel="noopener noreferrer"`), images `![alt](/media/<file>)` (Creative Studio media) or `https://`. Anything else (`javascript:`, `data:`, `http:`, other paths) is shown as plain text.

**Lifecycle:** draft → in review → published → archived. Allowed moves: draft → in review / archived; in review → draft / published / archived; published → draft / archived; archived → draft.

- **Reviewer ≠ author.** Publishing needs Help center Edit, and the reviewer must be a different person than the author. The Owner may publish their own articles (setting "The Owner may publish their own articles", on by default; switch it off and the Owner needs a reviewer too). Enforced on the server.
- An article with `[ADD …]` left in it can't be published.
- **Published text is locked.** Title, body and slug can't change while published; move it back to draft (it leaves the site) to edit, then review again. Category, visibility and related articles can still change.
- A published article can't be deleted: archive it first.
- **Visibility "customers only"** is a placeholder until DPA AD has customer logins: such an article is treated as unpublished on the public site (404, not in search, the sitemap or the support chat).

## 3. The public site (`/help`, before the login wall)

- `/help` (Arabic by default; `?lang=en` for English), `/help/<category>`, `/help/a/<slug>`, `/help/search?q=…`, `/help/sitemap.xml`.
- Only **published, public** articles of the site's workspace exist there; everything else answers 404 (drafts, in review, archived, customers-only, unknown slugs, empty categories).
- **Which workspace:** the one chosen in Help center → Settings ("Show this workspace on the public site", Owner/Admin only; stored as `help_site.workspace_id` in `db.json`), else the first workspace. Deleting the chosen workspace falls back to the first.
- An article missing the page's language shows in the other language with a note.
- **Search** is on the server over published articles, both languages. Arabic is normalised: tashkeel and tatweel removed, أ/إ/آ/ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي; words also match without the "ال" prefix; English is case-insensitive. Every word of the query must match; title matches rank higher. 60 searches a minute per address.
- **"Was this helpful?"** is a plain HTML form (no JavaScript). It stores counters only: one row per article per Riyadh day with yes/no counts. No IP, no cookie, no personal data is stored. One vote per address per article per day (kept in memory only) and 20 votes per 10 minutes per address; more are ignored.
- **"Still need help?"** links to the AI Support website chat (`/support/<key>`) when it is switched on (AI Support → Website chat), else to a `mailto:` of the contact email in Help center → Settings, else it is hidden.
- **Security:** self-contained HTML (no app scripts, no tracking, no external fonts). `Content-Security-Policy: default-src 'none'; style-src 'nonce-…'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` (no scripts at all; the only style block carries a fresh nonce), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Pages are cached 60 seconds; search and "thanks" pages are not.
- Brand: the workspace's company name and the Creative Studio brand kit's primary and accent colours; light and dark follow the device.
- Every page links to the public Changelog ("ما الجديد / What's new", `docs/changelog.md`), which shares this shell (`web/lib/publicsite.js`) and this workspace.

## 4. AI Help writer (agent `help_writer`, Customer Success, max level 1)

Drafts only. Every call is attributed to the agent and counts against its budget; switched off (level 0) it gives the plain draft with no AI call.

- **Draft from a support article** (Articles → Draft with the AI Help writer) or **from resolved tickets** (Gaps → Draft from N resolved tickets, or Ask DPA AD). Only resolved tickets are used (their answers were checked by a person); emails and phone numbers are replaced by `[email]` / `[phone]` before the AI sees them. The AI writes Saudi Arabic and English JSON from the sources only, with `[ADD]` for gaps. The draft is kept only if every number in it appears in the sources (for billing articles, the draft prices from `PLANS` are added to the sources) and it has no HTML; otherwise the plain draft is used: the source's own words plus `[ADD]`.
- **Translate** AR → EN or EN → AR (button on each language). Kept only if it has the same numbers and the same links as the original; else a `[ADD translation]` template. A person edits and applies it, or discards it.
- **Gaps:** support tickets of the last 90 days grouped by topic (keywords for Salla, Zid, the ad platforms, privacy and video first, then the ticket's support category; feature requests skipped) where no published public article in that category exists.
- Outcomes: a published AI draft counts as accepted (unchanged) or edited; a deleted or archived one as rejected; a used translation as accepted or edited, a discarded one as rejected; a draft or translation that failed its checks as escalated.

## 5. AI Support citations

The support chat (public website chat, the team's AI draft reply, and comment/DM drafts from Creative Studio) gets a `<published_help_articles>` block: title, URL `https://<PUBLIC_URL>/help/a/<slug>` and a short excerpt of each published public article (at most 30). The reply may end with one of those links; it is told never to link anything else. Drafts, archived and customers-only articles are never in the list.

## 6. Command Center needs (label "Help center", hidden without Help center View)

- **Help articles to re-review:** published articles whose last review is 180+ days old. "Still correct (re-reviewed)" on the article resets it.
- **Help articles marked not helpful:** 3+ "no" votes in the last 30 days.
- **Help center gaps:** a topic with 5+ tickets in 90 days and no published article.

## 7. Access

New module `helpcenter`. Defaults: Owner, Admin, Team lead, Team member and Creative edit; Viewer view; Finance none. `ensureRoles` adds it to existing roles. Choosing the public site's workspace needs the Owner or Admin (Teams & roles edit).

Ask DPA AD: `list_help_articles` (read: articles, totals, gaps) and `draft_help_article` (write, low risk, after a Confirm: AI draft from a support article, tickets or a gap topic).

## 8. Data

Collections `help_articles`, `help_votes` (counters only) and `help_site` (the public site's workspace) in `db.json`; settings (`contact_email`, `owner_self_publish`) on `ws.help`. Deleting a workspace removes its `help_*` rows. Sample data: three published "Sample ·" articles (Arabic and English) and one draft, removed with Remove sample data (with their votes).

No new env vars (links use `PUBLIC_URL`).

## 9. To confirm (founder)

- Who reviews and publishes (default: anyone with Edit except the author; the Owner may self-publish).
- The 180-day re-review, the 3-in-30-days "not helpful" and the 5-tickets-in-90-days gap thresholds (constants at the top of `helpcenter.js`).
- The contact email for "Still need help?", or switch on the website chat.
- Whether `/help` should move to its own domain (e.g. `help.dpa.ad`) and be linked from dpa.ad; until then it is served from the dashboard host.
- Customers-only articles wait for customer logins.
- Article copy about features that are still planned (e.g. the Salla and Zid apps): say "coming soon" until they are live.
