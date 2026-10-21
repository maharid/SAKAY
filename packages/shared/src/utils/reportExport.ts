/**
 * Report exports for the portals: ONE table (a title, the filter in words, headers, rows) as CSV, a real .xlsx workbook, or a PDF.
 *
 * The PDF is a print-ready page the browser saves as PDF ("Save as PDF" in the print dialog); no PDF library is added to the apps. The .xlsx is written by the
 * portal's `xlsx` package, passed in as `xlsx` so this package does not depend on it. Times are Asia/Manila.
 */
import { downloadCsv, reportFileName } from './csvDownload';
import type { XlsxLike } from './auditLog';

export type ReportCell = string | number | null | undefined;

export interface ReportTable {
  /** "Booking Trend Report (Weekly)" */
  title: string;
  /** the filter in words and the basis of the figures, shown under the title in the PDF and above the table in the workbook */
  notes: string[];
  headers: string[];
  rows: ReportCell[][];
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cellText = (c: ReportCell): string => (c === null || c === undefined ? '' : String(c));

/** "booking_trend_report_weekly_2026-10-06.xlsx" */
export const reportXlsxName = (title: string, date: Date = new Date()): string => reportFileName(title, date).replace(/\.csv$/, '.xlsx');

/** The sheet name Excel accepts: at most 31 characters, none of  \ / ? * [ ] : */
const sheetName = (title: string): string => title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Report';

export function exportReportCsv(table: ReportTable, date: Date = new Date()): void {
  downloadCsv(reportFileName(table.title, date), table.headers, table.rows);
}

/** The notes sit above the header row, then one empty row, so the sheet reads like the printed report */
export function exportReportXlsx(xlsx: XlsxLike, table: ReportTable, date: Date = new Date()): void {
  const aoa: unknown[][] = [[table.title], ...table.notes.map((n) => [n]), [], table.headers, ...table.rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c)))];
  const sheet = xlsx.utils.aoa_to_sheet(aoa);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, sheetName(table.title));
  xlsx.writeFile(book, reportXlsxName(table.title, date));
}

/** Opens the print dialog on a clean page of the table. Returns false when the browser blocked the new window. */
export function printReportPdf(table: ReportTable, generatedBy: string): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank');
  if (!win) return false;
  const when = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const head = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = table.rows.length > 0
    ? table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(cellText(c))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${Math.max(1, table.headers.length)}">No records match.</td></tr>`;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(table.title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { font-size: 11px; margin: 0 0 4px; color: #444; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; margin-top: 12px; } th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; } tr { page-break-inside: avoid; }
  @media print { @page { size: A4 landscape; margin: 12mm; } }
</style></head><body>
<h1>${escapeHtml(table.title)}</h1>
${table.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
<p>Generated ${escapeHtml(when)} (Asia/Manila) by ${escapeHtml(generatedBy)}. ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}.</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`);
  win.document.close();
  return true;
}
