import React from 'react';
import { Tab, Tabs } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import GavelIcon from '@mui/icons-material/Gavel';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { CONTROL, FONT } from '../../styles/density';
import { OPS_TEXT } from '../operations/operationsTheme';

export type SettingsCategoryId = 'preferences' | 'account' | 'support' | 'legal' | 'about';

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: React.ReactElement;
}

// Only categories that have something real in them. There is no "Notifications": the portal has no notification preferences to change
// (the bell in the header just lists the notices), and a page of switches that do nothing would be worse than no page.
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'preferences', label: 'Preferences', description: 'How this portal reads.', icon: <TuneIcon /> },
  { id: 'account', label: 'Account & Security', description: 'Your sign-in, password and session.', icon: <LockOutlinedIcon /> },
  { id: 'support', label: 'Support & Feedback', description: 'Get help from the SAKAY team or tell us how the portal is working.', icon: <HelpOutlinedIcon /> },
  { id: 'legal', label: 'Legal & Privacy', description: 'The rules of using SAKAY and how it looks after personal information.', icon: <GavelIcon /> },
  { id: 'about', label: 'About SAKAY', description: 'What SAKAY is and who built it.', icon: <InfoOutlinedIcon /> },
];

export const settingsTabId = (id: SettingsCategoryId) => `settings-tab-${id}`;
export const settingsPanelId = (id: SettingsCategoryId) => `settings-panel-${id}`;

interface SettingsNavProps {
  value: SettingsCategoryId;
  onChange: (next: SettingsCategoryId) => void;
  /** a column of categories (wide screen) or a row of tabs that scrolls sideways (narrow screen) */
  vertical: boolean;
}

// The categories. The chosen one has a soft orange background and orange text; nothing else (no line, no bar) marks it.
// MUI's Tabs gives the keyboard behaviour for free: Tab enters the list, the arrow keys move between categories, Home and End jump to the ends.
export const SettingsNav: React.FC<SettingsNavProps> = ({ value, onChange, vertical }) => (
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
        color: OPS_TEXT.primary,
        minHeight: 40,
        minWidth: 0,
        px: '12px',
        gap: '10px',
        justifyContent: vertical ? 'flex-start' : 'center',
        alignItems: 'center',
        textAlign: 'left',
        borderRadius: CONTROL.radius,
        '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
        '& .MuiTab-iconWrapper': { mb: 0, mr: 0, fontSize: 18, color: OPS_TEXT.secondary },
        '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.05)' },
        '&.Mui-selected': {
          color: OPS_TEXT.brand,
          fontWeight: 700,
          backgroundColor: 'var(--sakay-orange-soft)',
          '& .MuiTab-iconWrapper': { color: OPS_TEXT.brand },
        },
        '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '-2px' },
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
        label={category.label}
      />
    ))}
  </Tabs>
);
