import type { TodaProfile } from '../types/toda';

export type AccreditationStatus = TodaProfile['accreditationStatus'];

/** Driver, roster and monitoring features stay locked until the LGU approves the accreditation (checklist B1). */
export const isTodaLocked = (status: AccreditationStatus | string | undefined | null): boolean => status !== undefined && status !== null && status !== 'Active';

/** The status as the person reads it, and its colours */
export function accreditationChip(status: AccreditationStatus): { label: string; bg: string; color: string } {
  switch (status) {
    case 'Active':
      return { label: 'Accredited Active', bg: '#E6F4EA', color: '#1E8E3E' };
    case 'Resubmission Required':
      return { label: 'Returned for correction', bg: '#FEE2E2', color: '#B91C1C' };
    case 'Deactivated':
      return { label: 'Declined / deactivated', bg: '#FEE2E2', color: '#B91C1C' };
    case 'Suspended':
      return { label: 'Suspended', bg: '#FEE2E2', color: '#B91C1C' };
    default:
      return { label: 'Pending Verification', bg: '#FEF3C7', color: '#B06000' };
  }
}

/** The status of one compliance file */
export function documentChip(status: AccreditationStatus, renewalPending: boolean): { label: string; bg: string; color: string } {
  if (status === 'Active') return renewalPending ? { label: 'Renewal sent to the LGU', bg: '#FEF3C7', color: '#B06000' } : { label: 'Verified by LGU', bg: '#E6F4EA', color: '#1E8E3E' };
  if (status === 'Resubmission Required') return { label: 'Returned: correct it', bg: '#FEE2E2', color: '#B91C1C' };
  if (status === 'Deactivated' || status === 'Suspended') return { label: 'Not accepted', bg: '#FEE2E2', color: '#B91C1C' };
  return { label: 'Pending Verification', bg: '#FEF3C7', color: '#B06000' };
}

/** How a status is drawn: good news, waiting, or a problem to fix. The words always say the same thing; the tone only picks the colour and icon. */
export type StatusTone = 'success' | 'warning' | 'danger';

export function accreditationTone(status: AccreditationStatus): StatusTone {
  if (status === 'Active') return 'success';
  if (status === 'Resubmission Required' || status === 'Deactivated' || status === 'Suspended') return 'danger';
  return 'warning';
}

export function documentTone(status: AccreditationStatus, renewalPending: boolean): StatusTone {
  if (status === 'Active') return renewalPending ? 'warning' : 'success';
  if (status === 'Resubmission Required' || status === 'Deactivated' || status === 'Suspended') return 'danger';
  return 'warning';
}

export type ComplianceDocumentKind = 'clearance' | 'roster' | 'bylaws';

/**
 * What to say under one compliance file. The database keeps ONE status for the whole TODA (toda_status) and one marker for a renewed Barangay Clearance waiting for
 * the LGU (renewal_submitted_at). So:
 *  - the Barangay Clearance is "Verified by LGU" only while nothing new is waiting, and "Renewal sent to the LGU" until the LGU records it;
 *  - the roster and the bylaws have no review status of their own once the TODA is Active, and a file replaced after the approval was never looked at by the LGU,
 *    so they are only said to be "On file" (never "Verified by LGU", and never "waiting" because of the clearance);
 *  - while the application itself is pending or returned, every file shares the application's status.
 */
export function complianceDocumentStatus(
  kind: ComplianceDocumentKind,
  status: AccreditationStatus,
  renewalPending: boolean
): { label: string; tone: StatusTone | 'neutral' } {
  if (status === 'Active') {
    if (kind === 'clearance') return { label: documentChip(status, renewalPending).label, tone: documentTone(status, renewalPending) };
    return { label: 'On file', tone: 'neutral' };
  }
  return { label: documentChip(status, false).label, tone: documentTone(status, false) };
}

/**
 * The files are stored as "<time in milliseconds>_<name>", so a replaced file carries the day it was sent. null when the name has no such start
 * (then the page falls back to the date it already had).
 */
export function submittedDateOfStoredFile(fileName: string | null | undefined): string | null {
  const match = /^(\d{13})_/.exec(fileName ?? '');
  if (!match) return null;
  const when = new Date(Number(match[1]));
  const year = when.getUTCFullYear();
  if (Number.isNaN(when.getTime()) || year < 2020 || year > 2100) return null;
  return when.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Whole days from today (Manila) to an ISO instant; negative once it has passed; null without a date */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const ms = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return Math.round((ms(day(t)) - ms(day(now))) / 86_400_000);
}

/** The reminder window of Rule 24.4: 30 days before the accreditation expires */
export const RENEWAL_WINDOW_DAYS = 30;
