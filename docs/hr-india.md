# Attendance, leave and payroll (India)

The dashboard page **People → Attendance & payroll** (route `people`) runs attendance (punching), leave and a monthly payroll for DPA AD's team employed in India.

**This is not legal or tax advice.** Every rate below is a typical value for **FY 2025-26** (1 April 2025 – 31 March 2026), kept in one file, `web/lib/india-payroll.js`, and editable per workspace in *Settings → Statutory rates*. Payroll runs in another financial year show a warning until someone confirms the rates. **Confirm every rate, slab and due date with the company's CA before paying salaries or filing anything.** The CA files Form 24Q (TDS) and issues Form 16, and the PF ECR and ESI returns are filed on the EPFO and ESIC portals.

Code: `lib/india-payroll.js` (rates and statutory maths), `lib/people.js` (attendance, leave, payroll lines, payslip), `lib/peopleroutes.js` (routes), `public/people.js` (page). Tests: `web/test/app.test.js` (search "india payroll", "attendance rules", "leave balances", "people & payroll API").

## Who can do what

| Area | Module | Owner / Admin | Finance | Team lead | Team member | Viewer / Creative |
|---|---|---|---|---|---|---|
| Today, attendance grid, leave, holidays, employees, settings | `team` | edit | none | edit | view | view / none |
| Payroll runs, salaries, payslips of everyone, statutory dues, bank CSV | `payroll` (new) | edit | edit | none | none | none |
| Own punches, own attendance, own leave balance and requests, own payslips | self-service (`/api/me/people/:ws`) | anyone whose login is linked to an employee | | | | |

