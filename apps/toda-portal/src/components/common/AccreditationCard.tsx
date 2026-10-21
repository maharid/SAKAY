import React, { useState } from 'react';
import { Alert, Box, Button, Card, Chip, TextField, Typography } from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';

import type { TodaProfile } from '../../types/toda';
import { accreditationChip, daysUntil } from '../../utils/accreditation';

interface AccreditationCardProps {
  profile: TodaProfile;
  /** Sends the returned application back to the LGU; rejects with the database's own sentence, shown here */
  onResubmit: (note: string) => Promise<void>;
}

const manilaDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
const dayText = (ymd: string): string => manilaDate(`${ymd}T00:00:00+08:00`);

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box>
    <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>{label}</Typography>
    <Typography sx={{ fontSize: '15.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{value}</Typography>
  </Box>
);

/**
 * Checklist B1: the application's status, the certificate and validity the LGU recorded, the validity the TODA declared, the LGU's correction or decline reason,
 * and the Resubmit step for an application that was returned. The files themselves are submitted from the compliance section below.
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
    <Card
      elevation={0}
      sx={{ p: 3, borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', backgroundColor: '#FFFFFF', boxShadow: 'var(--mac-shadow-card)', mb: 3.5 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ShieldIcon sx={{ color: '#059669', fontSize: 24 }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>Accreditation Status</Typography>
        </Box>
        <Chip label={chip.label} size="small" sx={{ backgroundColor: chip.bg, color: chip.color, fontWeight: 600, fontSize: '12.5px' }} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2.5 }}>
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
        <Alert severity="info" sx={{ mt: 2.5, borderRadius: '10px' }}>
          The LGU is reviewing your application. It will either approve it, return it to you with a reason, or decline it. You will see the result here.
        </Alert>
      )}

      {profile.accreditationStatus === 'Resubmission Required' && (
        <Box sx={{ mt: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Alert severity="error" sx={{ borderRadius: '10px' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '14px' }}>The LGU returned this application for correction</Typography>
            <Typography sx={{ fontSize: '14px', mt: 0.5 }}>{profile.resubmissionReason || 'The LGU did not write a reason. Contact the City Transport & Franchising Office.'}</Typography>
          </Alert>
          <Typography sx={{ fontSize: '14px', color: 'var(--mac-text-secondary)' }}>
            1. Upload the corrected file under Annual Compliance &amp; Accreditation Renewal below (a Barangay Clearance needs the date it is valid until).
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
          {error && <Alert severity="error" sx={{ borderRadius: '10px' }}>{error}</Alert>}
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void resubmit()}
            sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, backgroundColor: 'var(--sakay-orange)', borderRadius: '8px', '&:hover': { backgroundColor: '#E65C00' } }}
          >
            {busy ? 'Sending...' : 'Resubmit for LGU review'}
          </Button>
        </Box>
      )}

      {profile.accreditationStatus === 'Deactivated' && (
        <Alert severity="error" sx={{ mt: 2.5, borderRadius: '10px' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '14px' }}>The LGU declined or deactivated this accreditation</Typography>
          <Typography sx={{ fontSize: '14px', mt: 0.5 }}>{profile.declineReason || 'No reason was recorded.'} Documents cannot be submitted while the accreditation is deactivated; contact the City Transport &amp; Franchising Office.</Typography>
        </Alert>
      )}

      {profile.accreditationStatus === 'Active' && profile.renewalSubmittedAt && (
        <Alert severity="info" sx={{ mt: 2.5, borderRadius: '10px' }}>
          Your renewed Barangay Clearance was sent on {manilaDate(profile.renewalSubmittedAt)}. The accreditation above stays as it is until the LGU records the renewal.
        </Alert>
      )}
    </Card>
  );
};
