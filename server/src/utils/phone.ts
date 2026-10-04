/**
 * Philippine mobile numbers: one place for normalising, comparing and masking them.
 * A subscriber is identified by the LAST TEN digits (9XXXXXXXXX), whatever prefix the number was typed or stored with
 * (+63..., 63..., 09..., 9...).
 */

/** Digits only. */
export function digitsOf(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** The subscriber part: the last ten digits, or '' when there are not ten digits. */
export function subscriberOf(raw: unknown): string {
  const d = digitsOf(raw);
  return d.length >= 10 ? d.slice(-10) : '';
}

/** +639XXXXXXXXX, the same normalisation the apps use. */
export function normalizePhone(raw: unknown): string {
  const d = digitsOf(raw);
  if (d.startsWith('639') && d.length === 12) return `+${d}`;
  if (d.startsWith('09') && d.length === 11) return `+63${d.slice(1)}`;
  if (d.startsWith('9') && d.length === 10) return `+63${d}`;
  if (d.length === 11) return `+63${d.slice(1)}`;
  return `+${d}`;
}

/** True when both values are valid numbers of the same subscriber. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = subscriberOf(a);
  return x !== '' && x === subscriberOf(b);
}

/** A Philippine mobile number is 10 digits starting with 9 once the country prefix is dropped. */
export function isPhMobile(raw: unknown): boolean {
  return /^9\d{9}$/.test(subscriberOf(raw));
}

/** +63917*****67: enough to recognise, not enough to use. For logs and error messages. */
export function maskPhone(raw: unknown): string {
  const s = subscriberOf(raw);
  if (!s) return '(invalid number)';
  return `+63${s.slice(0, 3)}*****${s.slice(-2)}`;
}
