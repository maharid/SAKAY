import React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import RouteIcon from '@mui/icons-material/Route';

export type MapControlIcon = 'my-location' | 'route';

export interface MapControlButtonProps {
  /** What it does, for the screen reader and the tooltip ("Center on my location") */
  label: string;
  icon: MapControlIcon;
  onClick: () => void;
  /** Set when this cannot work right now ("Your location is not available"). The button stays focusable and pressable so the screen can explain. */
  unavailableReason?: string;
}

const ICONS: Record<MapControlIcon, React.ElementType> = { 'my-location': MyLocationIcon, route: RouteIcon };

const WHITE = '#FFFFFF';
const BLACK = '#0F172A';

/**
 * One round control on the map: an ACTION, never a switch. It is white with a black icon and stays so when hovered, pressed, focused or "used": nothing about it
 * says "on" (the camera it moves is shown by the map itself). It always has an accessible name, and when it cannot work it says why instead of silently doing
 * nothing (the icon is then dimmed, still black). The keyboard focus ring is a dark outline around the white circle.
 */
export const MapControlButton: React.FC<MapControlButtonProps> = ({ label, icon, onClick, unavailableReason }) => {
  const Icon = ICONS[icon];
  const unavailable = Boolean(unavailableReason);
  return (
    <IconButton
      onClick={onClick}
      disableRipple
      aria-label={unavailable ? `${label}. ${unavailableReason}` : label}
      aria-disabled={unavailable || undefined}
      title={unavailable ? unavailableReason : label}
      sx={{
        width: 44,
        height: 44,
        backgroundColor: WHITE,
        color: BLACK,
        border: '2px solid transparent',
        boxShadow: '0 4px 14px rgba(15, 23, 42, 0.18)',
        '&:hover, &:focus, &:active, &.Mui-focusVisible': { backgroundColor: WHITE, color: BLACK },
        '&.Mui-focusVisible': { outline: `3px solid ${BLACK}`, outlineOffset: 2 },
        '&:active': { transform: 'scale(0.96)' },
      }}
    >
      <Icon aria-hidden sx={{ fontSize: 22, color: BLACK, opacity: unavailable ? 0.45 : 1 }} />
    </IconButton>
  );
};

export interface MapControlStackProps {
  /** Distance from the bottom of the map (px): put it just above whatever covers the bottom, so it is never hidden behind it */
  bottom: number;
  /** Stacking order (default 12: above the map, below sheets and dialogs) */
  zIndex?: number;
  /** The group's accessible name (default "Map controls") */
  label?: string;
  children: React.ReactNode;
}

/** The right-hand column the map controls sit in, above the bottom sheet */
export const MapControlStack: React.FC<MapControlStackProps> = ({ bottom, zIndex = 12, label = 'Map controls', children }) => (
  <Box
    role="group"
    aria-label={label}
    sx={{
      position: 'absolute',
      right: 16,
      bottom,
      zIndex,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      transition: 'bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
    }}
  >
    {children}
  </Box>
);
