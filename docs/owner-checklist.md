# SAKAY: what only the owner can do or confirm

Everything the code can do on its own is done and tested. These steps need your Supabase project, your server host, your SMS phone, or real phones on real roads, so they cannot be checked from the repository. Each step says how to see that it worked. Items marked **new** came with the gap-closing round of 2026-10-18 (`docs/policy-decisions.md`, section 20).

## 0. The order of a release

1. **Migrations first.** A push to `main` is applied to the hosted project by the Supabase GitHub integration, usually within a minute. Confirm: `npx supabase migration list --linked` shows a remote value next to every local one (read-only).
2. **Then the server** (`server/`, on Render). It needs the variables of section 2 below.
3. **Then the apps** (passenger, driver, LGU portal, TODA portal). An app that is newer than the database fails on a function that does not exist yet; a database newer than the app is harmless.

## 1. The routing engine for driver ETAs (G19)

Without the `http` extension the dispatcher ranks drivers by a straight-line estimate (labelled as such). With it, it asks the OSRM road router. In the Supabase SQL editor:

```sql
create extension if not exists http with schema extensions;
-- works when this returns the JSON text of a route:
select public._osrm_http_get('https://router.project-osrm.org/route/v1/driving/121.1803,13.4115;121.1900,13.4200?overview=false');
-- after some bookings: what the offers were ranked by (osrm / straight_line_estimate)
select eta_source, count(*) from dispatch_attempt where notification_sent_at > now() - interval '1 day' group by 1;
-- the engine's health (three failures in a row open the breaker for 60 seconds)
select * from osrm_eta_state;
```

The public OSRM demo server is for light use. For real traffic, host your own OSRM (the address is one place in the database: `_osrm_base_url()`). To turn it off again: `drop extension http;`.

## 2. The server (G20)

| Variable | What for | If missing |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | roles, OTP counters, **password recovery (sets the new password)**, everything the server reads | the server answers 503 to everything that needs it |
| `CORS_ORIGIN` | the origins of the four apps, comma separated (production allows only these) | browsers are refused |
| `SMS_GATEWAY_URL`, `SMS_GATEWAY_LOGIN`, `SMS_GATEWAY_PASSWORD` (`SMS_GATEWAY_DEVICE_ID`, `SMS_GATEWAY_SIM_NUMBER`) | the Android SMS gateway phone: registration codes, **password-recovery codes (new)**, outcome texts | no code is sent; the app says so |
| `SCHEDULER_SECRET` (16+ random characters) | protects `/api/scheduler/*` | those routes answer 503 to everybody |
| `GEMINI_API_KEY` | reading licence / MTOP photos (OCR) | OCR is off; documents are typed by hand |
| `TRUST_PROXY` | leave unset on Render (it is 1 in production) | |

**The gateway phone must be awake, online and have SMS credit.** The server asks the gateway whether each message left the phone and says so when it did not. Test it with "Forgot password" in the Passenger app using your own number.

**The server sleeps on Render's free plan.** The hourly duties no longer depend on it (they run inside the database), and the password-recovery limits live in the database too, so a sleeping server loses nothing. A sleeping server does make the first request of the day slow; a paid plan removes that.

## 3. The scheduled jobs in the database (G20)

Run in the SQL editor and compare:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

| Job | Schedule | What it does |
|---|---|---|
| `sakay-dispatch-sweep` | every 5 seconds | offers, timers, No Driver Found, stuck payment |
| `sakay-presence-sweep` | every minute | drivers whose app went silent are put Offline |
| `sakay-policy-sweeps` (**new**) | minute 12 of every hour | reminders and overdue flags (Rules 3.7, 24.x), strike clean-up (22.1, 25.x), ends **vehicle substitutions** whose days are over (29.18) |
| `sakay-integrity-sweep` | 03:27 Manila | the detectors of Section 27 (review flags only) |
| `sakay-retention-job` | 03:42 Manila | the database part of data retention (28.x) |
| `sakay-dispatch-log-purge` | 03:17 Manila | removes old cron logs and ETA cache |

