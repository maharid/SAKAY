import { adminActionMessage, reportAvailabilityArgs } from '@sakay/shared';
import type { AvailabilityKind } from '@sakay/shared';

import { supabase } from './supabaseClient';

/**
 * Rule 5.7: a passenger reports that the driver of one of HER trips accepted the booking while already carrying other passengers (or was working the terminal queue).
 * A report only: nothing is struck until an administrator confirms it. The database decides who may report (only a passenger the driver served, for that trip) and
 * which driver: the driver is read from the booking itself, never typed. Resolves to null when the report was filed, otherwise to what the database said.
 */
export async function reportDriverOfTrip(bookingId: string, kind: AvailabilityKind, description: string): Promise<string | null> {
  const { data: booking, error: readError } = await supabase.from('booking').select('driver_id').eq('booking_id', bookingId).maybeSingle();
  if (readError || !booking?.driver_id) return 'This trip has no driver to report.';
  const { error } = await supabase.rpc('report_driver_availability_violation', reportAvailabilityArgs(String(booking.driver_id), kind, bookingId, description));
  return error ? adminActionMessage(error.message, 'The report could not be sent.') : null;
}
