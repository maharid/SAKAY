import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  TextField,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import CalculateIcon from '@mui/icons-material/Calculate';
import HistoryIcon from '@mui/icons-material/History';
import EditNoteIcon from '@mui/icons-material/EditNote';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { FareMatrixRecord } from '../mockData/adminData';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { fetchFareMatrices, enactFareMatrix, fetchFareExample, type FareExample } from '../services/adminApiService';

/**
 * ============================================================================
 * FARE CONFIGURATION PAGE COMPONENT
 * ============================================================================
 * Purpose:
 *   Allows LGU Transport Board administrators to review active municipal
 *   tricycle tariffs, derive passenger seat fares, enact new fare ordinances,
 *   and maintain an immutable audit trail of all rate modifications.
 * ============================================================================
 */
export const FareConfigurationPage: React.FC = () => {
  // State: the rule history exactly as the database reports it (Rule 6.3)
  const [fareHistory, setFareHistory] = useState<FareMatrixRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');
  const [updateModalOpen, setUpdateModalOpen] = useState<boolean>(false);
  const [selectedVersion, setSelectedVersion] = useState<FareMatrixRecord | null>(null);
  const [example, setExample] = useState<FareExample | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  // Form State: controlled inputs for enacting a new municipal fare rate
  const [newBaseFare, setNewBaseFare] = useState<string>('');
  const [newBaseDistance, setNewBaseDistance] = useState<string>('');
  const [newSucceedingRate, setNewSucceedingRate] = useState<string>('');
  const [newOrdinance, setNewOrdinance] = useState<string>('');
  const [newEffectiveLocal, setNewEffectiveLocal] = useState<string>('');
  const [newReason, setNewReason] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');

  /**
   * Loads the rule history from the database. Never falls back to an invented rate: if the history cannot be read,
   * the page says so.
   */
  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      setFareHistory(await fetchFareMatrices());
    } catch (err) {
      setFareHistory([]);
      setLoadError(err instanceof Error ? err.message : 'The fare history could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // The rule in force is decided by the database from the effective timestamps.
  const activeMatrix = fareHistory.find((f) => f.status === 'In force') || null;

  // Version numbers run oldest (V1) to newest.
  const versionNumber = (record: FareMatrixRecord): number =>
    [...fareHistory]
      .sort((a, b) => new Date(a.effective_timestamp).getTime() - new Date(b.effective_timestamp).getTime() || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .findIndex((f) => f.fare_matrix_id === record.fare_matrix_id) + 1;

  // Worked example for the rule in force, computed by the database's own fare function.
  const activeRuleKey = activeMatrix?.fare_matrix_id;
  useEffect(() => {
    if (!activeMatrix) {
      setExample(null);
      return;
    }
    let cancelled = false;
    fetchFareExample(4.5, activeMatrix).then((ex) => {
      if (!cancelled) setExample(ex);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuleKey]);

  const openConfigureModal = () => {
    setFormError('');
    setNewBaseFare(activeMatrix ? activeMatrix.base_fare.toFixed(2) : '');
    setNewBaseDistance(activeMatrix ? activeMatrix.base_distance_km.toFixed(2) : '');
    setNewSucceedingRate(activeMatrix ? activeMatrix.succeeding_rate.toFixed(2) : '');
    setNewOrdinance('');
    setNewEffectiveLocal('');
    setNewReason('');
    setNewNotes('');
    setUpdateModalOpen(true);
  };

  /**
   * Handler: submits a new fare rule to the database (public.enact_fare_matrix). The database checks the caller is the
   * LGU Administrator, refuses a back-dated change, records the audit entry (actor, before, after, reason) and appends
   * the version. The page then reloads the history instead of pretending the save worked.
   */
  const handleUpdateMatrixSubmit = async () => {
    const money = /^\d+(\.\d{1,2})?$/;
    if (!money.test(newBaseFare.trim()) || !money.test(newBaseDistance.trim()) || !money.test(newSucceedingRate.trim())) {
      setFormError('Base fare, base distance and per-km rate must be numbers with at most 2 decimal places.');
      return;
    }
    if (newOrdinance.trim().length < 3) {
      setFormError('Enter the ordinance or resolution this change is based on.');
      return;
    }
    if (newReason.trim().length < 5) {
      setFormError('Enter the reason for the change (at least 5 characters). It is written to the audit trail.');
      return;
    }

    // The date-time box is read as Asia/Manila time; empty means "effective immediately".
    const effectiveAt = newEffectiveLocal ? new Date(newEffectiveLocal + ':00+08:00').toISOString() : null;

    setSaving(true);
    setFormError('');
    try {
      await enactFareMatrix({
        baseFare: Number(newBaseFare),
        baseDistanceKm: Number(newBaseDistance),
        succeedingRate: Number(newSucceedingRate),
        ordinanceReference: newOrdinance.trim(),
        reason: newReason.trim(),
        effectiveAt,
        notes: newNotes.trim() || undefined,
      });
      setUpdateModalOpen(false);
      await loadHistory();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'The change could not be saved.';
      setFormError(raw.replace(/^ERR_[A-Z_]+:\s*/, ''));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
        <Typography sx={{ fontSize: '14px', color: 'var(--mac-text-muted)' }}>Loading the fare rules...</Typography>
      </Box>
    );
  }

  if (loadError || !activeMatrix) {
    return (
      <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={loadHistory}>
              Retry
            </Button>
          }
        >
          {loadError
            ? 'The fare rules could not be loaded: ' + loadError.replace(/^ERR_[A-Z_]+:\s*/, '')
            : 'No fare rule is in force. Enact one to allow bookings.'}
        </Alert>
        {!loadError && (
          <Button onClick={openConfigureModal} variant="contained" sx={{ mt: 2, textTransform: 'none' }}>
            Configure New Rate
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Top Summary Stat Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2.5,
          mb: 3.5,
        }}
      >
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Standard Base Fare</Typography>
          <Typography sx={{ fontSize: '32px', fontWeight: 700, color: 'var(--sakay-orange)' }}>₱{activeMatrix.base_fare.toFixed(2)}</Typography>
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 0.5 }}>First {activeMatrix.base_distance_km.toFixed(1)} kilometers</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Succeeding Per-KM Rate</Typography>
          <Typography sx={{ fontSize: '32px', fontWeight: 700, color: '#1565C0' }}>₱{activeMatrix.succeeding_rate.toFixed(2)} / km</Typography>
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 0.5 }}>Excess distance increment</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Solo Trip Base</Typography>
          <Typography sx={{ fontSize: '32px', fontWeight: 700, color: '#2E7D32' }}>₱{(activeMatrix.solo_base_fare ?? 0).toFixed(2)}</Typography>
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: 0.5 }}>4-Seat capacity charter</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '20px 24px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 500, color: 'var(--mac-text-muted)', mb: 1 }}>Matrix Versions</Typography>
          <Typography sx={{ fontSize: '32px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{fareHistory.length} Versions</Typography>
          <Typography sx={{ fontSize: '12px', color: '#1E8E3E', mt: 0.5, fontWeight: 600 }}>Active: V{versionNumber(activeMatrix)}</Typography>
        </Box>
      </Box>

      {/* 2. Active Fare Matrix & Derived Formulas Split Grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' }, gap: 3, mb: 4, alignItems: 'start' }}>
        {/* Active Fare Matrix Card */}
        <Card
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <CardContent sx={{ p: '28px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: '4px' }}>
                  <Typography sx={{ fontSize: '20px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                    Current Active Fare Matrix
                  </Typography>
                  <Chip
                    label="Active Standard"
                    size="small"
                    sx={{ backgroundColor: '#E6F4EA', color: '#1E8E3E', fontWeight: 700, fontSize: '12px', height: 24 }}
                  />
                </Box>
                <Typography sx={{ fontSize: '13.5px', color: 'var(--mac-text-muted)' }}>
                  {activeMatrix.ordinance_reference}
                </Typography>
              </Box>

              <Button
                onClick={openConfigureModal}
                startIcon={<EditNoteIcon />}
                variant="contained"
                sx={{
                  height: 40,
                  padding: '0 20px',
                  borderRadius: '9px',
                  textTransform: 'none',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  backgroundColor: 'var(--sakay-orange)',
                  color: '#FFFFFF',
                  boxShadow: 'var(--mac-shadow-subtle)',
                  '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' },
                }}
              >
                Configure New Rate
              </Button>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2.5, backgroundColor: '#FAFAFC', padding: '22px', borderRadius: '12px', border: '1px solid var(--mac-border-color)', mb: 3 }}>
              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                  Base Minimum Fare
                </Typography>
                <Typography sx={{ fontSize: '24px', fontWeight: 700, color: 'var(--sakay-orange)' }}>
                  ₱{activeMatrix.base_fare.toFixed(2)}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-secondary)', mt: '2px' }}>
                  Covers first {activeMatrix.base_distance_km.toFixed(1)} km
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                  Per-Kilometer Increment
                </Typography>
                <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#1565C0' }}>
                  ₱{activeMatrix.succeeding_rate.toFixed(2)}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-secondary)', mt: '2px' }}>
                  Applied after {activeMatrix.base_distance_km.toFixed(1)} km
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                  Effective Since
                </Typography>
                <Typography sx={{ fontSize: '18px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {activeMatrix.effective_date}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-secondary)', mt: '2px' }}>
                  Enforced City-Wide
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1 }}>
              <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)' }}>
                Configured By: <strong style={{ color: 'var(--mac-text-primary)' }}>{activeMatrix.configured_by_lgu_admin}</strong>
              </Typography>
              <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)' }}>
                System Version ID: {activeMatrix.fare_matrix_id}
              </Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Derived Calculations Context Card */}
        <Card
          sx={{
            borderRadius: 'var(--mac-radius-lg)',
            border: '1px solid var(--mac-border-color)',
            boxShadow: 'var(--mac-shadow-card)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <CardContent sx={{ p: '26px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <CalculateIcon sx={{ color: 'var(--sakay-orange)', fontSize: 24 }} />
              <Typography sx={{ fontSize: '18px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                Derived Metering Formulas
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)', mb: 2.5 }}>
              Standard algorithmic fare computations mandated by Calapan City Local Transport Framework:
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Formula 1: Single Seat Fare */}
              <Box sx={{ backgroundColor: '#F8F9FA', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '4px' }}>
                  1. Standard Single Seat Fare
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--sakay-orange)', fontWeight: 600 }}>
                  Seat Fare = Base Fare + (Excess Distance × Per-KM Rate)
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mt: '4px' }}>
                  {example
                    ? 'Example (4.5 km, rule in force): ₱' + activeMatrix.base_fare.toFixed(2) + ' + (' + example.excessKm.toFixed(1) + ' km × ₱' + activeMatrix.succeeding_rate.toFixed(2) + ') = ₱' + example.seatFare.toFixed(2)
                    : 'Example unavailable right now.'}
                </Typography>
              </Box>

              {/* Formula 2: Solo Trip Charter */}
              <Box sx={{ backgroundColor: '#F8F9FA', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '4px' }}>
                  2. Solo Trip (Full Unit Charter)
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: '13px', color: '#1565C0', fontWeight: 600 }}>
                  Solo Trip Fare = Seat Fare × the seats of the tricycle{example ? ' (₱' + example.soloBase.toFixed(2) + ' base)' : ''}
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mt: '4px' }}>
                  {example
                    ? 'Example (4.5 km): ₱' + example.soloFare.toFixed(2) + ' (rounded to the nearest peso). Guarantees exclusive vehicle occupancy, whatever the headcount.'
                    : 'Guarantees exclusive vehicle occupancy for the passenger party.'}
                </Typography>
              </Box>

              {/* Formula 3: Ride-Sharing Split */}
              <Box sx={{ backgroundColor: '#F8F9FA', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '4px' }}>
                  3. Ride-Sharing Proportional Split
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: '13px', color: '#2E7D32', fontWeight: 600 }}>
                  Shared Fare = the vehicle fare of the route, split per kilometre by passengers on board
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mt: '4px' }}>
                  {example
                    ? 'The vehicle fare is the Solo Trip Fare of the whole route. Example (4.5 km, two 1-passenger bookings sharing it): ₱' + example.sharedEstimate.toFixed(2) + ' each. Kilometres travelled by one booking alone are charged to that booking.'
                    : 'Kilometres travelled by one booking alone are charged to that booking.'}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* 3. Version History Table */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <HistoryIcon sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
            Fare Matrix Version History & Historical Records
          </Typography>
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
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>VERSION & ORDINANCE</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>BASE FARE</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>BASE DISTANCE</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>PER-KM INCREMENT</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>EFFECTIVE TIMEFRAME</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>STATUS</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: '13px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>ACTIONS</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fareHistory.map((version) => (
                <TableRow
                  key={version.id}
                  sx={{
                    transition: 'var(--mac-transition-fast)',
                    backgroundColor: version.is_active ? 'rgba(255, 107, 26, 0.03)' : 'transparent',
                    '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  }}
                >
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '14.5px', color: 'var(--mac-text-primary)' }}>
                      {version.id} ({version.fare_matrix_id})
                    </Typography>
                    <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: '2px' }}>
                      {version.ordinance_reference}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize: '15px', fontWeight: 700, color: 'var(--sakay-orange)', py: 2.2, px: 3 }}>
                    ₱{version.base_fare.toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ fontSize: '14px', color: 'var(--mac-text-primary)', py: 2.2, px: 3 }}>
                    {version.base_distance_km.toFixed(1)} km
                  </TableCell>
                  <TableCell sx={{ fontSize: '14px', fontWeight: 600, color: '#1565C0', py: 2.2, px: 3 }}>
                    ₱{version.succeeding_rate.toFixed(2)} / km
                  </TableCell>
                  <TableCell sx={{ fontSize: '13.5px', color: 'var(--mac-text-secondary)', py: 2.2, px: 3 }}>
                    {version.effective_date}
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <StatusBadge status={version.status === 'In force' ? 'Active' : version.status ?? 'Superseded'} />
                  </TableCell>
                  <TableCell align="right" sx={{ py: 2.2, px: 3 }}>
                    <ActionButton
                      label="Inspect"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVersion(version);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* 4. Configure New Fare Matrix Modal */}
      <MacCenterModal
        open={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        title="Configure New Fare Matrix Version"
        subtitle="Appends an immutable rate record to the municipal ledger."
        maxWidth={640}
        primaryActionLabel={saving ? 'Saving...' : 'Enact & Publish Rate'}
        primaryActionDisabled={saving}
        onPrimaryAction={handleUpdateMatrixSubmit}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setUpdateModalOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box sx={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', padding: '14px 18px', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: '13px', color: '#0369A1', lineHeight: 1.4 }}>
              <strong>Forward-only, append-only:</strong> a new version never edits or deletes an old one, and it applies only to bookings confirmed after its effective time. Bookings already confirmed keep the rate they were confirmed at. The change and your reason are written to the audit trail.
            </Typography>
          </Box>

          {formError && <Alert severity="error">{formError}</Alert>}

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              fullWidth
              label="Base Fare (PHP)"
              placeholder="15.00"
              value={newBaseFare}
              onChange={(e) => setNewBaseFare(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
            />
            <TextField
              fullWidth
              label="Base Distance Coverage (KM)"
              placeholder="2.0"
              value={newBaseDistance}
              onChange={(e) => setNewBaseDistance(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
            />
          </Box>

          <TextField
            fullWidth
            label="Succeeding Per-Kilometer Rate (PHP/KM)"
            placeholder="1.00"
            value={newSucceedingRate}
            onChange={(e) => setNewSucceedingRate(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            label="Ordinance / Resolution Legal Reference"
            placeholder="e.g. City Ordinance No. 110, Series of 2022"
            value={newOrdinance}
            onChange={(e) => setNewOrdinance(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            type="datetime-local"
            label="Effective From (Asia/Manila)"
            value={newEffectiveLocal}
            onChange={(e) => setNewEffectiveLocal(e.target.value)}
            helperText="Leave empty to take effect immediately. It cannot be in the past."
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            label="Reason for the change (audit trail)"
            placeholder="e.g. Sangguniang Panlungsod resolution adjusting the tariff"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Regulatory Notes (optional)"
            placeholder="Anything else worth keeping with this version..."
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />
        </Box>
      </MacCenterModal>

      {/* 5. Inspect Version Modal */}
      {selectedVersion && (
        <MacCenterModal
          open={Boolean(selectedVersion)}
          onClose={() => setSelectedVersion(null)}
          title={`Fare Matrix Record — ${selectedVersion.fare_matrix_id}`}
          subtitle={selectedVersion.ordinance_reference}
          badge={<StatusBadge status={selectedVersion.status === 'In force' ? 'Active' : selectedVersion.status ?? 'Superseded'} />}
          maxWidth={640}
        >
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2.5, backgroundColor: '#F5F5F7', padding: '20px', borderRadius: '12px', mb: 3 }}>
              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px' }}>Base Minimum Fare</Typography>
                <Typography sx={{ fontSize: '20px', fontWeight: 700, color: 'var(--sakay-orange)' }}>₱{selectedVersion.base_fare.toFixed(2)}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px' }}>Base Distance Covered</Typography>
                <Typography sx={{ fontSize: '18px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedVersion.base_distance_km.toFixed(1)} km</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px' }}>Succeeding Rate</Typography>
                <Typography sx={{ fontSize: '18px', fontWeight: 600, color: '#1565C0' }}>₱{selectedVersion.succeeding_rate.toFixed(2)} / km</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px' }}>Solo Trip Base (4 Seats)</Typography>
                <Typography sx={{ fontSize: '18px', fontWeight: 600, color: '#2E7D32' }}>₱{(selectedVersion.solo_base_fare ?? 0).toFixed(2)}</Typography>
              </Box>
              <Box sx={{ gridColumn: 'span 2' }}>
                <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mb: '4px' }}>Authorized Officer</Typography>
                <Typography sx={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedVersion.configured_by_lgu_admin}</Typography>
              </Box>
            </Box>

            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1.5 }}>
              Administrative Notes & Background
            </Typography>
            <Box sx={{ backgroundColor: '#FAFAFC', padding: '16px 20px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: '14px', color: 'var(--mac-text-primary)', lineHeight: 1.5 }}>
                {selectedVersion.notes || 'No supplementary notes attached to this record.'}
              </Typography>
            </Box>
          </Box>
        </MacCenterModal>
      )}
    </Box>
  );
};
