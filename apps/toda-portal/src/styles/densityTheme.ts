import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import { CONTROL, FONT } from './density';

// The portal's theme (main.tsx) sizes form fields for a roomier layout: 14px text in a 52px field. The signed-in part of the portal (every tab, with its modals,
// dropdowns, menus and alerts) uses the compact scale of styles/density.ts, so everything MUI draws there is brought to that scale. It is a nested theme applied by
// TodaLayout: it reaches what the layout renders (popups and dialogs opened from it included) and leaves the sign-in and registration pages as they were.

const FIELD_TOP_PADDING = '15px';
const FIELD_BOTTOM_PADDING = '3px';
const FIELD_SIDE_PADDING = '12px';

// the label sits centred in the empty field and floats to the top edge, small, once the field has a value or focus.
// It shrinks to 0.875 (a 12px label becomes 10.5px) so a floated label stays readable; MUI's own 0.75 would make it 9px.
const labelPosition = {
  fontSize: FONT.body,
  transform: `translate(${FIELD_SIDE_PADDING}, 11px) scale(1)`,
  '&.MuiInputLabel-shrink': { transform: `translate(${FIELD_SIDE_PADDING}, 4px) scale(0.875)`, maxWidth: 'calc(114% - 24px)' },
} as const;

// The tall top padding and the taller box exist to make room for the floating label, so they belong only to a field that HAS a label. The portal's theme
// (main.tsx) and this one used to give that padding to EVERY outlined field, so a field without a label (the search box and the drop-downs of the filter bars,
// the month and year pickers) had its text pushed 6-8px below the middle of the box. MUI draws the label right before the input box, which is what the
// sibling selectors below look for. A field without a label gets no top or bottom padding at all: the box is centred by flex, so the text sits in the middle
// whatever height the page gives the box (36px on a mouse, 44px on a touch screen).
const LABELLED_BOX = '.MuiInputLabel-root + &';
const LABELLED_INPUT = '.MuiInputLabel-root + .MuiOutlinedInput-root &';

const labelledPadding = {
  paddingTop: `${FIELD_TOP_PADDING} !important`,
  paddingBottom: `${FIELD_BOTTOM_PADDING} !important`,
} as const;

// the same keys as the portal's theme, so these values replace its padding and its 52px minimum for a field without a label
const plainInput = {
  paddingTop: '0px !important',
  paddingBottom: '0px !important',
  paddingLeft: FIELD_SIDE_PADDING,
  fontSize: FONT.body,
} as const;

export const createDensityTheme = (outerTheme: Theme): Theme =>
  createTheme(outerTheme, {
    components: {
      MuiInputLabel: { styleOverrides: { root: labelPosition } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: '10px', minHeight: CONTROL.height, fontSize: FONT.body, [LABELLED_BOX]: { minHeight: CONTROL.fieldHeight } },
          input: { ...plainInput, [LABELLED_INPUT]: labelledPadding },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiInputLabel-root': labelPosition,
            '& .MuiOutlinedInput-root': {
              borderRadius: '10px',
              minHeight: CONTROL.height,
              fontSize: FONT.body,
              '& .MuiOutlinedInput-input': plainInput,
            },
            '& .MuiInputLabel-root + .MuiOutlinedInput-root': {
              minHeight: CONTROL.fieldHeight,
              '& .MuiOutlinedInput-input': labelledPadding,
            },
          },
        },
      },
      MuiFormHelperText: { styleOverrides: { root: { fontSize: FONT.caption, marginTop: '3px', marginLeft: '2px', lineHeight: 1.4 } } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: FONT.body, minHeight: 32, paddingTop: 6, paddingBottom: 6 } } },
      MuiButton: {
        styleOverrides: {
          root: { fontSize: FONT.body },
          sizeSmall: { fontSize: FONT.small },
        },
      },
      MuiAlert: { styleOverrides: { root: { fontSize: FONT.body, paddingTop: 2, paddingBottom: 2 } } },
      MuiTableCell: { styleOverrides: { root: { fontSize: FONT.body }, head: { fontSize: FONT.small } } },
      MuiChip: { styleOverrides: { root: { fontSize: FONT.small } } },
      // icons that use MUI's own size names: small matches the sidebar icons
      MuiSvgIcon: { styleOverrides: { fontSizeSmall: { fontSize: 16 }, fontSizeMedium: { fontSize: 19 }, fontSizeLarge: { fontSize: 24 } } },
    },
  });
