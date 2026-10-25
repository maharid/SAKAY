import React from 'react';
import { Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { SettingRow } from '../common/SettingRow';
import { secondaryButtonSx } from '../../styles/pageTheme';

// Help & Support: the way to the help page the header's "Tulong" button used to open (the /tulong screen, unchanged). Nothing is added here: the page's own
// content is what it was, and this entry only takes the person to it.
export const HelpSupportPanel: React.FC = () => {
  const navigate = useNavigate();

  return (
    <SettingRow
      title="Tulong help center"
      description="User guides and support information for LGU administrators."
      control={
        <Button onClick={() => navigate('/tulong')} sx={secondaryButtonSx}>
          Open Help &amp; Support
        </Button>
      }
    />
  );
};
