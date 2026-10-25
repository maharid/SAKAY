// The Privacy Policy and the Terms of Service of the LGU Administrator Portal.
//
// The project has written texts for drivers (apps/driver-pwa DriverPrivacyPolicy.tsx and DriverTermsOfService.tsx) and for passengers, and a shared privacy notice
// (packages/shared/src/config/privacyNotice.ts, retention figures in policyConfig.ts). It has NO text written for LGU administrators. So this file says only what
// those texts, the portal itself or the code already say, put in the words of an administrator, and invents nothing: no new promise, no new period, no new duty.
// Where a statement comes from is written next to it. What the project does not have is NOT filled in here (see the list at the end of the file).

export interface LegalSection {
  title: string;
  /** a paragraph at the top of the section */
  intro?: string;
  bullets?: string[];
  /** the smaller paragraph under the list */
  note?: string;
}

export interface LegalDocument {
  title: string;
  /** the line under the title (when the text was written, or what it is based on) */
  dateLine?: string;
  intro?: string;
  sections: LegalSection[];
}

/** Who receives a request about personal data: the LGU Transport Office of Calapan City (packages/shared PRIVACY_CONTACT, without the TODA Administrator, who is not an LGU administrator's contact). */
export const LGU_PRIVACY_CONTACT = 'the LGU Transport Office of Calapan City';

/**
 * The figures of the retention schedule (packages/shared/src/config/policyConfig.ts). They are handed in, not written here, so the policy can never say a different number
 * than the database enforces (utils/legalDocuments.ts passes the real ones; server/test/lguSettingsContent.test.ts checks the sentences against the shared notice).
 */
export interface RetentionFigures {
  noticeVersion: string;
  gpsDays: number;
  sessionDays: number;
  documentSupersededDays: number;
  documentRejectedDays: number;
  documentClosedMonths: number;
  closedRecordsYears: number;
}