- Salary, PAN, UAN and tax fields are removed from every employee record unless the role can view Payroll. Self-service routes only ever return the signed-in person's own record and payslips.
- A manager (the employee set as someone's manager) approves or rejects their direct reports' leave from *My day*, even without team edit. Nobody approves their own leave there.
- Only an **Owner** can reverse an approved or paid payroll run, and must give a reason.
- *Post to Finance* needs Payroll edit **and** Finance edit.

## Attendance

- The server records each punch at its own clock and shows it in **IST (UTC+5:30)**. The browser never sends a time. A second punch within 60 seconds is refused (double taps).
- Settings: shift start and end, grace minutes (default 09:30–18:30, 15 minutes), full-day hours (8), half-day hours (4), weekly offs (Sunday; Saturday + Sunday; or Sunday + 2nd and 4th Saturday).
- Daily status, for days the person is employed and attendance is tracked (from *attendance tracked from*, which defaults to the day the employee is added, so no past days become absences):

| Status | Rule | Loss of pay |
|---|---|---|
| Holiday | company holiday or one of the three fixed national holidays | 0 |
| Weekly off | per the weekly-off setting | 0 |
| On leave | approved full-day leave | 0, or 1 for Loss-of-pay leave |
| Present | worked ≥ full-day hours | 0 |
| Late | present, first punch after shift start + grace | 0 (see late rule) |
| Half day | worked ≥ half-day hours but < full day | 0.5 |
| Absent | no punches, or worked < half-day hours | 1 |
| Half day + half leave | approved half-day leave and ≥ half-day hours worked | 0 |
| No punch-out | a past day with an open punch | 0 (paid as present until an Admin corrects it) |
| In now / Punched out / Not in yet | today, until the day is over | 0 |

- **Late rule** (optional, off by default): every *N* lates in a month = half a day loss of pay.
- Work on a holiday or weekly off is marked so an Admin can grant a comp-off.
- **Regularization:** Admins add, change or remove punches. A reason is required; each correction keeps who, when, the reason and the before/after times. Removed punches are kept (marked removed). Overnight shifts are not supported.

## Leave

Defaults are **typical; they vary by state Shops & Establishments Act. Check your state's rules** and adjust in Settings → Leave policy.

| Type | Default | Basis |
|---|---|---|
| Earned / privileged | 15 a year, accrued 1.25 at each month end, carry-forward cap 45, encashable on exit | State S&E Acts (e.g. many grant 1 day per 20 days worked; often after 240 days' service): verify |
| Casual | 8 a year, credited on 1 January (pro rata for joiners, to the half day), lapses | Company policy / state Act |
| Sick | 8 a year, credited on 1 January, lapses (some states allow accumulation) | Company policy / state Act |
| Maternity | 26 weeks; 12 weeks for a woman with two or more surviving children; counted in calendar days | Maternity Benefit Act 1961 (as amended 2017). Eligibility (80 days worked in the 12 months before) is not checked. ESI-covered employees are paid by ESIC; the payroll warns. |
| Paternity | 5 days a year, marked company policy (no statutory paternity leave for private employers) | Company policy |
| Comp-off | granted by an Admin for work on a holiday or weekly off; no expiry is applied | Company policy |
| Loss of pay | unpaid; reduces paid days | — |

- Leave year: calendar year (January–December). Earned leave accrues for each month the person was employed on the 15th.
- Leave days skip weekly offs and holidays (no "sandwich" rule); maternity counts every calendar day. Half-day leave is one date only.
- Requests can't overlap; paid types need enough balance (balance − pending), otherwise the person is told to apply the rest as Loss of pay.
- Opening balances and adjustments are ledger entries with a note, so the accrual history stays visible.
- **Holidays:** only the three fixed national holidays are built in: 26 January (Republic Day), 15 August (Independence Day), 2 October (Gandhi Jayanti). State and festival holidays move every year and are **never preloaded**: add them in Leave → Holidays.

## Payroll

### Salary structure

- Annual CTC → monthly gross so that gross + employer PF (+ EDLI and admin if switched on) + employer ESI + gratuity provision = CTC ÷ 12.
- **Basic = 50% of gross** by default (Code on Wages 2019 s.2(y): excluded allowances above 50% of total pay count back into "wages", so basic + DA is kept at least 50%). Configurable per company and per employee. DA isn't modelled separately: treat basic as basic + DA.
- HRA = 40% of basic (50% in a metro), special allowance = the rest.

### Monthly run

- **Paid days** = days employed in the month − loss-of-pay days (attendance + unpaid leave + late rule). Components are prorated on calendar days (paid days ÷ days in month). Joiners and leavers are paid only for the days employed.
- One-off additions: bonus, arrears, reimbursement, other earning. Deductions: advance recovery, other deduction.
- Statuses: **draft** (recalculates live, adjustable) → **approved** (lines and totals frozen; salary edits no longer change it) → **paid**. Reversal (Owner, with reason) keeps the record as *reversed*, removes any Finance expense it posted, and lets the month be run again.
- Outputs: net pay; employer cost (gross + employer PF + EDLI/admin + employer ESI + gratuity provision); printable HTML payslip with YTD; statutory summary; due dates; bank-transfer CSV with `[ADD ACCOUNT NO]` / `[ADD IFSC]` placeholders (no bank details are stored); a PF ECR text file (EPFO ECR 2.0 layout, `#~#` separated — check the portal's current format before upload).
- *Post to Finance* adds one "payroll" expense in SAR at the INR → SAR rate the person types. There is no default rate.

### Statutory rates (FY 2025-26 defaults)

| Item | Rule used | Source | Confirm |
|---|---|---|---|
| EPF employee | 12% of PF wages (earned basic), wages capped at ₹15,000/month by default; option for 12% of full basic | EPF & MP Act 1952, EPF Scheme 1952; ceiling from 1 Sep 2014 | CA |
| EPF employer | 12%: EPS 8.33% of wages up to ₹15,000 (max ₹1,250) + EPF the rest (3.67% at the ceiling) | EPS 1995 | CA (EPS eligibility for members over 58 or who joined after Sep 2014 above the ceiling is not handled) |
| EDLI | 0.5% of wages up to ₹15,000 (max ₹75), off by default | EDLI Scheme 1976 | CA |
| EPF admin charges | 0.5% of PF wages, minimum ₹500/month per establishment, off by default | EPFO notification (from 1 Jun 2018) | CA |
| ESI | covered when monthly gross ≤ ₹21,000; employee 0.75%, employer 3.25% of wages earned (bonus and reimbursements excluded), rounded up | ESI Act 1948; rates from 1 Jul 2019 | CA (the contribution-period rule and the ₹25,000 limit for persons with disability are not applied) |
| Professional Tax: Karnataka | ₹0 below ₹25,000 gross; ₹200/month at ₹25,000+, ₹300 in February | Karnataka Tax on Professions Act 1976; threshold from 1 Apr 2023; February ₹300 from the 2025 amendment | CA — **verify the February amount** |
| Professional Tax: Maharashtra | men: ≤ ₹7,500 nil, ₹7,501–10,000 ₹175, above ₹200 (₹300 in February); women: ≤ ₹25,000 nil, above ₹200 (₹300 in February) | Maharashtra PT Act 1975, Schedule I | CA |
| Professional Tax: Delhi, Haryana, Uttar Pradesh | no PT | — | CA |
| Professional Tax: other states | **no preset.** Enter the state's monthly slabs in Settings, or a monthly amount per employee; until then PT is ₹0 with a warning | — | CA / state Act |
| TDS, new regime | slabs 0% to ₹4L, 5% to ₹8L, 10% to ₹12L, 15% to ₹16L, 20% to ₹20L, 25% to ₹24L, 30% above; standard deduction ₹75,000; s.87A rebate up to ₹60,000 (nil tax up to ₹12L taxable) with marginal relief above ₹12L; 4% cess | Income-tax Act 1961 s.115BAC, 87A, 16(ia), 192; Finance Act 2025 | CA — surcharge above ₹50L is **not** computed (warned); the Income-tax Act 2025 is due to replace the 1961 Act from 1 April 2026, so section numbers and any new slabs must be confirmed |
| TDS, old regime | slabs 0% to ₹2.5L, 5% to ₹5L, 20% to ₹10L, 30% above; standard deduction ₹50,000; 87A rebate up to ₹12,500 to ₹5L; 4% cess; PT and declared deductions (80C, HRA exemption…) entered per employee are deducted | Finance Act 2025 | CA |
| TDS method | annualise: salary already in approved runs this FY + opening YTD + this month + this structure × the months left; tax minus TDS already deducted, spread over the months left. Or "enter monthly TDS manually" per employee. Labelled an estimate everywhere. No PAN → warning about s.206AA | — | CA files Form 24Q |
| Gratuity provision | 4.81% of earned basic a month (15/26 ÷ 12), employer cost | Payment of Gratuity Act 1972 | CA |
| Gratuity on exit | after 5 years' continuous service (1 year for fixed-term employees under the Code on Social Security 2020 — verify), 15/26 × last basic × completed years (over 6 months rounds up), capped at ₹20 lakh; shown as a full-and-final estimate, added only if a person adds it | PGA 1972 s.4; ceiling from 29 Mar 2018 | CA |
| Leave encashment on exit | earned-leave balance × monthly basic ÷ 30 (company policy, configurable) | Company policy / state Act | CA |

### Due dates (all marked "verify")

| What | Due |
|---|---|
| TDS deposit | 7th of the next month (March: 30 April); Form 24Q quarterly by the CA |
| PF ECR and payment | 15th of the next month |
| ESI contribution | 15th of the next month |
| Professional Tax, Karnataka | 20th of the next month (verify) |
| Professional Tax, other states | per the state's rules: no date is invented |

## What the founder must confirm (with the CA or the state rules)

1. Every rate in *Settings → Statutory rates*, especially for FY 2026-27 onwards (the defaults are FY 2025-26) and whether the Income-tax Act 2025 changes anything for salary TDS.
2. Karnataka PT's ₹300 February amount; Maharashtra PT slabs; the PT slabs and due date for every other state where someone works.
3. EPF: capped at ₹15,000 or on full basic; whether EDLI and admin charges are paid; EPS eligibility for each employee.
4. ESI coverage per employee and the contribution-period rule.
5. The leave policy against the state Shops & Establishments Act (earned leave per year, eligibility period, carry-forward cap, casual and sick leave, encashment) and the state's festival holidays.
6. Whether the Labour Codes (in force from 21 November 2025, subject to each state's rules) change the wage definition, gratuity for fixed-term staff, or leave rules for the company.
7. The salary structure (50% basic, HRA %, metro), and whether CTC includes the gratuity provision.
8. Each employee's tax regime, declared deductions (old regime) and the opening YTD for months paid before using this dashboard.
9. Statutory due dates each month.

## Limitations

- One shift for everyone; no overnight shifts, rosters, geo-fencing or device punching.
- Leave year is the calendar year; no sandwich rule; comp-off doesn't expire; maternity eligibility isn't checked.
- TDS is an estimate: no surcharge, no HRA-exemption calculation, no previous-employer Form 12B handling beyond "opening YTD", no Form 16 or 24Q generation.
- ESI uses the monthly gross each month (not the April–September / October–March contribution period). Statutory bonus (Payment of Bonus Act), LWF (Labour Welfare Fund) and minimum-wage checks are not built.
- No bank account numbers are stored; the bank CSV has placeholders. The ECR file layout must be checked against EPFO before upload.
- Finance posting needs a manually typed INR → SAR rate.
