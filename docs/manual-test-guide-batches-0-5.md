# SAKAY Test Guide: Batches 0 to 5

Do the steps in order. After each step, write PASS or FAIL. If FAIL, write what you saw on the screen.

## Before you start

- Open 5 terminals in `C:\SAKAY\client` and run one command in each:
  - `npm run dev:server`
  - `npm run dev:passenger` (opens at http://localhost:5173)
  - `npm run dev:driver` (http://localhost:5176)
  - `npm run dev:toda` (http://localhost:5175)
  - `npm run dev:lgu` (http://localhost:5174)
- Use **test accounts only**. The apps save to your real Supabase project.
- Registering sends a **real SMS** to the number you type. Use your own number.
- Use a phone (or a laptop with location turned on) for the driver tests.

You need these test accounts: one LGU admin, one TODA admin, one test driver that is already verified, one test passenger.

---

# BATCH 0: Foundation

#### Step 1: Run the automated tests

- **Where:** Terminal in `C:\SAKAY\client`
- **Action:**
  1. Run `node scripts/db-tests/run-all.js`
- **Expected Result:** The last lines say `27/27 suites passed`. (I already ran this: it passed.)

#### Step 2: Open the four apps

- **Where:** Browser
- **Action:**
  1. Open http://localhost:5173, :5174, :5175 and :5176.
- **Expected Result:** All four open normally. No red error page.

---

# BATCH 1: TODA and Driver Onboarding

#### Step 1: Register a new driver

- **Where:** Driver PWA (http://localhost:5176)
- **Action:**
  1. Start driver registration.
  2. Enter your own phone number and finish the OTP sent by SMS.
  3. Choose a TODA, enter a franchise number and plate number (example: FR-TEST-101 and 101-TST).
  4. Upload sample document photos and submit.
  5. Log in as this new driver.
- **Expected Result:** The driver sees **Pending Verification**. There is no Online toggle that works. The driver cannot receive trips.

#### Step 2: TODA admin endorses the driver

- **Where:** TODA Portal (http://localhost:5175)
- **Action:**
  1. Log in as the TODA admin.
  2. Click **Driver Verification** in the sidebar.
  3. Open the new driver.
  4. Click **Endorse to City LGU** and confirm.
  5. Go back to the Driver PWA and refresh.
- **Expected Result:** The driver is **still Pending**. Still cannot go Online. (The TODA alone never activates a driver.)

#### Step 3: LGU admin approves the driver

- **Where:** LGU Portal (http://localhost:5174)
- **Action:**
  1. Log in as the LGU admin.
  2. Click **Drivers** in the sidebar.
  3. Open the new driver and click **Approve Driver**, then confirm.
  4. Go to the Driver PWA, log out, log in again.
  5. Try to switch **Online**.
- **Expected Result:** The driver is now Verified and can go Online.
- **If the TODA roster did not list this driver:** the LGU portal asks for a written override reason (at least 10 characters) before it will approve. Type one and continue.
- **If the driver still cannot go Online:** write down the exact message and tell me. (Recent commits made both portals use the database approval functions, so this should now work.)

#### Step 4: A different TODA admin cannot see the driver

- **Where:** TODA Portal
- **Action:**
  1. Log in as an admin of a **different** TODA (skip if you only have one TODA).
  2. Open **Driver Verification**.
- **Expected Result:** The new driver is not in the list.

#### Step 5: Send an application back for correction

- **Where:** TODA Portal and Driver PWA
- **Action:**
  1. Register another test driver (like Step 1).
  2. In the TODA Portal, open the driver and return it for correction with a reason (example: "Blurry license photo").
  3. In the Driver PWA, log in and open the status screen.
  4. Fix the document and submit again.
- **Expected Result:** The driver sees your reason. After resubmitting, the application goes back to the TODA list as a fresh review (the 5-day timer starts again).

#### Step 6: Duplicate franchise or plate

- **Where:** Driver PWA, then LGU Portal
- **Action:**
  1. Register a driver using the **same plate number** as a previous driver, but typed differently (example: `101 tst` instead of `101-TST`).
  2. Open the LGU Portal and look at the dashboard flags.
- **Expected Result:** The application is **not approved automatically**. A flag for duplicate plate or franchise appears for review.

#### Step 7: Terminal relocation

- **Where:** TODA Portal, then LGU Portal
- **Action:**
  1. In the TODA Portal, open **Account & Accreditation** and request a new terminal location.
  2. In the LGU Portal, open **Accredited TODAs**, open that TODA, and look for the relocation request.
  3. Before approving, check the TODA's current terminal location. Then approve it and check again.
- **Expected Result:** The old location stays in use until the LGU approves. After approval it changes.

#### Not clickable (already proven by the passing automated tests)

Expired license, expired MTOP and expired TODA certificate blocking drivers; the 3-day reminder and 5-day overdue flag.

---

# BATCH 2: Passenger Accounts

#### Step 1: No login before OTP

- **Where:** Passenger PWA (http://localhost:5173)
- **Action:**
  1. Register a new passenger with your phone number. **Stop at the OTP screen** (do not enter the code).
  2. Open the login page in a new tab and try to log in with that number and password.
- **Expected Result:** Login is refused.

#### Step 2: Finish OTP, then log in

- **Where:** Passenger PWA
- **Action:**
  1. Go back to the OTP screen and enter the SMS code.
  2. Log in.
- **Expected Result:** Login works.

#### Step 3: Same number cannot register twice

- **Where:** Passenger PWA
- **Action:**
  1. Try to register again with the same number written 3 ways, one at a time: `09XXXXXXXXX`, `+639XXXXXXXXX`, `639XXXXXXXXX`.
- **Expected Result:** Each one is refused as already registered. (The Forgot Password page is only an information page. That is expected.)

#### Step 4: Under 12 years old

- **Where:** Passenger PWA
- **Action:**
  1. Register with a birthdate less than 12 years ago.
- **Expected Result:** Refused with a message that passengers under 12 cannot hold an account.

#### Step 5: Five wrong OTP codes (this locks that number for 15 minutes)

- **Where:** Passenger PWA
- **Action:**
  1. Start a new registration with a spare number.
  2. At the OTP screen, type a wrong code 5 times.
  3. Try once more.
- **Expected Result:** The message says too many failed attempts and to try again in about 15 minutes.

#### Step 6: Expired code

- **Where:** Passenger PWA
- **Action:**
  1. Request an OTP. Wait **more than 5 minutes**.
  2. Enter the correct code.
- **Expected Result:** "OTP has expired. Please request a new code."

#### Step 7: One open booking only

- **Where:** Passenger PWA
- **Action:**
  1. Log in and book a ride. Leave it searching for a driver.
  2. Open the app in a second tab and try to book another ride.
- **Expected Result:** The second booking is blocked with the message "You already have an active booking."
- **Known gap:** After a driver has **accepted** the first ride, a second booking may not be blocked. Try it and tell me what happens.

#### Step 8: Logging in on a second device signs out the first

- **Where:** Passenger PWA, then Driver PWA
- **Action:**
  1. Log in as the test passenger in one browser. Log in as the same passenger in a second browser (or private window).
  2. Go back to the first browser and click around.
  3. Repeat with the test driver (log in on phone 1, then on phone 2).
- **Expected Result:** The first browser or phone gets signed out. For the driver, phone 1 can no longer go Online.

---

# BATCH 3: Strikes and Suspensions

Strike levels (as in your policy PDF): 1 = warning. 3 = review flag. 5 = suspended 7 days. 8 = suspended 30 days. 10 = deactivated.

Note: these lengths (and the 48-hour exemption window) only apply to your hosted database after migration `20261011000001_align_strike_values_to_policy.sql` is applied. Until then it still suspends for 3 and 7 days.

#### Step 1: Give strikes to the test passenger

- **Where:** LGU Portal
- **Action:**
  1. Click **Passengers** in the sidebar and open the test passenger.
  2. Click **+ Record Violation / Strike**, choose a violation, enter a reason, confirm.
  3. Repeat. After each one, read "Active Strike Count".
- **Expected Result:**
  - 1 strike: warning only, account still works.
  - 3 strikes: a review flag appears on the LGU Dashboard.
  - 5 strikes: account is suspended for 7 days.
  - 8 strikes: suspended for 30 days.
  - 10 strikes: deactivated.
  - Each result happens once only, not again on the next strike.

#### Step 2: Suspended passenger is blocked

- **Where:** Passenger PWA
- **Action:**
  1. Use the test passenger after strike 5 (or after clicking **Suspend Account**).
  2. Try to log in or book.
- **Expected Result:** Login or booking is refused with a suspension message.

#### Step 3: Suspended driver is blocked

- **Where:** LGU Portal, then Driver PWA
- **Action:**
  1. Click **Drivers**, open the test driver, and suspend the account.
  2. Open the Driver PWA and try to go Online.
- **Expected Result:** The driver cannot go Online and sees the reason.

#### Step 4: Reactivate

- **Where:** LGU Portal
- **Action:**
  1. For a deactivated account, click **Reactivate Account**.
  2. Try it once **without** ticking the box that says you reviewed the full history.
  3. Try again with the box ticked.
- **Expected Result:** Refused without the box. Works with it. The strike count stays the same after reactivating.

#### Step 5: Check the audit log

- **Where:** LGU Portal, **Audit Logs**
- **Action:**
  1. Look at the newest entries.
- **Expected Result:** Each strike, suspension and reactivation is listed with who did it and why.

#### Not clickable (already proven by the passing automated tests)

Exemption requests and decisions, the emergency strike pause, safety-incident victims getting no strike, strikes expiring after 90 days. These have no screen yet.

---

# BATCH 4: Driver Online and Offline

Use a phone with location turned on.

#### Step 1: Stay Online while moving between pages

- **Where:** Driver PWA
- **Action:**
  1. Log in as the verified test driver and switch **Online**.
  2. Tap **Home**, then **Kita**, then **Abiso**, then **Home**.
- **Expected Result:** A reminder to keep the app open appears. The driver stays **ONLINE** the whole time.

#### Step 2: Refresh while Online

- **Where:** Driver PWA
- **Action:**
  1. While Online, refresh the page. Then close the app and open it again.
- **Expected Result:** Still **ONLINE** after both.

#### Step 3: Location off

- **Where:** Driver PWA
- **Action:**
  1. Block location for the site in the browser settings, then try to go Online.
  2. Allow location, go Online, then block it again while Online.
- **Expected Result:** First try: refused with "Location is turned off." Second: the driver is set Offline automatically and is asked to allow location again.

#### Step 4: Going Offline

- **Where:** Driver PWA
- **Action:**
  1. While Online with no booking, switch **Offline**.
  2. Go Online again. Accept a booking from the passenger test account. Try to switch Offline.
- **Expected Result:** Offline works with no booking. With an accepted booking, it is refused ("You cannot go Offline while a booking is open").

#### Step 5: Ignored offers

- **Where:** Passenger PWA and Driver PWA
- **Action:**
  1. Driver is Online. Passenger books a ride.
  2. The driver sees the offer and **does nothing** for 15 seconds.
  3. Passenger books again. Repeat until the driver has ignored 5 offers.
- **Expected Result:**
  - After the 3rd ignored offer: the driver sees "You appear to be unavailable. Please switch to Offline if you are no longer accepting bookings."
  - After the 5th: the driver is set Offline automatically.
  - The driver gets **no strike**. Check in LGU Portal, **Drivers**, open the driver: strike count unchanged.
  - Declining or accepting an offer resets the count to zero.

#### Step 6: Database jobs

- **Where:** Supabase, SQL Editor
- **Action:**
  1. Paste and run: `SELECT jobname, schedule, active FROM cron.job;`
  2. Paste and run: `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261006000003';`
- **Expected Result:** First: a row named `sakay-presence-sweep`, every minute, active = true. Second: one row. If the second shows no rows, tell me, because one Batch 4 fix is not on your live database.

---

# BATCH 5: Fares

#### Step 1: Check the Solo fare

- **Where:** Passenger PWA
- **Action:**
  1. Choose a pickup and destination and pick **Solo Trip**.
  2. Note the distance (km) shown and the fare.
  3. Compare with this table:

| Distance | Solo fare |
|---|---|
| 2 km or less | ₱60 |
| 2.5 km | ₱62 |
| 5 km | ₱72 |
| 7 km | ₱80 |
| 10 km | ₱92 |

  (Rule: ₱60 for the first 2 km, then ₱4 for each extra km, rounded to the nearest peso.)
- **Expected Result:** The fare matches the table for that distance (within ₱1 to ₱2, because the exact distance comes from the map). The number of passengers (1 to 4) does not change a Solo fare.

#### Step 2: Shared Trip screen

- **Where:** Passenger PWA
- **Action:**
  1. Choose **Shared Trip** with a 10 km route (or similar).
- **Expected Result:** Before you confirm, you see two fares: the Matched Shared Fare Estimate (about ₱46 for 10 km) and the Maximum Unmatched Fare (₱92). (Rule 6.1.3 in your PDF, read literally, would give ₱30 here. The system uses the model you chose instead.) You also see a note that matching continues until less than half the trip is done, and that it becomes a Solo Trip if nobody joins.

#### Step 3: Same final fare on both phones

- **Where:** Passenger PWA and Driver PWA
- **Action:**
  1. Complete one full trip with your test passenger and test driver.
  2. Compare the final fare on both apps.
- **Expected Result:** Both show exactly the same final fare.

#### Step 4: Fare Configuration page

- **Where:** LGU Portal, **Fare Configuration** in the sidebar
- **Action:**
  1. Open the page and read the current rate. (Do not change it: rate changes cannot be deleted later.)
- **Expected Result:** Shows base fare ₱15, ₱1 per extra km, and "City Ordinance No. 110, Series of 2022".

#### Step 5: Cash only

- **Where:** Passenger PWA, **Terms of Service**
- **Action:**
  1. Read the payment section.
- **Expected Result:** Says cash only. No wallet, QR code, or student/senior/PWD discount.

#### Not clickable (already proven by the passing automated tests)

Shared-trip fare split for 5 route scenarios, rate changes not affecting old bookings, nobody being able to edit a final fare, and rejecting future-dated bookings.

---

## When you finish

Send me: the step number and PASS or FAIL for each, and for every FAIL, what the screen said. The three steps I most want to see are **Batch 1 Step 3**, **Batch 2 Step 7** and **Batch 4 Step 6**.

---

# DAY 1 ADDITIONS (incident reports, LGU analytics, pause bookings)

These need two migrations applied to the hosted database first: `20261012000001` and `20261012000002`.

#### Step 1: Passenger reports an incident

- **Where:** Passenger PWA (http://localhost:5173)
- **Action:**
  1. Log in as a test passenger who has at least one **completed** trip.
  2. Open **History**, open a completed trip, tap the report button. (Or open **Support** and choose the incident report.)
  3. Choose the trip (it is already chosen if you came from the trip), pick a category, write what happened, attach a photo, and tap **Submit Report**.
  4. Open **Track Reports**.
- **Expected Result:** A green message says the report was submitted. The report appears in the list as **Submitted** and opens with your text and the photo. (No made-up sample reports.)

#### Step 2: TODA administrator reviews it

- **Where:** TODA Portal (http://localhost:5175)
- **Action:**
  1. Log in as the TODA admin of the reported driver's TODA.
  2. Open **TODA Reports & Incidents**, open the **Incident Reports & Complaints** tab, and open the new report.
  3. Click **Escalate to City LGU**, confirm. Then open another report and click **Mark Resolved (TODA Level)**.
- **Expected Result:** You can see the description and the photo. Both buttons work (they used to fail). A different TODA's admin does not see the report.

#### Step 3: LGU administrator sees it

- **Where:** LGU Portal (http://localhost:5174)
- **Action:**
  1. Log in as the LGU admin and open **Incident Reports**.
  2. Open the escalated report and change its status (for example **Under Investigation**, then **Resolved** with a note).
  3. Go back to the passenger's **Track Reports**.
- **Expected Result:** The LGU sees the report with the passenger, driver, TODA and photo. The passenger sees the new status and your note. A **Pending** report can be withdrawn by the passenger; one that is already being reviewed cannot.

#### Step 4: LGU analytics show real numbers

- **Where:** LGU Portal
- **Action:**
  1. Open **Analytics**.
  2. Open **Reports** and look at each tab, including the new **6. Service Utilization**.
- **Expected Result:** Four cards (completion rate, busiest hour, driver utilization, average fare) with real numbers. A 14-day booking chart. The hotspot map shows circles where your test bookings were picked up (it is empty if no booking has a pickup location). Service utilization lists completed, cancelled, no driver found, in progress, solo and shared. The TODA tab shows a completion rate, not "100% Compliant".

#### Step 5: Driver pauses and resumes bookings

- **Where:** Driver PWA (http://localhost:5176), and Passenger PWA
- **Action:**
  1. Log in as the verified test driver and switch **Online**.
  2. Tap **Pause bookings** under the status pill and choose **15 minutes**.
  3. In the Passenger PWA, book a ride from near the driver.
  4. Back in the Driver PWA, tap the orange **Paused until ...** button to resume, then book again from the passenger.
- **Expected Result:** While paused, the driver gets **no offer** (the passenger's search skips this driver), and the driver stays ONLINE. After resuming, the offer arrives. The pause also ends by itself when the time passes, and switching Offline clears it.
