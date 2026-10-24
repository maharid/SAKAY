// TODA Settings: the texts of Legal & Privacy, the Tagalog texts, and About SAKAY.
//
// Legal & Privacy shows the Driver App's Privacy Policy and Terms of Service in English and in Tagalog, and Settings uses a few other Tagalog lines of the Driver
// App (its Settings and Change Password pages). The two apps cannot import from each other, so the portal keeps a copy (apps/toda-portal/src/utils/legalContent.ts,
// legalContentTagalog.ts, translations.ts). This test reads the Driver App's own files and fails as soon as a line of a copy no longer matches them, is missing,
// or is in another order. Nothing in the portal's Tagalog is newly translated.
//   run:  cd server && npx tsx --test test/todaSettingsContent.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../apps/toda-portal/src/utils/legalContent';
import type { LegalDocument } from '../../apps/toda-portal/src/utils/legalContent';
import { LANGUAGE_OPTIONS } from '../../apps/toda-portal/src/utils/language';
import { TAGALOG_TEXTS } from '../../apps/toda-portal/src/utils/translations';
import { ABOUT_SAKAY, SUPPORT_EMAIL } from '../../apps/toda-portal/src/utils/appInfo';

const APPS = path.join(process.cwd(), '..', 'apps');
const DRIVER_SRC = path.join(APPS, 'driver-pwa', 'src');
const DRIVER_ACCOUNT = path.join(DRIVER_SRC, 'features', 'account-management', 'components');

// a Driver App file as plain text: bold tags removed (so "<strong>90 days</strong>" reads like "90 days") and every line trimmed (so a paragraph that
// the Driver App file keeps on its own indented line starts and ends at a line break)
const normalise = (raw: string) =>
  raw
    .replace(/\r\n/g, '\n')
    .replace(/<\/?strong>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
const readSource = (file: string) => normalise(fs.readFileSync(file, 'utf8'));

const PRIVACY_SOURCE = readSource(path.join(DRIVER_ACCOUNT, 'DriverPrivacyPolicy.tsx'));
const TERMS_SOURCE = readSource(path.join(DRIVER_ACCOUNT, 'DriverTermsOfService.tsx'));
const LANGUAGE_SOURCE = readSource(path.join(DRIVER_SRC, 'utils', 'LanguageContext.tsx'));

/** every .ts and .tsx file of the Driver App, as one text */
function readWholeDriverApp(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) parts.push(readSource(full));
    }
  };
  walk(DRIVER_SRC);
  return parts.join('\n');
}

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

/** The part of a Driver App page between two markers (the file holds the Tagalog text first, then the English text). */
function blockBetween(source: string, marker: string, endMarker?: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `the marker ${marker} is no longer in the Driver App file; update this test`);
  const end = endMarker ? source.indexOf(endMarker) : -1;
  assert.ok(!endMarker || end > start, `the marker ${endMarker} is no longer after ${marker} in the Driver App file; update this test`);
  return source.slice(start, end > 0 ? end : undefined);
}

const numberedHeadings = (block: string) => (block.match(/^\d+\. [A-Z]/gm) ?? []).length;

interface PageCheck {
  name: string;
  doc: LegalDocument;
  source: string;
  /** where the text of this language starts and ends in the Driver App file */
  marker: string;
  endMarker?: string;
}

function checkDocument({ name, doc, source, marker, endMarker }: PageCheck) {
  describe(name, () => {
    it('has every line of the Driver App page, word for word', () => {
      for (const line of allLines(doc)) {
        assert.ok(findExact(source, line) >= 0, `not found in the Driver App page: ${JSON.stringify(line)}`);
      }
    });

    it('keeps the order of the Driver App page', () => {
      // the privacy policy's opening paragraph sits above the English/Tagalog split of the Driver App file, so the walk starts there when there is one
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
      assert.equal(doc.sections.length, numberedHeadings(blockBetween(source, marker, endMarker)));
      doc.sections.forEach((section, i) => assert.ok(section.title.startsWith(`${i + 1}. `), `section ${i + 1} is numbered ${section.title}`));
    });
  });
}

