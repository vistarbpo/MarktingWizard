# Meetings → tasks

Route `meetings`, access module `meetings`, menu item **Meetings** (after Goals & review). Code: `web/lib/meetings.js` (rules, parsing, the AI Meeting secretary, needs, samples), `web/lib/meetingsroutes.js` (HTTP), `web/public/meetings.js` (page).

AI does every step it can (reading the notes, drafting the summary and action items, guessing owner, date and module, drafting the follow-up). People do what must be human: decide which items are real, who owns them and when, and send anything to a customer.

## 1. Meetings

- Title, date and time (Riyadh, stored as `date` + `time` and `starts_at` in UTC), duration, type (`internal`, `sales_call`, `customer`, `partner`, `investor`, `hiring`), attendees (team users, plus outside people with name, email and organisation), agenda.
- Links (each checked against the person's View level on that module): a Sales deal, a Store CRM store (searched, not listed: the CRM can hold 30k stores), a Billing / Customer Success customer (one record: Customer Success reads Billing's customers) and a hiring candidate.
- **Investor and hiring meetings** are seen only by Owner, Admin, their team attendees and the person who created them. Everyone else gets 404 on every route, the list and the Command Center. A person can't save an edit that would lock themselves out.

## 2. Notes in

- Paste text, or upload `.txt`, `.vtt`, `.srt` or `.docx` (up to 200 KB of text; the browser refuses files over 700 KB).
- VTT and SRT become plain `Speaker: line` text: timestamps, cue numbers, `NOTE`/`STYLE` blocks and tags are dropped, and consecutive lines from the same speaker are joined. Speakers come from `<v Name>`, `[Name]` or `Name:`.
- `.docx` is read with Node's zlib (no new dependency): only `word/document.xml`, paragraphs as lines.
- **No audio transcription on the server** (Hostinger can't run it). The page says so; export the transcript from Zoom, Meet or Teams.

## 3. The AI Meeting secretary

Agent `meeting_secretary` (Operations, max level 1, $15/month by default). From the notes only, it drafts a summary, decisions, open questions and action items (what, owner, due date, module, and the exact source line).

The JSON is checked before anything is kept:
- invalid JSON or the wrong shape: factual draft instead
- any number in the summary, decisions, questions or items that isn't in the notes: factual draft instead
- any quoted text that isn't verbatim in the notes: factual draft instead
- an item whose `source` line isn't in the notes is dropped (listed as an issue)
- an owner that isn't an attendee becomes `[ADD]`; a due date that isn't `YYYY-MM-DD` becomes empty; a module that needs a link the meeting doesn't have becomes `ops`

**Factual draft (rule-based extractor)**, also used when the agent is switched off or unreachable: lines (bullets and `Speaker:` prefixes allowed) starting with `Action:`, `Action items:`, `TODO`, `To-do`, `Next steps:`, `Follow-up:`, `Task:`, `- [ ]` / `[ ]`, `المطلوب`, `مطلوب`, `مهمة`, `إجراء`, `متابعة`, or `سوف` / `سيقوم` / `ستقوم` / `سنقوم` / `سأقوم` / `راح`. Decisions come from `Decision:`, `Decided:`, `Agreed:`, `قرار`, `قررنا`, `تم الاتفاق`, `اتفقنا`, and questions from lines ending in `?` or `؟`. The owner is the attendee whose first name appears in the line (or the speaker); the due date is an ISO date in the line. The summary is an `[ADD]` placeholder.

Outcomes go to AI Workforce: `escalated` when the AI draft fails the checks; on review, `accepted` (created unchanged), `edited` (a person changed text, owner, date or module, or skipped an item) or `rejected` (nothing created). Factual drafts record nothing.

## 4. Review then create

A person reviews the draft, edits the summary and each item's text, owner, due date and module ("Goes to"), adds items, and ticks the ones to create. Unticked items are skipped. Once nothing is left to review, the draft is **reviewed** and can only be drafted again with `force`.

| Goes to | Needs Edit on | What is written | Link back |
|---|---|---|---|
| Operations task (default) | `ops` | `ops_tasks` row (owner, due, `source: "meeting"`) | `meeting_id`, notes "From meeting … (Meetings #id)" |
| Sales next action | `sales` | `deal.next_step` (shown first as the deal's next action while the deal is open) and a deal note | `next_step.meeting_id`, activity `meeting_id` |
| Store CRM note | `crm` | a note on the linked store | note `meeting_id` and text |
| Customer Success task | `success` | an alert of the new type `meeting_action` (with its playbook), owned by the item's owner | alert `meeting_id`, key `meeting|<item>` (never doubled) |
| Hiring activity | `team` | a note on the linked candidate | activity `meeting_id` |
| Goals check-in note | `okr`, and owning the key result (or Owner/Admin/Team lead) | an `okr_log` note on the chosen key result (active objectives only) | log `meeting_id` |

Items for modules the person can't edit are refused one by one with the reason; the rest are created. Every created item is also kept in `meetings_items` for **My action items**.

## 5. Follow-up email

For meetings with outside people (any type but internal, or an outside attendee). Arabic (Saudi dialect) first, then English after `---`. The AI draft is kept only if it has no numbers that aren't in the meeting; otherwise a plain template with `[ADD]`.

It is **drafted only**. A person copies it, or sends it through the Store CRM when the meeting links a store: Store CRM Edit needed, every `[ADD]` filled, then `outreach.sendOne()`, so Test mode only logs it, sample stores are never sent, do-not-contact, opt-out and bounce rules apply, and the unsubscribe footer is added. In Live mode it is refused outside 09:00–21:00 Riyadh time and on Fridays.

## 6. My action items and the Command Center

- **My action items**: open items you own (overdue first, by due date), plus done ones. Mark done or reopen (the owner, the meeting's creator, or Owner/Admin/Team lead). An Operations task marked done in Operations counts as done here.
- **Command Center needs** (module "Meetings"): your overdue items (up to 4, then a count); for Owner/Admin/Team lead, the count of others' overdue items; and meetings with notes in but no reviewed draft after **2 days** (for the creator, attendees and managers; private meetings only for people who can see them).

## 7. Ask DPA AD

- `list_meetings` (read): meetings you can see, with notes and draft status.
- `add_meeting_notes` (write, low risk, confirm card): save notes on a meeting (replace or append) or create a meeting with notes. Only text the person gave.

## 8. Access

Defaults: Owner, Admin, Team lead, Team member, Creative: **Edit**; Finance: **View**; Viewer: **None** (notes can be sensitive). Existing roles get these defaults on start (`ensureRoles`).

## 9. Data and compliance

- Collections `meetings_meetings` (with the draft and follow-up inside each meeting) and `meetings_items`. Both are cleared with their workspace.
- Data register: a "Meeting notes and transcripts" row is added (also to registers seeded before this module).
- Data requests: outside attendees are matched by email, and notes, summaries, items and follow-ups by email or phone mentions. Export lists the meeting, the attendee record, the matching note lines and any sent follow-up. Delete keeps the meeting but replaces the attendee with `[removed]` and redacts the email or number in the text.
- Sample data: two `Sample ·` meetings (an internal sync, and a demo call linked to a sample deal and store) with notes and a factual draft. Remove sample data removes them, their items and the sample tasks created from them.

## To confirm (founder)

- Who besides Owner/Admin should see investor and hiring meetings (today: attendees and the creator too).
- The defaults: Creative Edit, Finance View, Viewer None.
- 2 days before notes without a reviewed draft become a need.
- Retention for meeting notes and transcripts, and telling outside attendees before a call is recorded or transcribed (PDPL; see `docs/security-compliance.md`).
- Whether a deal's next action from a meeting should replace the automatic next step (today it shows first until the deal is lost).
