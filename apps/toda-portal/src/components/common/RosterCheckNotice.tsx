import React from 'react';
import { Alert, Typography } from '@mui/material';

import type { DriverApplicant } from '../../types/toda';
import { FONT } from '../../styles/density';
import { formatWhen } from '../../utils/applicantDetails';

interface RosterCheckNoticeProps {
  applicant: DriverApplicant;
  /** The TODA can still endorse, return or reject this application. Otherwise the "you can still endorse" line would be wrong. */
  canDecide?: boolean;
}

const alertSx = { borderRadius: '10px', fontSize: FONT.body } as const;

// The result of the Master Roster check for one application, in words: what was compared, what was found, and why it did or did not count.
// The database decides (the FRANCHISE number, against entries added before the application); this only explains its answer.
export const RosterCheckNotice: React.FC<RosterCheckNoticeProps> = ({ applicant, canDecide = true }) => {
  const check = applicant.rosterCheck;

  if (applicant.rosterMatchKnown === false || !check) {
    return (
      <Alert severity="info" sx={alertSx}>
        <strong>Roster check unavailable.</strong> The result of the roster check could not be loaded. Refresh the page before you decide.
      </Alert>
    );
  }

  const franchise = check.driverFranchise ? `franchise number ${check.driverFranchise}` : 'the franchise number';
  const entry = check.entryMemberName
    ? `${check.entryMemberName} (franchise ${check.entryFranchise || 'not recorded'}${check.entryPlate ? `, plate ${check.entryPlate}` : ''})`
    : '';

  if (check.reason === 'matched') {
    return (
      <Alert severity="success" sx={alertSx}>
        <strong>Found on the Master Roster.</strong> The applicant's franchise number is on your TODA's roster: {entry}, added before the application was submitted.
      </Alert>
    );
  }

  const endorsed = Boolean(applicant.todaEndorsed) || applicant.todaStageStatus === 'Endorsed to LGU';
  const consequence = canDecide ? (
    <Typography component="span" sx={{ display: 'block', fontSize: FONT.small, mt: '4px' }}>
      You can still endorse the application, but it will carry a Roster Mismatch flag for the LGU, which must give a written reason before approving.
    </Typography>
  ) : endorsed ? (
    <Typography component="span" sx={{ display: 'block', fontSize: FONT.small, mt: '4px' }}>
      This application was already endorsed. The Roster Mismatch flag went to the LGU, which decides it with a written reason.
    </Typography>
  ) : null;

  if (check.reason === 'entry_added_later') {
    return (
      <Alert severity="warning" sx={alertSx}>
        <strong>On the roster, but not in time.</strong> Your roster has an entry for {franchise}: {entry}. It counts from {formatWhen(check.entryCountedFrom)},
        after this application was submitted ({formatWhen(check.submittedAt)}). An entry added after the application does not count.
        {consequence}
      </Alert>
    );
  }

  if (check.reason === 'entry_left') {
    return (
      <Alert severity="warning" sx={alertSx}>
        <strong>On the roster, but he had left.</strong> Your roster has an entry for {franchise}: {entry}. He was marked as no longer a member on {formatWhen(check.entryCountedFrom)},
        before this application was submitted ({formatWhen(check.submittedAt)}). A member who has left does not count.
        {consequence}
      </Alert>
    );
  }

  if (check.reason === 'plate_only') {
    return (
      <Alert severity="warning" sx={alertSx}>
        <strong>Not found on the Master Roster.</strong> No roster entry has {franchise}. {entry} has the same plate number under a different franchise
        number. A plate number alone does not count, and neither does a name.
        {consequence}
      </Alert>
    );
  }

  if (check.reason === 'no_franchise') {
    return (
      <Alert severity="warning" sx={alertSx}>
        <strong>Not checked: no franchise number.</strong> The application has no franchise number to compare with the roster. Look for it on the MTOP permit.
        {consequence}
      </Alert>
    );
  }

  return (
    <Alert severity="warning" sx={alertSx}>
      <strong>Not found on the Master Roster.</strong> No roster entry has {franchise}. A plate number or a name alone does not count.
      {consequence}
    </Alert>
  );
};
