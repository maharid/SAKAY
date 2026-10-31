# Batch 4: LGU approval of new roster members, document statuses that follow the decisions, verification history, and portal layout

Database objects are in `supabase/migrations/20261104000001_batch4_roster_approval_document_status_history.sql` (forward-only, safe to run twice, **not applied to the hosted
database**: run it in the Supabase SQL editor, after 20261102000001 and 20261103000001, before using the new screens). Rehearsal on the local emulator:
`node scripts/db-tests/batch17/roster-approval-and-history.js` (58 checks).

## 1. A member added to a Master Roster is approved by the LGU

* **The original roster is never asked again.** Entries that came from the roster file a TODA registered with (`source = registration_file`) are `Approved` (`approval_basis = original_roster`).
* **A member added later waits.** A member typed in (`add_toda_roster_entry`), brought in by an updated roster file (`import_toda_roster`, second import), or whose **franchise number was changed**
  (`update_toda_roster_entry`: a different member, so the earlier approval does not carry over) is `Pending`. A rejected entry that the TODA corrects goes back to `Pending`.
  A member who left and was put back (`reinstate_toda_roster_entry`) keeps what the LGU decided about him before.
* **Pending does not count.** `affiliation_roster_check` matches only an `Approved` entry; the two new reasons are `entry_pending_lgu` and `entry_rejected_lgu`. The timing rule (an entry counts only
  if it was on the roster before the application) is unchanged. The endorsement, the Roster Mismatch flag and the LGU's written-reason override all read this same check, so nothing else was changed.
* **The LGU decides** with `decide_toda_roster_entry(entry, 'approve' | 'reject', reason)` from Accredited TODAs > the TODA > Master Roster ("Approve" / "Reject" on the row, "Awaiting your approval" figure and
  filter). Rejecting needs a reason of 10 characters. The database records the LGU account (id and name), the time and the reason on the entry, writes the audit entry (`TODA_ROSTER_ENTRY_APPROVED` /
  `TODA_ROSTER_ENTRY_REJECTED`), tells the TODA, and resolves an open roster-mismatch flag that the approval settles.
