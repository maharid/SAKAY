import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Typography, Button, TextField, Box, MenuItem } from '@mui/material';
import { CONTROL, FONT } from '../../styles/density';

export interface MacConfirmDialogOption {
  value: string;
  label: string;
}

interface MacConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: 'orange' | 'danger';
  requireReason?: boolean;
  reasonPlaceholder?: string;
  /** The reason must be at least this many characters once trimmed (default: any non-blank text). */
  minReasonLength?: number;
  /** Optional required choice shown above the reason (e.g. the violation being recorded). */
  options?: MacConfirmDialogOption[];
  optionLabel?: string;
  onConfirm: (reason?: string, option?: string) => void;
}

export const MacConfirmDialog: React.FC<MacConfirmDialogProps> = ({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  confirmVariant = 'orange',
  requireReason = false,
  reasonPlaceholder = 'Enter reason...',
  minReasonLength = 1,
  options,
  optionLabel = 'Select an option',
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [option, setOption] = useState('');

  const handleConfirm = () => {
    onConfirm(requireReason ? reason : undefined, options ? option : undefined);
    setReason('');
    setOption('');
  };

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
            borderRadius: 'var(--mac-radius-lg)',
            maxWidth: 420,
            width: '100%',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            overflow: 'hidden',
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          padding: '16px 19px 13px 19px',
          borderBottom: '1px solid var(--mac-border-color)',
          fontSize: FONT.cardTitle,
          fontWeight: 600,
          color: 'var(--mac-text-primary)',
          backgroundColor: '#FAFAFC',
        }}
      >
        {title}
      </DialogTitle>

      <DialogContent sx={{ paddingTop: '22px !important', paddingBottom: '16px !important', paddingLeft: '19px !important', paddingRight: '19px !important' }}>
        <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-secondary)', lineHeight: 1.5, mb: requireReason ? 1.6 : 0 }}>
          {message}
        </Typography>

        {options && (
          <Box sx={{ mt: 1.6 }}>
            <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-primary)', mb: 0.8 }}>
              {optionLabel} (Required)
            </Typography>
            <TextField
              select
              fullWidth
              size="small"
              value={option}
              onChange={(e) => setOption(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '9px', fontSize: FONT.body, backgroundColor: '#FAFAFC' } }}
            >
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value} sx={{ fontSize: FONT.body, whiteSpace: 'normal' }}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        )}

        {requireReason && (
          <Box sx={{ mt: 1.6 }}>
            <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-primary)', mb: 0.8 }}>
              Reason for Decision (Required{minReasonLength > 1 ? `, at least ${minReasonLength} characters` : ''})
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder={reasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '9px',
                  fontSize: FONT.body,
                  backgroundColor: '#FAFAFC',
                  '& fieldset': { borderColor: 'var(--mac-border-color)' },
                  '&:hover fieldset': { borderColor: 'var(--sakay-orange-border)' },
                  '&.Mui-focused fieldset': { borderColor: 'var(--sakay-orange)' },
                },
              }}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2 }}>
        <Button
          onClick={onClose}
          sx={{
            height: CONTROL.height,
            '@media (pointer: coarse)': { height: CONTROL.touchHeight },
            padding: '0 14px',
            borderRadius: '9px',
            textTransform: 'none',
            fontSize: FONT.body,
            fontWeight: 600,
            color: '#334155',
            border: '1.5px solid #94A3B8',
            backgroundColor: '#FFFFFF',
            '&:hover': {
              backgroundColor: '#F1F5F9',
              borderColor: '#64748B',
              color: '#0F172A',
            },
          }}
        >
          Cancel
        </Button>

        <Button
          onClick={handleConfirm}
          disabled={(requireReason && reason.trim().length < minReasonLength) || (Boolean(options) && !option)}
          variant="contained"
          sx={{
            height: CONTROL.height,
            '@media (pointer: coarse)': { height: CONTROL.touchHeight },
            padding: '0 16px',
            borderRadius: '9px',
            textTransform: 'none',
            fontSize: FONT.body,
            fontWeight: 600,
            backgroundColor: confirmVariant === 'danger' ? '#DC2626' : 'var(--sakay-orange)',
            color: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-subtle)',
            '&:hover': {
              backgroundColor: confirmVariant === 'danger' ? '#B91C1C' : 'var(--sakay-orange-hover)',
            },
            '&.Mui-disabled': {
              backgroundColor: '#E5E5EA',
              color: '#8E8E93',
            },
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
