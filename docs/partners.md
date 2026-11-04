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
2. a partner's **coupon** (section 9): a Billing customer that redeemed it, or a CRM store whose `coupon_code` (typed at signup, kept by the lead hook) belongs to a partner. Company coupons attribute nobody, so the next rule decides;
3. the Paid Ads lead hook (`/hooks/ads/lead/<secret>`): a `ref` field, or the `dpa_ref` cookie when the form posts from the browser, stored on the CRM store as `ref_code` (first touch wins);
4. `utm_campaign` on the CRM store equal to a code.

Deals inherit from a store that links to them; Billing customers inherit from their CRM store, then from their deal (after their own manual or coupon attribution). A customer referrer never earns from its own account. Rows show the source (`manual`, `coupon`, `ref`, `utm`, `via store`, `via deal`) and the code (the referral code, or the coupon code).

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

## 9. Coupons

Partners → **Coupons** (and a Coupons section on each partner page). Code: `web/lib/coupons.js`, `web/lib/couponroutes.js`; collections `partners_coupons`, `partners_redemptions`.

A coupon is a code a partner gives to stores (or a company promo code with no partner, e.g. Ramadan). It (1) gives the customer a discount on its subscription invoices and (2) attributes the customer to the partner.

**The coupon**: code (A–Z, 0–9 and `-`, 4–20 characters; typed in any case, Arabic-Indic digits accepted; unique across the dashboard, referral codes included, except that a partner's coupon may repeat its own referral code: that is the default suggestion "Suggest a code from the partner's link"), partner (optional), discount `percent` (1–100) or `fixed` (amount + SAR or USD), duration `once` (first invoice) / `months` (N billing months, 1–36, from the first discounted invoice) / `forever`, plans (all, or a list from `PLANS`), cycles (monthly, yearly or both), first-time customers only (default yes), max redemptions in total (optional), valid from / until (Riyadh days, inclusive), status active or paused (**expired** is worked out from valid until), an internal note, and a change log. Customers keep the terms they redeemed (a snapshot): later edits apply to new redemptions only. A redeemed coupon can't be renamed, moved to another partner or deleted (pause it); a partner whose coupon was redeemed can't be deleted (set it to Ended).

**Redemption** (one per customer, no stacking):

- In Billing: when a customer is created (field "Coupon code"; a refusal stops the creation) or later from the customer drawer ("Apply coupon", with a preview of the next invoice: base, discount, VAT, total).
- From the signup form: the Paid Ads lead hook takes a `coupon` field and keeps it on the CRM store as `coupon_code` if the coupon is live then (first one wins). When a Billing customer is created from that store (or its deal), the coupon is redeemed if it still qualifies; otherwise the customer is created and the reason is shown.
- Refused, with the reason in English and Arabic: unknown, paused, expired, not yet valid, plan or cycle not covered, fixed amount in another currency, limit reached, already used by this customer, not a first-time customer, customer already has a coupon, sample coupon on a real customer.
- **First-time** = never billed: no issued invoice, not added as "already billed", and no other customer record with the same domain that was billed or used a coupon.
- **Remove** (Billing Edit): before the first discounted invoice is issued, the redemption is removed as if it never happened (drafts lose the discount; it doesn't count to the limit). After it, issued invoices keep their discount and only future invoices change ("stopped"; it still counts as used).
- Paused or expired coupons stop new redemptions only; customers who already redeemed keep their discount for its duration.

**On invoices**: the coupon is the invoice's document discount "Coupon <CODE>", VAT on the amount after it; overage is never discounted; percent coupons also discount proration (upgrade) invoices; voiding a discounted invoice gives its month back; account credit still applies after the coupon. All the rules are in `docs/billing-zatca.md` section 3a.

**Attribution and commission**: a redemption with a partner attributes the customer to that partner (source `coupon`, after a person's choice and before `ref`, the cookie and `utm_campaign`, section 3). Commission is computed from what the customer actually paid before VAT (Billing payments), so a 20% coupon lowers the commission base by 20%. A partner never earns on a coupon it doesn't own; company coupons earn nobody.

**Public check** for the dpa.ad signup form: `GET /hooks/coupon/<code>` (before the login wall). Answers only `{ valid, reason_code, discount: { type, value, currency, duration, months }, plans, cycles, message: { ar, en } }`, never the partner, the number of redemptions or notes. Invalid codes get the same shape with `valid: false`, `discount: null` and one of `unknown_or_inactive` (unknown, paused or sample), `expired`, `not_yet_valid`, `limit_reached`. CORS only for https origins on the partners allowlist (Settings; default `dpa.ad` and subdomains); 30 checks per 10 minutes per IP; `no-store`. It can't check plan, cycle or first-time rules (the store isn't known yet): Billing checks them at redemption.

**Reports** per coupon: redemptions, active customers, total discount given (issued invoices, before VAT, SAR), and MRR at list price vs paid while coupons run. Money only with Billing or Finance view.

**Permissions**: coupons need Partners View to see and Partners Edit to create or edit; applying or removing on a customer needs Billing Edit (Owner, Admin, Finance by default); a coupon above **50%** or **forever** needs the **Owner** (checked on the server; a default to confirm). Every create, edit, apply and remove is in the activity log.

**Command Center** (with the Partners module): partner coupons expiring within 7 days while the partner is signed or active; coupons at 90% or more of their max redemptions.

**Ask DPA AD**: `list_coupons` (read) and `create_coupon` (write, risk medium, confirm card; the Owner rule applies).

**Data**: coupons hold no personal data; redemptions hold a customer id only (no names, emails or phones), so data requests need nothing new. Sample data adds `SAMPLE-RAMADAN` (company coupon, 20% for 3 months) and `SAMPLE-AGENCY10` on the sample agency, redeemed by one sample Billing customer; sample coupons never go on real customers or answer the public check; all removed with Remove sample data. Deleting a workspace clears its `partners_*` rows, coupons included.

## 10. For the founder to confirm

- Commission terms per partner type (default none; e.g. % and months, or a bounty) and whether bounties are clawed back on refunds (not done today).
- VAT on commissions paid to Saudi partners and withholding tax for non-resident partners (`[CONFIRM]` with the accountant).
- Whether negative months (refunds larger than commission) carry forward (today such a statement can't be approved).
- The referral cookie notice on dpa.ad (PDPL) and the click retention period.
- The signup form on dpa.ad sends the code as `ref` (it can read `utm_campaign` from the landing URL) to the lead hook.
- Coupons (defaults chosen, to confirm): percent coupons also discount proration (upgrade) invoices, fixed ones don't; overage is never discounted; no exchange rate for fixed coupons (one coupon per currency); above 50% or forever is Owner-only; "first-time" = never billed and no billed or coupon-using record with the same domain; paused/expired coupons keep running for customers who already redeemed; a manual attribution beats a coupon; 100% coupons issue zero-value invoices (ask the accountant).
- The signup form on dpa.ad calls `/hooks/coupon/<code>` to show the discount, and sends the code as `coupon` to the lead hook.
