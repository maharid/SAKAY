// What the Passenger app's Trip History and Trip Details screens say about a trip (apps/passenger-pwa/src/features/trip-history/tripFormat.ts): the date and time, the status words and
// colours, the driver's lines, and that Rebook hands over THIS trip's own route.
//   run:  cd server && npx tsx --test test/*.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { driverSummary, rebookPoints, stashRebook, tripTypeLabel } from '../../apps/passenger-pwa/src/features/trip-history/tripFormat';
import { formatTripDistance, formatTripWhen, tripStatusColors, tripStatusLabel } from '../../packages/shared/src/utils/tripStatus';

const TRIP = {
  pickup: 'Island Divers, Manalo Extension, Bancao-Bancao, Puerto Princesa',
  pickupLat: 9.7392,
  pickupLng: 118.7353,
  dropoff: 'Palawan State University, Escano, Tiniguiban',
  dropoffLat: 9.7611,
  dropoffLng: 118.7479,
};

describe('trip date and time', () => {
  it('is written in Philippine time, e.g. 10 Oct 2025, 8:22 AM', () => {
    assert.equal(formatTripWhen({ createdAt: '2025-10-10T00:22:00Z' }), '10 Oct 2025, 8:22 AM');
    // late evening UTC is the next morning in Manila
    assert.equal(formatTripWhen({ createdAt: '2025-10-09T23:59:00Z' }), '10 Oct 2025, 7:59 AM');
  });

  it('falls back to the date and time the record was stored with, and to nothing at all, never to a made-up one', () => {
    assert.equal(formatTripWhen({ dateString: 'October 10, 2025', time: '08:22 AM' }), 'October 10, 2025, 08:22 AM');
    assert.equal(formatTripWhen({ createdAt: 'not a date', dateString: 'October 10, 2025' }), 'October 10, 2025');
    assert.equal(formatTripWhen({}), '');
  });
});

describe('trip distance', () => {
  it('is the recorded distance with its unit, to one decimal', () => {
    assert.equal(formatTripDistance(4.2), '4.2 km');
    assert.equal(formatTripDistance(12), '12.0 km');
    assert.equal(formatTripDistance(0.46), '0.5 km');
  });
  it('is nothing when the record holds none, never a made-up number', () => {
    for (const none of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatTripDistance(none as number | null | undefined), null, String(none));
  });
});

describe('trip status and type', () => {
  it('words the two finished statuses in both languages and leaves any other as it is', () => {
    assert.equal(tripStatusLabel('Completed', 'en'), 'Completed');
    assert.equal(tripStatusLabel('Completed', 'tl'), 'Nakumpleto');
    assert.equal(tripStatusLabel('Cancelled', 'tl'), 'Kinansela');
    assert.equal(tripStatusLabel('Trip Ongoing', 'tl'), 'Trip Ongoing');
    assert.equal(tripStatusLabel(undefined, 'en'), '');
  });

  it('is green only for a completed trip, red for a cancelled one and neutral for the rest, with white text', () => {
    assert.equal(tripStatusColors('Completed').background, '#15803D');
    assert.equal(tripStatusColors('Cancelled').background, '#B91C1C');
    assert.equal(tripStatusColors('Trip Ongoing').background, '#475569');
    assert.equal(tripStatusColors(undefined).color, '#FFFFFF');
  });

  it('names solo and shared trips', () => {
    assert.equal(tripTypeLabel('Share', 'en'), 'Shared Trip');
    assert.equal(tripTypeLabel('Solo', 'tl'), 'Solo Trip');
  });
});

describe('driver lines', () => {
  it('gives the name, the TODA and the vehicle, only the parts the record has', () => {
    const full = driverSummary({ driverName: ' Miguel Gacho ', todaName: 'PPC TODA', plateNumber: 'ABC 123', bodyNumber: '1673' }, 'en');
    assert.deepEqual(full, { hasDriver: true, name: 'Miguel Gacho', todaName: 'PPC TODA', vehicleLine: 'Plate ABC 123 · Body no. 1673' });
    assert.equal(driverSummary({ driverName: 'Ana', plateNumber: 'XYZ 9' }, 'tl').vehicleLine, 'Plaka XYZ 9');
    assert.equal(driverSummary({ driverName: 'Ana', bodyNumber: '77' }, 'en').vehicleLine, 'Body no. 77');
    assert.equal(driverSummary({ driverName: 'Ana' }, 'en').vehicleLine, '');
  });

  it('says so, instead of showing empty fields, when no driver was assigned', () => {
    const none = driverSummary({ driverName: '' }, 'en');
    assert.equal(none.hasDriver, false);
    assert.equal(none.name, 'No driver assigned');
    assert.equal(driverSummary({}, 'tl').name, 'Walang drayber');
  });

  it('keeps a very long name whole (the screen cuts it, the data does not)', () => {
    const long = 'Juan Carlos Maximiliano de la Santissima Trinidad y Alcantara Villanueva';
    assert.equal(driverSummary({ driverName: long }, 'en').name, long);
  });
});

describe('Rebook', () => {
  it('hands over the pickup and the destination of THIS trip, with its coordinates', () => {
    const { pickup, dropoff } = rebookPoints(TRIP);
    assert.deepEqual(pickup, { address: TRIP.pickup, lat: 9.7392, lng: 118.7353 });
    assert.deepEqual(dropoff, { address: TRIP.dropoff, lat: 9.7611, lng: 118.7479 });
  });

  it('writes the two keys the new-trip screen reads, and a second trip replaces the first, never mixes with it', () => {
    const store = new Map<string, string>();
    const sink = { setItem: (k: string, v: string) => void store.set(k, v) };
    stashRebook(TRIP, sink);
    assert.deepEqual(JSON.parse(store.get('trip_pickup')!), { address: TRIP.pickup, lat: 9.7392, lng: 118.7353 });
    stashRebook({ ...TRIP, pickup: 'Somewhere else', pickupLat: 1, pickupLng: 2, dropoff: 'Another place', dropoffLat: 3, dropoffLng: 4 }, sink);
    assert.deepEqual(JSON.parse(store.get('trip_pickup')!), { address: 'Somewhere else', lat: 1, lng: 2 });
    assert.deepEqual(JSON.parse(store.get('trip_dropoff')!), { address: 'Another place', lat: 3, lng: 4 });
    assert.deepEqual([...store.keys()].sort(), ['trip_dropoff', 'trip_pickup']);
  });
});
