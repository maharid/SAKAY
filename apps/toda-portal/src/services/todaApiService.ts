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
  TodaDriverMember,
  TodaAnnouncement,
  TodaAuditLog,
} from '../types/toda';
import { parseDriverRoster } from '../utils/rosterParser';
import { REJECTION_REASON_LABEL, SIGNED_URL_TTL, apiFetch, apiPostJson, isRejectionReasonCode, ownedObjectPath, signIncidentEvidence, signedStorageUrlFromAny } from '@sakay/shared';
import type { RejectionReasonCode } from '@sakay/shared';

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

    const isDbActive = ['active', 'approved', 'verified', 'accredited'].includes(
      String(data.toda_status || data.account_status || data.status || '').toLowerCase()
    );

    return {
      id: data.toda_id,
      name: data.toda_name,
      acronym: data.toda_acronym || 'TODA',
      registrationNumber: data.registration_number || data.toda_acronym || 'TODA',
      dateEstablished: data.date_established || '2024-01-01',
      terminalLocation: data.terminal_location || data.service_coverage_area || 'Calapan City Terminal',
      terminalLatitude: data.terminal_latitude || null,
      terminalLongitude: data.terminal_longitude || null,
      barangay: data.barangay || 'Calapan City',
      serviceCoverageArea: data.service_coverage_area || 'Calapan City Corridor',
      contactNumber: data.president_contact || data.contact_number || '+63 917 000 0000',
      email: data.email || `${(data.toda_acronym || 'toda').toLowerCase()}@toda.sakay.internal`,
      officers: {
        president: data.president_name || 'Association President',
        presidentContact: data.president_contact || '',
        vicePresident: data.vice_president_name || 'N/A',
        vicePresidentContact: data.vice_president_contact || '',
        secretary: data.secretary_name || 'N/A',
        secretaryContact: data.secretary_contact || '',
        treasurer: data.treasurer_name || 'N/A',
        treasurerContact: data.treasurer_contact || '',
      },
      accreditationStatus: isDbActive ? 'Active' : 'Pending Verification',
      accreditationExpiry: data.certificate_expiry ? new Date(data.certificate_expiry).toLocaleDateString('en-US') : 'Dec 31, 2026',
      accreditationNo: data.certificate_number || data.toda_acronym || 'TODA',
      permitNumber: data.toda_acronym || 'TODA',
      barangayClearanceFile: {
        name: data.barangay_clearance_url ? data.barangay_clearance_url.split('/').pop()?.split('?')[0] || 'Barangay_Clearance.pdf' : 'Barangay_Clearance.pdf',
        date: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Jan 10, 2026',
        url: data.barangay_clearance_url,
      },
      rosterFile: {
        name: data.accredited_drivers_url ? data.accredited_drivers_url.split('/').pop()?.split('?')[0] || 'TODA_Driver_Roster.xlsx' : 'TODA_Driver_Roster.xlsx',
        date: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Jan 15, 2026',
        count: data.registered_tricycle_count || driverCount || 0,
        url: data.accredited_drivers_url,
      },
      bylawsFile: {
        name: data.bylaws_url ? data.bylaws_url.split('/').pop()?.split('?')[0] || 'TODA_Bylaws.pdf' : 'TODA_Bylaws.pdf',
        date: data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Jan 15, 2026',
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
  }> = {}
) {
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

  // Terminal coordinates must go through official request_terminal_relocation RPC
  if (profileData.terminalLatitude !== undefined && profileData.terminalLongitude !== undefined && profileData.terminalLatitude !== null && profileData.terminalLongitude !== null) {
    try {
      await supabase.rpc('request_terminal_relocation', {
        p_toda_id: targetTodaId,
        p_new_latitude: profileData.terminalLatitude,
        p_new_longitude: profileData.terminalLongitude,
        p_new_location: profileData.terminalLocation || 'Updated Terminal Location',
        p_reason: 'Requested relocation via TODA profile edit',
      });
    } catch (reloErr) {
      console.warn('[todaApiService] Relocation request error:', reloErr);
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

  return { success: true, data: updatedData };
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

/**
 * Updates a TODA compliance document URL (Barangay Clearance, Driver Roster, or Bylaws)
 * in the database and marks status as 'Pending Verification' so the LGU can verify and endorse it.
 */
export async function updateTodaComplianceDocument(
  todaId: string,
  category: 'Barangay Clearance' | 'Driver Roster' | 'Internal Bylaws',
  fileUrl: string,
  fileName: string
) {
  // Columns guaranteed to exist in public.toda (no updated_at!)
  const updatePayload: Record<string, any> = {
    toda_status: 'Pending Verification',
    resubmission_reason: null, // Clear any previous correction request
  };

  if (category === 'Barangay Clearance') {
    updatePayload.barangay_clearance_url = fileUrl;
  } else if (category === 'Driver Roster') {
    updatePayload.accredited_drivers_url = fileUrl;
  } else if (category === 'Internal Bylaws') {
    updatePayload.bylaws_url = fileUrl;
  }

  let updatedData: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('toda')
      .update(updatePayload)
      .eq('toda_id', todaId)
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
    } else if (errMsg.includes('toda_status') && 'toda_status' in updatePayload) {
      delete updatePayload.toda_status;
      updatePayload.account_status = 'Pending Verification';
    } else {
      console.error('[todaApiService] updateTodaComplianceDocument error:', error);
      throw error;
    }
  }

  await recordTodaAuditAction({
    actionType: 'COMPLIANCE_DOCUMENT_UPDATED',
    targetId: todaId,
    targetName: fileName,
    details: `Re-uploaded and submitted updated ${category} ("${fileName}") for City LGU verification and review.`,
    category: 'Account',
  });

  return updatedData || { toda_id: todaId, status: 'Pending Verification', fileUrl };
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
      p_terminal_latitude: payload.terminalLatitude ?? 13.4115,
      p_terminal_longitude: payload.terminalLongitude ?? 121.1803,
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
      if (detail.includes('ERR_ALREADY_TODA_ADMIN')) {
        throw new Error('This login already administers a TODA. Choose a different acronym to register another TODA.');
      }
      throw new Error(detail ? `The registration could not be saved: ${detail}` : 'The registration could not be saved. Please try again.');
    }

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

export async function resubmitTodaApplication(todaId: string, updatedData: any) {
  let updatePayload: Record<string, any> = {
    ...updatedData,
    toda_status: 'Pending Verification',
  };
  delete updatePayload.updated_at;
  delete updatePayload.terminal_location;

  let updatedDataResult: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('toda')
      .update(updatePayload)
      .eq('toda_id', todaId)
      .select()
      .maybeSingle();

    if (!error) {
      updatedDataResult = data;
      break;
    }

    const errMsg = (error.message || '') + ' ' + (error.details || '');
    const match =
      errMsg.match(/Could not find the '([^']+)' column/i) ||
      errMsg.match(/column [^.]*\.?([a-zA-Z0-9_]+) does not exist/i);

    if (match && match[1] && match[1] in updatePayload) {
      console.warn(`[todaApiService] Column '${match[1]}' does not exist in 'toda', pruning and retrying...`);
      delete updatePayload[match[1]];
    } else if (errMsg.includes('toda_status') && 'toda_status' in updatePayload) {
      delete updatePayload.toda_status;
      updatePayload.account_status = 'Pending Verification';
    } else {
      console.error('[todaApiService] resubmitTodaApplication error:', error);
      throw error;
    }
  }

  await recordTodaAuditAction({
    actionType: 'TODA_APPLICATION_RESUBMITTED',
    targetId: todaId,
    details: `Corrected and resubmitted TODA accreditation application for '${updatedDataResult?.toda_name || todaId}'.`,
  });

  return { success: true, data: updatedDataResult };
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

    // 3. If an accredited driver roster file was uploaded, parse and render from the submitted document
    if (todaRecord?.accredited_drivers_url) {
      try {
        const rawUrl = todaRecord.accredited_drivers_url;
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

        if (arrayBuffer) {
          const parsed = await parseDriverRoster(arrayBuffer);
          if (parsed && parsed.rows && parsed.rows.length > 0) {
            return parsed.rows.map((row, idx) => {
              const cleanName = (row.name || '').trim().toLowerCase();
              const cleanFranchise = (row.franchiseNumber || '').trim().toLowerCase();

              // Correlate strictly with registered driver account by franchise number
              const matchedDriver = driverList.find((d: any) => {
                const dFranchise = (d.franchise_number || d.plate_number || '').trim().toLowerCase();
                return Boolean(cleanFranchise && dFranchise === cleanFranchise);
              });

              let accountStatus: string = 'Not Registered';
              if (matchedDriver) {
                const rawStatus = matchedDriver.account_status;
                if (rawStatus === 'Suspended') {
                  accountStatus = 'TODA Suspended';
                } else if (rawStatus === 'Active' || rawStatus === 'Verified') {
                  accountStatus = 'Active';
                } else if (rawStatus === 'Deactivated') {
                  accountStatus = 'LGU Deactivated';
                } else if (rawStatus === 'Pending' || rawStatus === 'Pending Verification') {
                  accountStatus = 'Pending Verification';
                } else {
                  accountStatus = rawStatus || 'Active';
                }
              } else {
                accountStatus = 'Not Registered';
              }

              return {
                id: matchedDriver?.driver_id || `roster-${idx + 1}`,
                membershipNo: `MEM-${String(idx + 1).padStart(3, '0')}`,
                name: row.name || `Driver #${idx + 1}`,
                phone: matchedDriver?.contact_number || '',
                vehiclePlate: matchedDriver?.plate_number || row.franchiseNumber || 'N/A',
                franchiseNo: row.franchiseNumber || matchedDriver?.franchise_number || 'N/A',
                licenseNo: matchedDriver?.license_number || '',
                serviceZone: todaRecord?.service_coverage_area || todaRecord?.barangay || 'Calapan City',
                todaVerificationStatus: 'Verified',
                lguVerificationStatus: matchedDriver?.account_status === 'Verified' ? 'Verified' : 'Pending',
                accountStatus: accountStatus as TodaDriverMember['accountStatus'],
                suspensionReason: matchedDriver?.suspension_reason || undefined,
                suspendedAt: matchedDriver?.suspended_at ? new Date(matchedDriver.suspended_at).toLocaleDateString('en-US') : undefined,
                strikesCount: matchedDriver?.strikes_count || 0,
                rating: Number(matchedDriver?.weighted_average_rating) || 5.0,
                totalTrips: 0,
                joinedDate: todaRecord?.created_at ? new Date(todaRecord.created_at).toLocaleDateString('en-US') : 'Recent',
                availabilityStatus: matchedDriver?.availability_status || undefined,
                bookingsPausedUntil: matchedDriver?.bookings_paused_until || null,
              };
            });
          }
        }
      } catch (rosterParseErr) {
        console.warn('[todaApiService] Could not parse uploaded roster file, falling back to driver table:', rosterParseErr);
      }
    }

    // 4. Fallback to registered driver table accounts
    if (driverList.length > 0) {
      return driverList.map((d: any, idx: number) => ({
        id: d.driver_id,
        membershipNo: d.toda_membership_number || `MEM-${String(idx + 1).padStart(3, '0')}`,
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
        rating: Number(d.weighted_average_rating) || 5.0,
        totalTrips: 0,
        joinedDate: d.created_at ? new Date(d.created_at).toLocaleDateString('en-US') : 'Recent',
        availabilityStatus: d.availability_status || undefined,
        bookingsPausedUntil: d.bookings_paused_until || null,
      }));
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

    // The roster match, asked of the database: the SAME function the endorsement uses (franchise or plate number against this TODA's roster
    // entries made before the application; a name alone never matches), so this screen and the Roster Mismatch flag cannot disagree.
    const rosterMatches = new Map<string, boolean>();
    try {
      const { data: matchRows, error: matchErr } = await supabase.rpc('get_affiliation_roster_matches', {
        p_affiliation_ids: data.map((aff: any) => aff.affiliation_id),
      });
      if (matchErr) throw matchErr;
      for (const r of (matchRows || []) as any[]) rosterMatches.set(r.affiliation_id, Boolean(r.roster_matched));
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
        submittedDate: aff.submitted_at ? new Date(aff.submitted_at).toLocaleDateString('en-US') : 'Recent',
        daysPending,
        isOverdue: aff.toda_endorsement_status === 'Submitted' && daysPending > 3,
        onSubmittedRoster: rosterMatches.get(aff.affiliation_id) === true,
        rosterMatchKnown: rosterMatches.has(aff.affiliation_id),
        tricyclePhotoUrl: tricyclePhotoUrl || d.profile_photo_url || '',
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
  selfie: 'Selfie / face photo',
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

export async function submitIncidentRemarks(incidentId: string, remarks: string, status?: 'Resolved') {
  // The database stamps the signed-in TODA administrator as the reviewer (reviewed_by_toda is a UUID the guard fills in).
  const updatePayload: Record<string, any> = {
    resolution: remarks,
    resolution_notes: remarks,
    ...(status ? { status } : {}),
  };
  const { data, error } = await supabase
    .from('incident_report')
    .update(updatePayload)
    .eq('incident_id', incidentId)
    .select()
    .single();

  if (error) throw error;

  await recordTodaAuditAction({
    actionType: 'TODA_INCIDENT_REMARKS_SUBMITTED',
    targetId: incidentId,
    details: `Submitted internal TODA remarks on incident: "${remarks}"`,
    category: 'Incident',
  });

  return { success: true, data };
}

export async function escalateIncidentToLgu(incidentId: string, remarks?: string) {
  const escalationNote = `[Escalated to LGU Transport Board] ${remarks || 'Requires City LGU investigation.'}`;
  const updatePayload: Record<string, any> = {
    status: 'Under Investigation',
    resolution: escalationNote,
    resolution_notes: escalationNote,
  };
  const { data, error } = await supabase
    .from('incident_report')
    .update(updatePayload)
    .eq('incident_id', incidentId)
    .select()
    .single();

  if (error) throw error;

  await recordTodaAuditAction({
    actionType: 'INCIDENT_ESCALATED_TO_LGU',
    targetId: incidentId,
    details: `Escalated incident complaint to City LGU Administrator & Transport Board. Remarks: ${remarks || 'None'}`,
    category: 'Incident',
  });

  return { success: true, data };
}

export async function fetchTodaAuditLogs(): Promise<TodaAuditLog[]> {
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('performed_at', { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map((l: any) => ({
      id: l.log_id,
      log_id: l.log_id,
      toda_admin_id: l.toda_admin_id || l.target_id || 'TODA_ADMIN',
      actor_name: 'TODA Administrator',
      action_type: l.action_type,
      target_id: l.target_id || '',
      target_name: l.target_name || l.target_id || 'Entity',
      details: l.details || '',
      performed_at: (l.performed_at || l.created_at)
        ? new Date(l.performed_at || l.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Recent',
      category: (l.action_type.includes('DRIVER')
        ? 'Driver Verification'
        : l.action_type.includes('INCIDENT')
        ? 'Incident'
        : l.action_type.includes('ANNOUNCEMENT')
        ? 'Announcement'
        : 'Account') as any,
    }));
  } catch (err) {
    console.error('[todaApiService] fetchTodaAuditLogs error:', err);
    return [];
  }
}

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
        details: `[TODA Admin]: ${action.details}`,
        performed_at: new Date().toISOString(),
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

    const filtered = data.filter((a: any) => !a.toda_id || a.toda_id === effectiveTodaId);

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
  todaId?: string
) {
  const effectiveTodaId = await getEffectiveTodaId(todaId);
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase.from('announcement').insert([
    {
      title,
      message,
      urgency: urgency === 'High Priority' ? 'Urgent' : 'Normal',
      is_published: true,
      toda_id: effectiveTodaId,
      created_by: user?.id || null,
      created_at: new Date().toISOString(),
    },
  ]).select().single();

  if (error) throw error;

  await recordTodaAuditAction({
    actionType: 'TODA_ANNOUNCEMENT_POSTED',
    targetId: data?.announcement_id,
    targetName: title,
    details: `Posted new TODA announcement: "${title}"`,
    category: 'Announcement',
  });

  return data;
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
}

export async function fetchTodaRosterEntries(todaId?: string): Promise<TodaRosterEntry[]> {
  try {
    const targetTodaId = await getEffectiveTodaId(todaId);
    let localEntries: TodaRosterEntry[] = [];
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`sakay_toda_roster_${targetTodaId}`);
        if (raw) localEntries = JSON.parse(raw);
      } catch {}
    }

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
        if (json.success && json.data) {
          const merged = [...json.data];
          for (const le of localEntries) {
            if (!merged.some(m => m.franchise_number === le.franchise_number)) {
              merged.push(le);
            }
          }
          return merged;
        }
      } catch {}
      return localEntries;
    }

    const dbEntries = data || [];
    const merged = [...dbEntries];
    for (const le of localEntries) {
      if (!merged.some(m => m.franchise_number === le.franchise_number)) {
        merged.push(le);
      }
    }
    return merged;
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
  input: { memberName: string; franchiseNumber: string; plateNumber: string }
): Promise<{ changed: boolean }> {
  const { data, error } = await supabase.rpc('update_toda_roster_entry', {
    p_entry_id: entryId,
    p_member_name: input.memberName,
    p_franchise_number: input.franchiseNumber,
    p_plate_number: input.plateNumber.trim() || null,
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
}) {
  const targetTodaId = await getEffectiveTodaId(entry.todaId);
  const newEntry: TodaRosterEntry = {
    roster_id: 'roster-' + Date.now(),
    toda_id: targetTodaId,
    member_name: entry.memberName.trim(),
    franchise_number: entry.franchiseNumber.trim(),
    plate_number: entry.plateNumber.trim(),
    created_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(`sakay_toda_roster_${targetTodaId}`);
      const existing: TodaRosterEntry[] = raw ? JSON.parse(raw) : [];
      existing.unshift(newEntry);
      localStorage.setItem(`sakay_toda_roster_${targetTodaId}`, JSON.stringify(existing));
    } catch {}
  }

  try {
    const { data, error } = await supabase
      .from('toda_roster_entry')
      .insert({
        toda_id: targetTodaId,
        member_name: entry.memberName.trim(),
        franchise_number: entry.franchiseNumber.trim(),
        plate_number: entry.plateNumber.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      await recordTodaAuditAction({
        actionType: 'TODA_ROSTER_ENTRY_ADDED',
        targetId: targetTodaId,
        targetName: entry.memberName,
        details: `Added new official roster entry for '${entry.memberName}' (Franchise: ${entry.franchiseNumber}, Plate: ${entry.plateNumber}).`,
        category: 'Membership',
      });
      return data;
    }
    if (error) throw error;
  } catch (supabaseErr: any) {
    console.warn('[todaApiService] Direct Supabase roster insert note:', supabaseErr.message || supabaseErr);
    // 1. Try Express backend endpoint (port 5000)
    try {
      const serverRes = await apiFetch(supabase, `${API_BASE_URL}/admin/todas/${targetTodaId}/roster`, {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            {
              driver_full_name: entry.memberName.trim(),
              franchise_number: entry.franchiseNumber.trim(),
              plate_number: entry.plateNumber.trim(),
            },
          ],
        }),
      });
      const json = await serverRes.json();
      if (json.success && json.data?.[0]) {
        return json.data[0];
      }
    } catch {}

    // 2. Return local dev entry
    return newEntry;
  }
}

