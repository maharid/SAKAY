# Batch 3: exports, incident resolution, dashboard, settings, live trips, fare and service area

Database objects are in `supabase/migrations/20261103000001_batch3_incident_investigation_feedback_profile.sql` (forward-only, safe to run twice, **not applied to the hosted
database**: run it in the Supabase SQL editor before using the new incident, feedback and profile screens). Rehearsal on the local emulator:
`node scripts/db-tests/batch16/incident-investigation.js` (22 checks) and `node scripts/db-tests/batch16/feedback-and-profile.js` (29 checks).

## Typography

The portals' font is **Poppins** again (`@fontsource/poppins`, weights 400 to 700), the same as the Passenger and Driver apps and the font AGENTS.md names. Evidence from the Git history:

| When | What the LGU and TODA portals used |
| --- | --- |
| 2026-08-17 (`b6b675f`) | system stack with Inter (`--mac-font-family`) |
| 2026-08-27 (`f32f039`) | Mona Sans (CDN link and `@fontsource/mona-sans`) |
| 2026-08-28 (`67a7b79`) to the last commit (`30fee02`) | the MUI theme and the shared components use **Poppins** (`@fontsource/poppins`); the page CSS variable still named "Mona Sans" and `index.html` still linked the Mona Sans CDN |
| Batch 1 (uncommitted) | switched the theme to `@fontsource/mona-sans` |

Batch 3 puts `main.tsx` (theme and imports), `macOS-theme.css` (`--mac-font-family` and `--sakay-font-family`) back on Poppins. `@fontsource/mona-sans` is still listed in the two portals'
`package.json` but nothing imports it any more (`npm uninstall @fontsource/mona-sans --workspace=apps/lgu-portal --workspace=apps/toda-portal` removes it).

## The export design (LGU and TODA)

One implementation: `packages/shared/src/utils/reportExport.ts`, `csvDownload.ts`, `auditLog.ts` and the `ExportToolbar` component. Every report, the incident lists and both audit logs use it.

