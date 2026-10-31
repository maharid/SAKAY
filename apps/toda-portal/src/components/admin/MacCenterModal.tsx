import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
} from '@mui/material';
import { DialogCloseButton } from '@sakay/shared';

import { CONTROL, FONT } from '../../styles/density';
import { OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';

interface MacCenterModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  primaryActionLabel?: string;
  /** the main action cannot be pressed (for example while it is being saved) */
  primaryActionDisabled?: boolean;
  onPrimaryAction?: () => void;
  primaryActionColor?: 'primary' | 'error' | 'success' | 'warning';
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  leftActionLabel?: string;
  onLeftAction?: () => void;
  /** A third action between Close and the primary one (for example "Return for Correction"). */
  middleActionLabel?: string;
  onMiddleAction?: () => void;
  maxWidth?: number | string;
}

// every footer button: the same height as the other buttons of the portal (taller on a touch screen), readable text, a clear keyboard focus ring
const footerButton = {
  height: CONTROL.height,
  padding: '0 16px',
  borderRadius: CONTROL.radius,
  fontSize: FONT.body,
  fontWeight: 600,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  '@media (pointer: coarse)': { height: CONTROL.touchHeight },
  ...opsFocusRing,
} as const;

// macos-style centered modal with blurred backdrop and action buttons
export const MacCenterModal: React.FC<MacCenterModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  primaryActionLabel,
  primaryActionDisabled = false,
  onPrimaryAction,
  primaryActionColor = 'primary',
  secondaryActionLabel,
  onSecondaryAction,
  leftActionLabel,
  onLeftAction,
  middleActionLabel,
  onMiddleAction,
  maxWidth = 576,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'blur(4px)',
          },
        },
        paper: {
          sx: {
            borderRadius: '18px',
            maxWidth: maxWidth,
            width: '100%',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            border: '1px solid var(--mac-border-color)',
            overflow: 'hidden',
            margin: '16px',
          },
        },
      }}
    >
      {/* Modal Header */}
      <DialogTitle
        sx={{
          padding: '19px 22px 16px',
          borderBottom: '1px solid var(--mac-border-color)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ pr: '13px', flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', mb: subtitle ? '4px' : 0 }}>
            <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
              {title}
            </Typography>
            {badge}
          </Box>
          {subtitle && (
            <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, fontWeight: 400 }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        <DialogCloseButton onClick={onClose} />
      </DialogTitle>

      {/* Modal Content with Explicit Top Padding */}
      <DialogContent sx={{ padding: '19px 22px 22px', pt: '19px !important' }}>
        {children}
      </DialogContent>

      {/* Modal Footer */}
      {(primaryActionLabel || secondaryActionLabel || leftActionLabel || middleActionLabel) && (
        <DialogActions
          sx={{
            padding: '14px 22px 19px',
            borderTop: '1px solid var(--mac-border-color)',
            backgroundColor: '#FAFAFC',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <Box>
            {leftActionLabel && (
              <Button
                variant="outlined"
                color="error"
                onClick={onLeftAction}
                sx={{
                  ...footerButton,
                  border: '1.5px solid #EF4444',
                  color: '#B91C1C',
                  backgroundColor: '#FFFFFF',
                  '&:hover': {
                    backgroundColor: '#FEF2F2',
                    borderColor: '#DC2626',
                  },
                }}
              >
                {leftActionLabel}
              </Button>
            )}
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', ml: 'auto' }}>
            {secondaryActionLabel && (
              <Button
                variant="outlined"
                onClick={onSecondaryAction || onClose}
                sx={{
                  ...footerButton,
                  border: '1.5px solid #94A3B8',
                  color: '#334155',
                  backgroundColor: '#FFFFFF',
                  '&:hover': {
                    backgroundColor: '#F1F5F9',
                    borderColor: '#64748B',
                    color: '#0F172A',
                  },
                }}
              >
                {secondaryActionLabel}
              </Button>
            )}

            {middleActionLabel && (
              <Button
                variant="outlined"
                onClick={onMiddleAction}
                sx={{
                  ...footerButton,
                  border: '1.5px solid #D97706',
                  color: '#92400E',
                  backgroundColor: '#FFFFFF',
                  '&:hover': { backgroundColor: '#FFFBEB', borderColor: '#B45309' },
                }}
              >
                {middleActionLabel}
              </Button>
            )}

            {primaryActionLabel && (
              <Button
                variant="contained"
                onClick={onPrimaryAction}
                color={primaryActionColor}
                disabled={primaryActionDisabled}
                sx={{
                  ...footerButton,
                  padding: '0 18px',
                  boxShadow: 'none',
                  // the same deep orange as the page buttons, so the white text stays readable
                  backgroundColor: primaryActionColor === 'primary' ? '#C75000' : undefined,
                  '&:hover': {
                    boxShadow: 'none',
                    backgroundColor: primaryActionColor === 'primary' ? '#A84300' : undefined,
                  },
                  '&.Mui-disabled': primaryActionColor === 'primary' ? { color: '#FFFFFF', backgroundColor: '#E5C0A8' } : undefined,
                }}
              >
                {primaryActionLabel}
              </Button>
            )}
          </Box>
        </DialogActions>
      )}
    </Dialog>
  );
};
