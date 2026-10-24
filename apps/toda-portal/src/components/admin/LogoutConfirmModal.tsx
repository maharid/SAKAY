import React from 'react';
import { Box, Typography, Button, Dialog } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';

interface LogoutConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderRadius: '13px',
            padding: '19px',
            maxWidth: '336px',
            width: '100%',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.16)',
            border: '1px solid var(--mac-border-color)',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: '10px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: '13px',
          }}
        >
          <LogoutIcon fontSize="medium" />
        </Box>

        <Typography variant="h6" sx={{ fontSize: '14px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '6px' }}>
          Log out?
        </Typography>

        <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', lineHeight: 1.4, mb: '19px' }}>
          Are you sure you want to log out of the SAKAY TODA Administrator Portal?
        </Typography>

        <Box sx={{ display: 'flex', gap: '10px', width: '100%' }}>
          <Button
            fullWidth
            variant="outlined"
            onClick={onClose}
            sx={{
              height: 34,
              borderRadius: '8px',
              borderColor: 'var(--mac-border-color)',
              color: 'var(--mac-text-primary)',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '11.5px',
              '&:hover': {
                backgroundColor: 'var(--mac-canvas-bg)',
                borderColor: 'var(--mac-border-color)',
              },
            }}
          >
            Cancel
          </Button>

          <Button
            fullWidth
            variant="contained"
            color="error"
            onClick={onConfirm}
            sx={{
              height: 34,
              borderRadius: '8px',
              backgroundColor: '#DC2626',
              color: '#FFFFFF',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '11.5px',
              boxShadow: 'none',
              '&:hover': {
                backgroundColor: '#B91C1C',
                boxShadow: 'none',
              },
            }}
          >
            Log Out
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};
