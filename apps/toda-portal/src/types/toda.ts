export type StatusType =
  | 'Approved'
  | 'Pending'
  | 'Rejected'
  | 'Suspended'
  | 'TODA Suspended'
  | 'LGU Deactivated'
  | 'Deactivated'
  | 'Under Review'
  | 'Resolved'
  | 'Active'
  | 'Inactive'
  | 'Declined'
  | 'Verified'
  | 'Unverified'
  | 'Valid'
  | 'Expiring Soon'
  | 'Expired'
  | 'Resubmission Required'
  | 'Pending Verification'
  | 'Pending Review'
  | 'Under Investigation'
  | 'TODA Endorsed'
  | 'Endorsed to LGU'
  | 'Awaiting Screening'
  | 'Submitted'
  | 'TODA Review'
  | 'Pending LGU Re-approval'
  | 'Published'
  | 'Unpublished'
  | 'Draft'
  | 'Escalated to LGU'
  | 'Resolved (TODA Level)'
  | 'Dismissed'
  | 'Suspension Review'
  | 'Reactivation Review'
  | 'Endorsed';

export interface TodaProfile {
  id: string;
  name: string;
  acronym: string;
  registrationNumber: string;
  dateEstablished: string;
  terminalLocation: string;
  pendingTerminalLocation?: string | null;
  terminalLatitude?: number | null;
  terminalLongitude?: number | null;
  barangay: string;
  serviceCoverageArea: string;
  contactNumber: string;
  email: string;
  officers: {
    president: string;
    presidentContact?: string;
    vicePresident: string;
    vicePresidentContact?: string;
    secretary: string;
    secretaryContact?: string;
    treasurer: string;
    treasurerContact?: string;
  };
  accreditationStatus: 'Active' | 'Pending Verification' | 'Suspended' | 'Deactivated';
  accreditationExpiry: string;
  accreditationNo: string;
  permitNumber: string;
  barangayClearanceFile: { name: string; date: string; url?: string };
  rosterFile: { name: string; date: string; count: number; url?: string };
  bylawsFile?: { name: string; date: string; url?: string };
  isOtpVerified: boolean;
  misteepComplaintsCount: number;
}

/** One document of an application, as THIS TODA's review sees it (database: get_affiliation_document_reviews). */
export interface ApplicantDocumentReview {
  documentType: 'license' | 'mtop' | 'tricycle' | 'selfie';
  /**
   * returned            this review returned it and the driver has not replaced it yet
   * resubmitted         this review returned it and the driver has replaced it since
   * returned_elsewhere  another TODA's review (or the LGU) flagged the shared document; its reason is not shown here
   * replaced_elsewhere  the shared document was replaced after this application was submitted, because of another review
   * not_returned        no issue was raised by this review
   */
  state: 'returned' | 'resubmitted' | 'returned_elsewhere' | 'replaced_elsewhere' | 'not_returned';
  reasonCode?: string | null;
  reason?: string | null;
  returnedAt?: string | null;
  returnedByStage?: 'TODA' | 'LGU' | null;
  resubmittedAt?: string | null;
}

export interface DriverApplicant {
  /** True while this application is back in TODA review after the driver replaced the documents it returned. */
  isResubmitted?: boolean;
  /** When the driver resubmitted: the 5-calendar-day review clock restarted here (Rule 3.6). ISO timestamp. */
  resubmittedAt?: string;
  /** Per document: what this review returned, why, and whether the driver has replaced it. */
  documentReviews?: ApplicantDocumentReview[];
  /** The AFFILIATION id (driver x this TODA). One driver applying to two TODAs is two applicants, one in each TODA's list. */
  id: string;
  affiliationId?: string;
  /** The person behind the application. */
  driverId?: string;
  /** This TODA's own data for the application (each affiliation keeps its own). */
  membershipNo?: string;
  assignedTerminal?: string;
  barangayServiceArea?: string;
  name: string;
  phone: string;
  licenseNo: string;
  vehiclePlate: string;
  chassisNo: string;
  motorNo: string;
  franchiseNo: string;
  submittedDate: string;
  daysPending: number;
  isOverdue: boolean; // >3 days warning
  /** On the TODA's master roster by franchise or plate number, as decided by the DATABASE (the same rule as the endorsement). */
  onSubmittedRoster: boolean;
  /** False when the database could not answer (then neither "matched" nor "mismatch" is claimed). */
  rosterMatchKnown?: boolean;
  tricyclePhotoUrl: string;
  licenseFrontUrl?: string;
  licenseBackUrl?: string;
  mtopUrl?: string;
  selfieUrl?: string;
  photoVerified: boolean;
  rosterVerified: boolean;
  todaStageStatus: 'Awaiting Screening' | 'Submitted' | 'TODA Review' | 'TODA Endorsed' | 'Endorsed to LGU' | 'Rejected' | 'Resubmission Required';
  rejectionReason?: string;
  notes?: string;
}

