import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { TodaAdminProfile } from '../types/toda';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  todaAdminProfile: TodaAdminProfile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string; role?: 'toda_admin' }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Earlier versions kept a copy of the signed-in administrator (profile AND tokens) under this key and restored it as a "session" when
// Supabase had none. Nothing is stored or restored any more; this only removes what those versions left in the browser.
const LEGACY_TODA_AUTH_CACHE_KEY = 'sakay_toda_admin_auth_cache';

const clearLegacyTodaAuthCache = () => {
  try {
    localStorage.removeItem(LEGACY_TODA_AUTH_CACHE_KEY);
  } catch {}
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [todaAdminProfile, setTodaAdminProfile] = useState<TodaAdminProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // The signed-in user's OWN row in public.toda_admin (found by their auth user id and nothing else), with their TODA.
  // A profile is never built from an e-mail address, an e-mail prefix or sign-up metadata: sign-ups are open, so none of those say who
  // somebody is. No row means the user is not a TODA administrator.
  const fetchTodaAdminProfile = useCallback(async (authUser: User): Promise<TodaAdminProfile | null> => {
    const { data, error: profileError } = await supabase
      .from('toda_admin')
      .select('*, toda(*)')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      console.error('fetchTodaAdminProfile error:', profileError);
      throw new Error(profileError.message);
    }
    if (!data) {
      return null;
    }

    const todaData = data.toda || null;

    if (data.account_status === 'Suspended') {
      await supabase.auth.signOut();
      clearLegacyTodaAuthCache();
      throw new Error('Your TODA administrator account is suspended. Please contact the City Transport & Franchising Office.');
    }

    return {
      admin_id: data.admin_id,
      auth_user_id: authUser.id,
      toda_id: data.toda_id,
      full_name: data.full_name || 'TODA Administrator',
      email: data.email || authUser.email || '',
      contact_number: data.contact_number || '',
      account_status: data.account_status as TodaAdminProfile['account_status'],
      toda_acronym: data.toda_acronym || todaData?.toda_acronym,
      toda: todaData,
    };
  }, []);

  // Initialize auth state
  useEffect(() => {
    let isMounted = true;

    clearLegacyTodaAuthCache();

    // Puts a Supabase session on screen: the user, and the administrator profile only when they really are one.
    const applySession = async (activeSession: Session | null) => {
      if (!activeSession?.user) {
        setSession(null);
        setUser(null);
        setTodaAdminProfile(null);
        return;
      }
      setSession(activeSession);
      setUser(activeSession.user);
      let profile: TodaAdminProfile | null = null;
      try {
        profile = await fetchTodaAdminProfile(activeSession.user);
      } catch {}
      if (isMounted) setTodaAdminProfile(profile);
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
          setTodaAdminProfile(null);
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
        setTodaAdminProfile(null);
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
  }, [fetchTodaAdminProfile]);

  // Sign In with the TODA's login (its e-mail address, or its acronym) and password.
  // The e-mail is only DERIVED from what was typed ("cctoda" -> cctoda@toda.sakay.internal); nothing is looked up before the password is
  // checked, no other address or password is tried, and no account is built into the portal.
  const signIn = async (usernameOrEmail: string, password: string): Promise<{ success: boolean; error?: string; role?: 'toda_admin' }> => {
    try {
      setLoading(true);
      setError(null);

      const cleanInput = usernameOrEmail.trim();
      const authEmail = cleanInput.includes('@')
        ? cleanInput.toLowerCase()
        : `${cleanInput.toLowerCase()}@toda.sakay.internal`;

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });

      if (signInError) {
        let safeErrorMsg = signInError.message;
        if (!safeErrorMsg || safeErrorMsg === '{}' || (typeof safeErrorMsg === 'object')) {
          safeErrorMsg = 'Incorrect TODA Acronym or password. Please try again.';
        } else if (safeErrorMsg.toLowerCase().includes('invalid login credentials')) {
          safeErrorMsg = 'Incorrect TODA Acronym or password. Please try again.';
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
      const profile = await fetchTodaAdminProfile(data.user);

      if (!profile) {
        await supabase.auth.signOut();
        const msg = 'Access Denied: Your account is not registered as a TODA Administrator.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      setSession(data.session);
      setUser(data.user);
      setTodaAdminProfile(profile);
      setLoading(false);

      return { success: true, role: 'toda_admin' };
    } catch (err: any) {
      console.error('TODA Sign in exception:', err);
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
      console.error('Error signing out of TODA portal:', err);
    } finally {
      clearLegacyTodaAuthCache();
      setSession(null);
      setUser(null);
      setTodaAdminProfile(null);
      setError(null);
      setLoading(false);
    }
  };

  // Refresh profile manually
  const refreshProfile = async (): Promise<void> => {
    if (user) {
      const profile = await fetchTodaAdminProfile(user);
      setTodaAdminProfile(profile);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        todaAdminProfile,
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
