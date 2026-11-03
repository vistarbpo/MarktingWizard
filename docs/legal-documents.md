# Legal & company documents

Settings → Legal & documents (route `legal`, access module `legal`). Code: `web/lib/legal.js`, `web/lib/legalroutes.js`, `web/public/legal.js`. Tests: the `legal …` tests at the end of `web/test/app.test.js`.

**This is not legal advice software.** Every template and every AI draft is a starting point for a lawyer. The page, each template and each printed draft say so in English and Arabic.

AI does every step it can: it fills templates from the dashboard's data, works out renewal and notice dates, and summarizes contracts with a quoted sentence for every point. People do what must be human: they review with a lawyer, sign, record the signature with the signed file, and accept or dismiss each suggested obligation.

## 1. Document vault

Each document has a title, a type, parties (name, email, role), a number/reference, issue date, expiry/renewal date, auto-renew with a term in months, a notice period in days, payment terms, an owner, tags, notes, a status and a confidentiality level.

- **Types:** CR (commercial registration), VAT certificate, Chamber of Commerce, articles of association, bank letter, trademark, licence (MISA, Saudi Business Center…), India entity / GST / PF / ESI registration, insurance, NDA, customer contract, partner agreement, vendor contract, employment contract / offer letter, policy, board resolution, cap table document, other.
- **Status:** draft → in review → signed → active → expired / terminated.
  - Agreements (NDA, customer, partner, vendor and employment contracts, board resolutions, articles) become **signed** or **active** only after a signature is recorded with the signed file (section 5).
  - Certificates and licences can be set to active directly.
- **Confidentiality:**
  - *Normal:* everyone with Legal access.
  - *Restricted:* Owner and Admins only. Everyone else gets 404 on every route: the list, details, file download, print view, summary, obligations, signatures and template generation. Restricted documents are also hidden from What's due, the Command Center and Ask DPA AD.
  - Employment contracts, cap table documents, board resolutions and bank letters start restricted when an Owner or Admin adds them. Only an Owner or Admin can make a document restricted or change its level.
- **Delete:** drafts and in-review documents can be deleted with their files and obligations. Signed, active, expired and terminated documents, and any with a recorded signature, are kept for legal reasons: only the Owner can delete one.
- Every change is in the document's change log.

## 2. Files and versions

- **Allowed files:** PDF, Word (.docx), PNG, JPEG or plain text, up to 20 MB. The bytes are checked (PDF header, zip with `word/document.xml`, PNG/JPEG signatures, text without binary bytes), so a renamed file is refused. The size limit is enforced while the upload streams in.
- **Storage:** files are saved in `DATA_DIR/legal/` under a random name. They are not in the public `/media/` folder.
- **Download:** files are served only by `/api/workspaces/:ws/legal/documents/:id/file?v=N`, after the login and permission checks, with `nosniff`, `no-store` and a sandbox CSP. Each download, inline view and print is written to the activity log (Teams & roles → Activity).
- **Versions:** a new upload becomes the current version, and the older versions stay. Each version records who uploaded it and when, its size and SHA-256, its kind (upload, signed copy or template draft) and a note.
- **Backups:** `legal/` is in every backup, with its own size cap `BACKUP_LEGAL_MAX_MB` (default 500 MB). `web/scripts/restore-backup.js` restores it next to `media/`.

## 3. Renewals, notice deadlines and obligations

- **Renewal date:**
  - Without auto-renew, the renewal date is the expiry date.
  - With auto-renew, the date rolls forward by the renewal term until it is today or later.
- **Termination notice deadline** = renewal date − notice period (days). It is the last day to give notice.
- **Reminders** fire at 90, 30 and 7 days before expiry (Settings). Each document and each row in What's due shows its reminder stage.
- **Expired:** a signed or active document past its date without auto-renew shows as *expired by date* until someone renews it or marks it expired or terminated.
- **Obligations and reminders:**
  - Each one has a kind (payment, notice, renewal date, termination notice deadline, reminder, other), a title, an optional due date, a repeat (once, monthly, quarterly, yearly), an owner and notes.
  - Marking a repeating one done moves it to its next date.
- **What's due:** expiries, notice deadlines and open obligations for the next 30 days to 12 months, with overdue items included.
- **Command Center (Home), module "Legal":**
  - documents expiring within 30 days (setting `expiring_days`)
  - documents that have expired but are still marked in force
  - notice deadlines within 14 days (setting `notice_window_days`)
  - overdue obligations

  Restricted documents count only for Owner and Admins.
- **Dates** use the Riyadh day (`riyadhDay`). Tests fix the clock with `legalOptions: { clock }`.

## 4. Templates and generating a draft

There are 7 starter templates. Each has `[CONFIRM]` where a lawyer must decide something and `[ADD]` where a fact is missing:

1. Mutual NDA (English)
2. Mutual NDA (Arabic)
3. Customer SaaS terms (outline)
4. Data processing agreement under PDPL (outline)
5. Partner / referral agreement (outline)
6. Freelancer / contractor agreement
7. India employment offer letter (outline)

They never cite law article numbers. The only legal references are the ones already in `docs/security-compliance.md` (the PDPL by Royal Decree M/19 as amended, the 30-day request default and the 72-hour breach checklist default), and each of those is marked `[CONFIRM]`.

**Generate** (Templates tab) fills a template with what the dashboard already has:

