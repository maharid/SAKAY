// Perimeter Lockdown S0 (20261008000001): a sign-up can no longer grant itself an administrator role.
// Runs the WHOLE migration chain on the local PostgreSQL emulator (nothing here touches Supabase).
const { freshDb, asUser, attempt, check, summary } = require('../tlib');
const { ID, seed } = require('../fixtures');
const fs = require('fs');
const path = require('path');

(async () => {
  const db = await freshDb();
  await seed(db);
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  const signUp = async (email, meta, extra = {}) => {
    const cols = ['email', 'raw_user_meta_data'];
    const vals = [email, JSON.stringify(meta)];
    for (const [k, v] of Object.entries(extra)) { cols.push(k); vals.push(v); }
    return (await one(`INSERT INTO auth.users (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}${i === 1 ? '::jsonb' : ''}`).join(',')}) RETURNING id`, vals)).id;
  };
  const asAuthed = (uid, sql) => asUser(db, { uid }, (tx) => tx.query(sql));
  const adminsBefore = await one(`SELECT (SELECT count(*) FROM public.lgu_admin)::int l, (SELECT count(*) FROM public.toda_admin)::int t`);

  console.log('\nS0-1 the exploits from the audit');
  const mallory = await signUp('mallory@x.test', { role: 'lgu_admin', full_name: 'Mallory', position: 'Boss' });
  check('sign-up claiming role=lgu_admin creates NO lgu_admin row', (await q(`SELECT 1 FROM public.lgu_admin WHERE auth_user_id = $1`, [mallory])).length === 0);
  check('...and is_lgu_admin() is false for that user', (await asAuthed(mallory, `SELECT public.is_lgu_admin() AS r`)).rows[0].r === false);
  check('...nor any passenger / driver row from that claim', (await q(`SELECT 1 FROM public.passenger WHERE auth_user_id = $1 UNION ALL SELECT 1 FROM public.driver WHERE auth_user_id = $1`, [mallory])).length === 0);

  const byAcronym = await signUp('m2@x.test', { role: 'toda_admin', toda_acronym: 'TODA ONE' });
  await q(`UPDATE public.toda SET toda_acronym = 'VTODA' WHERE toda_id = '${ID.TODA1}'`);
  const byAcronym2 = await signUp('m3@x.test', { role: 'toda_admin', toda_acronym: 'VTODA' });
  const byId = await signUp('m4@x.test', { role: 'toda_admin', toda_id: ID.TODA1 });
  check('sign-up claiming role=toda_admin (acronym or toda_id) creates NO toda_admin row',
    (await q(`SELECT 1 FROM public.toda_admin WHERE auth_user_id = ANY($1::uuid[])`, [[byAcronym, byAcronym2, byId]])).length === 0);
  check('...and is_toda_admin() / get_current_toda_admin_toda_id() stay empty', (await asAuthed(byId, `SELECT public.is_toda_admin() AS a, public.get_current_toda_admin_toda_id() AS b`)).rows[0].a === false);

  console.log('\nS0-2 legitimate sign-ups still work (always Pending)');
  const p = await signUp('p@x.test', { role: 'passenger', full_name: 'New Pax', contact_number: '+639171111111', account_status: 'Active', strikes_count: 0 });
  const prow = await one(`SELECT account_status, full_name, contact_number FROM public.passenger WHERE auth_user_id = $1`, [p]);
  check('role=passenger creates a passenger in Pending OTP Verification (a status in the metadata is ignored)', prow && prow.account_status === 'Pending OTP Verification' && prow.full_name === 'New Pax', prow);
  const d = await signUp('d@x.test', { role: 'driver', full_name: 'New Driver', contact_number: '+639172222222', toda_id: ID.TODA2, account_status: 'Verified', availability_status: 'Available' });
  const drow = await one(`SELECT account_status, availability_status, toda_id FROM public.driver WHERE auth_user_id = $1`, [d]);
  check('role=driver creates a Pending Verification / Offline driver (status in metadata ignored), TODA taken from metadata',
    drow && drow.account_status === 'Pending Verification' && drow.availability_status === 'Offline' && drow.toda_id === ID.TODA2, drow);
  const none = await signUp('none@x.test', {});
  const garbage = await signUp('g@x.test', { role: 'superuser' });
  check('no role / an unknown role creates nothing (the auth user is still created)',
    (await q(`SELECT 1 FROM public.passenger WHERE auth_user_id = ANY($1::uuid[]) UNION ALL SELECT 1 FROM public.driver WHERE auth_user_id = ANY($1::uuid[])`, [[none, garbage]])).length === 0
    && (await q(`SELECT 1 FROM auth.users WHERE id = ANY($1::uuid[])`, [[none, garbage]])).length === 2);

  console.log('\nS0-3 the trigger still fires for a role with no EXECUTE on the function (the real GoTrue role)');
  await db.exec(`CREATE ROLE auth_admin_stub NOLOGIN; GRANT USAGE ON SCHEMA auth, public TO auth_admin_stub; GRANT SELECT, INSERT, UPDATE ON auth.users TO auth_admin_stub;`);
  const stubInsert = await attempt(() => db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE auth_admin_stub`);
    const r = await tx.query(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('stub@x.test', '{"role":"passenger","full_name":"Stub","contact_number":"+639173333333"}'::jsonb) RETURNING id`);
    return r.rows[0].id;
  }));
  check('sign-up inserted by a role that has no EXECUTE privilege on the trigger function succeeds', stubInsert.ok, stubInsert);
  check('...and the passenger row exists', stubInsert.ok && (await q(`SELECT 1 FROM public.passenger WHERE contact_number = '+639173333333'`)).length === 1);
  const priv = await one(`SELECT has_function_privilege('anon', 'public.handle_new_user_signup()', 'EXECUTE') a1, has_function_privilege('authenticated', 'public.handle_new_user_signup()', 'EXECUTE') u1,
                                 has_function_privilege('anon', 'public.handle_user_auth_update()', 'EXECUTE') a2, has_function_privilege('authenticated', 'public.handle_user_auth_update()', 'EXECUTE') u2`);
  check('neither trigger function is executable by anon / authenticated', !priv.a1 && !priv.u1 && !priv.a2 && !priv.u2, priv);

  console.log('\nS0-4 phone confirmation activates only the passenger whose number was confirmed');
  const stat = async (uid) => (await one(`SELECT account_status s FROM public.passenger WHERE auth_user_id = $1`, [uid])).s;
  const other = await signUp('o@x.test', { role: 'passenger', full_name: 'Other', contact_number: '09174444444' });
  await q(`UPDATE auth.users SET phone = '+639175555555', phone_confirmed_at = now() WHERE id = $1`, [other]);
  check('a confirmed phone that is NOT the number on the passenger row does not activate it', (await stat(other)) === 'Pending OTP Verification', await stat(other));
  const same = await signUp('s@x.test', { role: 'passenger', full_name: 'Same', contact_number: '09176666666' });
  await q(`UPDATE auth.users SET phone = '+639176666666', phone_confirmed_at = now() WHERE id = $1`, [same]);
  check('a confirmed phone that IS the number (different formatting: 09.. vs +639..) activates it', (await stat(same)) === 'Active', await stat(same));
  const susp = await signUp('x@x.test', { role: 'passenger', full_name: 'Susp', contact_number: '09177777777' });
  // A suspension is the policy engine's doing: declare the internal context for the set-up statement only.
  await db.exec(`SELECT set_config('sakay.internal_context','true',false); UPDATE public.passenger SET account_status = 'Suspended' WHERE auth_user_id = '${susp}'; SELECT set_config('sakay.internal_context','',false);`);
  await q(`UPDATE auth.users SET phone = '09177777777', phone_confirmed_at = now() WHERE id = $1`, [susp]);
  check('an already Suspended passenger is not reactivated by a phone confirmation', (await stat(susp)) === 'Suspended', await stat(susp));
  const internalAfter = await one(`SELECT current_setting('sakay.internal_context', true) AS v`);
  check('the trigger does not leave the policy-engine flag switched on', internalAfter.v !== 'true', internalAfter);

  console.log('\nS0-5 nothing else changed');
  const adminsAfter = await one(`SELECT (SELECT count(*) FROM public.lgu_admin)::int l, (SELECT count(*) FROM public.toda_admin)::int t`);
  check('no administrator row was created or removed by any of the above', adminsAfter.l === adminsBefore.l && adminsAfter.t === adminsBefore.t, { adminsBefore, adminsAfter });
  const trg = (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal ORDER BY 1`)).map((r) => r.tgname);
  check('triggers left on auth.users: on_auth_user_created, on_auth_user_updated, trg_auto_confirm_synthetic_users', JSON.stringify(trg) === JSON.stringify(['on_auth_user_created', 'on_auth_user_updated', 'trg_auto_confirm_synthetic_users']), trg);
  const again = await attempt(async () => {
    const f = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261008000001_perimeter_signup_triggers.sql'), 'utf8');
    await db.exec(f);
  });
  check('the migration can be run a second time without error', again.ok, again);

  console.log('\nS0-6 S0 on its own: the hot-fix applied to the database exactly as it is before the lockdown (nothing else from S1-S4)');
  const PRE = '20261007000004_security_null_safe_service_context.sql';        // the live database today
  const old = await freshDb(PRE);
  const oq = async (s, p) => (await old.query(s, p)).rows;
  const oSign = async (email, meta) => (await oq(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2::jsonb) RETURNING id`, [email, JSON.stringify(meta)]))[0].id;
  const exploit = async (tag) => {
    const a = await oSign(`${tag}-lgu@x.test`, { role: 'lgu_admin', full_name: 'M' });
    await oq(`INSERT INTO public.toda (toda_id, toda_name, toda_acronym) VALUES ('${ID.TODA1}', 'T1', 'ACR${tag}') ON CONFLICT DO NOTHING`);
    const b = await oSign(`${tag}-toda@x.test`, { role: 'toda_admin', toda_acronym: `ACR${tag}` });
    return {
      lgu: (await oq(`SELECT 1 FROM public.lgu_admin WHERE auth_user_id = $1 AND account_status = 'Active'`, [a])).length === 1,
      toda: (await oq(`SELECT 1 FROM public.toda_admin WHERE auth_user_id = $1 AND account_status = 'Active'`, [b])).length === 1,
    };
  };
  const wasOpen = await exploit('before');
  check('(proof of the flaw) before S0 a sign-up with role=lgu_admin / role=toda_admin metadata becomes an ACTIVE administrator', wasOpen.lgu && wasOpen.toda, wasOpen);
  const sql0 = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261008000001_perimeter_signup_triggers.sql'), 'utf8');
  const applied = await attempt(() => old.exec(sql0));
  check('S0 applies on its own (the migration and its self-check)', applied.ok, applied);
  const nowOpen = await exploit('after');
  check('after S0 the same two sign-ups create no administrator', !nowOpen.lgu && !nowOpen.toda, nowOpen);
  const pOk = await oSign('legit-p@x.test', { role: 'passenger', full_name: 'Legit', contact_number: '+639170009999' });
  check('...and an ordinary passenger sign-up still works (Pending)', (await oq(`SELECT account_status FROM public.passenger WHERE auth_user_id = $1`, [pOk]))[0]?.account_status === 'Pending OTP Verification');
  await old.close();

  await db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
