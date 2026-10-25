import React from 'react';
import { Box, Typography } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';

import { formatManilaDateTime } from '@sakay/shared/utils/restrictionUtils';
import type { AccountRestrictionKind } from '../../mockData/adminData';
import { FONT } from '../../styles/density';

interface RestrictionBannerProps {
  kind?: AccountRestrictionKind;
  suspendedUntil?: string;
  reason?: string;
}

/**
 * Shows an account's suspension / deactivation state as decided by the database.
 * Renders nothing for an unrestricted account.
 */
export const RestrictionBanner: React.FC<RestrictionBannerProps> = ({ kind, suspendedUntil, reason }) => {
  if (!kind) return null;

  const until = formatManilaDateTime(suspendedUntil);
  const headline =
    kind === 'CLOSED'
      ? 'Account Permanently Closed'
      : kind === 'DEACTIVATED'
        ? 'Account Deactivated — awaiting manual LGU review'
        : kind === 'INVESTIGATION'
          ? 'Account Suspended — pending investigation (no end date)'
          : until
            ? `Account Suspended until ${until}`
            : 'Account Suspended';

  return (
    <Box sx={{ mb: 3.2, backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', padding: '13px 16px', borderRadius: '12px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.4 }}>
        <ReportProblemIcon sx={{ color: '#DC2626', fontSize: '18px' }} />
        <Typography sx={{ fontSize: FONT.heading, fontWeight: 600, color: '#991B1B' }}>{headline}</Typography>
      </Box>
      {reason && (
        <Typography sx={{ fontSize: FONT.small, color: '#B91C1C', mt: '3px' }}>{reason}</Typography>
      )}
      {kind === 'SUSPENDED' && (
        <Typography sx={{ fontSize: FONT.small, color: '#B91C1C', mt: '3px' }}>
          The suspension lifts automatically when this period ends.
        </Typography>
      )}
    </Box>
  );
};
