import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

// The server reads roles, OTP counters and driver records with the SERVICE ROLE. After the perimeter lockdown the anon role has no table
// access at all, so a server running on the anon key cannot do any of that (and fails closed). Say so at start-up instead of failing
// request by request.
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY) {
  console.error('[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set: the server is using the anon key, which can read nothing. Set the service role key in the server environment.');
}

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    console.log('[Supabase] Initialized Supabase client successfully.');
  } catch (error) {
    console.warn('[Supabase] Warning: Failed to initialize Supabase client:', error);
  }
} else {
  console.log('[Supabase] Running in local development mode without live Supabase credentials.');
}

export { supabase };
