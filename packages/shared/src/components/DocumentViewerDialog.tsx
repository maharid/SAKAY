import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';

import { SakayDialogTitle } from './SakayDialogTitle';

export type DocumentViewerKind = 'image' | 'pdf' | 'spreadsheet' | 'file';

export interface DocumentViewerSource {
  url: string;
  /** A short name for this photo ("Front", "Back") */
  label?: string;
}

export interface DocumentViewerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The file or document name, shown in the header */
  title: string;
  /** One quiet line under the title (the document type, an issue date) */
  subtitle?: string;
  /** A small status shown beside the title ("Verified", "Resubmission required") */
  status?: { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' };
  /** What the file is. Left out, it is worked out from the address and the title. */
  kind?: DocumentViewerKind;
  /** The photo(s) or file to show. Several photos (a licence: front and back) are shown one at a time with Previous / Next. */
  sources?: DocumentViewerSource[];
  /** Signs a stored link again: a link signed when a list loaded may be past its short life. */
  resolveUrl?: (url: string) => Promise<string | null | undefined>;
  /** Your own body, for a file the viewer cannot draw itself (a spreadsheet read into a table). Takes the place of the photo or PDF. */
  children?: React.ReactNode;
  /** The review actions of this document (Approve, Request resubmission). They sit at the left of the footer. */
  reviewActions?: React.ReactNode;
  /** The name of the downloaded file (without extension) */
  downloadName?: string;
  /** What the viewer says when there is nothing to show */
  emptyMessage?: string;
}

const ACCENT = '#C75000';
const ACCENT_HOVER = '#A84300';
const INK = '#1d1d1f';
const MUTED = '#4d4d52';
const LINE = 'rgba(15, 23, 42, 0.1)';

const STATUS_TONES = {
  success: { bg: '#DCFCE7', fg: '#166534' },
  warning: { bg: '#FEF3C7', fg: '#92400E' },
  info: { bg: '#DBEAFE', fg: '#1E40AF' },
  neutral: { bg: '#F1F5F9', fg: '#334155' },
} as const;

const buttonBase = {
  height: 36,
  px: '14px',
  borderRadius: '8px',
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  '@media (pointer: coarse)': { height: 44 },
  '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 },
} as const;

const secondaryButton = { ...buttonBase, color: '#334155', border: '1.5px solid #94A3B8', backgroundColor: '#FFFFFF', '&:hover': { backgroundColor: '#F1F5F9', borderColor: '#64748B' } } as const;
const primaryButton = { ...buttonBase, color: '#FFFFFF', backgroundColor: ACCENT, boxShadow: 'none', '&:hover': { backgroundColor: ACCENT_HOVER, boxShadow: 'none' }, '&.Mui-disabled': { color: '#FFFFFF', backgroundColor: '#E5C0A8' } } as const;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|heic)$/i;

/** What a file is, from its address (without the signing query) and, failing that, from the words in its title. */
export function guessDocumentKind(url: string | null | undefined, title: string): DocumentViewerKind {
  const clean = (url || '').split('?')[0];
  if (/^data:image/i.test(url || '') || IMAGE_EXT.test(clean)) return 'image';
  if (/\.pdf$/i.test(clean)) return 'pdf';
  if (/\.(csv|xlsx?|ods)$/i.test(clean)) return 'spreadsheet';
  const t = title.toLowerCase();
  if (/(photo|picture|selfie|licen[sc]e|proof|id\b|image|biometric|mtop|plate|receipt)/.test(t)) return 'image';
  if (/roster|spreadsheet/.test(t)) return 'spreadsheet';
  return 'pdf';
}

const KIND_ICON: Record<DocumentViewerKind, React.ReactElement> = {
  image: <ImageOutlinedIcon sx={{ color: ACCENT, fontSize: 22 }} />,
  pdf: <PictureAsPdfOutlinedIcon sx={{ color: '#B91C1C', fontSize: 22 }} />,
  spreadsheet: <TableChartOutlinedIcon sx={{ color: '#15803D', fontSize: 22 }} />,
  file: <DescriptionOutlinedIcon sx={{ color: '#64748B', fontSize: 22 }} />,
};

