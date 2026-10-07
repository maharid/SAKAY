// The passenger's dispatcher (apps/passenger-pwa/src/services/dispatchService.ts) replayed against an in-memory fake database and a fake
// clock: the policy timeline from booking to "No Driver Found" in a few milliseconds, with no network and no Supabase.
//   run:  cd server && npx tsx --test --experimental-test-module-mocks test/dispatchService.test.ts
// (Without the flag the module cannot be mocked and these tests are skipped; the plain `npx tsx --test test/*.test.ts` still passes.)
import { describe, it, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const canMockModules = typeof (mock as unknown as { module?: unknown }).module === 'function';

// ------------------------------------------------------------------------------------------------------------- fake database
type Row = Record<string, unknown>;

interface DriverPlan {
  driver_id: string;
  toda_id: string;
  distance_km: number | null;
  /** From this moment (ms since the search began) the driver is online and can be found */
  onlineFromMs?: number;
  /** What the driver does with an offer */
  response: 'accept' | 'decline' | 'ignore';
  /** Seconds after the offer reached them */
  afterSeconds?: number;
}

const PRIORITY_TODA = 'T-PRIORITY';

class FakeDb {
  booking: Row = { booking_id: 'B1', booking_status: 'Pending', pickup_latitude: 13.4117, pickup_longitude: 121.1803 };
  attempts: Row[] = [];
  drivers: DriverPlan[] = [];
  roundStartedAt = 0;
  startedAt = 0;
  offersLog: { driver_id: string; atSeconds: number }[] = [];
  private nextAttempt = 1;

  now() {
    return Date.now();
  }

  seconds() {
    return Math.round((this.now() - this.startedAt) / 1000);
  }

  // A driver answers an offer once their time has come (this mimics the driver's phone and the database trigger).
  private settle() {
    for (const a of this.attempts) {
      if (a.response_status !== 'Pending') continue;
      const plan = this.drivers.find((d) => d.driver_id === a.driver_id)!;
      if (plan.response === 'ignore') continue;
      if (this.now() - (a.offeredAt as number) < (plan.afterSeconds ?? 3) * 1000) continue;
      if (plan.response === 'decline') {
        a.response_status = 'Declined';
      } else if (this.booking.booking_status === 'Pending' || this.booking.booking_status === 'Searching Driver') {
        a.response_status = 'Accepted';
        this.booking.booking_status = 'Accepted';
        this.booking.driver_id = plan.driver_id;
      }
    }
  }

  rpc(fn: string, args: Row) {
    if (fn === 'list_accredited_todas') {
      return { data: [{ toda_id: PRIORITY_TODA, terminal_latitude: 13.412, terminal_longitude: 121.1805 }], error: null };
    }
    if (fn === 'find_candidate_drivers') {
      if (!['Pending', 'Searching Driver'].includes(this.booking.booking_status as string)) return { data: [], error: null };
      const maxKm = args.p_max_km as number;
      const offered = new Set(
        this.attempts.filter((a) => (a.offeredAt as number) >= this.roundStartedAt).map((a) => a.driver_id as string)
      );
      const data = this.drivers
        .filter((d) => (d.onlineFromMs ?? 0) <= this.now() - this.startedAt)
        .filter((d) => !offered.has(d.driver_id))
        .filter((d) => d.distance_km === null || d.distance_km <= maxKm)
        .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))
        .map((d) => ({ driver_id: d.driver_id, toda_id: d.toda_id, distance_km: d.distance_km }));
      return { data, error: null };
    }
    if (fn === 'retry_driver_search') {
      if (!['No Driver Found', 'Pending', 'Searching Driver'].includes(this.booking.booking_status as string)) {
        return { data: { success: false }, error: null };
      }
      this.attempts.filter((a) => a.response_status === 'Pending').forEach((a) => (a.response_status = 'Expired'));
      this.booking.booking_status = 'Pending';
      this.roundStartedAt = this.now();
      return { data: { success: true }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row[] | Row = [];
  private filters: ((r: Row) => boolean)[] = [];
  private wantsOne = false;
  constructor(private db: FakeDb, private table: string) {}

  select() {
    return this;
  }
  insert(rows: Row[]) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.payload = values;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  maybeSingle() {
    this.wantsOne = true;
    return this.run();
  }
  // `.single()` on a select behaves like maybeSingle for the fake
  single() {
    return this.maybeSingle();
  }
  // supabase-js builders are awaitable
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
    return this.run().then(resolve, reject);
  }

  private rows(): Row[] {
    return this.table === 'booking' ? [this.db.booking] : this.db.attempts;
  }

  async run() {
    (this.db as unknown as { settle: () => void }).settle();
    const matches = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'insert') {
      const row = { ...(this.payload as Row[])[0], attempt_id: `A${this.db['nextAttempt']++}`, offeredAt: this.db.now() };
      this.db.attempts.push(row);
      this.db.offersLog.push({ driver_id: row.driver_id as string, atSeconds: this.db.seconds() });
      return { data: row, error: null };
    }
    if (this.op === 'update') {
      matches.forEach((r) => Object.assign(r, this.payload));
      return { data: matches, error: null };
    }
    return { data: this.wantsOne ? matches[0] ?? null : matches, error: null };
  }
}

