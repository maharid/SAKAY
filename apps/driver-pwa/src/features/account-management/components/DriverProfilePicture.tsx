import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, IconButton, Alert, Button, CircularProgress } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import { useLanguage } from '../../../utils/LanguageContext';
import { useLiveCamera } from '../../../hooks/useLiveCamera';
import type { CameraErrorKind } from '../../../hooks/useLiveCamera';
import { saveDriverProfilePicture } from '../../../services/driverApiService';
import { saveProfilePictureData } from '../../../services/driverOnboardingCache';

type Phase = 'intro' | 'camera' | 'review' | 'saved';
type Say = (tl: string, en: string) => string;

interface Capture {
  blob: Blob;
  previewUrl: string;
  capturedAt: number;
}

interface ProfilePictureLocationState {
  phone?: string;
  driverName?: string;
  isEditMode?: boolean;
  isResubmission?: boolean;
  faultyDocuments?: string[];
  issues?: { documentType: string; grounds: string; notes: string }[];
  rejectionReason?: string;
  rejectionComment?: string;
}

const BACK_BUTTON_SX = {
  width: 44,
  height: 44,
  borderRadius: '14px',
  border: '1px solid #E2E8F0',
  backgroundColor: '#FFFFFF',
  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  '&:hover': { backgroundColor: '#F8FAFC' },
} as const;

/** The camera problems the driver can fix by trying again; the others mean this device or connection cannot take a live photo */
const RETRYABLE_CAMERA_ERRORS: CameraErrorKind[] = ['denied', 'not_found', 'in_use', 'interrupted', 'unknown'];

function useSay(): Say {
  const { language } = useLanguage();
  return (tl, en) => (language === 'tl' ? tl : en);
}

function cameraErrorMessage(kind: CameraErrorKind, say: Say): string {
  switch (kind) {
    case 'denied':
      return say(
        'Naka-block ang access sa camera. Payagan ang SAKAY na gamitin ang camera sa settings ng browser o telepono, saka subukan muli.',
        'Camera access is blocked. Allow SAKAY to use the camera in your browser or phone settings, then try again.'
      );
    case 'not_found':
      return say('Walang nakitang camera sa aparatong ito.', 'No camera was found on this device.');
    case 'in_use':
      return say(
        'Hindi mabuksan ang camera. Maaaring ginagamit ito ng ibang app. Isara ang ibang app na gumagamit ng camera, saka subukan muli.',
        'The camera could not be started. Another app may be using it. Close other apps that use the camera, then try again.'
      );
    case 'interrupted':
      return say('Huminto ang camera. Pakisubukang muli.', 'The camera stopped working. Please try again.');
    case 'insecure':
      return say(
        'Kailangan ng ligtas na koneksyon (HTTPS) para magamit ang camera.',
        'The camera needs a secure (HTTPS) connection.'
      );
    case 'unsupported':
      return say(
        'Hindi sinusuportahan ng aparato o browser na ito ang pagkuha ng live na larawan. Gumamit ng ibang aparato o browser.',
        'This device or browser does not support taking a live photo. Please use a different device or browser.'
      );
    default:
      return say('Hindi mabuksan ang camera. Pakisubukang muli.', 'The camera could not be started. Please try again.');
  }
}

const ScreenHeader: React.FC<{ onBack: () => void; backLabel: string; backDisabled?: boolean }> = ({ onBack, backLabel, backDisabled }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      px: 3,
      pt: 'calc(var(--safe-area-top) + 20px)',
      pb: 2,
      backgroundColor: '#FFFFFF',
      flexShrink: 0,
      zIndex: 20,
    }}
  >
    <IconButton aria-label={backLabel} onClick={onBack} disabled={backDisabled} sx={BACK_BUTTON_SX}>
      <ArrowBackIcon sx={{ color: '#0F172A', fontSize: 20 }} />
    </IconButton>
    <Logo color="orange" width={110} />
  </Box>
);

