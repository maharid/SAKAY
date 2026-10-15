/**
 * SAKAY CENTRAL POLICY CONFIGURATION
 * Canonical single source of truth for operational constants and business rules.
 *
 * Rules:
 * 1. Every policy number (distances, seconds, minutes, thresholds, counts, windows, fare values)
 *    must live in this canonical module or be database-backed.
 * 2. Only values that already exist scattered in code and map directly to an authoritative
 *    policy rule are included in Batch 0.
 * 3. Later batches will import from this central module.
 */

// ============================================================================
// 1. FARE MATRIX & TARIFF CONFIGURATION (Rules 6.1, 6.1.1, 14.1 - City Ordinance No. 110, s. 2022)
// ============================================================================
// The authoritative rate lives in the database table public.fare_matrix (Rule 6.3: LGU Administrator only,
// effective timestamp, audited) and is applied by public.calculate_fare(). DEFAULT_TARIFF below is only the
// mirror of the SEEDED ordinance row, kept for documentation and for the drift test
// (scripts/db-tests/batch5/config-drift.js); no app computes a fare from it.

export interface TariffConfig {
  /** Base fare covering the first baseDistanceKm (Rule 6.1) */
  baseFare: number;
  /** Included base distance in kilometers (Rule 6.1) */
  baseDistanceKm: number;
  /** Rate per succeeding kilometer beyond base distance (Rule 6.1) */
  succeedingRate: number;
  /** Standard motorized tricycle seating capacity (Rules 6.1.1, 14.1) */
  capacity: number;
}

/**
 * Seeded Municipal Tariff Matrix for Calapan City Tricycle Services
 * Source: City Ordinance No. 110, Series of 2022
 */
export const DEFAULT_TARIFF: TariffConfig = {
  baseFare: 15.0,        // ₱15.00 base seat fare (Rule 6.1)
  baseDistanceKm: 2.0,   // First 2.0 km inclusive (Rule 6.1)
  succeedingRate: 1.0,   // ₱1.00 per succeeding km (Rule 6.1)
  capacity: 4,           // 4 passenger seats / Solo multiplier (Rules 6.1.1, 14.1)
};

// ============================================================================
// 2. DISPATCH & OFFER TIMERS (Rule 7.3)
// ============================================================================

/**
 * Driver booking offer response window in seconds.
 * A driver offered a sequential booking has exactly 15 seconds to accept before timeout.
 * (Rule 7.3)
 */
export const DRIVER_OFFER_TIMEOUT_SECONDS = 15;
export const DRIVER_OFFER_TIMEOUT_MS = DRIVER_OFFER_TIMEOUT_SECONDS * 1000;

/**
 * The phone needs a moment to receive an offer. The offer stays open this much longer than the window so the driver still gets the whole
 * window (the screen shows at most DRIVER_OFFER_TIMEOUT_SECONDS). [DB] dispatch_constant('offer_grace_seconds')
 */
export const DISPATCH_OFFER_GRACE_SECONDS = 5;

// The search for a driver runs in the DATABASE (Batch 6): offers, deadlines, tiers, ranking and the end of the search are decided there, and
// the apps only show them. The numbers below are MIRRORS of dispatch_constant() (supabase/migrations/20261015000001_*), kept for display and
// for the drift test (scripts/db-tests/batch6/config-drift.js), which fails if either side changes alone. Change both together.
// (Intelligent Driver Dispatch specification, sections 4 - 8 and 21; decision PI-12 = A.)
//   Tier 1  the Priority TODA (the accredited TODA whose terminal is nearest the pickup), drivers inside this radius
//   Tier 2  any accredited TODA, drivers inside this radius
//   Tier 3  live search: the radius grows, the pool is looked at again at every refresh, until the maximum duration
// Offers go to one driver at a time, nearest ETA first; a driver offered the booking in this search cycle is not offered it again.

/** Tier 1: Priority TODA geofence around the pickup, in km (600 m) [DB tier1_radius_m] */
export const DISPATCH_TIER1_RADIUS_KM = 0.6;

/** Tier 2: any accredited TODA within this radius of the pickup, in km [DB tier2_radius_m] */
export const DISPATCH_TIER2_RADIUS_KM = 2;

/** Tier 3: radius (km) that applies from this many seconds after Tier 3 began (spec: 0:00 2.0 km, 1:30 2.5 km, 3:00 3.0 km, 4:30 3.5 km) [DB dispatch_tier3_radius_m()] */
export const DISPATCH_TIER3_RADIUS_STEPS = [
  { fromSecond: 0, radiusKm: 2.0 },
  { fromSecond: 90, radiusKm: 2.5 },
  { fromSecond: 180, radiusKm: 3.0 },
  { fromSecond: 270, radiusKm: 3.5 },
] as const;

/** Tier 3: how often the pool of eligible drivers is looked at again, so a driver who comes online later can still be offered the booking [DB tier3_refresh_seconds] */
export const DISPATCH_TIER3_REFRESH_SECONDS = 30;

/**
 * Tier 3 maximum duration: with nobody accepting by then, the booking becomes No Driver Found and the passenger may Retry or Cancel. [DB tier3_max_seconds]
 * Figure F6.5: 10 minutes, as Appendix B and the specification (Section 30, criterion 8) say (decision D-2, 2026-10-11; the pilot default was 300 s
 * before). An LGU administrator can change it at run time (dispatch_setting, 60 to 1800 s); this constant is only the DEFAULT the database falls
 * back to (dispatch_setting_default) and the drift test checks. The worst case a passenger waits is about 20 s x (offers made in Tiers 1 and 2)
 * + this + 20 s, NOT "10:30" (docs/policy-decisions.md section 12.1).
 */
