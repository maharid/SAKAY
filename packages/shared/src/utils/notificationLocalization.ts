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

// "(Rule 8.3)", "(Rules 12.1 / 12.2)" and "Rule 8.3:" point into the policy documents; the person reading a message does not need them.
const RULE_NUMBERS = String.raw`\d+(?:\.\d+)*(?:\s*(?:\/|,|&|and|at|-)\s*(?:(?:Rules?|Patakaran)\s+)?\d+(?:\.\d+)*)*`;
const RULE_IN_PARENTHESES = new RegExp(String.raw`\s*[(\[]\s*(?:Rules?|Patakaran)\s+${RULE_NUMBERS}\s*[)\]]`, 'gi');
const RULE_AT_START = new RegExp(String.raw`^\s*(?:Rules?|Patakaran)\s+${RULE_NUMBERS}\s*[:\-\u2013]\s*`, 'i');

/** The text without its references to numbered rules ("(Rule 8.3)"); the sentence is left as it was otherwise. */
export function stripRuleReferences(text: string): string {
  return (text ?? '').replace(RULE_IN_PARENTHESES, '').replace(RULE_AT_START, '');
}

/**
 * A message from the server or from a service, ready to show in ONE language: an "ERR_SOMETHING:" label is dropped, references to numbered rules are
 * removed, and a "Tagalog (English)" text keeps only the part in the selected language. Anything else is shown as it is.
 */
export function messageForLanguage(raw: string | null | undefined, language: 'tl' | 'en'): string {
  const text = (raw ?? '').replace(/^ERR_[A-Z0-9_]+:\s*/, '').trim();
  return cleanBilingualText(stripRuleReferences(text), language).trim();
}

/** The notification as the person should read it in `language` (system-made texts are translated; internal rule references are removed). */
export function localizeSystemNotification(
  rawTitle: string,
  rawMessage: string,
  language: 'tl' | 'en',
  notificationType?: string
): LocalizedNotificationResult {
  const result = localizeSystemNotificationBase(rawTitle, rawMessage, language, notificationType);
  return { ...result, title: stripRuleReferences(result.title), message: stripRuleReferences(result.message) };
}

function localizeSystemNotificationBase(
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

  // 8. Stall Warning (Rule 8.2) - Mixed Language fix
  if (
    type === 'STALL_WARNING' ||
    titleTrimmed.includes('Hindi ka pa gumagalaw') ||
    titleTrimmed.includes('You have not started')
  ) {
    if (language === 'en') {
      return {
        title: 'You Have Not Started Traveling',
        message: 'You have not started traveling toward the passenger. Please proceed or cancel the booking.',
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'Hindi Ka Pa Gumagalaw',
        message: 'Hindi ka pa nagsisimulang pumunta sa pasahero. Pakisimulan o ikansela ang booking.',
        isSystemGenerated: true,
      };
    }
  }

  // 9. Booking Auto Cancelled (Rule 8.3 / Rule 8.4)
  if (
    type === 'BOOKING_AUTO_CANCELLED' ||
    titleTrimmed.includes('Nakansela ang booking') ||
    titleTrimmed.includes('Booking cancelled') ||
    titleTrimmed.includes('Booking Cancelled')
  ) {
    if (language === 'en') {
      let msg = cleanBilingualText(rawMessage, 'en');
      if (msg.includes('Hindi ka nagsimulang') || msg.includes('Hindi nakapagpatuloy')) {
        msg = msg.includes('strike')
          ? 'You did not start traveling toward the passenger, so the booking was cancelled and given to another driver. One strike was recorded. You may appeal through the Exemption & Appeal process.'
          : 'Your driver was unable to proceed. We\'re finding you another driver.';
      }
      return {
        title: 'Booking Cancelled',
        message: msg,
        isSystemGenerated: true,
      };
    } else {
      let msg = cleanBilingualText(rawMessage, 'tl');
      if (msg.includes('You did not start traveling toward the passenger')) {
        msg = 'Hindi ka nagsimulang bumiyahe papunta sa pasahero, kaya nakansela ang booking at ibinigay sa ibang drayber. Naitala ang isang strike. Kung may humarang sa kalsada, aberya sa sasakyan, o GPS fault, maaari kang umapela sa pamamagitan ng proseso ng Exemption & Appeal.';
      } else if (msg.includes('You stopped on the way to the passenger for 5 minutes')) {
        msg = 'Huminto ka sa daan papunta sa pasahero nang 5 minuto nang hindi nag-uulat ng trapiko o saradong kalsada, kaya nakansela ang booking at ibinigay sa ibang drayber. Naitala ang isang strike. Maaari kang umapela sa pamamagitan ng proseso ng Exemption & Appeal.';
      } else if (msg.includes('Your driver was unable to proceed')) {
        msg = 'Hindi nakapagpatuloy ang iyong drayber. Naghahanap kami ng ibang drayber.';
      }
      return {
        title: 'Nakansela ang Booking',
        message: msg,
        isSystemGenerated: true,
      };
    }
  }

  // 10. Suspension Ended / Lifted
  if (
    type === 'SUSPENSION_ENDED' ||
    titleTrimmed.includes('Naalis ang Suspensyon') ||
    titleTrimmed.includes('Tapos na ang Suspensyon') ||
    titleTrimmed.includes('Suspension Lifted')
  ) {
    if (language === 'en') {
      return {
        title: 'Account Suspension Lifted',
        message: 'Suspension lifted after your exemption was granted.',
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'Naalis ang Suspensyon ng Iyong Account',
        message: 'Inalis ang suspensyon dahil napagbigyan ang iyong exemption.',
        isSystemGenerated: true,
      };
    }
  }

  // 11. Account Restrictions & Strikes
  if (
    type === 'ACCOUNT_RESTRICTION_NOTICE' ||
    type === 'STRIKE_ISSUED' ||
    titleTrimmed.includes('Suspendido ang Iyong Account') ||
    titleTrimmed.includes('Na-deactivate ang Iyong Account') ||
    titleTrimmed.includes('Account Suspended') ||
    titleTrimmed.includes('Account Deactivated')
  ) {
    const isSuspended = titleTrimmed.includes('Suspendido') || titleTrimmed.includes('Suspended');
    const isDeactivated = titleTrimmed.includes('Na-deactivate') || titleTrimmed.includes('Deactivated');

    if (language === 'en') {
      const titleEn = isDeactivated
        ? 'Your Account is Deactivated'
        : isSuspended
        ? 'Your Account is Suspended'
        : cleanBilingualText(rawTitle, 'en');
      return {
        title: titleEn,
        message: cleanBilingualText(rawMessage, 'en'),
        isSystemGenerated: true,
      };
    } else {
      const titleTl = isDeactivated
        ? 'Na-deactivate ang Iyong Account'
        : isSuspended
        ? 'Suspendido ang Iyong Account'
        : cleanBilingualText(rawTitle, 'tl');
      return {
        title: titleTl,
        message: cleanBilingualText(rawMessage, 'tl'),
        isSystemGenerated: true,
      };
    }
  }

  // 12. Account Reinstated
  if (
    type === 'ACCOUNT_REINSTATED' ||
    titleTrimmed.includes('Naibalik ang Iyong Account') ||
    titleTrimmed.includes('Account Reinstated')
  ) {
    if (language === 'en') {
      return {
        title: 'Your Account Has Been Reinstated',
        message: cleanBilingualText(rawMessage, 'en'),
        isSystemGenerated: true,
      };
    } else {
      return {
        title: 'Naibalik ang Iyong Account',
        message: cleanBilingualText(rawMessage, 'tl'),
        isSystemGenerated: true,
      };
    }
  }

  // Default: Check if title or message is bilingual (contains Tagalog and English)
  const cleanedTitle = cleanBilingualText(rawTitle, language);
  const cleanedMessage = cleanBilingualText(rawMessage, language);
  const hasBilingualArtifacts = cleanedTitle !== rawTitle || cleanedMessage !== rawMessage;

  return {
    title: cleanedTitle,
    message: cleanedMessage,
    isSystemGenerated: hasBilingualArtifacts,
  };
}

