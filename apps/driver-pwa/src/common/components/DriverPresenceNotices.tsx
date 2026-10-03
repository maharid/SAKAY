import React from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import BatterySaverIcon from '@mui/icons-material/BatterySaver';
import ScreenLockPortraitIcon from '@mui/icons-material/ScreenLockPortrait';
import { DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED } from '@sakay/shared';

import { useLanguage } from '../../utils/LanguageContext';
import { useDriverSession } from '../../contexts/DriverSessionContext';
import type { PresenceEndReason } from '../../services/driverPresenceService';

/** Persistent reminder while Online (Rule 17.6) with the battery-saver note (Rule 17.8). Shown on the Home screen. */
export const DriverForegroundReminder: React.FC = () => {
  const { language } = useLanguage();
  return (
    <Alert
      severity="info"
      icon={<ScreenLockPortraitIcon fontSize="small" />}
      sx={{ borderRadius: '12px', fontSize: '11.5px', alignItems: 'center', py: 0.5 }}
    >
      <Typography sx={{ fontSize: '11.5px', fontWeight: 700, lineHeight: 1.35 }}>
        {language === 'tl'
          ? 'Panatilihing bukas ang SAKAY at hindi naka-lock ang screen habang Online.'
          : 'Keep SAKAY open and the screen unlocked while you are Online.'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
        <BatterySaverIcon sx={{ fontSize: 13, color: '#64748B' }} />
        <Typography sx={{ fontSize: '10.5px', color: '#475569', lineHeight: 1.3 }}>
          {language === 'tl'
            ? 'Kung bumagal ang update ng lokasyon dahil sa battery saver, tatanggapin ito ng app.'
            : 'If battery saver slows location updates, the app accepts that.'}
        </Typography>
      </Box>
    </Alert>
  );
};

function offlineNoticeText(reason: PresenceEndReason, language: 'tl' | 'en'): { title: string; body: string } {
  const tl = language === 'tl';
  switch (reason) {
    case 'auto_inactivity':
      return {
        title: tl ? 'Awtomatikong na-Offline ka' : 'You were set to Offline',
        body: tl
          ? `Hindi ka tumugon sa ${DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED} sunod-sunod na booking offer, kaya inilagay ka sa Offline. Walang strike na ibinigay.`
          : `You did not respond to ${DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED} booking offers in a row, so you were set to Offline. No strike was applied.`,
      };
    case 'stale_heartbeat':
      return {
        title: tl ? 'Nawalan ng koneksyon ang app' : 'We lost contact with the app',
        body: tl
          ? 'Hindi na nakapag-ulat ang SAKAY nang ilang minuto, kaya inilagay ka sa Offline. Panatilihing bukas ang app at hindi naka-lock ang screen habang Online.'
          : 'SAKAY stopped reporting for several minutes, so you were set to Offline. Keep the app open and the screen unlocked while Online.',
      };
    case 'location_permission_revoked':
      return {
        title: tl ? 'Naka-off ang Location' : 'Location was turned off',
        body: tl
          ? 'Na-off ang location permission, kaya inilagay ka sa Offline. Payagan muli ang location bago mag-Online.'
          : 'Location permission was turned off, so you were set to Offline. Allow location again before you go Online.',
      };
    default:
      return {
        title: tl ? 'Inilagay ka sa Offline ng sistema' : 'You were set to Offline by the system',
        body: tl
          ? 'Maaaring dahil ito sa restriksyon ng account o dokumento. Tingnan ang Home screen para sa detalye.'
          : 'This can happen because of an account or document restriction. Check the Home screen for details.',
      };
  }
}

/** Rule 7.6 reminder and the explanation shown when the system ended the Online session. */
export const DriverPresenceNotices: React.FC = () => {
  const { language } = useLanguage();
  const lang: 'tl' | 'en' = language === 'tl' ? 'tl' : 'en';
  const {
    reminderOpen, dismissReminder, goOffline, offlineNotice, dismissOfflineNotice, backgroundNotice, dismissBackgroundNotice,
  } = useDriverSession();

  const notice = offlineNotice ? offlineNoticeText(offlineNotice.reason, lang) : null;

  // "Switch to Offline" can be refused (a booking is open). Say so instead of silently closing the dialog.
  const [reminderError, setReminderError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!reminderOpen) setReminderError(null);
  }, [reminderOpen]);
  const handleSwitchOffline = async () => {
    const result = await goOffline();
    if (result.ok) {
      setReminderError(null);
      dismissReminder();
      return;
    }
    setReminderError(
      result.code === 'ERR_OPEN_BOOKING'
        ? (lang === 'tl' ? 'Hindi ka maaaring mag-Offline habang may bukas na booking.' : 'You cannot go Offline while a booking is open.')
        : (result.message || (lang === 'tl' ? 'Hindi ma-Offline. Subukan muli.' : 'Could not go Offline. Try again.'))
    );
  };

  return (
    <>
      <Dialog
        open={reminderOpen}
        onClose={dismissReminder}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A' }}>
          {lang === 'tl' ? 'Mukhang hindi ka available' : 'Are you still there?'}
        </DialogTitle>
        <DialogContent>
          {/* Exact wording of Rule 7.6, followed by the Filipino line. */}
          <Typography sx={{ fontSize: '13.5px', color: '#334155', lineHeight: 1.5 }}>
            You appear to be unavailable. Please switch to Offline if you are no longer accepting bookings.
          </Typography>
          <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.5, mt: 1 }}>
            Mukhang hindi ka available. Paki-switch sa Offline kung hindi ka na tumatanggap ng booking.
          </Typography>
          {reminderError && (
            <Alert severity="warning" sx={{ mt: 1.5, borderRadius: '12px', fontSize: '12px' }}>
              {reminderError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={dismissReminder}
            sx={{ textTransform: 'none', color: '#64748B', fontWeight: 700 }}
          >
            {lang === 'tl' ? 'Narito pa ako' : "I'm still here"}
          </Button>
          <Button
            variant="contained"
            onClick={handleSwitchOffline}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6B00', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {lang === 'tl' ? 'Mag-Offline' : 'Switch to Offline'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rule 17.6: shown on return from the background, when location updates were probably paused */}
      <Dialog
        open={backgroundNotice !== null && notice === null && !reminderOpen}
        onClose={dismissBackgroundNotice}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A' }}>
          {lang === 'tl' ? 'Nasa background ang SAKAY' : 'SAKAY was in the background'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
            {lang === 'tl'
              ? 'Humihinto ang pagpapadala ng lokasyon kapag naka-minimize ang app o naka-lock ang screen, kaya maaaring hindi ka makatanggap ng booking. Panatilihing bukas ang SAKAY at hindi naka-lock ang screen habang Online.'
              : 'Location updates stop while the app is minimized or the screen is locked, so you may miss booking requests. Keep SAKAY open and the screen unlocked while you are Online.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            variant="contained"
            onClick={dismissBackgroundNotice}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6B00', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {lang === 'tl' ? 'Sige' : 'OK'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={notice !== null}
        onClose={dismissOfflineNotice}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: '24px', p: 1 } } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '16px', color: '#0F172A' }}>{notice?.title}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>{notice?.body}</Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            variant="contained"
            onClick={dismissOfflineNotice}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6B00', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {lang === 'tl' ? 'Sige' : 'OK'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DriverPresenceNotices;
