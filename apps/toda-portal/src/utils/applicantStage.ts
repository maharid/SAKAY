import type { DriverApplicant, TodaDriverMember } from '../types/toda';

/**
 * Where one driver's application to THIS TODA stands, from the two stages the database keeps on the affiliation (driver_toda_affiliation):
 * the TODA's endorsement and the City LGU's verification. While the TODA has not decided it is the TODA's stage; once the TODA endorsed it, it is the LGU's
 * decision: waiting ('Endorsed to LGU'), verified, returned or rejected. It used to be 'Endorsed to LGU' for ever, even after the LGU approved the driver.
 */
export function applicantStage(
  todaEndorsement: string | null | undefined,
  lguVerification: string | null | undefined
): DriverApplicant['todaStageStatus'] {
  if (todaEndorsement === 'Endorsed') {
    if (lguVerification === 'Approved') return 'Verified by LGU';
    if (lguVerification === 'Rejected') return 'Rejected by LGU';
    if (lguVerification === 'Resubmission Required') return 'Returned by LGU';
    return 'Endorsed to LGU';
  }
  if (todaEndorsement === 'Rejected') return 'Rejected';
  if (todaEndorsement === 'Resubmission Required') return 'Resubmission Required';
  return 'Awaiting Screening';
}

/**
 * The LGU's decision on a driver's affiliation with this TODA, for the Members list. The affiliation's own stage decides (a driver may be verified through another
 * TODA only); the driver's overall account status is only the fallback for a row that has no affiliation stage.
 */
export function memberLguStatus(row: { affiliation_lgu_status?: string | null; account_status?: string | null } | null | undefined): TodaDriverMember['lguVerificationStatus'] {
  switch (row?.affiliation_lgu_status) {
    case 'Approved': return 'Verified';
    case 'Rejected': return 'Rejected';
    case 'Resubmission Required': return 'Returned';
    case 'Pending': return 'Pending';
    default: return row?.account_status === 'Verified' ? 'Verified' : 'Pending';
  }
}
