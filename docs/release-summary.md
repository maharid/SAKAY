# SAKAY: release readiness (2026-10-18)

This is the short answer to "is the system ready, and what is left?". The long answers are in `docs/policy-compliance-matrix.md` (rule by rule), `docs/policy-decisions.md` (every choice and why), `docs/policy-errata.md` (where the policy text itself is wrong) and `docs/owner-checklist.md` (what only you can do).

## 1. Where the code stands

Every section of the policy (1 to 29) is implemented in the database or the apps and has a test that runs the real database functions on the local emulator. On 2026-10-18 the whole repository was audited against the policy once more; 23 gaps (G1 to G23) were found and each is now built, decided, or handed to you:

| Kind | Gaps | State |
|---|---|---|
| Built and tested | G1 - G13 (seed, scheduled duties, password recovery, one passenger session, public channel, line endings, strikes and appeals screens, LGU appeals page, trip corrections, queue and availability reports, vehicle substitution, coverage gaps and decline history, LGU service-area and applicant controls, photos on appeals and fare cases) | done, pushed |
| Decided and recorded | G14 - G18 (rules that software cannot enforce, or that were already enforced) | `policy-decisions.md`, G-14 to G-18 |
| Yours | G19 - G21 (routing engine, server settings, cron jobs, real phones) | `owner-checklist.md` |
| Documentation | G22 | this file, the matrix (sections 18 and 19), the errata |
| For your sign-off | G23 (four figures that differ from the policy text) | `policy-decisions.md`, G-23 |

## 2. How it was checked

- **Database:** 104 test suites on the local emulator (the whole migration chain; time is moved by shifting stored timestamps), all passing.
- **Server:** 427 tests, all passing.
- **Apps:** the Passenger, Driver, LGU and TODA apps type-check and build.
- **Screens:** the new screens were opened in the built-in browser against stubbed data (service area, vehicle substitutions, coverage gaps, fare cases with a photo upload, and the earlier ones of this round).
- **Not checked, because it cannot be from here:** a real phone on a real road, the SMS gateway phone, the OSRM routing extension, the hosted project after the last migration. `docs/owner-checklist.md` lists each, with how to see that it worked.

## 3. What to do, in order

1. Push is already done (everything is on `main`). Wait for the hosted project to apply the migrations `20261028000004` to `20261028000006` and confirm with `npx supabase migration list --linked` (read-only).
2. Work through `docs/owner-checklist.md`: the OSRM extension, the server variables, the cron jobs, the daily retention call, the three owner decisions, then the 13-row real-phone test.
3. Read G-23 in `docs/policy-decisions.md` and tell me if you want the policy's figures exactly instead of the ones in use.
4. Optional: delete the two unused files named in G-22 (`git rm apps/lgu-portal/src/lib/auditLog.ts apps/toda-portal/src/lib/auditLog.ts`).

## 4. Known limits

- A second device signed in as the same **driver** is not signed out by the database as a passenger's is (Rule 29.1); it cannot take an offer twice, which is what the rule protects.
- A driver's OTP resend counters live in the server's memory, so a server restart resets them (passengers' are in the database).
- A suspended driver is still signed out at login (G-7, note e): a follow-up, not a gap in the rule.
- Rules 11.2 - 11.4 (who boards the tricycle) and the confirmation-before-strike rules (8.7, 27.x) are procedure, not something software can see; the system gives the screens and the records.
- The public OSRM demo server is for light use; for real traffic host your own (`docs/owner-checklist.md`, section 1).
