// Rule 16.3 and PI-15: the checks and call arguments the portals use to correct a completed trip or close a trip left at the destination
// (packages/shared/src/utils/tripCorrections.ts). scripts/db-tests/batch9/corrections-client-contract.js proves the checks agree with the real database.
//   run:  cd server && npx tsx --test test/tripCorrections.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeProblem, closeUnfinishedTripArgs, correctCompletedTripArgs, correctionProblem } from '../../packages/shared/src/utils/tripCorrections';

const base = { currentFare: 65, currentPayment: 'Paid', newFare: null as number | null, paymentStatus: null as string | null, reason: 'The driver and the passenger were reached' };

describe('the call arguments', () => {
  it('trim the reason and keep nulls as nulls', () => {
    assert.deepEqual(correctCompletedTripArgs('b', 50, null, '  why this was needed  '), { p_booking_id: 'b', p_new_fare: 50, p_payment_status: null, p_reason: 'why this was needed' });
    assert.deepEqual(correctCompletedTripArgs('b', null, 'Waived', 'because'), { p_booking_id: 'b', p_new_fare: null, p_payment_status: 'Waived', p_reason: 'because' });
    assert.deepEqual(closeUnfinishedTripArgs('b', 'Paid', '  reached both  '), { p_booking_id: 'b', p_payment_status: 'Paid', p_reason: 'reached both' });
  });
});

describe('correcting a completed trip', () => {
  it('is allowed for a lower fare, a payment status, or both', () => {
    assert.equal(correctionProblem({ ...base, newFare: 50 }), null);
    assert.equal(correctionProblem({ ...base, paymentStatus: 'Waived' }), null);
    assert.equal(correctionProblem({ ...base, newFare: 0 }), null, 'a fare of 0 becomes Waived by itself');
    assert.equal(correctionProblem({ ...base, newFare: 50, paymentStatus: 'Payment Disputed' }), null);
  });
  it('says what is wrong, in the database\'s order', () => {
    assert.match(correctionProblem({ ...base, reason: 'short' }) ?? '', /reason/);
    assert.match(correctionProblem({ ...base }) ?? '', /new fare, a payment status/);
    assert.match(correctionProblem({ ...base, paymentStatus: 'Refunded' }) ?? '', /payment status must be/);
    assert.match(correctionProblem({ ...base, newFare: 70 }) ?? '', /never above the system's fare \(65\.00\)/);
    assert.match(correctionProblem({ ...base, newFare: -1 }) ?? '', /at least 0/);
    assert.match(correctionProblem({ ...base, newFare: 65 }) ?? '', /Nothing would change/);
    assert.match(correctionProblem({ ...base, paymentStatus: 'Paid' }) ?? '', /Nothing would change/);
    assert.match(correctionProblem({ ...base, newFare: Number.NaN }) ?? '', /must be a number/);
  });
  it('a trip with no recorded fare can only have its payment status changed', () => {
    assert.match(correctionProblem({ ...base, currentFare: null, newFare: 10 }) ?? '', /never above the system's fare \(0\.00\)/);
    assert.equal(correctionProblem({ ...base, currentFare: null, currentPayment: 'Unpaid', paymentStatus: 'Waived' }) === null, false, 'no fare to work from: not offered');
  });
});

describe('closing a trip left at the destination', () => {
  it('only as Paid or Waived, with the words of how it was confirmed', () => {
    assert.equal(closeProblem('Paid', 'reached the driver and the passenger'), null);
    assert.equal(closeProblem('Waived', 'reached the driver and the passenger'), null);
    for (const p of ['Unpaid', 'Payment Disputed', '', null]) assert.match(closeProblem(p, 'reached the driver and the passenger') ?? '', /Paid .* or Waived/, String(p));
    assert.match(closeProblem('Paid', '  short  ') ?? '', /who was reached/);
  });
});