export const DISPATCH_TIER3_MAX_SECONDS = 600;

/** Rule 12.8: this many accepted drivers in a row failing the same booking ends the dispatch cycle [DB accepted_cancel_limit] */
export const DISPATCH_ACCEPTED_CANCEL_LIMIT = 3;

/** The estimated arrival of an offer: straight-line distance x this winding percent, at this speed. An ESTIMATE, labelled as such (see policy-decisions section 13). [DB eta_winding_percent, eta_speed_kmh] */
export const DISPATCH_ETA_WINDING_PERCENT = 130;
export const DISPATCH_ETA_SPEED_KMH = 20;

/** Rule 12.1: a passenger who cancels within this many seconds after the driver accepted (and before the driver arrived) is not struck [DB passenger_cancel_grace_seconds] */
export const PASSENGER_CANCEL_GRACE_SECONDS = 60;

/** Rules 12.3 / 12.4: progress toward the pickup (metres) that makes a driver's cancellation "en route" [DB driver_travel_threshold_m] */
export const DRIVER_CANCEL_TRAVEL_THRESHOLD_METERS = 50;

/** Rule 16.6: how long the passenger has to confirm the fare at the destination before the driver may end the trip [DB completion_confirm_timeout_seconds] */
export const COMPLETION_CONFIRM_TIMEOUT_SECONDS = 120;

/**
 * Trip progress while the passenger is on board (a straight-line estimate toward the destination pin, see utils/tripProgress.ts). The driver
 * may finish the trip once it reaches this percent: the destination pin can sit inside an establishment the tricycle cannot enter, so waiting
 * for the last few metres kept a trip stuck at 95% [DB trip_finish_min_progress_pct]
 */
export const TRIP_FINISH_MIN_PROGRESS_PERCENT = 90;
/** Within this many metres of the destination pin the progress reads its maximum [DB trip_progress_near_destination_m] */
export const TRIP_PROGRESS_NEAR_DESTINATION_METERS = 80;
/** While the trip is in progress the progress never reads more than this; 100% is only for a trip that has arrived [DB trip_progress_cap_pct] */
export const TRIP_PROGRESS_CAP_PERCENT = 95;
/** ...and never less than this once the passenger is on board [DB trip_progress_floor_pct] */
export const TRIP_PROGRESS_FLOOR_PERCENT = 5;

// Batch 9 (20261024000001): the end of the trip. completion_confirm_timeout_seconds above is ONE timer for the passenger's Confirm Fare / Report Fare
// Discrepancy (Rules 16.6 / 18.2, PI-08 + PI-13 merged: figures F9.1 = F9.2); after it the driver may tap Payment Received ("Paid - fare unconfirmed", no strike).

/** Figure F9.5: the TODA Administrator decides a fare dispute within this many business days (shown as overdue, never resolved by itself) [DB fare_dispute_toda_business_days] */
export const FARE_DISPUTE_TODA_BUSINESS_DAYS = 2;
/** Figure F9.5: ... and the LGU Administrator within this many business days of an escalation [DB fare_dispute_lgu_business_days] */
export const FARE_DISPUTE_LGU_BUSINESS_DAYS = 3;
/** Rule 16.6 / PI-20: a fare finished without the passenger's confirmation can still be reported for this many hours [DB late_dispute_window_hours] */
export const LATE_FARE_DISPUTE_WINDOW_HOURS = 24;
/** Rule 13.6 / D9-9: early ends of one kind (personal, or Safety Concern) in the window that raise a review flag (no strike) [DB early_end_flag_count, early_end_flag_window_days] */
export const EARLY_END_FLAG_COUNT = 3;
export const EARLY_END_FLAG_WINDOW_DAYS = 30;
/** PI-15: a trip left at the destination without Payment Received this long is flagged for the TODA Administrator [DB payment_stuck_minutes] */
export const PAYMENT_STUCK_MINUTES = 30;
/** Rule 18.7: complaints of refused change that raise a TODA review flag; the policy says "repeated", so this is a pilot figure [DB change_refusal_flag_count, change_refusal_window_days] */
export const CHANGE_REFUSAL_FLAG_COUNT = 3;
export const CHANGE_REFUSAL_WINDOW_DAYS = 30;

/** Rules 12.7 / 12.9: cancellations in the window that raise a review flag (no strike) [DB repeat_cancel_flag_count, repeat_cancel_window_hours] */
export const REPEAT_CANCEL_FLAG_COUNT = 3;
export const REPEAT_CANCEL_WINDOW_HOURS = 24;

/** Rule 7.9: explicit declines in the window that raise a review flag for the TODA administrator (no strike) [DB decline_flag_count, decline_flag_window_hours] */
export const DISPATCH_DECLINE_FLAG_COUNT = 5;
export const DISPATCH_DECLINE_FLAG_WINDOW_HOURS = 24;
/** Rule 7.9: how many days back the TODA administrator's decline history reads by default (get_driver_decline_history) [DB decline_history_days] */
export const DISPATCH_DECLINE_HISTORY_DAYS = 30;

