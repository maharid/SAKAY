import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { LguAdminProfile } from '../types/admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  adminProfile: LguAdminProfile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string; role?: 'lgu_admin' | 'toda_admin' }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Earlier versions kept a copy of the signed-in administrator (profile AND tokens) under this key and restored it as a "session" when
// Supabase had none. Nothing is stored or restored any more; this only removes what those versions left in the browser.
const LEGACY_LGU_AUTH_CACHE_KEY = 'sakay_lgu_admin_auth_cache';

const clearLegacyLguAuthCache = () => {
  try {
    localStorage.removeItem(LEGACY_LGU_AUTH_CACHE_KEY);
  } catch {}
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [adminProfile, setAdminProfile] = useState<LguAdminProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // The signed-in user's own row in public.lgu_admin, or null when they are not an LGU administrator.
  // There is NO fallback profile: being signed in is not enough, an administrator needs an Active lgu_admin record.
  const fetchAdminProfile = useCallback(async (authUser: User): Promise<LguAdminProfile | null> => {
    const { data, error: profileError } = await supabase
      .from('lgu_admin')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching LGU Admin profile:', profileError);
      throw new Error(profileError.message);
    }

    if (!data) {
      return null;
    }

    const profile = data as LguAdminProfile;

    if (profile.account_status === 'Suspended') {
      await supabase.auth.signOut();
      clearLegacyLguAuthCache();
      throw new Error('Your administrator account is suspended. Please contact the City Transport & Franchising Office.');
    }

    return profile.account_status === 'Active' ? profile : null;
  }, []);

  // Initialize auth state
  useEffect(() => {
    let isMounted = true;

    clearLegacyLguAuthCache();

    // Puts a Supabase session on screen: the user, and the administrator profile only when they really are one.
    const applySession = async (activeSession: Session | null) => {
      if (!activeSession?.user) {
        setSession(null);
        setUser(null);
        setAdminProfile(null);
        return;
      }
      setSession(activeSession);
      setUser(activeSession.user);
      let profile: LguAdminProfile | null = null;
      try {
        profile = await fetchAdminProfile(activeSession.user);
      } catch {}
      if (isMounted) setAdminProfile(profile);
    };

    const initializeAuth = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { session: initialSession } } = await supabase.auth.getSession();

        if (!isMounted) return;
        await applySession(initialSession);
      } catch (err: any) {
        console.error('Auth initialization error:', err);
        if (isMounted) {
          setSession(null);
          setUser(null);
          setAdminProfile(null);
          setError(err.message || 'Failed to initialize authentication.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setAdminProfile(null);
        setLoading(false);
      } else if (newSession?.user) {
        // Deferred: calling Supabase from inside this callback can deadlock the client.
        setTimeout(async () => {
          if (!isMounted) return;
          await applySession(newSession);
          if (isMounted) setLoading(false);
        }, 0);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchAdminProfile]);

  // Sign In with email and password
  const signIn = async (email: string, password: string): Promise<{ success: boolean; error?: string; role?: 'lgu_admin' | 'toda_admin' }> => {
    try {
      setLoading(true);
      setError(null);

      // Exactly what was typed: no other e-mail address and no other password is ever tried.
      const cleanEmail = email.trim();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) {
        let safeErrorMsg = signInError.message;
        if (!safeErrorMsg || safeErrorMsg === '{}' || (typeof safeErrorMsg === 'object')) {
          safeErrorMsg = 'Unable to sign in right now. Please try again.';
        } else if (safeErrorMsg.toLowerCase().includes('invalid login credentials')) {
          safeErrorMsg = 'Invalid email or password. Please check your credentials.';
        }

        setError(safeErrorMsg);
        setLoading(false);
        return { success: false, error: safeErrorMsg };
      }

      if (!data?.user) {
        const msg = 'Login failed: No user returned from authentication service.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      // The administrator record decides who this is
      let profile: LguAdminProfile | null = null;
      try {
        profile = await fetchAdminProfile(data.user);
      } catch (profileErr: any) {
        const msg = profileErr?.message || 'Unable to verify your administrator account right now. Please try again.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      if (!profile) {
        // A TODA administrator who signed in at the LGU portal is pointed to their own portal (the session is kept for it).
        const { data: todaRow } = await supabase
          .from('toda_admin')
          .select('account_status')
          .eq('auth_user_id', data.user.id)
          .maybeSingle();
        setLoading(false);
        if (todaRow?.account_status === 'Active') {
          return { success: true, role: 'toda_admin' };
        }

        await supabase.auth.signOut();
        const msg = 'This account is not an LGU administrator account.';
        setError(msg);
        return { success: false, error: msg };
      }

      setSession(data.session);
      setUser(data.user);
      setAdminProfile(profile);
      setLoading(false);

      // Record last login
      try {
        await supabase
          .from('lgu_admin')
          .update({ last_login: new Date().toISOString() })
          .eq('auth_user_id', data.user.id);
      } catch (e) {
        console.log('[LGU AUTH] Record last login warning:', e);
      }

      return { success: true, role: 'lgu_admin' };

    } catch (err: any) {
      console.error('Sign in exception:', err);

      let msg = err.message || 'An unexpected error occurred during login.';
      if (msg === '{}' || (typeof msg === 'object')) {
        msg = 'Unable to sign in right now. Please try again.';
      }

      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  };

  // Sign Out
  const signOut = async (): Promise<void> => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    } finally {
      clearLegacyLguAuthCache();
      setSession(null);
      setUser(null);
      setAdminProfile(null);
      setError(null);
      setLoading(false);
    }
  };

  // Refresh profile manually
  const refreshProfile = async (): Promise<void> => {
    if (user) {
      const profile = await fetchAdminProfile(user);
      setAdminProfile(profile);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        adminProfile,
        loading,
        error,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
