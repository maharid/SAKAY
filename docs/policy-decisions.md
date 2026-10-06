# SAKAY Policy Decisions Log

This document records the architectural and regulatory decisions for SAKAY policy implementation across Batches 0 to 13.

---

## 1. Policy Issues Decision Log (PI-01 to PI-12)

### PI-01: Barangay Service Zone as a Dispatch Eligibility Rule
- **Issue**: Policy Chapter 1 and Rules 2.2, 7.1, 7.4, 7.10 use the pickup barangay's service zone as a driver eligibility filter. Intelligent Driver Dispatch Specification Section 17 eliminates barangay eligibility filters in favor of metric distance tiers around the pickup.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option C (Hybrid)**
- **Details**: Enforce a booking-creation boundary gate (pickup coordinates must fall inside a participating TODA's accredited operational territory, e.g. Brgy. Lumangbayan / Xentro Mall), but impose NO barangay boundary filter on driver dispatch eligibility. Tiered metric radii (Tier 1 Priority TODA -> Tier 2 -> Tier 3) govern driver offer sequencing.

---

### PI-02: Redispatch Priority Credits vs. Strict Ranking Criteria
- **Issue**: Rules 10.4 and 12.4 specify that drivers receive redispatch priority credits after passenger no-shows, and bookings are redispatched with priority after en-route driver cancellations. Dispatch specifications forbid priority tokens and ranking overrides outside ETA and tie-break orders.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Narrow Deterministic Tie-Breaker)**
- **Details**: Implement a single-use, session-scoped flag (`has_redispatch_priority: boolean`) on the re-queued booking or driver record. This acts strictly as the **first tie-breaker** when two candidates share the exact same ETA, preserving deterministic dispatch without artificial distance boosts.

---

### PI-03: Passenger Destination Change After Booking Confirmation
- **Issue**: Rules 6.2(a) and 6.2.2 describe destination modifications and fare recalculation, whereas Rules 6.2.1, 13.9, 13.10, 29.4 and Section 20 state that destination changes are unsupported after booking confirmation.
- **Status**: `approved by the project owner - implemented in Batch 5` (decision D1)
- **Approved Option**: **Option A (Not Supported Post-Confirmation)**
- **Details**: Destination modifications after driver acceptance are not supported in the UI or backend. Fixed cash fares and shared-ride segment mathematics require an immutable route. Unavoidable road closures or emergencies are handled exclusively via emergency early trip termination (Rule 6.2(b)).
- **Enforced in the database (Batch 5)**: pickup and destination (address and coordinates), the estimated distance and fare, the passenger count and the trip type cannot be changed by any client once the booking exists (`booking_fare_update_guard`, `ERR_BOOKING_LOCKED`). The wording of Rules 6.2(a) and 6.2.2 should be deleted from the policy document.

---

### PI-04: Shared-Trip Fare Gaps & Calculation Model
- **Issue**: Policy Rule 6.1.4 charges additional fare only on exclusive excess kilometers at ₱1/km, failing to charge distance for the common route beyond 2 km and severely under-collecting driver earnings on long routes.
- **Status**: `approved by the project owner - implemented in Batch 5` (decision D2). The policy text still says shared fares are subject to LGU / adviser validation; the owner has chosen to build this model for the pilot.
- **Approved Model**: **Option B (Vehicle-Fare Proportional Pool Model)**. Implemented in the database by `public.calculate_fare()` (estimates) and `public.allocate_shared_fares()` (settlement), `supabase/migrations/20261007000002_batch5_fare_engine.sql`. The earlier `fareCalculator.ts` was **not** this model (it priced each booking's pool from that booking's own distance, which charged Booking B ₱32 below instead of ₱22) and has been replaced.
- **Choices inside Option B (D2a-D2c)**: (a) the pool is the Solo Trip Fare of the **whole vehicle route** (occupied kilometres), not of each booking's own route; (b) every kilometre costs the same (pool ÷ route km), so the ₱60 base is spread over the route and a late boarder does not ride almost free; (c) the Matched Shared Fare Estimate shown before booking assumes **one more 1-passenger booking** on the same route, which is an upper bound for the matched fare (a heavier partner lowers it).
- **Answer to the reviewer's "x4 dapat diba?"**: yes under the study's own Solo x4 logic: in this model a booking that travels alone is charged the whole vehicle's cost for those kilometres.
- **Regulatory note for the LGU**: with two sharing passengers each pays half of the vehicle fare, which is twice the ordinance per-seat fare (₱46 each vs ₱23 on a 10 km trip). That is the point the policy already flags as subject to LGU approval.

#### Arithmetic Walkthrough for Model B (Scenario 5) - executed by `scripts/db-tests/batch5/fare-formula.js`
- **Scenario Parameters**:
  - Passenger A (1 pax) travels 5.0 km total: 2.0 km exclusive segment (before Passenger B boards), followed by 3.0 km common segment with Passenger B.
  - Passenger B (1 pax) boards at km 2.0 and travels 3.0 km common with Passenger A to the destination.
  - Tariff Parameters (City Ordinance No. 110, s. 2022): Base Fare = ₱15.00 (first 2.0 km), Succeeding Rate = ₱1.00/km, Tricycle Capacity = 4 seats.
- **Step 1: Total Route Vehicle Pool**:
  - Total vehicle distance = 5.0 km.
  - Base distance = 2.0 km; Excess distance = 5.0 km - 2.0 km = 3.0 km.
  - Core Seat Fare = ₱15.00 + (3.0 km × ₱1.00/km) = ₱18.00.
  - Total Vehicle Solo Pool = ₱18.00 × 4 seats = **₱72.00**.
- **Step 2: Segment 1 Breakdown (Exclusive to A, 2.0 km, 1 pax onboard)**:
  - Distance proportion = 2.0 km / 5.0 km = 0.40 (40% of route).
  - Passenger A onboard share = 1 pax / 1 total pax onboard = 1.0 (100%).
  - Segment 1 Cost for Booking A = 0.40 × ₱72.00 × 1.0 = **₱28.80**.
- **Step 3: Segment 2 Breakdown (Common to A & B, 3.0 km, 2 pax onboard)**:
  - Distance proportion = 3.0 km / 5.0 km = 0.60 (60% of route).
  - Passenger A onboard share = 1 pax / 2 total pax onboard = 0.50 (50%).
  - Passenger B onboard share = 1 pax / 2 total pax onboard = 0.50 (50%).
  - Segment 2 Cost for Booking A = 0.60 × ₱72.00 × 0.50 = **₱21.60**.
  - Segment 2 Cost for Booking B = 0.60 × ₱72.00 × 0.50 = **₱21.60**.
- **Step 4: Final Fare Aggregation & Rounding**:
  - **Booking A Final Fare**: ₱28.80 + ₱21.60 = ₱50.40 → rounds to **₱50.00**.
  - **Booking B Final Fare**: ₱21.60 → rounds to **₱22.00**.
  - **Total Driver Realized Earnings**: ₱50.40 + ₱21.60 = **₱72.00** (exactly guarantees the full 5.0 km vehicle solo pool).
  - **Minimum Fare Verification**: Both ₱50.00 and ₱22.00 exceed the mandatory municipal minimum base fare (₱15.00).

---

### PI-05: Stall Monitoring Rule vs. "Arrived" Phase
- **Issue**: Rule 8.3 imposes 2 strikes for stalling after arrival confirmation, whereas Rule 8.5 states stall detection applies only to the approach phase, handing off post-arrival waiting to the passenger no-show timer.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Approach Phase Only)**
- **Details**: Stall detection (<20 m movement within monitoring window) applies strictly while the driver is en route to pickup (1 strike). Once the driver marks arrival at the pickup point, behavior is governed by the 5-minute (+2 min one-time grace extension) passenger no-show timer (Section 10).

---

### PI-06: Pickup-Zone Radius & GPS Accuracy Gating
- **Issue**: Rule 10.1 sets 10 m, Rule 10.2 cites 5 m, and Rule 8.5 cites ~20 m. Real-world consumer mobile GPS accuracy ranges between 5–20 meters in Calapan.
- **Status**: `recommended - provisional`
- **Provisional Value**: **25 meters** (`PICKUP_ZONE_RADIUS_METERS = 25`), with dynamic compensation for device accuracy up to 40 m.
- **Note**: Provisional figure; will be benchmarked and finalized during Batch 8 implementation.

---

### PI-07: End-Trip Destination Gating Definition
- **Issue**: Rule 13.2 mentions destination arrival gating within 20 meters, but Section 16 never formally defines the geofence threshold or backend validation.
- **Status**: `recommended - provisional`
- **Provisional Value**: **30 meters** (`DESTINATION_GEOFENCE_RADIUS_METERS = 30`), unlocking "End Trip" only within this geofence or upon confirmed emergency early termination.
- **Note**: Provisional figure; will be benchmarked and finalized during Batch 9 implementation.

---

### PI-08: Passenger Fare Confirmation Indefinite Timeout Block
- **Issue**: Rules 18.2–18.3 block the driver from tapping "Payment Received" until passenger confirms fare or files a dispute, but provides no timeout if the passenger abandons the app.
- **Status**: `recommended - provisional`
- **Provisional Value**: **120 seconds (2 minutes)** (`FARE_CONFIRMATION_TIMEOUT_SECONDS = 120`).
- **Note**: Provisional figure; will be benchmarked and finalized during Batch 9 implementation.

---

### PI-09: Cross-Reference Errata & Undefined Penalties
- **Issue**: Typographical cross-references in policy text (Section 19 vs. 20, Rule 18.4 vs. 18.5, Rule 6.1 vs. 6.1.3, Rule 11 vs. 12, missing 13.1 label). Undefined strike counts for Rule 29.15 (passenger vehicle damage) and Rule 29.16 (passenger contamination).
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Implement Obvious Intent)**
- **Details**: Apply corrections (a)–(f). Penalties for Rule 29.15 and Rule 29.16 will be proposed and reviewed in Batch 3.

---

### PI-10: Ride-Sharing Cutoff Comparator
- **Issue**: Rule 6.5 states matching continues while *less than 50%* of trip is completed; Rule 14.2 states *50% or less*; Rule 14.4 cites the *50% cutoff*.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Strictly Less Than 50%)**
- **Details**: `progress = (distance covered along route) / (total route distance) < 0.50`. Pairing closes when progress reaches or exceeds 50.0%.

---

### PI-11: Coverage Gap Definition
- **Issue**: Rule 7.10 defines a coverage gap as 5+ No Driver Found in a service zone within 24 h; Intelligent Driver Dispatch Section 18 triggers it when 5+ bookings from the same pickup barangay reach Tier 3 or end in No Driver Found within 24 h.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Dispatch Specification Definition)**
- **Details**: Analytics monitor bookings originating from the same pickup barangay that reach Tier 3 or end in "No Driver Found" within a rolling 24-hour window.

---

### PI-12: "No Driver Found" Termination Trigger & Maximum Wait Window
- **Issue**: Rules 7.4/7.5 declare "No Driver Found" as soon as eligible drivers decline/time out; dispatch spec keeps refreshing Tier 3 every 30 s up to a 10-minute maximum. Rule 12.8 adds that 3 consecutive accepted drivers cancelling ends the cycle.
- **Status**: `recommended - provisional`
- **Approved Option**: **Option A (Dispatch Specification + Rule 12.8)**
- **Details**: Dispatch executes Tier 1 (15 s) -> Tier 2 (15 s) -> Tier 3 periodic refresh every 30 s up to 10 minutes maximum, or terminates immediately if 3 consecutive accepted drivers cancel. Total worst-case passenger wait is 10 minutes 30 seconds.

