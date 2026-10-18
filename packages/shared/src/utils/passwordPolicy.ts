/**
 * The password rules of the Passenger and Driver apps: at least 8 characters, upper and lower case letters, a number and a symbol, and at
 * most 72 bytes (the login system only reads the first 72 bytes of a password, so a longer one would be silently cut short).
 * The registration screens show the same four rules as a checklist; the server checks them again before it sets a recovered password
 * (server/src/utils/passwordPolicy.ts, kept in step by server/test/passwordReset.test.ts).
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

export function checkPassword(password: string): PasswordCheck {
  const length = password.length >= PASSWORD_MIN_LENGTH;
  const letters = /[A-Z]/.test(password) && /[a-z]/.test(password);
  const digit = /\d/.test(password);
  const symbol = /[^A-Za-z0-9]/.test(password);
  const tooLong = new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES;
  return { length, letters, digit, symbol, tooLong, ok: length && letters && digit && symbol && !tooLong };
}
