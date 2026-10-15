/**
 * SAKAY Incident Report Service (Policy Section 19; checklist: Passenger > Report Incidents)
 *
 * One place that files, lists, shows and withdraws a passenger's incident reports against the database.
 * A report is always about a TRIP the passenger took (the table requires a booking), so the screen asks which trip.
 * The driver, the driver's TODA, the reporter's role and the starting status are decided by the database from the booking and the
 * signed-in user (migration 20261012000001); this file never sends them.
 *
 * Evidence photos go to the private bucket 'incident-evidence' under the reporter's own folder "<auth uid>/<file>"; the report keeps
 * only the storage paths, and a screen asks for a short-lived signed link when it needs to show one.
 */

import { supabase } from './supabaseClient';
import { signIncidentEvidence, uploadIncidentEvidenceFiles, INCIDENT_EVIDENCE_MAX_BYTES, BOOKING_OPEN_STATUSES } from '@sakay/shared';
import type { IncidentEvidenceFile } from '@sakay/shared';

export { INCIDENT_EVIDENCE_MAX_BYTES };

export type IncidentReportStatus = 'Submitted' | 'Under Investigation (LGU & TODA)' | 'Resolved' | 'Cancelled';

/** What the report screens show for one report. */
export interface IncidentReportItem {
  id: string;
  incidentType: string;
  /** "Pickup > Drop-off" of the trip the report is about */
  tripSummary: string;
  description: string;
  status: IncidentReportStatus;
  submittedAt: string;
  officialResponse?: string;
  cancellationReason?: string;
  /** storage paths in the evidence bucket */
  evidencePaths: string[];
}

/**
 * A trip the passenger can report about: a completed one, or (for an emergency incident only, Rule 16.5) the one in progress or one the passenger had to walk away from
 * (a cancelled booking that had a driver: a passenger who fled an unsafe situation reports it, Rule 26.4).
 */
export interface ReportableTrip {
  bookingId: string;
  label: string;
  dateLabel: string;
  /** The trip is not completed: only an emergency incident (an emergency or a serious allegation) may name it */
  emergencyOnly: boolean;
  /** in progress, or cancelled (for the label of the list) */
  state: 'in_progress' | 'cancelled' | 'completed';
}

interface IncidentRow {
  incident_id: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
  resolution?: string | null;
  resolution_notes?: string | null;
  cancellation_reason?: string | null;
  evidence_paths?: string[] | null;
  booking?: { pickup_address?: string | null; dropoff_address?: string | null } | Array<{ pickup_address?: string | null; dropoff_address?: string | null }> | null;
}

const INCIDENT_COLUMNS =
  'incident_id, category, description, status, created_at, resolution, resolution_notes, cancellation_reason, evidence_paths, booking:booking_id(pickup_address, dropoff_address)';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

/** The database keeps the review vocabulary of the TODA and LGU portals; the passenger sees four plain states. */
export function toReportStatus(dbStatus: string): IncidentReportStatus {
  switch (dbStatus) {
    case 'Under Investigation':
      return 'Under Investigation (LGU & TODA)';
    case 'Resolved':
    case 'Dismissed':
      return 'Resolved';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Submitted'; // 'Pending', 'Pending Review'
  }
}

function toItem(row: IncidentRow): IncidentReportItem {
  const trip = Array.isArray(row.booking) ? row.booking[0] : row.booking;
  const tripSummary = trip ? `${trip.pickup_address || 'Pickup'} > ${trip.dropoff_address || 'Drop-off'}` : 'Trip';
  return {
    id: row.incident_id,
    incidentType: row.category,
    tripSummary,
    description: row.description,
    status: toReportStatus(row.status),
    submittedAt: formatDate(row.created_at),
    officialResponse: row.resolution_notes || row.resolution || undefined,
    cancellationReason: row.cancellation_reason || undefined,
    evidencePaths: row.evidence_paths ?? [],
  };
}

/**
 * The passenger's completed trips that had a driver, newest first (policy 16.5: a report is made after the trip), and the trip in progress with a driver,
 * marked inProgress: the screen lists it for the emergency categories only, and the database refuses any other report about it.
 */
export async function fetchReportableTrips(): Promise<ReportableTrip[]> {
  const { data, error } = await supabase
    .from('booking')
    .select('booking_id, booking_status, pickup_address, dropoff_address, created_at')
    .in('booking_status', ['Completed', 'Cancelled', ...BOOKING_OPEN_STATUSES])
    .not('driver_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    bookingId: b.booking_id as string,
    label: `${b.pickup_address || 'Pickup'} > ${b.dropoff_address || 'Drop-off'}`,
    dateLabel: formatDate(b.created_at as string),
    emergencyOnly: b.booking_status !== 'Completed',
    state: b.booking_status === 'Completed' ? 'completed' : b.booking_status === 'Cancelled' ? 'cancelled' : 'in_progress',
  }));
}

/** Uploads the (optional) photo, then files the report. Throws an Error whose message can be shown to the passenger. */
export async function submitIncidentReport(input: {
  bookingId: string;
  category: string;
  description: string;
  /** up to 3 photos (F11.2: JPEG, PNG or WebP, 5 MB each) */
  files?: File[];
}): Promise<{ incidentId: string }> {
  const evidencePaths = await uploadIncidentEvidenceFiles(supabase, input.files ?? []);

  const { data, error } = await supabase
    .from('incident_report')
    .insert({
      booking_id: input.bookingId,
      category: input.category,
      description: input.description.trim(),
      evidence_paths: evidencePaths,
    })
    .select('incident_id')
    .single();
  if (error || !data) throw new Error(error?.message || 'Hindi naisumite ang ulat. (The report could not be submitted.)');
  return { incidentId: data.incident_id as string };
}

/** All of the signed-in passenger's reports, newest first (the database only returns their own). */
export async function fetchMyIncidentReports(): Promise<IncidentReportItem[]> {
  const { data, error } = await supabase
    .from('incident_report')
    .select(INCIDENT_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as IncidentRow[]).map(toItem);
}

export async function fetchMyIncidentReport(incidentId: string): Promise<IncidentReportItem | null> {
  const { data, error } = await supabase.from('incident_report').select(INCIDENT_COLUMNS).eq('incident_id', incidentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toItem(data as unknown as IncidentRow) : null;
}

/** Withdraws a report that nobody has started reviewing. Throws when it is already being reviewed. */
export async function withdrawIncidentReport(incidentId: string, reason: string): Promise<void> {
  const { data, error } = await supabase
    .from('incident_report')
    .update({ status: 'Cancelled', cancellation_reason: reason.trim() })
    .eq('incident_id', incidentId)
    .eq('status', 'Pending')
    .select('incident_id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('Sinusuri na ang ulat na ito kaya hindi na ito maaaring bawiin. (This report is already being reviewed and can no longer be withdrawn.)');
  }
}

/** Short-lived links for the photos of one of the passenger's own reports. */
export function incidentEvidenceFiles(paths: string[]): Promise<IncidentEvidenceFile[]> {
  return signIncidentEvidence(supabase, paths);
}