// ------------------------------------------------------------------------------------------------------------------ harness
const SERVICE = path.resolve(import.meta.dirname, '../../apps/passenger-pwa/src/services/dispatchService.ts');
const CLIENT = path.resolve(import.meta.dirname, '../../apps/passenger-pwa/src/services/supabaseClient.ts');

let db: FakeDb;

const SHARED_INDEX = path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts');

// A module can only be mocked once: the database client hands every call to whichever fake database the running scenario set up.
// '@sakay/shared' is given its real constants and helpers directly (under Node its index file's `export *` lines are not seen as named
// exports; the apps' bundler has no such problem). The dispatcher itself is the real, unmodified file.
before(async () => {
  if (!canMockModules) return;
  const config = await import('../../packages/shared/src/config/policyConfig');
  const schedule = await import('../../packages/shared/src/utils/dispatchSchedule');
  const named = Object.fromEntries(Object.entries({ ...config, ...schedule }).filter(([key]) => key !== 'default'));
  mock.module(pathToFileURL(SHARED_INDEX).href, { namedExports: named });
  mock.module(pathToFileURL(CLIENT).href, {
    namedExports: { supabase: { from: (t: string) => db.from(t), rpc: async (fn: string, args: Row) => db.rpc(fn, args) } },
  });
});
type Service = typeof import('../../apps/passenger-pwa/src/services/dispatchService');
let service: Service;
let counter = 0;

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

// True when the search has ended. A search that never ends fails the test instead of hanging it.
const hasEnded = async (run: Promise<unknown>): Promise<boolean> => {
  let done = false;
  run.then(() => {
    done = true;
  });
  await flush();
  return done;
};

// Moves the fake clock forward one second at a time, letting the dispatcher run in between.
const advance = async (seconds: number) => {
  for (let i = 0; i < seconds; i++) {
    mock.timers.tick(1000);
    await flush();
  }
};

const setup = async (drivers: DriverPlan[], before?: (db: FakeDb) => void) => {
  db = new FakeDb();
  db.drivers = drivers;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  db.startedAt = db.roundStartedAt = Date.now();
  before?.(db);
  // a fresh copy of the service per scenario (its search state is module-level)
  service = (await import(`${pathToFileURL(SERVICE).href}?scenario=${counter++}`)) as Service;
};

const driver = (id: string, distance_km: number | null, extra: Partial<DriverPlan> = {}): DriverPlan => ({
  driver_id: id,
  toda_id: PRIORITY_TODA,
  distance_km,
  response: 'ignore',
  ...extra,
});

