// Shared by the TODA and the LGU portals (one place for the file download of every exported table).

/**
 * One CSV cell. Every cell is quoted, so commas, quotes and line breaks in names or addresses cannot break the columns. A text that a spreadsheet would run as a formula
 * (it starts with =, @, a tab or a carriage return, or with + or - followed by something that is not a number) gets a leading apostrophe, so a name or a note typed by a user
 * can never become a formula in somebody's Excel.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? '');
  if (typeof value !== 'number' && /^(?:[=@\t\r]|[+-](?![\s]*[\d.(]))/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The text of a CSV file: the heading row, then the rows, one line each (CRLF) */
export function csvText(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Saves a table as a CSV file the browser downloads (opens in Excel). The byte-order mark makes Excel read Filipino characters correctly.
 */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const blob = new Blob(['﻿' + csvText(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** "Booking Volume (Weekly)" for the LGU on 2026-10-06 at 14:30 becomes "sakay_lgu_booking_volume_weekly_2026-10-06_1430.csv" (the date and time are Asia/Manila) */
export function reportFileName(reportName: string, date: Date = new Date(), scope?: string): string {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const day = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const time = date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(':', '');
  const parts = ['sakay', scope ? slug(scope).slice(0, 40) : '', slug(reportName).slice(0, 90)].filter(Boolean);
  return `${parts.join('_')}_${day}_${time}.csv`;
}
