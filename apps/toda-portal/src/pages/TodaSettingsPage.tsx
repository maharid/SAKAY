import React, { useState } from 'react';
import { Box, Card, useMediaQuery } from '@mui/material';

import { AboutPanel } from '../components/settings/AboutPanel';
import { AccountSecurityPanel } from '../components/settings/AccountSecurityPanel';
import { LegalPrivacyPanel } from '../components/settings/LegalPrivacyPanel';
import { PreferencesPanel } from '../components/settings/PreferencesPanel';
import { SETTINGS_CATEGORIES, SettingsNav } from '../components/settings/SettingsNav';
import type { SettingsCategoryId } from '../components/settings/SettingsNav';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { SupportFeedbackPanel } from '../components/settings/SupportFeedbackPanel';
import { OPS_BORDER, opsCardSx } from '../components/operations/operationsTheme';
import { SPACE } from '../styles/density';

// What each category shows, and whether its rows are a list of settings (a thin line between them) or one piece of content
const PANELS: Record<SettingsCategoryId, { content: React.ReactNode; divided: boolean }> = {
  preferences: { content: <PreferencesPanel />, divided: true },
  account: { content: <AccountSecurityPanel />, divided: true },
  support: { content: <SupportFeedbackPanel />, divided: true },
  legal: { content: <LegalPrivacyPanel />, divided: false },
  about: { content: <AboutPanel />, divided: false },
};

// Below this screen width the categories become a row of tabs above the settings (the sidebar takes 220px of the screen when it is open)
const WIDE_QUERY = '(min-width: 1100px)';

// Settings: ONE card. The categories are on its left (a row of tabs along its top on a narrow screen) and the settings of the chosen category fill the rest.
// Each category lives in components/settings; this page only picks which one is shown.
export const TodaSettingsPage: React.FC = () => {
  const wide = useMediaQuery(WIDE_QUERY, { noSsr: true });
  const [category, setCategory] = useState<SettingsCategoryId>('preferences');

  return (
    <Box sx={{ maxWidth: 1080, pb: SPACE.section }}>
      <Card
        elevation={0}
        sx={{ ...opsCardSx, overflow: 'hidden', display: 'grid', gridTemplateColumns: wide ? '232px minmax(0, 1fr)' : 'minmax(0, 1fr)', minHeight: wide ? 520 : 0 }}
      >
        <Box
          sx={{
            backgroundColor: '#FAFAF8',
            borderRight: wide ? `1px solid ${OPS_BORDER}` : 'none',
            borderBottom: wide ? 'none' : `1px solid ${OPS_BORDER}`,
            p: wide ? '12px' : '6px 8px',
            minWidth: 0,
          }}
        >
          <SettingsNav value={category} onChange={setCategory} vertical={wide} />
        </Box>

        <Box sx={{ minWidth: 0, p: '20px 24px 24px' }}>
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
