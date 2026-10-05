// OTP lockout counter (20261010000002): a lock that has run out, or old failures, must not make the NEXT wrong code lock the number again.
// Whole migration chain on the local emulator only (never Supabase).
//
//   BEFORE the patch (chain through 20261010000001): after the 15-minute lock runs out, ONE wrong code locks the number again (the reported bug).
//   AFTER the patch (full chain):                    one wrong code after the lock counts as the first failure; five still lock for 15 minutes.
const { setup, ID, attempt, check, summary } = require('../b4fixtures');

const BEFORE = '20261010000001_document_returns_and_resubmission.sql';
const PHONE = '+639170000001';   // Pax One

async function run(label, until) {
  const t = await setup(until);
  const { svc, internal, one } = t;
  const fail = () => svc((tx) => tx.query(`SELECT public.increment_failed_otp('${ID.P1}')`));
  const lock = async () => (await svc((tx) => tx.query(`SELECT public.check_otp_lockout('${PHONE}') AS r`))).rows[0].r;
  const counters = () => one(`SELECT failed_otp_attempts n FROM passenger WHERE passenger_id='${ID.P1}'`);
  const ageLastFailure = (minutes) => internal(`UPDATE passenger SET last_otp_failed_at = now() - interval '${minutes} minutes' WHERE passenger_id='${ID.P1}'`);
  return { t, fail, lock, counters, ageLastFailure };
}

(async () => {
  // ---- BEFORE: the bug is real --------------------------------------------------------------------------------------
  console.log('BEFORE the patch');
  const b = await run('before', BEFORE);
  for (let i = 0; i < 5; i++) await b.fail();
  check('five wrong codes lock the number', (await b.lock()).is_locked === true);
  await b.ageLastFailure(16);
  check('16 minutes later the lock has run out', (await b.lock()).is_locked === false);
  await b.fail();
  check('VULNERABLE (the reported bug): ONE wrong code locks the number again', (await b.lock()).is_locked === true, await b.counters());
  await b.t.db.close();

  // ---- AFTER ---------------------------------------------------------------------------------------------------------
  console.log('\nAFTER the patch (full chain)');
  const a = await run('after', null);
  check('a new account starts at no failures and no lock', (await a.lock()).is_locked === false);
  for (let i = 0; i < 4; i++) await a.fail();
  check('four wrong codes do NOT lock', (await a.lock()).is_locked === false, await a.counters());
  await a.fail();
  const locked = await a.lock();
  check('the fifth wrong code locks for 15 minutes (threshold unchanged)', locked.is_locked === true && locked.minutes_remaining > 14, locked);

  await a.ageLastFailure(14);
  check('14 minutes in, still locked (the window is unchanged)', (await a.lock()).is_locked === true);
  await a.ageLastFailure(16);
  check('16 minutes in, the lock has run out', (await a.lock()).is_locked === false);
  await a.fail();
  const afterOne = await a.counters();
  check('FIXED: one wrong code after the lock counts as failure number 1', afterOne.n === 1, afterOne);
  check('FIXED: ...and does not lock', (await a.lock()).is_locked === false);
  for (let i = 0; i < 3; i++) await a.fail();
  check('...four in the new window: still open', (await a.lock()).is_locked === false, await a.counters());
  await a.fail();
  check('...the fifth in the new window locks again', (await a.lock()).is_locked === true, await a.counters());

  // stale failures from long ago do not count towards today's attempt
  await a.t.internal(`UPDATE passenger SET failed_otp_attempts = 4, last_otp_failed_at = now() - interval '7 days' WHERE passenger_id='${ID.P1}'`);
  await a.fail();
  const stale = await a.counters();
  check('4 failures a week ago + 1 now = 1 (a new count), not a lock', stale.n === 1 && (await a.lock()).is_locked === false, stale);

  // the legitimate resets still work, and a signed-in user still cannot call any of these
  await a.t.svc((tx) => tx.query(`SELECT public.reset_failed_otp('${ID.P1}')`));
  check('reset_failed_otp still clears the counter', (await a.counters()).n === 0);
  const poke = await attempt(() => a.t.as(ID.P2_AUTH, (tx) => tx.query(`SELECT public.increment_failed_otp('${ID.P1}')`)));
  check('a signed-in passenger still cannot lock somebody out (service role only)', !poke.ok && /permission denied/.test(poke.error), poke.ok ? 'allowed' : poke.error);

  await a.t.db.close();
  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
