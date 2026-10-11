/** The longest message the quick-message sheet will hand to the SMS app (one standard text) */
export const MAX_QUICK_MESSAGE_LENGTH = 160;

/**
 * The link that opens the phone's SMS app with the message already typed. Returns null when there is nothing to send or nobody to send it to
 * (no digits in the number, an empty message), so a screen can refuse instead of opening an empty draft.
 */
export function buildSmsHref(phone: string | null | undefined, message: string | null | undefined): string | null {
  const to = (phone ?? '').replace(/[^\d+]/g, '');
  const body = (message ?? '').trim().slice(0, MAX_QUICK_MESSAGE_LENGTH);
  if (!/\d/.test(to) || !body) return null;
  return `sms:${to}?body=${encodeURIComponent(body)}`;
}
