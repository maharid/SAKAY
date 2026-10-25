// The notifications of the Driver and Passenger apps and of the LGU and TODA portals (packages/shared/src/utils/notificationLocalization.ts, notificationPolicy.ts,
// portalNotificationText.ts): each notice reads in ONE language (the selected one), and only the notices worth a person's attention are listed.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBilingualText, localizeSystemNotification, stripRuleReferences } from '../../packages/shared/src/utils/notificationLocalization';
import { formatNotificationTime, isImportantNotification, notificationCategory, selectImportantNotifications } from '../../packages/shared/src/utils/notificationPolicy';
import { notificationPanelText, portalNotice } from '../../packages/shared/src/utils/portalNotificationText';

// A word of each language that the other one does not use, to tell which language a text is in
const TAGALOG_ONLY = /\b(ang|ng|mga|ay|iyong|ulat|biyahe|pamasahe|drayber|sasakyan|isinara|itinama|hindi)\b/i;

describe('a bilingual notice reads in one language', () => {
  const pairs: [string, string, string][] = [
    ['Naibalik ang gamit (The item was returned)', 'The lost-item report is closed: the item was returned. (Sarado na ang ulat: naibalik ang gamit.)', 'LOST_ITEM_CLOSED'],
    [
      'Suspendido ang Iyong Account (Your account is on hold)',
      'Your account is on hold while your TODA and the LGU review the incident on your trip. You are not struck. (Naka-hold ang account mo habang sinusuri ng TODA at LGU ang insidente; walang strike.)',
      'ACCOUNT_RESTRICTION_NOTICE',
    ],
    [
      'Walang available na drayber (No driver available)',
      'We could not find a driver near you. You can search again or cancel without any penalty. (Walang nahanap na drayber. Maaari kang mag-search muli o kanselahin nang walang parusa.)',
      'NO_DRIVER_FOUND',
    ],
  ];
  for (const [title, message, type] of pairs) {
    it(`${type}: no parenthesis with the other language is left`, () => {
      const en = localizeSystemNotification(title, message, 'en', type);
      const tl = localizeSystemNotification(title, message, 'tl', type);
      assert.doesNotMatch(en.title + ' ' + en.message, TAGALOG_ONLY);
      assert.doesNotMatch(en.title + en.message, /[()]/);
      assert.doesNotMatch(tl.title + tl.message, /[()]/);
      assert.notEqual(tl.message, en.message);
    });
  }

  it('a full stop after the parenthesis and a parenthesis inside the translation are handled', () => {
    const text = 'The trip was closed by an administrator after manual reconciliation (Isinara ng administrator ang biyahe matapos ang manu-manong pagsusuri).';
    assert.equal(cleanBilingualText(text, 'en'), 'The trip was closed by an administrator after manual reconciliation.');
    assert.equal(cleanBilingualText(text, 'tl'), 'Isinara ng administrator ang biyahe matapos ang manu-manong pagsusuri.');
    assert.equal(cleanBilingualText('Hintayin ang pasahero. (Wait for the passenger (up to 5 minutes) to confirm.)', 'en'), 'Wait for the passenger (up to 5 minutes) to confirm.');
  });

  it('rule numbers and policy item numbers are not shown', () => {
    assert.equal(stripRuleReferences('Stall / failure to proceed to pickup (approach phase only, PI-05)'), 'Stall / failure to proceed to pickup (approach phase only)');
    assert.equal(stripRuleReferences('Waived (PI-12) after review (Rule 25.4)'), 'Waived after review');
  });

  it('a short parenthesis that is not a translation stays', () => {
    assert.equal(cleanBilingualText('Your fare is PHP 70 (cash)', 'tl'), 'Your fare is PHP 70 (cash)');
  });
});

describe('the notices the database writes in English only get a Tagalog text', () => {
  it('a fare review decision keeps its data and its reason, in both languages', () => {
    const title = 'Nasuri na ang pamasahe (Your fare review is complete)';
    const message = 'Decision: FARE REDUCED. The fare is now PHP 70.00. Meter was wrong.';
    const en = localizeSystemNotification(title, message, 'en', 'FARE_DISPUTE_RESOLVED');
    const tl = localizeSystemNotification(title, message, 'tl', 'FARE_DISPUTE_RESOLVED');
    assert.equal(en.message, 'Decision: Fare reduced. The fare is now PHP 70.00. Meter was wrong.');
    assert.equal(tl.message, 'Desisyon: Binawasan ang pamasahe. Ang pamasahe ay PHP 70.00 na ngayon. Meter was wrong.');
    assert.equal(en.title, 'Your fare review is complete');
    assert.equal(tl.title, 'Nasuri na ang pamasahe');
  });

  it('a substitute vehicle keeps its plate', () => {
    const tl = localizeSystemNotification(
      'Aprubado ang ibang sasakyan (The substitute vehicle is approved)',
      'You may use ABC 123 until Nov 3, 2026, 8:00 PM. Your registered vehicle comes back on its own after that.',
      'tl',
      'VEHICLE_SUBSTITUTION_ACTIVE'
    );
    assert.match(tl.message, /^Maaari mong gamitin ang ABC 123 hanggang Nov 3, 2026, 8:00 PM\./);
  });

  it('a resubmission for the TODA or LGU, a trip closed or corrected by an administrator', () => {
    const resub = localizeSystemNotification('Resubmitted: Juan Cruz', 'Juan Cruz resubmitted license for TODA review. The 5-day review period has restarted.', 'tl', 'DRIVER_RESUBMITTED');
    assert.equal(resub.title, 'Nagsumite Muli: Juan Cruz');
    assert.match(resub.message, /^Nagsumite muli si Juan Cruz ng license para sa pagsusuri ng TODA\./);
    const closed = localizeSystemNotification(
      'Isinara ng administrator ang biyahe (An administrator closed your trip)',
      'The trip was closed as Paid after the parties were contacted. Cash received.',
      'tl',
      'TRIP_CLOSED_BY_ADMIN'
    );
    assert.equal(closed.message, 'Isinara ang biyahe bilang Bayad na matapos makontak ang mga kasangkot. Cash received.');
    const corrected = localizeSystemNotification(
      'Naitama ang talaan ng biyahe (Your trip record was corrected)',
      'An administrator corrected the fare or payment of a completed trip. Fare fixed.',
      'en',
      'TRIP_CORRECTED'
    );
    assert.equal(corrected.message, 'An administrator corrected the fare or payment of a completed trip. Fare fixed.');
  });
});

