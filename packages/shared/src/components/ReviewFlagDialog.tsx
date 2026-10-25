import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';

import { closeProblem } from '../utils/tripCorrections';
import { isAvailabilityFlag } from '../utils/availabilityReports';
import { FLAG_TITLES, declinesSentence, eventsInWindowSentence, flagEvents, humanizeCode, manilaFull, manilaShort, shortFlagTitle, shortId } from '../utils/reviewFlagText';
import type { ReviewFlagRow } from './ReviewFlagsPanel';

export interface ReviewFlagDialogProps {
  open: boolean;
  /** the window has finished closing (the panel can let go of the flag then) */
  onExited: () => void;
  flag: ReviewFlagRow;
  /** the name of the driver the flag is about */
  driver: string;
  /** an action is being written to the database: every button waits */
  busy: boolean;
  /** what the database said when the last action was refused (shown inside the window, which stays open) */
  error: string | null;
  /** runs an action through the panel (one at a time); the panel closes the window when it worked */
  run: (task: () => Promise<string | null>, ok: string) => void;
  onClose: () => void;
  onResolve: (flagId: string, status: 'Resolved' | 'Dismissed', note: string) => Promise<string | null>;
  onConfirm: (flagId: string, bookingId: string | null, reason: string) => Promise<string | null>;
  onCloseTrip?: (bookingId: string, paymentStatus: 'Paid' | 'Waived', reason: string) => Promise<string | null>;
  onConfirmAvailability?: (flagId: string, reason: string) => Promise<string | null>;
  onViewDeclineHistory?: (driverId: string, driverName: string) => void;
}

const INK = '#1d1d1f';
const MUTED = '#4d4d52';
const LINE = 'rgba(15, 23, 42, 0.12)';

// The same look as the TODA portal's modal buttons: 36px tall, 12px text, 44px on a touch screen, a clear keyboard focus ring
const buttonSx = {
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '12px',
  minHeight: 36,
  px: '16px',
  borderRadius: '8px',
  boxShadow: 'none',
  '@media (pointer: coarse)': { minHeight: 44 },
  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' },
} as const;
const primarySx = { ...buttonSx, fontWeight: 700, backgroundColor: '#C75000', color: '#FFFFFF', '&:hover': { backgroundColor: '#A84300', boxShadow: 'none' }, '&.Mui-disabled': { backgroundColor: '#E5C0A8', color: '#FFFFFF' } } as const;

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography sx={{ fontSize: '12px', fontWeight: 700, color: MUTED, mb: '6px' }}>{children}</Typography>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: '11.5px', color: MUTED }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, fontSize: '12.5px', fontWeight: 600, color: INK, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);

/**
 * The full details of one review flag, and where the administrator reviews it (what was found, then Verified / Dismiss / confirm the strike). Everything the flag holds
 * is here; the list only shows a label, the driver, the date and one line. A part the flag does not have is left out, never filled with a placeholder.
 */
