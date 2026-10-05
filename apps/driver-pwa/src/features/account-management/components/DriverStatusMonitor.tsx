import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  Button,
  Switch,
  Snackbar,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import LogoutIcon from '@mui/icons-material/Logout';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { fetchMyApplicationReview, fetchOwnDriverRecord } from '../../../services/driverApiService';
import { classifyApplication, rejectionReasonParts, REVIEW_DOCUMENT_LABEL, REVIEW_DOCUMENT_ORDER, RETURN_REASON_LABEL } from '@sakay/shared';
import type { ApplicationStatus, ReturnReasonCode, ReviewDocumentType } from '@sakay/shared';
import { fetchMyAffiliationOptions, type AffiliationOption } from '../../../services/driverPresenceService';
import {
  parseRejectionComment,
  hydrateOnboardingCacheFromExisting,
  saveResubmissionSession,
  type FaultyDocType,
} from '../../../services/driverOnboardingCache';

const RETURN_REASON_TL: Record<ReturnReasonCode, string> = {
  blurry: 'Malabo / hindi mabasa',
  expired: 'Paso na',
  mismatch: 'Hindi tugma ang impormasyon',
  wrong_document: 'Maling dokumento',
  incomplete: 'Kulang',
  other: 'Iba pa',
};

const DOCUMENT_LABEL_TL: Record<ReviewDocumentType, string> = {
  license: "Driver's License (Lisensya)",
  mtop: 'MTOP / Prangkisa',
  tricycle: 'Larawan ng Tricycle',
  selfie: 'Selfie / Larawan ng Mukha',
};

