# Database tests (local PostgreSQL emulator)

These suites run the real `supabase/migrations/*.sql` on [PGlite](https://pglite.dev) (PostgreSQL in
WebAssembly) so policy rules enforced in the database can be tested without a Supabase project.
**They never connect to Supabase.**

```bash
node scripts/db-tests/run-all.js            # everything
node scripts/db-tests/run-all.js batch3     # one folder
node scripts/db-tests/run-all.js engine     # suites whose path contains "engine"
node scripts/db-tests/run-all.js batch5     # the fare suites (formula, rules, booking guards, trip distance, client contract, config drift)

B4_FULL_CHAIN=1 node scripts/db-tests/run-all.js batch4   # run the Batch 4 suites on EVERY migration (regression check)
```

`run-all.js` takes one filter. The Batch 3 and Batch 4 suites normally stop at their own last migration.
`B4_FULL_CHAIN=1` makes the Batch 4 suites apply the whole chain instead, which proves later batches did not
change presence behaviour (the Batch 3 suites have no such switch). The Batch 5 fare suites always run on the
whole chain.

## How it works
- `lib.js` builds the Supabase pieces the migrations rely on: the `anon` / `authenticated` /
  `service_role` roles (`service_role` bypasses RLS like the real one), `auth.users`,
  `auth.uid()` / `auth.role()` / `auth.jwt()` (read from `request.jwt.claim.*`), a `storage` schema, and
  `uuid-ossp`. It then applies the migrations in order, optionally stopping at a given file.
- `tlib.js` has `freshDb(untilMigration)`, `asUser(db, { uid, role }, fn)` (runs `fn` as a signed-in user, a
  service role or anon inside a transaction), `attempt()` and `check()`.
- `fixtures.js` seeds two passengers, drivers in two TODAs, an LGU admin and two TODA admins.
- Each suite prints `N passed, M failed` and exits non-zero on failure.

## Writing a suite for a new batch
1. Create `scripts/db-tests/<batchN>/<topic>.js`.
2. `const db = await freshDb('<last migration file of the batch>.sql')`, `await seed(db)`.
3. Call engine functions as the caller you want to test (`asUser(db, { uid: ID.L_AUTH }, ...)` for an LGU
   admin, `{ role: 'service_role' }` for the server, `{ uid: ID.P_AUTH }` for a passenger).
4. Pass `{ commit: true }` to `asUser` when later steps need the data; otherwise it rolls back.

## Pitfalls
- The engine is a single connection: never `await db.query()` while inside an `asUser` callback (it waits
  for the transaction and hangs). Resolve ids before opening the transaction.
- A passing "can do X" check that updated 0 rows proves nothing; assert `rowCount` for writes.
- Updating a column to the value it already has is not a change, so protection triggers will not fire.

## Note
The migrations are applied exactly as they are in the repo (no patching), so these suites also prove that
a fresh database can be built from `supabase/migrations`.

## Fresh-session tests (bugs that only show in a brand-new database session)
Every suite above runs in a session that has already executed migration statements, so custom settings such as
`sakay.internal_context` are defined (they read as an empty string). On the hosted database a freshly opened
connection has never set them (they read as NULL), and a check like `IF NOT helper()` that gets NULL silently skips.
`security/null-safe-service-context.js` shows the technique: build and seed a database, `await db.dumpDataDir()`, and load
the dump into a new instance (`new PGlite({ loadDataDir: dump, extensions })`). Use one new instance per probe and refuse to
run a probe on an instance where `current_setting('sakay.internal_context', true)` is not NULL.

## Service-area gate (`batch1/service-area-gate.js`)
`20261016000001` on the whole chain: a trip must start AND end inside the active service area (a destination in Puerto Galera or Manila is refused with `ERR_DESTINATION_OUT_OF_SERVICE_AREA`, a pickup outside keeps `ERR_OUT_OF_SERVICE_AREA`), the 16 km edge (15.8 km in, 16.2 km out), the gate follows a narrowed pilot area for both ends, and a passenger cannot widen the area (14 checks; 5 fail on the chain without the migration).

## Batch 6 suites (`batch6/*.js`, `e2e/solo-trip.js`): dispatch, the booking lifecycle and the booking timers
These prove the five `20261015*` migrations on the whole chain. The search for a driver and every deadline of an accepted booking are stored in
the database, so the suites **move the stored timestamps back** (`rewind`, `age`, `silence` in `b6fixtures.js` and the suites) instead of waiting
minutes; the apps are never involved except as callers of the same RPCs they use. `b6fixtures.js` builds the Batch 5 fixtures plus TODA terminals,
drivers placed N metres from the pickup, and the apps' calls (`accept`, `decline`, `driverCancel`, `statusOf`, `retry`, `sweep`).

