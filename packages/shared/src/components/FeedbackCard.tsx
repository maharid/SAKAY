import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface FeedbackCardProps {
  /** The icon in the tile at the top left (about 20px) */
  icon: React.ReactNode;
  title: string;
  /** One plain sentence under the title */
  description?: string;
  /** The form (or whatever belongs in the section) */
  children: React.ReactNode;
}

/**
 * The frame of the "Send feedback" section of a Settings page, the same in the LGU and the TODA portal: one soft card with an icon tile, a heading, one sentence of
 * what it is for, and the form under a thin line. It is only the frame; each portal puts its own form and its own buttons inside, so what the form does is unchanged.
 * The colours and sizes are those of the portals' page theme (their text and border colours, the 12px body text).
 */
export const FeedbackCard: React.FC<FeedbackCardProps> = ({ icon, title, description, children }) => {
  const headingId = React.useId();
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{ width: '100%', border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: '14px', backgroundColor: '#FAFAF8', overflow: 'hidden' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', p: '16px 20px', borderBottom: '1px solid rgba(15, 23, 42, 0.08)', backgroundColor: '#FFFFFF' }}>
        <Box
          aria-hidden
          sx={{ width: 38, height: 38, flexShrink: 0, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--sakay-orange-soft, #FFF1E4)', color: '#B34700', '& .MuiSvgIcon-root': { fontSize: 22 } }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography id={headingId} component="h3" sx={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f', lineHeight: 1.35 }}>
            {title}
          </Typography>
          {description && <Typography sx={{ fontSize: '12px', color: '#4d4d52', lineHeight: 1.5, mt: '1px' }}>{description}</Typography>}
        </Box>
      </Box>
      <Box sx={{ p: '18px 20px 20px' }}>{children}</Box>
    </Box>
  );
};

export default FeedbackCard;
