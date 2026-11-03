# Partners & referrals

Grow → Partners & referrals (route `partners`, access module `partners`). Code: `web/lib/partners.js`, `web/lib/partnersroutes.js`, `web/public/partners.js`. Tests: the `partners …` tests at the end of `web/test/app.test.js`.

AI does every step it can (counting clicks, matching referrals, computing commissions, drafting statements and emails); people sign partners, attribute what the rules can't see, approve and pay statements, and send emails.

## 1. Partners

Types: agency, freelancer / creator, platform partner (Salla/Zid app stores, Salla Partners), tech partner, reseller, customer referrer (customer refers customer, linked to a Billing customer).

Fields: name, type, contact (name, email, phone), country/city, status (prospect → talking → signed → active → paused → ended), owner, agreement (commission %, recurring months, flat bounty in SAR, tier), contract (link or Creative Studio media id), notes, optional Store CRM store (needed to send emails from the CRM), and a change log of every edit. The Partners tab shows the pipeline board by status; click a card for the partner page.

A partner with an approved or paid statement can't be deleted (set it to Ended).

## 2. Referral links

Each partner gets a code and a link `https://<PUBLIC_URL>/r/<code>` on creation; more codes can be added (3–32 characters, lowercase letters, digits, dashes, unique across the dashboard), each with an optional landing page.

`/r/<code>` (before the login wall):

- records a click: a SHA-256 hash of (random salt, IP, Riyadh day), so one visitor counts once a day; the browser family (Chrome, Safari…); repeats only increase `hits`. Bots and link previews (WhatsApp, Facebook…) are not counted. No raw IP, no other personal data. At most 60 recorded clicks a minute per IP.
- sets the first-party cookie `dpa_ref=<code>` (default 60 days, HttpOnly, SameSite=Lax, Secure).
- redirects (302) to the code's landing page, else the default landing page (`https://dpa.ad`), adding `utm_source=partner&utm_medium=referral&utm_campaign=<code>`.
- **No open redirect:** a landing page must be https on a host in the allowlist (Settings; default `dpa.ad` and its subdomains), checked when saved and again on every redirect; no `user@host`; query parameters such as `?to=` are ignored. Unknown or switched-off codes go to the default page with no cookie.

## 3. Attribution

A CRM store, Sales deal or Billing customer is attributed to a code by, in this order:

1. a person's choice (Attribution tab);
2. the Paid Ads lead hook (`/hooks/ads/lead/<secret>`): a `ref` field, or the `dpa_ref` cookie when the form posts from the browser, stored on the CRM store as `ref_code` (first touch wins);
3. `utm_campaign` on the CRM store equal to a code.

Deals inherit from a store that links to them; Billing customers inherit from their CRM store, then from their deal. A customer referrer never earns from its own account.

Per partner: clicks, leads (attributed stores plus deals not already counted through a store), trials, paying customers, and MRR referred (only for roles with Billing view).

## 4. Commissions and statements

Computed only from Billing (`billing_payments`, `billing_invoices`); nothing is typed or invented:

- **Percent:** commission % of each paid payment before VAT (payment × taxable / total of its invoice), for payments in the first *recurring months* counted from the month of the customer's first payment.
- **Bounty:** the flat bounty once, dated the customer's first payment.
- **Refunds:** a credit note on an invoice whose payment earned commission takes the same % off its amount before VAT.

Statements (SAR, one per partner per month): **Draft statements** for a month picks every line dated in or before that month that no other live statement holds (so a late payment lands on the next statement); repeating it refreshes the draft. Draft → **approved** (Owner or Finance Edit; total must be above 0) → **paid** with date and bank reference (Owner or Finance Edit). Paying posts one Finance expense (`source: "partners"`, category Marketing & ads, `statement_id`), never twice. Draft or approved statements can be voided with a reason (their lines become free again); paid ones can't.

VAT and withholding on commissions are shown as a `[CONFIRM]` note and are not computed.

## 5. Partner portal

Optional read-only page `/p/<token>` per partner (random 32-character token): link(s), clicks, leads, trials, paying, and approved and paid statements. Customer names only when Settings → "Show customer names on partner portals" is on (default off). A new link replaces the old one; Revoke stops it. 30 requests per 10 minutes per IP; `noindex`, `no-store`.

## 6. AI Partnerships manager

Agent `partnerships_manager` (team Sales, max level 1, budget $10/month). Drafts a partner outreach email, an onboarding email (link and agreed terms) and the monthly partner update (this month's clicks, counts and the latest statement), Saudi Arabic first then English. Facts come only from the partner record and computed numbers; a reply with any number not in the facts, or not in the expected JSON, is replaced by the plain template (logged as *escalated*). `[ADD]` marks what's missing. Outcomes: *Copy and mark used* unchanged = accepted, edited = edited, *Discard* = rejected. Sending only through the Store CRM's `sendOne()` (partner linked to a CRM store, Store CRM Edit, no `[ADD]` left, Test mode logs only, sample and opted-out stores never sent, 09:00–21:00 Riyadh, not Friday).

## 7. Permissions

| Role | Partners | Money (agreement, MRR, statements) | Approve / pay |
|---|---|---|---|
| Owner, Admin | Edit | yes | yes (Finance Edit) |
| Team lead | Edit | yes (Billing view) | no |
| Finance | Edit | yes | yes |
| Team member | View | no | no |
| Creative | None | – | – |
| Viewer | View | yes (Billing view; MRR only with Billing view) | no |

Money is shown with Billing or Finance view; MRR referred only with Billing view. Changing an agreement needs Billing or Finance view.

## 8. Command Center, assistant, data

- Needs: statements waiting for approval; approved statements unpaid after 14 days; signed or active partners with no clicks or referrals for 30 days (from their status change). Hidden without the module.
- Ask DPA AD: `list_partners` (read), `add_partner` (write, confirm card).
- Data register entry `partner_contacts`; data requests find partners by contact email or phone, export them with their drafts, and delete clears the contact fields and redacts notes and drafts. Partners, codes and statements stay (accounting records).
- Sample data: two "Sample ·" partners with clicks and one draft statement (a sample line, not a real payment); removed with Remove sample data.

## 9. For the founder to confirm

- Commission terms per partner type (default none; e.g. % and months, or a bounty) and whether bounties are clawed back on refunds (not done today).
- VAT on commissions paid to Saudi partners and withholding tax for non-resident partners (`[CONFIRM]` with the accountant).
- Whether negative months (refunds larger than commission) carry forward (today such a statement can't be approved).
- The referral cookie notice on dpa.ad (PDPL) and the click retention period.
- The signup form on dpa.ad sends the code as `ref` (it can read `utm_campaign` from the landing URL) to the lead hook.