const TAGALOG_REGEX = /\b(ang|ng|sa|mga|na|ka|mo|ko|at|ay|iyo|inyo|inyong|drayber|pasahero|biyahe|hindi|dahil|para|isinumite|napagbigyan|mag-book|nagsisimula|nagsisimulang|gumagalaw|nakapagpatuloy|nakansela|inalis|suspensyon|paalala|abiso|ulat|kalsada|pumunta|pakisimulan|ikansela|huminto|daan|trapiko|sarado|manatiling|maingat|pagmamaneho|lisensya)\b/i;
const ENGLISH_REGEX = /\b(the|is|are|you|your|have|not|started|driver|passenger|trip|cancelled|canceled|booking|please|appeal|suspension|lifted|unable|finding|traveling|proceed|toward|stopped|delay|exemption|license|reminder|notice|warning)\b/i;

function countMatches(str: string, regex: RegExp): number {
  const matches = str.match(new RegExp(regex.source, regex.flags + 'g'));
  return matches ? matches.length : 0;
}

export function cleanBilingualText(raw: string, language: 'tl' | 'en'): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // Pattern: "TextA (TextB)"
  const match = trimmed.match(/^(.*?)\s*\(([^()]+)\)\s*$/s);
  if (!match) return trimmed;

  const part1 = match[1].trim();
  const part2 = match[2].trim();

  const part1Tl = countMatches(part1, TAGALOG_REGEX);
  const part1En = countMatches(part1, ENGLISH_REGEX);
  const part2Tl = countMatches(part2, TAGALOG_REGEX);
  const part2En = countMatches(part2, ENGLISH_REGEX);

  // If part2 has no language keywords and is short, might be a date or metadata e.g. (12 days). A short sentence ("Choose a reason.") is a translation.
  const alphaWords = part2.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;
  const sentenceLike = alphaWords >= 3 || (alphaWords >= 2 && /[.!?]$/.test(part2));
  if (part2Tl === 0 && part2En === 0 && part2.length < 25 && !sentenceLike) {
    return trimmed;
  }

  const isPart1Tagalog = part1Tl > part1En;
  const isPart2Tagalog = part2Tl > part2En;

  if (isPart1Tagalog && !isPart2Tagalog) {
    return language === 'tl' ? part1 : part2;
  }
  if (!isPart1Tagalog && isPart2Tagalog) {
    return language === 'tl' ? part2 : part1;
  }

  if (part2Tl > 0 && part1En > 0) {
    return language === 'tl' ? part2 : part1;
  }
  if (part1Tl > 0 && part2En > 0) {
    return language === 'tl' ? part1 : part2;
  }

  return language === 'tl' ? part1 : part2;
}