* **Toolbar:** a labelled "Export" group with Excel, CSV and PDF (`ExportToolbar`). While one file is being made all three are disabled. The confirmation is a toast that goes away by itself.
* **Audit first:** the export is written to the audit log **before** any file is made (`record_audit_export`, `REPORT_EXPORTED`). If that fails, no file is made and the person is told why.
* **Excel:** SAKAY header, report title, what it covers (the filters in words), organisation, when, who exported it; the summary above the table; a filter on the heading row; column widths; a footer.
* **PDF:** a SAKAY band and the report's title on every page, column widths in proportion to the content, long text wrapped, numbers right-aligned, the heading row repeated, "Page 2 of 5" and the exporter in every footer. The audit log's PDF is a real PDF now (it used to be the browser's print dialog).
* **CSV:** data only: one heading row of clean column names, every cell quoted with quotes doubled, a byte-order mark so Excel reads Filipino characters. A text starting with `=`, `@`, a tab, or `+`/`-` followed by something that is not a number gets a leading apostrophe, so a name typed by a user can never run as a formula.
* **File names:** `sakay_<scope>_<report>_<YYYY-MM-DD>_<HHmm>.<ext>` in Asia/Manila time, for example `sakay_lgu_audit_log_lgu_2026-10-31_1430.pdf`.
* **What is exported:** exactly what the page shows for its filters. The incident lists export the filtered rows; the audit logs export the dates, the search text **and the category** (the category filter used to be ignored by the export). Row-level security decides what each account can read: a TODA administrator receives only their own audit entries and their own TODA's records.

## Incident resolution (LGU)

The four steps (Review, Investigate, Decide, Finalize) share one set of rules, `packages/shared/src/utils/incidentResolutionSteps.ts`, read by the Next button, the stepper and the last check before finalizing:

1. **Review:** the report is accepted or taken (recorded by the database).
2. **Investigate:** findings of at least 10 characters, **saved on the report** (`incident_record_investigation`: who, when, audited), and optionally who was contacted. The Next button saves them first.
3. **Decide:** an outcome; for an upheld or fabricated report an explicit strike choice (a strike, or "No strike"); points inside the strike's range; findings of at least 10 characters.
4. **Finalize:** steps 1 to 3 complete and the confirmation ticked, then a confirmation window.

A step is "Done" only when its requirements are met, never because it was opened. Going back is always possible and keeps what was typed. Going forward past an incomplete step, with Next or by clicking the stepper, is refused with a list of what is missing and takes the person to that step. The decision being prepared is kept as a draft on this computer until it is recorded; the investigation findings live in the database.

**What the database refuses on its own** (tested in `batch16/incident-investigation.js`): findings before the report is taken, findings under 10 or over 4000 characters, a contact that is not on the list, a TODA administrator on a serious report or another TODA's report, a passenger, a change after the decision; and the existing rules: a decision with findings under 10 characters, an outcome that is not on the list, a strike on an outcome that carries none, a TODA deciding the LGU's report, a second decision.
The database does **not** force the steps in order for a decision (a decision needs findings, not an earlier saved investigation): that would change the existing incident rules and tests.

"Other ways to handle this report" is shown only when this report allows one: hand it back to the TODA, mark it serious, or record a lost-item contact. Each is explained, needs a reason (10 characters), and asks for confirmation. A serious report has none of them, so the empty card of before is gone.

## Dashboard, reports and analytics (LGU)

* Review Flags: five on the Dashboard and "See more" to `/review-flags` (all of them, waiting or resolved). The panel and its resolution window are one component (`ReviewFlagsPanel`).
* Booking trend: now drawn from the real bookings of the last 7 days (it was never given data and always showed its empty message), with the change against the 7 days before and a tooltip per day. Driver verification: the groups add up to the total (the "Rejected 0" was a fixed zero; rejected and deactivated drivers are counted now), each with a tooltip saying what it means.
* Reports: the chart or the map is above its table. Peak hours: a 24-hour column chart with the busiest hour marked, one comparison table at a time (TODA or barangay), the exported table folded away. Hotspots: a map of the areas (circle sized by bookings) with the ten busiest ranked, pickups or drop-offs, all days, weekdays or weekends.
* Analytics: four groups in tabs (Overview, When and where, Drivers and passengers, Coverage gaps); the "Bars per" choice moved into its chart; the registration notes are one click away. The calculations are unchanged.

## Settings

* **English is the default** in the Passenger and Driver apps (a stored choice is kept). The booking and incident error messages that were written in both languages at once ("Tagalog (English)") follow the chosen language. Messages written by the database in both languages by design are left as they are.
* **Change password:** one shared window for both portals: asks for the current password (the login system checks it again), live rules, strength bar, mismatch message, a status while it works, the login system's own sentence when it refuses, a toast when it is done. The new password goes through `supabase.auth.updateUser`, as before.
* **Send feedback:** stored in `app_feedback` through `submit_app_feedback` (name and role come from the account; one reference per attempt so a double click is one feedback; at most five an hour; the LGU administrator reads all of it, a person reads their own). It no longer opens the mail program. The card spans the width of its parent.
* **LGU profile:** read view with Edit, Save and Cancel; name, position, office and mobile number are checked on the page and again by `update_my_lgu_profile` (audited, old and new values). The e-mail stays a separate, confirmed change; the account's status, login and role cannot be changed.

## Live trips, fare configuration and service area

* **Live trips:** the map's box is measured whenever it changes size and it is rounded and clipped to its card, with a key and a "Fit all trips" button. End a trip for safety is the modal card used by the TODA portal. **Driver search settings** (how long an offer and a search may take) were at the bottom of Live Trips under the table, away from anything they affect; they are on the Service Area page now, which is where drivers are found.
* **Fare configuration:** the figures strip and the "current rule" card said the same thing twice and the left card was stretched empty; one card holds the rule in force (the four figures in a row, then since when, who and the rule ID). The formulas, validation and the way a rule is enacted are untouched.
* **Service area:** a map of the area in force (the city boundary or the pilot circle) with the TODA terminals as pins and the pilot circle being set up as a dashed outline; what the area means for booking and for finding a driver; one "Change the service area" card (the whole-city card and the pilot card were two cards for one choice); earlier settings folded away.

## Left open

1. The migration is not applied; none of the new database functions exist on the hosted project until it is.
2. The decision draft (outcome, strike, findings being written) lives in this computer's storage; only the investigation findings are saved in the database.
3. Feedback has no inbox screen yet: the LGU administrator can read `app_feedback` in the database. The Passenger and Driver "Rate the app" screens still send nothing.
4. Messages the database writes in both languages (some incident and strike texts) still show both.
