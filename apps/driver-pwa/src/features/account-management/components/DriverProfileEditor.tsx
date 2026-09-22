import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Avatar,
  CircularProgress,
  Alert,
  IconButton,
  Button,
  Chip,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import VerifiedIcon from '@mui/icons-material/Verified';
import BadgeIcon from '@mui/icons-material/Badge';
import DescriptionIcon from '@mui/icons-material/Description';
import TwoWheelerIcon from '@mui/icons-material/TwoWheeler';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import PageHeader from '../../../common/components/PageHeader';
import PrimaryButton from '../../../common/components/PrimaryButton';
import SuccessModal from '../../../common/components/SuccessModal';
import { RegisterInput } from '../../../common/components/RegisterInput';
import SakayPhoneInput from '../../../common/components/SakayPhoneInput';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { fetchDriverProfile, formatPhoneToE164 } from '../../../services/driverApiService';

export const DriverProfileEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();
  const isTagalog = language === 'tl';

  const locationState = location.state as { phoneUpdated?: boolean } | null;

  const [profile, setProfile] = useState<any>(() => {
    const saved = localStorage.getItem('sakay_driver_profile');
    return saved ? JSON.parse(saved) : {
      id: '',
      name: '',
      phone: '',
      email: '',
      licenseNumber: '',
      vehiclePlate: '',
      franchiseNumber: '',
      todaName: '',
      rating: 5.0,
      totalTrips: 0,
      profile_photo_url: '',
    };
  });

  const [fullName, setFullName] = useState(profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [initialPhone, setInitialPhone] = useState(profile.phone || '');
  const [email, setEmail] = useState(profile.email || '');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(profile.profile_photo_url || '');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const driverId = localStorage.getItem('sakay_driver_id') || undefined;
    fetchDriverProfile(driverId).then(async (dbProfile) => {
      if (dbProfile) {
        const { count: completedTripsCount } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .eq('driver_id', dbProfile.id)
          .eq('booking_status', 'Completed');

        const combined = {
          ...dbProfile,
          totalTrips: completedTripsCount || 0,
        };
        setProfile(combined);
        setFullName(combined.name || '');
        setPhone(combined.phone || '');
        setInitialPhone(combined.phone || '');
        setEmail(combined.email || '');
        if ((combined as any).profile_photo_url) {
          setProfilePhotoUrl((combined as any).profile_photo_url);
        }
        localStorage.setItem('sakay_driver_profile', JSON.stringify(combined));
      }
    });
  }, []);

  useEffect(() => {
    if (locationState?.phoneUpdated) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    }
  }, [locationState]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploadingPhoto(true);

    try {
      const activeId = profile.id || localStorage.getItem('sakay_driver_id');
      const fileExt = file.name.split('.').pop();
      const fileName = `driver-${activeId || Date.now()}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from('profiles')
        .upload(filePath, file, { upsert: true });

      if (uploadErr) {
        throw new Error(uploadErr.message);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('profiles')
        .getPublicUrl(filePath);

      setProfilePhotoUrl(publicUrl);

      if (activeId) {
        await supabase
          .from('driver')
          .update({ profile_photo_url: publicUrl })
          .eq('driver_id', activeId);
      }
    } catch (err: any) {
      setError(err?.message || (isTagalog ? 'Hindi ma-upload ang larawan.' : 'Failed to upload photo.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(isTagalog ? 'Kailangan ang buong pangalan.' : 'Full name is required.');
      return;
    }

    setSaving(true);
    setError(null);

    const cleanNewPhone = phone.replace(/\D/g, '');
    const cleanOldPhone = initialPhone.replace(/\D/g, '');
    const formattedPhone = formatPhoneToE164(cleanNewPhone);

    const updated = {
      ...profile,
      name: fullName.trim(),
      phone: formattedPhone,
      email: email.trim(),
      profile_photo_url: profilePhotoUrl,
    };

    try {
      const activeId = profile.id || localStorage.getItem('sakay_driver_id');
      if (activeId) {
        await supabase
          .from('driver')
          .update({
            full_name: fullName.trim(),
            contact_number: formattedPhone,
            email: email.trim() || null,
            profile_photo_url: profilePhotoUrl || null,
          })
          .eq('driver_id', activeId);
      }

      // If mobile number was changed, trigger OTP verification
      if (cleanNewPhone && cleanNewPhone !== cleanOldPhone) {
        setSaving(false);
        navigate('/driver/verify-otp', {
          state: {
            phone: formattedPhone,
            fullName: fullName.trim(),
            isPhoneChange: true,
            oldPhone: initialPhone,
            returnTo: '/driver/profile',
          },
        });
        return;
      }

      setProfile(updated);
      localStorage.setItem('sakay_driver_profile', JSON.stringify(updated));
      localStorage.setItem('sakay_driver_phone', formattedPhone);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err?.message || (isTagalog ? 'Hindi ma-save ang profile.' : 'Failed to save profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FAFAFA',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PageHeader
        title={isTagalog ? 'Impormasyon ng Profile' : 'Profile Information'}
        onBack={() => navigate('/driver/settings')}
      />

      <Box
        component="form"
        onSubmit={handleSave}
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          p: 2.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
        }}
      >
        {/* Profile Avatar */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', my: 0.5 }}>
          <Box sx={{ position: 'relative' }}>
            <Avatar
              src={profilePhotoUrl}
              sx={{
                width: '90px',
                height: '90px',
                backgroundColor: '#FF6B00',
                fontSize: '32px',
                fontWeight: 800,
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                border: '3px solid #FFF',
                outline: '2px solid #E2E8F0',
              }}
            >
              {fullName ? fullName.charAt(0).toUpperCase() : 'D'}
            </Avatar>
            <IconButton
              component="label"
              disabled={uploadingPhoto}
              sx={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                backgroundColor: '#FF6B00',
                color: '#FFFFFF',
                '&:hover': { backgroundColor: '#E05300' },
                width: '30px',
                height: '30px',
                boxShadow: 'none',
              }}
            >
              {uploadingPhoto ? (
                <CircularProgress size={14} sx={{ color: '#FFF' }} />
              ) : (
                <PhotoCameraIcon sx={{ fontSize: 15 }} />
              )}
              <input type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 1.5 }}>
            <VerifiedIcon sx={{ color: '#16A34A', fontSize: 16 }} />
            <Typography sx={{ fontSize: '12.5px', color: '#16A34A', fontWeight: 700 }}>
              {isTagalog ? 'Akreditadong SAKAY Drayber' : 'Accredited SAKAY Driver'}
            </Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px' }}>
            {error}
          </Alert>
        )}

        {/* SECTION 1: Personal Information */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Personal na Impormasyon' : 'Personal Information'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: '16px',
              border: '1px solid #F1F5F9',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <RegisterInput
              label={isTagalog ? 'BUONG PANGALAN' : 'FULL NAME'}
              value={fullName}
              onChange={(val) => setFullName(val)}
            />

            <Box>
              <SakayPhoneInput
                label={isTagalog ? 'NUMERO NG TELEPONO' : 'MOBILE NUMBER'}
                value={phone}
                onChange={(val) => setPhone(val)}
              />
              <Typography sx={{ fontSize: '11px', color: '#64748B', mt: 0.5, ml: 1 }}>
                {isTagalog
                  ? 'Ang pagpapalit ng numero ay nangangailangan ng OTP verification.'
                  : 'Changing your mobile number requires OTP verification.'}
              </Typography>
            </Box>

            <RegisterInput
              label={isTagalog ? 'EMAIL ADDRESS' : 'EMAIL ADDRESS'}
              value={email}
              onChange={(val) => setEmail(val)}
            />
          </Paper>
        </Box>

        {/* SECTION 2: Driver's License */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Lisensya sa Pagmamaneho' : "Driver's License"}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: '16px',
              border: '1px solid #F1F5F9',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BadgeIcon sx={{ color: '#FF6B00', fontSize: 20 }} />
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                  {profile.licenseNumber || 'D02-18-987654'}
                </Typography>
              </Box>
              <Chip
                label={isTagalog ? 'Aktibo' : 'Verified'}
                size="small"
                sx={{
                  backgroundColor: '#ECFDF5',
                  color: '#047857',
                  fontWeight: 700,
                  fontSize: '11px',
                }}
              />
            </Box>

            <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
              {isTagalog ? 'Huling Na-update: Naka-verify sa LTO System' : 'Status: Verified with LTO Record'}
            </Typography>

            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadFileIcon />}
              onClick={() => navigate('/driver/prepare-license')}
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                borderColor: '#CBD5E1',
                color: '#334155',
                fontSize: '12.5px',
                fontWeight: 600,
                py: 0.75,
                mt: 0.5,
                '&:hover': { borderColor: '#FF6B00', color: '#FF6B00', backgroundColor: '#FFF8F0' },
              }}
            >
              {isTagalog ? 'I-update / I-upload ang Lisensya' : 'Re-verify / Upload License'}
            </Button>
          </Paper>
        </Box>

        {/* SECTION 3: MTOP Permit & TODA */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'MTOP Permit at TODA' : 'MTOP Permit & TODA Info'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: '16px',
              border: '1px solid #F1F5F9',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DescriptionIcon sx={{ color: '#FF6B00', fontSize: 20 }} />
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                  {profile.todaName || 'Calapan Central TODA'}
                </Typography>
              </Box>
              <Chip
                label={isTagalog ? 'Rehistrado' : 'Approved'}
                size="small"
                sx={{
                  backgroundColor: '#ECFDF5',
                  color: '#047857',
                  fontWeight: 700,
                  fontSize: '11px',
                }}
              />
            </Box>

            <Typography sx={{ fontSize: '13px', color: '#475569' }}>
              MTOP Permit #: <strong>{profile.franchiseNumber || 'MTOP-2024-04821'}</strong>
            </Typography>

            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadFileIcon />}
              onClick={() => navigate('/driver/mtop-instructions')}
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                borderColor: '#CBD5E1',
                color: '#334155',
                fontSize: '12.5px',
                fontWeight: 600,
                py: 0.75,
                mt: 0.5,
                '&:hover': { borderColor: '#FF6B00', color: '#FF6B00', backgroundColor: '#FFF8F0' },
              }}
            >
              {isTagalog ? 'I-update ang MTOP Permit' : 'Re-verify / Upload MTOP Permit'}
            </Button>
          </Paper>
        </Box>

        {/* SECTION 4: Tricycle Unit */}
        <Box>
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 1,
              px: 0.5,
            }}
          >
            {isTagalog ? 'Impormasyon ng Tricycle' : 'Tricycle Unit Info'}
          </Typography>

          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: '16px',
              border: '1px solid #F1F5F9',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TwoWheelerIcon sx={{ color: '#FF6B00', fontSize: 20 }} />
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                  Plaka: {profile.vehiclePlate || '123-ABC'}
                </Typography>
              </Box>
              <Chip
                label={isTagalog ? 'Inspeksyon OK' : 'Registered'}
                size="small"
                sx={{
                  backgroundColor: '#ECFDF5',
                  color: '#047857',
                  fontWeight: 700,
                  fontSize: '11px',
                }}
              />
            </Box>

            <Typography sx={{ fontSize: '12.5px', color: '#64748B' }}>
              Unit: Registered Public Transport Tricycle
            </Typography>

            <Button
              variant="outlined"
              size="small"
              startIcon={<UploadFileIcon />}
              onClick={() => navigate('/driver/tricycle-instructions')}
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                borderColor: '#CBD5E1',
                color: '#334155',
                fontSize: '12.5px',
                fontWeight: 600,
                py: 0.75,
                mt: 0.5,
                '&:hover': { borderColor: '#FF6B00', color: '#FF6B00', backgroundColor: '#FFF8F0' },
              }}
            >
              {isTagalog ? 'I-update ang Larawan ng Tricycle' : 'Update Tricycle Photo / Details'}
            </Button>
          </Paper>
        </Box>

        {/* Save Changes Primary Button */}
        <Box sx={{ mt: 1, mb: 2 }}>
          <PrimaryButton type="submit" loading={saving} fullWidth>
            {isTagalog ? 'I-save ang mga Pagbabago' : 'Save Changes'}
          </PrimaryButton>
        </Box>
      </Box>

      <SuccessModal
        open={success}
        title={isTagalog ? 'Tagumpay!' : 'Success!'}
        message={isTagalog ? 'Matagumpay na na-update ang iyong profile.' : 'Your profile details have been successfully updated.'}
      />
    </Box>
  );
};

export default DriverProfileEditor;
