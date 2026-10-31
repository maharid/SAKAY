// Batch 2: where a notice in the LGU or TODA portal leads and what icon it gets, how a phone number is shown and dialled, who acts on an incident report, the kinds of announcement
// event, and the words of an emergency declaration (packages/shared/src/utils/portalNoticeRouting.ts, phoneDisplay.ts, incidentReview.ts, announcementEventTypes.ts, calamityDetails.ts).
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LGU_RECIPIENT, NOTICE_KIND_LABEL, noticeDestination, noticeVisualKind, todaRecipient } from '../../packages/shared/src/utils/portalNoticeRouting';
import { formatPhoneDisplay, phoneHref } from '../../packages/shared/src/utils/phoneDisplay';
import { incidentHandling } from '../../packages/shared/src/utils/incidentReview';
import { ANNOUNCEMENT_EVENT_TYPES, LGU_ANNOUNCEMENT_EVENT_TYPES, TODA_ANNOUNCEMENT_EVENT_TYPES, asAnnouncementEventType } from '../../packages/shared/src/utils/announcementEventTypes';
import { calamityDetails, endOfManilaDay, formatCalamityMoment, manilaDateOf } from '../../packages/shared/src/utils/calamityDetails';

describe('a notice opens the record it is about', () => {
  it('sends the LGU to the incident, the driver, the appeal and the TODA, with the record named', () => {
    assert.equal(noticeDestination('lgu', 'INCIDENT_ESCALATED', 'abc-123'), '/incident-reports?incident=abc-123');
    assert.equal(noticeDestination('lgu', 'INCIDENT_OVERDUE_LGU', 'abc-123'), '/incident-reports?incident=abc-123');
    assert.equal(noticeDestination('lgu', 'DRIVER_RESUBMITTED', 'aff-1'), '/drivers?affiliation=aff-1');
    assert.equal(noticeDestination('lgu', 'APPEAL_PENDING_LGU', 'ap-9'), '/appeals?appeal=ap-9');
    assert.equal(noticeDestination('lgu', 'TODA_ACCREDITATION_EXPIRED_LGU', 'toda-5|2026-12-31'), '/accredited-todas?toda=toda-5');
  });

  it('sends a TODA to its own incident, application and accreditation pages', () => {
    assert.equal(noticeDestination('toda', 'INCIDENT_LGU_DECIDED', 'abc-123'), '/reports?incident=abc-123');
    assert.equal(noticeDestination('toda', 'TODA_DRIVER_LGU_DECISION', 'aff-1'), '/driver-verification?application=aff-1');
    assert.equal(noticeDestination('toda', 'TODA_ACCREDITATION_EXPIRING', 'toda-5|2026-12-31'), '/account');
    assert.equal(noticeDestination('toda', 'TODA_ACCREDITATION_EXPIRED', 'toda-5|2026-12-31'), '/account');
  });

  it('opens nothing for a plain information notice, and never an LGU page for a TODA notice', () => {
    assert.equal(noticeDestination('lgu', 'SOMETHING_ELSE', 'x'), null);
    assert.equal(noticeDestination('toda', 'SOMETHING_ELSE', 'x'), null);
    assert.equal(noticeDestination('toda', 'APPEAL_PENDING_LGU', 'ap-9'), null);
  });

  it('encodes the record id and falls back to the page when there is none', () => {
    assert.equal(noticeDestination('lgu', 'INCIDENT_NEW_LGU', 'a b&c'), '/incident-reports?incident=a%20b%26c');
    assert.equal(noticeDestination('lgu', 'INCIDENT_NEW_LGU', ''), '/incident-reports');
  });
});

describe('every kind of notice has its own icon', () => {
  it('tells the kinds apart', () => {
    assert.equal(noticeVisualKind('INCIDENT_NEW_LGU'), 'incident');
    assert.equal(noticeVisualKind('INCIDENT_OVERDUE_TODA'), 'overdue');
    assert.equal(noticeVisualKind('INCIDENT_FOLLOWUP'), 'followup');
    assert.equal(noticeVisualKind('DRIVER_RESUBMITTED'), 'resubmission');
    assert.equal(noticeVisualKind('TODA_DRIVER_LGU_DECISION'), 'driverVerification');
    assert.equal(noticeVisualKind('TODA_ACCREDITATION_EXPIRING'), 'accreditation');
    assert.equal(noticeVisualKind('APPEAL_PENDING_LGU'), 'appeal');
    assert.equal(noticeVisualKind('SOMETHING_ELSE'), 'general');
  });

  it('names every kind, so the icon has an accessible name', () => {
    for (const type of ['INCIDENT_NEW_LGU', 'INCIDENT_OVERDUE_LGU', 'INCIDENT_FOLLOWUP', 'DRIVER_RESUBMITTED', 'TODA_DRIVER_LGU_DECISION', 'TODA_ACCREDITATION_EXPIRING', 'APPEAL_PENDING_LGU', 'LGU_RENEWAL_REMINDER', 'X']) {
      assert.ok(NOTICE_KIND_LABEL[noticeVisualKind(type)], type);
    }
  });

  it('addresses the LGU and each TODA separately (the portals read only their own address, never a passenger’s or a driver’s notices)', () => {
    assert.equal(LGU_RECIPIENT, 'lgu_admin');
    assert.equal(todaRecipient('11111111-1111-1111-1111-111111111111'), 'toda_11111111-1111-1111-1111-111111111111');
  });
});