---

## 2. Findings Routed to Batches (Architectural Debt & Gaps)

1. **Driver Offline State Persistence Bug** (`apps/driver-pwa/src/services/driverApiService.ts:338`):
   - *Finding*: `updateDriverAvailability` writes `'Online'` to Supabase `driver.availability_status`, whereas the schema and `DriverAvailabilityHome.tsx` query expect `'Available'`. On page navigation, profile re-fetch defaults `isOnline` to `false`.
   - *Routed to*: **Batch 4** (Driver Session Lifecycle & Availability).

2. **TODA Accreditation LocalStorage Overrides** (`apps/lgu-portal/src/services/adminApiService.ts:302-340`):
   - *Finding*: `TODA_STATUS_OVERRIDES_KEY` and `SAKAY_APPROVED_TODAS_KEY` use browser `localStorage` to simulate TODA approvals and bypass database RLS constraints.
   - *Routed to*: **Batch 1** (TODA & Driver Onboarding, Accreditation & Boundaries).

3. **Client-Side Disciplinary Enforcement** (`apps/driver-pwa/src/features/availability/components/DriverAvailabilityHome.tsx:174`):
   - *Finding*: Driver account suspension is checked only in the React UI (`driverData.account_status !== 'Active'`) without database-level RLS token revocation or session termination.
   - *Routed to*: **Batch 3** (Disciplinary Framework, Strikes, Suspensions & Review Flags).

4. **Payment Confirmation LocalStorage Side-Channel** (`apps/driver-pwa/src/features/trip-management/components/DriverActiveTrip.tsx:140-144`):
   - *Finding*: `payment_confirmed_${bookingId}` is polled from `localStorage` across tabs/windows rather than strictly observing authoritative database state transitions on `public.booking`.
   - *Routed to*: **Batch 9** (Trip Execution, Destination Gating, Payments & Receipts).

5. **Fragmented Audit Writers & In-Memory Shadow Arrays** (`apps/lgu-portal/src/lib/auditLog.ts`, `apps/toda-portal/src/lib/auditLog.ts`):
   - *Finding*: Portals maintain local in-memory arrays for audit logs that shadow real `public.audit_log` PostgreSQL rows and fail to record actor IDs and before/after state diffs.
   - *Routed to*: **Batch 12** (Ratings, Feedback, System Audit Logging & Analytics).

6. **Browser-Side Client Dispatch Loop** (`apps/passenger-pwa/src/services/dispatchService.ts:13-295`):
   - *Finding*: The entire sequential tiered dispatch engine runs inside the passenger's browser context via `setTimeout` and client Supabase queries, risking failure if the passenger closes or backgrounds the PWA.
   - *Routed to*: **Batch 6** (Intelligent Driver Dispatch & Assignment - migration to backend/RPC).

7. **Driver Rating Formula Discrepancy** (`database.ts:88`, `supabase/migrations/20260927000000_fix_database_advisor_and_rls.sql:226`):
   - *Finding*: Code uses `weighted_average_rating`, whereas Rule 23.1 requires a plain arithmetic mean over all completed trip ratings.
   - *Routed to*: **Batch 12** (Ratings, Feedback, System Audit Logging & Analytics).

8. **Scattered Hard-Coded Policy Timers Pending Owning-Batch Migration**:
   - *Finding*: Hard-coded copies of the 15 s offer window, 5 s GPS interval, and 5-minute OTP TTL remain in call sites and must be switched to the central config in their respective owning batches:
     - `server/src/services/smsService.ts:10` (5-minute OTP TTL) -> switch to central config in **Batch 2**.
     - `apps/driver-pwa/src/contexts/DriverSessionContext.tsx:73` (15 s countdown) & `apps/driver-pwa/src/features/trip-management/components/DriverActiveTrip.tsx:205` (5 s GPS interval) -> switch to central config in **Batch 4**.
     - `apps/passenger-pwa/src/services/dispatchService.ts:117` (15 s offer window) -> switch to central config in **Batch 6**.
   - *Routed to*: **Batches 2, 4, and 6**.

---

## 3. PROPOSED Canonical Status Vocabulary (For User Approval)

### A. Canonical Booking Status State Machine
```
[Pending]
   │
   ▼
[Searching Driver] ───────────────► [No Driver Found] (All tiers exhausted / timed out)
   │
   ▼
[Driver Assigned] ────────────────► [Cancelled] (By Passenger or Driver before arrival)
   │
   ▼
[Driver En Route] ────────────────► [Cancelled] (By Passenger or Driver en route)
   │
   ▼
[Driver Arrived] (Starts 5-min no-show timer) ──► [Cancelled] (Passenger No-Show)
   │
   ▼
[Passenger Boarded]
   │
   ▼
[Trip Ongoing] ───────────────────► [Cancelled] (Emergency / Force Majeure Termination)
   │
   ▼
[Arrived at Destination] (Gated by destination geofence)
   │
   ▼
[Completed] (Payment confirmed, receipt issued)
```

**Proposed Canonical Status Strings** (`booking_status` column):
1. `'Pending'`: Initial booking reservation created by passenger.
2. `'Searching Driver'`: Active dispatch algorithm currently offering to candidate drivers.
3. `'Driver Assigned'`: Driver accepted offer; awaiting vehicle departure.
4. `'Driver En Route'`: Driver actively traveling to passenger pickup location.
5. `'Driver Arrived'`: Driver within pickup geofence; 5-minute passenger countdown active.
6. `'Passenger Boarded'`: Passenger verified and seated in tricycle.
7. `'Trip Ongoing'`: Vehicle in transit along confirmed route to destination.
8. `'Arrived at Destination'`: Tricycle confirmed within destination geofence; awaiting payment.
9. `'Completed'`: Cash payment received and verified; digital trip receipt archived.
10. `'Cancelled'`: Trip terminated before completion (accompanied by `cancelled_by` and `cancellation_reason`).
11. `'No Driver Found'`: Dispatch exhausted all tiers without driver acceptance.

*(Eliminates ambiguous aliases: `'Accepted'`, `'In Transit'`, `'Arrived at Pickup'`)*.

### B. Canonical Driver Availability State Machine
```
[Offline] ◄─────────────────────────► [Available]
                                          │
                                          ▼
                                       [Busy] (Automatically assigned during active trip)
```

**Proposed Canonical Availability Strings** (`driver.availability_status` column):
1. `'Offline'`: Driver not logged in or toggled off; ineligible for dispatch offers; background telemetry paused.
2. `'Available'`: Driver online, verified, idle or cruising; actively eligible for dispatch matching.
3. `'Busy'`: Driver currently assigned to an accepted booking or executing an active trip.

*(Eliminates non-canonical `'Online'` and `'Paused'` strings from database mutations)*.

---

## 3. Batch 1 Architectural Decisions & Policy Clarifications

### PI-01 (Approved Option C - Temporary Testing Variant): Calapan City Service Area Boundary Gate
- **Decision**: Implement a database-backed booking-creation boundary gate (`public.service_area_config`) enforced server-side before booking insertion (`check_booking_service_area_gate`).
- **Temporary Scope**: For development and acceptance testing, the allowed service area is set to all of Calapan City using a center point at Calapan City Hall (Latitude: `13.4115° N`, Longitude: `121.1803° E`) with an interim testing radius of `16.0 km`.
- **Geographic Coverage & Municipality Boundaries**:
  - Real-world verification confirms this 16 km circle encompasses all 62 Calapan City mainland barangays.
  - However, because municipal boundaries are irregular polygons, this circular radius also temporarily overlaps with portions of neighbouring municipalities (e.g., Baco Poblacion is located at ~`13.3586° N, 121.0983° E`, approximately `10.64 km` from Calapan City Hall, well within the 16 km circle).
- **Enforcement**: Pickups outside this radius are blocked server-side and trigger Tagalog error: *"Ang iyong lokasyon ng pagsakay ay nasa labas ng opisyal na nasasakupan ng SAKAY (Calapan City Service Area)."*
- **Pilot Narrowing Path**: The architecture allows instant narrowing to pilot barangay / terminal radius without code changes using `set_pilot_service_area(p_toda_id, p_radius_km)`.
- **Data Note**: The official **Xentro Mall TODA** record does not exist yet in `public.toda` (Calapan Central TODA / CCTODA is currently seeded). Once Xentro Mall TODA is accredited by the LGU, its DB-stored terminal coordinates will seed the pilot narrowing radius.

