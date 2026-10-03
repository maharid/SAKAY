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
