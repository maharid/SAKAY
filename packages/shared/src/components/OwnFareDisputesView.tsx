import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { EvidenceLinks } from './EvidenceLinks';
import { EvidencePicker } from './EvidencePicker';
import { useInFlight } from '../hooks/useInFlight';
import { FARE_STATEMENT_MAX, fareStatementProblem } from '../utils/caseEvidence';
import type { CaseEvidenceFile, OwnFareDispute } from '../utils/caseEvidence';
import { messageForLanguage } from '../utils/notificationLocalization';

export interface OwnFareDisputesViewProps {
  language: 'tl' | 'en';
  /** whose disputes these are: only changes who "you" and "the other side" are */
  audience: 'passenger' | 'driver';
  /** null while loading or when they could not be read */
  disputes: OwnFareDispute[] | null;
  loading: boolean;
  failed: boolean;
  /** adds a statement with up to three photos; resolves to null when it worked, else to the sentence to show */
  onAddStatement: (disputeId: string, text: string, files: File[]) => Promise<string | null>;
  /** a statement was added: the screen reloads its data */
  onChanged: () => void | Promise<void>;
  /** signs the sender's own photos so they can be opened */
  sign: (paths: string[]) => Promise<CaseEvidenceFile[]>;
}

const KIND: Record<string, { en: string; tl: string }> = {
  FARE_DISCREPANCY: { en: 'The fare was reported as different from the app', tl: 'Iniulat na iba ang pamasahe sa app' },
  SAFETY_REVIEW: { en: 'Review of an early end for safety', tl: 'Pagsusuri ng maagang pagtatapos para sa kaligtasan' },
  NON_PAYMENT: { en: 'The driver reported that the fare was not paid', tl: 'Iniulat ng drayber na hindi nabayaran ang pamasahe' },
};

const OUTCOME: Record<string, { en: string; tl: string }> = {
  FARE_CONFIRMED: { en: 'The fare stands', tl: 'Nanatili ang pamasahe' },
  FARE_REDUCED: { en: 'The fare was reduced', tl: 'Binawasan ang pamasahe' },
  FARE_WAIVED: { en: 'The fare was waived', tl: 'Hindi na sinisingil ang pamasahe' },
  FARE_ADJUSTED: { en: 'The fare was adjusted', tl: 'Inayos ang pamasahe' },
  NON_PAYMENT_UPHELD: { en: 'Non-payment upheld', tl: 'Pinagtibay ang hindi pagbabayad' },
  NON_PAYMENT_REJECTED: { en: 'Non-payment rejected: the fare was paid', tl: 'Tinanggihan: nabayaran ang pamasahe' },
};

const manila = (iso: string): string =>
  new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const peso = (v: number | null): string => (v === null ? '-' : `PHP ${v.toFixed(2)}`);

/**
 * The fare disputes about a person's own trips (Rules 18.4, 13.5, 18.6): what was reported, who has the case, what was decided, and the statements so far, with a way to add
 * information and up to three photos while the case is open. The photos a person sent are shown to that person as links; the other side's are only counted (the storage policies
 * never let one party open the other's photos). The DATABASE decides who may add what; this carries the words and the photos.
 */
