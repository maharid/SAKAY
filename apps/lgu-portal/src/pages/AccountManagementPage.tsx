import React, { useEffect, useState } from 'react';
import { Alert, Avatar, Box, Button, TextField, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { ChangePasswordDialog, SakayToast } from '@sakay/shared';

import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabaseClient';
import { updateMyLguProfile } from '../services/adminApiService';
import { SakayPhoneInput } from '../components/common/SakayPhoneInput';
import { FlagTag } from '../components/common/DataTable';
import { DashboardCard } from '../components/dashboard/DashboardCard';
import { FONT, SPACE } from '../styles/density';
import { PAGE_TEXT, pageCardSx, primaryButtonSx, secondaryButtonSx } from '../styles/pageTheme';

type Message = { type: 'success' | 'error'; text: string } | null;

// The look of the fields on this page: the same 40px field as the rest of the portal
const accountInputStyles = {
  '& .MuiOutlinedInput-root': { borderRadius: '10px', backgroundColor: '#FFFFFF', fontSize: FONT.body },
  '& .MuiInputLabel-root': { fontSize: FONT.body },
  '& .MuiFormHelperText-root': { fontSize: FONT.small },
};

// The result of the last save, shown above the field it belongs to
const FormMessage: React.FC<{ message: Message }> = ({ message }) =>
  message ? (
    <Alert severity={message.type} role={message.type === 'error' ? 'alert' : 'status'} sx={{ mb: '14px', borderRadius: '10px', py: '2px', '& .MuiAlert-message': { fontSize: FONT.body } }}>
      {message.text}
    </Alert>
  ) : null;

// One form of the page. The button sits at the bottom of its card, so the cards of a row end on the same line.
const AccountForm: React.FC<{ onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }> = ({ onSubmit, children }) => (
  <Box component="form" noValidate onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
    {children}
  </Box>
);

// A read-only line of the profile: a label and the value (or a quiet "Not set")
const ProfileLine: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography component="dt" sx={{ fontSize: FONT.small, fontWeight: 600, color: PAGE_TEXT.secondary }}>{label}</Typography>
    <Typography component="dd" sx={{ m: 0, mt: '1px', fontSize: FONT.body, color: value ? PAGE_TEXT.primary : PAGE_TEXT.secondary, overflowWrap: 'anywhere' }}>{value || 'Not set'}</Typography>
  </Box>
);

// Stored as +639XXXXXXXXX, edited as 09XXXXXXXXX
const nationalOf = (stored?: string | null): string => {
  const digits = String(stored ?? '').replace(/\D/g, '');
  if (digits.startsWith('639')) return `0${digits.slice(2)}`;
  return digits.startsWith('09') ? digits : '';
};
const prettyPhone = (stored?: string | null): string => {
  const national = nationalOf(stored);
  return national.length === 11 ? `+63 ${national.slice(1, 4)} ${national.slice(4, 7)} ${national.slice(7)}` : '';
};

interface ProfileFields {
  fullName: string;
  position: string;
  office: string;
  contact: string;
}
interface ProfileErrors {
  fullName?: string;
  position?: string;
  office?: string;
  contact?: string;
}

/** The checks the database makes again (update_my_lgu_profile): so a mistake is shown beside its field before anything is sent */
function profileErrors(f: ProfileFields): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = f.fullName.trim();
  if (name.length < 2) errors.fullName = 'Enter your full name.';
  else if (name.length > 120 || !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .,'-]*$/.test(name)) errors.fullName = 'Use letters, spaces, dots, commas, apostrophes and hyphens only (2 to 120 characters).';
  if (f.position.trim().length > 100) errors.position = 'The position is too long (at most 100 characters).';
  if (f.office.trim().length > 150) errors.office = 'The office is too long (at most 150 characters).';
  if (f.contact !== '' && !/^09\d{9}$/.test(f.contact)) errors.contact = 'Enter an 11-digit mobile number starting with 09, or leave it empty.';
  return errors;
}