- **Company:** legal name (Arabic name for the Arabic NDA), CR and VAT numbers and address from Billing → Settings. The address needs a street; without it, it is `[ADD]`.
- **Counterparty,** read with the person's own permissions:
  - a Store CRM store (needs CRM view)
  - a Billing customer: legal name, VAT number, billing address, plan (needs Billing or Success view)
  - a partner: contact, referral link, and commission terms when the person has Billing or Finance view (needs Partners view)
  - an employee, for the offer letter (needs Team view): designation, department, joining date and state. The CTC and its monthly structure (basic, HRA, special allowance, employer PF, gratuity, from the payroll maths) are filled only with Payroll view; otherwise they are `[ADD]`.
  - someone else, typed in
- **Typed fields:** purpose, term, signatories, notice period, fee and so on.

Anything still missing becomes `[ADD]`. The draft is saved as a new version: printable HTML, right to left for Arabic, with every placeholder highlighted and the "not legal advice" banner. An employment offer letter starts restricted. While the current version is a template draft with `[ADD]` or `[CONFIRM]` left, the document can't be marked signed.

## 5. Signature log (no e-signature integration)

Sign in DocuSign or on paper. Then:

1. Upload the signed file as a **Signed copy**.
2. Record who signed, their email and party, the date (not in the future), how (wet ink, DocuSign, other e-signature) and a note such as the envelope id.

A signature must point to an uploaded file version. A template draft is refused. Recording it makes that version current and moves a draft or in-review document to **signed**. Removing the last signature moves a signed document back to in review.

## 6. AI Legal assistant (agent `legal_assistant`, Leadership, max level 1)

**Summarize** reads the current version's text, or text the person pastes in.

- **Files it can read:**
  - TXT
  - DOCX (read with zlib, no new dependency)
  - PDF with a simple text layer (Flate or plain content streams, `Tj`/`TJ` strings)
  - generated drafts
- **When it can't read the file:** scanned PDFs, PDFs with embedded CID fonts (common for Arabic) and images ask the person to paste the text.
- **What it lists:** parties, term, renewal, notice, payment, liability cap, governing law and disputes, data protection, and unusual clauses. Each point has a sentence quoted from the text.
- **Quote check:** every quote is looked for in the text, after normalising spaces, quote marks, dashes, tatweel and Arabic diacritics. Points whose quote isn't found are dropped and counted, and the outcome is logged as *escalated* in AI Workforce.
- **Fallback:** if the AI is off (level 0), unreachable, not JSON, or quotes nothing real, the summary is built by fixed rules: the sentences that match each point's keywords, quoted as they are, with `[CONFIRM] read the quoted sentence`.
- **Suggested obligations** come from the AI's quoted obligations and from rules (the renewal date, the notice deadline, "N days" in a notice or payment sentence). A person accepts each one, optionally changing the date, or dismisses it. The outcome is logged as accepted, edited or rejected.
- **Drafts only:** nothing is changed until a person accepts it.

## 7. Permissions, privacy, data requests, self-service

- **Default access:** Owner and Admin edit; Team lead and Finance view; Team member, Creative and Viewer none. `ensureRoles` adds `legal` to existing roles.
- **Data register:** the starter has the entry "Legal & company documents (vault)".
- **Data requests (Security & compliance):**
  - Find and export list the documents whose parties include the person's email, with signatures and file names. The files themselves aren't included.
  - Delete takes the person off the parties of **drafts** only.
  - Signed, active, expired and terminated documents, and any with a signature, are **retained for legal reasons**: they are never changed automatically. The found list says so, and a person decides with a lawyer.
- **Employee self-service:**
  - An employee linked to their login sees their own signed (or later) employment contract under *My employment documents* in My day.
  - They download it from `/api/me/legal/:ws/documents/:id/file`, which is written to the activity log.
  - Nothing else is visible to them.
- **Ask DPA AD:**
  - `list_documents` (read; restricted documents only for Owner/Admin)
  - `add_document_reminder` (write, low risk, with a Confirm card naming the document)
- **Workspace delete** removes the `legal_*` rows and their files on disk.
- **Sample data:** "Sample · Mutual NDA with Najd Digital Agency" (a template draft) and "Sample · Cloud hosting vendor contract" (active, auto-renews in 20 days, 14-day notice period, sample contract text). Remove sample data deletes both, with their files and their obligation.

## 8. For the founder to confirm (with a lawyer)

1. Every template, clause by clause: governing law and disputes forum, liability caps, confidentiality survival, IP assignment, refunds, notice periods. They are outlines, not finished contracts.
2. The DPA outline against the PDPL, its Implementing Regulations and the transfer regulations: the sub-processor list, the breach-notice timeline, the data-request deadline and the legal basis for transfers outside the Kingdom.
3. Offer letter: which entity employs the team in India (an Indian subsidiary or an employer of record), probation, the notice period, and state Shops & Establishments rules (with the CA, as in `docs/hr-india.md`).
4. Freelancer agreement: misclassification risk in the contractor's country, and tax handling.
5. Retention: how long signed contracts, employment records and drafts are kept, and which documents must never be deleted.
6. Who sees restricted documents (Owner and Admin by default), and whether contract text may be sent to Anthropic for summaries. The data register says it is.
7. Whether a typed signature log plus the signed file is enough evidence, or an e-signature provider integration is needed later.
