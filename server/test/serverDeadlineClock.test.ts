// The passenger's arrival-wait countdown (packages/shared/src/utils/serverDeadlineClock.ts).
// The bug: the card flickered between "Time is up" and "0:01" because every 3-second poll restarted the end time from a rounded-up
// "seconds remaining", overlapping polls could overtake each other, and a late answer re-opened a finished countdown.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpiryAnnouncer, ServerDeadlineClock, formatCountdown, type DeadlineSample } from '../../packages/shared/src/utils/serverDeadlineClock';

// A phone clock the test can wind; the server's clock is `SERVER_EPOCH + phone time` (the same speed, an arbitrary offset: the phone's wall
// clock plays no part).
const SERVER_EPOCH = 1_760_000_000_000;
const setup = () => {
  let t = 10_000;
  const clock = new ServerDeadlineClock(() => t);
  const advance = (ms: number) => { t += ms; };
  const now = () => t;
  /** The server answers at phone time `t + latency/2` (the middle of the round trip); the deadline is `endsInMs` after `sentAt` */
  const answer = (sequence: number, deadlineAbs: number, latencyMs = 100, extra: Partial<DeadlineSample> = {}): DeadlineSample => {
    const sentAt = t;
    const receivedAt = t + latencyMs;
    return { sequence, sentAt, receivedAt, deadlineMs: deadlineAbs, serverNowMs: SERVER_EPOCH + sentAt + latencyMs / 2, ...extra };
  };
  return { clock, advance, now, answer };
};

describe('one end time per deadline', () => {
  it('counts down from the server deadline and ends once', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 5000;
    assert.equal(clock.apply({ ...answer(1, deadline, 0) }), true);
    assert.deepEqual(clock.snapshot(), { hasValue: true, expired: false, remainingSeconds: 5, episodeKey: String(deadline) });
    advance(1000);
    assert.equal(clock.snapshot().remainingSeconds, 4);
    advance(3900);
    assert.equal(clock.snapshot().remainingSeconds, 1); // 100 ms left still reads "0:01", never "Time is up"
    advance(150);
    assert.equal(clock.snapshot().expired, true);
    assert.equal(clock.snapshot().remainingSeconds, 0);
  });

  it('has no value before the first answer', () => {
    const { clock } = setup();
    assert.equal(clock.snapshot().hasValue, false);
    assert.equal(clock.snapshot().expired, false);
  });

  it('never shows a negative value and stays ended as time passes', () => {
    const { clock, advance, answer, now } = setup();
    clock.apply(answer(1, SERVER_EPOCH + now() + 1000, 0));
    advance(1500);
    for (let i = 0; i < 20; i++) {
      const s = clock.snapshot();
      assert.equal(s.expired, true);
      assert.equal(s.remainingSeconds, 0);
      advance(137);
    }
  });
});

describe('the flicker: polls near the end', () => {
  it('a poll answered "1 second" just before the end cannot restart the countdown (the old behaviour re-based to now + 1 s)', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 3000;
    clock.apply(answer(1, deadline, 100));
    advance(2800); // 200 ms to go
    // the server rounds up: it would say seconds_remaining = 1 here. The absolute deadline is unchanged, so the end must not move.
    assert.equal(clock.apply(answer(2, deadline, 100)), false);
    advance(150);
    assert.deepEqual([clock.snapshot().expired, clock.snapshot().remainingSeconds], [false, 1], '50 ms left still reads 0:01');
    advance(100);
    assert.equal(clock.snapshot().expired, true);
    // ...and a LATER poll that still names the same deadline cannot re-open it
    assert.equal(clock.apply(answer(3, deadline, 20)), false);
    assert.equal(clock.snapshot().expired, true);
    assert.equal(clock.snapshot().remainingSeconds, 0);
  });

  it('once ended, a faster-round-trip measurement of the same deadline cannot re-open it', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 2000;
    clock.apply(answer(1, deadline, 600)); // a slow first measurement: the end is estimated up to ~300 ms off
    advance(2100);
    assert.equal(clock.snapshot().expired, true);
    assert.equal(clock.apply(answer(2, deadline, 10)), false);
    assert.equal(clock.snapshot().expired, true);
  });

  it('the seconds shown never go up within one deadline, even when a better measurement moves the end a little later', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 10_000;
    clock.apply(answer(1, deadline, 800));
    advance(4400);
    const before = clock.snapshot().remainingSeconds; // 6 (or 5.x rounded up)
    clock.apply(answer(2, deadline, 10)); // a much better round trip: the end may shift by a few hundred ms
    const after = clock.snapshot().remainingSeconds;
    assert.ok(after <= before, `${after} should not exceed ${before}`);
    let last = after;
    for (let i = 0; i < 60; i++) {
      advance(100);
      const s = clock.snapshot();
      assert.ok(s.remainingSeconds <= last);
      last = s.remainingSeconds;
    }
    assert.equal(clock.snapshot().expired, true);
  });
});

