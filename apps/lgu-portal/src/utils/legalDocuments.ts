import {
  PRIVACY_NOTICE_VERSION,
  RETENTION_CLOSED_RECORDS_YEARS,
  RETENTION_DOC_CLOSED_MONTHS,
  RETENTION_DOC_REJECTED_DAYS,
  RETENTION_DOC_SUPERSEDED_DAYS,
  RETENTION_GPS_LOG_DAYS,
  RETENTION_SESSION_DAYS,
} from '@sakay/shared';

import { buildPrivacyPolicy } from './legalContent';

export { TERMS_OF_SERVICE } from './legalContent';

// The Privacy Policy of the LGU portal, written with the real figures of the retention schedule.
export const PRIVACY_POLICY = buildPrivacyPolicy({
  noticeVersion: PRIVACY_NOTICE_VERSION,
  gpsDays: RETENTION_GPS_LOG_DAYS,
  sessionDays: RETENTION_SESSION_DAYS,
  documentSupersededDays: RETENTION_DOC_SUPERSEDED_DAYS,
  documentRejectedDays: RETENTION_DOC_REJECTED_DAYS,
  documentClosedMonths: RETENTION_DOC_CLOSED_MONTHS,
  closedRecordsYears: RETENTION_CLOSED_RECORDS_YEARS,
});
