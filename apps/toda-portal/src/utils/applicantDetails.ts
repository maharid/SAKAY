// Small helpers for showing an applicant's details in the review window the same way the LGU Portal shows a driver's (dates as "Jan 11, 2027",
// "Not recorded" for what is missing, an expiry that stands out).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date from the database ("2027-01-11") or an ISO timestamp, as a calendar date without any time-zone shift. */
function toCalendarDate(value?: string | null): Date | null {
  if (!value) return null;
  const plain = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Jan 11, 2027", or "Not recorded" when there is no date. */
export function formatDocDate(value?: string | null): string {
  const date = toCalendarDate(value);
  return date ? `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : 'Not recorded';
}

/** "Oct 22, 2026, 9:51 PM" (Manila time): when something happened. */
export function formatWhen(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : '';
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'unknown';

/** Whether a license / permit date has passed, runs out within 30 days, or is fine. */
export function expiryState(value?: string | null, now: Date = new Date()): { state: ExpiryState; days: number } {
  const date = toCalendarDate(value);
  if (!date) return { state: 'unknown', days: 0 };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { state: 'expired', days };
  if (days <= 30) return { state: 'soon', days };
  return { state: 'ok', days };
}

const words = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** True when the two names have at least one whole word in common (so a reordered or abbreviated name still counts). */
export function sharesNameWord(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;   // nothing to compare: say nothing
  const other = new Set(words(b));
  return words(a).some((w) => other.has(w));
}
