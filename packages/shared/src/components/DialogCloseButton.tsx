import React from 'react';
import { IconButton } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';

export interface DialogCloseButtonProps {
  onClick: () => void;
  /** The dialog is busy saving: closing is not offered until it ends. */
  disabled?: boolean;
  label?: string;
  sx?: SxProps<Theme>;
}

/**
 * The one X that closes every window of the portals: same size, same soft round look, 44 px on a touch screen, a clear keyboard focus ring.
 * It sits at the top right of a dialog's header, so a window never needs a separate "Close" button in its footer.
 */
export const DialogCloseButton: React.FC<DialogCloseButtonProps> = ({ onClick, disabled = false, label = 'Close', sx }) => (
  <IconButton
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    size="small"
    sx={[
      {
        flexShrink: 0,
        width: 32,
        height: 32,
        color: '#4B5563',
        backgroundColor: 'rgba(15, 23, 42, 0.05)',
        '@media (pointer: coarse)': { width: 44, height: 44 },
        '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.1)', color: '#111827' },
        '&:focus-visible': { outline: '2px solid #C75000', outlineOffset: 2 },
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
  >
    <CloseIcon sx={{ fontSize: 16 }} />
  </IconButton>
);
