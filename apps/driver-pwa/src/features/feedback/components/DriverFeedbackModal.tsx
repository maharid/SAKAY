import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Rating as MuiRating,
  Chip,
  TextField,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';

import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import { formatShortBookingId } from '@sakay/shared';

interface DriverFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  booking?: {
    booking_id?: string;
    id?: string;
    passenger_name?: string;
    passengerName?: string;
    passenger_id?: string;
    driver_id?: string;
  } | null;
  onSubmitted?: () => void;
}

const STORAGE_KEY = 'sakay_driver_passenger_ratings';

export const DriverFeedbackModal: React.FC<DriverFeedbackModalProps> = ({
  open,
  onClose,
  booking,
  onSubmitted,
}) => {
  const { language } = useLanguage();
  const bookingId = booking?.booking_id || booking?.id || '';
  const passengerName = booking?.passenger_name || booking?.passengerName || 'Calapan Commuter';

  const [stars, setStars] = useState<number | null>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    language === 'tl' ? ['Magalang na Pasahero', 'Handa ang Sukli / Bayad'] : ['Courteous Passenger', 'Exact Payment Ready']
  );
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [thankYouOpen, setThankYouOpen] = useState(false);

  const availableTags =
    language === 'tl'
      ? ['Magalang na Pasahero', 'Handa ang Sukli / Bayad', 'Nasa Sakayan sa Oras', 'Ligtas sa Biyahe', 'Maingat sa Tricycle']
      : ['Courteous Passenger', 'Exact Payment Ready', 'On Time at Pickup', 'Safe Rider', 'Respectful of Vehicle'];

  // Check if booking already rated
  useEffect(() => {
    if (!open || !bookingId) return;

    // Check localStorage cache first
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const found = list.find((r: any) => r.bookingId === bookingId);
      if (found) {
        setAlreadyRated(true);
        setStars(found.stars || 5);
        setSelectedTags(found.tags || []);
        setComment(found.comment || '');
        return;
      }
    } catch {}

    // Check DB
    const checkDb = async () => {
      try {
        const { data } = await supabase
          .from('rating')
          .select('stars, tags, comment')
          .eq('booking_id', bookingId)
          .eq('rater_role', 'Driver')
          .maybeSingle();

        if (data) {
          setAlreadyRated(true);
          setStars(data.stars);
          setSelectedTags(data.tags || []);
          setComment(data.comment || '');
        } else {
          setAlreadyRated(false);
        }
      } catch (err) {
        console.warn('[DriverFeedbackModal] DB check error:', err);
      }
    };
    checkDb();
  }, [open, bookingId]);

  const handleToggleTag = (tag: string) => {
    if (alreadyRated) return;
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = async () => {
    if (alreadyRated) return;
    setSubmitting(true);

    const activeDriverId = localStorage.getItem('sakay_driver_id') || booking?.driver_id || 'DRV-DEMO';
    const activePassengerId = booking?.passenger_id || 'PSG-DEMO';

    const record = {
      bookingId,
      passengerName,
      stars: stars || 5,
      tags: selectedTags,
      comment: comment.trim(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };

    try {
      if (bookingId) {
        await supabase.from('rating').insert([
          {
            booking_id: bookingId,
            rater_id: activeDriverId,
            ratee_id: activePassengerId,
            rater_role: 'Driver',
            stars: stars || 5,
            tags: selectedTags,
            comment: comment.trim(),
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.warn('[DriverFeedbackModal] DB insert note:', err);
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...list]));
    } catch {}

    setSubmitting(false);
    setAlreadyRated(true);
    setThankYouOpen(true);
    if (onSubmitted) onSubmitted();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography sx={{ fontSize: '17px', fontWeight: 800, fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'I-rate ang Pasahero' : 'Rate Passenger'}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {/* Passenger Identity Card */}
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: '16px',
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              textAlign: 'center',
            }}
          >
            <Avatar
              sx={{
                width: 54,
                height: 54,
                backgroundColor: '#10B981',
                fontWeight: 800,
                fontSize: '20px',
                margin: '0 auto 8px auto',
              }}
            >
              {passengerName.charAt(0)}
            </Avatar>
            <Typography sx={{ fontSize: '16px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
              {passengerName}
            </Typography>
            <Typography sx={{ fontSize: '11.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
              Booking: {formatShortBookingId(bookingId)}
            </Typography>

            {/* Star Rating Picker */}
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#475569', fontFamily: 'Poppins, sans-serif' }}>
                {language === 'tl' ? 'Kamusta ang naging pasahero?' : 'How was your passenger?'}
              </Typography>
              <MuiRating
                value={stars}
                readOnly={alreadyRated}
                onChange={(_, val) => !alreadyRated && setStars(val)}
                size="large"
                sx={{ color: '#FF6B00', fontSize: '34px' }}
              />
            </Box>
          </Paper>

          {/* Tag Selection */}
          <Box>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A', mb: 1, fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl' ? 'Mga Positibong Katangian' : 'Passenger Compliments'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {availableTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <Chip
                    key={tag}
                    label={tag}
                    clickable={!alreadyRated}
                    onClick={() => handleToggleTag(tag)}
                    sx={{
                      fontSize: '12px',
                      fontWeight: isSelected ? 700 : 500,
                      backgroundColor: isSelected ? '#FFF8F0' : '#F1F5F9',
                      color: isSelected ? '#FF6B00' : '#475569',
                      border: isSelected ? '1px solid #FF6B00' : '1px solid transparent',
                      fontFamily: 'Poppins, sans-serif',
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* Comment / Remarks */}
          <Box>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A', mb: 0.5, fontFamily: 'Poppins, sans-serif' }}>
              {language === 'tl' ? 'Karagdagang Komento (Opsyonal)' : 'Additional Comments (Optional)'}
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={2}
              disabled={alreadyRated}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={language === 'tl' ? 'Isulat ang iyong komento...' : 'Write your comment...'}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', fontSize: '13px' } }}
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 2, pt: 0 }}>
          {alreadyRated ? (
            <Button
              fullWidth
              variant="outlined"
              onClick={onClose}
              sx={{
                borderRadius: '14px',
                height: '46px',
                borderColor: '#10B981',
                color: '#10B981',
                fontWeight: 700,
                textTransform: 'none',
              }}
            >
              ✓ {language === 'tl' ? 'Na-rate na ang Pasahero' : 'Passenger Already Rated'}
            </Button>
          ) : (
            <Button
              fullWidth
              variant="contained"
              disabled={submitting}
              onClick={handleSubmit}
              sx={{
                borderRadius: '14px',
                height: '46px',
                backgroundColor: '#FF6B00',
                color: '#FFFFFF',
                fontWeight: 700,
                textTransform: 'none',
                boxShadow: 'none',
                '&:hover': { backgroundColor: '#E05000' },
              }}
            >
              {submitting
                ? language === 'tl'
                  ? 'Ipinapadala...'
                  : 'Submitting...'
                : language === 'tl'
                ? 'Ipadala ang Rating'
                : 'Submit Rating'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Thank You Popup Dialog */}
      <Dialog
        open={thankYouOpen}
        onClose={() => setThankYouOpen(false)}
        maxWidth="xs"
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 2, textAlign: 'center' } } }}
      >
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CheckCircleIcon sx={{ fontSize: 52, color: '#10B981' }} />
          <Typography sx={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl' ? 'Salamat sa Rating!' : 'Thank You for Rating!'}
          </Typography>
          <Typography sx={{ fontSize: '13px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Nai-record na ang iyong feedback para sa pasahero. Nakatutulong ito sa pagpapanatili ng magandang serbisyo ng SAKAY.'
              : 'Your feedback for the passenger has been recorded. This helps maintain SAKAY community quality.'}
          </Typography>
          <Button
            variant="contained"
            fullWidth
            onClick={() => {
              setThankYouOpen(false);
              onClose();
            }}
            sx={{
              mt: 1,
              borderRadius: '12px',
              backgroundColor: '#FF6B00',
              fontWeight: 700,
              textTransform: 'none',
            }}
          >
            {language === 'tl' ? 'Magpatuloy' : 'Continue'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
