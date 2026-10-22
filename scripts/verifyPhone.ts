import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// The number to check is passed on the command line, never written in this file: npx tsx scripts/verifyPhone.ts 09XXXXXXXXX
const phone: string = process.argv[2] ?? '';
if (!phone) {
  console.error('Usage: npx tsx scripts/verifyPhone.ts <mobile number, e.g. 09XXXXXXXXX>');
  process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL as string;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
  const { data: passenger, error: pErr } = await supabase
    .from('passenger')
    .select('id')
    .eq('contact_number', phone);
  if (pErr) console.error('Passenger query error:', pErr);
  else console.log('Passenger rows:', passenger?.length ?? 0);

  const { data: users, error: uErr } = await supabase
    .from('auth.users')
    .select('id')
    .eq('phone', phone);
  if (uErr) console.error('Auth users query error:', uErr);
  else console.log('Auth users rows:', users?.length ?? 0);
}

verify().then(() => process.exit());
