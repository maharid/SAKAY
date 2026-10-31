import { AUDIT_EXPORT_MAX_ROWS, AUDIT_LOG_PAGE_SIZE } from '../config/policyConfig';
import { downloadCsv } from './csvDownload';
import type { ReportTable } from './reportExport';

/**
 * The audit log (Rule 28.4) as the portals read and export it. The database does the work (get_audit_log: paging, the actor's real name from the account, UTC
 * and Asia/Manila times, a TODA Administrator sees their own entries only; record_audit_export: the export is itself audited). Here: the shapes, the paging loop and
 * the Excel / CSV / PDF export of a page set. The audit log is append-only: nothing in this file writes an entry.
 */

export interface AuditLogEntry {
  log_id: string;
  performed_at: string;
  performed_at_manila: string;
  action_type: string;
  category: string | null;
  target_id: string | null;
  target_name: string | null;
  details: string | null;
  before_state: unknown;
  after_state: unknown;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string;
}

export interface AuditLogFilters {
  /** ISO time, inclusive */
  from?: string | null;
  /** ISO time, exclusive */
  to?: string | null;
  action?: string | null;
  search?: string | null;
}

export interface AuditLogPage {
  total: number;
  limit: number;
  offset: number;
  rows: AuditLogEntry[];
}

/** The part of a Supabase client this needs: a way to call a database function */
export type AuditRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** A calendar day typed in a date box (YYYY-MM-DD) is a day in Asia/Manila: its first instant (inclusive) and the first instant of the next day (exclusive) */
export function manilaDayStartIso(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00+08:00`).toISOString() : null;
}
export function manilaNextDayStartIso(day: string): string | null {
  const start = manilaDayStartIso(day);
  return start ? new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
}

const argsOf = (f: AuditLogFilters, limit: number, offset: number): Record<string, unknown> => ({
  p_from: f.from || null,
  p_to: f.to || null,
  p_action: f.action || null,
  p_search: f.search || null,
  p_limit: limit,
  p_offset: offset,
});

export async function fetchAuditLogPage(rpc: AuditRpc, filters: AuditLogFilters = {}, limit: number = AUDIT_LOG_PAGE_SIZE, offset = 0): Promise<AuditLogPage> {
  const { data, error } = await rpc('get_audit_log', argsOf(filters, limit, offset));
  if (error) throw new Error(error.message);
  const page = (data ?? {}) as Partial<AuditLogPage>;
  return { total: Number(page.total ?? 0), limit: Number(page.limit ?? limit), offset: Number(page.offset ?? offset), rows: Array.isArray(page.rows) ? (page.rows as AuditLogEntry[]) : [] };
}

/** Every entry the filters match, page after page, up to `maxRows` (the export). `truncated` is true when there were more. */
export async function fetchAuditLogForExport(rpc: AuditRpc, filters: AuditLogFilters = {}, maxRows: number = AUDIT_EXPORT_MAX_ROWS): Promise<{ rows: AuditLogEntry[]; total: number; truncated: boolean }> {
  const rows: AuditLogEntry[] = [];
  let total = 0;
  const pageSize = 1000;
  while (rows.length < maxRows) {
    const page = await fetchAuditLogPage(rpc, filters, Math.min(pageSize, maxRows - rows.length), rows.length);
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length === 0 || rows.length >= total) break;
  }
  return { rows, total, truncated: rows.length < total };
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export const AUDIT_EXPORT_HEADERS = ['Time (Asia/Manila)', 'Time (UTC)', 'Actor', 'Actor role', 'Action', 'Category', 'Target', 'Target ID', 'Details', 'Before', 'After', 'Log ID'];

/** The table of an export: one row per entry, times in Asia/Manila and in UTC */
export function auditLogExportMatrix(rows: AuditLogEntry[]): string[][] {
  return rows.map((r) => [
    r.performed_at_manila,
    r.performed_at,
    r.actor_name,
    text(r.actor_role),
    r.action_type,
    text(r.category),
    text(r.target_name),
    text(r.target_id),
    text(r.details),
    text(r.before_state),
    text(r.after_state),
    r.log_id,
  ]);
}

/** audit_log_2026-10-18.xlsx */
export function auditLogFileName(extension: 'xlsx' | 'csv' | 'pdf', date: Date = new Date()): string {
  return `audit_log_${date.toISOString().slice(0, 10)}.${extension}`;
}

/** The part of the `xlsx` package an export needs (the portals have it installed; the shared package does not depend on it) */
export interface XlsxLike {
  utils: {
    aoa_to_sheet(data: unknown[][]): unknown;
    book_new(): unknown;
    book_append_sheet(workbook: unknown, sheet: unknown, name: string): void;
  };
  writeFile(workbook: unknown, filename: string): void;
}

export function exportAuditLogXlsx(xlsx: XlsxLike, rows: AuditLogEntry[], filename: string = auditLogFileName('xlsx')): void {
  const sheet = xlsx.utils.aoa_to_sheet([AUDIT_EXPORT_HEADERS, ...auditLogExportMatrix(rows)]);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, 'Audit log');
  xlsx.writeFile(book, filename);
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The PDF: a print-ready page the browser saves as PDF ("Save as PDF" in the print dialog). No PDF library is added to the app. The page carries the time and the
 * number of entries, the time in Asia/Manila, the actor and the details (the before / after states are in the Excel and CSV exports).
 * Returns false when the browser blocked the new window.
 */
export function printAuditLogPdf(rows: AuditLogEntry[], title: string, generatedBy: string): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank');
  if (!win) return false;
  const when = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const body = rows
    .map((r) => `<tr><td>${escapeHtml(r.performed_at_manila)}</td><td>${escapeHtml(r.actor_name)}<br><small>${escapeHtml(text(r.actor_role))}</small></td><td>${escapeHtml(r.action_type)}</td><td>${escapeHtml(text(r.target_name) || text(r.target_id))}</td><td>${escapeHtml(text(r.details))}</td></tr>`)
    .join('');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { font-size: 11px; margin: 0 0 12px; color: #444; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; } th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; } tr { page-break-inside: avoid; } small { color: #555; }
  @media print { @page { size: A4 landscape; margin: 12mm; } }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>Generated ${escapeHtml(when)} (Asia/Manila) by ${escapeHtml(generatedBy)}. ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}. Times are Asia/Manila.</p>
<table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${body}</tbody></table>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`);
  win.document.close();
  return true;
}

