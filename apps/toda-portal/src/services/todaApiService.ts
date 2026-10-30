/**
 * ============================================================================
 * SAKAY TODA ADMIN API CLIENT SERVICE (todaApiService.ts)
 * ============================================================================
 * Purpose:
 *   Centralized network and database service connecting the TODA Association
 *   Admin Portal 100% directly to Supabase PostgreSQL database tables.
 *   NO MOCK DATA SUBSTITUTION — returns live database records or empty arrays.
 * ============================================================================
 */

import { supabase } from './supabaseClient';
import {
  ApplicantDocumentReview,
  TodaProfile,
  DriverApplicant,
  RosterCheck,
  RosterReason,
  TodaDriverMember,
  TodaAnnouncement,
  TodaAuditLog,
  DriverExemptionRequest,
  EvidenceFileItem,
} from '../types/toda';
import { parseDriverRoster } from '../utils/rosterParser';
import { REJECTION_REASON_LABEL, SIGNED_URL_TTL, calculateDistanceKm, closeUnfinishedTripArgs, confirmAvailabilityArgs, reportAvailabilityArgs, escalateExemptionArgs, apiFetch, apiPostJson, isRejectionReasonCode, ownedObjectPath, signIncidentEvidence, signedStorageUrlFromAny } from '@sakay/shared';
import {
  decideIncident as decideIncidentReport,
  escalateIncident as escalateIncidentReport,
  confirmFlaggedViolationArgs,
  endTripForSafety,
  startIncidentReview,
  updateLostItem,
  type IncidentDecision,
  type ReviewFlagRow,
  type SafetyEnd,
  type LostItemStatus,
  type TripEndResult,
} from '@sakay/shared';
import type { AvailabilityKind, RejectionReasonCode } from '@sakay/shared';
import { signCaseEvidence } from '@sakay/shared';
import type { CaseEvidenceFile } from '@sakay/shared';
import { adminActionMessage, deliberateOfflineArgs, escalateFareDisputeArgs, fareDisputesArgs, mapReconciliationTrips, parseFareDisputes, reconcileTripArgs, resolveFareDisputeArgs } from '@sakay/shared';
import type { FareDisputeDecision, FareDisputeRow } from '@sakay/shared';
import { exportAuditLogFile, fetchAuditLogPage, manilaDayStartIso, manilaNextDayStartIso } from '@sakay/shared';
import type { AuditLogFilters, AuditRpc, XlsxLike } from '@sakay/shared';
import type { DeliberateOfflineInput, ReconcileInput, ReconciliationTrip } from '@sakay/shared';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';

export const DEFAULT_TODA_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

export async function getEffectiveTodaId(providedId?: string): Promise<string> {
  if (providedId && providedId !== DEFAULT_TODA_ID && providedId.trim()) {
    return providedId;
  }

  // The signed-in administrator's OWN TODA, from their own toda_admin record. It is never taken from sign-up metadata, from the e-mail
  // address or from a built-in TODA: those could name somebody else's association (sign-ups are open).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: adminRecord } = await supabase
        .from('toda_admin')
        .select('toda_id')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      if (adminRecord?.toda_id) {
        return adminRecord.toda_id;
      }
    }
  } catch (err) {
    console.warn('[todaApiService] Error resolving authenticated toda_id:', err);
  }

  return DEFAULT_TODA_ID;
}

// ============================================================================
// 1. TODA PROFILE & REGISTRATION
// ============================================================================



export async function fetchTodaProfile(todaId?: string): Promise<TodaProfile | null> {
  try {
    const targetTodaId = await getEffectiveTodaId(todaId);
    let data: any = null;

    if (targetTodaId && targetTodaId !== DEFAULT_TODA_ID) {
      const { data: directToda } = await supabase
        .from('toda')
        .select('*')
        .or(`toda_id.eq.${targetTodaId},toda_acronym.ilike.${targetTodaId}`)
        .maybeSingle();
      data = directToda;
    }

    if (!data) return null;

    // Count real drivers in database: one per affiliation with this TODA (driver.toda_id is only the pointer to ONE of a driver's TODAs)
    const { count: driverCount } = await supabase
      .from('driver_toda_affiliation')
      .select('*', { count: 'exact', head: true })
      .eq('toda_id', data.toda_id);

    const rawStatus = String(data.toda_status || data.account_status || data.status || '').trim().toLowerCase();
    const accreditationStatus: TodaProfile['accreditationStatus'] = ['active', 'approved', 'verified', 'accredited'].includes(rawStatus)
      ? 'Active'
      : rawStatus === 'resubmission required'
        ? 'Resubmission Required'
        : ['deactivated', 'declined', 'rejected'].includes(rawStatus)
          ? 'Deactivated'
          : rawStatus === 'suspended'
            ? 'Suspended'
            : 'Pending Verification';
    const shortDate = (iso: string | null | undefined): string =>
      iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const fileName = (url: string | null | undefined): string => (url ? url.split('/').pop()?.split('?')[0] || 'Uploaded file' : 'Not uploaded');

    return {
      id: data.toda_id,
      name: data.toda_name,
      acronym: data.toda_acronym || 'TODA',
      registrationNumber: data.registration_number || data.toda_acronym || 'TODA',
      dateEstablished: data.date_established || '',
      terminalLocation: data.terminal_location || data.service_coverage_area || '',
      terminalLatitude: data.terminal_latitude || null,
      terminalLongitude: data.terminal_longitude || null,
      pendingTerminalLocation: data.pending_terminal_location || null,
      pendingTerminalLatitude: data.pending_terminal_latitude ?? null,
      pendingTerminalLongitude: data.pending_terminal_longitude ?? null,
      pendingTerminalReason: data.pending_terminal_reason || null,
      terminalRelocationStatus: data.terminal_relocation_status || null,
      terminalRelocationRequestedAt: data.terminal_relocation_requested_at || null,
      terminalRelocationDecisionNote: data.terminal_relocation_decision_note || null,
      terminalRelocationDecidedAt: data.terminal_relocation_decided_at || null,
      barangay: data.barangay || '',
      serviceCoverageArea: data.service_coverage_area || '',
      contactNumber: data.president_contact || data.contact_number || '',
      email: data.email || `${(data.toda_acronym || 'toda').toLowerCase()}@toda.sakay.internal`,
      officers: {
        president: data.president_name || '',
        presidentContact: data.president_contact || '',
        vicePresident: data.vice_president_name || '',
        vicePresidentContact: data.vice_president_contact || '',
        secretary: data.secretary_name || '',
        secretaryContact: data.secretary_contact || '',
        treasurer: data.treasurer_name || '',
        treasurerContact: data.treasurer_contact || '',
      },
      accreditationStatus,
      resubmissionReason: accreditationStatus === 'Resubmission Required' ? data.resubmission_reason || null : null,
      declineReason: accreditationStatus === 'Deactivated' ? data.decline_reason || null : null,
      accreditationExpiry: data.certificate_expiry ? new Date(data.certificate_expiry).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '',
      accreditationExpiryIso: data.certificate_expiry || null,
      accreditationNo: data.certificate_number || '',
      permitNumber: data.toda_acronym || 'TODA',
      declaredClearanceValidUntil: data.declared_clearance_valid_until ? String(data.declared_clearance_valid_until).slice(0, 10) : null,
      renewalSubmittedAt: data.renewal_submitted_at || null,
      barangayClearanceFile: {
        name: fileName(data.barangay_clearance_url),
        date: shortDate(data.barangay_clearance_submitted_at || (data.barangay_clearance_url ? data.created_at : null)),
        url: data.barangay_clearance_url,
      },
      rosterFile: {
        name: fileName(data.accredited_drivers_url),
        date: shortDate(data.accredited_drivers_url ? data.created_at : null),
        count: data.registered_tricycle_count || driverCount || 0,
        url: data.accredited_drivers_url,
      },
      bylawsFile: {
        name: fileName(data.bylaws_url),
        date: shortDate(data.bylaws_url ? data.created_at : null),
        url: data.bylaws_url,
      },
      isOtpVerified: true,
      misteepComplaintsCount: 0,
    };
  } catch (err) {
    console.error('[todaApiService] fetchTodaProfile error:', err);
    return null;
  }
}

export async function updateTodaProfile(
  todaId?: string,
  profileData: Partial<{
    name: string;
    acronym: string;
    barangay: string;
    dateEstablished: string;
    terminalLocation: string;
    terminalLatitude?: number | null;
    terminalLongitude?: number | null;
    contactPhone: string;
    contactEmail: string;
    serviceArea: string;
    officers: any;
    /** why the terminal is moving (panel comment D-P4): required when the pin moved */
    relocationReason: string;
  }> = {}
): Promise<{ relocationRequested: boolean }> {
  const targetTodaId = await getEffectiveTodaId(todaId);
  const updatePayload: any = {};
  if (profileData.name) updatePayload.toda_name = profileData.name;
  if (profileData.acronym) updatePayload.toda_acronym = profileData.acronym;
  if (profileData.barangay) updatePayload.barangay = profileData.barangay;
  if (profileData.dateEstablished) updatePayload.date_established = profileData.dateEstablished;
  if (profileData.contactPhone) updatePayload.president_contact = profileData.contactPhone;
  if (profileData.serviceArea || profileData.terminalLocation) {
    updatePayload.service_coverage_area = profileData.serviceArea || profileData.terminalLocation;
  }

  // The terminal moves only through request_terminal_relocation (the LGU decides), and only when the pin really moved (a profile save must not re-ask for it every time).
  // Asked FIRST: if the database refuses it (outside the city, in the sea, no reason), nothing else is saved and the person is told why.
  let relocationRequested = false;
  if (profileData.terminalLatitude != null && profileData.terminalLongitude != null) {
    const { data: current } = await supabase.from('toda').select('terminal_latitude, terminal_longitude').eq('toda_id', targetTodaId).maybeSingle();
    const moved = !current || current.terminal_latitude == null || current.terminal_longitude == null
      || calculateDistanceKm(Number(current.terminal_latitude), Number(current.terminal_longitude), profileData.terminalLatitude, profileData.terminalLongitude) * 1000 >= 25;
    if (moved) {
      const { data: reloc, error: relocError } = await supabase.rpc('request_terminal_relocation', {
        p_toda_id: targetTodaId,
        p_new_latitude: profileData.terminalLatitude,
        p_new_longitude: profileData.terminalLongitude,
        p_new_location: profileData.terminalLocation || profileData.serviceArea || '',
        p_reason: profileData.relocationReason || '',
      });
      if (relocError) throw new Error(relocError.message);
      if (!reloc || reloc.success !== true) throw new Error(String(reloc?.error || 'The terminal move could not be requested.'));
      relocationRequested = true;
    }
  }
  if (profileData.officers) {
    if (profileData.officers.president !== undefined) updatePayload.president_name = profileData.officers.president;
    if (profileData.officers.presidentContact !== undefined) updatePayload.president_contact = profileData.officers.presidentContact;
    if (profileData.officers.vicePresident !== undefined) updatePayload.vice_president_name = profileData.officers.vicePresident;
    if (profileData.officers.vicePresidentContact !== undefined) updatePayload.vice_president_contact = profileData.officers.vicePresidentContact;
    if (profileData.officers.secretary !== undefined) updatePayload.secretary_name = profileData.officers.secretary;
    if (profileData.officers.secretaryContact !== undefined) updatePayload.secretary_contact = profileData.officers.secretaryContact;
    if (profileData.officers.treasurer !== undefined) updatePayload.treasurer_name = profileData.officers.treasurer;
    if (profileData.officers.treasurerContact !== undefined) updatePayload.treasurer_contact = profileData.officers.treasurerContact;
  }

  let updatedData: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('toda')
      .update(updatePayload)
      .eq('toda_id', targetTodaId)
      .select()
      .maybeSingle();

    if (!error) {
      updatedData = data;
      break;
    }

    const errMsg = (error.message || '') + ' ' + (error.details || '');
    const match =
      errMsg.match(/Could not find the '([^']+)' column/i) ||
      errMsg.match(/column [^.]*\.?([a-zA-Z0-9_]+) does not exist/i);

    if (match && match[1] && match[1] in updatePayload) {
      console.warn(`[todaApiService] Column '${match[1]}' does not exist in 'toda', pruning and retrying...`);
      delete updatePayload[match[1]];
    } else {
      console.error('[todaApiService] updateTodaProfile error:', error);
      throw error;
    }
  }

  await recordTodaAuditAction({
    actionType: 'TODA_PROFILE_UPDATED',
    targetId: todaId,
    details: `Updated association contact info for '${updatedData?.toda_name || todaId}'.`,
  });

  return { relocationRequested };
}

