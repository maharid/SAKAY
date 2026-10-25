import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Portal from '@mui/material/Portal';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

export type SakayToastSeverity = 'success' | 'info' | 'warning' | 'error';

export interface SakayToastProps {
  /** Shown while true and while there is a message (default true: the message alone decides) */
  open?: boolean;
  message: string | null;
  severity?: SakayToastSeverity;
  /** Called when the time runs out or the person presses the X. Nothing else closes the toast. */
  onClose: () => void;
  /** How long the toast stays, in milliseconds (default 4000). null or 0 means it stays until the person closes it. */
  autoHideDuration?: number | null;
  anchorOrigin?: {
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
  /** portal: the desktop portals (13px text). mobile: the Passenger and Driver apps (14px text, clear of the phone's safe areas). */
  variant?: 'portal' | 'mobile';
}

interface Look {
  background: string;
  color: string;
  track: string;
  bar: string;
  closeHover: string;
  Icon: React.ElementType;
}

// Every colour pair keeps the text at 4.5:1 or better. The icon says the kind of message too, so colour is never the only clue.
const LOOK: Record<SakayToastSeverity, Look> = {
  success: { background: '#15803D', color: '#FFFFFF', track: 'rgba(255,255,255,0.28)', bar: '#FFFFFF', closeHover: 'rgba(255,255,255,0.22)', Icon: CheckCircleOutlineIcon },
  error: { background: '#B91C1C', color: '#FFFFFF', track: 'rgba(255,255,255,0.28)', bar: '#FFFFFF', closeHover: 'rgba(255,255,255,0.22)', Icon: ErrorOutlineIcon },
  warning: { background: '#F59E0B', color: '#1A1A1A', track: 'rgba(0,0,0,0.14)', bar: '#1A1A1A', closeHover: 'rgba(0,0,0,0.12)', Icon: WarningAmberIcon },
  info: { background: '#C75000', color: '#FFFFFF', track: 'rgba(255,255,255,0.28)', bar: '#FFFFFF', closeHover: 'rgba(255,255,255,0.22)', Icon: InfoOutlinedIcon },
};

const DEFAULT_DURATION = 4000;
/**
 * The one notice that appears for a moment after something happened ("The announcement was published"). The same look and the same behaviour in the Passenger,
 * Driver, TODA and LGU apps:
 *  - it stays until its time runs out or the person presses the X (or Escape while the toast has the focus); a re-render, a click elsewhere or a keypress elsewhere
 *    never closes it;
 *  - the bar along the bottom edge is the time that is left; it stops while the pointer or the keyboard focus is on the toast, so it can be read in peace, and while
 *    the page is hidden (a toast that nobody could see does not use up its time);
 *  - screen readers hear it (errors and warnings at once, the rest politely);
 *  - with reduced motion the toast does not slide in and the bar moves in steps.
 * One countdown only, kept as a deadline on the clock (not counted frame by frame, so a slow or throttled screen cannot make it last longer): it restarts when the
 * message changes or the toast opens again. The animation frames only draw the bar; they never decide when the toast closes.
 */
export const SakayToast: React.FC<SakayToastProps> = ({
  open = true,
  message,
  severity = 'info',
  onClose,
  autoHideDuration = DEFAULT_DURATION,
  anchorOrigin,
  variant = 'portal',
}) => {
  const mobile = variant === 'mobile';
  const origin = anchorOrigin ?? (mobile ? { vertical: 'top' as const, horizontal: 'center' as const } : { vertical: 'bottom' as const, horizontal: 'right' as const });
  const visible = Boolean(open && message);
  const timed = Boolean(visible && autoHideDuration && autoHideDuration > 0);

  const barRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const controlsRef = useRef<{ pause: () => void; resume: () => void } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  // The countdown: ONE timeout closes the toast (once), and the bar is drawn from the clock, straight on the element (no re-render per frame).
  useEffect(() => {
    if (!timed || !autoHideDuration) return;
    let remaining = autoHideDuration;
    let startedAt = 0;
    let running = false;
    let timeout = 0;
    let frame = 0;
    const left = () => (running ? remaining - (performance.now() - startedAt) : remaining);
    const paint = () => {
      if (!barRef.current) return;
      const share = Math.max(0, Math.min(1, left() / autoHideDuration));
      barRef.current.style.transform = `scaleX(${reducedMotion ? Math.ceil(share * 10) / 10 : share})`;
    };
    const loop = () => {
      paint();
      if (running) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || remaining <= 0) return;
      running = true;
      startedAt = performance.now();
      timeout = window.setTimeout(() => {
        remaining = 0;
        running = false;
        cancelAnimationFrame(frame);
        paint();
        onCloseRef.current();
      }, remaining);
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!running) return;
      remaining = Math.max(0, left());
      running = false;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      paint();
    };
    // paused by the pointer or the keyboard focus, and by a hidden page
    const onVisibility = () => (document.hidden ? stop() : !pausedRef.current && start());
    controlsRef.current = { pause: stop, resume: () => !document.hidden && start() };
    document.addEventListener('visibilitychange', onVisibility);
    paint();
    if (!pausedRef.current && !document.hidden) start();
    return () => {
      running = false;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      controlsRef.current = null;
    };
  }, [timed, autoHideDuration, message, reducedMotion]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    controlsRef.current?.pause();
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    controlsRef.current?.resume();
  }, []);
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // the focus only moved inside the toast: still paused
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
    }
  };

  // a new toast starts un-paused, even if the pointer happened to be resting where the old one was
  useEffect(() => {
    pausedRef.current = false;
  }, [message, open]);

  if (!visible) return null;

  const look = LOOK[severity];
  const Icon = look.Icon;
  const urgent = severity === 'error' || severity === 'warning';
  const horizontal =
    origin.horizontal === 'center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : origin.horizontal === 'left'
      ? { left: { xs: '16px', sm: '24px' } }
      : { right: { xs: '16px', sm: '24px' } };
  const vertical =
    origin.vertical === 'top'
      ? { top: mobile ? 'calc(var(--safe-area-top, 0px) + 12px)' : '24px' }
      : { bottom: mobile ? 'calc(var(--safe-area-bottom, 0px) + 16px)' : '24px' };

  return (
    <Portal>
      <Box
        sx={{
          position: 'fixed',
          zIndex: 2000,
          width: 'calc(100% - 32px)',
          maxWidth: 420,
          pointerEvents: 'none',
          ...horizontal,
          ...vertical,
        }}
      >
        <Box
          role={urgent ? 'alert' : 'status'}
          aria-live={urgent ? 'assertive' : 'polite'}
          aria-atomic="true"
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          sx={{
            position: 'relative',
            overflow: 'hidden',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: mobile ? '12px 10px 14px 14px' : '10px 8px 13px 13px',
            borderRadius: '14px',
            backgroundColor: look.background,
            color: look.color,
            fontFamily: 'Poppins, sans-serif',
            fontSize: mobile ? '14px' : '13px',
            fontWeight: 600,
            lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.28)',
            border: severity === 'warning' ? '1px solid rgba(0, 0, 0, 0.14)' : '1px solid rgba(255, 255, 255, 0.22)',
            animation: 'sakayToastIn 160ms ease-out',
            '@keyframes sakayToastIn': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Icon aria-hidden sx={{ fontSize: mobile ? 22 : 20, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{message}</Box>
          <IconButton
            size="small"
            aria-label="Dismiss notification"
            onClick={() => onCloseRef.current()}
            sx={{
              flexShrink: 0,
              color: look.color,
              width: mobile ? 32 : 28,
              height: mobile ? 32 : 28,
              '&:hover': { backgroundColor: look.closeHover },
              '&:focus-visible': { outline: `2px solid ${look.color}`, outlineOffset: '1px' },
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>

          {/* the time that is left: full at the start, empty when the toast closes (it only says what the countdown does, so it is hidden from screen readers) */}
          {timed && (
            <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: look.track }}>
              <Box ref={barRef} sx={{ height: '100%', width: '100%', backgroundColor: look.bar, transformOrigin: 'left center', transform: 'scaleX(1)' }} />
            </Box>
          )}
        </Box>
      </Box>
    </Portal>
  );
};

export default SakayToast;
