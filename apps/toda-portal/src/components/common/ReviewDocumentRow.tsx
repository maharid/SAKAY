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
  /** One or two lines about the document (a number, what the picture should show). Long text wraps; it never pushes the button out of line. */
  description: string;
  /** Small status pills after the title (resubmitted, returned...) */
  badges?: React.ReactNode;
  onView: () => void;
  viewLabel?: string;
}

// One submitted document or photo in the application review window: a thumbnail, what it is, and ONE button of a fixed size.
// The row measures its own width: on a narrow window the button drops under the text instead of squeezing it.
export const ReviewDocumentRow: React.FC<ReviewDocumentRowProps> = ({ thumbnailUrl, title, description, badges, onView, viewLabel = 'View Photo' }) => (
  <Box sx={{ containerType: 'inline-size' }}>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: '12px',
        rowGap: '10px',
        p: '12px',
        borderRadius: '10px',
        backgroundColor: '#FFFFFF',
        border: `1px solid ${OPS_BORDER}`,
        '@container (max-width: 380px)': { gridTemplateColumns: 'auto minmax(0, 1fr)', '& .review-doc-action': { gridColumn: '1 / -1' }, '& .review-doc-action .MuiButton-root': { width: '100%' } },
      }}
    >
      <Avatar
        src={thumbnailUrl || ''}
        variant="rounded"
        alt=""
        sx={{ width: 44, height: 44, backgroundColor: 'var(--sakay-orange-soft)', border: `1px solid ${OPS_BORDER}` }}
      >
        <DescriptionOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 21 }} />
      </Avatar>

      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
          <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: OPS_TEXT.primary }}>{title}</Typography>
          {badges}
        </Box>
        <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '2px', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{description}</Typography>
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
