# Incident follow-up, overdue reports, portal notices, accreditation reminders and emergency declarations

Batch 2. Everything below is in migration `supabase/migrations/20261102000001_batch2_incident_followup_notifications_reminders.sql`
(forward-only, safe to run twice). It has **not** been applied to the hosted database: run it from the Supabase SQL editor
(see "Applying it"). Rehearsal: `node scripts/db-tests/batch16/incident-followup-notifications.js` on the local PGlite emulator.

## 1. Who acts on an incident report

| Where the report is | Who has to act | TODA portal | LGU portal |
| --- | --- | --- | --- |
| Filed with the TODA (route `TODA`) | The TODA administrator | "Needs your action" | "With the TODA" (read only; take over only when the TODA's time ran out) |
| Escalated by the TODA / filed with the LGU | The LGU Administrator | "With the LGU" and the follow-up button | "Needs your action" |
| Decided / withdrawn | Nobody | "Closed" | "Closed" |

Statuses and decisions are untouched: a report keeps the status it has. The LGU's resolution is a four-step view
(Review, Investigate, Decide, Finalize) over the **same** database functions as before (`incident_start_review`, `incident_decide`,
`incident_escalate`, `incident_refer_to_toda`, `incident_lost_item_update`). A report a TODA escalated is already "Under Investigation", so
"Start review" had no effect on it; **Accept for review** (`incident_lgu_acknowledge`) is the explicit step that records who is responsible and tells the TODA.

## 2. Follow-up and escalation

* A TODA administrator can send the LGU a follow-up on a report that is with the LGU and not decided (`incident_send_followup`). It records who, when, which report and what was said in `incident_followup`
  (newest first in both portals), and it notifies the LGU.
* **Cooldown / duplicate protection:** one follow-up per report per `incident_followup_cooldown_hours`. A second attempt is refused with `ERR_FOLLOWUP_TOO_SOON` and the time it becomes possible again.
  **Policy gap:** no approved figure existed, so the default is **24 hours** (`system_policy_config.incident_followup_cooldown_hours`). Change it in that table; no code change.
* The LGU accepting the report, deciding it, or a TODA withdrawing it notifies the other side once.

## 3. Overdue

No deadline was invented. The times are the existing F11.1 policy clocks (`incident_constant()` / `incidentClocks`): a first action within 2 business days (4 hours for a safety report) and a decision within
3 business days after an escalation. The hourly sweep (`run_scheduled_sla_and_expiry_cascade`) now also sets `incident_report.overdue_kind` / `overdue_since`
when a report passes one of them. The list rows and the detail views show "Overdue", and the LGU and TODA are each notified **once** per event
(`INCIDENT_OVERDUE_TODA`, `INCIDENT_OVERDUE_LGU`, `INCIDENT_OVERDUE_FYI`). The recorded `overdue_kind` / `overdue_since` stay as history; the "Overdue" label itself is worked out from the clocks and the outcome each time the list is read, so it disappears as soon as the report is acted on or decided.

## 4. Who sees which notice

The `notification` table is addressed by `recipient_id` (`lgu_admin`, `toda_<id>`, a driver or a passenger id) and the LGU can read every row (that is what lets it see its own and a TODA's
driver-related rows), so the portals now **filter by `recipient_id`** instead of reading the whole table. That was the cause of passenger / driver notices ("Your report is being reviewed", "May Bagong Strike sa Iyong Account") showing in the LGU portal.
Row security is unchanged on purpose.

| Notice | LGU | TODA |
| --- | --- | --- |
| Incident filed with / escalated to the LGU, follow-up from a TODA, overdue at the LGU | yes | |
| Incident filed with the TODA, referred back, LGU accepted / decided / withdrawn, TODA overdue | | yes |
| Driver verification request, resubmission (pending review) | yes | |
| LGU decision on a driver (verified / returned / rejected) | | yes |
| TODA accreditation application | yes | |
| Appeal waiting for the LGU | yes | |
| Accreditation expiring / expired | expired: yes | yes |

Each notice has its own icon (`PortalNoticeIcon`), a right-facing chevron, a timestamp and read state per signed-in administrator (`portal_notification_read`). Clicking one marks it read and opens the actual
record (`noticeDestination()`): `?incident=`, `?affiliation=`, `?appeal=`, `?toda=`, `?application=`.

## 5. Accreditation expiry reminders

* The TODA administrators get a notice **7 days** before the accreditation certificate expires and another **when it has expired**. The 7 is `system_policy_config.toda_accreditation_reminder_days` (an array, default `[7]`).
* "Once per accreditation period": the notice's subject carries the certificate and its expiry date, and the table has a unique index on the recipient, type, subject and threshold. The sweep can run any number of times and writes each reminder once; a renewal gives a new expiry date, so it starts a new period.
* The notice states the TODA, the certificate number and the date, and links to **Account & Accreditation** (`/account`).
* The 30/14/3-day reminders that already existed are kept as they were (they are not period-aware).
* **Delivery failures:** a notice that cannot be written never undoes the action it reports. It is recorded as `NOTIFICATION_DELIVERY_FAILED` in the audit log with the recipient, type and the database's reason.

### SMS to TODA officers: evaluated, not implemented

What exists: an Android SMS gateway (`server/src/services/smsService.ts`: `sendOtpSms`, `verifyOtpCode`, `sendNoticeSms`) used by the **driver and passenger** sign-up and recovery. Its codes live in server memory for five minutes.

Why it is not switched on for TODA officers:

1. A TODA administrator's `contact_number` is typed during registration and edited in the profile. It is **never verified** (no OTP, no `contact_verified_at`). Sending an expiry notice with certificate details to an unverified number would send it to whoever the number belongs to.
2. The requirement says not to send sensitive reminders to unverified numbers, and no approved requirement asks for SMS to TODA officers.
3. Nothing records an SMS delivery today, so a failure could not be reported honestly.

What it would need (not built): a one-time code when the number is saved (`sendOtpSms` / `verifyOtpCode`, already there) and a `toda_admin.contact_verified_at` column cleared whenever the number changes; a dispatcher that sends only to verified numbers with `sendNoticeSms` for the same two events; and a delivery log row per attempt (sent / failed / reason) written to the audit log like the in-app failure above. The in-app notice is the reminder of record until then.

## 6. Announcements and the emergency declaration

* Announcements now **store their event type** (`announcement.event_type`: General, Terminal Rules, Document Renewal, Meeting Notice, Safety Advisory, Road Closure, Weather, Emergency, Fare Update, Service Notice; a check constraint). The icon follows it everywhere (`AnnouncementEventIcon`): the TODA and LGU forms (changing the type changes the icon at once), the lists, and the Passenger and Driver notice lists. Before this, the TODA form's "Category" was never saved and every announcement came back as General. Old rows are General. A declared calamity publishes an **Emergency** announcement.
* The multi-line text boxes of both portals started their text 28 px in (the box padded 14 px and the theme padded the text area 14 px again) while one-line fields started at 14 px. The theme now gives the text area the whole inset. In the Passenger and Driver apps, the notice details started at 20 px while their header and list start at 16 px; they now match.
* **Emergency declaration** (LGU Administrator only; the database refuses anyone else): declaring, changing (`update_calamity`) and ending are each one action and each audited (`CALAMITY_DECLARED`, `CALAMITY_UPDATED`, `CALAMITY_ENDED`). While one is in effect the panel is framed in orange with an "IN EFFECT" label and says what is suspended, what is never paused, who is affected, where, and how long (the optional expected end is a date, shown to users). The Passenger and Driver banners say the same words (`calamityDetails()`).
* **What a declaration suspends is the strike count, and nothing else** (cancellations, stalls and no-shows; or every violation that can be paused). Serious and safety violations are always enforced. Bookings and trips are not blocked by it. The panel says exactly that and does not claim more.

## 7. Open items

1. The follow-up cooldown (24 h) needs an owner-approved figure.
2. SMS to TODA officers needs the verification flow above and an approved requirement.
3. The emergency declaration's kind and scope cannot be changed once declared (end it and declare another).
4. The 30/14/3-day TODA reminders that existed before this batch are not period-aware.

## Applying it

Run `supabase/migrations/20261102000001_batch2_incident_followup_notifications_reminders.sql` once in the Supabase SQL editor before using the new screens: they call `incident_send_followup`, `incident_lgu_acknowledge`,
`mark_portal_notifications_read` and `update_calamity`, and read the new columns. Until it is run, those buttons show the database's "function not found" sentence.
