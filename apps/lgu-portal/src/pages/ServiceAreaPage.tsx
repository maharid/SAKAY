import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, TextField, Typography } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import { PILOT_RADIUS_MAX_KM, PILOT_RADIUS_MIN_KM, pilotAreaProblem } from '@sakay/shared';
import type { ServiceAreaRecord } from '@sakay/shared';

import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { fetchServiceAreas, fetchTodaTerminals, setPilotServiceArea, useWholeCityServiceArea } from '../services/adminApiService';

const stamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const cardSx = { p: 3, mb: 3, borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' };

/**
 * ============================================================================
 * SERVICE AREA PAGE (ServiceAreaPage.tsx)
 * ============================================================================
 * PI-01 / Rule 17.5: the service area is where a booking may START and END.
 *   ● The whole of Calapan City, by its boundary (the default)
 *   ● Or, for a pilot, a circle around one TODA's terminal
 * Every new booking's pickup AND destination must be inside, so a change decides who can book. It is the LGU Administrator's only and is audited.
 * ============================================================================
 */
export const ServiceAreaPage: React.FC = () => {
  const [areas, setAreas] = useState<ServiceAreaRecord[] | null>(null);
  const [terminals, setTerminals] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [todaId, setTodaId] = useState('');
  const [radius, setRadius] = useState('1.5');
  const [confirm, setConfirm] = useState<'city' | 'pilot' | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [list, tods] = await Promise.all([fetchServiceAreas(), fetchTodaTerminals()]);
    setAreas(list);
    setTerminals(tods);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const active = areas?.find((a) => a.active) ?? null;
  const radiusNumber = radius.trim() === '' ? null : Number(radius);
  const problem = pilotAreaProblem(todaId || null, radiusNumber);

  const apply = async () => {
    const which = confirm;
    setConfirm(null);
    if (!which || busy) return;
    setBusy(true);
    const failure = which === 'city' ? await useWholeCityServiceArea() : await setPilotServiceArea(todaId, radiusNumber ?? 0);
    setBusy(false);
    setMessage(failure ? { severity: 'error', text: failure } : { severity: 'success', text: which === 'city' ? 'The service area is the whole of Calapan City.' : 'The service area is now the pilot area.' });
    if (!failure) await load();
  };

  return (
    <Box sx={{ maxWidth: 900, margin: '0 auto', pb: 6 }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress size={32} sx={{ color: 'var(--sakay-orange)' }} /></Box>
      ) : (
        <>
          {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2, borderRadius: '10px' }}>{message.text}</Alert>}
          {areas === null && <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>The service area could not be read.</Alert>}

          <Paper elevation={0} sx={cardSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
              <MapIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>Where bookings may start and end now</Typography>
            </Box>
            {active ? (
              <>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{active.name}</Typography>
                <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', mt: 0.5 }}>
                  {active.isWholeCity ? 'The whole city, by its boundary.' : `A circle of ${active.radiusKm} km around the terminal: a pilot area.`} Changed {stamp(active.updatedAt)}.
                </Typography>
              </>
            ) : (
              <Typography sx={{ fontSize: '14px', color: '#B91C1C', fontWeight: 600 }}>No service area is active.</Typography>
            )}
            <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 1.5, lineHeight: 1.5 }}>
              A passenger can book only when the pickup AND the destination are inside. A change applies to every new booking at once; trips already under way are not affected.
            </Typography>
          </Paper>

          <Paper elevation={0} sx={cardSx}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 1 }}>The whole of Calapan City</Typography>
            <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', mb: 2, lineHeight: 1.5 }}>Use the city boundary as the service area (the normal setting).</Typography>
            <Button variant="outlined" disabled={busy || Boolean(active?.isWholeCity)} onClick={() => setConfirm('city')} sx={{ textTransform: 'none', fontWeight: 600 }}>
              {active?.isWholeCity ? 'Already the whole city' : 'Use the whole of Calapan City'}
            </Button>
          </Paper>

          <Paper elevation={0} sx={cardSx}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 1 }}>A pilot area around one TODA's terminal</Typography>
            <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', mb: 2, lineHeight: 1.5 }}>
              Narrows bookings to a circle around the terminal of one TODA, from {PILOT_RADIUS_MIN_KM} to {PILOT_RADIUS_MAX_KM} km. Use it while only that TODA's drivers are on SAKAY.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2, mb: 2 }}>
              <TextField select size="small" label="TODA (its terminal is the centre)" value={todaId} onChange={(e) => setTodaId(e.target.value)}>
                {terminals.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </TextField>
              <TextField size="small" type="number" label="Radius (km)" value={radius} onChange={(e) => setRadius(e.target.value)} slotProps={{ htmlInput: { min: PILOT_RADIUS_MIN_KM, max: PILOT_RADIUS_MAX_KM, step: '0.1' } }} />
            </Box>
            {problem && todaId !== '' && <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mb: 1 }}>{problem}</Typography>}
            <Button variant="contained" disabled={busy || Boolean(problem)} onClick={() => setConfirm('pilot')} sx={{ textTransform: 'none', fontWeight: 600, boxShadow: 'none', backgroundColor: 'var(--sakay-orange)', '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' } }}>
              Narrow to the pilot area
            </Button>
          </Paper>

          {areas && areas.length > 1 && (
            <Paper elevation={0} sx={cardSx}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1 }}>Earlier settings</Typography>
              {areas.filter((a) => !a.active).slice(0, 8).map((a) => (
                <Typography key={a.configId} sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', lineHeight: 1.7 }}>
                  {a.name} ({a.isWholeCity ? 'city boundary' : `${a.radiusKm} km circle`}), last used {stamp(a.updatedAt)}
                </Typography>
              ))}
            </Paper>
          )}
        </>
      )}

      <MacConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'city' ? 'Use the whole of Calapan City?' : 'Narrow the service area?'}
        message={
          confirm === 'city'
            ? 'Passengers anywhere in the city will be able to book. The change is written to the audit log.'
            : `From now on a booking must start AND end within ${radiusNumber ?? '?'} km of the terminal of ${terminals.find((t) => t.id === todaId)?.name ?? 'the TODA'}. Passengers outside it will be refused. The change is written to the audit log.`
        }
        confirmLabel={confirm === 'city' ? 'Use the whole city' : 'Narrow the area'}
        confirmVariant={confirm === 'city' ? 'orange' : 'danger'}
        onConfirm={apply}
      />
    </Box>
  );
};
