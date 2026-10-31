import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';

import { describeIncidentPlace } from '../utils/incidentPlace';
import { incidentClocks, incidentStateWords, type IncidentRecord } from '../utils/incidentReview';
import { PhoneContact } from './PhoneContact';

export interface IncidentFactsProps {
  record: IncidentRecord;
  reporter: { role: string; name: string };
  passenger?: { name?: string; phone?: string | null };
  driver?: { name?: string; phone?: string | null; plate?: string };
  todaName?: string;
  /** "Pickup > Destination" of the trip */
  route?: string;
  evidence: { name: string; url: string }[];
  /** Opens the evidence photo viewer at this photo */
  onOpenEvidence?: (index: number) => void;
}

const PRIORITY: Record<string, { bg: string; fg: string; word: string }> = {
  Serious: { bg: '#FEE2E2', fg: '#991B1B', word: 'Serious' },
  Emergency: { bg: '#FFEDD5', fg: '#9A3412', word: 'Emergency' },
  Standard: { bg: '#F1F5F9', fg: '#334155', word: 'Standard' },
};

const manila = (iso: string | null | undefined): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

const card = { p: '12px 14px', borderRadius: '12px', border: '1px solid rgba(15, 23, 42, 0.12)', backgroundColor: '#FAFAF8' } as const;
const label = { fontSize: '11.5px', fontWeight: 700, color: '#4d4d52', textTransform: 'uppercase', letterSpacing: '0.04em', mb: '4px' } as const;

const Cell: React.FC<{ name: string; children: React.ReactNode }> = ({ name, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#4d4d52', mb: '2px' }}>{name}</Typography>
    <Box sx={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f', overflowWrap: 'anywhere' }}>{children}</Box>
  </Box>
);

/**
 * What an administrator reads first about an incident report, in the same order in the TODA and the LGU portal: the severity, the state, when it was filed, who holds it and when it is
 * due; what was reported; where the vehicle was (a place name, the coordinates only as supporting detail); the people on the trip with a Call / Text action; the evidence.
 */
export const IncidentFacts: React.FC<IncidentFactsProps> = ({ record, reporter, passenger, driver, todaName, route, evidence, onOpenEvidence }) => {
  const clocks = incidentClocks(record);
  const words = incidentStateWords(record, todaName);
  const sev = PRIORITY[record.priority] ?? PRIORITY.Standard;
  const lat = record.incident_latitude;
  const lng = record.incident_longitude;
  const [place, setPlace] = useState<string | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);

  useEffect(() => {
    setPlace(null);
    if (lat === null || lng === null) return;
    const controller = new AbortController();
    setPlaceLoading(true);
    void describeIncidentPlace(lat, lng, controller.signal)
      .then((label) => {
        if (!controller.signal.aborted) setPlace(label);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlaceLoading(false);
      });
    return () => controller.abort();
  }, [lat, lng]);

  const dueText = record.outcome !== null || record.status === 'Cancelled'
    ? 'Closed'
    : clocks.nextDue
    ? `${record.first_action_at === null ? 'First action' : 'Decision'} due ${manila(clocks.nextDue)}`
    : 'No deadline set';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box sx={{ ...card, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: '12px 16px' }}>
        <Cell name="Severity">
          <Chip size="small" label={sev.word} sx={{ fontWeight: 700, height: 22, backgroundColor: sev.bg, color: sev.fg }} />
        </Cell>
        <Cell name="Status">
          <Box component="span">{words.state}</Box>
          {clocks.overdue && (
            <Chip size="small" label={clocks.firstActionOverdue ? 'First action overdue' : 'Decision overdue'} sx={{ ml: '6px', height: 20, fontWeight: 700, backgroundColor: '#FEE2E2', color: '#991B1B' }} />
          )}
        </Cell>
        <Cell name="Submitted">{manila(record.created_at)}</Cell>
        <Cell name="Who holds it">{words.holder}</Cell>
        <Cell name="Time limit">{dueText}</Cell>
        <Cell name="Reported by">{reporter.role}{reporter.name ? ` (${reporter.name})` : ''}</Cell>
      </Box>

      <Box sx={card}>
        <Typography sx={label}>What was reported</Typography>
        <Typography sx={{ fontSize: '13px', color: '#1d1d1f', lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{record.description || 'No detailed description was provided.'}</Typography>
      </Box>

      {(lat !== null && lng !== null) || route ? (
        <Box sx={card}>
          <Typography sx={label}>Where</Typography>
          {lat !== null && lng !== null && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <PlaceOutlinedIcon aria-hidden sx={{ color: '#B34700', fontSize: 20, mt: '1px' }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f', overflowWrap: 'anywhere' }}>
                  {place ? `Vehicle near ${place}` : placeLoading ? 'Looking up the place...' : 'The place name could not be looked up'}
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: '#4d4d52', mt: '2px' }}>
                  Position when the report was filed: {lat.toFixed(5)}, {lng.toFixed(5)} ·{' '}
                  <Box component="a" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noreferrer" sx={{ color: '#B34700', fontWeight: 600 }}>
                    Open the map
                  </Box>
                </Typography>
              </Box>
            </Box>
          )}
          {route && (
            <Typography sx={{ fontSize: '12.5px', color: '#334155', mt: lat !== null ? '8px' : 0, overflowWrap: 'anywhere' }}>
              <b>Trip:</b> {route}
            </Typography>
          )}
        </Box>
      ) : null}

      <Box sx={{ ...card, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '14px 20px' }}>
        <Box>
          <Typography sx={label}>Passenger</Typography>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f' }}>{passenger?.name || 'Not recorded'}</Typography>
          <PhoneContact phone={passenger?.phone} who="the passenger" />
        </Box>
        <Box>
          <Typography sx={label}>Driver{driver?.plate ? ` (${driver.plate})` : ''}</Typography>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f' }}>{driver?.name || 'Not recorded'}</Typography>
          <PhoneContact phone={driver?.phone} who="the driver" />
        </Box>
      </Box>

      <Box sx={card}>
        <Typography sx={label}>Evidence ({evidence.length})</Typography>
        {evidence.length === 0 ? (
          <Typography sx={{ fontSize: '12.5px', color: '#4d4d52' }}>No photo was attached to this report.</Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {evidence.map((file, index) => (
              <Box
                key={file.url}
                component="button"
                type="button"
                onClick={() => onOpenEvidence?.(index)}
                aria-label={`Open photo ${index + 1}: ${file.name}`}
                sx={{ p: 0, border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', lineHeight: 0, backgroundColor: '#FFFFFF', '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: 2 } }}
              >
                <Box component="img" src={file.url} alt="" sx={{ width: 96, height: 96, objectFit: 'cover', display: 'block' }} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};