* **Notices:** the LGU gets "a roster member needs approval" (opens that TODA's Master Roster); the TODA gets "Roster member approved / not approved" (opens Driver Membership).
* **Existing entries (the backfill, run once):** registration-file entries are `Approved`; a later entry whose driver the LGU had already verified for that TODA is `Approved` with
  `approval_basis = prior_verification` (the LGU's own verification date, no approver name: nothing is invented); every other later entry is `Pending`, so the LGU reviews it.
* The unused server route `POST /api/admin/todas/:id/roster` now inserts `Pending` entries (the service role could otherwise add an approved member).

## 2. TODA Driver Membership > Master Roster: Registered or Verified

The long explanation and the information banner are gone. One line says what the list is, and four figures sit above the table: Members, Registered, Verified by the LGU, Awaiting LGU approval
(and Not approved by the LGU when there is one). Each active member shows **one** driver status, from real data (`packages/shared/src/utils/rosterMemberState.ts`, 6 unit tests):

| Status | Meaning |
| --- | --- |
| Not registered | no SAKAY driver account has this franchise number |
| Registered | a driver account exists; the LGU has not verified it (pending, returned, rejected or suspended all stay "Registered") |
| Verified | the LGU verified that driver for this TODA |

Below it, for a member added after the registration file: "Awaiting LGU approval", or "Not approved by the LGU" with the reason (and "Edit the entry to send it again").

## 3. Driver Verification

* **Tabs (TODA Screen Application):** Overview, Documents, Screening, History. Nothing was removed: the personal, membership and vehicle sections are in Overview, the documents in Documents, the
  roster check and the checklist in Screening (Endorse takes the reviewer there when the checklist is not finished), and the history in History. The LGU's driver window already had its tabs; it
  keeps them and its Verification history tab now shows the real history.
* **Document statuses.** The cause: nothing recorded that a document had been inspected. The TODA window said "Pending Inspection" for every document that was never returned and "Resubmitted
  (Awaiting Review)" for a returned one for ever, even after the TODA endorsed and the LGU verified. `get_affiliation_document_approvals(affiliations)` now answers per application and document:
  `verified` (the LGU verified the application after the document was last replaced), `endorsed` (the TODA endorsed it after that), `resubmitted` (the driver replaced it after the application was
  submitted and nothing has been decided since) or `pending`, with who decides next. A document replaced after a decision is **never** shown as approved. An open return always shows first.
  Both portals read the same answer, and the document-level status stays separate from the driver-level status.
* **One card at the top** instead of up to five stacked alerts (TODA: Returned / Resubmitted / Elsewhere / Rejected / Roster check; LGU: Resubmission Required + Resubmission Received + the long TODA
  applications hint). It appears only when something needs the reviewer and links to the tab with the detail. A rejected application keeps its own "final" notice.

## 4. Notifications (both portals)

* The right-facing arrow and the unread dot sit at the **upper right** of each notice, and the kind icon at the upper left (nothing is pushed to the middle of a tall notice).
* **Shorter text** (`packages/shared/src/utils/notificationCompact.ts`, 7 unit tests): "Renew DWCC TODA's Barangay Clearance by Dec 31, 2026 to keep drivers online."; the expired notices in one
  sentence; any other notice keeps its first sentences, loses the "Open ... for the details" instructions the row already carries, and is cut at a word, never in a date. The database texts are unchanged.
* The panel is 352 px wide, about three notices tall (432 px at most, less on a short window), scrolls its list and keeps the title and "Mark all as read" in view.

## 5. Accredited TODAs > View Details > Master Roster

* **View no longer downloads.** The TODA window opened every document, a roster spreadsheet included, in the picture/PDF viewer, which put the file in a frame, and a browser downloads a spreadsheet
  there. A roster now opens in the roster viewer (a searchable table; Download stays a separate button), and the shared viewer shows "This spreadsheet cannot be shown here" with Download instead of ever
  framing a spreadsheet.
* The viewer's top row: the search box first, "Drivers in the file: N" to its right on the same row (it wraps under on a narrow window).
* The driver window opened from a Master Roster no longer shows the "TODA applications" box or "Permanently disqualify this applicant" (that action stays in Drivers); Approve / Reject there apply to this
  TODA's application. "Level 1: Warning Issued (2 / 10)" is the same size as "Strikes and discipline".
* **Verification history** (`get_driver_verification_history`; LGU: every event; a TODA administrator: only the events of their own TODA's application): registration, application, document returned
  (stage, who, why), document replaced, endorsement, LGU verification (with the roster-mismatch override), return, rejection, resubmission, renewal, and the Master Roster addition and the LGU's decision.
  Every time is the one the workflow recorded (audit log, document return history, the application and roster records); an event that was never recorded is not listed. The TODA's and the LGU's actions are
  told apart by the line under each event ("TODA · name · TODA", "LGU · name"). Future actions appear by themselves because they are written to the same records.

## 6. Toolbar cards

`ToolbarRow` and `ToolbarSideCard` (shared): the search and filter card with a card of its own **beside** it, the same height. LGU Audit Log and Incident Reports and the TODA Audit Log: the export card
(Excel, CSV, PDF; `ExportToolbar appearance="panel"`; the export still follows the filters and is audited first). LGU Announcement Management: "New announcement" in its card; the TODA's: "Send Reminder" and
"New Announcement" in theirs. Behaviour and permissions are unchanged; when the page is too narrow for both (a phone) the second card goes under the first.

## 7. TODA Account Management and Accreditation

The single "Edit TODA profile" button is replaced by an Edit button on each section: TODA information (name, acronym, barangay, date established), Authorized TODA officers, and the terminal location,
each in its own modal that sends only that section's fields to the existing update function (the validation, the LGU revalidation of identity changes and the terminal relocation rule are unchanged).

## Left open

1. The migration is not applied; none of the new database functions exist on the hosted project until it is.
2. The TODA's "Registered" status for a member depends on the franchise number the driver gave; a driver with a different number is "Not registered" until the TODA corrects the entry.
3. I could not log in to either portal here, so the real pages against data were not seen in a browser; the pieces that do not need data were (notification panel, the toolbar cards, the history list).
