// The language of the TODA portal.
//
// The portal's screens are written in English only: it has no translation files (unlike the Driver and Passenger apps, which carry English and Filipino texts).
// So English is the only language offered, and it is the default. The choice is still kept the way those apps keep theirs (one key in the browser's own storage),
// and a stored value that is not an AVAILABLE language is ignored, so adding a language later means adding its translations and one line to LANGUAGE_OPTIONS.

export type PortalLanguage = 'en';

export interface LanguageOption {
  code: PortalLanguage;
  /** the name as the people who speak it write it */
  name: string;
}

/** Only languages whose texts really exist in the portal belong here. */
export const LANGUAGE_OPTIONS: LanguageOption[] = [{ code: 'en', name: 'English' }];

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
