import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Switch,
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Radio,
  Avatar,
  Divider,
  CircularProgress,
  Alert,
  TextField,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import MapView from '../../../common/components/MapView';
import SakayToast from '../../../common/components/SakayToast';
import { DriverForegroundReminder } from '../../../common/components/DriverPresenceNotices';
import { supabase } from '../../../services/supabaseClient';
import { checkDriverDocumentaryRestriction, fetchAccreditedTodas, submitDriverRenewal, selectActiveDriverAffiliation } from '../../../services/driverApiService';
import { fetchMyAffiliationOptions } from '../../../services/driverPresenceService';
import type { AffiliationOption } from '../../../services/driverPresenceService';
import {
  getCurrentDevicePosition,
  getCachedDevicePosition,
  describeRestriction,
  fetchOwnAccountRestriction,
  parseRestrictionError,
  type AccountRestriction,
} from '@sakay/shared';
import { useLanguage } from '../../../utils/LanguageContext';
import { useDriverSession } from '../../../contexts/DriverSessionContext';

export const DriverAvailabilityHome: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, setProfile, presence, goOnline, goOffline, refreshPresence, enableLocation, locationReauthRequired, sessionMissing } = useDriverSession();

  // Going Online / Offline is a request to the database; this screen only shows its answer.
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [presenceMessage, setPresenceMessage] = useState<string | null>(null);

  const [toastOpen, setToastOpen] = useState(false);
  const [earnedAmount, setEarnedAmount] = useState<number | null>(null);
  const [searchingPillVisible, setSearchingPillVisible] = useState(() => !location.state?.showEarningsAnimation);

  useEffect(() => {
    if (location.state?.showEarningsAnimation) {
      // The amount is the fare the database locked for the trip (Rule 6.2); with none, no figure is invented.
      const lockedFare = Number(location.state.completedFare);
      setEarnedAmount(Number.isFinite(lockedFare) && lockedFare > 0 ? lockedFare : null);
      setToastOpen(true);
      setSearchingPillVisible(false);
    }
  }, [location.state]);

  const handleToastClose = () => {
    setToastOpen(false);
    setTimeout(() => {
      setSearchingPillVisible(true);
    }, 150);
  };

  // Suspension / deactivation decided by the database (Sections 20-22)
  const [accountRestriction, setAccountRestriction] = useState<AccountRestriction | null>(null);

  // Documentary Restriction & Renewal State (Rule 24.1 - 24.3)
  const [restrictionInfo, setRestrictionInfo] = useState<{
    is_restricted: boolean;
    reasons: string[];
    license_expired?: boolean;
    mtop_expired?: boolean;
    toda_expired?: boolean;
    no_active_affiliation?: boolean;
  } | null>(null);

  const [renewalModalOpen, setRenewalModalOpen] = useState(false);
  const [renewalLicenseExpiry, setRenewalLicenseExpiry] = useState('');
  const [renewalMtopExpiry, setRenewalMtopExpiry] = useState('');
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);
  const [renewalMsg, setRenewalMsg] = useState('');

  const handleRenewalSubmit = async () => {
    // The signed-in driver's real id; there is no fallback id.
    const activeDriverId = profile.id || localStorage.getItem('sakay_driver_id');
    if (!activeDriverId) return;
    setRenewalSubmitting(true);
    setRenewalMsg('');
    try {
      await submitDriverRenewal(
        activeDriverId,
        renewalLicenseExpiry || undefined,
        renewalMtopExpiry || undefined
      );
      setRenewalMsg(
        language === 'tl'
          ? 'Matagumpay na naisumite ang renewal para sa beripikasyon ng LGU.'
          : 'Renewal submitted successfully for LGU verification.'
      );
      setTimeout(async () => {
        setRenewalModalOpen(false);
        setRenewalMsg('');
        const restr = await checkDriverDocumentaryRestriction(activeDriverId);
        setRestrictionInfo(restr);
      }, 1800);
    } catch (err: any) {
      setRenewalMsg(err.message || 'Error submitting renewal');
    } finally {
      setRenewalSubmitting(false);
    }
  };
  // Location Permission Modal State (matching iOS permission prompt)
  // Only opens on the very first instance if never prompted before and not already granted
  const [locationPermissionOpen, setLocationPermissionOpen] = useState(() => {
    const prompted = localStorage.getItem('sakay_driver_location_prompted') === 'true';
    const perm = localStorage.getItem('sakay_driver_location_permission');
    if (prompted || perm === 'always' || perm === 'once') return false;
    return true;
  });

  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string>('');
  // The driver's OWN TODA affiliations (Rules 3.1 / 3.10). Only verified ones can be selected, and only while Offline.
  const [affiliations, setAffiliations] = useState<AffiliationOption[]>([]);
  const [selectingAffiliation, setSelectingAffiliation] = useState(false);
  const [todaModalOpen, setTodaModalOpen] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  // Rule 17.7: after permission was revoked the prompt returns until the driver allows location again.
  const [reauthDismissed, setReauthDismissed] = useState(false);
  useEffect(() => {
    if (locationReauthRequired) setReauthDismissed(false);
  }, [locationReauthRequired]);

  // Check if browser native permission is already granted; if so, never prompt and record
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'granted') {
          localStorage.setItem('sakay_driver_location_prompted', 'true');
          localStorage.setItem('sakay_driver_location_permission', 'always');
          setLocationPermissionOpen(false);
        }
      }).catch(() => {});
    }
  }, []);

  // Centre the map on the device position on mount ONLY if permission was already granted.
  // Display only: the Online heartbeat is the single place a position is sent to the database.
  useEffect(() => {
    const perm = localStorage.getItem('sakay_driver_location_permission');
    const prompted = localStorage.getItem('sakay_driver_location_prompted') === 'true';
    if (perm !== 'always' && perm !== 'once' && !prompted) return;
    if (perm === 'denied') return;

    getCurrentDevicePosition()
      .then((coords) => {
        setProfile((prev) => ({
          ...prev,
          currentLat: coords.latitude,
          currentLng: coords.longitude,
        }));
        setRecenterTrigger((prev) => prev + 1);
      })
      .catch((err) => {
        console.warn('[DriverAvailabilityHome] Mount position error:', err);
      });
  }, [locationPermissionOpen, setProfile]);

  // Load live Supabase profile on mount
  useEffect(() => {
    async function loadLiveDriver() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        // The home screen is for a signed-in driver; nothing can be read without a session.
        if (!user?.id) return;

        // Ask the database before reading the profile: it decides suspension / deactivation and
        // lifts a suspension whose period has ended, so the status read below is current.
        const ownRestriction = await fetchOwnAccountRestriction(supabase, 'driver');
        setAccountRestriction(ownRestriction?.restricted ? ownRestriction : null);

        // The driver's OWN row (row security shows a driver nobody else's). The TODA's name comes from the public directory below:
        // the toda table itself is not readable by a driver.
        const { data: driverData } = await supabase
          .from('driver')
          .select(`
            driver_id,
            full_name,
            contact_number,
            email,
            plate_number,
            license_number,
            franchise_number,
            account_status,
            weighted_average_rating,
            current_latitude,
            current_longitude,
            toda_id
          `)
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (driverData) {
          // A suspended / deactivated driver stays on the home screen with the reason and end date;
          // only applicants who are not yet verified are sent to the application status page.
          if (driverData.account_status !== 'Verified' && !ownRestriction?.restricted) {
            navigate('/driver/status', { replace: true });
            return;
          }

          // Authoritative check for documentary restrictions (Rule 24.1 - 24.3)
          // A restricted driver is put Offline by the database (scheduler cascade and the Online guard);
          // the app never writes availability itself.
          const restr = await checkDriverDocumentaryRestriction(driverData.driver_id);
          setRestrictionInfo(restr);

          const { count: completedTripsCount } = await supabase
            .from('booking')
            .select('*', { count: 'exact', head: true })
            .eq('driver_id', driverData.driver_id)
            .eq('booking_status', 'Completed');

          let plateNumber = driverData.plate_number;
          let licenseNumber = driverData.license_number;
          let franchiseNumber = driverData.franchise_number;

          if (!plateNumber || !licenseNumber || !franchiseNumber) {
            const { data: verif } = await supabase
              .from('driver_verification')
              .select('submitted_plate_number, submitted_license_number, submitted_franchise_number, ocr_plate_number, ocr_license_number, ocr_franchise_number')
              .eq('driver_id', driverData.driver_id)
              .maybeSingle();

            if (verif) {
              plateNumber = plateNumber || verif.submitted_plate_number || verif.ocr_plate_number || '';
              licenseNumber = licenseNumber || verif.submitted_license_number || verif.ocr_license_number || '';
              franchiseNumber = franchiseNumber || verif.submitted_franchise_number || verif.ocr_franchise_number || '';
            }
          }

          const todaObj = (await fetchAccreditedTodas()).find((t) => t.id === driverData.toda_id);
          const todaNameStr = todaObj ? `${todaObj.name} (${todaObj.acronym})` : '';

          const cached = getCachedDevicePosition();
          const resolvedLat = cached?.latitude || (driverData.current_latitude ? Number(driverData.current_latitude) : 13.4117);
          const resolvedLng = cached?.longitude || (driverData.current_longitude ? Number(driverData.current_longitude) : 121.1803);

          setProfile((prev) => {
            const hasPrevRealLat = prev.currentLat && prev.currentLat !== 13.4117 && prev.currentLat !== 13.367554;
            const hasPrevRealLng = prev.currentLng && prev.currentLng !== 121.1803 && prev.currentLng !== 121.168617;
            const finalLat = hasPrevRealLat ? prev.currentLat : resolvedLat;
            const finalLng = hasPrevRealLng ? prev.currentLng : resolvedLng;

            return {
              ...prev,
              id: driverData.driver_id,
              name: driverData.full_name || prev.name,
              phone: driverData.contact_number || prev.phone,
              email: driverData.email || prev.email,
              vehiclePlate: plateNumber || prev.vehiclePlate,
              licenseNumber: licenseNumber || prev.licenseNumber,
              franchiseNumber: franchiseNumber || prev.franchiseNumber,
              todaName: todaNameStr || prev.todaName,
              selectedTodaId: driverData.toda_id || prev.selectedTodaId,
              rating: Number(driverData.weighted_average_rating) || 5.0,
              totalTrips: completedTripsCount || 0,
              accountStatus: driverData.account_status,
              verificationStage: 'Stage 2 Approved',
              currentLat: finalLat,
              currentLng: finalLng,
            };
          });
        }
      } catch (err) {
        console.warn('[DriverAvailabilityHome] Live profile sync note:', err);
      }
    }

    loadLiveDriver();
  }, [navigate, setProfile]);

  // Load the driver's own affiliations (re-load when the driver id becomes known, and after a selection).
  const loadAffiliations = React.useCallback(async () => {
    if (!profile.id) return;
    setAffiliations(await fetchMyAffiliationOptions(profile.id));
  }, [profile.id]);
  useEffect(() => {
    loadAffiliations();
  }, [loadAffiliations, presence.status]);

  const activeAffiliation = affiliations.find((a) => a.isActive) || null;
  const selectableAffiliations = affiliations.filter((a) => a.isSelectable);
  const isOnline = presence.status === 'online';
  const displayTodaText = activeAffiliation
    ? `${activeAffiliation.todaName} (${activeAffiliation.todaAcronym})`
    : (profile.todaName || (language === 'tl' ? 'Pumili ng TODA...' : 'Select TODA...'));

  const selectedVehicle = {
    id: profile.selectedVehicleId || profile.id || 'veh-primary',
    plateNumber: profile.vehiclePlate || 'N/A',
    franchiseNumber: profile.franchiseNumber || 'N/A',
    model: 'Registered Tricycle Unit',
  };

  const isDriverVerifiedInDb = profile.accountStatus === 'Verified';
  // Expired papers block going Online. A missing active affiliation does not: the database selects the only
  // verified affiliation automatically, and the picker below handles the case of several.
  const documentsBlock = !!restrictionInfo?.is_restricted
    && !!(restrictionInfo.license_expired || restrictionInfo.mtop_expired || restrictionInfo.toda_expired);
  const canGoOnline = isDriverVerifiedInDb && !documentsBlock && !accountRestriction?.restricted
    && presence.status !== 'unknown';

  // Why Online was refused, in the driver's language. The database gives the reason; the app never guesses.
  const describePresenceError = (code: string, serverMessage: string): string => {
    const tl = language === 'tl';
    switch (code) {
      case 'ERR_NO_SESSION':
        return tl ? 'Walang secure na login session. Mag-login gamit ang tunay na account ng drayber para makapag-Online.' : 'There is no secure login session. Sign in with your real driver account to go Online.';
      case 'ERR_LOCATION_DENIED':
        return tl ? 'Naka-off ang Location. Payagan ito para makapag-Online.' : 'Location is turned off. Allow it to go Online.';
      case 'ERR_LOCATION_REQUIRED':
        return tl ? 'Hindi makuha ang iyong lokasyon. Subukan muli sa bukas na lugar.' : 'Could not get your location. Try again in an open area.';
      case 'ERR_LOCATION_INACCURATE':
        return tl ? 'Mahina ang GPS signal (higit sa 100 m ang layo ng error). Pumunta sa bukas na lugar at subukan muli.' : 'GPS signal is too weak (accuracy worse than 100 m). Move to an open area and try again.';
      case 'ERR_LOCATION_STALE':
        return tl ? 'Luma na ang nakuhang lokasyon. Subukan muli.' : 'The location fix is too old. Try again.';
      case 'ERR_SELECT_AFFILIATION':
        return tl ? 'Pumili muna ng aktibong TODA bago mag-Online.' : 'Select your active TODA before going Online.';
      case 'ERR_NO_VERIFIED_AFFILIATION':
        return tl ? 'Wala ka pang beripikadong TODA affiliation.' : 'You do not have a verified TODA affiliation yet.';
      case 'ERR_OPEN_BOOKING':
        return tl ? 'Hindi ka maaaring mag-Offline habang may bukas na booking.' : 'You cannot go Offline while a booking is open.';
      case 'ERR_NETWORK':
        return tl ? 'Walang koneksyon. Subukan muli.' : 'No connection. Try again.';
      default:
        return serverMessage;
    }
  };

  const handleToggleOnline = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canGoOnline || togglingOnline) return;
    const wantOnline = e.target.checked;
    setTogglingOnline(true);
    setPresenceMessage(null);
    try {
      const outcome = wantOnline ? await goOnline() : await goOffline();
      if (outcome.ok) return;

      // The database refuses going online while suspended / deactivated: show why, with the end date.
      const refused = parseRestrictionError(outcome.message);
      if (refused) setAccountRestriction(refused);
      if (outcome.code === 'ERR_LOCATION_DENIED') setReauthDismissed(false);
      if (outcome.code === 'ERR_SELECT_AFFILIATION') setTodaModalOpen(true);
      if (outcome.code === 'ERR_DOCUMENT_EXPIRED' && profile.id) {
        checkDriverDocumentaryRestriction(profile.id).then(setRestrictionInfo).catch(() => {});
      }
      setPresenceMessage(describePresenceError(outcome.code, outcome.message));
    } finally {
      setTogglingOnline(false);
    }
  };

  // Rules 3.1 / 3.10: the active affiliation is chosen through the database function, never changes while Online.
  const handleSelectAffiliation = async (option: AffiliationOption) => {
    if (isOnline || selectingAffiliation || !option.isSelectable) return;
    setSelectingAffiliation(true);
    setPresenceMessage(null);
    try {
      const result = await selectActiveDriverAffiliation(option.affiliationId);
      if (result?.success) {
        setProfile((prev) => ({
          ...prev,
          selectedTodaIds: [option.todaId],
          selectedTodaId: option.todaId,
          todaName: `${option.todaName} (${option.todaAcronym})`,
        }));
        await loadAffiliations();
        await refreshPresence();
      } else {
        setPresenceMessage(result?.error || (language === 'tl' ? 'Hindi mapili ang TODA.' : 'Could not select that TODA.'));
      }
    } catch (err: any) {
      setPresenceMessage(err?.message || (language === 'tl' ? 'Hindi mapili ang TODA.' : 'Could not select that TODA.'));
    } finally {
      setSelectingAffiliation(false);
    }
  };

  // Display only: re-centres the map. Publishing a position is the Online heartbeat's job.
  const handleRecenter = async () => {
    try {
      const coords = await getCurrentDevicePosition();
      setProfile((prev) => ({
        ...prev,
        currentLat: coords.latitude,
        currentLng: coords.longitude,
      }));
      setRecenterTrigger((prev) => prev + 1);
    } catch {
      setRecenterTrigger((prev) => prev + 1);
    }
  };

  const handleAllowLocation = async (saveAlways: boolean) => {
    setIsRequestingLocation(true);
    setLocationError('');
    try {
      const coords = await getCurrentDevicePosition();
      localStorage.setItem('sakay_driver_location_prompted', 'true');
      localStorage.setItem('sakay_driver_location_permission', 'always');

      setProfile((prev) => ({
        ...prev,
        currentLat: coords.latitude,
        currentLng: coords.longitude,
      }));
      setRecenterTrigger((prev) => prev + 1);

      // Location is back: the engine restarts its watcher and the re-authorization prompt is done (Rule 17.7).
      enableLocation();
      setIsRequestingLocation(false);
      setLocationPermissionOpen(false);
    } catch (err: any) {
      console.warn('[DriverAvailabilityHome] Geolocation note:', err?.message || err);
      setIsRequestingLocation(false);
      setLocationError(
        language === 'tl'
          ? 'Hindi ma-access ang GPS. Pakisuyong i-on ang Location sa settings ng iyong device.'
          : 'Unable to access GPS. Please turn on Location in your device settings.'
      );
    }
  };

  const handleDenyLocation = () => {
    localStorage.setItem('sakay_driver_location_prompted', 'true');
    localStorage.setItem('sakay_driver_location_permission', 'denied');
    setLocationPermissionOpen(false);
    setReauthDismissed(true);
  };

  const locationDialogOpen = locationPermissionOpen || (locationReauthRequired && !reauthDismissed);

  // The documentary banner is hidden when the only problem is "no active affiliation" and the driver has a verified
  // one to choose: that is fixed by the picker (or automatically), not by renewing documents.
  const onlyAffiliationIssue = !!restrictionInfo?.no_active_affiliation
    && !restrictionInfo.license_expired && !restrictionInfo.mtop_expired && !restrictionInfo.toda_expired;
  const showDocBanner = !!restrictionInfo?.is_restricted && !accountRestriction?.restricted
    && !(onlyAffiliationIssue && selectableAffiliations.length > 0);

  const displayName = profile.name || 'Drayber';
  const firstName = displayName.split(' ')[0] || 'Drayber';
  const initialLetter = firstName.charAt(0) || 'D';
  const ratingNum = typeof profile.rating === 'number' ? profile.rating : 5.0;
  const tripsCount = typeof profile.totalTrips === 'number' ? profile.totalTrips : 0;

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#E3ECEF', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <MapView
        userLocation={{ lat: profile.currentLat, lng: profile.currentLng }}
        recenterTrigger={recenterTrigger}
      />

      <SakayToast
        open={toastOpen}
        message={
          earnedAmount
            ? (language === 'tl'
                ? `🎉 Kumpleto na ang biyahe! +₱${earnedAmount.toFixed(2)} naidagdag sa kita ngayong araw.`
                : `🎉 Trip Completed! +₱${earnedAmount.toFixed(2)} added to today's earnings.`)
            : null
        }
        severity="success"
        autoHideDuration={4500}
        onClose={handleToastClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />

      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          top: 'calc(var(--safe-area-top) + 12px)',
          left: '16px',
          right: '16px',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          borderRadius: '20px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 20,
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
          border: '1px solid rgba(226, 232, 240, 0.8)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 42,
              height: 42,
              backgroundColor: '#FF6B00',
              fontWeight: 800,
              fontSize: '17px',
              border: '2px solid #FFFFFF',
              boxShadow: '0 2px 8px rgba(255, 107, 0, 0.3)',
            }}
          >
            {initialLetter}
          </Avatar>
          <Box>
            <Typography sx={{ color: '#0F172A', fontWeight: 800, fontSize: '14.5px', lineHeight: 1.2 }}>
              {firstName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: '2px' }}>
              <StarIcon sx={{ fontSize: 13, color: '#FFB800' }} />
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#0F172A' }}>
                {ratingNum.toFixed(1)}
              </Typography>
              <Typography sx={{ fontSize: '11px', color: '#64748B' }}>
                ({tripsCount} trips)
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            backgroundColor: profile.isOnline ? '#ECFDF5' : '#F1F5F9',
            padding: '5px 12px',
            borderRadius: '999px',
            border: `1px solid ${profile.isOnline ? '#A7F3D0' : '#E2E8F0'}`,
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: profile.isOnline ? '#10B981' : '#94A3B8',
            }}
          />
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 800,
              color: profile.isOnline ? '#047857' : '#64748B',
            }}
          >
            {profile.isOnline ? 'ONLINE' : 'OFFLINE'}
          </Typography>
          <Switch
            checked={profile.isOnline}
            disabled={!canGoOnline || togglingOnline}
            onChange={handleToggleOnline}
            color="success"
            size="small"
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': {
                color: '#10B981',
              },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                backgroundColor: '#10B981',
              },
            }}
          />
        </Box>
      </Paper>

      {/* Suspension / Deactivation Banner (Sections 20-22): shows the reason and end date */}
      {accountRestriction?.restricted && (
        <Paper
          elevation={3}
          sx={{
            position: 'absolute',
            top: 'calc(var(--safe-area-top) + 84px)',
            left: '16px',
            right: '16px',
            backgroundColor: '#FEF2F2',
            border: '1.5px solid #FCA5A5',
            borderRadius: '16px',
            p: 2,
            zIndex: 25,
            boxShadow: '0 8px 24px rgba(220, 38, 38, 0.15)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <WarningAmberIcon sx={{ color: '#DC2626', fontSize: 26, mt: 0.2, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ color: '#991B1B', fontWeight: 800, fontSize: '13px', lineHeight: 1.2 }}>
                {accountRestriction.kind === 'DEACTIVATED' || accountRestriction.kind === 'CLOSED'
                  ? (language === 'tl' ? 'Na-deactivate ang Account' : 'Account Deactivated')
                  : (language === 'tl' ? 'Suspendido ang Account' : 'Account Suspended')}
              </Typography>
              <Typography sx={{ color: '#7F1D1D', fontSize: '11.5px', mt: 0.5, lineHeight: 1.4 }}>
                {describeRestriction(accountRestriction, language === 'tl' ? 'tl' : 'en')}
              </Typography>
              {accountRestriction.kind === 'SUSPENDED' && (
                <Typography sx={{ color: '#991B1B', fontSize: '10.5px', fontStyle: 'italic', mt: 0.5 }}>
                  {language === 'tl'
                    ? 'Kusang mawawala ang suspensyon kapag natapos ang panahon nito.'
                    : 'The suspension lifts automatically when this period ends.'}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      )}

      {/* Documentary Restriction Warning Banner (Rule 24.2, 24.3) */}
      {showDocBanner && restrictionInfo && (
        <Paper
          elevation={3}
          sx={{
            position: 'absolute',
            top: 'calc(var(--safe-area-top) + 84px)',
            left: '16px',
            right: '16px',
            backgroundColor: '#FEF2F2',
            border: '1.5px solid #FCA5A5',
            borderRadius: '16px',
            p: 2,
            zIndex: 25,
            boxShadow: '0 8px 24px rgba(220, 38, 38, 0.15)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <WarningAmberIcon sx={{ color: '#DC2626', fontSize: 26, mt: 0.2, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ color: '#991B1B', fontWeight: 800, fontSize: '13px', lineHeight: 1.2 }}>
                {language === 'tl'
                  ? 'Pansamantalang Naka-block Mag-Online (Documentary Restriction)'
                  : 'Service Restriction (Documentary)'}
              </Typography>
              <Typography sx={{ color: '#7F1D1D', fontSize: '11.5px', mt: 0.5, lineHeight: 1.4 }}>
                {restrictionInfo.reasons && restrictionInfo.reasons.length > 0
                  ? restrictionInfo.reasons.join('. ')
                  : (language === 'tl' ? 'Paso na ang iyong lisensya, MTOP, o akreditasyon ng TODA.' : 'Expired license, MTOP, or TODA accreditation.')}
              </Typography>
              <Typography sx={{ color: '#991B1B', fontSize: '10.5px', fontStyle: 'italic', mt: 0.5 }}>
                {language === 'tl'
                  ? 'Hindi ito strike o administrative penalty. Kusang mawawala matapos maaprubahan ng LGU ang renewal.'
                  : 'This is not a disciplinary strike. Restriction lifts automatically upon LGU verification.'}
              </Typography>
              {(restrictionInfo.license_expired || restrictionInfo.mtop_expired) && (
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => setRenewalModalOpen(true)}
                  sx={{
                    mt: 1.5,
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '11.5px',
                    borderRadius: '8px',
                    boxShadow: 'none',
                    '&:hover': { backgroundColor: '#B91C1C', boxShadow: 'none' },
                  }}
                >
                  {language === 'tl' ? 'Mag-sumite ng Renewal' : 'Submit Document Renewal'}
                </Button>
              )}
            </Box>
          </Box>
        </Paper>
      )}

      {searchingPillVisible && (
        <Chip
          label={
            profile.isOnline
              ? (language === 'tl' ? 'Naghahanap ng mga pasahero...' : 'Searching for nearby passengers...')
              : (language === 'tl' ? 'Offline • Mag-online para makatanggap ng biyahe' : 'Offline • Go online to receive trips')
          }
          sx={{
            position: 'absolute',
            top: 'calc(var(--safe-area-top) + 94px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#FFFFFF',
            color: profile.isOnline ? '#0F172A' : '#64748B',
            fontWeight: 700,
            fontSize: '11.5px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
            border: '1px solid #E2E8F0',
            zIndex: 10,
            animation: 'fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
            },
            '@keyframes fadeInUp': {
              from: { opacity: 0, transform: 'translate(-50%, 8px)' },
              to: { opacity: 1, transform: 'translate(-50%, 0)' },
            },
          }}
        />
      )}


      <IconButton
        onClick={handleRecenter}
        aria-label="Recenter map"
        sx={{
          position: 'absolute',
          bottom: '220px',
          right: '16px',
          backgroundColor: '#FFFFFF',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          boxShadow: '0 4px 14px rgba(15, 23, 42, 0.15)',
          color: '#0F172A',
          zIndex: 10,
          transition: 'all 0.2s ease',
          '&:hover': {
            backgroundColor: '#F8FAFC',
            transform: 'scale(1.05)',
          },
        }}
      >
        <MyLocationIcon sx={{ fontSize: 20, color: '#0F172A' }} />
      </IconButton>

      <Paper
        elevation={8}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '16px 20px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          zIndex: 20,
          borderTop: '1px solid #E2E8F0',
          boxShadow: '0 -6px 24px rgba(0, 0, 0, 0.06)',
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#CBD5E1',
            alignSelf: 'center',
            mb: 0.5,
          }}
        />

        {/* No Supabase session (demo login): the database refuses every presence request */}
        {sessionMissing && (
          <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '11.5px', py: 0.25 }}>
            {language === 'tl'
              ? 'Walang secure na login session (demo login). Mag-login gamit ang tunay na account ng drayber para makapag-Online.'
              : 'No secure login session (demo login). Sign in with your real driver account to go Online.'}
          </Alert>
        )}

        {/* Rule 17.6: persistent reminder while Online */}
        {isOnline && <DriverForegroundReminder />}

        {/* The database's reason when Online was refused (never a guess) */}
        {presenceMessage && (
          <Alert severity="warning" onClose={() => setPresenceMessage(null)} sx={{ borderRadius: '12px', fontSize: '11.5px', py: 0.25 }}>
            {presenceMessage}
          </Alert>
        )}

        {/* Only the real blocker is shown: suspension and documents have their own banners above */}
        {!isOnline && isDriverVerifiedInDb && !accountRestriction?.restricted && !documentsBlock && affiliations.length > 0 && selectableAffiliations.length === 0 && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '11.5px', py: 0.25 }}>
            {language === 'tl'
              ? 'Hindi pa tapos ang beripikasyon ng iyong TODA affiliation. Hindi ka pa makakapag-Online.'
              : 'Your TODA affiliation is not fully verified yet, so you cannot go Online.'}
          </Alert>
        )}
        {!isOnline && isDriverVerifiedInDb && !accountRestriction?.restricted && !documentsBlock && selectableAffiliations.length > 1 && !activeAffiliation && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '11.5px', py: 0.25 }}>
            {language === 'tl'
              ? 'Pumili ng isang aktibong TODA sa ibaba bago mag-Online.'
              : 'Select one active TODA below before going Online.'}
          </Alert>
        )}

        <Box
          onClick={() => setTodaModalOpen(true)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: '14px',
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            '&:hover': { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '10.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl' ? 'Kinabibilangang TODA' : 'Active TODA Affiliation'}
            </Typography>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', mt: '2px', fontFamily: 'Poppins, sans-serif' }}>
              {displayTodaText}
            </Typography>
          </Box>
          <ArrowForwardIosIcon sx={{ fontSize: 13, color: '#94A3B8' }} />
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: '14px',
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '10.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl' ? 'Gamit na Tricycle Unit' : 'Tricycle Unit in Use'}
            </Typography>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', mt: '2px', fontFamily: 'Poppins, sans-serif' }}>
              {selectedVehicle
                ? `${language === 'tl' ? 'Plaka' : 'Plate'}: ${selectedVehicle.plateNumber} • Franchise: ${selectedVehicle.franchiseNumber}`
                : (language === 'tl' ? 'Rehistradong Tricycle Unit' : 'Registered Tricycle Unit')}
            </Typography>
            {/* Rules 3.10 / 29.18: the verified unit is fixed; substituting needs TODA and LGU approval */}
            <Typography sx={{ fontSize: '10.5px', color: '#64748B', mt: '2px', fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl'
                ? 'Naka-lock ang beripikadong unit. Makipag-ugnayan sa TODA at LGU para magpalit.'
                : 'Your verified unit is locked. Ask your TODA and the LGU to change it.'}
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Dialog open={todaModalOpen} onClose={() => setTodaModalOpen(false)} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px' } } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A', px: 2.5, pt: 2.5, pb: 1, fontFamily: 'Poppins, sans-serif' }}>
          {language === 'tl' ? 'Pumili ng Aktibong TODA' : 'Select Active TODA'}
        </DialogTitle>
        <DialogContent sx={{ px: 2.5, py: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, mt: 0.5 }}>
            {/* Rule 3.10: no change while Online */}
            {isOnline && (
              <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '11.5px', py: 0.25 }}>
                {language === 'tl'
                  ? 'Hindi maaaring magpalit ng aktibong TODA habang Online. Mag-Offline muna.'
                  : 'The active TODA cannot be changed while you are Online. Go Offline first.'}
              </Alert>
            )}
            {affiliations.length > 0 ? (
              affiliations.map((option) => {
                const locked = isOnline || selectingAffiliation || !option.isSelectable;
                return (
                  <Box
                    key={option.affiliationId}
                    onClick={() => !locked && handleSelectAffiliation(option)}
                    sx={{
                      p: 1.5,
                      borderRadius: '14px',
                      border: option.isActive ? '2px solid #FF6B00' : '1px solid #E2E8F0',
                      backgroundColor: option.isActive ? '#FFF8F0' : '#FFFFFF',
                      cursor: locked ? 'default' : 'pointer',
                      opacity: option.isSelectable ? 1 : 0.6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease',
                      '&:hover': { borderColor: locked ? undefined : '#FF6B00' },
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontWeight: 700, fontSize: '13px', color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>{option.todaName} ({option.todaAcronym})</Typography>
                      <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
                        {option.isSelectable ? `Terminal: ${option.coverage}` : option.statusLabel}
                      </Typography>
                    </Box>
                    <Radio
                      checked={option.isActive}
                      disabled={locked}
                      sx={{
                        color: '#CBD5E1',
                        p: 0.5,
                        '&.Mui-checked': { color: '#FF6B00' },
                      }}
                    />
                  </Box>
                );
              })
            ) : (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '12.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
                  {language === 'tl' ? 'Wala ka pang TODA affiliation' : 'You have no TODA affiliations yet'}
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1.5 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => setTodaModalOpen(false)}
            sx={{
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              borderRadius: '14px',
              height: '46px',
              fontSize: '14px',
              textTransform: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#E05300' },
            }}
          >
            {language === 'tl' ? 'Tapos Na' : 'Done'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={locationDialogOpen}
        onClose={() => {
          setLocationPermissionOpen(false);
          setReauthDismissed(true);
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '28px',
              padding: 0,
              backgroundColor: '#FFFFFF',
              overflow: 'hidden',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)',
              maxWidth: '320px',
              margin: 'auto',
            },
          },
        }}
      >
        <Box sx={{ p: '24px 20px 18px 20px', textAlign: 'center' }}>
          <Typography
            sx={{
              fontSize: '17px',
              fontWeight: 800,
              color: '#0F172A',
              lineHeight: 1.35,
              mb: '12px',
              fontFamily: 'Poppins, sans-serif',
            }}
          >
            {language === 'tl' ? 'Payagan ang “SAKAY” na gamitin ang iyong lokasyon?' : 'Allow “SAKAY” to use your location?'}
          </Typography>
          <Typography
            sx={{
              fontSize: '13px',
              fontWeight: 400,
              color: '#475569',
              lineHeight: 1.5,
              fontFamily: 'Poppins, sans-serif',
              mb: locationError ? '12px' : 0,
            }}
          >
            {language === 'tl'
              ? 'Ginagamit ang iyong lokasyon para makahanap ng malapit na pasahero at masubaybayan ang iyong biyahe sa mapa.'
              : 'Your location is used to find nearby passengers and track your trip on the map.'}
          </Typography>
          {locationError && (
            <Alert severity="warning" sx={{ mt: '12px', fontSize: '12px', borderRadius: '12px', textAlign: 'left' }}>
              {locationError}
            </Alert>
          )}
        </Box>

        <Divider sx={{ borderColor: '#E2E8F0' }} />

        <Button
          fullWidth
          disabled={isRequestingLocation}
          onClick={() => handleAllowLocation(false)}
          sx={{
            py: '14px',
            color: '#0F172A',
            fontWeight: 600,
            fontSize: '14px',
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            borderRadius: 0,
            '&:hover': { backgroundColor: '#F8FAFC' },
          }}
        >
          {language === 'tl' ? 'Payagan nang isang beses' : 'Allow Once'}
        </Button>

        <Divider sx={{ borderColor: '#E2E8F0' }} />

        <Button
          fullWidth
          disabled={isRequestingLocation}
          onClick={() => handleAllowLocation(true)}
          sx={{
            py: '14px',
            color: '#FF6B00',
            fontWeight: 700,
            fontSize: '14px',
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            borderRadius: 0,
            '&:hover': { backgroundColor: '#FFF8F0' },
          }}
        >
          {isRequestingLocation ? (
            <CircularProgress size={20} sx={{ color: '#FF6B00' }} />
          ) : (
            language === 'tl' ? 'Habang Ginagamit ang App' : 'While Using the App'
          )}
        </Button>

        <Divider sx={{ borderColor: '#E2E8F0' }} />

        <Button
          fullWidth
          disabled={isRequestingLocation}
          onClick={handleDenyLocation}
          sx={{
            py: '14px',
            color: '#64748B',
            fontWeight: 600,
            fontSize: '14px',
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            borderRadius: 0,
            '&:hover': { backgroundColor: '#F8FAFC' },
          }}
        >
          {language === 'tl' ? 'Huwag Payagan' : "Don't Allow"}
        </Button>
      </Dialog>

      {/* Renewal Submission Dialog (Rule 24.2) */}
      <Dialog
        open={renewalModalOpen}
        onClose={() => !renewalSubmitting && setRenewalModalOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: '20px', p: 1 } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A' }}>
          {language === 'tl' ? 'Mag-sumite ng Document Renewal' : 'Submit Document Renewal'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', mb: 2 }}>
            {language === 'tl'
              ? 'Ilagay ang bagong petsa ng expiration ng iyong mga dokumento. Susuriin ito ng LGU bago i-update ang opisyal na rekord.'
              : 'Enter new document expiration dates. These will be reviewed by LGU before official records update.'}
          </Typography>
          {renewalMsg && (
            <Alert severity={renewalMsg.includes('Matagumpay') || renewalMsg.includes('successfully') ? 'success' : 'error'} sx={{ mb: 2 }}>
              {renewalMsg}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label={language === 'tl' ? "Bagong Expiry ng Driver's License" : "New Driver's License Expiry"}
              type="date"
              slotProps={{ inputLabel: { shrink: true } }}
              value={renewalLicenseExpiry}
              onChange={(e) => setRenewalLicenseExpiry(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={language === 'tl' ? "Bagong Expiry ng MTOP Permit" : "New MTOP Franchise Expiry"}
              type="date"
              slotProps={{ inputLabel: { shrink: true } }}
              value={renewalMtopExpiry}
              onChange={(e) => setRenewalMtopExpiry(e.target.value)}
              fullWidth
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setRenewalModalOpen(false)}
            disabled={renewalSubmitting}
            sx={{ textTransform: 'none', color: '#64748B' }}
          >
            {language === 'tl' ? 'Kanselahin' : 'Cancel'}
          </Button>
          <Button
            variant="contained"
            onClick={handleRenewalSubmit}
            disabled={renewalSubmitting || (!renewalLicenseExpiry && !renewalMtopExpiry)}
            sx={{
              backgroundColor: '#FF6B00',
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '10px',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {renewalSubmitting ? (language === 'tl' ? 'Isinusumite...' : 'Submitting...') : (language === 'tl' ? 'Isumite sa LGU' : 'Submit to LGU')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverAvailabilityHome;
