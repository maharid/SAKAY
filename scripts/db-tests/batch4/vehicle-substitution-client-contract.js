// Rule 29.18: the TypeScript the Driver app and both portals use for vehicle substitutions (packages/shared/src/utils/vehicleSubstitution.ts) against the REAL database
// functions and row security. Proves that every call and parameter name exists (the calls are made by NAME), that the screens' checks agree with the database on a
// table of inputs (nothing valid is blocked, nothing the database would refuse is offered), that the rows are read into what the screens show (with the driver's name),
// that each person sees only what row security shows them, and that the database's own sentences reach the screen. Whole migration chain on the local emulator.
const path = require('path');
const esbuild = require('esbuild');
const { setup, ID, attempt, check, summary, asUser } = require('../b6fixtures');

const SHARED = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'utils');
function loadTs(file) {
  const code = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const vs = loadTs(path.join(SHARED, 'vehicleSubstitution.ts'));
  const s = await setup();
  const { db, internal, one } = s;
  const REASON = 'My tricycle broke down and the shop needs three days';
  await internal(`UPDATE driver SET plate_number = 'REG-111', franchise_number = 'FR-111' WHERE driver_id = '${ID.D1}'`);

  // a Supabase-shaped client acting as a signed-in user: rpc by NAME, and the select / order / limit / in the screens make (row security applies)
  const clientAs = (uid) => ({
    rpc: async (fn, args) => {
      try {
        const names = Object.keys(args ?? {});
        const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n])), { commit: true });
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    from: (table) => ({
      select: (columns) => ({
        order: (column, opts) => ({
          limit: async (n) => {
            try {
              const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT ${columns} FROM public.${table} ORDER BY ${column} ${opts.ascending ? 'ASC' : 'DESC'} LIMIT ${Number(n)}`), { commit: true });
              return { data: r.rows, error: null };
            } catch (e) {
              return { data: null, error: { message: e.message } };
            }
          },
        }),
        in: async (column, values) => {
          try {
            const r = await asUser(db, { uid }, (tx) => tx.query(`SELECT ${columns} FROM public.${table} WHERE ${column} = ANY($1::uuid[])`, [values]), { commit: true });
            return { data: r.rows, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message } };
          }
        },
      }),
    }),
  });
  const driver = clientAs(ID.D_AUTH);
  const toda = clientAs(ID.T_AUTH);
  const otherToda = clientAs(ID.T2_AUTH);
  const lgu = clientAs(ID.L_AUTH);
  const reset = () => internal(`DELETE FROM vehicle_substitution`);

  console.log('S1 the screen\'s check agrees with the database about a request');
  const cases = [
    ['a good request', 'SUB 222', 'FR-222', REASON, 3],
    ['a plate with lower case and spaces', ' sub 222 ', 'FR-222', REASON, 3],
    ['the most days (7)', 'SUB 222', 'FR-222', REASON, 7],
    ['one day', 'SUB 222', 'FR-222', REASON, 1],
    ['0 days', 'SUB 222', 'FR-222', REASON, 0],
    ['8 days', 'SUB 222', 'FR-222', REASON, 8],
    ['a short reason', 'SUB 222', 'FR-222', 'broke', 3],
    ['a reason of exactly 10 characters', 'SUB 222', 'FR-222', '0123456789', 3],
    ['a reason of 9 characters', 'SUB 222', 'FR-222', '012345678', 3],
    ['no plate', '', 'FR-222', REASON, 3],
    ['a plate with symbols', '<script>', 'FR-222', REASON, 3],
    ['a plate of 2 characters', 'AB', 'FR-222', REASON, 3],
    ['no franchise number', 'SUB 222', ' ', REASON, 3],
    ['the registered vehicle itself (other case, spaces)', ' reg-111 ', 'FR-111', REASON, 3],
  ];
  for (const [label, plate, franchise, reason, days] of cases) {
    const screen = vs.substitutionRequestProblem({ plate, franchise, reason, days, registeredPlate: 'REG-111' });
    const res = await attempt(() => asUser(db, { uid: ID.D_AUTH }, async (tx) => (await tx.query(`SELECT public.request_vehicle_substitution(${Object.keys(vs.requestSubstitutionArgs('a', 'b', 'c', 1)).map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, Object.values(vs.requestSubstitutionArgs(plate, franchise, reason, days)))).rows[0].r, { commit: false }));
    check(`${label}: the screen ${screen === null ? 'allows' : 'blocks'} it and the database ${res.ok ? 'accepts' : 'refuses'} it`, (screen === null) === res.ok, { screen, db: res.ok ? 'ok' : res.error });
  }

  console.log('\nS2 the whole path through the shared calls');
  check('nothing yet', (await vs.fetchVehicleSubstitutions(driver)).length === 0);
  const sent = await vs.requestVehicleSubstitution(driver, ' sub 222 ', 'fr-222', `  ${REASON}  `, 3);
  check('the driver\'s request is accepted (null = no problem)', sent === null, sent);
  const dup = await vs.requestVehicleSubstitution(driver, 'SUB 333', 'FR-333', REASON, 2);
  check('a second one gets the database\'s sentence, without its code', dup !== null && /already have a vehicle request/.test(dup) && !/ERR_/.test(dup), dup);
  let list = await vs.fetchVehicleSubstitutions(driver);
  const mine = list[0];
  check('the driver sees it with the plate and franchise normalised, the reason trimmed, his own name', list.length === 1 && mine.status === 'Pending TODA Approval' && mine.substitutePlate === 'SUB 222' && mine.substituteFranchise === 'FR-222' && mine.reason === REASON && mine.driverName === 'Driver One' && mine.requestedDays === 3 && vs.isOpenSubstitution(mine.status), list);
  check('...his TODA Administrator and the LGU see it; the other TODA\'s administrator and another driver do not', (await vs.fetchVehicleSubstitutions(toda)).length === 1 && (await vs.fetchVehicleSubstitutions(lgu)).length === 1 && (await vs.fetchVehicleSubstitutions(otherToda)).length === 0 && (await vs.fetchVehicleSubstitutions(clientAs(ID.D2_AUTH))).length === 0);
  check('the check before a decision: a denial needs a reason, an approval does not', vs.substitutionDecisionProblem(false, '  ') !== null && vs.substitutionDecisionProblem(false, 'No valid franchise') === null && vs.substitutionDecisionProblem(true, '') === null && vs.substitutionDecisionProblem(null, 'x') !== null);
  const early = await vs.decideVehicleSubstitution(lgu, 'lgu_admin', mine.substitutionId, true, '');
  check('the LGU cannot decide before the TODA (the database\'s sentence is shown)', early !== null && /waiting for the LGU|not waiting/i.test(early) && !/ERR_/.test(early), early);
  const wrong = await vs.decideVehicleSubstitution(otherToda, 'toda_admin', mine.substitutionId, true, '');
  check('another TODA\'s administrator is refused', wrong !== null && /Only the TODA Administrator of this driver/.test(wrong), wrong);
  const todaOk = await vs.decideVehicleSubstitution(toda, 'toda_admin', mine.substitutionId, true, 'I checked the unit at the terminal');
  list = await vs.fetchVehicleSubstitutions(lgu);
  check('the TODA Administrator approves: it waits for the LGU, with the TODA\'s note', todaOk === null && list[0].status === 'Pending LGU Approval' && list[0].todaNote === 'I checked the unit at the terminal', list[0]);
  const lguOk = await vs.decideVehicleSubstitution(lgu, 'lgu_admin', mine.substitutionId, true, 'Both units checked');
  list = await vs.fetchVehicleSubstitutions(driver);
  const dRow = await one(`SELECT plate_number, franchise_number FROM driver WHERE driver_id = '${ID.D1}'`);
  check('the LGU approves: Active until a date three days out, the registered vehicle remembered, the substitute is his vehicle', lguOk === null && list[0].status === 'Active' && list[0].originalPlate === 'REG-111' && Date.parse(list[0].endsAt) > Date.now() + 2.9 * 86400000 && dRow.plate_number === 'SUB 222', { list: list[0], dRow });
  const noWhy = await vs.endVehicleSubstitution(toda, mine.substitutionId, '  ');
  check('an administrator ending it must say why', noWhy !== null && /reason/i.test(noWhy), noWhy);
  const ended = await vs.endVehicleSubstitution(driver, mine.substitutionId, '');
  list = await vs.fetchVehicleSubstitutions(driver);
  check('the driver gives it back himself: Ended, the registered vehicle is back', ended === null && list[0].status === 'Ended' && !vs.isOpenSubstitution(list[0].status) && (await one(`SELECT plate_number FROM driver WHERE driver_id = '${ID.D1}'`)).plate_number === 'REG-111', { ended, list: list[0] });

  console.log('\nS3 deny and withdraw');
  await reset();
  await vs.requestVehicleSubstitution(driver, 'SUB 444', 'FR-444', REASON, 2);
  const id = (await vs.fetchVehicleSubstitutions(driver))[0].substitutionId;
  const shortNo = await vs.decideVehicleSubstitution(toda, 'toda_admin', id, false, 'no');
  check('a denial without a real reason is refused by the database too', shortNo !== null && /reason for denying/.test(shortNo), shortNo);
  const denied = await vs.decideVehicleSubstitution(toda, 'toda_admin', id, false, 'That unit has no valid franchise');
  const dl = await vs.fetchVehicleSubstitutions(driver);
  check('denied with the reason, which the driver can read', denied === null && dl[0].status === 'Denied' && dl[0].denialReason === 'That unit has no valid franchise' && dl[0].deniedByRole === 'toda_admin', dl[0]);
  await vs.requestVehicleSubstitution(driver, 'SUB 555', 'FR-555', REASON, 2);
  const id2 = (await vs.fetchVehicleSubstitutions(driver))[0].substitutionId;
  const wd = await vs.withdrawVehicleSubstitution(driver, id2);
  check('the driver withdraws a waiting request, once', wd === null && (await vs.withdrawVehicleSubstitution(driver, id2)) !== null && (await vs.fetchVehicleSubstitutions(driver))[0].status === 'Withdrawn');

  console.log('\nThe builders send exactly the database\'s parameter names');
  const names = (fn) => db.query(`SELECT unnest(proargnames) AS n FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn]).then((r) => r.rows.map((x) => x.n));
  for (const [fn, args] of [
    ['request_vehicle_substitution', vs.requestSubstitutionArgs('P', 'F', 'r', 1)],
    ['decide_vehicle_substitution_toda', vs.decideSubstitutionArgs('i', true, 'n')],
    ['decide_vehicle_substitution_lgu', vs.decideSubstitutionArgs('i', true, 'n')],
    ['end_vehicle_substitution', vs.endSubstitutionArgs('i', 'r')],
    ['withdraw_vehicle_substitution', vs.withdrawSubstitutionArgs('i')],
  ]) {
    const have = await names(fn);
    check(`${fn}: the arguments sent are exactly the function's`, JSON.stringify(Object.keys(args).sort()) === JSON.stringify([...have].sort()), { sent: Object.keys(args), have });
  }

  process.exit(summary() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
