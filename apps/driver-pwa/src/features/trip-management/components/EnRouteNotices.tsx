import React, { useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';

import { reportDriverDelay } from '../../../services/bookingClockService';
import type { DriverDelayReason } from '@sakay/shared';

interface EnRouteNoticesProps {
  bookingId: string;
  language: string;
  /** Rule 8.2: set once the database has warned this driver that he has not started toward the passenger */
  stallWarnedAt: string | null;
  onMessage: (message: string) => void;
}

/**
 * What the system tells (and lets) a driver on the way to the pickup:
 *  - the Rule 8.2 warning when he has not started moving toward the passenger (the booking is cancelled for him a minute later), and
 *  - the two delays he may report (Rule 8.4: traffic, a road closure) so that standing still for a while on the way is not taken for a stall.
 */
const EnRouteNotices: React.FC<EnRouteNoticesProps> = ({ bookingId, language, stallWarnedAt, onMessage }) => {
  const [sending, setSending] = useState<DriverDelayReason | null>(null);

  const report = async (reason: DriverDelayReason) => {
    setSending(reason);
    const result = await reportDriverDelay(bookingId, reason);
    setSending(null);
    if (!result.ok) {
      onMessage(result.error || (language === 'tl' ? 'Hindi naiulat ang pagkaantala.' : 'The delay could not be reported.'));
      return;
    }
    onMessage(
      language === 'tl'
        ? 'Naitala ang pagkaantala. Magpatuloy sa pagpunta sa pasahero.'
        : 'Delay noted. Please carry on toward the passenger.'
    );
  };

  const delayButton = (reason: DriverDelayReason, label: string) => (
    <Button
      size="small"
      variant="outlined"
      disabled={sending !== null}
      onClick={() => report(reason)}
      sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 700, fontSize: '12px', borderColor: '#CBD5E1', color: '#475569', flex: 1 }}
    >
      {label}
    </Button>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {stallWarnedAt && (
        <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '12.5px', fontWeight: 600 }}>
          {language === 'tl'
            ? 'Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.'
            : 'You have not started traveling toward the passenger. Please proceed or cancel the booking.'}
        </Alert>
      )}
      <Box>
        <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', mb: 0.5 }}>
          {language === 'tl' ? 'Huminto sa daan? Ipaalam kung bakit:' : 'Stopped on the way? Tell us why:'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {delayButton('traffic', language === 'tl' ? 'Trapiko' : 'Heavy traffic')}
          {delayButton('road_closure', language === 'tl' ? 'Sarado ang daan' : 'Road closed')}
        </Box>
      </Box>
    </Box>
  );
};

export default EnRouteNotices;
