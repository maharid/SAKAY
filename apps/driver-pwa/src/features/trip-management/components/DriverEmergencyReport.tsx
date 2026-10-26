import React, { useState } from 'react';
import { Button, IconButton } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';

import { DESTRUCTIVE_BUTTON_SX, UrgentSafetyReportDialog, fileUrgentSafetyReport, useInFlight, type UrgentReportCategory } from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';

interface DriverEmergencyReportProps {
  bookingId: string;
  language: string;
  /** 'icon': a small red icon button (for a row that is short on room); the label stays as its accessible name. Default: the text button. */
  variant?: 'text' | 'icon';
}

/**
 * Rules 16.5, 19.7, 26.2, 26.3: the driver's emergency report during a trip - an accident, a passenger who needs a doctor, a safety concern, a threat or an assault. One tap, nothing to type;
 * the database files it as an emergency incident (or straight to the LGU Administrator for a threat or an assault, Rule 19.8) with the vehicle's last known position. It does not end the trip:
 * once it is safe the driver stops the trip with "I cannot continue the trip" and the reason (an accident, an emergency, a safety concern ...), which is never struck (decision PI-11B).
 */
const DriverEmergencyReport: React.FC<DriverEmergencyReportProps> = ({ bookingId, language, variant = 'text' }) => {
  const tl = language === 'tl';
  const flight = useInFlight();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [routing, setRouting] = useState<'TODA' | 'LGU' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = tl ? 'Emergency / Agarang Ulat' : 'Emergency / Urgent Report';

  const submit = (category: UrgentReportCategory, description: string) =>
    flight.run(async () => {
      setError(null);
      const r = await fileUrgentSafetyReport(supabase, bookingId, category, description || null);
      if (!r.ok) {
        setError(r.error ?? (tl ? 'Hindi naipadala ang ulat. Pakisubukang muli.' : 'The report could not be sent. Please try again.'));
        return;
      }
      setRouting(r.data?.routing === 'LGU' ? 'LGU' : 'TODA');
      setSent(true);
    });

  const close = () => {
    setOpen(false);
    setSent(false);
    setError(null);
  };

  return (
    <>
      {variant === 'icon' ? (
        <IconButton
          aria-label={label}
          title={label}
          onClick={() => setOpen(true)}
          sx={{ width: 44, height: 44, flexShrink: 0, backgroundColor: '#FEE2E2', color: '#B91C1C', '&:hover': { backgroundColor: '#FECACA' } }}
        >
          <ReportProblemIcon fontSize="small" />
        </IconButton>
      ) : (
        <Button
          variant="outlined"
          fullWidth
          startIcon={<ReportProblemIcon />}
          onClick={() => setOpen(true)}
          sx={DESTRUCTIVE_BUTTON_SX}
        >
          {label}
        </Button>
      )}
      <UrgentSafetyReportDialog
        open={open}
        language={tl ? 'tl' : 'en'}
        busy={flight.busy}
        sent={sent}
        sentRouting={routing}
        error={error}
        onClose={close}
        onSubmit={submit}
      />
    </>
  );
};

export default DriverEmergencyReport;
