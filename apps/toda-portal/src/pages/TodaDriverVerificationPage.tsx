import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TableBody,
  TableCell,
  TableRow,
  Button,
  Chip,
  Checkbox,
  FormControlLabel,
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
import PersonIcon from '@mui/icons-material/Person';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

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
import { isTodaLocked } from '../utils/accreditation';
import { useAuth } from '../contexts/AuthContext';
import type { DocumentReturnInput } from '../services/todaApiService';
import { REJECTION_REASON_CODES, REJECTION_REASON_LABEL, rejectionReasonParts } from '@sakay/shared';
import type { RejectionReasonCode, ReturnReasonCode, ReviewDocumentType } from '@sakay/shared';
import { DataTableCard, DataTableMessageRow, CellStack, PersonCell, StatusPill } from '../components/common/DataTable';
import { FeatureLockedNotice } from '../components/common/FeatureLockedNotice';
import { PageNotice } from '../components/common/PageNotice';
import { ReviewDocumentRow } from '../components/common/ReviewDocumentRow';
import { DetailSection, DetailGrid, DetailField } from '../components/common/DetailSection';
import { RosterCheckNotice } from '../components/common/RosterCheckNotice';
import { dangerButtonSx, primaryButtonSx, rowActionSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { OPS_BORDER, OPS_TEXT } from '../components/operations/operationsTheme';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from '@sakay/shared/components/dialogStyles';
import { FONT, SHELL, SPACE } from '../styles/density';
import { SakayToast } from '../components/common/SakayToast';
import { expiryState, formatDocDate, formatWhen, sharesNameWord } from '../utils/applicantDetails';

// ---- Return for correction (Rules 3.6, 3.8): the TODA names the documents and says why. Rejecting (fraud / ineligible) is a different action.
const RETURN_DOCUMENTS: { value: ReviewDocumentType; label: string }[] = [
  { value: 'license', label: "Driver's License (Front & Back)" },
  { value: 'mtop', label: 'MTOP Franchise Permit' },
  { value: 'tricycle', label: 'Tricycle Unit Inspection Photo' },
  { value: 'selfie', label: 'Driver Profile Photo (Selfie)' },
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

/** An expiry date shown with a pill when it has passed or is close, like the LGU Portal's driver window. */
const expiryPill = (iso?: string | null): React.ReactNode => {
  const { state, days } = expiryState(iso);
  if (state === 'expired') return <StatusPill label="Expired" tone="danger" />;
  if (state === 'soon') return <StatusPill label={days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`} tone="warning" />;
  return null;
};

// the look shared by the notices inside the review window
const reviewAlertSx = { borderRadius: '10px', fontSize: FONT.body } as const;

// a titled block of the review window
const ReviewSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box component="section">
    <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, mb: '8px' }}>{title}</Typography>
    {children}
  </Box>
);

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
    urls: string[];
    labels?: string[];
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
    return text.trim() || 'The server did not give any details.';
  };

  /**
   * The "Endorse to City LGU" button. It always answers: with the checklist complete it opens the confirmation; otherwise it says which
   * box is missing (it used to do nothing at all, which looked like a broken button).
   */
  const handleEndorseClick = () => {
    if (!rosterChecked || !photoChecked) {
      const missing = [!rosterChecked && 'roster', !photoChecked && 'photo'].filter(Boolean);
      setToastMessage(
        `Finish the screening checklist before you endorse: tick ${
          missing.length === 2 ? 'both boxes (roster and photo)' : missing[0] === 'roster' ? 'the roster box' : 'the photo box'
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
        setToastMessage(`The application could not be endorsed to the LGU: ${detail}`);
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
      setToastMessage('The application was endorsed to the LGU.');
      setToastSeverity('success');
      setToastOpen(true);
      setCelebrateDialogOpen(true);

      // Re-fetch driver applicant list from Supabase to verify persistent state
      loadApplicants();
    } catch (err) {
      console.error('[TodaVerification] Endorsement exception:', err);
      const detail = reasonOf(err);
      setForwardError(detail);
      setToastMessage(`The application could not be endorsed to the LGU: ${detail}`);
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
        setToastMessage(`The rejection was not saved: ${reasonOf((rejectRes as any)?.error)}`);
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
        `The application of ${selectedApplicant.name} was returned. The driver will only be asked for: ${returnSelection.map((d) => d.label).join(', ')}.`
      );
      setToastSeverity('success');
      setToastOpen(true);
      setReturnDialogOpen(false);
      setSelectedApplicant(null);
      loadApplicants(true);
    } catch (err) {
      console.error('[TodaVerification] Return for correction error:', err);
      setToastMessage(`The application could not be returned: ${(err as Error)?.message || 'Please try again.'}`);
      setToastSeverity('error');
      setToastOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canEndorse = rosterChecked && photoChecked;

  // the four documents an applicant sends, listed the way the LGU Portal lists them (the license is one document, front and back)
  const reviewDocuments: { docType: ReviewDocumentType; title: string; type: string; urls: string[]; labels?: string[] }[] = selectedApplicant
    ? [
        {
          docType: 'license',
          title: "Driver's License (Front & Back)",
          type: 'Identification Proof',
          urls: [selectedApplicant.licenseFrontUrl, selectedApplicant.licenseBackUrl].filter((u): u is string => Boolean(u)),
          labels: ['Front', 'Back'],
        },
        { docType: 'mtop', title: 'MTOP Franchise Permit', type: 'Official LGU Permit', urls: selectedApplicant.mtopUrl ? [selectedApplicant.mtopUrl] : [] },
        { docType: 'tricycle', title: 'Tricycle Unit Inspection Photo', type: 'Vehicle Compliance Photo', urls: selectedApplicant.tricyclePhotoUrl ? [selectedApplicant.tricyclePhotoUrl] : [] },
        { docType: 'selfie', title: 'Driver Profile Photo (Selfie)', type: 'Profile Photo', urls: selectedApplicant.selfieUrl ? [selectedApplicant.selfieUrl] : [] },
      ]
    : [];

  // The four numbers: the counts are the ones computed above; the number is coloured only when it is above zero.
  const stats: OperationsStat[] = [
    {
      key: 'pending',
      label: 'Awaiting TODA screening',
      value: pendingCount,
      note: 'Applications waiting for your review',
      tone: pendingCount > 0 ? 'brand' : 'neutral',
      extra:
        resubmittedCount > 0 ? (
          <Chip
            label={`${resubmittedCount} resubmitted by the driver`}
            size="small"
            onClick={() => setStatusFilter('Resubmitted')}
            sx={{ backgroundColor: '#EDE9FE', color: '#4C1D95', fontWeight: 700, fontSize: FONT.small, height: 24, cursor: 'pointer' }}
          />
        ) : undefined,
    },
    { key: 'overdue', label: 'Overdue (over 3 days)', value: overdueCount, note: 'Past the 3-day limit', tone: overdueCount > 0 ? 'danger' : 'neutral' },
    { key: 'endorsed', label: 'Endorsed to LGU', value: endorsedCount, note: 'Sent to the City LGU Franchising Office' },
    { key: 'verified', label: 'Verified drivers (LGU accredited)', value: lguVerifiedCount, note: 'Verified by the City Franchising Office', tone: lguVerifiedCount > 0 ? 'success' : 'neutral' },
  ];

  const filtersActive = Boolean(searchQuery) || statusFilter !== 'All' || rosterFilter !== 'All';
  const stillDecidable = (app: DriverApplicant) => app.todaStageStatus === 'Awaiting Screening' || app.todaStageStatus === 'Submitted' || app.todaStageStatus === 'TODA Review';

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: SPACE.section }}>
      {isTodaLocked(todaStatus) ? (
        <FeatureLockedNotice />
      ) : (
        <>
      {/* 1. The deadline rule: a calm, always-visible reminder. An application past the deadline is marked Overdue in the table and counted below. */}
      <PageNotice title="Review deadline">
        Screen each new driver application against the TODA Master Roster, then endorse it or return it within <strong>3 calendar days</strong> of
        submission. After 3 days the application is marked Overdue.
      </PageNotice>

      {/* 2. The four numbers */}
      <OperationsStatStrip stats={stats} />

      {/* 3. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search name, plate, license or franchise"
        selectFilters={[
          {
            id: 'status',
            label: 'Stage status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
            width: 230,
          },
          {
            id: 'roster',
            label: 'Roster check',
            value: rosterFilter,
            options: rosterOptions,
            onChange: setRosterFilter,
            width: 200,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setRosterFilter('All');
        }}
      />

      {/* 4. The applications */}
      <DataTableCard label="Driver applications" minWidth={880} columns={[{ label: 'Driver applicant' }, { label: 'Vehicle and franchise' }, { label: 'Master roster check' }, { label: 'Submitted' }, { label: 'Stage status' }, { label: 'Action', align: 'right' }]}>
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading driver applications..." />
          ) : filteredApplicants.length === 0 ? (
            applicants.length === 0 && !filtersActive ? (
              <DataTableMessageRow
                colSpan={6}
                kind="empty"
                title="No driver applications yet"
                hint="New applications from drivers who choose your TODA will appear here."
              />
            ) : (
              <DataTableMessageRow
                colSpan={6}
                kind="noResults"
                title="No applications match"
                hint="Try other words or another filter, or press Reset to see every application."
              />
            )
          ) : (
            filteredApplicants.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <PersonCell name={app.name} detail={<><span style={{ display: 'block', whiteSpace: 'nowrap' }}>License: {app.licenseNo}</span><span style={{ display: 'block', whiteSpace: 'nowrap' }}>{app.phone}</span></>} />
                </TableCell>

                <TableCell>
                  <CellStack primary={`Plate: ${app.vehiclePlate}`} secondary={<span style={{ whiteSpace: 'nowrap' }}>MTOP: {app.franchiseNo}</span>} />
                </TableCell>

                <TableCell>
                  {/* the roster result: words, colour and icon agree; a mismatch is the one that stands out */}
                  {app.rosterMatchKnown === false ? (
                    <StatusPill tone="neutral" label="Roster not checked" />
                  ) : app.onSubmittedRoster ? (
                    <StatusPill tone="success" label="Master Roster Verified" icon={<CheckCircleIcon aria-hidden sx={{ fontSize: 14 }} />} />
                  ) : app.rosterCheck?.reason === 'entry_added_later' ? (
                    // the franchise IS on the roster, but the entry came after the application: not a missing member, so not the red mismatch
                    <StatusPill tone="warning" label="On roster, added after applying" icon={<WarningAmberIcon aria-hidden sx={{ fontSize: 14 }} />} />
                  ) : (
                    <StatusPill tone="danger" label="Roster Mismatch Flag" icon={<WarningAmberIcon aria-hidden sx={{ fontSize: 14 }} />} />
                  )}
                </TableCell>

                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, fontWeight: 500 }}>
                    {app.isResubmitted ? `Resubmitted ${formatWhen(app.resubmittedAt)}` : app.submittedDate}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 8px', mt: '2px' }}>
                    <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>
                      {app.todaStageStatus === 'Resubmission Required'
                        ? 'Waiting for the driver'
                        : `${app.daysPending} day(s) ${app.isResubmitted ? 'since resubmission' : 'ago'}`}
                    </Typography>
                    {app.isOverdue && stillDecidable(app) && (
                      <StatusPill tone="danger" label="Overdue (>3 Days)" icon={<WarningAmberIcon aria-hidden sx={{ fontSize: 14 }} />} />
                    )}
                  </Box>
                </TableCell>

                <TableCell>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <StatusBadge status={app.todaStageStatus} highContrast sx={{ height: '24px', fontSize: FONT.small }} />
                    {app.isResubmitted && <StatusPill tone="violet" label="Resubmitted" />}
                  </Box>
                </TableCell>

                <TableCell align="right">
                  {/* an application that still needs a decision gets the orange button; one already sent on is only viewed (grey) */}
                  <Button
                    variant="outlined"
                    startIcon={<VisibilityIcon sx={{ fontSize: 15 }} />}
                    onClick={() => handleOpenReview(app)}
                    disabled={isTodaLocked(todaStatus)}
                    sx={rowActionSx(app.todaStageStatus === 'Endorsed to LGU' ? 'neutral' : 'brand')}
                  >
                    {app.todaStageStatus === 'Endorsed to LGU' ? 'View Details' : 'Screen Application'}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </DataTableCard>


      {/* 5. Review window for one application */}
      {selectedApplicant && (
        <MacCenterModal
          open={Boolean(selectedApplicant)}
          onClose={() => setSelectedApplicant(null)}
          title={`Screen Application — ${selectedApplicant.name}`}
          subtitle={
            selectedApplicant.isResubmitted
              ? `Resubmitted: ${formatWhen(selectedApplicant.resubmittedAt)} • ${selectedApplicant.daysPending} days since resubmission`
              : `Submitted: ${selectedApplicant.submittedDate} • ${selectedApplicant.daysPending} days pending`
          }
          badge={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <StatusBadge status={selectedApplicant.todaStageStatus} highContrast />
              {selectedApplicant.isResubmitted && <StatusPill label="Resubmitted" tone="info" />}
            </Box>
          }
          maxWidth={640}
          primaryActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Endorse to City LGU" : undefined}
          onPrimaryAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? handleEndorseClick : undefined}
          secondaryActionLabel="Close"
          onSecondaryAction={() => setSelectedApplicant(null)}
          leftActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Reject Application" : undefined}
          onLeftAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? openRejectDialog : undefined}
          middleActionLabel={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? "Return for Correction" : undefined}
          onMiddleAction={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus) ? openReturnDialog : undefined}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gapLarge }}>
            {/* Resubmitted: what changed, and what this review asked for before (so the reviewer can compare) */}
            {selectedApplicant.isResubmitted && (
              <Alert severity="info" icon={false} sx={{ ...reviewAlertSx, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A8A' }}>
                <Typography sx={{ fontWeight: 700, fontSize: FONT.body, mb: '3px' }}>
                  Resubmitted by the driver on {formatWhen(selectedApplicant.resubmittedAt)}
                </Typography>
                <Typography sx={{ fontSize: FONT.small, mb: '6px' }}>
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
                    <Box key={r.documentType} sx={{ borderTop: '1px solid #BFDBFE', pt: '5px', mt: '5px' }}>
                      <Typography sx={{ fontSize: FONT.small, fontWeight: 700 }}>
                        {documentLabelOf(r.documentType)} — previous return ({formatWhen(r.returnedAt)}): {reasonLabelOf(r.reasonCode)}
                      </Typography>
                      <Typography sx={{ fontSize: FONT.small, fontStyle: 'italic' }}>"{r.reason}"</Typography>
                    </Box>
                  ))}
              </Alert>
            )}

            {/* Returned: waiting for the driver */}
            {selectedApplicant.todaStageStatus === 'Resubmission Required' && (
              <Alert severity="warning" sx={reviewAlertSx}>
                <Typography sx={{ fontWeight: 700, fontSize: FONT.body, mb: '3px' }}>Returned to the driver — waiting for the corrected documents</Typography>
                {(selectedApplicant.documentReviews || [])
                  .filter((r) => r.state === 'returned')
                  .map((r) => (
                    <Typography key={r.documentType} sx={{ fontSize: FONT.small }}>
                      <strong>{documentLabelOf(r.documentType)}</strong> ({formatWhen(r.returnedAt)}): {reasonLabelOf(r.reasonCode)} — {r.reason}
                    </Typography>
                  ))}
              </Alert>
            )}

            {/* A shared document that another review flagged or replaced (no reason: that is the other review's judgement) */}
            {(selectedApplicant.documentReviews || []).some((r) => r.state === 'returned_elsewhere' || r.state === 'replaced_elsewhere') && (
              <Alert severity="info" sx={reviewAlertSx}>
                {(selectedApplicant.documentReviews || [])
                  .filter((r) => r.state === 'returned_elsewhere' || r.state === 'replaced_elsewhere')
                  .map((r) => (
                    <Typography key={r.documentType} sx={{ fontSize: FONT.small }}>
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
                <Alert severity="error" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ ...reviewAlertSx, alignItems: 'flex-start' }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 700, mb: '3px' }}>Rejected: final.</Typography>
                  <Typography sx={{ fontSize: FONT.small, lineHeight: 1.5 }}>
                    {parts.label ? <><strong>Reason:</strong> {parts.label}.{parts.note ? ` ${parts.note}` : ''} </> : null}
                    The applicant cannot re-apply to your TODA or send new documents. Only the City LGU can reopen a rejected application, with a
                    written reason that goes to the audit log.
                  </Typography>
                </Alert>
              );
            })()}

            {/* Master Roster check: decided by the database, by the franchise number (never by name or plate alone), with the reason */}
            <RosterCheckNotice applicant={selectedApplicant} canDecide={DECIDABLE_STAGES.includes(selectedApplicant.todaStageStatus)} />

            <DetailSection icon={<PersonIcon />} title="Personal details">
              <DetailGrid>
                <DetailField label="Full Name" value={selectedApplicant.name} />
                <DetailField label="Contact Phone" value={selectedApplicant.phone} />
                <DetailField label="Residential Barangay" value={selectedApplicant.residentialBarangay} />
                <DetailField label="Date Applied" value={selectedApplicant.submittedDate} />
              </DetailGrid>
            </DetailSection>

            <DetailSection icon={<AccountBalanceIcon />} title="TODA membership and endorsement">
              <DetailGrid>
                <DetailField label="Applying to" value={todaAdminProfile?.toda?.toda_name || todaAdminProfile?.toda_acronym} />
                <DetailField label="TODA Stage 1 Endorsement">
                  <StatusBadge status={selectedApplicant.todaStageStatus} />
                </DetailField>
                <DetailField label="TODA Membership No." value={selectedApplicant.membershipNo} />
                <DetailField label="Assigned Terminal" value={selectedApplicant.assignedTerminal} />
              </DetailGrid>
            </DetailSection>

            <DetailSection icon={<DirectionsCarIcon />} title="Vehicle and MTOP franchise (City Ord. No. 118)">
              <DetailGrid>
                <DetailField label="Professional Driver's License" value={selectedApplicant.licenseNo} />
                <DetailField label="License Expiry" value={formatDocDate(selectedApplicant.licenseExpiry)}>
                  {expiryPill(selectedApplicant.licenseExpiry)}
                </DetailField>
                <DetailField label="MTOP Franchise No." value={selectedApplicant.franchiseNo} />
                <DetailField label="MTOP Expiry" value={formatDocDate(selectedApplicant.mtopExpiry)}>
                  {expiryPill(selectedApplicant.mtopExpiry)}
                </DetailField>
                <DetailField label="Tricycle Vehicle Plate" value={selectedApplicant.vehiclePlate} />
                <DetailField label="Registered MTOP Operator" value={selectedApplicant.mtopOperatorName} wide />
              </DetailGrid>
              {selectedApplicant.mtopOperatorName && !sharesNameWord(selectedApplicant.mtopOperatorName, selectedApplicant.name) && (
                <Alert severity="info" sx={{ ...reviewAlertSx, mt: '10px' }}>
                  The operator named on the MTOP permit ({selectedApplicant.mtopOperatorName}) shares no name with the driver ({selectedApplicant.name}).
                  Check that the driver is allowed to operate this tricycle.
                </Alert>
              )}
            </DetailSection>

            <DetailSection icon={<VerifiedUserIcon />} title={`Verification documents (${reviewDocuments.length})`}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {reviewDocuments.map((doc) => {
                  const rv = (selectedApplicant.documentReviews || []).find((r) => r.documentType === doc.docType);
                  const state = !rv || rv.state === 'not_returned' ? null : rv.state;
                  const badge =
                    doc.urls.length === 0 ? (
                      <StatusPill label="No file received" tone="danger" />
                    ) : state === null ? (
                      <StatusPill label="Pending Inspection" tone="neutral" />
                    ) : state === 'resubmitted' ? (
                      <StatusPill label="Resubmitted (Awaiting Review)" tone="info" />
                    ) : state === 'returned' ? (
                      <StatusPill label="Resubmission Required" tone="warning" />
                    ) : state === 'returned_elsewhere' ? (
                      <StatusPill label="Flagged in another review" tone="neutral" />
                    ) : (
                      <StatusPill label={`Replaced · ${formatWhen(rv?.resubmittedAt)} (another review)`} tone="neutral" />
                    );
                  return (
                    <ReviewDocumentRow
                      key={doc.docType}
                      thumbnailUrl={doc.urls[0]}
                      title={doc.title}
                      type={doc.type}
                      badges={badge}
                      tone={state === 'returned' ? 'returned' : state === 'resubmitted' ? 'resubmitted' : 'neutral'}
                      onView={() =>
                        setPreviewDocData({
                          name: `${doc.title} — ${selectedApplicant.name}`,
                          type: doc.type,
                          urls: doc.urls,
                          labels: doc.labels,
                        })
                      }
                    />
                  );
                })}
              </Box>
            </DetailSection>

            <ReviewSection title="Screening checklist">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <FormControlLabel
                  sx={{ alignItems: 'flex-start', m: 0 }}
                  control={
                    <Checkbox
                      checked={rosterChecked}
                      onChange={(e) => setRosterChecked(e.target.checked)}
                      sx={{ pt: '2px', color: OPS_TEXT.brand, '&.Mui-checked': { color: OPS_TEXT.brand }, '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}` } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, pt: '2px' }}>
                      Check membership against the TODA driver roster
                      {!rosterChecked && selectedApplicant.rosterMatchKnown !== false && !selectedApplicant.onSubmittedRoster && (
                        <Typography component="span" sx={{ display: 'block', fontSize: FONT.small, fontWeight: 500, color: '#92400E' }}>
                          No match was found on the roster. Tick this once you have confirmed the membership another way. You can still endorse; a Roster Mismatch flag will be added.
                        </Typography>
                      )}
                    </Typography>
                  }
                />

                <FormControlLabel
                  sx={{ alignItems: 'flex-start', m: 0 }}
                  control={
                    <Checkbox
                      checked={photoChecked}
                      onChange={(e) => setPhotoChecked(e.target.checked)}
                      sx={{ pt: '2px', color: OPS_TEXT.brand, '&.Mui-checked': { color: OPS_TEXT.brand }, '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}` } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, pt: '2px' }}>
                      Check the tricycle photo and the plate details
                    </Typography>
                  }
                />
              </Box>
            </ReviewSection>
          </Box>
        </MacCenterModal>
      )}

      {/* Confirm: endorse to the LGU */}
      <MacConfirmDialog
        open={forwardDialogOpen}
        onClose={() => { if (!isSubmitting) { setForwardDialogOpen(false); setForwardError(null); } }}
        title="Endorse Application?"
        message={
          `Confirm that you are endorsing the application of ${selectedApplicant?.name} (${selectedApplicant?.vehiclePlate}). It will be sent to the LGU for the next review.` +
          (selectedApplicant && selectedApplicant.rosterMatchKnown !== false && !selectedApplicant.onSubmittedRoster
            ? ' The applicant is not on the Master Roster. You can still endorse, but the application will carry a Roster Mismatch flag, and the LGU must give a written reason before approving.'
            : '')
        }
        confirmLabel="Confirm Endorsement"
        confirmVariant="primary"
        isLoading={isSubmitting}
        errorMessage={forwardError}
        onConfirm={handleForwardConfirm}
      />

      {/* Done: the application was endorsed */}
      <Dialog
        open={celebrateDialogOpen}
        onClose={() => {
          setCelebrateDialogOpen(false);
          setSelectedApplicant(null);
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { ...DIALOG_PAPER_SX, textAlign: 'center', p: '22px 19px 19px' } } }}
      >
        <Box
          aria-hidden
          sx={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: '#DCFCE7',
            color: '#166534',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: '12px',
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 32 }} />
        </Box>
        <Typography component="h2" sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: OPS_TEXT.primary, mb: '4px' }}>
          Application endorsed
        </Typography>
        <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.5, mb: '18px' }}>
          The application was sent to the LGU for the next review.
        </Typography>
        <Button
          fullWidth
          variant="contained"
          disableElevation
          autoFocus
          onClick={() => {
            setCelebrateDialogOpen(false);
            setSelectedApplicant(null);
          }}
          sx={primaryButtonSx}
        >
          Done
        </Button>
      </Dialog>

      {/* Return for correction: which documents, and why (Rules 3.6, 3.8). The driver is asked for ONLY these. */}
      <Dialog
        open={returnDialogOpen}
        onClose={() => !isSubmitting && setReturnDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}
      >
        <DialogTitle sx={DIALOG_TITLE_SX}>Return for Correction</DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography sx={DIALOG_INTRO_SX}>
            Choose the documents <strong>{selectedApplicant?.name}</strong> must send again, and say what is wrong. The driver will only be asked for
            these documents; the others stay as they are.
          </Typography>

          {RETURN_DOCUMENTS.map((d) => {
            const row = returnForm[d.value];
            const flagged = (selectedApplicant?.documentReviews || []).find((r) => r.documentType === d.value)?.state === 'returned_elsewhere';
            return (
              <Box key={d.value} sx={{ p: '10px 12px', borderRadius: '10px', border: `1px solid ${row.checked ? '#D97706' : OPS_BORDER}`, backgroundColor: row.checked ? '#FFFBEB' : '#FFFFFF' }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Checkbox
                      checked={row.checked}
                      onChange={(e) => setReturnForm((prev) => ({ ...prev, [d.value]: { ...prev[d.value], checked: e.target.checked } }))}
                      sx={{ color: '#92400E', '&.Mui-checked': { color: '#92400E' }, '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}` } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: OPS_TEXT.primary }}>
                      {d.label}
                      {flagged && (
                        <Typography component="span" sx={{ fontSize: FONT.small, fontWeight: 500, color: OPS_TEXT.secondary, ml: '6px' }}>
                          (already flagged in another review)
                        </Typography>
                      )}
                    </Typography>
                  }
                />
                {row.checked && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', mt: '8px', pl: '6px' }}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Reason (choose one)"
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
                      label="What is wrong?"
                      placeholder="Write the exact reason for the driver..."
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
          <Typography sx={DIALOG_INTRO_SX}>
            Returning is not rejecting: the application stays open, and the 5-calendar-day review period restarts when the driver sends the documents again.
            It does not affect reviews by other TODAs.
          </Typography>
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={() => setReturnDialogOpen(false)} disabled={isSubmitting} variant="outlined" sx={secondaryButtonSx}>
            Cancel
          </Button>
          <Button onClick={handleReturnConfirm} variant="contained" disableElevation disabled={!returnIsComplete || isSubmitting} sx={primaryButtonSx}>
            {isSubmitting ? 'Returning...' : returnSelection.length > 1 ? `Return ${returnSelection.length} Documents` : 'Return Document to Driver'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject: PERMANENT grounds only (Rule 3.8). Document problems are RETURNED for correction, a separate action. */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => (isSubmitting ? undefined : setRejectDialogOpen(false))}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}
      >
        <DialogTitle sx={DIALOG_TITLE_SX}>Reject Application</DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Alert severity="error" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ ...reviewAlertSx, alignItems: 'flex-start' }}>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 700, mb: '3px' }}>Rejection is final.</Typography>
            <Typography sx={{ fontSize: FONT.small, lineHeight: 1.5 }}>
              <strong>{selectedApplicant?.name}</strong> cannot re-apply to your TODA and cannot send new documents. They will be told the reason you
              choose below.
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
          <Box sx={{ border: '1px solid #FDE68A', backgroundColor: '#FFFBEB', borderRadius: '10px', p: '11px 13px' }}>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: '#92400E', mb: '3px' }}>Is the problem fixable?</Typography>
            <Typography sx={{ fontSize: FONT.small, color: '#78350F', lineHeight: 1.5, mb: '10px' }}>
              A blurry photo, an expired or wrong document, or details that do not match can be corrected by the applicant. Do not reject for
              these: return the documents instead, and the applicant can send new ones.
            </Typography>
            <Button
              variant="outlined"
              disabled={isSubmitting}
              onClick={() => {
                setRejectDialogOpen(false);
                openReturnDialog();
              }}
              sx={{ ...secondaryButtonSx, color: '#92400E', borderColor: '#D97706', '&:hover': { backgroundColor: '#FEF3C7', borderColor: '#92400E' } }}
            >
              Return for Correction Instead
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={() => setRejectDialogOpen(false)} disabled={isSubmitting} variant="outlined" sx={secondaryButtonSx}>
            Cancel
          </Button>
          <Button onClick={handleRejectConfirm} variant="contained" disableElevation disabled={!rejectReason || isSubmitting} sx={dangerButtonSx}>
            {isSubmitting ? 'Rejecting...' : 'Reject Permanently'}
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
          imageUrls={previewDocData.urls}
          photoLabels={previewDocData.labels}
        />
      )}

      {/* Global Success / Error Toast Notification */}
      <SakayToast open={toastOpen} message={toastMessage} severity={toastSeverity} autoHideDuration={toastSeverity === 'error' ? 12000 : 5000} onClose={() => setToastOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
      </>
      )}
    </Box>
  );
};