export interface TodaDriverMember {
  id: string;
  membershipNo: string;
  name: string;
  phone: string;
  email?: string;
  vehiclePlate: string;
  franchiseNo: string;
  licenseNo: string;
  terminalShift?: string;
  serviceZone: string;
  todaVerificationStatus: 'Verified' | 'Endorsed' | 'Pending';
  lguVerificationStatus: 'Verified' | 'Pending' | 'Suspended';
  accountStatus: 'Active' | 'TODA Suspended' | 'LGU Deactivated' | 'Suspension Review' | 'Reactivation Review' | 'Not Registered' | 'Unregistered' | 'Pending Verification' | 'Pending Review';
  suspensionReason?: string;
  suspendedAt?: string;
  strikesCount: number;
  rating: number;
  totalTrips: number;
  joinedDate: string;
  /** What the database says right now: Offline, Available (online and idle) or Busy (on a trip) */
  availabilityStatus?: 'Offline' | 'Available' | 'Busy';
  /** Set while the driver has paused new bookings */
  bookingsPausedUntil?: string | null;
}

export interface EvidenceFileItem {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'document';
  url: string;
}

export interface DriverExemptionRequest {
  id: string;
  driverId: string;
  driverName: string;
  strikeId: string;
  incidentCategory: string;
  reason: string;
  evidenceFiles: EvidenceFileItem[];
  submittedAt: string;
  status: 'Pending Review' | 'Approved' | 'Escalated to LGU' | 'Rejected';
  decisionNotes?: string;
}

export interface TodaAnnouncement {
  id: string;
  title: string;
  message: string;
  category: 'Terminal Rules' | 'Document Renewal' | 'Meeting Notice' | 'Safety Advisory' | 'General';
  urgency: 'Standard' | 'High Priority';
  isPublished: boolean;
  sendPushNotification: boolean;
  createdBy: string;
  createdAt: string;
}

export interface TodaBooking {
  id: string;
  bookingCode: string;
  passengerName: string;
  passengerPhone: string;
  driverName: string;
  vehiclePlate: string;
  pickupLocation: string;
  dropoffLocation: string;
  distanceKm: number;
  fareAmount: number;
  tripMode: 'Solo Trip' | 'Shared Ride';
  status: 'Completed' | 'In Progress' | 'Cancelled';
  paymentMethod: 'Cash';
  timestamp: string;
}

export interface TodaIncident {
  id: string;
  incidentCode?: string;
  bookingId: string;
  tripId: string;
  driverName: string;
  vehiclePlate: string;
  reporterName: string;
  reporterRole: 'Passenger' | 'Driver' | 'Commuter';
  category: string;
  description: string;
  submittedAt: string;
  status: 'Pending Review' | 'Under Investigation' | 'Resolved (TODA Level)' | 'Escalated to LGU' | 'Dismissed';
  findings?: string;
  /** photos the reporter attached (short-lived signed links) */
  evidenceFiles?: { name: string; url: string }[];
  escalationReason?: string;
  escalatedAt?: string;
}

export interface TodaAuditLog {
  id: string;
  log_id: string;
  toda_admin_id: string;
  actor_name: string;
  action_type: string;
  target_id: string;
  target_name: string;
  details: string;
  performed_at: string;
  category: 'Account' | 'Driver Verification' | 'Membership' | 'Operations' | 'Announcement' | 'Incident';
}

export interface NotificationItem {
  id: string;
  title: string;
  time?: string;
  read?: boolean;
  unread?: boolean;
  type?: string;
  description?: string;
}

export interface TodaAdminProfile {
  admin_id: string;
  auth_user_id: string;
  toda_id: string;
  full_name: string;
  email: string;
  toda_acronym?: string;
  contact_number?: string;
  account_status: 'Active' | 'Suspended';
  created_at?: string;
  toda?: {
    toda_id: string;
    toda_name: string;
    toda_acronym?: string;
    account_status?: 'Pending Verification' | 'Active' | 'Suspended' | 'Deactivated';
    toda_status?: string;
    barangay?: string;
    service_coverage_area?: string;
    president_name?: string;
    contact_number?: string;
  };
}

