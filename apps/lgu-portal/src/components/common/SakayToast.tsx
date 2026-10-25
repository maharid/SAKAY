import React, { useEffect, useState, useRef, useCallback } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { FONT } from '../../styles/density';

export interface SakayToastProps {
  open: boolean;
  message: string | null;
  severity?: 'success' | 'info' | 'warning' | 'error';
  onClose: () => void;
  autoHideDuration?: number | null;
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
  const hasTimer = Boolean(open && message && autoHideDuration && autoHideDuration > 0);
  const [remainingMs, setRemainingMs] = useState<number>(autoHideDuration ?? 0);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const remainingRef = useRef<number>(autoHideDuration ?? 0);
  const lastTimeRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Detect reduced-motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);

  // Synchronized countdown timer driven by requestAnimationFrame with tick throttling
  useEffect(() => {
    if (!open || !message || !autoHideDuration || autoHideDuration <= 0) {
      setRemainingMs(0);
      remainingRef.current = 0;
      isPausedRef.current = false;
      setIsPaused(false);
      return;
    }

    remainingRef.current = autoHideDuration;
    setRemainingMs(autoHideDuration);
    isPausedRef.current = false;
    setIsPaused(false);
    lastTimeRef.current = performance.now();

    let animId: number;
    let lastRender = 0;

    const tick = (now: number) => {
      if (isPausedRef.current) {
        lastTimeRef.current = now;
        animId = requestAnimationFrame(tick);
        return;
      }

      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;
      remainingRef.current = Math.max(0, remainingRef.current - delta);

      if (now - lastRender >= 25 || remainingRef.current <= 0) {
        setRemainingMs(remainingRef.current);
        lastRender = now;
      }

      if (remainingRef.current <= 0) {
        onCloseRef.current();
        return;
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [open, message, autoHideDuration]);

  const handleMouseEnter = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    lastTimeRef.current = performance.now();
    isPausedRef.current = false;
    setIsPaused(false);
  }, []);

  const handleFocus = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
  }, []);

  const handleBlur = useCallback(() => {
    lastTimeRef.current = performance.now();
    isPausedRef.current = false;
    setIsPaused(false);
  }, []);

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    onClose();
  };

  if (!message) return null;

  const isBrandInfo = severity === 'info';
  const isWarning = severity === 'warning';

  const getBackgroundColor = () => {
    switch (severity) {
      case 'success':
        return '#10B981';
      case 'warning':
        return '#F59E0B';
      case 'error':
        return '#EF4444';
      case 'info':
      default:
        return '#FF6600';
    }
  };

  const getTextColor = () => {
    if (isBrandInfo || isWarning) {
      return '#1A1A1A';
    }
    return '#FFFFFF';
  };

  const progressPercent =
    hasTimer && autoHideDuration && autoHideDuration > 0
      ? Math.max(0, Math.min(100, (remainingMs / autoHideDuration) * 100))
      : 0;

  return (
    <Snackbar
      open={open}
      autoHideDuration={null}
      onClose={handleClose}
      anchorOrigin={anchorOrigin}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
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
            onClick={onClose}
            sx={{
              p: 0.4,
              color: getTextColor(),
              backgroundColor: isBrandInfo || isWarning ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.2)',
              borderRadius: '50%',
              '&:hover': {
                backgroundColor: isBrandInfo || isWarning ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.3)',
              },
            }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        }
        sx={{
          width: '100%',
          borderRadius: '14px',
          fontFamily: 'Poppins, sans-serif',
          fontSize: FONT.caption,
          fontWeight: 600,
          backgroundColor: `${getBackgroundColor()} !important`,
          color: `${getTextColor()} !important`,
          boxShadow: isBrandInfo ? '0 6px 20px rgba(255, 102, 0, 0.3)' : '0 6px 20px rgba(15, 23, 42, 0.2)',
          position: 'relative',
          overflow: 'hidden',
          pr: 0.8,
          alignItems: 'center',
          border: isBrandInfo || isWarning ? '1px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(255, 255, 255, 0.25)',
          '& .MuiAlert-icon': {
            color: `${getTextColor()} !important`,
          },
        }}
      >
        <Box sx={{ pr: 0.8 }}>{message}</Box>

        {/* Synchronized Progress Timer Bar */}
        {hasTimer && (
          <Box
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Notification display duration"
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: '3px',
              width: `${progressPercent}%`,
              backgroundColor: isBrandInfo || isWarning ? 'rgba(26, 26, 26, 0.45)' : 'rgba(255, 255, 255, 0.75)',
              borderRadius: '0 999px 999px 0',
              transition: prefersReducedMotion ? 'none' : isPaused ? 'none' : 'width 25ms linear',
            }}
          />
        )}
      </Alert>
    </Snackbar>
  );
};

export default SakayToast;
