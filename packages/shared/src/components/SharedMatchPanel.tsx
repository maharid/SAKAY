import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';

import { describeOtherParty, type SharedLanguage, type SharedMatchView } from '../utils/sharedMatch';

export interface SharedMatchPanelProps {
  view: SharedMatchView | null;
  language: SharedLanguage;
  /** Whole seconds left to answer (the first passenger's consent) */
  secondsLeft: number | null;
  /** An answer is being saved: both buttons wait */
  busy?: boolean;
  /** The error of the last answer, in the database's words */
  errorMessage?: string | null;
  /** Accept Shared Match (true) or Decline Shared Match (false); the screen calls respondSharedMatch and then refreshes */
  onRespond: (accept: boolean) => void;
}

const FONT = 'Poppins, sans-serif';
const INK = '#0F172A';
const MUTED = '#475569';

const TEXT = {
  en: {
    consentTitle: 'Share this ride?',
    consentLead: 'Another Mobile-Verified passenger can share your ride. This is who they are (no names or addresses are shared):',
    consentFree: 'Declining is free. Your trip stays a Solo trip and you pay the Solo fare you accepted when you booked. Nobody is struck either way.',
    consentConcern: 'Report Concern is only for safety incidents, misconduct or rule violations; it is not how you answer this.',
    accept: 'Accept Shared Match',
    decline: 'Decline Shared Match',
    seconds: (n: number) => `${n} s left to answer`,
    noAnswer: 'No answer counts as Decline.',
    proposedTitle: 'A shared ride is being arranged',
    proposedBody: 'A driver already on a trip nearby is being asked to take you. Your search carries on if they cannot.',
    waitingFirstTitle: 'Waiting for the passenger on board',
    waitingFirstBody: 'A driver can take you. The passenger already riding must agree to share first.',
    matchedTitle: 'Shared ride confirmed',
    matchedFirstBody: 'Another passenger will share this ride. The driver picks them up on the way.',
    matchedSecondBody: 'You are sharing this ride. The driver is on the way.',
    otherLabel: 'The other passenger',
    driverLabel: 'Driver',
    vehicleLabel: 'Tricycle',
    plateLabel: 'Plate',
  },
  tl: {
    consentTitle: 'Papayagan bang may kasabay?',
    consentLead: 'May isa pang Mobile-Verified na pasaherong puwedeng sumabay sa biyahe mo. Ito ang kaunting detalye (walang pangalan o address):',
    consentFree: 'Libre ang tumanggi. Mananatiling Solo ang biyahe mo at ang Solo fare na pinayagan mo sa pag-book ang babayaran. Walang parusa kahit alin ang piliin.',
    consentConcern: 'Ang Report Concern ay para lamang sa mga insidente sa kaligtasan, maling asal o paglabag; hindi ito ang sagot dito.',
    accept: 'Tanggapin ang Shared Match',
    decline: 'Tanggihan ang Shared Match',
    seconds: (n: number) => `${n} segundo pa para sumagot`,
    noAnswer: 'Ang hindi pagsagot ay ibibilang na pagtanggi.',
    proposedTitle: 'Inaayos ang shared ride',
    proposedBody: 'Tinatanong ang drayber na may biyahe na sa malapit kung puwede ka niyang isakay. Tuloy ang paghahanap kung hindi siya puwede.',
    waitingFirstTitle: 'Hinihintay ang pasaherong nakasakay',
    waitingFirstBody: 'May drayber na puwedeng kumuha sa iyo. Kailangang pumayag muna ang pasaherong nakasakay na.',
    matchedTitle: 'Kumpirmado ang shared ride',
    matchedFirstBody: 'May isa pang pasaherong sasabay sa biyaheng ito. Susunduin sila ng drayber sa daan.',
    matchedSecondBody: 'Kasabay mo ang ibang pasahero sa biyaheng ito. Papunta na ang drayber.',
    otherLabel: 'Ang kasabay',
    driverLabel: 'Drayber',
    vehicleLabel: 'Tricycle',
    plateLabel: 'Plaka',
  },
} as const;

