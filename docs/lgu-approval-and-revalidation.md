# LGU approval and revalidation: what needs the LGU, what does not

Audit of the TODA registration, driver application, driver affiliation, Master Roster and TODA account workflows (Batch 1, section D).
It records what each action does today, who decides it, what protects it in the database, and the gaps this batch closed or left open.
Nothing here was invented as a new business rule: every "approval" row is an approval that already existed in the migrations or the rule it
is built on (Rule numbers are the ones cited in the migrations). Rows marked **gap** are where the audit found a bypass; **closed** says it was fixed
in migration `20261101000001_toda_change_approval.sql`; **open** says a decision is still needed from the owner.

## The matrix

| Action | Who decides | How it is enforced | Audit trail | Status |
| --- | --- | --- | --- | --- |
| TODA registration | LGU approves or returns it (`approve_toda_accreditation`) | A TODA is created only by `register_toda_with_admin()`; the status columns are protected by `protect_toda_read_only_columns` | `TODA_REGISTRATION_SUBMITTED`, approval entries | in place |
| Driver application to a TODA | The TODA endorses, then the LGU approves (two stages per affiliation: `toda_endorsement_status`, `lgu_verification_status`) | `endorse_driver_affiliation`, `verify_driver_affiliation`; the TODA portal now shows the LGU's persisted decision ("Verified by LGU", "Returned by LGU", "Rejected by LGU") instead of "Endorsed to LGU" for ever | policy audit rows per decision | in place, **status display fixed** |
| Terminal move of an accredited TODA | LGU approves or rejects with its own words (10 to 500 characters) | `request_terminal_relocation`, `approve_terminal_relocation`, `reject_terminal_relocation`; the pending place sits in `pending_terminal_*` and the terminal in force is untouched until approval; the columns change only through those functions | `TODA_TERMINAL_RELOCATION_*` | in place |
| **Name of the terminal place** (`service_coverage_area`) | Travels with the terminal move | It was written directly by the TODA's app on every profile save, so a TODA could rename the approved terminal place. Now refused by `protect_toda_identity_columns` on an Active TODA; the app sends the place name only with a moved pin | `TODA_TERMINAL_RELOCATION_*` | **gap, closed** |
| **Name, acronym, barangay, date established** of an accredited TODA | LGU approves a request (`request_toda_profile_change`, `decide_toda_change_request`) | The TODA's table update is refused while Active; the request keeps what is in force (`previous`), what is proposed, who asked and why; the record in force changes only when the LGU approves. While the application is still being reviewed the details are the applicant's own and are applied at once (audited) | `TODA_PROFILE_CHANGE_REQUESTED`, `TODA_CHANGE_APPROVED` / `_REJECTED` / `_WITHDRAWN`, review flag `TODA_PROFILE_CHANGE_REQUESTED` | **gap, closed** |
| **Internal Bylaws** replaced by an accredited TODA | LGU approves | It used to overwrite the file in force at once with no flag. Now a pending request (`kind = 'bylaws'`); the bylaws in force stay until the LGU approves; the TODA can take the request back | `COMPLIANCE_DOCUMENT_UPDATED`, `TODA_CHANGE_*`, review flag `TODA_BYLAWS_CHANGE_REQUESTED` | **gap, closed** |
| Barangay Clearance renewal | LGU records the renewal (certificate number and valid-until date) | `toda_submit_compliance_document` flags `TODA_RENEWAL_SUBMITTED`; the accreditation in force (`certificate_number`, `certificate_expiry`) does not change until the LGU records it (`approve_toda_accreditation`). The file pointer shows the newest clearance because that is the file the LGU has to read | `TODA_CLEARANCE_RENEWAL_SUBMITTED` | in place. **open:** the pointer to the previous clearance file is replaced at submission; it is kept in storage and in the audit row, not as a viewable version |
| Roster file (newer version) | The TODA's own; the LGU is told | A later file is a new dated version in `toda_roster_file_version`; the registration file is never overwritten; the Master Roster changes only when the TODA confirms each member | `TODA_ROSTER_UPDATED` flag; roster audit rows | in place |
| Add a member to the Master Roster (insert) | The TODA | `add_toda_roster_entry`; direct table writes are dropped. It does not create or verify a driver: the driver still has to apply, be endorsed and be approved | `TODA_ROSTER_ENTRY_ADDED` | in place (TODA-level by design) |
| Edit a roster entry | The TODA | `update_toda_roster_entry`; applications already submitted keep the roster result they had | `TODA_ROSTER_ENTRY_UPDATED` | in place |
| **Mark a member as left** (delete) | The TODA decides the roster; the LGU is **asked to look** when the member is an LGU-verified driver of that TODA | `mark_toda_roster_entry_left` keeps the row (never deleted) and now raises review flag `TODA_ROSTER_MEMBER_LEFT` for the LGU. It does not block: the driver stays verified and affiliated until the LGU decides | `TODA_ROSTER_ENTRY_LEFT` | **gap, closed** (a review request, not a restriction) |
| Driver's own details (licence, MTOP, plate) | The driver edits; expiry renewals are verified by the LGU (Rule 24.2) | Renewal photos and dates wait in `renewalStatus = Pending LGU Verification` | existing audit rows | in place |
| Announcements to the TODA's own drivers | The TODA, no approval | Unchanged on purpose (TODA-level) | `TODA_ANNOUNCEMENT_*` | in place |
| Officer names and contact numbers | The TODA, no approval | Unchanged on purpose; they do not identify the accredited entity | `TODA_PROFILE_UPDATED` | in place |

## What protects the record in force

* RLS gives a TODA administrator no insert or delete on `toda`; updates are limited by triggers: `protect_toda_read_only_columns` (terminal pin, certificate, statuses, clearance file),
  `protect_toda_relocation_columns`, `protect_toda_suspension_columns`, and the new `protect_toda_identity_columns` (name, acronym, barangay, date established, registration number, terminal place name, bylaws file; only while Active).
  The LGU administrator and the server's service role pass them; the functions that change a protected column set the internal context themselves.
* A pending change never overwrites the record in force. It lives in `toda_change_request` (identity fields, bylaws) or in `pending_terminal_*` (terminal), next to what was in force.
* Every request and decision is audited with who, what changed (old and new values), when, and the LGU's own words; the LGU also gets a review flag on the dashboard.

## Left for the owner to decide (not assumed)

1. Whether a replaced **Barangay Clearance** should keep the previous file as a viewable version until the LGU records the renewal (today only the newest file is linked).
2. Whether a verified driver marked as having **left the roster** should automatically lose the affiliation after a time limit if the LGU does not act on the review flag (today he stays verified until the LGU decides).
3. Whether a change to a driver's **plate or franchise number** after approval should create a re-verification flag (today the driver's own edit goes through the existing renewal rules only).

Tests: `scripts/db-tests/batch16/toda-change-approval.js` (the new migration, on the local PGlite emulator), `scripts/db-tests/batch15/terminal-relocation.js`, `scripts/db-tests/batch15/master-roster.js`.
