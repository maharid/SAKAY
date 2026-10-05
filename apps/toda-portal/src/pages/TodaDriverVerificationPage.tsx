import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  Checkbox,
  FormControlLabel,
  Avatar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Snackbar,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import InboxIcon from '@mui/icons-material/Inbox';
import VerifiedIcon from '@mui/icons-material/Verified';
import ShieldIcon from '@mui/icons-material/Shield';
import DescriptionIcon from '@mui/icons-material/Description';

import { DriverApplicant } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { DocumentPreviewModal } from '../components/admin/DocumentPreviewModal';
import {
  fetchDriverApplicants,
  fetchTodaDrivers,
  fetchTodaProfile,
  forwardApplicantToLgu,
  rejectDriverApplicant,
  requestDriverResubmission,
  recordTodaAuditAction,
} from '../services/todaApiService';
import { useAuth } from '../contexts/AuthContext';
import type { DocumentReturnInput } from '../services/todaApiService';
import { REJECTION_REASON_CODES, REJECTION_REASON_LABEL, rejectionReasonParts } from '@sakay/shared';
import type { RejectionReasonCode, ReturnReasonCode, ReviewDocumentType } from '@sakay/shared';

// ---- Return for correction (Rules 3.6, 3.8): the TODA names the documents and says why. Rejecting (fraud / ineligible) is a different action.
const RETURN_DOCUMENTS: { value: ReviewDocumentType; label: string }[] = [
  { value: 'license', label: "Driver's License (front & back)" },
  { value: 'mtop', label: 'MTOP / Franchise Permit' },
  { value: 'tricycle', label: 'Tricycle Unit Photo' },
  { value: 'selfie', label: 'Selfie / Face Photo' },
];

const RETURN_REASONS: { value: ReturnReasonCode; label: string }[] = [
  { value: 'blurry', label: 'Blurry / hard to read' },
  { value: 'expired', label: 'Expired' },
  { value: 'mismatch', label: 'Information does not match' },
  { value: 'wrong_document', label: 'Wrong document' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'other', label: 'Other' },
];

type ReturnForm = Record<ReviewDocumentType, { checked: boolean; code: ReturnReasonCode; reason: string }>;

const emptyReturnForm = (): ReturnForm => ({
  license: { checked: false, code: 'blurry', reason: '' },
  mtop: { checked: false, code: 'blurry', reason: '' },
  tricycle: { checked: false, code: 'blurry', reason: '' },
  selfie: { checked: false, code: 'blurry', reason: '' },
});

const reasonLabelOf = (code?: string | null): string => RETURN_REASONS.find((r) => r.value === code)?.label || '';
const documentLabelOf = (doc: string): string => RETURN_DOCUMENTS.find((d) => d.value === doc)?.label || doc;

const formatWhen = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : '';

/** Stage statuses in which the TODA can still decide (endorse, return or reject). */
const DECIDABLE_STAGES = ['Awaiting Screening', 'Submitted', 'TODA Review'];

