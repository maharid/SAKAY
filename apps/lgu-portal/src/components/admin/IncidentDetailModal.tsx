import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RouteIcon from '@mui/icons-material/Route';
import DescriptionIcon from '@mui/icons-material/Description';
import HistoryIcon from '@mui/icons-material/History';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { IncidentReviewPanel } from '@sakay/shared';
import { IncidentReportRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { ActionButton } from './ActionButton';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { startIncident, escalateIncident, decideIncident, updateLostItemReport, referIncidentToToda } from '../../services/adminApiService';
import { FONT } from '../../styles/density';

interface IncidentDetailModalProps {
  open: boolean;
  onClose: () => void;
  incident: IncidentReportRecord | null;
  /** The list is read again after every action (the database's answer is what the screen then shows) */
  onChanged: () => void | Promise<void>;
  onViewLinkedTrip?: (tripId: string) => void;
}

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <Box sx={{ mb: 3.2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.6 }}>
      {icon}
      <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{title}</Typography>
    </Box>
    {children}
  </Box>
);

const Party: React.FC<{ label: string; name: string; phone?: string }> = ({ label, name, phone }) => (
  <Box>
    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '2px' }}>{label}</Typography>
    <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{name}</Typography>
    {phone ? (
      <Typography sx={{ fontSize: FONT.caption }}>
        <a href={`tel:${phone}`} style={{ color: '#2563EB', fontWeight: 600 }}>{phone}</a>
        {' · '}
        <a href={`sms:${phone}`} style={{ color: '#2563EB' }}>SMS</a>
      </Typography>
    ) : (
      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>no number on record</Typography>
    )}
  </Box>
);

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ open, onClose, incident, onChanged, onViewLinkedTrip }) => {
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);

  if (!incident) return null;

  // every action is ONE database function; the list is read again afterwards
  const after = (task: () => Promise<string | null>) => async (): Promise<string | null> => {
    const problem = await task();
    if (!problem) await onChanged();
    return problem;
  };

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={onClose}
        title={`Incident #${incident.id}`}
        subtitle={`${incident.category} • Submitted ${incident.submittedDate}`}
        badge={<StatusBadge status={incident.status} />}
        maxWidth={656}
      >
        {/* Repeated Complaints Warning Banner */}
        {incident.relatedIncidentsCount >= 3 && (
          <Box
            sx={{
              mb: 3.2,
              backgroundColor: '#FFF7ED',
              border: '1px solid #FDBA74',
              borderRadius: '12px',
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 1.6,
            }}
          >
            <WarningAmberIcon sx={{ color: '#EA580C', fontSize: '19px', flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: '#9A3412', mb: '2px' }}>
                Supervisory Review Warning: Driver Has {incident.relatedIncidentsCount} Related Complaints
              </Typography>
              <Typography sx={{ fontSize: FONT.caption, color: '#C2410C' }}>
                Driver {incident.driverName} ({incident.todaName}) has {incident.relatedIncidentsCount} incident reports about them within the past 30 days.
              </Typography>
            </Box>
          </Box>
        )}

        {/* Section 1: Overview Header */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 2,
            backgroundColor: '#FAFAFC',
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid var(--mac-border-color)',
            mb: 3.2,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '3px' }}>Incident Category</Typography>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'var(--sakay-orange)' }}>{incident.category}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '3px' }}>Submitted Timestamp</Typography>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{incident.submittedDate} • {incident.submittedTime}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '3px' }}>Reported By</Typography>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{incident.reportedBy} ({incident.reporterName})</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '3px' }}>Current Status</Typography>
            <StatusBadge status={incident.status} />
          </Box>
        </Box>

        {/* Section 2: Full Written Description */}
        <Section icon={<DescriptionIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />} title="Full Written Description">
          <Box sx={{ backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px', border: '1px solid var(--mac-border-color)' }}>
            <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-primary)', lineHeight: 1.6 }}>"{incident.description}"</Typography>
          </Box>
        </Section>

        {/* Section 3: Supporting Evidence Attachments (Rule 19.2: up to 3 photos; the links are short-lived) */}
        <Box sx={{ mb: 3.2 }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1.6, letterSpacing: '0.3px' }}>
            Submitted Supporting Evidence ({incident.evidenceFiles.length})
          </Typography>

          {incident.evidenceFiles.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
              {incident.evidenceFiles.map((file, idx) => (
                <Box
                  key={idx}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: '10px', border: '1px solid var(--mac-border-color)', backgroundColor: '#FFFFFF' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.6 }}>
                    <DescriptionIcon sx={{ color: 'var(--sakay-orange)', fontSize: '19px' }} />
                    <Box>
                      <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{file.name}</Typography>
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px' }}>Attachment Format: {file.type.toUpperCase()}</Typography>
                    </Box>
                  </Box>
                  <ActionButton label="View Evidence" showArrow={false} onClick={() => setSelectedPhoto(idx)} sx={{ height: 34, fontSize: FONT.caption }} />
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ padding: '13px 16px', backgroundColor: '#F5F5F7', borderRadius: '10px' }}>
              <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', fontStyle: 'italic' }}>No supporting photo evidence was attached to this incident report.</Typography>
            </Box>
          )}
        </Box>

        {/* Section 4: Linked Trip Card (Rule 19.2: the trip, the parties, the route, the time) */}
        <Section icon={<RouteIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />} title="Linked Trip Details">
          <Box sx={{ backgroundColor: '#F5F5F7', padding: '16px', borderRadius: '12px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.6 }}>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'var(--mac-text-primary)' }}>Trip Ref: {incident.tripId.slice(0, 8).toUpperCase()}</Typography>
              {onViewLinkedTrip && <ActionButton label="View Linked Trip" onClick={() => onViewLinkedTrip(incident.tripId)} sx={{ height: 32, fontSize: FONT.caption }} />}
            </Box>
            <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-primary)', mb: 1.6 }}>{incident.route ?? '-'}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.6 }}>
              <Party label="Driver" name={`${incident.driverName} (${incident.vehiclePlate})`} phone={incident.driverPhone} />
              <Party label="Passenger" name={incident.passengerName} phone={incident.passengerPhone} />
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mb: '2px' }}>TODA Affiliation</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{incident.todaName}</Typography>
              </Box>
            </Box>
          </Box>
        </Section>

        {/* Section 5: Status History Audit Trail (what the audit log recorded: every action, who, when) */}
        {incident.statusHistory && incident.statusHistory.length > 0 && (
          <Section icon={<HistoryIcon fontSize="small" sx={{ color: 'var(--sakay-orange)' }} />} title="Review Timeline & Audit Trail">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, backgroundColor: '#F5F5F7', padding: '14px 16px', borderRadius: '12px' }}>
              {incident.statusHistory.map((step, idx) => (
                <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1.6 }}>
                  <CheckCircleIcon sx={{ color: 'var(--sakay-orange)', fontSize: '14px' }} />
                  <Box>
                    <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{step.step}</Typography>
                    <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>{step.timestamp} • {step.actor}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Section>
        )}

        {/* Section 6: the review (Rules 19.3, 19.4, 19.5, 19.8, 26.4): start, escalate / reclassify, the outcome and the strike, the lost-item contact */}
        <Box sx={{ pt: 1.6, borderTop: '1px solid var(--mac-border-color)' }}>
          {incident.record && (
            <IncidentReviewPanel
              role="lgu_admin"
              incident={incident.record}
              onStart={after(() => startIncident(incident.id))}
              onEscalate={(reason, serious) => after(() => escalateIncident(incident.id, reason, serious))()}
              onDecide={(d) => after(() => decideIncident({ incidentId: incident.id, ...d }))()}
              onLostItem={(status, note) => after(() => updateLostItemReport(incident.id, status, note))()}
              onRefer={(reason) => after(() => referIncidentToToda(incident.id, reason))()}
            />
          )}
        </Box>
      </MacCenterModal>

      {/* Evidence viewer: the photos of this report (signed again when it opens) */}
      {selectedPhoto !== null && (
        <DocumentPreviewModal
          open
          onClose={() => setSelectedPhoto(null)}
          documentName={incident.evidenceFiles[selectedPhoto]?.name ?? 'Evidence'}
          documentType="Evidence Attachment"
          urls={[...incident.evidenceFiles.slice(selectedPhoto), ...incident.evidenceFiles.slice(0, selectedPhoto)].map((f) => f.url)}
        />
      )}
    </>
  );
};
