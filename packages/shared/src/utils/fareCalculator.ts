/**
 * Official SAKAY Fare Calculator
 * Calapan City Ordinance Fare Matrix Rules:
 * - Base seat fare: ₱15.00 covering the first 2.0 km.
 * - Succeeding distance: ₱1.00 per km for distance beyond 2.0 km.
 * - Solo trip: Entire passenger seat fare multiplied by 4 (reserving all 4 seats).
 * - Shared booking: Seat fare per passenger (Base ₱15.00 + ₱1.00/km succeeding).
 */

export interface TariffConfig {
  baseFare: number;       // Base seat fare for first 2.0 km (default: 15.00)
  baseDistanceKm: number; // Included base distance in km (default: 2.0)
  succeedingRate: number; // Rate per succeeding km (default: 1.00)
}

export interface FareBreakdown {
  distanceKm: number;
  succeedingDistanceKm: number;
  tripType: 'Solo' | 'Shared';
  passengers: number;
  multiplier: number;
  baseFareSeat: number;
  baseFareTotal: number;
  succeedingRate: number;
  succeedingChargeSeat: number;
  succeedingChargeTotal: number;
  seatFare: number;
  totalFare: number;
}

export const DEFAULT_TARIFF: TariffConfig = {
  baseFare: 15.0,
  baseDistanceKm: 2.0,
  succeedingRate: 1.0,
};

/**
 * Computes exact SAKAY estimated fare and detailed itemized breakdown.
 * Uses un-rounded distance float for internal calculation and rounds monetary values to 2 decimal places.
 */
export function calculateFare(
  distanceKm: number,
  tripType: 'Solo' | 'Shared' = 'Solo',
  passengers: number = 1,
  tariff: TariffConfig = DEFAULT_TARIFF
): FareBreakdown {
  const baseFareSeat = Number(tariff?.baseFare) || DEFAULT_TARIFF.baseFare;
  const baseKm = Number(tariff?.baseDistanceKm) || DEFAULT_TARIFF.baseDistanceKm;
  const succRate = Number(tariff?.succeedingRate) ?? DEFAULT_TARIFF.succeedingRate;

  // Un-rounded succeeding distance beyond baseKm (0 if distance <= baseKm)
  const dist = Math.max(0, distanceKm);
  const succeedingDistanceKm = Math.max(0, dist - baseKm);

  // Seat fare (for 1 seat)
  const succeedingChargeSeat = succeedingDistanceKm * succRate;
  const seatFare = baseFareSeat + succeedingChargeSeat;

  // Multiplier: Solo = 4 seats reserved; Shared = passenger count (or 1)
  const multiplier = tripType === 'Solo' ? 4 : Math.max(1, passengers);

  const baseFareTotal = baseFareSeat * multiplier;
  const succeedingChargeTotal = succeedingChargeSeat * multiplier;
  const rawTotal = seatFare * multiplier;
  const totalFare = Number(rawTotal.toFixed(2));

  return {
    distanceKm: dist,
    succeedingDistanceKm,
    tripType,
    passengers,
    multiplier,
    baseFareSeat: Number(baseFareSeat.toFixed(2)),
    baseFareTotal: Number(baseFareTotal.toFixed(2)),
    succeedingRate: Number(succRate.toFixed(2)),
    succeedingChargeSeat: Number(succeedingChargeSeat.toFixed(2)),
    succeedingChargeTotal: Number(succeedingChargeTotal.toFixed(2)),
    seatFare: Number(seatFare.toFixed(2)),
    totalFare,
  };
}
