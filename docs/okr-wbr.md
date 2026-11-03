# Goals & review: OKRs and the weekly business review

Route `okr` (menu: **Goals & review**, after SOP), access module `okr`. Code: `web/lib/okr.js` (rules, metrics, WBR data, narrative check, scheduler, sample rows), `web/lib/okrroutes.js` (HTTP routes and the printable review), `web/public/okr.js` (page), `ccOkr()` in `web/public/command.js` (Home card). Tests: the `okr …` tests at the end of `web/test/app.test.js`.

AI does every step it can (reads the metrics, drafts the weekly review, suggests a grade). People set the goals, check in with their confidence, comment, grade and mark the review reviewed.

## 1. OKRs

- **Objective**: a quarter (`2026-Q4`), level company or team (a team from Teams & roles → Teams), owner, description. Status **draft → active → closed**. Activation needs **2 to 5 key results**. Closing needs a **score from 0 to 1.0** and a **retro note**, typed by a person. The page shows a rule-based suggestion (average KR progress rounded to 0.1) and, on request, the AI Chief of staff's suggestion (it must cite the KRs it used; otherwise the rule is shown). When the suggestion was the AI's, the grade is recorded in AI Workforce as accepted (same to 0.1) or edited. Closed objectives freeze each KR's value and can't be edited or deleted.
- **Key result**: start, target, current, unit, owner, confidence (**on track / at risk / off track**, set by the owner at a check-in), check-in history.
  - **Linked**: reads a metric the dashboard already computes, through the owning module's functions (nothing is re-derived). A new linked KR starts from today's value unless a start is typed. Check-ins on a linked KR record the live value; a typed value is ignored.
  - **Manual**: the person types the current value at each check-in, with a note.
- **Progress** = (current − start) ÷ (target − start), clamped to 0–100%. It works for "lower is better" goals too (start 24 h, target 4 h). Objective progress = average of the KRs the reader can see.

### Linked metrics (`METRICS` in `okr.js`)

| Metric | Kind | Source | Needs View on |
|---|---|---|---|
| ARR (USD) | at a moment | Billing MRR × 12 ÷ 3.75 (Finance MRR when there are no Billing customers, today only) | Finance or Billing |
| MRR (SAR) | at a moment | Billing subscription event log (`mrrAt`), else `financeSnapshot` | Finance or Billing |
| Paying stores | at a moment | Billing customers with MRR, else Finance | Finance or Billing |
| NRR, last 30 days | at a moment | Billing: MRR now of stores paying 30 days ago ÷ their MRR then | Billing or Success |
| Logo churn, last 30 days | at a moment | Billing: stores paying 30 days ago that pay nothing now | Billing or Success |
| Store CRM replies | over the period | CRM messages received | Store CRM |
| Meetings booked | over the period | CRM stores whose Sales deal was created in the period | Store CRM |
| Deals won | over the period | Sales deals moved to Paying | Sales |
| Cost per lead (SAR) | over the period | Paid Ads insights (`metricsOf`): spend ÷ leads | Paid Ads |
| NPS, last 90 days | at a moment | Customer success answers (`npsOf`) | Success |
| Support first response (h) | over the period | AI Support tickets opened, time to the first reply sent | Support |
| Any KPI | at a moment | Latest value logged in KPIs | Marketing |

For a KR, "over the period" metrics add up from the quarter's first day to today.

## 2. Weekly business review (WBR)

