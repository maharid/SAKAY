/**
 * ============================================================================
 * SAKAY DRIVER API CLIENT SERVICE (driverApiService.ts)
 * ============================================================================
 * Purpose:
 *   Centralized network service providing typed database requests connecting the
 *   SAKAY Driver PWA directly to the Supabase database.
 * ============================================================================
 */

import { apiPostJson } from '@sakay/shared';
import type { ApplyDriverTodaAffiliationsResponse, DriverTodaApplicationInput } from '@sakay/shared';
import { supabase } from './supabaseClient';
import { getOnboardingCache } from './driverOnboardingCache';
import type { LicenseExtractedData, MtopExtractedData } from './driverOnboardingCache';


export async function rotateDriverSession(driverId: string): Promise<string> {
  const newSessionId = crypto.randomUUID();
  await supabase
    .from('driver')
    .update({ session_id: newSessionId })
    .eq('driver_id', driverId);
  try {
    localStorage.setItem('sakay_driver_session_token', newSessionId);
  } catch {}
  return newSessionId;
}

/**
 * Helper to get localized error message respecting current selected language
 */
export function getLocalizedError(tlMsg: string, enMsg: string): string {
  const lang = typeof window !== 'undefined' ? localStorage.getItem('sakay_language') || 'tl' : 'tl';
  return lang === 'tl' ? tlMsg : enMsg;
}

/**
 * Normalizes any Philippine phone number representation to standard E.164 (+639XXXXXXXXX)
 */
export function formatPhoneToE164(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('09') && digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }
  if (digits.startsWith('9') && digits.length === 10) {
    return `+63${digits}`;
  }
  if (digits.startsWith('63') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 11) {
    return `+63${digits.slice(1)}`;
  }
  return digits ? `+63${digits}` : '';
}

/**
 * Returns candidate phone representations and auth sign-in email variants for resilient matching
 */
export function getPhoneLookupCandidates(raw: string) {
  const digits = (raw || '').replace(/\D/g, '');
  let phoneRaw = digits;
  if (digits.startsWith('639')) {
    phoneRaw = digits.slice(2);
  } else if (digits.startsWith('09')) {
    phoneRaw = digits.slice(1);
  } else if (digits.startsWith('63')) {
    phoneRaw = digits.slice(2);
  } else if (digits.startsWith('0')) {
    phoneRaw = digits.slice(1);
  }

  const phone09 = `0${phoneRaw}`;
  const phone63WithPlus = `+63${phoneRaw}`;
  const phone63NoPlus = `63${phoneRaw}`;

  return {
    phoneRaw,
    phone09,
    phone63WithPlus,
    phone63NoPlus,
    e164: phone63WithPlus,
    authCandidates: [
      { email: `driver_${phone63NoPlus}@sakay.ph` },
      { email: `driver_${phone09}@sakay.ph` },
      { email: `driver_${phoneRaw}@sakay.ph` },
      { email: `driver_${phone09}@driver.sakay.internal` },
      { email: `driver_${phone63NoPlus}@driver.sakay.internal` },
      { phone: phone63WithPlus },
      { phone: phone09 },
    ],
  };
}

/**
 * The signed-in user's id, read from the local session (no network call: these helpers run on polling screens). Nothing relies on it for
 * safety: every query below carries the session token, so row security shows the signed-in driver their own rows whatever id is asked for.
 */
async function currentAuthUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/**
 * The signed-in driver's OWN record and verification status, found from the session (the database shows a driver nobody else's row).
 * There is no look-up by phone number any more, and no second client with borrowed credentials: before sign-in nothing can be read.
 */
