import React, { useState } from 'react';
import {
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button,
  Box,
  TextField,
  CircularProgress,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import { dangerButtonSx, primaryButtonSx, secondaryButtonSx } from '../common/pageButtons';
import { OPS_TEXT } from '../operations/operationsTheme';
import { FONT } from '../../styles/density';

interface MacConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'orange' | 'primary';
  requireReason?: boolean;
  reasonPlaceholder?: string;
  isLoading?: boolean;
  /** Shown inside the dialog when the action failed, so the person who clicked sees why (the dialog stays open). */
  errorMessage?: string | null;
  onConfirm: (reason?: string) => void;
}

// A question with two answers. The button that confirms is the deep orange of every other main button; a red one is only for something that cannot be undone.
export const MacConfirmDialog: React.FC<MacConfirmDialogProps> = ({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  requireReason = false,
  reasonPlaceholder = 'Please enter a reason...',
  isLoading = false,
  errorMessage = null,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);

  const handleConfirm = () => {
    if (isLoading) return;
    if (requireReason && !reason.trim()) {
      setError(true);
      return;
    }
    onConfirm(reason);
    setReason('');
    setError(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="confirm-dialog-title"
      slotProps={{
        // a plain, lighter shade: this question often opens on top of another window, and two blurred layers would make the page behind it muddy
        backdrop: { sx: { backgroundColor: 'rgba(15, 23, 42, 0.32)' } },
        paper: {
          sx: {
            width: 'calc(100% - 32px)',
            maxWidth: 420,
            m: '16px',
            borderRadius: '14px',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--mac-shadow-popover)',
            border: '1px solid var(--mac-border-color)',
            padding: '6.5px',
          },
        },
      }}
    >
      <DialogTitle sx={{ padding: '16px 19px 10px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {confirmVariant === 'danger' && <WarningAmberIcon aria-hidden sx={{ color: '#B91C1C', fontSize: 19 }} />}
          <Typography id="confirm-dialog-title" component="span" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>
            {title}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ padding: '0 19px 16px' }}>
        <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.55, overflowWrap: 'anywhere', mb: requireReason ? '13px' : 0 }}>
          {message}
        </Typography>

        {errorMessage && (
          <Alert severity="error" sx={{ mt: '13px', borderRadius: '8px', fontSize: FONT.body }}>
            {errorMessage}
          </Alert>
        )}

        {requireReason && (
          <Box sx={{ mt: '13px' }}>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder={reasonPlaceholder}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(false);
              }}
              error={error}
              helperText={error ? 'Reason is required for this action' : ''}
              slotProps={{ htmlInput: { 'aria-label': 'Reason' } }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  fontSize: FONT.body,
                  backgroundColor: '#FAFAFC',
                },
              }}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ padding: '10px 19px 13px', gap: '10px' }}>
        <Button variant="outlined" onClick={onClose} sx={secondaryButtonSx}>
          {cancelLabel}
        </Button>

        <Button
          variant="contained"
          disableElevation
          disabled={isLoading}
          onClick={handleConfirm}
          sx={confirmVariant === 'danger' ? dangerButtonSx : primaryButtonSx}
        >
          {isLoading ? <CircularProgress size={16} color="inherit" aria-label="Please wait" /> : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
