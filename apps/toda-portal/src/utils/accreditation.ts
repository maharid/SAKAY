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