| Suite | Proves |
|---|---|
| `batch6/dispatch-engine.js` | The three tiers, the Priority TODA, the exact ranking, sequential offers and their expiry, the widening live search and its end, one eligibility function, Retry (new cycle), a search that was already running at deploy time, offers that count toward the inactivity rules (82 checks). |
| `batch6/offers-and-assignment.js` | Atomic accept (two drivers, an expired offer, a double tap), decline reasons and the Rule 7.9 flag, the doors closed (the apps cannot write or read offers; who may call which function), the LGU Administrator's two settings with their range checks and audit (74 checks). |
| `batch6/booking-lifecycle.js` | Rule 4.4 over every status the apps write, the status guard (who may move a booking where, the server's clock for every moment), Rules 12.1 / 12.2 / 12.9 (passenger), 12.3 / 12.4 / 12.7 / 12.8 (driver, redispatch, the end of the cycle), Rule 16.6 (75 checks). |
| `batch6/booking-timers.js` | Rules 8.2 - 8.5 (warning, cancellation, en-route stall, the reported delay), 9.2 / 9.3 / 9.5 (unreachable, provisional strike, a trip is never cancelled), 10.1 - 10.5 (the arrival wait, "I'm Almost There" exactly once, the guarded No-Show, no reinstatement), the single-use redispatch credit (a tie-breaker only), 12.6, idempotence, who may read or write these clocks, a trip in flight at deploy time, and that both sweeps read the booking table through their partial indexes (97 checks). |
| `batch6/config-drift.js` | Every number and list the apps mirror from the database (`policyConfig.ts`, `bookingUtils.ts`) equals what the database enforces, and a constant on one side only fails (63 checks). |
| `e2e/solo-trip.js` | One whole solo trip, start to finish, as the apps do it: book, offer, accept, arrive, ride, fare lock, confirm (50 checks). |

## Perimeter lockdown suites (`security/perimeter-*.js`) and the server tests
These prove the five `20261008*` migrations (stages S0 - S4), the operator scripts and the Express layer. None of them touches Supabase.

| Suite | Proves |
|---|---|
| `security/perimeter-s0-signup.js` | S0 on the pre-lockdown database: the sign-up escalation works before, and a sign-up can create only Pending passenger / driver rows after (22 checks). |
| `security/perimeter-s1-expand.js` | S1: the policy helpers, `list_accredited_todas()`, `find_candidate_drivers()` (removed by Batch 6, which this suite now proves), `get_booking_counterparties()`, `get_assigned_driver_details()`, `get_my_toda_affiliations()`, `register_toda_with_admin()` and every insert / update guard. Runs on the whole chain, so it also keeps proving S1 after S2 - S4. |
| `security/perimeter-lockdown.js` | S2 - S4: function privileges, the row-security matrix (anon, a signed-in stranger, passenger, driver, TODA administrator, LGU administrator), storage, and the sign-up / registration paths on the locked-down chain. Also has a sensitivity run: with S2 - S4 removed from the chain the same suite fails (48 checks), so the checks can fail. |
| `security/perimeter-apply-script.js` | `scripts/applyPerimeterLockdown.js` on a local rehearsal database (`--emulator`): its argument and safety rules, the read-only preflight, a dry run of every stage, and `selftest` (apply S0 - S4, then the generated emergency rollback, and the perimeter must be back exactly as the snapshot recorded it). `DATABASE_URL` is blanked, so it can never reach a hosted database. |
| `security/perimeter-verify-script.js` | `scripts/verifyPerimeter.js` (the anonymous black-box check) against a local stand-in server that answers like the locked-down project (must report nothing exposed) and like the open project of before (must report the exposures). |
| `security/perimeter-relink-login.js` | `scripts/relinkDriverLogin.js` (repairs a driver whose login e-mail is not the one the Driver app derives from the phone number), before and after the lockdown. |
| `security/multi-affiliation.js` | `20261009000001` and `20261009000002` on the whole chain: `apply_driver_toda_affiliations()` (one Submitted affiliation per selected TODA, own membership / terminal / barangay, idempotent, refuses inactive TODAs and anon), read-only visibility for the administrator of every TODA the driver applied to (and no write access), the TODA stage and the LGU stage decided per affiliation, going Online under the active affiliation only, a rejection of one affiliation not rejecting the driver, the `booking.passenger_id` fix (with a control run on the pre-fix chain), and `supabase/scripts/safe_test_data_cleanup.sql` PART 4 (dry run, apply, orphan login, refuses an administrator) (49 checks). |
| `security/document-returns.js` | `20261010000001` on the whole chain: the old client writes are refused (why the status never changed), `return_driver_documents()` (which documents, preset code + required free text, validation, who may return what, sequential LGU stage), per-document state for the driver / each TODA / the LGU (another TODA's flag shown without its reason), row security and append-only history, TODA2 not blocked or altered by TODA1's return, `resubmit_driver_documents()` (only returned documents, only the affiliation whose documents are all replaced goes back to review, the 5-day clock restarts, the reminder and overdue state start over on the real scheduled job), MTOP-only / tricycle-only / two-at-once returns, TODA + LGU returns on one driver, the pre-migration legacy return, and the status-screen classification (74 checks). |
| `e2e/return-for-correction.js` | The scripted end-to-end scenario, run for licence only, MTOP only, tricycle photo only and licence + tricycle at once: register, the TODA returns with reasons, the driver's screen asks for exactly those documents, the driver resubmits, "Resubmitted, awaiting TODA review", the TODA sees the Resubmitted state, the previous reason, the restarted clock, the notification and the audit trail, the TODA endorses, the LGU approves (68 checks). Needs Node 22.18+ (it loads the shared `.ts` classifier directly). |
| `security/otp-failed-attempt-window.js` | `20261010000002` on the whole chain: the OTP lockout counter. BEFORE: after the 15-minute lock runs out ONE wrong code locks the number again (the reported bug); AFTER: the first failure after a finished lock or stale failures counts as 1, five still lock for 15 minutes, the grants (service role only) are unchanged. |
| `security/permanent-rejection-reasons.js` | `20261010000003` on the whole chain: `reject_driver_affiliation()` accepts exactly the five permanent grounds (fraudulent, license_mtop_revoked, ineligible, duplicate_identity, failed_background_check) with an optional note and refuses everything else; the LGU's old categories still work; one affiliation at a time; a rejected application cannot be re-applied to, endorsed or returned; anon is refused. |
| `security/reapplication-lgu-only.js` | `20261010000004` on the whole chain: `allow_driver_reapplication()` is for LGU administrators only (BEFORE: the TODA could undo its own rejection) and needs a reason of at least 10 characters; the audit entry names the administrator, the reason and what was cleared; a permanently disqualified driver and a live application are refused; the driver cannot re-apply to the rejecting TODA or resubmit a rejected application. |
| `security/roster-match-and-override.js` | `20261010000005` on the whole chain: ONE roster match (franchise or plate, entries made before the application, never the name): `get_affiliation_roster_matches()` for the TODA screen gives the same answer as `endorse_driver_affiliation()` on six cases; who may ask it; `verify_driver_affiliation()` refuses an approval while a Roster Mismatch flag is open unless the LGU gives a reason (at least 10 characters), which goes to the flag's resolution and the audit log; no reason is asked for a matched applicant; the old 4-argument function is gone. |
| `security/perimeter-toda-admin-login.js` | `scripts/todaAdminLogin.js` (creates the administrator login of a TODA that has none, or resets the password of the one it has), before and after the lockdown: the preview changes nothing, one transaction, the password rules and the refusal of public passwords, and the cases it must refuse (two administrators, a taken address, an unknown TODA) (49 checks). |

`security/perimeter-lockdown.js` and `perimeter-s1-expand.js` use the stub for `storage.foldername()` and the storage grants that `lib.js` now provides, and `batch5/booking-guards.js` and `security/null-safe-service-context.js` were updated for the scoped policies (a non-participant now sees no row, or gets "permission denied", instead of an application error).

Server tests (Node's built-in runner through `tsx`; a fake Supabase client, no network, no database):

```bash
cd server
npx tsc --noEmit
npx tsx --test test/*.test.ts
```

`test/auth.test.ts` (token check, role rows, fail-closed behaviour), `test/app.test.ts` (default deny, role gates, body limits, CORS and headers, scheduler secret, error handling, rate limits) and `test/routes.test.ts` (OTP, the driver-to-passenger SMS, the LGU and TODA outcome messages, the phone helpers).

Operator scripts (they read `DATABASE_URL` from `server/.env` and print no credentials or personal data):

```bash
node scripts/applyPerimeterLockdown.js preflight          # read-only; writes a snapshot + an emergency rollback script
node scripts/applyPerimeterLockdown.js dryrun all         # every stage, then ROLLBACK
node scripts/applyPerimeterLockdown.js apply S0           # one stage per run; S2 - S4 need --apps-deployed
node scripts/verifyPerimeter.js --server https://<server> # anonymous black-box check, read-only
node scripts/relinkDriverLogin.js <mobile number>         # repairs one driver's login e-mail; preview, then add --apply
node scripts/todaAdminLogin.js <ACRONYM>                  # creates / resets a TODA administrator login; preview, then add --apply
node scripts/applyPerimeterLockdown.js selftest           # local only: what perimeter-apply-script.js runs
```