/** Decision D-4: a No Driver Found booking that ended longer ago than this cannot be retried (the pickup is probably not where the passenger is any more) [DB retry_max_age_minutes] */
export const DISPATCH_RETRY_MAX_AGE_MINUTES = 60;

/**
 * Rule 7.10 / PI-11 = A, figure F6.9: this many bookings of one zone (the barangay of the Priority TODA) reaching Tier 3 or ending as No Driver
 * Found within this many hours are logged as a Coverage Gap Indicator: analysis only, no penalty, no change to ranking, fares or service zones.
 * [DB coverage_gap_count, coverage_gap_window_hours]
 */
export const COVERAGE_GAP_COUNT = 5;
export const COVERAGE_GAP_WINDOW_HOURS = 24;

// ETA from the routing engine (Rule 7.2.2, decision D-1, figure F6.10). The database asks OSRM through the `http` extension when it is
// installed, and otherwise uses the straight-line estimate labelled as such (eta_source). These mirror dispatch_constant() / _osrm_base_url().
/** The routing servers, in the order they are tried (a failed request is retried once on the second) [DB _osrm_base_url]. The apps' road distance uses the same two. */
export const OSRM_BASE_URLS = ['https://router.project-osrm.org', 'https://routing.openstreetmap.de/routed-car'] as const;
/** One request may take this long [DB osrm_timeout_ms] */
export const OSRM_TIMEOUT_MS = 2000;
/** An ETA is reused this long [DB osrm_cache_seconds] */
export const OSRM_CACHE_SECONDS = 15;
/** This many failed rankings in a row open the circuit breaker, which keeps the routing engine out of the way for OSRM_BREAKER_SECONDS [DB osrm_failure_limit, osrm_breaker_seconds] */
export const OSRM_FAILURE_LIMIT = 3;
export const OSRM_BREAKER_SECONDS = 60;
/** The nearest candidates (straight line) of a tier that one request ranks [DB osrm_max_candidates] */
export const OSRM_MAX_CANDIDATES = 15;

/** Rules 8.2 / 8.3: no movement toward the pickup this long after accepting: a warning, then cancelled on the driver's behalf [DB stall_warn_seconds, stall_cancel_seconds] */
export const DRIVER_STALL_WARN_SECONDS = 120;
export const DRIVER_STALL_CANCEL_SECONDS = 180;
/** Rules 8.2 / 8.3: less movement than this (metres, after the GPS error) counts as not moving [DB stall_min_movement_m] */
export const DRIVER_STALL_MIN_MOVEMENT_METERS = 20;
/** Rule 8.4: standing still this long on the way (approach phase), without a reported delay, is a stall [DB stall_en_route_seconds] */
export const DRIVER_STALL_EN_ROUTE_SECONDS = 300;
/** Rule 8.4 (decision D7-7): the driver who stands still on the way is warned this long into the stand-still, with the Rule 8.2 text [DB stall_en_route_warn_seconds] */
export const DRIVER_STALL_EN_ROUTE_WARN_SECONDS = 240;

/** Rules 9.2 / 9.3: no location from an accepted driver this long: Driver Unreachable; then (before arriving) cancelled with a provisional strike [DB unreachable_warn_seconds, unreachable_cancel_seconds] */
export const DRIVER_UNREACHABLE_WARN_SECONDS = 180;
export const DRIVER_UNREACHABLE_CANCEL_SECONDS = 300;
/** Rule 9.5: a trip silent this long goes to the TODA administrator for manual reconciliation (it is never auto-cancelled) [DB ongoing_reconcile_seconds] */
export const TRIP_RECONCILE_SECONDS = 1800;

/** Rules 10.1 / 10.3: the passenger has this long after the driver arrived, and may add the extension once [DB no_show_wait_seconds, no_show_extension_seconds] */
export const NO_SHOW_WAIT_SECONDS = 300;
export const NO_SHOW_EXTENSION_SECONDS = 120;
/**
 * PI-06 / D8-ZONE (figure F8.3): ONE pickup zone for Rules 8.5, 10.1 and the Arrived tap. The driver is "at the pickup" when his newest fix (no older than
 * location_max_age_seconds, 45 s) is within this many metres of it by plain distance (the fix's own error earns no credit); a fix less accurate than the cap
 * is ignored, never guessed at [DB no_show_radius_m, zone_max_accuracy_m]
 */
export const PICKUP_ZONE_RADIUS_METERS = 25;
export const PICKUP_ZONE_MAX_ACCURACY_METERS = 30;
/**
 * Rule 10.2 (D8-X1): the driver may be this many metres beyond the zone, and may be outside it for this many seconds, without pausing the passenger's wait.
 * Beyond either, the time does not count toward the wait [DB arrival_zone_tolerance_m, arrival_zone_tolerance_seconds]
 */
export const PICKUP_ZONE_TOLERANCE_METERS = 5;
export const PICKUP_ZONE_TOLERANCE_SECONDS = 15;

/** Rule 8.4: what a driver may report to explain standing still on the way (the database accepts exactly these) */
export const DRIVER_DELAY_REASONS = ['traffic', 'road_closure', 'police_checkpoint'] as const;
export type DriverDelayReason = (typeof DRIVER_DELAY_REASONS)[number];