export const OwnFareDisputesView: React.FC<OwnFareDisputesViewProps> = ({ language, audience, disputes, loading, failed, onAddStatement, onChanged, sign }) => {
  const tl = language === 'tl';
  const flight = useInFlight();
  const [target, setTarget] = useState<OwnFareDispute | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const close = () => {
    setTarget(null);
    setText('');
    setFiles([]);
    setFormError(null);
  };

  const send = () =>
    flight.run(async () => {
      if (!target) return;
      const problem = fareStatementProblem(text);
      if (problem) {
        setFormError(problem);
        return;
      }
      const failure = await onAddStatement(target.disputeId, text, files);
      if (failure) {
        setFormError(failure);
        return;
      }
      close();
      setDone(true);
      await onChanged();
    });

  const who = (party: string): string => {
    if (party === audience) return tl ? 'Ikaw' : 'You';
    if (party === 'passenger') return tl ? 'Pasahero' : 'Passenger';
    if (party === 'driver') return tl ? 'Drayber' : 'Driver';
    if (party === 'toda_admin') return 'TODA Administrator';
    if (party === 'lgu_admin') return 'LGU Administrator';
    return tl ? 'Sistema' : 'System';
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={28} /></Box>;
  if (failed || disputes === null) {
    return <Alert severity="warning" sx={{ borderRadius: '12px' }}>{tl ? 'Hindi mabasa ang mga kaso ngayon.' : 'The cases could not be read right now.'}</Alert>;
  }

  return (
    <>
      {done && <Alert severity="success" onClose={() => setDone(false)} sx={{ mb: 2, borderRadius: '12px' }}>{tl ? 'Naidagdag ang impormasyon.' : 'Your information was added.'}</Alert>}
      {disputes.length === 0 && (
        <Typography sx={{ fontSize: '14px', color: '#64748B', textAlign: 'center', py: 4 }}>
          {tl ? 'Wala kang kaso tungkol sa pamasahe.' : 'You have no fare cases.'}
        </Typography>
      )}
      {disputes.map((d) => (
        <Paper key={d.disputeId} elevation={0} sx={{ p: 2, mb: 2, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
            <Chip
              size="small"
              label={d.status === 'Resolved' ? (tl ? 'Nasuri na' : 'Decided') : d.status === 'Escalated' ? (tl ? 'Nasa LGU Administrator' : 'With the LGU Administrator') : (tl ? 'Naghihintay sa TODA Administrator' : 'Waiting for the TODA Administrator')}
              color={d.status === 'Resolved' ? 'success' : 'warning'}
            />
            <Typography sx={{ fontSize: '12px', color: '#64748B' }}>{manila(d.createdAt)}</Typography>
          </Box>
          <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>{tl ? (KIND[d.kind]?.tl ?? d.kind) : (KIND[d.kind]?.en ?? d.kind)}</Typography>
          {(d.pickup || d.dropoff) && <Typography sx={{ fontSize: '12.5px', color: '#475569' }}>{d.pickup ?? '-'} {'->'} {d.dropoff ?? '-'}</Typography>}
          <Typography sx={{ fontSize: '12.5px', color: '#334155', mt: 0.5 }}>
            {tl ? 'Pamasahe sa app' : 'Fare in the app'}: {peso(d.systemFare)}
            {d.claimedAmount !== null ? ` · ${tl ? 'Iniulat na hiningi' : 'Reported as asked'}: ${peso(d.claimedAmount)}` : ''}
          </Typography>
          {d.status === 'Resolved' && (
            <Alert severity="info" sx={{ mt: 1, borderRadius: '10px', fontSize: '12.5px' }}>
              <strong>{d.outcome ? (tl ? OUTCOME[d.outcome]?.tl : OUTCOME[d.outcome]?.en) ?? d.outcome : ''}</strong>
              {d.resolvedFare !== null ? ` (${peso(d.resolvedFare)})` : ''}
              {d.resolutionNote ? `: ${d.resolutionNote}` : ''}
            </Alert>
          )}
          {d.notes.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {d.notes.map((n, i) => (
                <Box key={`${n.createdAt}-${i}`} sx={{ pl: 1.25, borderLeft: '3px solid #E2E8F0' }}>
                  <Typography sx={{ fontSize: '11.5px', color: '#64748B' }}>{who(n.party)} · {manila(n.createdAt)}</Typography>
                  <Typography sx={{ fontSize: '13px', color: '#0F172A', whiteSpace: 'pre-wrap' }}>{n.note}</Typography>
                  {n.party === audience ? (
                    <EvidenceLinks paths={n.evidencePaths} sign={sign} label={tl ? 'Mga larawan mo' : 'Your photos'} />
                  ) : n.evidencePaths.length > 0 ? (
                    <Typography sx={{ fontSize: '12px', color: '#64748B' }}>{tl ? `${n.evidencePaths.length} larawan ang kalakip` : `${n.evidencePaths.length} photo(s) attached`}</Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          )}
          {d.status !== 'Resolved' && (
            <Button size="small" variant="outlined" onClick={() => { setTarget(d); setDone(false); }} sx={{ mt: 1.25, textTransform: 'none', fontWeight: 600 }}>
              {tl ? 'Magdagdag ng impormasyon' : 'Add information'}
            </Button>
          )}
        </Paper>
      ))}

      <Dialog open={target !== null} onClose={close} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>{tl ? 'Magdagdag ng impormasyon' : 'Add information'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
          <Typography sx={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.45 }}>
            {tl ? 'Mababasa ito ng TODA Administrator na nagsusuri ng kasong ito.' : 'The TODA Administrator who reviews this case will read it.'}
          </Typography>
          <TextField
            multiline
            minRows={3}
            size="small"
            label={tl ? 'Ano ang gusto mong idagdag?' : 'What would you like to add?'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            helperText={`${text.trim().length} / ${FARE_STATEMENT_MAX}`}
            fullWidth
          />
          <EvidencePicker language={language} files={files} onChange={setFiles} disabled={flight.busy} />
          {formError && <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '12px' }}>{messageForLanguage(formError, language)}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={close} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 700 }}>{tl ? 'Kanselahin' : 'Cancel'}</Button>
          <Button variant="contained" disabled={flight.busy} onClick={send} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}>
            {tl ? 'Ipadala' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
