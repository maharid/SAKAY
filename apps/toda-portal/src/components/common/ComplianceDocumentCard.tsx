import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import { FONT } from '../../styles/density';
import { OPS_BORDER, OPS_TEXT } from '../operations/operationsTheme';
import { ToneStatusPill } from './DataTable';
import { FileNameText } from './FileNameText';
import { rowActionSx } from './pageButtons';

interface ComplianceDocumentCardProps {
  title: string;
  statusLabel: string;
  statusTone: 'success' | 'warning' | 'danger' | 'neutral';
  fileName: string;
  /** Quiet lines under the file name: when it was sent, how many members it lists. Keep each one short. */
  details: string[];
  /** True while a file is being dragged over this document */
  dragging: boolean;
  onDragActive: (active: boolean) => void;
  onDropFile: (file: File) => void;
  onView: () => void;
  onReplace: () => void;
}

// One compliance document, as a card of its own: what it is, the LGU's status for it, the file that was sent (on ONE line, the whole name in a tooltip), and the
// two things you can do with it. The buttons always sit at the bottom, so three cards side by side line up whatever their text. A file dragged onto the card
// replaces the document too.
export const ComplianceDocumentCard: React.FC<ComplianceDocumentCardProps> = ({
  title,
  statusLabel,
  statusTone,
  fileName,
  details,
  dragging,
  onDragActive,
  onDropFile,
  onView,
  onReplace,
}) => (
  <Box
    onDragOver={(e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }}
    onDragEnter={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onDragActive(true);
    }}
    onDragLeave={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onDragActive(false);
    }}
    onDrop={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onDropFile(file);
    }}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      minWidth: 0,
      p: '14px',
      borderRadius: '10px',
      backgroundColor: dragging ? '#FFF7ED' : '#FFFFFF',
      border: dragging ? '2px dashed var(--sakay-orange)' : `1px solid ${OPS_BORDER}`,
      transition: 'background-color 0.2s ease',
    }}
  >
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, flex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', pointerEvents: 'none' }}>
        <DescriptionOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19, flexShrink: 0, mt: '1px' }} />
        <Typography component="h3" sx={{ fontSize: FONT.body, fontWeight: 700, color: OPS_TEXT.primary, lineHeight: 1.35 }}>{title}</Typography>
      </Box>
      <Box sx={{ pointerEvents: 'none' }}>
        <ToneStatusPill label={statusLabel} tone={statusTone} />
      </Box>
      <FileNameText name={fileName} />
      <Box sx={{ pointerEvents: 'none' }}>
        {details.map((line) => (
          <Typography key={line} sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.45 }}>{line}</Typography>
        ))}
      </Box>
    </Box>

    <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Button variant="outlined" startIcon={<VisibilityIcon sx={{ fontSize: 15 }} />} onClick={onView} aria-label={`View ${title}`} sx={{ ...rowActionSx('brand'), flex: '1 1 0' }}>
        View
      </Button>
      <Button variant="outlined" startIcon={<UploadFileIcon sx={{ fontSize: 15 }} />} onClick={onReplace} aria-label={`Replace the file of ${title}`} sx={{ ...rowActionSx('neutral'), flex: '1 1 0' }}>
        Replace file
      </Button>
    </Box>
  </Box>
);
