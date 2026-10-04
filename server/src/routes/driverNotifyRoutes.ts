import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendRawSms } from '../services/smsService';
import { supabase as defaultSupabase } from '../config/supabase';
import { isPhMobile, maskPhone } from '../utils/phone';

/**
 * POST /api/admin/notify/driver: the LGU tells a driver applicant the outcome of their application by SMS.
 *
 * The LGU portal used to do this through the SMS relay (any number, any text, from anybody). Now the browser says only WHICH message and
 * for WHICH driver:
 *   - the caller is a signed-in LGU administrator (requireRole('lgu') runs before this router);
 *   - the number is the contact number of the driver's own record, never one that came with the request;
 *   - the text comes from a fixed template (only the driver's first name, the TODA name and a short reason are filled in);
 *   - a message is refused when the record does not support it: "approved" only for a Verified driver, "rejected" only for a Rejected
 *     one, "returned" only for a driver whose application was returned for correction.
 */
export type DriverNotificationKind = 'approved' | 'rejected' | 'returned';

/** What the driver's account_status must be for each message. */
export const REQUIRED_STATUS: Record<DriverNotificationKind, string> = {
  approved: 'Verified',
  rejected: 'Rejected',
  returned: 'Resubmission Required',
};

const DOCUMENT_NAMES: Record<string, string> = {
  license: "Driver's License",
  mtop: 'MTOP / Franchise',
  tricycle: 'Photo ng Tricycle',
  selfie: 'Photo / Selfie',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DriverNotifyDeps {
  supabase: SupabaseClient | null;
  sendRawSms: typeof sendRawSms;
}

/** Plain text of at most `max` characters: control characters become spaces. */
const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The message for one outcome. Exported for the tests. */
export function buildDriverMessage(
  kind: DriverNotificationKind,
  parts: { firstName: string; todaName?: string; reason?: string; notes?: string; documents?: string[] }
): string {
  const first = parts.firstName || 'Drayber';
  if (kind === 'approved') {
    return `SAKAY Alert: Magandang araw, ${first}! Ang iyong aplikasyon bilang drayber ay opisyal nang inaprubahan ng City LGU Franchising Office at ${parts.todaName || 'TODA'}. Beripikado na ang iyong account! Maaari ka nang mag-log in sa SAKAY Driver app upang magsimulang pumasada. Ingat sa biyahe!`;
  }
  if (kind === 'rejected') {
    return `SAKAY Alert: Paumanhin, ${first}. Ang iyong aplikasyon bilang drayber ay hindi naaprubahan ng City LGU. Dahilan: ${parts.reason || 'Hindi natugunan ang mga kinakailangan'}. Para sa katanungan, maaaring sumangguni sa City Franchising Office.`;
  }
  const docs = (parts.documents ?? []).map((d) => DOCUMENT_NAMES[d]).filter(Boolean).join(', ') || DOCUMENT_NAMES.license;
  return `SAKAY Alert: Magandang araw, ${first}! May kailangang iwasto sa iyong ${docs} para sa SAKAY Driver registration. Dahilan: ${parts.notes || parts.reason || 'Pakisuri ang iyong dokumento'}. Pakibuksan ang app upang mai-resubmit ang iyong dokumento.`;
}

export function createDriverNotifyRouter(deps: DriverNotifyDeps): Router {
  const router = Router();
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

  router.post('/driver', async (req: Request, res: Response): Promise<void> => {
    try {
      const { driverId, kind, reason, notes, documents } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof driverId !== 'string' || !UUID.test(driverId)) { fail(res, 400, 'A valid driver id is required.'); return; }
      if (typeof kind !== 'string' || !(kind in REQUIRED_STATUS)) { fail(res, 400, 'Unknown notification type.'); return; }
      const type = kind as DriverNotificationKind;
      if (!deps.supabase) { fail(res, 503, 'Messaging is temporarily unavailable.'); return; }

      const found = await deps.supabase
        .from('driver')
        .select('driver_id, full_name, contact_number, account_status, toda_id')
        .eq('driver_id', driverId)
        .maybeSingle();
      if (found.error) { console.error('[DriverNotify] driver lookup:', found.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const driver = found.data as { full_name: string | null; contact_number: string | null; account_status: string; toda_id: string | null } | null;
      if (!driver) { fail(res, 404, 'Driver not found.'); return; }
      if (driver.account_status !== REQUIRED_STATUS[type]) {
        fail(res, 409, `This message needs the driver's status to be "${REQUIRED_STATUS[type]}"; it is "${driver.account_status}".`);
        return;
      }
      if (!driver.contact_number || !isPhMobile(driver.contact_number)) { fail(res, 422, 'The driver has no valid mobile number on record.'); return; }

      let todaName: string | undefined;
      if (type === 'approved' && driver.toda_id) {
        const toda = await deps.supabase.from('toda').select('toda_name').eq('toda_id', driver.toda_id).maybeSingle();
        todaName = clean((toda.data as { toda_name?: string } | null)?.toda_name, 60) || undefined;
      }

      const text = buildDriverMessage(type, {
        firstName: clean(driver.full_name, 60).split(' ')[0],
        todaName,
        reason: clean(reason, 200),
        notes: clean(notes, 200),
        documents: Array.isArray(documents) ? documents.filter((d): d is string => typeof d === 'string').slice(0, 4) : undefined,
      });

      const result = await deps.sendRawSms(driver.contact_number, text);
      if (!result.success) { console.warn(`[DriverNotify] SMS to ${maskPhone(driver.contact_number)} failed: ${result.error}`); fail(res, 502, result.error || 'Failed to dispatch SMS.'); return; }
      res.json({ success: true, message: 'SMS sent successfully.' });
    } catch (err) {
      console.error('[DriverNotify] error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error while sending SMS.');
    }
  });

  return router;
}

// ── the TODA administrator's side ─────────────────────────────────────────────────────────────────────────────────────────────────
// POST /api/toda-admin/notify/driver: a TODA administrator tells an applicant of THEIR OWN TODA what the TODA decided.
// Same rules as above, with the TODA's own checks: the driver must belong to the caller's TODA, and the message must match the stage
// the driver's verification record is in (endorsed -> Approved by the TODA, returned -> Resubmission Required, rejected -> Rejected).
export type TodaNotificationKind = 'endorsed' | 'returned' | 'rejected';

export const REQUIRED_VERIFICATION_STATUS: Record<TodaNotificationKind, string> = {
  endorsed: 'Approved',
  returned: 'Resubmission Required',
  rejected: 'Rejected',
};

/** The TODA's message for one decision. Exported for the tests. */
export function buildTodaDriverMessage(
  kind: TodaNotificationKind,
  parts: { firstName: string; todaName?: string; reason?: string }
): string {
  const first = parts.firstName || 'Drayber';
  if (kind === 'endorsed') {
    return `SAKAY Update: Magandang araw, ${first}! Ang iyong aplikasyon bilang drayber ay naaprubahan at na-endorso na ng ${parts.todaName || 'iyong TODA'}. Kasalukuyan na itong ipinasa sa Calapan City LGU Franchising Office para sa pinal na beripikasyon. Makakatanggap ka muli ng mensahe kapag natapos ang pagsusuri.`;
  }
  if (kind === 'returned') {
    return `SAKAY Update: Magandang araw, ${first}! May kailangang iwasto o linawin sa iyong isinumiteng dokumento para sa TODA registration. Dahilan: ${parts.reason || 'Pakisuri ang iyong dokumento'}. Pakibuksan ang app upang ma-resubmit ang iyong aplikasyon.`;
  }
  return `SAKAY Update: Paumanhin, ${first}. Ang iyong aplikasyon bilang drayber ay hindi naaprubahan ng TODA. Dahilan: ${parts.reason || 'Hindi natugunan ang mga kinakailangan'}. Para sa katanungan, maaaring sumangguni sa pamunuan ng TODA.`;
}

export function createTodaDriverNotifyRouter(deps: DriverNotifyDeps): Router {
  const router = Router();
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

  router.post('/driver', async (req: Request, res: Response): Promise<void> => {
    try {
      const todaId = req.actor?.todaAdmin?.todaId;
      if (!todaId) { fail(res, 403, 'Only a TODA administrator can send this message.'); return; }

      const { driverId, kind, reason } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof driverId !== 'string' || !UUID.test(driverId)) { fail(res, 400, 'A valid driver id is required.'); return; }
      if (typeof kind !== 'string' || !(kind in REQUIRED_VERIFICATION_STATUS)) { fail(res, 400, 'Unknown notification type.'); return; }
      const type = kind as TodaNotificationKind;
      if (!deps.supabase) { fail(res, 503, 'Messaging is temporarily unavailable.'); return; }

      const found = await deps.supabase
        .from('driver')
        .select('driver_id, full_name, contact_number, toda_id')
        .eq('driver_id', driverId)
        .maybeSingle();
      if (found.error) { console.error('[TodaNotify] driver lookup:', found.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const driver = found.data as { full_name: string | null; contact_number: string | null; toda_id: string | null } | null;
      // a driver of another TODA is reported exactly like one that does not exist
      if (!driver || driver.toda_id !== todaId) { fail(res, 404, 'Driver not found.'); return; }

      const verif = await deps.supabase
        .from('driver_verification')
        .select('verification_status')
        .eq('driver_id', driverId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (verif.error) { console.error('[TodaNotify] verification lookup:', verif.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const status = (verif.data as { verification_status?: string } | null)?.verification_status;
      if (status !== REQUIRED_VERIFICATION_STATUS[type]) {
        fail(res, 409, `This message needs the application's status to be "${REQUIRED_VERIFICATION_STATUS[type]}"; it is "${status ?? 'not submitted'}".`);
        return;
      }
      if (!driver.contact_number || !isPhMobile(driver.contact_number)) { fail(res, 422, 'The driver has no valid mobile number on record.'); return; }

      let todaName: string | undefined;
      if (type === 'endorsed') {
        const toda = await deps.supabase.from('toda').select('toda_name, toda_acronym').eq('toda_id', todaId).maybeSingle();
        const row = toda.data as { toda_name?: string; toda_acronym?: string } | null;
        const name = clean(row?.toda_name, 60);
        todaName = name ? `${name}${row?.toda_acronym ? ` (${clean(row.toda_acronym, 12)})` : ''}` : undefined;
      }

      const text = buildTodaDriverMessage(type, {
        firstName: clean(driver.full_name, 60).split(' ')[0],
        todaName,
        reason: clean(reason, 200),
      });
      const result = await deps.sendRawSms(driver.contact_number, text);
      if (!result.success) { console.warn(`[TodaNotify] SMS to ${maskPhone(driver.contact_number)} failed: ${result.error}`); fail(res, 502, result.error || 'Failed to dispatch SMS.'); return; }
      res.json({ success: true, message: 'SMS sent successfully.' });
    } catch (err) {
      console.error('[TodaNotify] error:', err instanceof Error ? err.message : err);
      fail(res, 500, 'Internal server error while sending SMS.');
    }
  });

  return router;
}

export const todaDriverNotifyRouter = createTodaDriverNotifyRouter({ supabase: defaultSupabase, sendRawSms });

export default createDriverNotifyRouter({ supabase: defaultSupabase, sendRawSms });
