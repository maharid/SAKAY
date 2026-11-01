/**
 * What a notice in the Passenger or the Driver app lets the person DO: a short action that opens the page of the record the notice is about. The type of the notice and the record it
 * carries (the notice table's subject: a strike, a booking, an incident report) decide it, and only pages that exist in that app are named. A notice with no page of its own gets no
 * action, and a notice about a record whose id it does not carry opens the list that holds the record, never a page for the wrong one.
 */

export type NoticeAudience = 'passenger' | 'driver';

export interface NoticeActionInput {
  /** notification_type as the database wrote it */
  type?: string | null;
  /** the record the notice is about (notification.subject_id) */
  subjectId?: string | null;
}

export interface NoticeAction {
  key: string;
  en: string;
  tl: string;
  /** the address to open, inside the app */
  to: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordId = (subject: string | null | undefined): string | null => {
  const id = String(subject ?? '').split('|')[0].trim();
  return UUID.test(id) ? id : null;
};

const PAGES = {
  passenger: { strikes: '/strikes', disputes: '/fare-disputes', reports: '/track-reports', trip: (id: string) => `/trip-details/${id}`, report: (id: string) => `/track-reports/${id}` },
  driver: { strikes: '/driver/strikes', disputes: '/driver/fare-disputes', status: '/driver/status', substitution: '/driver/vehicle-substitution', trip: (id: string) => `/driver/trip-detail/${id}` },
} as const;

const SEE_STRIKES = { en: 'See My Strikes', tl: 'Tingnan ang mga Strike' };
const WANT_APPEAL = { en: 'Want to Appeal?', tl: 'Gustong Mag-apela?' };

// A strike was issued, a warning given, an account restricted or let go: the strikes page has the whole story
const STRIKE_TYPES = /^(STRIKE_ISSUED|STRIKE_WAIVED_SAFETY_VICTIM|CONDUCT_WARNING|ACCOUNT_RESTRICTION_NOTICE|ACCOUNT_SUSPENDED_BY_ADMIN|ACCOUNT_SUSPENSION_ENDED|ACCOUNT_SUSPENSION_LIFTED_BY_WAIVER|SUSPENSION_ENDED|ACCOUNT_REINSTATED|VICTIM_STRIKES_WAIVED)$/;
// a strike that can still be appealed (the page decides whether it still can: the window, a waiver, an appeal already waiting)
const APPEALABLE_NOTICE = /^STRIKE_ISSUED$/;
const APPEAL_TYPES = /^(APPEAL_|EXEMPTION_)/;
// about ONE finished trip: its own page, when the notice carries the booking
const TRIP_TYPES = /^(TRIP_CORRECTED|TRIP_CLOSED_BY_ADMIN|TRIP_RECONCILED|PASSENGER_COUNT_CORRECTED|BOOKING_SYSTEM_CANCELLED)$/;
const INCIDENT_TYPES = /^(INCIDENT_|LOST_ITEM_)/;
const DISPUTE_TYPES = /^FARE_DISPUTE_/;
// the driver's application, documents and TODA membership: the status page
const DRIVER_STATUS_TYPES = /^(DRIVER_AFFILIATION_|DRIVER_APPLICATION_|DRIVER_DOCUMENTS_RETURNED|DOCUMENT_RETURNED|DRIVER_RESUBMITTED|DRIVER_REAPPLICATION_ALLOWED|DRIVER_PERMANENTLY_DISQUALIFIED|DRIVER_DOCUMENTARY_RESTRICTION)/;
const SUBSTITUTION_TYPES = /^VEHICLE_SUBSTITUTION_/;

/** The actions of a notice, in the order they are shown (an empty list: nothing to open). */
export function noticeActions(audience: NoticeAudience, notice: NoticeActionInput): NoticeAction[] {
  const type = String(notice.type ?? '').toUpperCase().trim();
  if (!type) return [];
  const id = recordId(notice.subjectId);
  const p = PAGES[audience];

  if (STRIKE_TYPES.test(type)) {
    const actions: NoticeAction[] = [{ key: 'strikes', ...SEE_STRIKES, to: p.strikes }];
    if (APPEALABLE_NOTICE.test(type)) actions.push({ key: 'appeal', ...WANT_APPEAL, to: id ? `${p.strikes}?appeal=${id}` : `${p.strikes}?appeal=1` });
    return actions;
  }
  if (APPEAL_TYPES.test(type)) return [{ key: 'appeal-status', en: 'View Appeal', tl: 'Tingnan ang Apela', to: p.strikes }];
  if (TRIP_TYPES.test(type)) return id ? [{ key: 'trip', en: 'View Trip', tl: 'Tingnan ang Biyahe', to: p.trip(id) }] : [];
  if (DISPUTE_TYPES.test(type)) return [{ key: 'dispute', en: 'View Fare Review', tl: 'Tingnan ang Pagsusuri ng Pamasahe', to: p.disputes }];
  if (INCIDENT_TYPES.test(type)) {
    // only the passenger can follow a report in the app (the Driver app files reports; it has no page to follow one)
    if (audience !== 'passenger') return [];
    const pp = PAGES.passenger;
    return [{ key: 'report', en: 'View Report', tl: 'Tingnan ang Ulat', to: id ? pp.report(id) : pp.reports }];
  }
  if (audience === 'driver') {
    const d = PAGES.driver;
    if (DRIVER_STATUS_TYPES.test(type)) return [{ key: 'status', en: 'View Status', tl: 'Tingnan ang Status', to: d.status }];
    if (SUBSTITUTION_TYPES.test(type)) return [{ key: 'substitution', en: 'View Request', tl: 'Tingnan ang Hiling', to: d.substitution }];
    // a booking cancelled for him leads to his strikes, where he can appeal (Rules 8.6 / 9.4)
    if (type === 'BOOKING_AUTO_CANCELLED') return [{ key: 'strikes', ...SEE_STRIKES, to: d.strikes }, { key: 'appeal', ...WANT_APPEAL, to: `${d.strikes}?appeal=1` }];
  }
  return [];
}

/** The strike the "Want to Appeal?" address names, for the strikes page to open that strike's appeal form ("1" means: the first strike that can be appealed). */
export function appealTargetFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('appeal');
  if (!value) return null;
  return value === '1' ? '1' : UUID.test(value) ? value : null;
}
