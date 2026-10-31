import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Rating from '@mui/material/Rating';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import StarRoundedIcon from '@mui/icons-material/StarRounded';

export interface RateAppFormProps {
  language: 'tl' | 'en';
  /** Which app is being rated: only the wording of the invitation differs */
  audience: 'driver' | 'passenger';
  rating: number | null;
  onRatingChange: (value: number | null) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  /** The comment field's label and placeholder, in the language of the screen (the screen keeps its own copy of these two lines) */
  commentLabel: string;
  commentPlaceholder: string;
  /** Called when the form is submitted (the screen decides what happens next) */
  onSubmit: () => void;
}

const FONT = 'var(--sakay-font-family, Poppins), sans-serif';

const TEXT = {
  en: {
    title: { driver: 'How was your experience using SAKAY Driver?', passenger: 'How was your experience using SAKAY?' },
    subtitle: { driver: 'Help us improve our service for all drivers in Calapan City.', passenger: 'Help us improve our service for all of Calapan City.' },
    stars: ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'],
    submit: 'Submit rating',
    starLabel: (n: number) => `${n} ${n === 1 ? 'star' : 'stars'}`,
  },
  tl: {
    title: { driver: 'Kamusta ang iyong karanasan sa SAKAY Driver?', passenger: 'Kamusta ang iyong karanasan sa SAKAY?' },
    subtitle: { driver: 'Tulungan kaming mapabuti ang serbisyo para sa mga drayber sa Calapan City.', passenger: 'Tulungan kaming mapabuti ang serbisyo para sa buong Calapan City.' },
    stars: ['Mahina', 'Katamtaman', 'Maganda', 'Napakaganda', 'Napakahusay'],
    submit: 'Isumite ang Rating',
    starLabel: (n: number) => `${n} bituin`,
  },
} as const;

/**
 * The body of the Rate the App screen of the Driver and Passenger apps: the question, five large stars (the 48px star is a comfortable tap on a phone), the word for
 * the chosen number, an optional comment and the submit button. The screen around it keeps its own header, state and thank-you dialog; what is done with the
 * rating is unchanged.
 */
export const RateAppForm: React.FC<RateAppFormProps> = ({ language, audience, rating, onRatingChange, comment, onCommentChange, commentLabel, commentPlaceholder, onSubmit }) => {
  const t = TEXT[language];
  return (
    <Box
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}
    >
      <Paper
        elevation={0}
        sx={{ p: 3, borderRadius: '24px', backgroundColor: '#FFFFFF', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1 }}
      >
        <Box aria-hidden sx={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: '#FFF2E9', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 0.5 }}>
          <StarRoundedIcon sx={{ fontSize: 32, color: '#FF6600' }} />
        </Box>
        <Typography component="h2" sx={{ fontSize: '17px', fontWeight: 700, color: '#0F172A', fontFamily: FONT, lineHeight: 1.35 }}>
          {t.title[audience]}
        </Typography>
        <Typography sx={{ fontSize: '13px', color: '#475569', fontFamily: FONT, lineHeight: 1.5 }}>{t.subtitle[audience]}</Typography>

        <Rating
          value={rating}
          onChange={(_, value) => onRatingChange(value)}
          getLabelText={(value) => t.starLabel(value)}
          icon={<StarRoundedIcon fontSize="inherit" />}
          emptyIcon={<StarRoundedIcon fontSize="inherit" sx={{ color: '#CBD5E1' }} />}
          sx={{ mt: 1.5, color: '#FF6600', fontSize: '48px', gap: '2px', '& .MuiRating-icon': { mx: 0.25 } }}
        />
        {/* the word for the chosen number: it changes with every tap and is announced */}
        <Typography aria-live="polite" sx={{ minHeight: 24, fontSize: '15px', fontWeight: 700, color: '#B34700', fontFamily: FONT }}>
          {rating ? t.stars[Math.min(5, Math.max(1, Math.round(rating))) - 1] : ''}
        </Typography>
      </Paper>

      <TextField
        fullWidth
        multiline
        minRows={4}
        label={commentLabel}
        placeholder={commentPlaceholder}
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
      />

      <Box sx={{ mt: 'auto', pt: 1 }}>
        <Button
          type="submit"
          fullWidth
          variant="contained"
          sx={{
            backgroundColor: '#FF6600',
            color: '#FFFFFF',
            borderRadius: '14px',
            minHeight: 52,
            fontSize: '15px',
            fontWeight: 700,
            textTransform: 'none',
            fontFamily: FONT,
            whiteSpace: 'nowrap',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E65C00', boxShadow: 'none' },
          }}
        >
          {t.submit}
        </Button>
      </Box>
    </Box>
  );
};

export default RateAppForm;
