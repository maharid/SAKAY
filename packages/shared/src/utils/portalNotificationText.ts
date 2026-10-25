/**
 * The words of the notification panel of the LGU and TODA portals, and of the notices the portals write themselves from their own data (an application waiting
 * for the LGU, a TODA waiting for accreditation), in English and in Tagalog. The notices the database writes are translated by localizeSystemNotification.
 * "Mga Notification" and "Markahan lahat bilang nabasa" are the Driver App's own words; the other Tagalog lines are new and are listed in the change notes for review.
 */

export type NotificationPanelLanguage = 'tl' | 'en';

const PANEL = {
  en: {
    lguTitle: 'LGU Notifications',
    todaTitle: 'TODA Notifications',
    markAll: 'Mark all as read',
    empty: 'No notifications at this time.',
    loading: 'Loading notifications...',
    failed: 'Notifications could not be loaded.',
    failedHint: 'They will be tried again in a moment.',
    unread: 'Unread',
  },
  tl: {
    lguTitle: 'Mga Notification ng LGU',
    todaTitle: 'Mga Notification ng TODA',
    markAll: 'Markahan lahat bilang nabasa',
    empty: 'Walang notification sa ngayon.',
    loading: 'Kinukuha ang mga notification...',
    failed: 'Hindi ma-load ang mga notification.',
    failedHint: 'Susubukan itong muli sa ilang sandali.',
    unread: 'Hindi pa nababasa',
  },
} as const;

export function notificationPanelText(language: NotificationPanelLanguage) {
  return PANEL[language];
}

export type PortalNoticeKind = 'resubmitted' | 'endorsed' | 'todaPending';

/** A notice the LGU portal builds from its own data: what happened (kind) and who it is about (name), in the selected language. */
export function portalNotice(kind: PortalNoticeKind, name: string | null | undefined, language: NotificationPanelLanguage): { title: string; description: string } {
  const tl = language === 'tl';
  if (kind === 'resubmitted') {
    const who = name || (tl ? 'Aplikante ng drayber' : 'Driver applicant');
    return tl
      ? { title: 'Nagsumite Muli ng Dokumento ang Drayber', description: `Nagsumite muli ng mga na-update na dokumento si ${who} para sa Stage 2 na pagsusuri.` }
      : { title: 'Driver Resubmitted Documents', description: `${who} resubmitted updated documents for Stage 2 review.` };
  }
  if (kind === 'endorsed') {
    const who = name || (tl ? 'Aplikante ng drayber' : 'Driver applicant');
    return tl
      ? { title: 'Na-endorso ang Aplikasyon ng Drayber', description: `Na-endorso ng TODA si ${who} para sa Stage 2 na inspeksyon ng LGU.` }
      : { title: 'Driver Application Endorsed', description: `${who} endorsed by TODA for Stage 2 LGU inspection.` };
  }
  const todaName = name || (tl ? 'Isang TODA' : 'A TODA');
  return tl
    ? { title: 'Nakabinbin ang Akreditasyon ng TODA', description: `Nagsumite ang ${todaName} ng aplikasyon para sa akreditasyon ng LGU.` }
    : { title: 'TODA Accreditation Pending', description: `${todaName} submitted an application for LGU accreditation.` };
}
