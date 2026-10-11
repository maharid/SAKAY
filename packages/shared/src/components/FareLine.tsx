import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface FareLineProps {
  /** What the amount is for. Wraps onto a second line when it is long (a long Filipino label, say) */
  label: React.ReactNode;
  /** An optional quieter line under the label, e.g. "2.9 km × ₱1.00 × 4" */
  detail?: React.ReactNode;
  /** The amount, already formatted (see formatPeso). It stays on one line and keeps its width, so it is never split from its peso sign */
  amount: React.ReactNode;
  /** "total" is the line the passenger pays: larger, bolder */
  emphasis?: 'normal' | 'total';
  /** "light" for white and tinted cards, "dark" for the dark fare card */
  tone?: 'light' | 'dark';
}

const TONES = {
  light: { label: '#475569', detail: '#64748B', amount: '#0F172A', total: '#FF6600' },
  dark: { label: '#CBD5E1', detail: '#94A3B8', amount: '#FFFFFF', total: '#FFB27A' },
} as const;

/**
 * One row of a fare breakdown: the description on the left, the price on the right.
 *
 * It is a two-column grid whose right column is exactly as wide as the price, so the price can never be squeezed or wrapped
 * ("₱ / 63.00"), and the left column takes the rest and wraps. A fixed gap keeps the two apart even when the label runs long.
 * Digits are tabular, so a column of amounts lines up on the decimal point.
 */
const FareLine: React.FC<FareLineProps> = ({ label, detail, amount, emphasis = 'normal', tone = 'light' }) => {
  const c = TONES[tone];
  const total = emphasis === 'total';
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: '16px',
        alignItems: 'baseline',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="div"
          sx={{
            fontSize: total ? '15px' : '13px',
            fontWeight: total ? 700 : 500,
            lineHeight: 1.35,
            color: total ? c.amount : c.label,
            fontFamily: 'Poppins, sans-serif',
            overflowWrap: 'anywhere',
          }}
        >
          {label}
        </Typography>
        {detail && (
          <Typography
            component="div"
            sx={{ fontSize: '12px', lineHeight: 1.35, color: c.detail, fontFamily: 'Poppins, sans-serif', overflowWrap: 'anywhere' }}
          >
            {detail}
          </Typography>
        )}
      </Box>
      <Typography
        component="div"
        sx={{
          fontSize: total ? '17px' : '13px',
          fontWeight: 700,
          lineHeight: 1.35,
          color: total ? c.total : c.amount,
          fontFamily: 'Poppins, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {amount}
      </Typography>
    </Box>
  );
};

export default FareLine;
