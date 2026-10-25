// The language of the LGU portal.
//
// The portal offers the same two languages as the Driver and Passenger apps: English and Tagalog. English is the default. The choice is kept the way those apps
// keep theirs: one key ("sakay_language", holding "en" or "tl") in the browser's own storage, and a stored value that is not one of the two is ignored.
//
// Not every screen of the portal has a Tagalog text yet. The texts that exist are the ones the Driver App already has (see utils/translations.ts);
// everything else stays in English instead of being translated here without review.

export type PortalLanguage = 'en' | 'tl';

export interface LanguageOption {
  code: PortalLanguage;
  /** the name as the people who speak it write it */
  name: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'tl', name: 'Tagalog' },
];

export const DEFAULT_LANGUAGE: PortalLanguage = 'en';

/** The same key the Driver and Passenger apps use for their own language choice (each app keeps its own copy: they run on different addresses). */
export const LANGUAGE_STORAGE_KEY = 'sakay_language';

const isAvailable = (value: unknown): value is PortalLanguage => LANGUAGE_OPTIONS.some((option) => option.code === value);

function storageOf(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage can be blocked (private window); the portal then simply uses the default
  }
}

export function readStoredLanguage(): PortalLanguage {
  const saved = storageOf()?.getItem(LANGUAGE_STORAGE_KEY);
  return isAvailable(saved) ? saved : DEFAULT_LANGUAGE;
}

export function storeLanguage(language: PortalLanguage): void {
  try {
    storageOf()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* the choice just is not remembered */
  }
}
