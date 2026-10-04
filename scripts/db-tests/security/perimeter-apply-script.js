// scripts/applyPerimeterLockdown.js, rehearsed on the local emulator: its safety rules, the dry run of every stage, and the
// "apply every stage, then the emergency rollback" self-test (the rollback must put policies, table privileges, function grants and
// bucket flags back exactly as the snapshot recorded them). Nothing here connects to Supabase.
const path = require('path');
const { spawnSync } = require('child_process');
const { check, summary } = require('../tlib');

const script = path.join(__dirname, '..', '..', 'applyPerimeterLockdown.js');
// DATABASE_URL is blanked on purpose: no run here may ever reach a hosted database.
const run = (args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 600000, env: { ...process.env, DATABASE_URL: '' } });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

console.log('\nthe command line');
const bad = run(['frobnicate']);
check('an unknown mode prints the usage and exits with 2', bad.status === 2 && /usage:/.test(bad.out), bad.out.slice(0, 120));
const noStage = run(['apply']);
check('apply without a stage prints the usage and exits with 2', noStage.status === 2 && /usage:/.test(noStage.out));
const allHosted = run(['apply', 'all']);
check('"apply all" is refused on the hosted database (stages are applied one at a time, on purpose)', allHosted.status === 2 && /usage:/.test(allHosted.out));
const noUrl = run(['preflight']);
check('without DATABASE_URL it stops before doing anything', noUrl.status === 2 && /NO DATABASE_URL/.test(noUrl.out), noUrl.out.slice(0, 120));

console.log('\nthe safety rules (rehearsal database)');
const order = run(['apply', 'S3', '--emulator', '--apps-deployed']);
check('stages must be applied in order: S3 is refused while S0-S2 are not applied', order.status === 1 && /apply the stages in order/.test(order.out), order.out.slice(-200));

console.log('\npreflight (read-only)');
const pre = run(['preflight', '--emulator']);
check('the preflight runs and reports the live perimeter', pre.status === 0 && /the live perimeter TODAY/.test(pre.out) && /snapshot\.json/.test(pre.out), pre.out.slice(-300));
check('...it names the exposures of the pre-lockdown database (anon policies, public buckets, sign-up triggers)',
  /name anon or public \.+ [1-9]/.test(pre.out) && /storage buckets that are public \.+ [1-9]/.test(pre.out) && /trg_on_auth_user_created_toda_admin/.test(pre.out));
check('...it lists the drivers and passengers the new apps cannot find by phone (their login e-mail is not the derived one)',
  /logins the NEW apps cannot find/.test(pre.out) && /drivers the new Driver app cannot find by phone \.+ \d+ of \d+/.test(pre.out)
  && /passengers the new Passenger app cannot find by phone \.+ \d+ of \d+/.test(pre.out), pre.out.slice(0, 600));
check('...and never prints a connection string or a password', !/postgres(ql)?:\/\//i.test(pre.out) && !/password/i.test(pre.out));

console.log('\ndry run of every stage (rolled back)');
const dry = run(['dryrun', 'all', '--emulator']);
check('the dry run passes every stage and every verification', dry.status === 0 && /DRY RUN PASSED/.test(dry.out), dry.out.slice(-400));
const stageLines = ['S0:', 'S1:', 'S2:', 'S3:', 'S4:'].every((s) => new RegExp(s + ' \\d+ checks passed').test(dry.out));
check('...each stage printed its own verification result', stageLines);
check('...and nothing was recorded', /stages recorded = none/.test(dry.out));

console.log('\nthe self-test: apply S0..S4, then the emergency rollback');
const st = run(['selftest']);
check('apply S0 -> S4 and the generated rollback script: the self-test passes', st.status === 0 && /SELFTEST PASSED/.test(st.out), st.out.slice(-600));
check('...the perimeter was closed after S4', /PASS  after S0-S4 the perimeter is closed/.test(st.out));
check('...the rollback restored the policies, table privileges, function grants and bucket flags exactly',
  /PASS  the rollback restores the policies exactly/.test(st.out) && /PASS  the rollback restores the table privileges exactly/.test(st.out)
  && /PASS  the rollback restores the function EXECUTE grants/.test(st.out) && /PASS  the rollback restores the bucket flags/.test(st.out));
check('...and S0 (the sign-up hot-fix) stays in place after a rollback', /PASS  S0 stays in place after the rollback/.test(st.out));

process.exit(summary() ? 0 : 1);
