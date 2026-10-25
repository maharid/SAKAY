import React, { useState } from 'react';
import { Box, Card, useMediaQuery } from '@mui/material';

import { AppearancePanel } from '../components/settings/AppearancePanel';
import { HelpSupportPanel } from '../components/settings/HelpSupportPanel';
import { SETTINGS_CATEGORIES, SETTINGS_WIDE_QUERY, SettingsNav } from '../components/settings/SettingsNav';
import type { SettingsCategoryId } from '../components/settings/SettingsNav';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { PAGE_BORDER, pageCardSx } from '../styles/pageTheme';

// What each category shows
const PANELS: Record<SettingsCategoryId, React.ReactNode> = {
  appearance: <AppearancePanel />,
  support: <HelpSupportPanel />,
};

// Settings: ONE card (the same as the TODA portal's Settings). The categories are on its left (a row of tabs along its top on a narrow screen) and the
// settings of the chosen category fill the rest. Each category lives in components/settings; this page only picks which one is shown.
export const SettingsPage: React.FC = () => {
  const wide = useMediaQuery(SETTINGS_WIDE_QUERY, { noSsr: true });
  const [category, setCategory] = useState<SettingsCategoryId>('appearance');

  return (
    <Box sx={{ width: '100%', maxWidth: 1600, mx: 'auto', pb: 4.8 }}>
      <Card
        elevation={0}
        sx={{
          ...pageCardSx,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: wide ? 'clamp(210px, 22%, 260px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          minHeight: 360,
        }}
      >
        <Box
          sx={{
            backgroundColor: '#FAFAF8',
            borderRight: wide ? `1px solid ${PAGE_BORDER}` : 'none',
            borderBottom: wide ? 'none' : `1px solid ${PAGE_BORDER}`,
            p: wide ? '12px' : '6px 8px',
            minWidth: 0,
          }}
        >
          <SettingsNav value={category} onChange={setCategory} vertical={wide} />
        </Box>

        <Box sx={{ minWidth: 0, p: '20px 24px 24px', display: 'flex', flexDirection: 'column' }}>
          {SETTINGS_CATEGORIES.map((c) => (
            <SettingsPanel key={c.id} category={c} active={c.id === category}>
              {PANELS[c.id]}
            </SettingsPanel>
          ))}
        </Box>
      </Card>
    </Box>
  );
};
