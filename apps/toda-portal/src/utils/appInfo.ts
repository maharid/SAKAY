// What the Settings page says about SAKAY. Every line comes from the project itself; nothing is made up:
//  - the description and the developers' names come from the title page of the SAKAY paper (August 2026) and from the portal's own menu;
//  - the e-mail address is the one the project team gave for questions and feedback.
// The portal has no release version of its own (its package version is the unset 0.0.0), so none is shown.

export const ABOUT_SAKAY = {
  name: 'SAKAY',
  portal: 'TODA Administrator Portal',
  description:
    'SAKAY is a mobile and web-based tricycle booking system for Calapan City, with ride sharing and transportation reports. This portal is where TODA administrators review driver applications, manage their members and follow daily operations.',
  developers: ['Via Bianca A. Celis', 'Janna Marion S. Del Mundo', 'Mark R. Payo', 'Beah M. Rocero'],
} as const;

/** Where the SAKAY team receives questions and feedback. */
export const SUPPORT_EMAIL = 'teamsakay@gmail.com';

/** Who to ask about the accreditation. The portal already says this wherever an accreditation needs an answer from the City. */
export const ACCREDITATION_HELP = "For questions about your TODA's accreditation, contact the City Transport & Franchising Office.";
