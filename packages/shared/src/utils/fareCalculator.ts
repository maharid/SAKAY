import type { NoticeLanguage, RpcCapableClient } from './restrictionUtils';

/**
 * SAKAY fare quotes (client side).
 *
 * There is NO fare formula in the apps. The one fare function is public.calculate_fare() in the database
 * (supabase/migrations/20261007000002_batch5_fare_engine.sql). The apps ask for a quote (public.quote_fare)
 * and show what comes back; the database re-computes the fare when the booking is inserted and again, from the
 * recorded GPS track, when the trip arrives. The amount a passenger is charged is therefore never something a
 * phone supplied (Rules 6.2, 6.3; PI-04 Option B).
 */

export type TripType = 'Solo' | 'Shared';

/** The fare rule (LGU matrix row) a quote or a booking was priced on (Rule 6.3). */
export interface FareRuleSnapshot {
  fare_matrix_id: string;
  base_fare: number;
  base_distance_km: number;
  succeeding_rate: number;
  seat_capacity: number;
  /** ISO timestamp (UTC) */
  effective_timestamp: string;
  ordinance_reference: string | null;
}

/** How a fare is made up, ready to print: base + distance + (rounding / minimum fare). */
export interface FareComponents {
  base: number;
  distance: number;
  adjustment: number;
}

/** The figures calculate_fare() returns for a distance and a headcount. */
export interface FareFigures {
  distance_km: number;
  excess_km: number;
  passenger_count: number;
  seat_capacity: number;
  /** Fare for one passenger (exact, before rounding) */
  seat_fare: number;
  /** No booking is charged less than this (Rule 6.1.5 d) */
  minimum_fare: number;
  /** Solo Trip Fare = seat fare x seat capacity, whole pesos (Rule 6.1.2) */
  solo_fare: number;
  /** Rule 6.5: what a Shared booking pays if nobody is matched = the Solo fare */
  max_unmatched_fare: number;
  /** Rule 6.5: the estimate if a compatible partner is matched (assumes one more 1-passenger booking) */
  shared_matched_estimate: number;
  partner_assumption_passengers: number;
  solo_components: FareComponents;
  shared_components: FareComponents;
}

/** What public.quote_fare() returns: the figures plus the rule in force right now. */
export interface FareQuote extends FareFigures {
  rule: FareRuleSnapshot;
}

/** The estimate stored on a booking when it was confirmed. */
export interface FareEstimateBreakdown extends FareFigures {
  trip_type: TripType;
  estimated_fare: number;
}

/** What the database learned from the driver's GPS track when the trip arrived (figure F5.1). */
export interface FareTrackSummary {
  distance_km: number;
  fixes_total: number;
  fixes_usable: number;
  fixes_counted: number;
  rejected_accuracy: number;
  rejected_speed: number;
  max_gap_seconds: number;
  gap_flag: boolean;
  end_distance_to_destination_m: number | null;
}

export type FareDistanceBasis =
  | 'estimate_no_track'
  | 'estimate_within_tolerance'
  | 'estimate_kept_incomplete_track'
  | 'actual_distance'
  // Batch 9 (Rules 13.4 / 13.5 / 13.7): an early end is billed on the distance travelled to the approved early point
  | 'actual_distance_to_early_point'
  | 'estimate_is_greater_than_actual'
  | 'straight_line_to_early_point_no_track';

/**
 * How the final fare was reached. 'shared_allocated' (Batch 10): a matched Shared leg settled by allocate_shared_fares() from where each booking boarded and
 * alighted along the vehicle's route; 'matched_estimate_pending_segments': a matched leg whose route could not be measured (the accepted estimate stands).
 */
export type FareBasis = 'solo' | 'unmatched_solo' | 'matched_estimate_pending_segments' | 'shared_allocated';

