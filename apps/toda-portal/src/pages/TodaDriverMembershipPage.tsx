import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TableBody,
  TableCell,
  TableRow,
  Button,
  Tabs,
  Tab,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import GavelIcon from '@mui/icons-material/Gavel';
import DescriptionIcon from '@mui/icons-material/Description';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';

import { EvidenceLinks } from '@sakay/shared';
import { TodaDriverMember, DriverExemptionRequest } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { STRIKE_LADDER } from '@sakay/shared/config/policyConfig';
import { StatusBadge } from '../components/common/StatusBadge';
import { SakayToast } from '../components/common/SakayToast';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { DataTableCard, DataTableMessageRow, CellStack, PersonCell } from '../components/common/DataTable';
import { FeatureLockedNotice } from '../components/common/FeatureLockedNotice';
import { primaryButtonSx, rowActionSx } from '../components/common/pageButtons';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { OPS_TEXT } from '../components/operations/operationsTheme';
import { FONT, SHELL, SPACE } from '../styles/density';
import { DIALOG_ACTIONS_SX, DIALOG_CONTENT_SX, DIALOG_INTRO_SX, DIALOG_PAPER_SX, DIALOG_TITLE_SX } from '@sakay/shared/components/dialogStyles';
import {
  fetchTodaDriverMembers,
  suspendTodaDriver,
  reactivateTodaDriver,
  recordTodaAuditAction,
  fetchTodaRosterEntries,
  addTodaRosterEntry,
  updateTodaRosterEntry,
  fetchTodaProfile,
  fetchTodaExemptionRequests,
  decideExemptionRequest,
  escalateExemptionRequest,
  signTodaCaseEvidence,
  TodaRosterEntry,
} from '../services/todaApiService';
import { isTodaLocked } from '../utils/accreditation';
import { useAuth } from '../contexts/AuthContext';

