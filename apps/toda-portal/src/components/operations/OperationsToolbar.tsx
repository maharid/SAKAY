import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import RefreshIcon from '@mui/icons-material/Refresh';

import { CONTROL, FONT, SPACE } from '../../styles/density';
import { OPS_BORDER, OPS_TEXT, opsButtonSx } from './operationsTheme';

export type OperationsAccreditationState = 'active' | 'not-active' | 'loading';

interface OperationsToolbarProps {
  /** 'loading' while the profile is still being read, so a warning does not flash before the answer is known */
  accreditation: OperationsAccreditationState;
  /** The certificate number the LGU recorded, when there is one */
  accreditationNo?: string;
  dateLabel: string;
  onOpenCalendar: (anchor: HTMLElement) => void;
  lastRefreshed: string;
  onRefresh: () => void;
}

const outlinedButtonSx = {
  ...opsButtonSx,
  color: OPS_TEXT.primary,
  backgroundColor: '#FFFFFF',
  border: `1px solid ${OPS_BORDER}`,
  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' },
  '& .MuiButton-startIcon .MuiSvgIcon-root': { fontSize: 16 },
} as const;

// Each state has its own icon and its own words, so the colour is never the only signal.
const ACCREDITATION_LOOK = {
  active: { border: '#86EFAC', background: '#F0FDF4', color: '#166534', label: 'Accreditation active' },
  'not-active': { border: '#FCD34D', background: '#FFFBEB', color: '#92400E', label: 'Accreditation not active yet' },
  loading: { border: OPS_BORDER, background: '#FFFFFF', color: OPS_TEXT.secondary, label: 'Checking accreditation...' },
} as const;

// One slim row: accreditation on the left (one pill instead of a banner), date and refresh on the right.
export const OperationsToolbar: React.FC<OperationsToolbarProps> = ({
  accreditation,
  accreditationNo,
  dateLabel,
  onOpenCalendar,
  lastRefreshed,
  onRefresh,
}) => {
  const look = ACCREDITATION_LOOK[accreditation];

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mb: SPACE.gapLarge }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '3px 8px',
          minHeight: CONTROL.height,
          px: '13px',
          py: '3px',
          borderRadius: SPACE.cardRadius,
          border: `1px solid ${look.border}`,
          backgroundColor: look.background,
          color: look.color,
        }}
      >
        {accreditation === 'active' && <VerifiedUserOutlinedIcon aria-hidden sx={{ fontSize: 18 }} />}
        {accreditation === 'not-active' && <WarningAmberIcon aria-hidden sx={{ fontSize: 18 }} />}
        <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'inherit' }}>{look.label}</Typography>
        {accreditation !== 'loading' && accreditationNo && (
          <Typography sx={{ fontSize: FONT.small, color: 'inherit' }}>Certificate #{accreditationNo}</Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <Button
          onClick={(e) => onOpenCalendar(e.currentTarget)}
          startIcon={<CalendarTodayIcon aria-hidden sx={{ color: OPS_TEXT.brand }} />}
          sx={outlinedButtonSx}
        >
          {dateLabel}
        </Button>
        <Button onClick={onRefresh} startIcon={<RefreshIcon aria-hidden />} sx={outlinedButtonSx}>
          Refresh
        </Button>
        <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>Updated {lastRefreshed}</Typography>
      </Box>
    </Box>
  );
};