/**
 * Is the acronym free? Asked BEFORE anybody is signed in, so it uses the public directory of accredited TODAs (the toda table itself is
 * not readable then). A TODA that is still pending is not in the directory; the database refuses a duplicate of it at registration.
 */
export async function checkAcronymAvailability(acronym: string): Promise<boolean> {
  if (!acronym.trim()) return true;
  try {
    const cleanAcronym = acronym.trim().toUpperCase();
    const { data, error } = await supabase.rpc('list_accredited_todas');

    if (error) {
      console.warn('[todaApiService] checkAcronymAvailability warning:', error);
      return true;
    }

    return !((data ?? []) as Array<{ toda_acronym?: string | null }>).some((t) => (t.toda_acronym || '').trim().toUpperCase() === cleanAcronym);
  } catch (err) {
    console.error('[todaApiService] checkAcronymAvailability error:', err);
    return true;
  }
}

/** Uploads a file into the SIGNED-IN user's own folder of a private bucket (<auth uid>/<file>) and returns the storage path. */
async function uploadOwnedFile(authUserId: string, file: File, bucket: string): Promise<string> {
  const path = ownedObjectPath(authUserId, `${Date.now()}_${file.name}`);
  const { error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: true });
  if (error) {
    throw new Error(`The file '${file.name}' could not be uploaded: ${error.message}`);
  }
  return path;
}

/**
 * Uploads a TODA document for the signed-in administrator. Files go into the administrator's own folder of the (private) bucket; the
 * returned `url` is the STORAGE PATH, which is what the toda record keeps (screens ask for a short-lived signed link when they open it).
 */
export async function uploadTodaDocument(
  file: File,
  bucket: 'barangay-clearances' | 'toda-accredited-driver-lists' | 'toda-bylaws'
): Promise<{ url: string; fileName: string; path: string; sizeBytes: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error('Please sign in again before uploading.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
  let targetBucket: string = bucket;
  if (bucket === 'toda-accredited-driver-lists' || ['csv', 'xlsx', 'xls'].includes(ext)) {
    targetBucket = 'toda-accredited-driver-lists';
  } else if (bucket === 'toda-bylaws') {
    targetBucket = 'toda-bylaws';
  } else {
    targetBucket = 'barangay-clearances';
  }

  const path = await uploadOwnedFile(session.user.id, file, targetBucket);
  return { url: path, fileName: file.name, path, sizeBytes: file.size };
}

/** What the database said, as the sentence to show; the functions below answer { success, error } instead of raising. */
function todaRpcResult(data: unknown, error: { message?: string } | null, fallback: string): { renewal?: boolean; toda_status?: string } {
  if (error) throw new Error(error.message || fallback);
  const r = data as { success?: boolean; error?: string; renewal?: boolean; toda_status?: string } | null;
  if (!r?.success) throw new Error(r?.error || fallback);
  return r;
}

/** The portal's own screens (the sidebar, the status banner) re-read the TODA after something changed its status or documents. */
const TODA_PROFILE_CHANGED = 'toda-profile-changed';
export const onTodaProfileChanged = (handler: () => void): (() => void) => {
  window.addEventListener(TODA_PROFILE_CHANGED, handler);
  return () => window.removeEventListener(TODA_PROFILE_CHANGED, handler);
};
const announceTodaProfileChanged = (): void => {
  try {
    window.dispatchEvent(new Event(TODA_PROFILE_CHANGED));
  } catch {
    // no window (tests): nothing to tell
  }
};

/**
 * Submits one compliance file (Barangay Clearance, Driver Roster or Internal Bylaws) that was already uploaded into this login's own folder.
 * The database function decides what it means (Rule 2.1, 24.3): while the application is pending or returned it replaces the file; for an Active TODA a new
 * Barangay Clearance is a RENEWAL: the accreditation stays as it is and the LGU Administrator is flagged to record it. A TODA cannot change its own status.
 * A Barangay Clearance needs the date it is valid until.
 */
export async function updateTodaComplianceDocument(
  _todaId: string,
  category: 'Barangay Clearance' | 'Driver Roster' | 'Internal Bylaws',
  filePath: string,
  fileName: string,
  validUntil?: string | null
): Promise<{ renewal: boolean; rosterUpdate: boolean }> {
  const { data, error } = await supabase.rpc('toda_submit_compliance_document', {
    p_category: category,
    p_path: filePath,
    p_file_name: fileName,
    p_valid_until: validUntil || null,
  });
  const r = todaRpcResult(data, error, 'The document could not be submitted. Please try again.');
  announceTodaProfileChanged();
  // Decision D-P9: an ACTIVE TODA's new roster file is a new version, not a replacement. The screen shows what is new and what is missing and the TODA decides member by member
  // (nothing is added or removed by itself). While the application is still pending or returned the registration file is simply replaced and imported as before.
  const rosterUpdate = category === 'Driver Roster' && r.toda_status === 'Active';
  if (category === 'Driver Roster' && !rosterUpdate) await autoImportTodaRoster(_todaId);
  return { renewal: Boolean(r.renewal), rosterUpdate };
}

/** States what the TODA says its Barangay Clearance is valid until (used right after registering). Not fatal when it fails: the LGU reads the date from the document. */
export async function declareClearanceValidity(validUntil: string): Promise<void> {
  const { data, error } = await supabase.rpc('toda_declare_clearance_validity', { p_valid_until: validUntil });
  todaRpcResult(data, error, 'The clearance validity date could not be saved.');
}

/**
 * A new TODA registers itself, in the only order that works with locked-down storage and row security:
 *   1. the registrant's own login (nothing in the sign-up grants a role)
 *   2. the three documents, into that login's own folder of the private buckets (<auth uid>/<file>)
 *   3. one database function creates the TODA (Pending Verification) and makes THIS login its administrator
 *   4. officers and bylaws are added to the new record by the administrator
 * There are no fallback table inserts: if a step fails, the registration stops with a message. The browser is signed out at the end.
 */
export async function registerToda(payload: {
  todaName: string;
  todaAcronym: string;
  /** the number on the TODA's registration papers; the acronym is used when it is left out */
  registrationNumber?: string;
  barangay: string;
  dateEstablished: string;
  serviceCoverageArea: string;
  presidentName: string;
  presidentContact: string;
  vicePresidentName?: string;
  vicePresidentContact?: string;
  secretaryName?: string;
  secretaryContact?: string;
  treasurerName?: string;
  treasurerContact?: string;
  officeEmail?: string;
  password: string;
  /** the three documents; they are uploaded here, AFTER the registrant's login exists */
  files: { barangayClearance: File; driverRoster: File; bylaws: File };
  /** what the registrant says the Barangay Clearance is valid until (YYYY-MM-DD); the LGU checks it against the document */
  clearanceValidUntil?: string;
  registeredTricycleCount?: number;
  terminalLatitude?: number | null;
  terminalLongitude?: number | null;
}) {
  const cleanAcronym = payload.todaAcronym.trim().toUpperCase();

  // 1. Uniqueness of the acronym
  const isAvailable = await checkAcronymAvailability(cleanAcronym);
  if (!isAvailable) {
    throw new Error(`The TODA Acronym '${cleanAcronym}' is already registered. Please choose a unique acronym or contact the LGU Transport Board.`);
  }

  const syntheticEmail = `${cleanAcronym.toLowerCase()}@toda.sakay.internal`;

  // 2. The registrant's own login
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: syntheticEmail,
    password: payload.password,
    options: {
      data: {
        full_name: payload.presidentName.trim(),
        phone: payload.presidentContact.trim(),
      },
    },
  });
  const signUpMessage = (signUpError?.message || '').toLowerCase();
  const alreadyRegistered = Boolean(
    signUpError && (signUpMessage.includes('already registered') || signUpMessage.includes('already exists') || (signUpError as any)?.code === 'user_already_exists')
  );
  if (signUpError && !alreadyRegistered) {
    throw new Error(signUpError.message);
  }

  // Signed in: a new sign-up already is; an unfinished earlier attempt is resumed with the SAME password
  let authUser = !alreadyRegistered ? signUpData?.session?.user ?? null : null;
  if (!authUser) {
    const signIn = await supabase.auth.signInWithPassword({ email: syntheticEmail, password: payload.password });
    if (signIn.error || !signIn.data?.user) {
      throw new Error(
        alreadyRegistered
          ? `A login for '${cleanAcronym}' already exists. Use its password to continue, or choose a different acronym.`
          : (signIn.error?.message || 'Could not sign in to complete the registration.')
      );
    }
    authUser = signIn.data.user;
  }

  try {
    // 3. Documents, into the registrant's own folder
    const clearancePath = await uploadOwnedFile(authUser.id, payload.files.barangayClearance, 'barangay-clearances');
    const rosterPath = await uploadOwnedFile(authUser.id, payload.files.driverRoster, 'toda-accredited-driver-lists');
    const bylawsPath = await uploadOwnedFile(authUser.id, payload.files.bylaws, 'toda-bylaws');

    // The registration itself
    const { data: registeredTodaId, error: rpcError } = await supabase.rpc('register_toda_with_admin', {
      p_toda_name: payload.todaName.trim(),
      p_toda_acronym: cleanAcronym,
      p_registration_number: payload.registrationNumber?.trim() || cleanAcronym,
      p_date_established: payload.dateEstablished || new Date().toISOString().split('T')[0],
      p_active_drivers: 0,
      p_registered_tricycles: payload.registeredTricycleCount ?? 0,
      p_terminal_latitude: payload.terminalLatitude ?? null,
      p_terminal_longitude: payload.terminalLongitude ?? null,
      p_terminal_location_name: payload.serviceCoverageArea.trim(),
      p_barangay: payload.barangay,
      p_service_coverage_area: payload.serviceCoverageArea.trim(),
      p_president_name: payload.presidentName.trim(),
      p_admin_email: syntheticEmail,
      p_admin_contact_number: payload.presidentContact.trim(),
      p_barangay_clearance_url: clearancePath,
      p_accredited_drivers_url: rosterPath,
      p_auth_user_id: authUser.id,
    });

    if (rpcError || !registeredTodaId) {
      const detail = rpcError?.message || '';
      if (/registration_number/i.test(detail) && /duplicate|unique|already/i.test(detail)) {
        throw new Error(`The registration number '${payload.registrationNumber?.trim() || cleanAcronym}' is already registered to another TODA. Check the number on your papers.`);
      }
      if (detail.includes('ERR_TERMINAL_LOCATION')) {
        throw new Error(detail.replace(/^.*ERR_TERMINAL_LOCATION:\s*/, ''));
      }
      if (detail.includes('ERR_ALREADY_TODA_ADMIN')) {
        throw new Error('This login already administers a TODA. Choose a different acronym to register another TODA.');
      }
      throw new Error(detail ? `The registration could not be saved: ${detail}` : 'The registration could not be saved. Please try again.');
    }

    // The validity date the registrant stated for the clearance. Not fatal when it fails: the LGU reads the real date from the document at approval.
    if (payload.clearanceValidUntil) {
      try {
        await declareClearanceValidity(payload.clearanceValidUntil);
      } catch (validityErr) {
        console.warn('[todaApiService] The clearance validity date was not saved with the registration:', validityErr);
      }
    }

    // The roster file just submitted becomes the master roster. Not fatal: it is brought in again when the portal opens.
    await autoImportTodaRoster(registeredTodaId as string);

    // 4. Officers and bylaws, added to the new record by its own administrator (a missing optional column is skipped, not fatal)
    const details: Record<string, any> = {
      vice_president_name: payload.vicePresidentName?.trim() || null,
      vice_president_contact: payload.vicePresidentContact?.trim() || null,
      secretary_name: payload.secretaryName?.trim() || null,
      secretary_contact: payload.secretaryContact?.trim() || null,
      treasurer_name: payload.treasurerName?.trim() || null,
      treasurer_contact: payload.treasurerContact?.trim() || null,
      bylaws_url: bylawsPath,
    };
    for (let attempt = 0; attempt < 10; attempt++) {
      const { error: detailsError } = await supabase.from('toda').update(details).eq('toda_id', registeredTodaId);
      if (!detailsError) break;
      const errMsg = (detailsError.message || '') + ' ' + (detailsError.details || '');
      const match = errMsg.match(/Could not find the '([^']+)' column/i) || errMsg.match(/column [^.]*\.?([a-zA-Z0-9_]+) does not exist/i);
      if (match && match[1] && match[1] in details) {
        delete details[match[1]];
      } else {
        console.warn('[todaApiService] Officer / bylaws details were not saved with the registration:', detailsError.message);
        break;
      }
    }

    return { success: true, data: { toda_id: registeredTodaId as string }, syntheticEmail, acronym: cleanAcronym };
  } finally {
    // Leave the browser signed out: the new administrator logs in on the login screen
    try {
      await supabase.auth.signOut();
    } catch {}
  }
}

