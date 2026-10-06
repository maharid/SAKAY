# SAKAY Capstone Checklist: Accomplishment Audit

Checklist audited: `SAKAY - Checklist.pdf` (128 line items, four roles; the Points and Score columns in the PDF are blank).

**Status after Day 1 (2026-10-06):** the first audit scored 80.9% (strict 74.2%). The Day 1 work lifts 13 items; the totals below are the updated ones. The Day 1 items need migrations `20261012000001` and `20261012000002` applied to the hosted database before they work live.
Code audited: git `HEAD d367ec2` (2026-10-06): the four apps, the Express server, the Supabase migrations and the shared package.
Method: each item was traced from the screen down to the data it uses (service function, database table or function, server route). I did not run the apps; "works" means the code path is complete and uses real data.

## Scoring

| Mark | Meaning | Points |
|---|---|---|
| I | Implemented: complete, uses real data from the database | 1 |
| P | Partial: part works, or the screen exists but some data or step is missing, fake or broken | 0.5 |
| M | Missing: not built, switched off, or cannot work | 0 |

Percent = points / items. The checklist gives no weights, so every item counts the same.

## Result

| Role | Items | I | P | M | Points | Percent |
|---|---|---|---|---|---|---|
| LGU Administrator | 42 | 40 | 2 | 0 | 41.0 | **97.6%** |
| TODA Administrator | 29 | 18 | 6 | 5 | 21.0 | **72.4%** |
| Passenger | 25 | 22 | 1 | 2 | 22.5 | **90.0%** |
| Driver | 32 | 28 | 1 | 3 | 28.5 | **89.1%** |
| **Total** | **128** | **108** | **10** | **10** | **113.0** | **88.3%** |

(Before Day 1: 95 / 17 / 16 and 103.5 points = 80.9%.)

Strictest reading (only fully working items count, partials count zero): 108 / 128 = **84.4%** (before Day 1: 74.2%).

---

## LGU Administrator (42 items)

| # | Item | Mark | Evidence and notes |
|---|---|---|---|
| 1 | View Dashboard | I | `fetchDashboardStats` counts real passengers, drivers, TODAs, bookings, incidents. |
| 2 | View TODA applications | I | `fetchTodaApplications`. |
| 3 | Review submitted information | I | Application review modal. |
| 4 | Review submitted documents | I | Clearance, driver list, bylaws open through signed storage links. |
| 5 | Approve TODA application | I | Calls `approve_toda_accreditation`. Caveat: the portal does not ask for the real certificate number or expiry; it generates `CERT-LGU-<year>-<random>` and a 3-year expiry (`adminApiService.ts` `approveTodaApplication`). |
| 6 | Return application for correction | I | `returnTodaApplicationForCorrection`. |
| 7 | Reject TODA application | I | `rejectTodaApplication`. |
| 8 | View accredited TODAs | I | `fetchAccreditedTodas`. |
| 9 | View TODA information | I | TODA detail modal. |
| 10 | View service coverage | I | "Service Coverage Area" and terminal map pin in the detail modal. |
| 11 | View registration and accreditation information | P | Accreditation number and dates are real, but the document list in the same modal is hard-coded placeholders ("SEC / CDA Registration Certificate", "Mayor's Permit", date "2024") (`TodaDetailModal.tsx` ~L133). |
| 12 | View driver records | I | `fetchDrivers`. |
| 13 | Review driver verification information | I | Driver detail modal with documents, renewals, roster flag. |
| 14 | View driver TODA affiliation | I | Per-affiliation status (multi-affiliation added in migration `20261009000002`). |
| 15 | Manage driver account status | I | Suspend, reactivate, record strike through `admin_suspend_account`, `admin_reinstate_account`, `issue_strike`. |
| 16 | View passenger records | I | `fetchPassengers`. |
| 17 | View passenger account information | I | Real name, phone, status, strikes. Caveat: "total bookings" is always 0 and "rating" is always 5.0 (hard-coded). |
| 18 | Manage passenger account status | I | Suspend, reactivate, strike. |
| 19 | View active trips | I | Live Trips, Active tab. |
| 20 | View completed trips | I | Completed tab. |
| 21 | View cancelled bookings | I | Cancelled tab (includes No Driver Found). |
| 22 | Monitor ongoing trips | I | Map plus 10-second refresh (polling, not push). |
| 23 | View submitted incident reports | I | Reports now save for real (Day 1, migration 20261012000001) and appear here with the passenger photo. |
| 24 | Review incident details | I | Incident detail modal with status history. |
| 25 | View related trip information | I | Trip and booking reference in the modal. |
| 26 | Update incident status | I | `updateIncidentStatus` (Under Investigation, Resolved, Dismissed). |
| 27 | View ratings | I | `fetchPassengerFeedback`. |
| 28 | View passenger feedback | I | Same page. |
| 29 | Review complaints | P | Rating filter and search only; no complaint workflow. |
| 30 | Booking reports | I | Reports, Bookings tab, CSV export. |
| 31 | Driver utilization reports | I | Reports, Drivers tab (completed trips per driver). |
| 32 | TODA performance reports | I | Reports, TODA tab. Caveat: "compliance rate" is hard-coded 100%. |
| 33 | Peak-hour reports | I | Hourly distribution from real booking times. |
| 34 | Barangay demand reports | I | Day 1: the barangay is read from the pickup address text against the list of Calapan barangays; an address that names none is listed as "Not identified". |
| 35 | Service utilization reports | I | Day 1: Reports, tab 6 "Service Utilization" (completed, cancelled, no driver found, in progress, solo vs shared), with CSV export. |
| 36 | View booking trends | I | Day 1: 14-day booking trend chart on the Analytics page, computed from the bookings. |
| 37 | View peak travel periods | I | The Peak Hours report (in Reports, not on the Analytics page). |
| 38 | View demand hotspot maps | I | Day 1: hotspots are clusters of real pickup coordinates (about 550 m areas, top 8); the five fixed places are gone. |
| 39 | View service utilization | I | Day 1: outcome bars (completed, cancelled, no driver found, in progress) and solo/shared mix, from the bookings. |
| 40 | View driver utilization | I | Day 1: verified drivers who completed a trip in the last 30 days (the fixed 84% is gone); the per-driver table is in Reports. |
| 41 | View Audit Logs | I | Reads the real `audit_log` table. Not every action in the apps writes to it yet. No export. |
| 42 | Manage Account Information | I | Name, email, password through Supabase Auth. |

