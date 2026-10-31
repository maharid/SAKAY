import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';
import { IncidentFacts, incidentHandling, type IncidentFollowupRow } from '@sakay/shared';

import { IncidentReportRecord } from '../../mockData/adminData';
import { MacCenterModal } from './MacCenterModal';
import { StatusBadge } from '../common/StatusBadge';
import { PageNotice } from '../common/PageNotice';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { IncidentResolutionStepper } from './IncidentResolutionStepper';
import {
  startIncident,
  acknowledgeIncidentReport,
  recordIncidentInvestigationFor,
  escalateIncident,
  decideIncident,
  updateLostItemReport,
  referIncidentToToda,
  fetchIncidentFollowups,
} from '../../services/adminApiService';
import { rowActionSx } from '../../styles/pageTheme';

interface IncidentDetailModalProps {
  open: boolean;
  onClose: () => void;
  incident: IncidentReportRecord | null;
  /** The list is read again after every action (the database's answer is what the screen then shows) */
  onChanged: () => void | Promise<void>;
  onViewLinkedTrip?: (tripId: string) => void;
}

/** One incident report, for the LGU Administrator: the four-step resolution (review, investigate, decide, finalize) with the report's facts, evidence and history */
export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ open, onClose, incident, onChanged, onViewLinkedTrip }) => {
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);
  const [followups, setFollowups] = useState<IncidentFollowupRow[]>([]);

  const incidentId = incident?.id;
  const loadFollowups = useCallback(() => {
    if (!incidentId) return;
    void fetchIncidentFollowups(incidentId).then(setFollowups);
  }, [incidentId]);
  useEffect(() => {
    if (open) loadFollowups();
  }, [open, loadFollowups]);

  if (!incident || !incident.record) return null;
  const record = incident.record;

  // every action is ONE database function; the list is read again afterwards
  const after = (task: () => Promise<string | null>) => async (): Promise<string | null> => {
    const problem = await task();
    if (!problem) {
      await onChanged();
      loadFollowups();
    }
    return problem;
  };

  const handling = incidentHandling(record, 'lgu_admin');

  return (
    <>
      <MacCenterModal
        open={open}
        onClose={onClose}
        title={`Incident #${incident.id.slice(0, 8).toUpperCase()}`}
        subtitle={`${incident.category} · Submitted ${incident.submittedDate}`}
        badge={<StatusBadge status={handling === 'monitoring' ? 'With the TODA' : incident.status} />}
        maxWidth={760}
      >
        {incident.relatedIncidentsCount >= 3 && (
          <PageNotice tone="warning" title={`This driver has ${incident.relatedIncidentsCount} related complaints`}>
            Driver {incident.driverName} ({incident.todaName}) has {incident.relatedIncidentsCount} incident reports about them within the past 30 days. This calls for a supervisory review.
          </PageNotice>
        )}
        {handling === 'monitoring' && (
          <PageNotice tone="info" title="This report is with the TODA">
            The TODA Administrator is reviewing it first. You can read it; take it over only if the TODA has not acted by its time limit.
          </PageNotice>
        )}

        <IncidentResolutionStepper
          key={incident.id}
          incident={incident}
          record={record}
          followups={followups}
          onAccept={after(() => startIncident(incident.id))}
          onTake={after(() => acknowledgeIncidentReport(incident.id))}
          onRecordInvestigation={(notes, contacted) => after(() => recordIncidentInvestigationFor(incident.id, notes, contacted))()}
          onDecide={(d) => after(() => decideIncident({ incidentId: incident.id, ...d }))()}
          onEscalate={(reason, serious) => after(() => escalateIncident(incident.id, reason, serious))()}
          onRefer={(reason) => after(() => referIncidentToToda(incident.id, reason))()}
          onLostItem={(status, note) => after(() => updateLostItemReport(incident.id, status, note))()}
          renderFacts={() => (
            <>
              <IncidentFacts
                record={record}
                reporter={{ role: incident.reportedBy, name: incident.reporterName }}
                passenger={{ name: incident.passengerName, phone: incident.passengerPhone }}
                driver={{ name: incident.driverName, phone: incident.driverPhone, plate: incident.vehiclePlate }}
                todaName={incident.todaName}
                route={incident.route}
                evidence={incident.evidenceFiles}
                onOpenEvidence={setSelectedPhoto}
              />
              {onViewLinkedTrip && incident.tripId && incident.tripId !== 'N/A' && (
                <Box sx={{ mt: '10px' }}>
                  <Button onClick={() => onViewLinkedTrip(incident.tripId)} sx={rowActionSx('neutral')}>View the linked trip</Button>
                </Box>
              )}
            </>
          )}
        />
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
