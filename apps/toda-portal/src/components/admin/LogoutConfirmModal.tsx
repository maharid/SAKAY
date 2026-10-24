import React from 'react';
import { Box, Typography, Button, Dialog } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';

import { dangerButtonSx, secondaryButtonSx } from '../common/pageButtons';
import { OPS_TEXT } from '../operations/operationsTheme';
import { FONT } from '../../styles/density';

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
      aria-labelledby="logout-confirm-title"
      slotProps={{
        paper: {
          sx: {
            borderRadius: '13px',
            padding: '19px',
            maxWidth: '352px',
            width: 'calc(100% - 32px)',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.16)',
            border: '1px solid var(--mac-border-color)',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Box
          aria-hidden
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: '13px',
          }}
        >
          <LogoutIcon fontSize="medium" />
        </Box>

        <Typography id="logout-confirm-title" component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary, mb: '6px' }}>
          Log out?
        </Typography>

        <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.5, mb: '19px' }}>
          Are you sure you want to log out of the SAKAY TODA Administrator Portal?
        </Typography>

        <Box sx={{ display: 'flex', gap: '10px', width: '100%' }}>
          <Button fullWidth variant="outlined" onClick={onClose} autoFocus sx={secondaryButtonSx}>
            Cancel
          </Button>

          <Button fullWidth variant="contained" disableElevation onClick={onConfirm} sx={dangerButtonSx}>
            Log Out
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};
