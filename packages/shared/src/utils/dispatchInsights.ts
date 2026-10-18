import { reportNetworkOutcome } from '../hooks/useConnectionStatus';
import type { RpcCapableClient } from './restrictionUtils';

/**
 * Rules 7.9 and 7.10, for the TODA and the LGU Administrators:
 *   * the DECLINE HISTORY of a driver (get_driver_decline_history): how many offers, how many accepted, declined (and why), unanswered or withdrawn, and the latest
 *     declines. A driver may decline without a strike; a repeated or unreasonable pattern while Online is flagged for the TODA Administrator, who weighs the stated
 *     reasons and the history before anything is confirmed (7.9).
 *   * the COVERAGE GAP indicators (get_coverage_gaps): a barangay service zone with 5 or more No Driver Found outcomes in 24 hours is logged (7.10), for service
 *     planning and resource allocation only: it never penalises a passenger or a driver.
 * The DATABASE decides who may read what (a TODA Administrator: their own drivers and their own zone; the LGU: all). This only asks and shapes the answer.
 */

// ── decline history ──────────────────────────────────────────────────────────

export const DECLINE_REASON_LABELS: Record<string, string> = {
  vehicle_issue: 'Vehicle issue',
  personal_emergency: 'Personal emergency',
  safety_concern: 'Safety concern',
  end_of_shift: 'End of shift',
  other: 'Other operational reason',
  not_given: 'No reason given',
};

export interface DeclineHistory {
  windowDays: number;
  offers: number;
  accepted: number;
  declined: number;
  unanswered: number;
  withdrawn: number;
  completedTrips: number;
  byReason: Array<{ reason: string; count: number }>;
  declines: Array<{ attemptId: string; bookingId: string; declinedAt: string; reason: string; tier: number | null; etaSeconds: number | null; distanceM: number | null }>;
  availabilityStatus: string | null;
  bookingsPausedUntil: string | null;
  openReviewFlags: number;
}

export const declineHistoryArgs = (driverId: string, days: number | null = null) => ({ p_driver_id: driverId, p_days: days });

/** The decline history of one driver; null when it could not be read (an administrator of another TODA is refused by the database). */
export async function fetchDeclineHistory(client: RpcCapableClient, driverId: string, days: number | null = null): Promise<DeclineHistory | null> {
  const { data, error } = await client.rpc('get_driver_decline_history', declineHistoryArgs(driverId, days));
  reportNetworkOutcome(error);
  const r = data as Record<string, unknown> | null;
  if (error || !r || r.success === false) return null;
  const s = (r.summary ?? {}) as Record<string, unknown>;
  const reasons = (r.by_reason ?? {}) as Record<string, unknown>;
  return {
    windowDays: Number(r.window_days ?? 0),
    offers: Number(s.offers ?? 0),
    accepted: Number(s.accepted ?? 0),
    declined: Number(s.declined ?? 0),
    unanswered: Number(s.unanswered ?? 0),
    withdrawn: Number(s.withdrawn ?? 0),
    completedTrips: Number(r.completed_trips ?? 0),
    byReason: Object.entries(reasons).map(([reason, count]) => ({ reason, count: Number(count) })).sort((a, b) => b.count - a.count),
    declines: ((r.declines ?? []) as Array<Record<string, unknown>>).map((d) => ({
      attemptId: String(d.attempt_id),
      bookingId: String(d.booking_id),
      declinedAt: String(d.declined_at),
      reason: d.reason ? String(d.reason) : 'not_given',
      tier: d.tier === null || d.tier === undefined ? null : Number(d.tier),
      etaSeconds: d.eta_seconds === null || d.eta_seconds === undefined ? null : Number(d.eta_seconds),
      distanceM: d.distance_m === null || d.distance_m === undefined ? null : Number(d.distance_m),
    })),
    availabilityStatus: r.availability_status ? String(r.availability_status) : null,
    bookingsPausedUntil: r.bookings_paused_until ? String(r.bookings_paused_until) : null,
    openReviewFlags: Number(r.open_review_flags ?? 0),
  };
}

/** The share of the offers of the window that the driver declined, as a whole percent (0 with no offers: nothing is invented). */
export const declineRatePercent = (h: Pick<DeclineHistory, 'offers' | 'declined'>): number => (h.offers > 0 ? Math.round((h.declined / h.offers) * 100) : 0);

// ── coverage gaps ────────────────────────────────────────────────────────────

export interface CoverageGapEvent {
  loggedAt: string;
  zone: string;
  bookings: number;
  threshold: number;
  windowHours: number;
}

export interface CoverageGapZone {
  zone: string;
  timesLogged: number;
  lastLoggedAt: string;
  mostBookings: number;
}

export interface CoverageGaps {
  windowDays: number;
  zones: CoverageGapZone[];
  events: CoverageGapEvent[];
}

export const coverageGapsArgs = (days: number) => ({ p_days: days });

/** The Coverage Gap indicators of the last `days` days (an LGU Administrator: every zone; a TODA Administrator: their own zone); null when it could not be read. */
export async function fetchCoverageGaps(client: RpcCapableClient, days = 30): Promise<CoverageGaps | null> {
  const { data, error } = await client.rpc('get_coverage_gaps', coverageGapsArgs(days));
  reportNetworkOutcome(error);
  const r = data as Record<string, unknown> | null;
  if (error || !r || r.success === false) return null;
  return {
    windowDays: Number(r.window_days ?? days),
    zones: ((r.zones ?? []) as Array<Record<string, unknown>>).map((z) => ({
      zone: String(z.zone),
      timesLogged: Number(z.times_logged ?? 0),
      lastLoggedAt: String(z.last_logged_at),
      mostBookings: Number(z.most_bookings ?? 0),
    })),
    events: ((r.events ?? []) as Array<Record<string, unknown>>).map((e) => ({
      loggedAt: String(e.logged_at),
      zone: String(e.zone),
      bookings: Number(e.bookings ?? 0),
      threshold: Number(e.threshold ?? 0),
      windowHours: Number(e.window_hours ?? 24),
    })),
  };
}
