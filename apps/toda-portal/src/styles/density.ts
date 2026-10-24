// Interface density of the TODA portal shell (sidebar, header, page padding) and the Operations Monitoring tab.
//
// The look of the dashboard at 80% browser zoom was chosen as the target for 100% zoom. These are the sizes of that look, written down once so that
// the shell, the tab, the popups and the modals all use the same scale instead of each file guessing its own numbers.
// They are NOT a blanket "x 0.8": the smallest text stops at 11px so supporting text stays readable, and controls keep a 44px touch size on touch screens.
// All values are plain CSS px; nothing here uses zoom or transform.

/** Type scale. One name per job, used everywhere the same job appears. */
export const FONT = {
  /** UPPERCASE group labels in the sidebar, letter-spaced */
  overline: '10.5px',
  /** the smallest readable text: captions, the header subtitle, timestamps */
  caption: '11px',
  /** supporting text under a number or a title, table column headings, helper lines */
  small: '11.5px',
  /** the normal text size: labels, table rows, buttons, form fields, menu items */
  body: '12px',
  /** heading inside a notice or a popup */
  heading: '13px',
  /** heading of a card with an action */
  cardTitle: '14px',
  /** heading of a list card (Driver roster, bookings) */
  sectionTitle: '15px',
  /** the page title in the header */
  pageTitle: '16px',
  /** the big number on a stat card */
  display: '32px',
} as const;

/** Sizes of the shell. */
export const SHELL = {
  headerHeight: '70px',
  sidebarWidth: 220,
  sidebarRailWidth: 60,
  pagePadding: { xs: '16px', md: '22px', lg: '26px' },
  /** the widest the page content grows on a very large screen */
  contentMaxWidth: 1280,
} as const;

/** Controls. */
export const CONTROL = {
  height: 36,
  /** fingers need more room than a mouse pointer */
  touchHeight: 44,
  radius: '8px',
  /** inside a form: the field height */
  fieldHeight: '40px',
} as const;

/** Cards and the space between sections. */
export const SPACE = {
  card: '16px 19px',
  cardLarge: '19px',
  gap: '16px',
  gapLarge: '19px',
  section: '26px',
  sectionLarge: '32px',
  cardRadius: '13px',
} as const;