/** The legs a matched Shared booking was settled on (Batch 10; booking.fare_breakdown.final.shared_leg). Positions are km along the vehicle's route. */
export interface SharedLegBreakdown {
  fare: number;
  raw_fare: number;
  /** What the allocation gave before the booking's own Solo (Maximum Unmatched) fare capped it */
  allocated_fare: number;
  capped_at_solo: boolean;
  solo_cap: number;
  route_km: number;
  pool_fare: number;
  per_km_cost: number;
  passenger_count: number;
  board_km: number;
  alight_km: number;
  other_passenger_count: number;
  other_board_km: number | null;
  other_alight_km: number | null;
  /** True when the other leg was still on board: its end is its remaining estimated distance (the first leg to end is locked with that estimate) */
  other_projected: boolean;
  segments: Array<{ from_km: number; to_km: number; length_km: number; passengers_on_board: number; type: 'common' | 'exclusive'; cost: number }>;
  components: FareComponents;
}

/** Rules 13.4 / 13.5 / 13.7: how and where the trip ended early, recorded by the database when the driver ended it (booking.fare_breakdown.final.early_end). */
export interface FareEarlyEndBreakdown {
  kind: 'PERSONAL' | 'SAFETY' | 'DRIVER';
  reason: string | null;
  requested_at: string | null;
  ended_at: string;
  /** The approved early termination point (the driver's fix when he ended the trip); null when the database held no usable fix */
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  /** A Safety Concern fare is provisional until the administrative review (Rule 13.5) */
  provisional: boolean;
  /** The fare accepted at booking confirmation, on the same basis: the floor of a personal early end (Rule 13.4) */
  accepted_estimate_fare: number;
  actual_distance_km: number | null;
}

/** What an administrator decided about the fare of a completed trip (a dispute resolution or an audited correction, Rule 16.3 / 18.4) */
export interface FareResolutionBreakdown {
  source: 'fare_dispute' | 'admin_correction';
  dispute_id?: string;
  outcome?: string;
  previous_fare: number;
  final_fare: number;
  resolved_by_role: 'toda_admin' | 'lgu_admin';
  resolved_at: string;
}

/** The final, binding fare and how it was reached (Rule 6.2). */
export interface FareFinalBreakdown {
  basis: FareBasis;
  distance_basis: FareDistanceBasis;
  billed_distance_km: number;
  estimated_distance_km: number;
  recorded_distance_km: number | null;
  tolerance_km: number;
  /** True when the recorded distance differed from the estimate by more than the tolerance (Rule 6.2.4) */
  deviation: boolean;
  track: FareTrackSummary;
  seat_fare: number;
  excess_km: number;
  seat_capacity: number;
  components: FareComponents;
  minimum_fare: number;
  actual_fare: number;
  finalized_at: string;
  /** Present only when the trip ended before the destination (Batch 9) */
  early_end?: FareEarlyEndBreakdown;
  /** Present only for a matched Shared leg that was settled by the allocation (Batch 10) */
  shared_leg?: SharedLegBreakdown;
}

/** booking.fare_breakdown: the rule snapshot, the estimate, and (once the trip arrived) the final fare. */
export interface FareBreakdown {
  version: number;
  rule: FareRuleSnapshot;
  estimate: FareEstimateBreakdown | null;
  final: FareFinalBreakdown | null;
  /** An administrator's decision on the fare of the completed trip (Batch 9): the fare shown is then `resolution.final_fare` */
  resolution?: FareResolutionBreakdown;
  /** Bookings made before the fare engine: the rule in force when they were created was looked up at the end */
  legacy_rule_lookup?: boolean;
}

/**
 * Asks the database for a fare quote (public.quote_fare). Throws an Error whose message is the database's,
 * so callers can pass it to parseFareError().
 */
export async function fetchFareQuote(
  client: RpcCapableClient,
  distanceKm: number,
  passengerCount: number
): Promise<FareQuote> {
  const { data, error } = await client.rpc('quote_fare', {
    p_distance_km: distanceKm,
    p_passenger_count: passengerCount,
  });
  if (error) {
    throw new Error(typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : 'Fare quote failed');
  }
  const quote = data as FareQuote | null;
  if (!quote || typeof quote.solo_fare !== 'number' || typeof quote.shared_matched_estimate !== 'number' || !quote.rule) {
    throw new Error('Fare quote failed: unexpected response');
  }
  return quote;
}

