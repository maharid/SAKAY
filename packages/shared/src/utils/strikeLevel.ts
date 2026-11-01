import { STRIKE_LADDER } from '../config/policyConfig';

/**
 * Where the number of active strikes puts a person on the strike ladder (Sections 20 and 21; the lengths come from policyConfig): the level's name and what the next level is and
 * how far away. It only words the ladder for a count; the account's real restriction is set by the database.
 */

export type StrikeLevelLang = 'en' | 'tl';

export interface StrikeLevel {
  /** 0 = good standing ... 5 = deactivation review */
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  /** the number of strikes at which the ladder ends */
  max: number;
  /** the next step up the ladder: how many more active strikes reach it and what it is (null at the top) */
  next: { remaining: number; tier: 1 | 2 | 3 | 4 | 5 } | null;
}

const STEPS: Array<{ at: number; tier: 1 | 2 | 3 | 4 | 5 }> = [
  { at: STRIKE_LADDER.WARNING_AT, tier: 1 },
  { at: STRIKE_LADDER.ADMIN_REVIEW_AT, tier: 2 },
  { at: STRIKE_LADDER.SUSPENSION_1_AT, tier: 3 },
  { at: STRIKE_LADDER.SUSPENSION_2_AT, tier: 4 },
  { at: STRIKE_LADDER.DEACTIVATION_AT, tier: 5 },
];

export function strikeLevel(activeStrikes: number): StrikeLevel {
  const n = Math.max(0, Math.floor(Number.isFinite(activeStrikes) ? activeStrikes : 0));
  let tier: StrikeLevel['tier'] = 0;
  for (const step of STEPS) if (n >= step.at) tier = step.tier;
  const next = STEPS.find((step) => n < step.at);
  return { tier, max: STRIKE_LADDER.DEACTIVATION_AT, next: next ? { remaining: next.at - n, tier: next.tier } : null };
}

const NAMES: Record<StrikeLevel['tier'], { en: string; tl: string }> = {
  0: { en: 'Good standing', tl: 'Maayos ang katayuan' },
  1: { en: 'Warning', tl: 'Babala' },
  2: { en: 'Administrative review', tl: 'Administratibong pagsusuri' },
  3: { en: `${STRIKE_LADDER.SUSPENSION_1_DAYS}-day suspension`, tl: `${STRIKE_LADDER.SUSPENSION_1_DAYS}-araw na suspensyon` },
  4: { en: `${STRIKE_LADDER.SUSPENSION_2_DAYS}-day suspension`, tl: `${STRIKE_LADDER.SUSPENSION_2_DAYS}-araw na suspensyon` },
  5: { en: 'Deactivation review', tl: 'Pagsusuri para sa deactivation' },
};

export function strikeLevelName(tier: StrikeLevel['tier'], lang: StrikeLevelLang): string {
  return NAMES[tier][lang];
}

/** "2 more active strikes lead to a 7-day suspension." / "At the highest level." / "No active strikes." */
export function strikeNextStepText(level: StrikeLevel, activeStrikes: number, lang: StrikeLevelLang): string {
  const tl = lang === 'tl';
  if (!level.next) return tl ? 'Ito na ang pinakamataas na antas.' : 'This is the highest level.';
  const { remaining, tier } = level.next;
  const name = strikeLevelName(tier, lang).toLowerCase();
  if (activeStrikes <= 0) return tl ? `Walang aktibong strike. Ang ${name} ay nasa ${STEPS[tier - 1].at} strike.` : `No active strikes. ${name.charAt(0).toUpperCase()}${name.slice(1)} starts at ${STEPS[tier - 1].at}.`;
  return tl
    ? `${remaining} pang aktibong strike bago ang ${name}.`
    : `${remaining} more active strike${remaining === 1 ? '' : 's'} lead${remaining === 1 ? 's' : ''} to ${name}.`;
}