const Facts: React.FC<{ view: SharedMatchView; language: SharedLanguage; showDriver: boolean }> = ({ view, language, showDriver }) => {
  const t = TEXT[language];
  if (!view.other) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography sx={{ fontSize: '13px', color: MUTED, fontFamily: FONT, lineHeight: 1.5 }}>
        <strong>{t.otherLabel}:</strong> {describeOtherParty(view.other, language)}
      </Typography>
      {showDriver && view.driver && (
        <Typography sx={{ fontSize: '13px', color: MUTED, fontFamily: FONT, lineHeight: 1.5 }}>
          <strong>{t.driverLabel}:</strong> {view.driver.name} · {view.driver.vehicle}
          {view.driver.plateNumber ? ` · ${t.plateLabel} ${view.driver.plateNumber}` : ''}
        </Typography>
      )}
    </Box>
  );
};

/**
 * What a passenger sees of ride-sharing (Rules 14.2.1, 14.5): the first passenger's Accept Shared Match / Decline Shared Match, and the limited facts about the
 * other passenger (Mobile-Verified status, party size, approximate pickup area, general destination direction, and the driver's name, vehicle details and plate
 * number). The view comes from get_shared_match_state, which answers nothing else, so this panel cannot show a name, a phone number or an address.
 * Report Concern is deliberately nowhere near these buttons: it is not a consent mechanism (Rule 14.5).
 */
const SharedMatchPanel: React.FC<SharedMatchPanelProps> = ({ view, language, secondsLeft, busy = false, errorMessage, onRespond }) => {
  if (!view) return null;
  const t = TEXT[language];

  if (view.state === 'awaiting_my_consent') {
    return (
      <Dialog open fullWidth maxWidth="xs" aria-labelledby="shared-match-title" slotProps={{ paper: { sx: { borderRadius: '20px', m: 2 } } }}>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 2.5 }}>
          <Typography id="shared-match-title" sx={{ fontSize: '18px', fontWeight: 700, color: INK, fontFamily: FONT }}>
            {t.consentTitle}
          </Typography>
          <Typography sx={{ fontSize: '14px', color: MUTED, fontFamily: FONT, lineHeight: 1.5 }}>{t.consentLead}</Typography>
          <Box sx={{ p: 1.5, borderRadius: '14px', backgroundColor: '#F1F5F9' }}>
            <Facts view={view} language={language} showDriver={false} />
          </Box>
          <Typography sx={{ fontSize: '13px', color: MUTED, fontFamily: FONT, lineHeight: 1.5 }}>{t.consentFree}</Typography>
          <Typography sx={{ fontSize: '12px', color: '#64748B', fontFamily: FONT, lineHeight: 1.5 }}>{t.consentConcern}</Typography>
          {secondsLeft !== null && (
            <Typography role="timer" aria-live="off" sx={{ fontSize: '13px', fontWeight: 600, color: '#B45309', fontFamily: FONT }}>
              {t.seconds(secondsLeft)} · {t.noAnswer}
            </Typography>
          )}
          {errorMessage && (
            <Typography role="alert" sx={{ fontSize: '13px', color: '#B91C1C', fontFamily: FONT }}>
              {errorMessage}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
            <Button
              variant="outlined"
              fullWidth
              disabled={busy}
              onClick={() => onRespond(false)}
              sx={{ minHeight: 52, borderRadius: '16px', textTransform: 'none', fontWeight: 600, fontSize: '14px', fontFamily: FONT, color: '#334155', borderColor: '#CBD5E1' }}
            >
              {t.decline}
            </Button>
            <Button
              variant="contained"
              fullWidth
              disabled={busy}
              onClick={() => onRespond(true)}
              sx={{ minHeight: 52, borderRadius: '16px', backgroundColor: '#FF6600', textTransform: 'none', fontWeight: 700, fontSize: '14px', fontFamily: FONT, boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}
            >
              {t.accept}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  const card = (title: string, body: string, facts: boolean, showDriver: boolean) => (
    <Box role="status" aria-live="polite" sx={{ p: 1.5, borderRadius: '16px', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#047857', fontFamily: FONT }}>{title}</Typography>
      <Typography sx={{ fontSize: '13px', color: '#065F46', fontFamily: FONT, lineHeight: 1.5 }}>{body}</Typography>
      {facts && <Facts view={view} language={language} showDriver={showDriver} />}
    </Box>
  );
  if (view.state === 'proposed') return card(t.proposedTitle, t.proposedBody, false, false);
  if (view.state === 'awaiting_first_passenger') return card(t.waitingFirstTitle, t.waitingFirstBody, true, true);
  if (view.state === 'matched') return card(t.matchedTitle, view.role === 'first' ? t.matchedFirstBody : t.matchedSecondBody, true, view.role === 'second');
  return null;
};

export default SharedMatchPanel;
