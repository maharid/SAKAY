/**
 * ============================================================================
 * DRIVER PRESENCE SERVICE (Batch 4)
 * ============================================================================
 * Thin, typed wrappers around the database functions that decide whether a driver
 * is Online (migrations 20261005000001 / 20261005000002). The database is the only
 * authority: nothing here writes driver.availability_status or the driver's location
 * directly, and every result is the server's answer, never the app's guess.
 * ============================================================================
 */

import { supabase } from './supabaseClient';

export interface PresenceSession {
  session_id: string;
  started_at: string;
  last_heartbeat_at: string;
  unanswered_streak: number;
  reminder_sent_at: string | null;
  offline_pending_reason: string | null;
}

export type PresenceEndReason =
  | 'manual'
  | 'auto_inactivity'
  | 'location_permission_revoked'
  | 'stale_heartbeat'
  | 'system';

/** Result of any presence function. On failure `success` is false and `error_code` says why. */
export interface PresenceResult {
  success: boolean;
  error_code?: string;
  error?: string;
  online?: boolean;
  availability_status?: 'Offline' | 'Available' | 'Busy';
  active_toda_id?: string | null;
  active_affiliation_id?: string | null;
  open_booking?: boolean;
  session?: PresenceSession | null;
  last_session_end?: { reason: PresenceEndReason; ended_at: string } | null;
  already_online?: boolean;
  already_offline?: boolean;
  deferred?: boolean;
  reauth_required?: boolean;
  location_accepted?: boolean;
  location_rejected_reason?: 'no_position' | 'low_accuracy' | null;
  server_time?: string;
}

export interface PositionFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** When the device took the fix (ms since epoch). */
  timestamp?: number;
}

/**
 * The login-session token stored at login (Batch 2). The database compares it with driver.session_id so only the
 * device that logged in last can act (Rule 29.1). Null when nothing is stored.
 */
function loginSessionToken(): string | null {
  try {
    return localStorage.getItem('sakay_driver_session_token');
  } catch {
    return null;
  }
}

function failure(error: unknown): PresenceResult {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || 'Network error';
  return { success: false, error_code: 'ERR_NETWORK', error: message };
}

async function call(fn: string, args?: Record<string, unknown>): Promise<PresenceResult> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return failure(error);
    return (data ?? { success: false, error_code: 'ERR_EMPTY' }) as PresenceResult;
  } catch (err) {
    return failure(err);
  }
}

/** What the server believes right now (used on open, refresh and when the app returns to the foreground). */
export function fetchMyPresence(): Promise<PresenceResult> {
  return call('get_my_driver_presence', { p_session_token: loginSessionToken() });
}

/** Every precondition (verified, affiliation, documents, suspension, fresh accurate location) is checked in the database. */
export function requestGoOnline(fix: PositionFix): Promise<PresenceResult> {
  const ageMs = fix.timestamp ? Math.max(0, Date.now() - fix.timestamp) : 0;
  return call('driver_go_online', {
    p_latitude: fix.latitude,
    p_longitude: fix.longitude,
    p_accuracy_m: fix.accuracy,
    p_position_age_ms: Math.round(ageMs),
    p_session_token: loginSessionToken(),
  });
}

/** Refused only while an accepted booking is open (Rule 5.5). */
export function requestGoOffline(): Promise<PresenceResult> {
  return call('driver_go_offline');
}

/** The one location publisher. A missing fix still proves the app is alive. */
export function sendHeartbeat(fix: PositionFix | null): Promise<PresenceResult> {
  return call('driver_heartbeat', {
    p_latitude: fix ? fix.latitude : null,
    p_longitude: fix ? fix.longitude : null,
    p_accuracy_m: fix ? fix.accuracy : null,
    p_session_token: loginSessionToken(),
  });
}

/** Location permission was revoked (Rule 17.7). Goes Offline now, or when an open booking ends. */
export function reportLocationUnavailable(detail: string): Promise<PresenceResult> {
  return call('driver_report_location_unavailable', { p_detail: detail });
}

export interface AffiliationOption {
  affiliationId: string;
  todaId: string;
  todaName: string;
  todaAcronym: string;
  coverage: string;
  isActive: boolean;
  /** Fully verified by the TODA and the LGU and the TODA itself is active and unexpired. */
  isSelectable: boolean;
  statusLabel: string;
}

/**
 * The driver's OWN affiliations (Rules 3.1 / 3.10). Only verified ones can be selected.
 * They come from a database function that returns only the caller's rows together with each TODA's display fields (name, status,
 * accreditation expiry): the toda table itself is not readable by a driver, so an embed of it would come back empty.
 */
export async function fetchMyAffiliationOptions(_driverId?: string): Promise<AffiliationOption[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_toda_affiliations');
    if (error || !data) return [];

    const today = new Date().toISOString().slice(0, 10);
    return (data as any[]).map((row: any) => {
      const verified = row.toda_endorsement_status === 'Endorsed' && row.lgu_verification_status === 'Approved';
      const todaOk = row.toda_status === 'Active' && (!row.certificate_expiry || String(row.certificate_expiry).slice(0, 10) >= today);
      let statusLabel = 'Verified';
      if (!verified) {
        statusLabel = row.toda_endorsement_status !== 'Endorsed' ? `TODA review: ${row.toda_endorsement_status}` : `LGU review: ${row.lgu_verification_status}`;
      } else if (!todaOk) {
        statusLabel = 'TODA accreditation inactive or expired';
      }
      return {
        affiliationId: row.affiliation_id,
        todaId: row.toda_id,
        todaName: row.toda_name || 'TODA',
        todaAcronym: row.toda_acronym || 'TODA',
        coverage: row.service_coverage_area || row.barangay || 'Calapan City',
        isActive: !!row.is_active_selection,
        isSelectable: verified && todaOk,
        statusLabel,
      };
    });
  } catch {
    return [];
  }
}