// toda driver roster membership, strikes record, and suspension management
export const TodaDriverMembershipPage: React.FC = () => {
  const { todaAdminProfile } = useAuth();
  const effectiveTodaId = todaAdminProfile?.toda_id;

  const [activeTab, setActiveTab] = useState<number>(0);
  const [drivers, setDrivers] = useState<TodaDriverMember[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [exemptions, setExemptions] = useState<DriverExemptionRequest[]>([]);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  
  const [todaStatus, setTodaStatus] = useState<string>('Active');

  // Selected Driver for Detail Modal
  const [selectedDriver, setSelectedDriver] = useState<TodaDriverMember | null>(null);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [suspendReasonInput, setSuspendReasonInput] = useState('');

  // Selected Exemption for Review Modal
  const [selectedExemption, setSelectedExemption] = useState<DriverExemptionRequest | null>(null);
  const [exemptionDecisionModalOpen, setExemptionDecisionModalOpen] = useState(false);
  // Rules 8.6, 9.4, 25: the decision on an appeal (Full waiver / Partial waiver / Denied, with the reason): the database checks and audits it
  const [decisionOutcome, setDecisionOutcome] = useState<'FULL' | 'PARTIAL' | 'DENIED'>('FULL');
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionPoints, setDecisionPoints] = useState('1');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  // Rule 25.4: passing an appeal to the LGU Administrator
  const [escalateOpen, setEscalateOpen] = useState(false);
  const loadExemptions = async () => setExemptions(await fetchTodaExemptionRequests());
  useEffect(() => {
    loadExemptions();
  }, [effectiveTodaId]);

  // Master Roster (Rule 2.4)
  const [rosterEntries, setRosterEntries] = useState<TodaRosterEntry[]>([]);
  const [rosterAddModalOpen, setRosterAddModalOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newFranchiseNumber, setNewFranchiseNumber] = useState('');
  const [newPlateNumber, setNewPlateNumber] = useState('');
  const [rosterSubmitting, setRosterSubmitting] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // Editing one roster entry (checklist: update member information)
  const [editingEntry, setEditingEntry] = useState<TodaRosterEntry | null>(null);
  const [editName, setEditName] = useState('');
  const [editFranchise, setEditFranchise] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEditEntry = (entry: TodaRosterEntry) => {
    setEditingEntry(entry);
    setEditName(entry.member_name || '');
    setEditFranchise(entry.franchise_number || '');
    setEditPlate(entry.plate_number || '');
    setEditError(null);
  };

  const handleEditRosterSubmit = async () => {
    if (!editingEntry?.entry_id) return;
    if (editName.trim().length < 2 || !editFranchise.trim()) {
      setEditError('Member name and franchise number are required.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const { changed } = await updateTodaRosterEntry(editingEntry.entry_id, {
        memberName: editName.trim(),
        franchiseNumber: editFranchise.trim(),
        plateNumber: editPlate.trim(),
      });
      if (changed) {
        const now = new Date().toISOString();
        setRosterEntries((prev) => prev.map((x) => (x.entry_id === editingEntry.entry_id
          ? { ...x, member_name: editName.trim(), franchise_number: editFranchise.trim(), plate_number: editPlate.trim(), updated_at: now }
          : x)));
      }
      setEditingEntry(null);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update the roster entry');
    } finally {
      setEditSubmitting(false);
    }
  };

  const loadDrivers = () => {
    setIsLoading(true);
    const targetId = effectiveTodaId || todaAdminProfile?.toda_id;

    fetchTodaProfile(targetId).then((profile) => {
      if (profile) setTodaStatus(profile.accreditationStatus);
    });

    fetchTodaDriverMembers(targetId)
      .then((data) => {
        setDrivers(data || []);
      })
      .catch((err) => {
        console.error('[TodaMembership] Failed to fetch drivers from database:', err);
        setDrivers([]);
      })
      .finally(() => {
        setIsLoading(false);
      });

    fetchTodaRosterEntries(targetId)
      .then((entries) => {
        setRosterEntries(entries || []);
      })
      .catch((err) => {
        console.warn('[TodaMembership] Failed to fetch roster entries:', err);
      });
  };

  const handleAddRosterSubmit = async () => {
    if (!newMemberName.trim() || !newFranchiseNumber.trim()) {
      setRosterError('Member name and franchise number are required.');
      return;
    }
    const targetId = effectiveTodaId || todaAdminProfile?.toda_id;
    setRosterSubmitting(true);
    setRosterError(null);
    try {
      const added = await addTodaRosterEntry({
        todaId: targetId,
        memberName: newMemberName.trim(),
        franchiseNumber: newFranchiseNumber.trim(),
        plateNumber: newPlateNumber.trim() || newFranchiseNumber.trim(),
      });
      setRosterEntries((prev) => [added, ...prev]);
      setRosterAddModalOpen(false);
      setNewMemberName('');
      setNewFranchiseNumber('');
      setNewPlateNumber('');
    } catch (err: any) {
      setRosterError(err.message || 'Failed to add roster entry');
    } finally {
      setRosterSubmitting(false);
    }
  };

  useEffect(() => {
    loadDrivers();
  }, [effectiveTodaId]);

  // Filter Logic
  const filteredDrivers = drivers.filter((drv) => {
    const matchesSearch =
      drv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      drv.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      drv.membershipNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      drv.franchiseNo.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'All' || drv.accountStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalCount = drivers.length;
  const activeCount = drivers.filter((d) => d.accountStatus === 'Active').length;
  const reviewCount = drivers.filter((d) => d.accountStatus === 'Suspension Review' || d.accountStatus === 'Reactivation Review').length;
  const suspendedCount = drivers.filter((d) => d.accountStatus === 'TODA Suspended' || d.accountStatus === 'LGU Deactivated').length;

  const statusOptions: FilterOption[] = [
    { label: 'All Member Statuses', value: 'All' },
    { label: 'Active', value: 'Active' },
    { label: 'Suspension Review (LGU Endorsement)', value: 'Suspension Review' },
    { label: 'Reactivation Review', value: 'Reactivation Review' },
    { label: 'TODA Suspended', value: 'TODA Suspended' },
    { label: 'LGU Deactivated', value: 'LGU Deactivated' },
  ];

  // Action: Request Driver Suspension Review (Governance Flow)
  const handleSuspendRequest = async () => {
    if (!selectedDriver) return;

    try {
      await suspendTodaDriver(selectedDriver.id, suspendReasonInput);
    } catch (err) {
      // Do not show a review that was never raised.
      setToast({ message: `Could not submit the recommendation: ${(err as Error).message}`, severity: 'error' });
      return;
    }

    setDrivers((prev) =>
      prev.map((d) =>
        d.id === selectedDriver.id
          ? {
              ...d,
              accountStatus: 'Suspension Review',
              suspensionReason: suspendReasonInput || 'Endorsed for TODA policy review.',
              suspendedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
            }
          : d
      )
    );

    recordTodaAuditAction({
      actionType: 'DRIVER_SUSPENSION_RECOMMENDED',
      targetId: selectedDriver.id,
      targetName: selectedDriver.name,
      details: `Submitted driver suspension endorsement for ${selectedDriver.name} (${selectedDriver.vehiclePlate}) for LGU review. Reason: ${suspendReasonInput || 'Operational violation.'}`,
      category: 'Membership',
    });

    setSuspendDialogOpen(false);
    setSelectedDriver(null);
  };

  // Action: Request Driver Reactivation (Governance Flow)
  const handleReactivateRequest = async () => {
    if (!selectedDriver) return;

    try {
      await reactivateTodaDriver(selectedDriver.id);
    } catch (err) {
      setToast({ message: `Could not submit the recommendation: ${(err as Error).message}`, severity: 'error' });
      return;
    }

    setDrivers((prev) =>
      prev.map((d) =>
        d.id === selectedDriver.id
          ? { ...d, accountStatus: 'Reactivation Review' }
          : d
      )
    );

    recordTodaAuditAction({
      actionType: 'DRIVER_REACTIVATION_RECOMMENDED',
      targetId: selectedDriver.id,
      targetName: selectedDriver.name,
      details: `Submitted driver reactivation recommendation for ${selectedDriver.name} (${selectedDriver.vehiclePlate}) to LGU Franchising Office for decision.`,
      category: 'Membership',
    });

    setReactivateDialogOpen(false);
    setSelectedDriver(null);
  };

  // Rule 25.6: a TODA Administrator decides the appeals routed to the TODA (Full waiver, Partial waiver or Denied, with the reason, Rule 25.8).
  // The database decides whether this administrator may, writes the audit entry and tells the driver.
  const handleExemptionDecision = async () => {
    if (!selectedExemption || decisionBusy) return;
    if (decisionReason.trim().length === 0) {
      setDecisionError('A reason is required for every decision.');
      return;
    }
    setDecisionBusy(true);
    setDecisionError(null);
    const message = await decideExemptionRequest(selectedExemption.id, decisionOutcome, decisionReason.trim(), Number(decisionPoints));
    setDecisionBusy(false);
    if (message) {
      setDecisionError(message);
      return;
    }
    setToast({ message: 'The decision was recorded and the driver was told.', severity: 'success' });
    setExemptionDecisionModalOpen(false);
    setSelectedExemption(null);
    await loadExemptions();
  };

  const handleEscalate = async (reason?: string) => {
    setEscalateOpen(false);
    if (!selectedExemption || !reason) return;
    if (reason.trim().length < 5) {
      setDecisionError('Write why the LGU Administrator needs to decide this appeal.');
      return;
    }
    setDecisionBusy(true);
    const message = await escalateExemptionRequest(selectedExemption.id, reason);
    setDecisionBusy(false);
    if (message) {
      setDecisionError(message);
      return;
    }
    setToast({ message: 'The appeal was passed to the LGU Administrator.', severity: 'success' });
    setExemptionDecisionModalOpen(false);
    setSelectedExemption(null);
    await loadExemptions();
  };

  // The four numbers of the roster view: the counts are the ones computed above; the number is coloured only when it is above zero.
  const stats: OperationsStat[] = [
    { key: 'total', label: 'Driver roster', value: totalCount },
    { key: 'active', label: 'Active accredited drivers', value: activeCount, tone: activeCount > 0 ? 'success' : 'neutral' },
    { key: 'review', label: 'Pending governance reviews', value: reviewCount, note: 'Under LGU endorsement review', tone: reviewCount > 0 ? 'brand' : 'neutral' },
    { key: 'suspended', label: 'Suspended / deactivated', value: suspendedCount, tone: suspendedCount > 0 ? 'danger' : 'neutral' },
  ];

  const filtersActive = Boolean(searchQuery) || statusFilter !== 'All';
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: SPACE.section }}>
      {isTodaLocked(todaStatus) ? (
        <FeatureLockedNotice />
      ) : (
        <>
      {/* 1. The three views of this page */}
      <Box sx={{ borderBottom: '1px solid var(--mac-border-color)', mb: SPACE.gapLarge }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: FONT.body,
              fontWeight: 600,
              minHeight: 40,
              color: OPS_TEXT.secondary,
              '&.Mui-selected': { color: OPS_TEXT.brand },
              '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '-2px' },
            },
            '& .MuiTabs-indicator': { backgroundColor: 'var(--sakay-orange)', height: 3 },
          }}
        >
          <Tab icon={<PeopleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Driver Members (${totalCount})`} />
          <Tab icon={<GavelIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Strike Exemption Appeals (${exemptions.length})`} />
          <Tab icon={<DescriptionIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Master Roster (${rosterEntries.length})`} />
        </Tabs>
      </Box>

      {activeTab === 0 ? (
        <>
          {/* what this list is, in one line (the Master Roster tab is a different list) */}
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.5, mb: SPACE.gap, maxWidth: '100ch' }}>
            The drivers of your TODA, with their SAKAY account status and strikes. Request a suspension or a reactivation here.
          </Typography>

          {/* 2. Summary numbers */}
          <OperationsStatStrip stats={stats} />

          {/* 3. Search and filter */}
          <FilterToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search name, plate, franchise or membership ID"
            selectFilters={[
              {
                id: 'status',
                label: 'Account status',
                value: statusFilter,
                options: statusOptions,
                onChange: setStatusFilter,
                width: 220,
              },
            ]}
            onResetFilters={() => {
              setSearchQuery('');
              setStatusFilter('All');
            }}
          />

          {/* 4. Accredited drivers */}
          <DataTableCard label="Driver members" minWidth={860} columns={[{ label: 'Driver member' }, { label: 'Franchise and plate' }, { label: 'Service zone' }, { label: 'Strikes' }, { label: 'Account status' }, { label: 'Action', align: 'right' }]}>
            <TableBody>
              {isLoading ? (
                <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading drivers..." />
              ) : filteredDrivers.length === 0 ? (
                filtersActive || drivers.length > 0 ? (
                  <DataTableMessageRow
                    colSpan={6}
                    kind="noResults"
                    title="No drivers match"
                    hint={statusFilter !== 'All' ? `No driver members match the "${statusFilter}" status${searchQuery ? ' and your search' : ''}. Try another filter, or press Reset.` : 'No driver members match your search. Try other words, or press Reset.'}
                  />
                ) : (
                  <DataTableMessageRow
                    colSpan={6}
                    kind="empty"
                    title="No drivers yet"
                    hint="Accredited driver members of this TODA will be listed here."
                  />
                )
              ) : (
                filteredDrivers.map((drv) => {
                  const highStrikes = drv.strikesCount >= STRIKE_LADDER.ADMIN_REVIEW_AT;
                  return (
                    <TableRow key={drv.id}>
                      <TableCell>
                        <PersonCell name={drv.name} detail={`${drv.membershipNo} • License: ${drv.licenseNo}`} />
                      </TableCell>

                      <TableCell>
                        <CellStack primary={drv.vehiclePlate} secondary={drv.franchiseNo} />
                      </TableCell>

                      <TableCell sx={{ color: OPS_TEXT.secondary, maxWidth: 260 }}>
                        {drv.serviceZone}
                      </TableCell>

                      <TableCell>
                        {/* the icon and the red colour both mark a driver who has reached the review level; the numbers say it in words */}
                        <Chip
                          icon={highStrikes ? <WarningAmberIcon sx={{ fontSize: '14px !important', color: '#B91C1C !important' }} /> : undefined}
                          label={`${drv.strikesCount} / ${STRIKE_LADDER.DEACTIVATION_AT} Strikes`}
                          size="small"
                          sx={{
                            height: 24,
                            fontSize: FONT.small,
                            fontWeight: 600,
                            backgroundColor: highStrikes ? '#FEF2F2' : '#F1F3F4',
                            color: highStrikes ? '#B91C1C' : OPS_TEXT.secondary,
                          }}
                        />
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={drv.accountStatus} highContrast sx={{ height: '24px', fontSize: FONT.small }} />
                      </TableCell>

                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {isTodaLocked(todaStatus) ? (
                          <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>
                            Temporarily Locked
                          </Typography>
                        ) : drv.accountStatus === 'Active' ? (
                          <Button
                            variant="outlined"
                            sx={rowActionSx('danger')}
                            onClick={() => {
                              setSelectedDriver(drv);
                              setSuspendDialogOpen(true);
                            }}
                          >
                            Request Suspension
                          </Button>
                        ) : drv.accountStatus === 'TODA Suspended' || drv.accountStatus === 'Suspension Review' ? (
                          <Button
                            variant="outlined"
                            sx={rowActionSx('neutral')}
                            onClick={() => {
                              setSelectedDriver(drv);
                              setReactivateDialogOpen(true);
                            }}
                          >
                            Request Reactivation
                          </Button>
                        ) : (
                          <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>
                            Under LGU Jurisdiction
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </DataTableCard>
        </>
      ) : activeTab === 1 ? (
        /* 5. Strike Exemption Appeals Tab */
        <DataTableCard label="Strike exemption appeals" minWidth={760} columns={[{ label: 'Driver' }, { label: 'Incident category' }, { label: 'Submitted evidence' }, { label: 'Appeal date' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}>
          <TableBody>
            {exemptions.length === 0 ? (
              <DataTableMessageRow
                colSpan={6}
                kind="empty"
                title="No strike exemption appeals"
                hint="When a driver appeals a strike, the appeal will be listed here for your review."
              />
            ) : (
              exemptions.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {ex.driverName}
                  </TableCell>

                  <TableCell>
                    <CellStack primary={ex.incidentCategory} secondary={`Strike Ref: ${ex.strikeId}`} quiet />
                  </TableCell>

                  <TableCell>
                    <Chip
                      icon={<DescriptionIcon sx={{ fontSize: '14px !important', color: `${OPS_TEXT.brand} !important` }} />}
                      label={`${ex.evidenceFiles.length} Evidence Document${ex.evidenceFiles.length === 1 ? '' : 's'}`}
                      size="small"
                      sx={{ height: 24, backgroundColor: 'var(--sakay-orange-soft)', color: OPS_TEXT.brand, fontWeight: 600, fontSize: FONT.small }}
                    />
                  </TableCell>

                  <TableCell sx={{ color: OPS_TEXT.secondary }}>
                    {ex.submittedAt}
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={ex.status} highContrast sx={{ height: '24px', fontSize: FONT.small }} />
                  </TableCell>

                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      sx={rowActionSx(ex.status === 'Pending TODA Review' ? 'brand' : 'neutral')}
                      onClick={() => {
                        setSelectedExemption(ex);
                        setDecisionOutcome('FULL');
                        setDecisionReason('');
                        setDecisionPoints('1');
                        setDecisionError(null);
                        setExemptionDecisionModalOpen(true);
                      }}
                    >
                      {ex.status === 'Pending TODA Review' ? 'Review Appeal' : 'View Appeal'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </DataTableCard>
      ) : (
        /* 6. Official Master Roster Tab (Rule 2.4) */
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '13px', mb: SPACE.gap }}>
            <Box sx={{ minWidth: 0, flex: '1 1 320px' }}>
              <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>
                Master Roster
              </Typography>
              <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '2px', lineHeight: 1.5, maxWidth: '90ch' }}>
                The franchise and plate numbers your TODA vouches for. When a driver applies to your TODA, Driver Verification checks the application against this list.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => {
                setRosterError(null);
                setRosterAddModalOpen(true);
              }}
              sx={primaryButtonSx}
            >
              Add Roster Member
            </Button>
          </Box>

          <DataTableCard label="Master roster" minWidth={760} columns={[{ label: 'Member full name' }, { label: 'Franchise number' }, { label: 'Vehicle plate number' }, { label: 'Date added' }, { label: 'Screening status' }, { label: 'Action', align: 'right' }]}>
            <TableBody>
              {rosterEntries.length === 0 ? (
                <DataTableMessageRow
                  colSpan={6}
                  kind="empty"
                  title="No master roster entries yet"
                  hint='Click "Add Roster Member" to register franchise members.'
                />
              ) : (
                rosterEntries.map((entry) => (
                  <TableRow key={entry.roster_id || `${entry.franchise_number}-${entry.plate_number}`}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {entry.member_name}
                    </TableCell>
                    <TableCell>
                      {entry.franchise_number}
                    </TableCell>
                    <TableCell>
                      {entry.plate_number}
                    </TableCell>
                    <TableCell sx={{ color: OPS_TEXT.secondary }}>
                      {entry.created_at ? dateOf(entry.created_at) : 'Registered'}
                      {entry.updated_at && (
                        <Typography component="div" sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>
                          Edited {dateOf(entry.updated_at)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status="Active" label="Active Roster" highContrast sx={{ height: '24px', fontSize: FONT.small }} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="outlined"
                        startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                        disabled={!entry.entry_id}
                        onClick={() => openEditEntry(entry)}
                        sx={rowActionSx('brand')}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </DataTableCard>
        </Box>
      )}

      {/* 6. Strike Exemption Appeal Centered Modal with Clickable Evidence */}
      {selectedExemption && (
        <MacCenterModal
          open={exemptionDecisionModalOpen}
          onClose={() => setExemptionDecisionModalOpen(false)}
          title={`Review Strike Exemption Appeal — ${selectedExemption.driverName}`}
          subtitle={'Submitted: ' + selectedExemption.submittedAt + (selectedExemption.decisionDueAt ? ' • Decision due: ' + selectedExemption.decisionDueAt : '')}
          badge={<StatusBadge status={selectedExemption.status} />}
          maxWidth={608}
          primaryActionLabel={selectedExemption.status === 'Pending TODA Review' ? 'Record decision' : undefined}
          onPrimaryAction={handleExemptionDecision}
          secondaryActionLabel="Close"
          onSecondaryAction={() => setExemptionDecisionModalOpen(false)}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '19px' }}>
            {/* The decision (Rule 25.6): only an appeal routed to this TODA and still waiting */}
            {selectedExemption.status === 'Pending TODA Review' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '13px', p: '13px 14px', borderRadius: '10px', border: '1px solid var(--sakay-orange-border)', backgroundColor: 'var(--sakay-orange-soft)' }}>
                <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Your decision</Typography>
                <TextField
                  select
                  size="small"
                  label="Outcome"
                  value={decisionOutcome}
                  onChange={(e) => setDecisionOutcome(e.target.value as 'FULL' | 'PARTIAL' | 'DENIED')}
                  slotProps={{ select: { native: true } }}
                  fullWidth
                >
                  <option value="FULL">Full waiver: the strike is removed</option>
                  <option value="PARTIAL">Partial waiver: some of its points are removed</option>
                  <option value="DENIED">Denied: the strike stands</option>
                </TextField>
                {decisionOutcome === 'PARTIAL' && (
                  <TextField
                    size="small"
                    type="number"
                    label={'Points to waive (the strike has ' + (selectedExemption.strikePointsActive ?? '?') + ' active)'}
                    value={decisionPoints}
                    onChange={(e) => setDecisionPoints(e.target.value)}
                    fullWidth
                  />
                )}
                <TextField
                  multiline
                  minRows={2}
                  size="small"
                  label="Reason for the decision (the driver is told)"
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  fullWidth
                />
                {decisionError && <Alert severity="warning" sx={{ borderRadius: '8px' }}>{decisionError}</Alert>}
                {/* Rule 25.4: when the TODA cannot decide it (a suspension or deactivation is at stake, or the TODA is a party) */}
                <Button
                  variant="text"
                  onClick={() => setEscalateOpen(true)}
                  disabled={decisionBusy}
                  sx={{ textTransform: 'none', fontSize: '11px', fontWeight: 600, alignSelf: 'flex-start', color: '#1565C0', px: 0 }}
                >
                  Pass this appeal to the LGU Administrator instead
                </Button>
              </Box>
            ) : (
              <Alert severity={selectedExemption.status === 'Denied' ? 'error' : selectedExemption.status === 'Pending LGU Review' ? 'info' : 'success'} sx={{ borderRadius: '8px' }}>
                {selectedExemption.status === 'Pending LGU Review'
                  ? 'This appeal was passed to the LGU Administrator (a serious consequence, or the deadline passed).'
                  : 'Decided: ' + selectedExemption.status + (selectedExemption.decisionNotes ? ' — ' + selectedExemption.decisionNotes : '')}
              </Alert>
            )}

            {/* Section 1: Appeal Information */}
            <Box>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '10px' }}>
                Appeal Information
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '13px',
                  backgroundColor: '#F5F5F7',
                  padding: '14px 16px',
                  borderRadius: '10px',
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Driver Name</Typography>
                  <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedExemption.driverName}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Strike / Incident Category</Typography>
                  <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedExemption.incidentCategory}</Typography>
                </Box>
                <Box sx={{ gridColumn: 'span 2' }}>
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Driver's Stated Reason for Appeal</Typography>
                  <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-primary)', mt: '1.5px', lineHeight: 1.5 }}>
                    "{selectedExemption.reason}"
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Section 2: Supporting Evidence Attachments (Clickable & Viewable with explicit View button) */}
            <Box>
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '10px' }}>
                Supporting evidence ({selectedExemption.evidenceFiles.length} {selectedExemption.evidenceFiles.length === 1 ? 'attachment' : 'attachments'})
              </Typography>

              {selectedExemption.evidenceFiles.length === 0 ? (
                <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', fontStyle: 'italic' }}>
                  No supporting evidence was submitted with this appeal.
                </Typography>
              ) : (
                <EvidenceLinks paths={selectedExemption.evidenceFiles.map((f) => f.id)} sign={signTodaCaseEvidence} label="Photos sent with the appeal" />
              )}
            </Box>
          </Box>
        </MacCenterModal>
      )}

      {/* Rule 25.4: an appeal the TODA passes on (a serious consequence, or the TODA is a party) */}
      <MacConfirmDialog
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        title="Pass this appeal to the LGU Administrator?"
        message="Use this when the appeal involves a suspension or deactivation, or when the TODA itself is a party to the dispute. The LGU Administrator then decides it, and you can no longer decide it."
        confirmLabel="Pass to the LGU"
        confirmVariant="orange"
        requireReason
        reasonPlaceholder="Why does the LGU need to decide this appeal? (a few words)"
        onConfirm={handleEscalate}
      />

      {/* Suspension Recommendation Confirmation Dialog */}
      <MacConfirmDialog
        open={suspendDialogOpen}
        onClose={() => setSuspendDialogOpen(false)}
        title="Request Driver Suspension Review?"
        message={`Submit a driver suspension recommendation for ${selectedDriver?.name} (${selectedDriver?.vehiclePlate}) to the LGU Franchising Office for formal review.`}
        confirmLabel="Submit Suspension Request"
        confirmVariant="danger"
        requireReason
        reasonPlaceholder="Specify operational violation details..."
        onConfirm={handleSuspendRequest}
      />

      {/* Reactivation Recommendation Confirmation Dialog */}
      <MacConfirmDialog
        open={reactivateDialogOpen}
        onClose={() => setReactivateDialogOpen(false)}
        title="Request Driver Reactivation?"
        message={`Recommend reactivation of ${selectedDriver?.name}'s account status. The request will be forwarded to the LGU Franchising Board.`}
        confirmLabel="Submit Reactivation Endorsement"
        confirmVariant="orange"
        onConfirm={handleReactivateRequest}
      />

      {/* Add Master Roster Member Dialog (Rule 2.4) */}
      <Dialog open={rosterAddModalOpen} onClose={() => setRosterAddModalOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
        <DialogTitle sx={DIALOG_TITLE_SX}>
          Add Official Master Roster Entry
        </DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography sx={DIALOG_INTRO_SX}>
            Register driver and franchise details in the official TODA master roster. Applications matching this record will be verified automatically.
          </Typography>
          {rosterError && (
            <Alert severity="error">
              {rosterError}
            </Alert>
          )}
          <TextField
            label="Member Full Name"
            required
            fullWidth
            size="small"
            value={newMemberName}
            onChange={(e) => setNewMemberName(e.target.value)}
            placeholder="e.g. Juan dela Cruz"
          />
          <TextField
            label="Franchise Number"
            required
            fullWidth
            size="small"
            value={newFranchiseNumber}
            onChange={(e) => setNewFranchiseNumber(e.target.value)}
            placeholder="e.g. FR-CAL-2026-001"
          />
          <TextField
            label="Vehicle Plate Number"
            fullWidth
            size="small"
            value={newPlateNumber}
            onChange={(e) => setNewPlateNumber(e.target.value)}
            placeholder="e.g. 123-ABC"
          />
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={() => setRosterAddModalOpen(false)} sx={{ textTransform: 'none', color: OPS_TEXT.secondary, fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            onClick={handleAddRosterSubmit}
            variant="contained"
            disabled={rosterSubmitting}
            sx={primaryButtonSx}
          >
            {rosterSubmitting ? 'Adding...' : 'Add to Master Roster'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Master Roster Member Dialog */}
      <Dialog open={Boolean(editingEntry)} onClose={() => !editSubmitting && setEditingEntry(null)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}>
        <DialogTitle sx={DIALOG_TITLE_SX}>Update Master Roster Entry</DialogTitle>
        <DialogContent sx={DIALOG_CONTENT_SX}>
          <Typography sx={DIALOG_INTRO_SX}>
            Correct this member's details. A new franchise or plate number counts for applications submitted from now on; applications already
            submitted keep the roster result they had. Every change is recorded in the audit log.
          </Typography>
          {editError && (
            <Alert severity="error">
              {editError}
            </Alert>
          )}
          <TextField label="Member Full Name" required fullWidth size="small" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <TextField label="Franchise Number" required fullWidth size="small" value={editFranchise} onChange={(e) => setEditFranchise(e.target.value)} />
          <TextField label="Vehicle Plate Number" fullWidth size="small" value={editPlate} onChange={(e) => setEditPlate(e.target.value)} />
        </DialogContent>
        <DialogActions sx={DIALOG_ACTIONS_SX}>
          <Button onClick={() => setEditingEntry(null)} disabled={editSubmitting} sx={{ textTransform: 'none', color: OPS_TEXT.secondary, fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            onClick={handleEditRosterSubmit}
            variant="contained"
            disabled={editSubmitting}
            sx={primaryButtonSx}
          >
            {editSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
      </>
      )}

      <SakayToast
        open={Boolean(toast)}
        message={toast?.message ?? null}
        severity={toast?.severity ?? 'info'}
        onClose={() => setToast(null)}
      />
    </Box>
  );
};