describe('which notices are listed', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const sent = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString();

  it('a prompt of a live trip is listed while it lasts and dropped after', () => {
    assert.equal(isImportantNotification({ type: 'DRIVER_UNREACHABLE', sentAt: sent(5) }, now), true);
    assert.equal(isImportantNotification({ type: 'DRIVER_UNREACHABLE', sentAt: sent(120) }, now), false);
    assert.equal(isImportantNotification({ type: 'STALL_WARNING', sentAt: null }, now), false);
  });

  it('strikes, bookings that failed and the decisions are always listed', () => {
    for (const type of ['STRIKE_ISSUED', 'BOOKING_AUTO_CANCELLED', 'NO_DRIVER_FOUND', 'FARE_DISPUTE_RESOLVED', 'INCIDENT_DECIDED', 'EXEMPTION_DECISION', 'DOCUMENT_RETURNED']) {
      assert.equal(isImportantNotification({ type, sentAt: sent(60 * 24 * 40) }, now), true, type);
    }
  });

  it('the thank-you note of a trip is not listed, the one about a disputed fare is', () => {
    assert.equal(isImportantNotification({ type: 'PAYMENT_RECEIVED', message: 'Thank you for riding with SAKAY. (Salamat sa pagsakay sa SAKAY.)' }, now), false);
    assert.equal(isImportantNotification({ type: 'PAYMENT_RECEIVED', message: 'Your driver finished the trip. The fare you reported will be reviewed. (Natapos na ang biyahe.)' }, now), true);
  });

  it('records of work are not notifications', () => {
    for (const type of ['AUDIT_LOG_EXPORTED', 'RETENTION_JOB_RUN', 'IDENTITY_DOCUMENTS_PURGED', 'DRIVER_RENEWAL_REMINDER_SENT']) {
      assert.equal(isImportantNotification({ type, sentAt: sent(1) }, now), false, type);
    }
  });

  it('the same notice sent again within ten minutes is listed once, the newest, and a later one stays', () => {
    const rows = [
      { type: 'STRIKE_ISSUED', title: 'Strike', message: 'One strike', sentAt: sent(2) },
      { type: 'STRIKE_ISSUED', title: 'Strike', message: 'One strike', sentAt: sent(5) },
      { type: 'STRIKE_ISSUED', title: 'Strike', message: 'One strike', sentAt: sent(60 * 24) },
      { type: 'STRIKE_ISSUED', title: 'Strike', message: 'Another strike', sentAt: sent(3) },
    ];
    const listed = selectImportantNotifications(rows, (r) => r, now);
    assert.deepEqual(
      listed.map((r) => `${r.message}@${r.sentAt}`),
      [`One strike@${sent(2)}`, `One strike@${sent(60 * 24)}`, `Another strike@${sent(3)}`]
    );
  });

  it('a notice about a booking or a trip is under Trips, the others under Advisories', () => {
    assert.equal(notificationCategory('NO_DRIVER_FOUND'), 'trips');
    assert.equal(notificationCategory('DISPATCH_TERMINATED'), 'trips');
    assert.equal(notificationCategory('FARE_DISPUTE_RESOLVED'), 'trips');
    assert.equal(notificationCategory('STRIKE_ISSUED'), 'advisories');
    assert.equal(notificationCategory('VEHICLE_SUBSTITUTION_ACTIVE'), 'advisories');
    assert.equal(notificationCategory(undefined), 'advisories');
  });
});

describe('the time and the words of the panels follow the selected language', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('relative time', () => {
    assert.equal(formatNotificationTime('2026-10-26T11:55:00Z', 'en', now), '5m ago');
    assert.equal(formatNotificationTime('2026-10-26T11:55:00Z', 'tl', now), '5m ang nakalipas');
    assert.equal(formatNotificationTime('2026-10-25T08:00:00Z', 'en', now), 'Yesterday');
    assert.equal(formatNotificationTime('2026-10-25T08:00:00Z', 'tl', now), 'Kahapon');
    assert.equal(formatNotificationTime(undefined, 'tl', now), 'Kamakailan');
  });
  it('panel and portal notices have both languages and keep the name', () => {
    assert.equal(notificationPanelText('en').markAll, 'Mark all as read');
    assert.equal(notificationPanelText('tl').markAll, 'Markahan lahat bilang nabasa');
    assert.equal(portalNotice('endorsed', 'Juan Cruz', 'en').description, 'Juan Cruz endorsed by TODA for Stage 2 LGU inspection.');
    assert.match(portalNotice('endorsed', 'Juan Cruz', 'tl').description, /Juan Cruz/);
    assert.doesNotMatch(portalNotice('resubmitted', 'Juan Cruz', 'tl').title, /Resubmitted/);
  });
});
