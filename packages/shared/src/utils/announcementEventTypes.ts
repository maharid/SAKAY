/**
 * The kind of event an announcement is about. It is stored with the announcement (announcement.event_type), chosen in the form, and the announcement's icon follows it everywhere it is shown
 * (the portals' lists and forms, the Passenger and Driver apps). The database accepts only these values (announcement_event_type_check).
 */
export const ANNOUNCEMENT_EVENT_TYPES = ['General', 'Terminal Rules', 'Document Renewal', 'Meeting Notice', 'Safety Advisory', 'Road Closure', 'Weather', 'Emergency', 'Fare Update', 'Service Notice'] as const;
export type AnnouncementEventType = (typeof ANNOUNCEMENT_EVENT_TYPES)[number];

/** What a TODA administrator may announce to its own drivers; the LGU Administrator may use every type (Emergency is the LGU's alone: it is what a declared calamity publishes) */
export const TODA_ANNOUNCEMENT_EVENT_TYPES: readonly AnnouncementEventType[] = ['Terminal Rules', 'Document Renewal', 'Meeting Notice', 'Safety Advisory', 'General'];
export const LGU_ANNOUNCEMENT_EVENT_TYPES: readonly AnnouncementEventType[] = ['General', 'Safety Advisory', 'Road Closure', 'Weather', 'Fare Update', 'Service Notice', 'Meeting Notice', 'Document Renewal'];

/** A value from the database (or an older row) as a known event type: anything else is "General" */
export function asAnnouncementEventType(value: unknown): AnnouncementEventType {
  return (ANNOUNCEMENT_EVENT_TYPES as readonly string[]).includes(String(value)) ? (value as AnnouncementEventType) : 'General';
}