describe('a phone number is shown the way people read it and dialled in full', () => {
  it('formats a Philippine mobile number', () => {
    assert.equal(formatPhoneDisplay('09171234567'), '+63 917 123 4567');
    assert.equal(formatPhoneDisplay('+639171234567'), '+63 917 123 4567');
    assert.equal(formatPhoneDisplay('9171234567'), '+63 917 123 4567');
  });
  it('shows anything else as it was written, and nothing as nothing', () => {
    assert.equal(formatPhoneDisplay('(02) 8123-4567'), '(02) 8123-4567');
    assert.equal(formatPhoneDisplay(null), '');
    assert.equal(phoneHref(''), null);
    assert.equal(phoneHref('123'), null);
  });
  it('dials a mobile number with the country code', () => {
    assert.equal(phoneHref('0917 123 4567'), '+639171234567');
  });
});

describe('who acts on an incident report', () => {
  const report = (o: Record<string, unknown>) => ({ routing: 'TODA', priority: 'Standard', outcome: null, status: 'Pending Review', ...o }) as never;
  it('a report with the TODA needs the TODA and is only monitored by the LGU', () => {
    assert.equal(incidentHandling(report({}), 'toda_admin'), 'action');
    assert.equal(incidentHandling(report({}), 'lgu_admin'), 'monitoring');
  });
  it('an escalated or serious report needs the LGU and is only monitored by the TODA', () => {
    assert.equal(incidentHandling(report({ routing: 'LGU' }), 'lgu_admin'), 'action');
    assert.equal(incidentHandling(report({ routing: 'LGU' }), 'toda_admin'), 'monitoring');
    assert.equal(incidentHandling(report({ priority: 'Serious' }), 'lgu_admin'), 'action');
  });
  it('a decided or withdrawn report is closed for both', () => {
    assert.equal(incidentHandling(report({ outcome: 'UPHELD' }), 'lgu_admin'), 'closed');
    assert.equal(incidentHandling(report({ status: 'Cancelled' }), 'toda_admin'), 'closed');
  });
});

describe('the kind of event an announcement is about', () => {
  it('knows ten kinds, and the TODA and the LGU each offer a part of them', () => {
    assert.equal(ANNOUNCEMENT_EVENT_TYPES.length, 10);
    for (const t of [...TODA_ANNOUNCEMENT_EVENT_TYPES, ...LGU_ANNOUNCEMENT_EVENT_TYPES]) assert.ok(ANNOUNCEMENT_EVENT_TYPES.includes(t), t);
    assert.ok(!TODA_ANNOUNCEMENT_EVENT_TYPES.includes('Emergency'), 'an emergency is the LGU’s declaration alone');
    assert.ok(!LGU_ANNOUNCEMENT_EVENT_TYPES.includes('Emergency'), 'and it is published by declaring one, not chosen by hand');
  });
  it('reads anything unknown (an older row, a typo) as General', () => {
    assert.equal(asAnnouncementEventType('Weather'), 'Weather');
    assert.equal(asAnnouncementEventType('Pizza Party'), 'General');
    assert.equal(asAnnouncementEventType(null), 'General');
    assert.equal(asAnnouncementEventType(undefined), 'General');
  });
});

describe('the words of an emergency declaration', () => {
  it('says what is paused for each scope, and that serious violations never are', () => {
    const some = calamityDetails({ scope: 'CANCEL_STALL_NOSHOW' });
    const all = calamityDetails({ scope: 'ALL' });
    assert.match(some.suspended, /cancellations, stalls and no-shows/i);
    assert.match(all.suspended, /every violation that can be paused/i);
    assert.match(some.stillEnforced, /serious and safety violations/i);
    assert.match(some.affected, /drivers/i);
    assert.match(some.coverage, /every TODA/i);
  });
  it('says how long it lasts: until it is ended, or until the date given', () => {
    assert.match(calamityDetails({ scope: 'ALL', declaredAt: '2026-11-02T01:00:00Z' }).duration, /until the LGU Administrator ends it/);
    assert.match(calamityDetails({ scope: 'ALL', declaredAt: '2026-11-02T01:00:00Z', expectedEndAt: '2026-11-04T15:59:00Z' }).duration, /expected/);
  });
  it('says it in Tagalog too', () => {
    assert.match(calamityDetails({ scope: 'ALL' }, 'tl').affected, /driver at pasahero/i);
  });
  it('uses Philippine time whatever the device’s time zone is', () => {
    assert.match(formatCalamityMoment('2026-11-02T12:00:00Z'), /Nov 2, 2026/);
    assert.match(formatCalamityMoment('2026-11-02T12:00:00Z'), /8:00/);
    assert.equal(formatCalamityMoment(undefined), '-');
    assert.equal(manilaDateOf('2026-11-02T17:00:00Z'), '2026-11-03');
    assert.equal(endOfManilaDay('2026-11-03'), '2026-11-03T15:59:00.000Z');
    assert.equal(endOfManilaDay('not a date'), null);
  });
});
