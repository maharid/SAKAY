import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CONTROL, FONT } from '../../styles/density';

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
  secondaryActionLabel = 'Close',
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
            <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-muted)', fontWeight: 400 }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: 'var(--mac-text-muted)',
            backgroundColor: 'var(--mac-canvas-bg)',
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.06)',
              color: 'var(--mac-text-primary)',
            },
          }}
        >
          <CloseIcon fontSize="small" sx={{ fontSize: '14px' }} />
        </IconButton>
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
          }}
        >
          {secondaryActionLabel && (
            <Button
              variant="outlined"
              onClick={onSecondaryAction || onClose}
              sx={{
                height: CONTROL.height,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                padding: '0 16px',
                borderRadius: '8px',
                border: '1.5px solid',
                borderColor: secondaryActionColor === 'error' ? '#EF4444' : '#94A3B8',
                color: secondaryActionColor === 'error' ? '#DC2626' : '#334155',
                fontSize: FONT.body,
                fontWeight: 600,
                textTransform: 'none',
                backgroundColor: secondaryActionColor === 'error' ? '#FEF2F2' : '#FFFFFF',
                '&:hover': {
                  backgroundColor: secondaryActionColor === 'error' ? '#FEE2E2' : '#F1F5F9',
                  borderColor: secondaryActionColor === 'error' ? '#DC2626' : '#64748B',
                  color: secondaryActionColor === 'error' ? '#B91C1C' : '#0F172A',
                },
              }}
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
              sx={{
                height: CONTROL.height,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                padding: '0 18px',
                borderRadius: '8px',
                fontSize: FONT.body,
                fontWeight: 600,
                textTransform: 'none',
                backgroundColor: primaryActionDisabled
                  ? undefined
                  : primaryActionColor === 'primary'
                  ? 'var(--sakay-orange)'
                  : primaryActionColor === 'warning'
                  ? '#D97706'
                  : undefined,
                color: '#FFFFFF',
                '&:hover': {
                  backgroundColor: primaryActionDisabled
                    ? undefined
                    : primaryActionColor === 'primary'
                    ? 'var(--sakay-orange-hover)'
                    : primaryActionColor === 'warning'
                    ? '#B45309'
                    : undefined,
                },
                '&.Mui-disabled': {
                  backgroundColor: '#E2E8F0',
                  color: '#94A3B8',
                },
              }}
            >
              {primaryActionLabel}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
};