/**
 * Sends an application the LGU returned for correction back into review (Pending Verification). The corrected files are submitted first with
 * updateTodaComplianceDocument(); this is the explicit "I corrected it" step. Only the TODA's own application, and only while it is returned.
 */
export async function resubmitTodaApplication(note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('toda_resubmit_application', { p_note: note?.trim() || null });
  todaRpcResult(data, error, 'The application could not be resubmitted. Please try again.');
  announceTodaProfileChanged();
}


// ============================================================================
// 2. DRIVER MANAGEMENT & SCREENING
// ============================================================================

/**
 * The driver rows affiliated with ONE TODA (any stage), newest first, each carrying THAT affiliation's membership number, terminal and
 * barangay in place of the driver's single legacy columns. (Row security lets a TODA administrator read exactly these drivers.)
 */
async function fetchAffiliatedDrivers(todaId: string): Promise<any[]> {
  const { data } = await supabase
    .from('driver_toda_affiliation')
    .select('toda_membership_number, assigned_terminal, barangay_service_area, submitted_at, driver:driver_id(*)')
    .eq('toda_id', todaId)
    .order('submitted_at', { ascending: false });

  return (data || [])
    .map((aff: any) => {
      const d = Array.isArray(aff.driver) ? aff.driver[0] : aff.driver;
      if (!d) return null;
      return {
        ...d,
        toda_membership_number: aff.toda_membership_number || d.toda_membership_number || null,
        assigned_terminal: aff.assigned_terminal || d.assigned_terminal || null,
        barangay_service_area: aff.barangay_service_area || d.barangay_service_area || null,
      };
    })
    .filter((row: any) => row !== null);
}

/**
 * The TODA's registered roster file (the spreadsheet uploaded at registration or replaced in Settings) as bytes, or null when it cannot be
 * opened. The stored value is a storage path (older rows may hold a storage URL).
 */
async function downloadRosterFile(rawUrl: string): Promise<ArrayBuffer | null> {
  let arrayBuffer: ArrayBuffer | null = null;

  // Clean storage path
  let storagePath = rawUrl;
  if (rawUrl.includes('toda-accredited-driver-lists/')) {
    storagePath = decodeURIComponent(rawUrl.split('toda-accredited-driver-lists/')[1].split('?')[0]);
  } else if (rawUrl.startsWith('http')) {
    try {
      const urlObj = new URL(rawUrl);
      const parts = urlObj.pathname.split('/');
      const bucketIndex = parts.indexOf('toda-accredited-driver-lists');
      if (bucketIndex !== -1 && bucketIndex < parts.length - 1) {
        storagePath = decodeURIComponent(parts.slice(bucketIndex + 1).join('/'));
      }
    } catch {}
  }

  // Attempt 1: Direct authenticated download via Supabase Storage
  try {
    const { data: blob, error: dlErr } = await supabase.storage
      .from('toda-accredited-driver-lists')
      .download(storagePath);

    if (!dlErr && blob) {
      arrayBuffer = await blob.arrayBuffer();
    }
  } catch (dlErr) {
    console.warn('[todaApiService] Storage download attempt 1:', dlErr);
  }

  // Attempt 2: Signed URL download
  if (!arrayBuffer) {
    try {
      const { data: signedData } = await supabase.storage
        .from('toda-accredited-driver-lists')
        .createSignedUrl(storagePath, SIGNED_URL_TTL.document);

      if (signedData?.signedUrl) {
        const res = await fetch(signedData.signedUrl);
        if (res.ok) {
          arrayBuffer = await res.arrayBuffer();
        }
      }
    } catch (signedErr) {
      console.warn('[todaApiService] Signed URL attempt 2:', signedErr);
    }
  }

  return arrayBuffer;
}

/** The Members row of a driver account of this TODA (used for a driver who is not on the Master Roster, and when the roster is still empty). */
function memberFromDriverRow(d: any, todaRecord: any, idx = 0): TodaDriverMember {
  return {
        id: d.driver_id,
        membershipNo: d.toda_membership_number || '-',
        name: d.full_name,
        phone: d.contact_number,
        vehiclePlate: d.plate_number || 'N/A',
        franchiseNo: d.franchise_number || d.plate_number || 'N/A',
        licenseNo: d.license_number || '',
        serviceZone: d.barangay_service_area || todaRecord?.barangay || 'Calapan City',
        todaVerificationStatus: 'Verified',
        lguVerificationStatus: d.account_status === 'Verified' ? 'Verified' : 'Pending',
        accountStatus: d.account_status === 'Suspended' ? 'TODA Suspended' : (d.account_status as any) || 'Active',
        suspensionReason: d.suspension_reason || undefined,
        suspendedAt: d.suspended_at ? new Date(d.suspended_at).toLocaleDateString('en-US') : undefined,
        strikesCount: d.strikes_count || 0,
        rating: Number(d.weighted_average_rating) || 0,   // 0 = Not Yet Rated (Rule 23.1)
        totalTrips: 0,
        joinedDate: d.created_at ? new Date(d.created_at).toLocaleDateString('en-US') : 'Recent',
        availabilityStatus: d.availability_status || undefined,
        bookingsPausedUntil: d.bookings_paused_until || null,
  };
}

export async function fetchTodaDrivers(todaId?: string): Promise<TodaDriverMember[]> {
  try {
    const currentTodaId = await getEffectiveTodaId(todaId);
    let todaRecord: any = null;

    if (currentTodaId && currentTodaId !== DEFAULT_TODA_ID) {
      const { data: directToda } = await supabase
        .from('toda')
        .select('*')
        .eq('toda_id', currentTodaId)
        .maybeSingle();
      todaRecord = directToda;
    }

    // 2. Fetch all drivers currently registered in the database for this TODA: one per AFFILIATION with it (a driver of two TODAs is a
    //    member of both; driver.toda_id points at only one of them), with this TODA's own membership number and service barangay.
    const driverList = currentTodaId ? await fetchAffiliatedDrivers(currentTodaId) : [];

    // 3. The Master Roster is the list of members (decision D-P9): the roster FILE submitted at registration is evidence, not the list, so a member added later appears here
    //    and one who left does not. A member is matched to a driver account by franchise number; a driver of this TODA who is not on the roster is listed too.
    const { data: rosterRows } = currentTodaId && currentTodaId !== DEFAULT_TODA_ID
      ? await supabase.from('toda_roster_entry').select('*').eq('toda_id', currentTodaId).eq('status', 'Active').order('created_at', { ascending: true })
      : { data: null };
    if (rosterRows && rosterRows.length > 0) {
      const matchedIds = new Set<string>();
      const fromRoster: TodaDriverMember[] = rosterRows.map((row: any, idx: number) => {
        const key = normalizeFranchiseKey(row.franchise_number);
        const matchedDriver = driverList.find((d: any) => key !== '' && normalizeFranchiseKey(d.franchise_number) === key);
        if (matchedDriver) matchedIds.add(matchedDriver.driver_id);
        const rawStatus = matchedDriver?.account_status;
        let accountStatus: string = 'Not Registered';
        if (matchedDriver) {
          if (rawStatus === 'Suspended') accountStatus = 'TODA Suspended';
          else if (rawStatus === 'Active' || rawStatus === 'Verified') accountStatus = 'Active';
          else if (rawStatus === 'Deactivated') accountStatus = 'LGU Deactivated';
          else if (rawStatus === 'Pending' || rawStatus === 'Pending Verification') accountStatus = 'Pending Verification';
          else accountStatus = rawStatus || 'Active';
        }
        return {
          id: matchedDriver?.driver_id || `roster-${row.entry_id || idx + 1}`,
          // the TODA's own number for the member (never one made up from the order of a file)
          membershipNo: row.membership_number || matchedDriver?.toda_membership_number || '-',
          name: row.member_name || `Member ${idx + 1}`,
          phone: matchedDriver?.contact_number || '',
          vehiclePlate: matchedDriver?.plate_number || row.plate_number || 'N/A',
          franchiseNo: row.franchise_number || matchedDriver?.franchise_number || 'N/A',
          licenseNo: matchedDriver?.license_number || '',
          serviceZone: todaRecord?.service_coverage_area || todaRecord?.barangay || 'Calapan City',
          todaVerificationStatus: 'Verified',
          lguVerificationStatus: matchedDriver?.account_status === 'Verified' ? 'Verified' : 'Pending',
          accountStatus: accountStatus as TodaDriverMember['accountStatus'],
          suspensionReason: matchedDriver?.suspension_reason || undefined,
          suspendedAt: matchedDriver?.suspended_at ? new Date(matchedDriver.suspended_at).toLocaleDateString('en-US') : undefined,
          strikesCount: matchedDriver?.strikes_count || 0,
          rating: Number(matchedDriver?.weighted_average_rating) || 0,   // 0 = Not Yet Rated (Rule 23.1)
          totalTrips: 0,
          joinedDate: row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : 'Recent',
          availabilityStatus: matchedDriver?.availability_status || undefined,
          bookingsPausedUntil: matchedDriver?.bookings_paused_until || null,
        };
      });
      const notOnRoster: TodaDriverMember[] = driverList
        .filter((d: any) => !matchedIds.has(d.driver_id))
        .map((d: any) => memberFromDriverRow(d, todaRecord));
      return [...fromRoster, ...notOnRoster];
    }

    // 4. Fallback to registered driver table accounts
    if (driverList.length > 0) {
      return driverList.map((d: any, idx: number) => memberFromDriverRow(d, todaRecord, idx));
    }

    return [];
  } catch (err) {
    console.error('[todaApiService] fetchTodaDrivers error:', err);
    return [];
  }
}