export const buildPrivacyPolicy = (f: RetentionFigures): LegalDocument => ({
  title: 'Privacy Policy',
  // the retention periods and the rights are those of the privacy notice that drivers and passengers are shown
  dateLine: `The retention periods and your rights follow the SAKAY privacy notice, version ${f.noticeVersion}.`,
  intro:
    'This policy covers the SAKAY LGU Administrator Portal. It says what personal information you can see in it, why that information is used, who else receives it, how long SAKAY keeps it and what your rights are. It is put together from the privacy notice that SAKAY shows to drivers and passengers.',
  sections: [
    {
      // what each page of the portal lists (the sidebar), with the kinds of data the driver and passenger policies say SAKAY collects
      title: '1. What you can see in this portal',
      intro: 'As an LGU Administrator you can see the records that TODAs, drivers and passengers give to SAKAY:',
      bullets: [
        'TODA applications and accreditation records, with the documents the TODA uploaded',
        "Driver applications, with the photos of the Professional Driver's License, the Franchise/MTOP and the vehicle unit, and the details read from them",
        'Driver and passenger accounts: name and mobile number, and for drivers the profile photo',
        'Trips: pickup and drop-off places, route distance, fare, times and status, and the GPS route of a trip while it is live or under review',
        'Strikes, suspensions, appeals, incident reports and passenger feedback',
      ],
    },
    {
      // Driver Privacy Policy, section 2 (How We Use Your Information), and item F of the shared notice
      title: '2. Why this information is used',
      intro: 'It is used to:',
      bullets: [
        'Verify the identity and credential eligibility of drivers and TODAs',
        'Calculate exact fares under city regulations',
        'Monitor live rides for safety and dispute resolution',
        'Investigate submitted complaints or strike appeals',
        'Prevent unauthorized vehicle substitution and abuse',
        'Ensure compliance with LGU Transport Board rules',
      ],
      note: 'The information is not used for anything else.',
    },
    {
      // Driver Privacy Policy, section 4 (Sharing Your Information), and item H of the shared notice
      title: '3. Who receives it',
      intro:
        "A driver's information is accessible exclusively to the driver's TODA Administrator, the LGU Administrators and the assigned commuter (limited to name, photo and franchise number during active trips). SAKAY never sells personal data to third parties.",
      note: "Two services work for SAKAY: an OCR service (Google Gemini API) reads the photos of a driver's license and MTOP to fill in the form, and only the details needed are kept; an SMS provider sends codes and messages.",
    },
    {
      // item G of the shared notice, with the figures of packages/shared/src/config/policyConfig.ts
      title: '4. How long it is kept',
      bullets: [
        `GPS locations of trips: ${f.gpsDays} days after they are recorded; longer only if the trip is part of an open complaint, dispute or investigation, until the case is closed.`,
        `Session and connection records: ${f.sessionDays} days. One-time codes (OTP) are never stored.`,
        `Document photos: deleted ${f.documentSupersededDays} days after they are replaced, ${f.documentRejectedDays} days after an application is rejected, and ${f.documentClosedMonths} months after an account is closed (longer only while a case is open).`,
        `Strike, suspension, deactivation and exemption records: while the account is active and for ${f.closedRecordsYears} years after it is closed, after which the name and other identifiers are removed.`,
      ],
      note: "The records of administrators' actions are kept as the Data Protection Officer decides.",
    },
    {
      // Account Management page (name, e-mail, contact number) and the Audit Logs page
      title: '5. Your account and the audit log',
      intro:
        'Your name, e-mail address and contact number are kept on your administrator record, and you can change them under Account Management. Administrative actions taken in this portal are recorded in the audit log, with who did them and when.',
    },
    {
      // item I of the shared notice
      title: '6. Your rights',
      intro: `You have the right to be informed, to see and correct your personal data, to object to its use, and to ask for it to be erased or blocked when keeping it is no longer necessary or is unlawful. Write to ${LGU_PRIVACY_CONTACT}. You may also complain to the National Privacy Commission.`,
    },
    {
      // Driver Privacy Policy, section 8 (Contact)
      title: '7. Contact',
      intro: 'For questions about this policy, contact the Calapan City LGU Transport Board.',
    },
  ],
});

export const TERMS_OF_SERVICE: LegalDocument = {
  title: 'Terms of Service',
  intro: 'These terms cover the use of the SAKAY LGU Administrator Portal.',
  sections: [
    {
      // what the portal enforces when someone signs in (contexts/AuthContext.tsx)
      title: '1. Who may use this portal',
      intro: 'Only LGU Administrators with an Active administrator record can sign in. An account that is suspended cannot sign in.',
    },
    {
      // the Audit Logs page
      title: '2. Your actions are recorded',
      intro: 'Administrative actions taken in this portal are recorded in the audit log, with who did them and when.',
    },
    {
      // Driver Terms of Service, sections 3 (Fare Structure), 6 (Strike System and Penalties) and 8 (Suspension and Deactivation)
      title: '3. The rules you apply',
      intro:
        'SAKAY applies the official fare rates set by the Calapan City LGU, and the strike system, suspensions and deactivations described in the Terms of Service shown to drivers. Deactivations require formal administrative review from the TODA Board and the LGU Transport Board.',
    },
    {
      // Driver Terms of Service, section 9 (Changes to These Terms)
      title: '4. Changes to these terms',
      intro: 'SAKAY or the LGU may update these terms periodically.',
    },
    {
      // Driver Terms of Service, section 10 (Contact)
      title: '5. Contact',
      intro: 'For inquiries regarding these terms, contact the Calapan City LGU Transport Board.',
    },
  ],
};

// NOT in the project, so NOT written here (to be given by the City Transport Office / the Data Protection Officer):
//  - the name and contact of the Data Protection Officer (privacyNotice.ts says they are "added when the LGU names them");
//  - Terms of Service written for LGU administrators (duties, acceptable use, what happens on misuse);
//  - the date an administrators' privacy policy or terms were approved, and how long the records of administrators' actions are kept.
