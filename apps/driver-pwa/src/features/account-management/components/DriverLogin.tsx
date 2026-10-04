import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SuccessModal from '../../../common/components/SuccessModal';
import SakayToast from '../../../common/components/SakayToast';
import { RegisterInput } from '../../../common/components/RegisterInput';
import SakayPhoneInput from '../../../common/components/SakayPhoneInput';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { describeRestriction, fetchOwnAccountRestriction } from '@sakay/shared';
import { fetchOwnDriverRecord, getPhoneLookupCandidates, rotateDriverSession } from '../../../services/driverApiService';

export const formatMobileNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  let afterPrefix = '';
  if (digits.startsWith('09')) {
    afterPrefix = digits.slice(2);
  } else if (digits.startsWith('639')) {
    afterPrefix = digits.slice(3);
  } else if (digits.startsWith('9')) {
    afterPrefix = digits.slice(1);
  } else if (digits.startsWith('0')) {
    afterPrefix = digits.slice(1);
  } else {
    afterPrefix = digits;
  }

  afterPrefix = afterPrefix.slice(0, 9);
  if (!afterPrefix) return '09';

  const full = '09' + afterPrefix;
  if (full.length <= 4) return full;
  if (full.length <= 7) return `${full.slice(0, 4)} ${full.slice(4)}`;
  return `${full.slice(0, 4)} ${full.slice(4, 7)} ${full.slice(7, 11)}`;
};