describe('overlapping, reordered and stale answers', () => {
  it('an answer to an OLDER request than one already applied is ignored', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 6000;
    const first = answer(1, deadline, 100);
    advance(3000);
    const second = answer(2, deadline, 100);
    clock.apply(second);
    // the first poll's answer finally arrives, after the second's
    assert.equal(clock.apply(first), false);
    assert.equal(clock.snapshot().remainingSeconds, 3);
  });

  it('an answer carrying an older server time is ignored even if its request number is newer', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 10_000;
    clock.apply(answer(1, deadline, 100));
    advance(1000);
    clock.apply(answer(2, deadline, 100));
    const stale = answer(3, deadline + 90_000, 100, { serverNowMs: SERVER_EPOCH + 9_000 }); // a cached / replayed older state
    assert.equal(clock.apply(stale), false);
    assert.equal(clock.snapshot().episodeKey, String(deadline));
  });

  it('an answer with no usable figure changes nothing', () => {
    const { clock, answer, now } = setup();
    clock.apply(answer(1, SERVER_EPOCH + now() + 4000, 0));
    assert.equal(clock.apply({ sequence: 2, sentAt: now(), receivedAt: now() + 5 }), false);
    assert.equal(clock.snapshot().remainingSeconds, 4);
  });
});

describe('a genuine extension ("I\'m Almost There")', () => {
  it('a LATER deadline from a newer answer re-opens the countdown', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 3000;
    clock.apply(answer(1, deadline, 0));
    advance(2000);
    const extended = deadline + 120_000;
    assert.equal(clock.apply(answer(2, extended, 0)), true);
    assert.equal(clock.snapshot().expired, false);
    assert.equal(clock.snapshot().remainingSeconds, 121);
  });

  it('a DELAYED extension answer arriving after the local end still wins, because the server accepted it before its own end', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 3000;
    clock.apply(answer(1, deadline, 0));
    const request = answer(2, deadline + 120_000, 4000, { serverNowMs: SERVER_EPOCH + now() + 2500 }); // sent at 0 s, the server answered at 2.5 s, it arrives at 4 s
    advance(3500);
    assert.equal(clock.snapshot().expired, true); // the card had already run out
    advance(500);
    assert.equal(clock.apply(request), true);
    const s = clock.snapshot();
    assert.equal(s.expired, false);
    assert.ok(s.remainingSeconds > 100 && s.remainingSeconds <= 120, String(s.remainingSeconds));
  });
});

describe('without an absolute deadline (the server sent only seconds)', () => {
  it('counts to the middle of the rounded-up second and ends', () => {
    const { clock, advance, now } = setup();
    clock.apply({ sequence: 1, sentAt: now(), receivedAt: now(), secondsRemaining: 3 });
    assert.equal(clock.snapshot().remainingSeconds, 3);
    advance(2600);
    assert.equal(clock.snapshot().expired, true);
  });

  it('"0 seconds" is ended at once and stays ended', () => {
    const { clock, now } = setup();
    clock.apply({ sequence: 1, sentAt: now(), receivedAt: now(), secondsRemaining: 0 });
    assert.equal(clock.snapshot().expired, true);
    clock.apply({ sequence: 2, sentAt: now(), receivedAt: now(), secondsRemaining: 1 });
    assert.equal(clock.snapshot().expired, true, 'a later "1 second" within the noise of the rounding cannot re-open it');
  });

  it('a figure two minutes later is an extension, not noise', () => {
    const { clock, advance, now } = setup();
    clock.apply({ sequence: 1, sentAt: now(), receivedAt: now(), secondsRemaining: 5 });
    advance(3000);
    clock.apply({ sequence: 2, sentAt: now(), receivedAt: now(), secondsRemaining: 122 });
    assert.equal(clock.snapshot().expired, false);
    assert.ok(clock.snapshot().remainingSeconds > 100);
  });
});

describe('remounts and resets', () => {
  it('a new clock (a remounted screen) starts from the next answer and agrees with the old one', () => {
    const { clock, advance, answer, now } = setup();
    const deadline = SERVER_EPOCH + now() + 8000;
    clock.apply(answer(1, deadline, 100));
    advance(3000);
    const remounted = new ServerDeadlineClock(now);
    remounted.apply(answer(1, deadline, 100));
    assert.equal(remounted.snapshot().remainingSeconds, clock.snapshot().remainingSeconds);
  });

  it('reset() forgets the wait and accepts request numbers from 1 again', () => {
    const { clock, answer, now } = setup();
    clock.apply(answer(7, SERVER_EPOCH + now() + 4000, 0));
    clock.reset();
    assert.equal(clock.snapshot().hasValue, false);
    assert.equal(clock.apply(answer(1, SERVER_EPOCH + now() + 9000, 0)), true);
    assert.equal(clock.snapshot().remainingSeconds, 9);
  });
});

describe('announcing the end exactly once', () => {
  it('announces each deadline once, however often it is asked (re-renders, remounts)', () => {
    const announcer = new ExpiryAnnouncer();
    assert.equal(announcer.announce('booking-1|111'), true);
    for (let i = 0; i < 5; i++) assert.equal(announcer.announce('booking-1|111'), false);
    assert.equal(announcer.announce('booking-1|222'), true, 'an extended deadline that also runs out is announced again');
    assert.equal(announcer.announce('booking-2|111'), true);
  });

  it('keeps its memory bounded', () => {
    const announcer = new ExpiryAnnouncer(3);
    for (const id of ['a', 'b', 'c', 'd']) assert.equal(announcer.announce(id), true);
  });
});

describe('formatCountdown', () => {
  it('draws minutes and seconds, never negative', () => {
    assert.equal(formatCountdown(307), '5:07');
    assert.equal(formatCountdown(59), '0:59');
    assert.equal(formatCountdown(0), '0:00');
    assert.equal(formatCountdown(-5), '0:00');
  });
});
