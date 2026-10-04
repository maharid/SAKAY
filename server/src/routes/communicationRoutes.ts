import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendRawSms } from '../services/smsService';
import { supabase as defaultSupabase } from '../config/supabase';
import { isPhMobile, samePhone } from '../utils/phone';

/**
 * POST /api/communication/send-sms: a driver texts the passenger of the trip they are on.
 *
 * This used to be an open SMS relay (anybody, any number, any text, on the project's SIM). Now:
 *   - the caller must be a signed-in, VERIFIED driver (requireAuth + attachActor run before this router);
 *   - the only number it will text is the passenger of one of THIS driver's trips that is live right now;
 *   - the text is at most 140 characters, with control characters removed;
 *   - the sender label comes from the driver's record, not from the request.
 */
export const MAX_MESSAGE_LENGTH = 140;

/** Statuses of a trip a driver is committed to (the same list as the database function _booking_is_open_accepted). */
export const LIVE_TRIP_STATUSES = [
  'Accepted', 'Assigned', 'Driver Assigned', 'Driver En Route', 'Heading to Passenger',
  'Driver Arrived', 'Arrived at Pickup', 'In Transit', 'Trip Ongoing', 'Ongoing', 'Arrived at Destination',
];

export interface CommunicationDeps {
  supabase: SupabaseClient | null;
  sendRawSms: typeof sendRawSms;
}

const clean = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

export function createCommunicationRouter(deps: CommunicationDeps): Router {
  const router = Router();

  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

  router.post('/send-sms', async (req: Request, res: Response): Promise<void> => {
    try {
      const driver = req.actor?.driver;
      if (!driver) { fail(res, 403, 'Only drivers can send messages to passengers.'); return; }
      if (driver.accountStatus !== 'Verified') { fail(res, 403, 'Only a verified driver can message a passenger.'); return; }

      const { phone, message } = (req.body ?? {}) as { phone?: unknown; message?: unknown };
      if (typeof phone !== 'string' || !isPhMobile(phone)) { fail(res, 400, 'A valid Philippine mobile number is required.'); return; }
      if (typeof message !== 'string') { fail(res, 400, 'Message content is required.'); return; }
      const text = clean(message);
      if (text.length === 0) { fail(res, 400, 'Message content cannot be empty.'); return; }
      if (text.length > MAX_MESSAGE_LENGTH) { fail(res, 400, `Message is too long (maximum ${MAX_MESSAGE_LENGTH} characters).`); return; }

      if (!deps.supabase) { fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const trips = await deps.supabase.from('booking').select('passenger_id')
        .eq('driver_id', driver.driverId).in('booking_status', LIVE_TRIP_STATUSES).limit(5);
      if (trips.error) { console.error('[Communication] trip lookup:', trips.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const passengerIds = (trips.data ?? []).map((t: { passenger_id: string }) => t.passenger_id).filter(Boolean);
      if (passengerIds.length === 0) { fail(res, 403, 'You can message a passenger only while you are on an active trip with them.'); return; }

      const pax = await deps.supabase.from('passenger').select('contact_number').in('passenger_id', passengerIds);
      if (pax.error) { console.error('[Communication] passenger lookup:', pax.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      if (!(pax.data ?? []).some((p: { contact_number: string | null }) => samePhone(p.contact_number, phone))) {
        fail(res, 403, 'That number is not the passenger of your current trip.');
        return;
      }

      const label = clean(driver.fullName ?? 'Driver').slice(0, 20) || 'Driver';
      const result = await deps.sendRawSms(phone, `[SAKAY Driver ${label}]: ${text}`);
      if (!result.success) { fail(res, 502, result.error || 'Failed to dispatch SMS.'); return; }
      res.json({ success: true, message: 'SMS sent successfully.' });
    } catch (err) {
      console.error('[Communication Route] Send SMS error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error while sending SMS.');
    }
  });

  return router;
}

export default createCommunicationRouter({ supabase: defaultSupabase, sendRawSms });
