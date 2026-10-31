import React, { useCallback } from 'react';
import { DocumentViewerDialog, refreshStorageUrl } from '@sakay/shared';

import { supabase } from '../../services/supabaseClient';

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  documentName: string;
  documentType?: string;
  imageUrl?: string | null;
  /** A document of several photos (a license: front and back). Shown one at a time with Previous / Next; takes the place of imageUrl. */
  imageUrls?: string[];
  /** A short name for each photo of imageUrls ('Front', 'Back') */
  photoLabels?: string[];
}

// The TODA portal's document window: the same shared viewer the LGU portal uses, so a photo or a file reads, zooms, downloads and closes the same way in both.
export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ open, onClose, documentName, documentType, imageUrl, imageUrls, photoLabels }) => {
  const list = imageUrls && imageUrls.length > 0 ? imageUrls.filter(Boolean) : imageUrl ? [imageUrl] : [];
  const resolveUrl = useCallback((u: string) => refreshStorageUrl(supabase, u), []);
  return (
    <DocumentViewerDialog
      open={open}
      onClose={onClose}
      title={documentName}
      subtitle={documentType}
      sources={list.map((u, i) => ({ url: u, label: photoLabels?.[i] }))}
      resolveUrl={resolveUrl}
      downloadName={documentName}
      emptyMessage="This document does not have a photo to show."
    />
  );
};
