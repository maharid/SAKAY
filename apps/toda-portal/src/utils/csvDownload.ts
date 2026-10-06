/**
 * Saves a table as a CSV file the browser downloads (opens in Excel). Every cell is quoted, so commas, quotes and line breaks in names or
 * addresses cannot break the columns; the byte-order mark makes Excel read Filipino characters correctly.
 */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const cell = (value: string | number | null | undefined): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const text = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** "Booking Volume (Weekly)" on 2026-10-06 becomes "booking_volume_weekly_2026-10-06.csv" */
export function reportFileName(reportName: string, date: Date = new Date()): string {
  const slug = reportName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug}_${date.toISOString().slice(0, 10)}.csv`;
}
