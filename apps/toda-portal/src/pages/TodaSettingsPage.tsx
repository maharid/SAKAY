import React, { useState } from 'react';
import { Box, Card, useMediaQuery } from '@mui/material';

import { AboutPanel } from '../components/settings/AboutPanel';
import { AccountSecurityPanel } from '../components/settings/AccountSecurityPanel';
import { LegalPrivacyPanel } from '../components/settings/LegalPrivacyPanel';
import { PreferencesPanel } from '../components/settings/PreferencesPanel';
import { SETTINGS_CATEGORIES, SETTINGS_WIDE_QUERY, SettingsNav } from '../components/settings/SettingsNav';
import type { SettingsCategoryId } from '../components/settings/SettingsNav';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { SupportFeedbackPanel } from '../components/settings/SupportFeedbackPanel';
import { OPS_BORDER, opsCardSx } from '../components/operations/operationsTheme';

// What each category shows, and whether its rows are a list of settings (a thin line between them) or one piece of content
const PANELS: Record<SettingsCategoryId, { content: React.ReactNode; divided: boolean }> = {
  preferences: { content: <PreferencesPanel />, divided: true },
  account: { content: <AccountSecurityPanel />, divided: true },
  support: { content: <SupportFeedbackPanel />, divided: true },
  legal: { content: <LegalPrivacyPanel />, divided: false },
  about: { content: <AboutPanel />, divided: false },
};

// Settings: ONE card in the middle of the page area. The categories are on its left (a row of tabs along its top on a narrow screen) and the settings of the
// chosen category fill the rest. Sizes come from the space that is left, not from fixed numbers:
//  - on a wide screen the card is as tall as the page area (the space under the header, between the paddings) and the settings scroll inside it, so the
//    sidebar line and the card always reach the bottom and a long document gets all the room that is left;
//  - on a narrow screen the card is at least that tall and grows with its content, and the page scrolls.
// Each category lives in components/settings; this page only picks which one is shown.
export const TodaSettingsPage: React.FC = () => {
  const wide = useMediaQuery(SETTINGS_WIDE_QUERY, { noSsr: true });
  const [category, setCategory] = useState<SettingsCategoryId>('preferences');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: 1600,
        mx: 'auto',
        height: wide ? '100%' : undefined,
        minHeight: wide ? 440 : '100%',
      }}
    >
      <Card
        elevation={0}
        sx={{
          ...opsCardSx,
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: wide ? 'clamp(210px, 22%, 260px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gridTemplateRows: wide ? 'minmax(0, 1fr)' : 'auto minmax(0, 1fr)',
        }}
      >
        <Box
          sx={{
            backgroundColor: '#FAFAF8',
            borderRight: wide ? `1px solid ${OPS_BORDER}` : 'none',
            borderBottom: wide ? 'none' : `1px solid ${OPS_BORDER}`,
            p: wide ? '12px' : '6px 8px',
            minWidth: 0,
            overflowY: wide ? 'auto' : 'visible',
          }}
        >
          <SettingsNav value={category} onChange={setCategory} vertical={wide} />
        </Box>

        <Box sx={{ minWidth: 0, minHeight: 0, p: '20px 24px 24px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {SETTINGS_CATEGORIES.map((c) => (
            <SettingsPanel key={c.id} category={c} active={c.id === category} divided={PANELS[c.id].divided}>
              {PANELS[c.id].content}
            </SettingsPanel>
          ))}
        </Box>
      </Card>
    </Box>
  );
};
