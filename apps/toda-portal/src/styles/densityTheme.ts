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

const fieldInput = {
  paddingTop: `${FIELD_TOP_PADDING} !important`,
  paddingBottom: `${FIELD_BOTTOM_PADDING} !important`,
  paddingLeft: FIELD_SIDE_PADDING,
  fontSize: FONT.body,
} as const;

export const createDensityTheme = (outerTheme: Theme): Theme =>
  createTheme(outerTheme, {
    components: {
      MuiInputLabel: { styleOverrides: { root: labelPosition } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: '10px', minHeight: CONTROL.fieldHeight, fontSize: FONT.body },
          input: fieldInput,
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiInputLabel-root': labelPosition,
            '& .MuiOutlinedInput-root': {
              borderRadius: '10px',
              minHeight: CONTROL.fieldHeight,
              fontSize: FONT.body,
              '& .MuiOutlinedInput-input': fieldInput,
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