## TODA Administrator (29 items)

| # | Item | Mark | Evidence and notes |
|---|---|---|---|
| 43 | Register TODA (name, acronym, registration number, date established) | P | Name, acronym, date established exist. There is no registration number field in the form. |
| 44 | Register office information (terminal, barangay, coverage, contact, email) | I | Terminal map picker, barangay list, coverage area, contact details. |
| 45 | Register authorized officers (President, VP, Secretary, Treasurer) | I | All four with contact numbers. |
| 46 | Verify mobile number via OTP | M | TODA registration does not verify the number (documented in `policy-decisions.md` 8.5). |
| 47 | Submit accreditation documents (Barangay Clearance, driver list) | I | Uploads to private storage. |
| 48 | Monitor accreditation application status | I | Status chip, return-for-correction and resubmit flow. |
| 49 | Edit profile information | I | `updateTodaProfile`. |
| 50 | View driver applications submitted to the TODA | I | Driver Verification page. |
| 51 | Confirm the applicant is on the TODA's roster | I | Master Roster match check and flag (Rule 2.4). |
| 52 | Review tricycle photo (franchise number, sticker) | I | Document viewer with per-document return. |
| 53 | Forward application to LGU | I | Now calls `endorse_driver_affiliation` (fixed in commits of 2026-10-05/06). |
| 54 | View driver records | I | Driver Membership. |
| 55 | Suspend or reactivate drivers | P | The TODA admin can only send a recommendation to the LGU (`suspendTodaDriver` creates a review flag). |
| 56 | Update member information | P | Roster entries can be added; members cannot be edited. |
| 57 | View active bookings | I | Operations page. |
| 58 | View active drivers | P | Counts drivers whose account is Active, not drivers who are Online right now. |
| 59 | View ongoing trips | I | "Active Trips" panel. |
| 60 | View booking statistics | I | Active, completed today, cancelled today. |
| 61 | View driver utilization statistics | M | Driver table shows name, franchise, status only. |
| 62 | Publish announcements to TODA members | I | `postTodaAnnouncement`; drivers see them under Abiso. |
| 63 | Send reminders | M | No reminder feature (announcements only). |
| 64 | Daily, weekly, monthly booking reports | P | One trip ledger with date filter and CSV; no daily/weekly/monthly roll-ups. |
| 65 | Driver trip volume and activity reports | M | Not built. |
| 66 | Platform booking volume reports | M | Not built (a count of ledger rows only). |
| 67 | Incident summary reports | I | Incidents and Complaints tab, status filters, CSV. |
| 68 | Estimated gross fare value reports | P | Fare per trip in the ledger; no gross total report. |
| 69 | View bookings and incidents | I | Reporting page. |
| 70 | Review incident details | I | Incident modal. |
| 71 | Escalate incidents to LGU | I | `escalateIncidentToLgu`. |

