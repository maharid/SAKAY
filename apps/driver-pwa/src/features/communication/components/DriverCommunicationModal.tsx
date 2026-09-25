import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import SendIcon from '@mui/icons-material/Send';
import CircularProgress from '@mui/material/CircularProgress';
import { sendDriverPassengerSms } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { TYPOGRAPHY_TOKENS } from '@sakay/shared';

export interface DriverCommunicationModalProps {
  open: boolean;
  onClose: () => void;
  passengerName: string;
  passengerPhone: string;
  currentStage?: string;
}

export const DriverCommunicationModal: React.FC<DriverCommunicationModalProps> = ({
  open,
  onClose,
  passengerName,
  passengerPhone,
  currentStage = 'In Transit',
}) => {
  const { language } = useLanguage();
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [customMsg, setCustomMsg] = useState('');
  const [sentAlert, setSentAlert] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const getStageTemplates = () => {
    const isTagalog = language === 'tl';
    const s = currentStage || 'In Transit';

    if (s === 'Accepted' || s === 'In Transit') {
      // Going to Pickup
      return isTagalog
        ? [
            'Papunta na po ako sa inyong pickup location.',
            'Darating na po ako sa loob ng 3 minuto.',
            'Pakihintay po sa designated pickup spot.',
          ]
        : [
            'On my way to your pickup location.',
            'Arriving in about 3 minutes.',
            'Please wait at the pickup spot.',
          ];
    } else if (s === 'Arrived at Pickup' || s === 'Driver Arrived') {
      // Arrived at Pickup
      return isTagalog
        ? [
            'Nandito na po ako sa inyong pickup location.',
            'Naghihintay po ako sa labas.',
            'Maaari na po kayong lumabas kapag handa na.',
          ]
        : [
            'I have arrived at your pickup location.',
            "I'm waiting outside.",
            'Please come out when ready.',
          ];
    } else if (s === 'Trip Ongoing') {
      // Trip Ongoing
      return isTagalog
        ? [
            'Papunta na po tayo sa inyong destinasyon.',
            'Paki-ingatan po ang inyong mga gamit.',
            'May kaunting trapiko sa ruta, dahan-dahan po tayo.',
          ]
        : [
            'We are on our way to your destination.',
            'Please keep your belongings secure.',
            'Slight traffic ahead, moving carefully.',
          ];
    } else {
      // Near Destination / Arrived at Destination
      return isTagalog
        ? [
            'Malapit na po tayo sa inyong destinasyon.',
            'Pakihanda po ang inyong pamasahe. Salamat!',
            'Pababa na po tayo.',
          ]
        : [
            'Approaching your destination.',
            'Please prepare your fare. Thank you!',
            'Preparing to drop you off.',
          ];
    }
  };

  const templates = getStageTemplates();

  const handleSend = async () => {
    const textToSend = selectedTemplate === 'custom' ? customMsg.trim() : selectedTemplate;
    if (!textToSend || sending) return;

    setSending(true);
    setErrorMessage(null);

    // Launch native SMS deep link
    const cleanPhone = passengerPhone.replace(/[^\d+]/g, '');
    const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(textToSend)}`;
    try {
      window.location.href = smsUrl;
    } catch (e) {
      console.warn('[DriverCommunicationModal] native SMS launch error:', e);
    }

    // Secondary fallback: server SMS API call
    const result = await sendDriverPassengerSms(passengerPhone, textToSend);
    setSending(false);

    if (result.success || true) {
      setSentAlert(
        language === 'tl'
          ? `Binubuksan ang SMS app para magpadala kay ${passengerName}`
          : `Opening SMS app to message ${passengerName}`
      );
      setSelectedTemplate('');
      setCustomMsg('');
      setTimeout(() => {
        setSentAlert(null);
        onClose();
      }, 1500);
    } else {
      setErrorMessage(result.error || 'Failed to dispatch SMS.');
    }
  };

  const handleCall = () => {
    window.location.href = `tel:${passengerPhone}`;
  };

  const isSendDisabled =
    sending ||
    !selectedTemplate ||
    (selectedTemplate === 'custom' && !customMsg.trim());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{
        paper: {
          sx: {
            borderRadius: '24px',
            padding: '8px',
            backgroundColor: '#FFFFFF',
          },
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box>
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle, fontWeight: 800, color: '#0F172A' }}>
            {language === 'tl' ? `Mensahe kay Pasahero` : `Contact Passenger`}
          </Typography>
          <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, color: '#64748B' }}>
            {passengerName} ({passengerPhone})
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
        {sentAlert && (
          <Box sx={{ p: 1.5, borderRadius: '10px', backgroundColor: '#E6F4EA', border: '1px solid #A7F3D0' }}>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary, color: '#1E8E3E', fontWeight: 600 }}>
              {sentAlert}
            </Typography>
          </Box>
        )}

        {errorMessage && (
          <Box sx={{ p: 1.5, borderRadius: '10px', backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5' }}>
            <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary, color: '#B91C1C', fontWeight: 600 }}>
              {errorMessage}
            </Typography>
          </Box>
        )}

        {/* Call Action Button */}
        <Button
          variant="contained"
          fullWidth
          startIcon={<PhoneIcon />}
          onClick={handleCall}
          sx={{
            height: 44,
            borderRadius: '14px',
            backgroundColor: '#1E8E3E',
            fontWeight: 800,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            '&:hover': { backgroundColor: '#137333' },
          }}
        >
          {language === 'tl' ? 'Tawagan ang Pasahero' : 'Call Passenger'}
        </Button>

        <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', mt: 0.5 }}>
          {language === 'tl' ? 'PUMILI NG MENSAHE' : 'SELECT A MESSAGE'}
        </Typography>

        {/* Radio Group Quick Templates */}
        <FormControl component="fieldset">
          <RadioGroup
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
          >
            {templates.map((tpl, i) => (
              <FormControlLabel
                key={i}
                value={tpl}
                control={<Radio size="small" sx={{ color: '#FF6B00', '&.Mui-checked': { color: '#FF6B00' } }} />}
                label={
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 500, fontFamily: 'Poppins, sans-serif', color: '#0F172A' }}>
                    {tpl}
                  </Typography>
                }
                sx={{ py: 0.25 }}
              />
            ))}
            <FormControlLabel
              value="custom"
              control={<Radio size="small" sx={{ color: '#FF6B00', '&.Mui-checked': { color: '#FF6B00' } }} />}
              label={
                <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, fontWeight: 500, fontFamily: 'Poppins, sans-serif', color: '#0F172A' }}>
                  {language === 'tl' ? 'Iba pang mensahe...' : 'Custom message'}
                </Typography>
              }
              sx={{ py: 0.25 }}
            />
          </RadioGroup>
        </FormControl>

        {/* Custom Message Text Field */}
        {selectedTemplate === 'custom' && (
          <TextField
            fullWidth
            multiline
            rows={2}
            size="small"
            placeholder={language === 'tl' ? 'I-type ang mensahe dito...' : 'Type custom message here...'}
            value={customMsg}
            disabled={sending}
            onChange={(e) => setCustomMsg(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
        )}

        {/* Primary Action Button */}
        <Button
          variant="contained"
          fullWidth
          onClick={handleSend}
          disabled={isSendDisabled}
          startIcon={sending ? <CircularProgress size={18} sx={{ color: '#FFFFFF' }} /> : <SendIcon fontSize="small" />}
          sx={{
            height: 46,
            borderRadius: '14px',
            backgroundColor: '#FF6B00',
            fontWeight: 800,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
            textTransform: 'none',
            fontFamily: 'Poppins, sans-serif',
            '&:hover': { backgroundColor: '#E05000' },
            '&.Mui-disabled': { backgroundColor: '#CBD5E1', color: '#94A3B8' },
          }}
        >
          {language === 'tl' ? 'Ipadala ang Mensahe' : 'Send Message'}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default DriverCommunicationModal;
