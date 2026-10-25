import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Rating, TextField, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlinedIcon from '@mui/icons-material/MailOutlined';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import SendIcon from '@mui/icons-material/Send';
import { FeedbackCard } from '@sakay/shared';
import { useNavigate } from 'react-router-dom';

import { SettingRow } from '../common/SettingRow';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';
import { SUPPORT_EMAIL } from '../../utils/appInfo';
import { useLanguage } from '../../hooks/useLanguage';
import { copyText, mailtoLink, openMailDraft } from '../../utils/mailto';

const COMMENT_MAX = 1000;
const FEEDBACK_SUBJECT = 'SAKAY LGU Portal feedback';
/** how long the copy button says "Copied!" before it goes back to "Copy email address" */
const COPIED_FOR_MS = 3000;

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

// Help and feedback (the same as the TODA portal's Support & Feedback). The help page the header's help button used to open is here (the /tulong screen, unchanged).
// The portal has no server route that receives feedback, so contact and feedback go by e-mail to the SAKAY team: the buttons open the person's own e-mail program with
// the message ready, and the person presses Send there. Nothing is claimed as sent from this page.
export const HelpSupportPanel: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // "Copied!" shows on the button itself (no toast); a failed copy is said under the row
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    const copiedOk = await copyText(SUPPORT_EMAIL);
    if (!mounted.current) return;
    // one timer at a time: a second click starts the three seconds again instead of leaving an old timer to cut it short
    window.clearTimeout(copiedTimer.current);
    setCopyFailed(!copiedOk);
    setCopied(copiedOk);
    if (copiedOk) copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
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
    const lines = ['SAKAY LGU Administrator Portal feedback', ''];
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
        title="Help center"
        description="User guides and support information for LGU administrators."
        control={
          <Button onClick={() => navigate('/tulong')} sx={secondaryButtonSx}>
            Open help center
          </Button>
        }
      />

      <SettingRow
        title="Contact the SAKAY team"
        description={
          <>
            Write to <Box component="strong" sx={{ color: PAGE_TEXT.primary }}>{SUPPORT_EMAIL}</Box> for help with the portal or to report a problem.
          </>
        }
        control={
          <Box sx={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Button component="a" href={mailtoLink(SUPPORT_EMAIL, 'SAKAY LGU Portal support', '')} startIcon={<MailOutlinedIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
              Send email
            </Button>
            <Button
              onClick={handleCopy}
              startIcon={copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
              sx={{
                ...secondaryButtonSx,
                ...(copied ? { color: PAGE_TEXT.success, borderColor: 'rgba(21, 128, 61, 0.45)', backgroundColor: '#F0FDF4', '&:hover': { backgroundColor: '#DCFCE7', borderColor: PAGE_TEXT.success } } : {}),
              }}
            >
              {/* both labels sit in the same spot and only one is visible, so the button keeps its width and nothing around it moves */}
              <Box component="span" sx={{ display: 'inline-grid' }}>
                <Box component="span" sx={{ gridArea: '1 / 1', visibility: copied ? 'hidden' : 'visible' }}>Copy email address</Box>
                <Box component="span" sx={{ gridArea: '1 / 1', visibility: copied ? 'visible' : 'hidden', textAlign: 'center' }}>Copied!</Box>
              </Box>
            </Button>
            {/* read out by a screen reader when the copy worked */}
            <Box component="span" role="status" sx={visuallyHidden}>{copied ? 'Copied!' : ''}</Box>
          </Box>
        }
      >
        {copyFailed && (
          <Typography role="alert" sx={{ fontSize: FONT.small, mt: '8px', color: PAGE_TEXT.danger, fontWeight: 600 }}>
            This browser did not allow copying. The address is {SUPPORT_EMAIL}.
          </Typography>
        )}
      </SettingRow>

      <Box sx={{ py: '16px' }}>
        <FeedbackCard icon={<RateReviewOutlinedIcon />} title="Send feedback" description="Tell the SAKAY team how the portal is working for you.">
          <Box component="form" noValidate onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <Box>
              <Typography id="feedback-rating-label" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>
                How is your experience with this portal? <Box component="span" sx={{ fontWeight: 400, color: PAGE_TEXT.secondary }}>(optional)</Box>
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', mt: '6px' }}>
                <Rating
                  name="feedback-rating"
                  value={rating}
                  onChange={(_, value) => {
                    setRating(value);
                    edited();
                  }}
                  aria-labelledby="feedback-rating-label"
                  sx={{ color: '#C75000', '& .MuiRating-icon': { fontSize: 32 } }}
                />
                <Typography aria-hidden sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.secondary, minWidth: 74 }}>
                  {rating ? `${rating} out of 5` : ''}
                </Typography>
              </Box>
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
              sx={{ '& .MuiOutlinedInput-root': { backgroundColor: '#FFFFFF' } }}
            />
            {error && (
              <Typography role="alert" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.danger }}>{error}</Typography>
            )}
            {opened && (
              <Alert severity="info" sx={{ borderRadius: '8px', fontSize: FONT.body }}>
                Your email program should now open with your feedback ready. Press Send there to finish. Nothing has been sent from this page yet.
              </Alert>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 16px', pt: '4px' }}>
              <Button type="submit" variant="contained" disableElevation startIcon={<SendIcon sx={{ fontSize: 18 }} />} sx={{ ...primaryButtonSx, minHeight: 42, px: '22px', fontSize: FONT.heading }}>
                Send feedback
              </Button>
              <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, lineHeight: 1.5, flex: '1 1 220px' }}>
                Your email program opens with your message ready to send.
              </Typography>
            </Box>
          </Box>
        </FeedbackCard>
      </Box>
    </>
  );
};
