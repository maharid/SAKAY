import React, { useRef, useState } from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';

import { SakayToast } from './SakayToast';
import type { SakayToastSeverity } from './SakayToast';
import type { XlsxLike } from '../utils/auditLog';
import { exportReportCsv, exportReportPdf, exportReportXlsx, reportPdfName, reportXlsxName } from '../utils/reportExport';
import type { ReportMeta, ReportTable } from '../utils/reportExport';
import { reportFileName } from '../utils/csvDownload';

export type ExportFormat = 'Excel' | 'CSV' | 'PDF';

export interface ExportToolbarProps {
  /**
   * The table to export, built when a format is chosen (so a page can ask the database for the full set then). Return null when there is nothing to export. It must follow the
   * page's active filters and contain only what the signed-in person may see: the toolbar exports exactly what it is given.
   */
  getTable: () => ReportTable | null | Promise<ReportTable | null>;
  /** Who exports it (name and role), and the organisation: written into the Excel and PDF files and the file name */
  meta: () => ReportMeta;
  /** Loads the portal's `xlsx` package, e.g. `async () => (await import('xlsx')) as unknown as XlsxLike` (only when Excel is chosen) */
  loadXlsx: () => Promise<XlsxLike>;
  /**
   * Written BEFORE the file is handed over: the audit entry of the export (who exported what, and when). If it throws, no file is made and the person is told why, so an export is
   * never missing from the log.
   */
  record?: (info: { format: ExportFormat; table: ReportTable }) => Promise<void> | void;
  /** True while the page has nothing to export (still loading, or no data) */
  disabled?: boolean;
  /** Why it is disabled, for the tooltip */
  disabledReason?: string;
  /** What the buttons are for: the heading of the group (default "Export") */
  label?: string;
  /** A short line under the heading, e.g. "Follows the filters above" */
  hint?: string;
  /** How the group sits: a bordered card (default) or bare buttons for a tight toolbar */
  appearance?: 'card' | 'bare';
}

const FORMAT_INFO: Record<ExportFormat, { short: string; tip: string; Icon: React.ElementType }> = {
  Excel: { short: 'Excel', tip: 'An Excel workbook (.xlsx): the SAKAY header, the summary above the table, and a filter on the columns', Icon: TableChartOutlinedIcon },
  CSV: { short: 'CSV', tip: 'The table only, as plain data (.csv) for a spreadsheet or a script', Icon: DescriptionOutlinedIcon },
  PDF: { short: 'PDF', tip: 'A print-ready PDF with the SAKAY header, the page numbers and the exporter in the footer', Icon: PictureAsPdfOutlinedIcon },
};

const FORMATS: ExportFormat[] = ['Excel', 'CSV', 'PDF'];

/**
 * THE export control of the LGU and the TODA portals: three file formats in one labelled group, the same everywhere (a report, the incident list, the audit log). It builds the table
 * when a format is chosen, writes the audit entry first, hands over the file and says so with a toast that goes away by itself. One export at a time: while one is being made every
 * button is disabled, so a double click cannot make two files.
 */
export const ExportToolbar: React.FC<ExportToolbarProps> = ({ getTable, meta, loadXlsx, record, disabled = false, disabledReason, label = 'Export', hint, appearance = 'card' }) => {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [toast, setToast] = useState<{ severity: SakayToastSeverity; text: string } | null>(null);
  // a second click in the same moment is refused even before React has drawn the disabled buttons
  const inFlight = useRef(false);

  const run = async (format: ExportFormat) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(format);
    setToast(null);
    try {
      const table = await getTable();
      if (!table) {
        setToast({ severity: 'warning', text: 'There is nothing to export yet.' });
        return;
      }
      if (record) {
        try {
          await record({ format, table });
        } catch (err) {
          throw new Error(`The export was not recorded in the audit log, so no file was made. ${err instanceof Error ? err.message : ''}`.trim());
        }
      }
      const info = meta();
      const now = new Date();
      let fileName: string;
      if (format === 'Excel') {
        exportReportXlsx(await loadXlsx(), table, info, now);
        fileName = reportXlsxName(table.title, now, info.scope);
      } else if (format === 'CSV') {
        exportReportCsv(table, now, info.scope);
        fileName = reportFileName(table.title, now, info.scope);
      } else {
        await exportReportPdf(table, info, now);
        fileName = reportPdfName(table.title, now, info.scope);
      }
      const rows = `${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`;
      setToast({ severity: 'success', text: `${format} export ready: ${rows}, saved as ${fileName}.${table.caveat ? ` ${table.caveat}` : ''}` });
    } catch (err) {
      setToast({ severity: 'error', text: err instanceof Error && err.message ? err.message : 'The export could not be made. Try again.' });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const off = disabled || busy !== null;
  const buttons = (
    <Box role="group" aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      {FORMATS.map((format) => {
        const { short, tip, Icon } = FORMAT_INFO[format];
        return (
          <Tooltip key={format} title={disabled && disabledReason ? disabledReason : tip} arrow placement="top">
            <span>
              <Button
                onClick={() => void run(format)}
                disabled={off}
                aria-busy={busy === format}
                aria-label={`${label} as ${short}`}
                startIcon={<Icon sx={{ fontSize: 17 }} />}
                sx={{
                  minHeight: 34,
                  px: '12px',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontFamily: 'inherit',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1d1d1f',
                  border: '1px solid rgba(15, 23, 42, 0.18)',
                  backgroundColor: '#FFFFFF',
                  '&:hover': { backgroundColor: '#FFF4EA', borderColor: '#C75000', color: '#B34700' },
                  '&.Mui-disabled': { color: 'rgba(29, 29, 31, 0.45)', borderColor: 'rgba(15, 23, 42, 0.1)' },
                  '&:focus-visible': { outline: '2px solid #B34700', outlineOffset: '2px' },
                }}
              >
                {busy === format ? (format === 'PDF' ? 'Preparing...' : 'Exporting...') : short}
              </Button>
            </span>
          </Tooltip>
        );
      })}
    </Box>
  );

  return (
    <>
      {appearance === 'bare' ? (
        buttons
      ) : (
        <Box
          component="section"
          aria-label={label}
          sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', px: '12px', py: '8px', borderRadius: '10px', border: '1px solid rgba(15, 23, 42, 0.12)', backgroundColor: '#FAFAF8' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <FileDownloadOutlinedIcon aria-hidden sx={{ fontSize: 20, color: '#B34700' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#1d1d1f', lineHeight: 1.2 }}>{label}</Typography>
              {hint && <Typography sx={{ fontSize: '11px', color: '#4d4d52', lineHeight: 1.2 }}>{hint}</Typography>}
            </Box>
          </Box>
          {buttons}
        </Box>
      )}
      <SakayToast message={toast?.text ?? null} severity={toast?.severity ?? 'success'} onClose={() => setToast(null)} autoHideDuration={toast?.severity === 'error' ? 7000 : 4500} />
    </>
  );
};

export default ExportToolbar;