export const DriverStatusMonitor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const isTagalog = language === 'tl';
  const state = location.state as {
    driverName?: string;
    phone?: string;
    accountStatus?: string;
    rejectionReason?: string;
    rejectionComment?: string;
  } | undefined;

  const [loading, setLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string>(state?.accountStatus || 'Pending Verification');
  const [rejectionReason, setRejectionReason] = useState<string | undefined>(state?.rejectionReason);
  const [rejectionComment, setRejectionComment] = useState<string | undefined>(state?.rejectionComment);

  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('sakay_driver_notify_status');
    return saved !== null ? saved === 'true' : true;
  });
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [isDocIncomplete, setIsDocIncomplete] = useState(false);
  const [incompleteDriverInfo, setIncompleteDriverInfo] = useState<{ phone: string; driverName: string } | null>(null);
  const [isResubmittedApplication, setIsResubmittedApplication] = useState(false);
  // The database's own reading of every TODA application: which documents wait for the driver, what was resubmitted and when.
  const [appStatus, setAppStatus] = useState<ApplicationStatus | null>(null);
  // One row per TODA the driver applied to: each affiliation is reviewed on its own (TODA first, then the LGU).
  const [affiliations, setAffiliations] = useState<AffiliationOption[]>([]);
  React.useEffect(() => {
    let alive = true;
    fetchMyAffiliationOptions().then((rows) => {
      if (alive) setAffiliations(rows);
    });
    return () => {
      alive = false;
    };
  }, [profileStatus]);

  const checkStatus = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      // The status page is for a signed-in driver: without a session there is nothing to show, so go to the login screen.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/driver/login', { replace: true });
        return;
      }

      // The driver's OWN record, found from the session (row security shows a driver nobody else's). It is never looked up by phone number.
      const driverData: any = await fetchOwnDriverRecord();

      if (driverData) {
        // Sync local profile cache
        const todaInfo = Array.isArray(driverData.toda) ? driverData.toda[0] : driverData.toda;
        const todaNameStr = todaInfo?.toda_name || '';
        const todaAcronymStr = todaInfo?.toda_acronym || '';

        localStorage.setItem('sakay_driver_id', driverData.driver_id);
        if (driverData.contact_number) {
          localStorage.setItem('sakay_driver_phone', driverData.contact_number);
        }

        localStorage.setItem(
          'sakay_driver_profile',
          JSON.stringify({
            name: driverData.full_name,
            phone: driverData.contact_number,
            vehiclePlate: driverData.plate_number || '',
            licenseNumber: driverData.license_number || '',
            franchiseNumber: driverData.franchise_number || '',
            todaName: todaInfo ? `${todaNameStr} (${todaAcronymStr})` : '',
            rating: 5.0,
            isOnline: false,
            isPaused: false,
            accountStatus: driverData.account_status,
            verificationStage: driverData.account_status === 'Verified' ? 'Stage 2 Approved' : 'Stage 1 TODA Review',
          })
        );

        // If approved by LGU (Verified) -> Immediately transition to Active Map
        if (driverData.account_status === 'Verified') {
          navigate('/driver/home', { replace: true });
          return;
        }

        // The review of every TODA application, from the database (one call). It decides "returned" / "resubmitted"; the shared
        // verification record below is only the fallback for a driver who has no TODA application on record.
        const review = await fetchMyApplicationReview();
        const status: ApplicationStatus | null = review && review.affiliations.length > 0 ? classifyApplication(review.affiliations) : null;
        setAppStatus(status);

        // Check verification details from driver_verification
        if (driverData.driver_id) {
          const { data: verif } = await supabase
            .from('driver_verification')
            .select('verification_status, submitted_license_number, remarks, rejection_reason, rejection_comment')
            .eq('driver_id', driverData.driver_id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (driverData.account_status === 'Rejected' || verif?.verification_status === 'Rejected') {
            setProfileStatus('Rejected');
            setRejectionReason(verif?.rejection_reason || verif?.remarks || state?.rejectionReason || 'Application rejected');
            setRejectionComment(verif?.rejection_comment || state?.rejectionComment);
            setLoading(false);
            return;
          }

          // 1. Documents are waiting for the DRIVER: say which, why, and who asked.
          if (status && status.kind === 'resubmission_required') {
            setIsResubmittedApplication(false);
            setProfileStatus('Resubmission Required');
            setLoading(false);
            return;
          }

          // 2. The driver resubmitted: the reviewer has not decided. Never "approved" until the TODA endorses / the LGU approves.
          if (status && status.kind === 'resubmitted_awaiting_toda') {
            setIsResubmittedApplication(true);
            setProfileStatus('Resubmitted - Awaiting TODA Review');
            setLoading(false);
            return;
          }
          if (status && status.kind === 'resubmitted_awaiting_lgu') {
            setIsResubmittedApplication(true);
            setProfileStatus('Endorsed to LGU');
            setLoading(false);
            return;
          }

          // Fallback for a driver with no TODA application on record: the shared record (it can be stale once applications exist)
          if (
            !status &&
            (driverData.account_status === 'Resubmission Required' ||
              verif?.verification_status === 'Resubmission Required')
          ) {
            setIsResubmittedApplication(false);
            setProfileStatus('Resubmission Required');
            setRejectionReason(verif?.rejection_reason || verif?.remarks || driverData.rejection_reason || state?.rejectionReason || 'Documentary Issue');
            setRejectionComment(verif?.rejection_comment || driverData.rejection_comment || state?.rejectionComment || 'Clearer license scan required');
            setLoading(false);
            return;
          }

          // "Resubmitted" is a fact about ONE application (its resubmitted_at, and the documents it returned that were replaced): it comes
          // from classifyApplication above and from nowhere else. It is NOT read from a shared remark on the verification record or from a
          // flag left in this browser: both outlive the correction they described and then label a plain first submission (or another
          // TODA's application) "Resubmission Review" once the TODA has endorsed it.
          setIsResubmittedApplication(false);

          if (!verif || !verif.submitted_license_number) {
            setIsDocIncomplete(true);
            setIncompleteDriverInfo({
              phone: driverData.contact_number,
              driverName: driverData.full_name,
            });
          } else {
            setIsDocIncomplete(false);
            const endorsed = status
              ? status.kind === 'endorsed_awaiting_lgu'
              : verif.verification_status === 'Approved' ||
                verif.verification_status === 'TODA Approved' ||
                verif.verification_status === 'TODA Endorsed' ||
                verif.verification_status === 'Endorsed to LGU' ||
                driverData.account_status === 'TODA Approved' ||
                driverData.account_status === 'Endorsed to LGU';
            if (endorsed) {
              setProfileStatus('Endorsed to LGU');
              setLoading(false);
              return;
            }
          }
        }

        setProfileStatus(driverData.account_status || 'Pending Verification');
      }
    } catch (err) {
      console.warn('[DriverStatusMonitor] Status check warning:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  React.useEffect(() => {
    checkStatus(false);

    // 1. Periodic background polling every 3.5s to ensure status stays reactive
    const pollInterval = setInterval(() => {
      checkStatus(true);
    }, 3500);

    // 2. Realtime listener for immediate status transition
    const channel = supabase
      .channel('driver-status-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver',
        },
        () => {
          checkStatus(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_verification',
        },
        () => {
          checkStatus(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_toda_affiliation',
        },
        () => {
          checkStatus(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_document',
        },
        () => {
          checkStatus(true);
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleToggleNotify = (checked: boolean) => {
    setNotifyEnabled(checked);
    localStorage.setItem('sakay_driver_notify_status', String(checked));
    setSnackbarMsg(
      checked
        ? (isTagalog
            ? 'Naka-turn on na ang mga abiso kapag nagbago ang status ng rehistrasyon.'
            : 'Notifications turned on for registration status updates.')
        : (isTagalog
            ? 'Naka-off na ang mga abiso sa pagbago ng status.'
            : 'Status notifications turned off.')
    );
    setSnackbarOpen(true);
  };

  const isRejected = profileStatus === 'Rejected';
  const isResubmissionRequired = profileStatus === 'Resubmission Required';
  const isResubmittedAwaitingToda = profileStatus === 'Resubmitted - Awaiting TODA Review';
  // True when TODA has endorsed the driver but LGU has not yet given final approval
  const isEndorsedToLgu = profileStatus === 'Endorsed to LGU';

  // What the driver is asked to correct: the database's list when it has one (every document with its OWN reason, and which TODA / the LGU
  // asked); the shared record's text only for a driver with no TODA application on record.
  const returnedRows = appStatus && appStatus.kind === 'resubmission_required' ? appStatus.returnedDocuments : null;
  const reasonLabel = (code: ReturnReasonCode | null): string =>
    code ? (isTagalog ? RETURN_REASON_TL[code] : RETURN_REASON_LABEL[code]) : '';
  const documentLabel = (doc: ReviewDocumentType): string => (isTagalog ? DOCUMENT_LABEL_TL[doc] : REVIEW_DOCUMENT_LABEL[doc]);
  const formatWhen = (iso: string | null | undefined): string =>
    iso
      ? new Date(iso).toLocaleString(isTagalog ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })
      : '';

  const parsedReturn = returnedRows
    ? {
        faultyDocuments: appStatus!.documentsToResubmit,
        issues: returnedRows.map((r) => ({ documentType: r.document_type, grounds: reasonLabel(r.reason_code), notes: r.reason })),
        displayReason: returnedRows.map((r) => `${documentLabel(r.document_type)}: ${reasonLabel(r.reason_code)}`).join('; '),
        displayNotes: returnedRows.map((r) => `${documentLabel(r.document_type)}: ${r.reason}`).join('; '),
      }
    : parseRejectionComment(rejectionComment, rejectionReason);
  const [hydrating, setHydrating] = useState(false);

  const handleStartCorrection = async () => {
    setHydrating(true);
    try {
      const driverId = localStorage.getItem('sakay_driver_id') || '';
      const phone = localStorage.getItem('sakay_driver_phone') || state?.phone || '';
      if (driverId) {
        await hydrateOnboardingCacheFromExisting(driverId, phone);
      }

      const firstFaulty: FaultyDocType = parsedReturn.faultyDocuments[0] || 'license';
      const routeMap: Record<FaultyDocType, string> = {
        license: '/driver/scan-license-front',
        mtop: '/driver/scan-mtop',
        tricycle: '/driver/scan-tricycle',
        selfie: '/driver/scan-face',
      };

      saveResubmissionSession({
        isResubmission: true,
        faultyDocuments: parsedReturn.faultyDocuments,
        issues: parsedReturn.issues,
        displayReason: parsedReturn.displayReason,
        displayNotes: parsedReturn.displayNotes,
      });

      const targetRoute = routeMap[firstFaulty];
      navigate(targetRoute, {
        state: {
          isResubmission: true,
          faultyDocuments: parsedReturn.faultyDocuments,
          issues: parsedReturn.issues,
          currentDocType: firstFaulty,
          rejectionReason,
          rejectionComment,
          phone,
          driverName: localStorage.getItem('sakay_driver_profile')
            ? JSON.parse(localStorage.getItem('sakay_driver_profile') || '{}').name
            : '',
        },
      });
    } catch (err) {
      console.warn('[DriverStatusMonitor] Error preparing correction:', err);
    } finally {
      setHydrating(false);
    }
  };


  // Per document, for an application that was resubmitted: the replaced ones say so with the date; nothing is marked as approved.
  const documentStatesCard =
    appStatus && (appStatus.kind === 'resubmitted_awaiting_toda' || appStatus.kind === 'resubmitted_awaiting_lgu') ? (
      <Paper
        elevation={0}
        sx={{ width: '100%', maxWidth: 340, p: 2.5, borderRadius: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', textAlign: 'left', mb: 2 }}
      >
        <Typography sx={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', mb: 1 }}>
          {isTagalog ? 'Mga Dokumento' : 'Documents'}
        </Typography>
        {REVIEW_DOCUMENT_ORDER.filter((doc) => doc !== 'selfie' || appStatus.documentStates[doc] !== 'not_returned').map((doc) => {
          const state = appStatus.documentStates[doc];
          const when = appStatus.resubmittedDocuments.find((d) => d.document_type === doc)?.resubmitted_at;
          const resubmitted = state === 'resubmitted';
          return (
            <Box key={doc} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.6 }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>{documentLabel(doc)}</Typography>
              <Chip
                size="small"
                label={
                  resubmitted
                    ? `${isTagalog ? 'Naisumite muli' : 'Resubmitted'}${when ? ` · ${formatWhen(when)}` : ''}`
                    : isTagalog
                    ? 'Hindi ibinalik'
                    : 'Not returned'
                }
                sx={{
                  backgroundColor: resubmitted ? '#EDE9FE' : '#E2E8F0',
                  color: resubmitted ? '#4C1D95' : '#475569',
                  fontWeight: 700,
                  fontSize: '11px',
                  height: 'auto',
                  '& .MuiChip-label': { whiteSpace: 'normal', py: '3px' },
                }}
              />
            </Box>
          );
        })}
        <Typography sx={{ fontSize: '11.5px', color: '#64748B', mt: 1 }}>
          {isTagalog
            ? 'Hindi pa ito aprubado: ang pagsusuri ng reviewer ang magpapasya.'
            : 'These are NOT approved yet: the reviewer decides after looking at what you resubmitted.'}
        </Typography>
      </Paper>
    ) : null;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Sticky Top Bar */}
      {/* Pinned Header with Centered SAKAY Orange Logo */}
      <Box
        sx={{
          padding: 'calc(var(--safe-area-top) + 16px) 24px 16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid #F1F5F9',
          backgroundColor: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        <Logo color="orange" width={110} />
      </Box>

      {/* Main Centered Content Area */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 3,
          py: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {isRejected ? (
          <>
            <Box
              sx={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                backgroundColor: '#FEF2F2',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 3,
                boxShadow: '0 8px 24px rgba(220, 38, 38, 0.15)',
              }}
            >
              <PendingActionsIcon sx={{ fontSize: 40 }} />
            </Box>

            <Typography
              sx={{
                fontSize: '22px',
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.3,
                mb: 1.5,
              }}
            >
              {isTagalog ? 'Hindi Na-aprubahan ang Aplikasyon' : 'Application Not Approved'}
            </Typography>

            <Typography
              sx={{
                fontSize: '14px',
                color: '#64748B',
                lineHeight: 1.5,
                maxWidth: 320,
                mb: 3,
              }}
            >
              {isTagalog
                ? 'Ang iyong rehistrasyon ay tinanggihan ng TODA Administrator matapos ang masusing pagsusuri.'
                : 'Your registration was rejected by the TODA Administrator after careful review.'}
            </Typography>

            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: 2.5,
                borderRadius: '16px',
                backgroundColor: '#FFF5F5',
                border: '1px solid #FECDD3',
                textAlign: 'left',
                mb: 4,
              }}
            >
              <Typography sx={{ fontSize: '11px', fontWeight: 800, color: '#BE123C', letterSpacing: '0.5px', textTransform: 'uppercase', mb: 1 }}>
                {isTagalog ? 'Dahilan ng Pagtanggi:' : 'Reason for Rejection:'}
              </Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#9F1239', mb: 1 }}>
                {rejectionReasonParts(rejectionReason, isTagalog ? 'tl' : 'en').label || (isTagalog ? 'Hindi natagpuan sa Master Roster ng TODA.' : 'Not found in TODA Master Roster.')}
              </Typography>
              {(rejectionComment || rejectionReasonParts(rejectionReason).note) && (
                <Typography sx={{ fontSize: '13px', color: '#881337', lineHeight: 1.4 }}>
                  {isTagalog ? 'Paliwanag:' : 'Comment:'} "{rejectionComment || rejectionReasonParts(rejectionReason).note}"
                </Typography>
              )}
            </Paper>

            {/* A rejection is final: there is no way to re-apply from this app (only the City LGU can reopen a case) */}
            <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, maxWidth: 330, mt: -2, mb: 3, fontWeight: 600 }}>
              {isTagalog
                ? 'Pinal na ang desisyong ito. Hindi ka na makakapag-apply muli sa TODA na ito. Para sa katanungan, makipag-ugnayan sa TODA o sa City LGU Transport Office.'
                : 'This decision is final. You cannot re-apply to this TODA. For questions, please contact the TODA or the City LGU Transport Office.'}
            </Typography>
          </>
        ) : isEndorsedToLgu ? (
          <>
            {/* LGU Review State — TODA endorsed but awaiting LGU final approval */}
            <Box
              sx={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                backgroundColor: '#EFF6FF',
                color: '#0066CC',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 3,
                boxShadow: '0 8px 24px rgba(0, 102, 204, 0.15)',
              }}
            >
              <PendingActionsIcon sx={{ fontSize: 40 }} />
            </Box>

            <Typography
              sx={{
                fontSize: '22px',
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.3,
                mb: 1.5,
              }}
            >
              {isResubmittedApplication
                ? (isTagalog ? 'Naisumite na ang Pagwawasto - Kasalukuyang Sinusuri ng LGU' : 'Resubmission Submitted - Under LGU Review')
                : (isTagalog ? 'Nasa LGU Admin na ang Aplikasyon' : 'Application Endorsed to LGU Admin')}
            </Typography>

            <Typography
              sx={{
                fontSize: '14px',
                color: '#64748B',
                lineHeight: 1.5,
                maxWidth: 330,
                mb: 3,
              }}
            >
              {isResubmittedApplication
                ? (isTagalog
                    ? 'Matagumpay na naisumite ang iyong mga binagong dokumento. Kasalukuyan itong muling sinusuri ng City LGU Transport Office. Muling nag-restart ang 5-araw na review period.'
                    : 'Your corrected documents have been submitted successfully. The City LGU Transport Office is now re-reviewing your application. The 5-day review period has restarted.')
                : (isTagalog
                    ? 'Matagumpay na na-endorse ng iyong TODA ang iyong aplikasyon sa City LGU Transport Office. Pakihintay ang huling pagsusuri at pag-apruba ng LGU. Hindi mo pa maa-access ang iyong account hanggang sa mabigyan ka ng pinal na pahintulot.'
                    : 'Your application has been endorsed by your TODA to the City LGU Transport Office. Please wait for the final review and approval of the LGU. You will not be able to access your account until final approval is granted.')}
            </Typography>

            {documentStatesCard}

            {/* Status ng Rehistrasyon Card */}
            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: 2.5,
                borderRadius: '16px',
                backgroundColor: isResubmittedApplication ? '#F5F3FF' : '#EFF6FF',
                border: `1px solid ${isResubmittedApplication ? '#DDD6FE' : '#BFDBFE'}`,
                textAlign: 'left',
                mb: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '12px', fontWeight: 800, color: isResubmittedApplication ? '#5B21B6' : '#1E40AF', textTransform: 'uppercase' }}>
                  {isTagalog ? 'Status ng Rehistrasyon' : 'Registration Status'}
                </Typography>
                <Chip
                  label={isResubmittedApplication ? (isTagalog ? 'Pagsusuri sa Pagwawasto' : 'Resubmission Review') : 'LGU Screening'}
                  size="small"
                  sx={{
                    backgroundColor: isResubmittedApplication ? '#EDE9FE' : '#DBEAFE',
                    color: isResubmittedApplication ? '#4C1D95' : '#1D4ED8',
                    fontWeight: 800,
                    fontSize: '11px',
                  }}
                />
              </Box>
            </Paper>

            {/* Tagalog/English Notification Switch Preference Card */}
            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: '14px 18px',
                borderRadius: '16px',
                backgroundColor: notifyEnabled ? '#EFF6FF' : '#F8FAFC',
                border: `1.5px solid ${notifyEnabled ? '#0066CC' : '#E2E8F0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 4,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1 }}>
                <NotificationsActiveOutlinedIcon
                  sx={{ color: notifyEnabled ? '#0066CC' : '#64748B', fontSize: 22 }}
                />
                <Box sx={{ textAlign: 'left' }}>
                  <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>
                    {isTagalog ? 'I-notify ako kapag nagbago ang status' : 'Notify me when status changes'}
                  </Typography>
                  <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontWeight: 500, mt: '2px' }}>
                    {isTagalog ? 'Magpapadala ng SMS kapag na-aprubahan ng LGU' : 'SMS will be sent upon LGU approval'}
                  </Typography>
                </Box>
              </Box>

              <Switch
                checked={notifyEnabled}
                onChange={(e) => handleToggleNotify(e.target.checked)}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: '#0066CC',
                    '& + .MuiSwitch-track': { backgroundColor: '#0066CC', opacity: 0.9 },
                  },
                }}
              />
            </Paper>
          </>
        ) : isResubmittedAwaitingToda ? (
          <>
            {/* Resubmitted: waiting for the TODA again. Never says the documents passed. */}
            <Box
              sx={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                backgroundColor: '#F5F3FF',
                color: '#6D28D9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 3,
                boxShadow: '0 8px 24px rgba(109, 40, 217, 0.15)',
              }}
            >
              <PendingActionsIcon sx={{ fontSize: 40 }} />
            </Box>

            <Typography sx={{ fontSize: '22px', fontWeight: 800, color: '#0F172A', lineHeight: 1.3, mb: 1.5 }}>
              {isTagalog ? 'Naisumite Muli — Hinihintay ang Pagsusuri ng TODA' : 'Resubmitted, Awaiting TODA Review'}
            </Typography>

            <Typography sx={{ fontSize: '14px', color: '#64748B', lineHeight: 1.5, maxWidth: 340, mb: 3 }}>
              {isTagalog
                ? `Naisumite mo muli ang iyong mga dokumento noong ${formatWhen(appStatus?.resubmittedAt)}. Muling sinusuri ng TODA ang iyong aplikasyon at nag-restart ang 5-araw na review period mula sa petsang iyon. Hindi pa aprubado ang iyong mga dokumento.`
                : `You resubmitted your documents on ${formatWhen(appStatus?.resubmittedAt)}. The TODA is reviewing your application again and the 5-calendar-day review period restarted on that date. Your documents have not been approved yet.`}
            </Typography>

            {documentStatesCard}

            <Paper
              elevation={0}
              sx={{ width: '100%', maxWidth: 340, p: 2.5, borderRadius: '16px', backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE', textAlign: 'left', mb: 4 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '12px', fontWeight: 800, color: '#5B21B6', textTransform: 'uppercase' }}>
                  {isTagalog ? 'Status ng Rehistrasyon' : 'Registration Status'}
                </Typography>
                <Chip
                  label={isTagalog ? 'Muling Sinusuri ng TODA' : 'TODA Re-review'}
                  size="small"
                  sx={{ backgroundColor: '#EDE9FE', color: '#4C1D95', fontWeight: 800, fontSize: '11px' }}
                />
              </Box>
            </Paper>
          </>
        ) : isResubmissionRequired ? (
          <>
            <Box
              sx={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                backgroundColor: '#FFFBEB',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 3,
                boxShadow: '0 8px 24px rgba(217, 119, 6, 0.15)',
              }}
            >
              <PendingActionsIcon sx={{ fontSize: 40 }} />
            </Box>

            <Typography
              sx={{
                fontSize: '22px',
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.3,
                mb: 1.5,
              }}
            >
              {isTagalog ? 'Kinakailangan ang Pagwawasto' : 'Resubmission Required'}
            </Typography>

            <Typography
              sx={{
                fontSize: '14px',
                color: '#64748B',
                lineHeight: 1.5,
                maxWidth: 340,
                mb: 3,
              }}
            >
              {isTagalog
                ? 'Ibinalik ng reviewer ang iyong aplikasyon dahil sa mga kulang o hindi wastong dokumento. Mag-restart ang 5-araw na review period matapos mong mai-sumite muli ang mga pagwawasto.'
                : 'Your application was returned by the reviewer for correction. The 5-calendar-day review period restarts once resubmitted.'}
            </Typography>

            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: 2,
                borderRadius: '16px',
                backgroundColor: '#FFFBEB',
                border: '1.5px solid #FDE68A',
                textAlign: 'left',
                mb: 3,
              }}
            >
              <Typography sx={{ fontSize: '11px', fontWeight: 800, color: '#B45309', letterSpacing: '0.5px', textTransform: 'uppercase', mb: 1.5 }}>
                {isTagalog ? 'Kailangang Iwasto na Dokumento:' : 'Documents Requiring Correction:'}
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                {parsedReturn.issues.map((issue, idx) => {
                  const row = returnedRows ? returnedRows[idx] : null;
                  return (
                    <Box
                      key={idx}
                      sx={{
                        p: 1.5,
                        borderRadius: '10px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #FEF3C7',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                        <Chip
                          label={documentLabel(issue.documentType)}
                          size="small"
                          sx={{
                            fontSize: '11px',
                            fontWeight: 800,
                            backgroundColor: '#FEF3C7',
                            color: '#92400E',
                            height: 22,
                          }}
                        />
                        {row && (
                          <Typography sx={{ fontSize: '11px', color: '#92400E', fontWeight: 600 }}>
                            {isTagalog ? 'Ibinalik ng' : 'Returned by'} {row.stage === 'LGU' ? 'LGU' : row.toda_acronym}
                            {row.returned_at ? ` · ${formatWhen(row.returned_at)}` : ''}
                          </Typography>
                        )}
                      </Box>
                      <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#78350F', mb: 0.25 }}>
                        {issue.grounds}
                      </Typography>
                      {issue.notes && (
                        <Typography sx={{ fontSize: '12px', color: '#92400E', fontStyle: 'italic', lineHeight: 1.35 }}>
                          "{issue.notes}"
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Paper>

            <Box sx={{ width: '100%', maxWidth: 340, mb: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <PrimaryButton
                fullWidth
                disabled={hydrating}
                onClick={handleStartCorrection}
                sx={{
                  height: '52px',
                  borderRadius: '14px',
                  fontSize: '15px',
                  fontWeight: 800,
                  backgroundColor: '#D97706',
                  boxShadow: 'none',
                  '&:hover': { backgroundColor: '#B45309', boxShadow: 'none' },
                }}
              >
                {hydrating
                  ? (isTagalog ? 'Inihahanda...' : 'Preparing...')
                  : parsedReturn.faultyDocuments.length === 1
                  ? (isTagalog ? 'Iwasto ang Dokumento' : 'Correct Document')
                  : (isTagalog
                      ? `Iwasto ang mga Dokumento (${parsedReturn.faultyDocuments.length})`
                      : `Correct Documents (${parsedReturn.faultyDocuments.length})`)}
              </PrimaryButton>
            </Box>
          </>
        ) : (
          <>
            <Box
              sx={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                backgroundColor: '#FFF8F0',
                color: '#FF6B00',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 3,
                boxShadow: '0 8px 24px rgba(255, 107, 0, 0.15)',
              }}
            >
              <PendingActionsIcon sx={{ fontSize: 40 }} />
            </Box>

            <Typography
              sx={{
                fontSize: '22px',
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.3,
                mb: 1.5,
              }}
            >
              {isDocIncomplete
                ? (isTagalog ? 'Kailangan mong Ipasa ang mga Dokumento' : 'Document Submission Required')
                : (isTagalog ? 'Patuloy na sinusuri ang iyong aplikasyon.' : 'Your application is currently under review.')}
            </Typography>

            <Typography
              sx={{
                fontSize: '14px',
                color: '#64748B',
                lineHeight: 1.5,
                maxWidth: 320,
                mb: 3,
              }}
            >
              {isDocIncomplete
                ? (isTagalog
                    ? 'Narehistro na ang iyong account, ngunit kailangan mo pang ipasa ang iyong Lisensya, MTOP Permit, Larawan ng Traysikel, at Selfie upang masuri ng iyong napiling TODA.'
                    : 'Your account is registered, but you still need to submit your License, MTOP Permit, Tricycle Photo, and Selfie for review by your TODA.')
                : (isTagalog
                    ? 'Pakihintay habang sinusuri ng TODA at LGU ang iyong mga isinumiteng impormasyon. Hindi mo muna maa-access ang iyong account at mga serbisyo habang nakabinbin pa ang pinal na pag-apruba.'
                    : 'Please wait while TODA and LGU review your submitted details. Account and service access remain restricted while pending final approval.')}
            </Typography>

            {isDocIncomplete && (
              <Box sx={{ width: '100%', maxWidth: 340, mb: 3 }}>
                <PrimaryButton
                  fullWidth
                  onClick={() =>
                    navigate('/driver/prepare-documents', {
                      state: incompleteDriverInfo || {
                        phone: localStorage.getItem('sakay_driver_phone') || '',
                        driverName: isTagalog ? 'Bagong Drayber' : 'New Driver',
                      },
                    })
                  }
                  sx={{
                    height: '52px',
                    borderRadius: '14px',
                    fontSize: '15px',
                    fontWeight: 800,
                    backgroundColor: '#FF6B00',
                    boxShadow: 'none',
                    '&:hover': { backgroundColor: '#E66000', boxShadow: 'none' },
                  }}
                >
                  {isTagalog ? 'Ipagpatuloy ang Pagpasa ng Dokumento' : 'Continue Document Submission'}
                </PrimaryButton>
              </Box>
            )}

            {/* Status ng Rehistrasyon Card */}
            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: 2.5,
                borderRadius: '16px',
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                textAlign: 'left',
                mb: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase' }}>
                  {isTagalog ? 'Status ng Rehistrasyon' : 'Registration Status'}
                </Typography>
                <Chip
                  label={
                    isDocIncomplete
                      ? (isTagalog ? 'Kailangan ng Dokumento' : 'Documents Required')
                      : 'TODA Screening'
                  }
                  size="small"
                  sx={{
                    backgroundColor: isDocIncomplete ? '#FEE2E2' : '#FEF3C7',
                    color: isDocIncomplete ? '#DC2626' : '#B45309',
                    fontWeight: 800,
                    fontSize: '11px',
                  }}
                />
              </Box>
            </Paper>

            {/* Per-TODA review status (Driver Module 2.1 / Policy 3.1) */}
            {affiliations.length > 0 && (
              <Paper
                elevation={0}
                sx={{
                  width: '100%',
                  maxWidth: 340,
                  p: 2.5,
                  borderRadius: '16px',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  textAlign: 'left',
                  mb: 2,
                }}
              >
                <Typography sx={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', mb: 1 }}>
                  {isTagalog ? 'Ang iyong mga TODA' : 'Your TODAs'}
                </Typography>
                {affiliations.map((aff) => (
                  <Box
                    key={aff.affiliationId}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.5 }}
                  >
                    <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>{aff.todaAcronym}</Typography>
                    <Chip
                      label={aff.statusLabel}
                      size="small"
                      sx={{
                        backgroundColor: aff.isSelectable ? '#DCFCE7' : '#FEF3C7',
                        color: aff.isSelectable ? '#15803D' : '#B45309',
                        fontWeight: 800,
                        fontSize: '11px',
                      }}
                    />
                  </Box>
                ))}
                <Typography sx={{ fontSize: '11.5px', color: '#64748B', mt: 1 }}>
                  {isTagalog
                    ? 'Bawat TODA ay sinusuri nang hiwalay. Maaari kang mag-online kapag may kahit isa nang ganap na aprubado.'
                    : 'Each TODA is reviewed separately. You can go online once at least one is fully approved.'}
                </Typography>
              </Paper>
            )}

            {/* Notification Switch Preference Card */}
            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 340,
                p: '14px 18px',
                borderRadius: '16px',
                backgroundColor: notifyEnabled ? '#FFF5EF' : '#F8FAFC',
                border: `1.5px solid ${notifyEnabled ? '#FF6B00' : '#E2E8F0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 4,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1 }}>
                <NotificationsActiveOutlinedIcon
                  sx={{ color: notifyEnabled ? '#FF6B00' : '#64748B', fontSize: 22 }}
                />
                <Box sx={{ textAlign: 'left' }}>
                  <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>
                    {isTagalog ? 'I-notify ako kapag nagbago ang status' : 'Notify me when status changes'}
                  </Typography>
                  <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontWeight: 500, mt: '2px' }}>
                    {isTagalog ? 'Magpapadala ng SMS kapag na-aprubahan' : 'SMS will be sent once approved'}
                  </Typography>
                </Box>
              </Box>

              <Switch
                checked={notifyEnabled}
                onChange={(e) => handleToggleNotify(e.target.checked)}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: '#FF6B00',
                    '& + .MuiSwitch-track': { backgroundColor: '#FF6B00', opacity: 0.9 },
                  },
                }}
              />
            </Paper>
          </>
        )}
      </Box>

      {/* Snackbar Notification Toast */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ top: "calc(var(--safe-area-top) + 16px) !important" }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity={notifyEnabled ? 'success' : 'info'}
          sx={{ width: '100%', borderRadius: '12px', fontWeight: 600, fontSize: '13px', boxShadow: "0 8px 24px rgba(15, 23, 42, 0.15)" }}
        >
          {snackbarMsg}
        </Alert>
      </Snackbar>

      {/* Pinned Single Action Button */}
      <Box
        sx={{
          p: 3,
          pt: 1.5,
          pb: 'calc(var(--safe-area-bottom) + 20px)',
          backgroundColor: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        {!isRejected && (
          <PrimaryButton
            fullWidth
            size="large"
            onClick={() => checkStatus(false)}
            disabled={loading}
            sx={{
              backgroundColor: '#FF6B00',
              '&:hover': { backgroundColor: '#E66000' },
            }}
          >
            {loading ? (
              isTagalog ? 'Kinukumpirma...' : 'Checking...'
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <RefreshIcon sx={{ fontSize: 18 }} />
                {isTagalog ? 'I-refresh ang Status' : 'Refresh Status'}
              </Box>
            )}
          </PrimaryButton>
        )}

        {/* Sign Out (a rejected driver has no "apply again": the rejection is final) */}
        <Box
          component="button"
          type="button"
          onClick={async () => {
            try {
              await supabase.auth.signOut();
              localStorage.removeItem('sakay_driver_phone');
              localStorage.removeItem('sakay_driver_id');
              localStorage.removeItem('sakay_driver_profile');
              localStorage.removeItem('sakay_driver_toda_id');
              localStorage.removeItem('sakay_driver_toda_ids');
              localStorage.removeItem('sakay_driver_onboarding_cache');
              sessionStorage.clear();
            } catch {}
            navigate('/account-selection', { replace: true });
          }}
          sx={{
            mt: isRejected ? 0 : 1.5,
            width: '100%',
            height: '48px',
            borderRadius: '14px',
            backgroundColor: '#F8FAFC',
            border: '1.5px solid #E2E8F0',
            color: '#475569',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            outline: 'none',
            fontFamily: 'inherit',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              backgroundColor: '#F1F5F9',
              borderColor: '#CBD5E1',
              color: '#0F172A',
              transform: 'translateY(-1px)',
            },
            '&:active': {
              backgroundColor: '#E2E8F0',
              transform: 'translateY(0)',
            },
          }}
        >
          <LogoutIcon sx={{ fontSize: 18, color: 'inherit' }} />
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'inherit' }}>
            {isRejected
              ? (isTagalog ? 'Mag-sign out' : 'Sign Out')
              : (isTagalog ? 'Mag-sign out / Gumawa ng Bagong Aplikasyon' : 'Sign Out / New Application')}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default DriverStatusMonitor;
