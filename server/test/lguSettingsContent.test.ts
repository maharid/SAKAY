// LGU Settings: the texts of Legal & Privacy and About SAKAY.
//
// The LGU portal has no text of its own for administrators, so its Privacy Policy and Terms of Service are put together from what the project already says (the Driver
// App's texts, the shared privacy notice and its retention figures) and from what the portal does. This test keeps them honest:
//   - every retention period the LGU policy states is the figure of packages/shared/src/config/policyConfig.ts;
//   - the rights and the "records of administrators' actions" sentence are the shared notice's own words;
//   - the lines taken from the Driver App's Privacy Policy and Terms of Service are still there, word for word;
//   - the About page agrees with the TODA portal's (same e-mail address, same developers, same first sentence);
//   - nothing in the LGU texts is addressed to a driver or a passenger.
//   run:  cd server && npx tsx --test test/lguSettingsContent.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPrivacyPolicy, TERMS_OF_SERVICE, LGU_PRIVACY_CONTACT } from '../../apps/lgu-portal/src/utils/legalContent';
import type { LegalDocument } from '../../apps/lgu-portal/src/utils/legalContent';
import { ABOUT_SAKAY, SUPPORT_EMAIL } from '../../apps/lgu-portal/src/utils/appInfo';
import { ABOUT_SAKAY as TODA_ABOUT, SUPPORT_EMAIL as TODA_EMAIL } from '../../apps/toda-portal/src/utils/appInfo';
import {
  PRIVACY_NOTICE_VERSION,
  RETENTION_CLOSED_RECORDS_YEARS,
  RETENTION_DOC_CLOSED_MONTHS,
  RETENTION_DOC_REJECTED_DAYS,
  RETENTION_DOC_SUPERSEDED_DAYS,
  RETENTION_GPS_LOG_DAYS,
  RETENTION_SESSION_DAYS,
} from '../../packages/shared/src/config/policyConfig';
import { PRIVACY_CONTACT, privacyNoticeExtraItems } from '../../packages/shared/src/config/privacyNotice';

// the same figures apps/lgu-portal/src/utils/legalDocuments.ts hands in
const PRIVACY_POLICY = buildPrivacyPolicy({
  noticeVersion: PRIVACY_NOTICE_VERSION,
  gpsDays: RETENTION_GPS_LOG_DAYS,
  sessionDays: RETENTION_SESSION_DAYS,
  documentSupersededDays: RETENTION_DOC_SUPERSEDED_DAYS,
  documentRejectedDays: RETENTION_DOC_REJECTED_DAYS,
  documentClosedMonths: RETENTION_DOC_CLOSED_MONTHS,
  closedRecordsYears: RETENTION_CLOSED_RECORDS_YEARS,
});

