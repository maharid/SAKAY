import React, { useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FactCheckIcon from '@mui/icons-material/FactCheck';

import { confirmPassengerFirstName } from '../../../services/bookingClockService';

interface PassengerCheckCardProps {
  bookingId: string;
  /** The passenger's registered FIRST name: all the driver is shown (Rule 11.1) */
  firstName: string;
  /** The driver has already confirmed it (the database holds boarding_verified_at) */
  verified: boolean;
  language: string;
  /** The database recorded the confirmation: the screen reads the booking again */
  onConfirmed: () => void;
  onMessage: (message: string) => void;
}

/**
 * Rules 11.1 - 11.4: before the passenger boards, the driver asks for their first name and checks it against the booking. The trip cannot start until the
 * driver has said so here (the database refuses it: ERR_VERIFY_PASSENGER). The screen cannot see who boards, so it also says what to do when it is not the
 * registered passenger: a booking of another account is not accepted unless the registered passenger is there and confirms (11.2); a wrong passenger who
 * has boarded before the trip starts is asked to get down (11.3); one found during the trip is dealt with by stopping somewhere safe and contacting the
 * passenger through the app's message or call buttons (11.4).
 */
const PassengerCheckCard: React.FC<PassengerCheckCardProps> = ({ bookingId, firstName, verified, language, onConfirmed, onMessage }) => {
  const tl = language === 'tl';
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    const result = await confirmPassengerFirstName(bookingId);
    setSaving(false);
    if (!result.ok) {
      onMessage(result.error || (tl ? 'Hindi naitala ang pagsusuri. Pakisubukang muli.' : 'The check could not be saved. Please try again.'));
      return;
    }
    onConfirmed();
  };

  const rules = tl
    ? [
        'Kung ibang account ang may-ari ng booking, ang nakarehistrong pasahero lamang ang isakay, o hilingin na kumpirmahin niya ito sa iyo.',
        'Kung may maling pasaherong nakasakay na at hindi pa nagsisimula ang biyahe, hilingin siyang bumaba muna.',
        'Kung natuklasan ito habang nasa biyahe, huminto sa ligtas na lugar at i-message o tawagan ang pasahero bago magpatuloy.',
      ]
    : [
        'If the booking belongs to another account, take only the registered passenger, or ask them to confirm it with you.',
        'If the wrong person has boarded and the trip has not started, ask them to get down first.',
        'If you find out during the trip, stop somewhere safe and message or call the passenger before you go on.',
      ];

  return (
    <Box
      sx={{
        p: '12px 14px',
        borderRadius: '14px',
        backgroundColor: verified ? '#F0FDF4' : '#FFF7ED',
        border: `1.5px solid ${verified ? '#86EFAC' : '#FDBA74'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {verified ? <CheckCircleIcon sx={{ color: '#16A34A', fontSize: 22 }} /> : <FactCheckIcon sx={{ color: '#EA580C', fontSize: 22 }} />}
        <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#475569', fontFamily: 'Poppins, sans-serif' }}>
          {tl ? 'Unang pangalan ng pasahero sa booking' : "The passenger's first name on the booking"}
        </Typography>
      </Box>
      <Typography
        sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2, fontFamily: 'Poppins, sans-serif', overflowWrap: 'anywhere' }}
      >
        {firstName}
      </Typography>

      {verified ? (
        <Typography role="status" sx={{ fontSize: '12.5px', fontWeight: 600, color: '#166534', fontFamily: 'Poppins, sans-serif' }}>
          {tl ? 'Nasuri na ang unang pangalan. Maaari nang simulan ang biyahe kapag nakasakay na ang pasahero.' : 'First name checked. You can start the trip once the passenger has boarded.'}
        </Typography>
      ) : (
        <>
          <Typography sx={{ fontSize: '12.5px', color: '#7C2D12', fontFamily: 'Poppins, sans-serif', lineHeight: 1.4 }}>
            {tl
              ? 'Itanong ang unang pangalan ng pasahero at itugma ito sa booking bago siya sumakay. Hindi mo masisimulan ang biyahe hangga\'t hindi ito nasusuri.'
              : 'Ask the passenger for their first name and make sure it matches the booking before they board. You cannot start the trip until you have checked it.'}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {rules.map((line) => (
              <Typography key={line} component="li" sx={{ fontSize: '11.5px', color: '#7C2D12', fontFamily: 'Poppins, sans-serif', lineHeight: 1.35 }}>
                {line}
              </Typography>
            ))}
          </Box>
          <Button
            variant="contained"
            fullWidth
            disabled={saving}
            onClick={confirm}
            startIcon={saving ? undefined : <CheckCircleIcon />}
            sx={{
              minHeight: 46,
              borderRadius: '12px',
              backgroundColor: '#EA580C',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'none',
              boxShadow: 'none',
              fontFamily: 'Poppins, sans-serif',
              '&:hover': { backgroundColor: '#C2410C', boxShadow: 'none' },
            }}
          >
            {saving ? <CircularProgress size={22} color="inherit" aria-label={tl ? 'Isinusulat' : 'Saving'} /> : tl ? 'Nasuri ko na ang unang pangalan' : 'I checked the first name'}
          </Button>
        </>
      )}
    </Box>
  );
};

export default PassengerCheckCard;
