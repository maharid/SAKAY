import React, { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/material/styles';

export interface OtpVerifiedCelebrationProps {
  language: 'tl' | 'en';
  /**
   * Called ONCE, when the celebration has been on screen for `durationMs` (the screen moves on by itself: no button). It is not called again by a
   * re-render, and not at all when the screen goes away first.
   */
  onDone: () => void;
  /** How long the celebration stays (default 1800 ms; 1200 ms for people who asked for reduced motion) */
  durationMs?: number;
}

const GREEN = '#15803D';
const ORANGE = '#FF6600';

const TEXT = {
  en: { title: 'Mobile number verified successfully!', sub: 'Continuing to the next step…' },
  tl: { title: 'Matagumpay na na-verify ang mobile number!', sub: 'Magpapatuloy na sa susunod na hakbang…' },
} as const;

const popIn = keyframes`
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;
const drawCheck = keyframes`
  from { stroke-dashoffset: 30; }
  to { stroke-dashoffset: 0; }
`;
const ringOut = keyframes`
  0% { transform: scale(0.8); opacity: 0.45; }
  100% { transform: scale(1.7); opacity: 0; }
`;
const burst = keyframes`
  0% { transform: translate(0, 0) scale(0.4); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0; }
`;
const rise = keyframes`
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

// Ten small dots flying out of the check, once: where each one ends up (px from the centre) and its colour. Few, small and short on purpose.
const DOTS = [
  { dx: 0, dy: -86, color: ORANGE },
  { dx: 62, dy: -62, color: '#FBBF24' },
  { dx: 88, dy: 0, color: GREEN },
  { dx: 62, dy: 62, color: ORANGE },
  { dx: 0, dy: 88, color: '#FBBF24' },
  { dx: -62, dy: 62, color: GREEN },
  { dx: -88, dy: 0, color: ORANGE },
  { dx: -62, dy: -62, color: '#FBBF24' },
  { dx: 36, dy: -80, color: GREEN },
  { dx: -38, dy: 80, color: ORANGE },
];

const reduced = '@media (prefers-reduced-motion: reduce)';

/**
 * What the Passenger and Driver apps show for a moment after the server accepted the mobile-number code: a check, a short message and a brief burst of
 * dots, then the screen moves on to the next step by itself. It is drawn only AFTER the verification succeeded (the screens mount it from the successful
 * answer), covers the whole screen so nothing behind it can be tapped, and is announced to screen readers. With reduced motion there is no movement at all.
 */
export const OtpVerifiedCelebration: React.FC<OtpVerifiedCelebrationProps> = ({ language, onDone, durationMs }) => {
  const t = TEXT[language];
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // One timer for the whole life of this overlay: mounting it starts the wait, unmounting it cancels it, a re-render does neither
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => onDoneRef.current(), durationMs ?? (reduceMotion ? 1200 : 1800));
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 10000,
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2.5,
        px: 3,
        textAlign: 'center',
      }}
    >
      <Box aria-hidden sx={{ position: 'relative', width: 104, height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* one soft ring that spreads and fades */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `3px solid ${GREEN}`,
            animation: `${ringOut} 900ms ease-out 200ms both`,
            [reduced]: { display: 'none' },
          }}
        />
        {DOTS.map((dot, index) => (
          <Box
            key={index}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: index % 3 === 0 ? 9 : 7,
              height: index % 3 === 0 ? 9 : 7,
              mt: index % 3 === 0 ? '-4.5px' : '-3.5px',
              ml: index % 3 === 0 ? '-4.5px' : '-3.5px',
              borderRadius: '50%',
              backgroundColor: dot.color,
              '--dx': `${dot.dx}px`,
              '--dy': `${dot.dy}px`,
              opacity: 0,
              animation: `${burst} 950ms ease-out ${260 + index * 20}ms both`,
              [reduced]: { display: 'none' },
            }}
          />
        ))}
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            backgroundColor: GREEN,
            boxShadow: '0 10px 28px rgba(21, 128, 61, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: `${popIn} 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both`,
            [reduced]: { animation: 'none' },
          }}
        >
          <Box component="svg" viewBox="0 0 48 48" sx={{ width: 52, height: 52 }}>
            <Box
              component="path"
              d="M12 25.5 L21 34 L37 15"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              sx={{
                strokeDasharray: 30,
                strokeDashoffset: 0,
                animation: `${drawCheck} 380ms ease-out 260ms both`,
                [reduced]: { animation: 'none' },
              }}
            />
          </Box>
        </Box>
      </Box>

      <Box sx={{ animation: `${rise} 400ms ease-out 350ms both`, [reduced]: { animation: 'none' } }}>
        <Typography component="h1" sx={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3, fontFamily: 'Poppins, sans-serif', overflowWrap: 'anywhere' }}>
          {t.title}
        </Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 500, color: '#475569', mt: 0.75, lineHeight: 1.5, fontFamily: 'Poppins, sans-serif' }}>{t.sub}</Typography>
      </Box>
    </Box>
  );
};

export default OtpVerifiedCelebration;
