import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { SakayDialogTitle } from './SakayDialogTitle';

/** A trip whose driver has been silent for 30 minutes (Rule 9.5), as get_trips_needing_reconciliation() answers. */
export interface ReconciliationTrip {
  eventId: string;
  bookingId: string;
  driverId: string;
  driverName: string;
  driverPhone: string | null;
  plateNumber: string | null;
  todaName: string | null;
  passengerName: string | null;
  passengerPhone: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  estimatedFare: number | null;
  tripStartedAt: string | null;
  interruptedSince: string | null;
  lastFixLatitude: number | null;
  lastFixLongitude: number | null;
  lastFixAt: string | null;
  restoredAt: string | null;
  silentMinutes: number | null;
}

export interface ReconcileInput {
  bookingId: string;
  outcome: 'completed' | 'cancelled';
  /** A LOWER agreed fare (never higher than the system's, checked by the database); null keeps the system's fare */
  fare: number | null;
  reason: string;
  contactedDriver: boolean;
  contactedPassenger: boolean;
}

export const DELIBERATE_OFFLINE_EVIDENCE = ['pattern_review', 'passenger_report', 'admission'] as const;
export type DeliberateOfflineEvidence = (typeof DELIBERATE_OFFLINE_EVIDENCE)[number];

export interface DeliberateOfflineInput {
  driverId: string;
  bookingId: string;
  evidence: DeliberateOfflineEvidence;
  note: string;
}

export interface TripReconciliationPanelProps {
  trips: ReconciliationTrip[];
  /** Closes the trip. Resolves to null when the database accepted it, else to what the database said. */
  onReconcile: (input: ReconcileInput) => Promise<string | null>;
  /** Reports a deliberate offline (Rule 9.6) for the LGU Administrator to confirm. Omit where the viewer cannot report. */
  onReportDeliberateOffline?: (input: DeliberateOfflineInput) => Promise<string | null>;
  /** Shown when there is nothing to reconcile (the LGU page hides the panel instead: pass false) */
  showWhenEmpty?: boolean;
}

const EVIDENCE_LABELS: Record<DeliberateOfflineEvidence, string> = {
  pattern_review: 'A pattern of interruptions found on review',
  passenger_report: "A passenger's report",
  admission: "The driver's own admission",
};

const manila = (iso: string | null): string => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
};

const Phone: React.FC<{ label: string; name: string | null; phone: string | null }> = ({ label, name, phone }) => (
  <Box sx={{ minWidth: 170 }}>
    <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{name || '—'}</Typography>
    {phone ? (
      <Typography sx={{ fontSize: '13px' }}>
        <a href={`tel:${phone}`} style={{ color: '#2563EB', fontWeight: 600 }}>{phone}</a>
        {' · '}
        <a href={`sms:${phone}`} style={{ color: '#2563EB' }}>SMS</a>
      </Typography>
    ) : (
      <Typography sx={{ fontSize: '13px', color: '#94A3B8' }}>no number on record</Typography>
    )}
  </Box>
);

/**
 * Rule 9.5: the trips whose driver stayed silent for 30 minutes, waiting for the TODA Administrator (or the LGU Administrator) to phone or text both
 * parties and close them. The administrator records who was reached and what was agreed; the database writes the outcome, keeps the fare no higher
 * than the system's (a lower agreed amount goes to the fare ledger) and audits everything. The same list lets the TODA Administrator report a driver
 * who went offline on purpose (Rule 9.6): the report goes to the LGU Administrator, who confirms it.
 * Used by the TODA and LGU portals (the data and the actions are theirs; this is only the screen).
 */
