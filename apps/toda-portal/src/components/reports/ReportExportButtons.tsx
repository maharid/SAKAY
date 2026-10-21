import React, { useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { exportReportCsv, exportReportXlsx, printReportPdf } from '@sakay/shared';
import type { ReportTable, XlsxLike } from '@sakay/shared';

export type ExportFormat = 'Excel' | 'CSV' | 'PDF';

interface ReportExportButtonsProps {
  /** The report as shown on screen; the three files contain exactly this table. Null while there is nothing to export. */
  table: ReportTable | null;
  /** Who the PDF says generated it */
  generatedBy: string;
  /** Called after the file was handed over, so the page can write the audit entry */
  onExported: (reportName: string, format: ExportFormat) => void;
}

/**
 * Checklist B5: every TODA report exports to Excel (.xlsx) and to PDF as well as CSV. The PDF is the browser's print dialog ("Save as PDF"); no PDF library is added.
 */
export const ReportExportButtons: React.FC<ReportExportButtonsProps> = ({ table, generatedBy, onExported }) => {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (format: ExportFormat) => {
    if (!table) return;
    setBusy(format);
    setProblem(null);
    try {
      if (format === 'Excel') {
        exportReportXlsx((await import('xlsx')) as unknown as XlsxLike, table);
      } else if (format === 'CSV') {
        exportReportCsv(table);
      } else if (!printReportPdf(table, generatedBy)) {
        throw new Error('The browser blocked the PDF window. Allow pop-ups for this site and try again.');
      }
      onExported(table.title, format);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The report could not be exported.');
    } finally {
      setBusy(null);
    }
  };

  const disabled = !table || busy !== null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button onClick={() => void run('Excel')} disabled={disabled} startIcon={<DownloadIcon />} variant="contained" size="small" sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}>
          {busy === 'Excel' ? 'Exporting...' : 'Excel (.xlsx)'}
        </Button>
        <Button onClick={() => void run('CSV')} disabled={disabled} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>
          CSV
        </Button>
        <Button onClick={() => void run('PDF')} disabled={disabled} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>
          {busy === 'PDF' ? 'Preparing...' : 'Save as PDF'}
        </Button>
      </Box>
      {problem && <Alert severity="error" onClose={() => setProblem(null)} sx={{ py: 0 }}>{problem}</Alert>}
    </Box>
  );
};
