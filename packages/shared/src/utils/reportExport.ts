/**
 * Report exports for the portals: ONE table as CSV, a real .xlsx workbook, or a real PDF (decision D-P6, panel: "summary nasa taas then table. Timestamp, who exported. For both
 * Excel and PDF. This means to put header and footer in reports").
 *
 * What an Excel or PDF report looks like:
 *   HEADER   the system and the city, the report's name, what it covers (the period, the TODA, the barangay: the filters in words), when it was generated (Asia/Manila) and
 *            WHO exported it (name and role)
 *   SUMMARY  the headline figures, ABOVE the table
 *   TABLE    the rows
 *   FOOTER   the closing line (number of rows, who exported it and when, that the figures describe SAKAY bookings only), and on the PDF the page number on every page
 * CSV is data only (a spreadsheet or a script reads it): no header, summary or footer lines.
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
}

/** Who exports the report, and when: written into the header and the footer of the Excel and PDF files */
export interface ReportMeta {
  /** the person's name, e.g. "Roberto Alcantara" */
  exportedBy: string;
  /** "LGU Administrator" / "TODA Administrator, Xentro Mall TODA" */
  role: string;
  generatedAt?: Date;
}

export const REPORT_ORGANISATION = 'SAKAY - Smart Assisted Kommuter Access sYstem, Calapan City';
export const REPORT_BASIS = 'The figures describe SAKAY bookings only (a pilot), not all tricycle travel in Calapan City.';

const cellText = (c: ReportCell): string => (c === null || c === undefined ? '' : String(c));
const stamp = (d: Date): string => d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' (Asia/Manila)';

/** "booking_trend_report_week_oct_26_nov_1_2026_2026-10-30.xlsx" */
export const reportXlsxName = (title: string, date: Date = new Date()): string => reportFileName(title, date).replace(/\.csv$/, '.xlsx');
export const reportPdfName = (title: string, date: Date = new Date()): string => reportFileName(title, date).replace(/\.csv$/, '.pdf');

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

export function exportReportCsv(table: ReportTable, date: Date = new Date()): void {
  downloadCsv(reportFileName(table.title, date), table.headers, table.rows);
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

export function exportReportXlsx(xlsx: XlsxLike, table: ReportTable, meta: ReportMeta, date: Date = new Date()): void {
  const sheet = xlsx.utils.aoa_to_sheet(reportSheetRows(table, meta));
  // column widths: wide enough for the header cells and the longest value of each column (at most 60)
  const widths = table.headers.map((h, i) => ({ wch: Math.min(60, Math.max(12, h.length + 2, ...table.rows.slice(0, 200).map((r) => cellText(r[i]).length + 2))) }));
  (sheet as unknown as Record<string, unknown>)['!cols'] = widths;
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, sheetName(table.title));
  xlsx.writeFile(book, reportXlsxName(table.title, date));
}

/**
 * The PDF: the header and the summary on the first page, the table (its heading row repeated on every page), and on EVERY page a footer with who exported it, when, and
 * "Page 2 of 5". Landscape when the table is wide.
 */
/** Draws the report (nothing is saved here: the tests and exportReportPdf use it) */
export async function buildReportPdf(table: ReportTable, meta: ReportMeta): Promise<import('jspdf').jsPDF> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;
  const landscape = table.headers.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;

  let y = margin;
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
      margin: { left: margin, right: margin },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;
  }

  autoTable(doc, {
    startY: y,
    head: [table.headers],
    body: table.rows.length > 0 ? table.rows.map((r) => r.map(cellText)) : [[{ content: 'No records match.', colSpan: Math.max(1, table.headers.length) }]],
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 102, 0], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 248] },
    margin: { left: margin, right: margin, bottom: 46 },
    showHead: 'everyPage',
  });

  // the footer of every page, once the number of pages is known
  const pages = doc.getNumberOfPages();
  const footer = reportFooterLines(table, meta);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, height - 40, width - margin, height - 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(footer[1], margin, height - 28);
    doc.text(i === pages ? `${footer[0]} ${footer[2]}` : footer[2], margin, height - 18, { maxWidth: width - 2 * margin - 80 });
    doc.text(`Page ${i} of ${pages}`, width - margin, height - 28, { align: 'right' });
  }
  return doc;
}

export async function exportReportPdf(table: ReportTable, meta: ReportMeta, date: Date = new Date()): Promise<void> {
  (await buildReportPdf(table, meta)).save(reportPdfName(table.title, date));
}