export const ReviewFlagDialog: React.FC<ReviewFlagDialogProps> = ({ open, onExited, flag: f, driver, busy, error, run, onClose, onResolve, onConfirm, onCloseTrip, onConfirmAvailability, onViewDeclineHistory }) => {
  const [note, setNote] = useState('');
  const [eventBooking, setEventBooking] = useState('');

  const d = (f.details ?? {}) as Record<string, unknown>;
  const events = flagEvents(d);
  const bookingId = typeof d.booking_id === 'string' ? d.booking_id : null;
  const confirmable = f.flag_type === 'DRIVER_SAFE_REASON_REVIEW' || (f.flag_type === 'DRIVER_EARLY_STOP_REVIEW' && d.valid_reason === false) || f.flag_type === 'DRIVER_SHARED_REQUEST_DECLINES' || f.flag_type === 'DRIVER_REPEATED_DECLINES';
  const needsEvent = f.flag_type === 'DRIVER_SAFE_REASON_REVIEW';
  const bookingForConfirm = needsEvent ? eventBooking : bookingId;
  const noteReady = note.trim().length >= 10;
  const declines = declinesSentence(d);
  const inWindow = eventsInWindowSentence(d);
  const sentence = FLAG_TITLES[f.flag_type];
  const hasDetails = Boolean(sentence || typeof d.note === 'string' || (typeof d.description === 'string' && isAvailabilityFlag(f.flag_type)) || events.length > 0 || declines || inWindow);
  const titleId = `review-flag-${f.flag_id}-title`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      slotProps={{
        transition: { onExited },
        backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.42)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' } },
        paper: { sx: { borderRadius: '18px', m: '16px', width: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)', boxShadow: '0 20px 50px rgba(15, 23, 42, 0.16), 0 8px 16px rgba(15, 23, 42, 0.08)' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', p: '16px 16px 14px 20px', borderBottom: `1px solid ${LINE}` }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={titleId} component="h2" sx={{ fontSize: '15px', fontWeight: 700, color: INK, lineHeight: 1.35, pt: '4px' }}>{shortFlagTitle(f.flag_type)}</Typography>
        </Box>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ width: 32, height: 32, flexShrink: 0, color: MUTED, '@media (pointer: coarse)': { width: 44, height: 44 }, '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' } }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: '16px 20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: '12px 16px' }}>
          <Fact label="Driver">{driver}</Fact>
          <Fact label="Status">{f.status}</Fact>
          <Fact label="Raised">{manilaFull(f.created_at)}</Fact>
          <Fact label="Rule">{f.source_rule}</Fact>
          <Fact label="Type">{humanizeCode(f.flag_type)}</Fact>
          {bookingId && <Fact label="Trip">{shortId(bookingId)}</Fact>}
        </Box>

        {hasDetails && (
          <Box>
            <SectionTitle>What was flagged</SectionTitle>
            <Box sx={{ backgroundColor: '#FAFAF8', border: `1px solid ${LINE}`, borderRadius: '8px', p: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sentence && <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: INK, lineHeight: 1.5 }}>{sentence}</Typography>}
              {typeof d.description === 'string' && isAvailabilityFlag(f.flag_type) && (
                <Typography sx={{ fontSize: '12.5px', color: INK, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                  {typeof d.reported_by === 'string' ? `Reported by ${d.reported_by.replace('_', ' ')}: ` : ''}"{d.description}"
                </Typography>
              )}
              {typeof d.note === 'string' && <Typography sx={{ fontSize: '12.5px', color: MUTED, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{d.note}</Typography>}
              {events.length > 0 && (
                <Box component="ul" sx={{ m: 0, pl: '18px', fontSize: '12.5px', color: INK, lineHeight: 1.6 }}>
                  {events.map((e, i) => (
                    <li key={`${e.booking_id}-${i}`}>
                      {manilaShort(e.at)}: {String(e.reason).replace(/_/g, ' ')} (trip {shortId(e.booking_id)})
                    </li>
                  ))}
                </Box>
              )}
              {declines && <Typography sx={{ fontSize: '12.5px', color: INK }}>{declines}</Typography>}
              {inWindow && <Typography sx={{ fontSize: '12.5px', color: INK }}>{inWindow}</Typography>}
            </Box>
            {onViewDeclineHistory && f.flag_type === 'DRIVER_REPEATED_DECLINES' && (
              <Button size="small" variant="text" onClick={() => onViewDeclineHistory(f.subject_id, driver)} sx={{ ...buttonSx, mt: '6px', ml: '-8px', color: '#B34700' }}>
                View the booking offers of this driver
              </Button>
            )}
          </Box>
        )}

        <Divider />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Box>
            <SectionTitle>Your review</SectionTitle>
            <Typography sx={{ fontSize: '12px', color: MUTED, lineHeight: 1.5 }}>
              Verify the event. If a reason was misused you can confirm the strike it was meant to avoid. Nothing here is decided by the system.
            </Typography>
          </Box>
          {needsEvent && (
            <TextField select size="small" fullWidth label="The event to confirm a strike for (only if the reason was misused)" value={eventBooking} onChange={(e) => setEventBooking(e.target.value)}>
              <MenuItem value="">No strike: choose an event only to confirm one</MenuItem>
              {events.map((e, i) => (
                <MenuItem key={`${e.booking_id}-${i}`} value={e.booking_id}>{manilaShort(e.at)}: {String(e.reason).replace(/_/g, ' ')} (trip {shortId(e.booking_id)})</MenuItem>
              ))}
            </TextField>
          )}
          <TextField size="small" multiline rows={3} fullWidth label="What you found (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <Alert severity="error" role="alert">{error}</Alert>}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: '12px 20px', borderTop: `1px solid ${LINE}`, backgroundColor: '#FAFAFC', display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: { sm: 'wrap' }, gap: '8px', justifyContent: 'flex-end', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
        <Button variant="outlined" onClick={onClose} sx={{ ...buttonSx, mr: { sm: 'auto' }, color: INK, borderColor: LINE, backgroundColor: '#FFFFFF', '&:hover': { backgroundColor: 'var(--sakay-orange-soft, #FFF1E6)', borderColor: 'var(--sakay-orange-border, #F5B98C)' } }}>
          Close
        </Button>
        <Button variant="outlined" disabled={busy || !noteReady} onClick={() => run(() => onResolve(f.flag_id, 'Dismissed', note.trim()), 'The flag was dismissed.')} sx={{ ...buttonSx, color: INK, borderColor: LINE, backgroundColor: '#FFFFFF' }}>
          Dismiss
        </Button>
        {onCloseTrip && f.flag_type === 'PAYMENT_STUCK_RECONCILIATION' && bookingId && (
          <>
            <Button variant="outlined" color="success" disabled={busy || closeProblem('Waived', note) !== null} onClick={() => run(() => onCloseTrip(bookingId, 'Waived', note.trim()), 'The trip was closed as Waived.')} sx={buttonSx}>
              Close the trip: Waived
            </Button>
            <Button variant="contained" color="success" disabled={busy || closeProblem('Paid', note) !== null} onClick={() => run(() => onCloseTrip(bookingId, 'Paid', note.trim()), 'The trip was closed as Paid.')} sx={{ ...buttonSx, fontWeight: 700 }}>
              Close the trip: Paid
            </Button>
          </>
        )}
        {onConfirmAvailability && isAvailabilityFlag(f.flag_type) && (
          <Button variant="contained" color="error" disabled={busy || !noteReady} onClick={() => run(() => onConfirmAvailability(f.flag_id, note.trim()), 'The violation was confirmed and the strike recorded.')} sx={{ ...buttonSx, fontWeight: 700 }}>
            Confirmed: record the strike
          </Button>
        )}
        {confirmable && (
          <Button variant="contained" color="error" disabled={busy || !noteReady || (needsEvent && !eventBooking)} onClick={() => run(() => onConfirm(f.flag_id, bookingForConfirm, note.trim()), 'The strike was confirmed.')} sx={{ ...buttonSx, fontWeight: 700 }}>
            Reason misused: confirm the strike
          </Button>
        )}
        <Button variant="contained" disabled={busy || !noteReady} onClick={() => run(() => onResolve(f.flag_id, 'Resolved', note.trim()), 'The flag was resolved.')} sx={primarySx}>
          Verified: no violation
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReviewFlagDialog;
