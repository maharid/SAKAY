import React from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import type { DriverApplicant } from '../../types/toda';
import { FONT } from '../../styles/density';
import { formatWhen } from '../../utils/applicantDetails';

interface RosterCheckNoticeProps {
  applicant: DriverApplicant;
  /** The TODA can still endorse, return or reject this application. Otherwise the "you can still endorse" line would be wrong. */
  canDecide?: boolean;
}

type Tone = 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, { bg: string; border: string; fg: string; icon: React.ReactElement }> = {
  success: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#166534', icon: <CheckCircleOutlinedIcon /> },
  warning: { bg: '#FFF7ED', border: '#FED7AA', fg: '#9A3412', icon: <WarningAmberIcon /> },
  danger: { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B', icon: <ErrorOutlinedIcon /> },
  info: { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', icon: <InfoOutlinedIcon /> },
};

interface Fact {
  label: string;
  value: string;
}

// One result of the roster check: what it is in a few words, who it is about, the dates that decide it, and what it means for the TODA. The long explanation of before is gone:
// the facts are the dates, and the rule is one sentence.
const Card: React.FC<{ tone: Tone; title: string; who?: string; facts?: Fact[]; rule?: string; consequence?: string }> = ({ tone, title, who, facts = [], rule, consequence }) => {
  const t = TONES[tone];
  return (
    <Box role="status" sx={{ borderRadius: '12px', border: `1px solid ${t.border}`, backgroundColor: t.bg, p: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <Box aria-hidden sx={{ color: t.fg, display: 'flex', mt: '1px', '& svg': { fontSize: 22 } }}>{t.icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h4" sx={{ fontSize: FONT.heading, fontWeight: 700, color: t.fg, lineHeight: 1.3 }}>{title}</Typography>
          {who && <Typography sx={{ fontSize: FONT.small, color: '#4d4d52', mt: '2px', overflowWrap: 'anywhere' }}>{who}</Typography>}
        </Box>
      </Box>

      {facts.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${facts.length}, minmax(0, 1fr))` }, gap: '8px' }}>
          {facts.map((f) => (
            <Box key={f.label} sx={{ borderRadius: '10px', backgroundColor: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(15, 23, 42, 0.08)', px: '12px', py: '8px' }}>
              <Typography sx={{ fontSize: FONT.small, color: '#65656a' }}>{f.label}</Typography>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: '#1d1d1f' }}>{f.value}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {(rule || consequence) && (
        <Typography sx={{ fontSize: FONT.small, color: '#3f3f46', lineHeight: 1.5 }}>
          {rule}
          {rule && consequence ? ' ' : ''}
          {consequence && <Box component="span" sx={{ fontWeight: 600 }}>{consequence}</Box>}
        </Typography>
      )}
    </Box>
  );
};

// The result of the Master Roster check for one application, in words. The database decides (the FRANCHISE number, against entries added before the application and approved by
// the LGU); this only explains its answer.
export const RosterCheckNotice: React.FC<RosterCheckNoticeProps> = ({ applicant, canDecide = true }) => {
  const check = applicant.rosterCheck;

  if (applicant.rosterMatchKnown === false || !check) {
    return <Card tone="info" title="Roster check unavailable" rule="The result could not be loaded. Refresh the page before you decide." />;
  }

  const franchise = check.driverFranchise || 'not recorded';
  const who = check.entryMemberName ? `${check.entryMemberName} · franchise ${check.entryFranchise || 'not recorded'}${check.entryPlate ? ` · plate ${check.entryPlate}` : ''}` : undefined;
  const applied: Fact = { label: 'Applied', value: formatWhen(check.submittedAt) };
  const endorsed = Boolean(applicant.todaEndorsed) || applicant.todaStageStatus === 'Endorsed to LGU';
  // what a mismatch means for the TODA, in one sentence
  const consequence = canDecide
    ? 'You can still endorse; the LGU gets a Roster Mismatch flag.'
    : endorsed
    ? 'Already endorsed: the LGU decides it with a written reason.'
    : undefined;

  switch (check.reason) {
    case 'matched':
      return <Card tone="success" title="Found on the Master Roster" who={who} facts={[{ label: 'Added to the roster', value: formatWhen(check.entryCountedFrom) }, applied]} rule="Added before the application." />;
    case 'entry_pending_lgu':
      return <Card tone="warning" title="On the roster, waiting for the LGU" who={who} rule="A member added after the registration roster file counts once the LGU approves the entry." consequence={consequence} />;
    case 'entry_rejected_lgu':
      return <Card tone="danger" title="The LGU did not approve this entry" who={who} rule="Correct the entry on the Master Roster to send it again." consequence={consequence} />;
    case 'entry_added_later':
      return (
        <Card
          tone="warning"
          title="On the roster, but added too late"
          who={who}
          facts={[applied, { label: 'Added to the roster', value: formatWhen(check.entryCountedFrom) }]}
          rule="An entry added after the application does not count."
          consequence={consequence}
        />
      );
    case 'entry_left':
      return (
        <Card
          tone="warning"
          title="On the roster, but the member had left"
          who={who}
          facts={[applied, { label: 'Left the roster', value: formatWhen(check.entryCountedFrom) }]}
          rule="A member who has left does not count."
          consequence={consequence}
        />
      );
    case 'plate_only':
      return <Card tone="warning" title="Not on the roster" who={who ? `Same plate, other franchise: ${who}` : undefined} rule={`No entry has franchise number ${franchise}. A plate or a name alone does not count.`} consequence={consequence} />;
    case 'no_franchise':
      return <Card tone="warning" title="Not checked: no franchise number" rule="Look for it on the MTOP permit." consequence={consequence} />;
    default:
      return <Card tone="warning" title="Not on the roster" rule={`No entry has franchise number ${franchise}.`} consequence={consequence} />;
  }
};
