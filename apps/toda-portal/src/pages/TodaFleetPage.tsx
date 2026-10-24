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
  Card,
  CardContent,
  Button,
  Chip,
  TextField,
  MenuItem,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import AddIcon from '@mui/icons-material/Add';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';

import { fetchTodaFleet, addTodaVehicle, TodaVehicleUnit, DEFAULT_TODA_ID } from '../services/todaApiService';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { DocumentPreviewModal } from '../components/admin/DocumentPreviewModal';

/**
 * ============================================================================
 * TODA TRICYCLE FLEET MANAGEMENT PAGE (TodaFleetPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● Manage Tricycle Units
 *     ○ View tricycle records
 *     ○ Add tricycle unit
 *     ○ Review tricycle documents
 *     ○ Update tricycle status
 *     ○ Manage TODA vehicle fleet
 * ============================================================================
 */
export const TodaFleetPage: React.FC = () => {
  const [fleet, setFleet] = useState<TodaVehicleUnit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Add Unit Dialog
  const [addUnitDialogOpen, setAddUnitDialogOpen] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newMtop, setNewMtop] = useState('');
  const [newDriver, setNewDriver] = useState('');
  const [newOrCr, setNewOrCr] = useState('');

  // Document preview
  const [previewDoc, setPreviewDoc] = useState<{ name: string; type: string } | null>(null);

  const loadFleet = async () => {
    setIsLoading(true);
    try {
      const data = await fetchTodaFleet();
      setFleet(data);
    } catch (err) {
      console.error('[TodaFleetPage] Error loading fleet:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFleet();
  }, []);

  const handleAddUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlate.trim() || !newMtop.trim() || !newDriver.trim()) return;

    try {
      await addTodaVehicle({
        plateNumber: newPlate.trim(),
        mtopNumber: newMtop.trim(),
        driverName: newDriver.trim(),
        orCrNumber: newOrCr.trim() || 'ORCR-PENDING',
      });

      const newUnit: TodaVehicleUnit = {
        id: `UNIT-${String(fleet.length + 1).padStart(3, '0')}`,
        plateNumber: newPlate.trim(),
        mtopNumber: newMtop.trim(),
        driverName: newDriver.trim(),
        driverId: `DRV-NEW-${Date.now().toString().slice(-4)}`,
        status: 'Active',
        inspectionStatus: 'Passed',
        orCrNumber: newOrCr.trim() || 'ORCR-PENDING',
        registeredDate: new Date().toLocaleDateString('en-US'),
      };

      setFleet((prev) => [newUnit, ...prev]);
      setAddUnitDialogOpen(false);
      setNewPlate('');
      setNewMtop('');
      setNewDriver('');
      setNewOrCr('');
    } catch (err) {
      console.error('[TodaFleetPage] Error adding unit:', err);
    }
  };

  const handleToggleUnitStatus = (unitId: string) => {
    setFleet((prev) =>
      prev.map((u) =>
        u.id === unitId
          ? { ...u, status: u.status === 'Active' ? 'Maintenance' : 'Active' }
          : u
      )
    );
  };

  const filteredFleet = fleet.filter((u) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      u.plateNumber.toLowerCase().includes(q) ||
      u.mtopNumber.toLowerCase().includes(q) ||
      u.driverName.toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'All' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalUnits = fleet.length;
  const activeUnits = fleet.filter((u) => u.status === 'Active').length;
  const maintenanceUnits = fleet.filter((u) => u.status === 'Maintenance').length;

  const statusOptions: FilterOption[] = [
    { label: 'All Unit Statuses', value: 'All' },
    { label: 'Active', value: 'Active' },
    { label: 'Maintenance', value: 'Maintenance' },
    { label: 'Inactive', value: 'Inactive' },
  ];

  return (
    <Box sx={{ maxWidth: 1280, margin: '0 auto', pb: '38px' }}>
      {/* 1. Summary Cards & Add Button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '22px', flexWrap: 'wrap', gap: '13px' }}>
        <Box>
          <Typography sx={{ fontSize: '16px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
            TODA Tricycle Fleet Roster
          </Typography>
          <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '2.5px' }}>
            Manage authorized motorized tricycle units, franchise permits, and roadworthiness records
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Button
            onClick={loadFleet}
            startIcon={<RefreshIcon />}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', borderColor: 'var(--mac-border-color)', color: 'var(--mac-text-primary)' }}
          >
            Refresh
          </Button>
          <Button
            onClick={() => setAddUnitDialogOpen(true)}
            startIcon={<AddIcon />}
            variant="contained"
            size="small"
            sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
          >
            + Register Tricycle Unit
          </Button>
        </Box>
      </Box>

      {/* 2. Top Summary KPI Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: '16px',
          mb: '26px',
        }}
      >
        <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '16px 18px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Total Fleet Size
              </Typography>
              <DirectionsCarIcon sx={{ color: 'var(--sakay-orange)', fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '3px' }}>
              {totalUnits} Units
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
              Accredited TODA tricycle inventory
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '16px 18px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Active & Operational
              </Typography>
              <CheckCircleIcon sx={{ color: '#2E7D32', fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: '#2E7D32', mb: '3px' }}>
              {activeUnits} Units
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
              Ready for dispatch operations
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: '14px', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '16px 18px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Under Maintenance / Inactive
              </Typography>
              <BuildIcon sx={{ color: '#FF6600', fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: '#FF6600', mb: '3px' }}>
              {maintenanceUnits} Units
            </Typography>
            <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
              Temporary mechanical repairs
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 3. Filter Toolbar */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search vehicle plate no., MTOP franchise, driver name, or unit ID..."
        selectFilters={[
          {
            id: 'status',
            label: 'Operational Status',
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

      {/* 4. Fleet Data Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: '14px',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                UNIT ID & PLATE NO.
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                MTOP FRANCHISE
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                ASSIGNED MEMBER DRIVER
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                INSPECTION & OR/CR
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                FLEET STATUS
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: '11px', color: 'var(--mac-text-muted)', py: '13px', px: '19px' }}>
                ACTIONS
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: '51px' }}>
                  <CircularProgress size={26} sx={{ color: 'var(--sakay-orange)', mb: '10px' }} />
                  <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)' }}>
                    Loading vehicle fleet...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : filteredFleet.length > 0 ? (
              filteredFleet.map((unit) => (
                <TableRow
                  key={unit.id}
                  sx={{
                    transition: 'var(--mac-transition-fast)',
                    '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  }}
                >
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '12px', color: 'var(--mac-text-primary)' }}>
                      {unit.plateNumber}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '1.5px' }}>
                      Unit Ref: {unit.id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                      {unit.mtopNumber}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                      Calapan City Franchise
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                      {unit.driverName}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                      ID: {unit.driverId}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#2E7D32' }}>
                      ✓ {unit.inspectionStatus}
                    </Typography>
                    <Typography
                      onClick={() => setPreviewDoc({ name: `OR/CR Document (${unit.plateNumber})`, type: 'Official LTO Registration' })}
                      sx={{ fontSize: '11px', color: 'var(--sakay-orange)', cursor: 'pointer', mt: '1.5px', textDecoration: 'underline' }}
                    >
                      {unit.orCrNumber} (View Doc)
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: '14px', px: '19px' }}>
                    <StatusBadge status={unit.status === 'Active' ? 'Active' : 'Inactive'} />
                  </TableCell>
                  <TableCell align="right" sx={{ py: '14px', px: '19px' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleToggleUnitStatus(unit.id)}
                      sx={{
                        textTransform: 'none',
                        fontSize: '11px',
                        borderColor: 'var(--mac-border-color)',
                        color: unit.status === 'Active' ? '#FF6600' : '#2E7D32',
                      }}
                    >
                      {unit.status === 'Active' ? 'Set Maintenance' : 'Set Active'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: '51px' }}>
                  <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-primary)', fontWeight: 600 }}>
                    No tricycle units found
                  </Typography>
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>
                    {searchQuery || statusFilter !== 'All'
                      ? 'No vehicle units match your search filters.'
                      : 'There are currently no registered tricycle units in this TODA fleet.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add Tricycle Unit Dialog */}
      <Dialog open={addUnitDialogOpen} onClose={() => setAddUnitDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '14px' }}>
          Register New Tricycle Unit
        </DialogTitle>
        <form onSubmit={handleAddUnitSubmit}>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <TextField
              label="Vehicle Plate Number *"
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="e.g. 981-MV"
              required
              fullWidth
              size="small"
            />
            <TextField
              label="MTOP Franchise Permit Number *"
              value={newMtop}
              onChange={(e) => setNewMtop(e.target.value)}
              placeholder="e.g. MTOP-2026-098"
              required
              fullWidth
              size="small"
            />
            <TextField
              label="Assigned Member Driver Full Name *"
              value={newDriver}
              onChange={(e) => setNewDriver(e.target.value)}
              placeholder="e.g. Danilo R. Santos"
              required
              fullWidth
              size="small"
            />
            <TextField
              label="LTO OR/CR Certificate Number"
              value={newOrCr}
              onChange={(e) => setNewOrCr(e.target.value)}
              placeholder="e.g. ORCR-77491"
              fullWidth
              size="small"
            />
          </DialogContent>
          <DialogActions sx={{ p: '16px' }}>
            <Button onClick={() => setAddUnitDialogOpen(false)} sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              sx={{ textTransform: 'none', backgroundColor: 'var(--sakay-orange)', fontWeight: 600 }}
            >
              Add Unit to Fleet
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Document Inspection Popover */}
      {previewDoc && (
        <DocumentPreviewModal
          open={Boolean(previewDoc)}
          onClose={() => setPreviewDoc(null)}
          documentName={previewDoc.name}
          documentType={previewDoc.type}
        />
      )}
    </Box>
  );
};