export const DriverLogin: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Toast and Modal State
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);



  const cleanPhoneDigits = phone.replace(/\D/g, '');
  const isValidPhone = cleanPhoneDigits.length === 11 && cleanPhoneDigits.startsWith('09');
  const showPhoneError = phoneTouched && !isValidPhone;

  // Disabled if mobile number or password is empty or loading
  const isLoginDisabled = !phone.trim() || !password.trim() || loading;

  const handleBack = () => {
    navigate('/driver/get-started');
  };

  const triggerErrorToast = (msg: string) => {
    setToastMessage(msg);
    setToastOpen(true);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoginDisabled) return;

    const rawDigits = phone.replace(/\D/g, '');
    if (!rawDigits || !isValidPhone) {
      triggerErrorToast(
        language === 'tl'
          ? 'Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9.'
          : 'Please enter a valid 10-digit mobile number starting with 9.'
      );
      return;
    }

    const candidates = getPhoneLookupCandidates(rawDigits);
    const phone63 = candidates.phone63WithPlus;
    // The login e-mail is derived from the mobile number. Nothing is looked up about the number before the password is checked, so this
    // screen cannot be used to find out which numbers are registered.
    const loginEmails = Array.from(new Set(candidates.authCandidates.map((c) => c.email).filter((e): e is string => Boolean(e))));

    setLoading(true);

    try {
      // 1. Sign in with the mobile number's login e-mail and the typed password
      let sessionUser: any = null;
      for (const email of loginEmails) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });

        if (!signInErr && signInData?.user) {
          sessionUser = signInData.user;
          break;
        }
        // Only a wrong e-mail / password pair is worth trying another spelling for; a rate limit or an outage is not.
        if (signInErr && signInErr.status !== 400) throw signInErr;
      }

      // 2. Wrong number or password: one message for every cause, so it does not say whether the number is registered
      if (!sessionUser) {
        setLoading(false);
        triggerErrorToast(
          language === 'tl'
            ? 'Mali ang numero o password. Pakisubukang muli.'
            : 'Invalid mobile number or password.'
        );
        return;
      }

      // 3. The signed-in driver's OWN record (row security shows a driver nobody else's)
      let driverData = await fetchOwnDriverRecord();
      if (!driverData) {
        // A login that has no driver record (for example one that was removed): create the pending record registration would have made
        const { error: provisionErr } = await supabase.from('driver').insert([{
          auth_user_id: sessionUser.id,
          contact_number: phone63,
          full_name: sessionUser.user_metadata?.full_name || 'Driver Applicant',
          account_status: 'Pending Verification',
          availability_status: 'Offline',
        }]);
        if (!provisionErr) driverData = await fetchOwnDriverRecord();
      }
      if (!driverData) {
        setLoading(false);
        await supabase.auth.signOut();
        triggerErrorToast(
          language === 'tl'
            ? 'Hindi ma-load ang inyong driver account. Pakisubukang muli.'
            : 'We could not load your driver account. Please try again.'
        );
        return;
      }

      // A suspended or deactivated driver cannot log in (Section 1). The database decides, and
      // lifts a suspension whose period has ended, so the message always carries the real end date.
      const restriction = await fetchOwnAccountRestriction(supabase, 'driver');
      if (restriction?.restricted) {
        setLoading(false);
        triggerErrorToast(describeRestriction(restriction, language === 'tl' ? 'tl' : 'en'));
        await supabase.auth.signOut();
        return;
      }

      localStorage.setItem('sakay_driver_phone', phone63);
      localStorage.setItem('sakay_driver_id', driverData.driver_id);

      const todaInfo = Array.isArray(driverData.toda) ? driverData.toda[0] : driverData.toda;
      const todaNameStr = todaInfo?.toda_name || '';
      const todaAcronymStr = todaInfo?.toda_acronym || '';

      const verif = driverData.verification;
      const plateNumber = driverData.plate_number || verif?.submitted_plate_number || verif?.ocr_plate_number || '';
      const licenseNumber = driverData.license_number || verif?.submitted_license_number || verif?.ocr_license_number || '';
      const franchiseNumber = driverData.franchise_number || verif?.submitted_franchise_number || verif?.ocr_franchise_number || '';
      const rating = Number(driverData.weighted_average_rating) || 5.0;

      localStorage.setItem(
        'sakay_driver_profile',
        JSON.stringify({
          id: driverData.driver_id,
          name: driverData.full_name,
          phone: phone63,
          email: driverData.email || '',
          vehiclePlate: plateNumber,
          licenseNumber: licenseNumber,
          franchiseNumber: franchiseNumber,
          todaName: todaInfo ? `${todaNameStr} (${todaAcronymStr})` : '',
          selectedTodaId: driverData.toda_id || '',
          rating: rating,
          totalTrips: 0,
          isOnline: false,
          isPaused: false,
          accountStatus: driverData.account_status,
          verificationStage: driverData.account_status === 'Verified' ? 'Stage 2 Approved' : 'Stage 1 TODA Review',
        })
      );

      // BATCH 2 FIX: Update single-session token upon new login
      if (driverData?.driver_id) {
        try {
          await rotateDriverSession(driverData.driver_id);
        } catch (err) {
          console.warn("Failed to rotate session:", err);
        }
      }

      setLoading(false);
      setSuccess(true);

      setTimeout(() => {
        if (driverData.account_status === 'Verified') {
          navigate('/driver/home', { replace: true });
        } else if (driverData.account_status === 'Rejected') {
          navigate('/driver/status', {
            replace: true,
            state: {
              driverName: driverData.full_name,
              accountStatus: 'Rejected',
              rejectionReason: driverData.verification?.remarks || 'Application rejected',
            },
          });
        } else {
          const verifObj = driverData.verification;
          if (!verifObj || !verifObj.submitted_license_number) {
            navigate('/driver/prepare-documents', {
              replace: true,
              state: {
                phone: phone63,
                driverName: driverData.full_name,
              },
            });
            return;
          }

          const isEndorsed =
            verifObj.verification_status === 'Approved' ||
            verifObj.verification_status === 'TODA Approved' ||
            verifObj.verification_status === 'Endorsed to LGU' ||
            driverData.account_status === 'TODA Approved' ||
            driverData.account_status === 'Endorsed to LGU';

          navigate('/driver/status', {
            replace: true,
            state: {
              driverName: driverData.full_name,
              accountStatus: isEndorsed ? 'Endorsed to LGU' : 'Pending Verification',
            },
          });
        }
      }, 1000);
    } catch (err: any) {
      setLoading(false);
      console.error('[DriverLogin] Login exception:', err);
      triggerErrorToast(
        err?.status === 429
          ? (language === 'tl'
              ? 'Masyadong maraming pagtatangka. Maghintay ng ilang minuto bago subukang muli.'
              : 'Too many attempts. Please wait a few minutes before trying again.')
          : err?.message ||
          (language === 'tl'
            ? 'Hindi makakonekta sa database. Pakisubukang muli.'
            : 'Unable to connect to the database. Please try again.')
      );
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Toast Error Notification */}
      <SakayToast
        open={toastOpen}
        message={toastMessage}
        severity="error"
        onClose={() => setToastOpen(false)}
      />

      {/* Fixed Sticky Header matching Passenger PWA */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '16px 24px 12px 24px',
          paddingTop: 'calc(var(--safe-area-top) + 16px)',
          backgroundColor: '#FFFFFF',
          zIndex: 20,
          flexShrink: 0,
          borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
        }}
      >
        <IconButton
          onClick={handleBack}
          sx={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            color: '#1A1A1A',
            borderRadius: '14px',
            width: '44px',
            height: '44px',
            '&:hover': { backgroundColor: '#F8FAFC' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Logo color="orange" width={110} />
      </Box>

      {/* Scrollable Form Body */}
      <Box
        component="form"
        onSubmit={handleLogin}
        className="anim-fade-in hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          padding: '24px 24px calc(var(--safe-area-bottom) + 24px) 24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ width: '100%' }}>
          <Box sx={{ marginTop: '8px', textAlign: 'left', width: '100%' }}>
            <Typography
              component="h2"
              sx={{
                fontSize: '26px',
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.3,
              }}
            >
              {t.loginTitle}
            </Typography>
            <Typography
              sx={{
                fontSize: '15px',
                color: '#64748B',
                marginTop: '8px',
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              {language === 'tl'
                ? 'Ilagay ang inyong numero ng telepono at password upang mag-login.'
                : 'Enter your mobile number and password to log in.'}
            </Typography>
          </Box>

          <Box
            sx={{
              marginTop: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              width: '100%',
            }}
          >
            <SakayPhoneInput
              label={language === 'tl' ? 'NUMERO NG TELEPONO' : 'MOBILE NUMBER'}
              value={phone}
              onChange={(val) => setPhone(val)}
              onFocus={() => setPhoneTouched(true)}
              onBlur={() => setPhoneTouched(true)}
              required
              error={showPhoneError}
              helperText={
                showPhoneError
                  ? language === 'tl'
                    ? 'Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9.'
                    : 'Please enter a valid 10-digit mobile number starting with 9.'
                  : ''
              }
            />

            <RegisterInput
              label="PASSWORD"
              required
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(val) => setPassword(val)}
              endAdornment={
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                  sx={{ color: '#64748B' }}
                >
                  {showPassword ? (
                    <VisibilityOffOutlinedIcon fontSize="small" />
                  ) : (
                    <VisibilityOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              }
            />

            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <Typography
                onClick={() => navigate('/forgot-password')}
                sx={{
                  fontSize: '14px',
                  color: '#FF6B00',
                  fontWeight: 600,
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline', color: '#E66000' },
                }}
              >
                {t.forgotPassword}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            marginTop: 'auto',
            paddingTop: '24px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <PrimaryButton type="submit" fullWidth disabled={isLoginDisabled} loading={loading}>
            {t.loginTitle}
          </PrimaryButton>

          <Typography
            sx={{
              textAlign: 'center',
              fontSize: '14px',
              color: '#0F172A',
              fontWeight: 600,
            }}
          >
            {t.dontHaveAccount || 'Wala ka pang account?'}{' '}
            <Box
              component="span"
              onClick={() => navigate('/driver/register')}
              sx={{
                color: '#FF6B00',
                fontWeight: 700,
                cursor: 'pointer',
                marginLeft: '6px',
                transition: 'color 0.2s',
                '&:hover': { color: '#E66000', textDecoration: 'underline' },
              }}
            >
              {t.registerLink || 'Mag-register'}
            </Box>
          </Typography>
        </Box>
      </Box>

      <SuccessModal
        open={success}
        title={language === 'tl' ? 'Matagumpay na Login!' : 'Login Successful!'}
        message={t.successLogin || (language === 'tl' ? 'Maligayang pagbabalik sa SAKAY Driver!' : 'Welcome back to SAKAY Driver!')}
      />
    </Box>
  );
};

export default DriverLogin;
