import React, { useState } from 'react';
import { Button } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';

import { UrgentSafetyReportDialog, fileUrgentSafetyReport, useInFlight, type UrgentReportCategory } from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';

interface DriverEmergencyReportProps {
  bookingId: string;
  language: string;
}

/**
 * Rules 16.5, 19.7, 26.2, 26.3: the driver's emergency report during a trip - an accident, a passenger who needs a doctor, a safety concern, a threat or an assault. One tap, nothing to type;
 * the database files it as an emergency incident (or straight to the LGU Administrator for a threat or an assault, Rule 19.8) with the vehicle's last known position. It does not end the trip:
 * once it is safe the driver stops the trip with "I cannot continue the trip" and the reason (an accident, an emergency, a safety concern ...), which is never struck (decision PI-11B).
 */
const DriverEmergencyReport: React.FC<DriverEmergencyReportProps> = ({ bookingId, language }) => {
  const tl = language === 'tl';
  const flight = useInFlight();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [routing, setRouting] = useState<'TODA' | 'LGU' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <Button
        variant="text"
        fullWidth
        startIcon={<ReportProblemIcon />}
        onClick={() => setOpen(true)}
        sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '13px', color: '#B91C1C', fontFamily: 'Poppins, sans-serif' }}
      >
        {tl ? 'Emergency / Agarang Ulat' : 'Emergency / Urgent Report'}
      </Button>
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
