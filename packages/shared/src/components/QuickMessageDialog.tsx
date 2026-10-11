import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import SendIcon from '@mui/icons-material/Send';

import { useInFlight } from '../hooks/useInFlight';
import { MAX_QUICK_MESSAGE_LENGTH, buildSmsHref } from '../utils/sms';

export interface QuickMessageDialogProps {
  open: boolean;
  onClose: () => void;
  language: string;
  /** Who the message is for ("Driver Juan", "Passenger Ana") */
  recipient: string;
  /** Their number (kept out of sight; only the SMS app needs it) */
  phone: string;
  /** Short ready-made messages, in the person's language */
  templates: string[];
  /** Shows a Call button too (the person may prefer to speak) */
  allowCall?: boolean;
  /** Opens the SMS app. Defaults to following the `sms:` link; a screen/test may supply its own. */
  launch?: (href: string) => void;
}

const FONT = 'Poppins, sans-serif';

/**
 * The quick-message sheet for both apps: a short list of ready-made messages, one tap to choose and one to send, and an "other message" box
 * for anything else. It sits at the bottom of the screen where the thumb is, never taller than the screen (the list scrolls, the Send button
 * stays in view). It opens the phone's own SMS app with the text already typed, so nothing is sent from here: the person confirms in their
 * messages. Sending is guarded: a second tap on Send, or a tap after it was taken, does nothing (one message, one SMS draft).
 */
export const QuickMessageDialog: React.FC<QuickMessageDialogProps> = ({
  open,
  onClose,
  language,
  recipient,
  phone,
  templates,
  allowCall = false,
  launch,
}) => {
  const tl = language === 'tl';
  const [choice, setChoice] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [sent, setSent] = useState(false);
  const flight = useInFlight();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh sheet each time it opens
  useEffect(() => {
    if (open) {
      setChoice('');
      setCustom('');
      setSent(false);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  const message = choice === 'custom' ? custom.trim() : choice;
  const href = buildSmsHref(phone, message);
  const noNumber = !/\d/.test(phone || '');
  const canSend = Boolean(href) && !sent && !flight.busy;

  const send = () =>
    flight.run(async () => {
      if (!href || sent) return;
      setSent(true);
      if (launch) launch(href);
      else window.location.href = href;
      closeTimer.current = setTimeout(onClose, 1200);
    });

  const call = () => {
    if (!noNumber) window.location.href = `tel:${(phone || '').replace(/[^\d+]/g, '')}`;
  };

  const optionSx = (selected: boolean) => ({
    width: '100%',
    minHeight: 48,
    px: 1.75,
    py: 1,
    borderRadius: '14px',
    justifyContent: 'space-between',
    gap: 1,
    textAlign: 'left' as const,
    border: `1.5px solid ${selected ? '#FF6600' : '#E2E8F0'}`,
    backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
    fontFamily: FONT,
    fontSize: '14px',
    fontWeight: selected ? 700 : 500,
    color: '#0F172A',
    lineHeight: 1.3,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="quick-message-title"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-end' } }}
      slotProps={{
        paper: { sx: { m: 0, width: '100%', maxWidth: 430, borderRadius: '24px 24px 0 0', maxHeight: '88%', display: 'flex', flexDirection: 'column' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2.5, pt: 2, pb: 1, flexShrink: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography id="quick-message-title" component="h2" sx={{ fontSize: '17px', fontWeight: 700, color: '#0F172A', fontFamily: FONT, lineHeight: 1.3 }}>
            {tl ? 'Mensahe' : 'Send a message'}
          </Typography>
          <Typography noWrap sx={{ fontSize: '13px', color: '#475569', fontFamily: FONT }}>
            {recipient}
          </Typography>
        </Box>
        <IconButton aria-label={tl ? 'Isara' : 'Close'} onClick={onClose} sx={{ width: 44, height: 44, flexShrink: 0 }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1 }} role="radiogroup" aria-label={tl ? 'Pumili ng mensahe' : 'Choose a message'}>
        {templates.map((text) => (
          <ButtonBase key={text} role="radio" aria-checked={choice === text} onClick={() => setChoice(text)} sx={optionSx(choice === text)}>
            <span>{text}</span>
            {choice === text && <CheckIcon aria-hidden sx={{ fontSize: 20, color: '#FF6600', flexShrink: 0 }} />}
          </ButtonBase>
        ))}
        <ButtonBase role="radio" aria-checked={choice === 'custom'} onClick={() => setChoice('custom')} sx={optionSx(choice === 'custom')}>
          <span>{tl ? 'Iba pang mensahe' : 'Other message'}</span>
          {choice === 'custom' && <CheckIcon aria-hidden sx={{ fontSize: 20, color: '#FF6600', flexShrink: 0 }} />}
        </ButtonBase>
        {choice === 'custom' && (
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            size="small"
            value={custom}
            onChange={(e) => setCustom(e.target.value.slice(0, MAX_QUICK_MESSAGE_LENGTH))}
            placeholder={tl ? 'I-type ang mensahe' : 'Type your message'}
            helperText={`${custom.length}/${MAX_QUICK_MESSAGE_LENGTH}`}
            slotProps={{ htmlInput: { 'aria-label': tl ? 'Iyong mensahe' : 'Your message', maxLength: MAX_QUICK_MESSAGE_LENGTH } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
        )}
      </Box>

      <Box sx={{ px: 2.5, pt: 1, pb: 'calc(var(--safe-area-bottom, 0px) + 16px)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1, borderTop: '1px solid #F1F5F9' }}>
        {noNumber && (
          <Typography role="alert" sx={{ fontSize: '12px', color: '#B91C1C', fontFamily: FONT }}>
            {tl ? 'Walang available na numero ng telepono para sa mensaheng ito.' : 'There is no phone number to send this message to.'}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {allowCall && (
            <Button
              variant="outlined"
              onClick={call}
              disabled={noNumber}
              startIcon={<PhoneIcon />}
              aria-label={tl ? 'Tawagan' : 'Call'}
              sx={{ minHeight: 48, px: 2, borderRadius: '14px', textTransform: 'none', fontWeight: 700, fontFamily: FONT, color: '#166534', borderColor: '#BBF7D0', flexShrink: 0 }}
            >
              {tl ? 'Tawag' : 'Call'}
            </Button>
          )}
          <Button
            variant="contained"
            fullWidth
            disabled={!canSend}
            onClick={send}
            startIcon={<SendIcon />}
            sx={{
              minHeight: 48,
              borderRadius: '14px',
              backgroundColor: '#FF6600',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '15px',
              fontFamily: FONT,
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
              '&.Mui-disabled': { backgroundColor: '#E2E8F0', color: '#64748B' },
            }}
          >
            {sent ? (tl ? 'Binubuksan ang Messages...' : 'Opening your messages...') : tl ? 'Ipadala' : 'Send'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default QuickMessageDialog;
