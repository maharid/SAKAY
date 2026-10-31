/**
 * The look of the quieter buttons of the trip screens, so that an action never looks like a line of text: a button has a shape, a border and a hover colour.
 * The primary action of a stage is the filled orange (or, for payment, green) button each screen already has; these two are the buttons that sit beside it.
 *   SECONDARY_BUTTON_SX    an action that is not the main one (change the pickup, withdraw a request, go to the dashboard): white, slate border and text
 *   DESTRUCTIVE_BUTTON_SX  an action that cancels, reports or refuses (the passenger did not pay, report a problem): white, red border and text
 * Use them with variant="outlined". The label stays on one line, the height is a comfortable tap (44px), and the keyboard focus ring comes from the app theme.
 */
const BASE = {
  minHeight: 44,
  borderRadius: '14px',
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '14px',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  backgroundColor: '#FFFFFF',
  fontFamily: 'var(--sakay-font-family, Poppins), sans-serif',
} as const;

export const SECONDARY_BUTTON_SX = {
  ...BASE,
  color: '#334155',
  borderColor: '#CBD5E1',
  '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#94A3B8' },
} as const;

export const DESTRUCTIVE_BUTTON_SX = {
  ...BASE,
  color: '#B91C1C',
  borderColor: '#FCA5A5',
  '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#F87171' },
} as const;
