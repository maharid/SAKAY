import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { URGENT_REPORT_OPTIONS, type UrgentReportCategory } from '../utils/tripSafety';

export interface UrgentSafetyReportDialogProps {
  open: boolean;
  language: 'en' | 'tl';
  busy: boolean;
  /** The report was accepted by the database: the dialog says what happens next */
  sent: boolean;
  /** Where the accepted report went (Rule 19.8: a threat or an assault goes straight to the LGU Administrator) */
  sentRouting?: 'TODA' | 'LGU' | null;
  /** What the database said when it refused (shown as it is) */
  error?: string | null;
  onClose: () => void;
  onSubmit: (category: UrgentReportCategory, description: string) => void;
  /** The passenger's next step once the vehicle has safely stopped (Rule 26.2): opens End Trip (Early). Not offered to the driver. */
  onEndTripEarly?: () => void;
}

/**
 * Rule 26.2: the Urgent Safety Report. One tap during a trip; nobody has to type while in danger. The database decides where it goes (the driver's TODA Administrator,
 * or straight to the LGU Administrator for a threat or an assault) and how fast it must be looked at. When the passenger wants to end the trip, the report comes first,
 * then End Trip (Early) once the vehicle has safely stopped; this dialog offers that next step. SAKAY has no in-app emergency calling or messaging (Rule 26.1): for
 * immediate danger the person uses the phone's own dialer.
 */
export const UrgentSafetyReportDialog: React.FC<UrgentSafetyReportDialogProps> = ({ open, language, busy, sent, sentRouting, error, onClose, onSubmit, onEndTripEarly }) => {
  const tl = language === 'tl';
  const [category, setCategory] = useState<UrgentReportCategory>('Safety Concern');
  const [text, setText] = useState('');

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', color: '#B91C1C' }}>{tl ? 'Agarang Ulat sa Kaligtasan' : 'Urgent Safety Report'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {sent ? (
          <>
            <Typography role="status" sx={{ fontSize: '14px', color: '#0F172A', lineHeight: 1.5, fontWeight: 600 }}>
              {tl ? 'Naipadala na ang iyong ulat.' : 'Your report was sent.'}
            </Typography>
            <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
              {sentRouting === 'LGU'
                ? tl ? 'Diretso ito sa LGU Administrator para sa agarang pagsusuri.' : 'It went straight to the LGU Administrator for an immediate review.'
                : tl ? 'Susuriin ito nang madalian ng TODA Administrator ng drayber.' : 'The driver\'s TODA Administrator will review it as a priority.'}
            </Typography>
            {onEndTripEarly && (
              <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                {tl
                  ? 'Kung gusto mong tapusin ang biyahe, hilingin sa drayber na huminto sa ligtas na lugar, saka pindutin ang End Trip (Early).'
                  : 'If you want to end the trip, ask the driver to stop in a safe place, then use End Trip (Early).'}
              </Typography>
            )}
          </>
        ) : (
          <>
            <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
              {tl
                ? 'Isang tap lang. Hindi mo kailangang mag-type. Ipapadala namin ang ulat at ang huling lokasyon ng tricycle sa mga administrator.'
                : 'One tap. You do not have to type. The report and the tricycle\'s last known position go to the administrators.'}
            </Typography>
            <RadioGroup value={category} onChange={(e) => setCategory(e.target.value as UrgentReportCategory)} aria-label={tl ? 'Ano ang nangyayari' : 'What is happening'}>
              {URGENT_REPORT_OPTIONS.map((o) => (
                <FormControlLabel
                  key={o.category}
                  value={o.category}
                  control={<Radio sx={{ color: '#CBD5E1', '&.Mui-checked': { color: '#DC2626' } }} />}
                  label={o[tl ? 'tl' : 'en']}
                  sx={{ '& .MuiFormControlLabel-label': { fontSize: '14px', color: '#0F172A' } }}
                />
              ))}
            </RadioGroup>
            <TextField
              fullWidth
              size="small"
              multiline
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              label={tl ? 'Dagdag na detalye (opsyonal)' : 'More detail (optional)'}
             
            />
            <Box sx={{ p: '10px 12px', borderRadius: '12px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5' }}>
              <Typography sx={{ fontSize: '12px', lineHeight: 1.45, color: '#991B1B' }}>
                {tl ? 'Kung nasa agarang panganib ka, tumawag sa 911 gamit ang telepono mo.' : 'If you are in immediate danger, call 911 with your phone.'}
              </Typography>
            </Box>
            {error && (
              <Typography role="alert" sx={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600 }}>
                {error}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexDirection: 'column', alignItems: 'stretch' }}>
        {sent ? (
          <>
            {onEndTripEarly && (
              <Button variant="contained" fullWidth onClick={onEndTripEarly} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 44, backgroundColor: '#FF6600', boxShadow: 'none', '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' } }}>
                {tl ? 'Tapusin ang Biyahe (Maaga)' : 'End Trip (Early)'}
              </Button>
            )}
            <Button variant="outlined" fullWidth onClick={onClose} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>
              {tl ? 'Isara' : 'Close'}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="contained"
              fullWidth
              disabled={busy}
              onClick={() => onSubmit(category, text.trim())}
              sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 700, height: 48, backgroundColor: '#DC2626', boxShadow: 'none', '&:hover': { backgroundColor: '#B91C1C', boxShadow: 'none' } }}
            >
              {busy ? (tl ? 'Ipinapadala...' : 'Sending...') : tl ? 'Ipadala ang Agarang Ulat' : 'Send Urgent Report'}
            </Button>
            <Button variant="outlined" fullWidth disabled={busy} onClick={onClose} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, height: 44 }}>
              {tl ? 'Kanselahin' : 'Cancel'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default UrgentSafetyReportDialog;
