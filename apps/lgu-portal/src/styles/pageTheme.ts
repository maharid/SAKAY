// Shared look of the LGU Dashboard and the Management screens (TODA Applications, Accredited TODAs, Drivers, Passengers, Vehicle Substitutions, Passenger Feedback).
// It is the TODA portal's page look (apps/toda-portal/src/components/operations/operationsTheme.ts and components/common/pageButtons.ts), so the two portals read
// as one system: ONE filled orange button for the main action, outlined buttons for everything else, red only for an action that removes or suspends something.
// Text colours here are chosen to reach 4.5:1 on white (the portal's muted grey is only about 4.2:1). Sizes come from styles/density.ts.

import { CONTROL, FONT, SPACE } from './density';

export const PAGE_BORDER = 'rgba(15, 23, 42, 0.12)';
export const PAGE_DIVIDER = 'rgba(15, 23, 42, 0.08)';

export const PAGE_TEXT = {
  primary: '#1d1d1f',
  secondary: '#4d4d52',
  brand: '#B34700',
  success: '#15803D',
  danger: '#B91C1C',
  warning: '#92400E',
} as const;

/** The white card every section sits on. */
export const pageCardSx = {
  backgroundColor: '#FFFFFF',
  border: `1px solid ${PAGE_BORDER}`,
  borderRadius: SPACE.cardRadius,
} as const;

/** A clearly visible keyboard focus ring for buttons, links and scrollable areas. */
export const pageFocusRing = {
  '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '2px' },
} as const;

/** Plain-language buttons: sentence case, the same height on every action (taller on a touch screen). */
export const pageButtonSx = {
  minHeight: CONTROL.height,
  px: '16px',
  borderRadius: CONTROL.radius,
  textTransform: 'none',
  fontSize: FONT.body,
  fontWeight: 600,
  '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
  ...pageFocusRing,
} as const;

/** The filled orange button: the one main action of a page. The fill is a deep orange so the white text stays readable (4.6:1). */
export const primaryButtonSx = {
  ...pageButtonSx,
  fontWeight: 700,
  color: '#FFFFFF',
  backgroundColor: '#C75000',
  boxShadow: 'none',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '#A84300', boxShadow: 'none' },
  '&.Mui-disabled': { color: '#FFFFFF', backgroundColor: '#E5C0A8' },
} as const;

/** The filled red button, only for an action that cannot be undone (record a strike, reject for good). The fill is dark enough for white text (6.5:1). */
export const dangerButtonSx = {
  ...pageButtonSx,
  fontWeight: 700,
  color: '#FFFFFF',
  backgroundColor: '#B91C1C',
  boxShadow: 'none',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '#991B1B', boxShadow: 'none' },
  '&.Mui-disabled': { color: '#FFFFFF', backgroundColor: '#E8B4B4' },
} as const;

/** An outlined neutral button: Refresh, Cancel, and the like. */
export const secondaryButtonSx = {
  ...pageButtonSx,
  color: PAGE_TEXT.primary,
  backgroundColor: '#FFFFFF',
  border: `1px solid ${PAGE_BORDER}`,
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' },
} as const;

type RowActionTone = 'neutral' | 'brand' | 'danger';

const ROW_ACTION_COLORS: Record<RowActionTone, { color: string; border: string; hoverBackground: string }> = {
  neutral: { color: PAGE_TEXT.primary, border: PAGE_BORDER, hoverBackground: 'var(--sakay-orange-soft)' },
  brand: { color: PAGE_TEXT.brand, border: 'var(--sakay-orange-border)', hoverBackground: 'var(--sakay-orange-soft)' },
  danger: { color: PAGE_TEXT.danger, border: 'rgba(185, 28, 28, 0.35)', hoverBackground: '#FEF2F2' },
};

/** An outlined red button for an action that removes or suspends something but can still be cancelled in the confirmation (Suspend accreditation). */
export const dangerOutlineButtonSx = {
  ...secondaryButtonSx,
  color: PAGE_TEXT.danger,
  borderColor: 'rgba(185, 28, 28, 0.35)',
  '&:hover': { backgroundColor: '#FEF2F2', borderColor: PAGE_TEXT.danger },
} as const;

/** A button inside a table row or a card: a little smaller than a page button, same type size; the colour says what kind of action it is. */
export const rowActionSx = (tone: RowActionTone = 'neutral') => ({
  minHeight: 32,
  px: '13px',
  borderRadius: CONTROL.radius,
  textTransform: 'none',
  fontSize: FONT.body,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  color: ROW_ACTION_COLORS[tone].color,
  backgroundColor: '#FFFFFF',
  border: `1px solid ${ROW_ACTION_COLORS[tone].border}`,
  boxShadow: 'none',
  '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
  '&:hover': { backgroundColor: ROW_ACTION_COLORS[tone].hoverBackground, borderColor: ROW_ACTION_COLORS[tone].color, boxShadow: 'none' },
  '&:focus-visible': { outline: `2px solid ${PAGE_TEXT.brand}`, outlineOffset: '2px' },
  '&.Mui-disabled': { color: '#8A8A90', borderColor: 'rgba(15, 23, 42, 0.12)', backgroundColor: '#F4F4F5' },
});
