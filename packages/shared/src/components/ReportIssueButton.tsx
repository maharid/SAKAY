import React from 'react';
import Button from '@mui/material/Button';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';

export interface ReportIssueButtonProps {
  label: string;
  onClick: () => void;
  /** The screen's own icon; the warning triangle by default */
  icon?: React.ReactNode;
  /** Draws it a little smaller, for a screen that is already full (a live trip) */
  compact?: boolean;
}

/**
 * "Report an issue": the one button, with the same size, red tint, icon and spacing on the Passenger and the Driver app. It only looks and sounds the same: each app gives it its own
 * destination (the passenger's or the driver's own reporting flow) and decides when to show it.
 */
export const ReportIssueButton: React.FC<ReportIssueButtonProps> = ({ label, onClick, icon, compact = false }) => (
  <Button
    fullWidth
    startIcon={icon ?? <ReportProblemOutlinedIcon />}
    onClick={onClick}
    sx={{
      height: compact ? 44 : 48,
      borderRadius: '14px',
      backgroundColor: '#FEF2F2',
      color: '#B91C1C',
      fontWeight: 700,
      fontSize: '14px',
      textTransform: 'none',
      fontFamily: 'Poppins, sans-serif',
      '&:hover': { backgroundColor: '#FEE2E2' },
      '&:focus-visible': { outline: '2px solid #B91C1C', outlineOffset: 2 },
    }}
  >
    {label}
  </Button>
);

export default ReportIssueButton;
