import React, { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import SecurityIcon from '@mui/icons-material/Security';

import { LegalDocumentView } from './LegalDocumentView';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../utils/legalDocuments';
import { CONTROL, FONT } from '../../styles/density';
import { PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';

type DocumentId = 'privacy' | 'terms';

const DOCUMENTS = {
  privacy: { label: 'Privacy Policy', icon: <SecurityIcon />, document: PRIVACY_POLICY },
  terms: { label: 'Terms of Service', icon: <GavelIcon />, document: TERMS_OF_SERVICE },
} as const;

// Legal & Privacy: the two documents, one at a time (utils/legalContent.ts). They are written for administrators out of what the project already says; see the
// comments of that file for where each statement comes from and what is still missing.
export const LegalPrivacyPanel: React.FC = () => {
  const [selected, setSelected] = useState<DocumentId>('privacy');

  return (
    <Box sx={{ pt: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={selected}
        onChange={(_, next: DocumentId | null) => next && setSelected(next)}
        aria-label="Choose a document"
        sx={{ alignSelf: 'flex-start', flexWrap: 'wrap', gap: '6px', '& .MuiToggleButtonGroup-grouped': { border: '1px solid rgba(15, 23, 42, 0.12) !important', borderRadius: `${CONTROL.radius} !important` } }}
      >
        {(Object.keys(DOCUMENTS) as DocumentId[]).map((id) => (
          <ToggleButton
            key={id}
            value={id}
            sx={{
              textTransform: 'none',
              gap: '8px',
              px: '14px',
              minHeight: CONTROL.height,
              fontSize: FONT.body,
              fontWeight: 600,
              color: PAGE_TEXT.primary,
              '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
              '& .MuiSvgIcon-root': { fontSize: 16, color: PAGE_TEXT.secondary },
              '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
              '&.Mui-selected': {
                color: PAGE_TEXT.brand,
                backgroundColor: 'var(--sakay-orange-soft)',
                borderColor: 'var(--sakay-orange-border) !important',
                '& .MuiSvgIcon-root': { color: PAGE_TEXT.brand },
              },
              ...pageFocusRing,
            }}
          >
            {DOCUMENTS[id].icon}
            {DOCUMENTS[id].label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>For LGU administrators who use this portal.</Typography>
      <LegalDocumentView document={DOCUMENTS[selected].document} />
    </Box>
  );
};
