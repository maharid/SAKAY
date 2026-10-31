import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Button, TextField, Alert, CircularProgress } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { FareMatrixRecord } from '../mockData/adminData';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { CellStack, DataTableCard, FlagTag } from '../components/common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../components/common/DetailSection';
import { PageNotice } from '../components/common/PageNotice';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { fetchFareMatrices, enactFareMatrix, fetchFareExample, type FareExample } from '../services/adminApiService';
import { FONT, SPACE } from '../styles/density';
import { PAGE_BORDER, PAGE_DIVIDER, PAGE_TEXT, primaryButtonSx, rowActionSx } from '../styles/pageTheme';

// The rounded fields of the form window
const FIELD_SX = { '& .MuiOutlinedInput-root': { borderRadius: '10px' } };

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

  // The window for a new fare rule. It is shown in every state of the page, so "Configure new rate" works even when no rule is in force yet.
  const configureWindow = (
    <MacCenterModal
      open={updateModalOpen}
      onClose={() => setUpdateModalOpen(false)}
      title="Configure new fare rate"
      subtitle="Adds a new version. Earlier versions are kept as they were."
      maxWidth={512}
      primaryActionLabel={saving ? 'Saving...' : 'Enact and publish rate'}
      primaryActionDisabled={saving}
      onPrimaryAction={handleUpdateMatrixSubmit}
      secondaryActionLabel="Cancel"
      onSecondaryAction={() => setUpdateModalOpen(false)}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', padding: '11px 14px', borderRadius: '10px' }}>
          <InfoOutlinedIcon aria-hidden sx={{ fontSize: 18, color: '#0369A1', mt: '1px' }} />
          <Typography sx={{ fontSize: FONT.body, color: '#0C4A6E', lineHeight: 1.5 }}>
            <strong>New versions only.</strong> A new version never edits or deletes an old one, and it applies only to bookings confirmed after its effective time. Bookings already
            confirmed keep the rate they were confirmed at. The change and your reason are written to the audit trail.
          </Typography>
        </Box>

        {formError && <Alert severity="error" sx={{ borderRadius: '10px' }}>{formError}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.6 }}>
          <TextField fullWidth label="Base fare (PHP)" placeholder="15.00" value={newBaseFare} onChange={(e) => setNewBaseFare(e.target.value)} sx={FIELD_SX} />
          <TextField fullWidth label="Base distance (km)" placeholder="2.0" value={newBaseDistance} onChange={(e) => setNewBaseDistance(e.target.value)} sx={FIELD_SX} />
        </Box>

        <TextField fullWidth label="Rate per extra km (PHP)" placeholder="1.00" value={newSucceedingRate} onChange={(e) => setNewSucceedingRate(e.target.value)} sx={FIELD_SX} />

        <TextField
          fullWidth
          label="Ordinance or resolution"
          placeholder="e.g. City Ordinance No. 110, Series of 2022"
          value={newOrdinance}
          onChange={(e) => setNewOrdinance(e.target.value)}
          sx={FIELD_SX}
        />

        <TextField
          fullWidth
          type="datetime-local"
          label="Effective from (Manila time)"
          value={newEffectiveLocal}
          onChange={(e) => setNewEffectiveLocal(e.target.value)}
          helperText="Leave empty to take effect immediately. It cannot be in the past."
          slotProps={{ inputLabel: { shrink: true } }}
          sx={FIELD_SX}
        />

        <TextField
          fullWidth
          label="Reason for the change"
          placeholder="e.g. Sangguniang Panlungsod resolution adjusting the tariff"
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
          helperText="Written to the audit trail. At least 5 characters."
          sx={FIELD_SX}
        />

        <TextField
          fullWidth
          multiline
          rows={3}
          label="Notes (optional)"
          placeholder="Anything else worth keeping with this version..."
          value={newNotes}
          onChange={(e) => setNewNotes(e.target.value)}
          sx={FIELD_SX}
        />
      </Box>
    </MacCenterModal>
  );

  if (isLoading) {
    return (
      <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', py: '48px' }}>
          <CircularProgress size={21} sx={{ color: 'var(--sakay-orange)' }} />
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Loading the fare rules...</Typography>
        </Box>
      </Box>
    );
  }

  if (loadError || !activeMatrix) {
    return (
      <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
        <PageNotice
          tone="danger"
          title={loadError ? 'The fare rules could not be loaded' : 'No fare rule is in force'}
          action={
            loadError ? (
              <Button onClick={loadHistory} sx={rowActionSx('neutral')}>
                Try again
              </Button>
            ) : (
              <Button onClick={openConfigureModal} variant="contained" sx={primaryButtonSx}>
                Configure new rate
              </Button>
            )
          }
        >
          {loadError ? loadError.replace(/^ERR_[A-Z_]+:\s*/, '') : 'Enact a fare rule to allow bookings.'}
        </PageNotice>
        {configureWindow}
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. The rule in force (its figures, then who set it and since when), and how a fare is worked out from it */}
      <Box sx={{ containerType: 'inline-size', mb: SPACE.section }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: SPACE.gapLarge,
            alignItems: 'start',
            '@container (min-width: 900px)': { gridTemplateColumns: 'minmax(0, 6fr) minmax(0, 6fr)' },
          }}
        >
          <DashboardCard
            title="Current fare rule"
            description={activeMatrix.ordinance_reference}
            titleAdornment={<FlagTag label="In force" tone="success" />}
            actions={
              <Button onClick={openConfigureModal} variant="contained" startIcon={<EditNoteIcon sx={{ fontSize: 16 }} />} sx={primaryButtonSx}>
                Configure new rate
              </Button>
            }
          >
            {/* the figures that make a fare, in one row */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
                border: `1px solid ${PAGE_BORDER}`,
                borderRadius: '10px',
                overflow: 'hidden',
                backgroundColor: '#FAFAF8',
              }}
            >
              <FigureBlock label="Base fare" value={`₱${activeMatrix.base_fare.toFixed(2)}`} note={`First ${activeMatrix.base_distance_km.toFixed(1)} km`} />
              <FigureBlock label="Rate per extra km" value={`₱${activeMatrix.succeeding_rate.toFixed(2)}`} note={`After ${activeMatrix.base_distance_km.toFixed(1)} km`} />
              <FigureBlock label="Solo trip base" value={`₱${(activeMatrix.solo_base_fare ?? 0).toFixed(2)}`} note="The whole 4-seat tricycle" />
              <FigureBlock label="Version" value={`V${versionNumber(activeMatrix)}`} note={`of ${fareHistory.length} kept`} />
            </Box>
            <Box component="dl" sx={{ m: 0, mt: '14px', display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '10px 20px' }}>
              <FactLine label="In force since">{activeMatrix.effective_date}</FactLine>
              <FactLine label="Applies to">The whole city</FactLine>
              <FactLine label="Set by">{activeMatrix.configured_by_lgu_admin}</FactLine>
              <FactLine label="Rule ID">{activeMatrix.fare_matrix_id}</FactLine>
            </Box>
          </DashboardCard>

          <DashboardCard title="How a fare is worked out" description="Fares follow the Calapan City transport rules. The examples are calculated by the system from the rule in force.">
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: `1px solid ${PAGE_DIVIDER}` } }}>
              <FormulaItem
                title="1. Seat fare"
                formula="Seat fare = Base fare + (Extra distance × Rate per km)"
                example={
                  example
                    ? 'Example (4.5 km, rule in force): ₱' + activeMatrix.base_fare.toFixed(2) + ' + (' + example.excessKm.toFixed(1) + ' km × ₱' + activeMatrix.succeeding_rate.toFixed(2) + ') = ₱' + example.seatFare.toFixed(2)
                    : 'Example unavailable right now.'
                }
              />
              <FormulaItem
                title="2. Solo trip (the whole tricycle)"
                formula={'Solo trip fare = Seat fare × the seats of the tricycle' + (example ? ' (₱' + example.soloBase.toFixed(2) + ' base)' : '')}
                example={
                  example
                    ? 'Example (4.5 km): ₱' + example.soloFare.toFixed(2) + ' (rounded to the nearest peso). The passenger has the vehicle to themselves, whatever the headcount.'
                    : 'The passenger has the vehicle to themselves.'
                }
              />
              <FormulaItem
                title="3. Shared ride"
                formula="Shared fare = the vehicle fare of the route, split per kilometre by the passengers on board"
                example={
                  example
                    ? 'The vehicle fare is the Solo trip fare of the whole route. Example (4.5 km, two 1-passenger bookings sharing it): ₱' + example.sharedEstimate.toFixed(2) + ' each. Kilometres travelled by one booking alone are charged to that booking.'
                    : 'Kilometres travelled by one booking alone are charged to that booking.'
                }
              />
            </Box>
          </DashboardCard>
        </Box>
      </Box>

      {/* 3. Every version of the rule */}
      <Box sx={{ mb: '10px' }}>
        <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>Fare history</Typography>
        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '2px' }}>Every version is kept. A new version never changes an old one.</Typography>
      </Box>
      <DataTableCard
        label="Fare history"
        minWidth={860}
        columns={[
          { label: 'Version and ordinance' },
          { label: 'Base fare' },
          { label: 'Base distance' },
          { label: 'Rate per km' },
          { label: 'Effective' },
          { label: 'Status' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {fareHistory.map((version) => (
            <TableRow key={version.id} sx={version.is_active ? { backgroundColor: 'rgba(255, 102, 0, 0.04)' } : undefined}>
              <TableCell sx={{ maxWidth: 320 }}>
                <CellStack primary={`${version.id} (${version.fare_matrix_id})`} secondary={version.ordinance_reference} />
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>₱{version.base_fare.toFixed(2)}</TableCell>
              <TableCell>{version.base_distance_km.toFixed(1)} km</TableCell>
              <TableCell>₱{version.succeeding_rate.toFixed(2)} / km</TableCell>
              <TableCell sx={{ color: PAGE_TEXT.secondary }}>{version.effective_date}</TableCell>
              <TableCell>
                <StatusBadge status={version.status === 'In force' ? 'Active' : version.status ?? 'Superseded'} />
              </TableCell>
              <TableCell align="right">
                <Button aria-label={`Inspect fare record ${version.id}`} onClick={() => setSelectedVersion(version)} sx={rowActionSx('neutral')}>
                  Inspect
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTableCard>

      {/* 4. Configure a new fare rule */}
      {configureWindow}

      {/* 5. One version in detail */}
      {selectedVersion && (
        <MacCenterModal
          open={Boolean(selectedVersion)}
          onClose={() => setSelectedVersion(null)}
          title={`Fare record ${selectedVersion.fare_matrix_id}`}
          subtitle={selectedVersion.ordinance_reference}
          badge={<StatusBadge status={selectedVersion.status === 'In force' ? 'Active' : selectedVersion.status ?? 'Superseded'} />}
          maxWidth={512}
        >
          <DetailSection title="Rates">
            <DetailGrid>
              <DetailField label="Base fare">{`₱${selectedVersion.base_fare.toFixed(2)}`}</DetailField>
              <DetailField label="Base distance covered">{`${selectedVersion.base_distance_km.toFixed(1)} km`}</DetailField>
              <DetailField label="Rate per extra km">{`₱${selectedVersion.succeeding_rate.toFixed(2)} / km`}</DetailField>
              <DetailField label="Solo trip base (4 seats)">{`₱${(selectedVersion.solo_base_fare ?? 0).toFixed(2)}`}</DetailField>
              <DetailField label="Set by">{selectedVersion.configured_by_lgu_admin}</DetailField>
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Notes">
            <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                {selectedVersion.notes || 'No notes were attached to this record.'}
              </Typography>
            </Box>
          </DetailSection>
        </MacCenterModal>
      )}
    </Box>
  );
};

// One of the figures of the rule in force: the label, the amount and what it covers
const FigureBlock: React.FC<{ label: string; value: string; note: string }> = ({ label, value, note }) => (
  <Box sx={{ p: '12px 14px', borderRight: `1px solid ${PAGE_DIVIDER}`, '&:last-of-type': { borderRight: 'none' }, minWidth: 0 }}>
    <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>{label}</Typography>
    <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: PAGE_TEXT.primary, lineHeight: 1.2, mt: '2px' }}>{value}</Typography>
    <Typography sx={{ fontSize: FONT.caption, color: PAGE_TEXT.secondary, mt: '2px', lineHeight: 1.35 }}>{note}</Typography>
  </Box>
);

// One fact about the rule: a label and its value
const FactLine: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, mt: '1px', fontSize: FONT.body, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);

interface FormulaItemProps {
  title: string;
  formula: string;
  example: string;
}

// One way of working out a fare: its name, the formula, and the example for the rule in force
const FormulaItem: React.FC<FormulaItemProps> = ({ title, formula, example }) => (
  <Box component="li" sx={{ py: '12px', '&:first-of-type': { pt: 0 }, '&:last-of-type': { pb: 0 } }}>
    <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>{title}</Typography>
    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.brand, mt: '3px', lineHeight: 1.45 }}>{formula}</Typography>
    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '3px', lineHeight: 1.5 }}>{example}</Typography>
  </Box>
);
