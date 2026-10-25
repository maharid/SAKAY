import React from 'react';
import { Box } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import GavelIcon from '@mui/icons-material/Gavel';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';

import { DashboardCard, DashboardEmpty, DashboardList, DashboardListItem } from './DashboardCard';
import { StatusBadge } from '../common/StatusBadge';

interface IncidentItem {
  id: string;
  category: string;
  status: string;
  timestamp: string;
  severity: string;
  description: string;
  iconType: string;
}

interface RecentIncidentReportsCardProps {
  reports?: IncidentItem[];
}

export const RecentIncidentReportsCard: React.FC<RecentIncidentReportsCardProps> = ({ reports = [] }) => {
  const getIncidentIcon = (type?: string) => {
    switch (type) {
      case 'overcharging':
      case 'fare':
        return <AttachMoneyIcon aria-hidden sx={{ color: '#B91C1C', fontSize: 16 }} />;
      case 'misconduct':
      case 'behavior':
        return <GavelIcon aria-hidden sx={{ color: '#92400E', fontSize: 16 }} />;
      case 'route':
      case 'safety':
      default:
        return <ReportProblemIcon aria-hidden sx={{ color: '#B91C1C', fontSize: 16 }} />;
    }
  };

  const getIncidentIconBg = (type?: string) => {
    switch (type) {
      case 'misconduct':
      case 'behavior':
        return 'rgba(251, 188, 4, 0.15)';
      default:
        return 'rgba(234, 67, 53, 0.12)';
    }
  };

  return (
    <DashboardCard title="Recent incident reports" action={{ label: 'View all', to: '/incident-reports', ariaLabel: 'View all incident reports' }}>
      {reports.length > 0 ? (
        <DashboardList>
          {reports.map((report) => (
            <DashboardListItem
              key={report.id}
              to="/incident-reports"
              leading={
                <Box sx={{ width: 32, height: 32, borderRadius: '8px', backgroundColor: getIncidentIconBg(report.iconType), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {getIncidentIcon(report.iconType)}
                </Box>
              }
              title={report.category}
              detail={report.timestamp}
              trailing={<StatusBadge status={report.status as any} />}
            />
          ))}
        </DashboardList>
      ) : (
        <DashboardEmpty
          icon={<CheckCircleOutlineIcon aria-hidden />}
          title="No incident reports"
          hint="Complaints and incident reports from passengers appear here."
        />
      )}
    </DashboardCard>
  );
};
