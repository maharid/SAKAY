import React, { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Rating, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

import { SakayToast } from './SakayToast';
import { FEEDBACK_COMMENT_MAX, feedbackProblem, submitAppFeedback } from '../utils/appFeedback';
import type { FeedbackApp } from '../utils/appFeedback';
import type { RpcCapableClient } from '../utils/restrictionUtils';

export interface AppFeedbackFormProps {
  app: FeedbackApp;
  /** The portal's database client: the feedback is sent through its submit_app_feedback function */
  client: RpcCapableClient;
  commentLabel?: string;
  commentPlaceholder?: string;
}

const newToken = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => ((Math.random() * 16) | 0).toString(16));

/**
 * The "Send feedback" form of the LGU and TODA portals: a star rating (optional) and a comment, sent to the SAKAY team through the database (not through the person's mail
 * program). While it is being sent the button says so and cannot be pressed again; if it fails the sentence says why and everything typed stays, and pressing again is safe (the
 * same attempt is saved once). When it is saved, a toast says so and the form is empty for the next one.
 */
export const AppFeedbackForm: React.FC<AppFeedbackFormProps> = ({ app, client, commentLabel = 'Comments', commentPlaceholder = 'What works well, and what could be better?' }) => {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // one reference per attempt: a retry of the same one is saved once; a new feedback gets a new reference
  const token = useRef(newToken());
  const inFlight = useRef(false);

  const touched = () => {
    setProblem(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const why = feedbackProblem(rating, comment);
    if (why) {
      setProblem(why);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const result = await submitAppFeedback(client, { app, rating, comment, token: token.current });
      if (!result.ok) {
        setProblem(result.code === 'NETWORK' ? 'The feedback could not be sent: there is no connection to the server. What you wrote is still here; try again.' : result.error ?? 'The feedback could not be sent. Please try again.');
        return;
      }
      setRating(null);
      setComment('');
      token.current = newToken();
      setSent(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Box component="form" noValidate onSubmit={submit} aria-busy={busy} sx={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' }}>
        <Box>
          <Typography id={`feedback-rating-${app}`} sx={{ fontSize: '12px', fontWeight: 600, color: '#1d1d1f' }}>
            How is your experience with this portal? <Box component="span" sx={{ fontWeight: 400, color: '#4d4d52' }}>(optional)</Box>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', mt: '6px' }}>
            <Rating
              name={`feedback-rating-${app}`}
              value={rating}
              disabled={busy}
              onChange={(_, value) => {
                setRating(value);
                touched();
              }}
              aria-labelledby={`feedback-rating-${app}`}
              sx={{ color: '#C75000', '& .MuiRating-icon': { fontSize: 32 } }}
            />
            <Typography aria-hidden sx={{ fontSize: '12px', fontWeight: 600, color: '#4d4d52', minWidth: 74 }}>
              {rating ? `${rating} out of 5` : ''}
            </Typography>
          </Box>
        </Box>
        <TextField
          label={commentLabel}
          placeholder={commentPlaceholder}
          multiline
          minRows={4}
          fullWidth
          disabled={busy}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX));
            touched();
          }}
          error={Boolean(problem) && !rating && comment.trim().length === 0}
          helperText={`${comment.length} of ${FEEDBACK_COMMENT_MAX} characters`}
          sx={{ '& .MuiOutlinedInput-root': { backgroundColor: '#FFFFFF' } }}
        />
        {problem && (
          <Alert severity="error" role="alert" sx={{ borderRadius: '8px', fontSize: '12px' }}>
            {problem}
          </Alert>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 16px', pt: '4px' }}>
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} sx={{ color: '#FFFFFF' }} /> : <SendIcon sx={{ fontSize: 18 }} />}
            sx={{ minHeight: 42, px: '22px', fontSize: '13px', textTransform: 'none', fontWeight: 700, backgroundColor: '#C75000', color: '#FFFFFF', '&:hover': { backgroundColor: '#B34700' }, '&.Mui-disabled': { backgroundColor: 'rgba(199, 80, 0, 0.6)', color: '#FFFFFF' } }}
          >
            {busy ? 'Sending...' : 'Send feedback'}
          </Button>
          <Typography sx={{ fontSize: '11.5px', color: '#4d4d52', lineHeight: 1.5, flex: '1 1 220px' }}>
            Your feedback goes to the SAKAY team with your name and role. It does not open your email program.
          </Typography>
        </Box>
      </Box>
      <SakayToast message={sent ? 'Thank you. Your feedback was sent to the SAKAY team.' : null} severity="success" onClose={() => setSent(false)} />
    </>
  );
};

export default AppFeedbackForm;
