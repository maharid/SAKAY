import { PICKUP_ZONE_RADIUS_METERS } from '@sakay/shared';

/**
 * Rule 10.1 / PI-06: what the Arrived button needs, in the driver's words. The database accepts Arrived only from the pickup (a fresh fix of good accuracy
 * within the zone radius of the policy config); both trip screens (navigation and active trip) show this line under the button so they say the same thing.
 */
export const arrivalZoneHint = (tl: boolean): string =>
  tl
    ? `Pindutin lamang kapag nasa loob ka na ng ${PICKUP_ZONE_RADIUS_METERS} m ng pickup at malinaw ang GPS.`
    : `Tap only when you are within ${PICKUP_ZONE_RADIUS_METERS} m of the pickup with a clear GPS signal.`;
