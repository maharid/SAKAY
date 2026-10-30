import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TableBody,
  TableCell,
  TableRow,
  Pagination,
  Button,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import L from 'leaflet';
import { calculateDistanceKm } from '@sakay/shared';

import { AccreditedTodaRecord, DriverRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { DataTableCard, DataTableMessageRow, PersonCell } from '../common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../common/DetailSection';
import { PageNotice } from '../common/PageNotice';
import { DriverDetailModal } from './DriverDetailModal';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { TodaAccreditationDialog } from './TodaAccreditationDialog';
import { fetchTodaRosterSummary, fetchTodaDrivers, approveTerminalRelocation, rejectTerminalRelocation, approveTodaApplication, suspendTodaAccreditation, reinstateTodaAccreditation, sendTodaRenewalReminder } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, dangerOutlineButtonSx, primaryButtonSx, rowActionSx, secondaryButtonSx } from '../../styles/pageTheme';

/** "Nov 3, 2026" in Manila time (a suspension ends at the close of a Manila day) */
const formatDay = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
/** the first and last day an end date may be picked (YYYY-MM-DD, Manila): tomorrow, and one year from today */
const manilaDayFromNow = (days: number): string => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const tomorrowManila = (): string => manilaDayFromNow(1);
const oneYearManila = (): string => manilaDayFromNow(365);

interface TodaDetailModalProps {
  open: boolean;
  onClose: () => void;
  toda: AccreditedTodaRecord | null;
  /** the accreditation was renewed or suspended: the directory reloads */
  onChanged?: () => void | Promise<void>;
}

