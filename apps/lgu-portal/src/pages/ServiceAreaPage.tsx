import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, TableBody, TableCell, TableRow, TextField, Typography } from '@mui/material';
import { PILOT_RADIUS_MAX_KM, PILOT_RADIUS_MIN_KM, pilotAreaProblem } from '@sakay/shared';
import type { ServiceAreaRecord } from '@sakay/shared';

import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { CellStack, DataTableCard, FlagTag } from '../components/common/DataTable';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { fetchServiceAreas, fetchTodaTerminals, setPilotServiceArea, useWholeCityServiceArea } from '../services/adminApiService';
import { FONT, SPACE } from '../styles/density';
import { PAGE_TEXT, primaryButtonSx, secondaryButtonSx } from '../styles/pageTheme';

const stamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

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
  const earlier = (areas ?? []).filter((a) => !a.active).slice(0, 8);

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
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {loading ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', py: '48px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Loading the service area...</Typography>
        </Box>
      ) : (
        <>
          {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: SPACE.gapLarge, borderRadius: '10px' }}>{message.text}</Alert>}
          {areas === null && <Alert severity="error" sx={{ mb: SPACE.gapLarge, borderRadius: '10px' }}>The service area could not be read.</Alert>}

          {/* 1. Where bookings may start and end now */}
          <Box sx={{ mb: SPACE.gapLarge }}>
            <DashboardCard
              title="Current service area"
              description="Where bookings may start and end now"
              titleAdornment={active ? <FlagTag label={active.isWholeCity ? 'Whole city' : 'Pilot area'} tone={active.isWholeCity ? 'success' : 'warning'} /> : undefined}
            >
              {active ? (
                <>
                  <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>{active.name}</Typography>
                  <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '3px', lineHeight: 1.5 }}>
                    {active.isWholeCity ? 'The whole city, by its boundary.' : `A circle of ${active.radiusKm} km around the terminal: a pilot area.`} Changed {stamp(active.updatedAt)}.
                  </Typography>
                </>
              ) : (
                <Typography role="alert" sx={{ fontSize: FONT.body, color: PAGE_TEXT.danger, fontWeight: 600 }}>No service area is active.</Typography>
              )}
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '10px', lineHeight: 1.5 }}>
                A passenger can book only when the pickup AND the destination are inside. A change applies to every new booking at once; trips already under way are not affected.
              </Typography>
            </DashboardCard>
          </Box>

          {/* 2. The two ways to set it */}
          <Box sx={{ containerType: 'inline-size', mb: SPACE.gapLarge }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: SPACE.gapLarge,
                alignItems: 'stretch',
                '@container (min-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              <DashboardCard title="The whole of Calapan City" description="Use the city boundary as the service area (the normal setting).">
                <Box sx={{ mt: 'auto', pt: '4px' }}>
                  <Button disabled={busy || Boolean(active?.isWholeCity)} onClick={() => setConfirm('city')} sx={secondaryButtonSx}>
                    {active?.isWholeCity ? 'Already the whole city' : 'Use the whole of Calapan City'}
                  </Button>
                </Box>
              </DashboardCard>

              <DashboardCard
                title="A pilot area around one TODA's terminal"
                description={`Narrows bookings to a circle around the terminal of one TODA, from ${PILOT_RADIUS_MIN_KM} to ${PILOT_RADIUS_MAX_KM} km. Use it while only that TODA's drivers are on SAKAY.`}
              >
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: 1.6, mb: 1.6 }}>
                  <TextField select size="small" label="TODA (its terminal is the centre)" value={todaId} onChange={(e) => setTodaId(e.target.value)}>
                    {terminals.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                  </TextField>
                  <TextField
                    size="small"
                    type="number"
                    label="Radius (km)"
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                    slotProps={{ htmlInput: { min: PILOT_RADIUS_MIN_KM, max: PILOT_RADIUS_MAX_KM, step: '0.1' } }}
                  />
                </Box>
                {problem && todaId !== '' && (
                  <Typography role="status" sx={{ fontSize: FONT.small, color: PAGE_TEXT.warning, mb: '10px', lineHeight: 1.5 }}>{problem}</Typography>
                )}
                <Box sx={{ mt: 'auto' }}>
                  <Button variant="contained" disabled={busy || Boolean(problem)} onClick={() => setConfirm('pilot')} sx={primaryButtonSx}>
                    Narrow to the pilot area
                  </Button>
                </Box>
              </DashboardCard>
            </Box>
          </Box>

          {/* 3. Earlier settings */}
          {earlier.length > 0 && (
            <>
              <Box sx={{ mb: '10px' }}>
                <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>Earlier settings</Typography>
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>The areas used before, newest first.</Typography>
              </Box>
              <DataTableCard label="Earlier service areas" minWidth={520} columns={[{ label: 'Area' }, { label: 'Kind' }, { label: 'Last used' }]}>
                <TableBody>
                  {earlier.map((a) => (
                    <TableRow key={a.configId}>
                      <TableCell><CellStack primary={a.name} /></TableCell>
                      <TableCell>{a.isWholeCity ? 'City boundary' : `${a.radiusKm} km circle`}</TableCell>
                      <TableCell sx={{ color: PAGE_TEXT.secondary }}>{stamp(a.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTableCard>
            </>
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
