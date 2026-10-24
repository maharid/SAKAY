import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Button,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { refreshStorageUrl } from '@sakay/shared';
import { supabase } from '../../services/supabaseClient';

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  documentName: string;
  documentType?: string;
  imageUrl?: string | null;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  open,
  onClose,
  documentName,
  documentType = 'Official Document Proof',
  imageUrl: sourceUrl,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [imgLoading, setImgLoading] = useState<boolean>(true);
  const [imgError, setImgError] = useState<boolean>(false);

  // A link that was signed when a list loaded may be past its short life (10 minutes): it is signed again when the preview opens.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState<boolean>(false);

  useEffect(() => {
    setZoomLevel(1);
    setImgLoading(true);
    setImgError(false);
    if (!open || !sourceUrl) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    refreshStorageUrl(supabase, sourceUrl)
      .then((fresh) => {
        if (!cancelled) setImageUrl(fresh || sourceUrl);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(sourceUrl);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceUrl]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 2.5));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.75));
  const handleResetZoom = () => setZoomLevel(1);

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.target = '_blank';
    a.download = `${documentName.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenOriginal = () => {
    if (imageUrl) {
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
          },
        },
        paper: {
          sx: {
            width: '100%',
            maxWidth: 624,
            borderRadius: '18px',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            border: '1px solid var(--mac-border-color)',
            overflow: 'hidden',
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          padding: '14px 19px',
          borderBottom: '1px solid var(--mac-border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FAFAFC',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <DescriptionIcon sx={{ color: 'var(--sakay-orange)', fontSize: 19 }} />
          <Box>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
              {documentName}
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
              {documentType} • Official TODA / Municipal Compliance Submission
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {imageUrl && !imgError && (
            <>
              <IconButton size="small" onClick={handleZoomOut} title="Zoom Out" sx={{ color: 'var(--mac-text-secondary)' }}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', minWidth: 30, textAlign: 'center' }}>
                {Math.round(zoomLevel * 100)}%
              </Typography>
              <IconButton size="small" onClick={handleZoomIn} title="Zoom In" sx={{ color: 'var(--mac-text-secondary)' }}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={handleResetZoom} title="Reset Zoom" sx={{ color: 'var(--mac-text-secondary)' }}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </>
          )}
          <IconButton onClick={onClose} size="small" sx={{ ml: '6px' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ padding: '16px', backgroundColor: '#18181B', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {imageUrl && !imgError ? (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: 384,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              borderRadius: '6.5px',
              backgroundColor: '#09090B',
            }}
          >
            {imgLoading && (
              <Box sx={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <CircularProgress size={29} sx={{ color: 'var(--sakay-orange)' }} />
                <Typography sx={{ fontSize: '11px', color: '#A1A1AA' }}>Loading captured document...</Typography>
              </Box>
            )}
            <Box
              component="img"
              src={imageUrl}
              alt={documentName}
              onLoad={() => setImgLoading(false)}
              onError={() => {
                setImgLoading(false);
                setImgError(true);
              }}
              sx={{
                maxWidth: zoomLevel === 1 ? '100%' : 'none',
                maxHeight: zoomLevel === 1 ? '100%' : 'none',
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
                transition: 'transform 0.15s ease-out',
                objectFit: 'contain',
                borderRadius: '5px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                display: imgLoading ? 'none' : 'block',
              }}
            />
          </Box>
        ) : resolving ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <CircularProgress size={29} sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: '11px', color: '#A1A1AA' }}>Preparing secure link...</Typography>
          </Box>
        ) : (
          <Box
            sx={{
              width: '100%',
              height: 304,
              backgroundColor: '#FAFAFC',
              borderRadius: '10px',
              border: '2px dashed var(--mac-border-color)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              p: '26px',
              textAlign: 'center',
            }}
          >
            <VerifiedUserIcon sx={{ fontSize: 38, color: '#1E8E3E', mb: '13px' }} />
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)', mb: '6px' }}>
              {documentName}
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', maxWidth: 352, mb: '6px' }}>
              {imgError
                ? 'Unable to load high-resolution image preview. You may still inspect the document record below.'
                : 'Captured document metadata is registered with Calapan City TODA Administrative Board.'}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
          {imageUrl ? 'High-Resolution Captured Submission' : 'Document Submission Record'}
        </Typography>

        <Box sx={{ display: 'flex', gap: '10px' }}>
          {imageUrl && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<OpenInNewIcon fontSize="small" />}
              onClick={handleOpenOriginal}
              sx={{
                textTransform: 'none',
                borderRadius: '6.5px',
                borderColor: 'var(--mac-border-color)',
                color: 'var(--mac-text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              Open Full Resolution
            </Button>
          )}

          {imageUrl && (
            <Button
              variant="contained"
              size="small"
              startIcon={<DownloadIcon fontSize="small" />}
              onClick={handleDownload}
              sx={{
                textTransform: 'none',
                borderRadius: '6.5px',
                backgroundColor: 'var(--sakay-orange)',
                color: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 600,
                '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' },
              }}
            >
              Download Photo
            </Button>
          )}

          <Button
            variant="outlined"
            size="small"
            onClick={onClose}
            sx={{
              textTransform: 'none',
              borderRadius: '6.5px',
              borderColor: 'var(--mac-border-color)',
              color: 'var(--mac-text-primary)',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            Close
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
