import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import PageHeader from '../../../common/components/PageHeader';
import { useLanguage } from '../../../utils/LanguageContext';
import { supabase } from '../../../services/supabaseClient';
import { extendTapArea } from '@sakay/shared';

export const DriverChangePasswordPage: React.FC = () => {
  const { language } = useLanguage();
  const isTagalog = language === 'tl';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Password criteria check
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-]/.test(newPassword);

  const criteriaList = [
    { label: isTagalog ? 'Hindi bababa sa 8 karakter' : 'Minimum 8 characters', met: hasMinLength },
    { label: isTagalog ? 'May 1 malaking titik (A-Z)' : 'At least 1 uppercase letter (A-Z)', met: hasUppercase },
    { label: isTagalog ? 'May 1 maliit na titik (a-z)' : 'At least 1 lowercase letter (a-z)', met: hasLowercase },
    { label: isTagalog ? 'May 1 numero (0-9)' : 'At least 1 number (0-9)', met: hasNumber },
    { label: isTagalog ? 'May 1 espesyal na karakter (!@#$%^&*)' : 'At least 1 special character (!@#$%^&*)', met: hasSpecial },
  ];

  const isPasswordValid = criteriaList.every((c) => c.met);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!isPasswordValid) {
      setErrorMsg(
        isTagalog
          ? 'Pakitiyak na natutugunan ng bagong password ang lahat ng pamantayan sa ibaba.'
          : 'Please make sure your new password meets all security criteria below.'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg(
        isTagalog
          ? 'Hindi magkatugma ang bagong password at kumpirmasyon.'
          : 'New password and confirm password do not match.'
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setSuccessMsg(
        isTagalog
          ? 'Matagumpay na napalitan ang iyong password!'
          : 'Password successfully updated!'
      );
      setTimeout(() => {
        navigate('/driver/settings', { replace: true });
      }, 1500);
    } catch (err: any) {
      console.warn('Driver change password error:', err);
      setErrorMsg(
        err?.message ||
          (isTagalog
            ? 'Nagkaroon ng problema sa pagpapalit ng password.'
            : 'Failed to update password. Please try again.')
      );
    } finally {
      setLoading(false);
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
        title={isTagalog ? 'Palitan ang Password' : 'Change Password'}
        onBack={() => navigate('/driver/settings')}
      />

      <Box
        component="form"
        onSubmit={handleSubmit}
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          '& > *': { flexShrink: 0 },
          p: 2.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: '20px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #F1F5F9',
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1, borderBottom: '1px solid #F8FAFC' }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '12px',
                backgroundColor: '#FFF2E9',
                color: '#FF6600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LockOutlinedIcon sx={{ fontSize: 22 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>
                {isTagalog ? 'Seguridad ng Account' : 'Account Security'}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {isTagalog ? 'Ilagay ang iyong bagong secure password' : 'Enter your new secure password'}
              </Typography>
            </Box>
          </Box>

          {errorMsg && (
            <Alert severity="error" sx={{ borderRadius: '12px' }}>
              {errorMsg}
            </Alert>
          )}

          {successMsg && (
            <Alert severity="success" sx={{ borderRadius: '12px' }}>
              {successMsg}
            </Alert>
          )}

          {/* New Password */}
          <TextField
            fullWidth
            required
            type={showNewPassword ? 'text' : 'password'}
            label={isTagalog ? 'Bagong Password' : 'New Password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      edge="end"
                      size="small"
                      sx={{ ...extendTapArea(8), color: '#64748B' }}
                    >
                      {showNewPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
                sx: {
                  borderRadius: '14px',
                  backgroundColor: '#F8FAFC',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#FF6600' },
                },
              },
            }}
          />

          {/* Criteria List */}
          <Box sx={{ pl: 0.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {criteriaList.map((crit, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleIcon sx={{ fontSize: 16, color: crit.met ? '#16A34A' : '#CBD5E1' }} />
                <Typography sx={{ fontSize: '12px', color: crit.met ? '#16A34A' : '#64748B', fontWeight: crit.met ? 600 : 400 }}>
                  {crit.label}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Confirm New Password */}
          <TextField
            fullWidth
            required
            type={showConfirmPassword ? 'text' : 'password'}
            label={isTagalog ? 'Kumpirmahin ang Bagong Password' : 'Confirm New Password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={confirmPassword.length > 0 && newPassword !== confirmPassword}
            helperText={confirmPassword.length > 0 && newPassword !== confirmPassword ? (isTagalog ? 'Hindi magkatugma ang password.' : 'Passwords do not match.') : ''}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                      size="small"
                      sx={{ ...extendTapArea(8), color: '#64748B' }}
                    >
                      {showConfirmPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
                sx: {
                  borderRadius: '14px',
                  backgroundColor: '#F8FAFC',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#FF6600' },
                },
              },
            }}
          />
        </Paper>

        <Box sx={{ flexGrow: 1 }} />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={loading || !newPassword || !confirmPassword}
          sx={{
            height: '52px',
            borderRadius: '16px',
            backgroundColor: '#FF6600',
            color: '#1A1A1A',
            fontWeight: 700,
            fontSize: '15px',
            textTransform: 'none',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#E55C00', boxShadow: 'none' },
            '&.Mui-disabled': { backgroundColor: '#FFD1B3', color: '#888888' },
            mb: 'calc(var(--safe-area-bottom) + 8px)',
          }}
        >
          {loading ? (
            <CircularProgress size={24} sx={{ color: '#1A1A1A' }} />
          ) : isTagalog ? (
            'I-save ang Bagong Password'
          ) : (
            'Save New Password'
          )}
        </Button>
      </Box>
    </Box>
  );
};

export default DriverChangePasswordPage;
