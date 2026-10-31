import { isAvailabilityFlag } from '@sakay/shared';

/** The flags a detector raises (Rules 27.1, 27.3 - 27.6): the LGU Administrator confirms them, which records the violation against every account named */
export const INTEGRITY_FLAG_TYPES = ['GPS_SPOOFING_REVIEW', 'RATING_MANIPULATION_REVIEW', 'COLLUSIVE_MATCHING_REVIEW', 'POSSIBLE_REREGISTRATION_REVIEW'];

/** A review flag still waiting for an administrator: the database says Open or Under Review (it never says "Pending"). */
export const isOpenFlag = (f: any): boolean => f.status === 'Open' || f.status === 'Under Review';

const EVIDENCE_TEXT: Record<string, string> = {
  pattern_review: 'a pattern of interruptions found on review',
  passenger_report: "a passenger's report",
  admission: "the driver's own admission",
};

/** What the flag says, in plain lines, for the flags that carry their evidence with them (Rules 8.7, 9.5, 9.6, 17.5). */
export const describeFlagDetails = (flag: any): string[] => {
  const d = flag?.details ?? {};
  if (flag?.flag_type === 'DRIVER_DELIBERATE_OFFLINE_REPORT') {
    return [
      "Reported by the driver's " + (d.reported_by_role === 'lgu_admin' ? 'LGU' : 'TODA') + ' Administrator. Evidence: ' + (EVIDENCE_TEXT[d.evidence] ?? d.evidence) + '.',
      d.note ? 'Note: ' + d.note : '',
      'Interruptions of this driver in the last 30 days: ' + (d.interruptions_last_30_days ?? 0) + '.',
      'Confirming issues 2 strikes; the driver cannot appeal this decision.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'GPS_AREA_REVIEW') {
    return [
      'Area around ' + d.center_latitude + ', ' + d.center_longitude + ' (about 550 m square).',
      d.determinations + ' stall or lost-connection determinations in ' + d.window_days + ' days (' + d.stalls + ' stalls, ' + d.connectivity + ' lost connections).',
      d.note ? 'Reported by the TODA Administrator: ' + d.note : '',
      'Possible service-zone boundary adjustment.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PASSENGER_EARLY_END_PATTERN' || flag?.flag_type === 'PASSENGER_SAFETY_END_PATTERN') {
    return [
      d.count + ' ' + (d.kind === 'SAFETY' ? 'Safety Concern' : 'personal') + ' early terminations in ' + d.window_days + ' days.',
      d.note ?? '',
      d.kind === 'SAFETY' ? 'Review the trips and the reasons; there is no strike for a Safety Concern pattern.' : 'Confirming issues 1 strike, PAX_FARE_AVOIDANCE. The TODA Administrator may investigate the trips first.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_EARLY_STOP_REVIEW') {
    return [
      'The driver ended booking ' + d.booking_id + ' before the destination. Reason: ' + d.reason + (d.valid_reason ? ' (a valid reason: no strike).' : '.'),
      d.valid_reason ? '' : 'Confirming issues DRV_EARLY_STOP (1 strike).',
    ].filter(Boolean);
  }
  if (isAvailabilityFlag(flag?.flag_type ?? '')) {
    return [
      (flag.flag_type === 'DRIVER_QUEUE_CONFLICT_REPORT' ? 'Queue conflict: Available in the app while queued at the terminal.' : 'Availability violation: accepted a booking while carrying other passengers.')
        + ' Reported by ' + String(d.reported_by ?? 'an administrator').replace('_', ' ') + '.',
      d.description ? '"' + d.description + '"' : '',
      'Confirming records the strike under your name. Nothing is struck until you confirm.',
    ].filter(Boolean);
  }
  if (flag?.flag_type === 'PAYMENT_STUCK_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been at the destination for 30 minutes without the driver tapping Payment Received. Contact both parties and close it as Paid or Waived.'];
  }
  if (flag?.flag_type === 'DRIVER_CHANGE_REFUSAL_PATTERN') {
    return [d.count + ' passengers reported that this driver refused to provide change in ' + d.window_days + ' days. Review the reports; there is no automatic strike.'];
  }
  if (flag?.flag_type === 'TRIP_MANUAL_RECONCILIATION') {
    return ['Booking ' + d.booking_id + ' has been without a driver location for 30 minutes. Close it from Live Trips after contacting both parties.'];
  }
  if (flag?.flag_type === 'TODA_RENEWAL_SUBMITTED') {
    return [
      (d.toda_name ?? 'A TODA') + ' sent a renewed Barangay Clearance' + (d.file_name ? ' ("' + d.file_name + '")' : '') + '.',
      d.declared_valid_until ? 'The TODA states it is valid until ' + d.declared_valid_until + '. Read the date on the document yourself.' : 'The TODA stated no validity date: read it from the document.',
      'Open the TODA under Accredited TODAs, check the document, then press Record Renewal. The accreditation and the certificate stay as they are until you do.',
    ];
  }
  if (flag?.flag_type === 'DUPLICATE_LICENSE' || flag?.flag_type === 'DUPLICATE_PLATE' || flag?.flag_type === 'DUPLICATE_MTOP') {
    const what = flag.flag_type === 'DUPLICATE_LICENSE' ? "Driver's License number" : flag.flag_type === 'DUPLICATE_PLATE' ? 'plate number' : 'MTOP franchise number';
    return ['A driver application uses a ' + what + (d.number ? ' (' + d.number + ')' : '') + ' that another driver already has. The application is not auto-approved: verify the documents of both drivers.'];
  }
  // Batch 11 (Sections 15, 19, 26; Rules 2.5, 29.19, 29.20, 29.22)
  if (flag?.flag_type === 'TODA_EXCESS_INCIDENTS') {
    return [d.upheld_reports + ' incident reports about drivers of this TODA were upheld in ' + d.window_days + ' days (the threshold is ' + d.threshold + '). Supervisory review; nothing is imposed automatically.'];
  }
  if (flag?.flag_type === 'DRIVER_DETENTION_LGU_REVIEW' || flag?.flag_type === 'DRIVER_DETENTION_TODA_REVIEW') {
    return ['The driver was detained or arrested during booking ' + d.booking_id + '. The account is on hold until BOTH the TODA and the LGU reviews are resolved; then reinstate it from the driver record.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_INCAPACITATED_REVIEW') {
    return ['The driver became ill during booking ' + d.booking_id + '. No strike is issued pending the review.', d.note ? 'How it was confirmed: ' + d.note : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'DRIVER_SAFE_REASON_REVIEW' || flag?.flag_type === 'DRIVER_SAFE_REASON_PATTERN') {
    return ['The driver cancelled or stopped for a reason that is not struck (a breakdown, an accident, an emergency, a safety concern, a road closure, an unsafe request). The TODA Administrator of the driver verifies it; no strike was issued.', d.events_in_window ? d.events_in_window + ' such events in ' + d.window_days + ' days.' : ''].filter(Boolean);
  }
  if (flag?.flag_type === 'LOST_ITEM_UNCLAIMED_REVIEW') {
    return ['A lost-item report has had no contact and no result for 14 days. The TODA Administrator arranges the contact or closes it as Unclaimed.'];
  }
  if (flag?.flag_type === 'DRIVER_LOW_RATING_REVIEW' || flag?.flag_type === 'PASSENGER_LOW_RATING_REVIEW') {
    return [String(d.note ?? 'The average rating is under 3.00 after at least 20 completed trips.'), 'Average ' + d.average + ' from ' + d.rating_count + ' ratings over ' + d.completed_trips + ' completed trips. Ratings never change booking or dispatch.'];
  }
  if (flag?.flag_type === 'GPS_SPOOFING_REVIEW') {
    const trips = Array.isArray(d.suspect_trips) ? d.suspect_trips : [];
    return [String(d.note ?? ''), trips.length + ' suspect trip(s) among the last ' + (d.window_trips ?? 10) + ' completed trips.'].filter(Boolean).concat(trips.map((x: any) => 'Trip ' + String(x.booking_id).slice(0, 8).toUpperCase() + ': ' + x.teleport_fixes + ' impossible jumps' + (x.distance_mismatch ? ', tracked ' + x.tracked_km + ' km against the quoted ' + x.quoted_km + ' km' : '')));
  }
  if (flag?.flag_type === 'RATING_MANIPULATION_REVIEW') {
    return [String(d.note ?? ''), 'Pattern: ' + String(d.pattern ?? '').replace(/_/g, ' ').toLowerCase() + ', ' + (Array.isArray(d.rating_ids) ? d.rating_ids.length : 0) + ' ratings. Confirming excludes these ratings and records 2 strikes for each account named.'];
  }
  if (flag?.flag_type === 'COLLUSIVE_MATCHING_REVIEW') {
    return [String(d.note ?? ''), d.matches + ' matches in ' + d.window_days + ' days. Confirming deactivates both accounts for review.'];
  }
  if (flag?.flag_type === 'POSSIBLE_REREGISTRATION_REVIEW') {
    const linked = Array.isArray(d.linked) ? d.linked : [];
    return [String(d.note ?? ''), 'Matched on: ' + (Array.isArray(d.basis) ? d.basis.join(', ').replace(/_/g, ' ') : '-') + '. Linked account(s): ' + linked.map((x: any) => x.type + ' ' + String(x.id).slice(0, 8) + (x.state ? ' (' + String(x.state).toLowerCase() + ')' : '')).join('; ') + '. Confirming deactivates them for review; closing them for good is a separate action on each account.'];
  }
  return [];
};
