import React from 'react';
import { Box, Typography } from '@mui/material';

import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT } from '../../styles/pageTheme';
import { settingsListSx } from '../common/SettingRow';
import { useLanguage } from '../../hooks/useLanguage';
import { settingsPanelId, settingsTabId } from './SettingsNav';
import type { SettingsCategory } from './SettingsNav';

interface SettingsPanelProps {
  category: SettingsCategory;
  /** only the chosen category is shown; the others stay in the page (hidden), so what someone has set but not saved is not lost when they look at another category */
  active: boolean;
  /** put a thin line between the rows (true for a list of settings, false for a document) */
  divided?: boolean;
  children: React.ReactNode;
}

// The content area of one category: its title and short description, then its rows.
// The panel grows to the height of the card, so a panel with a document in it (Legal & Privacy) can give the document all the room that is left.
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ category, active, divided = true, children }) => {
  const { t } = useLanguage();

  return (
    <Box
      role="tabpanel"
      id={settingsPanelId(category.id)}
      aria-labelledby={settingsTabId(category.id)}
      hidden={!active}
      sx={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
    >
      <Box sx={{ pb: '14px', borderBottom: `1px solid ${PAGE_BORDER}`, flexShrink: 0 }}>
        <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>{t(category.labelKey)}</Typography>
        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '2px' }}>{category.description}</Typography>
      </Box>
      <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', ...(divided ? settingsListSx : {}) }}>{children}</Box>
    </Box>
  );
};