checkDocument({ name: 'Privacy Policy (English)', doc: PRIVACY_POLICY.en, source: PRIVACY_SOURCE, marker: '/* ENGLISH PRIVACY POLICY */' });
checkDocument({ name: 'Privacy Policy (Tagalog)', doc: PRIVACY_POLICY.tl, source: PRIVACY_SOURCE, marker: '/* TAGALOG PRIVACY POLICY */', endMarker: '/* ENGLISH PRIVACY POLICY */' });
checkDocument({ name: 'Terms of Service (English)', doc: TERMS_OF_SERVICE.en, source: TERMS_SOURCE, marker: '/* ENGLISH CONTENT */' });
checkDocument({ name: 'Terms of Service (Tagalog)', doc: TERMS_OF_SERVICE.tl, source: TERMS_SOURCE, marker: '/* TAGALOG CONTENT */', endMarker: '/* ENGLISH CONTENT */' });

describe('titles and date', () => {
  it('use the Driver App texts in both languages', () => {
    assert.ok(LANGUAGE_SOURCE.includes(`privacyTitle: "${PRIVACY_POLICY.en.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`termsTitle: "${TERMS_OF_SERVICE.en.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`lastUpdatedTerms: "${PRIVACY_POLICY.en.lastUpdated}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`privacyTitle: "${PRIVACY_POLICY.tl.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`termsTitle: "${TERMS_OF_SERVICE.tl.title}"`));
    assert.ok(LANGUAGE_SOURCE.includes(`lastUpdatedTerms: "${PRIVACY_POLICY.tl.lastUpdated}"`));
    assert.equal(TERMS_OF_SERVICE.en.lastUpdated, PRIVACY_POLICY.en.lastUpdated);
    assert.equal(TERMS_OF_SERVICE.tl.lastUpdated, PRIVACY_POLICY.tl.lastUpdated);
  });

  it('list the expandable items A to E of the privacy policy in the Driver App order, in both languages', () => {
    for (const code of ['en', 'tl'] as const) {
      const items = PRIVACY_POLICY[code].sections[0].items ?? [];
      assert.deepEqual(items.map((item) => item.id), ['A', 'B', 'C', 'D', 'E']);
    }
  });

  it('have the strike table of the Terms with its five rows, in both languages', () => {
    for (const code of ['en', 'tl'] as const) {
      const table = TERMS_OF_SERVICE[code].sections.find((section) => section.table)?.table;
      assert.ok(table);
      assert.equal(table.rows.length, 5);
    }
  });
});

describe('languages', () => {
  it('offer exactly English and Tagalog, English first and by default', () => {
    assert.deepEqual(LANGUAGE_OPTIONS.map((option) => option.code), ['en', 'tl']);
    assert.deepEqual(LANGUAGE_OPTIONS.map((option) => option.name), ['English', 'Tagalog']);
  });

  it('have a document for every language offered', () => {
    for (const { code } of LANGUAGE_OPTIONS) {
      assert.ok(PRIVACY_POLICY[code] && TERMS_OF_SERVICE[code], `no legal document for ${code}`);
    }
  });

  it('use only Tagalog lines that the Driver App already has, word for word', () => {
    const driverApp = readWholeDriverApp();
    const lines = Object.entries(TAGALOG_TEXTS);
    assert.ok(lines.length > 0);
    for (const [key, line] of lines) {
      assert.ok(line && findExact(driverApp, line) >= 0, `${key}: not found in the Driver App: ${JSON.stringify(line)}`);
    }
  });
});

describe('About SAKAY', () => {
  it('gives the team e-mail address, a description and the developers', () => {
    assert.equal(SUPPORT_EMAIL, 'teamsakay@gmail.com');
    assert.ok(ABOUT_SAKAY.description.length > 0);
    assert.ok(ABOUT_SAKAY.developers.length > 0);
  });

  it('does not describe the project as a capstone or a degree project anywhere in the Settings files', () => {
    const portal = path.join(APPS, 'toda-portal', 'src');
    const files = [
      path.join(portal, 'utils', 'appInfo.ts'),
      path.join(portal, 'pages', 'TodaSettingsPage.tsx'),
      ...fs.readdirSync(path.join(portal, 'components', 'settings')).map((f) => path.join(portal, 'components', 'settings', f)),
    ];
    for (const file of files) {
      assert.ok(!/capstone|bachelor of science/i.test(fs.readFileSync(file, 'utf8')), `${path.basename(file)} still mentions a capstone or degree`);
    }
  });

  it('is no longer offered as an Account Security card on the Account & Accreditation page', () => {
    const page = fs.readFileSync(path.join(APPS, 'toda-portal', 'src', 'pages', 'TodaAccountManagementPage.tsx'), 'utf8');
    assert.ok(!page.includes('ChangePasswordCard'), 'the Account & Accreditation page still uses the password card');
  });
});
