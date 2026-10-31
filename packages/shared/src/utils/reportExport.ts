/**
 * Report exports for the portals: ONE table as CSV, a real .xlsx workbook, or a real PDF (decision D-P6, panel: "summary nasa taas then table. Timestamp, who exported. For both
 * Excel and PDF. This means to put header and footer in reports"). The LGU and the TODA portals, and every report, incident list and audit log in them, go through this one file.
 *
 * What an Excel or PDF report looks like:
 *   HEADER   the system and the city, the report's name, what it covers (the period, the TODA, the barangay: the filters in words), the organisation, when it was generated
 *            (Asia/Manila) and WHO exported it (name and role)
 *   SUMMARY  the headline figures, ABOVE the table
 *   TABLE    the rows (the PDF wraps long text, sizes the columns to their content and repeats the heading row and the SAKAY band on every page)
 *   FOOTER   the closing line (number of rows, who exported it and when, that the figures describe SAKAY bookings only), and on the PDF the page number on every page
 * CSV is data only (a spreadsheet or a script reads it): one heading row of clean column names, then the rows; no header, summary or footer lines, so the structure cannot be broken.
 *
 * The .xlsx is written by the portal's \`xlsx\` package (passed in as \`xlsx\`, so this package does not depend on it). The PDF is drawn with jsPDF and its autoTable plugin, loaded only
 * when a PDF is asked for. Times are Asia/Manila.
 */
import { downloadCsv, reportFileName } from './csvDownload';
import type { XlsxLike } from './auditLog';

export type ReportCell = string | number | null | undefined;

export interface ReportSummaryItem {
  label: string;
  value: ReportCell;
}

export interface ReportTable {
  /** "Booking Trend Report (Week: Oct 26 - Nov 1, 2026)": names exactly what the report is and covers */
  title: string;
  /** the period, the filters and the basis of the figures, in words: shown under the title */
  notes: string[];
  /** the headline figures, shown ABOVE the table */
  summary?: ReportSummaryItem[];
  headers: string[];
  rows: ReportCell[][];
  /** The columns the PDF shows (positions in `headers`, in order) when the page is too narrow for all of them. The Excel and CSV files always have every column. */
  pdfColumns?: number[];
  /** Force the PDF page direction (a table with long text reads better in landscape). Default: landscape when the PDF shows more than six columns. */
  orientation?: 'portrait' | 'landscape';
  /** Something the person must know about this file (for example: only the first 5000 entries). It is shown with the "exported" message. */
  caveat?: string;
}

/** Who exports the report, and when: written into the header and the footer of the Excel and PDF files */
export interface ReportMeta {
  /** the person's name, e.g. "Roberto Alcantara" */
  exportedBy: string;
  /** "LGU Administrator" / "TODA Administrator, Xentro Mall TODA" */
  role: string;
  generatedAt?: Date;
  /** The organisation the report belongs to ("City Transport Office, Calapan City" / the TODA's name): in the header, the PDF band and the file name */
  organisation?: string;
  /** A short word for the file name: "lgu", or the TODA's name */
  scope?: string;
}

export const REPORT_ORGANISATION = 'SAKAY - Smart Assisted Kommuter Access sYstem, Calapan City';
export const REPORT_BASIS = 'The figures describe SAKAY bookings only (a pilot), not all tricycle travel in Calapan City.';

const cellText = (c: ReportCell): string => (c === null || c === undefined ? '' : String(c));
const stamp = (d: Date): string => d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' (Asia/Manila)';

/** "sakay_lgu_booking_trend_report_week_oct_26_nov_1_2026_2026-10-30_1430.xlsx": who, what, and when it was made */
export const reportXlsxName = (title: string, date: Date = new Date(), scope?: string): string => reportFileName(title, date, scope).replace(/\.csv$/, '.xlsx');
export const reportPdfName = (title: string, date: Date = new Date(), scope?: string): string => reportFileName(title, date, scope).replace(/\.csv$/, '.pdf');

/** The sheet name Excel accepts: at most 31 characters, none of  \ / ? * [ ] : */
const sheetName = (title: string): string => title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Report';

/**
 * The summary a report without its own gets (decision D-P6): the totals of the columns that count things (bookings, trips, completed, cancelled...) and the number of rows. A
 * report that knows its headline figures sets `summary` itself.
 */
