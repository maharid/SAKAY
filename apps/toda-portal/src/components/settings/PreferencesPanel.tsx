import React from 'react';
import { FormControl, MenuItem, Select } from '@mui/material';

import { SettingRow } from '../common/SettingRow';
import { useLanguage } from '../../hooks/useLanguage';
import { DEFAULT_LANGUAGE } from '../../utils/language';
import type { PortalLanguage } from '../../utils/language';
import { CONTROL } from '../../styles/density';

// Language. It uses the same language mechanism as the rest of the portal (utils/language.ts): the choice is kept in this browser under the key the
// Driver and Passenger apps also use, and a saved value that is not an available language is ignored. English is the only language whose screens exist.
export const PreferencesPanel: React.FC = () => {
  const { language, setLanguage, options } = useLanguage();

  return (
    <SettingRow
      title="Language"
      description="Choose the language of this portal. English is the only language available for now. Your choice is saved on this device."
      control={
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value as PortalLanguage)}
            SelectDisplayProps={{ 'aria-label': 'Language' }}
            sx={{ height: CONTROL.height, '@media (pointer: coarse)': { height: CONTROL.touchHeight } }}
          >
            {options.map((option) => (
              <MenuItem key={option.code} value={option.code}>
                {option.name}
                {option.code === DEFAULT_LANGUAGE ? ' (default)' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      }
    />
  );
};