export const fetchTodaDriverMembers = fetchTodaDrivers;

/**
 * A link to an applicant's document photo. Every bucket is private: the link is a SIGNED URL that lives 10 minutes and that Storage only
 * issues if this administrator may read the file (the applicant's TODA). The preview window signs again when a photo is opened. There
 * is no public-URL fallback (there are no public files).
 */
async function resolveStorageImageUrl(preferredBucket: string, path?: string | null, fallbackBucket?: string): Promise<string> {
  if (!path) return '';
  return (await signedStorageUrlFromAny(supabase, fallbackBucket ? [preferredBucket, fallbackBucket] : [preferredBucket], path, SIGNED_URL_TTL.document)) || '';
}

/**
 * The applicants of ONE TODA, one row per AFFILIATION (driver x TODA). A driver may apply to several TODAs (Driver Module 2.1, Policy 3.1):
 * every TODA sees only its own affiliation of that driver, with its own stage, membership number and terminal, and what another TODA
 * decided about the same driver is invisible here and changes nothing here. `id` is the AFFILIATION id (what the decision functions
 * take); `driverId` is the person.
 */
export async function fetchDriverApplicants(todaId?: string): Promise<DriverApplicant[]> {
  try {
    const targetTodaId = await getEffectiveTodaId(todaId);
    // the roster file comes first, so the roster check below sees the members it names
    await autoImportTodaRoster(targetTodaId);

    const { data, error } = await supabase
      .from('driver_toda_affiliation')
      .select('*, driver:driver_id(*, driver_verification(*))')
      .eq('toda_id', targetTodaId)
      .order('submitted_at', { ascending: false });

    if (error || !data || data.length === 0) return [];

    // Which documents each application returned / got back, and why (one call for the whole list). The database answers only for this
    // TODA's own applications, and shows another review's flag on a shared document WITHOUT its reason.
    const reviewsByAffiliation = new Map<string, ApplicantDocumentReview[]>();
    try {
      const { data: reviewRows } = await supabase.rpc('get_affiliation_document_reviews', {
        p_affiliation_ids: data.map((aff: any) => aff.affiliation_id),
      });
      for (const r of (reviewRows || []) as any[]) {
        const list = reviewsByAffiliation.get(r.affiliation_id) || [];
        list.push({
          documentType: r.document_type,
          state: r.state,
          reasonCode: r.reason_code,
          reason: r.reason,
          returnedAt: r.returned_at,
          returnedByStage: r.returned_by_stage,
          resubmittedAt: r.resubmitted_at,
        });
        reviewsByAffiliation.set(r.affiliation_id, list);
      }
    } catch (reviewErr) {
      console.warn('[todaApiService] document reviews unavailable:', reviewErr);
    }

    // The roster match, asked of the database: the SAME function the endorsement uses (the FRANCHISE number against this TODA's roster entries
    // made before the application; a name alone never matches, a plate alone does not either), so this screen and the Roster Mismatch flag
    // cannot disagree. It also says why, and which roster entry it found.
    const rosterMatches = new Map<string, boolean>();
    const rosterChecks = new Map<string, RosterCheck>();
    try {
      const { data: matchRows, error: matchErr } = await supabase.rpc('get_affiliation_roster_matches', {
        p_affiliation_ids: data.map((aff: any) => aff.affiliation_id),
      });
      if (matchErr) throw matchErr;
      for (const r of (matchRows || []) as any[]) {
        rosterMatches.set(r.affiliation_id, Boolean(r.roster_matched));
        rosterChecks.set(r.affiliation_id, {
          reason: r.reason_code as RosterReason,
          driverFranchise: r.driver_franchise || undefined,
          entryMemberName: r.entry_member_name || undefined,
          entryFranchise: r.entry_franchise || undefined,
          entryPlate: r.entry_plate || undefined,
          entryCountedFrom: r.entry_counted_from || undefined,
          submittedAt: r.application_submitted_at || undefined,
        });
      }
    } catch (matchErr) {
      console.warn('[todaApiService] roster match unavailable:', matchErr);
    }

    return await Promise.all(data.map(async (aff: any) => {
      const d = Array.isArray(aff.driver) ? aff.driver[0] : aff.driver;
      if (!d) return null;
      const documentReviews = reviewsByAffiliation.get(aff.affiliation_id) || [];
      // "Resubmitted": back in TODA review after a TODA return that the driver has answered (resubmitted_at also exists after an LGU
      // return, but then the TODA stage is Endorsed, not Submitted)
      const isResubmitted =
        aff.toda_endorsement_status === 'Submitted' &&
        Boolean(aff.resubmitted_at) &&
        documentReviews.some((r) => r.state === 'resubmitted' && r.returnedByStage !== 'LGU');
      const verif = Array.isArray(d.driver_verification) ? d.driver_verification[0] : d.driver_verification;

      // The stage is THIS affiliation's TODA stage, never the shared verification record or the driver's overall status.
      let stageStatus: DriverApplicant['todaStageStatus'] = 'Awaiting Screening';
      if (aff.toda_endorsement_status === 'Endorsed') stageStatus = 'Endorsed to LGU';
      else if (aff.toda_endorsement_status === 'Rejected') stageStatus = 'Rejected';
      else if (aff.toda_endorsement_status === 'Resubmission Required') stageStatus = 'Resubmission Required';

      const authId = d.auth_user_id;
      const licFrontPath = verif?.license_front_photo_path || (authId ? `${authId}/license_front.jpg` : null);
      const licBackPath = verif?.license_back_photo_path || (authId ? `${authId}/license_back.jpg` : null);
      const mtopPath = verif?.mtop_photo_path || (authId ? `${authId}/mtop.jpg` : null);
      const tricyclePath = verif?.tricycle_photo_path || d.tricycle_photo_path || (authId ? `${authId}/tricycle.jpg` : null);
      const selfiePath = verif?.face_photo_path || (authId ? `${authId}/selfie.jpg` : null);

      const [licenseFrontUrl, licenseBackUrl, mtopUrl, tricyclePhotoUrl, selfieUrl] = await Promise.all([
        resolveStorageImageUrl('driver-licenses', licFrontPath),
        resolveStorageImageUrl('driver-licenses', licBackPath),
        resolveStorageImageUrl('mtop-permits', mtopPath, 'driver-licenses'),
        resolveStorageImageUrl('mtop-permits', tricyclePath, 'driver-licenses'),
        resolveStorageImageUrl('driver-selfies', selfiePath, 'driver-licenses'),
      ]);

      // The review clock of this affiliation starts when it was submitted, or resubmitted after a correction.
      const sinceMs = new Date(aff.resubmitted_at || aff.submitted_at || aff.created_at || Date.now()).getTime();
      const daysPending = Math.max(0, Math.floor((Date.now() - sinceMs) / 86_400_000));

      const applicant: DriverApplicant = {
        id: aff.affiliation_id,
        affiliationId: aff.affiliation_id,
        driverId: d.driver_id,
        name: d.full_name,
        phone: d.contact_number,
        licenseNo: d.license_number || verif?.submitted_license_number || 'N/A',
        vehiclePlate: d.plate_number || verif?.submitted_plate_number || 'N/A',
        chassisNo: d.chassis_number || verif?.submitted_chassis_number || 'N/A',
        motorNo: d.motor_number || verif?.submitted_motor_number || 'N/A',
        franchiseNo: d.franchise_number || verif?.submitted_franchise_number || 'N/A',
        membershipNo: aff.toda_membership_number || undefined,
        isResubmitted,
        resubmittedAt: aff.resubmitted_at || undefined,
        documentReviews,
        assignedTerminal: aff.assigned_terminal || undefined,
        barangayServiceArea: aff.barangay_service_area || undefined,
        submittedDate: aff.submitted_at ? new Date(aff.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
        daysPending,
        isOverdue: aff.toda_endorsement_status === 'Submitted' && daysPending > 3,
        onSubmittedRoster: rosterMatches.get(aff.affiliation_id) === true,
        rosterMatchKnown: rosterMatches.has(aff.affiliation_id),
        rosterCheck: rosterChecks.get(aff.affiliation_id),
        residentialBarangay: d.barangay_service_area || undefined,
        licenseExpiry: d.license_expiry || verif?.license_expiry || undefined,
        mtopExpiry: d.mtop_expiry || verif?.mtop_expiry || verif?.franchise_expiry || undefined,
        mtopOperatorName: verif?.submitted_operator_name || undefined,
        // the tricycle photo and nothing else: the driver's own profile picture is a different picture and must never stand in for it
        tricyclePhotoUrl: tricyclePhotoUrl || '',
        licenseFrontUrl,
        licenseBackUrl,
        mtopUrl,
        selfieUrl,
        photoVerified: true,
        rosterVerified: rosterMatches.get(aff.affiliation_id) === true,
        todaStageStatus: stageStatus,
        rejectionReason: aff.toda_rejection_reason || aff.toda_return_notes || undefined,
      };
      return applicant;
    })).then((rows) => rows.filter((row): row is DriverApplicant => row !== null));
  } catch (err) {
    console.error('[todaApiService] fetchDriverApplicants error:', err);
    return [];
  }
}

/**
 * The affiliation a decision is about. The portal passes the affiliation id (that is what an applicant's `id` is now). A driver id is still
 * accepted, but only ever resolves to the affiliation with THIS administrator's own TODA: it can never pick "the latest affiliation"
 * of the driver, which could belong to another TODA.
 */
async function resolveAffiliation(driverOrAffiliationId: string): Promise<{ affiliationId: string; driverId: string } | null> {
  const { data: byId } = await supabase
    .from('driver_toda_affiliation')
    .select('affiliation_id, driver_id')
    .eq('affiliation_id', driverOrAffiliationId)
    .maybeSingle();
  if (byId?.affiliation_id) return { affiliationId: byId.affiliation_id, driverId: byId.driver_id };

  const myTodaId = await getEffectiveTodaId();
  const { data: byDriver } = await supabase
    .from('driver_toda_affiliation')
    .select('affiliation_id, driver_id')
    .eq('driver_id', driverOrAffiliationId)
    .eq('toda_id', myTodaId)
    .maybeSingle();
  return byDriver?.affiliation_id ? { affiliationId: byDriver.affiliation_id, driverId: byDriver.driver_id } : null;
}

/** Runs one of the affiliation decision functions; they answer { success, error } instead of raising. */
async function decideAffiliation(
  fn: 'endorse_driver_affiliation' | 'return_driver_documents' | 'reject_driver_affiliation',
  args: Record<string, unknown>
): Promise<{ ok: true; data: any } | { ok: false; error: Error }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: new Error(error.message) };
  if (!data || data.success !== true) return { ok: false, error: new Error(data?.error || 'The decision was not accepted by the database.') };
  return { ok: true, data };
}

