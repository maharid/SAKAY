import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, TableBody, TableCell, TableRow, TextField, Typography } from '@mui/material';
import { PILOT_RADIUS_MAX_KM, PILOT_RADIUS_MIN_KM, SakayToast, pilotAreaProblem } from '@sakay/shared';
import type { ServiceAreaRecord } from '@sakay/shared';

import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { DispatchSettingsCard } from '../components/admin/DispatchSettingsCard';
import { ServiceAreaMap } from '../components/admin/ServiceAreaMap';
import { CellStack, DataTableCard, FlagTag } from '../components/common/DataTable';
import { SegmentedToggle } from '../components/common/SegmentedToggle';
import type { SegmentedOption } from '../components/common/SegmentedToggle';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { fetchActiveServiceAreaShape, fetchServiceAreas, fetchTodaTerminals, setPilotServiceArea, useWholeCityServiceArea } from '../services/adminApiService';
import type { ServiceAreaShapeOnMap, TerminalPin } from '../services/adminApiService';
import { FONT, SPACE } from '../styles/density';
import { PAGE_DIVIDER, PAGE_TEXT, primaryButtonSx, secondaryButtonSx } from '../styles/pageTheme';

const stamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

type Choice = 'city' | 'pilot';
const CHOICES: SegmentedOption<Choice>[] = [
  { value: 'city', label: 'The whole city' },
  { value: 'pilot', label: 'A pilot area' },
];

/** One line of "what this means": a label and the sentence */
const Effect: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.secondary }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, mt: '1px', fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.5 }}>{children}</Typography>
  </Box>
);

/**
 * ============================================================================
 * SERVICE AREA PAGE (ServiceAreaPage.tsx)
 * ============================================================================
 * PI-01 / Rule 17.5: the service area is where a booking may START and END.
 *   ● The whole of Calapan City, by its boundary (the default)
 *   ● Or, for a pilot, a circle around one TODA's terminal
 * Every new booking's pickup AND destination must be inside, so a change decides who can book. It is the LGU Administrator's only and is audited.
 * The page shows the area on a map with the TODA terminals, says what it means for booking and for finding a driver, changes it in ONE place, and holds the driver search
 * settings (how long an offer and a search may take), which belong with it. The rules and the database functions are unchanged.
 * ============================================================================
 */
