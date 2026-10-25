import React from 'react';
import { Box, Typography } from '@mui/material';

import { SETTINGS_WIDE_MEDIA } from './SettingsNav';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageFocusRing } from '../../styles/pageTheme';
import type { LegalDocument, LegalSection } from '../../utils/legalContent';

const paragraphSx = { fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.6 } as const;
const noteSx = { fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.6 } as const;

const Section: React.FC<{ section: LegalSection }> = ({ section }) => (
  <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <Typography component="h4" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary }}>{section.title}</Typography>
    {section.intro && <Typography sx={paragraphSx}>{section.intro}</Typography>}
    {section.bullets && (
      <Box component="ul" sx={{ m: 0, pl: '20px', ...paragraphSx }}>
        {section.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </Box>
    )}
    {section.note && <Typography sx={noteSx}>{section.note}</Typography>}
  </Box>
);

interface LegalDocumentViewProps {
  document: LegalDocument;
}

// A whole document in a scrollable area of its own. The area can be reached and scrolled with the keyboard (Tab, then the arrow keys or Page Down).
export const LegalDocumentView: React.FC<LegalDocumentViewProps> = ({ document: legal }) => (
  <Box
    role="region"
    aria-label={`${legal.title}, scrollable`}
    tabIndex={0}
    sx={{
      minHeight: 280,
      // narrow screen: the document has a height of its own and the page scrolls around it; wide screen: it takes all the room that is left in the card
      flex: '0 0 auto',
      maxHeight: 'max(300px, calc(100dvh - 400px))',
      [SETTINGS_WIDE_MEDIA]: { flex: '1 1 0', maxHeight: 'none' },
      overflowY: 'auto',
      border: `1px solid ${PAGE_BORDER}`,
      borderRadius: '8px',
      p: '18px 20px',
      ...pageFocusRing,
    }}
  >
    {/* the text keeps a readable line length however wide the card is, centred in the scrolling area */}
    <Box sx={{ maxWidth: 800, mx: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <Box>
        <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>{legal.title}</Typography>
        {legal.dateLine && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>{legal.dateLine}</Typography>}
      </Box>
      {legal.intro && <Typography sx={paragraphSx}>{legal.intro}</Typography>}
      {legal.sections.map((section) => (
        <Section key={section.title} section={section} />
      ))}
    </Box>
  </Box>
);
