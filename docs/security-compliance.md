# Security & compliance, backups and the status page

This doc covers what the dashboard does for security, backups, the Saudi Personal Data Protection Law (PDPL) and the public status page. It also lists what the founder still has to set up and confirm with a lawyer.

**This is not legal advice.** Every legal deadline and legal basis in the dashboard is a default that you can change. Confirm each one with a Saudi lawyer before you rely on it.

Where it lives:

- **Settings → Security & compliance** (route `compliance`, access module `compliance`)
- the public page at **https://wizard.dpa.ad/status** (also `/status.json`)

Code:

- `web/lib/backup.js`
- `web/lib/compliance.js`
- `web/lib/status.js`
- `web/lib/complianceroutes.js`
- `web/public/compliance.js`
- `web/public/status.html`
- `web/scripts/restore-backup.js`

## 1. What's built

| Section | What it does |
|---|---|
| Overview | Security checks computed live from the server (see section 5). Also shows what needs a person. |
| Backups | Nightly encrypted snapshot, kept on the server and optionally copied off-site. Each backup can be verified, and an Owner can download it. A health card shows the latest state. |
| Data register | Records of processing. For each kind of personal data: what is held, why, the legal basis, where it is stored, how long it is kept, and who can access it (read live from Teams & roles). It is prefilled for Store CRM contacts, support tickets, HR candidates, team users, sales deals, finance records and media. |
| Data requests | Requests for access, a copy, correction, deletion or an end to marketing, each with its deadline. Find, Export and Delete work across all modules. |
| Sub-processors | Every outside company that receives personal data: what data, which country, and whether a DPA is signed. Prefilled and linked to Operations → Tool stack. |
| Policies | Six templates with `[CONFIRM]` placeholders: information security, access control, incident response, data retention, acceptable use, backup and recovery. Each has a version and an owner. AI can improve a draft. A policy can't be approved while any `[CONFIRM]` is left. |
| Access review | A quarterly checklist of every active login, with its role and last sign-in. You choose keep, change or remove for each, and the review is recorded with the reviewer and the date. People marked remove can optionally be deactivated. |
| Breaches | Lists the Operations incidents. If an incident is flagged as a personal data breach, a notification checklist starts, with deadlines counted from when the team became aware. |
| Status page | Component states, published incidents and updates (Arabic and English), and the dashboard's uptime self-check. |

Two more pieces:

- **AI Compliance officer** (AI Workforce, team Leadership, max level 1). It:
  - drafts policies and customer-facing status updates
  - flags overdue requests and breach deadlines (these flags are rule-based and also show in the Command Center)

  A person always saves, approves and publishes. The outcome of each draft is recorded: accepted, edited or rejected.
- **Command Center needs.** These appear when:
  - there has been no successful backup in 26 hours
  - a data request is overdue, or due within 7 days
  - a breach checklist item is overdue, or due within 12 hours

### Permissions

| Role | Security & compliance |
|---|---|
| Owner, Admin | Edit |
| Team lead, Viewer | View. Request subjects and login emails are masked. View-only roles can't search, export or delete. |
| Everyone else | None |

Two actions have extra limits:

- **Backup download:** Owner role only. Each download is written to the activity log.
- **Data deletion:** needs Edit, works only on a *deletion* request, and needs you to type `DELETE` to confirm.

## 2. Setup for the founder

Set these in hPanel → Websites → wizard.dpa.ad → Node.js → Environment variables, then restart the app.