/** Rule 9.5: what the driver may say about an interrupted trip when he is connected again (the database accepts exactly these) */
export const TRIP_RECONFIRM_STATUSES = ['ongoing', 'ended'] as const;
export type TripReconfirmStatus = (typeof TRIP_RECONFIRM_STATUSES)[number];

/** Rule 25.3: the grounds on which a strike may be appealed (the database accepts exactly these) */
export const EXEMPTION_CAUSE_CODES = ['FORCE_MAJEURE', 'VEHICLE_BREAKDOWN', 'NETWORK_OUTAGE', 'MEDICAL_EMERGENCY', 'ACCIDENT_DOCUMENTED', 'DEVICE_FAILURE', 'OTHER'] as const;
export type ExemptionCauseCode = (typeof EXEMPTION_CAUSE_CODES)[number];

/** Rule 7.9: why a driver may decline an offer (the database accepts exactly these) */
export const DISPATCH_DECLINE_REASONS = ['vehicle_issue', 'personal_emergency', 'safety_concern', 'end_of_shift', 'other'] as const;
export type DispatchDeclineReason = (typeof DISPATCH_DECLINE_REASONS)[number];

/** Rules 12.3 / 12.4 / 15.1 / 29.13 / 29.14: why a driver may cancel an accepted booking (the database accepts exactly these) */
export const DRIVER_CANCEL_REASONS = [
  'vehicle_breakdown',
  'personal_emergency',
  'passenger_unreachable',
  'wrong_pickup_location',
  'safety_concern',
  'road_closure_or_traffic',
  'accident',
  'unsafe_or_illegal_request',
  'prohibited_item',
  'other',
] as const;
export type DriverCancelReason = (typeof DRIVER_CANCEL_REASONS)[number];
/**
 * Decision PI-11B: these reasons are NOT struck. The cancellation is recorded as an event with no points, the driver's TODA Administrator verifies it, and a
 * pattern (3 in 30 days) is flagged. The others (passenger_unreachable, wrong_pickup_location, other) still strike. [DB _safe_reason_exempt()]
 */
export const DRIVER_CANCEL_SAFE_REASONS = [
  'vehicle_breakdown',
  'personal_emergency',
  'safety_concern',
  'road_closure_or_traffic',
  'accident',
  'unsafe_or_illegal_request',
  'prohibited_item',
] as const;

// ============================================================================
// 3. TELEMETRY & GPS MONITORING INTERVALS (Rule 17.1)
// ============================================================================

/**
 * Driver near real-time GPS location refresh interval in seconds during active/assigned trip.
 * (Rule 17.1)
 */
export const ACTIVE_TRIP_GPS_INTERVAL_SECONDS = 5;
export const ACTIVE_TRIP_GPS_INTERVAL_MS = ACTIVE_TRIP_GPS_INTERVAL_SECONDS * 1000;

/**
 * Rule 17.9: the passenger's map shows the time of the last driver position whenever that position is more than this many seconds old
 * (counted by the SERVER's clock: get_driver_live_status().age_seconds). Display only; not a database rule.
 */
export const PASSENGER_STALE_LOCATION_INDICATOR_SECONDS = 10;
/**
 * Rule 17.4: this many calls to the server in a row that fail at the network level (or the browser saying it is offline) mean the connection is lost, and
 * both apps show "Connection lost — reconnecting...". Display only; not a database rule.
 */
export const CONNECTION_LOST_AFTER_FAILED_CALLS = 2;
/** Rule 17.9: a marker whose position is older than this many seconds is drawn dimmed (display only) */
export const PASSENGER_STALE_LOCATION_DIM_SECONDS = 30;

// ============================================================================
// 4. AUTHENTICATION & SECURITY TIMERS (Rule 4.6)
// ============================================================================

/**
 * Passenger SMS OTP validity time-to-live (TTL).
 * (Rule 4.6)
 */
export const OTP_EXPIRATION_MINUTES = 5;
export const OTP_EXPIRATION_MS = OTP_EXPIRATION_MINUTES * 60 * 1000;

// ============================================================================
// 5. ONBOARDING, ACCREDITATION & SLA TIMERS (Batch 1 - Rules 2.5, 3.5, 3.7, 24.4)
// ============================================================================

/** Driver application combined review deadline in calendar days (Rule 3.5) */
export const DRIVER_APPLICATION_REVIEW_DEADLINE_DAYS = 5;

/** Reviewer reminder threshold in calendar days (Rule 3.7) */
export const DRIVER_APPLICATION_STAGE_REMINDER_DAYS = 3;

/** Upheld incident reports threshold triggering supervisory review (Rule 2.5) */
export const TODA_INCIDENT_REPORT_FLAG_THRESHOLD = 3;

/** Rolling evaluation window in calendar days for TODA incidents (Rule 2.5) */
export const TODA_INCIDENT_REPORT_WINDOW_DAYS = 60;

/** Document and accreditation expiry advance reminder intervals in days (Rule 24.4) */
export const DOCUMENT_EXPIRY_REMINDER_DAYS = [30, 14, 3] as const;

// ============================================================================
// 6. STRIKES, SUSPENSION & EXEMPTION (Batch 3 - Sections 20, 21, 22, 25)
// ============================================================================
// The database is authoritative: these values are code constants inside
// public.strike_policy_constant() (20261004000001_*; the three policy-aligned values are set by 20261011000001_*). They are
// mirrored here ONLY for display (notices, FAQs, admin screens). Change both together.

