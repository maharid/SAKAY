import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';

import PageHeader from '../../../common/components/PageHeader';
import { useLanguage } from '../../../utils/LanguageContext';
import { RateAppForm } from '@sakay/shared';

export const DriverAppFeedbackPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const isTagalog = language === 'tl';
  const [rating, setRating] = useState<number | null>(5);
  const [feedbackText, setFeedbackText] = useState('');
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);


  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FAFAFA',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PageHeader
        title={isTagalog ? 'I-rate ang App' : 'Rate the App'}
        onBack={() => navigate(-1)}
      />

      <Box className="hide-scrollbar" sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', p: 2.5, pb: 'calc(var(--safe-area-bottom) + 24px)' }}>
        <RateAppForm
          language={language === 'tl' ? 'tl' : 'en'}
          audience="driver"
          rating={rating}
          onRatingChange={setRating}
          comment={feedbackText}
          onCommentChange={setFeedbackText}
          commentLabel={isTagalog ? 'Karagdagang Komento (Opsyonal)' : 'Additional Comments (Optional)'}
          commentPlaceholder={isTagalog ? 'Isulat dito ang iyong komento o suhestiyon...' : 'Type your comment or suggestion here...'}
          onSubmit={() => setSuccessDialogOpen(true)}
        />
      </Box>

      {/* Success Dialog */}
      <Dialog
        open={successDialogOpen}
        onClose={() => {
          setSuccessDialogOpen(false);
          navigate(-1);
        }}
        slotProps={{
          paper: { sx: { borderRadius: '20px', p: 1, textAlign: 'center', width: '90%', maxWidth: '340px' } },
        }}
      >
        <DialogTitle sx={{ pt: 3 }}>
          <CheckCircleOutlinedIcon sx={{ fontSize: 56, color: '#10B981' }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', mt: 1 }}>
            {isTagalog ? 'Salamat sa Rating!' : 'Thank You for Your Rating!'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#64748B' }}>
            {isTagalog
              ? 'Ang iyong opinyon ay napakahalaga upang mas mapaganda ang serbisyo ng SAKAY Driver.'
              : 'Your feedback is essential in helping us build a better driver app.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ pb: 3, justifyContent: 'center' }}>
          <Button
            variant="contained"
            onClick={() => {
              setSuccessDialogOpen(false);
              navigate(-1);
            }}
            sx={{
              backgroundColor: '#FF6600',
              color: '#FFFFFF',
              borderRadius: '12px',
              px: 4,
              fontWeight: 700,
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
            }}
          >
            {isTagalog ? 'Bumalik' : 'Done'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverAppFeedbackPage;
