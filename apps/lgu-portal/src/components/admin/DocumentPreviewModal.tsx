import React, { useCallback } from 'react';
import { Button } from '@mui/material';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { DocumentViewerDialog, refreshStorageUrl } from '@sakay/shared';
import type { DocumentViewerDialogProps } from '@sakay/shared';

import { supabase } from '../../services/supabaseClient';
import { CONTROL, FONT } from '../../styles/density';

export interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  documentName: string;
  documentType?: string;
  /** The date the document was issued, when the record says one. Nothing is shown when it is not known. */
  issueDate?: string;
  url?: string | null;
  urls?: string[];
  /** A short name for each photo of urls ('Front', 'Back') */
  photoLabels?: string[];
  currentStatus?: 'Pending' | 'Pending Inspection' | 'Verified' | 'Resubmission Required' | 'Resubmitted (Awaiting Review)';
  onApproveDocument?: () => void;
  onRequestResubmit?: () => void;
}

const STATUS: Record<string, NonNullable<DocumentViewerDialogProps['status']>> = {
  Verified: { label: 'Verified', tone: 'success' },
  'Resubmitted (Awaiting Review)': { label: 'Resubmitted, awaiting review', tone: 'info' },
  'Resubmission Required': { label: 'Resubmission required', tone: 'warning' },
  Pending: { label: 'Pending inspection', tone: 'neutral' },
  'Pending Inspection': { label: 'Pending inspection', tone: 'neutral' },
};

const actionButton = {
  height: CONTROL.height,
  '@media (pointer: coarse)': { height: CONTROL.touchHeight },
  px: '14px',
  borderRadius: '8px',
  textTransform: 'none',
  fontSize: FONT.body,
  fontWeight: 700,
  whiteSpace: 'nowrap',
} as const;

// The LGU's document window: the shared viewer, plus the review actions of a driver's document (approve it, or ask for a new one).
export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  open,
  onClose,
  documentName,
  documentType,
  issueDate,
  url = null,
  urls,
  photoLabels,
  currentStatus,
  onApproveDocument,
  onRequestResubmit,
}) => {
  const list = urls && urls.length > 0 ? urls.filter(Boolean) : url ? [url] : [];
  const labels = photoLabels ?? (list.length === 2 && /licen[sc]e/i.test(`${documentType ?? ''} ${documentName}`) ? ['Front', 'Back'] : []);
  const resolveUrl = useCallback((u: string) => refreshStorageUrl(supabase, u), []);
  const subtitle = [documentType, issueDate ? `Issued ${issueDate}` : null].filter(Boolean).join(' · ') || undefined;

  return (
    <DocumentViewerDialog
      open={open}
      onClose={onClose}
      title={documentName}
      subtitle={subtitle}
      status={currentStatus ? STATUS[currentStatus] : undefined}
      sources={list.map((u, i) => ({ url: u, label: labels[i] }))}
      resolveUrl={resolveUrl}
      downloadName={documentName}
      reviewActions={
        <>
          {onRequestResubmit && (
            <Button
              variant="outlined"
              startIcon={<AssignmentReturnIcon fontSize="small" />}
              onClick={onRequestResubmit}
              sx={{ ...actionButton, color: '#92400E', border: '1.5px solid #D97706', backgroundColor: '#FFFBEB', '&:hover': { backgroundColor: '#FEF3C7', borderColor: '#B45309' } }}
            >
              Request resubmission
            </Button>
          )}
          {onApproveDocument && (
            <Button
              variant="contained"
              disableElevation
              startIcon={<CheckCircleIcon fontSize="small" />}
              onClick={onApproveDocument}
              sx={{ ...actionButton, color: '#FFFFFF', backgroundColor: '#15803D', '&:hover': { backgroundColor: '#166534' } }}
            >
              Approve document
            </Button>
          )}
        </>
      }
    />
  );
};
