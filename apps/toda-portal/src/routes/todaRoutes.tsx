import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { TodaLayout } from '../components/layout/TodaLayout';
import { ProtectedRoute, PublicOnlyRoute } from '../components/auth/ProtectedRoute';

import { LoginPage } from '../pages/LoginPage';
import { TodaOperationsPage } from '../pages/TodaOperationsPage';
import { TodaDriverVerificationPage } from '../pages/TodaDriverVerificationPage';
import { TodaDriverMembershipPage } from '../pages/TodaDriverMembershipPage';
import { TodaAnnouncementsPage } from '../pages/TodaAnnouncementsPage';
import { TodaReportingPage } from '../pages/TodaReportingPage';
import { TodaAuditLogsPage } from '../pages/TodaAuditLogsPage';
import { TodaAccountManagementPage } from '../pages/TodaAccountManagementPage';
import { TodaSettingsPage } from '../pages/TodaSettingsPage';
import { TodaRegistrationPage } from '../pages/TodaRegistrationPage';

export const TodaRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Login Route */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />

      {/* TODA Registration & Accreditation Submission (Public) */}
      <Route path="/register" element={<TodaRegistrationPage />} />

      {/* Default redirect to /operations */}
      <Route path="/" element={<Navigate to="/operations" replace />} />

      {/* Operations Monitoring Screen */}
      <Route
        path="/operations"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Operations Monitoring" pageSubtitle="Your drivers, your trips, and what needs your attention">
              <TodaOperationsPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Driver Verification */}
      <Route
        path="/driver-verification"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Driver Verification" pageSubtitle="Screen TODA member driver applications before LGU accreditation endorsement">
              <TodaDriverVerificationPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Driver Membership */}
      <Route
        path="/drivers"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Driver Membership" pageSubtitle="Manage TODA member driver roster, strikes, and governance suspensions">
              <TodaDriverMembershipPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Announcements */}
      <Route
        path="/announcements"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Announcements" pageSubtitle="Send notices to your drivers. They read them in the Driver App">
              <TodaAnnouncementsPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Reports & Incidents */}
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="TODA Reports & Incidents" pageSubtitle="Trips, fares, driver activity and passenger complaints for your TODA">
              <TodaReportingPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Audit Logs */}
      <Route
        path="/audit-logs"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Audit Logs" pageSubtitle="A record of what you and your officers did in this portal">
              <TodaAuditLogsPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Account Management */}
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Account & Accreditation" pageSubtitle="Your TODA's details, officers, accreditation and documents">
              <TodaAccountManagementPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Settings */}
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <TodaLayout pageTitle="Settings" pageSubtitle="Manage your TODA account and application preferences.">
              <TodaSettingsPage />
            </TodaLayout>
          </ProtectedRoute>
        }
      />

      {/* Catch-all fallback */}
      <Route path="*" element={<Navigate to="/operations" replace />} />
    </Routes>
  );
};
