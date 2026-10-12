import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import WifiOffIcon from '@mui/icons-material/WifiOff';

import { useConnectionLost } from '../hooks/useConnectionStatus';

export interface ConnectionLostBannerProps {
  language: string;
}

/**
 * Rule 17.4: "Connection lost — reconnecting..." for as long as this phone cannot reach the server. It is the same words in both PWAs (the
 * Filipino line under them is the translation). It sits at the top of the phone frame, above every screen, and takes no space when the
 * connection is fine. It never says a trip was cancelled or finished: the trip is the database's and is read again when the connection is back.
 */
export const ConnectionLostBanner: React.FC<ConnectionLostBannerProps> = ({ language }) => {
  const lost = useConnectionLost();
  if (!lost) return null;
  const tl = language === 'tl';
  return (
    <Box
      role="alert"
      aria-live="assertive"
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 2,
        py: 1,
        pt: 'max(8px, env(safe-area-inset-top))',
        backgroundColor: '#B91C1C',
        color: '#FFFFFF',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        fontFamily: 'Poppins, sans-serif',
      }}
    >
      <WifiOffIcon sx={{ fontSize: 20, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.25, fontFamily: 'inherit' }}>
          Connection lost — reconnecting...
        </Typography>
        <Typography sx={{ fontSize: '11.5px', fontWeight: 500, lineHeight: 1.3, opacity: 0.92, fontFamily: 'inherit' }}>
          {tl
            ? 'Nawalan ng koneksyon — nire-reconnect... Hindi nawawala ang biyahe mo; babalik ito pag may koneksyon na.'
            : 'Your trip is safe on the server; it will update when the connection is back.'}
        </Typography>
      </Box>
      <CircularProgress size={16} thickness={5} sx={{ color: '#FFFFFF', flexShrink: 0 }} />
    </Box>
  );
};

export default ConnectionLostBanner;
