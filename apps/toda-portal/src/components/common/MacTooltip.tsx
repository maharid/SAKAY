import React from 'react';
import { Tooltip, TooltipProps } from '@mui/material';

export const MacTooltip: React.FC<TooltipProps> = ({ children, ...props }) => {
  return (
    <Tooltip
      arrow
      slotProps={{
        tooltip: {
          sx: {
            backgroundColor: 'rgba(29, 29, 31, 0.92)',
            backdropFilter: 'blur(12px)',
            color: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '6.5px',
            padding: '5px 10px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
          },
        },
        arrow: {
          sx: {
            color: 'rgba(29, 29, 31, 0.92)',
          },
        },
      }}
      {...props}
    >
      {children}
    </Tooltip>
  );
};
