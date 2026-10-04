require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const { Client } = require('pg');

async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const d = await c.query(
    "SELECT driver_id, full_name, contact_number, account_status, availability_status, toda_id, auth_user_id, license_expiry, mtop_expiry FROM public.driver WHERE contact_number LIKE '%9123456789%' LIMIT 1"
  );
  console.log('=== DRIVER ===');
  console.log(JSON.stringify(d.rows, null, 2));

  if (d.rows.length > 0) {
    const driverId = d.rows[0].driver_id;
    const todaId = d.rows[0].toda_id;

    const a = await c.query(
      'SELECT affiliation_id, toda_id, toda_endorsement_status, lgu_verification_status, is_active_selection FROM public.driver_toda_affiliation WHERE driver_id = $1',
      [driverId]
    );
    console.log('=== AFFILIATIONS ===');
    console.log(JSON.stringify(a.rows, null, 2));

    if (todaId) {
      const t = await c.query(
        'SELECT toda_id, toda_name, toda_status, certificate_expiry FROM public.toda WHERE toda_id = $1',
        [todaId]
      );
      console.log('=== TODA ===');
      console.log(JSON.stringify(t.rows, null, 2));
    }

    // Check all TODAs
    const allTodas = await c.query('SELECT toda_id, toda_name, toda_status, certificate_expiry FROM public.toda');
    console.log('=== ALL TODAS ===');
    console.log(JSON.stringify(allTodas.rows, null, 2));

    try {
      const r = await c.query('SELECT public.is_driver_documentarily_restricted($1) as result', [driverId]);
      console.log('=== DOCUMENTARY RESTRICTION ===');
      console.log(JSON.stringify(r.rows[0].result, null, 2));
    } catch(e) { console.log('Doc restriction check failed:', e.message); }

    try {
      const s = await c.query('SELECT * FROM public.driver_online_session WHERE driver_id = $1 AND ended_at IS NULL', [driverId]);
      console.log('=== OPEN SESSION ===');
      console.log(JSON.stringify(s.rows, null, 2));
    } catch(e) { console.log('Session check failed:', e.message); }

    try {
      const rs = await c.query("SELECT public.account_restriction_state('driver', $1) as result", [driverId]);
      console.log('=== ACCOUNT RESTRICTION STATE ===');
      console.log(JSON.stringify(rs.rows[0].result, null, 2));
    } catch(e) { console.log('Account restriction check failed:', e.message); }
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
