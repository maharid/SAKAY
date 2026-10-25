// What the Settings page says about SAKAY. Every line comes from the project itself; nothing is made up:
//  - the first sentence of the description and the developers' names come from the title page of the SAKAY paper (August 2026), as in the TODA portal's About page
//    (apps/toda-portal/src/utils/appInfo.ts); the second sentence lists what this portal's own menu offers;
//  - the e-mail address is the one the project team gave for questions and feedback (the TODA portal uses the same one).
// The portal has no release version of its own (its package version is the unset 0.0.0), so none is shown.
// server/test/lguSettingsContent.test.ts fails if the facts shared with the TODA portal stop matching.

export const ABOUT_SAKAY = {
  name: 'SAKAY',
  portal: 'LGU Administrator Portal',
  description:
    'SAKAY is a mobile and web-based tricycle booking system for Calapan City, with ride sharing and transportation reports. This portal is where LGU administrators review TODA and driver applications, look after drivers and passengers, follow trips and incident reports, set fares and the service area, publish announcements and read the reports and analytics.',
  developers: ['Via Bianca A. Celis', 'Janna Marion S. Del Mundo', 'Mark R. Payo', 'Beah M. Rocero'],
} as const;

/** Where the SAKAY team receives questions and feedback. */
export const SUPPORT_EMAIL = 'teamsakay@gmail.com';
