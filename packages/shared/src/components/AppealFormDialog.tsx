import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, MenuItem, TextField, Typography } from '@mui/material';
import { EXEMPTION_CAUSE_CODES } from '../config/policyConfig';
import type { ExemptionCauseCode } from '../config/policyConfig';
import { messageForLanguage } from '../utils/notificationLocalization';
import { EvidencePicker } from './EvidencePicker';
import { SakayDialogTitle } from './SakayDialogTitle';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX, WRAPPING_SELECT_SLOTS } from './dialogStyles';

export const APPEAL_CAUSE_LABELS: Record<ExemptionCauseCode, { en: string; tl: string }> = {
  FORCE_MAJEURE: { en: 'Force majeure (storm, flood, road closure)', tl: 'Force majeure (bagyo, baha, saradong daan)' },
  VEHICLE_BREAKDOWN: { en: 'Vehicle breakdown', tl: 'Nasira ang sasakyan' },
  NETWORK_OUTAGE: { en: 'Signal or network outage', tl: 'Walang signal o network' },
  MEDICAL_EMERGENCY: { en: 'Medical emergency', tl: 'Emergency sa kalusugan' },
  ACCIDENT_DOCUMENTED: { en: 'Documented traffic accident', tl: 'May dokumentadong aksidente' },
  DEVICE_FAILURE: { en: 'Phone or GPS failure (dead battery, damaged phone)', tl: 'Sira ang phone o GPS (na-lowbat, nasira)' },
  OTHER: { en: 'Other cause', tl: 'Ibang dahilan' },
};

const MIN_REASON_LENGTH = 5;

export interface AppealFormDialogProps {
  open: boolean;
  language: 'tl' | 'en';
  /** only changes the wording about who reviews the appeal */
  audience: 'passenger' | 'driver';
  /** the strike being appealed, as the person reads it */
  strikeTitle: string;
  /** "Issued 10 Oct 2025, 8:22 AM" */
  strikeMeta: string;
  /** when the appeal window of this strike ends, already formatted; null when it is not known */
  deadline: string | null;
  defaultCause: ExemptionCauseCode;
  /** the appeal is being sent */
  busy: boolean;
  /** what the database said when it refused (shown as is) */
  error: string | null;
  onClose: () => void;
  onSubmit: (cause: ExemptionCauseCode, justification: string, files: File[]) => void;
}

/**
 * The form of an appeal (Rule 25): the strike it is about, the cause, what happened, and up to three photos. Nothing is checked here beyond "the reason is written": the database decides
 * whether the strike can still be appealed. The screen that opens it gives it a `key` per strike, so a second strike never starts with the first one's text.
 */
export const AppealFormDialog: React.FC<AppealFormDialogProps> = ({ open, language, audience, strikeTitle, strikeMeta, deadline, defaultCause, busy, error, onClose, onSubmit }) => {
  const tl = language === 'tl';
  const [cause, setCause] = useState<ExemptionCauseCode>(defaultCause);
  const [justification, setJustification] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tooShort, setTooShort] = useState(false);

  const submit = () => {
    if (justification.trim().length < MIN_REASON_LENGTH) {
      setTooShort(true);
      return;
    }
    onSubmit(cause, justification, files);
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
      <SakayDialogTitle onClose={onClose} busy={busy} sx={DIALOG_TITLE_SX}>
        {tl ? 'Iapela ang Strike' : 'Appeal Strike'}
      </SakayDialogTitle>
      <DialogContent sx={DIALOG_CONTENT_SX}>
        <Box sx={{ p: '12px', borderRadius: '10px', backgroundColor: '#F8FAFC', border: '1px solid #E8ECF1' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{strikeTitle}</Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif', mt: '2px' }}>{strikeMeta}</Typography>
          {deadline && (
            <Typography sx={{ fontSize: '11.5px', color: '#92400E', fontWeight: 600, fontFamily: 'Poppins, sans-serif', mt: '6px' }}>
              {tl ? `Maaari kang mag-apela hanggang ${deadline}.` : `You can appeal until ${deadline}.`}
            </Typography>
          )}
        </Box>

        <Typography sx={DIALOG_INTRO_SX}>
          {audience === 'passenger'
            ? (tl ? 'Ang LGU Administrator ang magpapasya sa iyong apela.' : 'The LGU Administrator decides your appeal.')
            : (tl ? 'Ang TODA Administrator mo ang unang magpapasya; ang mabibigat na kaso ay napupunta sa LGU Administrator.' : 'Your TODA Administrator decides first; serious cases go to the LGU Administrator.')}
        </Typography>

        <TextField
          select
          size="small"
          label={tl ? 'Dahilan' : 'Cause'}
          value={cause}
          onChange={(e) => setCause(e.target.value as ExemptionCauseCode)}
          disabled={busy}
          fullWidth
          slotProps={WRAPPING_SELECT_SLOTS}
        >
          {EXEMPTION_CAUSE_CODES.map((c) => (
            <MenuItem key={c} value={c} sx={{ whiteSpace: 'normal', fontFamily: 'Poppins, sans-serif' }}>
              {tl ? APPEAL_CAUSE_LABELS[c].tl : APPEAL_CAUSE_LABELS[c].en}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          multiline
          minRows={3}
          size="small"
          label={tl ? 'Ano ang nangyari?' : 'What happened?'}
          value={justification}
          onChange={(e) => {
            setJustification(e.target.value);
            setTooShort(false);
          }}
          disabled={busy}
          error={tooShort}
          helperText={tooShort ? (tl ? 'Isulat kung ano ang nangyari.' : 'Write what happened.') : tl ? 'Ito ang babasahin ng magsusuri.' : 'The reviewer reads this.'}
          fullWidth
        />

        <EvidencePicker language={language} files={files} onChange={setFiles} disabled={busy} />

        {error && (
          <Alert severity="warning" role="alert" sx={{ borderRadius: '8px', fontSize: '12px' }}>
            {messageForLanguage(error, language)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={DIALOG_ACTIONS_SX}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none', color: '#475569', fontWeight: 700, fontFamily: 'Poppins, sans-serif' }}>
          {tl ? 'Kanselahin' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={busy}
          onClick={submit}
          startIcon={busy ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : undefined}
          sx={{ textTransform: 'none', fontWeight: 700, fontFamily: 'Poppins, sans-serif', borderRadius: '12px', minHeight: 40, backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E65C00' } }}
        >
          {busy ? (tl ? 'Ipinapadala…' : 'Submitting…') : tl ? 'Ipadala ang Apela' : 'Submit Appeal'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AppealFormDialog;