/** Rolling window for counting active strikes, in days (Sections 20/21) */
export const STRIKE_WINDOW_DAYS = 90;

/** Active-strike ladder (Sections 20/21): 7-day suspension at 5 strikes, 30-day at 8 (aligned to the policy by migration 20261011000001). */
export const STRIKE_LADDER = {
  WARNING_AT: 1,
  ADMIN_REVIEW_AT: 3,
  SUSPENSION_1_AT: 5,
  SUSPENSION_1_DAYS: 7,
  SUSPENSION_2_AT: 8,
  SUSPENSION_2_DAYS: 30,
  DEACTIVATION_AT: 10,
} as const;

/** Time an account holder has to request an exemption for a strike (Rules 25.1 / 9.4: 48 h; aligned by migration 20261011000001) */
export const EXEMPTION_REQUEST_WINDOW_HOURS = 48;

/** Business days (Mon-Fri, Asia/Manila) to decide an exemption request (Rule 25.6) */
export const EXEMPTION_DECISION_BUSINESS_DAYS = 3;

/** Same-cause requests reviewed within the window; the next one is denied (Rule 25.7, PI-B2) */
export const EXEMPTION_REPEAT_LIMIT = 3;
export const EXEMPTION_REPEAT_WINDOW_DAYS = 30;

// ============================================================================
// 7. DRIVER AVAILABILITY & PRESENCE (Batch 4 - Rules 3.1, 3.10, 5.5, 7.6-7.8, 17.1, 17.6-17.8, 29.7)
// ============================================================================
// Values marked [DB] are code constants inside public.driver_presence_constant()
// (supabase/migrations/20261005000001_*). The database enforces them; the copies here
// are for the app and for display. Change both together.

/** Consecutive unanswered offers that trigger the in-app reminder (Rule 7.6) [DB] */
export const DRIVER_INACTIVITY_REMINDER_AFTER_UNANSWERED = 3;

/** Consecutive unanswered offers (3 + 2 more) that set the driver Offline, no strike (Rule 7.7) [DB] */
export const DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED = 5;

/** Automatic Offlines in the rolling window that open a TODA review flag (Rule 7.8) [DB] */
export const DRIVER_AUTO_OFFLINE_REVIEW_COUNT = 3;
export const DRIVER_AUTO_OFFLINE_REVIEW_WINDOW_DAYS = 30;

/** Offline-after-decline pattern: repeats in one login session -> monitoring flag (Rule 29.7) [DB] */
export const DRIVER_OFFLINE_AFTER_DECLINE_SECONDS = 60;
export const DRIVER_OFFLINE_AFTER_DECLINE_COUNT = 3;

/** App silent for this long -> the presence sweep sets the driver Offline (approved extra, 5 min) [DB].
 *  The sweep runs inside the database (pg_cron, every minute): 5 minutes is the threshold, not the schedule. */
export const DRIVER_HEARTBEAT_STALE_SECONDS = 300;

/**
 * Time in the background (while Online) after which the driver is warned on return that location updates only
 * work with the app open and the screen unlocked (Rule 17.6). Client-only: browsers suspend the page while it is
 * hidden, so the warning can only appear when the driver comes back.
 */
export const DRIVER_BACKGROUND_WARNING_AFTER_SECONDS = 20;

/** Location publish interval while Online and idle, in seconds (decision F4.5: 15 s; slower is accepted, Rule 17.8) */
export const DRIVER_IDLE_LOCATION_INTERVAL_SECONDS = 15;
export const DRIVER_IDLE_LOCATION_INTERVAL_MS = DRIVER_IDLE_LOCATION_INTERVAL_SECONDS * 1000;

/** Fixes worse than this accuracy (metres) are not published and cannot start a session (decision F4.7) [DB] */
export const LOCATION_MAX_ACCURACY_METERS = 100;

/** Oldest GPS fix (seconds) that may be used to go Online or to receive offers (decision F4.6) [DB] */
export const LOCATION_MAX_AGE_SECONDS = 45;
export const LOCATION_MAX_AGE_MS = LOCATION_MAX_AGE_SECONDS * 1000;

/** Pause bookings (checklist: Driver > Manage Availability): shortest, default and longest pause, in minutes [DB] */
export const DRIVER_PAUSE_MIN_MINUTES = 5;
export const DRIVER_PAUSE_DEFAULT_MINUTES = 15;
export const DRIVER_PAUSE_MAX_MINUTES = 60;
/** The lengths the Driver app offers (client only; each lies between the minimum and the maximum) */
export const DRIVER_PAUSE_CHOICES_MINUTES = [15, 30, 60] as const;

// ============================================================================
// 8. FARE ENGINE (Batch 5 - Section 6, Rules 6.2 / 6.3 / 6.5 / 6.6, 14.7)
// ============================================================================
// Code constants inside public.fare_policy_constant() (supabase/migrations/20261007000001_*). The database
// enforces them; the copies here are for the app and for display, and the drift test fails if either side
// changes alone. The admin-changeable fare VALUES (base fare, base distance, per-km rate) are NOT here:
// they live in fare_matrix with an effective timestamp (see section 1).

/** Seats in a tricycle: Solo fare = seat fare x this; the shared "vehicle fare" = base fare x this (Rules 6.1.2 / 6.1.3) */
export const FARE_SEAT_CAPACITY = 4;

