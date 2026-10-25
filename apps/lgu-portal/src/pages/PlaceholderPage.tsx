import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ConstructionIcon from '@mui/icons-material/Construction';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { CONTROL, FONT } from '../styles/density';

interface PlaceholderPageProps {
  title: string;
  subtitle: string;
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title, subtitle }) => {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        backgroundColor: 'var(--mac-card-bg)',
        borderRadius: 'var(--mac-radius-lg)',
        border: '1px solid var(--mac-border-color)',
        boxShadow: 'var(--mac-shadow-card)',
        padding: '32px 19px',
        textAlign: 'center',
        maxWidth: 700,
        margin: '16px auto',
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: '16px',
          backgroundColor: 'var(--sakay-orange-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--sakay-orange)',
          mb: 2,
        }}
      >
        <ConstructionIcon sx={{ fontSize: '26px' }} />
      </Box>

      <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '19px', color: 'var(--mac-text-primary)', mb: 0.8 }}>
        {title}
      </Typography>

      <Typography sx={{ fontSize: FONT.small, color: 'var(--mac-text-secondary)', mb: 2.4, maxWidth: 460 }}>
        {subtitle}
      </Typography>

      <Box
        sx={{
          backgroundColor: 'var(--mac-warning-bg)',
          color: 'var(--mac-warning-text)',
          fontSize: FONT.caption,
          fontWeight: 600,
          padding: '5px 13px',
          borderRadius: '12px',
          mb: 2.4,
        }}
      >
        Routing & Page Shell Ready for Step 2 Implementation
      </Box>

      <Button
        onClick={() => navigate('/dashboard')}
        startIcon={<ArrowBackIcon fontSize="small" />}
        sx={{
          height: CONTROL.height,
          '@media (pointer: coarse)': { height: CONTROL.touchHeight },
          padding: '0 14px',
          borderRadius: '8px',
          backgroundColor: 'var(--sakay-orange)',
          color: '#FFFFFF',
          fontSize: FONT.body,
          fontWeight: 600,
          textTransform: 'none',
          '&:hover': {
            backgroundColor: 'var(--sakay-orange-hover)',
          },
        }}
      >
        Return to Dashboard
      </Button>
    </Box>
  );
};

