// One look for the shared modals (Report a driver, End a trip for safety) so they match: same corners, spacing, title and text sizes.
// Plain style objects for MUI's `sx`; the sizes follow the compact dashboard scale (body text 12px, small text 11.5px, title 14px).

export const DIALOG_PAPER_SX = {
  borderRadius: '13px',
  // a little breathing room from the screen edge on a phone; the paper never exceeds the screen and its content area scrolls
  m: { xs: '16px', sm: '32px' },
  width: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
  maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
} as const;

export const DIALOG_TITLE_SX = { fontWeight: 700, fontSize: '14px', px: '19px', pt: '16px', pb: '6px' } as const;

export const DIALOG_CONTENT_SX = { display: 'flex', flexDirection: 'column', gap: '13px', px: '19px', pt: '8px !important', pb: '16px' } as const;

export const DIALOG_INTRO_SX = { fontSize: '11.5px', color: '#475569', lineHeight: 1.5 } as const;

export const DIALOG_ACTIONS_SX = { px: '19px', pb: '16px', pt: '4px', gap: '6px' } as const;

/**
 * A dropdown whose chosen option can be a full sentence: it wraps inside the field instead of being cut with "...".
 * Set as an inline style on the shown value, so it does not depend on which style rule MUI happens to apply last.
 */
export const WRAPPING_SELECT_SLOTS = { select: { SelectDisplayProps: { style: { whiteSpace: 'normal' as const } } } };

/** The "nothing to choose" line inside an opened dropdown: plain text, not a selectable record. */
export const EMPTY_OPTION_SX = {
  display: 'block',
  whiteSpace: 'normal',
  cursor: 'default',
  color: '#475569',
  fontSize: '12px',
  lineHeight: 1.5,
  opacity: '1 !important',
  '&.Mui-disabled': { opacity: 1 },
} as const;
