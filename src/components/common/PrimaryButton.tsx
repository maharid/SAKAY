import React from 'react';
import Button from '@mui/material/Button';
import type { ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

interface PrimaryButtonProps extends ButtonProps {
  loading?: boolean;
}

const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  children,
  loading = false,
  disabled,
  sx,
  ...props
}) => {
  return (
    <Button
      variant="contained"
      disabled={disabled || loading}
      sx={{
        height: 56,
        fontSize: '1rem',
        fontWeight: 600,
        textTransform: 'none',
        borderRadius: '16px',
        boxShadow: '0 8px 20px rgba(255, 107, 0, 0.25)',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          boxShadow: '0 12px 28px rgba(255, 107, 0, 0.4)',
        },
        ...sx,
      }}
      {...props}
    >
      {loading ? <CircularProgress size={24} color="inherit" /> : children}
    </Button>
  );
};

export default PrimaryButton;
