import React, { useState } from 'react';
import { Alert, Box, Button, Card, TextField, Typography } from '@mui/material';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

import type { TodaProfile } from '../../types/toda';
import { accreditationChip, accreditationTone, daysUntil } from '../../utils/accreditation';
import { FONT, SPACE } from '../../styles/density';
import { OPS_TEXT, opsCardSx } from '../operations/operationsTheme';
import { ToneStatusPill } from './DataTable';
import { primaryButtonSx } from './pageButtons';

interface AccreditationCardProps {
  profile: TodaProfile;
  /** Sends the returned application back to the LGU; rejects with the database's own sentence, shown here */
  onResubmit: (note: string) => Promise<void>;
}

const manilaDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
const dayText = (ymd: string): string => manilaDate(`${ymd}T00:00:00+08:00`);

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{value}</Typography>
  </Box>
);

const noticeSx = { borderRadius: '8px', fontSize: FONT.body } as const;

/**
 * Checklist B1: the application's status, the certificate and validity the LGU recorded, the validity the TODA declared, the LGU's correction or decline reason,
 * and the Resubmit step for an application that was returned. The files themselves are submitted from the compliance section below.
 * The banner at the top of every page already announces a pending, declined, expiring or renewed accreditation, so only what needs an action stays here.
 */
export const AccreditationCard: React.FC<AccreditationCardProps> = ({ profile, onResubmit }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = accreditationChip(profile.accreditationStatus);
  const days = daysUntil(profile.accreditationExpiryIso);

  const resubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onResubmit(note.trim());
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The application could not be resubmitted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card elevation={0} sx={{ ...opsCardSx, p: SPACE.cardLarge, mb: SPACE.gapLarge }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', mb: '13px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19 }} />
          <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>Accreditation</Typography>
        </Box>
        <ToneStatusPill label={chip.label} tone={accreditationTone(profile.accreditationStatus)} />
      </Box>

      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px 16px' }}>
        <Fact label="Certificate number" value={profile.accreditationNo || 'Not issued yet'} />
        <Fact
          label="Accreditation valid until"
          value={
            profile.accreditationExpiryIso
              ? `${profile.accreditationExpiry}${days === null ? '' : days < 0 ? ' (expired)' : ` (${days} day${days === 1 ? '' : 's'} left)`}`
              : 'Not recorded by the LGU yet'
          }
        />
        <Fact label="Clearance validity you stated" value={profile.declaredClearanceValidUntil ? dayText(profile.declaredClearanceValidUntil) : 'Not stated'} />
        <Fact label="Clearance sent" value={profile.barangayClearanceFile.date || 'Not uploaded'} />
      </Box>

      {profile.accreditationStatus === 'Pending Verification' && (
        <Alert severity="info" sx={{ mt: '16px', ...noticeSx }}>
          The LGU will approve your application, return it to you with a reason, or decline it. You will see the result here.
        </Alert>
      )}

      {profile.accreditationStatus === 'Resubmission Required' && (
        <Box sx={{ mt: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Alert severity="error" sx={noticeSx}>
            <Typography sx={{ fontWeight: 700, fontSize: FONT.body }}>The LGU returned this application for correction</Typography>
            <Typography sx={{ fontSize: FONT.body, mt: '3px' }}>{profile.resubmissionReason || 'The LGU did not write a reason. Contact the City Transport & Franchising Office.'}</Typography>
          </Alert>
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.6 }}>
            1. Upload the corrected file under Compliance documents below (a Barangay Clearance needs the date it is valid until).
            <br />
            2. Press Resubmit. The application goes back to the LGU and this status changes to Pending Verification.
          </Typography>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={2}
            label="Note to the LGU (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {error && <Alert severity="error" sx={noticeSx}>{error}</Alert>}
          <Button variant="contained" disableElevation disabled={busy} onClick={() => void resubmit()} sx={{ ...primaryButtonSx, alignSelf: 'flex-start' }}>
            {busy ? 'Sending...' : 'Resubmit for LGU review'}
          </Button>
        </Box>
      )}

      {profile.accreditationStatus === 'Deactivated' && (
        <Alert severity="error" sx={{ mt: '16px', ...noticeSx }}>
          <Typography sx={{ fontWeight: 700, fontSize: FONT.body }}>The LGU declined or deactivated this accreditation</Typography>
          <Typography sx={{ fontSize: FONT.body, mt: '3px' }}>{profile.declineReason || 'No reason was recorded.'} Documents cannot be submitted while the accreditation is deactivated; contact the City Transport &amp; Franchising Office.</Typography>
        </Alert>
      )}
    </Card>
  );
};