const APPS = path.join(process.cwd(), '..', 'apps');
const DRIVER_ACCOUNT = path.join(APPS, 'driver-pwa', 'src', 'features', 'account-management', 'components');
const normalise = (raw: string) =>
  raw
    .replace(/\r\n/g, '\n')
    .replace(/<\/?strong>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
const DRIVER_PRIVACY = normalise(fs.readFileSync(path.join(DRIVER_ACCOUNT, 'DriverPrivacyPolicy.tsx'), 'utf8'));
const DRIVER_TERMS = normalise(fs.readFileSync(path.join(DRIVER_ACCOUNT, 'DriverTermsOfService.tsx'), 'utf8'));

const textOf = (doc: LegalDocument): string =>
  [doc.title, doc.dateLine, doc.intro, ...doc.sections.flatMap((s) => [s.title, s.intro, ...(s.bullets ?? []), s.note])].filter(Boolean).join('\n');

describe('LGU Legal & Privacy', () => {
  const privacy = textOf(PRIVACY_POLICY);
  const terms = textOf(TERMS_OF_SERVICE);
  const sharedEnglish = privacyNoticeExtraItems('driver', 'en');
  const retentionItem = sharedEnglish.find((i) => i.id === 'G')!.desc;
  const rightsItem = sharedEnglish.find((i) => i.id === 'I')!.desc;

  it('states the retention periods of policyConfig.ts', () => {
    for (const figure of [
      `${RETENTION_GPS_LOG_DAYS} days after they are recorded`,
      `${RETENTION_SESSION_DAYS} days`,
      `${RETENTION_DOC_SUPERSEDED_DAYS} days after they are replaced`,
      `${RETENTION_DOC_REJECTED_DAYS} days after an application is rejected`,
      `${RETENTION_DOC_CLOSED_MONTHS} months after an account is closed`,
      `${RETENTION_CLOSED_RECORDS_YEARS} years after it is closed`,
    ]) {
      assert.ok(privacy.includes(figure), figure);
      assert.ok(retentionItem.includes(figure.replace('after it is closed', 'after it is closed')), `the shared notice says: ${figure}`);
    }
    assert.ok(privacy.includes(PRIVACY_NOTICE_VERSION));
  });

  it("uses the shared notice's sentence about the records of administrators' actions and its statement of rights", () => {
    assert.ok(privacy.includes("The records of administrators' actions are kept as the Data Protection Officer decides."));
    assert.ok(retentionItem.includes("The records of administrators' actions are kept as the Data Protection Officer decides."));
    const rights = 'You have the right to be informed, to see and correct your personal data, to object to its use, and to ask for it to be erased or blocked when keeping it is no longer necessary or is unlawful.';
    assert.ok(privacy.includes(rights));
    assert.ok(rightsItem.includes(rights));
    assert.ok(privacy.includes('You may also complain to the National Privacy Commission.'));
  });

  it('sends requests to the LGU Transport Office, the first contact of the shared notice (a TODA Administrator is not an administrator\'s contact)', () => {
    assert.ok(PRIVACY_CONTACT.en.startsWith(LGU_PRIVACY_CONTACT));
    assert.ok(privacy.includes(`Write to ${LGU_PRIVACY_CONTACT}.`));
  });

  it("keeps the lines taken from the Driver App's Privacy Policy and Terms of Service word for word", () => {
    for (const line of [
      'Calculate exact fares under city regulations',
      'Monitor live rides for safety and dispute resolution',
      'Investigate submitted complaints or strike appeals',
      'Prevent unauthorized vehicle substitution and abuse',
      'Ensure compliance with LGU Transport Board rules',
    ]) {
      assert.ok(DRIVER_PRIVACY.includes(line), `the Driver App's privacy policy has: ${line}`);
      assert.ok(privacy.includes(line), line);
    }
    // section 4 of the driver's policy, said about "a driver" instead of "your"
    assert.ok(DRIVER_PRIVACY.includes('Accessible exclusively to your TODA Administrator, LGU Administrator, and the assigned commuter (limited to name, photo, and franchise number during active trips). We never sell your data to third parties.'));
    assert.ok(privacy.includes('accessible exclusively to the driver\'s TODA Administrator, the LGU Administrators and the assigned commuter (limited to name, photo and franchise number during active trips). SAKAY never sells personal data to third parties.'));
    for (const line of ['SAKAY strictly implements official fare rates set by the Calapan City LGU', 'Deactivations require formal administrative review from your TODA Board and LGU Transport Board.', 'SAKAY, your TODA, or the LGU may update these terms periodically.']) {
      assert.ok(DRIVER_TERMS.includes(line), `the Driver App's terms have: ${line}`);
    }
    assert.ok(terms.includes('official fare rates set by the Calapan City LGU'));
    assert.ok(terms.includes('Deactivations require formal administrative review from the TODA Board and the LGU Transport Board.'));
  });

  it('is not addressed to a driver or a passenger', () => {
    for (const [name, text] of [['privacy policy', privacy], ['terms', terms]] as const) {
      assert.ok(!/\bas a driver\b/i.test(text), `${name}: "as a driver"`);
      assert.ok(!/\bto use SAKAY as\b/i.test(text), `${name}: eligibility of drivers`);
      assert.ok(!/Go Online|cannot go Online|Charging excess fares/i.test(text), `${name}: driver rules`);
    }
  });

  it('gives a date line only where the project has one (the notice version), none for the terms', () => {
    assert.equal(PRIVACY_POLICY.dateLine, `The retention periods and your rights follow the SAKAY privacy notice, version ${PRIVACY_NOTICE_VERSION}.`);
    assert.equal(TERMS_OF_SERVICE.dateLine, undefined);
  });
});

describe('LGU About SAKAY', () => {
  it('agrees with the TODA portal on the e-mail address, the developers and the first sentence', () => {
    assert.equal(SUPPORT_EMAIL, TODA_EMAIL);
    assert.deepEqual([...ABOUT_SAKAY.developers], [...TODA_ABOUT.developers]);
    const firstSentence = (s: string) => s.split('. ')[0];
    assert.equal(firstSentence(ABOUT_SAKAY.description), firstSentence(TODA_ABOUT.description));
    assert.equal(ABOUT_SAKAY.name, TODA_ABOUT.name);
  });

  it('names the LGU portal and has no version number or date', () => {
    assert.equal(ABOUT_SAKAY.portal, 'LGU Administrator Portal');
    assert.ok(!/\bv?\d+\.\d+\.\d+\b/.test(ABOUT_SAKAY.description));
  });
});
