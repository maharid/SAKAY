import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import {
  CALAMITY_KINDS,
  CALAMITY_SCOPES,
  calamityDetails,
  endOfManilaDay,
  formatCalamityMoment,
  manilaDateOf,
  useInFlight,
  type ActiveCalamity,
  type CalamityKind,
  type CalamityScope,
} from '@sakay/shared';
import { MacCenterModal } from './MacCenterModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { DateField } from '../common/DateField';
import { declareCalamity, endCalamity, fetchCalamity, updateCalamityDeclaration } from '../../services/adminApiService';
import { FONT, SPACE } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageCardSx, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';

interface CalamityPanelProps {
  /** called after a declaration, a change or its end, so the page lists the new announcement */
  onChanged?: () => void | Promise<void>;
}

/** What the form is doing: a new declaration, or changing the one in effect (its kind and what it suspends cannot change: end it and declare another) */
type FormMode = 'declare' | 'edit';

const ACTIVE_ACCENT = '#C75000';

/** One row of "what this changes": a label and the sentence under it */
const EffectRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>
      {label}
    </Typography>
    <Typography component="dd" sx={{ m: 0, mt: '1px', fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  </Box>
);

/**
 * Rules 15.3, 15.4, 29.6: the LGU Administrator declares a calamity (a typhoon, a flood, an earthquake, a road closure, an officially declared emergency). It is ONE administrative
 * action: the platform-wide announcement and the pause of the strikes for cancellations, stalls and no-shows are made together by the database and recorded by ONE audit entry;
 * serious and safety violations are never paused. Both apps show a banner while it lasts. While it is in effect the panel says exactly what it suspends, for whom, where and for how
 * long; its text and expected end can be changed (audited), and ending it is one more action. Only the LGU Administrator can do any of it (the database refuses everyone else).
 */
export const CalamityPanel: React.FC<CalamityPanelProps> = ({ onChanged }) => {
  const flight = useInFlight();
  const [calamity, setCalamity] = useState<ActiveCalamity>({ active: false });
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [kind, setKind] = useState<CalamityKind>('Typhoon');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState<CalamityScope>('CANCEL_STALL_NOSHOW');
  const [endDate, setEndDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reload = useCallback(async () => setCalamity(await fetchCalamity()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const today = manilaDateOf(new Date().toISOString());
  const formOpen = formMode !== null;
  const sentence = (why: string) => why.replace(/^ERR_[A-Z_]+:\s*/, '');

  const openDeclare = () => {
    setProblem(null);
    setDone(null);
    setKind('Typhoon');
    setScope('CANCEL_STALL_NOSHOW');
    setTitle('');
    setMessage('');
    setEndDate('');
    setFormMode('declare');
  };

  const openEdit = () => {
    setProblem(null);
    setDone(null);
    setTitle(calamity.title ?? '');
    setMessage(calamity.message ?? '');
    setEndDate(manilaDateOf(calamity.expectedEndAt));
    setFormMode('edit');
  };

  const submit = () =>
    flight.run(async () => {
      setProblem(null);
      const expectedEndAt = endDate ? endOfManilaDay(endDate) : null;
      if (formMode === 'edit') {
        const why = await updateCalamityDeclaration({ title: title.trim(), message: message.trim(), expectedEndAt });
        if (why) {
          setProblem(sentence(why));
          return;
        }
        setFormMode(null);
        setDone('The declaration was changed. The announcement now shows the new text, and the change is in the audit log.');
        await reload();
        await onChanged?.();
        return;
      }
      const why = await declareCalamity({ kind, title: title.trim(), message: message.trim(), scope });
      if (why) {
        setProblem(sentence(why));
        return;
      }
      // the expected end is optional and recorded as the first change of the new declaration
      const endProblem = expectedEndAt ? await updateCalamityDeclaration({ title: title.trim(), message: message.trim(), expectedEndAt }) : null;
      setFormMode(null);
      setTitle('');
      setMessage('');
      setEndDate('');
      setDone(
        endProblem
          ? `The calamity was declared, but the expected end was not saved (${sentence(endProblem)}). Use Edit declaration to set it.`
          : 'The calamity was declared: the announcement is published and the strikes are paused.'
      );
      await reload();
      await onChanged?.();
    });

  const end = (note?: string) =>
    flight.run(async () => {
      const why = await endCalamity(note ?? '');
      setEndOpen(false);
      if (why) {
        setProblem(sentence(why));
        return;
      }
      setDone('The calamity ended: strikes count again.');
      await reload();
      await onChanged?.();
    });

  const details = calamityDetails(calamity);
  const scopeLabel = CALAMITY_SCOPES.find((s) => s.code === calamity.scope)?.en;

  return (
    <Box
      sx={{
        ...pageCardSx,
        mb: SPACE.gapLarge,
        p: SPACE.card,
        // a declaration in effect stands out from every other card on the page: a heavy orange frame, a tinted ground and a label
        border: calamity.active ? `2px solid ${ACTIVE_ACCENT}` : `1px solid ${PAGE_BORDER}`,
        backgroundColor: calamity.active ? '#FFF7ED' : '#FFFFFF',
        boxShadow: calamity.active ? '0 0 0 4px rgba(199, 80, 0, 0.10)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px 16px', flexWrap: 'wrap' }}>
        {calamity.active ? (
          <ReportProblemIcon aria-hidden sx={{ color: ACTIVE_ACCENT, fontSize: 22, alignSelf: 'flex-start' }} />
        ) : (
          <ThunderstormIcon aria-hidden sx={{ color: PAGE_TEXT.secondary, fontSize: 20, mt: '1px', alignSelf: 'flex-start' }} />
        )}
        <Box sx={{ flex: 1, minWidth: 260 }}>
          {calamity.active && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', mb: '4px' }}>
              <Box
                component="span"
                sx={{ px: '8px', py: '1px', borderRadius: '999px', backgroundColor: ACTIVE_ACCENT, color: '#FFFFFF', fontSize: FONT.caption, fontWeight: 700, letterSpacing: '0.04em' }}
              >
                IN EFFECT
              </Box>
              <Box component="span" sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.brand }}>
                {calamity.kind} · declared {formatCalamityMoment(calamity.declaredAt)}
              </Box>
            </Box>
          )}
          <Typography component="h2" sx={{ fontSize: calamity.active ? FONT.sectionTitle : FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>
            {calamity.active ? calamity.title : 'Calamity and emergency declaration'}
          </Typography>
          {!calamity.active && (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5, mt: '2px' }}>
              When a typhoon, a flood, an earthquake, a road closure or an officially declared emergency disrupts trips, publish a platform-wide announcement and suspend strikes for
              cancellations, stalls and no-shows in ONE recorded action, instead of waiving them case by case. Nothing is suspended right now.
            </Typography>
          )}
        </Box>
        {calamity.active ? (
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={openEdit} disabled={flight.busy} startIcon={<EditOutlinedIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
              Edit declaration
            </Button>
            <Button onClick={() => setEndOpen(true)} disabled={flight.busy} sx={secondaryButtonSx}>
              End the calamity
            </Button>
          </Box>
        ) : (
          <Button onClick={openDeclare} variant="contained" sx={primaryButtonSx}>
            Declare a calamity
          </Button>
        )}
      </Box>

      {calamity.active && (
        <>
          <Box sx={{ backgroundColor: '#FFFFFF', border: `1px solid ${PAGE_BORDER}`, borderRadius: '10px', p: '10px 14px' }}>
            <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>The announcement drivers and passengers read</Typography>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.5, mt: '2px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{calamity.message}</Typography>
          </Box>

          {/* what the declaration suspends: it is the strike count only (the declaration changes nothing else), for everybody, everywhere */}
          <Box>
            <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: PAGE_TEXT.primary, mb: '8px' }}>
              What is suspended
            </Typography>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '10px 22px' }}>
              <EffectRow label="Paused while it lasts">{details.suspended}</EffectRow>
              <EffectRow label="Never paused">{details.stillEnforced}</EffectRow>
              <EffectRow label="Who is affected">{details.affected} (the announcement and the banner reach both apps)</EffectRow>
              <EffectRow label="Where">{details.coverage}</EffectRow>
              <EffectRow label="How long">{details.duration}</EffectRow>
              <EffectRow label="Chosen scope">{scopeLabel ?? '-'}</EffectRow>
            </Box>
            {calamity.updatedAt && (
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px' }}>Last changed {formatCalamityMoment(calamity.updatedAt)}. Every change is in the audit log.</Typography>
            )}
          </Box>
        </>
      )}

      {/* the result of the last action, on its own row under the card's content, so showing it does not move the button */}
      {(done || (problem && !formOpen)) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {done && <Alert severity="success" sx={{ borderRadius: '10px' }} onClose={() => setDone(null)}>{done}</Alert>}
          {problem && !formOpen && <Alert severity="error" sx={{ borderRadius: '10px' }} onClose={() => setProblem(null)}>{problem}</Alert>}
        </Box>
      )}

      <MacCenterModal
        open={formOpen}
        onClose={() => !flight.busy && setFormMode(null)}
        title={formMode === 'edit' ? 'Edit the declaration' : 'Declare a calamity or emergency'}
        subtitle={formMode === 'edit' ? 'The announcement shows the new text at once; the change is audited' : 'One action: the announcement and the strike pause, recorded together'}
        maxWidth={496}
        primaryActionLabel={flight.busy ? (formMode === 'edit' ? 'Saving...' : 'Declaring...') : formMode === 'edit' ? 'Save changes' : 'Declare and publish'}
        onPrimaryAction={submit}
        primaryActionDisabled={flight.busy || title.trim().length < 5 || message.trim().length < 10}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setFormMode(null)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
          {formMode === 'edit' ? (
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              The kind of event ({calamity.kind}) and what is suspended cannot be changed. To change them, end this declaration and declare another.
            </Alert>
          ) : (
            <TextField select size="small" fullWidth label="Kind of event" value={kind} onChange={(e) => setKind(e.target.value as CalamityKind)}>
              {CALAMITY_KINDS.map((k) => (
                <MenuItem key={k} value={k}>{k}</MenuItem>
              ))}
            </TextField>
          )}
          <TextField size="small" fullWidth label="Announcement title (at least 5 characters)" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} />
          <TextField size="small" fullWidth multiline rows={4} label="Announcement for every passenger and driver (at least 10 characters)" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1500))}
            helperText="Say what happened, where, and what people should do. It appears in the notices and as a banner on the home screen of both apps." />
          {formMode !== 'edit' && (
            <TextField
              select
              size="small"
              fullWidth
              label="What is suspended"
              value={scope}
              onChange={(e) => setScope(e.target.value as CalamityScope)}
              helperText="Applies to all drivers and passengers, in every TODA and service area. Serious and safety violations are never paused."
            >
              {CALAMITY_SCOPES.map((s) => (
                <MenuItem key={s.code} value={s.code}>{s.en}</MenuItem>
              ))}
            </TextField>
          )}
          <DateField
            fullWidth
            label="Expected to end on (optional)"
            value={endDate}
            onChange={setEndDate}
            min={today}
            helperText="Shown to drivers and passengers. Leave it empty if it lasts until you end it; ending it early is always possible."
          />
          {problem && <Alert severity="error" sx={{ borderRadius: '10px' }}>{problem}</Alert>}
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
