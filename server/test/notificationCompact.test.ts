// The short wording of a notice in the bell panel (packages/shared/src/utils/notificationCompact.ts): action, entity and deadline are kept, the instructions the row already carries are not.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactNotificationMessage } from '../../packages/shared/src/utils/notificationCompact';

describe('compact notification text', () => {
  it('writes the accreditation reminder as one sentence with the TODA and the date', () => {
    const raw = 'DWCC TODA (certificate CERT-2026-01) is valid until Dec 31, 2026. Renew it with the City Transport Office so your drivers can stay Online. Open Account & Accreditation for the details.';
    assert.equal(compactNotificationMessage(raw, 'TODA_ACCREDITATION_EXPIRING'), "Renew DWCC TODA's Barangay Clearance by Dec 31, 2026 to keep drivers online.");
  });

  it('writes the expired notices for the TODA and for the LGU', () => {
    const toda = 'DWCC TODA (certificate on record) expired on Oct 01, 2026. Your drivers cannot go Online until the LGU records a renewal. Open Account & Accreditation to send the renewed Barangay Clearance.';
    assert.equal(compactNotificationMessage(toda, 'TODA_ACCREDITATION_EXPIRED'), "DWCC TODA's accreditation expired on Oct 01, 2026. Drivers cannot go online until it is renewed.");
    const lgu = 'The accreditation of DWCC TODA expired on Oct 01, 2026. Its drivers cannot go Online until a renewal is recorded.';
    assert.equal(compactNotificationMessage(lgu, 'TODA_ACCREDITATION_EXPIRED_LGU'), "DWCC TODA's accreditation expired on Oct 01, 2026. Its drivers cannot go online.");
  });

  it('keeps a short notice as it is', () => {
    assert.equal(compactNotificationMessage('Juan Dela Cruz resubmitted updated documents.'), 'Juan Dela Cruz resubmitted updated documents.');
  });

  it('drops the "Open ... for the details" instruction the row already carries', () => {
    assert.equal(compactNotificationMessage('A strike appeal needs a decision. Open Strike Appeals to review it.'), 'A strike appeal needs a decision.');
  });

  it('keeps the first two sentences when they are short, and not a long third one', () => {
    const raw = 'Report #AB12 passed its first-action time on Oct 30, 2026. Review it now. After that the report goes to the LGU for a decision and the TODA is told about it later on.';
    assert.equal(compactNotificationMessage(raw), 'Report #AB12 passed its first-action time on Oct 30, 2026. Review it now.');
  });

  it('cuts a very long sentence at a word, with an ellipsis, and never leaves the text empty', () => {
    const raw = `${'The driver submitted a long explanation about the trip '.repeat(5)}end.`;
    const out = compactNotificationMessage(raw);
    assert.ok(out.length <= 120 && out.endsWith('…') && !out.includes('  '), out);
    assert.equal(compactNotificationMessage(''), '');
    assert.equal(compactNotificationMessage(null), '');
  });

  it('leaves a notice of an unknown shape alone apart from the length', () => {
    const raw = 'DWCC TODA (certificate X) will be reviewed.';
    assert.equal(compactNotificationMessage(raw, 'TODA_ACCREDITATION_EXPIRING'), raw);
  });
});
