import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button } from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { StatusBadge } from '../common/StatusBadge';
import { CONTROL, FONT } from '../../styles/density';

interface TodaAppItem {
  id: string;
  name: string;
  barangay: string;
  submittedDate: string;
  status: string;
  representative: string;
  memberCount: number;
}

interface RecentTodaApplicationsCardProps {
  applications?: TodaAppItem[];
}

export const RecentTodaApplicationsCard: React.FC<RecentTodaApplicationsCardProps> = ({
  applications = [],
}) => {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        backgroundColor: 'var(--mac-card-bg)',
        borderRadius: 'var(--mac-radius-lg)',
        border: '1px solid var(--mac-border-color)',
        boxShadow: 'var(--mac-shadow-card)',
        padding: '21px 22px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header & Subtitle Block matching Recent Incident Reports */}
      <Box sx={{ mb: 1.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: FONT.cardTitle, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
              Recent TODA Applications
            </Typography>
            <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px' }}>
              Recent TODA accreditation requests.
            </Typography>
          </Box>

          <Button
            onClick={() => navigate('/toda-applications')}
            size="small"
            sx={{
              height: CONTROL.height,
              '@media (pointer: coarse)': { height: CONTROL.touchHeight },
              padding: '0 14px',
              borderRadius: '9px',
              backgroundColor: '#FFFFFF',
              color: 'var(--mac-text-primary)',
              fontSize: FONT.small,
              fontWeight: 500,
              textTransform: 'none',
              border: '1px solid var(--mac-border-color)',
              boxShadow: 'var(--mac-shadow-subtle)',
              transition: 'var(--mac-transition-fast)',
              flexShrink: 0,
              '&:hover': {
                backgroundColor: 'var(--sakay-orange-soft)',
                color: 'var(--sakay-orange)',
                borderColor: 'var(--sakay-orange-border)',
              },
            }}
          >
            View all
          </Button>
        </Box>
      </Box>

      {/* List Items or Empty State */}
      {applications.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {applications.map((app) => (
            <Box
              key={app.id}
              onClick={() => navigate('/toda-applications')}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 13px',
                borderRadius: 'var(--mac-radius-md)',
                backgroundColor: '#FAFAFC',
                border: '1px solid var(--mac-border-subtle)',
                transition: 'var(--mac-transition-fast)',
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: 'var(--mac-canvas-bg)',
                  borderColor: 'var(--mac-border-color)',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '8px',
                    backgroundColor: 'var(--mac-canvas-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--mac-text-secondary)',
                  }}
                >
                  <AccountBalanceIcon fontSize="small" />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)', lineHeight: 1.2 }}>
                    {app.name}
                  </Typography>
                  <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', lineHeight: 1.2, mt: '2px' }}>
                    Brgy. {app.barangay} • Submitted {app.submittedDate}
                  </Typography>
                </Box>
              </Box>

              <StatusBadge status={app.status as any} />
            </Box>
          ))}
        </Box>
      ) : (
        /* Empty State */
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexGrow: 1,
            py: 4,
            gap: 1.2,
          }}
        >
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '12px',
              backgroundColor: 'var(--sakay-orange-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--sakay-orange)',
            }}
          >
            <AccountBalanceIcon fontSize="medium" />
          </Box>
          <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: 'var(--mac-text-primary)' }}>
            No TODA applications yet.
          </Typography>
          <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', textAlign: 'center', maxWidth: 300 }}>
            New TODA applications will appear here after organizations submit their registration.
          </Typography>
        </Box>
      )}
    </Box>
  );
};
