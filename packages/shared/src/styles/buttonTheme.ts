import type { Components, Theme } from '@mui/material/styles';

/**
 * The rules every button of the Passenger and Driver apps shares (spread into both app themes, next to the field rules in inputTheme.ts).
 *
 * A label stays on ONE line: a button of a dialog (its DialogActions) never gives its text a second line. Buttons that fill the row (fullWidth) share a row while every
 * label fits, and when they do not fit side by side the next button takes the next row, full width. Dialogs that stack their buttons in a column keep their layout:
 * the row stretches its buttons across, so a stacked button is still the whole width.
 *
 * Every button shows where the keyboard is: a focus ring that does not depend on the button's colour.
 */
export const SAKAY_BUTTON_COMPONENTS: Components<Theme> = {
  MuiDialogActions: {
    styleOverrides: {
      root: {
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: 8,
        '& > :not(style) ~ :not(style)': { marginLeft: 0 },
        '& .MuiButton-root': { whiteSpace: 'nowrap', paddingLeft: 16, paddingRight: 16 },
        '& > .MuiButton-fullWidth': { flex: '1 1 auto', width: 'auto', minWidth: 'max-content' },
      },
    },
  },
  MuiButtonBase: {
    styleOverrides: {
      root: {
        '&.Mui-focusVisible': { outline: '3px solid #B34700', outlineOffset: 2 },
      },
    },
  },
};
