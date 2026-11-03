# Billing, VAT and ZATCA e-invoicing: the rules the dashboard follows

> **Verify every rule here with your accountant before going Live.** This is how the dashboard is built today,
> with the source each rule came from. It is not tax or legal advice. Sources change; ZATCA publishes updates
> to its e-invoicing rules and the XML implementation standard several times a year.

Code: `web/lib/billing.js` (subscriptions, invoices, dunning, metrics), `web/lib/zatca.js` (QR, XML, hash chain,
API adapter), `web/lib/moyasar.js` (card payments), `web/lib/qr.js` (QR image), `web/lib/billingroutes.js` (HTTP).
Page: **Finance → Billing & customers**.

## 1. Plans and prices

| Rule | Where it comes from |
|---|---|
| Prices are read from `PLANS` in `web/lib/sales.js` (Starter $199, Growth $449, Scale $1,299, Enterprise from $4,000, per month). Nothing is copied. | DPA AD pricing draft (`docs/dpa-ad-pricing.md`) |
| Yearly = 10 × monthly (2 months free). | Same |
| Enterprise may carry a custom monthly price of at least the list price. | "Enterprise from $4,000" |
| SAR = USD × 3.75 (`SAR_PER_USD`). Customers are billed in SAR by default; USD is an option. | SAMA peg; DPA AD decision |
| Render overage: Scale 15,000/month then $10 per extra 1,000; Enterprise 50,000/month then $8 per extra 1,000. Read from Finance → Pricing (`render_limit`, `overage_per_1k`), billed **per started 1,000** in arrears on the next invoice (yearly plans get a monthly overage-only invoice). | Pricing draft. *Decision to confirm: per started block vs pro-rata.* |
| MRR is in SAR before VAT: yearly plans count 1/12 of the yearly price; trials, paused and cancelled count 0. | Standard SaaS practice |

**Proration** (upgrade or downgrade mid-period): credit = old period price × remaining days ÷ period days; charge =
new period price × remaining days ÷ period days. Upgrades are charged at once on a proration invoice (+VAT);
downgrades become account credit that comes off the next invoice as a document-level discount. The preview is
shown before a person confirms. Billing-cycle changes apply from the next renewal. *Decision to confirm: whether
downgrade credit should instead wait until the period ends (no credit), which is also common.*

## 2. VAT

| Rule | Source |
|---|---|
| Standard rate **15%**. | VAT Implementing Regulations; rate in force since 1 July 2020 (Royal Decree A/638) |
| VAT is charged only when Finance → "VAT registered" is on. | ZATCA: only registered persons charge VAT |
| Mandatory registration above SAR 375,000 taxable supplies in 12 months; voluntary above SAR 187,500. | VAT Law Art. 50–51 / Implementing Regulations Art. 3 (already in `finance.js`) |
| VAT is worked out on the taxable total after document discounts (line VAT is shown per line too). Amounts round half-up to 2 decimals. | ZATCA XML implementation standard, rounding rules (BR-KSA-…); *confirm rounding approach* |
| Output VAT for the Finance VAT return comes from **issued** invoices (tax point = issue date), minus credit notes. | VAT Implementing Regulations Art. 23 (tax point: earlier of supply, invoice or payment) |
| Invoices in USD show VAT and the total in SAR too (`TaxCurrencyCode` SAR). | Implementing Regulations Art. 53(8); ZATCA XML standard (BR-KSA-68) |
| A VAT number is 15 digits starting and ending with 3. | ZATCA XML standard (BR-KSA-39/40) |
| Sales to customers outside Saudi Arabia may be zero-rated exports of services. **Not built**: every invoice uses the standard rate. | Implementing Regulations Art. 33. *Ask your accountant before billing a non-Saudi store.* |
| App-store (Salla/Zid) sales: who is the supplier for VAT (DPA AD or the platform) depends on the app-store contract. **Not decided.** | Contract + accountant |

## 3. Invoices and credit notes

* **Sequential numbers per company**: `INV-000001`, `INV-000002`, …; credit notes `CN-000001`, … Drafts have no
  number. A number is given when the invoice is issued and never reused or skipped. Prefixes are set in Billing → Settings.
  Source: Implementing Regulations Art. 53(5)(b) (sequential number that uniquely identifies the invoice).