## Passenger (25 items)

| # | Item | Mark | Evidence and notes |
|---|---|---|---|
| 72 | Register (name, mobile, password) | I | Real sign-up; under-12 age rule; duplicate numbers blocked. |
| 73 | Verify mobile number via OTP | I | Server issues and checks the code (5 min, 5 tries, 15-minute lock). Sends real SMS. |
| 74 | Edit profile (name, address, photo, password) | I | `ProfileEditor` and `ChangePasswordPage`. |
| 75 | Recover password via OTP re-verification | M | Switched off on purpose: the screen only shows help text (`ForgotPassword.tsx`). |
| 76 | Set pickup by GPS or manual pin | I | Map picker with GPS. |
| 77 | Search and select destination by address or landmark | I | OpenStreetMap Nominatim search. |
| 78 | Specify passenger count | I | |
| 79 | View estimated fare before confirming | I | Fare comes from the database function `quote_fare`; no formula in the app. |
| 80 | Confirm the booking request | I | Creates the booking; the dispatch loop runs in the passenger's browser (see Beyond the checklist). |
| 81 | Enable the shared ride option | I | Option and notice work. Matching of a second passenger is not built (Batch 10). |
| 82 | View the shared fare estimate before confirming | I | Matched estimate and Maximum Unmatched Fare both shown. |
| 83 | View the finalized proportionate fare allocation after completion | M | `allocate_shared_fares` exists in the database but nothing calls it; no matched trips exist. |
| 84 | View the driver's live location | I | Position through `get_assigned_driver_details` and a broadcast channel. |
| 85 | View driver name, photo, franchise number | P | Name and franchise number shown; no driver photo is returned or displayed. |
| 86 | Monitor trip progress pickup to destination | I | Progress bar and status steps. |
| 87 | View estimated time of arrival | I | Shown, but computed as a fixed 3 minutes per km, not from the routing engine. |
| 88 | Submit rating and written feedback | I | Writes to the `rating` table. |
| 89 | Review previously submitted feedback | I | Trip detail reads the `rating` table. |
| 90 | Select an incident type | I | Day 1: pick the completed trip, choose the category; the report is saved in the database. |
| 91 | Provide a written description | I | Day 1: saved with the report; real errors are shown instead of a fake success. |
| 92 | Attach optional photo evidence | I | Day 1: the photo is uploaded to the private evidence bucket (own folder), shown to the TODA administrator and the LGU. |
| 93 | Monitor the status of a submitted report | I | Day 1: the list and detail read the database; the status follows the TODA and LGU review; a Pending report can be withdrawn. |
| 94 | View a list of completed trips | I | `fetchTripHistory`. |
| 95 | Review fare history for past trips | I | Trip detail shows the fare. |
| 96 | Rebook a previous destination | I | Rebook button on history and detail. |

**Why 90 to 93 are marked down.** `IncidentReporting.tsx` (~L97) inserts `severity` (no such column), `created_at`, `category`, `description`, `status`, and leaves out `booking_id` and `reported_by`, which are NOT NULL in `incident_report` (`20260717123236_init_schema.sql` L647). The insert fails, the error is swallowed, the report is stored only in the phone's `localStorage` and the screen says it was submitted. The fare-dispute report in `TripMonitoring.tsx` (~L1652) has the same problem (it sends `driver_name`, `reporter_name`, `reporter_role`, `reported_at`, a text `incident_id`; none of them match the table). No incident from the Passenger app reaches the TODA or LGU portal today.

## Driver (32 items)