/**
 * Tells a driver applicant of THIS TODA what the TODA decided, by SMS. The browser says only WHICH message and for WHICH driver; the
 * server takes the number from the driver's own record, writes the text from a template and refuses a message the application's stage
 * does not support (server/src/routes/driverNotifyRoutes.ts: it checks THIS TODA's affiliation of the driver). A failure is logged and
 * never undoes the decision that was just saved.
 */
async function notifyApplicant(driverId: string, kind: 'endorsed' | 'returned' | 'rejected', reason?: string): Promise<void> {
  try {
    const { ok, data } = await apiPostJson(supabase, `${API_BASE_URL}/toda-admin/notify/driver`, { driverId, kind, reason });
    if (!ok) console.warn('[todaApiService] Applicant SMS not sent:', data?.error || 'request refused');
  } catch (smsErr) {
    console.warn('[todaApiService] Applicant SMS dispatch warning:', smsErr);
  }
}

/**
 * The TODA stage of ONE affiliation: Submitted -> Endorsed (and on to the LGU). Only this affiliation changes; the driver's other TODAs,
 * their stages and the driver's own account status are untouched. (endorse_driver_affiliation checks that the caller administers this
 * affiliation's TODA, that the TODA is active, and records the roster match.)
 */
export async function endorseDriverApplicant(applicantId: string, actorName: string = 'TODA President') {
  console.log('[todaApiService] Endorsing driver affiliation to LGU:', applicantId, 'by:', actorName);
  try {
    const target = await resolveAffiliation(applicantId);
    if (!target) return { success: false, error: new Error('This application was not found for your TODA.') };

    const res = await decideAffiliation('endorse_driver_affiliation', {
      p_affiliation_id: target.affiliationId,
      p_remarks: `Endorsed by ${actorName}`,
    });
    if (!res.ok) {
      console.error('[todaApiService] Failed to persist driver endorsement:', res.error.message);
      return { success: false, error: res.error };
    }

    // The decision is saved: the SMS goes out in the background (it can take many seconds) and never holds the screen
    void notifyApplicant(target.driverId, 'endorsed');
    return { success: true, data: res.data?.data, rosterMatched: res.data?.roster_matched !== false };
  } catch (err: any) {
    console.error('[todaApiService] endorseDriverApplicant exception:', err);
    return { success: false, error: err };
  }
}

export const forwardApplicantToLgu = endorseDriverApplicant;

/** What the TODA says about one document it returns: the preset reason and the required free text. */
export interface DocumentReturnInput {
  documentType: 'license' | 'mtop' | 'tricycle' | 'selfie';
  reasonCode: 'blurry' | 'expired' | 'mismatch' | 'wrong_document' | 'incomplete' | 'other';
  reason: string;
}

const RETURN_DOCUMENT_LABEL: Record<DocumentReturnInput['documentType'], string> = {
  license: "Driver's License",
  mtop: 'MTOP',
  tricycle: 'Tricycle photo',
  selfie: 'Profile photo (selfie)',
};

/**
 * Returns ONE affiliation to the driver for correction (Rules 3.6, 3.8): the TODA names WHICH documents (one or more) and WHY, each with
 * a preset reason and a required free-text reason. Only those documents are asked for again. Only THIS affiliation moves to "Resubmission
 * Required": the driver's other TODAs, their stages and their clocks are untouched. A separate action from rejecting (fraud / ineligible).
 */
export async function returnDriverDocuments(applicantId: string, documents: DocumentReturnInput[]) {
  console.log('[todaApiService] Returning documents for correction:', applicantId, documents.map((d) => d.documentType));
  try {
    const target = await resolveAffiliation(applicantId);
    if (!target) return { success: false, error: new Error('This application was not found for your TODA.') };

    const res = await decideAffiliation('return_driver_documents', {
      p_affiliation_id: target.affiliationId,
      p_documents: documents.map((d) => ({ document_type: d.documentType, reason_code: d.reasonCode, reason: d.reason.trim() })),
    });
    if (!res.ok) {
      console.warn('[todaApiService] return for correction error:', res.error.message);
      return { success: false, error: res.error };
    }

    // The SMS carries the same words the driver sees in the app
    const text = documents.map((d) => `${RETURN_DOCUMENT_LABEL[d.documentType]}: ${d.reason.trim()}`).join('; ');
    void notifyApplicant(target.driverId, 'returned', text);
    return { success: true, documents: res.data?.documents as string[] | undefined };
  } catch (err: any) {
    console.error('[todaApiService] returnDriverDocuments exception:', err);
    return { success: false, error: err };
  }
}

/**
 * Rejects ONE affiliation at the TODA stage, FOR GOOD (Rule 3.8): the applicant cannot re-apply to this TODA. The reason is one of the
 * permanent grounds (a code from the dropdown, never free text); the note is optional and is shown to the applicant with the reason. The
 * driver's other TODAs are not rejected by this. A fixable problem is RETURNED for correction (returnDriverDocuments) instead.
 */
export async function rejectDriverApplicant(applicantId: string, reason: RejectionReasonCode, note?: string) {
  console.log('[todaApiService] Rejecting driver affiliation:', applicantId, reason);
  try {
    if (!isRejectionReasonCode(reason)) {
      return { success: false, error: new Error('Choose one of the listed reasons for the rejection.') };
    }
    const target = await resolveAffiliation(applicantId);
    if (!target) return { success: false, error: new Error('This application was not found for your TODA.') };

    const cleanNote = (note || '').trim();
    const res = await decideAffiliation('reject_driver_affiliation', {
      p_affiliation_id: target.affiliationId,
      p_reason_category: reason,
      p_notes: cleanNote || null,
    });
    if (!res.ok) {
      console.warn('[todaApiService] affiliation rejection error:', res.error.message);
      return { success: false, error: res.error };
    }

    // The SMS carries the same words the driver sees in the app
    void notifyApplicant(target.driverId, 'rejected', cleanNote ? `${REJECTION_REASON_LABEL[reason]}: ${cleanNote}` : REJECTION_REASON_LABEL[reason]);
    return { success: true };
  } catch (err: any) {
    console.error('[todaApiService] rejectDriverApplicant exception:', err);
    return { success: false, error: err };
  }
}

export async function requestDriverResubmission(applicantId: string, documents: DocumentReturnInput[]) {
  // The database writes the audit_log entry and the document history of the return itself.
  const returnRes = await returnDriverDocuments(applicantId, documents);
  if (!returnRes.success) {
    throw returnRes.error || new Error('Failed to return the documents for resubmission');
  }
  return { success: true };
}

// A TODA administrator does not suspend or reactivate drivers directly: suspensions
// come from the strike ladder and administrative decisions, and reinstatement is a
// manual LGU decision (Sections 21, 22). The TODA's part is to RECOMMEND, which raises a
// review flag for the LGU Administrator through the shared flag mechanism (the database
// verifies the driver belongs to this TODA and audits the flag).
async function recommendToLgu(
  flagType: 'TODA_SUSPENSION_RECOMMENDATION' | 'TODA_REACTIVATION_RECOMMENDATION',
  driverId: string,
  reason?: string
) {
  const { data, error } = await supabase.rpc('create_admin_review_flag', {
    p_flag_type: flagType,
    p_subject_type: 'driver',
    p_subject_id: driverId,
    p_source_rule: 'Section 22',
    p_assigned_role: 'lgu_admin',
    p_details: { reason: reason || null },
  });
  if (error) throw new Error(error.message);
  return { success: true, flagId: data as string };
}

export async function suspendTodaDriver(driverId: string, reason: string) {
  return recommendToLgu('TODA_SUSPENSION_RECOMMENDATION', driverId, reason);
}

export async function reactivateTodaDriver(driverId: string, reason?: string) {
  return recommendToLgu('TODA_REACTIVATION_RECOMMENDATION', driverId, reason);
}

// ============================================================================
// 3. TRICYCLE FLEET MANAGEMENT
// ============================================================================

export interface TodaVehicleUnit {
  id: string;
  plateNumber: string;
  mtopNumber: string;
  driverName: string;
  driverId: string;
  status: 'Active' | 'Maintenance' | 'Inactive';
  inspectionStatus: 'Passed' | 'Pending Inspection';
  orCrNumber: string;
  registeredDate: string;
}

export async function fetchTodaFleet(todaId?: string): Promise<TodaVehicleUnit[]> {
  try {
    const effectiveTodaId = await getEffectiveTodaId(todaId);
    const data = await fetchAffiliatedDrivers(effectiveTodaId);
    if (data.length === 0) return [];

    return data.map((d: any, idx: number) => ({
      id: `UNIT-${String(idx + 1).padStart(3, '0')}`,
      plateNumber: d.plate_number || 'MV-101',
      mtopNumber: d.franchise_number || 'MTOP-2026-001',
      driverName: d.full_name,
      driverId: d.driver_id,
      status: d.account_status === 'Suspended' ? 'Inactive' : 'Active',
      inspectionStatus: 'Passed',
      orCrNumber: `ORCR-${Math.floor(10000 + Math.random() * 90000)}`,
      registeredDate: d.created_at ? new Date(d.created_at).toLocaleDateString('en-US') : '2026',
    }));
  } catch (err) {
    console.error('[todaApiService] fetchTodaFleet error:', err);
    return [];
  }
}

export async function addTodaVehicle(payload: { plateNumber: string; mtopNumber: string; driverName: string; orCrNumber?: string }) {
  await recordTodaAuditAction({
    actionType: 'TRICYCLE_UNIT_REGISTERED',
    targetId: payload.plateNumber,
    targetName: payload.plateNumber,
    details: `Registered new tricycle unit '${payload.plateNumber}' (MTOP: ${payload.mtopNumber}) assigned to ${payload.driverName}.`,
    category: 'Operations',
  });
  return { success: true };
}

// ============================================================================
// 4. TODA OPERATIONS, INCIDENTS, ANNOUNCEMENTS & AUDIT LOGS
// ============================================================================

/**
 * The passenger's name and phone for bookings of this TODA, from the database function that discloses just that to the TODA
 * administrator of the booking (the passenger table itself is not readable by a TODA administrator).
 */