export const TodaDetailModal: React.FC<TodaDetailModalProps> = ({ open, onClose, toda, onChanged }) => {
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const [isRelocationLoading, setIsRelocationLoading] = useState(false);
  const [relocationFeedback, setRelocationFeedback] = useState<string | null>(null);
  // the LGU decides a terminal move in its own words (decision D-P4): the dialog asks for them
  const [relocationDecision, setRelocationDecision] = useState<'approve' | 'reject' | null>(null);
  // "20 at registration, 22 now" (decision D-P9): the roster file the TODA registered with next to what its Master Roster holds today
  const [rosterSummary, setRosterSummary] = useState<Awaited<ReturnType<typeof fetchTodaRosterSummary>>>(null);
  useEffect(() => {
    if (!open || !toda) return;
    let stopped = false;
    setRosterSummary(null);
    void fetchTodaRosterSummary(toda.id).then((r) => { if (!stopped) setRosterSummary(r); });
    return () => { stopped = true; };
  }, [open, toda?.id]);
  // the accreditation controls (Rules 2.4, 24.3)
  const [renewOpen, setRenewOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reinstateOpen, setReinstateOpen] = useState(false);
  const [accreditationFeedback, setAccreditationFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Real affiliated drivers fetched from database
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState<boolean>(true);

  // Selected driver inside TODA roster modal for inspecting driver details
  const [selectedDriver, setSelectedDriver] = useState<DriverRecord | null>(null);

  // Selected document for official records preview
  const [selectedDoc, setSelectedDoc] = useState<{ name: string; type: string; url?: string | null } | null>(null);

  // Map Ref for Leaflet
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);

  // Fetch real drivers affiliated with this TODA
  useEffect(() => {
    if (!toda || !open) return;

    setIsLoadingDrivers(true);
    fetchTodaDrivers(toda.id)
      .then((data) => {
        setDrivers(data);
      })
      .catch((err) => {
        console.error('[TodaDetailModal] Error loading toda drivers:', err);
      })
      .finally(() => {
        setIsLoadingDrivers(false);
      });
  }, [toda, open]);

  // Initialize map when modal is open
  useEffect(() => {
    if (!toda || !mapRef.current || !open) return;

    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    const lat = toda.centerLat || 13.4115;
    const lng = toda.centerLng || 121.1803;

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    // Draw service zone circle
    L.circle([lat, lng], {
      color: '#FF5500',
      fillColor: '#FF5500',
      fillOpacity: 0.15,
      radius: 600,
    }).addTo(map);

    // Custom TODA Marker
    const customIcon = L.divIcon({
      className: 'custom-toda-marker',
      html: '🏛️',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    L.marker([lat, lng], { icon: customIcon })
      .addTo(map)
      .bindPopup(`<b>${toda.name}</b><br/>${toda.barangay}`);

    // Panel comment (D-P4): when the TODA asked to move the terminal, the requested place is on the same map, joined to the current one, so the LGU sees the move
    if (toda.pendingTerminalLat != null && toda.pendingTerminalLng != null) {
      const pLat = Number(toda.pendingTerminalLat);
      const pLng = Number(toda.pendingTerminalLng);
      L.polyline([[lat, lng], [pLat, pLng]], { color: '#B45309', weight: 3, dashArray: '6 6' }).addTo(map);
      L.marker([pLat, pLng], { icon: L.divIcon({ className: 'custom-toda-marker', html: '\u{1F4CD}', iconSize: [32, 32], iconAnchor: [16, 28] }) })
        .addTo(map)
        .bindPopup(`<b>Requested terminal</b><br/>${toda.pendingTerminalLocation || ''}`);
      map.fitBounds([[lat, lng], [pLat, pLng]], { padding: [48, 48], maxZoom: 16 });
    }

    leafletMapRef.current = map;

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [toda, open]);

  if (!toda) return null;

  // Pagination calculation
  const totalDrivers = drivers.length;
  const totalPages = Math.ceil(Math.max(1, totalDrivers) / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, totalDrivers);
  const currentPageDrivers = drivers.slice(startIndex, endIndex);

  // The files this TODA actually uploaded at registration (nothing is listed that is not on file)
  const officialDocs = toda.documents ?? [];

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={onClose}
        title={toda.name}
        subtitle={`Permit no. ${toda.accreditationNo} · ${toda.barangay}`}
        badge={<StatusBadge status={toda.status as any} />}
        maxWidth={736}
      >
        {/* A suspended TODA (decision D-P5): its drivers cannot go Online or take trips until the LGU reinstates it or the end date arrives */}
        {toda.status === 'Suspended' && (
          <PageNotice
            tone="danger"
            title="This TODA is suspended"
            action={
              <Button variant="contained" onClick={() => setReinstateOpen(true)} sx={primaryButtonSx}>
                Reinstate TODA
              </Button>
            }
          >
            Its drivers are Offline and cannot go Online, be offered a booking or accept one{toda.suspendedUntil ? `, until ${formatDay(toda.suspendedUntil)}` : ', until you reinstate the TODA'}.
            A driver who was on a trip finished it. <b>Reason:</b> {toda.suspensionReason || 'not recorded'}
            {toda.suspendedAt ? ` (suspended ${formatDay(toda.suspendedAt)})` : ''}.
          </PageNotice>
        )}

        {/* Terminal Relocation Request Banner (Rule 2.2): the requested place is on the map below; the LGU decides in its own words (D-P4) */}
        {(toda.terminalRelocationStatus === 'Pending LGU Re-approval' || toda.pendingTerminalLat) && (
          <PageNotice
            tone="warning"
            title="Terminal move waiting for your approval"
            action={
              <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button disabled={isRelocationLoading} onClick={() => setRelocationDecision('reject')} sx={rowActionSx('danger')}>
                  Reject move
                </Button>
                <Button variant="contained" disabled={isRelocationLoading} onClick={() => setRelocationDecision('approve')} sx={primaryButtonSx}>
                  Approve move
                </Button>
              </Box>
            }
          >
            Requested terminal: {toda.pendingTerminalLocation || 'New terminal location'} ({toda.pendingTerminalLat}, {toda.pendingTerminalLng}),{' '}
            {toda.pendingTerminalLat != null && toda.pendingTerminalLng != null
              ? `${Math.round(calculateDistanceKm(Number(toda.centerLat), Number(toda.centerLng), Number(toda.pendingTerminalLat), Number(toda.pendingTerminalLng)) * 1000)} m from`
              : 'from'} the current terminal ({toda.centerLat}, {toda.centerLng}). The map shows both: the dashed line is the move. The current terminal stays in force until you approve.
            {toda.pendingTerminalReason && (
              <Box component="span" sx={{ display: 'block', mt: '4px' }}>
                <b>The TODA's reason:</b> {toda.pendingTerminalReason}
              </Box>
            )}
            {relocationFeedback && (
              <Box component="span" sx={{ display: 'block', fontWeight: 700, color: PAGE_TEXT.warning, mt: '4px' }}>
                {relocationFeedback}
              </Box>
            )}
          </PageNotice>
        )}

        {/* Accreditation controls: record the renewal of the Barangay Clearance, remind the TODA, or suspend the accreditation after review */}
        {rosterSummary && (
          <DetailSection title="Master Roster">
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.6 }}>
              <b>{rosterSummary.from_registration_file}</b> member{rosterSummary.from_registration_file === 1 ? '' : 's'} came from the roster file the TODA registered with
              {rosterSummary.registration_file ? ` (${rosterSummary.registration_file.file_name})` : ''}, which is kept as submitted. Its Master Roster today holds{' '}
              <b>{rosterSummary.active}</b> active member{rosterSummary.active === 1 ? '' : 's'}: {rosterSummary.added_later} added since, {rosterSummary.left} no longer a member.
              {rosterSummary.versions.filter((v) => v.kind === 'update').length > 0
                ? ` ${rosterSummary.versions.filter((v) => v.kind === 'update').length} newer roster file version${rosterSummary.versions.filter((v) => v.kind === 'update').length === 1 ? '' : 's'} submitted (latest ${new Date(rosterSummary.versions.filter((v) => v.kind === 'update')[0].uploaded_at).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}).`
                : ''}
            </Typography>
          </DetailSection>
        )}

        <DetailSection title="Accreditation">
          <Box sx={{ backgroundColor: '#FAFAF8', border: `1px solid ${PAGE_BORDER}`, borderRadius: '12px', padding: '14px 16px' }}>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5 }}>
              Clearance valid until <b>{toda.barangayClearanceExpiry}</b> ({toda.clearanceStatus}). After it passes, every driver of this TODA is blocked from going Online until a renewal is recorded.
            </Typography>
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mt: '12px' }}>
              <Button
                onClick={async () => {
                  const problem = await sendTodaRenewalReminder(toda.id);
                  setAccreditationFeedback(problem ? { ok: false, text: problem } : { ok: true, text: 'The reminder was sent to the TODA administrators.' });
                }}
                sx={secondaryButtonSx}
              >
                Send renewal reminder
              </Button>
              <Button variant="contained" onClick={() => setRenewOpen(true)} sx={primaryButtonSx}>
                Record renewal
              </Button>
              {toda.status === 'Suspended' ? (
                <Button variant="contained" onClick={() => setReinstateOpen(true)} sx={primaryButtonSx}>
                  Reinstate TODA
                </Button>
              ) : (
                <Button onClick={() => setSuspendOpen(true)} sx={dangerOutlineButtonSx}>
                  Suspend TODA
                </Button>
              )}
            </Box>
            {toda.renewalSubmittedAt && (
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.warning, mt: '12px', backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px', p: '8px 12px', lineHeight: 1.5 }}>
                The TODA sent a renewed Barangay Clearance on {new Date(toda.renewalSubmittedAt).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}
                {toda.declaredClearanceValidUntil ? `, stating it is valid until ${toda.declaredClearanceValidUntil}` : ''}. Open it with View, then press Record renewal and enter the certificate number and the date you read on it.
              </Typography>
            )}
            {accreditationFeedback && (
              <Typography role="status" sx={{ fontSize: FONT.body, fontWeight: 600, color: accreditationFeedback.ok ? PAGE_TEXT.success : PAGE_TEXT.danger, mt: '8px' }}>
                {accreditationFeedback.text}
              </Typography>
            )}
          </Box>
        </DetailSection>

        {/* TODA details */}
        <DetailSection title="TODA details">
          <DetailGrid>
            <DetailField label="Representative">{toda.representative}</DetailField>
            <DetailField label="Contact number">{toda.phone}</DetailField>
            <DetailField label="Email address">{toda.email || 'N/A'}</DetailField>
            <DetailField label="Service area">{toda.serviceZone || toda.barangay}</DetailField>
            <DetailField label="Registered drivers">
              <Box component="span" sx={{ color: PAGE_TEXT.brand }}>{toda.registeredDrivers} {toda.registeredDrivers === 1 ? 'driver' : 'drivers'}</Box>
            </DetailField>
            <DetailField label="Accreditation expires">{toda.expiryDate}</DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Service zone and boundary map */}
        <DetailSection title="Service zone and boundary">
          <Box
            sx={{
              width: '100%',
              height: 210,
              borderRadius: '12px',
              overflow: 'hidden',
              border: `1px solid ${PAGE_BORDER}`,
              position: 'relative',
            }}
          >
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </Box>
        </DetailSection>

        {/* Official records and permits */}
        <DetailSection title="Registration and accreditation documents" note={`${officialDocs.length} ${officialDocs.length === 1 ? 'file' : 'files'}`}>
          {officialDocs.length === 0 && (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, py: 0.8 }}>
              No registration documents are on file for this TODA.
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {officialDocs.map((doc, idx) => (
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
                  <DescriptionIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 20 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>
                      {doc.name}
                    </Typography>
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px' }}>
                      {doc.type} · Submitted {doc.date}
                    </Typography>
                  </Box>
                </Box>
                <Button
                  aria-label={`View ${doc.name}`}
                  onClick={() => setSelectedDoc({ name: doc.name, type: doc.type, url: doc.url })}
                  sx={rowActionSx('brand')}
                >
                  View
                </Button>
              </Box>
            ))}
          </Box>
        </DetailSection>

        {/* Affiliated driver roster */}
        <DetailSection title="Affiliated drivers" note={totalDrivers > 0 ? `Showing ${startIndex + 1}–${endIndex} of ${totalDrivers}` : `${totalDrivers} drivers`}>
          <DataTableCard
            label="Affiliated drivers"
            minWidth={620}
            stackBelow={560}
            columns={[{ label: 'Driver' }, { label: 'Plate' }, { label: 'Online' }, { label: 'Verification' }, { label: 'Account' }, { label: 'Action', align: 'right' }]}
          >
            <TableBody>
              {isLoadingDrivers ? (
                <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading drivers..." />
              ) : currentPageDrivers.length > 0 ? (
                currentPageDrivers.map((drv) => (
                  <TableRow key={drv.id} onClick={() => setSelectedDriver(drv)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <PersonCell name={drv.name} />
                    </TableCell>
                    <TableCell sx={{ color: PAGE_TEXT.secondary }}>{drv.vehiclePlate}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: drv.onlineStatus === 'Online' ? '#34A853' : '#9AA0A6' }} />
                        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>{drv.onlineStatus}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={drv.verificationStatus as any} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={drv.accountStatus as any} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        aria-label={`Review driver ${drv.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDriver(drv);
                        }}
                        sx={rowActionSx('neutral')}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <DataTableMessageRow colSpan={6} kind="empty" title="No drivers yet" hint="No registered drivers are affiliated with this TODA." />
              )}
            </TableBody>
          </DataTableCard>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, val) => setPage(val)}
                size="small"
                sx={{
                  '& .Mui-selected': {
                    backgroundColor: '#C75000 !important',
                    color: '#FFFFFF',
                  },
                }}
              />
            </Box>
          )}
        </DetailSection>
      </MacCenterModal>


      {/* Renewal: the Administrator types the certificate number and the new valid-until date (Rule 24.3) */}
      <TodaAccreditationDialog
        open={renewOpen}
        mode="renew"
        todaName={toda.name}
        hasClearance={toda.hasBarangayClearance !== false}
        currentCertificateNumber={toda.certificateNumber}
        declaredValidUntil={toda.declaredClearanceValidUntil}
        onClose={() => setRenewOpen(false)}
        onSubmit={async (certificateNumber, validUntilIso, remarks) => {
          await approveTodaApplication(toda.id, remarks ? `Renewal. ${remarks}` : 'Renewal of the Barangay Clearance.', certificateNumber, validUntilIso);
          setRenewOpen(false);
          await onChanged?.();
          onClose();
        }}
      />

      {/* Suspension after review (Rule 2.4): the reason is required and goes to the audit log */}
      <MacConfirmDialog
        open={relocationDecision !== null}
        onClose={() => setRelocationDecision(null)}
        title={relocationDecision === 'approve' ? 'Approve the terminal move?' : 'Reject the terminal move?'}
        message={relocationDecision === 'approve'
          ? `The terminal of "${toda.name}" becomes ${toda.pendingTerminalLocation || 'the requested place'} (${toda.pendingTerminalLat}, ${toda.pendingTerminalLng}). Dispatch uses it from now on.`
          : `The terminal of "${toda.name}" stays where it is. The TODA reads your reason.`}
        confirmLabel={relocationDecision === 'approve' ? 'Approve the move' : 'Reject the move'}
        confirmVariant={relocationDecision === 'approve' ? 'orange' : 'danger'}
        requireReason
        minReasonLength={10}
        reasonPlaceholder={relocationDecision === 'approve' ? 'Why is the move approved? (at least 10 characters)' : 'Why is the move rejected? (at least 10 characters)'}
        onConfirm={async (reason) => {
          const decision = relocationDecision;
          setRelocationDecision(null);
          setIsRelocationLoading(true);
          try {
            if (decision === 'approve') {
              await approveTerminalRelocation(toda.id, reason ?? '');
              setRelocationFeedback('Terminal relocation approved and activated.');
            } else {
              await rejectTerminalRelocation(toda.id, reason ?? '');
              setRelocationFeedback('Relocation rejected.');
            }
            await onChanged?.();
          } catch (e) {
            setRelocationFeedback(`Error: ${e instanceof Error ? e.message : 'the decision was not saved.'}`);
          } finally {
            setIsRelocationLoading(false);
          }
        }}
      />

      <MacConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Suspend this TODA?"
        message={`Every driver of "${toda.name}" goes Offline now and cannot go Online or take trips while it is suspended (a driver on a trip finishes it first). Their unanswered offers move to other drivers. The TODA and its drivers read your reason.`}
        confirmLabel="Suspend TODA"
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="Why is the TODA suspended? (at least 10 characters)"
        dateField={{ label: 'Suspended until', hint: 'Leave empty to suspend until you reinstate the TODA. With a date, it ends by itself at the close of that day.', min: tomorrowManila(), max: oneYearManila() }}
        onConfirm={async (reason, _option, endDate) => {
          setSuspendOpen(false);
          try {
            const done = await suspendTodaAccreditation(toda.id, reason ?? '', endDate || null);
            setAccreditationFeedback({
              ok: true,
              text: `Suspended. ${done.driversSetOffline} driver${done.driversSetOffline === 1 ? '' : 's'} put Offline, ${done.driversFinishingTrip} finishing a trip first, ${done.offersWithdrawn} unanswered offer${done.offersWithdrawn === 1 ? '' : 's'} moved on to other drivers.`,
            });
            await onChanged?.();
          } catch (err) {
            setAccreditationFeedback({ ok: false, text: err instanceof Error ? err.message : 'The TODA was not suspended.' });
          }
        }}
      />

      <MacConfirmDialog
        open={reinstateOpen}
        onClose={() => setReinstateOpen(false)}
        title="Reinstate this TODA?"
        message={`"${toda.name}" is Active again and its drivers can go Online at once. The TODA and its drivers read your reason.`}
        confirmLabel="Reinstate TODA"
        confirmVariant="orange"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="Why is the suspension lifted? (at least 10 characters)"
        onConfirm={async (reason) => {
          setReinstateOpen(false);
          try {
            await reinstateTodaAccreditation(toda.id, reason ?? '');
            setAccreditationFeedback({ ok: true, text: 'The TODA is reinstated. Its drivers were told.' });
            await onChanged?.();
          } catch (err) {
            setAccreditationFeedback({ ok: false, text: err instanceof Error ? err.message : 'The TODA was not reinstated.' });
          }
        }}
      />

      {/* Driver Detail Inspection Modal */}
      {selectedDriver && (
        <DriverDetailModal
          open={Boolean(selectedDriver)}
          onClose={() => setSelectedDriver(null)}
          driver={selectedDriver}
        />
      )}

      {/* Document Inspection Popover */}
      {selectedDoc && (
        <DocumentPreviewModal
          open={Boolean(selectedDoc)}
          onClose={() => setSelectedDoc(null)}
          documentName={selectedDoc.name}
          documentType={selectedDoc.type}
          url={selectedDoc.url}
        />
      )}
    </>
  );
};
