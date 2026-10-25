import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { IncidentReviewPanel } from '@sakay/shared';
import { IncidentReportRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { DetailField, DetailGrid, DetailSection } from '../common/DetailSection';
import { PageNotice } from '../common/PageNotice';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { startIncident, escalateIncident, decideIncident, updateLostItemReport, referIncidentToToda } from '../../services/adminApiService';
import { FONT } from '../../styles/density';
import { PAGE_BORDER, PAGE_DIVIDER, PAGE_TEXT, rowActionSx } from '../../styles/pageTheme';

interface IncidentDetailModalProps {
  open: boolean;
  onClose: () => void;
  incident: IncidentReportRecord | null;
  /** The list is read again after every action (the database's answer is what the screen then shows) */
  onChanged: () => void | Promise<void>;
  onViewLinkedTrip?: (tripId: string) => void;
}

// A person on the trip, with a link to call or text them
const Party: React.FC<{ label: string; name: string; phone?: string }> = ({ label, name, phone }) => (
  <DetailField label={label}>
    {name}
    {phone ? (
      <Box component="span" sx={{ display: 'block', fontSize: FONT.small, fontWeight: 400 }}>
        <a href={`tel:${phone}`} style={{ color: '#1D4ED8', fontWeight: 600 }}>{phone}</a>
        {' · '}
        <a href={`sms:${phone}`} style={{ color: '#1D4ED8' }}>SMS</a>
      </Box>
    ) : (
      <Box component="span" sx={{ display: 'block', fontSize: FONT.small, fontWeight: 400, color: PAGE_TEXT.secondary }}>No number on record</Box>
    )}
  </DetailField>
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
        subtitle={`${incident.category} · Submitted ${incident.submittedDate}`}
        badge={<StatusBadge status={incident.status} />}
        maxWidth={656}
      >
        {/* Repeated complaints warning */}
        {incident.relatedIncidentsCount >= 3 && (
          <PageNotice tone="warning" title={`This driver has ${incident.relatedIncidentsCount} related complaints`}>
            Driver {incident.driverName} ({incident.todaName}) has {incident.relatedIncidentsCount} incident reports about them within the past 30 days. This calls for a supervisory review.
          </PageNotice>
        )}

        <DetailSection title="Overview">
          <DetailGrid>
            <DetailField label="Category">
              <Box component="span" sx={{ color: PAGE_TEXT.brand }}>{incident.category}</Box>
            </DetailField>
            <DetailField label="Submitted">{incident.submittedDate} · {incident.submittedTime}</DetailField>
            <DetailField label="Reported by">{incident.reportedBy} ({incident.reporterName})</DetailField>
            <DetailField label="Status"><StatusBadge status={incident.status} /></DetailField>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="What was reported">
          <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.6, overflowWrap: 'anywhere' }}>"{incident.description}"</Typography>
          </Box>
        </DetailSection>

        {/* Supporting evidence (Rule 19.2: up to 3 photos; the links are short-lived) */}
        <DetailSection title="Evidence" note={`${incident.evidenceFiles.length} ${incident.evidenceFiles.length === 1 ? 'file' : 'files'}`}>
          {incident.evidenceFiles.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {incident.evidenceFiles.map((file, idx) => (
                <Box
                  key={idx}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', padding: '10px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}`, backgroundColor: '#FFFFFF' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <DescriptionIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 20 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{file.name}</Typography>
                      <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px' }}>Format: {file.type.toUpperCase()}</Typography>
                    </Box>
                  </Box>
                  <Button aria-label={`View evidence ${file.name}`} onClick={() => setSelectedPhoto(idx)} sx={rowActionSx('brand')}>
                    View
                  </Button>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>No photo evidence was attached to this report.</Typography>
          )}
        </DetailSection>

        {/* The trip (Rule 19.2: the trip, the parties, the route, the time) */}
        <DetailSection title="Linked trip">
          <Box sx={{ backgroundColor: '#FAFAF8', padding: '14px 16px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', mb: '8px' }}>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>Trip ref. {incident.tripId.slice(0, 8).toUpperCase()}</Typography>
              {onViewLinkedTrip && <Button onClick={() => onViewLinkedTrip(incident.tripId)} sx={rowActionSx('neutral')}>View trip</Button>}
            </Box>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, mb: '12px' }}>{incident.route ?? '-'}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: '12px 16px' }}>
              <Party label="Driver" name={`${incident.driverName} (${incident.vehiclePlate})`} phone={incident.driverPhone} />
              <Party label="Passenger" name={incident.passengerName} phone={incident.passengerPhone} />
              <DetailField label="TODA">{incident.todaName}</DetailField>
            </Box>
          </Box>
        </DetailSection>

        {/* What the audit log recorded: every action, who, when */}
        {incident.statusHistory && incident.statusHistory.length > 0 && (
          <DetailSection title="Review timeline">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#FAFAF8', padding: '12px 16px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
              {incident.statusHistory.map((step, idx) => (
                <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <CheckCircleIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 16, mt: '2px' }} />
                  <Box>
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>{step.step}</Typography>
                    <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{step.timestamp} · {step.actor}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </DetailSection>
        )}

        {/* The review (Rules 19.3, 19.4, 19.5, 19.8, 26.4): start, escalate / reclassify, the outcome and the strike, the lost-item contact */}
        <Box sx={{ pt: '16px', borderTop: `1px solid ${PAGE_DIVIDER}` }}>
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
