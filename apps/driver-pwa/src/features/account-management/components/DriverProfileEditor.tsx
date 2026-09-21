import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Avatar,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import VerifiedIcon from '@mui/icons-material/Verified';

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
  const { language, t } = useLanguage();
  const isTagalog = language === 'tl';

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
        setEmail(combined.email || '');
        if ((combined as any).profile_photo_url) {
          setProfilePhotoUrl((combined as any).profile_photo_url);
        }
        localStorage.setItem('sakay_driver_profile', JSON.stringify(combined));
      }
    });
  }, []);

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

    const cleanRawDigits = phone.replace(/\D/g, '');
    const formattedPhone = formatPhoneToE164(cleanRawDigits);

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
          gap: 2,
        }}
      >
        {/* Profile Avatar */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', my: 1 }}>
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
              Accredited SAKAY Driver
            </Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px' }}>
            {error}
          </Alert>
        )}

        {/* Active Affiliations Summary Card */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', border: '1px solid #F1F5F9', backgroundColor: '#FFFFFF' }}>
          <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', mb: 0.75 }}>
            {isTagalog ? 'Akrreditasyon at Sasakyan' : 'Accreditation & Vehicle'}
          </Typography>
          <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
            TODA: {profile.todaName || 'Calapan Central TODA'}
          </Typography>
          <Typography sx={{ fontSize: '13px', color: '#475569', mt: '2px' }}>
            Plaka: {profile.vehiclePlate || 'N/A'} • Franchise #{profile.franchiseNumber || 'N/A'}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#64748B', mt: '2px' }}>
            Lisensya: {profile.licenseNumber || 'N/A'}
          </Typography>
        </Paper>

        {/* Full Name Input */}
        <RegisterInput
          label={isTagalog ? 'BUONG PANGALAN' : 'FULL NAME'}
          value={fullName}
          onChange={(val) => setFullName(val)}
        />

        {/* Mobile Number Input */}
        <SakayPhoneInput
          label={isTagalog ? 'NUMERO NG TELEPONO' : 'MOBILE NUMBER'}
          value={phone}
          onChange={(val) => setPhone(val)}
        />

        {/* Email Address Input */}
        <RegisterInput
          label={isTagalog ? 'EMAIL ADDRESS' : 'EMAIL ADDRESS'}
          value={email}
          onChange={(val) => setEmail(val)}
        />

        {/* Save Changes Primary Button */}
        <Box sx={{ mt: 2 }}>
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
