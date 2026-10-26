import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import IosShareIcon from '@mui/icons-material/IosShare';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';

import {
  UrgentSafetyReportDialog,
  createTripShare,
  fetchMyTripShare,
  fileUrgentSafetyReport,
  shareMessage,
  shareUrl,
  useInFlight,
  type UrgentReportCategory,
} from '@sakay/shared';
import { supabase } from '../../../services/supabaseClient';

interface TripSafetyActionsProps {
  bookingId: string;
  language: 'tl' | 'en';
  /** a driver is on the booking and the trip is not over: only then are the two buttons offered (Rule 26.1: during an active trip) */
  active: boolean;
  /** The passenger's next step after the Urgent Safety Report (Rule 26.2): opens End Trip (Early); undefined when the trip is not in progress */
  onEndTripEarly?: () => void;
  onMessage: (text: string) => void;
}

// On a narrow phone the two buttons share one row only without their icons (the words are what matter); wider, the icons are back
const NARROW_NO_ICON = { '@media (max-width: 389px)': { '& .MuiButton-startIcon': { display: 'none' } } } as const;

// The token this phone made for the booking, so sharing again sends the SAME link (one live link per trip). Per-phone convenience only; the database holds the truth.
const tokenKey = (bookingId: string) => `sakay_trip_share_${bookingId}`;
const readToken = (bookingId: string): string | null => {
  try {
    return localStorage.getItem(tokenKey(bookingId));
  } catch {
    return null;
  }
};
const saveToken = (bookingId: string, token: string | null) => {
  try {
    if (token) localStorage.setItem(tokenKey(bookingId), token);
    else localStorage.removeItem(tokenKey(bookingId));
  } catch {
    /* private window: the link still works, sharing again makes a new one */
  }
};

/**
 * Rules 26.1 and 26.2 during an active trip: Share Live Trip (the phone's own sharing - SMS, Messenger or any app - of a link that follows the trip, which stops working by itself when the trip is over; SAKAY has no in-app emergency
 * calling or messaging) and the Urgent Safety Report (one tap; then End Trip (Early) once the vehicle has safely stopped). The database makes the link and the report; this is the screen.
 */
const TripSafetyActions: React.FC<TripSafetyActionsProps> = ({ bookingId, language, active, onEndTripEarly, onMessage }) => {
  const tl = language === 'tl';
  const shareFlight = useInFlight();
  const urgentFlight = useInFlight();
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentRouting, setSentRouting] = useState<'TODA' | 'LGU' | null>(null);
  const [urgentError, setUrgentError] = useState<string | null>(null);

  // A link that no longer works (the trip ended, or it ran out) is forgotten, so sharing again makes a new one
  const refreshShare = useCallback(async () => {
    const s = await fetchMyTripShare(supabase, bookingId);
    if (!s.active) saveToken(bookingId, null);
  }, [bookingId]);

  useEffect(() => {
    if (active) void refreshShare();
  }, [active, refreshShare]);

  if (!active) return null;

  const handleShare = () =>
    shareFlight.run(async () => {
      const made = await createTripShare(supabase, bookingId, readToken(bookingId));
      const token = typeof made.data?.token === 'string' ? made.data.token : null;
      if (!made.ok || !token) {
        onMessage(made.error ?? (tl ? 'Hindi nagawa ang link. Pakisubukang muli.' : 'The link could not be made. Please try again.'));
        return;
      }
      saveToken(bookingId, token);
      const text = shareMessage(language, { url: shareUrl(window.location.origin, token) });
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'SAKAY', text });
          return;
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') return;   // the person closed the sheet: nothing to say
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        onMessage(tl ? 'Nakopya ang link. I-paste ito sa mensahe.' : 'Link copied. Paste it into a message.');
      } catch {
        setFallbackText(text);                                               // no sharing and no clipboard: show the text to copy, with an SMS link
      }
    });

  const handleUrgent = (category: UrgentReportCategory, description: string) =>
    urgentFlight.run(async () => {
      setUrgentError(null);
      const r = await fileUrgentSafetyReport(supabase, bookingId, category, description || null);
      if (!r.ok) {
        setUrgentError(r.error ?? (tl ? 'Hindi naipadala ang ulat. Pakisubukang muli.' : 'The report could not be sent. Please try again.'));
        return;
      }
      setSentRouting(r.data?.routing === 'LGU' ? 'LGU' : 'TODA');
      setSent(true);
    });

  const closeUrgent = () => {
    setUrgentOpen(false);
    setSent(false);
    setUrgentError(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {/* each label stays on ONE line: the buttons share the row by the size of their words, and when they do not fit side by side the second one takes the next row whole */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button
          variant="outlined"
          disabled={shareFlight.busy}
          onClick={handleShare}
          startIcon={<IosShareIcon />}
          sx={{ minHeight: 44, borderRadius: '14px', textTransform: 'none', fontWeight: 700, fontSize: '13px', lineHeight: 1.2, flex: '1 1 auto', px: 1.25, whiteSpace: 'nowrap', color: '#0F172A', borderColor: '#CBD5E1', ...NARROW_NO_ICON, '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#94A3B8' } }}
        >
          {tl ? 'Ibahagi ang Biyahe' : 'Share Live Trip'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => setUrgentOpen(true)}
          startIcon={<ReportProblemIcon />}
          sx={{ minHeight: 44, borderRadius: '14px', textTransform: 'none', fontWeight: 700, fontSize: '13px', lineHeight: 1.2, flex: '1 1 auto', px: 1.25, whiteSpace: 'nowrap', color: '#B91C1C', borderColor: '#FCA5A5', ...NARROW_NO_ICON, '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#F87171' } }}
        >
          {tl ? 'Agarang Ulat sa Kaligtasan' : 'Urgent Safety Report'}
        </Button>
      </Box>

      <UrgentSafetyReportDialog
        open={urgentOpen}
        language={language}
        busy={urgentFlight.busy}
        sent={sent}
        sentRouting={sentRouting}
        error={urgentError}
        onClose={closeUrgent}
        onSubmit={handleUrgent}
        onEndTripEarly={
          onEndTripEarly
            ? () => {
                closeUrgent();
                onEndTripEarly();
              }
            : undefined
        }
      />

      <Dialog open={fallbackText !== null} onClose={() => setFallbackText(null)} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#0F172A' }}>{tl ? 'Kopyahin ang mensahe' : 'Copy the message'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#475569', mb: 1 }}>
            {tl ? 'Hindi bumukas ang pagbabahagi ng telepono mo. Kopyahin ito at ipadala sa pamilya o kaibigan mo.' : 'Your phone\'s sharing did not open. Copy this and send it to your family or friends.'}
          </Typography>
          <TextField fullWidth multiline minRows={3} value={fallbackText ?? ''} slotProps={{ input: { readOnly: true } }} onFocus={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button component="a" href={`sms:?&body=${encodeURIComponent(fallbackText ?? '')}`} variant="contained" fullWidth sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44, backgroundColor: '#FF6600', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00' } }}>
            {tl ? 'Ipadala sa SMS' : 'Send by SMS'}
          </Button>
          <Button variant="outlined" fullWidth onClick={() => setFallbackText(null)} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>
            {tl ? 'Isara' : 'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TripSafetyActions;
