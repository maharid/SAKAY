/**
 * What a Master Roster member is, for the people who read the roster. Three different facts that must never be mixed up:
 *   Registered   the member has a SAKAY driver account (the franchise number on the roster belongs to a driver who registered)
 *   Verified     the City LGU verified that driver for this TODA (the application was approved at the LGU's stage)
 *   Approval     for a member added AFTER the registration roster file: whether the LGU approved the entry (Pending / Approved / Rejected)
 * A member with no account is "Not registered"; a registered driver the LGU has not verified is only "Registered", never "Verified".
 */

export type RosterMemberState = 'verified' | 'registered' | 'not_registered';
export type RosterApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface RosterMemberDriver {
  /** a driver who has no account yet carries an id the screen made up ("roster-...") */
  id: string;
  franchiseNo?: string | null;
  /** the LGU's decision on this driver's application to this TODA */
  lguVerificationStatus?: string | null;
  accountStatus?: string | null;
}

/** The franchise number the way the roster check compares it: letters and numbers only, upper case. */
export function normalizeFranchiseNumber(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const NO_ACCOUNT = new Set(['Not Registered', 'Unregistered']);

/** A driver who really has an account (not a roster-only line). */
export function hasDriverAccount(driver: RosterMemberDriver | undefined): boolean {
  return Boolean(driver) && !String(driver!.id).startsWith('roster-') && !NO_ACCOUNT.has(String(driver!.accountStatus ?? ''));
}

export function rosterMemberState(driver: RosterMemberDriver | undefined): RosterMemberState {
  if (!hasDriverAccount(driver)) return 'not_registered';
  return driver!.lguVerificationStatus === 'Verified' ? 'verified' : 'registered';
}

export const ROSTER_MEMBER_STATE_LABEL: Record<RosterMemberState, string> = {
  verified: 'Verified',
  registered: 'Registered',
  not_registered: 'Not registered',
};

export const ROSTER_MEMBER_STATE_HINT: Record<RosterMemberState, string> = {
  verified: 'Registered in SAKAY and verified by the LGU',
  registered: 'Registered in SAKAY, not verified by the LGU yet',
  not_registered: 'No SAKAY driver account yet',
};

/** The driver of a roster entry, found by franchise number. */
export function driverForFranchise<T extends RosterMemberDriver>(franchise: string | null | undefined, drivers: T[]): T | undefined {
  const key = normalizeFranchiseNumber(franchise);
  if (!key) return undefined;
  // a real account wins over a roster-only line with the same number
  return drivers.find((d) => hasDriverAccount(d) && normalizeFranchiseNumber(d.franchiseNo) === key)
    ?? drivers.find((d) => normalizeFranchiseNumber(d.franchiseNo) === key);
}

export interface RosterEntryLike {
  franchise_number: string | null | undefined;
  status?: string | null;
  approval_status?: string | null;
}

export interface RosterCounts {
  /** active members */
  members: number;
  registered: number;
  verified: number;
  notRegistered: number;
  pendingApproval: number;
  rejected: number;
}

/** The numbers above the roster: what is true of the ACTIVE members. A verified driver is also counted as registered. */
export function rosterCounts<D extends RosterMemberDriver>(entries: RosterEntryLike[], drivers: D[]): RosterCounts {
  const out: RosterCounts = { members: 0, registered: 0, verified: 0, notRegistered: 0, pendingApproval: 0, rejected: 0 };
  for (const e of entries) {
    if (e.status === 'Left') continue;
    out.members += 1;
    const state = rosterMemberState(driverForFranchise(e.franchise_number, drivers));
    if (state === 'verified') {
      out.verified += 1;
      out.registered += 1;
    } else if (state === 'registered') out.registered += 1;
    else out.notRegistered += 1;
    if (e.approval_status === 'Pending') out.pendingApproval += 1;
    if (e.approval_status === 'Rejected') out.rejected += 1;
  }
  return out;
}

export const ROSTER_APPROVAL_LABEL: Record<RosterApprovalStatus, string> = {
  Pending: 'Awaiting LGU approval',
  Approved: 'Approved by the LGU',
  Rejected: 'Not approved by the LGU',
};
