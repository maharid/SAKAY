// The one export design of the LGU and TODA portals (packages/shared/src/utils/reportExport.ts, csvDownload.ts, auditLog.ts, appFeedback.ts): a CSV that cannot be turned into a formula
// and keeps its structure, descriptive file names, a PDF with the SAKAY band, wrapped columns and page numbers on every page, the audit log as a report that follows its filters,
// and the feedback form's checks.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvText, reportFileName } from '../../packages/shared/src/utils/csvDownload';
import { buildReportPdf, reportHeaderLines, reportPdfName, reportSheetRows, reportXlsxName } from '../../packages/shared/src/utils/reportExport';
import type { ReportMeta, ReportTable } from '../../packages/shared/src/utils/reportExport';
import { AUDIT_EXPORT_HEADERS, loadAuditExportTable, recordAuditExportEntry } from '../../packages/shared/src/utils/auditLog';
import type { AuditLogEntry, AuditRpc } from '../../packages/shared/src/utils/auditLog';
import { FEEDBACK_COMMENT_MAX, feedbackProblem } from '../../packages/shared/src/utils/appFeedback';

const META: ReportMeta = { exportedBy: 'Maria Santos', role: 'LGU Administrator', organisation: 'City Transport Office, Calapan City', scope: 'lgu', generatedAt: new Date('2026-10-31T06:30:00Z') };

describe('a CSV cell', () => {
  it('is always quoted, with quotes doubled, so commas, quotes and line breaks cannot break the columns', () => {
    assert.equal(csvCell('Rizal St, Calapan'), '"Rizal St, Calapan"');
    assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
    assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(undefined), '""');
    assert.equal(csvCell(12.5), '"12.5"');
  });
  it('can never run as a formula in a spreadsheet: a text starting with = @ + - (not a number) gets an apostrophe', () => {
    assert.equal(csvCell('=SUM(A1:A9)'), `"'=SUM(A1:A9)"`);
    assert.equal(csvCell('@cmd'), `"'@cmd"`);
    assert.equal(csvCell('+cmd|calc'), `"'+cmd|calc"`);
    assert.equal(csvCell('-2+3'), '"-2+3"', 'a minus followed by a number is left alone');
    assert.equal(csvCell('+63 917 123 4567'), '"+63 917 123 4567"', 'a phone number is left alone');
    assert.equal(csvCell(-5), '"-5"', 'a real number is never touched');
    assert.equal(csvCell('Normal text'), '"Normal text"');
  });
  it('a file is one heading row and the rows, one line each, nothing else', () => {
    const text = csvText(['Name', 'Note'], [['A', 'x'], ['B', null]]);
    assert.equal(text, '"Name","Note"\r\n"A","x"\r\n"B",""');
  });
});

describe('the file names say who, what and when (Asia/Manila)', () => {
  const day = new Date('2026-10-31T06:30:00Z'); // 14:30 in Manila
  it('are descriptive, lower case, and the same for the three formats', () => {
    assert.equal(reportFileName('Booking Trend Report (Week: Oct 26 - Nov 1, 2026)', day, 'lgu'), 'sakay_lgu_booking_trend_report_week_oct_26_nov_1_2026_2026-10-31_1430.csv');
    assert.equal(reportXlsxName('Audit Log (LGU)', day, 'lgu'), 'sakay_lgu_audit_log_lgu_2026-10-31_1430.xlsx');
    assert.equal(reportPdfName('Audit Log (LGU)', day, 'lgu'), 'sakay_lgu_audit_log_lgu_2026-10-31_1430.pdf');
  });
  it('carry the TODA’s name for a TODA report, and no scope when there is none', () => {
    assert.equal(reportFileName('Incident Summary Report', day, 'Xentro Mall TODA'), 'sakay_xentro_mall_toda_incident_summary_report_2026-10-31_1430.csv');
    assert.equal(reportFileName('Incident Summary Report', day), 'sakay_incident_summary_report_2026-10-31_1430.csv');
  });
  it('use the Manila day and hour even when it is still the day before in UTC', () => {
    assert.match(reportFileName('x', new Date('2026-10-31T17:05:00Z')), /_2026-11-01_0105\.csv$/);
  });
});

describe('the header of an Excel or PDF file', () => {
  const table: ReportTable = { title: 'Incident Reports (LGU)', notes: ['Status: All; Category: All'], headers: ['A'], rows: [['1']] };
  it('names the organisation when there is one, before who exported it', () => {
    const lines = reportHeaderLines(table, META);
    const keys = lines.map(([k]) => k);
    assert.deepEqual(keys, ['Covers', 'Organization', 'Generated', 'Exported by']);
    assert.deepEqual(lines[1], ['Organization', 'City Transport Office, Calapan City']);
  });
  it('the sheet carries the filters in words, the exporter and the table', () => {
    const rows = reportSheetRows(table, META);
    assert.ok(rows.some((r) => r[0] === 'Covers' && r[1] === 'Status: All; Category: All'));
    assert.ok(rows.some((r) => r[0] === 'Exported by' && String(r[1]).includes('Maria Santos')));
    assert.ok(rows.some((r) => r === table.headers));
  });
});

