import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { TodaProfile } from '../../types/toda';
import { RENEWAL_WINDOW_DAYS, daysUntil } from '../../utils/accreditation';

interface AccreditationStatusBannerProps {
  profile: TodaProfile | null;
}

const manilaDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });

/**
 * What the TODA administrator needs to know about the accreditation, on every page (checklist B1: monitor the application status, see the LGU's reason, know when
 * to renew). Pending, returned for correction (with the LGU's reason), declined, suspended, expiring soon, expired, or a renewal waiting for the LGU. Nothing for a
 * healthy Active accreditation.
 */
export const AccreditationStatusBanner: React.FC<AccreditationStatusBannerProps> = ({ profile }) => {
  const navigate = useNavigate();
  if (!profile) return null;

  const goToAccount = (label: string) => (
    <Button color="inherit" size="small" onClick={() => navigate('/account')} sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label}
    </Button>
  );
  const alertSx = { borderRadius: 'var(--mac-radius-lg)', boxShadow: 'var(--mac-shadow-card)', '& .MuiAlert-message': { width: '100%' } };
  const title = (text: string, color: string) => <Typography sx={{ fontWeight: 600, color, mb: 0.5 }}>{text}</Typography>;
  const body = (text: React.ReactNode, color: string) => <Typography sx={{ fontSize: '14px', color }}>{text}</Typography>;

  switch (profile.accreditationStatus) {
    case 'Pending Verification':
      return (
        <Box sx={{ mb: 3.5 }}>
          <Alert severity="warning" sx={alertSx}>
            {title('Pending Accreditation', '#9a6b00')}
            {body('Your TODA application is with the LGU for review. You can use your account while you wait, but the driver, roster and monitoring features stay locked until it is approved.', '#664d03')}
          </Alert>
        </Box>
      );
    case 'Resubmission Required':
      return (
        <Box sx={{ mb: 3.5 }}>
          <Alert severity="error" action={goToAccount('Fix and resubmit')} sx={alertSx}>
            {title('The LGU returned your application for correction', '#991B1B')}
            {body(
              <>
                <b>Reason:</b> {profile.resubmissionReason || 'The LGU did not write a reason. Contact the City Transport & Franchising Office.'} Upload the corrected file under Account &amp; Accreditation,
                then press Resubmit.
              </>,
              '#7F1D1D'
            )}
          </Alert>
        </Box>
      );
    case 'Deactivated':
      return (
        <Box sx={{ mb: 3.5 }}>
          <Alert severity="error" sx={alertSx}>
            {title('Your accreditation was declined or deactivated', '#991B1B')}
            {body(
              <>
                <b>Reason:</b> {profile.declineReason || 'No reason was recorded.'} Contact the City Transport &amp; Franchising Office to ask what can be done.
              </>,
              '#7F1D1D'
            )}
          </Alert>
        </Box>
      );
    case 'Suspended':
      return (
        <Box sx={{ mb: 3.5 }}>
          <Alert severity="error" sx={alertSx}>
            {title('Your TODA is suspended', '#991B1B')}
            {body('The LGU suspended the TODA\'s participation. Contact the City Transport & Franchising Office.', '#7F1D1D')}
          </Alert>
        </Box>
      );
    default:
      break;
  }

  // Active: a renewed clearance already sent, or the expiry coming up
  const days = daysUntil(profile.accreditationExpiryIso);
  if (profile.renewalSubmittedAt) {
    return (
      <Box sx={{ mb: 3.5 }}>
        <Alert severity="info" sx={alertSx}>
          {title('Renewal sent to the LGU', '#0C4A6E')}
          {body(
            <>
              Your renewed Barangay Clearance was sent on {manilaDate(profile.renewalSubmittedAt)}. Your accreditation stays as it is until the LGU records the renewal
              {days !== null && days >= 0 ? ` (it is valid for ${days} more day${days === 1 ? '' : 's'})` : ''}.
            </>,
            '#075985'
          )}
        </Alert>
      </Box>
    );
  }
  if (days !== null && days < 0) {
    return (
      <Box sx={{ mb: 3.5 }}>
        <Alert severity="error" action={goToAccount('Submit renewal')} sx={alertSx}>
          {title('Your accreditation has expired', '#991B1B')}
          {body(`It expired on ${manilaDate(profile.accreditationExpiryIso as string)}. Your drivers are restricted from going Online until the LGU records the renewal.`, '#7F1D1D')}
        </Alert>
      </Box>
    );
  }
  if (days !== null && days <= RENEWAL_WINDOW_DAYS) {
    return (
      <Box sx={{ mb: 3.5 }}>
        <Alert severity="warning" action={goToAccount('Submit renewal')} sx={alertSx}>
          {title(`Your accreditation expires in ${days} day${days === 1 ? '' : 's'}`, '#9a6b00')}
          {body(`Valid until ${manilaDate(profile.accreditationExpiryIso as string)}. Upload the renewed Barangay Clearance so the LGU can record it before then; after that date your drivers cannot go Online.`, '#664d03')}
        </Alert>
      </Box>
    );
  }
  return null;
};
