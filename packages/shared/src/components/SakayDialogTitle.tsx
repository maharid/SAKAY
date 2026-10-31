import React from 'react';
import { Box, DialogTitle } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

import { DialogCloseButton } from './DialogCloseButton';

export interface SakayDialogTitleProps {
  /** Closes the window: shown as the X at the top right. Leave out only for a window that must not be dismissed while it works. */
  onClose?: () => void;
  /** The window is busy: the X is not offered until it ends. */
  busy?: boolean;
  id?: string;
  sx?: SxProps<Theme>;
  children: React.ReactNode;
}

/**
 * A dialog title that always carries the X. The title text keeps whatever style the dialog gave it; the X is the same one every window uses
 * (see DialogCloseButton), so a window never needs a separate "Close" button in its footer.
 */
export const SakayDialogTitle: React.FC<SakayDialogTitleProps> = ({ onClose, busy = false, id, sx, children }) => (
  <DialogTitle
    id={id}
    component="div"
    sx={[
      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
  >
    <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    {onClose && <DialogCloseButton onClick={onClose} disabled={busy} />}
  </DialogTitle>
);
