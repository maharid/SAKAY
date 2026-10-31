import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { DocumentViewerDialog, refreshStorageUrl, signedStorageUrlFromAny } from '@sakay/shared';
import type { DocumentViewerKind } from '@sakay/shared';

import { parseDriverRoster, DriverRosterRow } from '../../utils/rosterParser';
import { supabase } from '../../services/supabaseClient';
import { FONT } from '../../styles/density';

interface DocumentReviewModalProps {
  open: boolean;
  onClose: () => void;
  documentTitle: string;
  fileName: string | null;
  fileUrl: string | null;
  fileObj?: File | null;
}

const ROSTER_BUCKETS = ['barangay-clearances', 'toda-accredited-driver-lists', 'toda-bylaws'];

// A file a TODA submitted (clearance, bylaws, driver roster). A roster is read into a searchable table; a photo or a PDF is shown as it is.
// The window itself (header, Open full size, Download, X) is the shared viewer, the same one every document of both portals uses.
export const DocumentReviewModal: React.FC<DocumentReviewModalProps> = ({ open, onClose, documentTitle, fileName, fileUrl, fileObj }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableData, setTableData] = useState<DriverRosterRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(fileUrl || null);

  const getFileExtension = (): string => {
    if (fileObj?.name) {
      const ext = fileObj.name.split('.').pop()?.toLowerCase();
      if (ext && ext.length <= 5) return ext;
    }
    if (fileUrl) {
      const ext = fileUrl.split('?')[0].split('.').pop()?.toLowerCase();
      if (ext && ext.length <= 5 && !ext.includes('/')) return ext;
    }
    if (fileName && fileName.includes('.')) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext && ext.length <= 5 && !ext.includes(' ')) return ext;
    }
    return '';
  };

  const ext = getFileExtension();
  const isSpreadsheet = ['csv', 'xlsx', 'xls'].includes(ext) || documentTitle.toLowerCase().includes('roster') || (fileName || '').toLowerCase().includes('roster');
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || documentTitle.toLowerCase().includes('image');
  const kind: DocumentViewerKind = isSpreadsheet ? 'spreadsheet' : isImage ? 'image' : 'pdf';

  const parseSpreadsheetData = async (sourceUrl?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      let source: unknown = fileObj || sourceUrl || fileUrl;
      if (!source) throw new Error('No document data available to preview.');

      if (typeof source === 'string' && !source.startsWith('blob:') && !source.startsWith('data:')) {
        let storagePath = source;
        if (source.includes('toda-accredited-driver-lists/')) {
          storagePath = decodeURIComponent(source.split('toda-accredited-driver-lists/')[1].split('?')[0]);
        } else if (source.includes('/storage/v1/object/public/')) {
          storagePath = decodeURIComponent(source.split('/storage/v1/object/public/')[1].split('?')[0]);
          if (storagePath.startsWith('toda-accredited-driver-lists/')) storagePath = storagePath.slice('toda-accredited-driver-lists/'.length);
        }
        try {
          const { data: blob, error: dlErr } = await supabase.storage.from('toda-accredited-driver-lists').download(storagePath);
          if (!dlErr && blob) source = await blob.arrayBuffer();
        } catch {
          // the plain address is tried below
        }
      }

      const { rows } = await parseDriverRoster(source as Parameters<typeof parseDriverRoster>[0]);
      setTableData(rows);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The spreadsheet could not be read.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setTableData([]);
      setError(null);
      setSearchQuery('');
      setResolvedUrl(null);
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;
    const resolveAndLoad = async () => {
      let currentUrl = fileUrl;
      if (fileObj) {
        objectUrl = URL.createObjectURL(fileObj);
        currentUrl = objectUrl;
      } else if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
        // a link that was signed when the list loaded may be past its short life (10 minutes): sign it again
        currentUrl = (await refreshStorageUrl(supabase, fileUrl)) || fileUrl;
      } else if (fileUrl && !fileUrl.startsWith('blob:') && !fileUrl.startsWith('data:')) {
        // a bare storage path
        currentUrl = (await signedStorageUrlFromAny(supabase, ROSTER_BUCKETS, fileUrl)) || fileUrl;
      }
      if (isMounted) setResolvedUrl(currentUrl);
      if (isSpreadsheet) await parseSpreadsheetData(currentUrl);
    };
    void resolveAndLoad();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fileUrl, fileObj, fileName]);

  const filteredData = tableData.filter((row) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return row.name.toLowerCase().includes(q) || row.franchiseNumber.toLowerCase().includes(q) || String(row.no).includes(q);
  });

  const effectiveUrl = resolvedUrl || fileUrl;
  const headCell = { fontWeight: 700, fontSize: FONT.small, backgroundColor: '#F1F5F9', color: 'var(--mac-text-primary)', borderBottom: '2px solid #E2E8F0' };

  const rosterTable = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', px: '12px', py: '4px', borderRadius: '8px', backgroundColor: 'var(--sakay-orange-soft)', border: '1px solid var(--sakay-orange-border)' }}>
          <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>Drivers in the file:</Typography>
          <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: '#B34700' }}>{tableData.length}</Typography>
        </Box>
        <TextField
          size="small"
          placeholder="Search driver name or franchise..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search the roster file' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#64748B', fontSize: 18 }} />
                </InputAdornment>
              ),
              sx: { fontSize: FONT.body, backgroundColor: '#FFFFFF', borderRadius: '8px', width: { xs: '100%', sm: 280 } },
            },
          }}
        />
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, gap: '10px' }}>
          <CircularProgress size={30} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: '#4d4d52' }}>Reading the spreadsheet...</Typography>
        </Box>
      ) : error ? (
        <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>
      ) : tableData.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: '10px', backgroundColor: '#FFFFFF' }}>
          <Typography sx={{ fontSize: FONT.body, color: '#4d4d52' }}>No rows could be read from this spreadsheet.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '10px', maxHeight: '44vh', boxShadow: 'none', borderColor: 'var(--mac-border-color)', backgroundColor: '#FFFFFF' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headCell, width: '70px' }}>No.</TableCell>
                <TableCell sx={headCell}>Driver name</TableCell>
                <TableCell sx={headCell}>Franchise number</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredData.map((row, idx) => (
                <TableRow key={idx} hover sx={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFC', '&:last-child td': { borderBottom: 0 } }}>
                  <TableCell sx={{ fontSize: FONT.body, color: '#4d4d52', fontWeight: 600 }}>{row.no}</TableCell>
                  <TableCell sx={{ fontSize: FONT.body, color: 'var(--mac-text-primary)', fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell sx={{ fontSize: FONT.body }}>
                    <Chip label={row.franchiseNumber} size="small" sx={{ fontSize: FONT.small, fontWeight: 600, height: 22, backgroundColor: 'var(--sakay-orange-soft)', color: '#B34700', border: '1px solid var(--sakay-orange-border)' }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );

  return (
    <DocumentViewerDialog
      open={open}
      onClose={onClose}
      title={fileName || documentTitle}
      subtitle={fileName && fileName !== documentTitle ? documentTitle : undefined}
      kind={kind}
      sources={effectiveUrl ? [{ url: effectiveUrl }] : []}
      downloadName={fileName || documentTitle}
      emptyMessage={isImage ? 'There is no photo to show.' : 'There is no file to show.'}
    >
      {isSpreadsheet ? rosterTable : undefined}
    </DocumentViewerDialog>
  );
};
