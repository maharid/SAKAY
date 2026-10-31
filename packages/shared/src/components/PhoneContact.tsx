import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CallOutlinedIcon from '@mui/icons-material/CallOutlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';

import { formatPhoneDisplay, phoneHref } from '../utils/phoneDisplay';

export interface PhoneContactProps {
  phone: string | null | undefined;
  /** Who it is ("the passenger", "the driver"), for the buttons' accessible names */
  who: string;
}

const buttonSx = {
  height: 30,
  px: '10px',
  borderRadius: '8px',
  textTransform: 'none',
  fontSize: '12.5px',
  fontWeight: 600,
  color: '#334155',
  border: '1.5px solid #94A3B8',
  backgroundColor: '#FFFFFF',
  whiteSpace: 'nowrap',
  '@media (pointer: coarse)': { height: 40 },
  '&:hover': { backgroundColor: '#F1F5F9', borderColor: '#64748B' },
  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: 2 },
} as const;

/** A phone number the way a person reads it, with a plain Call button and a Text button (not a blue underlined link). */
export const PhoneContact: React.FC<PhoneContactProps> = ({ phone, who }) => {
  const href = phoneHref(phone);
  if (!phone || !href) {
    return <Typography sx={{ fontSize: '12px', color: '#4d4d52' }}>No number on record</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px', mt: '4px' }}>
      <Typography component="span" sx={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
        {formatPhoneDisplay(phone)}
      </Typography>
      <Box sx={{ display: 'inline-flex', gap: '6px' }}>
        <Button component="a" href={`tel:${href}`} aria-label={`Call ${who}`} startIcon={<CallOutlinedIcon sx={{ fontSize: 15 }} />} sx={buttonSx}>
          Call
        </Button>
        <Button component="a" href={`sms:${href}`} aria-label={`Text ${who}`} startIcon={<SmsOutlinedIcon sx={{ fontSize: 15 }} />} sx={buttonSx}>
          Text
        </Button>
      </Box>
    </Box>
  );
};
