import React, { useState } from 'react';
import { Alert, Box, Button, Rating, TextField, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlinedIcon from '@mui/icons-material/MailOutlined';
import SendIcon from '@mui/icons-material/Send';

import { SettingRow } from '../common/SettingRow';
import { primaryButtonSx, secondaryButtonSx } from '../common/pageButtons';
import { OPS_TEXT } from '../operations/operationsTheme';
import { ACCREDITATION_HELP, SUPPORT_EMAIL } from '../../utils/appInfo';
import { copyText, mailtoLink, openMailDraft } from '../../utils/mailto';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT } from '../../styles/density';

const COMMENT_MAX = 1000;
const FEEDBACK_SUBJECT = 'SAKAY TODA Portal feedback';

type CopyState = 'idle' | 'copied' | 'failed';

// Help and feedback. The portal has no server route that receives feedback (the "Rate the App" pages of the Driver and Passenger apps do not send anything either),
// so both go by e-mail to the SAKAY team: the buttons open the person's own e-mail program with the message ready, and the person presses Send there.
// Nothing is claimed as sent from this page.
export const SupportFeedbackPanel: React.FC = () => {
  const { t } = useLanguage();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const handleCopy = async () => {
    setCopyState((await copyText(SUPPORT_EMAIL)) ? 'copied' : 'failed');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = comment.trim();
    if (!rating && !text) {
      setError('Choose a star rating or write a comment first.');
      setOpened(false);
      return;
    }
    setError(null);
    const lines = ['SAKAY TODA Administrator Portal feedback', ''];
    if (rating) lines.push(`Rating: ${rating} out of 5`);
    if (text) lines.push('', 'Comments:', text);
    openMailDraft(mailtoLink(SUPPORT_EMAIL, FEEDBACK_SUBJECT, lines.join('\r\n')));
    setOpened(true);
  };

  const edited = () => {
    setError(null);
    setOpened(false);
  };

  return (
    <>
      <SettingRow
        title="Contact the SAKAY team"
        description={
          <>
            Write to <Box component="strong" sx={{ color: OPS_TEXT.primary }}>{SUPPORT_EMAIL}</Box> for help with the portal or to report a problem.
          </>
        }
        control={
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Button component="a" href={mailtoLink(SUPPORT_EMAIL, 'SAKAY TODA Portal support', '')} variant="outlined" startIcon={<MailOutlinedIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
              Send Email
            </Button>
            <Button variant="outlined" startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={handleCopy} sx={secondaryButtonSx}>
              Copy Email Address
            </Button>
          </Box>
        }
      >
        <Typography role="status" sx={{ fontSize: FONT.small, mt: copyState === 'idle' ? 0 : '8px', color: copyState === 'failed' ? OPS_TEXT.danger : OPS_TEXT.success, fontWeight: 600 }}>
          {copyState === 'copied' && 'The email address was copied.'}
          {copyState === 'failed' && `This browser did not allow copying. The address is ${SUPPORT_EMAIL}.`}
        </Typography>
      </SettingRow>

      <SettingRow title="Accreditation questions" description={ACCREDITATION_HELP} />

      <SettingRow title="Send feedback" description="Tell the SAKAY team how the portal is working for you. Your email program opens with your message ready to send.">
        <Box component="form" noValidate onSubmit={handleSubmit} sx={{ mt: '14px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: 560 }}>
          <Box>
            <Typography id="feedback-rating-label" sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>
              How is your experience with this portal? (optional)
            </Typography>
            <Rating
              name="feedback-rating"
              value={rating}
              onChange={(_, value) => {
                setRating(value);
                edited();
              }}
              aria-labelledby="feedback-rating-label"
              sx={{ mt: '4px', color: '#C75000', '& .MuiRating-icon': { fontSize: 30 } }}
            />
          </Box>
          <TextField
            label={t('feedback.comments')}
            placeholder={t('feedback.placeholder')}
            multiline
            minRows={3}
            fullWidth
            value={comment}
            onChange={(e) => {
              setComment(e.target.value.slice(0, COMMENT_MAX));
              edited();
            }}
            error={Boolean(error)}
            helperText={`${comment.length} of ${COMMENT_MAX} characters`}
          />
          {error && (
            <Typography role="alert" sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.danger }}>{error}</Typography>
          )}
          {opened && (
            <Alert severity="info" sx={{ borderRadius: '8px', fontSize: FONT.body }}>
              Your email program should now open with your feedback ready. Press Send there to finish. Nothing has been sent from this page yet.
            </Alert>
          )}
          <Box>
            <Button type="submit" variant="contained" disableElevation startIcon={<SendIcon sx={{ fontSize: 16 }} />} sx={primaryButtonSx}>
              Send Feedback
            </Button>
          </Box>
        </Box>
      </SettingRow>
    </>
  );
};
