import React from 'react';
import Box from '@mui/material/Box';
import logoTextWhite from '@sakay/shared/src/assets/images/webp/logo-text-white.webp';
import logoTextOrange from '@sakay/shared/src/assets/images/webp/logo-text-orange.webp';
import logoTextBlack from '@sakay/shared/src/assets/images/webp/logo-text-black.webp';

interface LogoProps {
  color?: 'white' | 'orange' | 'black';
  width?: number | string;
}

const Logo: React.FC<LogoProps> = ({ color = 'orange', width }) => {
  let logoSrc = logoTextOrange;
  if (color === 'white') logoSrc = logoTextWhite;
  if (color === 'black') logoSrc = logoTextBlack;

  const finalWidth = width || (color === 'white' ? 220 : 110);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Box
        component="img"
        src={logoSrc}
        alt="SAKAY Logo"
        sx={{
          width: typeof finalWidth === 'number' ? `${finalWidth}px` : finalWidth,
          height: 'auto',
          objectFit: 'contain',
        }}
      />
    </Box>
  );
};

export default Logo;
