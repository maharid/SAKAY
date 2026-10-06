import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Menu, MenuItem, Typography } from '@mui/material';
import PauseCircleOutlinedIcon from '@mui/icons-material/PauseCircleOutlined';
import PlayCircleOutlinedIcon from '@mui/icons-material/PlayCircleOutlined';

import { DRIVER_PAUSE_CHOICES_MINUTES } from '@sakay/shared';

/**
 * Pause / resume new bookings (checklist: Driver > Manage Availability).
 * The driver stays Online and keeps sending a location, but no new offer reaches them until the pause ends. The pause
 * ends by itself at the time the database set; the screen only displays it and asks the database to start or end it.
 */
interface PauseBookingsControlProps {
  language: 'tl' | 'en';
  /** ISO time the pause ends, or null while the driver is receiving bookings */
  pausedUntil: string | null;
  onPause: (minutes: number) => Promise<{ ok: boolean; message: string }>;
  onResume: () => Promise<{ ok: boolean; message: string }>;
}

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

export const PauseBookingsControl: React.FC<PauseBookingsControlProps> = ({ language, pausedUntil, onPause, onResume }) => {
  const tl = language === 'tl';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the pause runs out on the server the screen must notice without waiting for the next refresh.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pausedUntil) return;
    const left = Date.parse(pausedUntil) - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left + 250);
    return () => clearTimeout(timer);
  }, [pausedUntil]);
  const paused = !!pausedUntil && Date.parse(pausedUntil) > Date.now();

  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
      {paused ? (
        <Chip
          icon={<PlayCircleOutlinedIcon sx={{ fontSize: 18 }} />}
          label={tl ? `Naka-pause hanggang ${clock(pausedUntil as string)}. Mag-resume` : `Paused until ${clock(pausedUntil as string)}. Resume`}
          onClick={() => run(onResume)}
          disabled={busy}
          sx={{
            backgroundColor: '#FFF7ED',
            color: '#C2410C',
            fontWeight: 700,
            fontSize: '11.5px',
            border: '1px solid #FDBA74',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
          }}
        />
      ) : (
        <>
          <Button
            size="small"
            startIcon={<PauseCircleOutlinedIcon sx={{ fontSize: 18 }} />}
            onClick={(e) => setAnchor(e.currentTarget)}
            disabled={busy}
            sx={{
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '11.5px',
              borderRadius: '999px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
              px: 1.5,
              '&:hover': { backgroundColor: '#F8FAFC' },
            }}
          >
            {tl ? 'I-pause ang mga booking' : 'Pause bookings'}
          </Button>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {DRIVER_PAUSE_CHOICES_MINUTES.map((minutes) => (
              <MenuItem
                key={minutes}
                onClick={() => {
                  setAnchor(null);
                  run(() => onPause(minutes));
                }}
                sx={{ fontSize: '13px' }}
              >
                {tl ? `${minutes} minuto` : `${minutes} minutes`}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {error && (
        <Typography sx={{ fontSize: '10.5px', color: '#B91C1C', backgroundColor: '#FEF2F2', borderRadius: '8px', px: 1, py: 0.25, maxWidth: 280, textAlign: 'center' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};

export default PauseBookingsControl;
