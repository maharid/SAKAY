import type { DeliberateOfflineInput, ReconcileInput, ReconciliationTrip } from '../components/TripReconciliationPanel';

// What the TODA and LGU portals do with get_trips_needing_reconciliation() / admin_reconcile_trip() / report_deliberate_offline(): the rows become the
// panel's trips, and a refusal of the database becomes a sentence for the administrator (the database's own wording, without its internal code).

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** The rows of get_trips_needing_reconciliation() as the panel shows them. Anything that is not a list is no trips. */
export function mapReconciliationTrips(rows: unknown): ReconciliationTrip[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      eventId: String(row.event_id),
      bookingId: String(row.booking_id),
      driverId: String(row.driver_id),
      driverName: String(row.driver_name ?? 'Driver'),
      driverPhone: str(row.driver_phone),
      plateNumber: str(row.plate_number),
      todaName: str(row.toda_name),
      passengerName: str(row.passenger_name),
      passengerPhone: str(row.passenger_phone),
      pickupAddress: str(row.pickup_address),
      dropoffAddress: str(row.dropoff_address),
      estimatedFare: num(row.estimated_fare),
      tripStartedAt: str(row.trip_started_at),
      interruptedSince: str(row.interrupted_since),
      lastFixLatitude: num(row.last_fix_latitude),
      lastFixLongitude: num(row.last_fix_longitude),
      lastFixAt: str(row.last_fix_at),
      restoredAt: str(row.restored_at),
      silentMinutes: num(row.silent_minutes),
    };
  });
}

/** The arguments of admin_reconcile_trip() for what the administrator filled in (the same call from the TODA and the LGU portal). */
export const reconcileTripArgs = (input: ReconcileInput) => ({
  p_booking_id: input.bookingId,
  p_outcome: input.outcome,
  p_fare: input.fare,
  p_reason: input.reason,
  p_contacted_driver: input.contactedDriver,
  p_contacted_passenger: input.contactedPassenger,
});

/** The arguments of report_deliberate_offline() for what the administrator filled in. */
export const deliberateOfflineArgs = (input: DeliberateOfflineInput) => ({
  p_driver_id: input.driverId,
  p_booking_id: input.bookingId,
  p_evidence: input.evidence,
  p_note: input.note,
});

/** "ERR_RECONCILE_FARE_HIGHER: The agreed fare ..." / "Access Denied: ..." becomes the sentence after the code. */
export function adminActionMessage(message: string | undefined | null, fallback: string): string {
  const text = (message || '').replace(/^(ERR_[A-Z0-9_]+|Access Denied):\s*/, '').trim();
  return text || fallback;
}
