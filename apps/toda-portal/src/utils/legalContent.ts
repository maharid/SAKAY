// The Privacy Policy and the Terms of Service as the SAKAY Driver App shows them, in English and in Tagalog, word for word and in the same order.
//
// Sources:
//   apps/driver-pwa/src/features/account-management/components/DriverPrivacyPolicy.tsx
//   apps/driver-pwa/src/features/account-management/components/DriverTermsOfService.tsx
//   apps/driver-pwa/src/utils/LanguageContext.tsx  (the titles and the "Last updated" line)
// Items F to I of the privacy policy (why, how long, who receives it, your rights) are not written here: the Settings page adds them from @sakay/shared,
// in the chosen language, exactly as the Driver App does. server/test/todaSettingsContent.test.ts reads the Driver App's files and fails if any line below
// stops matching them, so the two cannot drift apart without somebody noticing. The Tagalog of the Driver App is kept as it is, including the headings
// of its Privacy Policy, which do not all say what the English headings say.
//
// In a text, **words between double stars** are shown in bold.

import type { PortalLanguage } from './language';
import { PRIVACY_POLICY_TL, TERMS_OF_SERVICE_TL } from './legalContentTagalog';

export interface LegalItem {
  id: string;
  title: string;
  desc: string;
}

export interface LegalSection {
  title: string;
  /** a paragraph at the top of the section */
  intro?: string;
  /** the expandable lines of the section (privacy policy, section 1) */
  items?: LegalItem[];
  bullets?: string[];
  table?: { head: string[]; rows: string[][] };
  /** the smaller paragraph under the list or the table */
  note?: string;
}

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  intro?: string;
  sections: LegalSection[];
}

const PRIVACY_POLICY_EN: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: 'Last updated: July 2026',
  intro: 'Your privacy matters to us. This policy explains what information SAKAY collects from you as a driver, how it is used, stored, and protected.',
  sections: [
    {
      title: '1. Information We Collect',
      intro:
        'To operate SAKAY and ensure passenger safety, we collect and use the following. Items F to I say why, for how long, with whom it is shared, and what your rights are:',
      items: [
        { id: 'A', title: 'A. Personal Information', desc: 'Name, birth date, mobile number, password, and profile photo.' },
        {
          id: 'B',
          title: 'B. Verification Documents',
          desc: "Photos of your Professional Driver's License, Franchise/MTOP, and vehicle unit with sidecar body number, analyzed via OCR.",
        },
        {
          id: 'C',
          title: 'C. Location (GPS Data)',
          desc: 'Real-time GPS telemetry while Online or executing a dispatch to monitor passenger route safety.',
        },
        {
          id: 'D',
          title: 'D. Trip Information',
          desc: 'Pickup and drop-off coordinates, route distance in kilometers, calculated fare, timestamps, and status.',
        },
        {
          id: 'E',
          title: 'E. Device and System Data',
          desc: 'Sign-in records, the times you are Online and Offline, and whether location is allowed, to protect against fraud and account misuse. The device model and operating system are not collected.',
        },
      ],
    },
    {
      title: '2. How We Use Your Information',
      intro: 'We process your data to:',
      bullets: [
        'Verify your identity and credential eligibility',
        'Match you with relevant TODA passenger dispatches',
        'Calculate exact fares under city regulations',
        'Monitor live rides for safety and dispute resolution',
        'Record earnings summaries and historical trip logs',
        'Investigate submitted complaints or strike appeals',
        'Prevent unauthorized vehicle substitution and abuse',
        'Ensure compliance with LGU Transport Board rules',
      ],
    },
    {
      title: '3. How We Use Location',
      intro: 'Location (GPS) is required for:',
      bullets: [
        'Dispatching nearby trip requests',
        'Tracking route progress in real time',
        'Monitoring CPSD compliance and security',
        'Protecting both commuters and drivers',
      ],
      note: 'GPS route telemetry is retained for up to **90 days**, unless required for ongoing investigations.',
    },
    {
      title: '4. Sharing Your Information',
      intro:
        'Accessible exclusively to your TODA Administrator, LGU Administrator, and the assigned commuter (limited to name, photo, and franchise number during active trips). We never sell your data to third parties.',
    },
    {
      title: '5. Data Storage and Deletion',
      intro: 'Uploaded license and registration document images are stored encrypted and permanently deleted once the regulatory verification window concludes.',
    },
    {
      title: '6. Your Rights',
      bullets: [
        'Access personal information on file',
        'Request copies of historical account data',
        'Request corrections of inaccurate records',
        'Request data deletion under the Data Privacy Act of 2012 (RA 10173)',
      ],
    },
    {
      title: '7. Data Security',
      intro: 'We utilize encrypted storage, SSL transport security, and multi-factor administrative access controls to safeguard all driver records.',
    },
    {
      title: '8. Contact',
      intro: 'For questions regarding your privacy rights, contact your TODA Administrator or the Calapan City LGU Transport Board.',
    },
  ],
};

