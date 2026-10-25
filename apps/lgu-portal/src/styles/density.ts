// Interface density of the LGU portal: the SAME scale as the TODA portal (apps/toda-portal/src/styles/density.ts), so the two admin portals read alike.
//
// The scale is "the look at 80% browser zoom, at 100% zoom": every size is about 0.8 of the roomy one, written down once so that the shell, the pages, the popups and the
// modals use the same numbers instead of each file guessing its own. It is NOT a blanket x0.8: the smallest text stops at 11px so supporting text stays readable, and
// controls keep a 44px touch size on touch screens. All values are plain CSS px; nothing here uses zoom or transform.

/** Type scale. One name per job, used everywhere the same job appears. */
export const FONT = {
  /** UPPERCASE group labels in the sidebar, letter-spaced */
  overline: '10.5px',
  /** the smallest readable text: captions, the header subtitle, timestamps, badges */
  caption: '11px',
  /** supporting text under a number or a title, table column headings, helper lines */
  small: '11.5px',
  /** the normal text size: labels, table rows, buttons, form fields, menu items */
  body: '12px',
  /** heading inside a notice or a popup */
  heading: '13px',
  /** heading of a card with an action */
  cardTitle: '14px',
  /** heading of a list card */
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
