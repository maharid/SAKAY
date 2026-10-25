import React, { useState } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Rating,
  Button,
  Chip,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Badge,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import PersonIcon from '@mui/icons-material/Person';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import ShieldIcon from '@mui/icons-material/Shield';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

export type FaultyDocumentType = 'license' | 'mtop' | 'tricycle' | 'selfie';

export interface ReturnIssueItem {
  id: string;
  documentType: FaultyDocumentType;
  grounds: string;
  notes: string;
}

const DOCUMENT_TYPE_OPTIONS: { value: FaultyDocumentType; label: string; desc: string }[] = [
  { value: 'license', label: "Driver's License (Lisensya)", desc: 'Harap at likod ng lisensya' },
  { value: 'mtop', label: 'MTOP / Franchise Document', desc: 'Permit at prangkisa mula sa LGU/TODA' },
  { value: 'tricycle', label: 'Photo of Tricycle Unit', desc: 'Larawan ng buong tricycle at body number' },
  { value: 'selfie', label: 'Driver Photo / Selfie', desc: 'Malinaw na larawan ng mukha' },
];

const GROUNDS_BY_DOC_TYPE: Record<FaultyDocumentType, string[]> = {
  license: [
    'Illegible / Blurry Scans (Malabo o hindi mabasa)',
    'Documentary Issue (Kulang o may depekto)',
    'Expired License (Paso na ang lisensya)',
    'Data Mismatch (TODA Roster vs License)',
    'Cut-off / Incomplete Edges',
    'Iba pa / Other Grounds',
  ],
  mtop: [
    'Illegible / Blurry Document (Hindi mabasa ang prangkisa)',
    'Expired MTOP / Franchise',
    'Franchise Number / Plate Mismatch',
    'Missing Operator / Signature Details',
    'Iba pa / Other Grounds',
  ],
  tricycle: [
    'Unclear Tricycle Unit Photo (Malabo ang kuha ng tricycle)',
    'Body Number / Sidecar Plate Not Visible',
    'Wrong Color Scheme / Toda Decal Missing',
    'Unit Does Not Match Registered Specs',
    'Iba pa / Other Grounds',
  ],
  selfie: [
    'Face Not Clear / Lighting Issue (Madilim o malabo)',
    'Face Cut-off / Not Centered',
    'Face Does Not Match ID Photo',
    'Wearing Sunglasses / Face Obstructed',
    'Iba pa / Other Grounds',
  ],
};

const DEFAULT_NOTES_BY_DOC_TYPE: Record<FaultyDocumentType, string> = {
  license: 'Clearer license scan required',
  mtop: 'Please provide a clear copy showing the franchise number and validity date',
  tricycle: 'Tricycle unit photo must clearly show the sidecar body number',
  selfie: 'Please take selfie in a well-lit area without sunglasses or cap',
};

export function getDocumentType(doc: {
  docType?: FaultyDocumentType | string;
  name?: string;
  type?: string;
  id?: string;
}): FaultyDocumentType {
  if (doc.docType && (['license', 'mtop', 'tricycle', 'selfie'] as string[]).includes(doc.docType)) {
    return doc.docType as FaultyDocumentType;
  }
  const idLower = (doc.id || '').toLowerCase();
  if (idLower.includes('license')) return 'license';
  if (idLower.includes('mtop')) return 'mtop';
  if (idLower.includes('tricycle')) return 'tricycle';
  if (idLower.includes('selfie')) return 'selfie';

  const nameLower = (doc.name || '').toLowerCase();
  const typeLower = (doc.type || '').toLowerCase();
  const combined = `${nameLower} ${typeLower}`;

  if (combined.includes('license') || combined.includes('lisensya') || combined.includes('identification')) {
    return 'license';
  }
  if (combined.includes('mtop') || combined.includes('franchise') || combined.includes('prangkisa') || combined.includes('permit')) {
    return 'mtop';
  }
  if (combined.includes('tricycle') || combined.includes('trike') || combined.includes('unit') || combined.includes('vehicle')) {
    return 'tricycle';
  }
  if (combined.includes('selfie') || combined.includes('face') || combined.includes('biometric') || combined.includes('mukha')) {
    return 'selfie';
  }
  return 'license';
}

import { DriverRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { CloseAccountButton, VoidStrikeButton } from './AccountSanctionActions';
import { DeclineHistoryDialog, allowDriverReapplication, fetchDeclineHistory, permanentlyDisqualifyDriver } from '@sakay/shared';
import { supabase } from '../../services/supabaseClient';
import type { DeclineHistory } from '@sakay/shared';
import { MacConfirmDialog } from './MacConfirmDialog';
import { RestrictionBanner } from './RestrictionBanner';
import { StatusBadge } from '../common/StatusBadge';
import { ActionButton } from './ActionButton';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { useStrikeData } from '../../hooks/useStrikeData';
import { getStrikeLevel } from '../../utils/strikeLevel';
import {
  verifyDriver,
  rejectDriver,
  returnDriverForCorrection,
  suspendDriver,
  reactivateDriver,
  issueDriverStrike,
  recordAdminAuditAction,
  verifyDriverRenewal,
  sendDriverRenewalReminder,
  updateDriverDocumentReview,
} from '../../services/adminApiService';
import { CONTROL, FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

interface DriverDetailModalProps {
  open: boolean;
  onClose: () => void;
  driver: DriverRecord | null;
  onStatusChange?: (driverId: string, newStatus: 'Active' | 'Inactive') => void;
  onDriverUpdated?: (updatedDriver: DriverRecord) => void;
}

/** A stored date (YYYY-MM-DD or a full timestamp) as a readable date; a missing one says so instead of showing an invented date. */
const dateText = (value?: string | null): string => {
  if (!value) return 'Not recorded';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
};

export const DriverDetailModal: React.FC<DriverDetailModalProps> = ({
  open,
  onClose,
  driver,
  onStatusChange,
  onDriverUpdated,
}) => {
  const [docList, setDocList] = useState(driver?.documents || []);
  const [selectedDoc, setSelectedDoc] = useState<{ doc: DriverRecord['documents'][number]; index: number } | null>(null);
  const [reminderSent, setReminderSent] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null);

  // Dialog states
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  // The TODA application (affiliation) the Approve / Reject decision applies to. null = the one waiting for the LGU (driver.actionAffiliationId).
  const [targetAffiliationId, setTargetAffiliationId] = useState<string | null>(null);
  const [returnSummaryDialogOpen, setReturnSummaryDialogOpen] = useState(false);
  const [configureDocIssue, setConfigureDocIssue] = useState<{
    docType: FaultyDocumentType;
    docName: string;
    grounds: string;
    notes: string;
  } | null>(null);
  const [returnIssues, setReturnIssues] = useState<ReturnIssueItem[]>([]);
  const [noDocForReturnDialogOpen, setNoDocForReturnDialogOpen] = useState<boolean>(false);
  const [unsubmittedExitDialogOpen, setUnsubmittedExitDialogOpen] = useState<boolean>(false);
  const prevModalDriverIdRef = React.useRef<string | null>(null);

  // Authoritative strike ledger + violation catalog (read from the policy engine)
  const strikeData = useStrikeData('driver', open ? driver?.id : null);
  // Rule 7.9: the booking offers of this driver (declines and their reasons), for the review of a pattern of refusals
  // Rule 3.9: allowing a rejected applicant to re-apply (per application), and the permanent disqualification of an applicant (the LGU Administrator's only)
  const [reapplyTarget, setReapplyTarget] = useState<string | null>(null);
  const [disqualifyOpen, setDisqualifyOpen] = useState(false);
  const [declineView, setDeclineView] = useState<{ loading: boolean; history: DeclineHistory | null } | null>(null);
  const openDeclineHistory = async () => {
    if (!driver) return;
    setDeclineView({ loading: true, history: null });
    setDeclineView({ loading: false, history: await fetchDeclineHistory(supabase, driver.id) });
  };

  React.useEffect(() => {
    if (driver && open) {
      const isNewModalSession = prevModalDriverIdRef.current !== driver.id;
      if (!isNewModalSession) return;
      prevModalDriverIdRef.current = driver.id;

      let initialIssues: ReturnIssueItem[] = [];
      let faultyList: FaultyDocumentType[] = [];
      let verifiedList: FaultyDocumentType[] = [];

      if (driver.rejectionComment && driver.rejectionComment.startsWith('{')) {
        try {
          const parsed = JSON.parse(driver.rejectionComment);
          if (Array.isArray(parsed.issues) && parsed.issues.length > 0) {
            initialIssues = parsed.issues.map((i: any) => ({
              id: i.id || i.documentType,
              documentType: i.documentType as FaultyDocumentType,
              grounds: i.grounds || GROUNDS_BY_DOC_TYPE[i.documentType as FaultyDocumentType]?.[0] || 'Documentary Issue',
              notes: i.notes || DEFAULT_NOTES_BY_DOC_TYPE[i.documentType as FaultyDocumentType] || 'Resubmission required',
            }));
            faultyList = parsed.issues.map((i: any) => i.documentType as FaultyDocumentType);
          } else if (Array.isArray(parsed.faultyDocuments)) {
            faultyList = parsed.faultyDocuments as FaultyDocumentType[];
            initialIssues = parsed.faultyDocuments.map((docKey: string, idx: number) => ({
              id: String(idx + 1),
              documentType: docKey as FaultyDocumentType,
              grounds: parsed.displayReason || GROUNDS_BY_DOC_TYPE[docKey as FaultyDocumentType]?.[0] || 'Documentary Issue',
              notes: parsed.displayNotes || DEFAULT_NOTES_BY_DOC_TYPE[docKey as FaultyDocumentType] || 'Resubmission required',
            }));
          }
          if (Array.isArray(parsed.verifiedDocuments)) {
            verifiedList = parsed.verifiedDocuments as FaultyDocumentType[];
          }
        } catch {}
      }


      const rawDocs = driver.documents || [];
      const isResub = Boolean(driver.isResubmitted);
      const isFullyApproved = driver.verificationStatus === 'Verified' || driver.lguVerificationStatus === 'Verified';

      const normalizedDocs = rawDocs.map((d) => {
        const dType = getDocumentType(d);
        let status = d.status;
        if (isFullyApproved) {
          status = 'Verified';
        } else if (verifiedList.includes(dType) || d.status === 'Verified') {
          status = 'Verified';
        } else if (isResub && faultyList.includes(dType)) {
          // Document was flagged in past rejection and has now been resubmitted
          status = 'Resubmitted (Awaiting Review)';
        } else if (faultyList.includes(dType) && !isResub) {
          status = 'Resubmission Required';
        }
        return {
          ...d,
          docType: dType,
          status,
        };
      });

      setDocList(normalizedDocs);

      // ONLY populate returnIssues if the driver is currently sitting in 'Resubmission Required' (unresubmitted).
      // If the driver has resubmitted (or is newly endorsed/pending), start fresh with [] so previously approved documents (like MTOP) NEVER reappear!
      if (!isResub && driver.verificationStatus === 'Resubmission Required') {
        setReturnIssues(initialIssues);
      } else {
        setReturnIssues([]);
      }
    } else if (!open) {
      prevModalDriverIdRef.current = null;
    }
  }, [driver, open]);

  const handleApproveDocument = async (index: number) => {
    if (!driver || index < 0 || index >= docList.length) return;
    const targetDoc = docList[index];
    const docType = getDocumentType(targetDoc);
    const updated = [...docList];
    updated[index] = { ...targetDoc, docType, status: 'Verified' };
    setDocList(updated);

    const newReturnIssues = returnIssues.filter((i) => i.documentType !== docType);
    setReturnIssues(newReturnIssues);
    setSelectedDoc(null);
    setSnackbarMsg(`"${targetDoc.name}" has been inspected and marked as Verified.`);

    const currentVerified = updated
      .filter((d) => d.status === 'Verified')
      .map((d) => getDocumentType(d));


    const updatedDriver: DriverRecord = {
      ...driver,
      documents: updated,
    };
    if (onDriverUpdated) onDriverUpdated(updatedDriver);

    try {
      await updateDriverDocumentReview(driver.id, currentVerified);
    } catch (err) {
      console.warn('[DriverDetailModal] Error updating doc approval in backend:', err);
    }
  };

  const handleStartResubmitForDoc = (doc: DriverRecord['documents'][number]) => {
    const docType: FaultyDocumentType = getDocumentType(doc);
    const existing = returnIssues.find((i) => i.documentType === docType);
    setConfigureDocIssue({
      docType,
      docName: doc.name,
      grounds: existing?.grounds || GROUNDS_BY_DOC_TYPE[docType][0],
      notes: existing?.notes || DEFAULT_NOTES_BY_DOC_TYPE[docType] || '',
    });
    setSelectedDoc(null);
  };

  const handleSaveDocIssue = async () => {
    if (!driver || !configureDocIssue) return;
    const { docType, grounds, notes } = configureDocIssue;

    const updatedDocs = docList.map((d) =>
      getDocumentType(d) === docType
        ? { ...d, docType, status: 'Resubmission Required' as const }
        : d
    );
    setDocList(updatedDocs);

    const newReturnIssues = [
      ...returnIssues.filter((i) => i.documentType !== docType),
      {
        id: docType,
        documentType: docType,
        grounds,
        notes,
      },
    ];
    setReturnIssues(newReturnIssues);

    const currentVerified = updatedDocs
      .filter((d) => d.status === 'Verified')
      .map((d) => getDocumentType(d));


    const updatedDriver: DriverRecord = {
      ...driver,
      documents: updatedDocs,
    };
    if (onDriverUpdated) onDriverUpdated(updatedDriver);

    try {
      await updateDriverDocumentReview(driver.id, currentVerified);
    } catch (err) {
      console.warn('[DriverDetailModal] Error updating doc issue in backend:', err);
    }

    setSnackbarMsg(`"${configureDocIssue.docName}" marked as Resubmission Required.`);
    setConfigureDocIssue(null);
  };

  const handleEditIssueFromSummary = (issue: ReturnIssueItem) => {
    const doc = docList.find((d) => getDocumentType(d) === issue.documentType);
    setConfigureDocIssue({
      docType: issue.documentType,
      docName: doc?.name || DOCUMENT_TYPE_OPTIONS.find((o) => o.value === issue.documentType)?.label || issue.documentType,
      grounds: issue.grounds,
      notes: issue.notes,
    });
  };
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  const [renewalApproveDialogOpen, setRenewalApproveDialogOpen] = useState(false);
  const [renewalRejectDialogOpen, setRenewalRejectDialogOpen] = useState(false);

  if (!driver) return null;

  const isAccountActive = driver.accountStatus === 'Active';
  const isVerified = driver.verificationStatus === 'Verified';

  // Per-TODA applications: every affiliation is verified by its TODA first and then decided by the LGU on its own.
  const affiliations = driver.affiliations ?? [];
  const isAwaitingLgu = (a: { todaStage: string; lguStage: string }) => a.todaStage === 'Endorsed' && a.lguStage === 'Pending';
  const awaitingAffiliations = affiliations.filter(isAwaitingLgu);
  const decisionAffiliationId = targetAffiliationId ?? driver.actionAffiliationId;
  const decisionAffiliation = affiliations.find((a) => a.affiliationId === decisionAffiliationId);
  /** Which TODA a decision is about, for the dialogs: "Balite TODA", or the driver's TODA name when there is only one. */
  const decisionTodaLabel = decisionAffiliation ? decisionAffiliation.todaName : driver.todaName;
  /** The application being approved has an open Roster Mismatch flag: the database refuses the approval without a written reason. */
  const rosterOverrideNeeded = Boolean(decisionAffiliation?.rosterMismatchOpen);

  /**
   * Action Handler: Approve Stage 2 LGU Verification
   */
  const handleVerifyConfirm = async (overrideReason?: string) => {
    try {
      await verifyDriver(driver.id, undefined, decisionAffiliationId, overrideReason);
      setSnackbarMsg(`Driver ${driver.name} successfully verified and accredited${decisionAffiliation ? ` for ${decisionAffiliation.todaName}` : ''}.`);
      const approvedId = decisionAffiliationId;
      const nextAffiliations = affiliations.map((a) =>
        a.affiliationId === approvedId ? { ...a, lguStage: 'Approved' as const, rosterMismatchOpen: false } : a
      );
      const updated: DriverRecord = {
        ...driver,
        verificationStatus: 'Verified',
        lguVerificationStatus: 'Verified',
        accountStatus: 'Active',
        affiliations: nextAffiliations,
        actionAffiliationId: nextAffiliations.find(isAwaitingLgu)?.affiliationId,
      };
      if (onDriverUpdated) onDriverUpdated(updated);
      if (onStatusChange) onStatusChange(driver.id, 'Active');
    } catch (err) {
      console.error('[DriverDetailModal] Verification error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setVerifyDialogOpen(false);
    setTargetAffiliationId(null);
  };

  /**
   * Action Handler: Reject Driver Application
   */
  const handleRejectConfirm = async (reason?: string) => {
    const finalReason = reason || 'Non-compliance with LGU franchise documentary guidelines.';
    try {
      await rejectDriver(driver.id, finalReason, undefined, decisionAffiliationId);
      setSnackbarMsg(`Driver application for ${driver.name}${decisionAffiliation ? ` to ${decisionAffiliation.todaName}` : ''} has been rejected.`);
      const rejectedId = decisionAffiliationId;
      const nextAffiliations = affiliations.map((a) =>
        a.affiliationId === rejectedId ? { ...a, lguStage: 'Rejected' as const } : a
      );
      // The driver is rejected as a whole only when no other TODA application is left alive (the database does the same).
      const otherAlive = nextAffiliations.some(
        (a) => a.affiliationId !== rejectedId && a.todaStage !== 'Rejected' && a.lguStage !== 'Rejected'
      );
      const updated: DriverRecord = otherAlive
        ? { ...driver, affiliations: nextAffiliations, actionAffiliationId: nextAffiliations.find(isAwaitingLgu)?.affiliationId }
        : {
            ...driver,
            accountStatus: 'Inactive',
            verificationStatus: 'Rejected',
            lguVerificationStatus: 'Rejected',
            affiliations: nextAffiliations,
            actionAffiliationId: undefined,
          };
      if (onDriverUpdated) onDriverUpdated(updated);
      if (!otherAlive && onStatusChange) onStatusChange(driver.id, 'Inactive');
    } catch (err) {
      console.error('[DriverDetailModal] Rejection error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setRejectDialogOpen(false);
    setTargetAffiliationId(null);
  };

  /**
   * Action Handler: Return Driver Application for Resubmission (Rule 3.8)
   */
  const handleReturnConfirm = async () => {
    try {
      const summaryReason = returnIssues
        .map((i) => {
          const docLabel = DOCUMENT_TYPE_OPTIONS.find((d) => d.value === i.documentType)?.label || i.documentType;
          return `${docLabel}: ${i.grounds}`;
        })
        .join('; ');

      const summaryNotes = returnIssues
        .map((i) => {
          const docLabel = DOCUMENT_TYPE_OPTIONS.find((d) => d.value === i.documentType)?.label || i.documentType;
          return `${docLabel}: ${i.notes}`;
        })
        .join('; ');

      const ORDERED_TYPES: FaultyDocumentType[] = ['license', 'mtop', 'tricycle', 'selfie'];
      const faultyDocuments = ORDERED_TYPES.filter((t) => returnIssues.some((i) => i.documentType === t));

      const currentVerified = docList
        .filter((d) => d.status === 'Verified' && !faultyDocuments.includes(getDocumentType(d)))
        .map((d) => getDocumentType(d));

      const structuredPayload = {
        faultyDocuments,
        verifiedDocuments: currentVerified,
        issues: returnIssues.map((i) => ({
          documentType: i.documentType,
          grounds: i.grounds,
          notes: i.notes,
        })),
        displayReason: summaryReason,
        displayNotes: summaryNotes,
        returnedAt: new Date().toISOString(),
      };
      const finalCommentJson = JSON.stringify(structuredPayload);

      await returnDriverForCorrection(
        driver.id,
        summaryReason,
        summaryNotes,
        returnIssues.map((i) => ({
          documentType: i.documentType,
          grounds: i.grounds,
          notes: i.notes,
        })),
        currentVerified,
        decisionAffiliationId
      );

      const updatedDocuments = docList.map((d) => {
        const dType = getDocumentType(d);
        if (faultyDocuments.includes(dType)) {
          return { ...d, docType: dType, status: 'Resubmission Required' as const };
        }
        return { ...d, docType: dType };
      });

      setDocList(updatedDocuments);
      setSnackbarMsg(`Driver application for ${driver.name} returned for resubmission.`);
      const updated: DriverRecord = {
        ...driver,
        accountStatus: 'Inactive',
        verificationStatus: 'Resubmission Required',
        lguVerificationStatus: 'Resubmission Required',
        documents: updatedDocuments,
        rejectionReason: summaryReason,
        rejectionComment: finalCommentJson,
        isResubmitted: false,
      };
      if (onDriverUpdated) onDriverUpdated(updated);
      if (onStatusChange) onStatusChange(driver.id, 'Inactive');
    } catch (err) {
      console.error('[DriverDetailModal] Return error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setReturnIssues([]);
    setReturnSummaryDialogOpen(false);
  };

  /**
   * Action Handler: Suspend Driver Account
   */
  const handleSuspendConfirm = async (reason?: string) => {
    const finalReason = reason || 'Administrative policy suspension';
    try {
      const res = await suspendDriver(driver.id, finalReason, 7);
      setSnackbarMsg(`Driver ${driver.name} has been suspended for 7 days.`);
      const updated: DriverRecord = {
        ...driver,
        accountStatus: 'Inactive',
        verificationStatus: 'Suspended',
        restrictionKind: 'SUSPENDED',
        suspendedUntil: res.data.suspended_until ?? undefined,
        suspensionReason: finalReason,
      };
      if (onDriverUpdated) onDriverUpdated(updated);
      if (onStatusChange) onStatusChange(driver.id, 'Inactive');
    } catch (err) {
      console.error('[DriverDetailModal] Suspension error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setSuspendDialogOpen(false);
  };

  /**
   * Action Handler: Reactivate Driver Account
   */
  const handleReactivateConfirm = async () => {
    const wasDeactivated = driver.restrictionKind === 'DEACTIVATED';
    try {
      await reactivateDriver(
        driver.id,
        wasDeactivated ? 'Reactivated after manual review of the full violation history' : 'Suspension lifted by LGU Administrator',
        wasDeactivated
      );
      setSnackbarMsg(`Driver ${driver.name} account has been reactivated.`);
      const updated: DriverRecord = {
        ...driver,
        accountStatus: 'Active',
        verificationStatus: 'Verified',
        restrictionKind: undefined,
        suspendedUntil: undefined,
        suspensionReason: undefined,
      };
      void strikeData.reload();
      if (onDriverUpdated) onDriverUpdated(updated);
      if (onStatusChange) onStatusChange(driver.id, 'Active');
    } catch (err) {
      console.error('[DriverDetailModal] Reactivation error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setReactivateDialogOpen(false);
  };

  /**
   * Action Handler: Issue Policy Strike
   */
  const handleStrikeConfirm = async (reason?: string, violationCode?: string) => {
    if (!violationCode) return;
    const finalReason = reason || 'Administrator confirmed';
    try {
      // The database engine decides the points and the ladder consequence (nothing is computed here).
      const result = await issueDriverStrike(driver.id, violationCode, finalReason);
      const consequence = result.consequence ? ` Consequence: ${result.consequence.replace(/_/g, ' ').toLowerCase()}.` : '';
      setSnackbarMsg(`Recorded for ${driver.name}. Active strikes: ${result.active_after ?? driver.strikesCount}.${consequence}`);
      const restricted = result.consequence === 'SUSPENSION' || result.consequence === 'INVESTIGATION_SUSPENSION' || result.consequence === 'DEACTIVATION';
      const updated: DriverRecord = {
        ...driver,
        strikesCount: result.active_after ?? driver.strikesCount,
        accountStatus: restricted ? 'Inactive' : driver.accountStatus,
        verificationStatus: restricted ? 'Suspended' : driver.verificationStatus,
        restrictionKind: result.consequence === 'DEACTIVATION' ? 'DEACTIVATED'
          : result.consequence === 'INVESTIGATION_SUSPENSION' ? 'INVESTIGATION'
          : result.consequence === 'SUSPENSION' ? 'SUSPENDED' : driver.restrictionKind,
        suspendedUntil: result.suspended_until ?? driver.suspendedUntil,
      };
      void strikeData.reload();
      if (onDriverUpdated) onDriverUpdated(updated);
    } catch (err) {
      console.error('[DriverDetailModal] Strike error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setStrikeDialogOpen(false);
  };

  /**
   * Action Handler: Send Renewal Reminder Alert
   */
  const handleSendReminder = async () => {
    // a real notice in the driver's app (the database refuses a second one within 10 minutes and writes the audit entry)
    const problem = await sendDriverRenewalReminder(driver.id);
    if (problem) {
      setSnackbarMsg(problem);
      return;
    }
    setReminderSent(true);
    setSnackbarMsg(`Renewal reminder sent to ${driver.name}.`);
    setTimeout(() => setReminderSent(false), 3000);
  };

  /**
   * Action Handler: Approve Driver Document Renewal (Rule 24.2)
   */
  const handleRenewalApproveConfirm = async () => {
    try {
      await verifyDriverRenewal(driver.id, true);
      setSnackbarMsg(`Driver ${driver.name} document renewal approved.`);
      const updated: DriverRecord = {
        ...driver,
        renewalStatus: 'Approved',
        licenseExpiry: driver.pendingLicenseExpiry || driver.licenseExpiry,
        mtopExpiry: driver.pendingMtopExpiry || driver.mtopExpiry,
        pendingLicenseExpiry: undefined,
        pendingMtopExpiry: undefined,
      };
      if (onDriverUpdated) onDriverUpdated(updated);
    } catch (err) {
      console.error('[DriverDetailModal] Renewal approval error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setRenewalApproveDialogOpen(false);
  };

  /**
   * Action Handler: Reject Driver Document Renewal (Rule 24.2)
   */
  const handleRenewalRejectConfirm = async (reason?: string) => {
    const finalReason = reason || 'Non-compliant renewed documents.';
    try {
      await verifyDriverRenewal(driver.id, false, finalReason);
      setSnackbarMsg(`Driver ${driver.name} document renewal rejected.`);
      const updated: DriverRecord = {
        ...driver,
        renewalStatus: 'Rejected',
        pendingLicenseExpiry: undefined,
        pendingMtopExpiry: undefined,
      };
      if (onDriverUpdated) onDriverUpdated(updated);
    } catch (err) {
      console.error('[DriverDetailModal] Renewal rejection error:', err);
      setSnackbarMsg(`Error: ${(err as Error).message}`);
    }
    setRenewalRejectDialogOpen(false);
  };

  // Strike level calculation
  // Ladder label from policyConfig; the count comes from the ledger.
  const activeStrikes = strikeData.activeStrikes ?? driver.strikesCount;
  const strikeLevel = getStrikeLevel(activeStrikes);

  const pendingReturnCount = returnIssues.length;
  const hasResubmissionIssues = pendingReturnCount > 0 || docList.some((d) => d.status === 'Resubmission Required');
  const allDocumentsVerified = docList.length > 0 && docList.every((d) => d.status === 'Verified');

  const handleRequestClose = () => {
    if (pendingReturnCount > 0) {
      setUnsubmittedExitDialogOpen(true);
    } else {
      onClose();
    }
  };

  const handleReturnForResubmissionClick = () => {
    if (pendingReturnCount === 0) {
      setNoDocForReturnDialogOpen(true);
    } else {
      setReturnSummaryDialogOpen(true);
    }
  };

  let primaryActionLabel = '';
  let primaryActionColor: 'primary' | 'warning' | 'error' = 'primary';
  let primaryActionDisabled = false;
  let onPrimaryAction: () => void = () => {};

  if (!isVerified) {
    primaryActionLabel = 'Approve Stage 2 verification';
    primaryActionColor = 'primary';
    // With TODA applications on record, the LGU can only decide one that its TODA has already endorsed (sequential review, Policy 3.1).
    const nothingWaitingForLgu = affiliations.length > 0 && !decisionAffiliation;
    primaryActionDisabled = !allDocumentsVerified || pendingReturnCount > 0 || nothingWaitingForLgu;
    onPrimaryAction = () => setVerifyDialogOpen(true);
  } else {
    primaryActionLabel = isAccountActive ? 'Suspend driver' : 'Reactivate driver';
    primaryActionColor = isAccountActive ? 'error' : 'primary';
    onPrimaryAction = isAccountActive ? () => setSuspendDialogOpen(true) : () => setReactivateDialogOpen(true);
  }

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={handleRequestClose}
        title={driver.name}
        subtitle={`License no. ${driver.licenseNo} · ${driver.todaName}`}
        badge={<StatusBadge status={(driver.verificationStatus && driver.verificationStatus !== 'Verified' ? driver.verificationStatus : driver.accountStatus) as any} />}
        maxWidth={672}
        primaryActionLabel={primaryActionLabel}
        primaryActionColor={primaryActionColor}
        primaryActionDisabled={primaryActionDisabled}
        onPrimaryAction={onPrimaryAction}
        secondaryActionLabel={!isVerified ? 'Reject application' : 'Close'}
        secondaryActionColor={!isVerified ? 'error' : 'inherit'}
        onSecondaryAction={!isVerified ? () => setRejectDialogOpen(true) : handleRequestClose}
        extraActions={
          !isVerified ? (
            <Badge
              badgeContent={pendingReturnCount}
              color="error"
              invisible={pendingReturnCount === 0}
              sx={{
                '& .MuiBadge-badge': {
                  right: 4,
                  top: 4,
                  fontWeight: 700,
                  fontSize: FONT.caption,
                  backgroundColor: '#DC2626',
                  color: '#FFFFFF',
                  boxShadow: '0 0 0 2px #FFFFFF',
                },
              }}
            >
              <Button
                variant={pendingReturnCount > 0 ? 'contained' : 'outlined'}
                onClick={handleReturnForResubmissionClick}
                sx={{
                  height: CONTROL.height,
                  '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontSize: FONT.body,
                  fontWeight: 700,
                  textTransform: 'none',
                  ...(pendingReturnCount > 0
                    ? {
                        backgroundColor: '#D97706',
                        color: '#FFFFFF',
                        border: '1.5px solid #D97706',
                        '&:hover': { backgroundColor: '#B45309', borderColor: '#B45309' },
                      }
                    : {
                        backgroundColor: '#FFFFFF',
                        color: '#475569',
                        border: '1.5px solid #CBD5E1',
                        '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#94A3B8', color: '#1E293B' },
                      }),
                }}
              >
                Return for resubmission
              </Button>
            </Badge>
          ) : driver.restrictionKind !== 'CLOSED' ? (
            <CloseAccountButton
              subjectType="driver"
              subjectId={driver.id}
              subjectName={driver.name}
              onDone={async (message) => {
                setSnackbarMsg(message);
                await strikeData.reload();
                if (onDriverUpdated) onDriverUpdated({ ...driver, accountStatus: 'Inactive', restrictionKind: 'CLOSED' });
              }}
            />
          ) : undefined
        }
      >
        {/* TODA applications (Driver Module 2.1 / Policy 3.1): one row per affiliation, each with its own TODA and LGU stage */}
        {affiliations.length > 0 && (
          <Box sx={{ mb: 1.6, p: 1.6, borderRadius: '12px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary, mb: 0.8 }}>
              TODA applications ({affiliations.length})
            </Typography>
            {affiliations.map((aff) => {
              const waiting = isAwaitingLgu(aff);
              const selected = waiting && decisionAffiliationId === aff.affiliationId;
              const chipTone = (stage: string) =>
                stage === 'Endorsed' || stage === 'Approved'
                  ? { backgroundColor: '#DCFCE7', color: '#15803D' }
                  : stage === 'Rejected'
                  ? { backgroundColor: '#FEE2E2', color: '#B91C1C' }
                  : stage === 'Resubmission Required'
                  ? { backgroundColor: '#FEF3C7', color: '#B45309' }
                  : { backgroundColor: '#E2E8F0', color: '#475569' };
              return (
                <Box
                  key={aff.affiliationId}
                  onClick={waiting ? () => setTargetAffiliationId(aff.affiliationId) : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.2,
                    py: 0.8,
                    px: 1.25,
                    borderRadius: '8px',
                    cursor: waiting ? 'pointer' : 'default',
                    border: selected ? '1.5px solid #FF6600' : '1.5px solid transparent',
                    backgroundColor: selected ? '#FFF7ED' : 'transparent',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: '#0F172A' }}>
                      {aff.todaName}
                      {aff.isActive ? ' • Active' : ''}
                    </Typography>
                    <Typography sx={{ fontSize: FONT.caption, color: '#64748B' }}>
                      {[aff.membershipNo && `Member no. ${aff.membershipNo}`, aff.assignedTerminal, aff.barangayServiceArea].filter(Boolean).join(' • ') || 'No membership details'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {aff.rosterMismatchOpen && (
                      <Chip size="small" label="Roster mismatch" sx={{ fontWeight: 700, fontSize: FONT.caption, backgroundColor: '#FEF3C7', color: '#92400E' }} />
                    )}
                    <Chip size="small" label={`TODA: ${aff.todaStage}`} sx={{ fontWeight: 700, fontSize: FONT.caption, ...chipTone(aff.todaStage) }} />
                    <Chip size="small" label={`LGU: ${aff.lguStage}`} sx={{ fontWeight: 700, fontSize: FONT.caption, ...chipTone(aff.lguStage) }} />
                    {(aff.todaStage === 'Rejected' || aff.lguStage === 'Rejected') && !driver.isPermanentlyDisqualified && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={(e) => { e.stopPropagation(); setReapplyTarget(aff.affiliationId); }}
                        sx={{ textTransform: 'none', fontWeight: 700, fontSize: FONT.small, py: 0, minHeight: 24 }}
                      >
                        Allow re-application
                      </Button>
                    )}
                  </Box>
                </Box>
              );
            })}
            {driver.isPermanentlyDisqualified ? (
              <Alert severity="error" sx={{ mt: 1.2, borderRadius: '10px' }}>
                Permanently disqualified: this applicant can never be cleared to re-apply.{driver.disqualificationReason ? ` Reason: ${driver.disqualificationReason}` : ''}
              </Alert>
            ) : (
              <Button size="small" color="error" variant="text" onClick={() => setDisqualifyOpen(true)} sx={{ textTransform: 'none', fontWeight: 600, fontSize: FONT.small, mt: 0.4, px: 0 }}>
                Permanently disqualify this applicant
              </Button>
            )}
            <Typography sx={{ fontSize: FONT.caption, color: '#64748B', mt: 0.8 }}>
              {awaitingAffiliations.length > 1
                ? 'Several TODA applications are waiting for the LGU. Click the one the Approve / Reject action applies to.'
                : awaitingAffiliations.length === 1
                ? 'The Approve / Reject action applies to the application waiting for the LGU. Each TODA application is decided on its own.'
                : 'No TODA application is waiting for the LGU: a TODA must endorse its application first.'}
            </Typography>
          </Box>
        )}

        {/* Resubmission Required Alert Banner */}
        {driver.verificationStatus === 'Resubmission Required' && (() => {
          let displayReason = driver.rejectionReason || 'Documentary Issue';
          let displayNotes = driver.rejectionComment || 'Clearer license scan required';
          let faultyList: string[] = [];

          if (driver.rejectionComment && driver.rejectionComment.startsWith('{')) {
            try {
              const parsed = JSON.parse(driver.rejectionComment);
              if (parsed.displayReason) displayReason = parsed.displayReason;
              if (parsed.displayNotes) displayNotes = parsed.displayNotes;
              if (Array.isArray(parsed.faultyDocuments)) {
                faultyList = parsed.faultyDocuments;
              } else if (Array.isArray(parsed.issues)) {
                faultyList = parsed.issues.map((i: any) => i.documentType);
              }
            } catch {}
          }

          const docLabels: Record<string, string> = {
            license: "Driver's License",
            mtop: 'MTOP / Franchise',
            tricycle: 'Photo ng Tricycle',
            selfie: 'Photo / Selfie',
          };

          return (
            <Box
              sx={{
                backgroundColor: '#FFFBEB',
                border: '1.5px solid #F59E0B',
                borderRadius: '12px',
                p: '13px 16px',
                mb: 2.4,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                  <Chip
                    label="Resubmission Required"
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: '#B45309',
                      fontWeight: 700,
                      fontSize: FONT.caption,
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                    }}
                  />
                  <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: '#92400E' }}>
                    Application Returned for Resubmission
                  </Typography>
                </Box>
              </Box>

              {faultyList.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.8, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: '#78350F' }}>
                    Faulty Document(s):
                  </Typography>
                  {faultyList.map((docKey) => (
                    <Chip
                      key={docKey}
                      label={docLabels[docKey] || docKey}
                      size="small"
                      sx={{
                        backgroundColor: '#FEF3C7',
                        color: '#92400E',
                        fontWeight: 600,
                        fontSize: FONT.caption,
                        border: '1px solid #FDE68A',
                      }}
                    />
                  ))}
                </Box>
              )}

              <Typography sx={{ fontSize: FONT.caption, color: '#78350F', mt: 0.4, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700 }}>Grounds:</span> {displayReason}
              </Typography>
              <Typography sx={{ fontSize: FONT.caption, color: '#78350F', mt: 0.4, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700 }}>Reviewer Notes:</span> {displayNotes}
              </Typography>
            </Box>
          );
        })()}

        {/* Resubmission Received Alert Banner (Awaiting LGU Review) */}
        {(driver.isResubmitted || driver.verificationStatus === 'Resubmitted (Awaiting Review)') && !isVerified && driver.verificationStatus !== 'Resubmission Required' && (() => {
          let faultyList: string[] = [];
          if (driver.rejectionComment && driver.rejectionComment.startsWith('{')) {
            try {
              const parsed = JSON.parse(driver.rejectionComment);
              if (Array.isArray(parsed.faultyDocuments)) {
                faultyList = parsed.faultyDocuments;
              } else if (Array.isArray(parsed.issues)) {
                faultyList = parsed.issues.map((i: any) => i.documentType);
              }
            } catch {}
          }

          const docLabels: Record<string, string> = {
            license: "Driver's License",
            mtop: 'MTOP / Franchise',
            tricycle: 'Photo ng Tricycle',
            selfie: 'Photo / Selfie',
          };

          return (
            <Box
              sx={{
                backgroundColor: '#EFF6FF',
                border: '1.5px solid #3B82F6',
                borderRadius: '12px',
                p: '13px 16px',
                mb: 2.4,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                  <Chip
                    label="Resubmission Received"
                    size="small"
                    sx={{
                      backgroundColor: '#DBEAFE',
                      color: '#1D4ED8',
                      fontWeight: 700,
                      fontSize: FONT.caption,
                      border: '1px solid #93C5FD',
                    }}
                  />
                  <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: '#1E40AF' }}>
                    Updated Documents Awaiting LGU Re-inspection
                  </Typography>
                </Box>
                {driver.resubmittedAt && (
                  <Typography sx={{ fontSize: FONT.caption, color: '#64748B', fontWeight: 500 }}>
                    Resubmitted: {new Date(driver.resubmittedAt).toLocaleDateString()} {new Date(driver.resubmittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                )}
              </Box>

              {faultyList.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.8, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: '#1E3A8A' }}>
                    Corrected Document(s):
                  </Typography>
                  {faultyList.map((docKey) => (
                    <Chip
                      key={docKey}
                      label={docLabels[docKey] || docKey}
                      size="small"
                      sx={{
                        backgroundColor: '#BFDBFE',
                        color: '#1E40AF',
                        fontWeight: 600,
                        fontSize: FONT.caption,
                        border: '1px solid #93C5FD',
                      }}
                    />
                  ))}
                </Box>
              )}

              <Typography sx={{ fontSize: FONT.caption, color: '#1E3A8A', lineHeight: 1.5 }}>
                Driver <strong>{driver.name}</strong> has submitted corrected documents following the previous return. Please inspect the updated document(s) below to proceed with Stage 2 verification approval.
              </Typography>
            </Box>
          );
        })()}

        {/* Header Profile Summary Bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FAFAFC',
            padding: '14px 19px',
            borderRadius: '12px',
            border: '1px solid var(--mac-border-color)',
            mb: 3.2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar
              sx={{
                width: 56,
                height: 56,
                backgroundColor: 'var(--sakay-orange)',
                color: '#FFFFFF',
                fontSize: '18px',
                fontWeight: 700,
                boxShadow: 'var(--mac-shadow-subtle)',
              }}
            >
              {driver.name.charAt(0)}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: 'var(--mac-text-primary)', lineHeight: 1.2 }}>
                {driver.name}
              </Typography>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mt: '3px' }}>
                Affiliated with <span style={{ fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.todaName}</span>
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.8 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              {driver.ratingCount > 0 ? (
                <>
                  <Rating value={driver.rating} readOnly precision={0.1} size="small" emptyIcon={<StarIcon fontSize="inherit" />} />
                  <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                    {driver.rating} / 5 ({driver.ratingCount} {driver.ratingCount === 1 ? 'rating' : 'ratings'})
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: 'var(--mac-text-muted)' }}>
                  Not Yet Rated
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.4 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: driver.onlineStatus === 'Online' ? '#34A853' : '#9AA0A6' }} />
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: driver.onlineStatus === 'Online' ? '#1E8E3E' : 'var(--mac-text-muted)' }}>
                Session: {driver.onlineStatus}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Section 1: Strike System & Policy Compliance */}
        <Box sx={{ mb: 3.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <FlashOnIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
              <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>
                Strikes and discipline
              </Typography>
            </Box>
            <Chip
              icon={<ShieldIcon style={{ fontSize: '12px', color: strikeLevel.color }} />}
              label={strikeLevel.label}
              size="small"
              sx={{
                backgroundColor: strikeLevel.bg,
                color: strikeLevel.color,
                fontWeight: 700,
                fontSize: FONT.cardTitle,
                height: 26,
                border: `1px solid ${strikeLevel.border}`,
              }}
            />
          </Box>

          <Box sx={{ backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px', mb: 1.6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                Active Strikes: <span style={{ color: activeStrikes > 0 ? '#DC2626' : '#1E8E3E', fontWeight: 700 }}>{activeStrikes} Strike(s)</span>
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.8 }}>
                <ActionButton
                  label="Booking offers"
                  showArrow={false}
                  onClick={openDeclineHistory}
                  sx={{ height: 32, fontSize: FONT.caption }}
                />
                <ActionButton
                  label="+ Record Violation / Strike"
                  showArrow={false}
                  onClick={() => setStrikeDialogOpen(true)}
                  sx={{ height: 32, fontSize: FONT.caption }}
                />
              </Box>
            </Box>

            {strikeData.history.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, mt: 1.6 }}>
                {strikeData.history.slice(0, 8).map((item) => (
                  <Box
                    key={item.id}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.6, backgroundColor: '#FFFFFF', padding: '8px 11px', borderRadius: '9px', border: '1px solid var(--mac-border-color)' }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                        +{item.strikesApplied} • {item.reason}
                      </Typography>
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
                        {item.date} • {item.issuedBy}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                      <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: '#C25E00' }}>{item.status}</Typography>
                      {item.voidable && (
                        <VoidStrikeButton
                          strikeId={item.id}
                          onDone={async (message) => {
                            setSnackbarMsg(message);
                            await strikeData.reload();
                          }}
                        />
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          <RestrictionBanner kind={driver.restrictionKind} suspendedUntil={driver.suspendedUntil} reason={driver.suspensionReason} />
        </Box>

        {/* Section 2: Personal Information */}
        <Box sx={{ mb: 3.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.6 }}>
            <PersonIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>
              Personal details
            </Typography>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px' }}>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Full Name</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.name}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Contact Phone</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.phone}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Residential Barangay</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.barangay}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Account Status</Typography>
              <StatusBadge status={driver.accountStatus as any} />
            </Box>
          </Box>
        </Box>

        {/* Section 3: TODA Affiliation */}
        <Box sx={{ mb: 3.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.6 }}>
            <AccountBalanceIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>
              TODA membership and endorsement
            </Typography>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px' }}>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Affiliated TODA</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.todaName}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>TODA Stage 1 Endorsement</Typography>
              <StatusBadge status={driver.todaVerificationStatus as any} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>TODA Membership No.</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                {driver.affiliations?.find((a) => a.isActive)?.membershipNo ?? driver.affiliations?.find((a) => a.membershipNo)?.membershipNo ?? 'Not recorded'}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Assigned Corridor</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.barangay}</Typography>
            </Box>
          </Box>
        </Box>

        {/* Section 4: Vehicle & License Credentials */}
        <Box sx={{ mb: 3.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.6 }}>
            <DirectionsCarIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>
              Vehicle and MTOP franchise (City Ord. No. 118)
            </Typography>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px' }}>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Professional Driver's License</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.licenseNo}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>License Expiry</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{dateText(driver.licenseExpiry)}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>MTOP Franchise No.</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.mtopNo || 'Not recorded'}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>MTOP Expiry</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{dateText(driver.mtopExpiry)}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Tricycle Vehicle Plate</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.vehiclePlate || 'Not recorded'}</Typography>
            </Box>
            <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
              <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-muted)', mb: '3px' }}>Registered MTOP Operator</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{driver.mtopOperatorName || 'Not recorded'}</Typography>
            </Box>
          </Box>

          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FAFAFC', padding: '11px 14px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
            <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-secondary)' }}>
              Send License & Franchise renewal advisory to driver.
            </Typography>
            <ActionButton
              label={reminderSent ? 'Alert Sent ✓' : 'Send Renewal Alert'}
              showArrow={false}
              onClick={handleSendReminder}
              sx={{ height: 34, fontSize: FONT.body }}
            />
          </Box>
        </Box>

        {/* Section 4B: Pending Document Renewal Review (Rule 24.2) */}
        {(driver.renewalStatus === 'Pending LGU Verification' || Boolean(driver.pendingLicenseExpiry || driver.pendingMtopExpiry)) && (
          <Box sx={{ mb: 3.2, backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '12px', padding: '16px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.6 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                <VerifiedUserIcon sx={{ color: '#D97706', fontSize: 16 }} />
                <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.warning }}>
                  Pending document renewal application
                </Typography>
              </Box>
              <Chip label="Pending LGU Verification" size="small" sx={{ backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 600, fontSize: FONT.caption }} />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.6, mb: 2 }}>
              {driver.pendingLicenseExpiry && (
                <Box sx={{ backgroundColor: '#FFFFFF', p: 1.2, borderRadius: '8px', border: '1px solid #FDE68A' }}>
                  <Typography sx={{ fontSize: FONT.caption, color: '#92400E', fontWeight: 600 }}>Proposed License Expiry</Typography>
                  <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: '#1F2937' }}>{dateText(driver.pendingLicenseExpiry)}</Typography>
                  <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Current: {dateText(driver.licenseExpiry)}</Typography>
                </Box>
              )}
              {driver.pendingMtopExpiry && (
                <Box sx={{ backgroundColor: '#FFFFFF', p: 1.2, borderRadius: '8px', border: '1px solid #FDE68A' }}>
                  <Typography sx={{ fontSize: FONT.caption, color: '#92400E', fontWeight: 600 }}>Proposed MTOP Expiry</Typography>
                  <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: '#1F2937' }}>{dateText(driver.pendingMtopExpiry)}</Typography>
                  <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Current: {dateText(driver.mtopExpiry)}</Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.2, justifyContent: 'flex-end' }}>
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={() => setRenewalRejectDialogOpen(true)}
                sx={{ textTransform: 'none', fontWeight: 600, fontSize: FONT.small }}
              >
                Reject renewal
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={() => setRenewalApproveDialogOpen(true)}
                sx={{ backgroundColor: '#D97706', '&:hover': { backgroundColor: '#B45309' }, textTransform: 'none', fontWeight: 600, fontSize: FONT.small }}
              >
                Approve & Update Expiry
              </Button>
            </Box>
          </Box>
        )}

        {/* Section 5: Verification Credentials */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <VerifiedUserIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
              <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>
                Verification documents ({docList.length})
              </Typography>
            </Box>
            {!isVerified && !allDocumentsVerified && !hasResubmissionIssues && (
              <Typography sx={{ fontSize: FONT.caption, color: '#D97706', fontWeight: 600 }}>
                * Inspect and verify all 4 documents to enable Stage 2 Approval
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
            {docList.map((doc, idx) => {
              const docType = getDocumentType(doc);
              const isStagedForReturn = returnIssues.some((i) => i.documentType === docType) || doc.status === 'Resubmission Required';
              const isDocVerified = !isStagedForReturn && doc.status === 'Verified';
              const isDocResubmit = isStagedForReturn;

              let wasFlagged = false;
              if (driver.rejectionComment && driver.rejectionComment.startsWith('{')) {
                try {
                  const p = JSON.parse(driver.rejectionComment);
                  const fList = p.faultyDocuments || (Array.isArray(p.issues) ? p.issues.map((i: any) => i.documentType) : []);
                  wasFlagged = fList.includes(docType);
                } catch {}
              }
              const isDocRecentlyResubmitted = !isStagedForReturn && !isDocVerified && (doc.status === 'Resubmitted (Awaiting Review)' || (Boolean(driver.isResubmitted) && wasFlagged));

              return (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '11px 14px',
                    borderRadius: '10px',
                    border: '1px solid',
                    borderColor: isDocVerified ? '#BBF7D0' : isDocResubmit ? '#FCD34D' : isDocRecentlyResubmitted ? '#93C5FD' : 'var(--mac-border-color)',
                    backgroundColor: isDocVerified ? '#F0FDF4' : isDocResubmit ? '#FFFBEB' : isDocRecentlyResubmitted ? '#EFF6FF' : '#FFFFFF',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.6 }}>
                    {isDocVerified ? (
                      <CheckCircleIcon sx={{ color: '#16A34A', fontSize: 16 }} />
                    ) : isDocResubmit ? (
                      <AssignmentReturnIcon sx={{ color: '#D97706', fontSize: 16 }} />
                    ) : isDocRecentlyResubmitted ? (
                      <AssignmentReturnIcon sx={{ color: '#2563EB', fontSize: 16 }} />
                    ) : (
                      <VerifiedUserIcon sx={{ color: '#94A3B8', fontSize: 16 }} />
                    )}
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                        <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {doc.name}
                        </Typography>
                        {isDocVerified && (
                          <Chip
                            label="Verified"
                            size="small"
                            sx={{ backgroundColor: '#DCFCE7', color: '#15803D', fontWeight: 700, fontSize: FONT.caption, height: 20 }}
                          />
                        )}
                        {isDocResubmit && (
                          <Chip
                            label="Resubmission Required"
                            size="small"
                            sx={{ backgroundColor: '#FEF3C7', color: '#B45309', fontWeight: 700, fontSize: FONT.caption, height: 20 }}
                          />
                        )}
                        {isDocRecentlyResubmitted && (
                          <Chip
                            label="Resubmitted (Awaiting Review)"
                            size="small"
                            sx={{ backgroundColor: '#DBEAFE', color: '#1D4ED8', fontWeight: 700, fontSize: FONT.caption, height: 20, border: '1px solid #93C5FD' }}
                          />
                        )}
                        {!isDocVerified && !isDocResubmit && !isDocRecentlyResubmitted && (
                          <Chip
                            label="Pending Inspection"
                            size="small"
                            sx={{ backgroundColor: '#F1F5F9', color: '#64748B', fontWeight: 600, fontSize: FONT.caption, height: 20 }}
                          />
                        )}
                      </Box>
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px' }}>
                        {doc.type}
                      </Typography>
                    </Box>
                  </Box>
                  <ActionButton
                    label="Inspect File"
                    showArrow={false}
                    onClick={() => setSelectedDoc({ doc, index: idx })}
                    sx={{ height: 34, fontSize: FONT.body }}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </MacCenterModal>

      {/* Confirmation Dialogs */}
      <MacConfirmDialog
        open={verifyDialogOpen}
        onClose={() => { setVerifyDialogOpen(false); setTargetAffiliationId(null); }}
        title={rosterOverrideNeeded ? 'Approve despite the roster mismatch?' : 'Approve Stage 2 driver verification?'}
        message={
          rosterOverrideNeeded
            ? `"${driver.name}" is NOT on the ${decisionTodaLabel} master roster (open Roster Mismatch flag). You may still approve, but you must write why. The reason is recorded on the flag and in the audit log under your name.`
            : `Authorize driver "${driver.name}" (${decisionTodaLabel}) for official franchise operations in Calapan City.`
        }
        confirmLabel={rosterOverrideNeeded ? 'Approve with override' : 'Approve driver'}
        confirmVariant="orange"
        requireReason={rosterOverrideNeeded}
        minReasonLength={10}
        reasonPlaceholder="Why is this applicant approved although they are not on the TODA roster? (e.g. checked the franchise record with the TODA president)"
        onConfirm={(reason) => handleVerifyConfirm(rosterOverrideNeeded ? reason : undefined)}
      />

      {/* Return for Resubmission Summary Dialog (Rule 3.8 Return Flow) */}
      <Dialog
        open={returnSummaryDialogOpen}
        onClose={() => setReturnSummaryDialogOpen(false)}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
            },
          },
          paper: {
            sx: {
              borderRadius: 'var(--mac-radius-lg)',
              maxWidth: 464,
              width: '100%',
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--mac-shadow-popover)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            padding: '16px 19px 13px 19px',
            borderBottom: '1px solid var(--mac-border-color)',
            fontSize: FONT.body,
            fontWeight: 700,
            color: '#92400E',
            backgroundColor: '#FFFBEB',
            display: 'flex',
            alignItems: 'center',
            gap: 1.2,
          }}
        >
          <AssignmentReturnIcon sx={{ color: '#D97706', fontSize: 18 }} />
          Return Application for Resubmission
        </DialogTitle>

        <DialogContent sx={{ p: '19px !important', maxHeight: '65vh', overflowY: 'auto' }}>
          <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-secondary)', lineHeight: 1.5, mb: 2 }}>
            Review the flagged document issues below before returning the application for <strong>{driver.name}</strong> ({driver.todaName}) under the <strong>Return Flow</strong>. The driver will only be required to correct and re-upload the flagged document(s).
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
            {returnIssues.map((issue, idx) => {
              const doc = docList.find((d) => getDocumentType(d) === issue.documentType);
              const docName = doc?.name || DOCUMENT_TYPE_OPTIONS.find((o) => o.value === issue.documentType)?.label || issue.documentType;

              return (
                <Box
                  key={issue.id || idx}
                  sx={{
                    p: 1.6,
                    borderRadius: '12px',
                    backgroundColor: '#FAFAFC',
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.warning }}>
                      Faulty document issue #{idx + 1}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditIcon sx={{ fontSize: 13 }} />}
                      onClick={() => handleEditIssueFromSummary(issue)}
                      sx={{
                        height: 28,
                        fontSize: FONT.small,
                        fontWeight: 600,
                        textTransform: 'none',
                        borderColor: '#D97706',
                        color: '#B45309',
                        borderRadius: '6px',
                        backgroundColor: '#FFFBEB',
                        '&:hover': {
                          backgroundColor: '#FEF3C7',
                          borderColor: '#B45309',
                        },
                      }}
                    >
                      Edit
                    </Button>
                  </Box>

                  {/* Document Name - Locked text */}
                  <Box sx={{ mb: 1.2 }}>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>
                      Document name
                    </Typography>
                    <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: 'var(--mac-text-primary)', mt: '2px' }}>
                      {docName}
                    </Typography>
                  </Box>

                  {/* Grounds */}
                  <Box sx={{ mb: 1.2 }}>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>
                      Selected grounds
                    </Typography>
                    <Typography sx={{ fontSize: FONT.caption, fontWeight: 500, color: 'var(--mac-text-secondary)', mt: '2px' }}>
                      {issue.grounds}
                    </Typography>
                  </Box>

                  {/* Reviewer Notes */}
                  <Box>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>
                      Reviewer notes and instructions
                    </Typography>
                    <Typography sx={{ fontSize: FONT.caption, fontStyle: 'italic', color: '#334155', mt: '2px', backgroundColor: '#FFFFFF', p: '6px 10px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                      "{issue.notes}"
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </DialogContent>

        <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2 }}>
          <Button
            onClick={() => setReturnSummaryDialogOpen(false)}
            sx={{
              height: CONTROL.height,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 14px',
              borderRadius: '9px',
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 600,
              color: '#334155',
              border: '1.5px solid #94A3B8',
              backgroundColor: '#FFFFFF',
              '&:hover': { backgroundColor: '#F1F5F9' },
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={handleReturnConfirm}
            variant="contained"
            sx={{
              height: CONTROL.height,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 16px',
              borderRadius: '9px',
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 700,
              backgroundColor: '#D97706',
              color: '#FFFFFF',
              boxShadow: 'var(--mac-shadow-subtle)',
              '&:hover': { backgroundColor: '#B45309' },
            }}
          >
            Confirm & Return Application ({returnIssues.length} {returnIssues.length === 1 ? 'Issue' : 'Issues'})
          </Button>
        </DialogActions>
      </Dialog>

      {/* Configure Document Resubmission Dialog */}
      <Dialog
        open={Boolean(configureDocIssue)}
        onClose={() => setConfigureDocIssue(null)}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
            },
          },
          paper: {
            sx: {
              borderRadius: 'var(--mac-radius-lg)',
              maxWidth: 400,
              width: '100%',
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--mac-shadow-popover)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            padding: '14px 19px 11px',
            borderBottom: '1px solid var(--mac-border-color)',
            fontSize: FONT.body,
            fontWeight: 700,
            color: '#92400E',
            backgroundColor: '#FFFBEB',
            display: 'flex',
            alignItems: 'center',
            gap: 1.2,
          }}
        >
          <AssignmentReturnIcon sx={{ color: '#D97706', fontSize: 16 }} />
          Configure Document Resubmission
        </DialogTitle>

        <DialogContent sx={{ p: '16px 19px !important' }}>
          {configureDocIssue && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
              {/* Document Type - Locked / Non-editable */}
              <Box>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary, mb: 0.4 }}>
                  Target document (locked)
                </Typography>
                <Box
                  sx={{
                    p: '8px 11px',
                    borderRadius: '8px',
                    backgroundColor: '#F8FAFC',
                    border: '1.5px solid #CBD5E1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography sx={{ fontSize: FONT.caption, fontWeight: 700, color: '#0F172A' }}>
                    {configureDocIssue.docName}
                  </Typography>
                  <Chip label="Selected" size="small" sx={{ backgroundColor: '#FEF3C7', color: '#B45309', fontWeight: 700, fontSize: FONT.caption }} />
                </Box>
              </Box>

              {/* Grounds Dropdown */}
              <Box>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.primary, mb: 0.6 }}>
                  Select grounds
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={configureDocIssue.grounds}
                    onChange={(e) =>
                      setConfigureDocIssue((prev) => (prev ? { ...prev, grounds: e.target.value } : null))
                    }
                    sx={{ borderRadius: '8px', fontSize: FONT.body, backgroundColor: '#FFFFFF' }}
                  >
                    {(GROUNDS_BY_DOC_TYPE[configureDocIssue.docType] || []).map((ground) => (
                      <MenuItem key={ground} value={ground} sx={{ fontSize: FONT.body }}>
                        {ground}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              {/* Reviewer Notes */}
              <Box>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label="Reviewer notes and instructions for the driver"
                  placeholder={DEFAULT_NOTES_BY_DOC_TYPE[configureDocIssue.docType]}
                  value={configureDocIssue.notes}
                  onChange={(e) =>
                    setConfigureDocIssue((prev) => (prev ? { ...prev, notes: e.target.value } : null))
                  }
                  slotProps={{
                    input: {
                      sx: {
                        borderRadius: '12px',
                        fontSize: FONT.body,
                        backgroundColor: '#FFFFFF',
                        '& fieldset': { borderColor: '#E5E5EA' },
                        '&:hover fieldset': { borderColor: '#C7C7CC' },
                        '&.Mui-focused fieldset': { borderColor: '#FF6600' },
                      },
                    },
                  }}
                />
              </Box>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ padding: '11px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2 }}>
          <Button
            onClick={() => setConfigureDocIssue(null)}
            sx={{
              height: 36,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 13px',
              borderRadius: '8px',
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 600,
              color: '#334155',
              border: '1.5px solid #94A3B8',
              backgroundColor: '#FFFFFF',
              '&:hover': { backgroundColor: '#F1F5F9' },
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSaveDocIssue}
            disabled={!configureDocIssue?.grounds || !configureDocIssue?.notes.trim()}
            variant="contained"
            sx={{
              height: 36,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 14px',
              borderRadius: '8px',
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 700,
              backgroundColor: '#D97706',
              color: '#FFFFFF',
              '&:hover': { backgroundColor: '#B45309' },
              '&.Mui-disabled': { backgroundColor: '#E5E5EA', color: '#8E8E93' },
            }}
          >
            Set for Resubmission
          </Button>
        </DialogActions>
      </Dialog>

      <MacConfirmDialog
        open={rejectDialogOpen}
        onClose={() => { setRejectDialogOpen(false); setTargetAffiliationId(null); }}
        title="Reject this driver application?"
        message={`Disapprove Stage 2 LGU verification for "${driver.name}" (${decisionTodaLabel}). Only this TODA application is rejected; the driver's other TODA applications are not affected. Specify the reason for rejection or return for correction.`}
        confirmLabel="Reject application"
        confirmVariant="danger"
        requireReason
        reasonPlaceholder="Specify rejection reasons (e.g. Expired Professional License, Invalid MTOP)..."
        onConfirm={handleRejectConfirm}
      />

      <MacConfirmDialog
        open={suspendDialogOpen}
        onClose={() => setSuspendDialogOpen(false)}
        title="Suspend this driver?"
        message={`Enact an administrative suspension on "${driver.name}". The driver will be barred from accepting booking dispatches.`}
        confirmLabel="Suspend driver"
        confirmVariant="danger"
        requireReason
        reasonPlaceholder="Specify mandatory suspension reason..."
        onConfirm={handleSuspendConfirm}
      />

      <MacConfirmDialog
        open={reactivateDialogOpen}
        onClose={() => setReactivateDialogOpen(false)}
        title="Reactivate this driver?"
        message={
          driver.restrictionKind === 'DEACTIVATED'
            ? `"${driver.name}" is deactivated. Confirm that you reviewed the full violation history. Strike counts are not reset; they age out of the 90-day window.`
            : `Reactivate "${driver.name}" to active status. The driver will immediately become eligible to receive ride bookings.`
        }
        confirmLabel={driver.restrictionKind === 'DEACTIVATED' ? 'I reviewed the history: reactivate' : 'Reactivate driver'}
        confirmVariant="orange"
        onConfirm={handleReactivateConfirm}
      />

      <MacConfirmDialog
        open={strikeDialogOpen}
        onClose={() => setStrikeDialogOpen(false)}
        title="Record a policy violation?"
        message={`Record a confirmed violation against "${driver.name}". The platform applies the strike count and any consequence automatically (warning at 1, review at 3, suspension at 5 and 8, deactivation at 10).`}
        confirmLabel="Record violation"
        confirmVariant="danger"
        options={strikeData.violationOptions}
        optionLabel="Violation"
        requireReason
        reasonPlaceholder="Describe the evidence that confirms this violation..."
        onConfirm={handleStrikeConfirm}
      />

      <MacConfirmDialog
        open={renewalApproveDialogOpen}
        onClose={() => setRenewalApproveDialogOpen(false)}
        title="Approve this document renewal?"
        message={`Approve and advance license/MTOP expiry credentials for "${driver.name}". Official records will update immediately.`}
        confirmLabel="Approve renewal"
        confirmVariant="orange"
        onConfirm={handleRenewalApproveConfirm}
      />

      <MacConfirmDialog
        open={renewalRejectDialogOpen}
        onClose={() => setRenewalRejectDialogOpen(false)}
        title="Reject this document renewal?"
        message={`Reject renewal application for "${driver.name}". The driver will be required to correct and re-upload valid documents.`}
        confirmLabel="Reject renewal"
        confirmVariant="danger"
        requireReason
        reasonPlaceholder="Specify reason for renewal rejection (e.g. illegible photocopy, mismatched validity)..."
        onConfirm={handleRenewalRejectConfirm}
      />

      {/* Document Inspection Popover */}
      {selectedDoc && (() => {
        const docType = getDocumentType(selectedDoc.doc);
        const isStaged = returnIssues.some((i) => i.documentType === docType);
        const liveDoc = docList.find((d) => getDocumentType(d) === docType) || selectedDoc.doc;
        const currentStatus = isStaged ? 'Resubmission Required' : liveDoc.status;

        return (
          <DocumentPreviewModal
            open={Boolean(selectedDoc)}
            onClose={() => setSelectedDoc(null)}
            documentName={selectedDoc.doc.name}
            documentType={selectedDoc.doc.type}
            url={selectedDoc.doc.url}
            urls={selectedDoc.doc.urls}
            currentStatus={currentStatus}
            onApproveDocument={!isVerified ? () => handleApproveDocument(selectedDoc.index) : undefined}
            onRequestResubmit={!isVerified ? () => handleStartResubmitForDoc(liveDoc) : undefined}
          />
        );
      })()}

      {/* Pop-up Dialog: No documents selected for resubmission */}
      <Dialog
        open={noDocForReturnDialogOpen}
        onClose={() => setNoDocForReturnDialogOpen(false)}
        slotProps={{
          backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(8px)' } },
          paper: {
            sx: {
              borderRadius: 'var(--mac-radius-lg)',
              maxWidth: 352,
              width: '100%',
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--mac-shadow-popover)',
              overflow: 'hidden',
              p: 0,
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            padding: '14px 19px 11px',
            borderBottom: '1px solid var(--mac-border-color)',
            fontSize: FONT.body,
            fontWeight: 700,
            color: 'var(--mac-text-primary)',
            backgroundColor: '#FAFAFC',
            display: 'flex',
            alignItems: 'center',
            gap: 1.2,
          }}
        >
          <InfoOutlinedIcon sx={{ color: 'var(--sakay-orange)', fontSize: 18 }} />
          No Documents Selected for Resubmission
        </DialogTitle>
        <DialogContent sx={{ p: '16px 19px !important' }}>
          <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-secondary)', lineHeight: 1.5 }}>
            There are currently no documents requested for resubmission. Please inspect a file from the <strong>Verification Documents</strong> list above and select <strong>Request Resubmission</strong> if corrections are required.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ padding: '10px 19px 14px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC' }}>
          <Button
            variant="contained"
            onClick={() => setNoDocForReturnDialogOpen(false)}
            sx={{
              height: 36,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 16px',
              borderRadius: '8px',
              fontSize: FONT.body,
              fontWeight: 600,
              textTransform: 'none',
              backgroundColor: 'var(--sakay-orange)',
              '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' },
            }}
          >
            Understood
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pop-up Dialog: Unsubmitted Resubmissions Exit Confirmation */}
      <Dialog
        open={unsubmittedExitDialogOpen}
        onClose={() => setUnsubmittedExitDialogOpen(false)}
        slotProps={{
          backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(8px)' } },
          paper: {
            sx: {
              borderRadius: 'var(--mac-radius-lg)',
              maxWidth: 384,
              width: '100%',
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--mac-shadow-popover)',
              overflow: 'hidden',
              p: 0,
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            padding: '14px 19px 11px',
            borderBottom: '1px solid var(--mac-border-color)',
            fontSize: FONT.body,
            fontWeight: 700,
            color: '#92400E',
            backgroundColor: '#FFFBEB',
            display: 'flex',
            alignItems: 'center',
            gap: 1.2,
          }}
        >
          <WarningAmberIcon sx={{ color: '#D97706', fontSize: 18 }} />
          Unsubmitted Resubmission Requests
        </DialogTitle>
        <DialogContent sx={{ p: '16px 19px !important' }}>
          <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-primary)', lineHeight: 1.5, mb: 0.8 }}>
            You have marked <strong>{pendingReturnCount} document{pendingReturnCount === 1 ? '' : 's'}</strong> for resubmission.
          </Typography>
          <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-secondary)', lineHeight: 1.5 }}>
            Do you want to check and proceed with returning this application to the driver, or exit without returning?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ padding: '11px 19px 14px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setUnsubmittedExitDialogOpen(false);
              onClose();
            }}
            sx={{
              height: CONTROL.height,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 13px',
              borderRadius: '8px',
              fontSize: FONT.body,
              fontWeight: 600,
              textTransform: 'none',
              borderColor: '#94A3B8',
              color: '#334155',
              '&:hover': { backgroundColor: '#F1F5F9' },
            }}
          >
            Exit
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setUnsubmittedExitDialogOpen(false);
              setReturnSummaryDialogOpen(true);
            }}
            sx={{
              height: CONTROL.height,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 16px',
              borderRadius: '8px',
              fontSize: FONT.body,
              fontWeight: 700,
              textTransform: 'none',
              backgroundColor: '#D97706',
              color: '#FFFFFF',
              '&:hover': { backgroundColor: '#B45309' },
            }}
          >
            Proceed with Return for Resubmission
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar Alert */}
      <Snackbar
        open={Boolean(snackbarMsg)}
        autoHideDuration={4000}
        onClose={() => setSnackbarMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarMsg(null)} severity="info" sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
      <MacConfirmDialog
        open={reapplyTarget !== null}
        onClose={() => setReapplyTarget(null)}
        title="Allow this applicant to apply again?"
        message="A rejection is final unless the LGU Administrator allows the applicant to be reviewed again. The application goes back to Submitted for its TODA. The earlier rejection reasons and your reason are kept in the audit log."
        confirmLabel="Allow re-application"
        confirmVariant="orange"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="Why may this applicant apply again? (at least 10 characters)"
        onConfirm={async (reason) => {
          const target = reapplyTarget;
          setReapplyTarget(null);
          if (!target || !reason) return;
          const problem = await allowDriverReapplication(supabase, target, reason);
          setSnackbarMsg(problem ?? 'The application goes back to review.');
          if (!problem && onDriverUpdated) {
            onDriverUpdated({
              ...driver,
              verificationStatus: 'Pending',
              affiliations: affiliations.map((a) => (a.affiliationId === target ? { ...a, todaStage: 'Submitted' as const, lguStage: 'Pending' as const } : a)),
            } as DriverRecord);
          }
        }}
      />
      <MacConfirmDialog
        open={disqualifyOpen}
        onClose={() => setDisqualifyOpen(false)}
        title="Permanently disqualify this applicant?"
        message={`"${driver.name}" can never be cleared to re-apply, and every application is rejected. Use this only for fraud, falsified documents or a comparable ground. It cannot be undone.`}
        confirmLabel="Disqualify permanently"
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="The ground for the disqualification (at least 10 characters)"
        onConfirm={async (reason) => {
          setDisqualifyOpen(false);
          if (!reason) return;
          const problem = await permanentlyDisqualifyDriver(supabase, driver.id, reason);
          setSnackbarMsg(problem ?? `${driver.name} was permanently disqualified.`);
          if (!problem && onDriverUpdated) {
            onDriverUpdated({ ...driver, verificationStatus: 'Rejected', isPermanentlyDisqualified: true, disqualificationReason: reason } as DriverRecord);
          }
        }}
      />
      <DeclineHistoryDialog
        open={declineView !== null}
        onClose={() => setDeclineView(null)}
        driverName={driver.name}
        history={declineView?.history ?? null}
        loading={declineView?.loading ?? false}
        failed={declineView !== null && !declineView.loading && declineView.history === null}
      />
    </>
  );
};
