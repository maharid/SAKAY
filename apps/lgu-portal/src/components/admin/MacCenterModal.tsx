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
import { FONT } from '../../styles/density';
import { PAGE_TEXT, dangerButtonSx, dangerOutlineButtonSx, pageFocusRing, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';

interface MacCenterModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionColor?: 'primary' | 'error' | 'success' | 'warning';
  primaryActionDisabled?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionColor?: 'inherit' | 'error' | 'primary';
  extraActions?: React.ReactNode;
  maxWidth?: number | string;
}

export const MacCenterModal: React.FC<MacCenterModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  primaryActionLabel,
  onPrimaryAction,
  primaryActionColor = 'primary',
  primaryActionDisabled = false,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionColor = 'inherit',
  extraActions,
  maxWidth = 576,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          },
        },
        paper: {
          sx: {
            borderRadius: 'var(--mac-radius-xl)',
            maxWidth: maxWidth,
            width: '100%',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            border: '1px solid var(--mac-border-color)',
            overflow: 'hidden',
            margin: '20px',
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
        <Box sx={{ pr: 1.6 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: subtitle ? '3px' : 0 }}>
            <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
              {title}
            </Typography>
            {badge}
          </Box>
          {subtitle && (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, fontWeight: 400 }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        <DialogCloseButton onClick={onClose} />
      </DialogTitle>

      {/* Modal Content */}
      <DialogContent sx={{ padding: '19px 22px 22px', pt: '19px !important' }}>
        {children}
      </DialogContent>

      {/* Modal Footer */}
      {(primaryActionLabel || secondaryActionLabel || extraActions) && (
        <DialogActions
          sx={{
            padding: '14px 22px 19px',
            borderTop: '1px solid var(--mac-border-color)',
            backgroundColor: '#FAFAFC',
            gap: 1.2,
            flexWrap: 'wrap',
            '& > :not(style) ~ :not(style)': { ml: 0 },
          }}
        >
          {secondaryActionLabel && (
            <Button
              variant="outlined"
              onClick={onSecondaryAction || onClose}
              sx={secondaryActionColor === 'error' ? dangerOutlineButtonSx : secondaryButtonSx}
            >
              {secondaryActionLabel}
            </Button>
          )}

          {extraActions}

          {primaryActionLabel && (
            <Button
              variant="contained"
              onClick={onPrimaryAction}
              color={primaryActionColor}
              disabled={primaryActionDisabled}
              sx={
                primaryActionColor === 'error'
                  ? dangerButtonSx
                  : primaryActionColor === 'warning'
                  ? { ...primaryButtonSx, backgroundColor: '#B45309', '&:hover': { backgroundColor: '#92400E', boxShadow: 'none' } }
                  : primaryButtonSx
              }
            >
              {primaryActionLabel}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
};