* **Statuses**: draft → issued → paid, or void. Issued invoices are **never edited**: corrections are credit notes.
  Voiding an issued, unpaid invoice issues a credit note for what is still due; a paid invoice can only be credited.
  A void and a credit note both need a reason, kept on record. Source: Art. 54 (credit/debit notes for adjustments);
  ZATCA e-invoicing rules (tax invoices cannot be deleted or altered after issue).
* **Tax invoice contents** (printed, Arabic + English): seller name, address, VAT number and CR; buyer name (and VAT
  number and address for B2B); invoice number; issue date and supply date; description, quantity, unit price,
  discount, taxable amount, VAT rate and amount per line; totals before VAT, VAT, total with VAT; SAR amounts.
  Source: Art. 53(5) (tax invoice) and 53(7) (simplified tax invoice). Tax invoices must be in Arabic (other languages
  may be added alongside), so the printable page shows both. *Verify the article numbers with your accountant.*
* **Standard vs simplified**: an invoice is *standard* (B2B) when the buyer has a VAT number, otherwise *simplified* (B2C).
  Source: E-invoicing Resolution and XML standard (`InvoiceTypeCode` name `0100000` vs `0200000`).
* **Credit note**: type code 381, references the original invoice number and gives the reason. Source: XML standard
  (BR-KSA-17, BR-KSA-56).
* Not VAT-registered: invoices are plain invoices without VAT, QR or ZATCA data.
* **Record keeping**: keep invoices for at least 6 years (VAT Law Art. 66; longer for some records). Data lives in
  `db.json`; **there are no backups yet** (see CLAUDE.md open items).

## 4. ZATCA phase 1 (generation): the QR code

Every tax invoice of a VAT-registered seller carries a QR code: base64 of a TLV list (tag byte, length byte, UTF-8 value):
1 seller name, 2 VAT number, 3 time stamp (ISO 8601), 4 total with VAT, 5 VAT total. Our test checks ZATCA's own
example ("Bobs Records", 310122393500003, 2022-04-25T15:30:00Z, 1000.00, 150.00) byte for byte, and the QR image
(drawn as SVG, error correction level M) was decoded back with a QR reader during development.
Source: ZATCA "E-Invoicing Detailed Guidelines" and the "QR code" section of the XML Implementation Standard.
Phase 1 applies from 4 December 2021 to all VAT-registered persons.

## 5. ZATCA phase 2 (integration): prepared, not connected

Built:
* **UBL 2.1 XML** per invoice/credit note in ZATCA's profile (`reporting:1.0`): UUID, ICV (invoice counter), PIH
  (previous invoice hash), QR, supplier/customer parties (CRN, address, VAT), delivery date, payment means,
  allowances, the tax total twice (once in SAR), monetary totals and lines. Download from the invoice (`/xml`).
* **Hash chain**: each document's hash is SHA-256 (base64) of its XML without `UBLExtensions`, `Signature` and the QR
  reference; the next document carries it as PIH. The first PIH is base64 of the SHA-256 hex of "0"
  (`NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==`).
* **ICV** counts every document (invoices and credit notes) of the company, starting at 1.
* **API adapter**: clearance (standard, before the invoice is shared) and reporting (simplified, within 24 hours) to
  `…/invoices/clearance/single` and `…/invoices/reporting/single` with `Accept-Version: V2` (*verify against current
  docs*). Test mode logs and never calls ZATCA; Live is **blocked** until signing exists.

Not built (needed before Live):
1. **Canonicalization**: ZATCA hashes the C14N 1.1 form of the XML. Our XML is generated in one fixed form, so hashes
   are stable, but they must be checked with the **ZATCA SDK / Fatoora validator** before going Live.
2. **XAdES signing** with the CSID's private key (ECDSA secp256k1) and the signed properties in `UBLExtensions`,
   plus the phase 2 QR tags 6–9 (hash, signature, public key, certificate signature) on simplified invoices.
3. Clearance responses: store the cleared XML ZATCA returns for standard invoices and share that version.

