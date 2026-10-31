import React from 'react';
import { ExportToolbar } from '@sakay/shared';
import type { ExportFormat, ReportTable } from '@sakay/shared';

import { useAuth } from '../../contexts/AuthContext';
import { loadXlsx } from '../../utils/loadXlsx';

export type { ExportFormat };

interface ReportExportButtonsProps {
  /** The report as shown on screen; the three files contain exactly this table. Null while there is nothing to export. */
  table: ReportTable | null;
  /** The role the files say exported it, e.g. "Xentro Mall TODA Administrator"; the person's name comes from the signed-in administrator */
  generatedBy: string;
  /** Called BEFORE the file is handed over, so the page can write the audit entry (if it throws, no file is made) */
  onExported: (reportName: string, format: ExportFormat) => void | Promise<void>;
}

/**
 * Every TODA report exports to Excel (.xlsx), CSV and PDF through the shared export toolbar (the same design as the LGU portal): Excel and PDF carry a header (what the report
 * covers, the TODA, when, and who exported it), the summary above the table and a footer; the PDF has the page number on every page; the success message is a toast.
 */
export const ReportExportButtons: React.FC<ReportExportButtonsProps> = ({ table, generatedBy, onExported }) => {
  const { todaAdminProfile } = useAuth();
  const todaName = todaAdminProfile?.toda?.toda_name || 'TODA';
  return (
    <ExportToolbar
      getTable={() => table}
      meta={() => ({ exportedBy: todaAdminProfile?.full_name || 'TODA Administrator', role: generatedBy, organisation: todaName, scope: todaName })}
      loadXlsx={loadXlsx}
      record={({ format, table: exported }) => onExported(exported.title, format)}
      disabled={!table}
      disabledReason="There is nothing to export yet"
    />
  );
};
