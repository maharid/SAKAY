import React, { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import SecurityIcon from '@mui/icons-material/Security';
import { privacyNoticeExtraItems } from '@sakay/shared';

import { OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { LegalDocumentView } from './LegalDocumentView';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../utils/legalContent';
import type { LegalDocument } from '../../utils/legalContent';
import { CONTROL, FONT } from '../../styles/density';

type DocumentId = 'privacy' | 'terms';

// The Privacy Policy gets items F to I (why the data is used, how long it is kept, who receives it, your rights) from the shared notice, as in the Driver App
const PRIVACY_WITH_NOTICE_ITEMS: LegalDocument = {
  ...PRIVACY_POLICY,
  sections: PRIVACY_POLICY.sections.map((section, index) =>
    index === 0 ? { ...section, items: [...(section.items ?? []), ...privacyNoticeExtraItems('driver', 'en')] } : section
  ),
};

const DOCUMENTS: Record<DocumentId, { label: string; icon: React.ReactElement; document: LegalDocument; source: string }> = {
  privacy: { label: 'Privacy Policy', icon: <SecurityIcon />, document: PRIVACY_WITH_NOTICE_ITEMS, source: 'This is the Privacy Policy that SAKAY shows to drivers in the Driver App.' },
  terms: { label: 'Terms of Service', icon: <GavelIcon />, document: TERMS_OF_SERVICE, source: 'These are the Terms of Service that SAKAY shows to drivers in the Driver App.' },
};

// Legal & Privacy: the two documents, one at a time. They are the Driver App's own texts (utils/legalContent.ts), unchanged.
export const LegalPrivacyPanel: React.FC = () => {
  const [selected, setSelected] = useState<DocumentId>('privacy');
  const current = DOCUMENTS[selected];

  return (
    <Box sx={{ pt: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
              color: OPS_TEXT.primary,
              '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
              '& .MuiSvgIcon-root': { fontSize: 16, color: OPS_TEXT.secondary },
              '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
              '&.Mui-selected': {
                color: OPS_TEXT.brand,
                backgroundColor: 'var(--sakay-orange-soft)',
                borderColor: 'var(--sakay-orange-border) !important',
                '& .MuiSvgIcon-root': { color: OPS_TEXT.brand },
              },
              ...opsFocusRing,
            }}
          >
            {DOCUMENTS[id].icon}
            {DOCUMENTS[id].label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{current.source}</Typography>
      <LegalDocumentView document={current.document} />
    </Box>
  );
};
