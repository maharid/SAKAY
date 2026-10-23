import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Tabs,
  Tab,
  Avatar,
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
import ShieldIcon from '@mui/icons-material/Shield';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';

import { EvidenceLinks } from '@sakay/shared';
import { TodaDriverMember, DriverExemptionRequest } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { STRIKE_LADDER } from '@sakay/shared/config/policyConfig';
import { StatusBadge } from '../components/common/StatusBadge';
import { SakayToast } from '../components/common/SakayToast';
import { ActionButton } from '../components/admin/ActionButton';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
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

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {isTodaLocked(todaStatus) ? (
        <Box sx={{ mt: 2, textAlign: 'center', p: 6, backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)' }}>
          <ShieldIcon sx={{ fontSize: 48, color: '#D1D5DB', mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'var(--mac-text-primary)' }}>Feature Unavailable</Typography>
          <Typography sx={{ color: 'var(--mac-text-secondary)', mt: 1, maxWidth: 500, mx: 'auto' }}>
            This feature will become available once your TODA has been approved and accredited by the LGU.
          </Typography>
        </Box>
      ) : (
        <>
      {/* 1. Page Sub-Header Navigation Tabs */}
      <Box sx={{ borderBottom: '1px solid var(--mac-border-color)', mb: 3.5 }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{
            minHeight: 46,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '15.5px',
              fontWeight: 600,
              minHeight: 46,
              color: 'var(--mac-text-muted)',
              '&.Mui-selected': { color: 'var(--sakay-orange)' },
            },
            '& .MuiTabs-indicator': { backgroundColor: 'var(--sakay-orange)', height: 3 },
          }}
        >
          <Tab icon={<PeopleIcon sx={{ fontSize: 20 }} />} iconPosition="start" label={`Accredited Driver Roster (${totalCount})`} />
          <Tab icon={<GavelIcon sx={{ fontSize: 20 }} />} iconPosition="start" label={`Strike Exemption Appeals (${exemptions.length})`} />
          <Tab icon={<DescriptionIcon sx={{ fontSize: 20 }} />} iconPosition="start" label={`Master Roster (${rosterEntries.length})`} />
        </Tabs>
      </Box>

      {activeTab === 0 ? (
        <>
          {/* 2. KPI Summary Panels */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: 2.5,
              mb: 3.5,
            }}
          >
            <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Driver Roster</Typography>
              <Typography sx={{ fontSize: '34px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{totalCount}</Typography>
            </Box>

            <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Active Accredited Drivers</Typography>
              <Typography sx={{ fontSize: '34px', fontWeight: 700, color: '#059669' }}>{activeCount}</Typography>
            </Box>

            <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Pending Governance Reviews</Typography>
              <Typography sx={{ fontSize: '34px', fontWeight: 700, color: 'var(--sakay-orange)' }}>{reviewCount}</Typography>
              <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Under LGU endorsement review</Typography>
            </Box>

            <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
              <Typography sx={{ fontSize: '14px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Suspended / Deactivated</Typography>
              <Typography sx={{ fontSize: '34px', fontWeight: 700, color: '#DC2626' }}>{suspendedCount}</Typography>
            </Box>
          </Box>

          {/* 3. Filter Toolbar */}
          <FilterToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search driver name, plate, franchise, or membership ID..."
            selectFilters={[
              {
                id: 'status',
                label: 'Account Status',
                value: statusFilter,
                options: statusOptions,
                onChange: setStatusFilter,
              },
            ]}
            onResetFilters={() => {
              setSearchQuery('');
              setStatusFilter('All');
            }}
          />

          {/* 4. Accredited Drivers Roster Table */}
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 'var(--mac-radius-lg)',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Driver Member</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Franchise & Plate</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Service Zone</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Strikes Record</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Account Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3, width: 220, whiteSpace: 'nowrap' }}>Governance Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredDrivers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 7 }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                        <Typography sx={{ fontSize: '16.5px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                          No Drivers Found
                        </Typography>
                        <Typography sx={{ fontSize: '14px', color: 'var(--mac-text-muted)' }}>
                          There are currently no driver members matching the "{statusFilter !== 'All' ? statusFilter : 'selected'}" filter criteria.
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDrivers.map((drv) => (
                    <TableRow key={drv.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
                          <Avatar
                            sx={{
                              width: 42,
                              height: 42,
                              backgroundColor: 'var(--sakay-orange-soft)',
                              color: 'var(--sakay-orange)',
                              fontWeight: 700,
                              fontSize: '15px',
                            }}
                          >
                            {drv.name.charAt(0)}
                          </Avatar>
                          <Box>
                            <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                              {drv.name}
                            </Typography>
                            <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                              {drv.membershipNo} • Lic: {drv.licenseNo}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                          {drv.vehiclePlate}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                          {drv.franchiseNo}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Typography sx={{ fontSize: '14.5px', color: 'var(--mac-text-secondary)' }}>
                          {drv.serviceZone}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Chip
                            label={`${drv.strikesCount} / ${STRIKE_LADDER.DEACTIVATION_AT} Strikes`}
                            size="small"
                            sx={{
                              fontSize: '13px',
                              fontWeight: 600,
                              backgroundColor: drv.strikesCount >= STRIKE_LADDER.ADMIN_REVIEW_AT ? '#FEF2F2' : '#F1F3F4',
                              color: drv.strikesCount >= STRIKE_LADDER.ADMIN_REVIEW_AT ? '#DC2626' : 'var(--mac-text-secondary)',
                            }}
                          />
                        </Box>
                      </TableCell>

                      <TableCell sx={{ py: 2, px: 3 }}>
                        <StatusBadge status={drv.accountStatus} />
                      </TableCell>

                      <TableCell align="right" sx={{ py: 2, px: 3, whiteSpace: 'nowrap' }}>
                        {isTodaLocked(todaStatus) ? (
                          <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>
                            Temporarily Locked
                          </Typography>
                        ) : drv.accountStatus === 'Active' ? (
                          <ActionButton
                            label="Request Suspension"
                            onClick={() => {
                              setSelectedDriver(drv);
                              setSuspendDialogOpen(true);
                            }}
                          />
                        ) : drv.accountStatus === 'TODA Suspended' || drv.accountStatus === 'Suspension Review' ? (
                          <ActionButton
                            label="Request Reactivation"
                            onClick={() => {
                              setSelectedDriver(drv);
                              setReactivateDialogOpen(true);
                            }}
                          />
                        ) : (
                          <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>
                            Under LGU Jurisdiction
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : activeTab === 1 ? (
        /* 5. Strike Exemption Appeals Tab */
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            overflow: 'hidden',
          }}
        >
          <Table>
            <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Driver</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Incident Category</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Submitted Evidence</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Appeal Date</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {exemptions.map((ex) => (
                <TableRow key={ex.id} sx={{ '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' } }}>
                  <TableCell sx={{ py: 2, px: 3, fontWeight: 600, fontSize: '15px' }}>
                    {ex.driverName}
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Typography sx={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                      {ex.incidentCategory}
                    </Typography>
                    <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                      Strike Ref: {ex.strikeId}
                    </Typography>
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <Chip
                      icon={<DescriptionIcon sx={{ fontSize: 16 }} />}
                      label={`${ex.evidenceFiles.length} Evidence Document${ex.evidenceFiles.length > 1 ? 's' : ''}`}
                      size="small"
                      sx={{ backgroundColor: 'var(--sakay-orange-soft)', color: 'var(--sakay-orange)', fontWeight: 600, fontSize: '13px' }}
                    />
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3, fontSize: '14px', color: 'var(--mac-text-secondary)' }}>
                    {ex.submittedAt}
                  </TableCell>

                  <TableCell sx={{ py: 2, px: 3 }}>
                    <StatusBadge status={ex.status} />
                  </TableCell>

                  <TableCell align="right" sx={{ py: 2, px: 3 }}>
                    <ActionButton
                      label={ex.status === 'Pending TODA Review' ? 'Review Appeal' : 'View Appeal'}
                      onClick={() => {
                        setSelectedExemption(ex);
                        setDecisionOutcome('FULL');
                        setDecisionReason('');
                        setDecisionPoints('1');
                        setDecisionError(null);
                        setExemptionDecisionModalOpen(true);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        /* 6. Official Master Roster Tab (Rule 2.4) */
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box>
              <Typography sx={{ fontSize: '18px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                Official TODA Master Roster Registry
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-secondary)', mt: 0.5 }}>
                Pre-accredited drivers, vehicle plates, and franchise numbers. Driver applicants matching this registry pass roster screening.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setRosterError(null);
                setRosterAddModalOpen(true);
              }}
              sx={{
                backgroundColor: 'var(--sakay-orange)',
                '&:hover': { backgroundColor: '#D97706' },
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                px: 2.5,
              }}
            >
              Add Roster Member
            </Button>
          </Box>

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 'var(--mac-radius-lg)',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Member Full Name</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Franchise Number</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Vehicle Plate Number</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Date Added</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>Screening Status</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12px', color: 'var(--mac-text-muted)', py: 2, px: 3 }} align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rosterEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'var(--mac-text-muted)' }}>
                      No master roster entries recorded yet. Click "Add Roster Member" to register franchise members.
                    </TableCell>
                  </TableRow>
                ) : (
                  rosterEntries.map((entry) => (
                    <TableRow key={entry.roster_id || `${entry.franchise_number}-${entry.plate_number}`}>
                      <TableCell sx={{ py: 2, px: 3, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                        {entry.member_name}
                      </TableCell>
                      <TableCell sx={{ py: 2, px: 3, color: 'var(--mac-text-primary)' }}>
                        {entry.franchise_number}
                      </TableCell>
                      <TableCell sx={{ py: 2, px: 3, color: 'var(--mac-text-primary)' }}>
                        {entry.plate_number}
                      </TableCell>
                      <TableCell sx={{ py: 2, px: 3, color: 'var(--mac-text-muted)', fontSize: '13px' }}>
                        {entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Registered'}
                        {entry.updated_at && (
                          <Typography component="div" sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                            Edited {new Date(entry.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 2, px: 3 }}>
                        <Chip label="Active Roster" size="small" sx={{ backgroundColor: '#E6F4EA', color: '#137333', fontWeight: 600, fontSize: '11px' }} />
                      </TableCell>
                      <TableCell sx={{ py: 2, px: 3 }} align="right">
                        <Button
                          size="small"
                          startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                          disabled={!entry.entry_id}
                          onClick={() => openEditEntry(entry)}
                          sx={{ textTransform: 'none', fontWeight: 600, color: 'var(--sakay-orange)' }}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
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
          maxWidth={760}
          primaryActionLabel={selectedExemption.status === 'Pending TODA Review' ? 'Record decision' : undefined}
          onPrimaryAction={handleExemptionDecision}
          secondaryActionLabel="Close"
          onSecondaryAction={() => setExemptionDecisionModalOpen(false)}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* The decision (Rule 25.6): only an appeal routed to this TODA and still waiting */}
            {selectedExemption.status === 'Pending TODA Review' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '16px 18px', borderRadius: '12px', border: '1px solid var(--sakay-orange-border)', backgroundColor: 'var(--sakay-orange-soft)' }}>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>Your decision</Typography>
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
                {decisionError && <Alert severity="warning" sx={{ borderRadius: '10px' }}>{decisionError}</Alert>}
                {/* Rule 25.4: when the TODA cannot decide it (a suspension or deactivation is at stake, or the TODA is a party) */}
                <Button
                  variant="text"
                  onClick={() => setEscalateOpen(true)}
                  disabled={decisionBusy}
                  sx={{ textTransform: 'none', fontSize: '12.5px', fontWeight: 600, alignSelf: 'flex-start', color: '#1565C0', px: 0 }}
                >
                  Pass this appeal to the LGU Administrator instead
                </Button>
              </Box>
            ) : (
              <Alert severity={selectedExemption.status === 'Denied' ? 'error' : selectedExemption.status === 'Pending LGU Review' ? 'info' : 'success'} sx={{ borderRadius: '10px' }}>
                {selectedExemption.status === 'Pending LGU Review'
                  ? 'This appeal was passed to the LGU Administrator (a serious consequence, or the deadline passed).'
                  : 'Decided: ' + selectedExemption.status + (selectedExemption.decisionNotes ? ' — ' + selectedExemption.decisionNotes : '')}
              </Alert>
            )}

            {/* Section 1: Appeal Information */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 1.5 }}>
                Appeal Information
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 2,
                  backgroundColor: '#F5F5F7',
                  padding: '18px 20px',
                  borderRadius: '12px',
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>Driver Name</Typography>
                  <Typography sx={{ fontSize: '16px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedExemption.driverName}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>Strike / Incident Category</Typography>
                  <Typography sx={{ fontSize: '16px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedExemption.incidentCategory}</Typography>
                </Box>
                <Box sx={{ gridColumn: 'span 2' }}>
                  <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>Driver's Stated Reason for Appeal</Typography>
                  <Typography sx={{ fontSize: '15px', color: 'var(--mac-text-primary)', mt: '2px', lineHeight: 1.5 }}>
                    "{selectedExemption.reason}"
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Section 2: Supporting Evidence Attachments (Clickable & Viewable with explicit View button) */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 1.5 }}>
                Submitted Supporting Evidence ({selectedExemption.evidenceFiles.length} Attachments)
              </Typography>

              {selectedExemption.evidenceFiles.length === 0 ? (
                <Typography sx={{ fontSize: '14px', color: 'var(--mac-text-muted)', fontStyle: 'italic' }}>
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
      <Dialog open={rosterAddModalOpen} onClose={() => setRosterAddModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>
          Add Official Master Roster Entry
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-secondary)', mb: 2 }}>
            Register driver and franchise details in the official TODA master roster. Applications matching this record will be verified automatically.
          </Typography>
          {rosterError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {rosterError}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Member Full Name"
              required
              fullWidth
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="e.g. Juan dela Cruz"
            />
            <TextField
              label="Franchise Number"
              required
              fullWidth
              value={newFranchiseNumber}
              onChange={(e) => setNewFranchiseNumber(e.target.value)}
              placeholder="e.g. FR-CAL-2026-001"
            />
            <TextField
              label="Vehicle Plate Number"
              fullWidth
              value={newPlateNumber}
              onChange={(e) => setNewPlateNumber(e.target.value)}
              placeholder="e.g. 123-ABC"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setRosterAddModalOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={handleAddRosterSubmit}
            variant="contained"
            disabled={rosterSubmitting}
            sx={{
              backgroundColor: 'var(--sakay-orange)',
              '&:hover': { backgroundColor: '#D97706' },
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {rosterSubmitting ? 'Adding...' : 'Add to Master Roster'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Master Roster Member Dialog */}
      <Dialog open={Boolean(editingEntry)} onClose={() => !editSubmitting && setEditingEntry(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px' }}>Update Master Roster Entry</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-secondary)', mb: 2 }}>
            Correct this member's details. A new franchise or plate number counts for applications submitted from now on; applications already
            submitted keep the roster result they had. Every change is recorded in the audit log.
          </Typography>
          {editError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {editError}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Member Full Name" required fullWidth value={editName} onChange={(e) => setEditName(e.target.value)} />
            <TextField label="Franchise Number" required fullWidth value={editFranchise} onChange={(e) => setEditFranchise(e.target.value)} />
            <TextField label="Vehicle Plate Number" fullWidth value={editPlate} onChange={(e) => setEditPlate(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEditingEntry(null)} disabled={editSubmitting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={handleEditRosterSubmit}
            variant="contained"
            disabled={editSubmitting}
            sx={{ backgroundColor: 'var(--sakay-orange)', '&:hover': { backgroundColor: '#D97706' }, textTransform: 'none', fontWeight: 600 }}
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