describe('the PDF', () => {
  const long = 'The driver admitted raising his voice at the passenger and was warned by the TODA administrator; the passenger accepted the explanation. '.repeat(3);
  const wide: ReportTable = {
    title: 'Audit Log (LGU)',
    notes: ['Period: the earliest entry to today'],
    headers: AUDIT_EXPORT_HEADERS,
    rows: Array.from({ length: 80 }, (_, i) => [`Oct ${i + 1}, 2026, 10:00 AM`, 'UTC', 'Maria Santos', 'LGU Administrator', 'INCIDENT_DECIDED', 'Incident Reports', 'Incident', `id-${i}`, long, '{}', '{}', `log-${i}`]),
    pdfColumns: [0, 2, 3, 4, 6, 8],
    orientation: 'landscape',
  };
  it('shows only the columns it is asked to, in landscape, and wraps the long text instead of cutting it', async () => {
    const doc = await buildReportPdf(wide, META);
    assert.ok(doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight());
    const text = doc.output();
    assert.ok(text.includes('The driver admitted raising'));
    assert.ok(!text.includes('Log ID'), 'a column the PDF does not show is not in it');
    assert.ok(text.includes('Actor role'));
  });
  it('has the SAKAY band and the page number on every page, and the exporter in every footer', async () => {
    const doc = await buildReportPdf(wide, META);
    const pages = doc.getNumberOfPages();
    assert.ok(pages >= 3, `expected several pages, got ${pages}`);
    const text = doc.output();
    for (let i = 1; i <= pages; i += 1) assert.ok(text.includes(`Page ${i} of ${pages}`), `page ${i}`);
    assert.ok((text.match(/SAKAY/g) ?? []).length >= pages, 'the band is on every page');
    assert.ok((text.match(/Exported by Maria Santos/g) ?? []).length >= pages);
  });
  it('can be forced to portrait or landscape whatever the number of columns', async () => {
    const small: ReportTable = { title: 'T', notes: [], headers: ['a', 'b'], rows: [[1, 2]] };
    assert.ok((await buildReportPdf({ ...small, orientation: 'landscape' }, META)).internal.pageSize.getWidth() > 800);
    assert.ok((await buildReportPdf(small, META)).internal.pageSize.getWidth() < 800);
  });
});

describe('the audit log as a report', () => {
  const entry = (n: number, action: string): AuditLogEntry => ({
    log_id: `log-${n}`, action_type: action, performed_at: `2026-10-0${n}T01:00:00Z`, performed_at_manila: `Oct ${n}, 2026, 9:00 AM`, actor_id: 'a1', actor_role: 'LGU Administrator', actor_name: n % 2 ? 'Maria' : 'Jose',
    target_id: `t${n}`, target_name: `Target ${n}`, details: `Details ${n}`, category: null, before_state: null, after_state: null,
  } as unknown as AuditLogEntry);
  const rows = [entry(1, 'FARE_MATRIX_ENACTED'), entry(2, 'ANNOUNCEMENT_PUBLISHED'), entry(3, 'FARE_MATRIX_ENACTED')];
  const rpc: AuditRpc = async (fn, args) => {
    if (fn === 'get_audit_log') return { data: { total: rows.length, limit: Number(args.p_limit), offset: Number(args.p_offset), rows: rows.slice(Number(args.p_offset), Number(args.p_offset) + Number(args.p_limit)) }, error: null };
    return { data: null, error: null };
  };
  it('follows the category the page filters on, not only the dates and the search', async () => {
    const all = await loadAuditExportTable(rpc, {}, { title: 'Audit Log (LGU)', covers: ['all'] });
    const fare = await loadAuditExportTable(rpc, {}, { title: 'Audit Log (LGU)', covers: ['fare'], keep: (e) => e.action_type.includes('FARE') });
    assert.equal(all.rows.length, 3);
    assert.equal(fare.rows.length, 2);
    assert.deepEqual(fare.summary, [{ label: 'Entries in this export', value: 2 }, { label: 'Different people who acted', value: 1 }]);
    assert.deepEqual(fare.headers, AUDIT_EXPORT_HEADERS);
    assert.deepEqual(fare.pdfColumns, [0, 2, 3, 4, 6, 8]);
  });
  it('writes the export to the audit log with the format and the number of entries', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const recorder: AuditRpc = async (fn, args) => {
      calls.push({ fn, args });
      return { data: null, error: null };
    };
    await recordAuditExportEntry(recorder, 'Excel', 2, { search: 'fare' });
    await recordAuditExportEntry(recorder, 'PDF', 5, {});
    assert.deepEqual(calls.map((c) => [c.fn, c.args.p_format, c.args.p_row_count]), [['record_audit_export', 'xlsx', 2], ['record_audit_export', 'pdf', 5]]);
  });
  it('refuses to hand over a file when the entry could not be written', async () => {
    const failing: AuditRpc = async () => ({ data: null, error: { message: 'permission denied' } });
    await assert.rejects(() => recordAuditExportEntry(failing, 'CSV', 1, {}), /permission denied/);
  });
});

describe('the feedback form', () => {
  it('needs a rating or a comment, and not too long a comment', () => {
    assert.match(feedbackProblem(null, '   ') ?? '', /rating or write a comment/);
    assert.equal(feedbackProblem(4, ''), null);
    assert.equal(feedbackProblem(null, 'The reports page is clearer now.'), null);
    assert.match(feedbackProblem(5, 'x'.repeat(FEEDBACK_COMMENT_MAX + 1)) ?? '', /too long/);
  });
});
