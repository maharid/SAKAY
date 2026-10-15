import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';

import { CALAMITY_KINDS, CALAMITY_SCOPES, useInFlight, type ActiveCalamity, type CalamityKind, type CalamityScope } from '@sakay/shared';
import { MacCenterModal } from './MacCenterModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { declareCalamity, endCalamity, fetchCalamity } from '../../services/adminApiService';

interface CalamityPanelProps {
  /** called after a declaration or its end, so the page lists the new announcement */
  onChanged?: () => void | Promise<void>;
}

const manila = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

/**
 * Rules 15.3, 15.4, 29.6: the LGU Administrator declares a calamity (a typhoon, a flood, an earthquake, a road closure, an officially declared emergency). It is ONE administrative
 * action: the platform-wide announcement and the pause of the strikes for cancellations, stalls and no-shows are made together by the database and recorded by ONE audit entry;
 * serious and safety violations are never paused. Both apps show a banner while it lasts. Ending it is one more action.
 */
export const CalamityPanel: React.FC<CalamityPanelProps> = ({ onChanged }) => {
  const flight = useInFlight();
  const [calamity, setCalamity] = useState<ActiveCalamity>({ active: false });
  const [formOpen, setFormOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [kind, setKind] = useState<CalamityKind>('Typhoon');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState<CalamityScope>('CANCEL_STALL_NOSHOW');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reload = useCallback(async () => setCalamity(await fetchCalamity()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = () =>
    flight.run(async () => {
      setProblem(null);
      const why = await declareCalamity({ kind, title: title.trim(), message: message.trim(), scope });
      if (why) {
        setProblem(why.replace(/^ERR_[A-Z_]+:\s*/, ''));
        return;
      }
      setFormOpen(false);
      setTitle('');
      setMessage('');
      setDone('The calamity was declared: the announcement is published and the strikes are paused.');
      await reload();
      await onChanged?.();
    });

  const end = (note?: string) =>
    flight.run(async () => {
      const why = await endCalamity(note ?? '');
      setEndOpen(false);
      if (why) {
        setProblem(why.replace(/^ERR_[A-Z_]+:\s*/, ''));
        return;
      }
      setDone('The calamity ended: strikes count again.');
      await reload();
      await onChanged?.();
    });

  return (
    <Box
      sx={{
        mb: 4,
        p: 2.5,
        borderRadius: 'var(--mac-radius-lg)',
        border: `1px solid ${calamity.active ? '#FDBA74' : 'var(--mac-border-color)'}`,
        backgroundColor: calamity.active ? '#FFF7ED' : '#FFFFFF',
        boxShadow: 'var(--mac-shadow-card)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <ThunderstormIcon sx={{ color: calamity.active ? '#EA580C' : 'var(--mac-text-muted)', mt: '2px' }} />
      <Box sx={{ flex: 1, minWidth: 260 }}>
        <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
          {calamity.active ? `Calamity in effect: ${calamity.title}` : 'Calamity and emergency declaration'}
        </Typography>
        {calamity.active ? (
          <Typography sx={{ fontSize: '12px', color: '#9A3412', lineHeight: 1.5, mt: 0.5 }}>
            {calamity.kind} · declared {manila(calamity.declaredAt)} · strikes paused for{' '}
            {calamity.scope === 'ALL' ? 'every violation that can be paused' : 'cancellations, stalls and no-shows'} (serious and safety violations are never paused).
          </Typography>
        ) : (
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', lineHeight: 1.5, mt: 0.5 }}>
            When a typhoon, a flood, an earthquake, a road closure or an officially declared emergency disrupts trips, publish a platform-wide announcement and suspend strikes for
            cancellations, stalls and no-shows (Rules 15.4 and 29.6) in ONE recorded action, instead of waiving them case by case.
          </Typography>
        )}
        {done && <Alert severity="success" sx={{ mt: 1.5 }} onClose={() => setDone(null)}>{done}</Alert>}
        {problem && !formOpen && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setProblem(null)}>{problem}</Alert>}
      </Box>
      {calamity.active ? (
        <Button onClick={() => setEndOpen(true)} disabled={flight.busy} variant="outlined" sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', borderColor: '#EA580C', color: '#9A3412' }}>
          End the calamity
        </Button>
      ) : (
        <Button onClick={() => { setProblem(null); setDone(null); setFormOpen(true); }} variant="contained" sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', backgroundColor: 'var(--sakay-orange)', boxShadow: 'none', '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' } }}>
          Declare a calamity
        </Button>
      )}

      <MacCenterModal
        open={formOpen}
        onClose={() => !flight.busy && setFormOpen(false)}
        title="Declare a calamity or emergency"
        subtitle="One action: the announcement and the strike pause, recorded together"
        maxWidth={620}
        primaryActionLabel={flight.busy ? 'Declaring...' : 'Declare and publish'}
        onPrimaryAction={submit}
        primaryActionDisabled={flight.busy || title.trim().length < 5 || message.trim().length < 10}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setFormOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField select size="small" fullWidth label="Kind of event" value={kind} onChange={(e) => setKind(e.target.value as CalamityKind)}>
            {CALAMITY_KINDS.map((k) => (
              <MenuItem key={k} value={k}>{k}</MenuItem>
            ))}
          </TextField>
          <TextField size="small" fullWidth label="Announcement title (at least 5 characters)" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} />
          <TextField size="small" fullWidth multiline rows={4} label="Announcement for every passenger and driver (at least 10 characters)" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1500))}
            helperText="Say what happened, where, and what people should do. It appears in the notices and as a banner on the home screen of both apps." />
          <TextField select size="small" fullWidth label="What is suspended" value={scope} onChange={(e) => setScope(e.target.value as CalamityScope)}>
            {CALAMITY_SCOPES.map((s) => (
              <MenuItem key={s.code} value={s.code}>{s.en}</MenuItem>
            ))}
          </TextField>
          {problem && <Alert severity="error">{problem}</Alert>}
        </Box>
      </MacCenterModal>

      <MacConfirmDialog
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title="End the calamity?"
        message="Strikes for cancellations, stalls and no-shows count again from now, the banner disappears and a 'normal operations resumed' announcement is published."
        confirmLabel="End the calamity"
        confirmVariant="orange"
        requireReason
        reasonPlaceholder="Why it is over (the weather cleared, the roads are open ...)"
        minReasonLength={5}
        onConfirm={(reason) => void end(reason)}
      />
    </Box>
  );
};
