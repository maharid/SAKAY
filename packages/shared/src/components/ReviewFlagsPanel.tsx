import React, { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import { useInFlight } from '../hooks/useInFlight';
import { flagSummary, manilaShort, shortFlagTitle } from '../utils/reviewFlagText';
import { ReviewFlagDialog } from './ReviewFlagDialog';

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
  /** Rule 7.9: opens the booking-offer history of the driver a DRIVER_REPEATED_DECLINES flag is about (the reasons and the pattern to weigh before confirming) */
  onViewDeclineHistory?: (driverId: string, driverName: string) => void;
  showWhenEmpty?: boolean;
}

/**
 * The review flags waiting for the driver's TODA Administrator (Rules 13.7, 15.1 - 15.5, 29.13, 29.14, 29.19, 29.20, 29.22; decision PI-11B): nothing is struck automatically; the administrator
 * verifies the event and either closes the flag or, if the reason was misused, confirms the strike (the engine records it under the administrator's name, with the reason).
 * The list shows one short line per flag (what, who, when, one figure); "See Details" opens the window with everything the flag holds and the review itself.
 */
export const ReviewFlagsPanel: React.FC<ReviewFlagsPanelProps> = ({ flags, driverNames = {}, onResolve, onConfirm, onCloseTrip, onConfirmAvailability, onViewDeclineHistory, showWhenEmpty = false }) => {
  const flight = useInFlight();
  // the flag whose window is mounted (it stays mounted until the window has finished closing, so the focus goes back to the button that opened it) and whether it is open
  const [shown, setShown] = useState<ReviewFlagRow | null>(null);
  const [open, setOpen] = useState(false);
  // the button that opened the window: the focus goes back to it when the window has closed (a flag that was resolved has no button any more)
  const opener = useRef<HTMLElement | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  if (flags.length === 0 && !showWhenEmpty) return null;

  const driverOf = (f: ReviewFlagRow): string => driverNames[f.subject_id] ?? (f.subject_type === 'driver' ? 'Driver' : f.subject_type);
  const openFlag = shown ? flags.find((f) => f.flag_id === shown.flag_id) ?? shown : null;

  // An action that was refused keeps the window open with the reason inside it; one that worked closes it and says so above the list
  const run = (task: () => Promise<string | null>, ok: string) =>
    void flight.run(async () => {
      const problem = await task();
      if (problem) {
        setDialogError(problem);
        return;
      }
      setMessage({ severity: 'success', text: ok });
      setDialogError(null);
      setOpen(false);
    });

  const closeDialog = () => {
    setOpen(false);
    setDialogError(null);
  };

  return (
    <Paper elevation={0} sx={{ p: 2.5, mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
      <Typography component="h2" sx={{ fontWeight: 700, fontSize: '15px', color: '#1d1d1f', mb: '2px' }}>Review flags ({flags.length})</Typography>
      <Typography sx={{ fontSize: '12px', color: '#4d4d52', lineHeight: 1.5, mb: 1.5 }}>
        Events recorded without a strike. Open each one to verify it.
      </Typography>
      {message && <Alert severity={message.severity} sx={{ mb: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {flags.map((f) => {
          const summary = flagSummary((f.details ?? {}) as Record<string, unknown>);
          const label = shortFlagTitle(f.flag_type);
          return (
            <Box
              component="li"
              key={f.flag_id}
              sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', gap: '10px 16px', p: '12px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f', lineHeight: 1.35 }}>{label}</Typography>
                  <Box component="span" sx={{ fontSize: '11px', fontWeight: 600, color: '#4d4d52', backgroundColor: '#F1F5F9', borderRadius: '999px', px: '8px', py: '1px', lineHeight: 1.6, whiteSpace: 'nowrap' }}>
                    {f.status}
                  </Box>
                </Box>
                <Typography sx={{ fontSize: '12px', color: '#4d4d52', mt: '2px', overflowWrap: 'anywhere' }}>
                  {driverOf(f)} · {manilaShort(f.created_at)}
                  {summary ? ` · ${summary}` : ''}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setShown(f);
                  setOpen(true);
                  setDialogError(null);
                  setMessage(null);
                }}
                aria-label={`See details: ${label}, ${driverOf(f)}`}
                sx={{
                  flexShrink: 0,
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '12px',
                  minHeight: 36,
                  px: '16px',
                  borderRadius: '8px',
                  color: '#1d1d1f',
                  borderColor: 'rgba(15, 23, 42, 0.12)',
                  backgroundColor: '#FFFFFF',
                  boxShadow: 'none',
                  '@media (pointer: coarse)': { minHeight: 44 },
                  '&:hover': { backgroundColor: 'var(--sakay-orange-soft, #FFF1E6)', borderColor: 'var(--sakay-orange-border, #F5B98C)' },
                  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' },
                }}
              >
                See Details
              </Button>
            </Box>
          );
        })}
      </Box>

      {openFlag && (
        <ReviewFlagDialog
          key={openFlag.flag_id}
          open={open}
          onExited={() => {
            setShown(null);
            if (opener.current?.isConnected) opener.current.focus();
            opener.current = null;
          }}
          flag={openFlag}
          driver={driverOf(openFlag)}
          busy={flight.busy}
          error={dialogError}
          run={run}
          onClose={closeDialog}
          onResolve={onResolve}
          onConfirm={onConfirm}
          onCloseTrip={onCloseTrip}
          onConfirmAvailability={onConfirmAvailability}
          onViewDeclineHistory={onViewDeclineHistory}
        />
      )}
    </Paper>
  );
};

export default ReviewFlagsPanel;
