/**
 * Incident reports from the driver's side (Policy Section 19). The same pipeline the passenger uses: a report is always about a TRIP the
 * reporter took part in, and the database (incident_report_guard, migration 20261012000001) decides the reporter's role, the passenger, the
 * driver, the TODA and the starting status from the booking and the signed-in user, so none of that is sent from here. A driver can report
 * only a trip they drove; anything else is refused by the database, not by this screen.
 */
import { supabase } from './supabaseClient';
import { uploadIncidentEvidence } from '@sakay/shared';

/** A completed trip the driver can report about. */
export interface ReportableTrip {
  bookingId: string;
  label: string;
  dateLabel: string;
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

/** The driver's completed trips, newest first (policy 16.5: a report is made after the trip). The database only returns trips they took part in. */
export async function fetchReportableTrips(): Promise<ReportableTrip[]> {
  const { data, error } = await supabase
    .from('booking')
    .select('booking_id, pickup_address, dropoff_address, created_at')
    .eq('booking_status', 'Completed')
    .not('driver_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    bookingId: b.booking_id as string,
    label: `${b.pickup_address || 'Pickup'} > ${b.dropoff_address || 'Drop-off'}`,
    dateLabel: formatDate(b.created_at as string),
  }));
}

/** Uploads the (optional) photo, then files the report. Throws an Error whose message can be shown to the driver. */
export async function submitIncidentReport(input: {
  bookingId: string;
  category: string;
  description: string;
  file?: File | null;
}): Promise<{ incidentId: string }> {
  const evidencePaths: string[] = [];
  if (input.file) evidencePaths.push(await uploadIncidentEvidence(supabase, input.file));

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
  if (error || !data) {
    // The database's own words (Filipino and English), without its internal error code
    throw new Error((error?.message || 'Hindi naisumite ang ulat. (The report could not be submitted.)').replace(/^ERR_[A-Z_]+:\s*/, ''));
  }
  return { incidentId: data.incident_id as string };
}
