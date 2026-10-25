import React from 'react';
import { Box, Typography, Drawer, IconButton, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { CONTROL, FONT } from '../../styles/density';

interface SlideOverDetailProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const SlideOverDetail: React.FC<SlideOverDetailProps> = ({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 480, md: 540 },
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            borderLeft: '1px solid var(--mac-border-color)',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      {/* Header Bar */}
      <Box
        sx={{
          padding: '16px 19px',
          borderBottom: '1px solid var(--mac-border-color)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          backgroundColor: '#FAFAFC',
        }}
      >
        <Box sx={{ pr: 1.6 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: '3px' }}>
            <Typography sx={{ fontSize: FONT.pageTitle, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
              {title}
            </Typography>
            {badge}
          </Box>
          {subtitle && (
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            width: 32,
            height: 32,
            borderRadius: '8px',
            color: 'var(--mac-text-muted)',
            '&:hover': { backgroundColor: 'var(--mac-canvas-bg)', color: 'var(--mac-text-primary)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Main Content Area */}
      <Box sx={{ flex: 1, overflowY: 'auto', padding: '19px' }}>{children}</Box>

      {/* Action Footer Bar if Actions Provided */}
      {(primaryActionLabel || secondaryActionLabel) && (
        <Box
          sx={{
            padding: '13px 19px',
            borderTop: '1px solid var(--mac-border-color)',
            backgroundColor: '#FAFAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1.2,
          }}
        >
          {secondaryActionLabel && (
            <Button
              onClick={onSecondaryAction}
              variant="outlined"
              color="error"
              sx={{
                height: CONTROL.height,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                padding: '0 16px',
                borderRadius: '9px',
                textTransform: 'none',
                fontSize: FONT.body,
                fontWeight: 500,
                borderColor: '#FCA5A5',
                color: '#DC2626',
                '&:hover': { backgroundColor: '#FEF2F2', borderColor: '#DC2626' },
              }}
            >
              {secondaryActionLabel}
            </Button>
          )}

          {primaryActionLabel && (
            <Button
              onClick={onPrimaryAction}
              variant="contained"
              sx={{
                height: CONTROL.height,
                '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                padding: '0 16px',
                borderRadius: '9px',
                textTransform: 'none',
                fontSize: FONT.body,
                fontWeight: 600,
                backgroundColor: 'var(--sakay-orange)',
                color: '#FFFFFF',
                boxShadow: 'var(--mac-shadow-subtle)',
                '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' },
              }}
            >
              {primaryActionLabel}
            </Button>
          )}
        </Box>
      )}
    </Drawer>
  );
};
