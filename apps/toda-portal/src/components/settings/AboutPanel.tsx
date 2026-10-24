import React from 'react';
import { Box, Link } from '@mui/material';

import { SettingFact, settingsListSx } from '../common/SettingRow';
import { OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { ABOUT_SAKAY, SUPPORT_EMAIL } from '../../utils/appInfo';

// About SAKAY: only facts the project has (utils/appInfo.ts). There is no version number because the portal has none.
export const AboutPanel: React.FC = () => (
  <Box component="dl" sx={{ m: 0, ...settingsListSx }}>
    <SettingFact label="Application">{ABOUT_SAKAY.name} {ABOUT_SAKAY.portal}</SettingFact>
    <SettingFact label="About">{ABOUT_SAKAY.description}</SettingFact>
    <SettingFact label="Contact">
      <Link href={`mailto:${SUPPORT_EMAIL}`} underline="hover" sx={{ color: OPS_TEXT.brand, fontWeight: 600, ...opsFocusRing }}>{SUPPORT_EMAIL}</Link>
    </SettingFact>
    <SettingFact label="Developed by">
      {ABOUT_SAKAY.developers.map((name) => (
        <Box component="span" key={name} sx={{ display: 'block' }}>{name}</Box>
      ))}
    </SettingFact>
  </Box>
);