**Founder task: onboarding.** Phase 2 applies by "waves" ZATCA announces by revenue; DPA AD is told by ZATCA at least
6 months before its wave. Steps: register the solution as an EGS unit on the Fatoora portal, generate a CSR, get the
compliance CSID with the portal OTP, pass compliance checks in the sandbox/simulation, then get the production CSID.
Set `ZATCA_ENV`, `ZATCA_CSID`, `ZATCA_CSID_SECRET` in hPanel and track the step in Billing → Settings → ZATCA.

## 6. Payments

* **Manual** (bank transfer, cash, other): a person records it on the invoice. Partial payments are allowed.
* **Card (Moyasar)**: on issue, a Moyasar invoice (payment link) is created through `POST /v1/invoices`
  (amount in halalas/cents, Basic auth with the secret key). The webhook `/hooks/moyasar` marks the invoice paid on
  `payment_paid` and records `payment_failed`. The event's `secret_token` must equal `MOYASAR_WEBHOOK_SECRET`
  (constant-time compare); without the secret every event is refused. In Live mode the payment is fetched again from
  Moyasar (`GET /v1/payments/:id`) before it counts. Replayed events never create a second payment.
  *Verify endpoints, field names (`callback_url`, `metadata`, `invoice_id` on the payment) and whether Moyasar now
  signs webhooks with a header, against Moyasar's current docs.*
* **Salla / Zid app-store payouts**: paste the payout CSV; rows are matched to customers (store id, domain, then
  name) and to an open invoice by amount (± SAR 1, gross or net). Applying records an `app_store` payment and the
  app-store fee as an expense. *Check the real column names of each partner portal's export.*
* Every payment creates Finance income (`entry: "billing"`), split by line type: subscription/proration →
  Subscription, setup → Setup fee, overage/other → Other revenue. Amounts include VAT, with the VAT portion recorded,
  following the Finance module's convention. A credit note on a paid invoice adds a negative income line (refund owed).
* **Test mode** (default): no payment links are created, nothing is charged, emails are logged; a "Test card"
  button simulates the Moyasar webhook. Sample stores are never charged or emailed.

## 7. Dunning

* Reminders on day **1, 3 and 7** after the due date (editable), or after a failed card payment if that's earlier.
  Bilingual (Saudi Arabic + English) templates; the day-7 one says when the account pauses.
* Sent 09:00–21:00 Riyadh time (Friday allowed: these are transactional, not marketing). Through the Store CRM's
  SMTP sender when Billing is in Live mode and email is configured; otherwise logged as "test".
* The customer is **past due** from day 1 and **paused** after N days (default 14). Paying everything that's overdue
  brings it back to active.
* Billing emails are transactional, so they carry no unsubscribe link. *Confirm with your lawyer under the PDPL and
  the CITC/CST e-marketing rules.*
* The AI Billing assistant (AI Workforce, level 1) only drafts custom reminders and invoice explanations; a person
  edits, approves and sends. Its outcomes (accepted/edited/rejected) feed its track record.

## 8. Metrics

From each customer's subscription events (each records the MRR after it): new, expansion, reactivation, contraction
and churned MRR per month; monthly NRR = (start + expansion − contraction − churn) ÷ start; trailing 12-month NRR =
today's MRR of the stores that paid 12 months ago ÷ their MRR then; logo churn = stores lost ÷ stores at the start of
the month. When billing customers exist, Finance and the Command Center use billed MRR from subscriptions instead of
logged recurring income or the Sales estimate.

## 9. Open questions for the accountant and lawyer

1. VAT treatment of app-store sales (Salla/Zid as agent or principal) and of non-Saudi customers (zero-rating).
2. Rounding: invoice-level vs line-level VAT, and the tolerance ZATCA accepts.
3. Is downgrade credit (account credit) acceptable, or should downgrades take effect at period end only?
4. Overage per started 1,000 renders, or pro-rata?
5. Whether proration invoices and overage-only invoices need any special wording.
6. Retention period and backup duty for invoice data (`db.json` has no backups yet).
7. Billing emails without an unsubscribe link under the PDPL.
8. The phase 2 wave date for DPA AD and the onboarding timeline.
