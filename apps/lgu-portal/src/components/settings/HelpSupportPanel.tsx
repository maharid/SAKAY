import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlinedIcon from '@mui/icons-material/MailOutlined';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import { AppFeedbackForm, FeedbackCard } from '@sakay/shared';
import { useNavigate } from 'react-router-dom';

import { SettingRow } from '../common/SettingRow';
import { FONT } from '../../styles/density';
import { PAGE_TEXT, primaryButtonSx, secondaryButtonSx } from '../../styles/pageTheme';
import { SUPPORT_EMAIL } from '../../utils/appInfo';
import { useLanguage } from '../../hooks/useLanguage';
import { copyText, mailtoLink } from '../../utils/mailto';
import { supabase } from '../../services/supabaseClient';

/** how long the copy button says "Copied!" before it goes back to "Copy email address" */
const COPIED_FOR_MS = 3000;

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

// Help and feedback. Contact goes by e-mail (the button opens the person's own mail program). Feedback is sent in the portal: the form stores it in the database (submit_app_feedback),
// with the person's name and role written by the database, and says when it is saved.
export const HelpSupportPanel: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // "Copied!" shows on the button itself (no toast); a failed copy is said under the row
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

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
          <AppFeedbackForm app="lgu-portal" client={supabase} commentLabel={t('feedback.comments')} commentPlaceholder={t('feedback.placeholder')} />
        </FeedbackCard>
      </Box>
    </>
  );
};
