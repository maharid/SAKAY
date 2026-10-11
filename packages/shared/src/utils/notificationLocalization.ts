/**
 * Localization helper for system-generated notification strings.
 * Ensures system notifications show consistent English or Tagalog text based on active language,
 * while preserving author-written text for custom announcements/advisories.
 */

export interface LocalizedNotificationResult {
  title: string;
  message: string;
  isSystemGenerated: boolean;
}

export function localizeSystemNotification(
  rawTitle: string,
  rawMessage: string,
  language: 'tl' | 'en',
  notificationType?: string
): LocalizedNotificationResult {
  const type = (notificationType || '').toUpperCase().trim();
  const titleTrimmed = (rawTitle || '').trim();
  const msgTrimmed = (rawMessage || '').trim();

  // 1. Driver License Expiry Reminder to Driver
  if (type === 'LICENSE_EXPIRY_REMINDER' || titleTrimmed.includes("Mapaso ang Driver's License") || titleTrimmed.includes("Driver's License Expiring Soon")) {
    if (language === 'en') {
      const match = msgTrimmed.match(/loob ng (\d+) araw \((.*?)\)/i);
      const days = match ? match[1] : '';
      const date = match ? match[2] : '';
      const msgEn = days
        ? `Your Driver's License will expire in ${days} day(s) (${date}). Please submit renewal documents before this date to prevent service restriction.`
        : 'Your Driver\'s License is expiring soon. Please submit renewal documents before expiry to prevent service restriction.';
      return {
        title: "Reminder: Driver's License Expiring Soon",
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: "Paalala: Malapit nang Mapaso ang Driver's License",
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // 2. MTOP Franchise Expiry Reminder to Driver
  if (type === 'MTOP_EXPIRY_REMINDER' || titleTrimmed.includes("Mapaso ang MTOP Franchise") || titleTrimmed.includes("MTOP Franchise Expiring Soon")) {
    if (language === 'en') {
      const match = msgTrimmed.match(/loob ng (\d+) araw \((.*?)\)/i);
      const days = match ? match[1] : '';
      const date = match ? match[2] : '';
      const msgEn = days
        ? `Your MTOP Franchise Permit will expire in ${days} day(s) (${date}). Please renew your franchise before this date.`
        : 'Your MTOP Franchise Permit is expiring soon. Please renew your franchise before expiry.';
      return {
        title: "Reminder: MTOP Franchise Expiring Soon",
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: "Paalala: Malapit nang Mapaso ang MTOP Franchise",
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // 3. Driver License Expiry Warning to TODA Admin
  if (type === 'DRIVER_LICENSE_EXPIRY_WARNING' || titleTrimmed.startsWith('Driver License Expiry Warning:')) {
    if (language === 'en') {
      const match = msgTrimmed.match(/ni (.*?) ay mapapaso sa loob ng (\d+) araw/i);
      const msgEn = match
        ? `The Driver's License of ${match[1]} will expire in ${match[2]} day(s).`
        : rawMessage;
      return {
        title: titleTrimmed,
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: titleTrimmed,
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // 4. Driver MTOP Expiry Warning to TODA Admin
  if (type === 'DRIVER_MTOP_EXPIRY_WARNING' || titleTrimmed.startsWith('Driver MTOP Expiry Warning:')) {
    if (language === 'en') {
      const match = msgTrimmed.match(/ni (.*?) ay mapapaso sa loob ng (\d+) araw/i);
      const msgEn = match
        ? `The MTOP franchise permit of ${match[1]} will expire in ${match[2]} day(s).`
        : rawMessage;
      return {
        title: titleTrimmed,
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: titleTrimmed,
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // 5. Document Returned for Correction
  if (type === 'DOCUMENT_RETURNED' || type === 'DRIVER_DOCUMENTARY_RESTRICTION' || titleTrimmed.includes('Ibinabalik ang Dokumento') || titleTrimmed.includes('Document Returned')) {
    if (language === 'en') {
      return {
        title: 'Notice: Document Returned for Resubmission',
        message: 'Your submitted document was returned for revision or corrections. Please check requirements and resubmit.',
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'Abiso: Pagbabalik ng Dokumento',
        message: rawMessage || 'Ang iyong isinumiteng dokumento ay ibinalik para sa pagwawasto. Mangyaring suriin at mag-resubmit.',
        isSystemGenerated: true,
      };
    }
  }

  // 6. SLA Reminder Stage 1
  if (type === 'SLA_REMINDER_STAGE1' || titleTrimmed.includes('SLA Reminder: Driver Application Pending Review')) {
    if (language === 'en') {
      const match = msgTrimmed.match(/para kay (.*?) ay (\d+) araw nang naghihintay/i);
      const msgEn = match
        ? `Application for ${match[1]} has been pending TODA endorsement for ${match[2]} day(s).`
        : 'Driver application is pending TODA endorsement review.';
      return {
        title: 'SLA Reminder: Driver Application Pending Review',
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'SLA Reminder: Driver Application Pending Review',
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // 7. SLA Reminder Stage 2
  if (type === 'SLA_REMINDER_STAGE2' || titleTrimmed.includes('SLA Reminder: Driver Verification Pending LGU Final Review')) {
    if (language === 'en') {
      const match = msgTrimmed.match(/para kay (.*?) ay (\d+) araw nang naghihintay/i);
      const msgEn = match
        ? `Application for ${match[1]} has been pending LGU verification for ${match[2]} day(s) after endorsement.`
        : 'Driver verification is pending final LGU review.';
      return {
        title: 'SLA Reminder: Driver Verification Pending LGU Final Review',
        message: msgEn,
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'SLA Reminder: Driver Verification Pending LGU Final Review',
        message: rawMessage,
        isSystemGenerated: true,
      };
    }
  }

  // Default: custom user-authored or non-system announcement
  return {
    title: rawTitle,
    message: rawMessage,
    isSystemGenerated: false,
  };
}
