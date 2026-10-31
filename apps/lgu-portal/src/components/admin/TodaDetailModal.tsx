import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { calculateDistanceKm } from '@sakay/shared';

import { AccreditedTodaRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { DetailField, DetailGrid, DetailSection } from '../common/DetailSection';
import { PageNotice } from '../common/PageNotice';
import { TodaZoneMap } from './TodaZoneMap';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { MacConfirmDialog } from './MacConfirmDialog';
import { TodaAccreditationDialog } from './TodaAccreditationDialog';
import { fetchTodaRosterSummary, fetchTodaChangeRequests, decideTodaChangeRequest, type TodaChangeRequestRow, approveTerminalRelocation, rejectTerminalRelocation, approveTodaApplication, suspendTodaAccreditation, reinstateTodaAccreditation, sendTodaRenewalReminder } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_TEXT, dangerOutlineButtonSx, primaryButtonSx, rowActionSx, secondaryButtonSx } from '../../styles/pageTheme';

/** "Nov 3, 2026" in Manila time (a suspension ends at the close of a Manila day) */
const formatDay = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
/** the first and last day an end date may be picked (YYYY-MM-DD, Manila): tomorrow, and one year from today */
const manilaDayFromNow = (days: number): string => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const tomorrowManila = (): string => manilaDayFromNow(1);
const oneYearManila = (): string => manilaDayFromNow(365);

const CHANGE_FIELD_LABEL: Record<string, string> = { toda_name: 'Name', toda_acronym: 'Acronym', barangay: 'Barangay', date_established: 'Date established' };

interface TodaDetailModalProps {
  open: boolean;
  onClose: () => void;
  toda: AccreditedTodaRecord | null;
  /** the accreditation was renewed or suspended: the directory reloads */
  onChanged?: () => void | Promise<void>;
}

