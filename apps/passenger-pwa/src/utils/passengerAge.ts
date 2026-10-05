/** Rule 4.3: a passenger under this age cannot hold a verified account. The message and the check both read this one number. */
export const MIN_PASSENGER_AGE_YEARS = 12;

/** Whole years from a YYYY-MM-DD date of birth to `today`, or null when the date cannot be read. */
export function ageInYears(isoDate: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - year;
  const beforeBirthday = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age--;
  return age;
}

export const isUnderMinimumAge = (isoDate: string, today: Date = new Date()): boolean => {
  const age = ageInYears(isoDate, today);
  return age !== null && age < MIN_PASSENGER_AGE_YEARS;
};

/** The under-age message, with the age in it, in both languages. */
export const underAgeMessage = (language: 'tl' | 'en'): string =>
  language === 'tl'
    ? `Ang mga pasaherong wala pang ${MIN_PASSENGER_AGE_YEARS} taong gulang ay hindi maaaring magkaroon ng verified account.`
    : `Passengers under ${MIN_PASSENGER_AGE_YEARS} years old cannot hold a verified account.`;
