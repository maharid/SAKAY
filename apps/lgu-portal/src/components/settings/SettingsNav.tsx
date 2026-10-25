import React from 'react';
import { Tab, Tabs } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import GavelIcon from '@mui/icons-material/Gavel';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { useLanguage } from '../../hooks/useLanguage';
import type { TranslationKey } from '../../utils/translations';
import { CONTROL, FONT } from '../../styles/density';
import { PAGE_TEXT } from '../../styles/pageTheme';

export type SettingsCategoryId = 'preferences' | 'support' | 'legal' | 'about';

export interface SettingsCategory {
  id: SettingsCategoryId;
  /** the name in the menu and the title of the panel (Tagalog where the Driver App has one) */
  labelKey: TranslationKey;
  description: string;
  icon: React.ReactElement;
}

// Only categories that have something real in them (the same rule as the TODA portal's Settings, which also has Account & Security: the LGU portal keeps the
// password and the sign-in details under Account Management).
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'preferences', labelKey: 'nav.preferences', description: 'How this portal looks and reads.', icon: <TuneIcon /> },
  { id: 'support', labelKey: 'nav.support', description: 'Find help, get in touch with the SAKAY team or tell us how the portal is working.', icon: <HelpOutlinedIcon /> },
  { id: 'legal', labelKey: 'nav.legal', description: 'The rules of using SAKAY and how it looks after personal information.', icon: <GavelIcon /> },
  { id: 'about', labelKey: 'nav.about', description: 'What SAKAY is and who built it.', icon: <InfoOutlinedIcon /> },
];

export const settingsTabId = (id: SettingsCategoryId) => `settings-tab-${id}`;
export const settingsPanelId = (id: SettingsCategoryId) => `settings-panel-${id}`;

// Below this screen width the categories become a row of tabs above the settings (the sidebar takes 220px of the screen when it is open)
export const SETTINGS_WIDE_QUERY = '(min-width: 1100px)';
export const SETTINGS_WIDE_MEDIA = `@media ${SETTINGS_WIDE_QUERY}`;

interface SettingsNavProps {
  value: SettingsCategoryId;
  onChange: (next: SettingsCategoryId) => void;
  /** a column of categories (wide screen) or a row of tabs that scrolls sideways (narrow screen) */
  vertical: boolean;
}

// The categories. The chosen one has a soft orange background and orange text; nothing else (no line, no bar) marks it.
// MUI's Tabs gives the keyboard behaviour for free: Tab enters the list, the arrow keys move between categories, Home and End jump to the ends.
export const SettingsNav: React.FC<SettingsNavProps> = ({ value, onChange, vertical }) => {
  const { t } = useLanguage();

  return (
    <Tabs
      value={value}
      onChange={(_, next: SettingsCategoryId) => onChange(next)}
      orientation={vertical ? 'vertical' : 'horizontal'}
      variant={vertical ? 'standard' : 'scrollable'}
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label="Settings categories"
      sx={{
        minHeight: 0,
        '& .MuiTabs-indicator': { display: 'none' },
        '& .MuiTabs-list': { gap: '2px' },
        '& .MuiTab-root': {
          textTransform: 'none',
          fontSize: FONT.body,
          fontWeight: 500,
          color: PAGE_TEXT.primary,
          minHeight: 40,
          minWidth: 0,
          px: '12px',
          gap: '10px',
          justifyContent: vertical ? 'flex-start' : 'center',
          alignItems: 'center',
          textAlign: 'left',
          borderRadius: CONTROL.radius,
          '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
          '& .MuiTab-iconWrapper': { mb: 0, mr: 0, fontSize: 18, color: PAGE_TEXT.secondary },
          '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.05)' },
          '&.Mui-selected': {
            color: PAGE_TEXT.brand,
            fontWeight: 700,
            backgroundColor: 'var(--sakay-orange-soft)',
            '& .MuiTab-iconWrapper': { color: PAGE_TEXT.brand },
          },
          '&.Mui-focusVisible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '-2px' },
        },
      }}
    >
      {SETTINGS_CATEGORIES.map((category) => (
        <Tab
          key={category.id}
          value={category.id}
          id={settingsTabId(category.id)}
          aria-controls={settingsPanelId(category.id)}
          icon={category.icon}
          iconPosition="start"
          label={t(category.labelKey)}
        />
      ))}
    </Tabs>
  );
};
