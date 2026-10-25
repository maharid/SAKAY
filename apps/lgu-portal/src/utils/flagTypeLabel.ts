/**
 * The name of an administrative review flag in plain words, for the Dashboard list and the resolve dialog.
 * The database keeps raw codes such as ROSTER_MISMATCH; the code never changes and is never shown on screen when a plain name exists.
 * A code that is not listed here falls back to the code itself, lower-cased and spaced out, so a new kind of flag is still readable.
 */
const FLAG_TYPE_LABELS: Record<string, string> = {
  ROSTER_MISMATCH: 'Roster does not match',
  APPLICATION_OVERDUE: 'Application is overdue',
  TODA_EXCESS_INCIDENTS: 'TODA has many incident reports',
  TODA_RENEWAL_SUBMITTED: 'TODA sent a renewal',
  TERMINAL_RELOCATION_PENDING: 'Terminal move is waiting',
  IMMEDIATE_REVIEW: 'Needs review right away',
  DUPLICATE_LICENSE: 'Duplicate license number',
  DUPLICATE_PLATE: 'Duplicate plate number',
  DUPLICATE_MTOP: 'Duplicate MTOP number',
  PERMANENT_DISQUALIFICATION: 'Permanent disqualification',
  GPS_SPOOFING_REVIEW: 'Possible fake GPS',
  GPS_AREA_REVIEW: 'GPS problem area',
  RATING_MANIPULATION_REVIEW: 'Possible rating manipulation',
  COLLUSIVE_MATCHING_REVIEW: 'Possible collusive matching',
  POSSIBLE_REREGISTRATION_REVIEW: 'Possible re-registration',
  PASSENGER_EARLY_END_PATTERN: 'Passenger ends trips early',
  PASSENGER_SAFETY_END_PATTERN: 'Passenger ends trips for safety',
  PASSENGER_LOW_RATING_REVIEW: 'Passenger rating is low',
  PASSENGER_COUNT_UNDER_DECLARED: 'Passengers under-declared',
  DRIVER_EARLY_STOP_REVIEW: 'Driver ended a trip early',
  DRIVER_SAFE_REASON_REVIEW: 'Driver stopped for a safe reason',
  DRIVER_SAFE_REASON_PATTERN: 'Driver often stops for safe reasons',
  DRIVER_DELIBERATE_OFFLINE_REPORT: 'Driver went offline on purpose',
  DRIVER_DETENTION_TODA_REVIEW: 'Driver detained (TODA review)',
  DRIVER_DETENTION_LGU_REVIEW: 'Driver detained (LGU review)',
  DRIVER_INCAPACITATED_REVIEW: 'Driver became ill on a trip',
  DRIVER_CHANGE_REFUSAL_PATTERN: 'Driver refuses to give change',
  DRIVER_INACTIVITY_REVIEW: 'Driver is often inactive',
  DRIVER_REPEATED_CANCELLATIONS: 'Driver cancels often',
  DRIVER_SHARED_REQUEST_DECLINES: 'Driver declines shared trips',
  DRIVER_REPEATED_DECLINES: 'Driver declines many offers',
  DRIVER_QUEUE_CONFLICT_REPORT: 'Driver queued while available',
  DRIVER_AVAILABILITY_VIOLATION_REPORT: 'Driver took a booking while full',
  DRIVER_LOW_RATING_REVIEW: 'Driver rating is low',
  PAYMENT_STUCK_RECONCILIATION: 'Trip is waiting for payment',
  TRIP_MANUAL_RECONCILIATION: 'Trip has gone silent',
  LOST_ITEM_UNCLAIMED_REVIEW: 'Lost item has no answer',
  QUEUE_CONFLICT: 'Queue conflict',
};

export const flagTypeLabel = (flagType: string | null | undefined): string => {
  if (!flagType) return 'Review flag';
  const known = FLAG_TYPE_LABELS[flagType];
  if (known) return known;
  const spaced = flagType.toLowerCase().replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