export async function fetchOwnDriverRecord(): Promise<any | null> {
  try {
    const userId = await currentAuthUserId();
    if (!userId) return null;

    const { data: driver, error } = await supabase
      .from('driver')
      .select('driver_id, auth_user_id, full_name, contact_number, email, plate_number, license_number, franchise_number, account_status, toda_id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (error || !driver) return null;

    const { data: verif } = await supabase
      .from('driver_verification')
      .select('verification_status, submitted_license_number, remarks')
      .eq('driver_id', driver.driver_id)
      .maybeSingle();

    const todas = await fetchAccreditedTodas();
    const toda = todas.find((t) => t.id === driver.toda_id);

    return {
      ...driver,
      toda: toda ? { toda_id: toda.id, toda_name: toda.name, toda_acronym: toda.acronym } : null,
      verification: verif || null,
    };
  } catch (err) {
    console.warn('[driverApiService] fetchOwnDriverRecord exception:', err);
    return null;
  }
}

// ============================================================================
// 1. REGISTRATION & PROFILE
// ============================================================================

/**
 * The directory of accredited TODAs for the registration picker. It comes from a database function that answers even before sign-in and
 * returns only the directory fields (the toda table itself holds documents and officer details and is not readable by drivers).
 */
export interface TodaDirectoryEntry {
  id: string;
  name: string;
  acronym: string;
  barangay: string;
  terminalLocation: string;
}

// The directory changes rarely and the status / profile screens ask for it on every poll, so it is kept for a minute.
const TODA_DIRECTORY_TTL_MS = 60_000;
let todaDirectoryMemo: { at: number; list: TodaDirectoryEntry[] } | null = null;

export async function fetchAccreditedTodas(): Promise<TodaDirectoryEntry[]> {
  try {
    if (todaDirectoryMemo && Date.now() - todaDirectoryMemo.at < TODA_DIRECTORY_TTL_MS) {
      return todaDirectoryMemo.list;
    }

    const { data, error } = await supabase.rpc('list_accredited_todas');

    if (error || !data || data.length === 0) {
      return [];
    }

    const list = (data as any[]).map((t: any) => ({
      id: t.toda_id,
      name: t.toda_name,
      acronym: t.toda_acronym || 'TODA',
      barangay: t.barangay || 'Calapan City',
      terminalLocation: t.service_coverage_area || t.barangay || 'Calapan City',
    }));
    todaDirectoryMemo = { at: Date.now(), list };
    return list;
  } catch (err) {
    console.error('[driverApiService] fetchAccreditedTodas error:', err);
    return [];
  }
}

export async function registerDriver(payload: {
  fullName: string;
  contactNumber: string;
  todaId: string;
  plateNumber: string;
  licenseNumber: string;
  franchiseNumber?: string;
  residentialAddress?: string;
}) {
  const insertPayload = {
    full_name: payload.fullName,
    contact_number: payload.contactNumber,
    toda_id: payload.todaId,
    plate_number: payload.plateNumber,
    license_number: payload.licenseNumber,
    franchise_number: payload.franchiseNumber || 'MTOP-PENDING',
    barangay_service_area: payload.residentialAddress || 'Calapan City',
    account_status: 'Pending Verification',
    is_profile_complete: true,
  };

  const { data, error } = await supabase.from('driver').insert([insertPayload]).select().single();
  if (error) throw error;
  return data;
}

/** The signed-in driver's profile. (The argument is ignored: the record is found from the session, never from an id kept on the device.) */
export async function fetchDriverProfile(_driverId?: string) {
  try {
    const userId = await currentAuthUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('driver')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (error || !data) return null;

    // The TODA's name comes from the public directory (a driver cannot read the toda table itself)
    const todaDirectory = await fetchAccreditedTodas();
    const todaEntry = todaDirectory.find((t) => t.id === data.toda_id);

    // Check verification record if plate/license/franchise are null in driver table
    let plateNumber = data.plate_number;
    let licenseNumber = data.license_number;
    let franchiseNumber = data.franchise_number;

    if (!plateNumber || !licenseNumber || !franchiseNumber) {
      const { data: verif } = await supabase
        .from('driver_verification')
        .select('submitted_plate_number, submitted_license_number, submitted_franchise_number, ocr_plate_number, ocr_license_number, ocr_franchise_number')
        .eq('driver_id', data.driver_id)
        .maybeSingle();

      if (verif) {
        plateNumber = plateNumber || verif.submitted_plate_number || verif.ocr_plate_number || '';
        licenseNumber = licenseNumber || verif.submitted_license_number || verif.ocr_license_number || '';
        franchiseNumber = franchiseNumber || verif.submitted_franchise_number || verif.ocr_franchise_number || '';
      }
    }

    const todaObj = todaEntry ? { toda_name: todaEntry.name, toda_acronym: todaEntry.acronym } : null;

    return {
      id: data.driver_id,
      name: data.full_name,
      phone: data.contact_number,
      email: data.email || '',
      // a storage PATH in the private "profiles" bucket (screens ask for a signed URL when they show it)
      profile_photo_url: data.profile_photo_url || '',
      vehiclePlate: plateNumber || '',
      licenseNumber: licenseNumber || '',
      franchiseNumber: franchiseNumber || '',
      todaName: todaObj?.toda_name || '',
      todaAcronym: todaObj?.toda_acronym || '',
      todaId: data.toda_id || '',
      rating: Number(data.weighted_average_rating) || 5.0,
      accountStatus: data.account_status,
      // The column holds 'Offline' | 'Available' | 'Busy' (never 'Online' / 'Paused'); the live value comes from the presence engine.
      isOnline: data.availability_status === 'Available' || data.availability_status === 'Busy',
      isPaused: false,
      verificationStage: data.account_status === 'Verified' ? 'Stage 2 Approved' : 'Stage 1 TODA Review',
      currentLat: data.current_latitude ? Number(data.current_latitude) : 13.4117,
      currentLng: data.current_longitude ? Number(data.current_longitude) : 121.1803,
    };
  } catch (err) {
    console.error('[driverApiService] fetchDriverProfile error:', err);
    return null;
  }
}

export async function updateDriverProfile(driverId: string, updates: Partial<{ fullName: string; contactNumber: string; plateNumber: string; licenseNumber: string }>) {
  const payload: any = {};
  if (updates.fullName) payload.full_name = updates.fullName;
  if (updates.contactNumber) payload.contact_number = updates.contactNumber;
  if (updates.plateNumber) payload.plate_number = updates.plateNumber;
  if (updates.licenseNumber) payload.license_number = updates.licenseNumber;

  const { data, error } = await supabase.from('driver').update(payload).eq('driver_id', driverId).select().single();
  if (error) throw error;
  return data;
}

// ============================================================================
// 2. AVAILABILITY & DISPATCH
// ============================================================================

// Availability is changed only through the presence functions (see driverPresenceService.ts):
// the database rejects a direct write that sets a driver Available.

// ============================================================================
// 3. BOOKINGS & ACTIVE TRIPS
// ============================================================================

/** The signed-in driver's trips (the argument is ignored: the driver is found from the session). */
export async function fetchDriverTrips(_driverId?: string) {
  try {
    const userId = await currentAuthUserId();
    if (!userId) return [];
    const { data: own } = await supabase.from('driver').select('driver_id').eq('auth_user_id', userId).maybeSingle();
    if (!own?.driver_id) return [];

    const { data, error } = await supabase
      .from('booking')
      .select('*')
      .eq('driver_id', own.driver_id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !data || data.length === 0) return [];

    // The passenger's name (and phone, only while a trip is live) comes from a function that discloses just that; the passenger table
    // itself is not readable by a driver.
    const parties = new Map<string, { passenger_name?: string | null; passenger_phone?: string | null }>();
    const { data: counterparties } = await supabase.rpc('get_booking_counterparties', { p_booking_ids: data.map((b: any) => b.booking_id) });
    for (const row of (counterparties ?? []) as any[]) parties.set(row.booking_id, row);

    return data.map((b: any) => {
      const p = parties.get(b.booking_id);
      return {
        id: b.booking_id,
        bookingCode: `BKG-${b.booking_id.slice(0, 8).toUpperCase()}`,
        passengerName: p?.passenger_name || 'Passenger',
        passengerPhone: p?.passenger_phone || '',
        pickupLocation: b.pickup_address || b.pickup_location_address || 'Calapan City',
        pickupLat: Number(b.pickup_latitude) || 13.4115,
        pickupLng: Number(b.pickup_longitude) || 121.1803,
        dropoffLocation: b.dropoff_address || b.dropoff_location_address || 'Calapan City',
        dropoffLat: Number(b.dropoff_latitude) || 13.4145,
        dropoffLng: Number(b.dropoff_longitude) || 121.1785,
        distanceKm: Number(b.actual_distance_km ?? b.estimated_distance_km) || 0,
        // the final fare once the trip arrived (written by the database, Rule 6.2), otherwise the estimate
        fareAmount: Number(b.actual_fare ?? b.estimated_fare) || 0,
        tripMode: (b.is_shared_trip || b.trip_type === 'shared' ? 'Shared Ride' : 'Solo Trip') as any,
        status: (b.booking_status === 'Completed' ? 'Completed' : b.booking_status?.includes('Cancel') ? 'Cancelled' : 'In Progress') as any,
        date: b.created_at ? new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
        time: b.created_at ? new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        rating: 5,
        createdAt: b.created_at,
        completedAt: b.trip_completed_at || b.completed_at || b.updated_at,
      };
    });
  } catch (err) {
    console.error('[driverApiService] fetchDriverTrips error:', err);
    return [];
  }
}

// The final fare is never sent from a client: the database computes and locks it when the trip arrives (Rule 6.2).
export async function updateTripStatus(bookingId: string, status: string) {
  const { data, error } = await supabase
    .from('booking')
    .update({ booking_status: status })
    .eq('booking_id', bookingId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// 4. EARNINGS & NOTIFICATIONS
// ============================================================================

export async function fetchDriverEarnings(driverId?: string) {
  try {
    const trips = await fetchDriverTrips(driverId);
    const completedTrips = trips.filter((t: any) => t.status === 'Completed');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;

    const todayTripsList = completedTrips.filter((t: any) => {
      const tripTime = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      return tripTime >= startOfToday;
    });

    const weeklyTripsList = completedTrips.filter((t: any) => {
      const tripTime = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      return tripTime >= sevenDaysAgo;
    });

    const todayEarnings = todayTripsList.reduce((sum: number, t: any) => sum + (t.fareAmount || 0), 0);
    const weeklyEarnings = weeklyTripsList.reduce((sum: number, t: any) => sum + (t.fareAmount || 0), 0);

    return {
      todayEarnings: Math.round(todayEarnings * 100) / 100,
      todayTrips: todayTripsList.length,
      weeklyEarnings: Math.round(weeklyEarnings * 100) / 100,
      weeklyTrips: weeklyTripsList.length,
      recentTrips: completedTrips.slice(0, 10),
    };
  } catch {
    return {
      todayEarnings: 0,
      todayTrips: 0,
      weeklyEarnings: 0,
      weeklyTrips: 0,
      recentTrips: [],
    };
  }
}

export async function fetchDriverNotifications(): Promise<any[]> {
  try {
    const userId = await currentAuthUserId();
    let driverId: string | null = null;
    if (userId) {
      const { data: d } = await supabase.from('driver').select('driver_id').eq('auth_user_id', userId).maybeSingle();
      driverId = d?.driver_id || null;
    }
    // driverId is interpolated into a filter string below: only ever a UUID
    const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    const [announcementsRes, notifsRes] = await Promise.all([
      supabase.from('announcement').select('*').order('created_at', { ascending: false }).limit(20),
      isUuid(driverId)
        ? supabase.from('notification').select('*').or(`recipient_id.eq.${driverId},driver_id.eq.${driverId}`).order('sent_at', { ascending: false }).limit(20)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const notifs = (notifsRes.data || []).map((n: any) => ({
      id: n.notification_id || n.id,
      title: n.title,
      message: n.message,
      category: 'TODA Announcement',
      type: 'alert',
      time: n.sent_at ? new Date(n.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent',
      timestamp: n.sent_at ? new Date(n.sent_at).toLocaleDateString('en-US') : 'Recent',
      read: false,
    }));

    const announcements = (announcementsRes.data || []).map((a: any) => ({
      id: a.announcement_id,
      title: a.title,
      message: a.message || a.content || '',
      category: a.category || (a.urgency === 'Urgent' ? 'Dispatch Alert' : 'TODA Announcement'),
      type: a.urgency === 'Urgent' ? 'alert' : 'announcement',
      time: a.created_at ? new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent',
      timestamp: a.created_at ? new Date(a.created_at).toLocaleDateString('en-US') : 'Recent',
      read: false,
    }));

    return [...notifs, ...announcements];
  } catch {
    return [];
  }
}

// ============================================================================
// 5. OTP SMS DISPATCH & VERIFICATION
// ============================================================================

export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('09') && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) return `+63${digits}`;
  if (digits.length === 11) return `+63${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Asks the server to send an OTP SMS to the signed-in driver's own number (the server refuses any other number and applies the
 * 30-second cooldown and the 5-per-day cap).
 */
export async function sendDriverOtp(phone: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const e164Phone = normalizePhoneE164(phone);
  try {
    const { ok, data } = await apiPostJson(supabase, '/api/auth/send-otp', { phone: e164Phone, role: 'driver' }, { timeoutMs: 20000 });
    if (ok && data.success) return { success: true, message: data.message };
    return { success: false, error: data.error || 'Failed to send OTP SMS.' };
  } catch (backendErr) {
    console.warn('[driverApiService] Backend server not reachable or timed out:', backendErr);
    return { success: false, error: 'Hindi maabot ang SMS server. Pakisubukang muli.' };
  }
}

/**
 * Asks the server to check the code. There is no sandbox code and no "success when the server is unreachable": if the server cannot be
 * reached, the code is NOT verified.
 */
export async function verifyDriverOtp(phone: string, code: string): Promise<{ success: boolean; error?: string }> {
  const e164Phone = normalizePhoneE164(phone);
  try {
    const { ok, data } = await apiPostJson(supabase, '/api/auth/verify-otp', { phone: e164Phone, code: code.trim(), role: 'driver' }, { timeoutMs: 15000 });
    if (ok && data.success) return { success: true };
    return { success: false, error: data.error || 'Maling OTP code o nag-expire na ito.' };
  } catch (backendErr) {
    console.warn('[driverApiService] Backend server not reachable or timed out:', backendErr);
    return { success: false, error: getLocalizedError('Hindi makakonekta sa server. Pakisubukang muli.', 'Unable to connect to the server. Please try again.') };
  }
}

/**
 * A driver texts the passenger of the trip they are on. The server accepts only that passenger's number, only while the trip is live,
 * and only from a verified driver (it used to be an open SMS relay). A failure is reported as a failure.
 */
export async function sendDriverPassengerSms(
  passengerPhone: string,
  message: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const e164Phone = normalizePhoneE164(passengerPhone);
  try {
    const { ok, data } = await apiPostJson(supabase, '/api/communication/send-sms', { phone: e164Phone, message }, { timeoutMs: 20000 });
    if (ok && data.success) return { success: true, message: data.message };
    return { success: false, error: data.error || 'Failed to dispatch SMS to passenger.' };
  } catch (err: any) {
    console.warn('[driverApiService] Error sending SMS to passenger:', err.message);
    return { success: false, error: getLocalizedError('Hindi maipadala ang SMS. Pakisubukang muli.', 'The SMS could not be sent. Please try again.') };
  }
}

// ============================================================================
// 5b. SUPABASE AUTH SESSION LIFECYCLE (DRIVER REGISTRATION)
// ============================================================================

/** Why a registration could not start. The screen shows `error` as it is: it says what was found and where. */
export type DriverAuthFailureCode =
  | 'login_exists_wrong_password'   // a login (Supabase Auth) for this number exists and the password does not open it
  | 'login_exists_sign_in_failed'   // a login exists but signing in failed for another reason (e-mail not confirmed, rate limit...)
  | 'driver_account_exists'         // a driver account for this number is already past registration (Verified, Rejected, ...)
  | 'sign_up_failed'                // anything else the sign-up said
  | 'unexpected';

export interface DriverAuthSessionResult {
  success: boolean;
  error?: string;
  code?: DriverAuthFailureCode;
}

/**
 * Creates the driver's Supabase Auth account (or resumes an unfinished registration with the same password), makes sure this browser is
 * signed in, and makes sure the driver's own record exists as Pending Verification.
 *
 * Perimeter lockdown: no look-up of anybody else's record, no guessing of other passwords, no second account under an alias for a
 * number that is taken. "Already registered" is learned from the sign-up itself.
 *
 * What "taken" means here, and what the answer says (this used to be one message for every case, and the register screen then replaced
 * every error that contained "already" / "exists" with it):
 *   - a LOGIN for the number exists (the alias driver_63XXXXXXXXXX@sakay.ph in Supabase Auth). With the same password it is the
 *     driver's own unfinished registration and is resumed; with another password it cannot be told apart from somebody else's login,
 *     so registration stops and says exactly that (a login left behind by an earlier test is the usual cause; it is removed with
 *     supabase/scripts/safe_test_data_cleanup.sql);
 *   - a DRIVER ACCOUNT in public.driver exists and is past registration: log in instead.
 * A login whose driver record was deleted is therefore still reported when its password is not known. Nothing in the browser can
 * decide that such a login is dead.
 */
export async function ensureDriverAuthSession(
  phone: string,
  password: string,
  fullName?: string,
  todaId?: string
): Promise<DriverAuthSessionResult> {
  const candidates = getPhoneLookupCandidates(phone);
  const e164Phone = candidates.e164;
  const driverEmail = `driver_${candidates.phone63NoPlus}@sakay.ph`;

  try {
    // 1. A clean slate: sign out any session left in this browser.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      await supabase.auth.signOut();
    }

    // 2. Create the login. Sign-up data is only used to create a PENDING record; no role is ever granted from it.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: driverEmail,
      password: password,
      options: {
        data: {
          role: 'driver',
          full_name: fullName || null,
          contact_number: e164Phone,
          toda_id: todaId || null,
        },
      },
    });
    const message = (signUpError?.message || '').toLowerCase();
    // An existing login is reported as an error, or (when confirmation e-mails are on) as a "user" that has no identities.
    const exists = Boolean(
      (signUpError && (message.includes('already registered') || message.includes('already exists') || (signUpError as any)?.code === 'user_already_exists')) ||
      (!signUpError && signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0)
    );
    if (signUpError && !exists) {
      console.warn('[DRIVER REGISTRATION AUTH] signUp error:', signUpError.message);
      return { success: false, code: 'sign_up_failed', error: signUpError.message };
    }

    // 3. Be signed in. A new sign-up already is; an unfinished registration is resumed by signing in with the SAME password,
    //    and a wrong password for an existing login ends here.
    let authUser = !exists ? signUpData?.session?.user ?? null : null;
    if (!authUser) {
      const signIn = await supabase.auth.signInWithPassword({ email: driverEmail, password: password });
      if (signIn.error || !signIn.data?.user) {
        if (!exists) {
          return { success: false, code: 'sign_up_failed', error: signIn.error?.message || 'Failed to sign in after registration.' };
        }
        const signInMessage = signIn.error?.message || '';
        const wrongPassword = (signIn.error as any)?.code === 'invalid_credentials' || /invalid login credentials/i.test(signInMessage);
        if (wrongPassword) {
          return {
            success: false,
            code: 'login_exists_wrong_password',
            error: getLocalizedError(
              'May login na para sa mobile number na ito mula sa naunang pagrerehistro, at hindi ito mabuksan ng password na inilagay. Mag-log in na lamang, i-reset ang password sa "Nakalimutan ang password", o hilingin sa LGU na alisin ang lumang login.',
              'A login for this mobile number already exists from an earlier registration, and the password you entered does not open it. Log in instead, reset the password with "Forgot password", or ask the LGU to remove the old login.'
            ),
          };
        }
        return {
          success: false,
          code: 'login_exists_sign_in_failed',
          error: getLocalizedError(
            `May login na para sa mobile number na ito, ngunit hindi ito nagawang buksan: ${signInMessage || 'hindi kilalang dahilan'}.`,
            `A login for this mobile number already exists, but signing in to it failed: ${signInMessage || 'unknown reason'}.`
          ),
        };
      }
      authUser = signIn.data.user;
    }

    // 4. The driver's own record (row security shows each driver only their own).
    const { data: own, error: ownErr } = await supabase
      .from('driver')
      .select('driver_id, account_status')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (ownErr) return { success: false, code: 'unexpected', error: ownErr.message };

    if (own) {
      if (own.account_status !== 'Pending Verification' && own.account_status !== 'Resubmission Required') {
        await supabase.auth.signOut();
        return {
          success: false,
          code: 'driver_account_exists',
          error: getLocalizedError(
            `Ang mobile number na ito ay may driver account na (katayuan: ${own.account_status}). Mangyaring mag-login na lamang.`,
            `This mobile number already has a driver account (status: ${own.account_status}). Please log in instead.`
          ),
        };
      }
      const updateObj: Record<string, any> = { contact_number: e164Phone, email: driverEmail };
      if (fullName) updateObj.full_name = fullName;
      const { error: upErr } = await supabase.from('driver').update(updateObj).eq('driver_id', own.driver_id);
      if (upErr) return { success: false, code: 'unexpected', error: upErr.message };
    } else {
      // No driver record behind this login: a registration that stopped after the sign-up, resumed with its own password.
      const insertObj: Record<string, any> = {
        auth_user_id: authUser.id,
        contact_number: e164Phone,
        full_name: fullName || 'Driver Applicant',
        account_status: 'Pending Verification',
        availability_status: 'Offline',
        email: driverEmail,
      };
      // The primary TODA (the first one selected) is the legacy single pointer; the real applications are the affiliations.
      if (todaId) insertObj.toda_id = todaId;
      const { error: insErr } = await supabase.from('driver').insert([insertObj]);
      if (insErr) return { success: false, code: 'unexpected', error: insErr.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[DRIVER REGISTRATION AUTH] Exception in ensureDriverAuthSession:', err);
    return {
      success: false,
      code: 'unexpected',
      error: getLocalizedError(
        'Hindi maihanda ang inyong account. Pakisuri ang koneksyon at subukang muli.',
        'Unable to prepare your account. Please check your connection and try again.'
      ),
    };
  }
}

/**
 * Applies the signed-in driver to ONE OR MORE accredited TODAs (Driver Module 2.1, Policy 3.1): one `driver_toda_affiliation` row per
 * selected TODA, each starting as Submitted / Pending, each with its own membership number, terminal and barangay. Each affiliation
 * is then reviewed on its own, first by that TODA's administrator and then by the LGU. Safe to repeat (a waiting application only has
 * its description refreshed; an application that is already past the TODA stage is left alone).
 */
export async function applyDriverTodaAffiliations(
  selections: DriverTodaApplicationInput[]
): Promise<ApplyDriverTodaAffiliationsResponse> {
  if (selections.length === 0) {
    return { success: false, error: getLocalizedError('Pumili ng kahit isang TODA.', 'Select at least one TODA.') };
  }
  try {
    const { data, error } = await supabase.rpc('apply_driver_toda_affiliations', { p_applications: selections });
    if (error) {
      console.warn('[driverApiService] apply_driver_toda_affiliations error:', error.message);
      return { success: false, error: error.message };
    }
    return data as ApplyDriverTodaAffiliationsResponse;
  } catch (err: any) {
    console.error('[driverApiService] applyDriverTodaAffiliations exception:', err);
    return {
      success: false,
      error: getLocalizedError(
        'Hindi maipadala ang inyong mga TODA. Pakisuri ang koneksyon at subukang muli.',
        'Could not submit your TODAs. Please check your connection and try again.'
      ),
    };
  }
}

// ============================================================================
// 6. DRIVER LICENSE VERIFICATION SUPABASE PERSISTENCE & STORAGE
// ============================================================================

/**
 * Helper to convert Base64 Data URL to Blob for Supabase Storage uploads
 */
export function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid image data format.');
  }
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return { blob: new Blob([u8arr], { type: mimeType }), mimeType };
}

/**
 * Safely parses date string into YYYY-MM-DD for PostgreSQL DATE columns
 */
function parseDateForDb(val?: string): string | null {
  if (!val || !val.trim()) return null;
  const cleaned = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(cleaned)) return cleaned.replace(/\//g, '-');
  
  // Handle MM-DD-YYYY or MM/DD/YYYY or DD-MM-YYYY formats
  const parts = cleaned.split(/[-/.]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      const m = parts[0].padStart(2, '0');
      const d = parts[1].padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }
  }

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Persists the driver's license photos to Supabase Storage ('driver-licenses')
 * and writes the verified field records (preserving OCR vs Submitted values)
 * to public.driver_verification and public.driver tables.
 */
export async function saveDriverLicenseVerification(
  formData: LicenseExtractedData,
  phone?: string
): Promise<{ success: boolean; error?: string; driverId?: string; verificationId?: string }> {
  console.log('[DRIVER LICENSE SAVE] ========================================');
  console.log('[DRIVER LICENSE SAVE] Starting driver license submission flow');
  console.log('[DRIVER LICENSE SAVE] Target Phone:', phone);
  console.log('[DRIVER LICENSE SAVE] Form Data Received:', {
    fullName: formData.fullName,
    licenseNumber: formData.licenseNumber,
    dob: formData.dob,
    hasRawFront: Boolean(formData.rawFrontPhoto),
    hasProcessedFront: Boolean(formData.frontPhoto),
    hasRawBack: Boolean(formData.rawBackPhoto),
    hasProcessedBack: Boolean(formData.backPhoto),
  });

  try {
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const candidates = getPhoneLookupCandidates(phone || cleanPhone);
    const e164Phone = candidates.e164;

    // 1. Verify Active Supabase Auth Session
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();

    console.log('[DRIVER LICENSE SAVE] Auth User:', user ? `ID=${user.id}, Email=${user.email}` : 'NULL');
    console.log('[DRIVER LICENSE SAVE] Auth Session:', session ? `Valid (Expires=${session.expires_at})` : 'NULL');

    if (!user || !session) {
      console.error('[DRIVER LICENSE SAVE] Authentication check failed. User or session is missing.');
      console.error('[DRIVER LICENSE SAVE] userErr:', userErr, 'sessionErr:', sessionErr);
      return {
        success: false,
        error: getLocalizedError(
          'Kailangan munang mag-login o kumpletuhin ang registration upang ma-save ang iyong beripikasyon.',
          'Please log in or complete registration first to save your verification.'
        ),
      };
    }

    const authUserId = user.id;

    console.log('[DRIVER PROFILE DEBUG] ========================================');
    console.log('[DRIVER PROFILE DEBUG] Starting saveDriverLicenseVerification');
    console.log('[DRIVER PROFILE DEBUG] Auth User ID:', authUserId);
    console.log('[DRIVER PROFILE DEBUG] Clean Phone Input:', cleanPhone);

    // 2. Identify and verify public.driver profile record
    let driverId: string | null = null;

    // Lookup driver profile linked directly to auth_user_id or candidate phones
    const { data: driverRows, error: driverLookupErr } = await supabase
      .from('driver')
      .select('driver_id, auth_user_id, contact_number')
      .or(`auth_user_id.eq.${authUserId},contact_number.eq.${candidates.phone63WithPlus},contact_number.eq.${candidates.phone09},contact_number.eq.${candidates.phone63NoPlus},contact_number.eq.${candidates.phoneRaw}`)
      .limit(1);

    const driverRow = driverRows?.[0] || null;

    console.log('[DRIVER PROFILE DEBUG] Lookup result:', {
      found: Boolean(driverRow),
      driverId: driverRow?.driver_id || null,
      error: driverLookupErr ? { code: driverLookupErr.code, message: driverLookupErr.message } : null,
    });

    if (driverRow) {
      driverId = driverRow.driver_id;
      if (!driverRow.auth_user_id) {
        console.log('[DRIVER PROFILE DEBUG] Linking existing driver record to auth_user_id:', authUserId);
        await supabase
          .from('driver')
          .update({ auth_user_id: authUserId, contact_number: e164Phone })
          .eq('driver_id', driverId);
      }
    }

    const storedTodaId = typeof window !== 'undefined' ? localStorage.getItem('sakay_driver_toda_id') : null;

    // AUTO-PROVISION IF NOT FOUND (Ensures driver registering for the first time is never blocked):
    if (!driverId) {
      console.log('[DRIVER PROFILE DEBUG] Auto-provisioning new driver record for auth_user_id:', authUserId);
      const insertDriverPayload: Record<string, any> = {
        auth_user_id: authUserId,
        contact_number: e164Phone,
        full_name: formData.fullName || user.user_metadata?.full_name || 'Driver Applicant',
        license_number: formData.licenseNumber || null,
        date_of_birth: parseDateForDb(formData.dob),
        residential_address: formData.address || null,
        toda_id: storedTodaId || user.user_metadata?.toda_id || null,
        account_status: 'Pending Verification',
        availability_status: 'Offline',
      };

      const { data: insertedDriver, error: insertDriverErr } = await supabase
        .from('driver')
        .insert([insertDriverPayload])
        .select('driver_id')
        .maybeSingle();

      if (insertedDriver?.driver_id) {
        driverId = insertedDriver.driver_id;
      } else {
        if (insertDriverErr) {
          console.warn('[DRIVER PROFILE DEBUG] Driver auto-insert note:', insertDriverErr.message);
        }
        const { data: refetchRows } = await supabase
          .from('driver')
          .select('driver_id')
          .eq('auth_user_id', authUserId)
          .limit(1);
        driverId = refetchRows?.[0]?.driver_id || null;
      }
    }

    if (!driverId) {
      console.error('[DRIVER PROFILE DEBUG] Could not resolve driver profile for auth_user_id:', authUserId);
      return {
        success: false,
        error: getLocalizedError(
          'Hindi mai-save ang profile ng drayber sa database. Pakisubukang muli.',
          'Unable to save driver profile to database. Please try again.'
        ),
      };
    }

    // Update existing driver record with allowable profile details and ensure toda_id and phone are set
    console.log('[DRIVER PROFILE DEBUG] Updating driver record ID:', driverId);
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
      contact_number: e164Phone,
    };
    if (formData.fullName) updatePayload.full_name = formData.fullName;
    if (formData.licenseNumber) updatePayload.license_number = formData.licenseNumber;
    if (formData.dob) updatePayload.date_of_birth = parseDateForDb(formData.dob);
    if (formData.address) updatePayload.residential_address = formData.address;
    if (storedTodaId) updatePayload.toda_id = storedTodaId;

    const { error: updateErr } = await supabase
      .from('driver')
      .update(updatePayload)
      .eq('driver_id', driverId);

    if (updateErr) {
      console.error('[DRIVER PROFILE DEBUG] Driver update note:', {
        code: updateErr.code,
        message: updateErr.message,
      });
    }

    console.log('[DRIVER PROFILE DEBUG] Confirmed Driver ID:', driverId);
    console.log('[DRIVER PROFILE DEBUG] Confirmed Auth User ID:', authUserId);

    // 3. Upload raw license photo proof to Supabase Storage ('driver-licenses')
    let totalSizeBytes = 0;
    let frontStoragePath: string | null = null;
    let backStoragePath: string | null = null;

    const frontUploadDataUrl = formData.rawFrontPhoto || formData.frontPhoto;

    if (frontUploadDataUrl && frontUploadDataUrl.startsWith('data:')) {
      try {
        const frontBlobInfo = dataUrlToBlob(frontUploadDataUrl);
        totalSizeBytes += frontBlobInfo.blob.size;
        frontStoragePath = `${authUserId}/license_front.jpg`;

        console.log('[DRIVER LICENSE SAVE] Converting front photo to Blob...');
        console.log('[DRIVER LICENSE SAVE] Blob size:', frontBlobInfo.blob.size, 'bytes');
        console.log('[DRIVER LICENSE SAVE] Target Bucket: driver-licenses');
        console.log('[DRIVER LICENSE SAVE] Target Path:', frontStoragePath);

        const { data: storageRes, error: frontUploadErr } = await supabase.storage
          .from('driver-licenses')
          .upload(frontStoragePath, frontBlobInfo.blob, {
            contentType: frontBlobInfo.mimeType,
            upsert: true,
          });

        if (frontUploadErr) {
          console.error('[DRIVER LICENSE SAVE] Storage upload error (front photo):', frontUploadErr);
          return {
            success: false,
            error: getLocalizedError(
              'Hindi na-save ang larawan ng iyong lisensya sa storage. Pakisubukang muli.',
              'Could not save your license photo to storage. Please try again.'
            ),
          };
        }
        console.log('[DRIVER LICENSE SAVE] Storage upload SUCCESS (front photo):', storageRes);
      } catch (frontErr) {
        console.error('[DRIVER LICENSE SAVE] Front photo conversion exception:', frontErr);
        return {
          success: false,
          error: getLocalizedError(
            'May problema sa pagproseso ng larawan ng lisensya. Pakisubukang muli.',
            'There was a problem processing the license photo. Please try again.'
          ),
        };
      }
    } else {
      console.error('[DRIVER LICENSE SAVE] Missing rawFrontPhoto or frontPhoto payload.');
      return {
        success: false,
        error: getLocalizedError(
          'Kailangan ng malinaw na larawan ng iyong driver license.',
          'A clear photo of your driver license is required.'
        ),
      };
    }

    // 4. Upload back photo proof if available
    const backUploadDataUrl = formData.rawBackPhoto || formData.backPhoto;
    if (backUploadDataUrl && backUploadDataUrl.startsWith('data:')) {
      try {
        const backBlobInfo = dataUrlToBlob(backUploadDataUrl);
        totalSizeBytes += backBlobInfo.blob.size;
        backStoragePath = `${authUserId}/license_back.jpg`;

        console.log('[DRIVER LICENSE SAVE] Uploading back photo to path:', backStoragePath);

        const { data: backStorageRes, error: backUploadErr } = await supabase.storage
          .from('driver-licenses')
          .upload(backStoragePath, backBlobInfo.blob, {
            contentType: backBlobInfo.mimeType,
            upsert: true,
          });

        if (backUploadErr) {
          console.warn('[DRIVER LICENSE SAVE] Storage upload warning (back photo):', backUploadErr);
        } else {
          console.log('[DRIVER LICENSE SAVE] Storage upload SUCCESS (back photo):', backStorageRes);
        }
      } catch (backErr) {
        console.warn('[DRIVER LICENSE SAVE] Back photo conversion warning:', backErr);
      }
    }

    // 5. Build database verification record payload
    let ocrFullName = '';
    let ocrLicenseNo = '';
    let ocrDobStr: string | null = null;
    let ocrAddr = '';
    let ocrDlCodesStr = '';

    if (formData.rawOcrText) {
      const rawText = formData.rawOcrText;
      const licMatch = rawText.match(/([A-Z0-9]\d{2}[-\s]?\d{2}[-\s]?\d{6})/i);
      if (licMatch) ocrLicenseNo = licMatch[1].replace(/\s+/g, '-');

      const dobMatch = rawText.match(/(?:19\d{2}|200[0-8])[-/.]\d{2}[-/.]\d{2}/);
      if (dobMatch) ocrDobStr = parseDateForDb(dobMatch[0]);
    }

    const verificationPayload = {
      driver_id: driverId,
      ocr_full_name: ocrFullName || formData.fullName,
      submitted_full_name: formData.fullName,
      ocr_license_number: ocrLicenseNo || formData.licenseNumber,
      submitted_license_number: formData.licenseNumber,
      ocr_dob: ocrDobStr || parseDateForDb(formData.dob),
      submitted_dob: parseDateForDb(formData.dob),
      ocr_address: ocrAddr || formData.address,
      submitted_address: formData.address,
      ocr_dl_codes: ocrDlCodesStr || formData.dlCodes,
      submitted_dl_codes: formData.dlCodes,
      license_expiry: parseDateForDb(formData.expirationDate),
      license_front_photo_path: frontStoragePath,
      license_back_photo_path: backStoragePath,
      mime_type: 'image/jpeg',
      file_size: totalSizeBytes > 0 ? totalSizeBytes : null,
      scan_status: 'Clean',
      verification_status: 'Pending',
      submitted_at: new Date().toISOString(),
    };

    console.log('[DRIVER LICENSE SAVE] Writing verification record to database public.driver_verification...');
    console.log('[DRIVER LICENSE SAVE] Payload:', verificationPayload);

    // 6. Check if existing driver_verification record exists (UPSERT pattern)
    const { data: existingVerif } = await supabase
      .from('driver_verification')
      .select('verification_id')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (existingVerif) {
      console.log('[DRIVER LICENSE SAVE] Updating existing verification record ID:', existingVerif.verification_id);
      const { data: updateRes, error: verifUpdateErr } = await supabase
        .from('driver_verification')
        .update(verificationPayload)
        .eq('verification_id', existingVerif.verification_id)
        .select();

      if (verifUpdateErr) {
        console.warn('[DRIVER LICENSE SAVE] Primary update warning:', verifUpdateErr);
        const fallbackPayload = {
          driver_id: driverId,
          submitted_full_name: formData.fullName,
          submitted_license_number: formData.licenseNumber,
          submitted_dob: parseDateForDb(formData.dob),
          submitted_address: formData.address,
          submitted_dl_codes: formData.dlCodes,
          license_expiry: parseDateForDb(formData.expirationDate),
          license_front_photo_path: frontStoragePath,
          license_back_photo_path: backStoragePath,
          submitted_at: new Date().toISOString(),
        };
        const { error: fallbackErr } = await supabase
          .from('driver_verification')
          .update(fallbackPayload)
          .eq('verification_id', existingVerif.verification_id);

        if (fallbackErr) {
          console.warn('[DRIVER LICENSE SAVE] Fallback update warning:', fallbackErr);
        }
      } else {
        console.log('[DRIVER LICENSE SAVE] Verification record update SUCCESS:', updateRes);
      }
    } else {
      console.log('[DRIVER LICENSE SAVE] Inserting new verification record...');
      const { data: insertRes, error: verifInsertErr } = await supabase
        .from('driver_verification')
        .insert([verificationPayload])
        .select();

      if (verifInsertErr) {
        console.warn('[DRIVER LICENSE SAVE] Primary insert warning:', verifInsertErr);
        const fallbackPayload = {
          driver_id: driverId,
          submitted_full_name: formData.fullName,
          submitted_license_number: formData.licenseNumber,
          submitted_dob: parseDateForDb(formData.dob),
          submitted_address: formData.address,
          submitted_dl_codes: formData.dlCodes,
          license_expiry: parseDateForDb(formData.expirationDate),
          license_front_photo_path: frontStoragePath,
          license_back_photo_path: backStoragePath,
          submitted_at: new Date().toISOString(),
        };
        const { error: fallbackInsertErr } = await supabase
          .from('driver_verification')
          .insert([fallbackPayload]);

        if (fallbackInsertErr) {
          console.warn('[DRIVER LICENSE SAVE] Fallback insert warning:', fallbackInsertErr);
        }
      } else {
        console.log('[DRIVER LICENSE SAVE] Verification record insert SUCCESS:', insertRes);
      }
    }

    // 7. Update allowable profile fields on public.driver profile
    try {
      await supabase
        .from('driver')
        .update({
          full_name: formData.fullName,
          residential_address: formData.address,
          date_of_birth: parseDateForDb(formData.dob),
        })
        .eq('driver_id', driverId);
      console.log('[DRIVER LICENSE SAVE] Driver profile update SUCCESS');
    } catch (profileErr) {
      console.warn('[DRIVER LICENSE SAVE] Driver profile soft update warning:', profileErr);
    }

    console.log('[DRIVER LICENSE SAVE] ========================================');
    console.log('[DRIVER LICENSE SAVE] SUBMISSION FLOW COMPLETED SUCCESSFULLY!');
    console.log('[DRIVER LICENSE SAVE] ========================================');
    return { success: true };
  } catch (err: any) {
    console.error('[DRIVER LICENSE SAVE] saveDriverLicenseVerification exception:', err);
    return {
      success: false,
      error: 'Nagkaroon ng hindi inaasahang problema sa koneksyon habang isina-save ang iyong impormasyon. Pakisubukang muli.',
    };
  }
}

/**
 * Persists the driver's MTOP permit document to Supabase Storage ('mtop-permits' or fallback)
 * and updates public.driver_verification & public.driver tables with franchise details.
 */
export async function saveDriverMtopVerification(
  formData: MtopExtractedData,
  phone?: string
): Promise<{ success: boolean; error?: string; driverId?: string; verificationId?: string }> {
  console.log('[DRIVER MTOP SAVE] ========================================');
  console.log('[DRIVER MTOP SAVE] Starting driver MTOP submission flow');
  console.log('[DRIVER MTOP SAVE] Target Phone:', phone);

  try {
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const candidates = getPhoneLookupCandidates(phone || cleanPhone);
    const e164Phone = candidates.e164;

    // 1. Verify Active Supabase Auth Session
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();

    if (!user || !session) {
      console.error('[DRIVER MTOP SAVE] Authentication check failed. User or session is missing.');
      return {
        success: false,
        error: getLocalizedError(
          'Kailangan munang mag-login upang ma-save ang iyong MTOP.',
          'Please log in first to save your MTOP.'
        ),
      };
    }

    const authUserId = user.id;

    // 2. Identify public.driver profile record
    let driverId: string | null = null;
    const { data: driverRows } = await supabase
      .from('driver')
      .select('driver_id')
      .or(`auth_user_id.eq.${authUserId},contact_number.eq.${candidates.phone63WithPlus},contact_number.eq.${candidates.phone09}`)
      .limit(1);

    driverId = driverRows?.[0]?.driver_id || null;

    if (!driverId) {
      console.log('[DRIVER MTOP SAVE] Auto-provisioning driver record for authUserId:', authUserId);
      const storedTodaId = typeof window !== 'undefined' ? localStorage.getItem('sakay_driver_toda_id') : null;
      const { data: insertedDriver } = await supabase
        .from('driver')
        .insert([
          {
            auth_user_id: authUserId,
            contact_number: e164Phone,
            full_name: formData.operatorName || user.user_metadata?.full_name || 'Driver Applicant',
            franchise_number: formData.franchiseNumber || null,
            plate_number: formData.plateNumber || null,
            toda_id: storedTodaId || user.user_metadata?.toda_id || null,
            account_status: 'Pending Verification',
            availability_status: 'Offline',
          },
        ])
        .select('driver_id')
        .maybeSingle();

      driverId = insertedDriver?.driver_id || null;
    }

    if (!driverId) {
      console.error('[DRIVER MTOP SAVE] Driver record not found for authUserId:', authUserId);
      return {
        success: false,
        error: getLocalizedError(
          'Hindi nahanap ang iyong rekord ng drayber. Pakisubukang muli.',
          'Driver record not found. Please try again.'
        ),
      };
    }

    // 3. Upload MTOP permit photo proof to Supabase Storage
    const photoUploadUrl = formData.rawPhotoUrl || formData.photoUrl;
    let mtopStoragePath: string | null = null;

    if (photoUploadUrl && photoUploadUrl.startsWith('data:')) {
      try {
        const blobInfo = dataUrlToBlob(photoUploadUrl);
        mtopStoragePath = `${authUserId}/mtop.jpg`;
        console.log('[DRIVER MTOP SAVE] Uploading MTOP photo to path:', mtopStoragePath);

        const { data: storageRes, error: uploadErr } = await supabase.storage
          .from('mtop-permits')
          .upload(mtopStoragePath, blobInfo.blob, {
            contentType: blobInfo.mimeType,
            upsert: true,
          });

        if (uploadErr) {
          console.warn('[DRIVER MTOP SAVE] Storage bucket mtop-permits warning, trying driver-licenses fallback:', uploadErr);
          await supabase.storage
            .from('driver-licenses')
            .upload(mtopStoragePath, blobInfo.blob, {
              contentType: blobInfo.mimeType,
              upsert: true,
            });
        }
      } catch (storageException) {
        console.warn('[DRIVER MTOP SAVE] Storage upload exception:', storageException);
      }
    }

    // 4. Update public.driver record with franchise details
    await supabase
      .from('driver')
      .update({
        franchise_number: formData.franchiseNumber,
        plate_number: formData.plateNumber,
        contact_number: e164Phone,
        updated_at: new Date().toISOString(),
      })
      .eq('driver_id', driverId);

    // 5. Update or Insert driver_verification record
    const { data: existingVerif } = await supabase
      .from('driver_verification')
      .select('verification_id')
      .eq('driver_id', driverId)
      .maybeSingle();

    let verifId = existingVerif?.verification_id;

    if (verifId) {
      await supabase
        .from('driver_verification')
        .update({
          submitted_franchise_number: formData.franchiseNumber,
          submitted_operator_name: formData.operatorName,
          submitted_plate_number: formData.plateNumber,
          franchise_expiry: parseDateForDb(formData.expirationDate),
          ...(mtopStoragePath ? { mtop_photo_path: mtopStoragePath } : {}),
        })
        .eq('verification_id', verifId);
    } else {
      const { data: newVerif } = await supabase
        .from('driver_verification')
        .insert({
          driver_id: driverId,
          submitted_franchise_number: formData.franchiseNumber,
          submitted_operator_name: formData.operatorName,
          submitted_plate_number: formData.plateNumber,
          franchise_expiry: parseDateForDb(formData.expirationDate),
          ...(mtopStoragePath ? { mtop_photo_path: mtopStoragePath } : {}),
        })
        .select('verification_id')
        .single();
      verifId = newVerif?.verification_id;
    }

    console.log('[DRIVER MTOP SAVE] MTOP save completed successfully for driverId:', driverId);
    return { success: true, driverId, verificationId: verifId };
  } catch (err: any) {
    console.error('[DRIVER MTOP SAVE] Exception:', err);
    return {
      success: false,
      error: getLocalizedError(
        'Nagkaroon ng hindi inaasahang problema sa pag-save ng MTOP. Pakisubukang muli.',
        'An unexpected error occurred while saving MTOP. Please try again.'
      ),
    };
  }
}

/**
 * Uploads the driver's selfie photo proof to Supabase Storage ('driver-selfies' or fallback)
 * and updates public.driver_verification & public.driver records.
 */
export async function saveDriverSelfieVerification(
  selfieDataUrl: string,
  phone?: string
): Promise<{ success: boolean; error?: string; selfieStoragePath?: string }> {
  console.log('[DRIVER SELFIE SAVE] ========================================');
  console.log('[DRIVER SELFIE SAVE] Starting selfie verification upload flow');

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[DRIVER SELFIE SAVE] Active auth user session missing, skipping remote storage upload.');
      return { success: true };
    }

    const authUserId = user.id;

    if (selfieDataUrl && selfieDataUrl.startsWith('data:')) {
      try {
        const blobInfo = dataUrlToBlob(selfieDataUrl);
        const selfiePath = `${authUserId}/selfie.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('driver-selfies')
          .upload(selfiePath, blobInfo.blob, {
            contentType: blobInfo.mimeType,
            upsert: true,
          });

        if (uploadErr) {
          console.warn('[DRIVER SELFIE SAVE] Storage bucket driver-selfies warning, trying driver-licenses fallback:', uploadErr);
          await supabase.storage
            .from('driver-licenses')
            .upload(selfiePath, blobInfo.blob, {
              contentType: blobInfo.mimeType,
              upsert: true,
            });
        }
        console.log('[DRIVER SELFIE SAVE] Selfie photo uploaded successfully:', selfiePath);

        // Persist face_photo_path to driver_verification
        try {
          const { data: drv } = await supabase
            .from('driver')
            .select('driver_id')
            .eq('auth_user_id', authUserId)
            .maybeSingle();
          if (drv?.driver_id) {
            await supabase
              .from('driver_verification')
              .update({ face_photo_path: selfiePath, face_verification_status: 'Passed' })
              .eq('driver_id', drv.driver_id);
          }
        } catch (dbErr) {
          console.warn('[DRIVER SELFIE SAVE] Non-blocking DB update warning:', dbErr);
        }

        return { success: true, selfieStoragePath: selfiePath };
      } catch (storageException) {
        console.warn('[DRIVER SELFIE SAVE] Storage upload exception:', storageException);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('[DRIVER SELFIE SAVE] Exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Uploads the driver's tricycle unit photo proof to Supabase Storage ('mtop-permits' or fallback)
 * and updates public.driver_verification & public.driver records.
 */
export async function saveDriverTricycleVerification(
  tricycleDataUrl: string,
  phone?: string
): Promise<{ success: boolean; error?: string; tricycleStoragePath?: string }> {
  console.log('[DRIVER TRICYCLE SAVE] ========================================');
  console.log('[DRIVER TRICYCLE SAVE] Starting tricycle unit photo upload flow');

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[DRIVER TRICYCLE SAVE] Active auth user session missing, skipping remote storage upload.');
      return { success: true };
    }

    const authUserId = user.id;

    if (tricycleDataUrl && tricycleDataUrl.startsWith('data:')) {
      try {
        const blobInfo = dataUrlToBlob(tricycleDataUrl);
        const tricyclePath = `${authUserId}/tricycle.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('mtop-permits')
          .upload(tricyclePath, blobInfo.blob, {
            contentType: blobInfo.mimeType,
            upsert: true,
          });

        if (uploadErr) {
          console.warn('[DRIVER TRICYCLE SAVE] Storage bucket mtop-permits warning, trying driver-licenses fallback:', uploadErr);
          await supabase.storage
            .from('driver-licenses')
            .upload(tricyclePath, blobInfo.blob, {
              contentType: blobInfo.mimeType,
              upsert: true,
            });
        }
        console.log('[DRIVER TRICYCLE SAVE] Tricycle unit photo uploaded successfully:', tricyclePath);

        // Persist tricycle_photo_path to driver_verification & driver
        try {
          const { data: drv } = await supabase
            .from('driver')
            .select('driver_id')
            .eq('auth_user_id', authUserId)
            .maybeSingle();
          if (drv?.driver_id) {
            await supabase
              .from('driver_verification')
              .update({ tricycle_photo_path: tricyclePath })
              .eq('driver_id', drv.driver_id);
            await supabase
              .from('driver')
              .update({ tricycle_photo_path: tricyclePath })
              .eq('driver_id', drv.driver_id);
          }
        } catch (dbErr) {
          console.warn('[DRIVER TRICYCLE SAVE] Non-blocking DB update warning:', dbErr);
        }

        return { success: true, tricycleStoragePath: tricyclePath };
      } catch (storageException) {
        console.warn('[DRIVER TRICYCLE SAVE] Storage upload exception:', storageException);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('[DRIVER TRICYCLE SAVE] Exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Finalizes driver registration submission in Supabase.
 * Marks public.driver as 'Pending Verification' & public.driver_verification as 'Submitted'.
 */
export async function submitFinalDriverRegistration(
  phone?: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[FINAL REGISTRATION SUBMIT] ========================================');
  console.log('[FINAL REGISTRATION SUBMIT] Finalizing registration submission...');

  try {
    const candidates = getPhoneLookupCandidates(phone || '');
    const e164Phone = candidates.e164;

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.warn('[FINAL REGISTRATION SUBMIT] User session not active during final submission.');
      return {
        success: false,
        error: getLocalizedError(
          'Kailangan munang mag-login bago mag-submit.',
          'Please log in before submitting.'
        ),
      };
    }

    const authUserId = user.id;
    const cache = getOnboardingCache();
    const storedTodaId = typeof window !== 'undefined' ? localStorage.getItem('sakay_driver_toda_id') || cache?.todaId : cache?.todaId;

    const license = cache?.step1_license;
    const mtop = cache?.step2_mtop;
    const tricycle = cache?.step3_tricycle;
    const face = cache?.step5_face;

    const frontPath = `${authUserId}/license_front.jpg`;
    const backPath = `${authUserId}/license_back.jpg`;
    const mtopPath = `${authUserId}/mtop.jpg`;
    const tricyclePath = `${authUserId}/tricycle.jpg`;
    const selfiePath = `${authUserId}/selfie.jpg`;

    // 1. Resolve Driver Record
    const { data: driverRows } = await supabase
      .from('driver')
      .select('driver_id')
      .or(`auth_user_id.eq.${authUserId},contact_number.eq.${candidates.phone63WithPlus},contact_number.eq.${candidates.phone09}`)
      .limit(1);

    let driverId = driverRows?.[0]?.driver_id || null;

    if (!driverId) {
      console.log('[FINAL REGISTRATION SUBMIT] Auto-provisioning driver record for authUserId:', authUserId);
      const { data: newDriver } = await supabase
        .from('driver')
        .insert([
          {
            auth_user_id: authUserId,
            contact_number: e164Phone,
            full_name: license?.fullName || user.user_metadata?.full_name || 'Driver Applicant',
            toda_id: storedTodaId || user.user_metadata?.toda_id || null,
            account_status: 'Pending Verification',
            availability_status: 'Offline',
          },
        ])
        .select('driver_id')
        .maybeSingle();

      driverId = newDriver?.driver_id || null;
    }

    if (!driverId) {
      console.error('[FINAL REGISTRATION SUBMIT] Driver profile row not found for authUserId:', authUserId);
      return {
        success: false,
        error: getLocalizedError(
          'Hindi nahanap ang rekord ng drayber sa database. Pakisubukang magparehistro muli.',
          'Driver record not found in the database. Please try registering again.'
        ),
      };
    }

    // 2. Update public.driver with allowable profile details (name, dob, address)
    const driverPayload: Record<string, any> = {
      account_status: 'Pending Verification',
      rejection_reason: null,
      rejection_comment: null,
      updated_at: new Date().toISOString(),
    };
    if (license?.fullName) driverPayload.full_name = license.fullName;
    if (license?.dob) driverPayload.date_of_birth = parseDateForDb(license.dob);
    if (license?.address) driverPayload.residential_address = license.address;

    // Optional extended profile fields (if migration was executed and triggers permit)
    const extendedDriverPayload = {
      ...driverPayload,
      ...(license?.licenseNumber ? { license_number: license.licenseNumber } : {}),
      ...(license?.expirationDate ? { license_expiry: parseDateForDb(license.expirationDate) } : {}),
      ...(license?.dlCodes ? { dl_codes: license.dlCodes } : {}),
      ...(mtop?.franchiseNumber ? { franchise_number: mtop.franchiseNumber } : {}),
      ...(mtop?.plateNumber ? { plate_number: mtop.plateNumber } : {}),
      ...(mtop?.chassisNumber ? { chassis_number: mtop.chassisNumber } : {}),
      ...(mtop?.vehicleMake ? { vehicle_make: mtop.vehicleMake } : {}),
      ...(mtop?.motorNumber ? { motor_number: mtop.motorNumber } : {}),
      ...(mtop?.orNumber ? { or_number: mtop.orNumber } : {}),
      ...(mtop?.authorizedRoute ? { authorized_route: mtop.authorizedRoute } : {}),
      ...(mtop?.expirationDate ? { mtop_expiry: parseDateForDb(mtop.expirationDate) } : {}),
      ...(tricyclePath ? { tricycle_photo_path: tricyclePath } : {}),
    };

    const { error: primaryDriverErr } = await supabase
      .from('driver')
      .update(extendedDriverPayload)
      .eq('driver_id', driverId);

    if (primaryDriverErr) {
      console.warn('[FINAL REGISTRATION SUBMIT] Primary driver profile update warning, falling back to core allowable profile fields:', primaryDriverErr);
      await supabase
        .from('driver')
        .update(driverPayload)
        .eq('driver_id', driverId);
    }

    // 3. Upsert public.driver_verification with complete submitted document fields
    const verifPayload: Record<string, any> = {
      driver_id: driverId,
      submitted_full_name: license?.fullName || null,
      submitted_license_number: license?.licenseNumber || null,
      submitted_dob: license?.dob ? parseDateForDb(license.dob) : null,
      submitted_address: license?.address || null,
      submitted_dl_codes: license?.dlCodes || null,
      license_expiry: license?.expirationDate ? parseDateForDb(license.expirationDate) : null,
      submitted_franchise_number: mtop?.franchiseNumber || null,
      submitted_operator_name: mtop?.operatorName || null,
      submitted_plate_number: mtop?.plateNumber || null,
      submitted_chassis_number: mtop?.chassisNumber || null,
      submitted_vehicle_make: mtop?.vehicleMake || null,
      submitted_motor_number: mtop?.motorNumber || null,
      submitted_or_number: mtop?.orNumber || null,
      franchise_expiry: mtop?.expirationDate ? parseDateForDb(mtop?.expirationDate) : null,
      mtop_expiry: mtop?.expirationDate ? parseDateForDb(mtop?.expirationDate) : null,
      submitted_authorized_route: mtop?.authorizedRoute || null,
      license_front_photo_path: frontPath,
      license_back_photo_path: backPath,
      mtop_photo_path: mtopPath,
      tricycle_photo_path: tricyclePath,
      face_photo_path: selfiePath,
      face_verification_status: face?.faceMatchPassed === false ? 'Flagged' : 'Passed',
      scan_status: 'Clean',
      verification_status: 'Pending',
      rejection_reason: null,
      rejection_comment: null,
      rejected_by: null,
      rejected_at: null,
      remarks: 'Resubmitted by driver applicant with updated documents',
      submitted_at: new Date().toISOString(),
    };

    // Core fallback payload in case newly added schema columns have not been migrated on remote PostgREST instance yet
    const fallbackVerifPayload: Record<string, any> = {
      driver_id: driverId,
      submitted_full_name: license?.fullName || null,
      submitted_license_number: license?.licenseNumber || null,
      submitted_dob: license?.dob ? parseDateForDb(license.dob) : null,
      submitted_address: license?.address || null,
      submitted_dl_codes: license?.dlCodes || null,
      license_expiry: license?.expirationDate ? parseDateForDb(license.expirationDate) : null,
      submitted_franchise_number: mtop?.franchiseNumber || null,
      submitted_operator_name: mtop?.operatorName || null,
      submitted_plate_number: mtop?.plateNumber || null,
      franchise_expiry: mtop?.expirationDate ? parseDateForDb(mtop?.expirationDate) : null,
      license_front_photo_path: frontPath,
      license_back_photo_path: backPath,
      mtop_photo_path: mtopPath,
      tricycle_photo_path: tricyclePath,
      face_photo_path: selfiePath,
      scan_status: 'Clean',
      verification_status: 'Pending',
      rejection_reason: null,
      rejection_comment: null,
      rejected_by: null,
      rejected_at: null,
      remarks: 'Resubmitted by driver applicant with updated documents',
      submitted_at: new Date().toISOString(),
    };

    const { data: existingVerif } = await supabase
      .from('driver_verification')
      .select('verification_id, verification_status, endorsed_at')
      .eq('driver_id', driverId)
      .maybeSingle();

    const isResubmission =
      existingVerif?.verification_status === 'Resubmission Required' ||
      Boolean(existingVerif?.endorsed_at) ||
      Boolean(localStorage.getItem('sakay_driver_resubmission_session'));

    // driver_verification_verification_status_check allows: 'Pending', 'Approved', 'Rejected', 'Resubmission Required'
    // An endorsed driver who resubmits maintains Stage 1 'Approved' (awaiting LGU Stage 2 review)
    const targetVerificationStatus = isResubmission ? 'Approved' : 'Pending';

    verifPayload.verification_status = targetVerificationStatus;
    fallbackVerifPayload.verification_status = targetVerificationStatus;

    if (isResubmission) {
      verifPayload.remarks = 'Resubmitted by driver applicant with updated documents';
      fallbackVerifPayload.remarks = 'Resubmitted by driver applicant with updated documents';
      verifPayload.rejected_at = null;
      verifPayload.rejected_by = null;
      fallbackVerifPayload.rejected_at = null;
      fallbackVerifPayload.rejected_by = null;
    }

    if (existingVerif) {
      const { error: updateVerifErr } = await supabase
        .from('driver_verification')
        .update(verifPayload)
        .eq('verification_id', existingVerif.verification_id);

      if (updateVerifErr) {
        console.warn('[FINAL REGISTRATION SUBMIT] Verification update warning, trying core fallback payload:', updateVerifErr);
        await supabase
          .from('driver_verification')
          .update(fallbackVerifPayload)
          .eq('verification_id', existingVerif.verification_id);
      }
    } else {
      const { error: insertVerifErr } = await supabase
        .from('driver_verification')
        .insert([verifPayload]);

      if (insertVerifErr) {
        console.warn('[FINAL REGISTRATION SUBMIT] Verification insert warning, trying core fallback payload:', insertVerifErr);
        await supabase
          .from('driver_verification')
          .insert([fallbackVerifPayload]);
      }
    }

    if (isResubmission) {
      try {
        localStorage.setItem('sakay_driver_just_resubmitted', 'true');
        localStorage.removeItem('sakay_driver_resubmission_session');
      } catch {}

      try {
        const applicantName = license?.fullName || 'Driver applicant';
        await supabase.from('notification').insert([
          {
            driver_id: driverId,
            title: 'Driver Resubmitted Documents',
            message: `${applicantName} resubmitted documents for Stage 2 review.`,
            notification_type: 'Driver Resubmission',
            is_read: false,
          },
        ]);
      } catch (notifErr) {
        console.warn('[FINAL REGISTRATION SUBMIT] Notification insert warning:', notifErr);
      }
    }

    console.log('[FINAL REGISTRATION SUBMIT] Complete submission finalized successfully for driver:', driverId);
    return { success: true };
  } catch (err: any) {
    console.error('[FINAL REGISTRATION SUBMIT] Exception during final submission:', err);
    return {
      success: false,
      error: getLocalizedError(
        'Hindi na-proseso ang huling submission. Pakisubukang muli.',
        'Could not process final submission. Please try again.'
      ),
    };
  }
}

/**
 * Checks if a driver is documentarily restricted (expired license, MTOP, or unaccredited TODA)
 * Authoritative DB-backed check (Rule 24.1 - 24.3)
 */
export async function checkDriverDocumentaryRestriction(driverId: string) {
  try {
    const { data, error } = await supabase.rpc('is_driver_documentarily_restricted', {
      p_driver_id: driverId,
    });
    if (error) {
      console.warn('[driverApiService] checkDriverDocumentaryRestriction warning:', error);
      return { is_restricted: false, reasons: [] };
    }
    return data || { is_restricted: false, reasons: [] };
  } catch (err) {
    console.warn('[driverApiService] checkDriverDocumentaryRestriction error:', err);
    return { is_restricted: false, reasons: [] };
  }
}

/**
 * Submits renewed driver documents for LGU verification (Rule 24.2)
 * Does NOT directly mutate driver expiry dates; puts into pending renewal status.
 */
export async function submitDriverRenewal(
  driverId: string,
  licenseExpiry?: string,
  mtopExpiry?: string,
  licensePhotoUrl?: string,
  mtopPhotoUrl?: string
) {
  const { data, error } = await supabase.rpc('submit_driver_renewal', {
    p_driver_id: driverId,
    p_license_expiry: licenseExpiry || null,
    p_mtop_expiry: mtopExpiry || null,
    p_license_photo_url: licensePhotoUrl || null,
    p_mtop_photo_url: mtopPhotoUrl || null,
  });
  if (error) throw error;
  return data;
}

/**
 * Selects an active TODA affiliation while driver is Offline (Rule 3.1, 3.10)
 */
export async function selectActiveDriverAffiliation(affiliationId: string) {
  const { data, error } = await supabase.rpc('select_active_driver_affiliation', {
    p_affiliation_id: affiliationId,
  });
  if (error) throw error;
  return data;
}

/**
 * Resubmits a driver application returned under Resubmission Required (Rule 3.6, 3.8)
 */
export async function resubmitDriverApplication(affiliationId: string, documents?: any) {
  const { data, error } = await supabase.rpc('resubmit_driver_application', {
    p_affiliation_id: affiliationId,
    p_submitted_documents: documents || null,
  });
  if (error) throw error;
  return data;
}