| Variable | Needed? | What it does |
|---|---|---|
| `BACKUP_KEY` | **Yes** | Encrypts every backup with AES-256-GCM. Make one with `openssl rand -hex 32` (64 hex characters). **Store a copy in a password manager.** Without the key a backup can't be opened, and if hPanel is lost the key is lost with it. Without `BACKUP_KEY`, backups stay on the server unencrypted and are never sent off-site. |
| `BACKUP_S3_ENDPOINT` | For off-site | For example `https://<account-id>.r2.cloudflarestorage.com` (Cloudflare R2), `https://s3.<region>.backblazeb2.com` (Backblaze B2) or `https://s3.<region>.amazonaws.com` (AWS). |
| `BACKUP_S3_BUCKET` | For off-site | The bucket name. |
| `BACKUP_S3_KEY` | For off-site | Access key ID. |
| `BACKUP_S3_SECRET` | For off-site | Secret access key. |
| `BACKUP_S3_REGION` | Optional | Default `us-east-1`. Use `auto` for R2, the bucket's region for B2 and AWS. |
| `BACKUP_S3_PREFIX` | Optional | Default `marketing-wizard/`. |
| `BACKUP_S3_PATH_STYLE` | Optional | `1` = `endpoint/bucket/key` (the default, except on amazonaws.com). `0` = `bucket.endpoint/key`. |
| `BACKUP_EMAIL_TO` | Optional | Emails each encrypted backup to this address through the existing `SMTP_*` mailbox. |
| `BACKUP_EMAIL_MAX_MB` | Optional | Default 15. Backups larger than this are not emailed. Check your provider's attachment limit. |
| `BACKUP_MEDIA` | Optional | `0` leaves `media/` out of backups. |
| `BACKUP_MEDIA_MAX_MB` | Optional | Default 200 (the whole backup is built in memory, so keep this modest on shared hosting). If the media folder is larger than this, it is left out of the backup and a note explains why. |
| `TOKEN_KEY` | Recommended | 64 hex characters. Encrypts social platform tokens. Reconnect accounts after you change it. |
| `PUBLIC_URL` | Recommended | `https://wizard.dpa.ad`. The status self-check calls `PUBLIC_URL/healthz`. |

### Getting S3-compatible storage

Any one of these works. Check current pricing and free tiers yourself.

- **Cloudflare R2:**
  1. In the dashboard, go to R2 and create a bucket.
  2. Go to *Manage API tokens* and create a token with *Object Read & Write*, scoped to that bucket only.
  3. Use the S3 endpoint shown, and region `auto`.
- **Backblaze B2:**
  1. Create a private bucket.
  2. Under *Application Keys*, add a key limited to that bucket.
  3. The endpoint is shown on the bucket page.
- **AWS S3:**
  1. Create a private bucket.
  2. Create an IAM user whose only permission is `s3:PutObject` on `arn:aws:s3:::<bucket>/marketing-wizard/*`.
- **Hostinger:** if your plan includes S3-compatible object storage, it works the same way. Verify what your plan offers.

Recommended on the bucket:

- **A lifecycle rule** that deletes old objects, for example after 90 days. The dashboard only uploads; it never deletes anything off-site.
- **Object versioning or object lock**, if the provider has it, so that a leaked key can't wipe your backups.

**Data residency:** a bucket outside Saudi Arabia is a cross-border transfer of personal data. See section 4.

### Keeping the scheduler awake

Hostinger can put an idle Node app to sleep. The schedule handles this as follows:

- A nightly backup runs from 02:00 Riyadh time.
- If the server was asleep at 02:00, the backup runs at the next check after it wakes. There is one check a minute.
- The 5-minute status self-check only runs while the process is alive.

Set up an external ping to `https://wizard.dpa.ad/healthz` every 5 minutes, for example with UptimeRobot or a cron job. This item is still open in CLAUDE.md.

## 3. Backups

- **What is saved:** `db.json`, `crm.json` and `media/`, with a `manifest.json` that holds a SHA-256 checksum for every file and the record counts per collection.
- **Consistency:** the CRM is flushed first, then both databases are serialised in the same tick, so they match each other.
- **Format:** a gzip'd tar built with Node's zlib, so no extra dependency. When `BACKUP_KEY` is set, the file is encrypted as `MWB1 | salt | iv | tag | ciphertext` with AES-256-GCM.
  - A 64-hex `BACKUP_KEY` is used directly as the key.
  - Any other value is treated as a passphrase and run through scrypt with the salt.
- **Where:** `DATA_DIR/backups/mwiz-backup-<UTC timestamp>-<nightly|weekly|manual>.tar.gz.enc`
- **What is kept:** the last 14 nightly, 8 weekly and 10 manual backups. A scheduled run counts as *weekly* when the last weekly backup is 6 or more days old.
- **Off-site copy:** sent right after each backup.
  - **S3:** a PUT signed with AWS Signature V4, implemented with `node:crypto`. It is tested against AWS's published vectors.
  - **Email:** sent as an attachment.
  - **Without `BACKUP_KEY`:** both are refused.
  - **Failures** show on the backup row. **Send off-site** retries.
- **Verify:** decrypts the backup in memory, checks every checksum, parses both JSON files and shows the counts per collection.

### Restore

1. In Security & compliance → Backups, press **Verify** on the backup you want and note the counts.
2. An Owner presses **Download**, or takes the file from the bucket or the email.
3. On a computer with Node 22 and this repo, run:

   ```bash
   BACKUP_KEY=<key> node web/scripts/restore-backup.js <file> restored/
   ```

   The script checks every checksum and writes `db.json`, `crm.json` and `media/` into `restored/`. It refuses to write into a folder that already has a `db.json` unless you pass `--force`.
