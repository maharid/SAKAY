import React from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import ScreenLockPortraitIcon from '@mui/icons-material/ScreenLockPortrait';
import LocationDisabledIcon from '@mui/icons-material/LocationDisabled';
import { DRIVER_AUTO_OFFLINE_AFTER_UNANSWERED, LOCATION_MAX_ACCURACY_METERS } from '@sakay/shared';

import { useLanguage } from '../../utils/LanguageContext';
import { useDriverSession } from '../../contexts/DriverSessionContext';
import type { PresenceEndReason } from '../../services/driverPresenceService';
import type { LocationIssue } from '../../utils/locationIssue';

/** Persistent reminder while Online (Rule 17.6). Shown on the Home screen. */
export const DriverForegroundReminder: React.FC = () => {
  const { language } = useLanguage();
  // One short line (Rule 17.6). The battery-saver detail was a second paragraph nobody could act on.
  return (
    <Alert
      severity="info"
      icon={<ScreenLockPortraitIcon fontSize="small" />}
      sx={{ borderRadius: '12px', fontSize: '12px', alignItems: 'center', py: 0.25 }}
    >
      <Typography sx={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.35 }}>
        {language === 'tl'
          ? 'Panatilihing bukas ang SAKAY at naka-on ang screen habang Online.'
          : 'Keep SAKAY open and the screen on while Online.'}
      </Typography>
    </Alert>
  );
};

/**
 * Shown on the Home screen while Online when the server is NOT getting a usable position from this phone: it refuses one worse than 100 m (or
 * none), or the heartbeat is not answered at all. Dispatch only sees a driver with a fresh, accurate position, so the driver would be Online
 * yet invisible, with no offers and no explanation.
 */
export const DriverLocationNotice: React.FC<{ issue: LocationIssue | null }> = ({ issue }) => {
  const { language } = useLanguage();
  if (!issue) return null;
  const tl = language === 'tl';
  const accuracy = issue.accuracyM !== null ? ` (±${issue.accuracyM} m, ${tl ? 'dapat hindi lalampas sa' : 'it must be within'} ${LOCATION_MAX_ACCURACY_METERS} m)` : '';
  const detail = issue.detail ? ` (${issue.detail})` : '';
  const text = issue.reason === 'no_connection'
    ? (tl
        ? `Hindi maipadala ng SAKAY ang lokasyon mo sa server${detail}. Hindi ka makikita ng sistema kaya hindi ka makakatanggap ng booking. Suriin ang internet o i-reload ang page.`
        : `SAKAY cannot send your position to the server${detail}. The system cannot see you, so you will not receive bookings. Check your internet connection or reload the page.`)
    : issue.reason === 'low_accuracy'
    ? (tl
        ? `Hindi sapat ang linaw ng lokasyon ng device mo${accuracy}. Hindi ka makikita ng sistema kaya hindi ka makakatanggap ng booking. Humanap ng mas malinaw na GPS signal.`
        : `Your location is not accurate enough${accuracy}. The system cannot see you, so you will not receive bookings. Move to a place with a clearer GPS signal.`)
    : (tl
        ? 'Walang kasalukuyang lokasyon mula sa device mo. Hindi ka makikita ng sistema kaya hindi ka makakatanggap ng booking. I-on ang Location at hintaying makakuha ng signal.'
        : 'No current location is coming from your device. The system cannot see you, so you will not receive bookings. Turn Location on and wait for a signal.');
  return (
    <Alert
      severity="warning"
      role="alert"
      icon={<LocationDisabledIcon fontSize="small" />}
      sx={{ borderRadius: '12px', fontSize: '12px', alignItems: 'center', py: 0.25 }}
    >
      <Typography sx={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.35 }}>{text}</Typography>
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
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>
          {lang === 'tl' ? 'Mukhang hindi ka available' : 'Are you still there?'}
        </DialogTitle>
        <DialogContent>
          {/* Exact wording of Rule 7.6, followed by the Filipino line. */}
          <Typography sx={{ fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
            You appear to be unavailable. Please switch to Offline if you are no longer accepting bookings.
          </Typography>
          <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5, mt: 1 }}>
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
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}
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
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>
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
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}
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
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0F172A' }}>{notice?.title}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>{notice?.body}</Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            variant="contained"
            onClick={dismissOfflineNotice}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '12px', backgroundColor: '#FF6600', '&:hover': { backgroundColor: '#E05300' } }}
          >
            {lang === 'tl' ? 'Sige' : 'OK'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DriverPresenceNotices;
