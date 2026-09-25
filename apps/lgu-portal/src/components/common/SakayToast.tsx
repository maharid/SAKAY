import React, { useEffect, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

export interface SakayToastProps {
  open: boolean;
  message: string | null;
  severity?: 'success' | 'info' | 'warning' | 'error';
  onClose: () => void;
  autoHideDuration?: number;
  anchorOrigin?: {
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
}

export const SakayToast: React.FC<SakayToastProps> = ({
  open,
  message,
  severity = 'info',
  onClose,
  autoHideDuration = 4000,
  anchorOrigin = { vertical: 'bottom', horizontal: 'right' },
}) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (open) {
      setProgress(100);
      const timer = setTimeout(() => {
        setProgress(0);
      }, 50);

      return () => clearTimeout(timer);
    } else {
      setProgress(100);
    }
  }, [open, message, autoHideDuration]);

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    onClose();
  };

  if (!message) return null;

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={handleClose}
      anchorOrigin={anchorOrigin}
      sx={{
        zIndex: 9999,
        width: 'calc(100% - 32px)',
        maxWidth: '420px',
        position: 'fixed',
        right: anchorOrigin.horizontal === 'right' ? '24px !important' : undefined,
        left: anchorOrigin.horizontal === 'center' ? '50% !important' : anchorOrigin.horizontal === 'left' ? '24px !important' : 'auto !important',
        transform: anchorOrigin.horizontal === 'center' ? 'translateX(-50%) !important' : 'none !important',
        bottom: anchorOrigin.vertical === 'bottom' ? '24px !important' : 'auto !important',
        top: anchorOrigin.vertical === 'top' ? '24px !important' : 'auto !important',
      }}
    >
      <Alert
        severity={severity}
        variant="filled"
        action={
          <IconButton
            size="small"
            aria-label="close"
            color="inherit"
            onClick={onClose}
            sx={{ p: 0.5 }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        }
        sx={{
          width: '100%',
          borderRadius: '14px',
          fontFamily: 'Poppins, sans-serif',
          fontSize: '13px',
          fontWeight: 600,
          boxShadow: '0 6px 20px rgba(15, 23, 42, 0.2)',
          position: 'relative',
          overflow: 'hidden',
          pr: 1,
          alignItems: 'center',
        }}
      >
        <Box sx={{ pr: 1 }}>{message}</Box>

        {/* Animated Progress Timer Bar */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '3px',
            width: `${progress}%`,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            transition: open ? `width ${autoHideDuration}ms linear` : 'none',
          }}
        />
      </Alert>
    </Snackbar>
  );
};

export default SakayToast;