4. In hPanel → Node.js, **stop** the app.
5. In File Manager, rename the current `db.json`, `crm.json` and `media/` in `DATA_DIR` to `*.old`.
6. Upload the restored files.
7. **Start** the app. Sign in and check that the counts match the Verify result.

Test a full restore into a scratch folder once a quarter. The backup policy template asks for this.

## 4. PDPL points used, and their sources

These are the points the dashboard was built around. The numbers are configurable in the app: **verify every one with a lawyer.**

1. **The law.**
   - The Personal Data Protection Law was issued by Royal Decree M/19 (1443H, September 2021) and amended by Royal Decree M/148 (1444H, 2023).
   - It came into force on 14 September 2023, with a one-year grace period to September 2024.
   - The regulator (the "competent authority") is the **Saudi Data & AI Authority (SDAIA)**.
   - It is supported by the **Implementing Regulations** and the **Regulations on Personal Data Transfer outside the Kingdom**.
2. **Records of processing.** A controller keeps a record of its processing activities. This is the *Data register*. *Confirm* the required fields and how long the record must be kept.
3. **Data subject rights.**
   - The rights are: to be informed, to access the data, to get a copy in a readable format, to have it corrected, and to have it destroyed. A person can also withdraw consent.
   - The dashboard uses a **30-day** response deadline by default (setting `dsr_days`), based on the Implementing Regulations. *Verify* the current deadline and when it may be extended.
4. **Legal bases.**
   - The bases include consent, a contract with the person, a legal obligation, vital interests and public interest.
   - **Legitimate interest** was added by the 2023 amendments. It does not cover sensitive data.
   - The register entries say `[CONFIRM]` for each legal basis.
5. **Direct marketing.**
   - Marketing messages need the recipient's consent and a way to opt out. The Store CRM already includes an unsubscribe link and header, honours "stop" and "إلغاء", and sends WhatsApp only to opted-in numbers.
   - **Cold email to the 30k Salla list is the biggest open legal question.** Confirm with a lawyer whether B2B store contacts can be emailed without prior consent, and on what legal basis.
6. **Breach notification.**
   - The dashboard defaults are:
     - **72 hours** from becoming aware to notify SDAIA, when the breach may harm people (`breach_regulator_hours`)
     - affected people notified **without undue delay**, with a 72-hour target (`breach_subjects_hours`)
   - The checklist says "Verify the current PDPL breach notification timeline" on both items.
7. **Cross-border transfers.**
   - Sending personal data outside the Kingdom is restricted. It needs an adequacy decision or appropriate safeguards (standard contractual clauses, binding corporate rules, and similar), plus a risk assessment in some cases.
   - Sub-processors that are likely to be outside the Kingdom: Anthropic (US), Meta, Google, TikTok and LinkedIn. Hostinger's data centre and the backup bucket depend on the region you pick.
   - Each vendor has a "Data leaves Saudi Arabia?" field and a DPA status. Nothing is marked signed or answered by default.
8. **Retention and destruction.** Destroy personal data when it is no longer needed for its purpose, unless the law requires keeping it (for example accounting records for ZATCA). The retention periods in the register are `[CONFIRM]`.
9. **Other duties to check:**
   - whether DPA AD must appoint a **data protection officer**
   - whether it must **register on the National Data Governance Platform**
   - whether it needs a **privacy notice** on dpa.ad and in the Salla app
   - the **penalties**: fines of up to SAR 5 million, and higher for repeat offences, with criminal penalties for some disclosures of sensitive data
10. **Security measures.** The law asks for appropriate organisational and technical measures. The dashboard does not claim any certification (ISO 27001, SOC 2, NCA ECC). The policy templates say so, and the AI is told never to claim one.

Sources to read, using the official versions:

- SDAIA: **sdaia.gov.sa**. Has the PDPL text, the Implementing Regulations, the Transfer Regulations and guidance documents. The Arabic text is authoritative.
- The National Data Governance Platform run by SDAIA, for registration and breach notification. Its address is published on sdaia.gov.sa.
- NCA (nca.gov.sa): the Essential Cybersecurity Controls, as a reference for good practice.
- AWS Signature Version 4 documentation and the `aws-sig-v4-test-suite`. The tests use the "get-vanilla" vector and the S3 "GET Object" example.

## 5. Security checks, and what each one means