/** The Matched Shared Fare Estimate assumes this many more passengers join (decision D2c) */
export const FARE_PARTNER_ASSUMPTION_PASSENGERS = 1;

/** Estimate-vs-actual distance tolerance: the larger of this many metres ... (F5.2) */
export const FARE_DEVIATION_TOLERANCE_METERS = 500;
/** ... and this percent of the estimated distance (F5.2) */
export const FARE_DEVIATION_TOLERANCE_PERCENT = 15;

/** GPS fixes worse than this accuracy (metres) are not used for trip distance (F5.1) */
export const FARE_GPS_MAX_ACCURACY_METERS = 50;
/** A fix implying a jump faster than this (km/h) is discarded as a teleport (F5.1) */
export const FARE_GPS_MAX_SPEED_KMH = 80;
/** Movement smaller than max(this, accuracy of both fixes added) is jitter (F5.1) */
export const FARE_GPS_DEADBAND_METERS = 15;
/** A silence longer than this (seconds) flags the track as incomplete (F5.1) */
export const FARE_GPS_GAP_FLAG_SECONDS = 30;
/** Consecutive discarded fixes after which the reference point is replaced (F5.1) */
export const FARE_GPS_REANCHOR_AFTER_REJECTS = 3;
/** A track ending farther than this (metres) from the destination cannot prove a shorter trip (F5.2 guard) */
export const FARE_GPS_ARRIVAL_RADIUS_METERS = 150;

/** Plausibility of the phone's OSRM distance vs the straight line between pickup and destination */
export const FARE_DISTANCE_MIN_PERCENT_OF_STRAIGHT = 90;
export const FARE_DISTANCE_MIN_SLACK_METERS = 50;
export const FARE_DISTANCE_MAX_FACTOR = 3;
export const FARE_DISTANCE_MAX_SLACK_METERS = 500;

/** A requested pickup time further ahead than this (seconds) is a scheduled booking, which is not supported (Rule 6.6) */
export const FUTURE_REQUEST_SLACK_SECONDS = 300;

/** A fare change effective earlier than this many seconds ago is back-dating and is refused (Rule 6.3) */
export const RATE_BACKDATE_SLACK_SECONDS = 120;

/**
 * Ride-sharing cutoff shown to the passenger before they confirm (Rule 6.5, PI-10 Option A): matching continues while the on-board progress is
 * STRICTLY LESS than this percent. The database enforces it (shared_trip_constant('cutoff_progress_pct'), migration 20261025000001); this copy is for
 * the screens and the drift test (scripts/db-tests/batch10/config-drift.js) keeps both equal.
 */
export const RIDE_SHARING_CUTOFF_PERCENT = 50;

// ----------------------------------------------------------------------------
// Ride-sharing (Batch 10): the matching of Section 14. Code constants inside public.shared_trip_constant(); the copies here are for the screens and
// the drift test fails if either side changes alone. The tricycle's 4 seats are FARE_SEAT_CAPACITY (one source); the driver's response window is
// DRIVER_OFFER_TIMEOUT_SECONDS (+ DISPATCH_OFFER_GRACE_SECONDS).
// ----------------------------------------------------------------------------
/** Rule 14.1: a Shared Trip is at most this many independently booked parties */
export const SHARED_TRIP_MAX_BOOKINGS = 2;
/** F10.3: the second pickup is within this distance (straight line, metres) of the first party's next stop */
export const SHARED_TRIP_PICKUP_SEPARATION_METERS = 600;
/** F10.4: nobody's added in-vehicle distance exceeds this percent of their own solo route ... */
export const SHARED_TRIP_DETOUR_MAX_PERCENT = 30;
/** ... or this many metres */
export const SHARED_TRIP_DETOUR_MAX_METERS = 1000;
/** F10.5: when both trips are longer than SHARED_TRIP_BEARING_MIN_TRIP_METERS their destination bearings differ by at most this many degrees */
export const SHARED_TRIP_BEARING_MAX_DEGREES = 45;
export const SHARED_TRIP_BEARING_MIN_TRIP_METERS = 500;
/** F10.6: the first passenger's window to Accept or Decline Shared Match; no answer counts as a Decline (no strike) */
export const SHARED_TRIP_PASSENGER_RESPONSE_SECONDS = 20;
/** F10.7: declines or timeouts of Shared requests in the window that raise a review flag for the driver (review only; a strike needs an administrator) */
export const SHARED_TRIP_DECLINE_FLAG_COUNT = 3;
export const SHARED_TRIP_DECLINE_FLAG_WINDOW_HOURS = 24;
/** Decision N4: the most passengers one Shared booking may declare: a seat must stay free for the second booking (4 passengers book Solo). The database
 * still accepts 1 - 4 and never matches a booking of 4. */
export const SHARED_BOOKING_MAX_PASSENGERS = FARE_SEAT_CAPACITY - 1;

