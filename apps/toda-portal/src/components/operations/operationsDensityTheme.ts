import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import { CONTROL, FONT } from '../../styles/density';

// The portal's theme (main.tsx) sizes form fields for a roomier layout: 14px text in a 52px field. The Operations Monitoring tab uses the compact scale
// (styles/density.ts), so everything MUI draws under this tab (the two modals, their dropdowns and menus, alerts, buttons in the panels) is brought to the
// same scale. It is a nested theme: it only reaches what the Operations page renders (popups and dialogs it opens included) and leaves the other tabs alone.

const FIELD_TOP_PADDING = '15px';
const FIELD_BOTTOM_PADDING = '3px';
const FIELD_SIDE_PADDING = '12px';

// the label sits centred in the empty field and floats to the top edge, small, once the field has a value or focus
const labelPosition = {
  fontSize: FONT.body,
  transform: `translate(${FIELD_SIDE_PADDING}, 11px) scale(1)`,
  '&.MuiInputLabel-shrink': { transform: `translate(${FIELD_SIDE_PADDING}, 5px) scale(0.75)` },
} as const;

const fieldInput = {
  paddingTop: `${FIELD_TOP_PADDING} !important`,
  paddingBottom: `${FIELD_BOTTOM_PADDING} !important`,
  paddingLeft: FIELD_SIDE_PADDING,
  fontSize: FONT.body,
} as const;

export const createOperationsTheme = (outerTheme: Theme): Theme =>
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
    },
  });
