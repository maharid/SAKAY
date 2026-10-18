import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { closeProblem } from '../utils/tripCorrections';
import { isAvailabilityFlag } from '../utils/availabilityReports';
import { INCIDENT_LOST_ITEM_UNCLAIMED_DAYS, SAFE_REASON_FLAG_COUNT, SAFE_REASON_FLAG_WINDOW_DAYS } from '../config/policyConfig';

/** A review flag as the database holds it (admin_review_flag) */
export interface ReviewFlagRow {
  flag_id: string;
  flag_type: string;
  source_rule: string;
  subject_type: string;
  subject_id: string;
  status: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ReviewFlagsPanelProps {
  flags: ReviewFlagRow[];
  /** the name of a driver by id, for the line of each flag */
  driverNames?: Record<string, string>;
  /** Resolves to null when the database accepted it, else to what the database said (shown as it is) */
  onResolve: (flagId: string, status: 'Resolved' | 'Dismissed', note: string) => Promise<string | null>;
  /** Confirms the strike the flag points at (admin_confirm_flagged_violation); the booking names the event for the flags that list several */
  onConfirm: (flagId: string, bookingId: string | null, reason: string) => Promise<string | null>;
  /**
   * PI-15: closes the trip a PAYMENT_STUCK_RECONCILIATION flag names, as Paid (the cash was received) or Waived (no fare), after the parties were contacted
   * (admin_close_unfinished_trip; it resolves the flag itself). Without it the flag can only be resolved or dismissed.
   */
  onCloseTrip?: (bookingId: string, paymentStatus: 'Paid' | 'Waived', reason: string) => Promise<string | null>;
  /**
   * Rules 5.3 / 5.7: confirms a reported queue conflict or availability violation (confirm_driver_availability_violation): the strike is recorded under the
   * administrator's name. Without it these flags can only be resolved or dismissed.
   */
  onConfirmAvailability?: (flagId: string, reason: string) => Promise<string | null>;
  showWhenEmpty?: boolean;
}

const TITLES: Record<string, string> = {
  DRIVER_SAFE_REASON_REVIEW: 'A driver cancelled or stopped for a reason that is not struck (verify it)',
  DRIVER_SAFE_REASON_PATTERN: `A driver used such reasons ${SAFE_REASON_FLAG_COUNT} times in ${SAFE_REASON_FLAG_WINDOW_DAYS} days`,
  DRIVER_EARLY_STOP_REVIEW: 'A driver ended a trip before the destination',
  DRIVER_DETENTION_TODA_REVIEW: 'A driver was detained or arrested during a trip: the TODA review (Rule 29.20)',
  DRIVER_DETENTION_LGU_REVIEW: 'A driver was detained or arrested during a trip: the LGU review (Rule 29.20)',
  DRIVER_INCAPACITATED_REVIEW: 'A driver became ill during a trip (Rule 29.22)',
  LOST_ITEM_UNCLAIMED_REVIEW: `A lost-item report has had no response for ${INCIDENT_LOST_ITEM_UNCLAIMED_DAYS} days (Rule 29.19)`,
  DRIVER_CHANGE_REFUSAL_PATTERN: 'Repeated complaints that a driver refused to give change (Rule 18.7)',
  DRIVER_REPEATED_CANCELLATIONS: 'A driver cancelled several accepted bookings (Rule 12.7)',
  DRIVER_SHARED_REQUEST_DECLINES: 'A driver declined several Shared Trip requests (Rule 14.3)',
  PAYMENT_STUCK_RECONCILIATION: 'A trip is waiting at the destination for the payment (PI-15)',
  DRIVER_QUEUE_CONFLICT_REPORT: 'A driver was reported queued at the terminal while Available in the app (Rule 5.3)',
  DRIVER_AVAILABILITY_VIOLATION_REPORT: 'A driver was reported accepting a booking while carrying other passengers (Rule 5.7)',
  TRIP_MANUAL_RECONCILIATION: 'A trip has been silent for 30 minutes (Rule 9.5)',
  DRIVER_LOW_RATING_REVIEW: 'A driver\'s average rating is under 3.00 after at least 20 completed trips: review, counselling or retraining (Rule 23.3)',
};

const manila = (iso: unknown): string => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
};

interface SafeEvent {
  booking_id: string;
  reason: string;
  at: string;
}

/**
 * The review flags waiting for the driver's TODA Administrator (Rules 13.7, 15.1 - 15.5, 29.13, 29.14, 29.19, 29.20, 29.22; decision PI-11B): nothing is struck automatically; the administrator
 * verifies the event and either closes the flag or, if the reason was misused, confirms the strike (the engine records it under the administrator's name, with the reason).
 * The LGU dashboard lists the same flags for the LGU Administrator.
 */
