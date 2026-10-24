// The texts of the TODA portal that have a Tagalog version.
//
// Every Tagalog line below is copied word for word from the Driver App, which is where SAKAY's Tagalog texts live (apps/driver-pwa/src: the Settings page, the
// Change Password page). Nothing here is newly translated. A text with no Tagalog line is shown in English, whatever the chosen language.
// server/test/todaSettingsContent.test.ts reads the Driver App files and fails if a Tagalog line here is not in them.
//
// The Privacy Policy and the Terms of Service are not in this table: they are whole documents with their own Tagalog versions (utils/legalContent.ts).

import type { PortalLanguage } from './language';

const EN = {
  'nav.preferences': 'Preferences',
  'nav.account': 'Account & Security',
  'nav.support': 'Support & Feedback',
  'nav.legal': 'Legal & Privacy',
  'nav.about': 'About SAKAY',

  'language.title': 'Language',
  'language.description':
    'Choose the language of this portal. Your choice is saved on this device. Screens that have no Tagalog text yet stay in English.',

  'password.change': 'Change Password',
  'password.new': 'New password',
  'password.confirm': 'Confirm new password',
  'password.rules': 'The password does not meet all four rules below.',
  'password.mismatch': 'The two passwords do not match.',
  'password.changed': 'Your password was changed.',

  'logout.title': 'Log out',
  'logout.button': 'Log Out',

  'legal.privacy': 'Privacy Policy',
  'legal.terms': 'Terms of Service',

  'feedback.comments': 'Additional Comments (Optional)',
  'feedback.placeholder': 'Type your comment or suggestion here...',
} as const;

export type TranslationKey = keyof typeof EN;

/** Only the texts the Driver App already has in Tagalog. */
const TL: Partial<Record<TranslationKey, string>> = {
  'nav.preferences': 'Mga Kagustuhan',
  'nav.account': 'Seguridad ng Account',
  'nav.support': 'Suporta at Feedback',
  'nav.legal': 'Legal at Patakaran',

  'language.title': 'Wika (Language)',

  'password.change': 'Palitan ang Password',
  'password.new': 'Bagong Password',
  'password.confirm': 'Kumpirmahin ang Bagong Password',
  'password.rules': 'Pakitiyak na natutugunan ng bagong password ang lahat ng pamantayan sa ibaba.',
  'password.mismatch': 'Hindi magkatugma ang bagong password at kumpirmasyon.',
  'password.changed': 'Matagumpay na napalitan ang iyong password!',

  'logout.title': 'Mag-log Out',
  'logout.button': 'Mag-log Out',

  'legal.privacy': 'Patakaran sa Privacy',
  'legal.terms': 'Kasunduan sa Serbisyo',

  'feedback.comments': 'Karagdagang Komento (Opsyonal)',
  'feedback.placeholder': 'Isulat dito ang iyong komento o suhestiyon...',
};

export function translate(language: PortalLanguage, key: TranslationKey): string {
  return (language === 'tl' ? TL[key] : undefined) ?? EN[key];
}

/** For the test: the Tagalog lines of the table. */
export const TAGALOG_TEXTS: Readonly<Partial<Record<TranslationKey, string>>> = TL;
