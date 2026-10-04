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

## Perimeter lockdown suites (`security/perimeter-*.js`) and the server tests
These prove the five `20261008*` migrations (stages S0 - S4), the operator scripts and the Express layer. None of them touches Supabase.

| Suite | Proves |
|---|---|
| `security/perimeter-s0-signup.js` | S0 on the pre-lockdown database: the sign-up escalation works before, and a sign-up can create only Pending passenger / driver rows after (22 checks). |
| `security/perimeter-s1-expand.js` | S1: the policy helpers, `list_accredited_todas()`, `find_candidate_drivers()`, `get_booking_counterparties()`, `get_assigned_driver_details()`, `get_my_toda_affiliations()`, `register_toda_with_admin()` and every insert / update guard. Runs on the whole chain, so it also keeps proving S1 after S2 - S4. |
| `security/perimeter-lockdown.js` | S2 - S4: function privileges, the row-security matrix (anon, a signed-in stranger, passenger, driver, TODA administrator, LGU administrator), storage, and the sign-up / registration paths on the locked-down chain. Also has a sensitivity run: with S2 - S4 removed from the chain the same suite fails (48 checks), so the checks can fail. |
| `security/perimeter-apply-script.js` | `scripts/applyPerimeterLockdown.js` on a local rehearsal database (`--emulator`): its argument and safety rules, the read-only preflight, a dry run of every stage, and `selftest` (apply S0 - S4, then the generated emergency rollback, and the perimeter must be back exactly as the snapshot recorded it). `DATABASE_URL` is blanked, so it can never reach a hosted database. |
| `security/perimeter-verify-script.js` | `scripts/verifyPerimeter.js` (the anonymous black-box check) against a local stand-in server that answers like the locked-down project (must report nothing exposed) and like the open project of before (must report the exposures). |
| `security/perimeter-relink-login.js` | `scripts/relinkDriverLogin.js` (repairs a driver whose login e-mail is not the one the Driver app derives from the phone number), before and after the lockdown. |
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
