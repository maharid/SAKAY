// Report exports (panel comment, decision D-P6: "summary nasa taas then table. Timestamp, who exported. For both Excel and PDF. This means to put header and footer in reports").
// The Excel sheet and the PDF are built here without saving anything: what is checked is the ORDER (header, summary, table, footer), who exported and when, the default summary, and
// that the PDF has a footer with the page number on every page.
//   run:  cd server && npx tsx --test test/reportExport.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_BASIS, REPORT_ORGANISATION, buildReportPdf, reportFooterLines, reportHeaderLines, reportSheetRows, summaryOf } from '../../packages/shared/src/utils/reportExport';
import type { ReportMeta, ReportTable } from '../../packages/shared/src/utils/reportExport';

const META: ReportMeta = { exportedBy: 'Roberto Alcantara', role: 'LGU Administrator, City Transport Office', generatedAt: new Date('2026-10-30T06:30:00Z') };
const TABLE: ReportTable = {
  title: 'Booking Trend Report (Week: Oct 26 - Nov 1, 2026)',
  notes: ['Filter: Oct 26, 2026 to Nov 1, 2026; all TODAs; all barangays'],
  summary: [{ label: 'Bookings in the periods shown', value: 14 }, { label: 'Completion rate', value: '71%' }],
  headers: ['Period', 'Bookings', 'Completed', 'Cancelled'],
  rows: [['Mon 26', 3, 2, 1], ['Tue 27', 4, 3, 1], ['Wed 28', 0, 0, 0]],
};

describe('the header and the footer', () => {
  it('say what the report covers, when it was generated (Asia/Manila) and who exported it', () => {
    const header = reportHeaderLines(TABLE, META);
    assert.deepEqual(header[0], ['Covers', 'Filter: Oct 26, 2026 to Nov 1, 2026; all TODAs; all barangays']);
    assert.ok(header.some(([k, v]) => k === 'Generated' && /Oct 30, 2026/.test(v) && /Asia\/Manila/.test(v) && /2:30/.test(v)));
    assert.deepEqual(header.at(-1), ['Exported by', 'Roberto Alcantara (LGU Administrator, City Transport Office)']);
  });
  it('close the report with the number of rows, the exporter and the basis of the figures', () => {
    const footer = reportFooterLines(TABLE, META);
    assert.equal(footer[0], 'End of report: 3 rows.');
    assert.match(footer[1], /Exported by Roberto Alcantara \(LGU Administrator, City Transport Office\) on .*Oct 30, 2026/);
    assert.equal(footer[2], REPORT_BASIS);
    assert.equal(reportFooterLines({ ...TABLE, rows: [TABLE.rows[0]] }, META)[0], 'End of report: 1 row.');
  });
});

describe('the Excel sheet', () => {
  const rows = reportSheetRows(TABLE, META);
  const at = (text: string) => rows.findIndex((r) => r[0] === text);
  it('is: the system, the title, what it covers, when and by whom, THEN the summary, THEN the table, THEN the footer', () => {
    assert.equal(rows[0][0], REPORT_ORGANISATION);
    assert.equal(rows[1][0], TABLE.title);
    const generated = rows.findIndex((r) => r[0] === 'Generated');
    const exportedBy = rows.findIndex((r) => r[0] === 'Exported by');
    const summary = at('SUMMARY');
    const head = at('Period');
    const end = at('End of report: 3 rows.');
    assert.ok(2 <= generated && generated < exportedBy && exportedBy < summary && summary < head && head < end, JSON.stringify({ generated, exportedBy, summary, head, end }));
  });
  it('puts the summary rows between the SUMMARY heading and the table heading, and the table rows right after the heading', () => {
    const summary = at('SUMMARY');
    assert.deepEqual(rows[summary + 1], ['Bookings in the periods shown', 14]);
    assert.deepEqual(rows[summary + 2], ['Completion rate', '71%']);
    const head = at('Period');
    assert.deepEqual(rows[head], ['Period', 'Bookings', 'Completed', 'Cancelled']);
    assert.deepEqual(rows[head + 1], ['Mon 26', 3, 2, 1]);
    assert.deepEqual(rows[head + 3], ['Wed 28', 0, 0, 0]);
  });
  it('ends with the footer lines, the exporter among them', () => {
    assert.match(String(rows.at(-2)?.[0]), /Exported by Roberto Alcantara/);
    assert.equal(rows.at(-1)?.[0], REPORT_BASIS);
  });
  it('empty cells are empty text, not "undefined"', () => {
    const r = reportSheetRows({ ...TABLE, rows: [['x', null, undefined, 1]] }, META);
    assert.deepEqual(r[r.findIndex((x) => x[0] === 'x')], ['x', '', '', 1]);
  });
});

describe('the default summary of a report that has none', () => {
  it('counts the rows and totals the columns that count things', () => {
    assert.deepEqual(summaryOf({ ...TABLE, summary: undefined }), [{ label: 'Rows in this report', value: 3 }, { label: 'Total: Bookings', value: 7 }, { label: 'Total: Completed', value: 5 }, { label: 'Total: Cancelled', value: 2 }]);
  });
  it('does not total a column that is not all numbers, and keeps a report\'s own summary', () => {
    assert.deepEqual(summaryOf({ ...TABLE, summary: undefined, rows: [['a', 'n/a', 1, 1]] }).map((s) => s.label), ['Rows in this report', 'Total: Completed', 'Total: Cancelled']);
    assert.deepEqual(summaryOf(TABLE), TABLE.summary);
  });
});

describe('the PDF', () => {
  it('has the header and the summary on the first page, the table, and a footer with the exporter and the page number on EVERY page', async () => {
    const many: ReportTable = { ...TABLE, rows: Array.from({ length: 120 }, (_, i) => [`Row ${i + 1}`, i, i, 0]) };
    const doc = await buildReportPdf(many, META);
    const pages = doc.getNumberOfPages();
    assert.ok(pages >= 3, `expected a long report to need several pages, got ${pages}`);
    const text = doc.output();
    assert.ok(text.includes('Booking Trend Report'));
    assert.ok(text.includes('Roberto Alcantara'));
    assert.ok(text.includes('Summary'));
    assert.ok(text.includes('Bookings in the periods shown'));
    for (let i = 1; i <= pages; i++) assert.ok(text.includes(`Page ${i} of ${pages}`), `page ${i} has no page number footer`);
    assert.ok((text.match(/Exported by Roberto Alcantara/g) ?? []).length >= pages, 'the exporter is in the footer of every page');
  });
  it('is landscape for a wide table and portrait for a narrow one', async () => {
    const narrow = await buildReportPdf(TABLE, META);
    assert.ok(narrow.internal.pageSize.getWidth() < narrow.internal.pageSize.getHeight());
    const wide = await buildReportPdf({ ...TABLE, headers: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], rows: [[1, 2, 3, 4, 5, 6, 7]] }, META);
    assert.ok(wide.internal.pageSize.getWidth() > wide.internal.pageSize.getHeight());
  });
  it('an empty report says so instead of printing an empty table', async () => {
    const doc = await buildReportPdf({ ...TABLE, rows: [] }, META);
    assert.ok(doc.output().includes('No records match.'));
  });
});