export const ReviewFlagsPanel: React.FC<ReviewFlagsPanelProps> = ({ flags, driverNames = {}, onResolve, onConfirm, onCloseTrip, onConfirmAvailability, showWhenEmpty = false }) => {
  const flight = useInFlight();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [eventBooking, setEventBooking] = useState('');
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  if (flags.length === 0 && !showWhenEmpty) return null;

  const run = (task: () => Promise<string | null>, ok: string) =>
    flight.run(async () => {
      const problem = await task();
      if (problem) {
        setMessage({ severity: 'error', text: problem });
        return;
      }
      setMessage({ severity: 'success', text: ok });
      setOpenId(null);
      setNote('');
      setEventBooking('');
    });

  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#0F172A', mb: 0.5 }}>Review flags ({flags.length})</Typography>
      <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5, mb: 1.5 }}>
        Events the system recorded without striking anybody. Verify each one; if a reason was misused you can confirm the strike it was meant to avoid. Nothing here is decided by the system.
      </Typography>
      {message && <Alert severity={message.severity} sx={{ mb: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {flags.map((f) => {
          const d = (f.details ?? {}) as Record<string, unknown>;
          const events = Array.isArray(d.events) ? (d.events as SafeEvent[]) : [];
          const driver = driverNames[f.subject_id] ?? (f.subject_type === 'driver' ? 'Driver' : f.subject_type);
          const confirmable = f.flag_type === 'DRIVER_SAFE_REASON_REVIEW' || (f.flag_type === 'DRIVER_EARLY_STOP_REVIEW' && d.valid_reason === false) || f.flag_type === 'DRIVER_SHARED_REQUEST_DECLINES';
          const needsEvent = f.flag_type === 'DRIVER_SAFE_REASON_REVIEW';
          const bookingForConfirm = needsEvent ? eventBooking : typeof d.booking_id === 'string' ? d.booking_id : null;
          return (
            <Box key={f.flag_id} sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label={f.flag_type.replace(/_/g, ' ')} sx={{ fontWeight: 700, fontSize: '10.5px' }} />
                <Typography sx={{ fontSize: '12px', color: '#64748B' }}>{driver} · {f.source_rule} · {manila(f.created_at)}</Typography>
              </Box>
              <Typography sx={{ fontSize: '13.5px', fontWeight: 600, color: '#0F172A', mt: 0.5 }}>{TITLES[f.flag_type] ?? f.flag_type}</Typography>
              {typeof d.description === 'string' && isAvailabilityFlag(f.flag_type) && (
                <Typography sx={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5, mt: 0.25 }}>
                  {typeof d.reported_by === 'string' ? `Reported by ${d.reported_by.replace('_', ' ')}: ` : ''}"{d.description}"
                </Typography>
              )}
              {typeof d.note === 'string' && <Typography sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.5, mt: 0.25 }}>{d.note}</Typography>}
              {events.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: '12.5px', color: '#334155' }}>
                  {events.map((e, i) => (
                    <li key={`${e.booking_id}-${i}`}>
                      {manila(e.at)}: {String(e.reason).replace(/_/g, ' ')} (trip {String(e.booking_id).slice(0, 8).toUpperCase()})
                    </li>
                  ))}
                </Box>
              )}
              {typeof d.events_in_window === 'number' && <Typography sx={{ fontSize: '12.5px', color: '#334155' }}>{d.events_in_window} events in {String(d.window_days)} days.</Typography>}
              <Box sx={{ mt: 1 }}>
                <Button size="small" variant="outlined" onClick={() => { setOpenId(openId === f.flag_id ? null : f.flag_id); setMessage(null); }} sx={{ textTransform: 'none', fontWeight: 600 }}>
                  {openId === f.flag_id ? 'Close' : 'Review'}
                </Button>
              </Box>
              {openId === f.flag_id && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.25 }}>
                  {needsEvent && (
                    <TextField select size="small" fullWidth label="The event to confirm a strike for (only if the reason was misused)" value={eventBooking} onChange={(e) => setEventBooking(e.target.value)}>
                      <MenuItem value="">No strike: choose an event only to confirm one</MenuItem>
                      {events.map((e, i) => (
                        <MenuItem key={`${e.booking_id}-${i}`} value={e.booking_id}>{manila(e.at)}: {String(e.reason).replace(/_/g, ' ')} (trip {String(e.booking_id).slice(0, 8).toUpperCase()})</MenuItem>
                      ))}
                    </TextField>
                  )}
                  <TextField size="small" multiline rows={2} fullWidth label="What you found (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained" disabled={flight.busy || note.trim().length < 10} onClick={() => void run(() => onResolve(f.flag_id, 'Resolved', note.trim()), 'The flag was resolved.')} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                      Verified: no violation
                    </Button>
                    <Button size="small" variant="outlined" disabled={flight.busy || note.trim().length < 10} onClick={() => void run(() => onResolve(f.flag_id, 'Dismissed', note.trim()), 'The flag was dismissed.')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                      Dismiss
                    </Button>
                    {onCloseTrip && f.flag_type === 'PAYMENT_STUCK_RECONCILIATION' && typeof d.booking_id === 'string' && (
                      <>
                        <Button size="small" variant="contained" color="success" disabled={flight.busy || closeProblem('Paid', note) !== null} onClick={() => void run(() => onCloseTrip(String(d.booking_id), 'Paid', note.trim()), 'The trip was closed as Paid.')} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                          Close the trip: Paid
                        </Button>
                        <Button size="small" variant="outlined" color="success" disabled={flight.busy || closeProblem('Waived', note) !== null} onClick={() => void run(() => onCloseTrip(String(d.booking_id), 'Waived', note.trim()), 'The trip was closed as Waived.')} sx={{ textTransform: 'none', fontWeight: 600 }}>
                          Close the trip: Waived
                        </Button>
                      </>
                    )}
                    {onConfirmAvailability && isAvailabilityFlag(f.flag_type) && (
                      <Button size="small" variant="contained" color="error" disabled={flight.busy || note.trim().length < 10} onClick={() => void run(() => onConfirmAvailability(f.flag_id, note.trim()), 'The violation was confirmed and the strike recorded.')} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                        Confirmed: record the strike
                      </Button>
                    )}
                    {confirmable && (
                      <Button size="small" variant="contained" color="error" disabled={flight.busy || note.trim().length < 10 || (needsEvent && !eventBooking)} onClick={() => void run(() => onConfirm(f.flag_id, bookingForConfirm, note.trim()), 'The strike was confirmed.')} sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}>
                        Reason misused: confirm the strike
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

export default ReviewFlagsPanel;