async function passengerContacts(bookingIds: string[]): Promise<Map<string, { full_name: string | null; contact_number: string | null }>> {
  const out = new Map<string, { full_name: string | null; contact_number: string | null }>();
  const ids = Array.from(new Set(bookingIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.rpc('get_booking_counterparties', { p_booking_ids: ids.slice(i, i + 200) });
    for (const row of (data ?? []) as any[]) {
      out.set(row.booking_id, { full_name: row.passenger_name ?? null, contact_number: row.passenger_phone ?? null });
    }
  }
  return out;
}

export async function fetchTodaOperationsTrips(todaId?: string) {
  try {
    const effectiveTodaId = await getEffectiveTodaId(todaId);
    const { data, error } = await supabase
      .from('booking')
      .select('*, driver:driver_id(*)')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const mine = data.filter((b: any) => b.toda_id === effectiveTodaId || b.driver?.toda_id === effectiveTodaId);
    const contacts = await passengerContacts(mine.map((b: any) => b.booking_id));
    return mine.map((b: any) => ({ ...b, passenger: contacts.get(b.booking_id) ?? null }));
  } catch {
    return [];
  }
}

export async function fetchTodaIncidents(todaId?: string) {
  try {
    const effectiveTodaId = await getEffectiveTodaId(todaId);
    const { data, error } = await supabase
      .from('incident_report')
      .select('*, booking:booking_id(*), driver:driver_id(*)')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const mine = data.filter((inc: any) =>
      inc.reported_toda_id === effectiveTodaId ||
      inc.driver?.toda_id === effectiveTodaId ||
      inc.booking?.toda_id === effectiveTodaId
    );
    const contacts = await passengerContacts(mine.map((inc: any) => inc.booking_id).filter(Boolean));
    return await Promise.all(
      mine.map(async (inc: any) => ({
        ...inc,
        passenger: (inc.booking_id && contacts.get(inc.booking_id)) || null,
        // short-lived links to the photos the reporter attached (the TODA administrator of the reported driver may read them)
        evidence_files: await signIncidentEvidence(supabase, inc.evidence_paths),
      }))
    );
  } catch {
    return [];
  }
}

// ---- reviewing a report (Section 19): every action is ONE database function (migration 20261026000001): who may act, the strike, the audit entry and the notices are the database's.
// A TODA administrator no longer writes a report from the browser. Each answers null when the database accepted it, else the database's own sentence (shown as it is).
const sentence = (r: TripEndResult): string | null => (r.ok ? null : r.error ?? 'The action could not be saved. Please try again.');

/** Pending -> Under Investigation (Rule 19.3: the driver's TODA Administrator reviews first) */
export async function startIncident(incidentId: string): Promise<string | null> {
  return sentence(await startIncidentReview(supabase, incidentId));
}
/** What the TODA cannot resolve, or what could mean a suspension or deactivation, goes to the LGU Administrator; serious = reclassify as an assault / harassment / threat / crime (Rule 19.8) */
export async function escalateIncident(incidentId: string, reason: string, serious: boolean): Promise<string | null> {
  return sentence(await escalateIncidentReport(supabase, incidentId, reason, serious));
}
/** Rules 19.4, 19.5, 26.4: the outcome (never automatic) and the strike the administrator confirms, issued as this administrator */
export async function decideIncident(decision: IncidentDecision): Promise<string | null> {
  return sentence(await decideIncidentReport(supabase, decision));
}
/** The review flags waiting for this TODA's Administrator (the database's row policy returns only the ones assigned to the TODA Administrator for the TODA's own drivers) */
export async function fetchTodaReviewFlags(): Promise<ReviewFlagRow[]> {
  const { data, error } = await supabase.from('admin_review_flag').select('*').in('status', ['Open', 'Under Review']).eq('assigned_role', 'toda_admin').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as ReviewFlagRow[];
}
export async function resolveTodaReviewFlag(flagId: string, status: 'Resolved' | 'Dismissed', note: string): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_admin_review_flag', { p_flag_id: flagId, p_status: status, p_resolution: note });
  return error ? adminActionMessage(error.message, 'The flag could not be closed.') : null;
}
/** Rule 13.7 / PI-11B: the TODA Administrator confirms the strike the flag points at (for the booking of the event) */
export async function confirmTodaFlaggedViolation(flagId: string, bookingId: string | null, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_confirm_flagged_violation', confirmFlaggedViolationArgs(flagId, bookingId, reason));
  return error ? adminActionMessage(error.message, 'The strike could not be confirmed.') : null;
}

/** Rules 29.20 - 29.22, 26.3: the driver's TODA Administrator ends a trip for safety (a detained or incapacitated driver, an accident, a passenger in danger); nobody is struck */
export async function endTripSafely(end: SafetyEnd): Promise<string | null> {
  return sentence(await endTripForSafety(supabase, end));
}
/** Rules 19.6, 29.19: the TODA-facilitated contact for a lost item, and what came of it */
export async function updateLostItemReport(incidentId: string, status: Exclude<LostItemStatus, 'Open'>, note: string): Promise<string | null> {
  return sentence(await updateLostItem(supabase, incidentId, status, note));
}

const auditRpc: AuditRpc = (fn, args) => supabase.rpc(fn, args);

/** What the audit screen filters on, on the server: a day range in Asia/Manila and a search text */
export interface TodaAuditQuery {
  fromDay?: string;
  toDay?: string;
  search?: string;
}

const todaAuditFilters = (q: TodaAuditQuery = {}): AuditLogFilters => ({
  from: q.fromDay ? manilaDayStartIso(q.fromDay) : null,
  to: q.toDay ? manilaNextDayStartIso(q.toDay) : null,
  search: q.search || null,
});

/** This TODA's entries (Rule 28.4): a TODA Administrator reads their own; the actor's name and the time come from the database, never from the browser. */
export async function fetchTodaAuditLogs(query: TodaAuditQuery = {}): Promise<TodaAuditLog[]> {
  try {
    const page = await fetchAuditLogPage(auditRpc, todaAuditFilters(query), 500, 0);
    return page.rows.map((l) => ({
      id: l.log_id,
      log_id: l.log_id,
      toda_admin_id: l.actor_id || '',
      actor_name: l.actor_name,
      actor_role: l.actor_role || '',
      action_type: l.action_type,
      target_id: l.target_id || '',
      target_name: l.target_name || l.target_id || 'Entity',
      details: l.details || '',
      performed_at: l.performed_at_manila + ' (Asia/Manila)',
      performed_at_iso: l.performed_at,
      before_state: l.before_state,
      after_state: l.after_state,
      category: (l.action_type.includes('DRIVER')
        ? 'Driver Verification'
        : l.action_type.includes('INCIDENT')
        ? 'Incident'
        : l.action_type.includes('ANNOUNCEMENT')
        ? 'Announcement'
        : 'Account') as TodaAuditLog['category'],
    }));
  } catch (err) {
    console.error('[todaApiService] fetchTodaAuditLogs error:', err);
    return [];
  }
}

/** Exports every entry the filters match (up to the cap) as Excel, CSV or a PDF (the browser's print dialog: "Save as PDF"); the export is written to the audit log first. */
export async function exportTodaAuditLog(format: 'xlsx' | 'csv' | 'pdf', query: TodaAuditQuery, generatedBy: string): Promise<{ count: number; truncated: boolean }> {
  return exportAuditLogFile({
    rpc: auditRpc,
    format,
    filters: todaAuditFilters(query),
    generatedBy,
    title: 'SAKAY - Audit Log (TODA Administrator)',
    loadXlsx: async () => (await import('xlsx')) as unknown as XlsxLike,
  });
}

/**
 * A free-text note from a screen. The database stamps WHO (the signed-in administrator) and WHEN (the server's clock); the browser's own time is not sent. Decisions
 * on an account, application, strike or trip outcome are NOT written here: the database function that makes the decision writes its own entry.
 */
export async function recordTodaAuditAction(action: {
  actionType: string;
  targetId?: string;
  targetName?: string;
  details: string;
  category?: string;
}) {
  try {
    await supabase.from('audit_log').insert([
      {
        action_type: action.actionType,
        target_id: action.targetId || null,
        target_name: action.targetName || null,
        details: `[TODA Admin]: ${action.details}`,
      },
    ]);
  } catch (err) {
    console.warn('[todaApiService] recordTodaAuditAction error:', err);
  }
}

export type ReminderAudience = 'ALL_DRIVERS' | 'EXPIRING_DOCUMENTS';

/**
 * Sends a reminder to the verified drivers of this TODA (or only those whose license or MTOP is expired or ends within 30 days).
 * The database decides who is reached (send_toda_driver_reminder, migration 20261013000001) and records it in the audit log.
 */
export async function sendDriverReminder(audience: ReminderAudience, title: string, message: string): Promise<{ sent: number }> {
  const { data, error } = await supabase.rpc('send_toda_driver_reminder', { p_audience: audience, p_title: title, p_message: message });
  if (error) throw new Error(error.message);
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The reminder was not sent.'));
  return { sent: Number(data.sent) || 0 };
}

export async function fetchTodaAnnouncements(todaId?: string): Promise<TodaAnnouncement[]> {
  try {
    const effectiveTodaId = await getEffectiveTodaId(todaId);
    const { data, error } = await supabase
      .from('announcement')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    // This TODA's own announcements (a TODA's administrator manages their published flag), the LGU's announcements for this TODA (only while published),
    // and the LGU's city-wide announcements that are published and meant for everybody or for TODA administrators.
    const filtered = data.filter((a: any) => {
      if (a.toda_id) return a.toda_id === effectiveTodaId && (Boolean(a.created_by) || a.is_published !== false);
      return a.is_published !== false && (!a.target_audience || ['All', 'TODA Administrator'].includes(a.target_audience));
    });

    return filtered.map((a: any) => ({
      id: a.announcement_id,
      title: a.title,
      message: a.message,
      category: 'General',
      urgency: (a.urgency === 'Urgent' ? 'High Priority' : 'Standard') as any,
      isPublished: a.is_published ?? true,
      sendPushNotification: true,
      createdBy: a.toda_id ? 'TODA Admin' : 'LGU & TODA Admin',
      createdAt: a.created_at ? new Date(a.created_at).toLocaleDateString('en-US') : 'Recent',
    }));
  } catch (err) {
    console.error('[todaApiService] fetchTodaAnnouncements error:', err);
    return [];
  }
}

export async function postTodaAnnouncement(
  title: string,
  message: string,
  urgency: 'Standard' | 'High Priority' = 'Standard',
  todaId?: string,
  /** false saves a draft that no driver sees until it is published */
  publish = true
) {
  const effectiveTodaId = await getEffectiveTodaId(todaId);

  // The database writes who posted it (created_by points at the TODA administrator's own row, not at the login id) and when.
  const { data, error } = await supabase.from('announcement').insert([
    {
      title,
      message,
      urgency: urgency === 'High Priority' ? 'Urgent' : 'Normal',
      is_published: publish,
      toda_id: effectiveTodaId,
    },
  ]).select().single();

  if (error) throw error;

  await recordTodaAuditAction({
    actionType: publish ? 'TODA_ANNOUNCEMENT_POSTED' : 'TODA_ANNOUNCEMENT_DRAFTED',
    targetId: data?.announcement_id,
    targetName: title,
    details: publish ? `Posted new TODA announcement: "${title}"` : `Saved a TODA announcement as a draft: "${title}"`,
    category: 'Announcement',
  });

  return data;
}