- **When**: the job runs hourly and is safe to repeat. From **Monday 07:00 Riyadh** it drafts this week's review once per workspace. If the server was down Monday morning, the next run that week drafts it (catch-up). An Owner, Admin or Team lead can draft or rebuild the draft at any time (Weekly review → Draft this week's review). A reviewed week is never rebuilt.
- **What it covers**: the 7 days before the Monday ("this week"), the 7 before that ("last week") and the 4 weeks ending with this week. Each metric row has this week, last week, change and % change, and the 4-week average (stocks: the value at each week's end; flows: the total of each week). Also: this quarter's active objectives and KRs, OKR changes in the week (status and confidence changes from the log), the Command Center's needs that day (up to 8), deals won and lost (`winLoss` from Market intel), Ops incidents (opened in the week or still open), and cash, burn and runway from `financeSnapshot`. The data is frozen when the review is drafted.
- **AI Chief of staff's notes**: the prompt holds only these rows, each with a reference (`M` metric, `G` objective, `K` key result, `O` OKR change, `N` need, `D` deal, `I` incident, `F1` cash). Rules: summarize only the rows, cite each one, copy numbers exactly, and write `[ADD]` where context is missing. `checkNarrative()` rejects the AI text if it cites a row that doesn't exist, has a bullet with no reference (and no `[ADD]`), or has a number that isn't in the rows. A rejected text is replaced by `ruleNarrative()`, a factual summary built from the rows (top 3 week-over-week moves, goals not on track, needs, wins/losses, incidents, runway, questions with `[ADD]`), and the agent records "escalated". With the agent at level 0, the factual summary is used and no AI call is made.
- **People**: anyone with Edit comments on any section. Owner, Admin and Team lead can edit the notes (references to unknown rows are refused) or switch to the factual summary (recorded as "rejected" when the text was the AI's). **Only an Owner or Admin marks a review reviewed.** This records "accepted" or "edited" for the agent, and the review is then **locked** (no edits, comments or rebuild). Reviewed weeks stay listed.
- **Print**: `/api/workspaces/:ws/okr/wbr/:id/print` opens printable HTML (use Print → Save as PDF), redacted for the reader like the page.

## 3. Reminders (Command Center)

- A KR on an active objective with no check-in for **7+ days** (counted from activation when it never had one) becomes a need for its owner (up to 4). Owner, Admin and Team lead also get one line counting stale KRs owned by others.
- A draft WBR is a need for Owner and Admin.
- Home shows a **Company goals** card with this quarter's company objectives (active first, up to 4) and their progress.
- People without the `okr` module see no card and no needs.

## 4. Permissions

| Role | `okr` | What they can do |
|---|---|---|
| Owner, Admin | edit | everything; mark reviews reviewed |
| Team lead | edit | create, edit, activate, grade and delete objectives and KRs; draft and edit the review; can't mark it reviewed |
| Team member | edit | check in only on KRs they own (enforced on the server); comment on the review |
| Finance, Creative, Viewer | view | read |

**Hidden metrics**: a metric from a module the reader can't view (see the table above, e.g. MRR needs Finance or Billing view) is removed from every OKR and WBR response, including the Home card, the assistant tools and the print view. A hidden KR shows only its title, owner and confidence, and the objective is marked partial. In a review, hidden rows are removed, along with every note line citing them and every note line with a number but no reference. Win/loss needs Sales, incidents need Operations, and cash needs Finance. A person who can't see every row can't edit the notes.

## 5. AI agent and assistant

- Agent `chief_of_staff`, "AI Chief of staff", team Leadership, max level 1 (drafts only), monthly budget $15. `agentFor()` maps `/okr/*` to it. Calls go through the Workforce provider, which enforces pause and budget.
- Ask DPA AD tools: `list_okrs` (read: objectives with KRs, redacted) and `okr_check_in` (write, risk low, with a Confirm card; the person must own the KR or be a Team lead or above).

## 6. Data

Collections in `db.json`: `okr_objectives`, `okr_krs`, `okr_checkins`, `okr_log`, `okr_wbrs`. Deleting a workspace clears them. Sample data adds three "Sample ·" objectives (two active, one draft) linked to the sample metrics. Remove sample data deletes them and every draft review. No new environment variables.

## 7. For the founder to confirm

1. The WBR time (Monday 07:00 Riyadh) and which week it covers (the previous Monday–Sunday).
2. The 7-day check-in reminder.
3. Who marks the review reviewed (Owner and Admin only today) and whether Team members may also edit objectives they own (today: check-ins only).
4. Whether NRR and logo churn should use 30 days (as now) or a quarter, once real customers exist.
5. The AI Chief of staff's monthly budget ($15 by default, in AI Workforce).
6. The real objectives for the quarter, after removing the sample data.