export const TodaDetailModal: React.FC<TodaDetailModalProps> = ({ open, onClose, toda, onChanged }) => {
  const navigate = useNavigate();
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

  // Selected document for official records preview
  const [selectedDoc, setSelectedDoc] = useState<{ name: string; type: string; url?: string | null } | null>(null);

  // The changes this TODA asked for (its details, new Internal Bylaws) and the LGU's last decisions: the record in force stays until the LGU decides
  const [changes, setChanges] = useState<TodaChangeRequestRow[]>([]);
  const [changeDecision, setChangeDecision] = useState<{ request: TodaChangeRequestRow; approve: boolean } | null>(null);
  const [changeFeedback, setChangeFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const loadChanges = React.useCallback(() => {
    if (!open || !toda) return;
    void fetchTodaChangeRequests(toda.id).then(setChanges);
  }, [open, toda?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setChangeFeedback(null);
    loadChanges();
  }, [loadChanges]);

  if (!toda) return null;

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

        {/* Changes the TODA asked for: its record in force stays as it is until the LGU decides, in its own words */}
        {changes.some((c) => c.status === 'Pending') && (
          <PageNotice tone="warning" title="Changes waiting for your decision">
            <Box component="span" sx={{ display: 'block', mb: '8px' }}>The details and the bylaws in force stay as they are until you approve.</Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {changes.filter((c) => c.status === 'Pending').map((c) => (
                <Box key={c.requestId} sx={{ backgroundColor: '#FFFFFF', border: `1px solid ${PAGE_BORDER}`, borderRadius: '10px', p: '10px 12px' }}>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>
                    {c.kind === 'profile' ? 'Change to the TODA details' : 'New Internal Bylaws'}
                    <Typography component="span" sx={{ fontSize: FONT.small, fontWeight: 500, color: PAGE_TEXT.secondary }}> · sent {formatDay(c.requestedAt)}{c.requestedByName ? ` by ${c.requestedByName}` : ''}</Typography>
                  </Typography>
                  {c.kind === 'profile' ? (
                    <Box component="ul" sx={{ m: '4px 0 0', pl: '18px' }}>
                      {Object.keys(c.proposed).map((key) => (
                        <li key={key}>
                          <Typography component="span" sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                            {CHANGE_FIELD_LABEL[key] ?? key}: {String(c.previous[key] ?? 'not set')} → <b>{String(c.proposed[key] ?? 'not set')}</b>
                          </Typography>
                        </li>
                      ))}
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', mt: '4px' }}>
                      <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, overflowWrap: 'anywhere' }}>{(c.fileName || 'New bylaws file').replace(/^\d{13}_/, '')}</Typography>
                      <Button onClick={() => setSelectedDoc({ name: (c.fileName || 'New Internal Bylaws').replace(/^\d{13}_/, ''), type: 'Internal Bylaws (proposed)', url: String(c.proposed.bylaws_url || '') })} sx={rowActionSx('brand')}>View new file</Button>
                    </Box>
                  )}
                  {c.reason && <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '4px' }}><b>The TODA's reason:</b> {c.reason}</Typography>}
                  <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mt: '8px' }}>
                    <Button onClick={() => setChangeDecision({ request: c, approve: false })} sx={rowActionSx('danger')}>Reject</Button>
                    <Button variant="contained" onClick={() => setChangeDecision({ request: c, approve: true })} sx={primaryButtonSx}>Approve</Button>
                  </Box>
                </Box>
              ))}
            </Box>
            {changeFeedback && <Box component="span" sx={{ display: 'block', fontWeight: 700, mt: '6px', color: changeFeedback.ok ? PAGE_TEXT.success : PAGE_TEXT.danger }}>{changeFeedback.text}</Box>}
          </PageNotice>
        )}

        {/* Master Roster: the list itself is on its own page, next to every registered driver */}
        <DetailSection title="Master Roster and drivers">
          <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.6 }}>
            {rosterSummary ? (
              <>
                <b>{rosterSummary.active}</b> active member{rosterSummary.active === 1 ? '' : 's'} on the Master Roster ({rosterSummary.from_registration_file} from the registration file, {rosterSummary.added_later} added since,{' '}
                {rosterSummary.left} no longer a member), and <b>{toda.registeredDrivers}</b> registered {toda.registeredDrivers === 1 ? 'driver' : 'drivers'}.
              </>
            ) : (
              <>{toda.registeredDrivers} registered {toda.registeredDrivers === 1 ? 'driver' : 'drivers'}.</>
            )}
          </Typography>
          <Box sx={{ mt: '10px' }}>
            <Button variant="contained" onClick={() => { onClose(); navigate(`/accredited-todas/${toda.id}/roster`); }} sx={primaryButtonSx}>
              Open the Master Roster
            </Button>
          </Box>
        </DetailSection>

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

        {/* Service zone and boundary: the terminal pin on a real map, inside the area SAKAY serves */}
        <DetailSection title="Service zone and boundary" note={toda.serviceZone || toda.barangay}>
          <TodaZoneMap
            terminal={toda.centerLat && toda.centerLng ? { lat: Number(toda.centerLat), lng: Number(toda.centerLng), label: toda.serviceZone || toda.barangay } : null}
            proposed={toda.pendingTerminalLat != null && toda.pendingTerminalLng != null ? { lat: Number(toda.pendingTerminalLat), lng: Number(toda.pendingTerminalLng), label: toda.pendingTerminalLocation ?? undefined } : null}
          />
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

      </MacCenterModal>


      {/* Renewal: the Administrator types the certificate number and the new valid-until date (Rule 24.3) */}
      <TodaAccreditationDialog
        open={renewOpen}
        mode="renew"
        todaName={toda.name}
        hasClearance={toda.hasBarangayClearance !== false}
        currentCertificateNumber={toda.certificateNumber}
        declaredValidUntil={toda.declaredClearanceValidUntil}
        onViewClearance={() => {
          const clearance = officialDocs.find((d) => /clearance/i.test(d.type) || /clearance/i.test(d.name));
          if (clearance) setSelectedDoc({ name: clearance.name, type: clearance.type, url: clearance.url });
        }}
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

      {/* The LGU decides a change in its own words (10 to 500 characters); the TODA reads them */}
      <MacConfirmDialog
        open={changeDecision !== null}
        onClose={() => setChangeDecision(null)}
        title={changeDecision?.approve ? 'Approve this change?' : 'Reject this change?'}
        message={changeDecision?.approve
          ? `The TODA's ${changeDecision.request.kind === 'profile' ? 'details become the ones it asked for' : 'Internal Bylaws become the new file'} from now on. The decision is recorded with your name and your reason.`
          : 'Nothing changes: the TODA keeps what is in force and reads your reason.'}
        confirmLabel={changeDecision?.approve ? 'Approve the change' : 'Reject the change'}
        confirmVariant={changeDecision?.approve ? 'orange' : 'danger'}
        requireReason
        minReasonLength={10}
        reasonPlaceholder={changeDecision?.approve ? 'Why is it approved? (at least 10 characters)' : 'Why is it rejected? (at least 10 characters)'}
        onConfirm={async (reason) => {
          const decision = changeDecision;
          setChangeDecision(null);
          if (!decision) return;
          try {
            await decideTodaChangeRequest(decision.request.requestId, decision.approve, reason ?? '');
            setChangeFeedback({ ok: true, text: decision.approve ? 'Approved. The change is now in force.' : 'Rejected. The TODA was told why.' });
            loadChanges();
            await onChanged?.();
          } catch (err) {
            setChangeFeedback({ ok: false, text: err instanceof Error ? err.message : 'The decision was not saved.' });
          }
        }}
      />

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
