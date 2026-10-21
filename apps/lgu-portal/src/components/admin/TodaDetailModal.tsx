import React, { useState, useEffect, useRef } from 'react';
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
  Avatar,
  Pagination,
  CircularProgress,
  Button,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import PeopleIcon from '@mui/icons-material/People';
import DescriptionIcon from '@mui/icons-material/Description';
import L from 'leaflet';

import { AccreditedTodaRecord, DriverRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { ActionButton } from './ActionButton';
import { DriverDetailModal } from './DriverDetailModal';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { TodaAccreditationDialog } from './TodaAccreditationDialog';
import { fetchTodaDrivers, approveTerminalRelocation, rejectTerminalRelocation, approveTodaApplication, suspendTodaAccreditation, sendTodaRenewalReminder } from '../../services/adminApiService';

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
  // the accreditation controls (Rules 2.4, 24.3)
  const [renewOpen, setRenewOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
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
        subtitle={`Permit: ${toda.accreditationNo} • ${toda.barangay}`}
        badge={<StatusBadge status={toda.status as any} />}
        maxWidth={920}
      >
        {/* Terminal Relocation Request Banner (Rule 2.2) */}
        {(toda.terminalRelocationStatus === 'Pending LGU Re-approval' || toda.pendingTerminalLat) && (
          <Box sx={{ mb: 3.5, backgroundColor: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: '12px', padding: '18px 24px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: '#9A3412', mb: 0.5 }}>
                  Terminal Relocation Request (Pending LGU Re-approval)
                </Typography>
                <Typography sx={{ fontSize: '12.5px', color: '#C2410C' }}>
                  Requested Terminal: {toda.pendingTerminalLocation || 'New Terminal Location'} ({toda.pendingTerminalLat}, {toda.pendingTerminalLng})
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mt: 0.5 }}>
                  Active coordinates remain: ({toda.centerLat}, {toda.centerLng}) until approved.
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={isRelocationLoading}
                  onClick={async () => {
                    setIsRelocationLoading(true);
                    try {
                      await rejectTerminalRelocation(toda.id, 'Relocation request does not meet municipal zoning ordinances');
                      setRelocationFeedback('Relocation rejected.');
                    } catch (e: any) {
                      setRelocationFeedback(`Error: ${e.message}`);
                    } finally {
                      setIsRelocationLoading(false);
                    }
                  }}
                  sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
                >
                  Reject Relocation
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  disabled={isRelocationLoading}
                  onClick={async () => {
                    setIsRelocationLoading(true);
                    try {
                      await approveTerminalRelocation(toda.id, 'Approved by LGU Transport Board');
                      setRelocationFeedback('Terminal relocation approved and activated.');
                    } catch (e: any) {
                      setRelocationFeedback(`Error: ${e.message}`);
                    } finally {
                      setIsRelocationLoading(false);
                    }
                  }}
                  sx={{ backgroundColor: '#1E8E3E', '&:hover': { backgroundColor: '#137333' }, textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
                >
                  Approve Relocation
                </Button>
              </Box>
            </Box>
            {relocationFeedback && (
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#9A3412', mt: 1 }}>
                {relocationFeedback}
              </Typography>
            )}
          </Box>
        )}

        {/* Accreditation controls: record the renewal of the Barangay Clearance, remind the TODA, or suspend the accreditation after review */}
        <Box sx={{ mb: 3.5, backgroundColor: '#F8FAFC', border: '1px solid var(--mac-border-color)', borderRadius: '12px', padding: '16px 20px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: '12.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Accreditation Controls
              </Typography>
              <Typography sx={{ fontSize: '12.5px', color: 'var(--mac-text-secondary)', mt: 0.5 }}>
                Clearance valid until <b>{toda.barangayClearanceExpiry}</b> ({toda.clearanceStatus}). After it passes, every driver of this TODA is blocked from going Online until a renewal is recorded.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" onClick={async () => {
                const problem = await sendTodaRenewalReminder(toda.id);
                setAccreditationFeedback(problem ? { ok: false, text: problem } : { ok: true, text: 'The reminder was sent to the TODA administrators.' });
              }} sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}>
                Send Renewal Reminder
              </Button>
              <Button size="small" variant="contained" onClick={() => setRenewOpen(true)} sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600, backgroundColor: 'var(--sakay-orange)', boxShadow: 'none', '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' } }}>
                Record Renewal
              </Button>
              <Button size="small" variant="outlined" color="error" onClick={() => setSuspendOpen(true)} sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}>
                Suspend Accreditation
              </Button>
            </Box>
          </Box>
          {toda.renewalSubmittedAt && (
            <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#9A3412', mt: 1.5, backgroundColor: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: '8px', p: '8px 12px' }}>
              The TODA sent a renewed Barangay Clearance on {new Date(toda.renewalSubmittedAt).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}
              {toda.declaredClearanceValidUntil ? `, stating it is valid until ${toda.declaredClearanceValidUntil}` : ''}. Open it with View Document, then press Record Renewal and enter the certificate number and the date you read on it.
            </Typography>
          )}
          {accreditationFeedback && (
            <Typography sx={{ fontSize: '12px', fontWeight: 600, color: accreditationFeedback.ok ? '#1E8E3E' : '#B91C1C', mt: 1 }}>
              {accreditationFeedback.text}
            </Typography>
          )}
        </Box>

        {/* Section 1: TODA Information Grid */}
        <Box sx={{ mb: 3.5 }}>
          <Typography sx={{ fontSize: '12.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1.5, letterSpacing: '0.3px' }}>
            1. TODA Accreditation & Contact Information
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, backgroundColor: '#F5F5F7', padding: '18px', borderRadius: '12px' }}>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Representative</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{toda.representative}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Contact Number</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{toda.phone}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Email Address</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{toda.email || 'N/A'}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Service Coverage Area</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{toda.serviceZone || toda.barangay}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Registered Drivers</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--sakay-orange)' }}>{toda.registeredDrivers} Drivers</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '13.6px', color: 'var(--mac-text-muted)' }}>Accreditation Expiry</Typography>
              <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>{toda.expiryDate}</Typography>
            </Box>
          </Box>
        </Box>

        {/* Section 2: Service Zone & Boundary Map */}
        <Box sx={{ mb: 3.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <MapIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
            <Typography sx={{ fontSize: '12.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              2. Service Zone & Operational Boundary
            </Typography>
          </Box>

          <Box
            sx={{
              width: '100%',
              height: 210,
              borderRadius: '12px',
              overflow: 'hidden',
              border: '1px solid var(--mac-border-color)',
              position: 'relative',
              boxShadow: 'var(--mac-shadow-subtle)',
            }}
          >
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </Box>
        </Box>

        {/* Section 3: Official Records & Permits */}
        <Box sx={{ mb: 3.5 }}>
          <Typography sx={{ fontSize: '12.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1.5, letterSpacing: '0.3px' }}>
            3. Registration & Accreditation Documents ({officialDocs.length})
          </Typography>

          {officialDocs.length === 0 && (
            <Typography sx={{ fontSize: '13px', color: 'var(--mac-text-muted)', py: 1 }}>
              No registration documents are on file for this TODA.
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {officialDocs.map((doc, idx) => (
              <Box
                key={idx}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  border: '1px solid var(--mac-border-color)',
                  backgroundColor: '#FFFFFF',
                  boxShadow: 'var(--mac-shadow-subtle)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <DescriptionIcon sx={{ color: 'var(--sakay-orange)', fontSize: '19.3' }} />
                  <Box>
                    <Typography sx={{ fontSize: '13.6px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                      {doc.name}
                    </Typography>
                    <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', mt: '2px' }}>
                      {doc.type} • Submitted {doc.date}
                    </Typography>
                  </Box>
                </Box>
                <ActionButton
                  label="View Document"
                  showArrow={false}
                  onClick={() => setSelectedDoc({ name: doc.name, type: doc.type, url: doc.url })}
                  sx={{ height: 34, fontSize: '12.4px' }}
                />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Section 4: Affiliated Driver Roster Table */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PeopleIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />
              <Typography sx={{ fontSize: '12.4px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                4. Affiliated Tricycle Drivers ({totalDrivers})
              </Typography>
            </Box>
            {totalDrivers > 0 && (
              <Typography sx={{ fontSize: '12.4px', color: 'var(--mac-text-muted)', fontWeight: 500 }}>
                Showing {startIndex + 1}–{endIndex} of {totalDrivers} drivers
              </Typography>
            )}
          </Box>

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{ border: '1px solid var(--mac-border-color)', borderRadius: '12px', overflow: 'hidden' }}
          >
            <Table size="small">
              <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>DRIVER NAME</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>PLATE NO.</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>ONLINE STATUS</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>VERIFICATION</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>ACCOUNT</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '12.4px', py: 1.5 }}>ACTIONS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoadingDrivers ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <CircularProgress size={24} sx={{ color: 'var(--sakay-orange)', mb: 1 }} />
                      <Typography sx={{ fontSize: '12.4px', color: 'var(--mac-text-muted)' }}>
                        Loading driver records...
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : currentPageDrivers.length > 0 ? (
                  currentPageDrivers.map((drv) => (
                    <TableRow
                      key={drv.id}
                      onClick={() => setSelectedDriver(drv)}
                      sx={{
                        cursor: 'pointer',
                        transition: 'var(--mac-transition-fast)',
                        '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                      }}
                    >
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: '13.6px', backgroundColor: 'var(--sakay-orange-soft)', color: 'var(--sakay-orange)' }}>
                            {drv.name.charAt(0)}
                          </Avatar>
                          <Typography sx={{ fontSize: '12.8px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                            {drv.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: '12.4px', color: 'var(--mac-text-secondary)', py: 1.5 }}>
                        {drv.vehiclePlate}
                      </TableCell>
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: drv.onlineStatus === 'Online' ? '#34A853' : '#9AA0A6' }} />
                          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-secondary)' }}>
                            {drv.onlineStatus}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 1.5 }}>
                        <StatusBadge status={drv.verificationStatus as any} />
                      </TableCell>
                      <TableCell sx={{ py: 1.5 }}>
                        <StatusBadge status={drv.accountStatus as any} />
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1.5 }}>
                        <ActionButton
                          label="Inspect"
                          showArrow={false}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDriver(drv);
                          }}
                          sx={{ height: 28, fontSize: '13.6px' }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography sx={{ fontSize: '12.8px', color: 'var(--mac-text-muted)' }}>
                        No registered drivers currently affiliated with this TODA.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, val) => setPage(val)}
                size="small"
                sx={{
                  '& .Mui-selected': {
                    backgroundColor: 'var(--sakay-orange) !important',
                    color: '#FFFFFF',
                  },
                }}
              />
            </Box>
          )}
        </Box>
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
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Suspend this TODA's accreditation?"
        message={`The TODA administrator of "${toda.name}" and every one of its drivers lose access until the accreditation is approved again.`}
        confirmLabel="Suspend Accreditation"
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="Why is the accreditation suspended after review? (at least 10 characters)"
        onConfirm={async (reason) => {
          setSuspendOpen(false);
          try {
            await suspendTodaAccreditation(toda.id, reason ?? '');
            await onChanged?.();
            onClose();
          } catch (err) {
            setAccreditationFeedback({ ok: false, text: err instanceof Error ? err.message : 'The accreditation was not suspended.' });
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
