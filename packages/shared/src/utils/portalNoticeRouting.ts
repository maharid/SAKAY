/**
 * What a notice in the LGU or the TODA portal is about, and where it leads.
 *
 * A notice is a row of the notice table addressed to the LGU ('lgu_admin') or to a TODA ('toda_<id>'), with a type and a subject (the record it is about). Here the type
 * decides the kind (which icon the notice gets) and, with the subject, the page it opens: the page opens the record itself (a query parameter names it), never a generic dashboard.
 * Pure text rules; the pages read the parameters.
 */

export type PortalAudience = 'lgu' | 'toda';

export type NoticeVisualKind =
  | 'incident'
  | 'overdue'
  | 'followup'
  | 'resubmission'
  | 'driverVerification'
  | 'accreditation'
  | 'appeal'
  | 'reminder'
  | 'general';

const upper = (type: string | null | undefined): string => (type || '').toUpperCase().trim();

export function noticeVisualKind(type: string | null | undefined): NoticeVisualKind {
  const t = upper(type);
  if (/^INCIDENT_OVERDUE/.test(t)) return 'overdue';
  if (t === 'INCIDENT_FOLLOWUP') return 'followup';
  if (/^INCIDENT_/.test(t)) return 'incident';
  if (t === 'DRIVER_RESUBMITTED' || t === 'RESUBMISSION' || t === 'RESUBMITTED') return 'resubmission';
  if (t === 'TODA_DRIVER_LGU_DECISION' || t === 'ENDORSEMENT' || t === 'ENDORSED' || /^DRIVER_(VERIFIED|REJECTED|APPLICATION)/.test(t) || /^ROSTER_ENTRY_/.test(t)) return 'driverVerification';
  if (/^TODA_ACCREDITATION/.test(t) || t === 'TODA_EXPIRY_REMINDER' || t === 'LGU_RENEWAL_REMINDER' || t === 'TODA' || t === 'TODAPENDING') return 'accreditation';
  if (/^APPEAL_/.test(t) || t === 'APPEAL') return 'appeal';
  if (/REMINDER|EXPIRY/.test(t)) return 'reminder';
  return 'general';
}

/** The record a notice is about: some subjects carry a period after the id ("<toda id>|2026-12-31"), only the first part is the id. */
const recordId = (subject: string | null | undefined): string => String(subject || '').split('|')[0].trim();

/**
 * The page (and record) a notice opens. Null when the notice has nothing to open (a plain information notice): it is then only marked as read.
 * The query parameter is read by the page, which opens the record's own window.
 */
export function noticeDestination(audience: PortalAudience, type: string | null | undefined, subject: string | null | undefined): string | null {
  const t = upper(type);
  const id = recordId(subject);
  const q = (path: string, param: string) => (id ? `${path}?${param}=${encodeURIComponent(id)}` : path);

  if (audience === 'lgu') {
    if (/^INCIDENT_/.test(t)) return q('/incident-reports', 'incident');
    if (t === 'DRIVER_RESUBMITTED' || t === 'RESUBMISSION' || t === 'ENDORSEMENT') return q('/drivers', 'affiliation');
    if (/^APPEAL/.test(t)) return q('/appeals', 'appeal');
    if (t === 'TODA_ACCREDITATION_EXPIRED_LGU' || t === 'TODA_EXPIRY_REMINDER') return q('/accredited-todas', 'toda');
    if (t === 'TODA' || t === 'TODAPENDING') return q('/toda-applications', 'toda');
    // a new roster member waits for the LGU: the subject is the TODA, the page is that TODA's Master Roster
    if (t === 'ROSTER_ENTRY_PENDING_LGU') return id ? `/accredited-todas/${encodeURIComponent(id)}/roster` : '/accredited-todas';
    return null;
  }

  if (/^INCIDENT_/.test(t)) return q('/reports', 'incident');
  if (t === 'DRIVER_RESUBMITTED' || t === 'TODA_DRIVER_LGU_DECISION') return q('/driver-verification', 'application');
  if (/^TODA_ACCREDITATION/.test(t) || t === 'TODA_EXPIRY_REMINDER' || t === 'LGU_RENEWAL_REMINDER') return '/account';
  // the LGU decided on a member the TODA added to its Master Roster
  if (t === 'ROSTER_ENTRY_DECIDED') return '/drivers';
  return null;
}

/** Notices that belong in the LGU portal (a stored notice addressed to a passenger or a driver never does). */
export const LGU_RECIPIENT = 'lgu_admin';
export const todaRecipient = (todaId: string): string => `toda_${todaId}`;

/** The wording used for a notice's kind, for the icon's accessible name */
export const NOTICE_KIND_LABEL: Record<NoticeVisualKind, string> = {
  incident: 'Incident report',
  overdue: 'Overdue',
  followup: 'Follow-up',
  resubmission: 'Resubmission',
  driverVerification: 'Driver verification',
  accreditation: 'Accreditation',
  appeal: 'Appeal',
  reminder: 'Reminder',
  general: 'Notice',
};
