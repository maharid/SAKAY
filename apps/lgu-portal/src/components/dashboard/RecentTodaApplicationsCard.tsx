import React from 'react';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';

import { DashboardCard, DashboardEmpty, DashboardList, DashboardListItem } from './DashboardCard';
import { StatusBadge } from '../common/StatusBadge';

interface TodaAppItem {
  id: string;
  name: string;
  barangay: string;
  submittedDate: string;
  status: string;
  representative: string;
  memberCount: number;
}

interface RecentTodaApplicationsCardProps {
  applications?: TodaAppItem[];
}

export const RecentTodaApplicationsCard: React.FC<RecentTodaApplicationsCardProps> = ({
  applications = [],
}) => (
  <DashboardCard title="Recent TODA applications" action={{ label: 'View all', to: '/toda-applications', ariaLabel: 'View all TODA applications' }}>
    {applications.length > 0 ? (
      <DashboardList>
        {applications.map((app) => (
          <DashboardListItem
            key={app.id}
            to="/toda-applications"
            title={app.name}
            detail={`Brgy. ${app.barangay} · Submitted ${app.submittedDate}`}
            trailing={<StatusBadge status={app.status as any} />}
          />
        ))}
      </DashboardList>
    ) : (
      <DashboardEmpty
        icon={<AccountBalanceIcon aria-hidden />}
        title="No TODA applications yet"
        hint="New applications appear here after an organization submits its registration."
      />
    )}
  </DashboardCard>
);
