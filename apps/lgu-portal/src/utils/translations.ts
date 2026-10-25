// The texts of the LGU portal that have a Tagalog version.
//
// Every Tagalog line below is copied word for word from the Driver App, which is where SAKAY's Tagalog texts live (apps/driver-pwa/src: the Settings page, the
// Additional Comments box). Nothing here is newly translated, and the table is built the same way as the TODA portal's (apps/toda-portal/src/utils/translations.ts).
// A text with no Tagalog line is shown in English, whatever the chosen language: that includes the Privacy Policy and the Terms of Service, which are written for
// administrators and exist in English only.
// server/test/lguSettingsContent.test.ts reads the Driver App files and fails if a Tagalog line here is not in them.

import type { PortalLanguage } from './language';

const EN = {
  'nav.preferences': 'Preferences',
  'nav.support': 'Help & Support',
  'nav.legal': 'Legal & Privacy',
  'nav.about': 'About SAKAY',

  'language.title': 'Language',
  'language.description':
    'Choose the language of this portal. Your choice is saved on this device. Screens that have no Tagalog text yet stay in English.',

  'feedback.comments': 'Additional comments (optional)',
  'feedback.placeholder': 'Type your comment or suggestion here...',
} as const;

export type TranslationKey = keyof typeof EN;

/** Only the texts the Driver App already has in Tagalog. */
const TL: Partial<Record<TranslationKey, string>> = {
  'nav.preferences': 'Mga Kagustuhan',
  'nav.legal': 'Legal at Patakaran',

  'language.title': 'Wika (Language)',

  'feedback.comments': 'Karagdagang Komento (Opsyonal)',
  'feedback.placeholder': 'Isulat dito ang iyong komento o suhestiyon...',
};

export function translate(language: PortalLanguage, key: TranslationKey): string {
  return (language === 'tl' ? TL[key] : undefined) ?? EN[key];
}

/** For the test: the Tagalog lines of the table. */
export const TAGALOG_TEXTS: Readonly<Partial<Record<TranslationKey, string>>> = TL;