| Check | Passes when |
|---|---|
| Team password is long | `DASHBOARD_PASSWORD` has 16 or more characters. 10–15 is a warning. |
| A personal Owner login exists | At least one active user has the Owner role. |
| TOKEN_KEY is set | 64 hex characters, or a passphrase of 16 or more characters. |
| BACKUP_KEY is set | It is set, with 16 or more characters. |
| Backups are fresh | A successful backup exists from the last 26 hours. |
| Backups are copied off-site | S3 or email is configured and backups are encrypted. |
| No idle active users | No active account has gone 90 days or more without signing in (setting `inactive_days`). |
| Store CRM sending mode | Information only: shows which workspaces are Live. |
| PUBLIC_URL uses HTTPS | `PUBLIC_URL` starts with `https://`. |
| Meta webhook secrets are set | `META_APP_SECRET` is set whenever `META_APP_ID` is, and `WA_APP_SECRET` whenever `WA_TOKEN` is. |

## 6. Data requests: how Find, Export and Delete work

**Find** matches:

- the email exactly, ignoring case
- the phone number by its last 9 digits after normalising, so +966 55…, 055… and 96655… all match

It searches:

- Store CRM contacts
- support tickets, using the contact field and the customer's own messages
- HR candidates
- sales deal contacts
- sales notes and drafts that mention the email or number

**Export** downloads a JSON file of everything found: each CRM contact with its messages and notes (without the unsubscribe token), full tickets, candidates with their activity, and the deal contact fields.

**Delete** uses each module's own delete function:

- removes the CRM contact, along with its messages, notes and enrollments
- deletes the ticket
- deletes the candidate and their activity
- clears the deal's contact name, email and phone; the deal stays as a business record
- replaces the email or number with `[removed]` in sales notes and drafts

The request record is kept as evidence. It holds the reference, the type, the dates, the counts of what was deleted, and who did it. It keeps **no name, email or phone**. The same person's other requests drop their details too.

### Known limits

Tell the person about the first point, and decide the others:

- **Backups** still contain the data until they rotate out: 14 nights and 8 weeks on the server, plus whatever the bucket's lifecycle rule keeps.
- **Free text that names the person** without their email or number (for example a note saying "spoke to Sara") is not found. Check by hand.
- **Re-imports:** a later CSV import of the same store list would add the person again. The dashboard doesn't keep a do-not-contact fingerprint, because that would itself be personal data. If you want a suppression list, decide it with your lawyer.
- **The activity log** records that a deletion happened (the request path), not who the person was.

## 7. Status page

- **Components:** Dashboard, Ad rendering, Publishing, Store integrations (Salla / Zid), and Email & WhatsApp. Each one is operational, degraded, outage or maintenance.
- **Component states** are set by hand. A published incident shows its impact on top of the state.
- **Dashboard uptime** comes from the self-check, which calls `PUBLIC_URL/healthz` every 5 minutes. Days with no checks are shown as "no data", never as up.
- **Uptime for the other components** is the share of tracked time without a published outage.
- **Publishing an incident:**
  1. In Breaches, press **Publish to status page**.
  2. Optionally press **AI: draft the update**. It writes Arabic and English text and leaves out internal details.
  3. A person edits the text and publishes it.
  4. Later updates and resolving the incident are done in the Status page tab. Unpublishing hides the incident.
- The page is bilingual and follows the browser's language, with a toggle. It has light and dark themes and works on phones, where it shows the last 30 days.

## 8. What the founder must confirm with a lawyer

1. The DSR response deadline (default 30 days) and when it can be extended.
2. The breach notification timeline: 72 hours to SDAIA, and when and how to tell affected people. Also the notification channel.
3. The legal basis for each entry in the data register, especially cold outreach to stores that never opted in.
4. Whether the 30k Salla store list can be used at all: its source, its consent, and whether it may be emailed or sent WhatsApp messages.
5. Cross-border transfers to Anthropic, Meta, Google, TikTok, LinkedIn, the Hostinger region and the backup bucket region: whether each is allowed and on which safeguard.
6. DPAs with each sub-processor. Most publish a standard DPA; sign or accept it and mark it in the dashboard.
7. The retention period for each kind of data, including the accounting records required by ZATCA.
8. Whether a data protection officer, registration on the National Data Governance Platform, or a published privacy notice is required for DPA AD.
9. Whether keeping deleted data in backups until they rotate out is acceptable, and what to tell people about it.
10. The legal entity name and CR number to put in the policies, and who owns each policy.
