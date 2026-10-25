import type { Components, Theme } from '@mui/material/styles';

/**
 * The look of every MUI text field in the Passenger and Driver apps (TextField, Select, multiline): one set of rules, used by both app themes, so a field looks and
 * lines up the same on every screen and matches the apps' own RegisterInput (the floating-label field of the sign-in and registration screens).
 *
 * The box is 62px high (a multiline box grows), the label sits inside it like a placeholder and floats to the top edge once there is a value or the field has the
 * focus, and the text sits BELOW the floating label, at the same left edge as the label (16px). A multiline box pads its text itself, so the text and the label
 * share one left edge there too (the old rules padded both the box and the textarea, which pushed the text 14px to the right of its label).
 *
 * The outline border is drawn by MUI on a <fieldset> that starts 5px above the box (room for the label notch): it is moved back onto the box (top: 0), because the box's
 * background, the border and the focus ring must all be the same rectangle.
 *
 * States: resting grey box with a light border; hover a darker border; focus a white box with the orange border and ring; filled looks like resting; error a red
 * border, ring and label (with the message under the box); disabled a flat pale box with greyed text.
 */
const BOX = '#F1F3F5';
const BOX_DISABLED = '#F1F5F9';
const BORDER = '#E2E8F0';
const BORDER_HOVER = '#CBD5E1';
const ORANGE = '#FF6600';
const ORANGE_RING = '0 0 0 3px rgba(255, 102, 0, 0.12)';
const RED = '#DC2626';
const RED_RING = '0 0 0 3px rgba(220, 38, 38, 0.12)';
const INK = '#0F172A';
const LABEL = '#64748B';
const PLACEHOLDER = '#5F6E82'; // 4.6:1 on the grey box
const DISABLED_TEXT = '#94A3B8';

export const SAKAY_INPUT_COMPONENTS: Components<Theme> = {
  MuiInputLabel: {
    styleOverrides: {
      root: {
        color: LABEL,
        fontSize: '15px',
        lineHeight: 1.4375,
        transformOrigin: 'top left',
        transform: 'translate(16px, 20px) scale(1)',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 32px)',
        '&.MuiInputLabel-shrink': {
          transform: 'translate(16px, 9px) scale(0.75)',
          fontWeight: 600,
          maxWidth: 'calc((100% - 32px) / 0.75)',
        },
        '&.Mui-focused': { color: ORANGE },
        '&.Mui-error': { color: RED },
        '&.Mui-disabled': { color: DISABLED_TEXT },
      },
    },
  },
  MuiOutlinedInput: {
    defaultProps: { notched: false },
    styleOverrides: {
      root: {
        borderRadius: 16,
        backgroundColor: BOX,
        fontSize: '15px',
        minHeight: '62px',
        padding: 0,
        transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
        '& .MuiOutlinedInput-notchedOutline': {
          // MUI draws this border 5px ABOVE the box (top: -5) to make room for the notch in the label; the notch is not used here (the label floats inside the box),
          // so the border must sit exactly on the box, or the grey background starts 5px below its own border and the focus ring floats off it
          top: 0,
          borderColor: BORDER,
          borderWidth: '1.5px',
          '& legend': { display: 'none' },
        },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: BORDER_HOVER },
        '&.Mui-focused': { backgroundColor: '#FFFFFF', boxShadow: ORANGE_RING },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: ORANGE, borderWidth: '1.5px' },
        '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: RED },
        '&.Mui-error.Mui-focused': { boxShadow: RED_RING },
        '&.Mui-disabled': { backgroundColor: BOX_DISABLED, boxShadow: 'none' },
        '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
        // a multiline box pads its own text (the textarea itself has no padding), top and left matching the single-line text
        '&.MuiInputBase-multiline': { padding: '26px 16px 12px 16px', alignItems: 'flex-start' },
      },
      input: {
        // text below the floating label, on the label's left edge; the box centres it vertically (min-height 62)
        padding: '26px 16px 8px 16px',
        height: 'auto',
        boxSizing: 'border-box',
        fontSize: '15px',
        fontWeight: 500,
        color: INK,
        '&::placeholder': { color: PLACEHOLDER, opacity: 1 },
        '&.Mui-disabled': { WebkitTextFillColor: DISABLED_TEXT, color: DISABLED_TEXT },
        // a Select shows its value in this element: room on the right for the arrow
        '&.MuiSelect-select': { paddingRight: '40px' },
        // the small size is the same box (the apps use one field height)
        '&.MuiInputBase-inputSizeSmall': { padding: '26px 16px 8px 16px' },
        // the textarea itself has no padding: its box pads it
        'textarea&': { padding: 0 },
      },
      notchedOutline: { top: 0, '& legend': { display: 'none' } },
    },
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: {
        marginLeft: 12,
        marginRight: 12,
        marginTop: 4,
        fontSize: '12px',
        lineHeight: 1.4,
        color: LABEL,
        '&.Mui-error': { color: RED, fontWeight: 600 },
      },
    },
  },
  MuiTextField: {
    defaultProps: { variant: 'outlined', fullWidth: true },
  },
};
