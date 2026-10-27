import React from 'react';
import { Avatar, Box, Button, Typography } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';

import { FONT } from '../../styles/density';
import { OPS_BORDER, OPS_TEXT } from '../operations/operationsTheme';
import { rowActionSx } from './pageButtons';

interface ReviewDocumentRowProps {
  /** A small picture of the document, when the file is a picture */
  thumbnailUrl?: string | null;
  title: string;
  /** What kind of document it is ("Identification Proof"): one short line, like the LGU Portal's document list */
  type: string;
  /** Small status pills after the title (resubmission required, resubmitted...) */
  badges?: React.ReactNode;
  /** How the row is tinted: nothing to flag, returned to the driver and waiting, or the driver sent a new copy (the LGU Portal's colours) */
  tone?: 'neutral' | 'returned' | 'resubmitted';
  onView: () => void;
  viewLabel?: string;
}

const TONES = {
  neutral: { border: OPS_BORDER, background: '#FFFFFF' },
  returned: { border: '#FCD34D', background: '#FFFBEB' },
  resubmitted: { border: '#93C5FD', background: '#EFF6FF' },
} as const;

// One submitted document in the application review window: a thumbnail, its name, its status and ONE button of a fixed size ("Inspect File",
// as in the LGU Portal). The row measures its own width: on a narrow window the button drops under the text instead of squeezing it.
export const ReviewDocumentRow: React.FC<ReviewDocumentRowProps> = ({ thumbnailUrl, title, type, badges, tone = 'neutral', onView, viewLabel = 'Inspect File' }) => (
  <Box sx={{ containerType: 'inline-size' }}>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: '12px',
        rowGap: '10px',
        p: '11px 14px',
        borderRadius: '10px',
        backgroundColor: TONES[tone].background,
        border: `1px solid ${TONES[tone].border}`,
        '@container (max-width: 380px)': { gridTemplateColumns: 'auto minmax(0, 1fr)', '& .review-doc-action': { gridColumn: '1 / -1' }, '& .review-doc-action .MuiButton-root': { width: '100%' } },
      }}
    >
      <Avatar
        src={thumbnailUrl || ''}
        variant="rounded"
        alt=""
        sx={{ width: 40, height: 40, backgroundColor: 'var(--sakay-orange-soft)', border: `1px solid ${OPS_BORDER}` }}
      >
        <DescriptionOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 20 }} />
      </Avatar>

      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
          <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>{title}</Typography>
          {badges}
        </Box>
        <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{type}</Typography>
      </Box>

      <Box className="review-doc-action">
        <Button
          variant="outlined"
          startIcon={<VisibilityIcon sx={{ fontSize: 15 }} />}
          onClick={onView}
          aria-label={`${viewLabel}: ${title}`}
          sx={{ ...rowActionSx('brand'), minWidth: 116 }}
        >
          {viewLabel}
        </Button>
      </Box>
    </Box>
  </Box>
);
