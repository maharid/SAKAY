// Button looks shared by the page-level tabs (Driver Verification, Driver Membership, Announcements, Reports, Audit Logs, Account). They sit on top of
// opsButtonSx (36px tall, 12px text, 44px on a touch screen, visible keyboard focus), so a button reads the same on every page: ONE filled orange button
// for the main action of a page, outlined buttons for everything else, and red only for an action that removes something or asks the LGU to suspend someone.

import { CONTROL, FONT } from '../../styles/density';
import { OPS_BORDER, OPS_TEXT, opsButtonSx } from '../operations/operationsTheme';

/** The filled orange button: the one main action of a page. The fill is a deep orange so the white text stays readable (4.6:1). */
export const primaryButtonSx = {
  ...opsButtonSx,
  fontWeight: 700,
  color: '#FFFFFF',
  backgroundColor: '#C75000',
  boxShadow: 'none',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '#A84300', boxShadow: 'none' },
  '&.Mui-disabled': { color: '#FFFFFF', backgroundColor: '#E5C0A8' },
} as const;

/** The filled red button, only for an action that cannot be undone (reject for good, delete). The fill is dark enough for white text (6.5:1). */
export const dangerButtonSx = {
  ...opsButtonSx,
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
  ...opsButtonSx,
  color: OPS_TEXT.primary,
  backgroundColor: '#FFFFFF',
  border: `1px solid ${OPS_BORDER}`,
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' },
} as const;

/** An outlined red button for an action that removes something but can still be cancelled (Discard Changes). */
export const dangerOutlineButtonSx = {
  ...secondaryButtonSx,
  color: OPS_TEXT.danger,
  borderColor: 'rgba(185, 28, 28, 0.35)',
  '&:hover': { backgroundColor: '#FEF2F2', borderColor: OPS_TEXT.danger },
} as const;

type RowActionTone = 'neutral' | 'brand' | 'danger';

const ROW_ACTION_COLORS: Record<RowActionTone, { color: string; border: string; hoverBackground: string }> = {
  neutral: { color: OPS_TEXT.primary, border: OPS_BORDER, hoverBackground: 'var(--sakay-orange-soft)' },
  brand: { color: OPS_TEXT.brand, border: 'var(--sakay-orange-border)', hoverBackground: 'var(--sakay-orange-soft)' },
  danger: { color: '#B91C1C', border: 'rgba(185, 28, 28, 0.35)', hoverBackground: '#FEF2F2' },
};

/** A button inside a table row: a little smaller than a page button, same type size, the colour says what kind of action it is. */
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
  '&:focus-visible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '2px' },
  '&.Mui-disabled': { color: '#8A8A90', borderColor: 'rgba(15, 23, 42, 0.12)', backgroundColor: '#F4F4F5' },
});

