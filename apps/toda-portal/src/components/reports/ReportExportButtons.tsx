import React, { useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { exportReportCsv, exportReportPdf, exportReportXlsx } from '@sakay/shared';
import type { ReportTable, XlsxLike } from '@sakay/shared';

import { useAuth } from '../../contexts/AuthContext';
import { secondaryButtonSx } from '../common/pageButtons';

export type ExportFormat = 'Excel' | 'CSV' | 'PDF';

interface ReportExportButtonsProps {
  /** The report as shown on screen; the three files contain exactly this table. Null while there is nothing to export. */
  table: ReportTable | null;
  /** The role the files say exported it, e.g. "Xentro Mall TODA Administrator"; the person's name comes from the signed-in administrator */
  generatedBy: string;
  /** Called after the file was handed over, so the page can write the audit entry */
  onExported: (reportName: string, format: ExportFormat) => void;
}

/**
 * Checklist B5: every TODA report exports to Excel (.xlsx) and to PDF as well as CSV. Excel and PDF carry a header (what the report covers, when, and who exported it), the summary
 * above the table and a footer (decision D-P6); the PDF is a real file with the page number on every page.
 */
export const ReportExportButtons: React.FC<ReportExportButtonsProps> = ({ table, generatedBy, onExported }) => {
  const { todaAdminProfile } = useAuth();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (format: ExportFormat) => {
    if (!table) return;
    setBusy(format);
    setProblem(null);
    try {
      const meta = { exportedBy: todaAdminProfile?.full_name || 'TODA Administrator', role: generatedBy };
      if (format === 'Excel') {
        exportReportXlsx((await import('xlsx')) as unknown as XlsxLike, table, meta);
      } else if (format === 'CSV') {
        exportReportCsv(table);
      } else {
        await exportReportPdf(table, meta);
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
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: '8px' }}>
      <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button onClick={() => void run('Excel')} disabled={disabled} variant="outlined" sx={secondaryButtonSx}>
          {busy === 'Excel' ? 'Exporting...' : 'Excel (.xlsx)'}
        </Button>
        <Button onClick={() => void run('CSV')} disabled={disabled} variant="outlined" sx={secondaryButtonSx}>
          CSV
        </Button>
        <Button onClick={() => void run('PDF')} disabled={disabled} variant="outlined" sx={secondaryButtonSx}>
          {busy === 'PDF' ? 'Preparing...' : 'Save as PDF'}
        </Button>
      </Box>
      {problem && <Alert severity="error" onClose={() => setProblem(null)} sx={{ py: 0, borderRadius: '8px' }}>{problem}</Alert>}
    </Box>
  );
};
