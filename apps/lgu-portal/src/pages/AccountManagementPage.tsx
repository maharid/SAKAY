import React, { useState, useEffect } from 'react';
import { Alert, Avatar, Box, Button, TextField, Typography } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabaseClient';
import { SakayPhoneInput } from '../components/common/SakayPhoneInput';
import { FlagTag } from '../components/common/DataTable';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { FONT, SPACE } from '../styles/density';
import { PAGE_TEXT, pageCardSx, primaryButtonSx } from '../styles/pageTheme';

type Message = { type: 'success' | 'error'; text: string } | null;

// The look of the fields on this page: the same 40px field as the rest of the portal
const accountInputStyles = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    backgroundColor: '#FFFFFF',
    fontSize: FONT.body,
  },
  '& .MuiInputLabel-root': { fontSize: FONT.body },
  '& .MuiFormHelperText-root': { fontSize: FONT.small },
};

// The result of the last save, shown above the field it belongs to
const FormMessage: React.FC<{ message: Message }> = ({ message }) =>
  message ? (
    <Alert severity={message.type} sx={{ mb: '14px', borderRadius: '10px', py: '2px', '& .MuiAlert-message': { fontSize: FONT.body } }}>
      {message.text}
    </Alert>
  ) : null;

// One form of the page. The button sits at the bottom of its card, so the cards of a row end on the same line.
const AccountForm: React.FC<{ onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }> = ({ onSubmit, children }) => (
  <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
    {children}
  </Box>
);

