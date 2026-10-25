// What the Driver and Passenger apps say on their About SAKAY page. Every line comes from the project itself; nothing is made up:
//  - the first sentence of the description and the developers' names are the ones the TODA and LGU portals show (apps/toda-portal/src/utils/appInfo.ts):
//    they come from the title page of the SAKAY paper (August 2026);
//  - the sentence about each app lists only what that app's own screens offer;
//  - the e-mail address is the one the project team gave for questions and feedback (the portals use the same one).
// The apps have no release version of their own (their package version is the unset 0.0.0), so none is shown.

export type AboutSakayLanguage = 'tl' | 'en';
export type AboutSakayAudience = 'driver' | 'passenger';

export const ABOUT_SAKAY_DESCRIPTION: Record<AboutSakayLanguage, string> = {
  en: 'SAKAY is a mobile and web-based tricycle booking system for Calapan City, with ride sharing and transportation reports.',
  tl: 'Ang SAKAY ay isang mobile at web-based na sistema ng pag-book ng tricycle para sa Calapan City, na may ride sharing at mga ulat sa transportasyon.',
};

export const ABOUT_SAKAY_APP_LINE: Record<AboutSakayAudience, Record<AboutSakayLanguage, string>> = {
  driver: {
    en: 'This app is where drivers receive booking requests, follow their trips and see their earnings.',
    tl: 'Sa app na ito natatanggap ng mga drayber ang mga booking request, nasusundan ang kanilang mga biyahe at nakikita ang kanilang kita.',
  },
  passenger: {
    en: 'This app is where passengers book a tricycle, follow their trip and look back at their past trips.',
    tl: 'Sa app na ito nagbu-book ang mga pasahero ng tricycle, nasusundan ang kanilang biyahe at nakikita ang kanilang mga nakaraang biyahe.',
  },
};

export const ABOUT_SAKAY_DEVELOPERS = ['Via Bianca A. Celis', 'Janna Marion S. Del Mundo', 'Mark R. Payo', 'Beah M. Rocero'] as const;

/** Where the SAKAY team receives questions and feedback. */
export const ABOUT_SAKAY_EMAIL = 'teamsakay@gmail.com';