export const TripReconciliationPanel: React.FC<TripReconciliationPanelProps> = ({ trips, onReconcile, onReportDeliberateOffline, showWhenEmpty = true }) => {
  const flight = useInFlight();
  const [closing, setClosing] = useState<ReconciliationTrip | null>(null);
  const [reporting, setReporting] = useState<ReconciliationTrip | null>(null);
  const [outcome, setOutcome] = useState<'completed' | 'cancelled'>('completed');
  const [fare, setFare] = useState('');
  const [reason, setReason] = useState('');
  const [contactedDriver, setContactedDriver] = useState(false);
  const [contactedPassenger, setContactedPassenger] = useState(false);
  const [evidence, setEvidence] = useState<DeliberateOfflineEvidence>('passenger_report');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (trips.length === 0 && !showWhenEmpty) return null;

  const openClose = (t: ReconciliationTrip) => {
    setClosing(t);
    setOutcome('completed');
    setFare('');
    setReason('');
    setContactedDriver(false);
    setContactedPassenger(false);
    setError(null);
  };
  const openReport = (t: ReconciliationTrip) => {
    setReporting(t);
    setEvidence('passenger_report');
    setNote('');
    setError(null);
  };

  const submitClose = () =>
    flight.run(async () => {
      if (!closing) return;
      const agreed = fare.trim() === '' ? null : Number(fare);
      if (agreed !== null && (!Number.isFinite(agreed) || agreed < 0)) {
        setError('The agreed fare must be a number.');
        return;
      }
      const message = await onReconcile({
        bookingId: closing.bookingId,
        outcome,
        fare: outcome === 'completed' ? agreed : null,
        reason,
        contactedDriver,
        contactedPassenger,
      });
      if (message) {
        setError(message);
        return;
      }
      setDone('The trip was closed and both parties were told.');
      setClosing(null);
    });

  const submitReport = () =>
    flight.run(async () => {
      if (!reporting || !onReportDeliberateOffline) return;
      const message = await onReportDeliberateOffline({ driverId: reporting.driverId, bookingId: reporting.bookingId, evidence, note });
      if (message) {
        setError(message);
        return;
      }
      setDone('The report was sent to the LGU Administrator, who confirms or dismisses it.');
      setReporting(null);
    });

  return (
    <Paper elevation={0} sx={{ mb: 3, borderRadius: '16px', border: '1px solid #FCD34D', backgroundColor: '#FFFBEB', overflow: 'hidden' }}>
      <Box sx={{ p: '16px 20px', borderBottom: '1px solid #FDE68A' }}>
        <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#92400E' }}>
          Trips waiting for manual reconciliation ({trips.length})
        </Typography>
        <Typography sx={{ fontSize: '12.5px', color: '#78350F', mt: 0.5, lineHeight: 1.45 }}>
          The driver of each trip below has sent no location for 30 minutes while the passenger was on board, so the system did not cancel it. Phone or text
          both parties, confirm what happened and the fare, then close the trip here. The booking stays open (and the passenger cannot book again) until you do.
        </Typography>
      </Box>

      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ m: 2, borderRadius: '10px' }}>
          {done}
        </Alert>
      )}

      {trips.length === 0 ? (
        <Typography sx={{ p: 3, fontSize: '13px', color: '#78350F' }}>No trip is waiting for reconciliation.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {trips.map((t) => (
            <Box key={t.eventId} sx={{ p: '16px 20px', borderTop: '1px solid #FEF3C7', display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start', backgroundColor: '#FFFFFF' }}>
              <Phone label="Driver" name={t.driverName} phone={t.driverPhone} />
              <Phone label="Passenger" name={t.passengerName} phone={t.passengerPhone} />
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Trip</Typography>
                <Typography sx={{ fontSize: '13px', color: '#0F172A' }}>{t.pickupAddress || 'Pickup'} → {t.dropoffAddress || 'Destination'}</Typography>
                <Typography sx={{ fontSize: '12px', color: '#475569' }}>
                  {t.plateNumber ? `${t.plateNumber} · ` : ''}{t.todaName ? `${t.todaName} · ` : ''}Started {manila(t.tripStartedAt)}
                  {t.estimatedFare !== null ? ` · Estimated fare ₱${Number(t.estimatedFare).toFixed(2)}` : ''}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: '#B45309', fontWeight: 600 }}>
                  Silent since {manila(t.interruptedSince)}
                  {t.silentMinutes !== null ? ` (about ${t.silentMinutes} min without a location)` : t.restoredAt ? ` — the driver reconnected at ${manila(t.restoredAt)} but has not finished the trip` : ''}
                </Typography>
                {t.lastFixLatitude !== null && t.lastFixLongitude !== null && (
                  <Typography sx={{ fontSize: '12px' }}>
                    Last confirmed position ({manila(t.lastFixAt)}):{' '}
                    <a href={`https://www.openstreetmap.org/?mlat=${t.lastFixLatitude}&mlon=${t.lastFixLongitude}#map=17/${t.lastFixLatitude}/${t.lastFixLongitude}`} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}>
                      {Number(t.lastFixLatitude).toFixed(5)}, {Number(t.lastFixLongitude).toFixed(5)}
                    </a>
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button variant="contained" onClick={() => openClose(t)} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#B45309', '&:hover': { backgroundColor: '#92400E' } }}>
                  Close trip
                </Button>
                {onReportDeliberateOffline && (
                  <Button variant="outlined" color="error" onClick={() => openReport(t)} sx={{ textTransform: 'none', fontWeight: 600 }}>
                    Report deliberate offline
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={closing !== null} onClose={() => setClosing(null)} maxWidth="sm" fullWidth>
        <SakayDialogTitle onClose={() => setClosing(null)} sx={{ fontWeight: 700, fontSize: '16px' }}>Close the trip after contacting the parties</SakayDialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField select size="small" label="What happened to the trip" value={outcome} onChange={(e) => setOutcome(e.target.value as 'completed' | 'cancelled')} fullWidth>
            <MenuItem value="completed">The trip was completed</MenuItem>
            <MenuItem value="cancelled">The trip did not happen / was not completed (cancel, no fare)</MenuItem>
          </TextField>
          {outcome === 'completed' && (
            <TextField
              size="small"
              type="number"
              label="Agreed fare (optional)"
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              helperText={`Leave empty to keep the system's fare${closing?.estimatedFare != null ? ` (estimated ₱${Number(closing.estimatedFare).toFixed(2)})` : ''}. A lower agreed amount is allowed with the reason below; never a higher one, and never below the tariff's base fare.`}
              fullWidth
            />
          )}
          <Box>
            <FormControlLabel control={<Checkbox checked={contactedDriver} onChange={(e) => setContactedDriver(e.target.checked)} />} label="I reached the driver" />
            <FormControlLabel control={<Checkbox checked={contactedPassenger} onChange={(e) => setContactedPassenger(e.target.checked)} />} label="I reached the passenger" />
          </Box>
          <TextField
            multiline
            minRows={3}
            size="small"
            label="How the outcome and fare were confirmed"
            placeholder="Who you spoke to, when, and what each of them said."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
          />
          {error && <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setClosing(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={flight.busy} onClick={submitClose} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#B45309', '&:hover': { backgroundColor: '#92400E' } }}>
            Close trip
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reporting !== null} onClose={() => setReporting(null)} maxWidth="sm" fullWidth>
        <SakayDialogTitle onClose={() => setReporting(null)} sx={{ fontWeight: 700, fontSize: '16px' }}>Report a deliberate offline</SakayDialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
            Only when there is evidence that {reporting?.driverName} switched off on purpose to avoid completing a booking. The LGU Administrator confirms the
            report (2 strikes, with no appeal) or dismisses it. The driver&apos;s recent interruptions are attached to the report automatically.
          </Typography>
          <TextField select size="small" label="Evidence" value={evidence} onChange={(e) => setEvidence(e.target.value as DeliberateOfflineEvidence)} fullWidth>
            {DELIBERATE_OFFLINE_EVIDENCE.map((e) => (
              <MenuItem key={e} value={e}>{EVIDENCE_LABELS[e]}</MenuItem>
            ))}
          </TextField>
          <TextField multiline minRows={3} size="small" label="Describe the evidence" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
          {error && <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setReporting(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" color="error" disabled={flight.busy} onClick={submitReport} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Send report to the LGU
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default TripReconciliationPanel;