describe('dispatcher timeline against a fake database', { skip: !canMockModules }, () => {
  beforeEach(() => {
    mock.timers.reset();
  });

  it('with no driver anywhere: still searching at 4:59, No Driver Found at 5:00 (the maximum search time)', async () => {
    await setup([]);
    const run = service.startDispatch('B1');
    await advance(299);
    assert.equal(db.booking.booking_status, 'Pending', 'still searching just before the maximum');
    assert.equal(service.getDispatchProgress('B1')?.phase, 'widening');
    await advance(5);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.booking.booking_status, 'No Driver Found');
    assert.equal(service.getDispatchProgress('B1')?.phase, 'ended');
    assert.equal(db.offersLog.length, 0);
  });

  it('a nearby Priority TODA driver who accepts ends the search at once', async () => {
    await setup([driver('d1', 0.4, { response: 'accept', afterSeconds: 5 })]);
    const run = service.startDispatch('B1');
    await advance(10);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.booking.booking_status, 'Accepted');
    assert.deepEqual(db.offersLog.map((o) => o.driver_id), ['d1']);
    assert.equal(service.getDispatchProgress('B1')?.phase, 'ended');
  });

  it('Tier 1 offers only the Priority TODA inside 600 m; another TODA at 400 m waits for Tier 2', async () => {
    await setup([
      driver('other-toda', 0.4, { toda_id: 'T-OTHER', response: 'decline', afterSeconds: 2 }),
      driver('priority', 0.5, { response: 'decline', afterSeconds: 2 }),
    ]);
    const run = service.startDispatch('B1');
    await advance(40);
    assert.deepEqual(db.offersLog.map((o) => o.driver_id), ['priority', 'other-toda']);
    assert.ok(db.offersLog[1].atSeconds >= db.offersLog[0].atSeconds + 2, 'one offer at a time');
    await advance(400);
    assert.equal(await hasEnded(run), true, 'the search has ended');
  });

  it('a driver who ignores the offer gets 20 s (15 s countdown + 5 s grace), is offered once, and the search goes on', async () => {
    await setup([driver('d1', 1.4)]);
    const run = service.startDispatch('B1');
    await advance(19);
    assert.equal(db.attempts[0].response_status, 'Pending');
    await advance(3);
    assert.equal(db.attempts[0].response_status, 'Declined');
    await advance(400);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.offersLog.length, 1, 'never offered the same booking twice in one round');
    assert.equal(db.booking.booking_status, 'No Driver Found');
  });

  it('the pool is refreshed: a driver who comes online later is found, but only once the radius reaches them', async () => {
    await setup([
      driver('late-near', 2.4, { onlineFromMs: 100_000, response: 'decline', afterSeconds: 1 }),
      driver('far', 3.4, { response: 'decline', afterSeconds: 1 }),
    ]);
    const run = service.startDispatch('B1');
    await advance(330);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    const at = (id: string) => db.offersLog.find((o) => o.driver_id === id)?.atSeconds;
    assert.ok(at('late-near')! >= 100 && at('late-near')! <= 130, `late driver offered at the next 30 s refresh (was ${at('late-near')})`);
    assert.ok(at('far')! >= 270, `a driver 3.4 km away is only reached once the radius is 3.5 km at 4:30 (was ${at('far')})`);
  });

  it('radius steps: 2.0 km at the start, 2.5 km from 1:30', async () => {
    await setup([driver('d25', 2.4, { response: 'decline', afterSeconds: 1 })]);
    const run = service.startDispatch('B1');
    await advance(85);
    assert.equal(db.offersLog.length, 0, 'a driver 2.4 km away is outside the 2.0 km radius');
    await advance(40);
    assert.equal(db.offersLog.length, 1, 'inside the 2.5 km radius after 1:30');
    await advance(300);
    assert.equal(await hasEnded(run), true, 'the search has ended');
  });

  it('a driver whose position is unknown is never offered the booking', async () => {
    await setup([driver('nowhere', null)]);
    const run = service.startDispatch('B1');
    await advance(310);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.offersLog.length, 0);
    assert.equal(db.booking.booking_status, 'No Driver Found');
  });

  it('Cancel Search: the dispatcher stops within seconds and never overwrites the cancellation', async () => {
    await setup([]);
    const run = service.startDispatch('B1');
    await advance(60);
    db.booking.booking_status = 'Cancelled';
    await advance(5);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.booking.booking_status, 'Cancelled');
    assert.equal(service.getDispatchProgress('B1')?.phase, 'ended');
  });

  it('a driver accepting during the wait for the next refresh ends the search without No Driver Found', async () => {
    await setup([]);
    const run = service.startDispatch('B1');
    await advance(45);
    db.booking.booking_status = 'Accepted';
    await advance(5);
    assert.equal(await hasEnded(run), true, 'the search has ended');
    assert.equal(db.booking.booking_status, 'Accepted');
  });

  it('Retry after No Driver Found starts a new round: the same driver is offered again, from the nearest tier', async () => {
    await setup([driver('d1', 0.4, { response: 'decline', afterSeconds: 1 })]);
    const first = service.startDispatch('B1');
    await advance(330);
    assert.equal(await hasEnded(first), true, 'the first search has ended');
    assert.equal(db.booking.booking_status, 'No Driver Found');
    assert.equal(db.offersLog.length, 1);

    const restarted = await service.retryDriverSearch('B1');
    assert.equal(restarted, true);
    await advance(5);
    assert.equal(db.offersLog.length, 2, 'the same driver is offered again in the new round');
    assert.equal(service.getDispatchProgress('B1')?.phase === 'nearby' || service.getDispatchProgress('B1')?.phase === 'widening', true);
    await advance(400);
  });

  it('a second start for the same booking does not start a second search', async () => {
    await setup([driver('d1', 0.4)]);
    const run = service.startDispatch('B1');
    await advance(2);
    await service.startDispatch('B1');
    await advance(2);
    assert.equal(db.offersLog.length, 1);
    await advance(400);
    assert.equal(await hasEnded(run), true, 'the search has ended');
  });
});
