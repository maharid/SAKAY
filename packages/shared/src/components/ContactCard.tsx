import React from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CallIcon from '@mui/icons-material/Call';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';

import { phoneHref } from '../utils/phoneDisplay';

export type ContactRole = 'driver' | 'passenger';

export interface ContactCardProps {
  /** Whose card it is: the card says so ("Driver" / "Passenger"), so the one is never taken for the other */
  role: ContactRole;
  language: 'en' | 'tl';
  /** The person's name; empty when nobody was assigned (a cancelled booking), and the card says so */
  name: string;
  /** Short lines under the name (the TODA, the vehicle); empty ones are left out */
  lines?: string[];
  /** The number, only when the record has one: Call and Text are drawn then and never otherwise */
  phone?: string | null;
  /** A short-lived link to the photo, when there is one */
  photoUrl?: string;
  /** What is said when there is no person ("No driver accepted this booking.") */
  emptyNote?: string;
}

const ROLE_WORDS: Record<ContactRole, { en: string; tl: string }> = {
  driver: { en: 'Driver', tl: 'Drayber' },
  passenger: { en: 'Passenger', tl: 'Pasahero' },
};

const contactSx = (bg: string, fg: string, hover: string) =>
  ({ width: 44, height: 44, backgroundColor: bg, color: fg, borderRadius: '14px', '&:hover': { backgroundColor: hover }, '&:focus-visible': { outline: `2px solid ${fg}`, outlineOffset: 2 } }) as const;

/**
 * The other person of a trip, the same card on the Passenger app (the driver) and on the Driver app (the passenger): a small tag that says which one it is, the photo or an avatar, the
 * name, a line or two, and Call and Text when the number is on the trip record. Nothing is drawn for what the record does not have.
 */
export const ContactCard: React.FC<ContactCardProps> = ({ role, language, name, lines = [], phone, photoUrl, emptyNote }) => {
  const tl = language === 'tl';
  const roleWord = tl ? ROLE_WORDS[role].tl : ROLE_WORDS[role].en;
  const roleLower = roleWord.toLowerCase();
  const person = name.trim();
  const href = phoneHref(phone);
  return (
    <Paper component="section" aria-label={roleWord} elevation={0} sx={{ backgroundColor: '#FFFFFF', border: '1px solid #E8ECF1', borderRadius: '16px', p: '14px 16px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Avatar
          src={photoUrl || undefined}
          alt={person}
          sx={{ width: 56, height: 56, flexShrink: 0, backgroundColor: person ? '#FF6600' : '#E2E8F0', color: person ? '#FFFFFF' : '#64748B', fontWeight: 700, fontSize: '22px', fontFamily: 'Poppins, sans-serif' }}
        >
          {person ? person.charAt(0).toUpperCase() : <PersonOutlinedIcon />}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#C2410C', fontFamily: 'Poppins, sans-serif', lineHeight: 1.4 }}>{roleWord}</Typography>
          {person ? (
            <>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
                {person}
              </Typography>
              {lines.filter(Boolean).map((line, i) => (
                <Typography key={i} noWrap title={line} sx={{ fontSize: i === 0 ? '12.5px' : '12px', color: i === 0 ? '#475569' : '#64748B', fontFamily: 'Poppins, sans-serif', lineHeight: 1.4 }}>
                  {line}
                </Typography>
              ))}
            </>
          ) : (
            <Typography sx={{ fontSize: '13px', color: '#64748B', fontFamily: 'Poppins, sans-serif', lineHeight: 1.4 }}>{emptyNote || (tl ? `Walang ${roleLower}.` : `No ${roleLower}.`)}</Typography>
          )}
        </Box>

        {person && href && (
          <Box sx={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <IconButton component="a" href={`tel:${href}`} aria-label={tl ? `Tawagan ang ${roleLower}` : `Call ${roleLower}`} sx={contactSx('#E6F4EA', '#166534', '#D1EBD7')}>
              <CallIcon fontSize="small" />
            </IconButton>
            <IconButton component="a" href={`sms:${href}`} aria-label={tl ? `I-text ang ${roleLower}` : `Text ${roleLower}`} sx={contactSx('#FFF1E6', '#C2410C', '#FFE6D2')}>
              <ChatBubbleIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default ContactCard;