// toda driver application screening and lgu endorsement page
export const TodaDriverVerificationPage: React.FC = () => {
  const { todaAdminProfile } = useAuth();
  const effectiveTodaId = todaAdminProfile?.toda_id;

  const [applicants, setApplicants] = useState<DriverApplicant[]>([]);
  const [lguVerifiedCount, setLguVerifiedCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [rosterFilter, setRosterFilter] = useState('All');
  
  const [todaStatus, setTodaStatus] = useState<string>('Active');

  // Selected Applicant for Review Modal
  const [selectedApplicant, setSelectedApplicant] = useState<DriverApplicant | null>(null);
  const [previewDocData, setPreviewDocData] = useState<{
    name: string;
    type: string;
    url?: string | null;
  } | null>(null);

  // Review Checkbox States
  const [rosterChecked, setRosterChecked] = useState(false);
  const [photoChecked, setPhotoChecked] = useState(false);

  // Confirmation & Celebratory Dialogs & Submission Guard
  const [forwardDialogOpen, setForwardDialogOpen] = useState(false);
  const [celebrateDialogOpen, setCelebrateDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnForm, setReturnForm] = useState<ReturnForm>(emptyReturnForm());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Why the last endorsement failed, shown INSIDE the confirm dialog (which stays open) as well as in the toast
  const [forwardError, setForwardError] = useState<string | null>(null);

  // Toast / Snackbar Notification State
  const [toastOpen, setToastOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error'>('success');

  // Rejection form (permanent): a reason from the fixed list is REQUIRED and starts empty, so it is always a conscious choice; the note is optional
  const [rejectReason, setRejectReason] = useState<RejectionReasonCode | ''>('');
  const [rejectNote, setRejectNote] = useState<string>('');

  const openRejectDialog = () => {
    setRejectReason('');
    setRejectNote('');
    setRejectDialogOpen(true);
  };

  const loadApplicants = (silent = false) => {
    if (!silent) setIsLoading(true);
    const targetId = effectiveTodaId || todaAdminProfile?.toda_id;

    fetchTodaProfile(targetId).then((profile) => {
      if (profile) setTodaStatus(profile.accreditationStatus);
    });

    Promise.all([
      fetchDriverApplicants(targetId),
      fetchTodaDrivers(targetId),
    ])
      .then(([apps, drvs]) => {
        // The roster match comes with each application, from the database (the same rule as the endorsement): no guessing by name here.
        const loaded = apps || [];
        setApplicants(loaded);
        // an open review window follows the fresh data (a driver may have resubmitted while it was open)
        setSelectedApplicant((prev) => (prev ? loaded.find((a) => a.id === prev.id) ?? prev : prev));
        const verified = (drvs || []).filter((d) => d.lguVerificationStatus === 'Verified').length;
        setLguVerifiedCount(verified);
      })
      .catch((err) => {
        console.error('[TodaVerification] Failed to fetch applicants from database:', err);
        setApplicants([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    loadApplicants();
    // Every 30 seconds, quietly: a returned application that the driver resubmits appears here without reloading the page.
    const timer = setInterval(() => loadApplicants(true), 30000);
    return () => clearInterval(timer);
  }, [effectiveTodaId]);

  // Filter Logic
  const filteredApplicants = applicants.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.licenseNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.franchiseNo.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Resubmitted' ? Boolean(app.isResubmitted) : app.todaStageStatus === statusFilter);

    let matchesRoster = true;
    if (rosterFilter === 'Matched') matchesRoster = app.rosterMatchKnown !== false && app.onSubmittedRoster;
    if (rosterFilter === 'Mismatch') matchesRoster = app.rosterMatchKnown !== false && !app.onSubmittedRoster;

    return matchesSearch && matchesStatus && matchesRoster;
  }).sort((a, b) => Number(Boolean(b.isResubmitted)) - Number(Boolean(a.isResubmitted)));   // resubmissions first, the rest keep their order

  // KPI Metrics (Accurate TODA Operational Governance Breakdown)
  const pendingCount = applicants.filter(
    (a) => a.todaStageStatus === 'Awaiting Screening' || a.todaStageStatus === 'Submitted' || a.todaStageStatus === 'TODA Review'
  ).length;

  const resubmittedCount = applicants.filter((a) => a.isResubmitted).length;

  const overdueCount = applicants.filter(
    (a) => a.isOverdue && (a.todaStageStatus === 'Awaiting Screening' || a.todaStageStatus === 'Submitted' || a.todaStageStatus === 'TODA Review')
  ).length;

  const endorsedCount = applicants.filter(
    (a) => a.todaStageStatus === 'Endorsed to LGU' || a.todaStageStatus === 'TODA Endorsed'
  ).length;

  const statusOptions: FilterOption[] = [
    { label: 'All Stage Statuses', value: 'All' },
    { label: 'Resubmitted (back in TODA review)', value: 'Resubmitted' },
    { label: 'Awaiting Screening (Pending TODA)', value: 'Awaiting Screening' },
    { label: 'TODA Review (In Progress)', value: 'TODA Review' },
    { label: 'Endorsed to LGU (Sent to LGU Review)', value: 'Endorsed to LGU' },
    { label: 'Resubmission Required', value: 'Resubmission Required' },
    { label: 'Rejected (TODA Level)', value: 'Rejected' },
  ];

  const rosterOptions: FilterOption[] = [
    { label: 'All Roster Records', value: 'All' },
    { label: 'Master Roster Verified', value: 'Matched' },
    { label: 'Roster Mismatch Flag', value: 'Mismatch' },
  ];

  const handleOpenReview = (app: DriverApplicant) => {
    setSelectedApplicant(app);
    setRosterChecked(app.rosterVerified);
    setPhotoChecked(app.photoVerified);
    setForwardError(null);
  };

  /** What the database (or the network) said, as a sentence for the TODA administrator. Never empty. */
  const reasonOf = (err: unknown): string => {
    const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    return text.trim() || 'Walang detalyeng ibinalik ng server.';
  };

  /**
   * The "Endorse to City LGU" button. It always answers: with the checklist complete it opens the confirmation; otherwise it says which
   * box is missing (it used to do nothing at all, which looked like a broken button).
   */
  const handleEndorseClick = () => {
    if (!rosterChecked || !photoChecked) {
      const missing = [!rosterChecked && 'roster', !photoChecked && 'photo'].filter(Boolean);
      setToastMessage(
        `Kumpletuhin muna ang TODA Officer Screening Checklist bago mag-endorse: lagyan ng tsek ang ${
          missing.length === 2 ? 'dalawang kahon (roster at larawan)' : missing[0] === 'roster' ? 'kahon ng roster' : 'kahon ng larawan'
        }.`
      );
      setToastSeverity('error');
      setToastOpen(true);
      return;
    }
    setForwardError(null);
    setForwardDialogOpen(true);
  };

  const handleForwardConfirm = async () => {
    if (!selectedApplicant || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await forwardApplicantToLgu(selectedApplicant.id);

      if (!res || !res.success) {
        // Say WHY, where the administrator is looking: inside the dialog (it stays open) and in the toast
        const detail = reasonOf((res as any)?.error ?? 'Database save returned unsuccessful status');
        console.error('[TodaVerification] Endorsement update failed in Supabase:', detail);
        setForwardError(detail);
        setToastMessage(`Hindi ma-endorse ang aplikasyon sa LGU: ${detail}`);
        setToastSeverity('error');
        setToastOpen(true);
        return;
      }
      setForwardError(null);

      // ONLY update UI to "Endorsed to LGU" AFTER Supabase update succeeds!
      setApplicants((prev) =>
        prev.map((a) => (a.id === selectedApplicant.id ? { ...a, todaStageStatus: 'Endorsed to LGU', rosterVerified: true, photoVerified: true } : a))
      );

      recordTodaAuditAction({
        actionType: 'DRIVER_APPLICANT_ENDORSED_TO_LGU',
        targetId: selectedApplicant.id,
        targetName: selectedApplicant.name,
        details: `Screened and endorsed driver ${selectedApplicant.name} (${selectedApplicant.vehiclePlate}) to City LGU Franchising Office for official accreditation.`,
        category: 'Driver Verification',
      });

      setForwardDialogOpen(false);
      setToastMessage('Matagumpay na na-endorse ang aplikasyon sa LGU.');
      setToastSeverity('success');
      setToastOpen(true);
      setCelebrateDialogOpen(true);

      // Re-fetch driver applicant list from Supabase to verify persistent state
      loadApplicants();
    } catch (err) {
      console.error('[TodaVerification] Endorsement exception:', err);
      const detail = reasonOf(err);
      setForwardError(detail);
      setToastMessage(`Hindi ma-endorse ang aplikasyon sa LGU: ${detail}`);
      setToastSeverity('error');
      setToastOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!selectedApplicant || !rejectReason || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const rejectRes = await rejectDriverApplicant(selectedApplicant.id, rejectReason, rejectNote);
      if (!rejectRes || !rejectRes.success) {
        // Each affiliation is decided by the database: show its refusal instead of pretending the application was rejected.
        console.error('[TodaVerification] Rejection was not saved:', (rejectRes as any)?.error);
        setToastMessage(`Hindi na-save ang pagtanggi sa aplikasyon: ${reasonOf((rejectRes as any)?.error)}`);
        setToastSeverity('error');
        setToastOpen(true);
        return;
      }

      setApplicants((prev) =>
        prev.map((a) => (a.id === selectedApplicant.id ? { ...a, todaStageStatus: 'Rejected' } : a))
      );

      const note = rejectNote.trim();
      recordTodaAuditAction({
        actionType: 'DRIVER_APPLICANT_REJECTED',
        targetId: selectedApplicant.id,
        targetName: selectedApplicant.name,
        details: `Rejected driver applicant ${selectedApplicant.name} at TODA level (final). Reason: ${REJECTION_REASON_LABEL[rejectReason]}${note ? `. Note: ${note}` : ''}`,
        category: 'Driver Verification',
      });

      setRejectDialogOpen(false);
      setSelectedApplicant(null);
      setRejectReason('');
      setRejectNote('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openReturnDialog = () => {
    setReturnForm(emptyReturnForm());
    setReturnDialogOpen(true);
  };

  const returnSelection = RETURN_DOCUMENTS.filter((d) => returnForm[d.value].checked);
  const returnIsComplete =
    returnSelection.length > 0 && returnSelection.every((d) => returnForm[d.value].reason.trim().length > 0);

  const handleReturnConfirm = async () => {
    if (!selectedApplicant || isSubmitting || !returnIsComplete) return;

    const documents: DocumentReturnInput[] = returnSelection.map((d) => ({
      documentType: d.value,
      reasonCode: returnForm[d.value].code,
      reason: returnForm[d.value].reason.trim(),
    }));

    setIsSubmitting(true);
    try {
      await requestDriverResubmission(selectedApplicant.id, documents);

      setToastMessage(
        `Naibalik ang aplikasyon ni ${selectedApplicant.name}. Hihilingin lamang sa drayber: ${returnSelection.map((d) => d.label).join(', ')}.`
      );
      setToastSeverity('success');
      setToastOpen(true);
      setReturnDialogOpen(false);
      setSelectedApplicant(null);
      loadApplicants(true);
    } catch (err) {
      console.error('[TodaVerification] Return for correction error:', err);
      setToastMessage(`Hindi naibalik ang aplikasyon: ${(err as Error)?.message || 'Pakisubukang muli.'}`);
      setToastSeverity('error');
      setToastOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canEndorse = rosterChecked && photoChecked;

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {todaStatus === 'Pending Verification' && (
        <Box sx={{ mb: 3.5, backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 'var(--mac-radius-lg)', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 2 }}>
          <WarningAmberIcon sx={{ color: '#DC2626', fontSize: 26, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#991B1B', mb: '3px' }}>
              Pending TODA LGU Accreditation
            </Typography>
            <Typography sx={{ fontSize: '13.5px', color: '#B91C1C', lineHeight: 1.4 }}>
              Your TODA organization is currently under review by the City Transport Office. Driver endorsement tools and membership management features are temporarily locked until your application is approved.
            </Typography>
          </Box>
        </Box>
      )}

      {todaStatus === 'Pending Verification' ? (
        <Box sx={{ mt: 2, textAlign: 'center', p: 6, backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)' }}>
          <ShieldIcon sx={{ fontSize: 48, color: '#D1D5DB', mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'var(--mac-text-primary)' }}>Feature Unavailable</Typography>
          <Typography sx={{ color: 'var(--mac-text-secondary)', mt: 1, maxWidth: 500, mx: 'auto' }}>
            This feature will become available once your TODA has been approved and accredited by the LGU.
          </Typography>
        </Box>
      ) : (
        <>
      {/* 1. 3-Day Operational Governance Banner (Simplified Non-Technical Language) */}
      <Box
        sx={{
          mb: 3.5,
          backgroundColor: '#FFF7ED',
          border: '1px solid #FDBA74',
          borderRadius: 'var(--mac-radius-lg)',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--mac-shadow-subtle)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <WarningAmberIcon sx={{ color: '#EA580C', fontSize: 26, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#9A3412', mb: '3px' }}>
              TODA Operational Governance Rule — 3-Calendar-Day Review Deadline
            </Typography>
            <Typography sx={{ fontSize: '13.5px', color: '#C2410C', lineHeight: 1.4 }}>
              TODA Officers must screen new driver applications against the active TODA Driver Master Roster and endorse or return them within <strong>3 calendar days</strong> of submission. Applications exceeding this 3-day standard processing window are flagged as Overdue.
            </Typography>
          </Box>
        </Box>
        <Chip
          label="3-Day Processing Deadline"
          size="small"
          sx={{ backgroundColor: '#EA580C', color: '#FFFFFF', fontWeight: 700, fontSize: '12.5px', px: 1, height: 26 }}
        />
      </Box>

      {/* 2. Clear KPI Breakdown Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2.5,
          mb: 3.5,
        }}
      >
        {/* Pending TODA Action */}
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', mb: 1 }}>
            Awaiting TODA Screening
          </Typography>
          <Typography sx={{ fontSize: '30px', fontWeight: 700, color: 'var(--sakay-orange)' }}>
            {pendingCount}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 0.5 }}>
            Applications requiring TODA manual screening
          </Typography>
          {resubmittedCount > 0 && (
            <Chip
              label={`${resubmittedCount} resubmitted by the driver`}
              size="small"
              onClick={() => setStatusFilter('Resubmitted')}
              sx={{ mt: 1, backgroundColor: '#EDE9FE', color: '#4C1D95', fontWeight: 700, fontSize: '11.5px', cursor: 'pointer' }}
            />
          )}
        </Box>

        {/* Overdue (>3 Days) */}
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', mb: 1 }}>
            Overdue Screening (&gt;3 Days)
          </Typography>
          <Typography sx={{ fontSize: '30px', fontWeight: 700, color: '#DC2626' }}>
            {overdueCount}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#DC2626', fontWeight: 600, mt: 0.5 }}>
            Exceeds 3-day standard processing time
          </Typography>
        </Box>

        {/* Endorsed to LGU */}
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', mb: 1 }}>
            Endorsed to LGU
          </Typography>
          <Typography sx={{ fontSize: '30px', fontWeight: 700, color: '#1565C0' }}>
            {endorsedCount}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 0.5 }}>
            Sent to City LGU Franchising Office
          </Typography>
        </Box>

        {/* LGU Verified Drivers Card */}
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)' }}>
              Verified Drivers (LGU Accredited)
            </Typography>
            <VerifiedIcon sx={{ color: '#1E8E3E', fontSize: 18 }} />
          </Box>
          <Typography sx={{ fontSize: '30px', fontWeight: 700, color: '#1E8E3E' }}>
            {lguVerifiedCount}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#1E8E3E', fontWeight: 600, mt: 0.5 }}>
            Active & verified by City Franchising Office
          </Typography>
        </Box>
      </Box>

      {/* 3. Floating Filter Toolbar with Rightmost Filter Alignment */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search driver applicant, plate, license, or franchise..."
        selectFilters={[
          {
            id: 'status',
            label: 'Stage Status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
          },
          {
            id: 'roster',
            label: 'Roster Matching',
            value: rosterFilter,
            options: rosterOptions,
            onChange: setRosterFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setRosterFilter('All');
        }}
      />

      {/* 4. Applications Roster Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 'var(--mac-radius-lg)',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Driver Applicant</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Vehicle & Franchise</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Master Roster Check</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Submission & Age</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Stage Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3, width: 180 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredApplicants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 7 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                    <InboxIcon sx={{ fontSize: 48, color: 'var(--mac-text-tertiary)' }} />
                    <Typography sx={{ fontSize: '16px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                      No Driver Applications Found
                    </Typography>
                    <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>
                      There are currently no driver applications matching the "{statusFilter !== 'All' ? statusFilter : 'selected'}" filter criteria.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              filteredApplicants.map((app) => (
                <TableRow key={app.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar sx={{ width: 38, height: 38, backgroundColor: 'var(--sakay-orange-soft)', color: 'var(--sakay-orange)', fontSize: '14.5px', fontWeight: 700 }}>
                        {app.name.charAt(0)}
                      </Avatar>
                      <Box>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {app.name}
                        </Typography>
                        <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>
                          License: {app.licenseNo} • {app.phone}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Typography sx={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                      Plate: {app.vehiclePlate}
                    </Typography>
                    <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>
                      MTOP: {app.franchiseNo}
                    </Typography>
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    {app.rosterMatchKnown === false ? (
                      <Chip label="Roster not checked" size="small" sx={{ backgroundColor: '#F1F3F5', color: '#64748B', fontWeight: 600, fontSize: '12.5px' }} />
                    ) : app.onSubmittedRoster ? (
                      <Chip
                        icon={<CheckCircleIcon sx={{ fontSize: 15, color: '#1E8E3E' }} />}
                        label="Master Roster Verified"
                        size="small"
                        sx={{ backgroundColor: '#E6F4EA', color: '#1E8E3E', fontWeight: 600, fontSize: '12.5px' }}
                      />
                    ) : (
                      <Chip
                        icon={<WarningAmberIcon sx={{ fontSize: 15, color: '#DC2626' }} />}
                        label="Roster Mismatch Flag"
                        size="small"
                        sx={{ backgroundColor: '#FEF2F2', color: '#DC2626', fontWeight: 600, fontSize: '12.5px' }}
                      />
                    )}
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-primary)', fontWeight: 500 }}>
                      {app.isResubmitted ? `Resubmitted ${formatWhen(app.resubmittedAt)}` : app.submittedDate}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: '2px' }}>
                      <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>
                        {app.todaStageStatus === 'Resubmission Required'
                          ? 'Waiting for the driver'
                          : `${app.daysPending} day(s) ${app.isResubmitted ? 'since resubmission' : 'ago'}`}
                      </Typography>
                      {app.isOverdue && (app.todaStageStatus === 'Awaiting Screening' || app.todaStageStatus === 'Submitted' || app.todaStageStatus === 'TODA Review') && (
                        <Chip label="Overdue (>3 Days)" size="small" sx={{ backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: '11px', fontWeight: 700, height: 20 }} />
                      )}
                    </Box>
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
                      <StatusBadge status={app.todaStageStatus} />
                      {app.isResubmitted && (
                        <Chip
                          label="Resubmitted"
                          size="small"
                          sx={{ backgroundColor: '#EDE9FE', color: '#4C1D95', fontWeight: 700, fontSize: '11px', height: 20 }}
                        />
                      )}
                    </Box>
                  </TableCell>

                  <TableCell align="right" sx={{ py: 2, px: 3 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<VisibilityIcon fontSize="small" />}
                      onClick={() => handleOpenReview(app)}
                      disabled={todaStatus === 'Pending Verification'}
                      sx={{
                        height: 34,
                        px: 2,
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        textTransform: 'none',
                        color: 'var(--sakay-orange)',
                        borderColor: 'var(--sakay-orange-border)',
                        backgroundColor: 'var(--sakay-orange-soft)',
                        whiteSpace: 'nowrap',
                        '&:hover': {
                          backgroundColor: 'var(--sakay-orange)',
                          color: '#FFFFFF',
                          borderColor: 'var(--sakay-orange)',
                        },
                        '&.Mui-disabled': {
                          borderColor: '#E5E5EA',
                          color: '#C7C7CC',
                          backgroundColor: '#F2F2F7',
                        }
                      }}
                    >
                      {app.todaStageStatus === 'Endorsed to LGU' ? 'View Details' : 'Screen Application'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 5. Driver Application Review Centered Modal */}
      {selectedApplicant && (
        <MacCenterModal
          open={Boolean(selectedApplicant)}
          onClose={() => setSelectedApplicant(null)}
          title={`Screen Driver Application — ${selectedApplicant.name}`}
          subtitle={
            selectedApplicant.isResubmitted
              ? `Resubmitted: ${formatWhen(selectedApplicant.resubmittedAt)} • ${selectedApplicant.daysPending} days since resubmission`
              : `Submitted: ${selectedApplicant.submittedDate} • ${selectedApplicant.daysPending} days pending`
          }
          badge={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <StatusBadge status={selectedApplicant.todaStageStatus} />
              {selectedApplicant.isResubmitted && (
                <Chip label="Resubmitted" size="small" sx={{ backgroundColor: '#EDE9FE', color: '#4C1D95', fontWeight: 700, fontSize: '12px' }} />
              )}
            </Box>
          }
          maxWidth={760}
          primaryActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Endorse to City LGU" : undefined}
          onPrimaryAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? handleEndorseClick : undefined}
          secondaryActionLabel="Close"
          onSecondaryAction={() => setSelectedApplicant(null)}
          leftActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Reject Application" : undefined}
          onLeftAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? openRejectDialog : undefined}
          middleActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Return for Correction" : undefined}
          onMiddleAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? openReturnDialog : undefined}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Resubmitted: what changed, and what this review asked for before (so the reviewer can compare) */}
            {selectedApplicant.isResubmitted && (
              <Alert severity="info" icon={false} sx={{ borderRadius: '12px', backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE', color: '#4C1D95' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '14px', mb: 0.5 }}>
                  Resubmitted by the driver on {formatWhen(selectedApplicant.resubmittedAt)}
                </Typography>
                <Typography sx={{ fontSize: '13px', mb: 1 }}>
                  The 5-calendar-day review period restarted on that date. Replaced:{' '}
                  <strong>
                    {(selectedApplicant.documentReviews || [])
                      .filter((r) => r.state === 'resubmitted')
                      .map((r) => documentLabelOf(r.documentType))
                      .join(', ')}
                  </strong>
                  . Documents that were not returned are unchanged.
                </Typography>
                {(selectedApplicant.documentReviews || [])
                  .filter((r) => r.state === 'resubmitted')
                  .map((r) => (
                    <Box key={r.documentType} sx={{ borderTop: '1px solid #DDD6FE', pt: 0.75, mt: 0.75 }}>
                      <Typography sx={{ fontSize: '12.5px', fontWeight: 700 }}>
                        {documentLabelOf(r.documentType)} — previous return ({formatWhen(r.returnedAt)}): {reasonLabelOf(r.reasonCode)}
                      </Typography>
                      <Typography sx={{ fontSize: '12.5px', fontStyle: 'italic' }}>"{r.reason}"</Typography>
                    </Box>
                  ))}
              </Alert>
            )}

            {/* Returned: waiting for the driver */}
            {selectedApplicant.todaStageStatus === 'Resubmission Required' && (
              <Alert severity="warning" sx={{ borderRadius: '12px' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '14px', mb: 0.5 }}>Returned to the driver — waiting for the corrected documents</Typography>
                {(selectedApplicant.documentReviews || [])
                  .filter((r) => r.state === 'returned')
                  .map((r) => (
                    <Typography key={r.documentType} sx={{ fontSize: '13px' }}>
                      <strong>{documentLabelOf(r.documentType)}</strong> ({formatWhen(r.returnedAt)}): {reasonLabelOf(r.reasonCode)} — {r.reason}
                    </Typography>
                  ))}
              </Alert>
            )}

            {/* A shared document that another review flagged or replaced (no reason: that is the other review's judgement) */}
            {(selectedApplicant.documentReviews || []).some((r) => r.state === 'returned_elsewhere' || r.state === 'replaced_elsewhere') && (
              <Alert severity="info" sx={{ borderRadius: '12px' }}>
                {(selectedApplicant.documentReviews || [])
                  .filter((r) => r.state === 'returned_elsewhere' || r.state === 'replaced_elsewhere')
                  .map((r) => (
                    <Typography key={r.documentType} sx={{ fontSize: '13px' }}>
                      <strong>{documentLabelOf(r.documentType)}</strong>{' '}
                      {r.state === 'returned_elsewhere'
                        ? 'was returned to the driver in another review and has not been replaced yet. Your review is not affected.'
                        : `was replaced by the driver on ${formatWhen(r.resubmittedAt)} after another review returned it. Look at the current copy.`}
                    </Typography>
                  ))}
              </Alert>
            )}

            {/* A rejected application: the reason, and that it is final (there is no action on it any more) */}
            {selectedApplicant.todaStageStatus === 'Rejected' && (() => {
              const parts = rejectionReasonParts(selectedApplicant.rejectionReason);
              return (
                <Alert severity="error" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ borderRadius: '12px', alignItems: 'flex-start' }}>
                  <Typography sx={{ fontSize: '14px', fontWeight: 800, mb: 0.5 }}>Rejected: final.</Typography>
                  <Typography sx={{ fontSize: '13px', lineHeight: 1.5 }}>
                    {parts.label ? <><strong>Reason:</strong> {parts.label}.{parts.note ? ` ${parts.note}` : ''} </> : null}
                    The applicant cannot re-apply to your TODA or send new documents. Only the City LGU can reopen a rejected application, with a
                    written reason that goes to the audit log.
                  </Typography>
                </Alert>
              );
            })()}

            {/* Master Roster Cross-Check Badge Banner: decided by the database, by franchise or plate number (never by name) */}
            {selectedApplicant.rosterMatchKnown === false ? (
              <Alert severity="info" sx={{ borderRadius: '12px', fontWeight: 600 }}>
                <strong>Hindi nasuri ang Master Roster.</strong> Hindi nakuha ang resulta ng roster check. I-refresh ang pahina bago mag-desisyon.
              </Alert>
            ) : selectedApplicant.onSubmittedRoster ? (
              <Alert severity="success" sx={{ borderRadius: '12px', fontWeight: 600 }}>
                <strong>Tugma sa Master Roster:</strong> Ang franchise number o plaka ng aplikante ay nakatala sa Master Roster ng TODA (bago isinumite ang aplikasyon).
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ borderRadius: '12px', fontWeight: 600 }}>
                <strong>Walang tugma sa Master Roster:</strong> Walang roster entry na may parehong franchise number o plaka ng aplikante (mula bago isinumite ang aplikasyon). Hindi sapat ang pangalan lamang.
                Maaari mo pa ring i-endorse ang aplikasyon, pero magkakaroon ito ng Roster Mismatch flag para sa LGU, na kailangang magbigay ng nakasulat na dahilan bago mag-apruba.
              </Alert>
            )}

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, backgroundColor: '#F8F9FA', p: 2.5, borderRadius: '12px' }}>
              <Box>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>Driver License No.</Typography>
                <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedApplicant.licenseNo}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>Vehicle Plate Number</Typography>
                <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedApplicant.vehiclePlate}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>Chassis Number</Typography>
                <Typography sx={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedApplicant.chassisNo}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)' }}>Motor Number</Typography>
                <Typography sx={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedApplicant.motorNo}</Typography>
              </Box>
            </Box>

            {/* Checklist items */}
            <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
              TODA Officer Screening Checklist
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={rosterChecked}
                    onChange={(e) => setRosterChecked(e.target.checked)}
                    sx={{ color: 'var(--sakay-orange)', '&.Mui-checked': { color: 'var(--sakay-orange)' } }}
                  />
                }
                label={
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                    Verify membership against active TODA Driver Roster
                    {!rosterChecked && selectedApplicant.rosterMatchKnown !== false && !selectedApplicant.onSubmittedRoster && (
                      <Typography component="span" sx={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#B45309' }}>
                        Walang tugma sa roster. Lagyan ng tsek kapag na-verify mo na ang membership sa ibang paraan; maaari pa ring i-endorse (magkakaroon ng Roster Mismatch flag).
                      </Typography>
                    )}
                  </Typography>
                }
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={photoChecked}
                    onChange={(e) => setPhotoChecked(e.target.checked)}
                    sx={{ color: 'var(--sakay-orange)', '&.Mui-checked': { color: 'var(--sakay-orange)' } }}
                  />
                }
                label={
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                    Inspect tricycle unit photograph & plate specifications
                  </Typography>
                }
              />
            </Box>

            {/* Supporting Evidence View */}
            <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--mac-text-primary)', mt: 1 }}>
              Submitted Verification Documents & Photos (5)
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {[
                {
                  docType: 'license',
                  title: "Driver's License (Harap / Front)",
                  subtitle: `Numero ng Lisensya: ${selectedApplicant.licenseNo} • LTO Official Card`,
                  type: 'Identification Proof',
                  url: selectedApplicant.licenseFrontUrl,
                },
                {
                  docType: 'license',
                  title: "Driver's License (Likod / Back)",
                  subtitle: 'Official LTO Conditions & Restrictions Card',
                  type: 'Identification Proof',
                  url: selectedApplicant.licenseBackUrl,
                },
                {
                  docType: 'mtop',
                  title: 'MTOP Franchise Permit',
                  subtitle: `Franchise Blg: ${selectedApplicant.franchiseNo} • Calapan City Franchising`,
                  type: 'Municipal Regulatory Permit',
                  url: selectedApplicant.mtopUrl,
                },
                {
                  docType: 'tricycle',
                  title: 'Larawan ng Tricycle Unit',
                  subtitle: `Plaka Blg: ${selectedApplicant.vehiclePlate} • Side/Body View`,
                  type: 'Vehicle Compliance Photo',
                  url: selectedApplicant.tricyclePhotoUrl,
                },
                {
                  docType: 'selfie',
                  title: 'Facial Verification / Selfie Photo',
                  subtitle: 'Real-time Driver Liveness Biometric Verification',
                  type: 'Biometric Verification',
                  url: selectedApplicant.selfieUrl,
                },
              ].map((doc, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.8,
                    borderRadius: '10px',
                    backgroundColor: '#FAFAFC',
                    border: '1px solid var(--mac-border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar
                      src={doc.url || ''}
                      variant="rounded"
                      sx={{
                        width: 48,
                        height: 48,
                        backgroundColor: 'var(--sakay-orange-soft)',
                        border: '1px solid var(--mac-border-color)',
                      }}
                    >
                      <DescriptionIcon sx={{ color: 'var(--sakay-orange)', fontSize: 24 }} />
                    </Avatar>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {doc.title}
                        </Typography>
                        {(() => {
                          const rv = (selectedApplicant.documentReviews || []).find((r) => r.documentType === doc.docType);
                          if (!rv || rv.state === 'not_returned') return null;
                          const tone =
                            rv.state === 'resubmitted'
                              ? { backgroundColor: '#EDE9FE', color: '#4C1D95' }
                              : rv.state === 'returned'
                              ? { backgroundColor: '#FEF3C7', color: '#92400E' }
                              : { backgroundColor: '#E2E8F0', color: '#475569' };
                          const label =
                            rv.state === 'resubmitted'
                              ? `Resubmitted · ${formatWhen(rv.resubmittedAt)}`
                              : rv.state === 'returned'
                              ? 'Returned — waiting for driver'
                              : rv.state === 'returned_elsewhere'
                              ? 'Flagged in another review'
                              : `Replaced · ${formatWhen(rv.resubmittedAt)} (another review)`;
                          return <Chip label={label} size="small" sx={{ ...tone, fontWeight: 700, fontSize: '11px', height: 20 }} />;
                        })()}
                      </Box>
                      <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
                        {doc.subtitle}
                      </Typography>
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<VisibilityIcon fontSize="small" />}
                    onClick={() =>
                      setPreviewDocData({
                        name: `${doc.title} — ${selectedApplicant.name}`,
                        type: doc.type,
                        url: doc.url,
                      })
                    }
                    sx={{
                      height: 34,
                      px: 2,
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      textTransform: 'none',
                      color: 'var(--sakay-orange)',
                      borderColor: 'var(--sakay-orange-border)',
                      backgroundColor: 'var(--sakay-orange-soft)',
                      '&:hover': {
                        backgroundColor: 'var(--sakay-orange)',
                        color: '#FFFFFF',
                      },
                    }}
                  >
                    Suriin ang Larawan
                  </Button>
                </Box>
              ))}
            </Box>
          </Box>
        </MacCenterModal>
      )}

      {/* Confirmation Dialogs */}
      <MacConfirmDialog
        open={forwardDialogOpen}
        onClose={() => { if (!isSubmitting) { setForwardDialogOpen(false); setForwardError(null); } }}
        title="Endorse ang Aplikasyon?"
        message={
          `Kumpirmahin ang pag-endorse sa aplikasyon ni ${selectedApplicant?.name} (${selectedApplicant?.vehiclePlate}). Ang aplikasyong ito ay ipapasa sa LGU para sa susunod na pagsusuri.` +
          (selectedApplicant && selectedApplicant.rosterMatchKnown !== false && !selectedApplicant.onSubmittedRoster
            ? ' Walang tugma sa Master Roster ang aplikante: maaari pa rin itong i-endorse, pero magkakaroon ng Roster Mismatch flag at kailangang magbigay ng nakasulat na dahilan ang LGU bago mag-apruba.'
            : '')
        }
        confirmLabel="Kumpirmahin ang Endorsement"
        confirmVariant="primary"
        isLoading={isSubmitting}
        errorMessage={forwardError}
        onConfirm={handleForwardConfirm}
      />

      {/* Celebratory Endorsement Popup Modal */}
      <Dialog
        open={celebrateDialogOpen}
        onClose={() => {
          setCelebrateDialogOpen(false);
          setSelectedApplicant(null);
        }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '24px',
              p: 3,
              maxWidth: 420,
              textAlign: 'center',
            },
          },
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            backgroundColor: '#ECFDF5',
            color: '#10B981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 2,
            boxShadow: '0 8px 24px rgba(16, 185, 129, 0.2)',
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 44 }} />
        </Box>
        <Typography sx={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', mb: 1 }}>
          Matagumpay na na-endorse!
        </Typography>
        <Typography sx={{ fontSize: '14px', color: '#64748B', lineHeight: 1.45, mb: 3 }}>
          Naipasa na ang aplikasyon sa LGU para sa susunod na pagsusuri.
        </Typography>
        <Button
          fullWidth
          variant="contained"
          onClick={() => {
            setCelebrateDialogOpen(false);
            setSelectedApplicant(null);
          }}
          sx={{
            borderRadius: '14px',
            backgroundColor: '#FF6B00',
            fontWeight: 700,
            py: 1.25,
            textTransform: 'none',
            fontSize: '15px',
            '&:hover': { backgroundColor: '#E05D00' },
          }}
        >
          Okay
        </Button>
      </Dialog>

      {/* Return for Correction: which documents, and why (Rules 3.6, 3.8). The driver is asked for ONLY these. */}
      <Dialog
        open={returnDialogOpen}
        onClose={() => !isSubmitting && setReturnDialogOpen(false)}
        slotProps={{ paper: { sx: { borderRadius: '20px', p: 2.5, maxWidth: 560, width: '100%' } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', p: 0, mb: 1, color: '#0F172A' }}>
          Ibalik para sa Pagwawasto (Return for Correction)
        </DialogTitle>
        <DialogContent sx={{ p: 0, pt: 1 }}>
          <Typography sx={{ fontSize: '14px', color: '#64748B', mb: 2 }}>
            Piliin ang dokumento na kailangang ipasa muli ni <strong>{selectedApplicant?.name}</strong> at isulat kung ano ang mali. Ang drayber ay hihingian
            lamang ng mga dokumentong ito; ang iba ay mananatili.
          </Typography>

          {RETURN_DOCUMENTS.map((d) => {
            const row = returnForm[d.value];
            const flagged = (selectedApplicant?.documentReviews || []).find((r) => r.documentType === d.value)?.state === 'returned_elsewhere';
            return (
              <Box key={d.value} sx={{ mb: 1.5, p: 1.5, borderRadius: '12px', border: `1px solid ${row.checked ? '#F59E0B' : '#E2E8F0'}`, backgroundColor: row.checked ? '#FFFBEB' : '#FFFFFF' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={row.checked}
                      onChange={(e) => setReturnForm((prev) => ({ ...prev, [d.value]: { ...prev[d.value], checked: e.target.checked } }))}
                      sx={{ color: '#D97706', '&.Mui-checked': { color: '#D97706' } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: '14px', fontWeight: 700 }}>
                      {d.label}
                      {flagged && (
                        <Typography component="span" sx={{ fontSize: '11.5px', fontWeight: 500, color: '#64748B', ml: 1 }}>
                          (already flagged in another review)
                        </Typography>
                      )}
                    </Typography>
                  }
                />
                {row.checked && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.5, pl: 1 }}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Dahilan (preset)"
                      value={row.code}
                      onChange={(e) => setReturnForm((prev) => ({ ...prev, [d.value]: { ...prev[d.value], code: e.target.value as ReturnReasonCode } }))}
                    >
                      {RETURN_REASONS.map((r) => (
                        <MenuItem key={r.value} value={r.value}>
                          {r.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      fullWidth
                      multiline
                      rows={2}
                      required
                      label="Ano ang mali? (kailangan)"
                      placeholder="Isulat ang eksaktong dahilan para sa drayber..."
                      value={row.reason}
                      error={row.reason.length > 0 && row.reason.trim().length === 0}
                      onChange={(e) => setReturnForm((prev) => ({ ...prev, [d.value]: { ...prev[d.value], reason: e.target.value } }))}
                      slotProps={{ htmlInput: { maxLength: 500 } }}
                    />
                  </Box>
                )}
              </Box>
            );
          })}
          <Typography sx={{ fontSize: '12.5px', color: '#64748B' }}>
            Ang pagbabalik ay hindi pagtanggi: nananatili ang aplikasyon at magre-restart ang 5-araw na review period kapag naipasa muli ng drayber ang mga dokumento.
            Hindi naaapektuhan ang pagsusuri ng ibang TODA.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 0, pt: 3, display: 'flex', gap: 1.5 }}>
          <Button
            onClick={() => setReturnDialogOpen(false)}
            disabled={isSubmitting}
            sx={{ borderRadius: '12px', backgroundColor: '#F1F3F5', color: '#0F172A', fontWeight: 700, textTransform: 'none', px: 2 }}
          >
            Kanselahin
          </Button>
          <Button
            onClick={handleReturnConfirm}
            variant="contained"
            disabled={!returnIsComplete || isSubmitting}
            sx={{ flex: 1, borderRadius: '12px', fontWeight: 700, textTransform: 'none', backgroundColor: '#D97706', '&:hover': { backgroundColor: '#B45309' } }}
          >
            {isSubmitting
              ? 'Ibinabalik...'
              : returnSelection.length > 1
              ? `Ibalik ang ${returnSelection.length} Dokumento`
              : 'Ibalik ang Dokumento sa Drayber'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject: PERMANENT grounds only (Rule 3.8). Document problems are RETURNED for correction, a separate action. */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => (isSubmitting ? undefined : setRejectDialogOpen(false))}
        slotProps={{ paper: { sx: { borderRadius: '20px', p: 2.5, maxWidth: 500, width: '100%' } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', p: 0, mb: 1.5, color: '#0F172A' }}>
          Reject Application
        </DialogTitle>
        <DialogContent sx={{ p: 0, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="error" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ borderRadius: '12px', alignItems: 'flex-start' }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 800, mb: 0.5 }}>Rejection is final.</Typography>
            <Typography sx={{ fontSize: '13px', lineHeight: 1.5 }}>
              <strong>{selectedApplicant?.name}</strong> cannot re-apply to your TODA and cannot send new documents. They will be told the reason you
              choose below. (Pinal ang pagtanggi. Hindi na makakapag-apply muli ang aplikante sa inyong TODA.)
            </Typography>
          </Alert>

          <TextField
            select
            fullWidth
            required
            label="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value as RejectionReasonCode)}
            helperText="Required. Choose the permanent ground for this rejection."
          >
            {REJECTION_REASON_CODES.map((code) => (
              <MenuItem key={code} value={code}>
                {REJECTION_REASON_LABEL[code]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Note (optional)"
            placeholder="Add details the applicant should know..."
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            helperText="Optional. Shown to the applicant together with the reason."
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          {/* Kept apart on purpose: a fixable problem is not a rejection */}
          <Box sx={{ border: '1px solid #FDE68A', backgroundColor: '#FFFBEB', borderRadius: '12px', p: 1.75 }}>
            <Typography sx={{ fontSize: '13px', fontWeight: 800, color: '#92400E', mb: 0.5 }}>Is the problem fixable?</Typography>
            <Typography sx={{ fontSize: '12.5px', color: '#78350F', lineHeight: 1.5, mb: 1.25 }}>
              A blurry photo, an expired or wrong document, or details that do not match can be corrected by the applicant. Do not reject for
              these: return the documents instead, and the applicant can send new ones.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              disabled={isSubmitting}
              onClick={() => {
                setRejectDialogOpen(false);
                openReturnDialog();
              }}
              sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 700, color: '#B45309', borderColor: '#D97706', '&:hover': { backgroundColor: '#FEF3C7', borderColor: '#B45309' } }}
            >
              Return for correction instead
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 0, pt: 3, display: 'flex', gap: 1.5 }}>
          <Button
            onClick={() => setRejectDialogOpen(false)}
            disabled={isSubmitting}
            sx={{ borderRadius: '12px', backgroundColor: '#F1F3F5', color: '#0F172A', fontWeight: 700, textTransform: 'none', px: 2 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRejectConfirm}
            variant="contained"
            color="error"
            disabled={!rejectReason || isSubmitting}
            sx={{ flex: 1, borderRadius: '12px', fontWeight: 700, textTransform: 'none' }}
          >
            {isSubmitting ? 'Rejecting...' : 'Reject permanently'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Photo Preview Modal */}
      {previewDocData && (
        <DocumentPreviewModal
          open={Boolean(previewDocData)}
          onClose={() => setPreviewDocData(null)}
          documentName={previewDocData.name}
          documentType={previewDocData.type}
          imageUrl={previewDocData.url}
        />
      )}

      {/* Global Success / Error Toast Notification */}
      <Snackbar
        open={toastOpen}
        autoHideDuration={toastSeverity === 'error' ? 12000 : 5000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToastOpen(false)}
          severity={toastSeverity}
          variant="filled"
          sx={{
            width: '100%',
            borderRadius: '12px',
            fontWeight: 600,
            fontSize: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>
      </>
      )}
    </Box>
  );
};