If a row is missing, pg_cron was not enabled when its migration ran: enable it (Database > Extensions) and run the migration's `DO` block again, or ask me to. After a day: `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;` should show `succeeded`.

## 4. Deleting stored identity images (G20, Rule 28)

The database decides which images are due; only the server can delete the files. Call this **once a day** from an external scheduler (cron-job.org, GitHub Actions, Render cron):

```bash
curl -X POST https://YOUR-SERVER/api/scheduler/run-retention -H "X-Scheduler-Secret: YOUR_SECRET"
```

It answers `{"success": true, ...}` with the counts. Without this call the files stay after the database says they are due.

## 5. Decisions only you can take (G20)

- **The data-protection contact.** Put the data protection officer's name and number in `PRIVACY_CONTACT` in `packages/shared/src/config/privacyNotice.ts` (it currently says "the LGU Transport Office of Calapan City"). It is shown in the privacy notice of both apps.
- **The OCR provider.** Document photos (licences, permits) are sent to Google Gemini for reading. Keep it only if the LGU accepts that under its privacy notice; otherwise leave `GEMINI_API_KEY` empty (documents are then typed by hand) or name another provider.
- **`scrub_unneeded_identity_fields()`.** Batch 12 stopped collecting the residential address, nationality, engine, chassis and make. Values stored earlier stay until you run, once, as the service role: `select public.scrub_unneeded_identity_fields();` It is not run by a migration on purpose: deleting stored personal data is your call. It is written to the audit log.
- **The first LGU / TODA administrators** exist only if somebody created them (`scripts/` apply scripts); the seed adds master data, never logins.

## 6. A run on real phones (G21)

None of this can be proven on a laptop. Do it once with two phones (a passenger and a driver) and one person watching the LGU portal. Pass means the app did what the right-hand column says.

| # | Do this | Pass when |
|---|---|---|
| 1 | Book from inside the city; try a pickup and a destination just outside the boundary | outside is refused with the service-area message; inside books |
| 2 | Driver goes Online, passenger books, driver accepts and drives toward the pickup | the passenger sees the tricycle move about every 5 seconds (no flicker, no jumping) |
| 3 | Driver stops moving for 2 minutes after accepting (Rule 8) | the warning appears, then the cancellation with no strike if a safe reason is given |
| 4 | Driver arrives within the pickup zone; passenger waits | the 5-minute countdown shows on both; "I'm almost there" adds 2 minutes once; "Passenger No-Show" works only when the driver is at the pickup |
| 5 | Turn off the driver's mobile data for 3 minutes mid-trip, then on again | both phones show "connection lost" and recover; the trip is not cancelled; the 30-minute silent-trip rule is not triggered |
| 6 | Let the driver's screen lock during a trip | the position keeps being sent (the screen wake lock works) |
| 7 | Deny, then re-allow, location permission on the driver's phone while Online | the driver is put Offline with a clear reason and can return |
| 8 | Finish a trip at the destination, passenger confirms fare, driver taps Payment Received | the trip is Completed and Paid on both and in the LGU portal |
| 9 | Passenger logs in on a second phone | the first phone is signed out; a booking from the first is refused |
| 10 | "Forgot password" with a real number (passenger, then driver) | the code arrives by SMS within a minute; the new password works; the old phone is signed out; a text says the password changed |
| 11 | Passenger takes a late-cancel strike, then appeals it | it appears in the LGU portal > Strike Appeals; the decision reaches the passenger |
| 12 | Driver asks for another vehicle (Settings > Another Vehicle) | the TODA portal shows it first, then the LGU portal; after approval the passenger sees the new plate; it reverts by itself |
| 13 | Passenger appeals a strike with two photos (Settings > Strikes & Appeals); driver adds a statement with a photo to a fare case (Settings > Fare Cases) | the LGU portal (Strike Appeals) and the TODA portal open the photos; the other side of a fare case sees only "1 photo attached"; Supabase > Storage shows the private bucket `case-evidence` |

Write down the result of each row and send me any that fail, with the time, so the server and database logs can be read for that moment.
