import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useInFlight } from '@sakay/shared';

import type { GpsArea } from '../../services/todaApiService';

interface GpsAreasCardProps {
  areas: GpsArea[];
  minCount: number;
  windowDays: number;
  /** Reports an area to the LGU Administrator. Resolves to null when accepted, else the database's explanation. */
  onReport: (cellKey: string, note: string) => Promise<string | null>;
}

const manila = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Rule 17.5: places where the stall or lost-connection rules cancelled bookings again and again (the same square of about 550 m) in the last 30 days.
 * Repeated determinations in one area may be GPS trouble of the place, not of the drivers: the TODA Administrator reports the area to the LGU
 * Administrator, who may adjust the service-zone boundary. This is data-quality escalation, not a penalty: nothing here touches a driver's record.
 */
export const GpsAreasCard: React.FC<GpsAreasCardProps> = ({ areas, minCount, windowDays, onReport }) => {
  const flight = useInFlight();
  const [target, setTarget] = useState<GpsArea | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (areas.length === 0) return null;

  const send = () =>
    flight.run(async () => {
      if (!target) return;
      const message = await onReport(target.cellKey, note);
      if (message) {
        setError(message);
        return;
      }
      setDone('The area was reported to the LGU Administrator.');
      setTarget(null);
    });

  return (
    <Paper elevation={0} sx={{ mb: '22px', borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', overflow: 'hidden' }}>
      <Box sx={{ p: '13px 18px', borderBottom: '1px solid var(--mac-border-color)' }}>
        <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
          Areas with repeated GPS-caused determinations
        </Typography>
        <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px', lineHeight: 1.45 }}>
          {minCount} or more stall or lost-connection cancellations (waived ones included) of your drivers in the same square of about 550 m within {windowDays} days.
          If the cause looks like weak GPS or signal in that place, report it so the LGU Administrator can consider a service-zone boundary adjustment.
        </Typography>
      </Box>
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ m: '13px', borderRadius: '8px' }}>
          {done}
        </Alert>
      )}
      {areas.map((a) => (
        <Box key={a.cellKey} sx={{ p: '11px 18px', borderTop: '1px solid var(--mac-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '13px', flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
              <a
                href={`https://www.openstreetmap.org/?mlat=${a.centerLatitude}&mlon=${a.centerLongitude}#map=16/${a.centerLatitude}/${a.centerLongitude}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2563EB' }}
              >
                Around {a.centerLatitude.toFixed(4)}, {a.centerLongitude.toFixed(4)}
              </a>{' '}
              — {a.determinations} determinations
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
              {a.stalls} stalls · {a.connectivity} lost connections · {manila(a.firstAt)} to {manila(a.lastAt)}
            </Typography>
          </Box>
          {a.reported ? (
            <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#059669' }}>Reported to the LGU</Typography>
          ) : (
            <Button
              variant="outlined"
              onClick={() => {
                setTarget(a);
                setNote('');
                setError(null);
              }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Report to LGU
            </Button>
          )}
        </Box>
      ))}

      <Dialog open={target !== null} onClose={() => setTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '13px' }}>Report this area to the LGU Administrator</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: '13px', pt: '6.5px !important' }}>
          <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-secondary)', lineHeight: 1.45 }}>
            The counts are attached by the system. Say what you have seen or heard in this area (for example a building, a barangay road, a place drivers say loses signal).
          </Typography>
          <TextField multiline minRows={3} size="small" label="What you observed" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
          {error && <Alert severity="warning" sx={{ borderRadius: '8px' }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: '13px' }}>
          <Button onClick={() => setTarget(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={flight.busy} onClick={send} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Send report
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default GpsAreasCard;
