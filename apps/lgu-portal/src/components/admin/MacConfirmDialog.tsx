import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Typography, Button, TextField, Box, MenuItem } from '@mui/material';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, dangerButtonSx, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';

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
  /** Optional date shown after the reason (e.g. when a suspension ends); onConfirm receives it as YYYY-MM-DD, or '' when left empty. */
  dateField?: { label: string; hint?: string; min?: string; max?: string };
  onConfirm: (reason?: string, option?: string, date?: string) => void;
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
  dateField,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [option, setOption] = useState('');
  const [date, setDate] = useState('');

  const handleConfirm = () => {
    onConfirm(requireReason ? reason : undefined, options ? option : undefined, dateField ? date : undefined);
    setReason('');
    setOption('');
    setDate('');
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
        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.5, mb: requireReason ? 1.6 : 0 }}>
          {message}
        </Typography>

        {options && (
          <Box sx={{ mt: 1.6 }}>
            <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.primary, mb: 0.8 }}>
              {optionLabel} (required)
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
            <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.primary, mb: 0.8 }}>
              Reason (required{minReasonLength > 1 ? `, at least ${minReasonLength} characters` : ''})
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

        {dateField && (
          <Box sx={{ mt: 1.6 }}>
            <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.primary, mb: 0.8 }}>
              {dateField.label} (optional)
            </Typography>
            <TextField
              fullWidth
              size="small"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ htmlInput: { min: dateField.min, max: dateField.max } }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '9px', fontSize: FONT.body, backgroundColor: '#FAFAFC' } }}
            />
            {dateField.hint && (
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: 0.6, lineHeight: 1.4 }}>{dateField.hint}</Typography>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ padding: '13px 19px', borderTop: '1px solid var(--mac-border-color)', backgroundColor: '#FAFAFC', gap: 1.2, flexWrap: 'wrap', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
        <Button onClick={onClose} sx={secondaryButtonSx}>
          Cancel
        </Button>

        <Button
          onClick={handleConfirm}
          disabled={(requireReason && reason.trim().length < minReasonLength) || (Boolean(options) && !option)}
          variant="contained"
          sx={confirmVariant === 'danger' ? dangerButtonSx : primaryButtonSx}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
