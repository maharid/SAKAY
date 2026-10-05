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
 *   - a driver may be affiliated with several TODAs and each affiliation is decided on its own. When the request carries an
 *     `affiliationId`, the message is checked against THAT affiliation (its LGU stage) and names THAT TODA; the driver's overall
 *     account_status is then not what decides it (it can be Verified through another TODA, or still Pending after one rejection).
 */
export type DriverNotificationKind = 'approved' | 'rejected' | 'returned';

/** What the driver's account_status must be for each message. */
export const REQUIRED_STATUS: Record<DriverNotificationKind, string> = {
  approved: 'Verified',
  rejected: 'Rejected',
  returned: 'Resubmission Required',
};

/** What the LGU stage of ONE affiliation must be for each message. */
export const REQUIRED_LGU_AFFILIATION_STATUS: Record<DriverNotificationKind, string> = {
  approved: 'Approved',
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
      const { driverId, kind, reason, notes, documents, affiliationId } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof driverId !== 'string' || !UUID.test(driverId)) { fail(res, 400, 'A valid driver id is required.'); return; }
      if (typeof kind !== 'string' || !(kind in REQUIRED_STATUS)) { fail(res, 400, 'Unknown notification type.'); return; }
      if (affiliationId !== undefined && (typeof affiliationId !== 'string' || !UUID.test(affiliationId))) { fail(res, 400, 'The affiliation id is not valid.'); return; }
      const type = kind as DriverNotificationKind;
      if (!deps.supabase) { fail(res, 503, 'Messaging is temporarily unavailable.'); return; }

      // One affiliation (the TODA the LGU just decided on), or the legacy driver-level message.
      let affiliationTodaId: string | null = null;
      if (typeof affiliationId === 'string') {
        const aff = await deps.supabase
          .from('driver_toda_affiliation')
          .select('affiliation_id, driver_id, toda_id, lgu_verification_status')
          .eq('affiliation_id', affiliationId)
          .maybeSingle();
        if (aff.error) { console.error('[DriverNotify] affiliation lookup:', aff.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
        const row = aff.data as { driver_id: string; toda_id: string; lgu_verification_status: string } | null;
        if (!row || row.driver_id !== driverId) { fail(res, 404, 'Affiliation not found.'); return; }
        if (row.lgu_verification_status !== REQUIRED_LGU_AFFILIATION_STATUS[type]) {
          fail(res, 409, `This message needs the affiliation's LGU stage to be "${REQUIRED_LGU_AFFILIATION_STATUS[type]}"; it is "${row.lgu_verification_status}".`);
          return;
        }
        affiliationTodaId = row.toda_id;
      }

      const found = await deps.supabase
        .from('driver')
        .select('driver_id, full_name, contact_number, account_status, toda_id')
        .eq('driver_id', driverId)
        .maybeSingle();
      if (found.error) { console.error('[DriverNotify] driver lookup:', found.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const driver = found.data as { full_name: string | null; contact_number: string | null; account_status: string; toda_id: string | null } | null;
      if (!driver) { fail(res, 404, 'Driver not found.'); return; }
      if (affiliationTodaId === null && driver.account_status !== REQUIRED_STATUS[type]) {
        fail(res, 409, `This message needs the driver's status to be "${REQUIRED_STATUS[type]}"; it is "${driver.account_status}".`);
        return;
      }
      if (!driver.contact_number || !isPhMobile(driver.contact_number)) { fail(res, 422, 'The driver has no valid mobile number on record.'); return; }

      let todaName: string | undefined;
      const namedTodaId = affiliationTodaId ?? driver.toda_id;
      if (type === 'approved' && namedTodaId) {
        const toda = await deps.supabase.from('toda').select('toda_name').eq('toda_id', namedTodaId).maybeSingle();
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
// Same rules as above, with the TODA's own checks, now PER AFFILIATION: the driver must have an affiliation with the caller's TODA
// (a driver can apply to several TODAs, and driver.toda_id points at only one of them), and the message must match the TODA stage of
// THAT affiliation (endorsed -> Endorsed, returned -> Resubmission Required, rejected -> Rejected). What another TODA decided about the
// same driver changes nothing here.
export type TodaNotificationKind = 'endorsed' | 'returned' | 'rejected';

export const REQUIRED_AFFILIATION_STATUS: Record<TodaNotificationKind, string> = {
  endorsed: 'Endorsed',
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
      if (typeof kind !== 'string' || !(kind in REQUIRED_AFFILIATION_STATUS)) { fail(res, 400, 'Unknown notification type.'); return; }
      const type = kind as TodaNotificationKind;
      if (!deps.supabase) { fail(res, 503, 'Messaging is temporarily unavailable.'); return; }

      // The affiliation of THIS driver with the caller's TODA. A driver who never applied to this TODA is reported exactly like one that
      // does not exist.
      const aff = await deps.supabase
        .from('driver_toda_affiliation')
        .select('affiliation_id, toda_endorsement_status')
        .eq('driver_id', driverId)
        .eq('toda_id', todaId)
        .maybeSingle();
      if (aff.error) { console.error('[TodaNotify] affiliation lookup:', aff.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const affiliation = aff.data as { toda_endorsement_status?: string } | null;
      if (!affiliation) { fail(res, 404, 'Driver not found.'); return; }

      const found = await deps.supabase
        .from('driver')
        .select('driver_id, full_name, contact_number')
        .eq('driver_id', driverId)
        .maybeSingle();
      if (found.error) { console.error('[TodaNotify] driver lookup:', found.error.message); fail(res, 503, 'Messaging is temporarily unavailable.'); return; }
      const driver = found.data as { full_name: string | null; contact_number: string | null } | null;
      if (!driver) { fail(res, 404, 'Driver not found.'); return; }

      const status = affiliation.toda_endorsement_status;
      if (status !== REQUIRED_AFFILIATION_STATUS[type]) {
        fail(res, 409, `This message needs the application's status to be "${REQUIRED_AFFILIATION_STATUS[type]}"; it is "${status ?? 'not submitted'}".`);
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
