import React, { useState, useEffect } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Rating, Chip, Button, Tabs, Tab } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import ShieldIcon from '@mui/icons-material/Shield';

import { PassengerRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { CloseAccountButton, VoidStrikeButton } from '../components/admin/AccountSanctionActions';
import { RestrictionBanner } from '../components/admin/RestrictionBanner';
import { SakayToast } from '../components/common/SakayToast';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag, PersonCell } from '../components/common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../components/common/DetailSection';
import { useStrikeData } from '../hooks/useStrikeData';
import { getStrikeLevel } from '../utils/strikeLevel';
import {
  fetchPassengers,
  suspendPassenger,
  reactivatePassenger,
  issuePassengerStrike,
  excludeRating,
} from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

/**
 * ============================================================================
 * PASSENGER MANAGEMENT PAGE COMPONENT
 * ============================================================================
 * Purpose:
 *   Enables LGU Transport Officers to monitor commuter registration, track
 *   ride completion statistics, review ratings, investigate passenger policy
 *   strikes, and enforce temporary suspensions or reactivations.
 * ============================================================================
 */
export const PassengerManagementPage: React.FC = () => {
  // State: Commuter accounts list and filter criteria
  const [passengers, setPassengers] = useState<PassengerRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [verificationFilter, setVerificationFilter] = useState('All');
  const [selectedPassenger, setSelectedPassenger] = useState<PassengerRecord | null>(null);
  // which part of the account is open (the window always opens on the first)
  const [accountTab, setAccountTab] = useState<'account' | 'strikes' | 'feedback'>('account');
  useEffect(() => {
    setAccountTab('account');
  }, [selectedPassenger?.id]);
  const [strikeIssued, setStrikeIssued] = useState(false);

  // Suspension, Reactivation & Strike Dialog States
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  // Rule 23.5: the LGU Administrator excludes (or counts again) one rating a driver gave this passenger
  const [excludeTarget, setExcludeTarget] = useState<{ ratingId: string; excluded: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  // Authoritative strike ledger + violation catalog for the open passenger
  const strikeData = useStrikeData('passenger', selectedPassenger?.id);
  const activeStrikes = strikeData.activeStrikes ?? selectedPassenger?.strikesCount ?? 0;
  const strikeItems = strikeData.history.length > 0 ? strikeData.history : selectedPassenger?.strikeHistory ?? [];

  /**
   * Effect: Fetch live passenger records on initial mount.
   */
  useEffect(() => {
    let isMounted = true;
    fetchPassengers()
      .then((data) => {
        if (isMounted) {
          setPassengers(data || []);
        }
      })
      .catch((err) => {
        console.warn('[PassengerManagement] Failed to fetch passengers:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filter logic: Search by name, phone, or email
  const filteredPassengers = passengers.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'All' || p.accountStatus === statusFilter;
    const matchesVerification = verificationFilter === 'All' || p.verificationStatus === verificationFilter;

    return matchesSearch && matchesStatus && matchesVerification;
  });

  const statusOptions: FilterOption[] = [
    { label: 'All Account Statuses', value: 'All' },
    { label: 'Active', value: 'Active' },
    { label: 'Pending OTP', value: 'Pending' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Deactivated', value: 'Deactivated' },
  ];

  const verificationOptions: FilterOption[] = [
    { label: 'All Verifications', value: 'All' },
    { label: 'Verified', value: 'Verified' },
    { label: 'Unverified', value: 'Unverified' },
  ];

  /**
   * Action Handler: Suspends a passenger account with a mandatory reason.
   */
  const handleSuspendConfirm = async (reason?: string) => {
    if (!selectedPassenger) return;
    const finalReason = reason || 'Violation of Platform Policies';

    // The database engine applies and audits the suspension; failures must be visible.
    try {
      await suspendPassenger(selectedPassenger.id, finalReason, 7);
      await refreshSelectedPassenger(selectedPassenger.id);
      setToast({ message: `${selectedPassenger.name} has been suspended for 7 days.`, severity: 'success' });
    } catch (err) {
      setToast({ message: `Suspension failed: ${(err as Error).message}`, severity: 'error' });
    }

    setSuspendDialogOpen(false);
  };

  /**
   * Action Handler: Reactivates a suspended or deactivated passenger account.
   * Strike counts are kept and age out normally (Rule 22.4).
   */
  const handleReactivateConfirm = async () => {
    if (!selectedPassenger) return;
    const wasDeactivated = selectedPassenger.accountStatus === 'Deactivated';

    try {
      await reactivatePassenger(
        selectedPassenger.id,
        wasDeactivated ? 'Reactivated after manual review of the full violation history' : 'Suspension lifted by LGU Administrator',
        wasDeactivated
      );
      await refreshSelectedPassenger(selectedPassenger.id);
      setToast({ message: `${selectedPassenger.name} has been reactivated.`, severity: 'success' });
    } catch (err) {
      setToast({ message: `Reactivation failed: ${(err as Error).message}`, severity: 'error' });
    }

    setReactivateDialogOpen(false);
  };

  /**
   * Action Handler: Records a catalog violation against a passenger. The engine decides the
   * points, the ladder consequence and the audit entry (nothing is computed here).
   */
  const handleIssueStrike = async (reason?: string, violationCode?: string) => {
    if (!selectedPassenger || !violationCode) return;
    setStrikeDialogOpen(false);

    try {
      const result = await issuePassengerStrike(selectedPassenger.id, violationCode, reason || 'Administrator confirmed');
      await refreshSelectedPassenger(selectedPassenger.id);
      setStrikeIssued(true);
      setTimeout(() => setStrikeIssued(false), 3000);
      const consequence = result.consequence ? ` Consequence: ${result.consequence.replace(/_/g, ' ').toLowerCase()}.` : '';
      setToast({ message: `Recorded for ${selectedPassenger.name}. Active strikes: ${result.active_after ?? '-'}.${consequence}`, severity: 'success' });
    } catch (err) {
      setToast({ message: `Could not record the violation: ${(err as Error).message}`, severity: 'error' });
    }
  };

  const handleExcludeConfirm = async (reason?: string) => {
    const target = excludeTarget;
    setExcludeTarget(null);
    if (!target || !selectedPassenger) return;
    const problem = await excludeRating(target.ratingId, !target.excluded, reason || '');
    if (problem) {
      setToast({ message: problem, severity: 'error' });
      return;
    }
    setToast({ message: target.excluded ? 'The rating counts again.' : 'The rating was excluded from the Average Rating. The reason was recorded in the audit log.', severity: 'success' });
    await refreshSelectedPassenger(selectedPassenger.id);
  };

  /** Re-reads the passenger list and the open ledger so every number comes from the database. */
  const refreshSelectedPassenger = async (passengerId: string) => {
    const fresh = await fetchPassengers();
    setPassengers(fresh);
    setSelectedPassenger(fresh.find((p) => p.id === passengerId) ?? null);
    await strikeData.reload();
  };


  const strikeLevel = getStrikeLevel(activeStrikes);

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search name, phone, or email"
        selectFilters={[
          {
            id: 'status',
            label: 'Account Status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
          },
          {
            id: 'verification',
            label: 'Verification',
            value: verificationFilter,
            options: verificationOptions,
            onChange: setVerificationFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('All');
          setVerificationFilter('All');
        }}
      />

      {/* 2. The passengers */}
      <DataTableCard
        label="Passengers"
        minWidth={900}
        columns={[
          { label: 'Passenger' },
          { label: 'Phone and email' },
          { label: 'Verification' },
          { label: 'Bookings' },
          { label: 'Strikes' },
          { label: 'Account' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={7} kind="loading" loadingText="Loading passengers..." />
          ) : filteredPassengers.length > 0 ? (
            filteredPassengers.map((passenger) => (
              <TableRow key={passenger.id}>
                <TableCell>
                  <PersonCell name={passenger.name} detail={`Registered ${passenger.registeredDate}`} />
                </TableCell>
                <TableCell>
                  <CellStack primary={passenger.phone} secondary={passenger.email} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={passenger.verificationStatus} />
                </TableCell>
                <TableCell>{passenger.totalBookings} {passenger.totalBookings === 1 ? 'booking' : 'bookings'}</TableCell>
                <TableCell>
                  <FlagTag label={`${passenger.strikesCount} ${passenger.strikesCount === 1 ? 'strike' : 'strikes'}`} tone={passenger.strikesCount > 0 ? 'danger' : 'success'} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={passenger.accountStatus} />
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`View the account of ${passenger.name}`} onClick={() => setSelectedPassenger(passenger)} sx={rowActionSx('neutral')}>
                    View account
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={7}
              kind={passengers.length > 0 ? 'noResults' : 'empty'}
              title={passengers.length > 0 ? 'No passengers match' : 'No passengers registered yet'}
              hint={
                passengers.length > 0
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Passengers appear here once they sign up for SAKAY.'
              }
              onRefresh={() => {
                setIsLoading(true);
                fetchPassengers().then((data) => { if (data) setPassengers(data || []); }).finally(() => setIsLoading(false));
              }}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 3. Passenger account window */}
      {selectedPassenger && (
        <MacCenterModal
          open={Boolean(selectedPassenger)}
          onClose={() => setSelectedPassenger(null)}
          title={`Passenger account: ${selectedPassenger.name}`}
          subtitle={`Passenger ID: ${selectedPassenger.id}`}
          badge={<StatusBadge status={selectedPassenger.accountStatus} />}
          primaryActionLabel={selectedPassenger.accountStatus === 'Pending' ? undefined : selectedPassenger.accountStatus === 'Active' ? 'Suspend account' : 'Reactivate account'}
          primaryActionColor={selectedPassenger.accountStatus === 'Active' ? 'error' : 'primary'}
          onPrimaryAction={() => {
            if (selectedPassenger.accountStatus === 'Active') {
              setSuspendDialogOpen(true);
            } else {
              setReactivateDialogOpen(true);
            }
          }}
          maxWidth={608}
          extraActions={
            selectedPassenger.restrictionKind !== 'CLOSED' ? (
              <CloseAccountButton
                subjectType="passenger"
                subjectId={selectedPassenger.id}
                subjectName={selectedPassenger.name}
                onDone={async (message, severity) => {
                  setToast({ message, severity });
                  await refreshSelectedPassenger(selectedPassenger.id);
                }}
              />
            ) : undefined
          }
        >
          {/* Rating from drivers */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 16px', backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', mb: '20px', border: `1px solid ${PAGE_BORDER}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              {selectedPassenger.ratingCount > 0 ? (
                <>
                  <Rating value={selectedPassenger.rating} readOnly precision={0.1} size="small" emptyIcon={<StarIcon fontSize="inherit" />} />
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>
                    {selectedPassenger.rating} / 5
                  </Typography>
                  <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
                    ({selectedPassenger.ratingCount} {selectedPassenger.ratingCount === 1 ? 'rating' : 'ratings'} from drivers)
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.secondary }}>
                  Not yet rated
                </Typography>
              )}
            </Box>

            <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>
              Registered {selectedPassenger.registeredDate}
            </Typography>
          </Box>

          {/* A suspension or closure, as decided by the database, is always in view */}
          <RestrictionBanner
            kind={selectedPassenger.restrictionKind}
            suspendedUntil={selectedPassenger.suspendedUntil}
            reason={selectedPassenger.suspensionReason}
          />


          <Tabs
            value={accountTab}
            onChange={(_, value) => setAccountTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Parts of the passenger account"
            sx={{
              minHeight: 40,
              mb: 2,
              borderBottom: `1px solid ${PAGE_BORDER}`,
              '& .MuiTabs-indicator': { backgroundColor: '#C75000', height: 3 },
              '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.secondary, px: 1.6 },
              '& .MuiTab-root.Mui-selected': { color: '#B34700' },
              '& .MuiTab-root.Mui-focusVisible': { outline: '2px solid #C75000', outlineOffset: -2 },
            }}
          >
            <Tab value="account" label="Account" id="passenger-tab-account" aria-controls="passenger-panel-account" />
            <Tab value="strikes" label={`Strikes${selectedPassenger.strikesCount > 0 ? ` (${selectedPassenger.strikesCount})` : ''}`} id="passenger-tab-strikes" aria-controls="passenger-panel-strikes" />
            <Tab value="feedback" label={`Feedback${(selectedPassenger.recentFeedback?.length ?? 0) > 0 ? ` (${selectedPassenger.recentFeedback?.length ?? 0})` : ''}`} id="passenger-tab-feedback" aria-controls="passenger-panel-feedback" />
          </Tabs>

          {accountTab === 'account' && <Box role="tabpanel" id="passenger-panel-account" aria-labelledby="passenger-tab-account">
          {/* Account details */}
          <DetailSection title="Account details">
            <DetailGrid>
              <DetailField label="Mobile phone">{selectedPassenger.phone}</DetailField>
              <DetailField label="Email address">{selectedPassenger.email}</DetailField>
              <DetailField label="Verification">
                <Box component="span" sx={{ color: selectedPassenger.verificationStatus === 'Verified' ? PAGE_TEXT.success : PAGE_TEXT.warning }}>
                  {selectedPassenger.verificationStatus === 'Verified' ? 'Verified (mobile number confirmed by OTP)' : 'Unverified (the OTP step is not finished; no booking is possible yet)'}
                </Box>
              </DetailField>
              <DetailField label="Completed rides">{selectedPassenger.totalBookings} {selectedPassenger.totalBookings === 1 ? 'booking' : 'bookings'}</DetailField>
            </DetailGrid>
          </DetailSection>

          </Box>}
          {accountTab === 'strikes' && <Box role="tabpanel" id="passenger-panel-strikes" aria-labelledby="passenger-tab-strikes">
          {/* Strikes and policy compliance */}
          <DetailSection title="Strikes" note="Last 90 days">
            <Box sx={{ backgroundColor: '#FAFAF8', border: `1px solid ${PAGE_BORDER}`, padding: '14px 16px', borderRadius: '12px' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', mb: strikeItems.length > 0 ? '12px' : 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>
                    Active strikes:{' '}
                    <Box component="span" sx={{ color: activeStrikes > 0 ? PAGE_TEXT.danger : PAGE_TEXT.success, fontWeight: 700 }}>{activeStrikes}</Box>
                  </Typography>
                  <Chip
                    icon={<ShieldIcon style={{ fontSize: '12px', color: strikeLevel.color }} />}
                    label={strikeLevel.label}
                    size="small"
                    sx={{ backgroundColor: strikeLevel.bg, color: strikeLevel.color, fontWeight: 700, fontSize: FONT.small, height: 24, border: `1px solid ${strikeLevel.border}` }}
                  />
                </Box>
                <Button onClick={() => setStrikeDialogOpen(true)} sx={rowActionSx('neutral')}>
                  {strikeIssued ? 'Violation recorded' : 'Record a violation'}
                </Button>
              </Box>

              {strikeItems.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {strikeItems.map((item) => (
                    <Box
                      key={item.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '6px 12px',
                        backgroundColor: '#FFFFFF',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: `1px solid ${PAGE_BORDER}`,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', mb: '2px' }}>
                          <FlagTag label={`+${item.strikesApplied} strike`} tone="danger" />
                          <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{item.reason}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
                          {item.date} · Issued by {item.issuedBy}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <FlagTag label={item.status} tone="warning" />
                        {item.voidable && (
                          <VoidStrikeButton
                            strikeId={item.id}
                            onDone={async (message, severity) => {
                              setToast({ message, severity });
                              await refreshSelectedPassenger(selectedPassenger.id);
                            }}
                          />
                        )}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.success, fontWeight: 600, mt: '10px' }}>
                  Clean record: no strikes in the last 90 days.
                </Typography>
              )}
            </Box>
          </DetailSection>

          </Box>}
          {accountTab === 'feedback' && <Box role="tabpanel" id="passenger-panel-feedback" aria-labelledby="passenger-tab-feedback">
          {/* Recent feedback about this passenger */}
          <DetailSection title="Recent feedback and complaints">
            {selectedPassenger.recentFeedback && selectedPassenger.recentFeedback.length > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selectedPassenger.recentFeedback.map((fb, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      padding: '12px 14px',
                      borderRadius: '12px',
                      border: `1px solid ${PAGE_BORDER}`,
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
                      <Rating value={fb.rating} readOnly precision={0.5} size="small" emptyIcon={<StarIcon fontSize="inherit" />} />
                      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{fb.date}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.brand, mb: '3px' }}>
                      Category: {fb.category}
                    </Typography>
                    <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.4 }}>
                      "{fb.comment}"
                    </Typography>
                    {fb.excluded && (
                      <Typography sx={{ fontSize: FONT.small, fontWeight: 700, color: PAGE_TEXT.warning, mt: '6px' }}>Excluded from the Average Rating</Typography>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px 12px', mt: '8px' }}>
                      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
                        Trip ref. {fb.tripId}
                      </Typography>
                      {fb.ratingId && (
                        <Button onClick={() => setExcludeTarget({ ratingId: fb.ratingId as string, excluded: Boolean(fb.excluded) })} sx={rowActionSx('neutral')}>
                          {fb.excluded ? 'Count again' : 'Exclude rating'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                No recent feedback or complaints for this passenger.
              </Typography>
            )}
          </DetailSection>
          </Box>}
        </MacCenterModal>
      )}

      {/* 4. Suspend */}
      {selectedPassenger && (
        <MacConfirmDialog
          open={suspendDialogOpen}
          onClose={() => setSuspendDialogOpen(false)}
          title="Suspend this passenger?"
          message={`Are you sure you want to suspend "${selectedPassenger.name}"? Write the policy violation below.`}
          confirmLabel="Suspend passenger"
          confirmVariant="danger"
          requireReason
          reasonPlaceholder="Describe the violation (e.g. repeated booking cancellations, abusive conduct)"
          onConfirm={handleSuspendConfirm}
        />
      )}

      {/* 5. Reactivate */}
      {selectedPassenger && (
        <MacConfirmDialog
          open={reactivateDialogOpen}
          onClose={() => setReactivateDialogOpen(false)}
          title="Reactivate this passenger?"
          message={
            selectedPassenger.accountStatus === 'Deactivated'
              ? `"${selectedPassenger.name}" is deactivated. Confirm that you reviewed the full violation history above. Strike counts are not reset; they age out of the 90-day window.`
              : `Reactivate account access for "${selectedPassenger.name}"? They will regain ability to book rides through the SAKAY Passenger PWA.`
          }
          confirmLabel={selectedPassenger.accountStatus === 'Deactivated' ? 'I reviewed the history: reactivate' : 'Reactivate account'}
          confirmVariant="orange"
          onConfirm={handleReactivateConfirm}
        />
      )}

      {/* 6. Record a violation (catalog-driven; the engine applies the ladder) */}
      {selectedPassenger && (
        <MacConfirmDialog
          open={strikeDialogOpen}
          onClose={() => setStrikeDialogOpen(false)}
          title="Record a policy violation?"
          message={`Record a confirmed violation against "${selectedPassenger.name}". The platform applies the strike count and any consequence automatically (warning at 1, review at 3, suspension at 5 and 8, deactivation at 10).`}
          confirmLabel="Record violation"
          confirmVariant="danger"
          options={strikeData.violationOptions}
          optionLabel="Violation"
          requireReason
          reasonPlaceholder="Describe the evidence that confirms this violation"
          onConfirm={handleIssueStrike}
        />
      )}

      <MacConfirmDialog
        open={Boolean(excludeTarget)}
        onClose={() => setExcludeTarget(null)}
        title={excludeTarget?.excluded ? 'Count this rating again' : 'Exclude this rating'}
        message={excludeTarget?.excluded
          ? 'The rating will count in the Average Rating again.'
          : 'Only a rating that was submitted maliciously or in retaliation, found so after an investigation, is excluded. It leaves both the total and the count of the Average Rating.'}
        confirmLabel={excludeTarget?.excluded ? 'Count again' : 'Exclude rating'}
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="What the investigation found (at least 10 characters)"
        onConfirm={(reason) => void handleExcludeConfirm(reason)}
      />

      <SakayToast
        open={Boolean(toast)}
        message={toast?.message ?? null}
        severity={toast?.severity ?? 'info'}
        onClose={() => setToast(null)}
      />
    </Box>
  );
};