export function summaryOf(table: ReportTable): ReportSummaryItem[] {
  if (table.summary && table.summary.length > 0) return table.summary;
  const items: ReportSummaryItem[] = [{ label: 'Rows in this report', value: table.rows.length }];
  table.headers.forEach((h, i) => {
    if (!/^(bookings|total bookings|trips|completed|completed trips|cancelled|no driver found|shared trips|incidents|reports)\b/i.test(h)) return;
    const values = table.rows.map((r) => r[i]);
    if (values.length === 0 || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    items.push({ label: `Total: ${h}`, value: (values as number[]).reduce((a, b) => a + b, 0) });
  });
  return items;
}

/** The lines above the table, shared by the Excel file and the PDF so they cannot differ */
export function reportHeaderLines(table: ReportTable, meta: ReportMeta): Array<[string, string]> {
  const when = stamp(meta.generatedAt ?? new Date());
  return [
    ...table.notes.map((n): [string, string] => ['Covers', n]),
    ...(meta.organisation ? [['Organization', meta.organisation] as [string, string]] : []),
    ['Generated', when],
    ['Exported by', `${meta.exportedBy} (${meta.role})`],
  ];
}

export function reportFooterLines(table: ReportTable, meta: ReportMeta): string[] {
  const when = stamp(meta.generatedAt ?? new Date());
  return [
    `End of report: ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}.`,
    `Exported by ${meta.exportedBy} (${meta.role}) on ${when}.`,
    REPORT_BASIS,
  ];
}

export function exportReportCsv(table: ReportTable, date: Date = new Date(), scope?: string): void {
  downloadCsv(reportFileName(table.title, date, scope), table.headers, table.rows);
}

/** The sheet as rows: header, summary, table, footer (exported for the tests) */
export function reportSheetRows(table: ReportTable, meta: ReportMeta): unknown[][] {
  const blank = (c: ReportCell) => (c === null || c === undefined ? '' : c);
  const summary = [['SUMMARY'], ...summaryOf(table).map((s) => [s.label, blank(s.value)]), []];
  return [
    [REPORT_ORGANISATION],
    [table.title],
    ...reportHeaderLines(table, meta).map(([k, v]) => [k, v]),
    [],
    ...summary,
    table.headers,
    ...table.rows.map((r) => r.map(blank)),
    [],
    ...reportFooterLines(table, meta).map((l) => [l]),
  ];
}

/** Excel column letters: 0 = A, 25 = Z, 26 = AA */
const columnLetters = (index: number): string => {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

export function exportReportXlsx(xlsx: XlsxLike, table: ReportTable, meta: ReportMeta, date: Date = new Date()): void {
  const sheetRows = reportSheetRows(table, meta);
  const sheet = xlsx.utils.aoa_to_sheet(sheetRows) as unknown as Record<string, unknown>;
  // column widths: wide enough for the header cells and the longest value of each column (at most 60)
  sheet['!cols'] = table.headers.map((h, i) => ({ wch: Math.min(60, Math.max(12, h.length + 2, ...table.rows.slice(0, 200).map((r) => cellText(r[i]).length + 2))) }));
  // a filter on the heading row, so the person can sort and search the table in Excel
  const headingRow = sheetRows.findIndex((r) => r === table.headers);
  if (headingRow >= 0 && table.headers.length > 0 && table.rows.length > 0) {
    sheet['!autofilter'] = { ref: `A${headingRow + 1}:${columnLetters(table.headers.length - 1)}${headingRow + 1 + table.rows.length}` };
  }
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, sheetName(table.title));
  xlsx.writeFile(book, reportXlsxName(table.title, date, meta.scope));
}

const BRAND_RGB: [number, number, number] = [199, 80, 0];
const BAND_HEIGHT = 24;

/** The widths (in points) of the PDF's columns: each in proportion to what it holds (a heading and its longest ordinary value), never narrower than a readable minimum */
function pdfColumnWidths(table: ReportTable, columns: number[], available: number): number[] {
  const sample = table.rows.slice(0, 300);
  const weights = columns.map((c) => {
    const lengths = sample.map((r) => cellText(r[c]).length).sort((a, b) => a - b);
    const typical = lengths.length > 0 ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))] : 0;
    return Math.min(46, Math.max(6, Math.min(table.headers[c]?.length ?? 6, 18), typical));
  });
  const minimum = Math.min(46, available / Math.max(1, columns.length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let widths = weights.map((w) => (available * w) / total);
  // a narrow column is lifted to the minimum and the others give up the difference
  const short = widths.filter((w) => w < minimum).length;
  if (short > 0) {
    const lifted = widths.map((w) => Math.max(w, minimum));
    const extra = lifted.reduce((a, b) => a + b, 0) - available;
    const roomy = lifted.filter((w) => w > minimum).reduce((a, b) => a + b, 0) || 1;
    widths = lifted.map((w) => (w > minimum ? w - (extra * w) / roomy : w));
  }
  return widths;
}

/**
 * The PDF: the SAKAY band on every page, the header and the summary on the first page, the table (its heading row repeated on every page, long text wrapped, numbers aligned to the
 * right), and on EVERY page a footer with who exported it, when, and "Page 2 of 5". Landscape when the table is wide or asks for it.
 */
/** Draws the report (nothing is saved here: the tests and exportReportPdf use it) */
export async function buildReportPdf(table: ReportTable, meta: ReportMeta): Promise<import('jspdf').jsPDF> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;
  const columns = table.pdfColumns && table.pdfColumns.length > 0 ? table.pdfColumns.filter((c) => c >= 0 && c < table.headers.length) : table.headers.map((_, i) => i);
  const landscape = table.orientation ? table.orientation === 'landscape' : columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setProperties({ title: table.title, subject: 'SAKAY report', author: meta.exportedBy, creator: 'SAKAY' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;
  const top = BAND_HEIGHT + 18;

  let y = top;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(194, 65, 12);
  doc.text(REPORT_ORGANISATION, margin, y);
  y += 20;
  doc.setFontSize(16);
  doc.setTextColor(17, 17, 17);
  const titleLines = doc.splitTextToSize(table.title, width - 2 * margin) as string[];
  doc.text(titleLines, margin, y);
  y += 18 * titleLines.length;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(68, 68, 68);
  for (const [label, value] of reportHeaderLines(table, meta)) {
    const lines = doc.splitTextToSize(`${label}: ${value}`, width - 2 * margin) as string[];
    doc.text(lines, margin, y);
    y += 12 * lines.length;
  }
  y += 6;

  {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(17, 17, 17);
    doc.text('Summary', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      body: summaryOf(table).map((s) => [s.label, cellText(s.value)]),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 230 } },
      margin: { left: margin, right: margin, top },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;
  }

  const widths = pdfColumnWidths(table, columns, width - 2 * margin);
  const columnStyles: Record<number, { cellWidth: number; halign: 'left' | 'right' }> = {};
  columns.forEach((c, i) => {
    const values = table.rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '');
    columnStyles[i] = { cellWidth: widths[i], halign: values.length > 0 && values.every((v) => typeof v === 'number') ? 'right' : 'left' };
  });

  autoTable(doc, {
    startY: y,
    head: [columns.map((c) => table.headers[c])],
    body: table.rows.length > 0 ? table.rows.map((r) => columns.map((c) => cellText(r[c]))) : [[{ content: 'No records match.', colSpan: Math.max(1, columns.length) }]],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 }, overflow: 'linebreak', valign: 'top', lineColor: [226, 226, 222], lineWidth: 0.4 },
    headStyles: { fillColor: BRAND_RGB, textColor: 255, fontStyle: 'bold', valign: 'middle' },
    alternateRowStyles: { fillColor: [250, 250, 248] },
    columnStyles,
    tableWidth: width - 2 * margin,
    margin: { left: margin, right: margin, top, bottom: 46 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
  });

  // the band at the top and the footer at the bottom of every page, once the number of pages is known
  const pages = doc.getNumberOfPages();
  const footer = reportFooterLines(table, meta);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...BRAND_RGB);
    doc.rect(0, 0, width, BAND_HEIGHT, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('SAKAY', margin, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const right = i === 1 ? meta.organisation ?? '' : table.title;
    if (right) doc.text(doc.splitTextToSize(right, width - 2 * margin - 90)[0] as string, width - margin, 16, { align: 'right' });

    doc.setDrawColor(200, 200, 200);
    doc.line(margin, height - 40, width - margin, height - 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(footer[1], margin, height - 28, { maxWidth: width - 2 * margin - 80 });
    doc.text(i === pages ? `${footer[0]} ${footer[2]}` : footer[2], margin, height - 18, { maxWidth: width - 2 * margin - 80 });
    doc.text(`Page ${i} of ${pages}`, width - margin, height - 28, { align: 'right' });
  }
  return doc;
}

export async function exportReportPdf(table: ReportTable, meta: ReportMeta, date: Date = new Date()): Promise<void> {
  (await buildReportPdf(table, meta)).save(reportPdfName(table.title, date, meta.scope));
}
