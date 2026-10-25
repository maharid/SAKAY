import React, { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { VehicleSubstitutionsPanel, asSubstitutionClient, decideVehicleSubstitution, endVehicleSubstitution, fetchVehicleSubstitutions } from '@sakay/shared';
import type { VehicleSubstitution } from '@sakay/shared';

import { supabase } from '../services/supabaseClient';
import { FONT } from '../styles/density';

/**
 * ============================================================================
 * VEHICLE SUBSTITUTIONS PAGE (VehicleSubstitutionsPage.tsx)
 * ============================================================================
 * Rule 29.18: a driver may use another vehicle only with the approval of the TODA Administrator and then the LGU Administrator, for 1 to 7 days.
 *   ● The requests the TODA Administrator already approved (or of a driver with no TODA) wait here
 *   ● Approving puts the substitute vehicle in place until the days are over; the registered vehicle comes back by itself
 *   ● An active substitution can be ended early; the driver is told of every decision
 * ============================================================================
 */
export const VehicleSubstitutionsPage: React.FC = () => {
  const [requests, setRequests] = useState<VehicleSubstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const rows = await fetchVehicleSubstitutions(asSubstitutionClient(supabase));
    setFailed(rows === null);
    setRequests(rows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box sx={{ maxWidth: 1100, margin: '0 auto', pb: 4.8 }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4.8 }}>
          <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)' }} />
        </Box>
      ) : (
        <>
          {failed && <Alert severity="error" sx={{ mb: 1.6, borderRadius: '10px' }}>The requests could not be loaded. Please try again.</Alert>}
          <VehicleSubstitutionsPanel
            role="lgu_admin"
            requests={requests}
            showWhenEmpty
            onDecide={async (id, approve, note) => {
              const message = await decideVehicleSubstitution(asSubstitutionClient(supabase), 'lgu_admin', id, approve, note);
              if (!message) await load();
              return message;
            }}
            onEnd={async (id, reason) => {
              const message = await endVehicleSubstitution(asSubstitutionClient(supabase), id, reason);
              if (!message) await load();
              return message;
            }}
          />
          {!failed && requests.length === 0 && (
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', textAlign: 'center' }}>
              No driver has asked to use another vehicle. A request appears here after the driver's TODA Administrator approves it.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
};