// ----------------------------------------------------------------------------
// Incident reporting, emergency and safety (Batch 11): Sections 15, 19, 26. Code constants inside public.incident_constant(); the copies here are for the
// screens and the drift test (scripts/db-tests/batch11/config-drift.js) fails if either side changes alone. The business-day arithmetic is the database's.
// ----------------------------------------------------------------------------
/** F11.1: a safety report (an emergency, an Urgent Safety Report, a serious allegation) gets its first administrator action within this many hours ... */
export const INCIDENT_SAFETY_FIRST_ACTION_HOURS = 4;
/** ... and its decision within this many business days */
export const INCIDENT_SAFETY_DECISION_BUSINESS_DAYS = 3;
/** F11.1: a standard report is reviewed first by the driver's TODA Administrator within this many business days ... */
export const INCIDENT_STANDARD_FIRST_REVIEW_BUSINESS_DAYS = 2;
/** ... and the LGU Administrator decides an escalated report within this many business days after the escalation */
export const INCIDENT_LGU_DECISION_BUSINESS_DAYS = 3;
/** F11.1: the TODA Administrator arranges the contact for a lost item within this many business days */
export const INCIDENT_LOST_ITEM_CONTACT_BUSINESS_DAYS = 1;
/** F11.2: photos per report, bytes per photo (the screens and the bucket agree: JPEG, PNG or WebP) */
export const INCIDENT_EVIDENCE_MAX_FILES = 3;
export const INCIDENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const INCIDENT_EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** F11.3: a Share Live Trip link lives until the trip ends plus this many minutes, and never longer than this many hours from its creation */
export const SHARE_LINK_BUFFER_MINUTES = 15;
export const SHARE_LINK_MAX_HOURS = 4;
/** F11.4: a Lost Item report is filed within this many days of the trip; with no response after the second number the TODA is shown it and may close it as Unclaimed */
export const INCIDENT_LOST_ITEM_FILE_DAYS = 7;
export const INCIDENT_LOST_ITEM_UNCLAIMED_DAYS = 14;
/** Decision PI-11B: safe-reason cancellations or stops in the window that raise the repeat-pattern flag (review only) */
export const SAFE_REASON_FLAG_COUNT = 3;
export const SAFE_REASON_FLAG_WINDOW_DAYS = 30;

// ============================================================================
// 9. UNIFIED POLICY CONSTANTS OBJECT
// ============================================================================

