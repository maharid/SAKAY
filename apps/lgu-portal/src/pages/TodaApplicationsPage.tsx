import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  TableBody,
  TableCell,
  TableRow,
  CircularProgress,
  Alert,
  Snackbar,
  Button,
  Divider,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';

import { TodaApplicationRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { TodaAccreditationDialog } from '../components/admin/TodaAccreditationDialog';
import { DocumentReviewModal } from '../components/modals/DocumentReviewModal';
import { DataTableCard, DataTableMessageRow, FlagTag, PersonCell } from '../components/common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../components/common/DetailSection';
import { StatStrip } from '../components/common/StatStrip';
import {
  fetchTodaApplications,
  approveTodaApplication,
  sendTodaRenewalReminder,
  returnTodaApplicationForCorrection,
  rejectTodaApplication,
} from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_BORDER, PAGE_DIVIDER, PAGE_TEXT, rowActionSx } from '../styles/pageTheme';
import { SakayToast } from '../components/common/SakayToast';

const formatDisplayDate = (dateStr?: string | null): string => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const TodaApplicationsPage: React.FC = () => {
  const [applications, setApplications] = useState<TodaApplicationRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [reminderSent, setReminderSent] = useState<string | null>(null);

  // Document Review Modal (Spreadsheet Parser, PDF & Image Viewer with blurred backdrop)
  const [reviewDoc, setReviewDoc] = useState<{
    name: string;
    type: string;
    url?: string | null;
  } | null>(null);

  // Notification Snackbar
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  // Selected Application for Review Modal
  const [selectedApp, setSelectedApp] = useState<TodaApplicationRecord | null>(null);

  // Specific document target for correction
  const [targetCorrectionDoc, setTargetCorrectionDoc] = useState<{ name: string; type: string } | null>(null);

  // Confirmation Dialog States
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [resubmissionDialogOpen, setResubmissionDialogOpen] = useState(false);
  // a notice opens this record: ?toda=<id> (read once, then removed from the address)
  const [searchParams, setSearchParams] = useSearchParams();
  const todaToOpen = searchParams.get('toda');
  useEffect(() => {
    if (!todaToOpen || isLoading) return;
    const found = applications.find((a) => a.id === todaToOpen);
    if (found) setSelectedApp(found);
    setSearchParams({}, { replace: true });
  }, [todaToOpen, applications, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadApplications = async () => {
    setIsLoading(true);
    try {
      const data = await fetchTodaApplications();
      setApplications(data);
    } catch (err) {
      console.error('[TodaApplicationsPage] Failed to fetch applications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  const filteredApps = applications.filter((app) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      app.name.toLowerCase().includes(q) ||
      (app.acronym && app.acronym.toLowerCase().includes(q)) ||
      app.representative.toLowerCase().includes(q) ||
      app.barangay.toLowerCase().includes(q) ||
      app.id.toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'All' || app.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const pendingCount = applications.filter((a) => a.status === 'Pending').length;
  const underReviewCount = applications.filter((a) => a.status === 'Under Review').length;
  const approvedCount = applications.filter((a) => a.status === 'Approved').length;
  const declinedCount = applications.filter(
    (a) => a.status === 'Declined' || a.status === 'Resubmission Required'
  ).length;

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Pending', value: 'Pending' },
    { label: 'Under Review', value: 'Under Review' },
    { label: 'Approved', value: 'Approved' },
    { label: 'Declined', value: 'Declined' },
    { label: 'Resubmission Required', value: 'Resubmission Required' },
  ];

  const dateOptions: FilterOption[] = [
    { label: 'All Dates', value: 'All' },
    { label: 'This Week', value: 'This Week' },
    { label: 'This Month', value: 'This Month' },
  ];

  /** Called by the approval dialog with the number and date the Administrator typed; throws the database's own explanation back into the dialog. */
  const handleApproveSubmit = async (certificateNumber: string, validUntilIso: string, remarks: string) => {
    if (!selectedApp) return;
    await approveTodaApplication(selectedApp.id, remarks || undefined, certificateNumber, validUntilIso);
    setSnackbarMessage(`Approved the accreditation of ${selectedApp.name}.`);
    setApproveDialogOpen(false);
    await loadApplications();
    setSelectedApp((prev) => (prev ? { ...prev, status: 'Approved' } : null));
  };

  const handleResubmissionConfirm = async (reason?: string) => {
    if (!selectedApp) return;

    const filePrefix = targetCorrectionDoc ? `[${targetCorrectionDoc.name}] ` : '';
    const correctionReason = `${filePrefix}${reason || 'Document requires correction or resubmission.'}`;

    try {
      await returnTodaApplicationForCorrection(selectedApp.id, correctionReason);
      setSnackbarMessage(`Application returned for correction: ${selectedApp.name}.`);
      setApplications((prev) =>
        prev.map((app) =>
          app.id === selectedApp.id
            ? { ...app, status: 'Resubmission Required', resubmissionReason: correctionReason }
            : app
        )
      );
      setSelectedApp((prev) =>
        prev ? { ...prev, status: 'Resubmission Required', resubmissionReason: correctionReason } : null
      );
    } catch (err) {
      console.error('[TodaApplications] Return for correction error:', err);
      setSnackbarMessage(`Error: ${(err as Error).message}`);
    }

    setTargetCorrectionDoc(null);
    setResubmissionDialogOpen(false);
  };

  const handleRejectConfirm = async (reason?: string) => {
    if (!selectedApp) return;

    const rejectReason = reason || 'Non-compliance with municipal franchising requirements.';
    try {
      await rejectTodaApplication(selectedApp.id, rejectReason);
      setSnackbarMessage(`Application permanently declined for ${selectedApp.name}.`);
      setApplications((prev) =>
        prev.map((app) =>
          app.id === selectedApp.id ? { ...app, status: 'Declined', declineReason: rejectReason } : app
        )
      );
      setSelectedApp((prev) =>
        prev ? { ...prev, status: 'Declined', declineReason: rejectReason } : null
      );
    } catch (err) {
      console.error('[TodaApplications] Reject error:', err);
      setSnackbarMessage(`Error declining application: ${(err as Error).message}`);
    }

    setRejectDialogOpen(false);
  };

  const handleSendReminder = async (todaId: string) => {
    // a real notice to the TODA's administrators (the database refuses a second one within 10 minutes and writes the audit entry)
    const problem = await sendTodaRenewalReminder(todaId);
    if (problem) {
      setSnackbarMessage(problem);
      return;
    }
    setReminderSent(todaId);
    setSnackbarMessage('The renewal reminder was sent to the TODA administrators.');
    setTimeout(() => setReminderSent(null), 3000);
  };

  const showCount = (n: number) => (isLoading ? <CircularProgress size={24} aria-label="Loading" sx={{ color: 'var(--sakay-orange)' }} /> : n);

  const organizationFields: Array<[string, React.ReactNode]> = selectedApp
    ? [
        ['TODA name', selectedApp.name],
        ['Acronym', selectedApp.acronym || 'N/A'],
        ['Barangay', selectedApp.barangay],
        ['Date established', formatDisplayDate(selectedApp.dateEstablished)],
        ['Registration number', selectedApp.registrationNumber || 'N/A'],
        ['Contact number', selectedApp.phone || 'N/A'],
        ['Email address', selectedApp.email || 'N/A'],
        ['Service area', selectedApp.serviceCoverageArea || selectedApp.barangay || 'N/A'],
        ['Terminal location', selectedApp.terminalLocation || 'Calapan City Terminal'],
        [
          'Terminal coordinates',
          selectedApp.terminalLatitude && selectedApp.terminalLongitude ? `${selectedApp.terminalLatitude}, ${selectedApp.terminalLongitude}` : 'None specified',
        ],
      ]
    : [];

  const officerFields = selectedApp?.officers
    ? [
        { label: 'President', name: selectedApp.officers.president, contact: selectedApp.officers.presidentContact },
        { label: 'Vice President', name: selectedApp.officers.vicePresident, contact: selectedApp.officers.vicePresidentContact },
        { label: 'Secretary', name: selectedApp.officers.secretary, contact: selectedApp.officers.secretaryContact },
        { label: 'Treasurer', name: selectedApp.officers.treasurer, contact: selectedApp.officers.treasurerContact },
      ]
    : [];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. How many applications are in each state */}
      <StatStrip
        label="Application totals"
        stats={[
          { key: 'pending', label: 'Pending', value: showCount(pendingCount), note: 'Waiting for a first review' },
          { key: 'review', label: 'Under review', value: showCount(underReviewCount), note: 'Documents being checked' },
          { key: 'accredited', label: 'Accredited TODAs', value: showCount(approvedCount), tone: 'success', note: 'Approved and operating' },
          { key: 'correction', label: 'Needs correction', value: showCount(declinedCount), tone: declinedCount > 0 ? 'brand' : 'neutral', note: 'Sent back or declined' },
        ]}
      />

      {/* 2. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search TODA, representative, barangay"
        selectFilters={[
          {
            id: 'status',
            label: 'Status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
          },
          {
            id: 'date',
            label: 'Date',
            value: dateFilter,
            options: dateOptions,
            onChange: setDateFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setDateFilter('All');
        }}
      />

      {/* 3. The applications */}
      <DataTableCard
        label="TODA applications"
        minWidth={680}
        columns={[{ label: 'TODA' }, { label: 'Representative' }, { label: 'Date submitted' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={5} kind="loading" loadingText="Loading TODA applications..." />
          ) : filteredApps.length > 0 ? (
            filteredApps.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <PersonCell
                    name={app.name}
                    tags={
                      <>
                        {app.acronym && <FlagTag label={app.acronym} tone="brand" />}
                        {app.isOverdue5Days && <FlagTag label="Overdue (over 5 days)" tone="danger" />}
                      </>
                    }
                  />
                </TableCell>
                <TableCell>{app.representative}</TableCell>
                <TableCell sx={{ color: PAGE_TEXT.secondary }}>{app.submittedDate}</TableCell>
                <TableCell>
                  <StatusBadge status={app.status} />
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`Review the application of ${app.name}`} onClick={() => setSelectedApp(app)} sx={rowActionSx('neutral')}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={5}
              kind={applications.length > 0 ? 'noResults' : 'empty'}
              title={applications.length > 0 ? 'No applications match' : 'No TODA applications yet'}
              hint={
                applications.length > 0
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'New applications appear here after a TODA submits its registration.'
              }
              onRefresh={loadApplications}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 4. Review window */}
      {selectedApp && (
        <MacCenterModal
          open={Boolean(selectedApp)}
          onClose={() => setSelectedApp(null)}
          title="Review TODA application"
          subtitle={`Records and files submitted by ${selectedApp.name}`}
          badge={<StatusBadge status={selectedApp.status} />}
          maxWidth={656}
          primaryActionLabel={selectedApp.status === 'Approved' ? undefined : 'Approve and issue accreditation'}
          onPrimaryAction={selectedApp.status === 'Approved' ? undefined : () => setApproveDialogOpen(true)}
          secondaryActionLabel={selectedApp.status === 'Approved' ? undefined : 'Decline application'}
          onSecondaryAction={selectedApp.status === 'Approved' ? () => setSelectedApp(null) : () => setRejectDialogOpen(true)}
          secondaryActionColor={selectedApp.status === 'Approved' ? undefined : 'error'}
        >
          <DetailSection title="Organization">
            <DetailGrid>
              {organizationFields.map(([label, value]) => (
                <DetailField key={label} label={label}>{value}</DetailField>
              ))}
            </DetailGrid>
          </DetailSection>

          {selectedApp.officers && (
            <DetailSection title="Officers">
              <DetailGrid>
                {officerFields.map((officer) => (
                  <DetailField key={officer.label} label={officer.label}>
                    {officer.name || 'N/A'}
                    {officer.contact && (
                      <Box component="span" sx={{ display: 'block', fontSize: FONT.small, fontWeight: 400, color: PAGE_TEXT.secondary }}>
                        {officer.contact}
                      </Box>
                    )}
                  </DetailField>
                ))}
              </DetailGrid>
            </DetailSection>
          )}

          {/* Required documents, each with its own "return for correction" */}
          <DetailSection title="Documents" note={`${selectedApp.documents.length} ${selectedApp.documents.length === 1 ? 'file' : 'files'}`}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {selectedApp.documents.map((doc, idx) => {
                const isRoster = doc.name.toLowerCase().includes('roster') || doc.type.toLowerCase().includes('spreadsheet') || doc.type.toLowerCase().includes('csv') || doc.type.toLowerCase().includes('excel');
                const isPdf = doc.type.toLowerCase().includes('pdf');

                return (
                  <Box
                    key={idx}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px 12px',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      border: `1px solid ${PAGE_BORDER}`,
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      {isRoster ? (
                        <TableChartOutlinedIcon aria-hidden sx={{ color: '#15803D', fontSize: 22 }} />
                      ) : isPdf ? (
                        <PictureAsPdfOutlinedIcon aria-hidden sx={{ color: '#B91C1C', fontSize: 22 }} />
                      ) : (
                        <DescriptionIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 22 }} />
                      )}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{doc.name}</Typography>
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px' }}>
                          {doc.type} · Uploaded {doc.date}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Button
                        startIcon={<VisibilityIcon sx={{ fontSize: 16 }} />}
                        aria-label={`View ${doc.name}`}
                        onClick={() => setReviewDoc({ name: doc.name, type: doc.type, url: doc.url })}
                        sx={rowActionSx('brand')}
                      >
                        View
                      </Button>

                      <Button
                        startIcon={<AssignmentReturnIcon sx={{ fontSize: 16 }} />}
                        aria-label={`Return ${doc.name} for correction`}
                        onClick={() => {
                          setTargetCorrectionDoc(doc);
                          setResubmissionDialogOpen(true);
                        }}
                        sx={rowActionSx('neutral')}
                      >
                        Return for correction
                      </Button>
                    </Box>
                  </Box>
                );
              })}
              {selectedApp.hasBarangayClearance !== false && (
                <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>
                  Barangay Clearance valid until, as stated by the TODA: <b>{selectedApp.declaredClearanceValidUntil ?? 'not stated'}</b>
                  {selectedApp.clearanceSubmittedAt ? ` (clearance sent ${new Date(selectedApp.clearanceSubmittedAt).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })})` : ''}. Read the date on the document yourself before approving.
                </Typography>
              )}
              {selectedApp.status !== 'Approved' && selectedApp.hasBarangayClearance === false && (
                <Alert
                  severity="warning"
                  sx={{ borderRadius: '12px' }}
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        setTargetCorrectionDoc({ name: 'Barangay Clearance', type: 'Missing' });
                        setResubmissionDialogOpen(true);
                      }}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Return for correction
                    </Button>
                  }
                >
                  No Barangay Clearance was uploaded, so this TODA cannot be accredited yet.
                </Alert>
              )}
            </Box>
          </DetailSection>

          {/* The reason, if the application was already sent back */}
          {selectedApp.resubmissionReason && (
            <Box sx={{ mb: '20px', backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', padding: '12px 14px', borderRadius: '12px' }}>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.warning, mb: '2px' }}>
                Correction requested
              </Typography>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary }}>{selectedApp.resubmissionReason}</Typography>
            </Box>
          )}

          {/* Reminder to renew the Barangay Clearance (a real notice to the TODA administrators) */}
          <Divider sx={{ my: 2, borderColor: PAGE_DIVIDER }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 12px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <NotificationsActiveIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 18 }} />
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                Remind the TODA to renew its Barangay Clearance.
              </Typography>
            </Box>
            <Button onClick={() => handleSendReminder(selectedApp.id)} sx={rowActionSx('neutral')}>
              {reminderSent === selectedApp.id ? 'Reminder sent' : 'Send reminder'}
            </Button>
          </Box>
        </MacCenterModal>
      )}

      {/* Document viewer (the same viewer as the TODA registration review) */}
      {reviewDoc && (
        <DocumentReviewModal
          open={Boolean(reviewDoc)}
          onClose={() => setReviewDoc(null)}
          documentTitle={reviewDoc.name}
          fileName={reviewDoc.name}
          fileUrl={reviewDoc.url || null}
        />
      )}

      {/* Approval: the Administrator types the certificate number and the date the Barangay Clearance is valid until (Rule 2.1) */}
      {selectedApp && (
        <TodaAccreditationDialog
          open={approveDialogOpen}
          mode="approve"
          todaName={selectedApp.name}
          hasClearance={selectedApp.hasBarangayClearance !== false}
          currentCertificateNumber={selectedApp.certificateNumber}
          declaredValidUntil={selectedApp.declaredClearanceValidUntil}
          onClose={() => setApproveDialogOpen(false)}
          onSubmit={handleApproveSubmit}
        />
      )}

      {/* Return for correction (one file, or the whole application) */}
      {selectedApp && (
        <MacConfirmDialog
          open={resubmissionDialogOpen}
          onClose={() => {
            setTargetCorrectionDoc(null);
            setResubmissionDialogOpen(false);
          }}
          title={
            targetCorrectionDoc
              ? `Return ${targetCorrectionDoc.name} for correction?`
              : 'Return application for correction?'
          }
          message={
            targetCorrectionDoc
              ? `Say what needs to be corrected in "${targetCorrectionDoc.name}". The TODA representative will be notified to upload this file again.`
              : `Send the application of "${selectedApp.name}" back for correction. Say what the TODA leaders need to change.`
          }
          confirmLabel="Send return notice"
          confirmVariant="orange"
          requireReason
          reasonPlaceholder={
            targetCorrectionDoc
              ? `Say what is wrong with ${targetCorrectionDoc.name} (e.g. The document is expired, please upload the current 2026 certification)...`
              : 'Say which documents are missing or invalid (e.g. Please upload the updated 2026 Barangay Clearance)...'
          }
          onConfirm={handleResubmissionConfirm}
        />
      )}

      {/* Decline */}
      {selectedApp && (
        <MacConfirmDialog
          open={rejectDialogOpen}
          onClose={() => setRejectDialogOpen(false)}
          title="Decline this application?"
          message={`Are you sure you want to permanently decline the accreditation request for "${selectedApp.name}"?`}
          confirmLabel="Decline application"
          confirmVariant="danger"
          requireReason
          reasonPlaceholder="Reason for declining (required)"
          onConfirm={handleRejectConfirm}
        />
      )}

      {/* Result of the last action */}
      <SakayToast message={snackbarMessage} autoHideDuration={4000} onClose={() => setSnackbarMessage(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
};