const TERMS_OF_SERVICE_EN: LegalDocument = {
  title: 'Terms of Service',
  lastUpdated: 'Last updated: July 2026',
  sections: [
    {
      title: '1. Eligibility',
      intro: 'To use SAKAY as a driver, you must meet all of the following:',
      bullets: [
        'Registered and active member of a participating TODA',
        "Hold a valid, unexpired Driver's License",
        'Hold a valid Franchise/MTOP registered under your TODA',
        'Approved and verified by TODA and LGU Administrators',
      ],
      note: 'An account that has not yet been approved by the LGU cannot go Online or receive bookings, even after all documents have been submitted to your TODA.',
    },
    {
      title: '2. Accuracy of Information',
      intro: 'You are responsible for making sure all information you submit is accurate, complete, and up to date.',
      note: 'Submitting false, outdated, or fake documents may result in rejection of your application, suspension, or permanent deactivation of your account.',
    },
    {
      title: '3. Fare Structure',
      intro:
        'SAKAY strictly implements official fare rates set by the Calapan City LGU and your TODA. All payment must be made in cash directly after the ride. Charging excess fares or demanding unofficial fees is strictly prohibited and subject to penalties.',
    },
    {
      title: '4. Accepting a Booking',
      intro: 'Once you accept a booking:',
      bullets: [
        'Proceed to the pickup location right away.',
        "Follow the booking's designated pickup and drop-off points.",
        "Never request extra payment that isn't displayed by the system.",
      ],
    },
    {
      title: '5. Cancelling a Booking',
      intro: 'Frequent or unjustified cancellations may result in:',
      bullets: ['Strikes recorded against your driver account'],
    },
    {
      title: '6. Strike System and Penalties',
      intro: 'Strikes accumulate within a rolling 90-day period:',
      table: {
        head: ['Total Strikes', 'Consequence'],
        rows: [
          ['1', 'Warning Notification'],
          ['3', 'Administrative Review'],
          ['5', '7-Day Suspension'],
          ['8', '30-Day Suspension'],
          ['10', 'Permanent Deactivation (LGU Review)'],
        ],
      },
      note: 'Severe offenses (harassment, physical altercation, driving under the influence) will result in immediate suspension pending formal investigation.',
    },
    {
      title: '7. Driver Conduct',
      bullets: [
        'Treat every passenger with respect, fairness, and courtesy',
        'Adhere strictly to traffic rules and city transport ordinances',
        'Keep GPS and location permissions active while online',
      ],
    },
    {
      title: '8. Suspension and Deactivation',
      intro:
        'Suspensions temporarily block dispatch access for the set duration. Deactivations require formal administrative review from your TODA Board and LGU Transport Board.',
    },
    {
      title: '9. Changes to These Terms',
      intro: 'SAKAY, your TODA, or the LGU may update these terms periodically. Key updates will be highlighted within the driver app.',
    },
    {
      title: '10. Contact',
      intro: 'For inquiries regarding these terms, contact your TODA Administrator or the Calapan City LGU Transport Board.',
    },
  ],
};

/** The documents in each language. */
export const PRIVACY_POLICY: Record<PortalLanguage, LegalDocument> = { en: PRIVACY_POLICY_EN, tl: PRIVACY_POLICY_TL };
export const TERMS_OF_SERVICE: Record<PortalLanguage, LegalDocument> = { en: TERMS_OF_SERVICE_EN, tl: TERMS_OF_SERVICE_TL };