export const AccountManagementPage: React.FC = () => {
  const { user, adminProfile, refreshProfile } = useAuth();

  // Profile: shown, then edited with Save and Cancel
  const savedFields: ProfileFields = {
    fullName: adminProfile?.full_name || '',
    position: adminProfile?.position || '',
    office: adminProfile?.office_name || '',
    contact: nationalOf(adminProfile?.contact_number),
  };
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<ProfileFields>(savedFields);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Message>(null);
  const errors = touched ? profileErrors(fields) : {};
  const changed = (Object.keys(fields) as Array<keyof ProfileFields>).some((k) => fields[k].trim() !== savedFields[k].trim());

  // Email State
  const [email, setEmail] = useState(user?.email || adminProfile?.email || '');
  const [emailMsg, setEmailMsg] = useState<Message>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  // Password window and its toast
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  // when the profile is read again (after a save, or the first time) the form shows what is stored, unless the person is in the middle of editing
  useEffect(() => {
    if (!editing) setFields({ fullName: adminProfile?.full_name || '', position: adminProfile?.position || '', office: adminProfile?.office_name || '', contact: nationalOf(adminProfile?.contact_number) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminProfile?.full_name, adminProfile?.position, adminProfile?.office_name, adminProfile?.contact_number, editing]);

  useEffect(() => {
    const currentMail = user?.email || adminProfile?.email;
    if (currentMail) setEmail(currentMail);
  }, [user?.email, adminProfile?.email]);

  const startEditing = () => {
    setFields(savedFields);
    setTouched(false);
    setProfileMsg(null);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditing(false);
    setTouched(false);
    setFields(savedFields);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setTouched(true);
    if (Object.keys(profileErrors(fields)).length > 0) return;
    setSaving(true);
    setProfileMsg(null);
    const problem = await updateMyLguProfile({ fullName: fields.fullName.trim(), position: fields.position.trim(), office: fields.office.trim(), contactNumber: fields.contact === '' ? '' : `+63${fields.contact.slice(1)}` });
    if (problem) {
      setProfileMsg({ type: 'error', text: problem });
      setSaving(false);
      return;
    }
    await refreshProfile();
    setSaving(false);
    setEditing(false);
    setTouched(false);
    setProfileMsg({ type: 'success', text: 'Your profile was updated.' });
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

  // The password: the current one is checked again by the login system, then the new one is set
  const verifyCurrentPassword = async (current: string): Promise<string | null> => {
    const loginEmail = user?.email || adminProfile?.email;
    if (!loginEmail) return 'Your login has no e-mail address on record, so the current password cannot be checked. Sign in again.';
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: current });
    if (!error) return null;
    return error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'The current password is not right.';
  };
  const setNewPassword = async (password: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({ password });
    return error ? error.message || 'The password could not be changed. Please try again.' : null;
  };

  const displayName = adminProfile?.full_name || 'City Administrator';
  const displayEmail = adminProfile?.email || user?.email || email || '';
  const initial = displayName.charAt(0).toUpperCase();
  const set = (key: keyof ProfileFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto', pb: 4.8, position: 'relative' }}>
      {/* 1. Who is signed in */}
      <Box component="section" aria-label="Your account" sx={{ ...pageCardSx, p: SPACE.cardLarge, mb: SPACE.gapLarge, display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <Avatar aria-hidden sx={{ width: 56, height: 56, bgcolor: 'var(--sakay-orange-soft)', color: PAGE_TEXT.brand, fontSize: '20px', fontWeight: 700, border: '2px solid var(--sakay-orange-border)', flexShrink: 0 }}>
          {initial}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
            <Typography component="h2" sx={{ fontSize: FONT.sectionTitle, fontWeight: 700, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{displayName}</Typography>
            <FlagTag label="LGU Administrator" tone="brand" />
          </Box>
          {(adminProfile?.position || adminProfile?.office_name) && (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '3px', overflowWrap: 'anywhere' }}>{[adminProfile?.position, adminProfile?.office_name].filter(Boolean).join(' · ')}</Typography>
          )}
          {displayEmail && <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, mt: '2px', overflowWrap: 'anywhere' }}>{displayEmail}</Typography>}
        </Box>
      </Box>

      <Box sx={{ containerType: 'inline-size' }}>
        {/* 2. The profile: read, then edit with Save and Cancel */}
        <Box sx={{ mb: SPACE.gapLarge }}>
          <DashboardCard
            title="Your profile"
            description="Your name, position, office and contact number as they appear in the portal. Your login, e-mail and role are not changed here."
            actions={
              !editing ? (
                <Button onClick={startEditing} startIcon={<EditOutlinedIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
                  Edit profile
                </Button>
              ) : undefined
            }
          >
            <FormMessage message={profileMsg} />
            {!editing ? (
              <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '14px 24px' }}>
                <ProfileLine label="Full name" value={adminProfile?.full_name} />
                <ProfileLine label="Position" value={adminProfile?.position} />
                <ProfileLine label="Office" value={adminProfile?.office_name} />
                <ProfileLine label="Contact number" value={prettyPhone(adminProfile?.contact_number)} />
                <ProfileLine label="E-mail (login)" value={displayEmail} />
                <ProfileLine label="Role" value="LGU Administrator" />
              </Box>
            ) : (
              <AccountForm onSubmit={saveProfile}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '14px 18px' }}>
                  <TextField fullWidth size="small" label="Full name" required autoComplete="name" value={fields.fullName} onChange={(e) => set('fullName')(e.target.value)} disabled={saving} error={Boolean(errors.fullName)} helperText={errors.fullName} slotProps={{ formHelperText: errors.fullName ? { role: 'alert' } : undefined }} sx={accountInputStyles} />
                  <TextField fullWidth size="small" label="Position" placeholder="e.g. City Transport Officer" value={fields.position} onChange={(e) => set('position')(e.target.value)} disabled={saving} error={Boolean(errors.position)} helperText={errors.position} sx={accountInputStyles} />
                  <TextField fullWidth size="small" label="Office" placeholder="e.g. City Transport Office, Calapan City" value={fields.office} onChange={(e) => set('office')(e.target.value)} disabled={saving} error={Boolean(errors.office)} helperText={errors.office} sx={accountInputStyles} />
                  <Box>
                    <SakayPhoneInput label="Mobile number" value={fields.contact} onChange={set('contact')} compact />
                    {errors.contact && <Typography role="alert" sx={{ fontSize: FONT.small, color: PAGE_TEXT.danger, mt: '3px' }}>{errors.contact}</Typography>}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <Button type="submit" variant="contained" disableElevation disabled={saving || !changed} sx={primaryButtonSx}>
                    {saving ? 'Saving...' : 'Save profile'}
                  </Button>
                  <Button onClick={cancelEditing} disabled={saving} sx={secondaryButtonSx}>
                    Cancel
                  </Button>
                  {!changed && <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, alignSelf: 'center' }}>Nothing has changed yet.</Typography>}
                </Box>
              </AccountForm>
            )}
          </DashboardCard>
        </Box>

        {/* 3. Sign-in: e-mail and password */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: SPACE.gapLarge, alignItems: 'stretch', '@container (min-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } }}>
          <DashboardCard title="Change email address" description="Update your official municipal email. A confirmation is sent to the new address.">
            <FormMessage message={emailMsg} />
            <AccountForm onSubmit={handleUpdateEmail}>
              <TextField fullWidth size="small" label="New email address" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isUpdatingEmail} sx={accountInputStyles} />
              <Box sx={{ mt: 'auto' }}>
                <Button type="submit" variant="contained" disabled={isUpdatingEmail || email === displayEmail} sx={primaryButtonSx}>
                  {isUpdatingEmail ? 'Updating...' : 'Update email'}
                </Button>
              </Box>
            </AccountForm>
          </DashboardCard>

          <DashboardCard title="Password" description="Change the password you sign in with. You will be asked for the current one.">
            <Box sx={{ mt: 'auto' }}>
              <Button onClick={() => setPasswordOpen(true)} startIcon={<LockOutlinedIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
                Change password
              </Button>
            </Box>
          </DashboardCard>
        </Box>
      </Box>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} verifyCurrent={verifyCurrentPassword} setNewPassword={setNewPassword} onChanged={() => setPasswordChanged(true)} />
      <SakayToast message={passwordChanged ? 'Your password was changed.' : null} severity="success" onClose={() => setPasswordChanged(false)} />
    </Box>
  );
};