export const POLICY_CONSTANTS = {
  FARE: DEFAULT_TARIFF,
  FARE_ENGINE: {
    FARE_SEAT_CAPACITY,
    FARE_PARTNER_ASSUMPTION_PASSENGERS,
    FARE_DEVIATION_TOLERANCE_METERS,
    FARE_DEVIATION_TOLERANCE_PERCENT,
    FARE_GPS_MAX_ACCURACY_METERS,
    FARE_GPS_MAX_SPEED_KMH,
    FARE_GPS_DEADBAND_METERS,
    FARE_GPS_GAP_FLAG_SECONDS,
    FARE_GPS_REANCHOR_AFTER_REJECTS,
    FARE_GPS_ARRIVAL_RADIUS_METERS,
    FARE_DISTANCE_MIN_PERCENT_OF_STRAIGHT,
    FARE_DISTANCE_MIN_SLACK_METERS,
    FARE_DISTANCE_MAX_FACTOR,
    FARE_DISTANCE_MAX_SLACK_METERS,
    FUTURE_REQUEST_SLACK_SECONDS,
    RATE_BACKDATE_SLACK_SECONDS,
    RIDE_SHARING_CUTOFF_PERCENT,
  },
  SHARED_TRIP: {
    SHARED_TRIP_MAX_BOOKINGS,
    SHARED_TRIP_PICKUP_SEPARATION_METERS,
    SHARED_TRIP_DETOUR_MAX_PERCENT,
    SHARED_TRIP_DETOUR_MAX_METERS,
    SHARED_TRIP_BEARING_MAX_DEGREES,
    SHARED_TRIP_BEARING_MIN_TRIP_METERS,
    SHARED_TRIP_PASSENGER_RESPONSE_SECONDS,
    SHARED_TRIP_DECLINE_FLAG_COUNT,
    SHARED_TRIP_DECLINE_FLAG_WINDOW_HOURS,
    SHARED_BOOKING_MAX_PASSENGERS,
  },
  DISPATCH: {
    DRIVER_OFFER_TIMEOUT_SECONDS,
    DRIVER_OFFER_TIMEOUT_MS,
    DISPATCH_OFFER_GRACE_SECONDS,
    DISPATCH_TIER1_RADIUS_KM,
    DISPATCH_TIER2_RADIUS_KM,
    DISPATCH_TIER3_RADIUS_STEPS,
    DISPATCH_TIER3_REFRESH_SECONDS,
    DISPATCH_TIER3_MAX_SECONDS,
    DISPATCH_ACCEPTED_CANCEL_LIMIT,
    DISPATCH_ETA_WINDING_PERCENT,
    DISPATCH_ETA_SPEED_KMH,
    PASSENGER_CANCEL_GRACE_SECONDS,
    DRIVER_CANCEL_TRAVEL_THRESHOLD_METERS,
    COMPLETION_CONFIRM_TIMEOUT_SECONDS,
    TRIP_FINISH_MIN_PROGRESS_PERCENT,
    TRIP_PROGRESS_NEAR_DESTINATION_METERS,
    TRIP_PROGRESS_CAP_PERCENT,
    TRIP_PROGRESS_FLOOR_PERCENT,
    FARE_DISPUTE_TODA_BUSINESS_DAYS,
    FARE_DISPUTE_LGU_BUSINESS_DAYS,
    LATE_FARE_DISPUTE_WINDOW_HOURS,
    EARLY_END_FLAG_COUNT,
    EARLY_END_FLAG_WINDOW_DAYS,
    PAYMENT_STUCK_MINUTES,
    CHANGE_REFUSAL_FLAG_COUNT,
    CHANGE_REFUSAL_WINDOW_DAYS,
    REPEAT_CANCEL_FLAG_COUNT,
    REPEAT_CANCEL_WINDOW_HOURS,
    DISPATCH_DECLINE_FLAG_COUNT,
    DISPATCH_DECLINE_FLAG_WINDOW_HOURS,
    DISPATCH_DECLINE_HISTORY_DAYS,
    DISPATCH_RETRY_MAX_AGE_MINUTES,
    COVERAGE_GAP_COUNT,
    COVERAGE_GAP_WINDOW_HOURS,
    OSRM_BASE_URLS,
    OSRM_TIMEOUT_MS,
    OSRM_CACHE_SECONDS,
    OSRM_FAILURE_LIMIT,
    OSRM_BREAKER_SECONDS,
    OSRM_MAX_CANDIDATES,
    DRIVER_STALL_WARN_SECONDS,
    DRIVER_STALL_CANCEL_SECONDS,
    DRIVER_STALL_MIN_MOVEMENT_METERS,
    DRIVER_STALL_EN_ROUTE_SECONDS,
    DRIVER_STALL_EN_ROUTE_WARN_SECONDS,
    DRIVER_UNREACHABLE_WARN_SECONDS,
    DRIVER_UNREACHABLE_CANCEL_SECONDS,
    TRIP_RECONCILE_SECONDS,
    NO_SHOW_WAIT_SECONDS,
    NO_SHOW_EXTENSION_SECONDS,
    PICKUP_ZONE_RADIUS_METERS,
    PICKUP_ZONE_MAX_ACCURACY_METERS,
    PICKUP_ZONE_TOLERANCE_METERS,
    PICKUP_ZONE_TOLERANCE_SECONDS,
  },
  TELEMETRY: {
    ACTIVE_TRIP_GPS_INTERVAL_SECONDS,
    ACTIVE_TRIP_GPS_INTERVAL_MS,
    PASSENGER_STALE_LOCATION_INDICATOR_SECONDS,
    PASSENGER_STALE_LOCATION_DIM_SECONDS,
    CONNECTION_LOST_AFTER_FAILED_CALLS,
  },
  AUTH: {
    OTP_EXPIRATION_MINUTES,
    OTP_EXPIRATION_MS,
  },
  ONBOARDING: {
    DRIVER_APPLICATION_REVIEW_DEADLINE_DAYS,
    DRIVER_APPLICATION_STAGE_REMINDER_DAYS,
    TODA_INCIDENT_REPORT_FLAG_THRESHOLD,
    TODA_INCIDENT_REPORT_WINDOW_DAYS,
    DOCUMENT_EXPIRY_REMINDER_DAYS,
  },
  STRIKES: {
    STRIKE_WINDOW_DAYS,
    STRIKE_LADDER,
    EXEMPTION_REQUEST_WINDOW_HOURS,
    EXEMPTION_DECISION_BUSINESS_DAYS,
    EXEMPTION_REPEAT_LIMIT,
    EXEMPTION_REPEAT_WINDOW_DAYS,
  },
  PRESENCE: {
    DRIVER_INACTIVITY_REMINDER_AFTER_UNANSWERED,
    DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED,
    DRIVER_AUTO_OFFLINE_REVIEW_COUNT,
    DRIVER_AUTO_OFFLINE_REVIEW_WINDOW_DAYS,
    DRIVER_OFFLINE_AFTER_DECLINE_SECONDS,
    DRIVER_OFFLINE_AFTER_DECLINE_COUNT,
    DRIVER_HEARTBEAT_STALE_SECONDS,
    DRIVER_BACKGROUND_WARNING_AFTER_SECONDS,
    DRIVER_IDLE_LOCATION_INTERVAL_SECONDS,
    DRIVER_PAUSE_MIN_MINUTES,
    DRIVER_PAUSE_DEFAULT_MINUTES,
    DRIVER_PAUSE_MAX_MINUTES,
    LOCATION_MAX_ACCURACY_METERS,
    LOCATION_MAX_AGE_SECONDS,
  },
  INCIDENTS: {
    INCIDENT_SAFETY_FIRST_ACTION_HOURS,
    INCIDENT_SAFETY_DECISION_BUSINESS_DAYS,
    INCIDENT_STANDARD_FIRST_REVIEW_BUSINESS_DAYS,
    INCIDENT_LGU_DECISION_BUSINESS_DAYS,
    INCIDENT_LOST_ITEM_CONTACT_BUSINESS_DAYS,
    INCIDENT_EVIDENCE_MAX_FILES,
    INCIDENT_EVIDENCE_MAX_BYTES,
    SHARE_LINK_BUFFER_MINUTES,
    SHARE_LINK_MAX_HOURS,
    INCIDENT_LOST_ITEM_FILE_DAYS,
    INCIDENT_LOST_ITEM_UNCLAIMED_DAYS,
    SAFE_REASON_FLAG_COUNT,
    SAFE_REASON_FLAG_WINDOW_DAYS,
    TODA_INCIDENT_REPORT_FLAG_THRESHOLD,
    TODA_INCIDENT_REPORT_WINDOW_DAYS,
  },
} as const;

export type PolicyConstants = typeof POLICY_CONSTANTS;