export const ServiceAreaPage: React.FC = () => {
  const [areas, setAreas] = useState<ServiceAreaRecord[] | null>(null);
  const [shape, setShape] = useState<ServiceAreaShapeOnMap | null>(null);
  const [terminals, setTerminals] = useState<TerminalPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<Choice>('city');
  const [todaId, setTodaId] = useState('');
  const [radius, setRadius] = useState('1.5');
  const [confirm, setConfirm] = useState<Choice | null>(null);
  const [problemText, setProblemText] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  const load = async () => {
    const [list, tods, active] = await Promise.all([fetchServiceAreas(), fetchTodaTerminals(), fetchActiveServiceAreaShape()]);
    setAreas(list);
    setTerminals(tods);
    setShape(active);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const active = areas?.find((a) => a.active) ?? null;
  const radiusNumber = radius.trim() === '' ? null : Number(radius);
  const problem = pilotAreaProblem(todaId || null, radiusNumber);
  const earlier = (areas ?? []).filter((a) => !a.active).slice(0, 8);
  const chosenTerminal = terminals.find((t) => t.id === todaId) ?? null;
  // the pilot circle the form describes, drawn dashed on the map before it is applied
  const preview = useMemo(
    () => (choice === 'pilot' && chosenTerminal && radiusNumber !== null && !problem ? { lat: chosenTerminal.lat, lng: chosenTerminal.lng, radiusKm: radiusNumber } : null),
    [choice, chosenTerminal, radiusNumber, problem]
  );

  const apply = async () => {
    const which = confirm;
    setConfirm(null);
    if (!which || busy) return;
    setBusy(true);
    setProblemText(null);
    const failure = which === 'city' ? await useWholeCityServiceArea() : await setPilotServiceArea(todaId, radiusNumber ?? 0);
    setBusy(false);
    if (failure) {
      setProblemText(failure);
      return;
    }
    setDone(which === 'city' ? 'The service area is the whole of Calapan City.' : 'The service area is now the pilot area.');
    await load();
  };

  const alreadyCity = Boolean(active?.isWholeCity);
  const canApply = choice === 'city' ? !alreadyCity : !problem;

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {loading ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', py: '48px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Loading the service area...</Typography>
        </Box>
      ) : (
        <>
          {areas === null && <Alert severity="error" sx={{ mb: SPACE.gapLarge, borderRadius: '10px' }}>The service area could not be read.</Alert>}

          {/* 1. The area on a map, and what it means */}
          <Box sx={{ containerType: 'inline-size', mb: SPACE.gapLarge }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: SPACE.gapLarge, alignItems: 'stretch', '@container (min-width: 900px)': { gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' } }}>
              <DashboardCard title="The service area on the map" description="The shaded area is where bookings may start and end. Pins are the terminals of the accredited TODAs.">
                <ServiceAreaMap active={shape} terminals={terminals} preview={preview} highlightTerminalId={choice === 'pilot' ? todaId || null : null} />
              </DashboardCard>

              <DashboardCard
                title="Current service area"
                description="What is in force now, and what it means"
                titleAdornment={active ? <FlagTag label={active.isWholeCity ? 'Whole city' : 'Pilot area'} tone={active.isWholeCity ? 'success' : 'warning'} /> : undefined}
              >
                {active ? (
                  <>
                    <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{active.name}</Typography>
                    <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '3px', lineHeight: 1.5 }}>
                      {active.isWholeCity ? 'The whole city, by its boundary.' : `A circle of ${active.radiusKm} km around the terminal: a pilot area.`} Changed {stamp(active.updatedAt)}.
                    </Typography>
                    <Box component="dl" sx={{ m: 0, mt: '14px', pt: '14px', borderTop: `1px solid ${PAGE_DIVIDER}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <Effect label="Booking">A passenger can book only when the pickup AND the destination are both inside the area. Outside it, the booking is refused before any driver is searched for.</Effect>
                      <Effect label="Finding a driver">Drivers are searched for around the pickup, in widening steps. How long a driver has to answer and how long the search may run are set under Driver search, below.</Effect>
                      <Effect label="When it changes">A change applies to every new booking at once. Trips already under way are not affected. Every change is written to the audit log.</Effect>
                    </Box>
                  </>
                ) : (
                  <Typography role="alert" sx={{ fontSize: FONT.body, color: PAGE_TEXT.danger, fontWeight: 600 }}>No service area is active.</Typography>
                )}
              </DashboardCard>
            </Box>
          </Box>

          {/* 2. Change it: one place, one choice */}
          <Box sx={{ mb: SPACE.gapLarge }}>
            <DashboardCard title="Change the service area" description="Choose the whole city, or narrow bookings to a pilot area around one TODA's terminal.">
              <Box sx={{ mb: '14px' }}>
                <SegmentedToggle label="Service area" value={choice} options={CHOICES} onChange={(v) => { setChoice(v); setProblemText(null); }} />
              </Box>
              {choice === 'city' ? (
                <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5, mb: '14px' }}>
                  Use the city boundary as the service area (the normal setting). Passengers anywhere in Calapan City can book.
                </Typography>
              ) : (
                <>
                  <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5, mb: '12px' }}>
                    Narrows bookings to a circle of {PILOT_RADIUS_MIN_KM} to {PILOT_RADIUS_MAX_KM} km around the terminal of one TODA. Use it while only that TODA's drivers are on SAKAY. The circle is drawn on the map as you set it.
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: 1.6, mb: 1.6, maxWidth: 640 }}>
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
                  {problem && todaId !== '' && <Typography role="status" sx={{ fontSize: FONT.small, color: PAGE_TEXT.warning, mb: '10px', lineHeight: 1.5 }}>{problem}</Typography>}
                </>
              )}
              {problemText && <Alert severity="error" role="alert" sx={{ mb: '12px', borderRadius: '10px' }}>{problemText}</Alert>}
              <Button
                variant="contained"
                disableElevation
                disabled={busy || !canApply}
                onClick={() => setConfirm(choice)}
                sx={primaryButtonSx}
              >
                {busy ? 'Applying...' : choice === 'city' ? (alreadyCity ? 'Already the whole city' : 'Use the whole of Calapan City') : 'Narrow to the pilot area'}
              </Button>
            </DashboardCard>
          </Box>

          {/* 3. Driver search: the settings that belong with the area (they used to sit at the bottom of Live Trips) */}
          <DispatchSettingsCard />

          {/* 4. Earlier settings, folded away until asked for */}
          {earlier.length > 0 && (
            <Box sx={{ mt: SPACE.gapLarge }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mb: showEarlier ? '10px' : 0 }}>
                <Box>
                  <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>Earlier settings</Typography>
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>The areas used before, newest first.</Typography>
                </Box>
                <Button onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} sx={secondaryButtonSx}>{showEarlier ? 'Hide' : `Show ${earlier.length}`}</Button>
              </Box>
              {showEarlier && (
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
              )}
            </Box>
          )}
        </>
      )}

      <SakayToast message={done} severity="success" onClose={() => setDone(null)} />
      <MacConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'city' ? 'Use the whole of Calapan City?' : 'Narrow the service area?'}
        message={
          confirm === 'city'
            ? 'Passengers anywhere in the city will be able to book. The change is written to the audit log.'
            : `From now on a booking must start AND end within ${radiusNumber ?? '?'} km of the terminal of ${chosenTerminal?.name ?? 'the TODA'}. Passengers outside it will be refused. The change is written to the audit log.`
        }
        confirmLabel={confirm === 'city' ? 'Use the whole city' : 'Narrow the area'}
        confirmVariant={confirm === 'city' ? 'orange' : 'danger'}
        onConfirm={apply}
      />
    </Box>
  );
};
