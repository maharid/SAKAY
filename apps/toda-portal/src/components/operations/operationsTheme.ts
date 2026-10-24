// Shared look of the Operations Monitoring dashboard. Text colours here are chosen to reach 4.5:1 on white (3:1 for the large numbers).
// Sizes come from the portal's density scale (styles/density.ts).

import { CONTROL, FONT, SPACE } from '../../styles/density';

export const OPS_BORDER = 'rgba(15, 23, 42, 0.12)';
export const OPS_DIVIDER = 'rgba(15, 23, 42, 0.08)';

export const OPS_TEXT = {
  primary: '#1d1d1f',
  secondary: '#4d4d52',
  brand: '#B34700',
  success: '#15803D',
  danger: '#B91C1C',
} as const;

/** The white card every section sits on. */
export const opsCardSx = {
  backgroundColor: '#FFFFFF',
  border: `1px solid ${OPS_BORDER}`,
  borderRadius: SPACE.cardRadius,
} as const;

/** A clearly visible keyboard focus ring for buttons and scrollable areas. */
export const opsFocusRing = {
  '&:focus-visible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '2px' },
} as const;

/** Plain-language buttons: sentence case, the same height on every action (taller on a touch screen). */
export const opsButtonSx = {
  minHeight: CONTROL.height,
  px: '16px',
  borderRadius: CONTROL.radius,
  textTransform: 'none',
  fontSize: FONT.body,
  fontWeight: 600,
  '@media (pointer: coarse)': { minHeight: CONTROL.touchHeight },
  ...opsFocusRing,
} as const;
