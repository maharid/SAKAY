// TODA Settings: the texts of Legal & Privacy and About SAKAY.
//
// Legal & Privacy shows the Driver App's Privacy Policy and Terms of Service. The two apps cannot import from each other, so the portal keeps a copy
// (apps/toda-portal/src/utils/legalContent.ts). This test reads the Driver App's own files and fails as soon as a line of the copy no longer matches them,
// is missing, or is in another order.
//   run:  cd server && npx tsx --test test/todaSettingsContent.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../apps/toda-portal/src/utils/legalContent';
import type { LegalDocument } from '../../apps/toda-portal/src/utils/legalContent';
import { ABOUT_SAKAY, SUPPORT_EMAIL } from '../../apps/toda-portal/src/utils/appInfo';

const APPS = path.join(process.cwd(), '..', 'apps');
const DRIVER_ACCOUNT = path.join(APPS, 'driver-pwa', 'src', 'features', 'account-management', 'components');

// a Driver App file as plain text: bold tags removed (so "<strong>90 days</strong>" reads like "90 days") and every line trimmed (so a paragraph that
// the Driver App file keeps on its own indented line starts and ends at a line break)
const readSource = (file: string) =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/<\/?strong>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a line of the portal's copy ends in the Driver App file, or -1. The line has to be a WHOLE text there (between tags, between quotes or on a line of
 * its own), so a shortened or extended sentence is not accepted. The search starts at `from`.
 */
function findExact(text: string, line: string, from = 0): number {
  const pattern = new RegExp(`(?:^|[>'"\`\\n])${escapeRegExp(line)}(?=$|[<'"\`\\n])`, 'g');
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match ? match.index + match[0].length : -1;
}

const PRIVACY_SOURCE = readSource(path.join(DRIVER_ACCOUNT, 'DriverPrivacyPolicy.tsx'));
const TERMS_SOURCE = readSource(path.join(DRIVER_ACCOUNT, 'DriverTermsOfService.tsx'));
const LANGUAGE_SOURCE = readSource(path.join(APPS, 'driver-pwa', 'src', 'utils', 'LanguageContext.tsx'));

const plain = (text: string) => text.split('**').join('');

/** Every piece of text of a document except the expandable items and the table (those have their own checks), in reading order. */
function bodyLines(doc: LegalDocument): string[] {
  const lines: string[] = [];
  if (doc.intro) lines.push(doc.intro);
  for (const section of doc.sections) {
    lines.push(section.title);
    if (section.intro) lines.push(section.intro);
    lines.push(...(section.bullets ?? []));
    if (section.note) lines.push(plain(section.note));
  }
  return lines;
}

/** Everything, including the items and the table cells (order not checked). */
function allLines(doc: LegalDocument): string[] {
  const lines = bodyLines(doc);
  for (const section of doc.sections) {
    for (const item of section.items ?? []) lines.push(item.title, item.desc);
    if (section.table) lines.push(...section.table.head, ...section.table.rows.flat());
  }
  return lines;
}

/** The part of a Driver App page that is the English text (the file holds the Filipino text first). */
const englishBlock = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `the marker ${marker} is no longer in the Driver App file; update this test`);
  return source.slice(at);
};

const numberedHeadings = (block: string) => (block.match(/^\s*\d+\. [A-Z]/gm) ?? []).length;

function checkDocument(name: string, doc: LegalDocument, source: string, marker: string) {
  describe(name, () => {
    it('has every line of the Driver App page, word for word', () => {
      for (const line of allLines(doc)) {
        assert.ok(findExact(source, line) >= 0, `not found in the Driver App page: ${JSON.stringify(line)}`);
      }
    });

    it('keeps the order of the Driver App page', () => {
      // the privacy policy's opening paragraph sits above the English/Filipino split of the Driver App file, so the walk starts there when there is one
      // (one character back, so that the quote or tag in front of the line is inside the search)
      let position = doc.intro ? Math.max(findExact(source, doc.intro) - doc.intro.length - 1, 0) : source.indexOf(marker);
      assert.ok(position >= 0, `the marker ${marker} is no longer in the Driver App file; update this test`);
      for (const line of bodyLines(doc)) {
        const end = findExact(source, line, position);
        assert.ok(end >= 0, `out of order or missing: ${JSON.stringify(line)}`);
        position = end;
      }
    });

    it('has as many numbered sections as the Driver App page (nothing left out)', () => {
      assert.equal(doc.sections.length, numberedHeadings(englishBlock(source, marker)));
      doc.sections.forEach((section, i) => assert.ok(section.title.startsWith(`${i + 1}. `), `section ${i + 1} is numbered ${section.title}`));
    });
  });
}

checkDocument('Privacy Policy', PRIVACY_POLICY, PRIVACY_SOURCE, '/* ENGLISH PRIVACY POLICY */');
checkDocument('Terms of Service', TERMS_OF_SERVICE, TERMS_SOURCE, '/* ENGLISH CONTENT */');

describe('titles and date', () => {
  it('use the Driver App English texts', () => {
    assert.ok(LANGUAGE_SOURCE.includes(`privacyTitle: "${PRIVACY_POLICY.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`termsTitle: "${TERMS_OF_SERVICE.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`lastUpdatedTerms: "${PRIVACY_POLICY.lastUpdated}"`));
    assert.equal(TERMS_OF_SERVICE.lastUpdated, PRIVACY_POLICY.lastUpdated);
  });

  it('lists the expandable items A to E of the privacy policy in the Driver App order', () => {
    const items = PRIVACY_POLICY.sections[0].items ?? [];
    assert.deepEqual(items.map((item) => item.id), ['A', 'B', 'C', 'D', 'E']);
  });

  it('has the strike table of the Terms with its five rows', () => {
    const table = TERMS_OF_SERVICE.sections.find((section) => section.table)?.table;
    assert.ok(table);
    assert.equal(table.rows.length, 5);
  });
});

describe('About SAKAY', () => {
  it('gives the team e-mail address, a description and the developers', () => {
    assert.equal(SUPPORT_EMAIL, 'teamsakay@gmail.com');
    assert.ok(ABOUT_SAKAY.description.length > 0);
    assert.ok(ABOUT_SAKAY.developers.length > 0);
  });

  it('does not describe the project as a capstone or a degree project anywhere in the Settings files', () => {
    const files = [
      path.join(APPS, 'toda-portal', 'src', 'utils', 'appInfo.ts'),
      path.join(APPS, 'toda-portal', 'src', 'pages', 'TodaSettingsPage.tsx'),
      ...fs.readdirSync(path.join(APPS, 'toda-portal', 'src', 'components', 'settings')).map((f) => path.join(APPS, 'toda-portal', 'src', 'components', 'settings', f)),
    ];
    for (const file of files) {
      assert.ok(!/capstone|bachelor of science/i.test(fs.readFileSync(file, 'utf8')), `${path.basename(file)} still mentions a capstone or degree`);
    }
  });
});
