/**
 * ============================================================================
 * SAKAY LGU ADMIN API & DATABASE SERVICE LAYER (adminApiService.ts)
 * ============================================================================
 * Purpose:
 *   Centralized service layer connecting the LGU Admin Portal directly to
 *   the live Supabase PostgreSQL cloud database and Express API server.
 *
 * Design Architecture:
 *   - 100% Real Database Queries: Direct Supabase client calls with robust error handling.
 *   - Clean empty states: Returns empty arrays / calculated real metrics.
 *   - Integrated Audit Logging: Every state mutation writes to public.audit_log.
 * ============================================================================
 */

import { adminActionMessage, mapServiceAreas, pilotAreaArgs, closeAccountArgs, closeUnfinishedTripArgs, confirmAvailabilityArgs, correctCompletedTripArgs, confirmFlaggedViolationArgs, decideExemptionArgs, mapAppealRows, voidStrikeArgs, escalateFareDisputeArgs, fareDisputesArgs, mapReconciliationTrips, parseFareDisputes, reconcileTripArgs, resolveFareDisputeArgs } from '@sakay/shared';
import type { ServiceAreaRecord, AppealRecord, AppealSubjectType, ExemptionOutcome, FareDisputeDecision, FareDisputeRow } from '@sakay/shared';
import type { ReconcileInput, ReconciliationTrip } from '@sakay/shared';
import { signCaseEvidence } from '@sakay/shared';
import type { CaseEvidenceFile } from '@sakay/shared';
import { supabase } from './supabaseClient';
import { formatManilaDateTime } from '@sakay/shared/utils/restrictionUtils';
import { SIGNED_URL_TTL, apiPostJson, classifyApplication, formatShortBookingId, signIncidentEvidence, signedStorageUrlFromAny } from '@sakay/shared';
import {
  TODA_INCIDENT_REPORT_FLAG_THRESHOLD,
  TODA_INCIDENT_REPORT_WINDOW_DAYS,
  decideIncident as decideIncidentReport,
  declareCalamity as declareCalamityReport,
  endCalamity as endCalamityReport,
  escalateIncident as escalateIncidentReport,
  fetchActiveCalamity,
  incidentClocks,
  endTripForSafety,
  startIncidentReview,
  updateLostItem,
  type SafetyEnd,
  type ActiveCalamity,
  type CalamityInput,
  type IncidentDecision,
  type IncidentRecord,
  type LostItemStatus,
  type TripEndResult,
} from '@sakay/shared';
import type { ApplicationReviewAffiliation, ApplicationReviewDocument, ApplicationStatus, ReviewDocumentType } from '@sakay/shared';
import {
  exportAuditLogFile,
  fetchAuditLogPage,
  manilaDayStartIso,
  manilaNextDayStartIso,
  type AuditLogFilters,
  type AuditRpc,
  type XlsxLike,
} from '@sakay/shared';
import {
  FareMatrixRecord,
  TodaApplicationRecord,
  AccreditedTodaRecord,
  DriverRecord,
  DriverAffiliationRecord,
  PassengerRecord,
  StrikeItem,
  IncidentReportRecord,
  AnnouncementRecord,
  AuditLogRecord,
} from '../mockData/adminData';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';

// ============================================================================
// 1. DASHBOARD METRICS & LIVE KPIS
// ============================================================================

export interface DashboardStats {
  kpis: {
    passengers: { total: number; active: number; inactive: number };
    drivers: { total: number; active: number; inactive: number };
    todas: { total: number; pendingReview: number };
    trips: { total: number; ongoing: number; allBookings: number; cancelled: number };
    verifications: { pending: number; overdue5Days: number };
    incidents: { open: number; total: number; resolved: number };
  };
  driverBreakdown: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    suspended: number;
  };
  recentIncidents: Array<{
    id: string;
    category: string;
    status: string;
    timestamp: string;
    severity: string;
    description: string;
    iconType: string;
  }>;
  recentApplications: Array<{
    id: string;
    name: string;
    barangay: string;
    submittedDate: string;
    status: string;
    representative: string;
    memberCount: number;
  }>;
  flaggedTodas: Array<{
    id: string;
    name: string;
    incidentCount: number;
  }>;
}

/**
 * Fetches real live dashboard statistics aggregated from Supabase tables.
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      passengersTotal,
      passengersActive,
      driversTotal,
      driversVerified,
      driversPending,
      driversSuspended,
      todasRes,
      bookingsTotal,
      bookingsCompleted,
      bookingsOngoing,
      incidentsTotal,
      incidentsOpen,
      bookingsCancelled,
      incidentsResolved,
      recentIncidentsRes,
      incidentReportsRes,
    ] = await Promise.all([
      supabase.from('passenger').select('*', { count: 'exact', head: true }),
      supabase.from('passenger').select('*', { count: 'exact', head: true }).eq('account_status', 'Active'),
      supabase.from('driver').select('*', { count: 'exact', head: true }).in('account_status', ['Pending Verification', 'Verified', 'Rejected', 'Suspended', 'Deactivated', 'Resubmission Required']),
      supabase.from('driver').select('*', { count: 'exact', head: true }).eq('account_status', 'Verified'),
      supabase.from('driver_verification').select('*', { count: 'exact', head: true }).in('verification_status', ['Approved', 'TODA Approved', 'TODA Endorsed', 'Endorsed to LGU', 'Resubmission Required']).is('lgu_approved_at', null),
      supabase.from('driver').select('*', { count: 'exact', head: true }).eq('account_status', 'Suspended'),
      supabase.from('toda').select('*').order('created_at', { ascending: false }),
      supabase.from('booking').select('*', { count: 'exact', head: true }),
      supabase.from('booking').select('*', { count: 'exact', head: true }).eq('booking_status', 'Completed'),
      supabase.from('booking').select('*', { count: 'exact', head: true }).in('booking_status', ['Accepted', 'In Transit', 'Arrived at Pickup', 'Trip Ongoing', 'Arrived at Destination', 'Driver Assigned', 'Driver En Route', 'Driver Arrived', 'Heading to Passenger']),
      supabase.from('incident_report').select('*', { count: 'exact', head: true }),
      supabase.from('incident_report').select('*', { count: 'exact', head: true }).is('outcome', null).neq('status', 'Cancelled'),
      supabase.from('booking').select('*', { count: 'exact', head: true }).ilike('booking_status', 'Cancel%'),
      // resolved = a decision (an outcome) is recorded; a report the reporter withdrew is neither open nor resolved
      supabase.from('incident_report').select('*', { count: 'exact', head: true }).not('outcome', 'is', null),
      supabase.from('incident_report').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('incident_report').select('*, driver:driver_id(toda_id), booking:booking_id(toda_id)'),
    ]);

    const totalP = passengersTotal.count || 0;
    const activeP = passengersActive.count || 0;
    const totalD = driversTotal.count || 0;
    const verifiedD = driversVerified.count || 0;
    const pendingD = driversPending.count || 0;
    const suspendedD = driversSuspended.count || 0;

    const allTodas = todasRes.data || [];
    const activeTodas = allTodas.filter((t: any) => (t.toda_status || t.account_status) === 'Active');
    const pendingTodas = allTodas.filter((t: any) => (t.toda_status || t.account_status) !== 'Active');
    const overdueTodas = pendingTodas.filter((t: any) => t.created_at && (Date.now() - new Date(t.created_at).getTime() > 5 * 24 * 60 * 60 * 1000));

    const totalB = bookingsTotal.count || 0;
    const completedB = bookingsCompleted.count || 0;
    const ongoingB = bookingsOngoing.count || 0;
    const totalI = incidentsTotal.count || 0;
    const openI = incidentsOpen.count || 0;
    const cancelledB = bookingsCancelled.count || 0;
    const resolvedI = incidentsResolved.count || 0;

    const recentIncidents = (recentIncidentsRes.data || []).map((inc: any) => ({
      id: inc.incident_id,
      category: inc.category || 'General Incident',
      status: inc.status || 'Under Investigation',
      timestamp: inc.created_at
        ? new Date(inc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Recent',
      severity: inc.priority === 'Serious' ? 'High' : inc.priority === 'Emergency' ? 'Medium' : 'Low',
      description: inc.description || '',
      iconType: (inc.category || '').toLowerCase().includes('charge')
        ? 'overcharging'
        : (inc.category || '').toLowerCase().includes('misconduct')
        ? 'misconduct'
        : 'safety',
    }));

    const recentApplications = allTodas.slice(0, 5).map((toda: any) => ({
      id: toda.toda_id,
      name: toda.toda_name,
      barangay: toda.barangay || 'Calapan City',
      submittedDate: toda.created_at
        ? new Date(toda.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Recent',
      status: (toda.toda_status || toda.account_status) === 'Active' ? 'Approved' : (toda.toda_status || toda.account_status) === 'Deactivated' ? 'Declined' : 'Pending',
      representative: toda.president_name || 'TODA Officer',
      memberCount: toda.registered_tricycle_count || toda.active_driver_count || 0,
    }));

    // Rule 2.5: a TODA with 3 or more UPHELD reports about its drivers within 60 days is flagged (the database raises the same flag in check_toda_excess_incidents)
    const todaIncidentsMap: Record<string, number> = {};
    const windowStart = Date.now() - TODA_INCIDENT_REPORT_WINDOW_DAYS * 86_400_000;
    (incidentReportsRes.data || []).forEach((inc: any) => {
      if (inc.outcome !== 'UPHELD' || inc.subject_type !== 'driver' || !inc.resolved_at || Date.parse(inc.resolved_at) < windowStart) return;
      const associatedTodaId = inc.reported_toda_id || inc.driver?.toda_id || inc.booking?.toda_id;
      if (associatedTodaId) {
        todaIncidentsMap[associatedTodaId] = (todaIncidentsMap[associatedTodaId] || 0) + 1;
      }
    });

    const flaggedTodas: Array<{ id: string; name: string; incidentCount: number }> = [];
    allTodas.forEach((t: any) => {
      const count = todaIncidentsMap[t.toda_id] || 0;
      if (count >= TODA_INCIDENT_REPORT_FLAG_THRESHOLD) {
        flaggedTodas.push({
          id: t.toda_id,
          name: t.toda_name,
          incidentCount: count,
        });
      }
    });

    return {
      kpis: {
        passengers: {
          total: totalP,
          active: activeP,
          inactive: Math.max(0, totalP - activeP),
        },
        drivers: {
          total: totalD,
          active: verifiedD,
          inactive: Math.max(0, totalD - verifiedD),
        },
        todas: {
          total: activeTodas.length,
          pendingReview: pendingTodas.length,
        },
        trips: {
          total: completedB,
          ongoing: ongoingB,
          allBookings: totalB,
          cancelled: cancelledB,
        },
        verifications: {
          pending: pendingD + pendingTodas.length,
          overdue5Days: overdueTodas.length,
        },
        incidents: {
          open: openI,
          total: totalI,
          resolved: resolvedI,
        },
      },
      driverBreakdown: {
        total: totalD,
        approved: verifiedD,
        pending: pendingD,
        rejected: 0,
        suspended: suspendedD,
      },
      recentIncidents,
      recentApplications,
      flaggedTodas,
    };
  } catch (err) {
    console.error('[adminApiService] fetchDashboardStats error:', err);
    return {
      kpis: {
        passengers: { total: 0, active: 0, inactive: 0 },
        drivers: { total: 0, active: 0, inactive: 0 },
        todas: { total: 0, pendingReview: 0 },
        trips: { total: 0, ongoing: 0, allBookings: 0, cancelled: 0 },
        verifications: { pending: 0, overdue5Days: 0 },
        incidents: { open: 0, total: 0, resolved: 0 },
      },
      driverBreakdown: { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 },
      recentIncidents: [],
      recentApplications: [],
      flaggedTodas: [],
    };
  }
}

// ============================================================================
// 2. TODA APPLICATIONS SERVICES (Live Supabase public.toda)
// ============================================================================

/**
 * A link to a stored document for the review screens. Every bucket is private: the link is a SIGNED URL that lives 10 minutes and that
 * Storage only issues if this administrator may read the file. The preview windows sign again when a document is opened, so a list that
 * has been open for a while still works. There is no public-URL fallback (there are no public files).
 */
async function resolveStorageDocUrl(bucket: string, rawVal?: string | null, fallbackBucket?: string): Promise<string | null> {
  if (!rawVal) return null;
  return signedStorageUrlFromAny(supabase, fallbackBucket ? [bucket, fallbackBucket] : [bucket], rawVal, SIGNED_URL_TTL.document);
}

function extractActualFilename(rawUrlOrPath?: string | null, fallback = 'Document'): string {
  if (!rawUrlOrPath) return fallback;
  try {
    const clean = rawUrlOrPath.split('?')[0].split('#')[0];
    const rawName = decodeURIComponent(clean.split('/').pop() || '');
    if (!rawName) return fallback;
    const stripped = rawName.replace(/^\d{10,15}_/, '');
    return stripped || rawName;
  } catch {
    return fallback;
  }
}

/** A TODA's registration documents as the LGU screens list them: the real files it uploaded, each with a short-lived signed link. */
async function todaDocumentsOf(row: any): Promise<Array<{ name: string; type: string; date: string; url: string | null; status: string }>> {
  // Signed links for the documents (a stored value is a storage path; an older full storage URL is converted to one)
  const bcUrl = await resolveStorageDocUrl('barangay-clearances', row.barangay_clearance_url);
  const adUrl = await resolveStorageDocUrl('toda-accredited-driver-lists', row.accredited_drivers_url);
  const blUrl = await resolveStorageDocUrl('toda-bylaws', row.bylaws_url);
  const submitted = row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Submitted';

  const docs: Array<{ name: string; type: string; date: string; url: string | null; status: string }> = [];
  if (row.barangay_clearance_url || bcUrl) {
    const fileLink = bcUrl || row.barangay_clearance_url;
    docs.push({
      name: extractActualFilename(row.barangay_clearance_url || bcUrl, 'Barangay_Clearance.pdf'),
      type: (fileLink || '').toLowerCase().includes('.pdf') ? 'PDF Document' : 'Image Verification',
      date: submitted,
      url: fileLink,
      status: 'Submitted',
    });
  }
  if (row.accredited_drivers_url || adUrl) {
    const fileLink = adUrl || row.accredited_drivers_url;
    docs.push({
      name: extractActualFilename(row.accredited_drivers_url || adUrl, 'Driver_Roster.xlsx'),
      type: (fileLink || '').toLowerCase().includes('.csv') ? 'CSV Spreadsheet' : 'Excel Spreadsheet',
      date: submitted,
      url: fileLink,
      status: 'Submitted',
    });
  }
  if (row.bylaws_url || blUrl) {
    const fileLink = blUrl || row.bylaws_url;
    docs.push({
      name: extractActualFilename(row.bylaws_url || blUrl, 'Internal_Bylaws.pdf'),
      type: (fileLink || '').toLowerCase().includes('.pdf') ? 'PDF Document' : 'Document Attachment',
      date: submitted,
      url: fileLink,
      status: 'Submitted',
    });
  }
  return docs;
}

