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
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { refreshStorageUrl } from '@sakay/shared';
import { supabase } from '../../services/supabaseClient';
import { primaryButtonSx, secondaryButtonSx } from '../common/pageButtons';
import { OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { FONT } from '../../styles/density';

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
  documentType = 'Document',
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
      aria-labelledby="document-preview-title"
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
          },
        },
        paper: {
          sx: {
            width: 'calc(100% - 32px)',
            maxWidth: 624,
            m: '16px',
            maxHeight: 'calc(100% - 32px)',
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
            <Typography id="document-preview-title" component="span" sx={{ display: 'block', fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>
              {documentName}
            </Typography>
            <Typography component="span" sx={{ display: 'block', fontSize: FONT.small, color: OPS_TEXT.secondary }}>
              {documentType}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {imageUrl && !imgError && (
            <>
              <IconButton size="small" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out" sx={{ color: OPS_TEXT.secondary, ...opsFocusRing }}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, minWidth: 36, textAlign: 'center' }}>
                {Math.round(zoomLevel * 100)}%
              </Typography>
              <IconButton size="small" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in" sx={{ color: OPS_TEXT.secondary, ...opsFocusRing }}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={handleResetZoom} aria-label="Reset zoom" title="Reset zoom" sx={{ color: OPS_TEXT.secondary, ...opsFocusRing }}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </>
          )}
          <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ ml: '6px', color: OPS_TEXT.secondary, ...opsFocusRing }}>
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
              height: 'min(384px, 52vh)',
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
                <Typography sx={{ fontSize: FONT.body, color: '#D4D4D8' }}>Loading photo...</Typography>
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
            <Typography sx={{ fontSize: FONT.body, color: '#D4D4D8' }}>Getting the photo ready...</Typography>
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
            <ImageNotSupportedOutlinedIcon aria-hidden sx={{ fontSize: 38, color: '#8A8A90', mb: '13px' }} />
            <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary, mb: '6px' }}>
              {imgError ? 'The photo could not be loaded' : 'No photo to show'}
            </Typography>
            <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, maxWidth: 352 }}>
              {imgError ? 'Close this window and try again in a moment.' : 'This document does not have a photo to show.'}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px' }}>
        {imageUrl && (
          <Button variant="outlined" startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />} onClick={handleOpenOriginal} sx={secondaryButtonSx}>
            Open Full Size
          </Button>
        )}

        {imageUrl && (
          <Button variant="contained" disableElevation startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} onClick={handleDownload} sx={primaryButtonSx}>
            Download Photo
          </Button>
        )}

        <Button variant="outlined" onClick={onClose} sx={secondaryButtonSx}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