/** The estimate the passenger is shown and confirms for a trip type (Rule 6.5). */
export function estimatedFareFor(figures: FareFigures, tripType: TripType): number {
  return tripType === 'Shared' ? figures.shared_matched_estimate : figures.solo_fare;
}

/** The base / distance parts of that estimate. */
export function componentsFor(figures: FareFigures, tripType: TripType): FareComponents {
  return tripType === 'Shared' ? figures.shared_components : figures.solo_components;
}

export type FareErrorCode =
  | 'ERR_FARE_MISMATCH'
  | 'ERR_DISTANCE_IMPLAUSIBLE'
  | 'ERR_DISTANCE_REQUIRED'
  | 'ERR_INVALID_DISTANCE'
  | 'ERR_SCHEDULED_BOOKING_NOT_SUPPORTED'
  | 'ERR_FUTURE_BOOKING_NOT_SUPPORTED'
  | 'ERR_NO_FARE_RULE'
  | 'ERR_BOOKING_LOCKED'
  | 'ERR_FARE_LOCKED';

const FARE_ERROR_CODES: FareErrorCode[] = [
  'ERR_FARE_MISMATCH',
  'ERR_DISTANCE_IMPLAUSIBLE',
  'ERR_DISTANCE_REQUIRED',
  'ERR_INVALID_DISTANCE',
  'ERR_SCHEDULED_BOOKING_NOT_SUPPORTED',
  'ERR_FUTURE_BOOKING_NOT_SUPPORTED',
  'ERR_NO_FARE_RULE',
  'ERR_BOOKING_LOCKED',
  'ERR_FARE_LOCKED',
];

export interface ParsedFareError {
  code: FareErrorCode;
  /** The fare the database expected, when it says so (ERR_FARE_MISMATCH) */
  expectedFare?: number;
}

/** Recovers the fare error from a database message raised by the fare guards; null for any other error. */
export function parseFareError(message: string | null | undefined): ParsedFareError | null {
  if (!message) return null;
  const code = FARE_ERROR_CODES.find((c) => message.includes(c));
  if (!code) return null;
  const expected = message.match(/expected=([0-9.]+)/);
  return { code, expectedFare: expected ? Number(expected[1]) : undefined };
}

/** Plain-language notice for a fare error, in the user's language. */
export function describeFareError(error: ParsedFareError, language: NoticeLanguage): string {
  switch (error.code) {
    case 'ERR_FARE_MISMATCH':
      return language === 'tl'
        ? 'Nagbago ang pamasahe. Pakisuri ang bagong halaga bago mag-book.'
        : 'The fare has changed. Please review the updated fare before booking.';
    case 'ERR_DISTANCE_IMPLAUSIBLE':
    case 'ERR_DISTANCE_REQUIRED':
    case 'ERR_INVALID_DISTANCE':
      return language === 'tl'
        ? 'Hindi makumpirma ang distansya ng ruta. Pakisubukang muli.'
        : 'We could not confirm the route distance. Please try again.';
    case 'ERR_SCHEDULED_BOOKING_NOT_SUPPORTED':
    case 'ERR_FUTURE_BOOKING_NOT_SUPPORTED':
      return language === 'tl'
        ? 'Hindi tumatanggap ang SAKAY ng naka-iskedyul na booking; para lamang ito sa agarang sakay.'
        : 'Scheduled bookings are not supported; every booking is for immediate pickup.';
    case 'ERR_NO_FARE_RULE':
      return language === 'tl'
        ? 'Walang umiiral na fare matrix sa ngayon. Makipag-ugnayan sa LGU.'
        : 'No fare rule is in force right now. Please contact the LGU.';
    case 'ERR_BOOKING_LOCKED':
    case 'ERR_FARE_LOCKED':
    default:
      return language === 'tl'
        ? 'Naka-lock na ang ruta at pamasahe ng booking na ito.'
        : "This booking's route and fare are locked.";
  }
}