// Note: In accordance with SAKAY Policy Batch 1, TODA status overrides in localStorage 
// have been permanently purged. All status verification is strictly database-backed.


/** How close a TODA's Barangay Clearance / accreditation validity date is (the reminders go out 30 days before it). */
function clearanceStatusOf(expiryIso: string | null | undefined): 'Valid' | 'Expiring Soon' | 'Expired' | 'Under Review' {
  if (!expiryIso) return 'Under Review';
  const days = Math.ceil((Date.parse(expiryIso) - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return 'Under Review';
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring Soon';
  return 'Valid';
}

export async function fetchTodaApplications(): Promise<TodaApplicationRecord[]> {
  try {
    const { data, error } = await supabase
      .from('toda')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    const applications = await Promise.all(data.map(async (row: any) => {
      const isOverdue = row.created_at
        ? Date.now() - new Date(row.created_at).getTime() > 5 * 24 * 60 * 60 * 1000
        : false;

      const docs = await todaDocumentsOf(row);

      const rawStatus = row.toda_status || row.account_status || row.status || 'Pending';
      const currentStatus = (rawStatus === 'Active' || rawStatus === 'Approved') ? 'Approved' : rawStatus;
      const normalizedStatus =
        currentStatus === 'Approved'
          ? 'Approved'
          : currentStatus === 'Deactivated' || currentStatus === 'Declined'
          ? 'Declined'
          : currentStatus === 'Resubmission Required'
          ? 'Resubmission Required'
          : 'Pending';

      return {
        id: row.toda_id,
        name: row.toda_name,
        acronym: row.toda_acronym || '',
        registrationNumber: row.registration_number || '',
        dateEstablished: row.date_established || '',
        representative: row.president_name || 'Designated Representative',
        phone: row.contact_number || row.president_contact || '',
        email: row.email || '',
        barangay: row.barangay || 'Calapan City',
        terminalLocation: row.terminal_location || row.service_coverage_area || 'Calapan City Terminal',
        terminalLatitude: row.terminal_latitude || 13.4115,
        terminalLongitude: row.terminal_longitude || 121.1803,
        serviceCoverageArea: row.service_coverage_area || '',
        memberCount: row.registered_tricycle_count || row.active_driver_count || 0,
        registeredTricycleCount: row.registered_tricycle_count || 0,
        activeDriverCount: row.active_driver_count || 0,
        barangayClearanceExpiry: row.certificate_expiry
          ? new Date(row.certificate_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '',
        clearanceStatus: clearanceStatusOf(row.certificate_expiry),
        hasBarangayClearance: Boolean(row.barangay_clearance_url && String(row.barangay_clearance_url).trim()),
        certificateNumber: row.certificate_number || null,
        declaredClearanceValidUntil: row.declared_clearance_valid_until ? String(row.declared_clearance_valid_until).slice(0, 10) : null,
        clearanceSubmittedAt: row.barangay_clearance_submitted_at || null,
        renewalSubmittedAt: row.renewal_submitted_at || null,
        submittedDate: row.created_at
          ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'Recent',
        status: normalizedStatus as 'Approved' | 'Declined' | 'Pending',
        isOverdue5Days: isOverdue && normalizedStatus !== 'Approved',
        officers: {
          president: row.president_name || 'N/A',
          presidentContact: row.president_contact || row.contact_number || 'N/A',
          vicePresident: row.vice_president_name || 'N/A',
          vicePresidentContact: row.vice_president_contact || 'N/A',
          secretary: row.secretary_name || 'N/A',
          secretaryContact: row.secretary_contact || 'N/A',
          treasurer: row.treasurer_name || 'N/A',
          treasurerContact: row.treasurer_contact || 'N/A',
        },
        documents: docs,
      };
    }));
    return applications;
  } catch (err) {
    console.error('[adminApiService] fetchTodaApplications error:', err);
    return [];
  }
}

export async function approveTodaApplication(
  applicationId: string,
  remarks?: string,
  certificateNumber?: string,
  certificateExpiry?: string
) {
  let todaInfo: any = null;
  try {
    const { data: fetchRes } = await supabase
      .from('toda')
      .select('*')
      .or(`toda_id.eq.${applicationId},toda_acronym.ilike.${applicationId}`)
      .maybeSingle();
    todaInfo = fetchRes;
  } catch {}

  const exactTodaId = todaInfo?.toda_id || applicationId;
  const acronym = todaInfo?.toda_acronym || (applicationId.length <= 15 ? applicationId : undefined);
  const name = todaInfo?.toda_name;

  // The LGU Administrator types the certificate number and the date the Barangay Clearance is valid until: nothing is invented here (Rule 2.1).
  if (!certificateNumber || !certificateNumber.trim() || !certificateExpiry) {
    throw new Error('Enter the certificate number and the date the Barangay Clearance is valid until.');
  }
  const defaultCertNo = certificateNumber.trim();
  const defaultCertExpiry = certificateExpiry;

  let updatedData: any = null;

  // 1. Primary: RPC function via Supabase (SECURITY DEFINER)
  try {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('approve_toda_accreditation', {
      p_toda_id: exactTodaId,
      p_certificate_number: defaultCertNo,
      p_certificate_expiry: defaultCertExpiry,
      p_remarks: remarks || null,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    if (rpcRes && rpcRes.success === false) throw new Error(String(rpcRes.error || 'The accreditation was not approved.'));
    if (rpcRes && rpcRes.success && rpcRes.data) {
      updatedData = rpcRes.data;
    }
  } catch (rpcErr) {
    console.warn('[adminApiService] approve RPC warning:', rpcErr);
    throw rpcErr;
  }

  // The database function is the only way to approve (Batch 12): it checks the caller and writes the audit entry in the same transaction. The old server
  // route and the direct table update wrote no actor and no before / after state, so they are gone.

  // 4. Verification Check: Verify actual database row status
  let isVerifiedInDb = false;
  try {
    const { data: checkRow } = await supabase
      .from('toda')
      .select('toda_id, toda_name, toda_acronym, toda_status, account_status')
      .or(`toda_id.eq.${applicationId},toda_acronym.ilike.${applicationId}`)
      .maybeSingle();

    if (
      checkRow &&
      (String(checkRow.toda_status).toLowerCase() === 'active' ||
        String(checkRow.account_status).toLowerCase() === 'active')
    ) {
      isVerifiedInDb = true;
      updatedData = updatedData || checkRow;
    }
  } catch {}

  if (!isVerifiedInDb && !updatedData) {
    throw new Error(
      `Database update failed for TODA '${acronym || name || applicationId}'. Supabase database status could not be saved to Active.`
    );
  }

  // Update associated toda_admin accounts to Active
  try {
    await supabase
      .from('toda_admin')
      .update({ account_status: 'Active', toda_status: 'Active' })
      .or(`toda_id.eq.${applicationId},toda_acronym.ilike.${applicationId}`);
  } catch {}

  // Status updated authoritatively in Supabase database; approve_toda_accreditation() wrote the audit entry (actor, before, after) itself.

  return { success: true, data: updatedData };
}

export async function returnTodaApplicationForCorrection(applicationId: string, reason: string) {
  // The database function is the only way (Batch 12): the LGU Administrator is checked inside, and the audit entry (actor, before, after, reason) is written in the
  // same transaction. The old server route and direct update wrote neither, and a failure used to be swallowed.
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('return_toda_accreditation', {
    p_toda_id: applicationId,
    p_reason: reason || null,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!rpcRes || rpcRes.success !== true) throw new Error(String(rpcRes?.error || 'The application was not returned.'));
  return { success: true, reason, data: rpcRes.data };
}

export async function rejectTodaApplication(applicationId: string, reason: string) {
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('deactivate_toda_accreditation', {
    p_toda_id: applicationId,
    p_reason: reason || null,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!rpcRes || rpcRes.success !== true) throw new Error(String(rpcRes?.error || 'The application was not declined.'));
  return { success: true, reason, data: rpcRes.data };
}

export const declineTodaApplication = rejectTodaApplication;

/** Suspends an accredited TODA's participation after the LGU reviewed it (Rule 2.4): its administrator and drivers can no longer operate until it is approved again. */
export async function suspendTodaAccreditation(todaId: string, reason: string) {
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('deactivate_toda_accreditation', {
    p_toda_id: todaId,
    p_reason: reason || null,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!rpcRes || rpcRes.success !== true) throw new Error(String(rpcRes?.error || 'The accreditation was not suspended.'));
  return { success: true, reason, data: rpcRes.data };
}


// ============================================================================
// 3. ACCREDITED TODA REGISTRY
// ============================================================================

export async function fetchAccreditedTodas(): Promise<AccreditedTodaRecord[]> {
  try {
    const { data, error } = await supabase
      .from('toda')
      .select('*')
      .order('toda_name', { ascending: true });

    if (error || !data) return [];

    const activeTodas = data.filter((row: any) => {
      const st = row.toda_status || row.account_status || row.status;
      return st === 'Active' || st === 'Approved';
    });

    return Promise.all(activeTodas.map(async (row: any) => ({
      id: row.toda_id,
      name: row.toda_name,
      acronym: row.toda_acronym || '',
      representative: row.president_name || 'Designated Representative',
      phone: row.contact_number || row.president_contact || '',
      email: row.email || '',
      barangay: row.barangay || 'Calapan City',
      serviceZone: row.service_coverage_area || row.barangay || 'Calapan City',
      registeredDrivers: row.registered_tricycle_count || row.active_driver_count || 0,
      status: 'Active',
      accreditationNo: row.registration_number || row.certificate_number || 'N/A',
      accreditedDate: row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : '',
      expiryDate: row.certificate_expiry ? new Date(row.certificate_expiry).toLocaleDateString('en-US') : '',
      barangayClearanceExpiry: row.certificate_expiry ? new Date(row.certificate_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014',
      clearanceStatus: clearanceStatusOf(row.certificate_expiry),
      hasBarangayClearance: Boolean(row.barangay_clearance_url && String(row.barangay_clearance_url).trim()),
      certificateNumber: row.certificate_number || null,
      declaredClearanceValidUntil: row.declared_clearance_valid_until ? String(row.declared_clearance_valid_until).slice(0, 10) : null,
      clearanceSubmittedAt: row.barangay_clearance_submitted_at || null,
      renewalSubmittedAt: row.renewal_submitted_at || null,
      confirmedIncidents: 0,
      flaggedForReview: false,
      centerLat: row.terminal_latitude || 13.4115,
      centerLng: row.terminal_longitude || 121.1803,
      terminalRelocationStatus: row.terminal_relocation_status || 'Approved',
      pendingTerminalLat: row.pending_terminal_latitude,
      pendingTerminalLng: row.pending_terminal_longitude,
      pendingTerminalLocation: row.pending_terminal_location,
      pendingTerminalReason: row.pending_terminal_reason,
      terminalRelocationRequestedAt: row.terminal_relocation_requested_at,
      documents: await todaDocumentsOf(row),
      driverRoster: [],
    })));
  } catch (err) {
    console.error('[adminApiService] fetchAccreditedTodas error:', err);
    return [];
  }
}

// ============================================================================
// 4. FARE MATRIX SERVICES
// ============================================================================

export type FareRuleStatus = 'In force' | 'Scheduled' | 'Superseded';

/**
 * The LGU's fare rule history. The database decides which rule is "In force" or "Scheduled" from the effective
 * timestamps (public.fare_matrix_history); nothing here compares dates. Throws when the history cannot be read, so
 * the page never shows an invented rate.
 */
export async function fetchFareMatrices(): Promise<FareMatrixRecord[]> {
  const { data, error } = await supabase.rpc('fare_matrix_history');
  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map((row) => ({
    id: row.fare_matrix_id,
    fare_matrix_id: row.fare_matrix_id,
    base_fare: Number(row.base_fare),
    base_distance_km: Number(row.base_distance_km),
    succeeding_rate: Number(row.succeeding_rate),
    effective_timestamp: row.effective_timestamp,
    effective_date: formatManilaDateTime(row.effective_timestamp),
    is_active: row.status === 'In force',
    status: row.status as FareRuleStatus,
    solo_base_fare: Number(row.solo_base_fare),
    ordinance_reference: row.ordinance_reference || 'No ordinance reference recorded',
    configured_by_lgu_admin: row.configured_by_name || 'Seeded ordinance record',
    notes: row.notes || undefined,
    created_at: row.created_at,
  }));
}

/**
 * Enacts a new fare rule (Rule 6.3). The database checks the caller is the LGU Administrator, refuses a
 * back-dated effective time, serialises concurrent changes and writes the audit_log row (actor, before, after,
 * reason) in the same transaction; this function writes nothing else. A change affects only bookings confirmed
 * after its effective time.
 */
export async function enactFareMatrix(input: {
  baseFare: number;
  baseDistanceKm: number;
  succeedingRate: number;
  ordinanceReference: string;
  reason: string;
  /** ISO timestamp; omit to take effect immediately */
  effectiveAt?: string | null;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('enact_fare_matrix', {
    p_base_fare: input.baseFare,
    p_base_distance_km: input.baseDistanceKm,
    p_succeeding_rate: input.succeedingRate,
    p_ordinance_reference: input.ordinanceReference,
    p_reason: input.reason,
    p_effective_timestamp: input.effectiveAt ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

/** The two dispatch values an LGU administrator may change at run time (Intelligent Driver Dispatch). The database holds, checks and audits them. */
export interface DispatchSettings {
  offerWindowSeconds: number;
  tier3MaxSeconds: number;
  defaults: { offerWindowSeconds: number; tier3MaxSeconds: number };
  limits: { offerWindowSeconds: [number, number]; tier3MaxSeconds: [number, number] };
}

export async function fetchDispatchSettings(): Promise<DispatchSettings> {
  const { data, error } = await supabase.rpc('get_dispatch_settings');
  const r = data as {
    offer_window_seconds: number;
    tier3_max_seconds: number;
    defaults: { offer_window_seconds: number; tier3_max_seconds: number };
    limits: { offer_window_seconds: [number, number]; tier3_max_seconds: [number, number] };
  } | null;
  if (error || !r) throw new Error(error?.message || 'The dispatch settings could not be loaded.');
  return {
    offerWindowSeconds: r.offer_window_seconds,
    tier3MaxSeconds: r.tier3_max_seconds,
    defaults: { offerWindowSeconds: r.defaults.offer_window_seconds, tier3MaxSeconds: r.defaults.tier3_max_seconds },
    limits: { offerWindowSeconds: r.limits.offer_window_seconds, tier3MaxSeconds: r.limits.tier3_max_seconds },
  };
}

/** Changes one setting. The database checks the range and the caller, and writes the audit row (before and after) itself. */
export async function saveDispatchSetting(key: 'offer_window_seconds' | 'tier3_max_seconds', value: number): Promise<void> {
  const { data, error } = await supabase.rpc('set_dispatch_setting', { p_key: key, p_value: value });
  const r = data as { success?: boolean; error?: string } | null;
  if (error) throw new Error(error.message);
  if (!r?.success) throw new Error(r?.error || 'The setting was not saved.');
}

export interface FareExample {
  excessKm: number;
  seatFare: number;
  soloFare: number;
  soloBase: number;
  sharedEstimate: number;
}

/** A worked example for a rule, computed by the database's own fare function (no formula is repeated here). */
export async function fetchFareExample(
  distanceKm: number,
  rule: { base_fare: number; base_distance_km: number; succeeding_rate: number }
): Promise<FareExample | null> {
  const { data, error } = await supabase.rpc('calculate_fare', {
    p_distance_km: distanceKm,
    p_trip_type: 'Shared',
    p_passenger_count: 1,
    p_base_fare: rule.base_fare,
    p_base_distance_km: rule.base_distance_km,
    p_succeeding_rate: rule.succeeding_rate,
  });
  const r = data as { excess_km: number; seat_fare: number; solo_fare: number; shared_matched_estimate: number; solo_components: { base: number } } | null;
  if (error || !r) return null;
  return {
    excessKm: Number(r.excess_km),
    seatFare: Number(r.seat_fare),
    soloFare: Number(r.solo_fare),
    soloBase: Number(r.solo_components.base),
    sharedEstimate: Number(r.shared_matched_estimate),
  };
}

// ============================================================================
// 5. DRIVERS & PASSENGERS SERVICES
// ============================================================================

export async function fetchDrivers(filters?: { status?: string; toda?: string }): Promise<DriverRecord[]> {
  try {
    // Per-TODA applications. A driver may apply to several TODAs; each affiliation (driver x TODA) has its OWN TODA stage and LGU stage,
    // and the LGU decides each one separately, after its TODA has endorsed it.
    const affByDriver = new Map<string, DriverAffiliationRecord[]>();
    // What the review of each driver's applications says (returned / resubmitted / endorsed...), from the DATABASE: per application, the
    // documents it returned and whether they were replaced. The shared verification record's remarks are never read for this.
    const statusByDriver = new Map<string, ApplicationStatus>();
    try {
      const { data: affRows } = await supabase
        .from('driver_toda_affiliation')
        .select('*, toda:toda_id ( toda_id, toda_name, toda_acronym )')
        .order('submitted_at', { ascending: true });

      const docsByAffiliation = new Map<string, ApplicationReviewDocument[]>();
      const openRosterFlags = new Set<string>();
      const affIds = ((affRows || []) as any[]).map((a) => a.affiliation_id);
      if (affIds.length > 0) {
        try {
          const { data: docRows } = await supabase.rpc('get_affiliation_document_reviews', { p_affiliation_ids: affIds });
          for (const r of (docRows || []) as any[]) {
            const list = docsByAffiliation.get(r.affiliation_id) || [];
            list.push({
              document_type: r.document_type,
              state: r.state,
              reason_code: r.reason_code,
              reason: r.reason,
              returned_at: r.returned_at,
              returned_by_stage: r.returned_by_stage,
              resubmitted_at: r.resubmitted_at,
            });
            docsByAffiliation.set(r.affiliation_id, list);
          }
        } catch (docErr) {
          console.warn('[adminApiService] fetchDrivers document reviews note:', docErr);
        }
        try {
          const { data: flagRows } = await supabase
            .from('admin_review_flag')
            .select('subject_id')
            .eq('flag_type', 'ROSTER_MISMATCH')
            .eq('subject_type', 'driver_application')
            .in('status', ['Open', 'Under Review']);
          for (const f of (flagRows || []) as any[]) openRosterFlags.add(String(f.subject_id));
        } catch (flagErr) {
          console.warn('[adminApiService] fetchDrivers roster flag note:', flagErr);
        }
      }
      const reviewByDriver = new Map<string, ApplicationReviewAffiliation[]>();
      for (const a of (affRows || []) as any[]) {
        const t0 = Array.isArray(a.toda) ? a.toda[0] : a.toda;
        const list = reviewByDriver.get(a.driver_id) || [];
        list.push({
          affiliation_id: a.affiliation_id,
          toda_id: a.toda_id,
          toda_name: t0?.toda_name,
          toda_acronym: t0?.toda_acronym,
          toda_stage: a.toda_endorsement_status,
          lgu_stage: a.lgu_verification_status,
          is_active: Boolean(a.is_active_selection),
          submitted_at: a.submitted_at,
          resubmitted_at: a.resubmitted_at,
          toda_return_reason: a.toda_rejection_reason,
          lgu_return_reason: a.lgu_rejection_reason,
          documents: docsByAffiliation.get(a.affiliation_id) || [],
        });
        reviewByDriver.set(a.driver_id, list);
      }
      for (const [driverId, list] of reviewByDriver) statusByDriver.set(driverId, classifyApplication(list));

      for (const a of (affRows || []) as any[]) {
        const t = Array.isArray(a.toda) ? a.toda[0] : a.toda;
        const list = affByDriver.get(a.driver_id) || [];
        list.push({
          affiliationId: a.affiliation_id,
          todaId: a.toda_id,
          todaName: t?.toda_name || 'TODA',
          todaAcronym: t?.toda_acronym || t?.toda_name || 'TODA',
          membershipNo: a.toda_membership_number || undefined,
          assignedTerminal: a.assigned_terminal || undefined,
          barangayServiceArea: a.barangay_service_area || undefined,
          todaStage: a.toda_endorsement_status,
          lguStage: a.lgu_verification_status,
          isActive: Boolean(a.is_active_selection),
          rosterMismatchOpen: openRosterFlags.has(String(a.affiliation_id)),
        });
        affByDriver.set(a.driver_id, list);
      }
    } catch (affErr) {
      console.warn('[adminApiService] fetchDrivers affiliation query note:', affErr);
    }

    // "Resubmitted (awaiting review)" and "Resubmission Required" are facts about the driver's APPLICATIONS (what was returned, whether the
    // documents were replaced since): they come from the review above. A remark left on the shared verification record, or a date
    // comparison on it, outlives the correction it described and then mislabels later applications, so neither is read any more. A driver
    // with no TODA application on record (registered before applications existed) can only be "Resubmission Required" by the shared status.
    const resubOf = (d: any): { isResub: boolean; isResubReq: boolean } => {
      const st = statusByDriver.get(d.driver_id);
      if (st) {
        return {
          isResub: st.kind === 'resubmitted_awaiting_toda' || st.kind === 'resubmitted_awaiting_lgu',
          isResubReq: st.kind === 'resubmission_required',
        };
      }
      const v = Array.isArray(d.driver_verification) ? d.driver_verification[0] : d.driver_verification;
      return { isResub: false, isResubReq: d.account_status === 'Resubmission Required' || v?.verification_status === 'Resubmission Required' };
    };

    // Drivers whose TODA has endorsed an affiliation and the LGU has not decided it yet.
    const awaitingLguDriverIds = new Set<string>();
    for (const [driverId, list] of affByDriver) {
      if (list.some((a) => a.todaStage === 'Endorsed' && a.lguStage === 'Pending')) awaitingLguDriverIds.add(driverId);
    }

    // Collect TODA-endorsed driver IDs. A driver with affiliations is endorsed when one of THEM is awaiting the LGU. Only a driver with NO
    // affiliation record (registered before the affiliation table existed) falls back to the shared driver_verification record
    // (verification_status = 'Approved' = TODA Stage 1 endorsement). LGU Stage 2 final approval is driver.account_status = 'Verified'.
    let todaEndorsedDriverIds: string[] = Array.from(awaitingLguDriverIds);
    try {
      const { data: verifEndorsed } = await supabase
        .from('driver_verification')
        .select('driver_id, verification_status')
        .in('verification_status', ['Approved', 'TODA Approved', 'TODA Endorsed', 'Endorsed to LGU', 'Resubmission Required']);

      if (verifEndorsed && verifEndorsed.length > 0) {
        const legacy = verifEndorsed
          .map((v: any) => v.driver_id)
          .filter((id: string | null) => Boolean(id) && !affByDriver.has(id as string));
        todaEndorsedDriverIds = Array.from(new Set([...todaEndorsedDriverIds, ...legacy]));
      }
    } catch (syncErr) {
      console.warn('[adminApiService] fetchDrivers verification query note:', syncErr);
    }

    // STRICT LGU FILTERING: Only show drivers that have TODA endorsement or are in final stages
    const allowedStatuses = ['TODA Approved', 'TODA Endorsed', 'Endorsed to LGU', 'LGU Approved', 'Active', 'Verified', 'Rejected', 'Suspended', 'Resubmission Required', 'Pending Verification', 'Pending'];

    // Fetch drivers in two queries: by account_status AND by TODA-endorsed IDs, merge results
    const [mainRes, endorsedRes] = await Promise.all([
      supabase
        .from('driver')
        .select('*, toda:toda_id ( toda_id, toda_name, toda_acronym, barangay ), driver_verification (*)')
        .in('account_status', allowedStatuses),
      todaEndorsedDriverIds.length > 0
        ? supabase
            .from('driver')
            .select('*, toda:toda_id ( toda_id, toda_name, toda_acronym, barangay ), driver_verification (*)')
            .in('driver_id', todaEndorsedDriverIds)
        : Promise.resolve({ data: [] }),
    ]);

    const mainData = mainRes.data || [];
    const endorsedData = (endorsedRes as any).data || [];

    // Merge, deduplicating by driver_id
    const mergedMap = new Map<string, any>();
    for (const d of mainData) mergedMap.set(d.driver_id, d);
    for (const d of endorsedData) {
      if (!mergedMap.has(d.driver_id)) mergedMap.set(d.driver_id, d);
    }
    let data = Array.from(mergedMap.values());

    // Apply status filter
    if (filters?.status && filters.status !== 'All') {
      const endorsedSet = new Set(todaEndorsedDriverIds);
      if (filters.status === 'Resubmitted' || filters.status === 'Resubmitted (Awaiting Review)') {
        data = data.filter((d: any) => resubOf(d).isResub);
      } else if (filters.status === 'Endorsed to LGU' || filters.status === 'Pending' || filters.status === 'Pending Verification') {
        data = data.filter((d: any) => {
          const { isResubReq } = resubOf(d);
          return (
            ((endorsedSet.has(d.driver_id) || ['TODA Approved', 'TODA Endorsed', 'Endorsed to LGU'].includes(d.account_status)) &&
              !['Verified', 'Active', 'LGU Approved'].includes(d.account_status) &&
              !isResubReq) ||
            awaitingLguDriverIds.has(d.driver_id)
          );
        });
      } else if (filters.status === 'Verified' || filters.status === 'Active') {
        data = data.filter((d: any) => ['Verified', 'Active', 'LGU Approved'].includes(d.account_status));
      } else if (filters.status === 'Resubmission Required') {
        data = data.filter((d: any) => resubOf(d).isResubReq);
      } else {
        data = data.filter((d: any) => d.account_status === filters.status);
      }
    }

    // Map TODAs for fallback lookup
    const { data: todas } = await supabase.from('toda').select('toda_id, toda_name, toda_acronym, barangay');
    const todaMap = new Map((todas || []).map((t: any) => [t.toda_id, t]));
    const todaEndorsedSet = new Set(todaEndorsedDriverIds);

    return await Promise.all(data.map(async (d: any) => {
      const todaInfo = d.toda || todaMap.get(d.toda_id);
      const verif = Array.isArray(d.driver_verification) ? d.driver_verification[0] : d.driver_verification;

      const { isResub: isResubmitted, isResubReq: isStatusResubmissionRequired } = resubOf(d);
      const reviewStatus = statusByDriver.get(d.driver_id);

      // Stage 2 LGU final approval: ONLY driver.account_status === 'Verified'
      const isFullyApproved = d.account_status === 'Verified';
      const isRejected = d.account_status === 'Rejected' || verif?.verification_status === 'Rejected';
      const isSuspended = d.account_status === 'Suspended' || d.account_status === 'Deactivated';
      // (the two are mutually exclusive: a resubmitted application is awaiting review, no longer "Resubmission Required")
      const isResubmission = isStatusResubmissionRequired;
      // Stage 1 TODA endorsement: driver is in driver_verification with 'Approved' but NOT yet LGU-approved
      const affs = affByDriver.get(d.driver_id) || [];
      const awaitingLgu = affs.filter((a) => a.todaStage === 'Endorsed' && a.lguStage === 'Pending');
      // With affiliations, "endorsed" means one of THEM awaits the LGU; the shared verification record is only used for older drivers.
      const legacyEndorsed = todaEndorsedSet.has(d.driver_id) || ['TODA Approved', 'TODA Endorsed', 'Endorsed to LGU'].includes(d.account_status) || verif?.verification_status === 'Approved' || Boolean(verif?.endorsed_at);
      const isTodaEndorsed = (affs.length > 0 ? awaitingLgu.length > 0 : legacyEndorsed) && !isFullyApproved && !isResubmission && !isRejected;

      // Parse faulty and verified lists if driver has rejection_comment with JSON
      let faultyList: string[] = [];
      let verifiedList: string[] = [];
      const rawComment = verif?.rejection_comment || d.rejection_comment;
      if (rawComment && rawComment.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawComment);
          if (Array.isArray(parsed.faultyDocuments)) {
            faultyList = parsed.faultyDocuments;
          } else if (Array.isArray(parsed.issues)) {
            faultyList = parsed.issues.map((i: any) => i.documentType);
          }
          if (Array.isArray(parsed.verifiedDocuments)) {
            verifiedList = parsed.verifiedDocuments;
          }
        } catch {}
      }

      const getDocStatus = (docType: string): 'Verified' | 'Pending Inspection' | 'Resubmission Required' | 'Resubmitted (Awaiting Review)' => {
        if (isFullyApproved) return 'Verified';
        if (verifiedList.includes(docType)) return 'Verified';
        if (reviewStatus) {
          // from the database: was THIS document returned, and has the driver replaced it since?
          const state = reviewStatus.documentStates[docType as ReviewDocumentType];
          if (state === 'returned' || state === 'returned_elsewhere') return 'Resubmission Required';
          if (state === 'resubmitted' || state === 'replaced_elsewhere') return 'Resubmitted (Awaiting Review)';
          return 'Pending Inspection';
        }
        // a driver with no TODA application on record: only the list written on the shared record says which documents were faulty
        if (faultyList.includes(docType)) return 'Resubmission Required';
        return 'Pending Inspection';
      };

      const docStatuses = [
        getDocStatus('license'),
        getDocStatus('mtop'),
        getDocStatus('tricycle'),
        getDocStatus('selfie')
      ];

      let verificationStatus: DriverRecord['verificationStatus'];
      let lguVerificationStatus: DriverRecord['lguVerificationStatus'];
      let accountStatus: DriverRecord['accountStatus'];

      if (isFullyApproved) {
        verificationStatus = 'Verified';
        lguVerificationStatus = 'Verified';
        accountStatus = 'Active';
      } else if (isSuspended) {
        verificationStatus = 'Suspended';
        lguVerificationStatus = 'Suspended';
        accountStatus = 'Inactive';
      } else if (isRejected) {
        verificationStatus = 'Rejected';
        lguVerificationStatus = 'Rejected';
        accountStatus = 'Inactive';
      } else {
        if (docStatuses.includes('Resubmission Required')) {
          verificationStatus = 'Resubmission Required';
          lguVerificationStatus = 'Resubmission Required';
          accountStatus = 'Inactive';
        } else if (docStatuses.includes('Resubmitted (Awaiting Review)')) {
          verificationStatus = 'Resubmitted (Awaiting Review)';
          lguVerificationStatus = 'Resubmitted (Awaiting Review)';
          accountStatus = 'Inactive';
        } else if (docStatuses.includes('Pending Inspection')) {
          verificationStatus = isTodaEndorsed ? 'Endorsed to LGU' : 'Pending';
          lguVerificationStatus = isTodaEndorsed ? 'Endorsed to LGU' : 'Pending';
          accountStatus = 'Inactive';
        } else {
          verificationStatus = isTodaEndorsed ? 'Endorsed to LGU' : 'Pending';
          lguVerificationStatus = isTodaEndorsed ? 'Endorsed to LGU' : 'Pending';
          accountStatus = 'Inactive';
        }
      }

      const authId = d.auth_user_id;
      const licFrontPath = verif?.license_front_photo_path || (authId ? `${authId}/license_front.jpg` : null);
      const licBackPath = verif?.license_back_photo_path || (authId ? `${authId}/license_back.jpg` : null);
      const mtopPath = verif?.mtop_photo_path || (authId ? `${authId}/mtop.jpg` : null);
      const tricyclePath = verif?.tricycle_photo_path || d.tricycle_photo_path || (authId ? `${authId}/tricycle.jpg` : null);
      const selfiePath = verif?.face_photo_path || (authId ? `${authId}/selfie.jpg` : null);

      const [licFrontUrl, licBackUrl, mtopUrl, tricycleUrl, selfieUrl] = await Promise.all([
        resolveStorageDocUrl('driver-licenses', licFrontPath),
        resolveStorageDocUrl('driver-licenses', licBackPath),
        resolveStorageDocUrl('mtop-permits', mtopPath, 'driver-licenses'),
        resolveStorageDocUrl('mtop-permits', tricyclePath, 'driver-licenses'),
        resolveStorageDocUrl('driver-selfies', selfiePath, 'driver-licenses'),
      ]);

        const documents = [
          {
            id: 'doc-license',
            docType: 'license' as const,
            name: "Driver's License (Front & Back)",
            type: 'Identification Proof',
            status: getDocStatus('license'),
            url: licFrontUrl || licBackUrl,
            urls: [licFrontUrl, licBackUrl].filter(Boolean) as string[],
          },
          {
            id: 'doc-mtop',
            docType: 'mtop' as const,
            name: 'MTOP Franchise Permit',
            type: 'Official LGU Permit',
            status: getDocStatus('mtop'),
            url: mtopUrl,
            urls: [mtopUrl].filter(Boolean) as string[],
          },
          {
            id: 'doc-tricycle',
            docType: 'tricycle' as const,
            name: 'Tricycle Unit Inspection Photo',
            type: 'Vehicle Compliance Photo',
            status: getDocStatus('tricycle'),
            url: tricycleUrl,
            urls: [tricycleUrl].filter(Boolean) as string[],
          },
          {
            id: 'doc-selfie',
            docType: 'selfie' as const,
            name: 'Driver Profile Photo (Selfie)',
            type: 'Profile Photo',
            status: getDocStatus('selfie'),
            url: selfieUrl,
            urls: [selfieUrl].filter(Boolean) as string[],
          },
        ];

        return {
          id: d.driver_id,
          name: d.full_name || 'Driver Applicant',
          licenseNo: d.license_number || verif?.submitted_license_number || 'N/A',
          licenseExpiry: d.license_expiry || verif?.license_expiry || '',
          licenseStatus: 'Valid',
          mtopNo: d.franchise_number || verif?.submitted_franchise_number || 'N/A',
          mtopExpiry: d.mtop_expiry || verif?.mtop_expiry || verif?.franchise_expiry || '',
          mtopStatus: 'Valid',
          mtopOperatorName: verif?.submitted_operator_name || '',
          todaName: affs.length > 1 ? affs.map((a) => a.todaAcronym).join(', ') : (affs[0]?.todaName || todaInfo?.toda_name || 'Calapan Central TODA'),
          todaId: d.toda_id || '',
          affiliations: affs,
          actionAffiliationId: awaitingLgu[0]?.affiliationId,
          vehiclePlate: d.plate_number || verif?.submitted_plate_number || 'N/A',
          franchiseNo: d.franchise_number || verif?.submitted_franchise_number || 'N/A',
          franchiseExpiry: verif?.mtop_expiry || verif?.franchise_expiry || '',
          todaVerificationStatus: 'Verified',
          lguVerificationStatus,
          verificationStatus,
          accountStatus,
          onlineStatus: d.availability_status === 'Available' || d.availability_status === 'Busy' ? 'Online' : 'Offline',
          // Rule 23.1: 0 = Not Yet Rated (the database holds NULL until the first rating); no default score
          rating: Number(d.weighted_average_rating) || 0,
          ratingCount: Number(d.rating_count) || 0,
          phone: d.contact_number || '',
          barangay: d.barangay_service_area || todaInfo?.barangay || 'Calapan City',
          rejectionReason: verif?.rejection_reason || d.rejection_reason || undefined,
          rejectionComment: verif?.rejection_comment || d.rejection_comment || undefined,
          strikesCount: d.strikes_count ?? 0,
          strikeHistory: [],
          restrictionKind: deriveRestrictionKind(d),
          suspendedUntil: d.suspended_until || undefined,
          suspensionReason: d.suspension_reason || undefined,
          isPermanentlyDisqualified: Boolean(d.is_permanently_disqualified),
          disqualificationReason: d.disqualification_reason || undefined,
          isResubmitted,
          resubmittedAt: reviewStatus?.resubmittedAt || undefined,
          documents,
        };
      }));
  } catch (err) {
    console.error('[adminApiService] fetchDrivers exception:', err);
    return [];
  }
}

/**
 * The affiliation an LGU decision is about. The portal passes the affiliation it is showing. Without one, the driver's single
 * affiliation that is waiting for the LGU (TODA endorsed, LGU not decided) is used; with none or several waiting, the caller must say
 * which TODA, because approving "a driver" is not a decision the system can make for a driver who applied to more than one TODA.
 */
async function resolveLguAffiliationId(driverId: string, affiliationId?: string): Promise<string> {
  if (affiliationId) {
    const { data: row } = await supabase
      .from('driver_toda_affiliation')
      .select('affiliation_id, driver_id')
      .eq('affiliation_id', affiliationId)
      .maybeSingle();
    if (!row || row.driver_id !== driverId) throw new Error('That TODA application does not belong to this driver.');
    return row.affiliation_id;
  }

  const { data: waiting } = await supabase
    .from('driver_toda_affiliation')
    .select('affiliation_id')
    .eq('driver_id', driverId)
    .eq('toda_endorsement_status', 'Endorsed')
    .eq('lgu_verification_status', 'Pending')
    .order('submitted_at', { ascending: true });
  if (!waiting || waiting.length === 0) {
    throw new Error('This driver has no TODA application waiting for the LGU (it must be endorsed by its TODA first).');
  }
  if (waiting.length > 1) {
    throw new Error('This driver has more than one TODA application waiting for the LGU. Choose which one to decide.');
  }
  return waiting[0].affiliation_id;
}

/** The database accepts two rejection categories (Rule 3.8); document problems are "returned for correction", not rejected. */
function lguRejectionCategoryOf(reason: string): 'ineligible' | 'fraudulent' {
  return /fraud|pekeng|peke|falsif/i.test(reason) ? 'fraudulent' : 'ineligible';
}

/**
 * Tells a driver applicant the outcome of their application by SMS. The browser says only WHICH message and for WHICH driver; the server
 * takes the number from the driver's own record, writes the text from a template and refuses a message the record does not support
 * (server/src/routes/driverNotifyRoutes.ts). A failure is logged and never undoes the decision that was just saved.
 */
async function notifyDriverOutcome(
  driverId: string,
  kind: 'approved' | 'rejected' | 'returned',
  details: { reason?: string; notes?: string; documents?: string[]; affiliationId?: string } = {}
): Promise<void> {
  try {
    const { ok, data } = await apiPostJson(supabase, `${API_BASE_URL}/admin/notify/driver`, { driverId, kind, ...details });
    if (!ok) console.warn('[adminApiService] Driver SMS not sent:', data?.error || 'request refused');
  } catch (smsErr) {
    console.warn('[adminApiService] Driver SMS dispatch warning:', smsErr);
  }
}

/**
 * LGU Stage 2 for ONE TODA application (affiliation): the TODA has endorsed it, the LGU now verifies it. Other applications of the same
 * driver are not touched. The first approval also makes the driver's account Verified and that TODA the active one; a later approval
 * only adds a verified TODA (the driver picks the active one while Offline).
 */
export async function verifyDriver(driverId: string, franchiseNumber?: string, affiliationId?: string, rosterOverrideReason?: string) {
  console.log('[adminApiService] Verifying driver accreditation for:', driverId, affiliationId ? `(affiliation ${affiliationId})` : '');
  try {
    const targetId = await resolveLguAffiliationId(driverId, affiliationId);

    const { data, error } = await supabase.rpc('verify_driver_affiliation', {
      p_affiliation_id: targetId,
      p_franchise_number: franchiseNumber || null,
      p_license_expiry: null,
      p_mtop_expiry: null,
      // Required (at least 10 characters) while a Roster Mismatch flag is open; written to the flag and to the audit log (Rule 2.4)
      p_roster_override_reason: rosterOverrideReason?.trim() || null,
    });
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) {
      throw new Error(String(data?.error || 'The verification was not accepted by the database.').replace(/^ERR_ROSTER_OVERRIDE_REQUIRED:\s*/, ''));
    }

    // Tell the driver (the number is the one on the driver's record; the server writes the Tagalog message about THIS TODA)
    await notifyDriverOutcome(driverId, 'approved', { affiliationId: targetId });

    return { success: true, data: data.data };
  } catch (err: any) {
    console.error('[adminApiService] verifyDriver exception:', err);
    throw err;
  }
}

/** Rejects ONE TODA application. The driver is rejected as a whole only when no other application of theirs is left alive. */
export async function rejectDriver(driverId: string, reason: string, notes?: string, affiliationId?: string) {
  console.log('[adminApiService] Rejecting driver application:', driverId, affiliationId ? `(affiliation ${affiliationId})` : '');
  try {
    const targetId = await resolveLguAffiliationId(driverId, affiliationId);
    const finalComment = notes ? `${reason}: ${notes}` : reason;

    const { data, error } = await supabase.rpc('reject_driver_affiliation', {
      p_affiliation_id: targetId,
      p_reason_category: lguRejectionCategoryOf(reason),
      p_notes: finalComment,
    });
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) throw new Error(data?.error || 'The rejection was not accepted by the database.');

    // Tell the driver
    await notifyDriverOutcome(driverId, 'rejected', { reason, affiliationId: targetId });

    return { success: true };
  } catch (err: any) {
    console.error('[adminApiService] rejectDriver exception:', err);
    throw err;
  }
}

export interface ReturnIssuePayload {
  documentType: 'license' | 'mtop' | 'tricycle' | 'selfie';
  grounds: string;
  notes: string;
}

/** The preset reason of the database for a free-text ground the LGU screen offers (e.g. "Illegible / Blurry Scans (Malabo o hindi mabasa)"). */
function lguReasonCodeOf(grounds: string): 'blurry' | 'expired' | 'mismatch' | 'wrong_document' | 'incomplete' | 'other' {
  if (/illegible|blurry|malabo|hindi mabasa|not clear|unclear/i.test(grounds)) return 'blurry';
  if (/expired|paso na/i.test(grounds)) return 'expired';
  if (/mismatch|does not match|discrepan/i.test(grounds)) return 'mismatch';
  if (/wrong|maling/i.test(grounds)) return 'wrong_document';
  if (/incomplete|cut-?off|missing|kulang|obstruct/i.test(grounds)) return 'incomplete';
  return 'other';
}

/**
 * LGU stage: returns ONE TODA application (affiliation) to the driver for correction, naming each document and why (Rules 3.6, 3.8).
 * Same database function as the TODA's return, so the Driver app asks for exactly these documents; the application goes back to the
 * LGU (not to the TODA) when the driver resubmits, and the driver's other TODA applications are not touched.
 */
export async function returnDriverForCorrection(
  driverId: string,
  reason: string,
  notes?: string,
  issues?: ReturnIssuePayload[],
  verifiedDocuments?: ('license' | 'mtop' | 'tricycle' | 'selfie')[],
  affiliationId?: string
) {
  console.log('[adminApiService] Returning driver application for correction:', driverId, { reason, notes, issues, verifiedDocuments, affiliationId });
  try {
    const targetId = await resolveLguAffiliationId(driverId, affiliationId);

    const returned = issues && issues.length > 0 ? issues : [{ documentType: 'license' as const, grounds: reason, notes: notes || reason }];
    const { data, error } = await supabase.rpc('return_driver_documents', {
      p_affiliation_id: targetId,
      p_documents: returned.map((i) => ({
        document_type: i.documentType,
        reason_code: lguReasonCodeOf(i.grounds),
        reason: (i.notes || i.grounds || reason).trim(),
      })),
      p_summary: reason,
      p_verified: verifiedDocuments || null,
    });
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) throw new Error(data?.error || 'The return was not accepted by the database.');

    // Tell the driver which documents to correct
    await notifyDriverOutcome(driverId, 'returned', {
      reason,
      notes,
      documents: (data.documents as string[]) || returned.map((i) => i.documentType),
      affiliationId: targetId,
    });

    return { success: true };
  } catch (err: any) {
    console.error('[adminApiService] returnDriverForCorrection exception:', err);
    throw err;
  }
}

export async function updateDriverDocumentReview(
  driverId: string,
  verifiedDocuments: ('license' | 'mtop' | 'tricycle' | 'selfie')[]
) {
  try {
    const { data: verif } = await supabase
      .from('driver_verification')
      .select('rejection_comment')
      .or(`driver_id.eq.${driverId},verification_id.eq.${driverId}`)
      .maybeSingle();

    let payload: any = {};
    if (verif?.rejection_comment && verif.rejection_comment.startsWith('{')) {
      try {
        payload = JSON.parse(verif.rejection_comment);
      } catch {}
    }

    payload.verifiedDocuments = verifiedDocuments;

    if (Array.isArray(payload.faultyDocuments)) {
      payload.faultyDocuments = payload.faultyDocuments.filter((d: string) => !verifiedDocuments.includes(d as any));
    }
    if (Array.isArray(payload.issues)) {
      payload.issues = payload.issues.filter((i: any) => !verifiedDocuments.includes(i.documentType));
    }

    const updatedComment = JSON.stringify(payload);

    await Promise.all([
      supabase
        .from('driver_verification')
        .update({
          rejection_comment: updatedComment,
        })
        .or(`driver_id.eq.${driverId},verification_id.eq.${driverId}`),
      supabase
        .from('driver')
        .update({
          rejection_comment: updatedComment,
        })
        .eq('driver_id', driverId),
    ]);


    return { success: true };
  } catch (err) {
    console.warn('[adminApiService] updateDriverDocumentReview warning:', err);
    return { success: false, error: err };
  }
}



/**
 * The drivers of ONE TODA: one per AFFILIATION with it (a driver of two TODAs is listed under both; driver.toda_id is only the pointer to
 * one of them), with that TODA's own LGU stage and membership data.
 */
export async function fetchTodaDrivers(todaId: string): Promise<DriverRecord[]> {
  try {
    const { data: affRows, error } = await supabase
      .from('driver_toda_affiliation')
      .select('*, toda:toda_id(toda_id, toda_name, toda_acronym, barangay), driver:driver_id(*, driver_verification(*))')
      .eq('toda_id', todaId)
      .order('submitted_at', { ascending: false });

    if (error || !affRows) return [];
    const data = (affRows as any[])
      .map((aff) => {
        const driverRow = Array.isArray(aff.driver) ? aff.driver[0] : aff.driver;
        if (!driverRow) return null;
        const t = Array.isArray(aff.toda) ? aff.toda[0] : aff.toda;
        return { ...driverRow, toda: t, __aff: aff };
      })
      .filter((row) => row !== null);
    return await Promise.all(data.map(async (d: any) => {
      const aff = d.__aff;
      const verif = Array.isArray(d.driver_verification) ? d.driver_verification[0] : d.driver_verification;
      const authId = d.auth_user_id;
      const licFrontPath = verif?.license_front_photo_path || (authId ? `${authId}/license_front.jpg` : null);
      const licBackPath = verif?.license_back_photo_path || (authId ? `${authId}/license_back.jpg` : null);
      const mtopPath = verif?.mtop_photo_path || (authId ? `${authId}/mtop.jpg` : null);
      const tricyclePath = verif?.tricycle_photo_path || d.tricycle_photo_path || (authId ? `${authId}/tricycle.jpg` : null);
      const selfiePath = verif?.face_photo_path || (authId ? `${authId}/selfie.jpg` : null);

      const [licFrontUrl, licBackUrl, mtopUrl, tricycleUrl, selfieUrl] = await Promise.all([
        resolveStorageDocUrl('driver-licenses', licFrontPath),
        resolveStorageDocUrl('driver-licenses', licBackPath),
        resolveStorageDocUrl('mtop-permits', mtopPath, 'driver-licenses'),
        resolveStorageDocUrl('mtop-permits', tricyclePath, 'driver-licenses'),
        resolveStorageDocUrl('driver-selfies', selfiePath, 'driver-licenses'),
      ]);

      return {
        id: d.driver_id,
        name: d.full_name,
        licenseNo: d.license_number || verif?.submitted_license_number || 'N/A',
        licenseExpiry: d.license_expiry || verif?.license_expiry || '',
        licenseStatus: 'Valid',
        mtopNo: d.franchise_number || verif?.submitted_franchise_number || 'N/A',
        mtopExpiry: d.mtop_expiry || verif?.mtop_expiry || verif?.franchise_expiry || '',
        mtopStatus: 'Valid',
        mtopOperatorName: verif?.submitted_operator_name || '',
        todaName: d.toda?.toda_name || 'TODA Association',
        todaId: todaId,
        // In this per-TODA list the decision is always about THIS TODA's application
        affiliations: [{
          affiliationId: aff.affiliation_id,
          todaId,
          todaName: d.toda?.toda_name || 'TODA Association',
          todaAcronym: d.toda?.toda_acronym || d.toda?.toda_name || 'TODA',
          membershipNo: aff.toda_membership_number || undefined,
          assignedTerminal: aff.assigned_terminal || undefined,
          barangayServiceArea: aff.barangay_service_area || undefined,
          todaStage: aff.toda_endorsement_status,
          lguStage: aff.lgu_verification_status,
          isActive: Boolean(aff.is_active_selection),
        }],
        actionAffiliationId: aff.toda_endorsement_status === 'Endorsed' && aff.lgu_verification_status === 'Pending' ? aff.affiliation_id : undefined,
        vehiclePlate: d.plate_number || verif?.submitted_plate_number || 'N/A',
        franchiseNo: d.franchise_number || verif?.submitted_franchise_number || 'N/A',
        franchiseExpiry: verif?.mtop_expiry || verif?.franchise_expiry || '',
        todaVerificationStatus: 'Verified',
        // THIS TODA's affiliation decides, not the driver's overall status (the driver may be Verified through another TODA only)
        lguVerificationStatus: aff.lgu_verification_status === 'Approved' ? 'Verified' : 'Pending',
        verificationStatus: aff.lgu_verification_status === 'Approved' ? 'Verified' : 'Pending',
        accountStatus: d.account_status === 'Suspended' || d.account_status === 'Deactivated' ? 'Inactive' : 'Active',
        onlineStatus: d.availability_status === 'Available' || d.availability_status === 'Busy' ? 'Online' : 'Offline',
        rating: Number(d.weighted_average_rating) || 0,
        ratingCount: Number(d.rating_count) || 0,
        phone: d.contact_number,
        barangay: aff.barangay_service_area || d.barangay_service_area || d.toda?.barangay || 'Calapan City',
        strikesCount: d.strikes_count ?? 0,
        strikeHistory: [],
        restrictionKind: deriveRestrictionKind(d),
        suspendedUntil: d.suspended_until || undefined,
        suspensionReason: d.suspension_reason || undefined,
        documents: [
          { name: "Driver's License (Front)", type: 'Identification Proof', status: 'Verified', url: licFrontUrl },
          { name: "Driver's License (Back)", type: 'Identification Proof', status: 'Verified', url: licBackUrl },
          { name: 'MTOP Franchise Permit', type: 'Official LGU Permit', status: 'Verified', url: mtopUrl },
          { name: 'Tricycle Unit Inspection Photo', type: 'Vehicle Compliance Photo', status: 'Verified', url: tricycleUrl },
          { name: 'Driver Profile Photo (Selfie)', type: 'Profile Photo', status: 'Verified', url: selfieUrl },
        ],
      };
    }));
  } catch (err) {
    console.error('[adminApiService] fetchTodaDrivers error:', err);
    return [];
  }
}

// ----------------------------------------------------------------------------
// STRIKES, SUSPENSIONS & REINSTATEMENT (Batch 3)
// All decisions are made by the database policy engine (RPCs) and audited there
// (actor, before/after state, reason). The client never writes strike or
// suspension columns directly: the database rejects such writes.
// ----------------------------------------------------------------------------

export type StrikeSubjectType = 'passenger' | 'driver';

export interface StrikeEngineResult {
  success: boolean;
  strike_id?: string;
  points?: number;
  active_before?: number;
  active_after?: number;
  consequence?: 'WARNING' | 'ADMIN_REVIEW' | 'SUSPENSION' | 'DEACTIVATION' | 'INVESTIGATION_SUSPENSION' | null;
  suspended_until?: string | null;
  paused?: boolean;
  observed?: boolean;
  exempt?: boolean;
  idempotent?: boolean;
}

export interface ViolationCatalogItem {
  violation_code: string;
  description: string;
  source_rule: string;
  default_points: number;
  min_points: number;
  max_points: number;
  confirmation_mode: 'AUTOMATIC' | 'UPHELD_REPORT' | 'ADMIN_CONFIRMATION';
  ladder_bypass: string;
}

async function callPolicyRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function deriveRestrictionKind(row: any): DriverRecord['restrictionKind'] {
  if (row.closed_at) return 'CLOSED';
  if (row.deactivated_at || row.account_status === 'Deactivated') return 'DEACTIVATED';
  if (row.suspension_kind === 'INVESTIGATION') return 'INVESTIGATION';
  if (row.account_status === 'Suspended') return 'SUSPENDED';
  return undefined;
}

/** Violations an administrator may record by hand (system-detected ones are issued by the platform). */
export async function fetchViolationCatalog(appliesTo: StrikeSubjectType): Promise<ViolationCatalogItem[]> {
  const { data, error } = await supabase
    .from('violation_catalog')
    .select('violation_code, description, source_rule, default_points, min_points, max_points, confirmation_mode, ladder_bypass')
    .eq('applies_to', appliesTo)
    .eq('is_active', true)
    .neq('confirmation_mode', 'AUTOMATIC')
    .order('source_rule');
  if (error) throw new Error(error.message);
  return (data || []) as ViolationCatalogItem[];
}

/** Strike ledger for one account, mapped for the existing strike-history lists. */
export async function fetchStrikeHistory(
  subjectType: StrikeSubjectType,
  subjectId: string
): Promise<{ activeStrikes: number; history: StrikeItem[] }> {
  const res = await callPolicyRpc<any>('get_strike_history', { p_subject_type: subjectType, p_subject_id: subjectId });
  const roleLabels: Record<string, string> = {
    lgu_admin: 'LGU Administrator',
    toda_admin: 'TODA Administrator',
    system: 'SAKAY System',
  };
  const history: StrikeItem[] = (res.strikes || []).map((s: any) => {
    const counted = ['ACTIVE', 'PROVISIONAL', 'PARTIALLY_WAIVED'].includes(s.status) && s.points_active > 0;
    let status: StrikeItem['status'];
    if (s.status === 'PROVISIONAL') status = 'Provisional (Exemption Window Open)';
    else if (s.status === 'WAIVED' || s.status === 'PARTIALLY_WAIVED' || s.status === 'VOIDED') status = 'Waived on Appeal';
    else if (s.status === 'AUTO_WAIVED' || s.status === 'OBSERVED') status = 'Not Counted (Waived / Exempt)';
    else status = counted && s.in_window ? 'Active (Rolling 90d)' : 'Expired';
    return {
      id: s.strike_id,
      date: new Date(s.issued_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: '2-digit', year: 'numeric' }),
      reason: `${s.description} (${s.source_rule})`,
      strikesApplied: s.points_active > 0 ? s.points_active : s.points_issued,
      status,
      issuedBy: roleLabels[s.issued_by_role] || 'SAKAY System',
      voidable: counted && Boolean(s.in_window),
    };
  });
  return { activeStrikes: res.active_strikes ?? 0, history };
}

export async function suspendDriver(driverId: string, reason: string, durationDays: number | null = 7) {
  const data = await callPolicyRpc<{ success: boolean; suspended_until: string | null }>('admin_suspend_account', {
    p_subject_type: 'driver', p_subject_id: driverId, p_days: durationDays, p_reason: reason,
  });
  return { success: true, data };
}

/** Lifts a suspension or reactivates a deactivated account. A deactivated account requires the
 *  administrator to confirm the full violation history was reviewed (Rule 22.2). Strikes are kept (22.4). */
export async function reactivateDriver(
  driverId: string,
  reason: string = 'Reinstated by LGU Administrator',
  historyReviewed: boolean = false
) {
  const data = await callPolicyRpc<{ success: boolean }>('admin_reinstate_account', {
    p_subject_type: 'driver', p_subject_id: driverId, p_reason: reason, p_history_reviewed: historyReviewed,
  });
  return { success: true, data };
}

export async function issueDriverStrike(driverId: string, violationCode: string, reason: string): Promise<StrikeEngineResult> {
  return callPolicyRpc<StrikeEngineResult>('issue_strike', {
    p_subject_type: 'driver', p_subject_id: driverId, p_violation_code: violationCode, p_reason: reason,
  });
}


/** Every row of a table the LGU may read, a page at a time (the API returns at most 1000 rows per request). */
async function fetchAllRows(table: string, columns: string, apply?: (q: any) => any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    let q: any = supabase.from(table).select(columns);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

export async function fetchPassengers(filters?: { status?: string }): Promise<PassengerRecord[]> {
  try {
    let query = supabase.from('passenger').select('*');
    if (filters?.status && filters.status !== 'All') {
      query = query.eq('account_status', filters.status);
    }
    const { data, error } = await query;
    if (error || !data) return [];

    // What each passenger has really done and been rated: their bookings, and the stars drivers gave them after a trip.
    const [bookingRows, ratingRows] = await Promise.all([
      fetchAllRows('booking', 'passenger_id'),
      fetchAllRows('rating', 'rating_id, booking_id, ratee_id, stars, tags, comment, created_at, is_excluded', (q) => q.eq('rater_role', 'Driver').order('created_at', { ascending: false })),
    ]);
    const bookingCount = new Map<string, number>();
    for (const b of bookingRows) {
      if (b.passenger_id) bookingCount.set(b.passenger_id, (bookingCount.get(b.passenger_id) ?? 0) + 1);
    }
    const ratingsOf = new Map<string, any[]>();
    for (const r of ratingRows) {
      if (r.ratee_id) ratingsOf.set(r.ratee_id, [...(ratingsOf.get(r.ratee_id) ?? []), r]);
    }

    return data.map((p: any) => {
      const given = ratingsOf.get(p.passenger_id) ?? [];
      // Rule 23.1: the Average Rating is the database's (sum / n of the ratings of Completed trips that were not excluded); NULL = Not Yet Rated
      const average = p.average_rating == null ? 0 : Number(p.average_rating);
      return {
      id: p.passenger_id,
      name: p.full_name,
      phone: p.contact_number,
      email: p.email || '',
      // A passenger who has not finished the OTP (account_status 'Pending ...') is Unverified and not yet Active (Rule 4.1)
      verificationStatus: String(p.account_status ?? '').startsWith('Pending') ? 'Unverified' : 'Verified',
      accountStatus: deriveRestrictionKind(p) === 'DEACTIVATED' || deriveRestrictionKind(p) === 'CLOSED'
        ? 'Deactivated'
        : p.account_status === 'Suspended' ? 'Suspended' : String(p.account_status ?? '').startsWith('Pending') ? 'Pending' : 'Active',
      restrictionKind: deriveRestrictionKind(p),
      suspendedUntil: p.suspended_until || undefined,
      suspensionReason: p.suspension_reason || undefined,
      activeSession: false,
      totalBookings: bookingCount.get(p.passenger_id) ?? 0,
      registeredDate: p.created_at ? new Date(p.created_at).toLocaleDateString('en-US') : '2026',
      // A passenger no driver has rated yet is "Not Yet Rated" (rating 0, count 0), not a made-up 5.0
      rating: average,
      ratingCount: Number(p.rating_count) || 0,
      strikesCount: p.strikes_count || 0,
      strikeHistory: [],
      recentFeedback: given.slice(0, 5).map((r: any) => ({
        ratingId: r.rating_id,
        excluded: Boolean(r.is_excluded),
        rating: Number(r.stars) || 0,
        category: Array.isArray(r.tags) && r.tags.length > 0 ? String(r.tags[0]) : 'General',
        comment: r.comment || 'No written feedback.',
        date: r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
        tripId: formatShortBookingId(r.booking_id),
      })),
    };
    });
  } catch (err) {
    console.error('[adminApiService] fetchPassengers error:', err);
    return [];
  }
}

export async function suspendPassenger(passengerId: string, reason: string, durationDays: number | null = 7) {
  const data = await callPolicyRpc<{ success: boolean; suspended_until: string | null }>('admin_suspend_account', {
    p_subject_type: 'passenger', p_subject_id: passengerId, p_days: durationDays, p_reason: reason,
  });
  return { success: true, data };
}

/** See reactivateDriver: deactivated accounts need the history-reviewed confirmation. */
export async function reactivatePassenger(
  passengerId: string,
  reason: string = 'Reinstated by LGU Administrator',
  historyReviewed: boolean = false
) {
  const data = await callPolicyRpc<{ success: boolean }>('admin_reinstate_account', {
    p_subject_type: 'passenger', p_subject_id: passengerId, p_reason: reason, p_history_reviewed: historyReviewed,
  });
  return { success: true, data };
}

export async function issuePassengerStrike(passengerId: string, violationCode: string, reason: string): Promise<StrikeEngineResult> {
  return callPolicyRpc<StrikeEngineResult>('issue_strike', {
    p_subject_type: 'passenger', p_subject_id: passengerId, p_violation_code: violationCode, p_reason: reason,
  });
}

// ----------------------------------------------------------------------------
// Rule 16.3 and PI-15: the audited correction of a completed trip, and closing a trip that was left at the destination
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// The service area (PI-01): the whole city, or a pilot circle around one TODA's terminal
// ----------------------------------------------------------------------------

/** The configured service areas, the active one first; null when they could not be read. */
export async function fetchServiceAreas(): Promise<ServiceAreaRecord[] | null> {
  const { data, error } = await supabase.from('service_area_config').select('config_id, area_name, radius_km, is_active, notes, updated_at, boundary_geojson').order('updated_at', { ascending: false }).limit(20);
  return error || !data ? null : mapServiceAreas(data);
}

/** The accredited TODAs that have a terminal on the map (the centre of a pilot area). */
export async function fetchTodaTerminals(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase.from('toda').select('toda_id, toda_name, terminal_latitude, terminal_longitude').not('terminal_latitude', 'is', null).not('terminal_longitude', 'is', null).order('toda_name', { ascending: true });
  return (data ?? []).map((t) => ({ id: String(t.toda_id), name: String(t.toda_name) }));
}

function rpcOutcome(res: { data: unknown; error: { message: string } | null }, fallback: string): string | null {
  if (res.error) return adminActionMessage(res.error.message, fallback);
  const d = res.data as { success?: boolean; error?: string } | null;
  return d && d.success === true ? null : adminActionMessage(d?.error, fallback);
}

/** Narrows the service area to a circle around a TODA's terminal. Null when it was set, otherwise the database's sentence. */
export async function setPilotServiceArea(todaId: string, radiusKm: number): Promise<string | null> {
  return rpcOutcome(await supabase.rpc('set_pilot_service_area', pilotAreaArgs(todaId, radiusKm)), 'The service area could not be changed.');
}

/** Puts the service area back to the whole of Calapan City (its boundary). Null when it was set, otherwise the database's sentence. */
export async function useWholeCityServiceArea(): Promise<string | null> {
  return rpcOutcome(await supabase.rpc('use_city_service_area'), 'The service area could not be changed.');
}

/** Rule 29.18: how many vehicle substitution requests wait for the LGU Administrator (the badge in the side menu); 0 when it cannot be read. */
export async function countPendingLguSubstitutions(): Promise<number> {
  const { count, error } = await supabase.from('vehicle_substitution').select('substitution_id', { count: 'exact', head: true }).eq('status', 'Pending LGU Approval');
  return error ? 0 : count ?? 0;
}

/**
 * Rules 5.3 / 5.7: the LGU Administrator confirms a reported queue conflict or availability violation (for a driver with no TODA, or one the TODA did not act on):
 * the strike is recorded under their name and the flag is resolved. Null when it was recorded, otherwise the database's sentence.
 */
export async function confirmAvailabilityViolation(flagId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('confirm_driver_availability_violation', confirmAvailabilityArgs(flagId, reason));
  return error ? adminActionMessage(error.message, 'The strike could not be recorded.') : null;
}

/**
 * Rule 16.3: corrects the fare (never above the system's) and / or the payment status of a COMPLETED trip. The route, the times and the people never change.
 * Null when it was recorded, otherwise the database's sentence (shown as it is). The passenger and the driver are told; the before and after are in the audit log.
 */
export async function correctCompletedTrip(bookingId: string, newFare: number | null, paymentStatus: string | null, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_correct_completed_trip', correctCompletedTripArgs(bookingId, newFare, paymentStatus, reason));
  return error ? adminActionMessage(error.message, 'The trip could not be corrected.') : null;
}

/**
 * PI-15: a trip the driver never finished (waiting at the destination) is closed as Paid or Waived after the parties were contacted. The LGU Administrator may
 * do it at any time. Null when it was closed, otherwise the database's sentence.
 */
export async function closeUnfinishedTrip(bookingId: string, paymentStatus: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_close_unfinished_trip', closeUnfinishedTripArgs(bookingId, paymentStatus, reason));
  return error ? adminActionMessage(error.message, 'The trip could not be closed.') : null;
}

// ----------------------------------------------------------------------------
// Strike appeals (Rule 25), voiding a strike and closing an account (Rule 22.2)
// ----------------------------------------------------------------------------

/**
 * Every strike appeal the LGU Administrator may see, newest first: a passenger's goes to the LGU directly (25.5), a driver's goes to the TODA first and
 * reaches the LGU when escalated (25.4). Row security shows the LGU all of them. A list that cannot be read throws, so the screen does not claim "no appeals".
 */
export async function fetchAppeals(): Promise<AppealRecord[]> {
  const { data: requests, error } = await supabase
    .from('exemption_request')
    .select('request_id, strike_id, subject_type, subject_id, cause_code, justification, evidence_urls, status, assigned_role, requested_at, decision_due_at, escalation_reason, auto_denied, decided_at, decision_reason, points_waived')
    .order('requested_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  if (!requests || requests.length === 0) return [];

  const strikeIds = [...new Set(requests.map((r) => String(r.strike_id)))];
  const passengerIds = [...new Set(requests.filter((r) => r.subject_type === 'passenger').map((r) => String(r.subject_id)))];
  const driverIds = [...new Set(requests.filter((r) => r.subject_type === 'driver').map((r) => String(r.subject_id)))];
  const [strikes, passengers, drivers, catalog] = await Promise.all([
    supabase.from('strikes_ledger').select('strike_id, violation_code, source_rule, status, points_active, points_issued').in('strike_id', strikeIds),
    passengerIds.length ? supabase.from('passenger').select('passenger_id, full_name').in('passenger_id', passengerIds) : Promise.resolve({ data: [] as any[] }),
    driverIds.length ? supabase.from('driver').select('driver_id, full_name').in('driver_id', driverIds) : Promise.resolve({ data: [] as any[] }),
    supabase.from('violation_catalog').select('violation_code, description'),
  ]);
  return mapAppealRows({
    requests,
    strikes: strikes.data ?? [],
    people: [
      ...(passengers.data ?? []).map((p: any) => ({ id: String(p.passenger_id), type: 'passenger' as const, name: String(p.full_name ?? 'Passenger') })),
      ...(drivers.data ?? []).map((d: any) => ({ id: String(d.driver_id), type: 'driver' as const, name: String(d.full_name ?? 'Driver') })),
    ],
    catalog: catalog.data ?? [],
  });
}

/** How many appeals wait for the LGU Administrator (the badge in the side menu); 0 when it cannot be read. */
export async function countPendingLguAppeals(): Promise<number> {
  const { count, error } = await supabase.from('exemption_request').select('request_id', { count: 'exact', head: true }).eq('status', 'Pending LGU Review');
  return error ? 0 : count ?? 0;
}

/** Rule 25.6: Full waiver, Partial waiver (the points to waive) or Denied, with the reason (25.8). Null when it was recorded, otherwise the database's sentence. */
/** Links for the photos of an appeal or a fare-dispute statement (the LGU Administrator may open every one; Storage signs them on request). */
export const signLguCaseEvidence = (paths: string[]): Promise<CaseEvidenceFile[]> => signCaseEvidence(supabase, paths);

export async function decideAppeal(requestId: string, outcome: ExemptionOutcome, reason: string, pointsToWaive?: number | null): Promise<string | null> {
  const { error } = await supabase.rpc('decide_exemption', decideExemptionArgs(requestId, outcome, reason, pointsToWaive));
  return error ? adminActionMessage(error.message, 'The decision could not be recorded.') : null;
}

/** The one way to remove a strike that should never have been issued. Null when it was voided, otherwise the database's sentence. */
export async function voidStrike(strikeId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_void_strike', voidStrikeArgs(strikeId, reason));
  return error ? adminActionMessage(error.message, 'The strike could not be voided.') : null;
}

/** Rule 22.2: closes an account for good, after the whole history was reviewed. Null when it was closed, otherwise the database's sentence. */
export async function closeAccountPermanently(subjectType: AppealSubjectType, subjectId: string, reason: string, historyReviewed: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('admin_close_account', closeAccountArgs(subjectType, subjectId, reason, historyReviewed));
  return error ? adminActionMessage(error.message, 'The account could not be closed.') : null;
}

// ============================================================================
// 6. INCIDENTS & ANNOUNCEMENTS SERVICES
// ============================================================================

/** What the audit log says happened to each report (the review timeline): who did what, when */
async function incidentTimeline(ids: string[]): Promise<Map<string, IncidentReportRecord['statusHistory']>> {
  const out = new Map<string, IncidentReportRecord['statusHistory']>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from('audit_log')
    .select('target_id, action_type, details, actor_role, performed_at')
    .in('target_id', ids)
    .in('action_type', ['URGENT_SAFETY_REPORT_FILED', 'INCIDENT_REVIEW_STARTED', 'INCIDENT_ESCALATED', 'INCIDENT_RECLASSIFIED_SERIOUS', 'INCIDENT_DECIDED', 'INCIDENT_LOST_ITEM_UPDATED', 'VICTIM_STRIKES_WAIVED'])
    .order('performed_at', { ascending: true });
  for (const row of data ?? []) {
    const list = out.get(row.target_id) ?? [];
    list.push({
      step: String(row.details ?? row.action_type).slice(0, 220),
      timestamp: row.performed_at ? new Date(row.performed_at).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
      actor: row.actor_role === 'lgu_admin' ? 'LGU Administrator' : row.actor_role === 'toda_admin' ? 'TODA Administrator' : row.actor_role === 'system' ? 'System' : String(row.actor_role ?? ''),
    });
    out.set(row.target_id, list);
  }
  return out;
}

export async function fetchIncidents(): Promise<IncidentReportRecord[]> {
  try {
    let { data, error } = await supabase
      .from('incident_report')
      .select('*, driver:driver_id(full_name, plate_number, contact_number, toda:toda_id(toda_name)), passenger:passenger_id(full_name, contact_number), booking:booking_id(pickup_address, dropoff_address)')
      .order('created_at', { ascending: false });

    if (error || !data) {
      const fallback = await supabase
        .from('incident_report')
        .select('*')
        .order('created_at', { ascending: false });
      data = fallback.data;
    }
    if (!data) return [];

    const timeline = await incidentTimeline(data.map((i: any) => i.incident_id));
    // Rule 8.7 / 19: reports about the same driver within the last 30 days (the supervisory warning of the detail screen)
    const since = Date.now() - 30 * 86_400_000;
    const perDriver = new Map<string, number>();
    data.forEach((i: any) => {
      if (i.driver_id && i.subject_type === 'driver' && Date.parse(i.created_at) >= since) perDriver.set(i.driver_id, (perDriver.get(i.driver_id) ?? 0) + 1);
    });

    // Every row is a real report in the database (filed by a passenger or driver through the apps, or by the system for a safety stop). Nothing is merged in from a browser.
    return await Promise.all(
      data.map(async (i: any): Promise<IncidentReportRecord> => {
        const record = i as IncidentRecord;
        const withdrawn = i.status === 'Cancelled';
        const status: IncidentReportRecord['status'] =
          withdrawn || record.outcome === 'NOT_UPHELD' || i.status === 'Dismissed' ? 'Dismissed' : record.outcome ? 'Resolved' : i.status === 'Under Investigation' ? 'Under Investigation' : 'Pending Review';
        return {
          id: i.incident_id,
          bookingId: i.booking_id || 'N/A',
          tripId: i.booking_id || 'N/A',
          reportedBy: (i.reported_by as any) || 'Passenger',
          reporterName: i.reported_by === 'Driver' ? (i.driver?.full_name || 'Driver') : i.reported_by === 'System' ? 'SAKAY (recorded by the system)' : (i.passenger?.full_name || 'Passenger'),
          driverName: i.driver?.full_name || 'Driver',
          todaName: i.driver?.toda?.toda_name || 'N/A',
          vehiclePlate: i.driver?.plate_number || 'N/A',
          passengerName: i.passenger?.full_name || 'Passenger',
          submittedDate: i.created_at ? new Date(i.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Manila' }) : 'Recent',
          submittedTime: i.created_at ? new Date(i.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }) : '',
          category: i.category || 'Others',
          // A report the passenger withdrew shows as Dismissed with the reason in the findings.
          status,
          description: i.description || '',
          findings: withdrawn ? `Withdrawn by the reporter: ${i.cancellation_reason || 'no reason given'}` : (i.resolution_notes || i.resolution || ''),
          evidenceFiles: await signIncidentEvidence(supabase, i.evidence_paths),
          relatedIncidentsCount: i.driver_id ? perDriver.get(i.driver_id) ?? 0 : 0,
          statusHistory: timeline.get(i.incident_id) ?? [],
          routing: record.routing,
          priority: record.priority,
          overdue: incidentClocks(record).overdue,
          route: `${i.booking?.pickup_address || '-'}  >  ${i.booking?.dropoff_address || '-'}`,
          passengerPhone: i.passenger?.contact_number || undefined,
          driverPhone: i.driver?.contact_number || undefined,
          record,
        };
      })
    );
  } catch (err) {
    console.error('[adminApiService] fetchIncidents error:', err);
    return [];
  }
}

// ---- reviewing a report (Section 19): every action is ONE database function (migration 20261026000001): who may act, the strike, the audit entry and the notices are the database's.
// The LGU Administrator no longer writes a report from the browser. Each answers null when the database accepted it, else the database's own sentence (shown as it is).
const incidentSentence = (r: TripEndResult): string | null => (r.ok ? null : r.error ?? 'The action could not be saved. Please try again.');
export async function startIncident(incidentId: string): Promise<string | null> {
  return incidentSentence(await startIncidentReview(supabase, incidentId));
}
/** Take a report over from the TODA, or reclassify it as serious (Rule 19.8) */
export async function escalateIncident(incidentId: string, reason: string, serious: boolean): Promise<string | null> {
  return incidentSentence(await escalateIncidentReport(supabase, incidentId, reason, serious));
}
/** Rules 19.4, 19.5, 26.4: the outcome (never automatic) and the strike the administrator confirms, issued as this administrator */
export async function decideIncident(decision: IncidentDecision): Promise<string | null> {
  return incidentSentence(await decideIncidentReport(supabase, decision));
}
/** Rules 29.20 - 29.22, 26.3: the LGU Administrator ends a trip for safety (a detained or incapacitated driver, an accident, a passenger in danger); nobody is struck */
export async function endTripSafely(end: SafetyEnd): Promise<string | null> {
  return incidentSentence(await endTripForSafety(supabase, end));
}
export async function updateLostItemReport(incidentId: string, status: Exclude<LostItemStatus, 'Open'>, note: string): Promise<string | null> {
  return incidentSentence(await updateLostItem(supabase, incidentId, status, note));
}

// ---- the calamity (Rules 15.4, 29.6): ONE administrative action = the announcement + the strike pause, recorded by one audit entry
export const fetchCalamity = (): Promise<ActiveCalamity> => fetchActiveCalamity(supabase);
export async function declareCalamity(input: CalamityInput): Promise<string | null> {
  return incidentSentence(await declareCalamityReport(supabase, input));
}
export async function endCalamity(note: string): Promise<string | null> {
  return incidentSentence(await endCalamityReport(supabase, note));
}

export async function fetchAnnouncements(): Promise<AnnouncementRecord[]> {
  const { data, error } = await supabase
    .from('announcement')
    .select('*, toda:toda_id(toda_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((a: any) => ({
    id: a.announcement_id,
    announcement_id: a.announcement_id,
    toda_id: a.toda_id ?? null,
    toda_name: a.toda?.toda_name ?? null,
    title: a.title,
    message: a.message,
    target_role: (a.target_audience || 'All') as AnnouncementRecord['target_role'],
    is_published: a.is_published !== false,
    publish_timing: 'Immediate',
    // created_by points at a TODA administrator; a notice written by the LGU Administrator has none
    created_by_lgu_admin: a.created_by ? 'TODA Administrator' : 'LGU Administrator',
    created_at: a.created_at ? formatManilaDateTime(a.created_at) : '\u2014',
    published_at: a.published_at ? formatManilaDateTime(a.published_at) : null,
    unpublished_at: a.unpublished_at ? formatManilaDateTime(a.unpublished_at) : null,
    updated_at: a.updated_at ? formatManilaDateTime(a.updated_at) : null,
  }));
}

export interface AnnouncementInput {
  title: string;
  message: string;
  /** All | Passenger | Driver | TODA Administrator (stored as target_audience; the apps read the announcements meant for them) */
  targetRole: string;
  targetTodaId: string | null;
}

/** Row security answers "no permission" with zero rows, not an error: a change that touched nothing is reported as a failure. */
async function announcementChanged(result: { data: any[] | null; error: { message: string } | null }): Promise<void> {
  if (result.error) throw new Error(result.error.message);
  if (!result.data || result.data.length === 0) {
    throw new Error('The announcement was not changed. It may have been deleted, or this account may not be allowed to change it.');
  }
}

/** Saves a new announcement. publish=false saves a draft that nobody sees until it is published. The database stamps the publication time. */
export async function createAnnouncement(payload: AnnouncementInput & { publish?: boolean; urgency?: string }) {
  const publish = payload.publish !== false;
  const { data, error } = await supabase
    .from('announcement')
    .insert([
      {
        title: payload.title,
        message: payload.message,
        target_audience: payload.targetRole || 'All',
        urgency: payload.urgency || 'Normal',
        is_published: publish,
        toda_id: payload.targetTodaId || null,
      },
    ])
    .select()
    .single();
  if (error) throw new Error(error.message);
  await recordAdminAuditAction({
    actionType: publish ? 'ANNOUNCEMENT_BROADCASTED' : 'ANNOUNCEMENT_DRAFTED',
    targetId: data?.announcement_id,
    targetName: payload.title,
    details: `${publish ? 'Published' : 'Saved as a draft'} the announcement '${payload.title}' for: ${payload.targetRole || 'All'}.`,
    category: 'Announcement',
  });
  return { success: true, data };
}

/** Changes the text, audience or scope of an existing announcement (the same row; the publish state is untouched). */
export async function updateAnnouncement(announcementId: string, input: AnnouncementInput): Promise<void> {
  await announcementChanged(
    await supabase
      .from('announcement')
      .update({ title: input.title, message: input.message, target_audience: input.targetRole || 'All', toda_id: input.targetTodaId || null })
      .eq('announcement_id', announcementId)
      .select('announcement_id')
  );
  await recordAdminAuditAction({
    actionType: 'ANNOUNCEMENT_EDITED',
    targetId: announcementId,
    targetName: input.title,
    details: `Edited the announcement '${input.title}' (audience: ${input.targetRole || 'All'}).`,
    category: 'Announcement',
  });
}

/** Publishes or unpublishes an announcement; the database stamps published_at / unpublished_at. */
export async function setAnnouncementPublished(announcementId: string, published: boolean, title = ''): Promise<void> {
  await announcementChanged(
    await supabase.from('announcement').update({ is_published: published }).eq('announcement_id', announcementId).select('announcement_id')
  );
  await recordAdminAuditAction({
    actionType: published ? 'ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_UNPUBLISHED',
    targetId: announcementId,
    targetName: title || undefined,
    details: `${published ? 'Published' : 'Unpublished'} the announcement${title ? ` '${title}'` : ''}.`,
    category: 'Announcement',
  });
}

export async function deleteAnnouncement(announcementId: string, title = ''): Promise<void> {
  await announcementChanged(await supabase.from('announcement').delete().eq('announcement_id', announcementId).select('announcement_id'));
  await recordAdminAuditAction({
    actionType: 'ANNOUNCEMENT_DELETED',
    targetId: announcementId,
    targetName: title || undefined,
    details: `Deleted the announcement${title ? ` '${title}'` : ''}.`,
    category: 'Announcement',
  });
}

// ============================================================================
// 7. AUDIT LOGGING SERVICES
// ============================================================================

const auditRpc: AuditRpc = (fn, args) => supabase.rpc(fn, args);

/** What the audit screen filters on, on the server: a day range in Asia/Manila and a search text */
export interface AuditQuery {
  fromDay?: string;
  toDay?: string;
  search?: string;
}

const auditFilters = (q: AuditQuery = {}): AuditLogFilters => ({
  from: q.fromDay ? manilaDayStartIso(q.fromDay) : null,
  to: q.toDay ? manilaNextDayStartIso(q.toDay) : null,
  search: q.search || null,
});

function auditCategoryOf(action: string): AuditLogRecord['category'] {
  if (action.includes('FARE')) return 'Fare Matrix';
  if (action.includes('ANNOUNCEMENT')) return 'Announcement';
  if (action.startsWith('ACCOUNT_') || action.startsWith('STRIKE_') || action.startsWith('EXEMPTION_') || action.startsWith('RATING_') || action.includes('PASSENGER')
      || action.startsWith('INTEGRITY_') || action.startsWith('VICTIM_')) return 'User Oversight';
  if (action.includes('TODA') || action.includes('DRIVER')) return 'Verification';
  return 'System';
}

/** The latest entries (Rule 28.4): the actor's name, role and the time come from the database, never from the browser. The log is append-only. */
export async function fetchAuditLogs(query: AuditQuery = {}): Promise<AuditLogRecord[]> {
  try {
    const page = await fetchAuditLogPage(auditRpc, auditFilters(query), 500, 0);
    return page.rows.map((log) => ({
      id: log.log_id,
      log_id: log.log_id,
      timestamp: log.performed_at_manila + ' (Asia/Manila)',
      lgu_admin_id: log.actor_id || '',
      actor_name: log.actor_name,
      actor_role: log.actor_role || '',
      action_type: log.action_type,
      target_id: log.target_id || '',
      target_name: log.target_name || log.target_id || '',
      details: log.details || '',
      performed_at: log.performed_at,
      before_state: log.before_state,
      after_state: log.after_state,
      category: auditCategoryOf(log.action_type),
    }));
  } catch (err) {
    console.error('[adminApiService] fetchAuditLogs error:', err);
    return [];
  }
}

/** Exports every entry the filters match (up to the cap) as Excel, CSV or a PDF (the browser's print dialog: "Save as PDF"); the export is written to the audit log first. */
export async function exportAuditLog(format: 'xlsx' | 'csv' | 'pdf', query: AuditQuery, generatedBy: string): Promise<{ count: number; truncated: boolean }> {
  return exportAuditLogFile({
    rpc: auditRpc,
    format,
    filters: auditFilters(query),
    generatedBy,
    title: 'SAKAY - Audit Log (LGU Administrator)',
    loadXlsx: async () => (await import('xlsx')) as unknown as XlsxLike,
  });
}

/**
 * A free-text note from a screen (an announcement, a reminder, an export of a report). The database stamps WHO (the signed-in administrator) and WHEN (the server's
 * clock); the browser's own time and name are not sent. Decisions on an account, application, TODA, fare, strike or trip outcome are NOT written here: the database
 * function that makes the decision writes its own entry in the same transaction.
 */
export async function recordAdminAuditAction(action: {
  actionType: string;
  targetId?: string;
  targetName?: string;
  details: string;
  category?: string;
  actorName?: string;
}) {
  try {
    await supabase.from('audit_log').insert([
      {
        action_type: action.actionType,
        target_id: action.targetId || null,
        target_name: action.targetName || null,
        category: action.category || 'General',
        details: action.details,
      },
    ]);
  } catch (err) {
    console.warn('[adminApiService] recordAdminAuditAction error:', err);
  }
}

// ----------------------------------------------------------------------------
// Ratings, integrity flags and legal holds (Batch 12; Rules 23.4, 23.5, 27.1 - 27.6, 28.3)
// ----------------------------------------------------------------------------
/** Rule 23.5: exclude (or count again) one rating; the reason is kept in the audit entry */
export async function excludeRating(ratingId: string, exclude: boolean, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_exclude_rating', { p_rating_id: ratingId, p_exclude: exclude, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The rating could not be changed.') : null;
}

/** Rules 27.1, 27.3 - 27.6: confirm what a detector flag points at (the strikes, the exclusion of the ratings) */
export async function confirmIntegrityFlag(flagId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_confirm_integrity_flag', { p_flag_id: flagId, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The violation could not be confirmed.') : null;
}

/** Rule 23.4: the warning to a passenger whose average stayed under 3.00 after 20 trips */
export async function sendConductWarning(flagId: string, message: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_send_conduct_warning', { p_flag_id: flagId, p_message: message });
  return error ? adminActionMessage(error.message, 'The warning could not be sent.') : null;
}

export interface LegalHoldRecord {
  hold_id: string;
  subject_type: 'booking' | 'driver' | 'passenger';
  subject_id: string;
  case_ref: string | null;
  reason: string;
  placed_at: string;
  released_at: string | null;
}

/** Rule 28.3: the holds the LGU Administrator placed (records tied to an investigation are kept until the case is closed) */
export async function fetchLegalHolds(): Promise<LegalHoldRecord[]> {
  const { data, error } = await supabase.from('legal_hold').select('hold_id, subject_type, subject_id, case_ref, reason, placed_at, released_at').order('placed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as LegalHoldRecord[];
}
export async function placeLegalHold(subjectType: LegalHoldRecord['subject_type'], subjectId: string, caseRef: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('place_legal_hold', { p_subject_type: subjectType, p_subject_id: subjectId, p_case_ref: caseRef, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The hold could not be placed.') : null;
}
export async function releaseLegalHold(holdId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('release_legal_hold', { p_hold_id: holdId, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The hold could not be released.') : null;
}

// ============================================================================
// 8. TRIP MONITORING & OPERATIONS SERVICES (Live Supabase public.booking)
// ============================================================================

export interface BookingRecordItem {
  id: string;
  bookingId: string;
  tripType: string;
  status: string;
  driverId?: string;
  driverName: string;
  driverPhone: string;
  todaName: string;
  vehiclePlate: string;
  passengerId?: string;
  passengerName: string;
  passengerPhone: string;
  passengerCount: number;
  pickupArea: string;
  destinationArea: string;
  startLat: number;
  startLng: number;
  destLat: number;
  destLng: number;
  /** The driver's own position while the booking is live (from the phone's heartbeat); null when there is no driver or no fix yet */
  driverLat: number | null;
  driverLng: number | null;
  /** When the driver's phone last reported that position (ISO); null when there is none */
  driverFixAt: string | null;
  /** The estimate the passenger confirmed (Matched Shared Fare Estimate for a Shared trip) */
  estimatedFare: number;
  /** The final, binding fare once the trip arrived (written by the database, Rule 6.2); null before that */
  finalFare?: number | null;
  /** How the final fare was reached, for the trip detail (rule 6.2.4: deviations are recorded) */
  fareBasis?: string | null;
  fareDeviation?: boolean;
  /** Unpaid | Paid | Payment Disputed | Waived */
  paymentStatus?: string | null;
  distanceKm?: number;
  /** The quoted road distance and the distance the phone recorded (null until known) */
  estimatedDistanceKm: number | null;
  actualDistanceKm: number | null;
  /** passenger | driver | system, and the reason given, for a cancelled booking (null otherwise) */
  cancelledBy: string | null;
  cancellationReason: string | null;
  /** The booking's timeline (ISO); each is null until it happens */
  requestedAt: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  bookingTime: string;
  sharedTripDetails?: {
    matchedPassengers: number;
    cutoffPassed: boolean;
    sharedSavings: string;
  };
}

/** The statuses in which a driver is committed to the booking and their phone is reporting a position */
const LIVE_BOOKING_STATUSES = [
  'Accepted',
  'Driver Assigned',
  'Driver En Route',
  'In Transit',
  'Arrived at Pickup',
  'Driver Arrived',
  'Trip Ongoing',
  'Heading to Passenger',
  'Arrived at Destination',
];

export async function fetchAllBookings(filterStatus?: string): Promise<BookingRecordItem[]> {
  try {
    let query = supabase
      .from('booking')
      .select(`
        *,
        passenger:passenger_id (
          full_name,
          contact_number
        ),
        driver:driver_id (
          full_name,
          contact_number,
          plate_number,
          current_latitude,
          current_longitude,
          last_location_update,
          toda:toda_id (
            toda_name,
            toda_acronym
          )
        ),
        booking_toda:toda_id (
          toda_name
        )
      `)
      .order('created_at', { ascending: false });

    if (filterStatus && filterStatus !== 'All') {
      if (filterStatus === 'Active') {
        query = query.in('booking_status', [
          'Accepted',
          'Driver Assigned',
          'Driver En Route',
          'In Transit',
          'Arrived at Pickup',
          'Driver Arrived',
          'Trip Ongoing',
          'Heading to Passenger',
          'Arrived at Destination',
        ]);
      } else if (filterStatus === 'Completed') {
        query = query.eq('booking_status', 'Completed');
      } else if (filterStatus === 'Cancelled') {
        query = query.in('booking_status', ['Cancelled', 'Cancelled by Passenger', 'Cancelled by Driver', 'No Driver Found']);
      } else {
        query = query.eq('booking_status', filterStatus);
      }
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((b: any): BookingRecordItem => {
      const live = LIVE_BOOKING_STATUSES.includes(b.booking_status);
      const hasFix = live && b.driver && b.driver.current_latitude != null && b.driver.current_longitude != null;
      const iso = (v: any): string | null => (v ? String(v) : null);
      return {
        id: b.booking_id,
        bookingId: b.booking_id,
        tripType: b.is_shared_trip || b.trip_type === 'Shared' ? 'Shared Trip' : 'Solo Ride',
        status: b.booking_status,
        driverId: b.driver_id,
        driverName: b.driver?.full_name || 'No driver assigned',
        driverPhone: b.driver?.contact_number || '\u2014',
        todaName: b.driver?.toda?.toda_name || b.booking_toda?.toda_name || '\u2014',
        vehiclePlate: b.driver?.plate_number || '\u2014',
        passengerId: b.passenger_id,
        passengerName: b.passenger?.full_name || 'Unknown passenger',
        passengerPhone: b.passenger?.contact_number || '\u2014',
        passengerCount: b.passenger_count || 1,
        pickupArea: b.pickup_address || b.pickup_location_address || '\u2014',
        destinationArea: b.dropoff_address || b.dropoff_location_address || '\u2014',
        startLat: Number(b.pickup_latitude),
        startLng: Number(b.pickup_longitude),
        destLat: Number(b.dropoff_latitude),
        destLng: Number(b.dropoff_longitude),
        driverLat: hasFix ? Number(b.driver.current_latitude) : null,
        driverLng: hasFix ? Number(b.driver.current_longitude) : null,
        driverFixAt: hasFix ? iso(b.driver.last_location_update) : null,
        estimatedFare: Number(b.estimated_fare) || 0,
        finalFare: b.actual_fare !== null && b.actual_fare !== undefined ? Number(b.actual_fare) : null,
        fareBasis: b.fare_breakdown?.final?.basis ?? null,
        fareDeviation: Boolean(b.fare_breakdown?.final?.deviation),
        paymentStatus: b.payment_status ?? null,
        distanceKm: Number(b.actual_distance_km ?? b.estimated_distance_km) || undefined,
        estimatedDistanceKm: b.estimated_distance_km != null ? Number(b.estimated_distance_km) : null,
        actualDistanceKm: b.actual_distance_km != null ? Number(b.actual_distance_km) : null,
        cancelledBy: b.cancelled_by || (String(b.booking_status).startsWith('Cancelled by ') ? String(b.booking_status).slice(13).toLowerCase() : null),
        cancellationReason: b.cancellation_reason || null,
        requestedAt: iso(b.requested_at ?? b.created_at),
        acceptedAt: iso(b.accepted_at),
        arrivedAt: iso(b.arrived_at),
        startedAt: iso(b.trip_started_at),
        completedAt: iso(b.trip_completed_at),
        cancelledAt: iso(b.cancelled_at),
        createdAt: b.created_at,
        bookingTime: b.created_at ? new Date(b.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '\u2014',
      };
    });
  } catch (err) {
    console.error('[adminApiService] fetchAllBookings error:', err);
    return [];
  }
}

/** The route a trip really took: the positions the driver's phone published during it (Rule 6.2.4), oldest first. The LGU Administrator may read them. */
export async function fetchTripTrack(bookingId: string): Promise<Array<{ lat: number; lng: number; at: string }>> {
  const { data, error } = await supabase
    .from('gps_log')
    .select('latitude, longitude, recorded_at')
    .eq('booking_id', bookingId)
    .order('recorded_at', { ascending: true })
    .limit(3000);
  if (error || !data) return [];
  return (data as any[])
    .filter((r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
    .map((r) => ({ lat: Number(r.latitude), lng: Number(r.longitude), at: String(r.recorded_at) }));
}

// ============================================================================
// 9. PASSENGER FEEDBACK & RATINGS SERVICES
// ============================================================================

export interface PassengerFeedbackItem {
  id: string;
  ratingId: string;
  passengerName: string;
  driverName: string;
  todaName: string;
  ratingValue: number;
  comment: string;
  category: 'Cleanliness' | 'Courtesy' | 'Safe Driving' | 'Fair Pricing' | 'General';
  createdAt: string;
  isComplaint: boolean;
  /** Rule 23.5: the LGU Administrator excluded this rating from the Average Rating */
  isExcluded: boolean;
}

export async function fetchPassengerFeedback(): Promise<PassengerFeedbackItem[]> {
  try {
    const { data, error } = await supabase
      .from('driver_rating')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return data.map((r: any) => {
        const ratingVal = Number(r.stars) || Number(r.rating_value) || 0;
        return {
          id: r.rating_id,
          ratingId: r.rating_id,
          passengerName: r.passenger_name || 'Passenger',
          driverName: r.driver_name || 'Driver',
          todaName: r.toda_name || 'Calapan TODA',
          ratingValue: ratingVal,
          comment: r.comment || r.feedback_comment || 'No written feedback submitted.',
          category: ratingVal >= 4 ? 'Safe Driving' : 'General',
          createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
          isComplaint: ratingVal <= 2,
          isExcluded: Boolean(r.is_excluded),
        };
      });
    }

    // Fallback: Query base 'rating' table if driver_rating view is not yet created
    const { data: rawRatings, error: rawError } = await supabase
      .from('rating')
      .select('*')
      .order('created_at', { ascending: false });

    if (rawError || !rawRatings) return [];

    const passengerIds = [...new Set(rawRatings.map((r: any) => r.rater_id).filter(Boolean))];
    const driverIds = [...new Set(rawRatings.map((r: any) => r.ratee_id).filter(Boolean))];

    const [passengersRes, driversRes] = await Promise.all([
      passengerIds.length > 0
        ? supabase.from('passenger').select('passenger_id, full_name').in('passenger_id', passengerIds)
        : { data: [] },
      driverIds.length > 0
        ? supabase.from('driver').select('driver_id, full_name, toda:toda_id(toda_name)').in('driver_id', driverIds)
        : { data: [] },
    ]);

    const passengerMap = new Map((passengersRes.data || []).map((p: any) => [p.passenger_id, p.full_name]));
    const driverMap = new Map((driversRes.data || []).map((d: any) => [d.driver_id, d]));

    return rawRatings.map((r: any) => {
      const d: any = driverMap.get(r.ratee_id);
      const stars = Number(r.stars) || 0;
      return {
        id: r.rating_id,
        ratingId: r.rating_id,
        passengerName: passengerMap.get(r.rater_id) || 'Passenger',
        driverName: d?.full_name || 'Driver',
        todaName: d?.toda?.toda_name || 'Calapan TODA',
        ratingValue: stars,
        comment: r.comment || 'No written feedback submitted.',
        category: stars >= 4 ? 'Safe Driving' : 'General',
        createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
        isComplaint: stars <= 2,
        isExcluded: Boolean(r.is_excluded),
      };
    });
  } catch (err) {
    console.error('[adminApiService] fetchPassengerFeedback error:', err);
    return [];
  }
}

// ============================================================================
// 15. TERMINAL RELOCATION & DOCUMENT RENEWAL MANAGEMENT (Batch 1 Rules 2.2, 24.2)
// ============================================================================

/**
 * Fetches TODAs with pending terminal relocation requests (Rule 2.2)
 */
export async function fetchPendingTerminalRelocations() {
  try {
    const { data, error } = await supabase
      .from('toda')
      .select('toda_id, toda_name, toda_acronym, terminal_latitude, terminal_longitude, service_coverage_area, pending_terminal_latitude, pending_terminal_longitude, pending_terminal_location, terminal_relocation_status, terminal_relocation_requested_at')
      .eq('terminal_relocation_status', 'Pending LGU Re-approval')
      .order('terminal_relocation_requested_at', { ascending: false });

    if (error) {
      console.warn('[adminApiService] fetchPendingTerminalRelocations warning:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[adminApiService] fetchPendingTerminalRelocations error:', err);
    return [];
  }
}

/**
 * Approves a pending terminal relocation (Rule 2.2)
 */
export async function approveTerminalRelocation(todaId: string, remarks?: string) {
  const { data, error } = await supabase.rpc('approve_terminal_relocation', {
    p_toda_id: todaId,
    p_remarks: remarks || null,
  });
  if (error) throw error;
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The terminal move was not approved.'));
  return data;
}

/**
 * Rejects a pending terminal relocation (Rule 2.2)
 */
export async function rejectTerminalRelocation(todaId: string, reason?: string) {
  const { data, error } = await supabase.rpc('reject_terminal_relocation', {
    p_toda_id: todaId,
    p_reason: reason || null,
  });
  if (error) throw error;
  if (!data || data.success !== true) throw new Error(String(data?.error || 'The terminal move was not rejected.'));
  return data;
}

/**
 * Fetches pending driver document renewals (Rule 24.2)
 */
export async function fetchPendingDriverRenewals() {
  try {
    const { data, error } = await supabase
      .from('driver_verification')
      .select(`
        driver_id,
        submitted_license_number,
        submitted_plate_number,
        pending_license_expiry,
        pending_mtop_expiry,
        pending_license_photo_url,
        pending_mtop_photo_url,
        renewal_status,
        driver:driver_id (
          driver_id,
          full_name,
          contact_number,
          license_expiry,
          mtop_expiry,
          toda:toda_id (toda_name, toda_acronym)
        )
      `)
      .eq('renewal_status', 'Pending LGU Verification');

    if (error) {
      console.warn('[adminApiService] fetchPendingDriverRenewals warning:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[adminApiService] fetchPendingDriverRenewals error:', err);
    return [];
  }
}

/**
 * Verifies or rejects a driver document renewal (Rule 24.2)
 */
export async function verifyDriverRenewal(driverId: string, approved: boolean, remarks?: string) {
  const { data, error } = await supabase.rpc('verify_driver_renewal', {
    p_driver_id: driverId,
    p_approved: approved,
    p_remarks: remarks || null,
  });
  if (error) throw error;
  return data;
}

/**
 * Fetches open administrative review flags (Batch 1 Rules 2.4, 3.2, 3.7)
 */
export async function fetchAdminReviewFlags() {
  try {
    const { data, error } = await supabase
      .from('admin_review_flag')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[adminApiService] fetchAdminReviewFlags warning:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[adminApiService] fetchAdminReviewFlags error:', err);
    return [];
  }
}

/**
 * Rule 9.5: the trips whose driver stayed silent for 30 minutes and still wait for an administrator to close them (the LGU Administrator sees all).
 */
export async function fetchTripsNeedingReconciliation(): Promise<ReconciliationTrip[]> {
  const { data, error } = await supabase.rpc('get_trips_needing_reconciliation');
  if (error) {
    console.warn('[adminApiService] fetchTripsNeedingReconciliation warning:', error.message);
    return [];
  }
  return mapReconciliationTrips(data);
}

/** Rule 9.5: closes a silent trip after the parties were contacted. Resolves to null when accepted, else the database's own explanation. */
export async function reconcileTrip(input: ReconcileInput): Promise<string | null> {
  const { error } = await supabase.rpc('admin_reconcile_trip', reconcileTripArgs(input));
  return error ? adminActionMessage(error.message, 'The trip could not be closed.') : null;
}

/** Batch 9: the fare disputes (the LGU Administrator sees all of them): the escalated ones, and those with no TODA, are this administrator's to decide. */
export async function fetchFareDisputes(): Promise<FareDisputeRow[]> {
  const { data, error } = await supabase.rpc('get_fare_disputes', fareDisputesArgs(null, 100));
  if (error) {
    console.warn('[adminApiService] fetchFareDisputes warning:', error.message);
    return [];
  }
  return parseFareDisputes(data);
}

/** Rules 13.5 / 18.4 / 18.6: decides a dispute, with the strike when one is confirmed (the passenger strikes are the LGU Administrator's). Resolves to null when accepted, else the database's explanation. */
export async function resolveFareDispute(decision: FareDisputeDecision): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_fare_dispute', resolveFareDisputeArgs(decision));
  return error ? adminActionMessage(error.message, 'The decision could not be recorded.') : null;
}

/** Rules 13.6 / 13.7: the LGU Administrator confirms the violation a review flag points at (PAX_FARE_AVOIDANCE, DRV_EARLY_STOP). Resolves to null when accepted, else the database's explanation. */
export async function confirmFlaggedViolation(flagId: string, bookingId: string | null, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_confirm_flagged_violation', confirmFlaggedViolationArgs(flagId, bookingId, reason));
  return error ? adminActionMessage(error.message, 'The violation could not be confirmed.') : null;
}

/** Rule 9.6: the LGU Administrator confirms a TODA Administrator's report of a deliberate offline: 2 strikes, no appeal under Rule 9.4. */
export async function confirmDeliberateOffline(flagId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('confirm_deliberate_offline', { p_flag_id: flagId, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The report could not be confirmed.') : null;
}

/**
 * Resolves an administrative review flag
 */
export async function resolveAdminReviewFlag(flagId: string, resolution: string) {
  // The RPC records the reviewer (resolved_by) and writes the audit_log entry.
  return callPolicyRpc<{ success: boolean; flag_id: string; status: string }>('resolve_admin_review_flag', {
    p_flag_id: flagId, p_status: 'Resolved', p_resolution: resolution,
  });
}




/** A real notice to the TODA's administrators about its Barangay Clearance (the database refuses a second one within 10 minutes). */
export async function sendTodaRenewalReminder(todaId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('admin_send_toda_renewal_reminder', { p_toda_id: todaId });
  if (error) return adminActionMessage(error.message, 'The reminder could not be sent.');
  const r = data as { success?: boolean; error?: string } | null;
  return r?.success ? null : r?.error || 'The reminder could not be sent.';
}

/** A real notice to the driver about the License and MTOP dates on record. */
export async function sendDriverRenewalReminder(driverId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('admin_send_driver_renewal_reminder', { p_driver_id: driverId });
  if (error) return adminActionMessage(error.message, 'The reminder could not be sent.');
  const r = data as { success?: boolean; error?: string } | null;
  return r?.success ? null : r?.error || 'The reminder could not be sent.';
}

/** The LGU Administrator sends a report back to the involved TODA for action (never a serious one, Rule 19.8). */
export async function referIncidentToToda(incidentId: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('incident_refer_to_toda', { p_incident_id: incidentId, p_reason: reason });
  return error ? adminActionMessage(error.message, 'The report could not be referred.') : null;
}
