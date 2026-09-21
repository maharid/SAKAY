import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';

import Logo from '../../../common/components/Logo';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SuccessModal from '../../../common/components/SuccessModal';
import { RegisterInput } from '../../../common/components/RegisterInput';
import SakayPhoneInput from '../../../common/components/SakayPhoneInput';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { getPhoneLookupCandidates, lookupDriverByPhoneSecure } from '../../../services/driverApiService';

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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const cleanPhoneDigits = phone.replace(/\D/g, '');
  const isValidPhone = cleanPhoneDigits.length === 11 && cleanPhoneDigits.startsWith('09');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    const rawDigits = phone.replace(/\D/g, '');
    if (!rawDigits || !password) {
      setError(
        t.enterPhoneAndPassword ||
          (language === 'tl'
            ? 'Mangyaring ilagay ang iyong numero at password.'
            : 'Please enter your mobile number and password.')
      );
      return;
    }

    const candidates = getPhoneLookupCandidates(rawDigits);
    const phone09 = candidates.phone09;
    const phone63 = candidates.phone63WithPlus;

    setLoading(true);
    setError('');

    // Instant Verified Test Driver Login (Option A for live map & ride testing)
    const isTestDriver =
      (phone09 === '09171234567' || phone09 === '09181234567' || phone09 === '09123456789' || phone09 === '09999999999') &&
      (password === 'Password123!' || password === '@Dmin_123' || password === 'password' || password === '123456');

    if (isTestDriver) {
      setLoading(false);
      sessionStorage.setItem('sakay_driver_just_logged_in', 'true');
      sessionStorage.removeItem('sakay_driver_location_prompt_dismissed');
      localStorage.removeItem('sakay_driver_location_permission');
      localStorage.setItem('sakay_driver_phone', phone63);
      localStorage.setItem('sakay_driver_id', '11111111-1111-1111-1111-111111111111');
      localStorage.setItem(
        'sakay_driver_profile',
        JSON.stringify({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Juan Dela Cruz',
          phone: phone63,
          vehiclePlate: 'ABC 123',
          licenseNumber: 'N03-12-123456',
          franchiseNumber: '1234',
          todaName: 'Calapan Central TODA (CCTODA)',
          selectedTodaId: 'toda-1',
          selectedVehicleId: 'VEH-001',
          rating: 5.0,
          totalTrips: 0,
          isOnline: true,
          isPaused: false,
          currentLat: 13.4124,
          currentLng: 121.1834,
          accountStatus: 'Verified',
          verificationStage: 'Stage 2 Approved',
        })
      );
      setSuccess(true);
      setTimeout(() => {
        navigate('/driver/home', { replace: true });
      }, 1000);
      return;
    }

    try {
      // 1. Verify if driver account exists in database first using secure lookup
      const driverData = await lookupDriverByPhoneSecure(phone63);

      if (!driverData) {
        setLoading(false);
        setError(
          language === 'tl'
            ? 'Walang nahanap na account para sa numerong ito. Mangyaring mag-register muna o suriin ang inyong numero.'
            : 'No account found for this mobile number. Please register first or check your mobile number.'
        );
        return;
      }

      // 2. Driver exists! Attempt authentication with Supabase Auth
      let sessionUser: any = null;

      // Prepare candidate credentials
      const authCandidates = [...candidates.authCandidates];
      if (driverData.email && !authCandidates.some((c: any) => c.email === driverData.email)) {
        authCandidates.unshift({ email: driverData.email });
      }

      for (const candidate of authCandidates) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          ...candidate,
          password: password,
        });

        if (!signInErr && signInData?.user) {
          sessionUser = signInData.user;
          break;
        }
      }

      // 3. If password was incorrect:
      if (!sessionUser) {
        setLoading(false);
        setError(
          language === 'tl'
            ? 'Mali ang password para sa account na ito. Pakisubukang muli.'
            : 'Incorrect password for this account. Please check your password and try again.'
        );
        return;
      }

      // 4. Session established! Link driver record to sessionUser if unlinked
      if (sessionUser?.id && !driverData.auth_user_id) {
        await supabase
          .from('driver')
          .update({ auth_user_id: sessionUser.id, contact_number: phone63 })
          .eq('driver_id', driverData.driver_id);
      } else if (driverData.contact_number !== phone63) {
        supabase
          .from('driver')
          .update({ contact_number: phone63 })
          .eq('driver_id', driverData.driver_id)
          .then(() => {});
      }

      sessionStorage.setItem('sakay_driver_just_logged_in', 'true');
      sessionStorage.removeItem('sakay_driver_location_prompt_dismissed');
      localStorage.removeItem('sakay_driver_location_permission');

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
          verificationStage: driverData.account_status === 'Verified' || driverData.account_status === 'Active' ? 'Stage 2 Approved' : 'Stage 1 TODA Review',
        })
      );

      setLoading(false);
      setSuccess(true);

      setTimeout(() => {
        if (driverData.account_status === 'Active' || driverData.account_status === 'Verified') {
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
      setError(
        err?.message ||
          (language === 'tl'
            ? 'Hindi makakonekta sa database. Pakisubukang muli.'
            : 'Unable to connect to the database. Please try again.')
      );
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/welcome');
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

          {error && (
            <Alert severity="error" sx={{ width: '100%', marginTop: '16px', borderRadius: '12px' }}>
              {error}
            </Alert>
          )}

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
              onChange={(val) => {
                setPhone(val);
                if (error) setError('');
              }}
              required
              error={hasAttemptedSubmit && !isValidPhone}
              helperText={
                hasAttemptedSubmit && !isValidPhone
                  ? language === 'tl'
                    ? 'Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9.'
                    : 'Please enter a valid 10-digit mobile number starting with 9.'
                  : ''
              }
            />

            <RegisterInput
              label="PASSWORD"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(val) => {
                setPassword(val);
                if (error) setError('');
              }}
              error={hasAttemptedSubmit && !password}
              helperText={hasAttemptedSubmit && !password ? t.passwordRequired : ''}
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
          <PrimaryButton type="submit" fullWidth loading={loading}>
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
              onClick={() => navigate('/account-selection')}
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