function fileExtension(blobType: string, url: string, kind: DocumentViewerKind): string {
  if (/pdf/i.test(blobType)) return '.pdf';
  if (/jpe?g/i.test(blobType)) return '.jpg';
  if (/png/i.test(blobType)) return '.png';
  if (/webp/i.test(blobType)) return '.webp';
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return `.${m[1].toLowerCase()}`;
  return kind === 'pdf' ? '.pdf' : kind === 'image' ? '.jpg' : '';
}

/**
 * The one window every document of both portals is read in (licences, permits, clearances, rosters, evidence): the same header, the same
 * zoom and page controls, the same Open full size and Download, and the X at the top right as the only way to close it.
 * A document that needs review puts its own actions at the left of the footer (reviewActions).
 */
export const DocumentViewerDialog: React.FC<DocumentViewerDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  status,
  kind: kindProp,
  sources,
  resolveUrl,
  children,
  reviewActions,
  downloadName,
  emptyMessage = 'This document has no file to show.',
}) => {
  const sourceKey = (sources || []).map((s) => s.url).join('\n');
  const stableSources = useMemo(() => (sources || []).filter((s) => Boolean(s.url)), [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [urls, setUrls] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setIndex(0);
    setZoom(1);
    setImageLoading(true);
    setImageFailed(false);
    if (!open || stableSources.length === 0) {
      setUrls([]);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    const plain = stableSources.map((s) => s.url);
    const sign = resolveUrl
      ? Promise.all(plain.map((u) => resolveUrl(u).then((signed) => signed || u).catch(() => u)))
      : Promise.resolve(plain);
    sign
      .then((list) => {
        if (!cancelled) setUrls(list);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, stableSources, resolveUrl]);

  const activeUrl = urls[index] || null;
  const kind: DocumentViewerKind = kindProp || guessDocumentKind(activeUrl || stableSources[0]?.url, title);
  const hasMany = urls.length > 1;
  const activeLabel = stableSources[index]?.label;
  const showImageTools = kind === 'image' && Boolean(activeUrl) && !imageFailed && !children;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= urls.length) return;
      setIndex(next);
      setZoom(1);
      setImageLoading(true);
      setImageFailed(false);
    },
    [urls.length],
  );

  const openFull = () => {
    if (activeUrl) window.open(activeUrl, '_blank', 'noopener,noreferrer');
  };

  // A signed storage link is another address, so the browser may ignore the download name; the file is fetched and saved as a blob. If that is not allowed, it opens in a new tab.
  const download = async () => {
    if (!activeUrl || downloading) return;
    setDownloading(true);
    const base = (downloadName || title || 'document').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
    try {
      const response = await fetch(activeUrl);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${base}${hasMany ? `_${index + 1}` : ''}${fileExtension(blob.type, activeUrl, kind)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    } catch {
      window.open(activeUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  const toolbar = showImageTools || hasMany;

  const body = children ? (
    children
  ) : activeUrl ? (
    kind === 'image' && !imageFailed ? (
      <Box sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', backgroundColor: '#111114' }}>
        {imageLoading && (
          <Box sx={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <CircularProgress size={28} sx={{ color: ACCENT }} />
            <Typography sx={{ fontSize: '13px', color: '#D4D4D8' }}>Loading the photo...</Typography>
          </Box>
        )}
        <Box
          component="img"
          key={activeUrl}
          src={activeUrl}
          alt={title}
          onLoad={() => setImageLoading(false)}
          onError={() => {
            setImageLoading(false);
            setImageFailed(true);
          }}
          sx={{
            maxWidth: zoom === 1 ? '100%' : 'none',
            maxHeight: zoom === 1 ? '100%' : 'none',
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease-out',
            objectFit: 'contain',
            display: imageLoading ? 'none' : 'block',
          }}
        />
      </Box>
    ) : kind === 'image' ? null : (
      <Box component="iframe" src={activeUrl} title={title} sx={{ width: '100%', height: '100%', minHeight: 380, border: 0, backgroundColor: '#FFFFFF' }} />
    )
  ) : null;

  const emptyState = (heading: string, text: string, loading?: boolean) => (
    <Box sx={{ width: '100%', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', textAlign: 'center', p: '24px' }}>
      {loading ? <CircularProgress size={28} sx={{ color: ACCENT }} /> : <ImageNotSupportedOutlinedIcon aria-hidden sx={{ fontSize: 36, color: '#8A8A90' }} />}
      <Typography sx={{ fontSize: '14px', fontWeight: 700, color: INK }}>{heading}</Typography>
      <Typography sx={{ fontSize: '13px', color: MUTED, maxWidth: 360 }}>{text}</Typography>
    </Box>
  );

  const darkBody = kind === 'image' && Boolean(activeUrl) && !imageFailed && !children;
  const hasFile = Boolean(activeUrl) && !children;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="document-viewer-title"
      slotProps={{
        backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } },
        paper: {
          sx: {
            m: '16px',
            width: 'calc(100% - 32px)',
            maxWidth: 760,
            maxHeight: 'calc(100% - 32px)',
            borderRadius: '16px',
            backgroundColor: '#FFFFFF',
            border: `1px solid ${LINE}`,
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.22)',
            overflow: 'hidden',
          },
        },
      }}
    >
      <SakayDialogTitle onClose={onClose} sx={{ p: '14px 16px 12px 20px', borderBottom: `1px solid ${LINE}`, backgroundColor: '#FAFAFC', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          {KIND_ICON[children ? 'spreadsheet' : kind]}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
              <Typography id="document-viewer-title" component="span" sx={{ fontSize: '15px', fontWeight: 700, color: INK, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {title}
              </Typography>
              {status && (
                <Box component="span" sx={{ px: '8px', py: '1px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, backgroundColor: STATUS_TONES[status.tone].bg, color: STATUS_TONES[status.tone].fg }}>
                  {status.label}
                </Box>
              )}
            </Box>
            {subtitle && <Typography component="span" sx={{ display: 'block', fontSize: '12px', color: MUTED, mt: '2px' }}>{subtitle}</Typography>}
          </Box>
        </Box>
      </SakayDialogTitle>

      {toolbar && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', px: '16px', py: '6px', borderBottom: `1px solid ${LINE}`, backgroundColor: '#FFFFFF' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {hasMany && (
              <>
                <IconButton size="small" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous photo" sx={{ color: MUTED }}>
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <Typography role="status" sx={{ fontSize: '12.5px', fontWeight: 600, color: INK, minWidth: 110, textAlign: 'center' }}>
                  Photo {index + 1} of {urls.length}
                  {activeLabel ? ` · ${activeLabel}` : ''}
                </Typography>
                <IconButton size="small" onClick={() => goTo(index + 1)} disabled={index === urls.length - 1} aria-label="Next photo" sx={{ color: MUTED }}>
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Box>
          {showImageTools && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <IconButton size="small" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out" title="Zoom out" sx={{ color: MUTED }}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
              <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: MUTED, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Typography>
              <IconButton size="small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in" title="Zoom in" sx={{ color: MUTED }}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom" sx={{ color: MUTED }}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Box>
      )}

      <DialogContent sx={{ p: children ? '16px' : 0, backgroundColor: darkBody ? '#111114' : '#F8F9FA', height: children ? undefined : 'min(460px, 58vh)', minHeight: children ? 200 : 300, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {body ?? (resolving ? emptyState('Getting the file ready', 'A secure link is being prepared.', true) : emptyState(imageFailed ? 'The photo could not be loaded' : 'Nothing to show', imageFailed ? 'Try again in a moment, or open it full size.' : emptyMessage))}
      </DialogContent>

      <DialogActions
        sx={{
          p: '12px 20px',
          borderTop: `1px solid ${LINE}`,
          backgroundColor: '#FAFAFC',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          '& > :not(style) ~ :not(style)': { ml: 0 },
          '@media (max-width: 599px)': { flexDirection: 'column', alignItems: 'stretch', '& .MuiButton-root': { width: '100%' } },
        }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', '@media (max-width: 599px)': { flexDirection: 'column', alignItems: 'stretch' } }}>{reviewActions}</Box>
        {(hasFile || (children && sources && sources.length > 0)) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px', ml: 'auto', '@media (max-width: 599px)': { flexDirection: 'column', ml: 0 } }}>
            <Button variant="outlined" startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />} onClick={openFull} disabled={!activeUrl} sx={secondaryButton}>
              Open full size
            </Button>
            <Button variant="contained" disableElevation startIcon={downloading ? <CircularProgress size={14} color="inherit" /> : <DownloadIcon sx={{ fontSize: 16 }} />} onClick={download} disabled={!activeUrl || downloading} sx={primaryButton}>
              Download
            </Button>
          </Box>
        )}
      </DialogActions>
    </Dialog>
  );
};