### PI-13: Documentary Restriction Scope & Expiry Cascade (Rules 24.1 – 24.5)
- **Decision**: Driver eligibility to accept dispatches and enter `Available` status is strictly gated by credential validity (Driver's License, MTOP Franchise, and TODA Accreditation Certificate).
- **Asia/Manila Date Authority**: Expirations are evaluated strictly against calendar date in `Asia/Manila` timezone (`(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::DATE`).
- **Non-Punitive Restriction**: Expired credentials trigger immediate documentary restriction (cannot go `Available`), but do NOT change `driver.account_status` (driver remains `Verified`), and record zero (0) disciplinary strikes.
- **Active Trip Safety**: If a credential expires while a driver is executing an active trip (`availability_status = 'Busy'`), the driver is permitted to finish the trip safely. The scheduled runner or availability transition forces the driver `Offline` once the vehicle returns to `Available`.
- **Secure Renewal Path (Rule 24.2)**: Drivers cannot edit authoritative expiry columns. Document renewals are submitted to pending staging columns in `driver_verification` (`submit_driver_renewal`), requiring future calendar dates, and become authoritative only after LGU Administrator review (`verify_driver_renewal`).
- **Multi-Affiliation Accreditation Cascade (Rule 24.3)**: If a TODA's accreditation certificate expires, all drivers whose active selection points to that TODA are documentarily restricted from going online. Drivers affiliated with multiple TODAs can switch their active selection to another accredited, unexpired TODA while `Offline`.

### PI-14: Two-Stage Application Resubmission Resume Point (Decision A)
- **Decision**: When a driver resubmits an application returned for corrections:
  - If the application was returned at the **LGU verification stage** (`lgu_verification_status = 'Resubmission Required'`), it resumes at the LGU stage. The TODA endorsement remains intact (`toda_endorsement_status = 'Endorsed'`), and `lgu_verification_status` is reset to `'Pending'`.
  - If the application was returned at the **TODA screening stage** (`toda_endorsement_status = 'Resubmission Required'`), it resumes at the TODA stage (`toda_endorsement_status = 'Submitted'`).
  - In both cases, the 5-calendar-day review clock restarts (`resubmitted_at = CURRENT_TIMESTAMP`).

---

## 4. Open Policy Questions

### Open Question 1: Post-Rejection Driver Affiliation Rules (Rule 3.9)
- **Question**: When a driver's affiliation application to a specific TODA is rejected for ineligibility or fraud (Rule 3.8), is the driver barred from applying to other TODAs, or is the rejection specific only to that TODA?
- **Status**: `Open / Pending Policy Owner Determination`
- **Current Batch 1 Implementation**:
  - Rejection grounds are strictly limited to `ineligible` or `fraudulent` (document errors must use Return/Resubmission).
  - The policy text does not specify whether a driver rejected by one TODA may apply to another.
  - In Batch 1, re-application after rejection requires an audited administrative action (`allow_driver_reapplication(p_affiliation_id, p_reason)`) by the TODA or LGU administrator.
  - Permanently disqualified drivers (`is_permanently_disqualified = TRUE`, Rule 3.9) are globally disqualified from all TODAs and can never be cleared by `allow_driver_reapplication`.


---

## 5. Batch 3 Decisions (Strikes, Suspension, Deactivation, Exemption, Review Flags)

Approved by the project owner when Phase B was started.

| Ref | Decision |
|---|---|
| **D1 / F3.4 / F3.7** | ~~Exemption request window and provisional-strike waiver window are **72 hours** (policy text: 48).~~ **Superseded 2026-10-06: now 48 hours, as in the policy (see section 9).** One constant for both (`strike_policy_constant('exemption_window_hours')`). |
| **D2 / F3.8** | Previously undefined counts: booking abuse (12.9) **2**, vehicle damage (29.15) **3**, contamination (29.16) **1**, availability violation (5.7) **1**, intentional pickup deviation (8.7) **1** (issued on the 2nd occurrence within 30 days, PI-B3). |
| **D3** | Existing strike counts reset to 0; old test data is not migrated. Suspensions created by the old 3-strike logic ("Automated platform suspension: …") are lifted with the counts; manual suspensions are kept as open-ended and must be reinstated by an administrator. |
| **D5** | The unauthenticated Express strike / suspend / reactivate routes (`server/src/routes/passengerRoutes.ts`, `driverRoutes.ts`) return **403**. |
| **D6** | Ladder thresholds, window and deadlines are code constants in the database (`strike_policy_constant`) mirrored in `packages/shared/src/config/policyConfig.ts` for display. The pause switch is database state in `system_policy_config.strike_accrual_paused`. |
| **F3.3 override** | ~~Suspension lengths: **3 days at 5 strikes, 7 days at 8 strikes** (policy text: 7 and 30).~~ **Superseded 2026-10-06: now 7 days at 5 strikes and 30 days at 8 strikes, as in the policy (see section 9).** Ladder otherwise as written: 1 warning, 3 administrative review, 10 deactivation. |
| **PI-09** | Option A: errata (a)–(f) applied by intent; counts for (g)–(h) per D2. The Batch 2 `issue_booking_abuse_strike` function, its trigger and the `strike_count` / `last_strike_at` / `is_suspended` passenger columns are removed. |
| **PI-B1** | A consequence fires on each *upward* crossing of a threshold; one strike that crosses several applies the highest and still raises the 3-strike review. A reinstated account still at/over 10 is deactivated again on its next strike. |
| **PI-B2** | Repeated exemption cause (25.7): the 3rd request on the same cause within 30 days is **reviewed**; the 4th and later are denied automatically. |
| **PI-B3** | "Repeated" = the 2nd confirmed occurrence of the same violation within 30 days; the strike is issued on the 2nd and each later one. |
| **PI-B4** | A 10-strike deactivation is reviewed by the **LGU** Administrator; the TODA Administrator can recommend through a review flag. |
| **PI-B5** | The driver's active TODA is snapshotted on each strike and exemption request; that TODA's administrator reviews it. |
| **PI-B6** | Immediate-escalation violations suspend the account **with no end date** ("pending investigation") until an administrator decides. |
| **PI-B7** | The emergency pause carries a scope (`ALL` or `CANCEL_STALL_NOSHOW`); serious and safety violations are never pausable. |
| **PI-B8** | A waiver or void that removes the basis for an *active ladder suspension* lifts it, and dismisses the open 3-strike review. Deactivation is never lifted automatically. |
| **PI-B9** | A driver can state that the TODA is a party to the dispute; the TODA administrator can also escalate with a reason. |

### Assumptions to confirm
- `DRV_FABRICATED_REPORT` (a driver's fabricated report against a passenger) is seeded at **2 strikes**, mirroring the passenger rule 19.5. The Batch 3 policy text only states the passenger count.
- Business days are Monday–Friday in Asia/Manila with **no holiday calendar** in this version.
- Suspension of a driver does not interrupt an active trip; the driver is forced offline when it ends.

### Findings routed to other batches
- **Batch 8:** the PI-09 cancellation trigger tests the booking statuses `Assigned` / `Ongoing`, which no app code writes (apps write `Accepted`, `In Transit`, `Trip Ongoing` …). It does not fire today; Batch 8 owns the definition of a "late" cancellation (12.2) and must align the statuses. The Batch 2 one-open-booking guard (`check_one_open_booking`) tests the same two names and therefore also misses accepted / in-transit bookings.
- **Batch 2:** `apps/passenger-pwa/src/services/bookingService.ts` (~lines 132-147) falls back to "the first passenger in the table" when no valid passenger id is available, so a booking (and any strike it later causes) can be attributed to the wrong person. Hard-coded test logins in `Login.tsx` and `DriverLogin.tsx` bypass the suspension checks and should be removed or gated.
- **Batch 0/1 (fixed after Batch 3):** migration `20260927000000_fix_database_advisor_and_rls.sql` created `toda` policies and `check_toda_is_active` using `account_status`, a column `20260828000003` renamed to `toda_status`, so the chain failed on a fresh database. The file now uses `toda_status`. (That fix alone only made the chain build on an *empty* database; the next section covers what a database with data exposed.) The live project already has this migration recorded as applied, so it is unaffected.
- **Batch 1 (fixed after Batch 3):** `POST /api/admin/drivers/:id/verify` had no authentication and wrote `account_status = 'Verified'` with the service-role key. Nothing calls it (the LGU portal uses `verify_driver_affiliation`), so it now returns 403 like the strike/suspend routes, as do the in-memory `POST /api/toda/drivers/:id/suspend` and `/reactivate`.
- **Still open (not changed):** other server routes that mutate data have no authentication: `POST /api/communication/send-sms` (sends real SMS), `/api/toda/:id/approve|return-correction|reject|decline|register`, `/api/toda/applicants/:id/verify-step|forward`, `/api/toda/terminal-relocation`, `/api/admin/fare-matrix`, `/api/admin/announcements`, `/api/admin/audit-logs`, `PATCH /api/admin/incidents/:id/status`, `/api/admin/todas/:id/roster`, and the OCR routes. The LGU and TODA portals call several of them, so they need a verified-JWT middleware rather than a 403.

### Live database state (checked read-only before Batch 3 was committed)
- The live Supabase project's `supabase_migrations.schema_migrations` records migrations only through `20260927020000`.
- **`20260930080000_batch1_onboarding_and_expiry.sql` (Batch 1) is NOT applied on live** (`admin_review_flag`, `system_policy_config`, `driver_toda_affiliation`, the `audit_log` extension columns and `is_driver_documentarily_restricted` are missing). The Batch 3 migrations depend on it and cannot be applied until it is.
- The Batch 2 files (`20261003000001-6`) are present in the database (applied by `scripts/applyBatch2Migrations.js`) but are not recorded in the history table, so `supabase db push` would try to run them again.
- Do not deploy the Batch 3 application code before the database is caught up: the LGU suspend/strike actions, the TODA recommendation and the new restriction checks call functions that do not exist on live yet (the restriction checks fall back gracefully; the LGU and TODA actions show an error).
- **Open for a later batch:** no LGU screen for the emergency pause or the exemption queue; no driver/passenger exemption request forms; TODA review-flag list.

### Supabase Preview failure on the Batch 1 migration (fixed)
Supabase Preview failed on `20260930080000_batch1_onboarding_and_expiry.sql` with
`record "v_driver" has no field "is_permanently_disqualified"` at the affiliation backfill.

**Why the local emulator missed it:** it had no driver rows when Batch 1 ran, so the backfill inserted nothing and the insert trigger never fired. A database that already has drivers with a `toda_id` (Supabase Preview, and the live project with 4 drivers) fails. **Applying Batch 1 to live would have failed the same way.** `scripts/db-tests/batch1/existing-data.js` now reproduces it (existing drivers when Batch 1 runs) and passes after the fixes.

Fixes in `20260930080000_batch1_onboarding_and_expiry.sql` (not applied on live, so safe to edit):
1. The backfill runs in the migration's trusted internal context. It records historic Endorsed / Approved / active rows, which the new-application trigger would reject even once the column exists; the flag is reset right afterwards and a test proves new applications are still validated.
2. New section 0 re-adds `toda.registration_number`, `certificate_number`, `certificate_expiry` and `account_status` with `IF NOT EXISTS`. Migration `20260828000003` drops/renames them, yet Batch 1 (the `toda` protection trigger, `approve_toda_accreditation`, the expiry cascade, the affiliation guard), `seed.sql` and the live project all use them. Without this, after Batch 1 every `UPDATE` on `toda`, accreditation approval and going online fail at run time. It is a no-op wherever the columns already exist. **The live project's `toda` table could not be re-checked; if any of these columns is missing there, this block adds it.**

Fixes in `supabase/seed.sql` (Supabase Preview and `db reset` run it after the migrations; it had five defects):
- removed `contact_number` / `email` from the `toda` insert (columns no longer exist) and set `toda_status = 'Active'` next to `account_status`;
- both `auth.identities` inserts named 7 columns but supplied 6 values (added `updated_at`);
- `lgu_admin.role` does not exist; the value is the job title, so it now writes `position`;
- the 4th TODA admin (`lptoda`) points at a TODA the seed never creates; the loop now skips an admin whose TODA is absent (with a notice) instead of failing on the foreign key. Nothing was deleted; if that TODA is meant to exist in the seed, add its row.


---

## 6. Batch 4 Decisions (Driver Availability, Online Persistence, Presence & Inactivity)

### 6.1 Approved by the project owner when Batch 4 started

| Ref | Decision | Where it lives |
|---|---|---|
| **PI-06 (Option A)** | One canonical, accuracy-aware location threshold instead of per-rule values. Batch 4 fixes the **publish / go-Online / dispatch** accuracy at 100 m. The 40 m pickup-zone gating and the no-show radius stay with Batch 8. | `LOCATION_MAX_ACCURACY_METERS`, `driver_presence_constant('location_max_accuracy_m')` |
| **PI-09 (Option A)** | Cross-reference errata are implemented by intent. For Rule 5.7 the strike count is 1 point per administrator-confirmed instance (catalog code `DRV_AVAILABILITY_VIOLATION`, Batch 3 decision D2); Rule 5.3 likewise 1 point (`DRV_QUEUE_CONFLICT`). | `violation_catalog` (Batch 3) |
| **F4.1 – F4.4** | Policy values kept as written: reminder at **3** unanswered offers, automatic Offline at **5**, review flag at **3 automatic Offlines in a rolling 30 days**, monitoring flag at **3 offline-after-decline events** with "immediately" meaning within **60 s**. | `driver_presence_constant()` + `policyConfig.ts` (section 7) |
| **F4.5** | Location publishing interval: **5 s** while a booking is open, **15 s** while Online and idle. Slower is accepted (Rule 17.8). | `ACTIVE_TRIP_GPS_INTERVAL_SECONDS`, `DRIVER_IDLE_LOCATION_INTERVAL_SECONDS` (client only) |
| **F4.6** | A GPS fix may be used to go Online, and counts as fresh for dispatch, for at most **45 s**. | `LOCATION_MAX_AGE_SECONDS`, `driver_has_fresh_location()` |
| **F4.7** | Fixes worse than **100 m** accuracy are not published and cannot start a session. | `LOCATION_MAX_ACCURACY_METERS` |
| **PI-B4-1** | **One verified unit per driver for the pilot.** Shown read-only on the Home screen; `plate_number` and `franchise_number` are locked once the account is Verified (also Suspended / Deactivated). Only an LGU administrator or the system can change them. No multi-vehicle table. | `protect_verified_vehicle()` (Rules 3.10, 29.18) |
| **PI-B4-2** | **Location permission lost during an open accepted booking:** record it and set Offline when the booking ends; otherwise set Offline immediately. | `driver_report_location_unavailable()`, `apply_pending_driver_offline()` |
| **PI-B4-3** | **"Unanswered" = the offer timed out with no response.** An explicit decline or an accept resets the streak and clears the reminder. A new online session starts at zero. | `classify_dispatch_attempt_response()`, `track_driver_offer_response()` |
| **PI-B4-4** | **Presence sweep:** an Online driver whose app has not reported for 5 minutes is set Offline (no strike), via the Express server's scheduler. | `sweep_driver_presence()`, `DRIVER_HEARTBEAT_STALE_SECONDS` |
| **PI-B4-5** | The Rule 7.6 reminder uses the exact English policy sentence, followed by a Filipino line. | `DriverPresenceNotices.tsx`, notification row `DRIVER_INACTIVITY_REMINDER` |
| **PI-B4-6** | Rule 5.4 (going Available right after leaving the terminal queue): **no system action** beyond TODA-administrator flagging. | none by design |
| **Extras** | Approved: the 5-minute presence sweep. **Not approved, not built:** TODA-portal additions (Online column, record-violation / flag screens), Screen Wake Lock, and adding `vitest`. | section 7.1 of the matrix |

### 6.2 Interpretations made while building (please confirm)

| Ref | Interpretation | Why |
|---|---|---|
| **D-B4-1** | **"Session" in Rule 29.7 means the driver's app login session** (the `driver.session_id` snapshot stored on each online session), not one Online period. | Going Offline ends the Online period, so "3 times in a session" could never be reached otherwise. |
| **D-B4-2** | Going Online **auto-selects the only verified affiliation**. If several are verified and none is selected, the driver must choose (`ERR_SELECT_AFFILIATION`). If the selected TODA expires and exactly one verified affiliation remains, that one becomes active. | Rule 3.1 requires a choice only when there are several. |
| **D-B4-3** | **"Open accepted booking"** is a booking whose `driver_id` is the driver and whose status is one of: Accepted, Assigned, Driver Assigned, Driver En Route, Heading to Passenger, Driver Arrived, Arrived at Pickup, In Transit, Trip Ongoing, Ongoing, Arrived at Destination. | The apps write several spellings, and nothing in the code ever sets a driver to `Busy`, so the booking table is the only reliable source. One function (`_booking_is_open_accepted`) holds the list. |
| **D-B4-4** | An offer **withdrawn by the system** (booking cancelled or completed while it was pending; recorded as `Expired` with `responded_at`) neither counts as unanswered nor resets the streak. | The driver neither ignored nor answered it. |
| **D-B4-5** | A heartbeat with **no usable position still proves presence**; a fix worse than 100 m is not published (the last good fix is kept). A fix older than 45 s is never sent. | Presence and GPS quality are separate questions; GPS staleness (Rule 9.2) is Batch 8. |
| **D-B4-6** | The database refuses a plain `UPDATE` that sets a driver `Available` or `Busy` (`ERR_USE_GO_ONLINE`) and refuses a plain `UPDATE` to `Offline` while a booking is open. The service role and the engine are exempt. Clients cannot write `unanswered`, `resolved_at` or `responded_at` on an offer except in the same update that answers it, and `responded_at` is stamped with the server clock. | So every precondition is checked in one place and the unanswered counter cannot be forged. |
| **D-B4-7** | **Reports under Rules 5.3 / 5.7:** a TODA administrator (own TODA's drivers), an LGU administrator, or a passenger (only for a driver on one of their own bookings) can file a report. It creates a review flag only. A strike is issued when the driver's TODA administrator or an LGU administrator confirms it, with a reason, through `issue_strike`. | Both rules say a strike follows a *confirmed* instance. |
| **D-B4-8** | The inactivity reminder is stored as a notification row **and** shown as an in-app dialog. | The row survives a closed app; the dialog is the "in-app reminder" the rule asks for. |
| **D-B4-9** | **The presence sweep runs inside the database with pg_cron, every minute** (job `sakay-presence-sweep`, entry point `run_presence_sweep_job()`, migration `20261006000002`). The 5-minute value is the staleness threshold, not the schedule. The earlier Express timer was removed. *(Owner decision after the first close-out audit.)* | Render's free plan puts the web service to sleep, which would silently stop an in-server timer. pg_cron needs no web server. |
| **D-B4-10** | **Single login session (Rule 29.1) is checked by the database.** `driver_go_online`, `driver_heartbeat` and `get_my_driver_presence` take the token the app stored at login and compare it with `driver.session_id`. A different or missing token is refused with `ERR_SESSION_SUPERSEDED` once a session id exists; a driver with no session id is not checked. Going Offline is allowed from any device. A refused device is signed out. *(Owner-approved fix, W12.)* | Batch 2's check was client-side only, so a signed-out device could keep reporting. |
| **D-B4-11** | **Background warning (Rule 17.6, W6):** if the app was hidden for **20 s or more** while Online, a dialog warns on return (`DRIVER_BACKGROUND_WARNING_AFTER_SECONDS`, client-only). Heartbeats are not paused while hidden; location freshness (45 s) already keeps stale drivers out of dispatch. Screen Wake Lock is **not** built. *(Owner-approved fix; Wake Lock deferred.)* | Browsers suspend a hidden page, so a warning can only be shown when the driver comes back. |
| **D-B4-12** | **W2 accepted as documented relays.** `DriverNavigation.tsx` and `DriverActiveTrip.tsx` keep relaying the context's position to the passenger over a realtime broadcast every 2 s. They are not refactored into the engine. They write nothing to the database. *(Owner decision.)* | Avoids risk to active-trip logic. |
| **D-B4-13** | **Deferred to later administrative batches:** the TODA + LGU vehicle-substitution approval workflow (W11), a multi-vehicle selector, and the TODA-portal screens. *(Owner decision.)* | Not needed for the one-unit pilot (PI-B4-1). |
| **D-B4-14** | The hard-coded fallback driver id was removed from the accept and renewal handlers. Accepting a booking without a valid driver id is refused instead of accepting for a made-up driver. | Aligns with Rule 29.1 and removes demo data from a real transaction. |
| **D-B4-15** | **Offers ignored while the driver has an open accepted booking are not inactivity** (no streak, no reminder; migration `20261006000003`). The inactivity reminder is also hidden during a booking. Found in manual test T5: a driver mid-trip kept receiving offers and the streak climbed to 8. | Rule 7.6 counts offers ignored "without accepting any booking"; a driver carrying a passenger is busy, not unavailable. Without this, the first ignored offer after a trip would switch the driver Offline at once. |
| **Follow-up (Batch 6)** | The dispatcher still offers bookings to a driver who is already on a trip, because nothing marks a driver Busy. D-B4-15 stops that from penalizing the driver, but Batch 6 should stop sending such offers. | `dispatchService.ts` filters only on `availability_status = 'Available'`. |

### 6.3 Findings routed to other batches or to the owner

- **Batch 6 (dispatch):** `dispatchService.ts` was not touched. It must (a) require `driver_has_fresh_location()` before offering, and (b) stop treating `availability_status = 'Available'` as sufficient. Its timeout write (`Declined` without `responded_at`) is exactly what the unanswered counter expects; do not add `responded_at` there.
- **Batch 2 follow-up:** the one-open-booking guard lists `Assigned` and `Ongoing`, but the apps write `Accepted`, `In Transit` and `Trip Ongoing`. The guard may not match real bookings. Not changed here.
- **Batch 8:** pickup-zone radius (PI-06) and GPS staleness / Driver Unreachable (Rule 9.2) build on `driver_has_fresh_location()` and the accuracy constant.
- **Security findings (outside Batch 4, not changed here):**
  - The hard-coded "Instant Verified Test Driver Login" in `DriverLogin.tsx` was **removed** at the owner's request; every driver login now creates a real Supabase session.
  - Still open: the LGU portal login (`AuthContext.tsx`) tries default passwords against `admin@gmail.com` / `admin@sakay.ph` and has a development-only demo fallback; driver registration (`driverApiService.ts`) tries a list of default passwords when reclaiming an auth account; `getSecureLookupClient()` signs in with a hard-coded admin email and password inside the client bundle (that account does not exist in the database today); and `driver_select_policy` lets the anonymous role read every driver row.
- **Operational:** `scripts/applyBatch4Migrations.js` and `scripts/checkDriverState.js` were not written by Claude and were never run by it. `applyBatch4Migrations.js` runs files straight against the hosted database without a transaction or history record; prefer `supabase db push`. The first two Batch 4 migrations are confirmed applied (read-only check of migration history). All four are safe to re-run (`batch4/reapply.js`). `checkDriverState.js` loads `.env` from `scripts/server/.env`, which does not exist.
- **pg_cron:** it was available but not installed on the hosted project when checked. Migration `20261006000002` installs it. After applying, confirm with `SELECT jobname, schedule, active FROM cron.job;`. The hourly SLA cascade and strike sweep (Batches 1 and 3) still run from the Express server and have the same sleep-on-free-plan weakness; moving them to pg_cron is a follow-up.
- **Deferred by the owner's choice:** the TODA-portal screens (Online column, record-violation and flag review), the vehicle-substitution approval workflow, a passenger screen for filing 5.3 / 5.7 reports, and Screen Wake Lock. Until they exist, flags can be read and actioned by calling the functions directly.


---

## 7. Batch 5 Decisions (Fare Computation, Rate Changes, Estimates, Deviations, Cash-Only, No Scheduling)

### 7.1 Approved by the project owner when Batch 5 started ("use the recommended defaults")

| Ref | Decision | Where it lives |
|---|---|---|
| **D1 / PI-03** | Option A: destinations (and pickup) are locked at confirmation; Rules 6.2(a) and 6.2.2 are dropped. | `booking_fare_update_guard()` (`ERR_BOOKING_LOCKED`) |
| **D2 / PI-04** | Option B: the fare is the Solo Trip Fare of the vehicle's whole route, split per kilometre by passengers on board; every kilometre costs the same; the Matched Shared Fare Estimate assumes one more 1-passenger booking. | `calculate_fare()`, `allocate_shared_fares()` |
| **D3 / PI-09** | Option A: cross-reference errata by intent (nothing new needed in Batch 5; the Batch 3 catalog already carries them). | `violation_catalog.source_rule` |
| **D4** | Ordinance **No. 110, Series of 2022** is the citation, stored in the database and shown from it. | `fare_matrix.ordinance_reference` |
| **D5** | No booking without a real OSRM road route: if OSRM cannot be reached nothing is priced and the Book button stays off. The database also refuses a booking without a plausible route distance. | `NewTrip.tsx`, `BookSummary.tsx`, `booking_fare_insert_guard()` |
| **D6** | F5.1 and F5.2 values approved (see 7.2 for the one refinement). | `fare_policy_constant()` + `policyConfig.ts` section 8 |
| **D7** | Rate changes are forward-only: they may be future-dated, never back-dated. | `enact_fare_matrix()` (`ERR_BACKDATED_RATE`) |
| **D8** | `fare_adjustment_history` is created now as the one fare-change ledger (route deviations now; Batch 9 adds disputes and early stops). | `20261007000003_*` |
| **D9** | `fareCalculator.ts` is now a typed client with no formula; the vitest test (which could not run: `vitest` is not installed) was replaced by database tests. | `packages/shared/src/utils/fareCalculator.ts`, `scripts/db-tests/batch5/` |
| **D10** | Cash-only wording fixed in the Passenger Terms. "No discount row for now": see 7.2. | `PassengerTermsOfService.tsx` |
| **D11** | The Express `/api/admin/fare-matrix` route answers 403 to everything. | `server/src/routes/fareMatrixRoutes.ts`, `disabledEndpoints.ts` |
| **D12** | `/book-summary` is kept and adapted to the same quote function; it is still unreachable from the app. | `BookSummary.tsx` |
| **D13** | The booking table's open row-level security (anonymous read and write of every booking) is a separate security pass. Batch 5 closes only the fare, route and rule columns. | trigger guards only |

### 7.2 Interpretations and refinements made while building (please confirm)

| Ref | Interpretation | Why |
|---|---|---|
| **D-B5-1** | **Dead-band refinement (F5.1).** Movement counts only beyond `max(15 m, accuracy of the last counted point + accuracy of this fix)`; the approved wording was `max(15 m, accuracy of this fix)`. The 15 m floor is unchanged. | Found by test: with the approved wording alternating +-11 m jitter produced 2.6 km of phantom distance while standing still, and a simulation of random noise (10 minutes, 5 s beats) gave 0.2 - 1.8 km. Overlapping error circles cannot show movement; with the combined rule the same simulation gives 40 - 140 m and the deterministic jitter test gives 0 m. |
| **D-B5-2** | **Extra guard constants** that were not in the figure list: a track that ends more than **150 m** from the destination cannot prove a SHORTER trip (F5.2 guard); the phone's OSRM distance must be at least 90 % of the straight line minus 50 m and at most 3x it plus 500 m; a requested time more than 300 s ahead is a scheduled booking; a rate back-dated by more than 120 s is refused; 3 consecutive discarded fixes replace the reference point. | Needed to make "keep the estimate unless the trip really differed" safe against missing GPS and early endings (early termination itself is Batch 9). All are code constants mirrored in `policyConfig.ts` and covered by the drift test. |
| **D-B5-3** | **D10 "no discount row for now"** was read as: the Student / Senior / PWD "mandatory 20 % discount" row was **removed from the Passenger Terms** (Tagalog and English), because the system does not implement any discount and the policy text has none. Nothing was built. | A Terms row promising something the app does not do is worse than silence. It is one table row per language: restore it if the LGU wants the discount, and a discount rule would then belong in the fare function. |
| **D-B5-4** | The orphan `/book-summary` screen lost its "auto-cancel if unmatched" radio group. | Rule 6.5 says an unmatched Shared booking **automatically continues as Solo**; the option promised something the policy forbids (and was never sent anywhere). |
| **D-B5-5** | The final fare is computed and locked **once, when the booking first reaches `Arrived at Destination` (or `Completed`)**, by whoever causes that transition. | Both apps then read the same figure from the same row (Rule 6.2); passenger or driver ending first gives the same result because a track that stops short of the destination cannot lower the fare. |
| **D-B5-6** | A Shared booking marked matched but with no recorded segments (cannot happen before Batch 10) is billed the **Matched Shared Fare Estimate**, never more than the estimate it accepted; one that was never matched is billed the Maximum Unmatched Fare (Solo). | Keeps the driver unblocked and the passenger protected until Batch 10 supplies the legs for `allocate_shared_fares()`. |
| **D-B5-7** | `gps_log` (every trip's route) was readable by anyone and writable by anyone, even without a login. It is now written only by `driver_heartbeat()` and readable only by the trip's passenger and driver, the driver's TODA administrator and the LGU administrator. | Trip distance is billed from it and it now holds real routes. |
| **D-B5-8** | The minimum fare (Rule 6.1.5 d) is applied per booking **after** rounding, to the rounded base fare. | A whole-peso fare cannot equal a base fare of, say, 15.50. |
| **D-B5-9** | Trusted server code (service role, internal context) may insert a booking row **without** a quote (imports, repairs, tests). Everyone else needs a quote. Scheduled bookings are refused for everyone. | Keeps maintenance possible without opening a client path. |
| **D-B5-10** | `fare_matrix.is_active` is now only a convenience flag set when a rule takes effect immediately; every lookup uses `effective_timestamp` (`fare_rule_in_force()`). | A scheduled rule cannot flip a flag by itself when its time arrives. |
| **D-B5-11** | Rule versions can no longer be edited or deleted by anyone (not even the service role); a mistake is fixed by enacting a newer version. | Bookings point at a version; history must not move. |
| **D-B5-12** | **Fail-closed trust check in the booking guards.** `booking_fare_insert_guard()` and `booking_fare_update_guard()` treat an unknown answer from Batch 3's `is_service_context()` as NOT trusted (`COALESCE(..., FALSE)`). | Found by the live dry run on the hosted database: the helper answers NULL, not FALSE, in a database session that has never set `sakay.internal_context`, and `IF NOT NULL` is NULL, so every lock was silently skipped (the estimate, pickup and final fare were editable; a client-supplied `created_at` and `actual_fare` were kept). The emulator sessions always had the setting defined, so no earlier test could see it. Covered now by 7 fail-closed checks that make the helper answer NULL. |

### 7.3 Findings routed to other batches or to the owner

- **Batch 6 (dispatch):** `accepted_at` is stamped by the driver's phone clock (`DriverIncomingRequestModal.tsx`); the fare conditions bind at acceptance (Rule 6.5), so the database should stamp it. `dispatchService.ts` was not touched.
- **Batch 8 (pickup edit):** Rule 29.9 lets a pickup be updated before a driver accepts; Batch 5 blocks direct edits, so Batch 8 must add the edit as a function that sets the internal context and re-quotes. The booking statuses Batch 5 keys on: `Trip Ongoing` / `Ongoing` (passenger on board), `Arrived at Destination` and `Completed` (final fare).
- **Batch 9 (trip execution):** early-termination fare rules and fare disputes should write `fare_adjustment_history` (reason codes `EARLY_TERMINATION`, `DISPUTE_RESOLUTION`, `ADMIN_CORRECTION`, `DECLARED_PASSENGER_MISMATCH` already exist in its CHECK); `trip_started_at`, `arrived_at` and `trip_completed_at` are still stamped by the phones; the payment-confirmed flag is still read from `localStorage` across tabs.
- **Batch 10 (ride sharing):** set `shared_trip_match.match_status = 'Matched'`, supply the legs (`board_km`, `alight_km` along the vehicle route) to `allocate_shared_fares()` and replace the interim `matched_estimate_pending_segments` billing; the 50 % cutoff text is already shown from `RIDE_SHARING_CUTOFF_PERCENT`; passenger caps disagree (UI 2 per Shared booking, `bookingService` 3, database 4).
- **Batch 11:** the passenger report category "Overcharging Attempt" has no wording for a driver asking for pre-payment or an off-platform deposit (Rule 6.4); the strike `DRV_OVERCHARGING` (2 strikes, administrator-confirmed) already exists.
- **Batch 12:** analytics now read `actual_fare` / `actual_distance_km` (the columns that exist; they used to read `final_fare` / `route_distance_km`, which no migration creates); `gps_log` needs a retention policy (about 12 rows a minute per trip in progress).
- **Security patch SP-1 (Batches 3, 4 and 5):** the trust checks that failed open on NULL (the helper `is_service_context()` and the one inline copy in `protect_read_only_columns()`) are fixed by migration `20261007000004_security_null_safe_service_context.sql`; see section 7.5. Verified in fresh database sessions (39 checks) and by a rolled-back dry run on the hosted database. Apply with `node scripts/applySecurityPatch.js apply`.
- **Security pass (D13):** booking row-level security still lets any role, including anonymous, read and update every booking. Batch 5 stops fare, route and rule edits with triggers, but names, addresses and coordinates of every booking remain readable.
- **Leftovers not changed:** "Ordinance No. 118" still appears in demo data (`apps/lgu-portal/src/mockData/adminData.ts`, `apps/toda-portal/src/mockData/todaData.ts`), in a comment of the historic migration `20260819122000_seed_master_data.sql` and in a Batch 3 catalog note (`DRV_OVERCHARGING`); historic migrations are never edited. The public OSRM servers are demonstration infrastructure; plan a hosted or self-hosted router before a wider pilot.

### 7.4 Operational notes

- The three Batch 5 migrations (`20261007000001_batch5_fare_rules.sql`, `20261007000002_batch5_fare_engine.sql`, `20261007000003_batch5_booking_fare_guards.sql`) were applied to the hosted database by the project owner and are recorded in its migration history (checked read-only on 2026-10-04). The note below is how they were applied: They depend on Batches 1 - 4 (all recorded in its migration history). A pre-flight and a rolled-back dry run against the hosted database passed with the final files. To apply: `node scripts/applyBatch5Migrations.js dryrun`, then `node scripts/applyBatch5Migrations.js apply` (one transaction per migration, checks before each commit, each recorded in `supabase_migrations.schema_migrations`, then an API schema reload).
- **Deploy the database and the apps together.** A phone still running the previous version sends `actual_fare` when the passenger confirms payment and reads `final_fare`; the new database rejects the first (`ERR_FARE_LOCKED`) and has no such column. Reload the apps after the migration.
- After applying, the rule in force must show the citation: `SELECT ordinance_reference FROM public.fare_rule_in_force();`.

### 7.5 Security patch SP-1: trust checks that failed open (migration `20261007000004_security_null_safe_service_context.sql`)

**What was wrong.** Batch 3's `is_service_context()` answered NULL, not FALSE, in a database session that had never set the custom setting `sakay.internal_context` (a freshly opened pooled connection is exactly that). A guard written `IF NOT is_service_context() THEN <protect>` evaluated `NOT NULL`, which is NULL, and PL/pgSQL treats NULL as false: the protection was silently skipped. Every earlier test passed because the test sessions had already defined the setting. The live dry run for Batch 5 found it on the hosted database (the first statement of a new connection printed `helper answers NULL`); a dry run of this patch showed **all 8 probed attacks working on the hosted database in brand-new connections** (the strike, suspension and vehicle columns, going Available without `driver_go_online()`, the strike pause switch, review flags, and the two service-only sweeps).

| Guard | What it protects | Reachable by clients? |
|---|---|---|
| `protect_read_only_columns()` (Batch 3; held its own inline copy of the check) | strike, suspension, deactivation and closure columns of passengers and drivers | Yes: an account holder updating their own row. The row policies for `passenger` and `driver` also contain `OR auth.uid() IS NULL`, so an **unauthenticated** caller reached them as well |
| `check_driver_online_eligibility()` (Batch 4) | going Available only through `driver_go_online()`; no Offline with an open accepted booking (Rule 5.5) | Yes: a driver updating their own row (and anonymous callers through the same row policy) |
| `protect_verified_vehicle()` (Batch 4) | plate and franchise number of a verified vehicle (Rules 3.10, 29.18) | Yes: same |
| `classify_dispatch_attempt_response()` (Batch 4) | the unanswered / resolved columns that feed Rules 7.6 - 7.8 | Yes: the `dispatch_attempt` update policy is `USING (true)` |
| `create_admin_review_flag()` (Batch 3) | who may create review flags | Yes: EXECUTE is granted to signed-in users |
| `protect_strike_pause_config()` (Batch 3) | the strike pause switch only through `set_strike_accrual_pause()` | Only the LGU administrator can write that table (direct writes skipped the audit) |
| `sweep_strike_state()`, `sweep_driver_presence()` | service-only sweeps | **No**: EXECUTE is revoked from clients; the check inside is defense in depth (an earlier version of these notes said any signed-in user could run them; that was wrong) |
| `booking_fare_insert_guard()`, `booking_fare_update_guard()` (Batch 5) | the fare lock | Already written NULL-safe (D-B5-12) |

**The fix.** (1) `is_service_context()` answers TRUE or FALSE, never NULL (both operands are COALESCEd), which repairs every caller at once. (2) `protect_read_only_columns()` is copied verbatim from its live definition with the one inline check replaced by the helper. Same signatures, attributes and privileges; the migration ends with a self-check and is safe to run twice. `issue_strike()` and the other "allow when trusted" checks were never affected (NULL fails them closed). `is_lgu_admin()`, `is_toda_admin()` and `_in_presence_context()` are strict booleans and were checked.

**Verification.** `scripts/db-tests/security/null-safe-service-context.js` dumps a populated database and loads it into a brand-new PGlite instance for every probe, so the session has never set the setting. Before the patch (chain through Batch 5) every attack works; after it every attack is refused and the legitimate paths (service role, LGU and TODA administrators, the strike engine, `driver_go_online()`, harmless self-edits) still work. `node scripts/applySecurityPatch.js dryrun` repeats this on the hosted database inside rolled-back transactions; `apply` runs the patch in one transaction, verifies before COMMIT, records it in the migration history and re-checks from new connections. The script refuses to run if the live function bodies are not exactly the Batch 3 text.

**Not part of this patch (found while checking who can reach these guards).** The row-level policies are still open: `passenger` and `driver` allow UPDATE when `auth.uid() IS NULL` (roles anon and authenticated), `dispatch_attempt` allows any UPDATE, and `booking` has the open policies noted in D13. With the guards fixed, the protected columns hold, but every other column of those rows can still be edited by an unauthenticated caller. This is the D13 security pass, now more urgent; it needs care because some screens (registration, OTP activation) may rely on anonymous access.

---

## 8. Security Batch: Perimeter Lockdown (stages S0 - S4)

**Status: built and verified on the local emulator and in rehearsals; when this was written, nothing had been applied to the hosted project.** The project owner applies it, one stage at a time, with `node scripts/applyPerimeterLockdown.js` (checklist in 8.4; `preflight` shows which stages are recorded in the migration history). Compliance rows: `docs/policy-compliance-matrix.md` section 10.

The Phase A audit (2026-10-04: the repository, and the hosted project read-only) found that the policy logic inside the database works under test but the **perimeter around it did not**. Sign-ups on the hosted project are open and auto-confirmed (`disable_signup=false`, `mailer_autoconfirm=true`), so "signed in" means "anyone on the internet", and the apps were written as if it did not. This batch makes the database, the Express server and the four apps agree on one model: **trust only role rows keyed to `auth.uid()`; never user metadata, never an e-mail address, never a phone number typed before sign-in.**

### 8.1 What the audit found, and what fixes it

| # | Finding | Fixed by |
|---|---|---|
| 1 | **Sign-up escalation.** Two `SECURITY DEFINER` triggers on `auth.users` read the user-editable `raw_user_meta_data`: `role = 'lgu_admin'` created an **Active LGU administrator**, `role = 'toda_admin'` plus a public acronym an Active TODA administrator, and any confirmed phone activated a Pending passenger. One `signUp()` call was enough (reproduced on the emulator only; no sign of use in the live data). | **S0** (hot-fix) |
| 2 | 40 row policies on `public` and 4 on `storage.objects` open to `anon` / every signed-in user (`USING (true)`, `OR auth.uid() IS NULL`): anon could read passenger, driver, booking and notification rows (names, numbers, live driver position) and write booking, dispatch, notification and audit rows. | **S3**, **S4** |
| 3 | **Self-grant.** A stranger with a login could insert itself as an Active `toda_admin`, a Verified `driver` or an Active `passenger` (no OTP), and edit its own TODA's accreditation or its own verification decision. | **S1** guards + **S3** policies |
| 4 | 43 functions in `public` executable by anon (32 `SECURITY DEFINER`), among them `activate_passenger_otp`, `increment_failed_otp`, `reset_failed_otp` and the old `get_assigned_driver_details` (any booking id returned the driver's live position). | **S1** (rewrites), **S2** |
| 5 | All 10 storage buckets public, anon insert / overwrite on any file; 97 stored files in 5 buckets (licences, permits, clearances, rosters, bylaws); six full public URLs stored in `public.toda`. | **S4** |
| 6 | Express server with **no authentication**: open SMS relay on the project's SIM, open Gemini OCR (money per call), scheduler secret with a hard-coded default that `render.yaml` never set, mock "TODA portal" API, 25 MB bodies, stack traces in answers. | server layer |
| 7 | **Client backdoors and secrets:** the LGU and TODA portals tried default admin accounts and passwords (`admin@gmail.com` / `admin123`, `Password123!`) and built an administrator profile from metadata or from the e-mail prefix; the Driver app signed in as `admin@gmail.com` in the browser to read other people's rows; "reclaim" routines tried 6 to 12 common passwords; the account password was kept in plain text in `localStorage`; the OTP screens accepted the fixed codes `123456` / `654321` (and any 6 digits in the TODA registration); a passenger test account and several "demo" sessions existed; seeded accounts with known passwords were in `supabase/seed.sql`. | apps, `seed.sql` |
| 8 | **Pre-login look-ups** (the apps asked the database "is this number registered, and under which e-mail?" before anybody was signed in): a way to list who is registered. | removed (D-SEC-6) |

### 8.2 Decisions approved by the project owner ("use the recommended defaults", D-SEC-5 clarified)

| ID | Decision | What was done |
|---|---|---|
| D-SEC-1 | Deploy as a hot-fix first: S0 alone. | `20261008000001`; `apply S0` changes nothing the old apps use. |
| D-SEC-2 | Include all 12 open tables and storage. | S3 (tables) and S4 (storage). |
| D-SEC-3 | Strict authentication model: trust nothing from user metadata. | Roles come only from `lgu_admin` / `toda_admin` / `driver` / `passenger` rows keyed to `auth.uid()`; `raw_user_meta_data` is used only for a PENDING record's display name; both portals refuse a login without an Active administrator row. |
| D-SEC-4 | Remove all `123456` bypasses and close the OTP RPCs. | The server issues, stores and checks codes (6 random digits, 5 wrong tries discard the code, 30 s cooldown, 5 a day); the OTP bookkeeping functions are service-role only (S2); a passenger is activated by the server after the code and the age rule 4.3; no sandbox code, no "success when the server is unreachable". |
| D-SEC-5 | Remove hard-coded backdoors, passwords and seed accounts from the codebase; **do not delete existing test accounts (such as the test driver "Juan") from the live database.** | Code and `seed.sql` cleaned (the seed now holds master data only). No live row was touched. The live accounts created by the old seed still exist with passwords that were public: see 8.4 step 11. |
| D-SEC-6 | Remove pre-login look-ups; the owner recreates affected legacy accounts. | The apps sign in with an e-mail derived from the typed number (`driver_63<10 digits>@sakay.ph` and four older spellings; `passenger_63<10 digits>@sakay.ph`). `scripts/relinkDriverLogin.js` (written by a parallel session) repairs one driver whose login uses another address; the preflight lists the affected drivers and passengers. |
| D-SEC-7 | TODA registration upload order. | Sign up, sign in, upload into `<auth uid>/<file>` of the private buckets, then `register_toda_with_admin` (identity is `auth.uid()`). No direct `toda` / `toda_admin` inserts remain. |
| D-SEC-8 | Small RPCs for counterparty data. | `get_booking_counterparties(uuid[])` (name; phone only while the trip is live), rewritten `get_assigned_driver_details`, `get_my_toda_affiliations()`. |
| D-SEC-9 | Add `find_candidate_drivers` (Batch 6 will replace it). | Only the passenger of an OPEN booking; driver id, TODA and a distance rounded to 0.1 km. |
| D-SEC-10 | `helmet` and `express-rate-limit`; verify tokens with `auth.getUser(token)`. | `server/src/app.ts` and `server/src/middleware/*` (8.3). |
| D-SEC-11 | Unmount / gate the dead Express surface. | `todaPortalRoutes` (hard-coded sample data) is not mounted; the account-action routes keep answering 403; `/api/scheduler` fails closed. |
| D-SEC-12 | No eleventh bucket; keep the fallback. | Selfies stay in `driver-licenses` (the `driver-selfies` bucket never existed); the apps keep the fallback read. |
| D-SEC-13 | Private Realtime channels wait for Batch 6. | Unchanged (see 8.5). |
| D-SEC-14 | The owner handles the Supabase dashboard tasks (CAPTCHA, rate limits, Twilio off). | The checklist in 8.4 and `verifyPerimeter.js` report the settings. |

### 8.3 What was built

**Database (`supabase/migrations`, forward-only, each ends with a self-check):**
- **S0 `20261008000001_perimeter_signup_triggers.sql`**: the sign-up trigger creates only PENDING passenger and driver rows (any other role in the metadata is ignored); the TODA-administrator trigger and its function are dropped; a confirmed phone activates a passenger only when it is the number on the passenger row (last 10 digits); EXECUTE on both trigger functions revoked.
- **S1 `20261008000002_perimeter_expand.sql`** (additive): policy helpers `rls_*` (`SECURITY DEFINER`, so a policy on one table can look at another without recursion); `is_trusted_session()`; the RPCs of D-SEC-8 / D-SEC-9 and `list_accredited_todas()` (the one function anon may call); `register_toda_with_admin` rewritten (same signature; `p_auth_user_id` may only be null or the caller); insert / update guards (a registrant can only create a Pending record; a booking's passenger is fixed and a driver can only attach themselves to a booking nobody has; administrators cannot move or reinstate themselves; a TODA administrator cannot mark their own TODA accredited; audit actors are stamped from the signed-in user); `protect_read_only_columns()` fixed (its `driver_verification` branch compared two columns that do not exist, so every update of a driver's own verification row failed).
- **S2 `20261008000003_perimeter_function_grants.sql`**: every function in `public` loses EXECUTE for PUBLIC, anon and authenticated; the service role gets it; `authenticated` gets back exactly what it had, except five server-only functions; `list_accredited_todas()` stays callable by anon; functions created from now on get no grants at all (a migration must grant explicitly).
- **S3 `20261008000004_perimeter_rls.sql`**: about 40 open policies replaced by scoped ones (own rows; LGU everything; TODA administrator the drivers, applicants, bookings and incidents of their own TODA; participants of a booking); anon loses every table privilege; authenticated loses TRUNCATE / REFERENCES / TRIGGER; the passenger Pending to Active carve-out of `protect_read_only_columns()` is removed (activation is the server's job).
- **S4 `20261008000005_perimeter_storage.sql`**: all ten buckets private; the four open policies on `storage.objects` replaced by owner-folder rules per bucket group (`<auth uid>/<file>`; the LGU reads everything; a TODA administrator reads the documents of their drivers and their TODA's registration files; the other party of a live trip sees a profile photo); the six stored full URLs in `public.toda` rewritten to storage paths.

**Server (`server/src`)**: default-deny order (security headers, CORS, request log, per-IP limit; then only `/api/health` and `/api/scheduler` are open; everything else needs a valid Supabase token and is limited per user; body parsing after sign-in, 100 kB, 12 MB for OCR). Limits: 300 requests / min per IP, 120 / min per user, OTP send 3 and verify 10 per 10 min, SMS 10 / h, OCR 10 / h, roster 30 / h, outcome messages 200 / h. Roles are read with the service role from the role rows (an administrator must be Active). Routes: OTP (own number only), driver to passenger SMS (verified driver, passenger of a live trip, 140 characters), OCR (drivers, image type and size checked), roster (LGU or the TODA's own administrator), and two new template-based outcome routes, `POST /api/admin/notify/driver` (LGU) and `POST /api/toda-admin/notify/driver` (TODA administrator): the browser names the driver and the message type, the server takes the number from the driver's record, writes the text from a template and refuses a message the record does not support. Production: generic 500s, CORS limited to `CORS_ORIGIN`, one trusted proxy hop, scheduler secret of 16+ characters compared in constant time (503 while unset).

**Shared package (`packages/shared`)**: `apiFetch` / `apiPostJson` (attach the Bearer token, 20 s timeout) and the storage helpers (`signedStorageUrl`, `refreshStorageUrl`, `ownedObjectPath`; signed links live 10 minutes for documents, 1 hour for avatars; screens sign when a file is opened; the database keeps storage paths only).

**Apps**: Passenger and Driver apps: no pre-login look-up, no password kept, no sandbox code, own-row reads through the session, counterparties and affiliations through the RPCs, private photos through signed links, password recovery switched off (informational screen). LGU and TODA portals: sign in with exactly what was typed, administrator profile only from the signed-in account's own row, no cached "session", no demo mode, TODA registration in the order of D-SEC-7, documents re-signed on open, outcome messages through the new routes.

**Scripts**: `scripts/applyPerimeterLockdown.js` (preflight, dryrun, apply per stage, selftest), `scripts/verifyPerimeter.js` (anonymous black-box check), `scripts/relinkDriverLogin.js` (repairs one driver's login e-mail), `scripts/todaAdminLogin.js` (gives a TODA an administrator login, or resets the password of the one it has). The last two were written by a parallel session.

### 8.4 Rollout and operator checklist

The new apps call functions that exist only after S1, and S2 - S4 switch off doors the old apps use, so the order matters.

1. `node scripts/applyPerimeterLockdown.js preflight`: read-only. Shows the exposures today, the drivers and passengers the new apps cannot find by phone, drift between the live database and the repo, and writes a snapshot and an emergency `rollback_S2_S3_S4.sql` to a temp folder (the path is printed).
2. Repair the logins you still need: `node scripts/relinkDriverLogin.js 09123456789` (preview), then add `--apply`. A passenger that matters registers again. A TODA that has no administrator login, or whose administrator forgot the password (there is no recovery inside the app), is handled by `node scripts/todaAdminLogin.js <ACRONYM>` (preview); with `--apply` it asks for the password on the screen (hidden, typed twice) and creates the login `<acronym>@toda.sakay.internal` or resets the existing one, all in one transaction, and it refuses a password that was written in the old code. The old apps keep working until you deploy the new ones.
3. `node scripts/applyPerimeterLockdown.js dryrun all`: every stage and its verification inside a transaction that is rolled back.
4. `node scripts/applyPerimeterLockdown.js apply S0`: the hot-fix; safe with the old apps.
5. `node scripts/applyPerimeterLockdown.js apply S1`: additive.
6. Render (server): set `SCHEDULER_SECRET` (16+ random characters; the cron caller sends it in the `X-Scheduler-Secret` header) and `CORS_ORIGIN` (the four app origins, comma separated; the Passenger and Driver apps too, even when they reach the server through a forwarding rule, because browsers send the Origin header on a POST); check `SUPABASE_SERVICE_ROLE_KEY` is set (a server on the anon key can read nothing once S3 is applied); keep `NODE_ENV=production`; deploy.
7. Deploy the four apps (new builds). The LGU and TODA portals read the server address from `VITE_API_URL` (the server's URL ending in `/api`; the default is `http://localhost:5000/api`). The Passenger and Driver apps call `/api/...` on their own address: `npm run dev` forwards it to `localhost:5000`, and wherever they are hosted that host must forward `/api/*` to the server (nothing in the repo does this). The apps no longer accept a fixed code, so sending a text message needs the server to be reachable that way.
8. Manual checks (8.4.1).
9. `node scripts/applyPerimeterLockdown.js apply S2 --apps-deployed`, then `apply S3 --apps-deployed`, then `apply S4 --apps-deployed`. Each runs its migration, its verification and the history row in one transaction and re-checks from a new connection.
10. `node scripts/verifyPerimeter.js --server https://<your server>`: every line must be `ok`.
11. Dashboard (D-SEC-14): turn the phone provider (Twilio) off; set the auth rate limits; keep sign-ups open; **do not enable CAPTCHA until the apps send captcha tokens**. Also look at the passwords that used to be written in the code: `admin@gmail.com` (`admin123`, committed and shipped inside the Driver app bundle) and `cctoda`, `bltoda`, `svtoda`, `lptoda` `@toda.sakay.internal` (`Password123!`). A read-only look at the live project on 2026-10-04 (not repeated by the session that built this batch) found none of these five accounts: the only account on `@toda.sakay.internal` is a TODA administrator who registered through the portal and chose their own password. So nothing needs rotating today, but treat the five passwords as public: never create an account with them, and know that running an old copy of `seed.sql` against another database creates the four TODA accounts again. The code cannot tell whether that one registered administrator happens to use `Password123!`; ask them, or reset it. Nothing in the code can do the dashboard settings or the reset for you.
12. Emergency only: the generated `rollback_S2_S3_S4.sql` puts policies, table privileges, function grants and bucket flags back as the snapshot recorded them (it re-opens every door; fix forward afterwards). S0 and S1 are never rolled back.

If you ever meet a file `supabase/scripts/applyPerimeterLockdown.js.js` (double extension; one lay in the working tree while this batch was built, was not part of it and has since been removed), do **not** run it: it applies all five migrations at once, has no S0-first stage, and its "dry run" rolls each migration back before the next one runs, so S2 would fail on the missing S1 functions.

**8.4.1 What to try by hand once S1 is applied and the new apps are deployed**

| App | Try |
|---|---|
| Passenger | Register, receive the SMS code, sign in; wrong code is refused; book a trip; during the trip the driver's name, vehicle and position show; after the trip the driver's number is gone; change the profile photo and reload (the picture comes back); "Forgot password" shows the help screen. |
| Driver | Register (the TODA list fills), SMS code, upload the documents, status page shows the application; sign in; the TODA picker shows each TODA with its status; go Online; an offer shows the passenger's name (no number); on the trip the number and the message button work; messaging outside a trip is refused. |
| TODA portal | Register a TODA (three files; a file is only uploaded at "Submit"); sign in by acronym or e-mail; the profile and documents open; applicants' photos open; endorse / return / reject sends the SMS; incidents and trips show the passenger's name and number. |
| LGU portal | Sign in (a TODA or passenger account is refused with a clear message); TODA applications: documents open, approve / return / reject; driver verification: approve / reject / return sends the SMS; the TODA registration form works without any code step. |

### 8.5 Interpretations, residual risks and things to confirm

- **Password recovery is off** for passengers and drivers (a safe reset needs a server-checked code tied to the account: the OTP redesign). The Driver "new password" screen never changed a password; it is unreachable now. Recovery is by LGU / TODA staff.
- **TODA registration does not verify the contact number** (the old step accepted any 6 digits, and called Supabase phone sign-in, which creates users). The LGU confirms the number during review. A real check for registrants is future work.
- **OTP store and limiters live in the server's memory** (one instance; a restart loses issued codes, the user asks again). Several instances would need a shared store.
- **A driver can aim a code at any number** by first saving it on their own record; bounded by the 30 s cooldown, 5 a day per number and 3 per 10 minutes per account, but it still costs SMS credit.
- **`find_candidate_drivers`** returns rounded distances; repeated calls can narrow a driver's position. It exists only for the passenger's own open booking, and Batch 6 replaces it with server-side dispatch.
- **A passenger can mark an offer unanswered** (the passenger app records dispatch timeouts through `dispatch_attempt`); the classification trigger limits what that counts as, but the passenger-driven dispatch remains until Batch 6.
- **Realtime broadcast channels** (`passenger_trip_<booking id>`, driver position) are still public broadcast channels (D-SEC-13).
- **Legacy driver resubmission.** The Driver app's final-submission code still tries to set the driver's own verification status (to Approved after a return) when an application is resubmitted. The database refuses a driver changing that column; the documents and their paths are saved, the status change is not. This did not work before either (until S1, every update of a driver's own verification row failed). The supported route is `resubmit_driver_application` (screen deferred in Batch 3).
- **Bugs found and left alone** (not security): the incident submit payload does not match the table, and the server's SLA scheduler calls a function that does not exist (`check_toda_incident_threshold`; the real one is `check_toda_excess_incidents`, which S2 leaves callable by the service role only).
- **Demo data left in place**: sample license / permit values shown by `DriverConfirmAllInfo` when nothing was scanned, the placeholder support hotline numbers, and `mockData` files that no screen reads.
- **Existing rows**: nothing was deleted or changed. Test accounts such as the driver "Juan" keep working in the old apps and need `relinkDriverLogin.js` for the new Driver app. A TODA with no administrator login (the old portal's development shortcut opened a fake demo session for such an acronym with any password; it is gone) gets one from `todaAdminLogin.js`; it creates the login with a direct insert into `auth.users`, the way the test driver's login was made, and only the hosted project can show that Supabase Auth accepts it (the emulator has no Auth service).
- **Hand-made live objects**: the `profiles` bucket is not in any migration; S4 makes it private. Hand-made policies that name anon / public are dropped by S3 / S4; other hand-made policies are listed by the preflight.
- **Sign-ups stay open** on purpose (passengers and drivers register themselves); that is why every rule above starts from "a signed-in stranger".

### 8.6 Verification

- **Emulator regression:** `node scripts/db-tests/run-all.js`: **27 suites, 978 checks, 0 failed** (the 26 suites of the full run, 929 checks, plus `security/perimeter-toda-admin-login.js`, 49 checks, which passed on its own afterwards). New in this batch: `security/perimeter-s0-signup.js` (22), `perimeter-s1-expand.js` (79), `perimeter-lockdown.js` (96), `perimeter-apply-script.js` (16), `perimeter-verify-script.js` (14), `perimeter-relink-login.js` (52), `perimeter-toda-admin-login.js` (49). Older suites were touched only where the scoped policies turn an application error into "no row" / "permission denied" (`batch5/booking-guards.js`, `security/null-safe-service-context.js`) and where the seed no longer creates login accounts (`batch1/existing-data.js`).
- **Sensitivity:** with S2 - S4 removed from the chain, `perimeter-lockdown.js` fails 48 checks, so the suite can tell an open database from a locked one.
- **Server:** `cd server && npx tsc --noEmit && npx tsx --test test/*.test.ts`: **119 tests, 0 failed** (default deny, role gates, body limits, CORS and headers, scheduler secret, OTP, SMS, the two outcome-message routes, rate limits).
- **Builds:** `npm run build:all` builds the passenger, driver, TODA and LGU apps and the server.
- **Operator scripts, rehearsed on a local database:** `selftest` applies S0 - S4, runs each stage's verification, then runs the generated emergency rollback and compares the perimeter with the snapshot (97 policies, 358 table privileges and every function grant come back exactly; S0 stays in place); `preflight` and `dryrun all` were rehearsed the same way; `verifyPerimeter.js` was run against a stand-in server that answers like the open and like the locked-down project; `relinkDriverLogin.js` and `todaAdminLogin.js` were rehearsed on a local database before and after the lockdown (made-up drivers and TODAs).
- **Browser smoke checks** with the dev servers (no account used, nothing written): the Driver help screen and login, the LGU login and TODA registration form, and the TODA registration page attaching a file without any request reaching Supabase.
- **Not done, on purpose:** nothing in this batch was applied to, or written on, the hosted project by the build session. The apps' real flows against the hosted project (SMS, sign-in, uploads) can only be exercised after S1, and then S2 - S4, are applied; no real SMS was sent; the apps have no automated UI tests.


---

## 9. Policy alignment: strike lengths and exemption window (2026-10-06)

**Decision (project owner: "apply the most appropriate"; applied by following the SAKAY Policy document, which is the root reference of the system).**

| Figure | Before (testing override) | Now (policy document) | Rule |
|---|---|---|---|
| Suspension at 5 strikes | 3 days (F3.3) | **7 days** | Sections 20 and 21 |
| Suspension at 8 strikes | 7 days (F3.3) | **30 days** | Sections 20 and 21 |
| Exemption request window | 72 hours (D1 / F3.4) | **48 hours** | Rule 25.1 |
| Provisional-strike waiver window (connectivity) | 72 hours (F3.7) | **48 hours** | Rule 9.4 (same constant) |

- **Why:** the document is what the panel reads and what the Driver Terms of Service already promise (7-Day and 30-Day rows). The overrides were testing-friendly values, not a policy position. I did not look up the exact numbers of Grab, Angkas or similar apps (no source was consulted); the pattern itself, a short first suspension, a longer second one, then permanent deactivation, with a short fixed appeal window, is the usual shape of graduated penalty schemes. The deciding factor is consistency with the policy document.
- **Where:** migration `supabase/migrations/20261011000001_align_strike_values_to_policy.sql` (replaces `strike_policy_constant()`), mirrored in `packages/shared/src/config/policyConfig.ts` (`STRIKE_LADDER`, `EXEMPTION_REQUEST_WINDOW_HOURS`). Screens that show these numbers (Driver Support FAQ, restriction labels, the strike notice text) read them from there, so they changed with it.
- **Effect on existing data:** none. Strikes already issued keep the suspension end date and the exemption deadline they were given. Only strikes issued after the migration is applied use the new values.
- **Tests:** the Batch 3 suites `foundation`, `engine`, `exemptions` and `guards` now run on the whole migration chain and assert 7 / 30 days and 47 h accepted / 49 h refused. `foundation.js` also checks that `policyConfig.ts` equals the database for the ladder and the window, so the two cannot drift apart again.
- **To apply on the hosted project:** run the migration the same way the others were applied (for example `npx supabase db push`). Until then the hosted database still enforces 3 / 7 days and 72 hours while the screens show 7 / 30 days and 48 hours.


---

## 10. Day 1 (2026-10-06): checklist items built before the defense

Built to raise the checklist score (`docs/checklist-accomplishment.md`); none of these are rules of the policy document, so they are recorded here.

| Ref | Decision | Where it lives |
|---|---|---|
| **D-D1-1** | **An incident report is always about a trip.** The table already required a booking; the Passenger screen now asks which completed trip. The driver, the driver's TODA, the reporter's role, the starting status (`Pending`) and the time come from the booking and the signed-in user inside the database, never from the request, so a report cannot be pointed at another driver or created already Resolved. The facts of a report (who, which trip, category, text, photos) cannot be edited afterwards by anyone; an administrator changes only the review fields and is stamped as the reviewer. | `incident_report_guard()`, migration `20261012000001` |
| **D-D1-2** | A passenger can **withdraw** a report only while it is `Pending`, with a reason (`Cancelled`). The LGU and TODA portals show a withdrawn report as Dismissed with the reason. | same |
| **D-D1-3** | **Evidence photos:** at most 3 files per report (database), images only, 5 MB each (screen), in the private bucket `incident-evidence` under the reporter's own folder. The reporter, the LGU and the TODA administrator of the reported driver can open them (signed links, 10 minutes). | `evidence_paths`, `storage_can_read_incident_evidence()`, `packages/shared/src/utils/incidentEvidence.ts` |
| **D-D1-4** | **Descriptive analytics are computed, never typed in.** Hotspots = pickup coordinates grouped into areas of about 550 m (top 8). Barangay demand = the Calapan barangay named in the pickup address (a booking stores no barangay; an address naming none is "Not identified"). Driver utilization = verified drivers with a completed trip in the last 30 days. TODA "compliance" is replaced by the **completion rate of its finished trips**. Dates and hours are read in Asia/Manila. | `packages/shared/src/utils/transportAnalytics.ts` (15 tests in `server/test/analytics.test.ts`) |
| **D-D1-5** | **Pause bookings:** an Online driver can pause new offers for 5 to 60 minutes (the app offers 15, 30, 60; default 15). It ends by itself, is cleared by going Offline or Online, and does not touch an accepted booking or the inactivity counters. Dispatch skips a paused driver in `find_candidate_drivers()`, and the database refuses to insert an offer for one. | migration `20261012000002`, `driver_presence_constant()`, `PauseBookingsControl.tsx` |

**For Batch 6 (dispatch rewrite):** the new dispatcher must keep excluding a driver whose `bookings_paused_until` is in the future (D-D1-5).
**For Batch 11:** a report can currently be filed for any booking that had a driver (the fare-dispute dialog files one before the trip is marked Completed); the screen's trip picker lists completed trips only. Emergency reports during a trip are Batch 11's.
**Not changed:** `fetchTodaIncidents` and `fetchIncidents` still read every row the account may see and filter in the app; the row policies already scope them.


---

## 11. Day 2 (2026-10-06): TODA reports, reminders, documents, driver photo

Built to raise the checklist score (`docs/checklist-accomplishment.md`: TODA 58, 61, 63, 64, 65, 66, 68; LGU 11; Passenger 85). None of these are rules of the policy document, so they are recorded here.

| Ref | Decision | Where it lives |
|---|---|---|
| **D-D2-1** | **TODA reports are computed from the TODA's own bookings**, in the same shared functions as the LGU analytics. Booking volume is grouped by day, week (Monday start) or month in Asia/Manila; "estimated gross fare" is the sum of the fare of completed trips (the final fare once it exists, otherwise the estimate). Driver activity counts completed and cancelled trips, distance and the latest completed trip per member, and marks a driver **Active** when they completed a trip in the last days shown on the screen. Every report can be exported to CSV and the export is written to the audit log. | `transportAnalytics.ts` (`volumeByPeriod`, `driverActivity`), `BookingVolumeReport.tsx`, `DriverActivityReport.tsx`, `csvDownload.ts` |
| **D-D2-2** | **"Active drivers" means Online right now.** The Operations page shows Online, On a trip, Paused and Offline from the presence state; account status alone no longer counts as active. | `TodaOperationsPage.tsx` |
| **D-D2-3** | **A reminder is sent by one database function, never by a direct write.** A TODA administrator cannot write a driver's notification (and must never reach another TODA's drivers), so `send_toda_driver_reminder(audience, title, message)` is the only way. Recipients are drivers whose membership of the sender's own TODA is endorsed and approved and whose account is Verified. Audiences: all of them, or only those whose Driver's License or MTOP is expired or ends within 30 days (the 30 days follow the renewal rule, 24.1 and 24.4). Title 1 to 80 and message 1 to 500 characters; a second send within 30 seconds is refused (a double tap); every send is audited with the audience and the count. | migration `20261013000001`, `SendReminderDialog.tsx` |
| **D-D2-4** | **The Driver app shows only real notices.** The built-in sample notifications ("Welcome to SAKAY Driver", a made-up TODA notice) are removed, and announcements are limited to the driver's own TODAs (or ones that name no TODA). A reminder appears under the same Abiso list. | `DriverNotifications.tsx`, `driverApiService.ts` |
| **D-D2-5** | **The LGU's TODA detail screen lists the files the TODA really uploaded** (Barangay Clearance, driver list, bylaws) using the same helper as the application review; a TODA with none says so. | `todaDocumentsOf` in `adminApiService.ts` |
| **D-D2-6** | **The assigned driver's photo reaches only the passenger of a live trip.** `get_assigned_driver_photo(booking)` returns the photo's storage path to the booking's own passenger while the trip is live (the same moment the storage rule lets them open it) and nothing otherwise; the app signs a short link. The trip screen also shows the driver's real rating (hidden when there is none) instead of a fixed 4.9. | migration `20261013000002`, `TripMonitoring.tsx` |
| **D-D2-7** | **The TODA registration form asks for the TODA's registration number** (3 to 50 characters: letters, digits, hyphen, slash; upper-cased). Until now the acronym was stored in its place. The number is unique across TODAs (it already was in the database); a duplicate is refused with a clear message. The profile page shows the real number. | `TodaRegistrationPage.tsx`, `registerToda` |
| **D-D2-8** | **A TODA administrator can correct a master-roster entry, but an edit cannot rewrite history.** The roster match (Rule 2.4) counts an entry only if it existed before the application was submitted. Editing the franchise or plate number of an old entry would have let an administrator make an earlier application look "found on the roster", so the database now records when an entry's franchise / plate last changed and the match counts the entry only from then (`identifiers_changed_at`). A name-only correction changes nothing about matching. The franchise number stays required, two entries of one TODA cannot share one, an entry cannot be moved to another TODA, and every change is audited with before and after. | migration `20261014000001`, `update_toda_roster_entry`, `affiliation_roster_matched` |
| **D-D2-9** | **The LGU passenger list shows real figures.** "Bookings" is the number of the passenger's bookings; the rating is the average of the stars drivers gave the passenger after trips (`rating` rows with the Driver as rater) with the latest comments; a passenger no driver has rated is "Not Yet Rated", not 5.0. | `fetchPassengers`, `PassengerManagementPage.tsx` |

**Not changed:** a TODA suspending a driver directly (checklist 55: it recommends to the LGU, who decides) and the OTP items (46, 75) are left for after the defense.