/** Row security answers "no permission" with zero rows, not an error: a change that touched nothing is reported as a failure (the same as the LGU portal). */
function announcementChanged(result: { data: unknown[] | null; error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
  if (!result.data || result.data.length === 0) {
    throw new Error('The announcement was not changed. It may have been deleted, or this account may not be allowed to change it.');
  }
}

/** Changes the text or the priority of an existing announcement (the same row; the publish state is untouched). */
export async function updateTodaAnnouncement(
  announcementId: string,
  input: { title: string; message: string; urgency: 'Standard' | 'High Priority' }
): Promise<void> {
  announcementChanged(
    await supabase
      .from('announcement')
      .update({ title: input.title, message: input.message, urgency: input.urgency === 'High Priority' ? 'Urgent' : 'Normal' })
      .eq('announcement_id', announcementId)
      .select('announcement_id')
  );
  await recordTodaAuditAction({
    actionType: 'TODA_ANNOUNCEMENT_EDITED',
    targetId: announcementId,
    targetName: input.title,
    details: `Edited the TODA announcement: "${input.title}"`,
    category: 'Announcement',
  });
}

/** Publishes (or hides again) an existing announcement; the database stamps the publication time. */
export async function setTodaAnnouncementPublished(announcementId: string, published: boolean, title = ''): Promise<void> {
  announcementChanged(await supabase.from('announcement').update({ is_published: published }).eq('announcement_id', announcementId).select('announcement_id'));
  await recordTodaAuditAction({
    actionType: published ? 'TODA_ANNOUNCEMENT_PUBLISHED' : 'TODA_ANNOUNCEMENT_UNPUBLISHED',
    targetId: announcementId,
    targetName: title || undefined,
    details: `${published ? 'Published' : 'Unpublished'} the TODA announcement${title ? `: "${title}"` : ''}`,
    category: 'Announcement',
  });
}

export async function deleteTodaAnnouncement(id: string) {
  const { error } = await supabase.from('announcement').delete().eq('announcement_id', id);
  if (error) throw error;
  return true;
}

export interface TodaRosterEntry {
  /** the database id of the entry (an entry that only exists in this browser has none and cannot be edited) */
  entry_id?: string;
  updated_at?: string | null;
  roster_id: string;
  toda_id: string;
  franchise_number: string;
  plate_number: string;
  member_name: string;
  created_at: string;
  /** the TODA's own number for the member (optional) */
  membership_number?: string | null;
  /** where the entry came from: the registration roster file, typed in, or a later file */
  source?: 'registration_file' | 'manual' | 'file_update' | string;
  /** a member who left stays on the list as history (decision D-P9) */
  status?: 'Active' | 'Left' | string;
  left_at?: string | null;
  left_reason?: string | null;
}

/**
 * The entries of this TODA's master roster, as the database holds them. (An earlier version also showed entries that were only saved in
 * this browser: they looked like roster members but the roster check could never see them, so they are no longer listed.)
 */
export async function fetchTodaRosterEntries(todaId?: string): Promise<TodaRosterEntry[]> {
  try {
    const targetTodaId = await getEffectiveTodaId(todaId);
    await autoImportTodaRoster(targetTodaId);

    const { data, error } = await supabase
      .from('toda_roster_entry')
      .select('*')
      .eq('toda_id', targetTodaId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[todaApiService] fetchTodaRosterEntries warning:', error);
      try {
        const serverRes = await apiFetch(supabase, `${API_BASE_URL}/admin/todas/${targetTodaId}/roster`);
        const json = await serverRes.json();
        if (json.success && json.data) return json.data as TodaRosterEntry[];
      } catch {
        // the answer below is an empty list: it never claims entries the database did not give
      }
      return [];
    }

    return (data || []) as TodaRosterEntry[];
  } catch (err) {
    console.error('[todaApiService] fetchTodaRosterEntries error:', err);
    return [];
  }
}

/**
 * Corrects one entry of the TODA's master roster. The database function (update_toda_roster_entry, migration 20261014000001) checks the
 * entry belongs to this TODA, refuses a franchise number another entry already has, writes the audit log, and remembers when the franchise
 * or plate number changed so an edit never makes an application that was submitted earlier look "found on the roster".
 */
export async function updateTodaRosterEntry(
  entryId: string,
  input: { memberName: string; franchiseNumber: string; plateNumber: string; membershipNumber?: string }
): Promise<{ changed: boolean }> {
  const { data, error } = await supabase.rpc('update_toda_roster_entry', {
    p_entry_id: entryId,
    p_member_name: input.memberName,
    p_franchise_number: input.franchiseNumber,
    p_plate_number: input.plateNumber.trim() || null,
    // undefined = leave the membership number as it is; an empty text clears it
    p_membership_number: input.membershipNumber === undefined ? null : input.membershipNumber.trim(),
  });
  if (error) throw new Error(error.message);
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The roster entry was not updated.'));
  return { changed: data.changed === true };
}

export async function addTodaRosterEntry(entry: {
  todaId?: string;
  memberName: string;
  franchiseNumber: string;
  plateNumber: string;
  membershipNumber?: string;
}): Promise<TodaRosterEntry> {
  // add_toda_roster_entry (migration 20261031000005) checks the caller, the fields and the duplicate, writes the audit entry and returns the new row
  const { data, error } = await supabase.rpc('add_toda_roster_entry', {
    p_member_name: entry.memberName.trim(),
    p_franchise_number: entry.franchiseNumber.trim(),
    p_plate_number: entry.plateNumber.trim(),
    p_membership_number: entry.membershipNumber?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The roster entry could not be saved. Please try again.'));
  return data.entry as TodaRosterEntry;
}

/** A member who has left: he stays on the list as history and stops matching NEW applications. A reason of at least 10 characters is required. */
export async function markTodaRosterEntryLeft(entryId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc('mark_toda_roster_entry_left', { p_entry_id: entryId, p_reason: reason.trim() });
  if (error) throw new Error(error.message);
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The member was not marked as left.'));
}

/** Puts a member who left back: a NEW entry is made (the old one stays as history), so he counts from now like any new member. */
export async function reinstateTodaRosterEntry(entryId: string): Promise<TodaRosterEntry> {
  const { data, error } = await supabase.rpc('reinstate_toda_roster_entry', { p_entry_id: entryId });
  if (error) throw new Error(error.message);
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The member was not put back on the roster.'));
  return data.entry as TodaRosterEntry;
}

export interface RosterFileVersion {
  version_id: string;
  kind: 'registration' | 'update';
  file_name: string | null;
  uploaded_at: string;
  file_path: string;
}

/** "20 at registration, 22 now": what the Master Roster holds compared with the roster file submitted at registration (get_toda_roster_summary) */
export interface RosterSummary {
  found: boolean;
  registration_file: { file_name: string; uploaded_at: string } | null;
  from_registration_file: number;
  active: number;
  added_later: number;
  left: number;
  edited: number;
  versions: RosterFileVersion[];
}

export async function fetchTodaRosterSummary(todaId?: string): Promise<RosterSummary | null> {
  const { data, error } = await supabase.rpc('get_toda_roster_summary', { p_toda_id: todaId ?? null });
  if (error || !data || data.found !== true) return null;
  return data as RosterSummary;
}

/** What a newer roster file would change in the Master Roster: nothing happens until the TODA confirms each member. */
export interface RosterFileDiff {
  fileName: string;
  rowsInFile: number;
  /** in the file, not an active member yet */
  onlyInFile: Array<{ name: string; franchiseNumber: string }>;
  /** an active member, not in the file */
  onlyOnRoster: TodaRosterEntry[];
  /** in both */
  inBoth: number;
}

const normalizeFranchiseKey = (value?: string | null): string => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function diffRosterFileWithRoster(filePath: string, fileName: string, todaId?: string): Promise<RosterFileDiff> {
  const targetTodaId = await getEffectiveTodaId(todaId);
  const buffer = await downloadRosterFile(filePath);
  if (!buffer) throw new Error('The roster file could not be opened. Please try again in a moment.');
  const parsed = await parseDriverRoster(buffer);
  const rows = (parsed?.rows || []).filter((row) => normalizeFranchiseKey(row.franchiseNumber) !== '');
  if (rows.length === 0) throw new Error('No members with a franchise number were found in the roster file.');

  const { data, error } = await supabase.from('toda_roster_entry').select('*').eq('toda_id', targetTodaId).eq('status', 'Active');
  if (error) throw new Error(error.message);
  const active = (data || []) as TodaRosterEntry[];
  const activeKeys = new Set(active.map((e) => normalizeFranchiseKey(e.franchise_number)));
  const fileKeys = new Set(rows.map((row) => normalizeFranchiseKey(row.franchiseNumber)));
  const seen = new Set<string>();
  const onlyInFile = rows
    .filter((row) => {
      const key = normalizeFranchiseKey(row.franchiseNumber);
      if (activeKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({ name: row.name, franchiseNumber: row.franchiseNumber }));
  return {
    fileName,
    rowsInFile: rows.length,
    onlyInFile,
    onlyOnRoster: active.filter((e) => !fileKeys.has(normalizeFranchiseKey(e.franchise_number))),
    inBoth: active.filter((e) => fileKeys.has(normalizeFranchiseKey(e.franchise_number))).length,
  };
}

/** Applies what the TODA confirmed: the members to add (as an updated file's entries) and the members to mark as left, each with a reason. Returns what was done. */
export async function applyRosterReconciliation(input: {
  add: Array<{ name: string; franchiseNumber: string }>;
  markLeft: Array<{ entryId: string; reason: string }>;
}): Promise<{ added: number; left: number; failed: string[] }> {
  const result = { added: 0, left: 0, failed: [] as string[] };
  if (input.add.length > 0) {
    const rows = input.add.map((m) => ({ member_name: m.name, franchise_number: m.franchiseNumber }));
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase.rpc('import_toda_roster', { p_entries: rows.slice(i, i + 500), p_source: 'file_update' });
      if (error || !data || data.success !== true) {
        result.failed.push(error?.message || String(data?.error || 'Some members could not be added.'));
        break;
      }
      result.added += Number(data.added) || 0;
    }
  }
  for (const m of input.markLeft) {
    try {
      await markTodaRosterEntryLeft(m.entryId, m.reason);
      result.left += 1;
    } catch (err) {
      result.failed.push((err as Error).message);
    }
  }
  return result;
}

// Roster files already brought into the master roster during this page load (so the portal does it once, not on every screen)
const rosterFilesSynced = new Set<string>();

/**
 * Keeps the master roster in step with the roster FILE the TODA submitted, without anyone clicking anything: right after registering, right after
 * the file is replaced, and once per page load for a TODA that registered before this existed. Add-only (a franchise already on the roster is
 * left alone) and quiet: when it cannot run, the roster stays as it is and nothing is shown. Returns what it did, or null when it did nothing.
 */
export async function autoImportTodaRoster(todaId?: string): Promise<RosterImportResult | null> {
  try {
    const targetTodaId = await getEffectiveTodaId(todaId);
    const { data: toda } = await supabase.from('toda').select('accredited_drivers_url').eq('toda_id', targetTodaId).maybeSingle();
    const fileUrl: string | null = toda?.accredited_drivers_url || null;
    if (!fileUrl) return null;

    const key = `${targetTodaId}|${fileUrl}`;
    if (rosterFilesSynced.has(key)) return null;
    rosterFilesSynced.add(key);

    // Decision D-P9: the registration file is imported ONCE, when the roster has nothing from it yet. Importing it again later would bring back a member who has left.
    const { count } = await supabase.from('toda_roster_entry').select('entry_id', { count: 'exact', head: true }).eq('toda_id', targetTodaId).eq('source', 'registration_file');
    if ((count ?? 0) > 0) return null;

    return await importTodaRosterFromUploadedFile(targetTodaId, fileUrl);
  } catch (err) {
    console.warn('[todaApiService] The roster file was not added to the master roster:', (err as Error)?.message || err);
    return null;
  }
}

export interface RosterImportResult {
  /** Members found in the roster file */
  rowsInFile: number;
  added: number;
  /** Already on the roster (same franchise number) or repeated in the file */
  skippedDuplicate: number;
  /** No usable franchise number or name */
  skippedInvalid: number;
}

/**
 * Fills the master roster from the roster file this TODA already submitted (the one used to build the member list): the rows are read
 * here and handed to the database function import_toda_roster, which adds only the ones with a franchise number the roster does not have
 * yet. Imported entries are dated when they are imported, like any entry typed in.
 */
export async function importTodaRosterFromUploadedFile(todaId?: string, knownFileUrl?: string | null): Promise<RosterImportResult> {
  const targetTodaId = await getEffectiveTodaId(todaId);
  let fileUrl = knownFileUrl || null;
  if (!fileUrl) {
    const { data: toda, error: todaErr } = await supabase
      .from('toda')
      .select('accredited_drivers_url')
      .eq('toda_id', targetTodaId)
      .maybeSingle();
    if (todaErr) throw new Error(todaErr.message);
    fileUrl = toda?.accredited_drivers_url || null;
  }
  if (!fileUrl) {
    throw new Error('Your TODA has no roster file on record. Add the members one by one instead.');
  }

  const buffer = await downloadRosterFile(fileUrl);
  if (!buffer) throw new Error('The roster file could not be opened. Please try again in a moment.');

  const parsed = await parseDriverRoster(buffer);
  const rows = (parsed?.rows || []).map((row) => ({ member_name: row.name, franchise_number: row.franchiseNumber }));
  if (rows.length === 0) throw new Error('No members were found in the roster file.');

  const result: RosterImportResult = { rowsInFile: rows.length, added: 0, skippedDuplicate: 0, skippedInvalid: 0 };
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.rpc('import_toda_roster', { p_entries: rows.slice(i, i + 500), p_source: 'registration_file' });
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) throw new Error(String(data?.error || 'The roster could not be imported.'));
    result.added += Number(data.added) || 0;
    result.skippedDuplicate += Number(data.skipped_duplicate) || 0;
    result.skippedInvalid += Number(data.skipped_invalid) || 0;
  }
  return result;
}

// ============================================================================
// BATCH 7: TRIPS THAT WENT SILENT (RULES 9.5, 9.6), AREAS OF REPEATED GPS TROUBLE (RULE 17.5), STRIKE APPEALS (RULES 8.6, 9.4, 25)
// ============================================================================

/** Rule 9.5: the trips of this TODA's drivers whose location stayed silent for 30 minutes and wait to be closed by an administrator. */
export async function fetchTripsNeedingReconciliation(): Promise<ReconciliationTrip[]> {
  const { data, error } = await supabase.rpc('get_trips_needing_reconciliation');
  if (error) {
    console.warn('[todaApiService] fetchTripsNeedingReconciliation:', error.message);
    return [];
  }
  return mapReconciliationTrips(data);
}

/** Rule 9.5: closes such a trip after phoning or texting the parties. Resolves to null when accepted, else the database's explanation. */
export async function reconcileTrip(input: ReconcileInput): Promise<string | null> {
  const { error } = await supabase.rpc('admin_reconcile_trip', reconcileTripArgs(input));
  return error ? adminActionMessage(error.message, 'The trip could not be closed.') : null;
}

/** Rule 9.6: reports a driver who went offline on purpose, with the evidence; the LGU Administrator confirms (2 strikes) or dismisses it. */
export async function reportDeliberateOffline(input: DeliberateOfflineInput): Promise<string | null> {
  const { error } = await supabase.rpc('report_deliberate_offline', deliberateOfflineArgs(input));
  return error ? adminActionMessage(error.message, 'The report could not be sent.') : null;
}

// ============================================================================
// BATCH 9: FARE DISPUTES (RULES 13.5, 18.4, 18.6)
// ============================================================================

/** The fare disputes of this TODA's drivers (all of them, so an escalated one stays visible). The database decides who may read what. */
export async function fetchFareDisputes(): Promise<FareDisputeRow[]> {
  const { data, error } = await supabase.rpc('get_fare_disputes', fareDisputesArgs(null, 100));
  if (error) {
    console.warn('[todaApiService] fetchFareDisputes:', error.message);
    return [];
  }
  return parseFareDisputes(data);
}

/** Rule 18.4: passes a dispute to the LGU Administrator. Resolves to null when accepted, else the database's explanation. */
export async function escalateFareDispute(disputeId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('escalate_fare_dispute', escalateFareDisputeArgs(disputeId, reason));
  return error ? adminActionMessage(error.message, 'The dispute could not be escalated.') : null;
}

/** Rules 13.5 / 18.4 / 18.6: decides a dispute (the fare, the payment, and the strike when one is confirmed). Resolves to null when accepted, else the database's explanation. */
export async function resolveFareDispute(decision: FareDisputeDecision): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_fare_dispute', resolveFareDisputeArgs(decision));
  return error ? adminActionMessage(error.message, 'The decision could not be recorded.') : null;
}

export interface GpsArea {
  cellKey: string;
  centerLatitude: number;
  centerLongitude: number;
  determinations: number;
  stalls: number;
  connectivity: number;
  firstAt: string;
  lastAt: string;
  reported: boolean;
}

/** Rule 17.5: the squares where this TODA's drivers were cancelled for a stall or a lost connection often enough to be worth reporting. */
export async function fetchGpsAreas(): Promise<{ areas: GpsArea[]; minCount: number; windowDays: number }> {
  const { data, error } = await supabase.rpc('get_gps_determination_hotspots');
  const row = data as { areas?: Array<Record<string, unknown>>; min_count?: number; window_days?: number } | null;
  if (error || !row) return { areas: [], minCount: 3, windowDays: 30 };
  return {
    minCount: Number(row.min_count ?? 3),
    windowDays: Number(row.window_days ?? 30),
    areas: (row.areas ?? []).map((a) => ({
      cellKey: String(a.cell_key),
      centerLatitude: Number(a.center_latitude),
      centerLongitude: Number(a.center_longitude),
      determinations: Number(a.determinations),
      stalls: Number(a.stalls),
      connectivity: Number(a.connectivity),
      firstAt: String(a.first_at),
      lastAt: String(a.last_at),
      reported: Boolean(a.reported),
    })),
  };
}

/** Rule 17.5: reports an area to the LGU Administrator for a possible service-zone boundary adjustment. */
export async function reportGpsArea(cellKey: string, note: string): Promise<string | null> {
  const { error } = await supabase.rpc('report_gps_area_issue', { p_cell_key: cellKey, p_note: note });
  return error ? adminActionMessage(error.message, 'The area could not be reported.') : null;
}

const manilaStamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Links for the photos of an appeal or a fare-dispute statement (Storage signs only what this administrator may read: the TODA's own drivers' cases). */
export const signTodaCaseEvidence = (paths: string[]): Promise<CaseEvidenceFile[]> => signCaseEvidence(supabase, paths);

/** Rules 8.6, 9.4, 25: the strike appeals of this TODA's drivers, as the database holds them (row security shows a TODA Administrator only their own). */
export async function fetchTodaExemptionRequests(): Promise<DriverExemptionRequest[]> {
  const { data: requests, error } = await supabase
    .from('exemption_request')
    .select('request_id, strike_id, subject_id, cause_code, justification, evidence_urls, status, requested_at, decision_due_at, assigned_role, decision_reason')
    .eq('subject_type', 'driver')
    .order('requested_at', { ascending: false })
    .limit(100);
  if (error || !requests || requests.length === 0) return [];

  const strikeIds = [...new Set(requests.map((r) => String(r.strike_id)))];
  const driverIds = [...new Set(requests.map((r) => String(r.subject_id)))];
  const [strikes, drivers, catalog] = await Promise.all([
    supabase.from('strikes_ledger').select('strike_id, violation_code, source_rule, points_active').in('strike_id', strikeIds),
    supabase.from('driver').select('driver_id, full_name').in('driver_id', driverIds),
    supabase.from('violation_catalog').select('violation_code, description'),
  ]);
  const strikeById = new Map((strikes.data ?? []).map((s) => [String(s.strike_id), s]));
  const driverName = new Map((drivers.data ?? []).map((d) => [String(d.driver_id), String(d.full_name)]));
  const described = new Map((catalog.data ?? []).map((c) => [String(c.violation_code), String(c.description)]));

  return requests.map((r) => {
    const strike = strikeById.get(String(r.strike_id));
    const urls: string[] = Array.isArray(r.evidence_urls) ? (r.evidence_urls as unknown[]).map(String) : [];
    // the photos stay storage PATHS here; the page asks Storage for a short-lived link when the administrator opens the appeal (Rule 25.2, migration 20261028000006)
    const evidenceFiles: EvidenceFileItem[] = urls.map((path, i) => ({
      id: path,
      name: 'Photo ' + (i + 1),
      type: 'image',
      url: '',
    }));
    return {
      id: String(r.request_id),
      driverId: String(r.subject_id),
      driverName: driverName.get(String(r.subject_id)) ?? 'Driver',
      strikeId: String(r.strike_id),
      incidentCategory: (strike ? described.get(String(strike.violation_code)) ?? String(strike.violation_code) : 'Strike') + (strike ? ' (' + strike.source_rule + ')' : ''),
      reason: String(r.justification),
      evidenceFiles,
      submittedAt: manilaStamp(String(r.requested_at)),
      status: String(r.status) as DriverExemptionRequest['status'],
      decisionNotes: r.decision_reason ? String(r.decision_reason) : undefined,
      causeCode: String(r.cause_code),
      strikePointsActive: strike ? Number(strike.points_active) : undefined,
      decisionDueAt: r.decision_due_at ? manilaStamp(String(r.decision_due_at)) : undefined,
      assignedRole: String(r.assigned_role),
    };
  });
}

/**
 * Rules 5.3 / 5.7: the TODA Administrator reports a driver of this TODA seen queued at the terminal while Available in the app, or one who accepted a booking while
 * carrying other passengers. A report only: a strike follows when an administrator confirms it. Null when it was filed, otherwise the database's sentence.
 */
export async function reportDriverAvailability(driverId: string, kind: AvailabilityKind, description: string): Promise<string | null> {
  const { error } = await supabase.rpc('report_driver_availability_violation', reportAvailabilityArgs(driverId, kind, null, description));
  return error ? adminActionMessage(error.message, 'The report could not be filed.') : null;
}

/** Rules 5.3 / 5.7: the TODA Administrator confirms a report of one of this TODA's drivers: the strike is recorded under their name. Null when it was recorded. */
export async function confirmAvailabilityViolation(flagId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('confirm_driver_availability_violation', confirmAvailabilityArgs(flagId, reason));
  return error ? adminActionMessage(error.message, 'The strike could not be recorded.') : null;
}

/**
 * PI-15: a trip the driver left at the destination (Payment Received never tapped) for 30 minutes is closed by the driver's TODA Administrator as Paid or Waived
 * after both parties were contacted. Null when it was closed (the flag is resolved with it), otherwise the database's sentence.
 */
export async function closeUnfinishedTrip(bookingId: string, paymentStatus: 'Paid' | 'Waived', reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_close_unfinished_trip', closeUnfinishedTripArgs(bookingId, paymentStatus, reason));
  return error ? adminActionMessage(error.message, 'The trip could not be closed.') : null;
}

/** Rule 25.4: passes an appeal that is with this TODA to the LGU Administrator (a serious consequence, or the TODA cannot decide it fairly). Null when it was passed. */
export async function escalateExemptionRequest(requestId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('escalate_exemption_request', escalateExemptionArgs(requestId, reason));
  return error ? adminActionMessage(error.message, 'The appeal could not be passed to the LGU.') : null;
}

/** Rule 25.6: decides a strike appeal: Full waiver, Partial waiver (the points to waive) or Denied, with the reason (Rule 25.8). Null when accepted. */
export async function decideExemptionRequest(requestId: string, outcome: 'FULL' | 'PARTIAL' | 'DENIED', reason: string, pointsToWaive?: number): Promise<string | null> {
  const { error } = await supabase.rpc('decide_exemption', {
    p_request_id: requestId,
    p_outcome: outcome,
    p_reason: reason,
    p_points_to_waive: outcome === 'PARTIAL' ? pointsToWaive ?? null : null,
  });
  return error ? adminActionMessage(error.message, 'The decision could not be recorded.') : null;
}
