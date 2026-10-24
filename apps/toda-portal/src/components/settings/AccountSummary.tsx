import React from 'react';
import { Avatar, Box, Typography } from '@mui/material';

import { OPS_TEXT } from '../operations/operationsTheme';
import { FONT } from '../../styles/density';

interface AccountSummaryProps {
  name: string;
  email: string;
}

// Who is signed in: a small grey "Signed in as", the name as the main line, the e-mail address on a line of its own under it. The avatar is the same initial
// circle the sidebar shows. A long name or address wraps inside its column instead of running into the edge of the card.
export const AccountSummary: React.FC<AccountSummaryProps> = ({ name, email }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', py: '16px', minWidth: 0 }}>
    <Avatar aria-hidden sx={{ width: 44, height: 44, flexShrink: 0, fontSize: FONT.cardTitle, fontWeight: 700, color: '#FFFFFF', backgroundColor: '#C75000' }}>
      {name.trim().charAt(0).toUpperCase() || 'T'}
    </Avatar>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.4 }}>Signed in as</Typography>
      <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{name}</Typography>
      {email && <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{email}</Typography>}
    </Box>
  </Box>
);