| # | Item | Mark | Evidence and notes |
|---|---|---|---|
| 97 | Register (name, mobile, password) | I | |
| 98 | Select one or more TODAs from the accredited list | I | Multi-select; one affiliation per TODA (migration `20261009000002`). |
| 99 | Verify mobile number via OTP | I | Same server OTP as the passenger. |
| 100 | Submit documents (license, MTOP, tricycle photo) | I | Camera scan, OCR, upload to private storage; also face photo. |
| 101 | Monitor application status | I | `DriverStatusMonitor` with return reasons and resubmission. |
| 102 | Edit profile information | I | `DriverProfileEditor`. |
| 103 | Select active TODA affiliation | I | Picker on Home, locked while Online. |
| 104 | Select the verified tricycle unit | P | One unit per driver, shown read-only and locked once verified; there is no unit table and nothing to select. |
| 105 | Set status online or offline | I | Server-side `driver_go_online` / `driver_go_offline`, survives navigation and refresh. |
| 106 | Pause bookings temporarily | I | Day 1: "Pause bookings" on the Home screen (15, 30 or 60 minutes) while Online; no offers reach a paused driver (database-enforced). |
| 107 | Resume bookings | I | Day 1: "Resume" ends the pause at once; it also ends by itself, and going Offline clears it. |
| 108 | Receive booking requests | I | Incoming request modal. |
| 109 | Accept a booking request | I | |
| 110 | Decline a booking request | I | Works. No decline-reason choice (the policy, Rule 7.9, asks for one). |
| 111 | View passenger details and trip information | I | Name always; phone only while the trip is live. |
| 112 | Route guidance to pickup | I | OSRM road route on the map. |
| 113 | Route guidance to destination | I | |
| 114 | View estimated travel time | I | Shown, from an assumed 20 km/h, not the routing engine's duration. |
| 115 | Start a trip upon passenger pickup | I | |
| 116 | Receive an Additional Shared Passenger Request | M | The state variables exist in `DriverActiveTrip.tsx` L68 to 71 but nothing ever sets them; no request is ever created. |
| 117 | Accept or reject that request | M | Same. |
| 118 | Complete a trip upon reaching destination | I | Final fare computed by the database. |
| 119 | View the recalculated proportionate fare after an additional passenger | M | Same. |
| 120 | View a trip fare summary | I | |
| 121 | Review completed trip fare records | I | |
| 122 | Monitor daily and weekly recorded fare totals | I | Today and last-7-days totals. |
| 123 | Send custom SMS messages | I | Opens the phone's own SMS app with the text (matches the no in-app messaging rule). |
| 124 | Use pre-defined message templates | I | Templates by trip stage. |
| 125 | Call a passenger with the native phone app | I | `tel:` link. |
| 126 | Receive booking alerts, reminders, announcements | I | Offers, inactivity and expiry reminders, TODA announcements. |
| 127 | View a list of completed trips | I | |
| 128 | Review trip details (pickup, drop-off, fare) | I | |

---

## Beyond the checklist: what a working system also needs

These are not checklist lines, so they are not in the percentage, but they decide whether the system works in real use.

| Area | State |
|---|---|
| Policy batches | Batches 0 to 5 done; Batches 6 to 13 (dispatch, stall and connectivity, no-show and cancellation, trip completion and disputes, ride-sharing, incidents and emergencies, ratings and fraud, final audit) are not built. |
| Dispatch | Runs inside the passenger's browser (`dispatchService.ts`); if the passenger closes or backgrounds the app, dispatch stops. Batch 6. |
| Database on the hosted project | I cannot see it. Five migrations dated 2026-10-09 to 10-10 (multi-affiliation, document returns, OTP window, rejection reasons, roster override) and Batch 4's `20261006000003` may not be applied there. Check with `node scripts/applyPerimeterLockdown.js preflight` and the migration history. |
| Maps and routing | Uses the public OpenStreetMap and OSRM demonstration servers; not allowed for production load. |
| SMS | Goes through an Android phone gateway on a SIM (`SMS_GATEWAY_*`); one phone is a single point of failure. |
| OTP store | Held in server memory: a server restart loses issued codes. The free Render plan also sleeps. |
| Realtime channels | Trip and position broadcast channels are public (decision D-SEC-13). |
| Scheduled jobs | Presence sweep runs in the database (pg_cron). The SLA and expiry jobs still depend on the Express server timer. |
| Security | Perimeter lockdown (S0 to S4) written and tested locally; whether it is applied on the hosted project is not visible to me. Sign-ups are open by design. |
| Tests | 27 database suites (all pass locally), 119 server tests; no automated tests for any screen; no CI workflow in the repository. |
| Data quality | Analytics values that are fixed in code: five map hotspots, "84%" utilization, "100%" compliance, passenger "rating 5.0 / 0 bookings", placeholder TODA documents. |
| Not in the checklist but in the policy | Audit log export to PDF or Excel (Rule 28.4), the exemption and appeal screens, the emergency strike-pause screen. |

## What is still open, in order of payoff

Done on Day 1: passenger incident reports (items 23, 90 to 93), the LGU analytics and reports (34, 35, 36, 38, 39, 40) and driver pause and resume (106, 107).

1. Ride-sharing end to end (matching, the driver's additional-passenger request, recalculated and final fare): Driver 116, 117, 119 and Passenger 83.
2. TODA reports and tools (daily/weekly/monthly roll-ups, driver volume, platform volume, gross fare, reminders, member edit, registration number): TODA 43, 55, 56, 58, 61, 63, 64 to 66, 68.
3. TODA OTP on registration (46) and passenger password recovery with OTP (75).
4. Smaller: the driver photo on the passenger's trip screen (85), choosing a verified tricycle unit (104), the placeholder documents on the accredited-TODA detail screen (11), and a complaints view (29).