/** Shown when the TODA sent the picture back for correction */
const ReturnedNotice: React.FC<{ note?: string }> = ({ note }) => {
  const say = useSay();
  return (
    <Box
      sx={{
        px: 2.5,
        py: 1,
        backgroundColor: '#FFFBEB',
        borderBottom: '1px solid #FDE68A',
        display: 'flex',
        alignItems: 'center',
        gap: 1.2,
        zIndex: 19,
        flexShrink: 0,
      }}
    >
      <WarningAmberRoundedIcon sx={{ color: '#D97706', fontSize: 20, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '12px', fontWeight: 700, color: '#B45309', lineHeight: 1.2 }}>
          {say('Kailangang Iwasto: Larawan sa Profile', 'Correction Required: Profile Picture')}
        </Typography>
        <Typography sx={{ fontSize: '12px', color: '#92400E', fontWeight: 600, lineHeight: 1.3, mt: 0.25 }} noWrap>
          {note || say('Kailangan ng mas malinaw na larawan', 'A clearer picture is required')}
        </Typography>
      </Box>
    </Box>
  );
};

/** The round picture frame used by the preview and the saved screens */
const PictureCircle: React.FC<{ previewUrl: string | null; size: number; borderColor?: string }> = ({ previewUrl, size, borderColor = '#FF6600' }) => {
  const say = useSay();
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${borderColor}`,
        boxShadow: '0 8px 30px rgba(15, 23, 42, 0.18)',
        overflow: 'hidden',
        backgroundColor: '#0F172A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {previewUrl ? (
        <Box
          component="img"
          src={previewUrl}
          alt={say('Ang iyong profile picture', 'Your profile picture')}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Typography sx={{ color: '#94A3B8', fontSize: '13px' }}>{say('Walang larawan', 'No picture')}</Typography>
      )}
    </Box>
  );
};

const IntroStep: React.FC<{ onOpenCamera: () => void; onBack: () => void; returnedNote?: string; isResubmission: boolean }> = ({
  onOpenCamera,
  onBack,
  returnedNote,
  isResubmission,
}) => {
  const say = useSay();
  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader onBack={onBack} backLabel={say('Bumalik', 'Back')} />
      {isResubmission && <ReturnedNotice note={returnedNote} />}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          py: 2,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 132,
            height: 132,
            borderRadius: '50%',
            backgroundColor: '#FFF5EF',
            border: '2px dashed #FFB98A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 3,
          }}
        >
          <PhotoCameraRoundedIcon sx={{ fontSize: 56, color: '#FF6600' }} />
        </Box>

        <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2, letterSpacing: '-0.5px', mb: 1.25 }}>
          {say('Ihanda ang Iyong Larawan sa Profile', 'Set Up Your Profile Picture')}
        </Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 500, color: '#64748B', lineHeight: 1.5, maxWidth: 320, mb: 1.5 }}>
          {say(
            'Kumuha ng live na larawan ng iyong sarili. Ang larawang ito ay ipapakita sa iyong driver profile sa SAKAY.',
            'Take a live photo of yourself. This picture will be displayed on your driver profile in SAKAY.'
          )}
        </Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', lineHeight: 1.5, maxWidth: 320, mb: 1.5 }}>
          {say(
            'Siguraduhing malinaw na kita ang iyong mukha at komportable ka sa paggamit ng larawang ito bilang iyong profile photo.',
            'Make sure your face is clearly visible and that you are comfortable using this picture as your profile photo.'
          )}
        </Typography>
        <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#94A3B8', lineHeight: 1.45, maxWidth: 300 }}>
          {say(
            'Live na kuha mula sa camera lamang ang tinatanggap. Hindi puwedeng pumili ng larawan mula sa gallery o files.',
            'Only a live camera photo can be used. You cannot choose a picture from your gallery or files.'
          )}
        </Typography>
      </Box>

      <Box sx={{ px: 3, pb: 'calc(var(--safe-area-bottom) + 20px)', backgroundColor: '#FFFFFF', flexShrink: 0 }}>
        <PrimaryButton fullWidth onClick={onOpenCamera} startIcon={<PhotoCameraRoundedIcon />}>
          {say('Buksan ang Camera', 'Open Camera')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

const CameraTip: React.FC<{ index: number; text: string }> = ({ index, text }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
    <Box
      sx={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        color: '#FFFFFF',
        fontSize: '12px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        mt: 0.2,
      }}
    >
      {index}
    </Box>
    <Typography sx={{ fontSize: '13px', color: '#E2E8F0', lineHeight: 1.45 }}>{text}</Typography>
  </Box>
);

interface CameraStepProps {
  camera: ReturnType<typeof useLiveCamera>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  capturing: boolean;
  captureError: string | null;
  onCapture: () => void;
  onBack: () => void;
  returnedNote?: string;
  isResubmission: boolean;
}

const CameraStep: React.FC<CameraStepProps> = ({ camera, videoRef, capturing, captureError, onCapture, onBack, returnedNote, isResubmission }) => {
  const say = useSay();
  const { status, errorKind, facing, frameReady, canSwitch } = camera;
  const hasError = status === 'error' && errorKind !== null;
  const canRetry = hasError && RETRYABLE_CAMERA_ERRORS.includes(errorKind);

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#000000', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <ScreenHeader onBack={onBack} backLabel={say('Bumalik', 'Back')} />
      {isResubmission && <ReturnedNotice note={returnedNote} />}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          overflowY: 'auto',
        }}
      >
        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.4, maxWidth: 320, mt: 1 }}>
          {say(
            'Ilagay ang iyong mukha sa loob ng bilog at tumingin nang diretso sa camera.',
            'Place your face inside the circle and look straight at the camera.'
          )}
        </Typography>

        {(hasError || captureError) && (
          <Alert
            severity="error"
            action={
              canRetry ? (
                <Button color="inherit" size="small" onClick={() => void camera.start(facing)} sx={{ fontWeight: 700, textTransform: 'none' }}>
                  {say('Subukan Muli', 'Try Again')}
                </Button>
              ) : undefined
            }
            sx={{ width: '100%', maxWidth: 340, my: 1, borderRadius: '12px' }}
          >
            {hasError ? cameraErrorMessage(errorKind, say) : captureError}
          </Alert>
        )}

        <Box sx={{ position: 'relative', width: 270, height: 270, borderRadius: '50%', my: 'auto', flexShrink: 0 }}>
          <Box
            sx={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              border: '3.5px solid #FF6600',
              boxShadow: '0 0 24px rgba(255, 102, 0, 0.45), inset 0 0 24px rgba(255, 102, 0, 0.2)',
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#0F172A',
            }}
          >
            {/* The live feed. Mirrored for the front camera, like a mirror; the saved picture is mirrored the same way. */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: facing === 'user' ? 'scaleX(-1)' : 'none',
                visibility: status === 'live' ? 'visible' : 'hidden',
              }}
            />
            {status !== 'live' && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
                {status === 'starting' ? (
                  <>
                    <CircularProgress size={32} sx={{ color: '#FF6600' }} />
                    <Typography sx={{ fontSize: '12px', color: '#CBD5E1', fontWeight: 600 }}>
                      {say('Binubuksan ang camera...', 'Starting camera...')}
                    </Typography>
                  </>
                ) : (
                  <PhotoCameraRoundedIcon sx={{ fontSize: 64, color: 'rgba(255, 255, 255, 0.25)' }} />
                )}
              </Box>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            width: '100%',
            maxWidth: 340,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            p: 2,
            mb: 2,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ color: '#FF6600', fontWeight: 700, fontSize: '14px', mb: 1.25 }}>
            {say('Para sa malinaw na larawan:', 'Tips for a clear picture:')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <CameraTip index={1} text={say('Pumunta sa maliwanag na lugar.', 'Stay in a well-lit place.')} />
            <CameraTip index={2} text={say('Tiyaking walang tumatakip sa iyong mukha.', 'Make sure nothing covers your face.')} />
            <CameraTip
              index={3}
              text={say(
                'Tumingin nang diretso sa camera at panatilihing nasa gitna ang iyong mukha.',
                'Look straight at the camera and keep your face centered.'
              )}
            />
          </Box>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            width: '100%',
            maxWidth: 340,
            pb: 'calc(var(--safe-area-bottom) + 12px)',
            flexShrink: 0,
          }}
        >
          <Box sx={{ width: 50, height: 50 }} />

          <IconButton
            aria-label={say('Kumuha ng larawan', 'Take picture')}
            onClick={onCapture}
            disabled={!frameReady || capturing}
            sx={{
              width: 74,
              height: 74,
              borderRadius: '50%',
              border: '4px solid #FFFFFF',
              padding: '4px',
              backgroundColor: 'transparent',
              '&:hover': { transform: 'scale(1.03)' },
              '&:active': { transform: 'scale(0.96)' },
              '&.Mui-disabled': { opacity: 0.4 },
            }}
          >
            <Box sx={{ width: '100%', height: '100%', borderRadius: '50%', backgroundColor: '#FF6600' }} />
          </IconButton>

          {canSwitch ? (
            <IconButton
              aria-label={say('Palitan ang camera', 'Switch camera')}
              onClick={() => camera.switchFacing()}
              sx={{
                color: '#FFFFFF',
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                width: 50,
                height: 50,
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
              }}
            >
              <CameraswitchIcon />
            </IconButton>
          ) : (
            <Box sx={{ width: 50, height: 50 }} />
          )}
        </Box>
      </Box>
    </Box>
  );
};

interface ReviewStepProps {
  previewUrl: string | null;
  saving: boolean;
  saveError: string | null;
  onConfirm: () => void;
  onRetake: () => void;
}

const ReviewStep: React.FC<ReviewStepProps> = ({ previewUrl, saving, saveError, onConfirm, onRetake }) => {
  const say = useSay();
  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader onBack={onRetake} backLabel={say('Kuhanan muli ang larawan', 'Retake picture')} backDisabled={saving} />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          py: 2,
        }}
      >
        <Typography sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', textAlign: 'center', lineHeight: 1.2, letterSpacing: '-0.5px', mb: 1 }}>
          {say('Nasiyahan Ka Ba sa Iyong Larawan?', 'Are You Satisfied With Your Picture?')}
        </Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 500, color: '#64748B', textAlign: 'center', lineHeight: 1.5, maxWidth: 320, mb: 3 }}>
          {say(
            'Ito ang magiging profile picture mo sa SAKAY. Pakisuri muna ito bago magpatuloy.',
            'This will be your profile picture in SAKAY. Please review it before continuing.'
          )}
        </Typography>

        <PictureCircle previewUrl={previewUrl} size={240} />

        {saveError && (
          <Alert severity="error" sx={{ width: '100%', maxWidth: 340, mt: 3, borderRadius: '12px' }}>
            {saveError}
          </Alert>
        )}
      </Box>

      <Box sx={{ px: 3, pb: 'calc(var(--safe-area-bottom) + 20px)', display: 'flex', flexDirection: 'column', gap: 1.5, backgroundColor: '#FFFFFF', flexShrink: 0 }}>
        <PrimaryButton fullWidth onClick={onConfirm} loading={saving} loadingLabel={say('Isina-save...', 'Saving...')} disabled={!previewUrl}>
          {saveError ? say('Subukang I-save Muli', 'Try Saving Again') : say('Gamitin ang Larawang Ito', 'Use This Picture')}
        </PrimaryButton>
        <PrimaryButton
          fullWidth
          variant="outlined"
          onClick={onRetake}
          disabled={saving}
          sx={{
            backgroundColor: 'transparent',
            borderColor: '#CBD5E1',
            color: '#0F172A',
            '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#94A3B8' },
          }}
        >
          {say('Kuhanan Muli', 'Retake Picture')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

const SavedStep: React.FC<{ previewUrl: string | null; onContinue: () => void }> = ({ previewUrl, onContinue }) => {
  const say = useSay();
  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ pt: 'calc(var(--safe-area-top) + 20px)', pb: 2, px: 3, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <Logo color="orange" width={110} />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3, py: 2, textAlign: 'center' }}>
        <Box sx={{ position: 'relative', mb: 3 }}>
          <PictureCircle previewUrl={previewUrl} size={200} borderColor="#16A34A" />
          <CheckCircleIcon
            sx={{ position: 'absolute', right: 4, bottom: 4, fontSize: 44, color: '#16A34A', backgroundColor: '#FFFFFF', borderRadius: '50%' }}
          />
        </Box>
        <Typography role="status" sx={{ fontSize: '24px', fontWeight: 700, color: '#0F172A', lineHeight: 1.2, letterSpacing: '-0.5px', mb: 1 }}>
          {say('Na-save ang Larawan', 'Picture Saved')}
        </Typography>
        <Typography sx={{ fontSize: '14px', fontWeight: 500, color: '#64748B', lineHeight: 1.5, maxWidth: 300 }}>
          {say('Na-save na ang iyong profile picture.', 'Your profile picture has been saved.')}
        </Typography>
      </Box>

      <Box sx={{ px: 3, pb: 'calc(var(--safe-area-bottom) + 20px)', backgroundColor: '#FFFFFF', flexShrink: 0 }}>
        <PrimaryButton fullWidth onClick={onContinue}>
          {say('Magpatuloy', 'Continue')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export const DriverProfilePicture: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const say = useSay();
  const state = location.state as ProfilePictureLocationState | undefined;

  const isEditMode = Boolean(state?.isEditMode);
  const isResubmission = Boolean(state?.isResubmission);
  const returnedNote = state?.issues?.find((issue) => issue.documentType === 'selfie')?.notes || state?.rejectionReason;

  const camera = useLiveCamera('user');
  const { start: startCamera, stop: stopCamera, videoRef } = camera;

  const [phase, setPhase] = useState<Phase>('intro');
  const [capture, setCapture] = useState<Capture | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savingRef = useRef(false);
  const captureRef = useRef<Capture | null>(null);

  // The camera runs only on the capture screen; every other screen has let go of it
  useEffect(() => {
    if (phase === 'camera') {
      void startCamera('user');
    } else {
      stopCamera();
    }
  }, [phase, startCamera, stopCamera]);

  // Keep at most one picture in memory; revoking the preview link frees it
  const replaceCapture = useCallback((next: Capture | null) => {
    if (captureRef.current) URL.revokeObjectURL(captureRef.current.previewUrl);
    captureRef.current = next;
    setCapture(next);
  }, []);

  useEffect(() => {
    return () => {
      if (captureRef.current) URL.revokeObjectURL(captureRef.current.previewUrl);
      captureRef.current = null;
    };
  }, []);

  const handleBack = () => {
    if (isResubmission) {
      navigate('/driver/status');
    } else if (isEditMode) {
      navigate('/driver/confirm-all-info', { state });
    } else {
      navigate('/driver/review-tricycle', { state });
    }
  };

  const handleOpenCamera = () => {
    setCaptureError(null);
    setPhase('camera');
  };

  const handleCapture = async () => {
    if (!camera.frameReady || capturing) return;

    setCapturing(true);
    setCaptureError(null);
    try {
      const blob = await camera.capturePhoto();
      replaceCapture({ blob, previewUrl: URL.createObjectURL(blob), capturedAt: Date.now() });
      setSaveError(null);
      setPhase('review');
    } catch (err) {
      console.warn('[DriverProfilePicture] Capture failed:', err);
      setCaptureError(say('Hindi makuha ang larawan. Pakisubukang muli.', 'The picture could not be taken. Please try again.'));
    } finally {
      setCapturing(false);
    }
  };

  const handleRetake = () => {
    if (savingRef.current) return;
    replaceCapture(null);
    setSaveError(null);
    setCaptureError(null);
    setPhase('camera');
  };

  const handleConfirm = async () => {
    if (!capture || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveDriverProfilePicture(capture.blob, capture.capturedAt);
      if (!result.success) {
        setSaveError(result.error || say('Hindi na-save ang iyong larawan. Pakisubukang muli.', 'Your picture could not be saved. Please try again.'));
        return;
      }
      const targetPhone = state?.phone || localStorage.getItem('sakay_driver_phone') || '';
      saveProfilePictureData({ photoPath: result.profilePhotoPath || '', savedAt: new Date().toISOString() }, targetPhone);
      setPhase('saved');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleContinue = () => {
    navigate('/driver/confirm-all-info', {
      replace: true,
      state: { ...state, isEditMode: false },
    });
  };

  if (phase === 'camera') {
    return (
      <CameraStep
        camera={camera}
        videoRef={videoRef}
        capturing={capturing}
        captureError={captureError}
        onCapture={() => void handleCapture()}
        onBack={() => setPhase('intro')}
        returnedNote={returnedNote}
        isResubmission={isResubmission}
      />
    );
  }

  if (phase === 'review') {
    return (
      <ReviewStep
        previewUrl={capture?.previewUrl ?? null}
        saving={saving}
        saveError={saveError}
        onConfirm={() => void handleConfirm()}
        onRetake={handleRetake}
      />
    );
  }

  if (phase === 'saved') {
    return <SavedStep previewUrl={capture?.previewUrl ?? null} onContinue={handleContinue} />;
  }

  return <IntroStep onOpenCamera={handleOpenCamera} onBack={handleBack} returnedNote={returnedNote} isResubmission={isResubmission} />;
};

export default DriverProfilePicture;
