/**
 * The password rules of the Passenger and Driver apps, checked here as well because the browser's check can be skipped.
 * They are the four rules the registration screens show (at least 8 characters, upper and lower case, a number, a symbol), plus an upper
 * limit: the login system only reads the first 72 bytes of a password, so a longer one would be silently cut short.
 * (packages/shared/src/utils/passwordPolicy.ts is the same rule for the screens; server/test/passwordReset.test.ts checks they agree.)
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordCheck {
  length: boolean;
  letters: boolean;
  digit: boolean;
  symbol: boolean;
  tooLong: boolean;
  ok: boolean;
}

export function checkPassword(password: unknown): PasswordCheck {
  const p = typeof password === 'string' ? password : '';
  const length = p.length >= PASSWORD_MIN_LENGTH;
  const letters = /[A-Z]/.test(p) && /[a-z]/.test(p);
  const digit = /\d/.test(p);
  const symbol = /[^A-Za-z0-9]/.test(p);
  const tooLong = Buffer.byteLength(p, 'utf8') > PASSWORD_MAX_BYTES;
  return { length, letters, digit, symbol, tooLong, ok: length && letters && digit && symbol && !tooLong };
}
