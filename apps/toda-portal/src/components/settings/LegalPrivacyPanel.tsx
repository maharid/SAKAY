import React, { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import SecurityIcon from '@mui/icons-material/Security';
import { privacyNoticeExtraItems } from '@sakay/shared';

import { OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { LegalDocumentView } from './LegalDocumentView';
import { useLanguage } from '../../hooks/useLanguage';
import { LANGUAGE_OPTIONS } from '../../utils/language';
import type { PortalLanguage } from '../../utils/language';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../utils/legalContent';
import type { LegalDocument } from '../../utils/legalContent';
import { CONTROL, FONT } from '../../styles/density';

type DocumentId = 'privacy' | 'terms';

// The Privacy Policy gets items F to I (why the data is used, how long it is kept, who receives it, your rights) from the shared notice, in the chosen language,
// as in the Driver App
const withNoticeItems = (policy: LegalDocument, language: PortalLanguage): LegalDocument => ({
  ...policy,
  sections: policy.sections.map((section, index) =>
    index === 0 ? { ...section, items: [...(section.items ?? []), ...privacyNoticeExtraItems('driver', language)] } : section
  ),
});

const PRIVACY_DOCUMENTS = Object.fromEntries(LANGUAGE_OPTIONS.map(({ code }) => [code, withNoticeItems(PRIVACY_POLICY[code], code)])) as Record<PortalLanguage, LegalDocument>;

const DOCUMENT_ICONS: Record<DocumentId, React.ReactElement> = { privacy: <SecurityIcon />, terms: <GavelIcon /> };

// Legal & Privacy: the two documents, one at a time, in the chosen language. They are the Driver App's own texts (utils/legalContent.ts), unchanged.
export const LegalPrivacyPanel: React.FC = () => {
  const { language, t } = useLanguage();
  const [selected, setSelected] = useState<DocumentId>('privacy');

  const labels: Record<DocumentId, string> = { privacy: t('legal.privacy'), terms: t('legal.terms') };
  const document = selected === 'privacy' ? PRIVACY_DOCUMENTS[language] : TERMS_OF_SERVICE[language];
  const source =
    selected === 'privacy'
      ? 'This is the Privacy Policy that SAKAY shows to drivers in the Driver App.'
      : 'These are the Terms of Service that SAKAY shows to drivers in the Driver App.';

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
        {(Object.keys(labels) as DocumentId[]).map((id) => (
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
            {DOCUMENT_ICONS[id]}
            {labels[id]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{source}</Typography>
      <LegalDocumentView document={document} />
    </Box>
  );
};
