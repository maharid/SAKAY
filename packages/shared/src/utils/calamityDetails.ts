import type { ActiveCalamity } from './tripSafety';

type Language = 'en' | 'tl';

/** What an emergency declaration changes, in words, for the LGU portal's panel and for the banner of both apps (the same sentences everywhere) */
export interface CalamityDetails {
  /** What is paused while it lasts */
  suspended: string;
  /** What is never paused */
  stillEnforced: string;
  /** Who it applies to */
  affected: string;
  /** Where it applies */
  coverage: string;
  /** Since when, and until when */
  duration: string;
}

const MANILA = 'Asia/Manila';

/** "Nov 2, 2026, 8:00 PM" in Philippine time (the same in every app, whatever the device's time zone) */
export function formatCalamityMoment(iso: string | undefined | null, language: Language = 'en'): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(language === 'tl' ? 'fil-PH' : 'en-PH', { timeZone: MANILA, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The effects of a declaration. A declaration does two things and no more: it publishes the announcement and it pauses the strikes (platform-wide, for drivers and passengers),
 * so that is all it says is suspended. Serious and safety violations are never paused.
 */
export function calamityDetails(calamity: Pick<ActiveCalamity, 'scope' | 'declaredAt' | 'expectedEndAt'>, language: Language = 'en'): CalamityDetails {
  const tl = language === 'tl';
  const all = calamity.scope === 'ALL';
  return {
    suspended: all
      ? tl ? 'Ang bilang ng strike sa lahat ng paglabag na maaaring i-pause' : 'Strikes for every violation that can be paused'
      : tl ? 'Ang bilang ng strike sa pagkansela, paghinto at hindi pagsipot' : 'Strikes for cancellations, stalls and no-shows',
    stillEnforced: tl ? 'Ang mga seryoso at pangkaligtasang paglabag ay patuloy na ipinapatupad' : 'Serious and safety violations are always enforced',
    affected: tl ? 'Lahat ng driver at pasahero' : 'All drivers and all passengers',
    coverage: tl ? 'Buong platform: bawat TODA at bawat sakop na lugar' : 'The whole platform: every TODA and every service area',
    duration: calamity.expectedEndAt
      ? tl
        ? `Mula ${formatCalamityMoment(calamity.declaredAt, 'tl')} hanggang ${formatCalamityMoment(calamity.expectedEndAt, 'tl')} (inaasahan)`
        : `From ${formatCalamityMoment(calamity.declaredAt)} until ${formatCalamityMoment(calamity.expectedEndAt)} (expected)`
      : tl
        ? `Mula ${formatCalamityMoment(calamity.declaredAt, 'tl')}, hanggang ipahayag ng LGU na tapos na ito`
        : `Since ${formatCalamityMoment(calamity.declaredAt)}, until the LGU Administrator ends it`,
  };
}

/** The date ("YYYY-MM-DD") of a moment in Philippine time: what the date field of the declaration form holds */
export function manilaDateOf(iso: string | undefined | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA', { timeZone: MANILA });
}

/** The end of a day in Philippine time (23:59) as a moment, for an "expected end" chosen as a date */
export function endOfManilaDay(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const moment = new Date(`${date}T23:59:00+08:00`);
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}
