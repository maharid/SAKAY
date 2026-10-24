// What the Settings page says about SAKAY. Every line is taken from the project's own documents; nothing is made up:
//  - the title, the school and the developers are on the title page of the SAKAY capstone paper (August 2026);
//  - the privacy notice version and its "your rights" text (which names who to write to) come from the shared policy files the Driver and Passenger apps also use.
// The portal has no release version of its own (its package version is the unset 0.0.0), so none is shown.

import { PRIVACY_NOTICE_VERSION, privacyNoticeExtraItems } from '@sakay/shared';

export const ABOUT_SAKAY = {
  name: 'SAKAY',
  portal: 'TODA Administrator Portal',
  title: 'SAKAY: A Mobile and Web-Based Supplementary Tricycle Booking System with Ride Sharing and Descriptive Transportation Analytics for Calapan City',
  project: 'Capstone project for the Bachelor of Science in Information Technology',
  school: 'School of Information Technology, Divine Word College of Calapan, Inc., Gov. Infantado St., Calapan City, Oriental Mindoro',
  completed: 'August 2026',
  developers: ['Via Bianca A. Celis', 'Janna Marion S. Del Mundo', 'Mark R. Payo', 'Beah M. Rocero'],
} as const;

/** Who to ask for help. The portal already says this wherever the accreditation needs an answer from the City; no phone number or e-mail address is written anywhere in the project, so none is shown. */
export const SUPPORT_NOTE = "For questions about your TODA's accreditation, contact the City Transport & Franchising Office.";

/** The "your rights" part of the SAKAY privacy notice, word for word (the same text for drivers and passengers), without its letter ("I. "). */
const rights = privacyNoticeExtraItems('passenger', 'en').find((item) => item.id === 'I');

export const PRIVACY_INFO = {
  version: PRIVACY_NOTICE_VERSION,
  rightsTitle: rights ? rights.title.replace(/^[A-Z]\.\s*/, '') : 'Your rights',
  rightsText: rights?.desc ?? '',
} as const;
