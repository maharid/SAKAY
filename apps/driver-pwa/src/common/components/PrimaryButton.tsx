import React from 'react';
import Button from '@mui/material/Button';
import type { ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

interface PrimaryButtonProps extends ButtonProps {
  /** Shows a spinner in place of the label and ignores presses while something is being saved */
  loading?: boolean;
  /** Words to show beside the spinner while loading ("Preparing..."); without it the spinner stands alone */
  loadingLabel?: string;
}

/**
 * The one filled orange button of a screen. States: rest, pressed (a shade deeper), loading (spinner, not pressable, announced as busy),
 * disabled (quiet grey that is still readable). The keyboard focus ring comes from globals.css.
 */
const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  children,
  loading = false,
  loadingLabel,
  disabled,
  sx,
  ...props
}) => {
  return (
    <Button
      variant="contained"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      sx={{
        minHeight: 54,
        px: 3,
        fontSize: '1rem',
        fontWeight: 700,
        lineHeight: 1.25,
        textTransform: 'none',
        borderRadius: '16px',
        backgroundColor: '#FF6600',
        color: '#1A1A1A',
        boxShadow: 'none',
        transition: 'background-color 0.15s ease-in-out, transform 0.1s ease-in-out',
        '&:hover': {
          backgroundColor: '#E65C00',
          boxShadow: 'none',
        },
        '&:active': {
          backgroundColor: '#CC5500',
          transform: 'scale(0.985)',
          boxShadow: 'none',
        },
        // loading keeps the orange fill (work is happening); only a button that cannot be pressed for a reason goes quiet grey
        '&.Mui-disabled': loading
          ? { backgroundColor: '#FF6600', color: '#1A1A1A' }
          : { backgroundColor: '#E2E8F0', color: '#64748B' },
        ...sx,
      }}
      {...props}
    >
      {loading ? (
        loadingLabel ? (
          <>
            <CircularProgress size={20} color="inherit" aria-hidden sx={{ mr: 1.25 }} />
            {loadingLabel}
          </>
        ) : (
          <CircularProgress size={24} color="inherit" aria-label="Loading" />
        )
      ) : (
        children
      )}
    </Button>
  );
};

export default PrimaryButton;