/**
 * One export for both portals: fetch what the filters match (up to the cap), WRITE THE EXPORT TO THE AUDIT LOG FIRST (who exported what, and when; if that fails
 * nothing is handed over), then hand over the file. `loadXlsx` loads the portal's `xlsx` package only when Excel is chosen.
 */
export async function exportAuditLogFile(opts: {
  rpc: AuditRpc;
  format: 'xlsx' | 'csv' | 'pdf';
  filters: AuditLogFilters;
  generatedBy: string;
  title: string;
  loadXlsx: () => Promise<XlsxLike>;
}): Promise<{ count: number; truncated: boolean }> {
  const { rows, truncated } = await fetchAuditLogForExport(opts.rpc, opts.filters);
  const { error } = await opts.rpc('record_audit_export', { p_format: opts.format, p_row_count: rows.length, p_filters: opts.filters });
  if (error) throw new Error(error.message);
  if (opts.format === 'xlsx') {
    exportAuditLogXlsx(await opts.loadXlsx(), rows);
  } else if (opts.format === 'csv') {
    downloadCsv(auditLogFileName('csv'), AUDIT_EXPORT_HEADERS, auditLogExportMatrix(rows));
  } else if (!printAuditLogPdf(rows, opts.title, opts.generatedBy)) {
    throw new Error('The browser blocked the PDF window. Allow pop-ups for this site and try again.');
  }
  return { count: rows.length, truncated };
}

// ---- the audit log as a report (the one export design, same as every other table: packages/shared/src/utils/reportExport.ts) -----------------------------------------------------

/** The columns the PDF shows (the Excel and CSV files have all of them, the before / after states included): the time, who, their role, what, the target and the details */
const AUDIT_PDF_COLUMNS = [0, 2, 3, 4, 6, 8];

/**
 * Every entry the filters match (up to the cap) as a report table: `keep` narrows them further with a filter the database does not have (the page's action category), so the file
 * is exactly what the page shows for the same dates, search and category. The signed-in person only ever receives their own scope (a TODA Administrator's own entries).
 */
export async function loadAuditExportTable(
  rpc: AuditRpc,
  filters: AuditLogFilters,
  opts: { title: string; covers: string[]; keep?: (entry: AuditLogEntry) => boolean },
): Promise<ReportTable> {
  const { rows, total, truncated } = await fetchAuditLogForExport(rpc, filters);
  const kept = opts.keep ? rows.filter(opts.keep) : rows;
  return {
    title: opts.title,
    notes: opts.covers,
    summary: [
      { label: 'Entries in this export', value: kept.length },
      { label: 'Different people who acted', value: new Set(kept.map((r) => r.actor_name)).size },
    ],
    headers: AUDIT_EXPORT_HEADERS,
    rows: auditLogExportMatrix(kept),
    pdfColumns: AUDIT_PDF_COLUMNS,
    orientation: 'landscape',
    caveat: truncated ? `Only the first ${rows.length} of ${total} entries were exported: narrow the dates to export the rest.` : undefined,
  };
}

/** Writes the export itself to the audit log (who, which format, how many entries, which filters) before any file is handed over */
export async function recordAuditExportEntry(rpc: AuditRpc, format: 'Excel' | 'CSV' | 'PDF', rowCount: number, filters: AuditLogFilters): Promise<void> {
  const { error } = await rpc('record_audit_export', { p_format: format === 'Excel' ? 'xlsx' : format.toLowerCase(), p_row_count: rowCount, p_filters: filters });
  if (error) throw new Error(error.message);
}