export const AccountManagementPage: React.FC = () => {
  const { user, adminProfile, refreshProfile } = useAuth();

  // Name State
  const [fullName, setFullName] = useState(adminProfile?.full_name || 'City Administrator');
  const [nameMsg, setNameMsg] = useState<Message>(null);
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Contact (mobile) number State: stored as +639XXXXXXXXX, edited as 09XXXXXXXXX
  const nationalOf = (stored?: string | null): string => {
    const digits = String(stored ?? '').replace(/\D/g, '');
    if (digits.startsWith('639')) return `0${digits.slice(2)}`;
    return digits.startsWith('09') ? digits : '';
  };
  const [contact, setContact] = useState(nationalOf(adminProfile?.contact_number));
  const [contactMsg, setContactMsg] = useState<Message>(null);
  const [isUpdatingContact, setIsUpdatingContact] = useState(false);

  // Email State
  const [email, setEmail] = useState(user?.email || adminProfile?.email || '');
  const [emailMsg, setEmailMsg] = useState<Message>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  // Password State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<Message>(null);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    setContact(nationalOf(adminProfile?.contact_number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminProfile?.contact_number]);

  useEffect(() => {
    if (adminProfile?.full_name) {
      setFullName(adminProfile.full_name);
    }
  }, [adminProfile?.full_name]);

  useEffect(() => {
    const currentMail = user?.email || adminProfile?.email;
    if (currentMail) {
      setEmail(currentMail);
    }
  }, [user?.email, adminProfile?.email]);

  const handleUpdateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^09\d{9}$/.test(contact)) {
      setContactMsg({ type: 'error', text: 'Enter a valid 11-digit mobile number starting with 09.' });
      return;
    }
    setIsUpdatingContact(true);
    setContactMsg(null);
    try {
      if (user) {
        const { data, error } = await supabase
          .from('lgu_admin')
          .update({ contact_number: `+63${contact.slice(1)}` })
          .eq('auth_user_id', user.id)
          .select('admin_id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('The number was not saved. Sign in again and retry.');
        await refreshProfile();
        setContactMsg({ type: 'success', text: 'Contact number updated successfully!' });
      }
    } catch (err: any) {
      setContactMsg({ type: 'error', text: err.message || 'Failed to update the contact number.' });
    } finally {
      setIsUpdatingContact(false);
    }
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setIsUpdatingName(true);
    setNameMsg(null);
    try {
      if (user) {
        const { error } = await supabase
          .from('lgu_admin')
          .update({ full_name: fullName.trim() })
          .eq('auth_user_id', user.id);
        if (error) throw error;
        await refreshProfile();
        setNameMsg({ type: 'success', text: 'Administrator name updated successfully!' });
      }
    } catch (err: any) {
      setNameMsg({ type: 'error', text: err.message || 'Failed to update administrator name.' });
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setEmailMsg({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }
    setIsUpdatingEmail(true);
    setEmailMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;

      if (user) {
        await supabase.from('lgu_admin').update({ email }).eq('auth_user_id', user.id);
        await refreshProfile();
      }

      setEmailMsg({ type: 'success', text: 'Email update requested. Please check your new email for confirmation.' });
    } catch (err: any) {
      setEmailMsg({ type: 'error', text: err.message || 'Failed to update email. Please try again.' });
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setPasswordMsg({ type: 'error', text: 'Password must be at least 8 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    setIsUpdatingPassword(true);
    setPasswordMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg({ type: 'success', text: 'Password updated successfully!' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || 'Failed to update password.' });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const displayName = adminProfile?.full_name || fullName || 'City Administrator';
  const displayEmail = adminProfile?.email || user?.email || email || '';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto', pb: 4.8, position: 'relative' }}>
      {/* 1. Who is signed in */}
      <Box component="section" aria-label="Your account" sx={{ ...pageCardSx, p: SPACE.cardLarge, mb: SPACE.gapLarge, display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <Avatar
          aria-hidden
          sx={{ width: 56, height: 56, bgcolor: 'var(--sakay-orange-soft)', color: PAGE_TEXT.brand, fontSize: '20px', fontWeight: 700, border: '2px solid var(--sakay-orange-border)', flexShrink: 0 }}
        >
          {initial}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
            <Typography component="h2" sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{displayName}</Typography>
            <FlagTag label="LGU Administrator" tone="brand" />
          </Box>
          {displayEmail && (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '3px', overflowWrap: 'anywhere' }}>{displayEmail}</Typography>
          )}
        </Box>
      </Box>

      {/* 2. The details you can change: name, contact number, e-mail and password */}
      <Box sx={{ containerType: 'inline-size' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: SPACE.gapLarge,
            alignItems: 'stretch',
            '@container (min-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          {/* Administrator Profile Name Update */}
          <DashboardCard title="Administrator name" description="The City Administrator's name as it is shown in the portal.">
            <FormMessage message={nameMsg} />
            <AccountForm onSubmit={handleUpdateName}>
              <TextField
                fullWidth
                size="small"
                label="Full name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isUpdatingName}
                sx={accountInputStyles}
              />
              <Box sx={{ mt: 'auto' }}>
                <Button type="submit" variant="contained" disabled={isUpdatingName || fullName === adminProfile?.full_name} sx={primaryButtonSx}>
                  {isUpdatingName ? 'Saving...' : 'Save name'}
                </Button>
              </Box>
            </AccountForm>
          </DashboardCard>

          {/* Contact (mobile) number */}
          <DashboardCard title="Contact number" description="The mobile number of the City Administrator, kept on the administrator record.">
            <FormMessage message={contactMsg} />
            <AccountForm onSubmit={handleUpdateContact}>
              <SakayPhoneInput label="Mobile number" value={contact} onChange={setContact} required compact />
              <Box sx={{ mt: 'auto' }}>
                <Button type="submit" variant="contained" disabled={isUpdatingContact || contact === nationalOf(adminProfile?.contact_number)} sx={primaryButtonSx}>
                  {isUpdatingContact ? 'Saving...' : 'Save contact number'}
                </Button>
              </Box>
            </AccountForm>
          </DashboardCard>

          {/* Change Email Address */}
          <DashboardCard title="Change email address" description="Update your official municipal email. A confirmation is sent to the new address.">
            <FormMessage message={emailMsg} />
            <AccountForm onSubmit={handleUpdateEmail}>
              <TextField
                fullWidth
                size="small"
                label="New email address"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isUpdatingEmail}
                sx={accountInputStyles}
              />
              <Box sx={{ mt: 'auto' }}>
                <Button type="submit" variant="contained" disabled={isUpdatingEmail || email === displayEmail} sx={primaryButtonSx}>
                  {isUpdatingEmail ? 'Updating...' : 'Update email'}
                </Button>
              </Box>
            </AccountForm>
          </DashboardCard>

          {/* Change Password */}
          <DashboardCard title="Change password" description="Use at least 8 characters.">
            <FormMessage message={passwordMsg} />
            <AccountForm onSubmit={handleUpdatePassword}>
              <TextField
                fullWidth
                size="small"
                label="New password"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isUpdatingPassword}
                sx={accountInputStyles}
              />
              <TextField
                fullWidth
                size="small"
                label="Confirm new password"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isUpdatingPassword}
                sx={accountInputStyles}
              />
              <Box sx={{ mt: 'auto' }}>
                <Button type="submit" variant="contained" disabled={isUpdatingPassword || !newPassword || !confirmPassword} sx={primaryButtonSx}>
                  {isUpdatingPassword ? 'Updating...' : 'Update password'}
                </Button>
              </Box>
            </AccountForm>
          </DashboardCard>
        </Box>
      </Box>
    </Box>
  );
};
