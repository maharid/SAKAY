import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchDriverOpenBooking, type DriverOpenBooking } from '../services/openBookingService';

const POLL_MS = 15_000;

// The Home screen takes a driver back to his trip ONCE per page load (a reopened or reloaded app lands on Home with no memory of the trip). After
// that he may leave the trip screen for Home on purpose: the card stays, but the app does not push him back again.
let resumedThisPageLoad = false;

/**
 * The driver's open booking from the database (Rule 29.2), refreshed every few seconds while `enabled`. With `autoResume` the first answer of a page
 * load that finds one sends him to its screen. `resume()` does the same on demand (the "Resume trip" card).
 */
export const useDriverOpenBooking = (enabled: boolean, autoResume: boolean): { openBooking: DriverOpenBooking | null; resume: () => void } => {
  const navigate = useNavigate();
  const [openBooking, setOpenBooking] = useState<DriverOpenBooking | null>(null);

  const resume = useCallback(() => {
    if (!openBooking) return;
    navigate(openBooking.route, { replace: true, state: { bookingId: openBooking.bookingId } });
  }, [navigate, openBooking]);

  useEffect(() => {
    if (!enabled) {
      setOpenBooking(null);
      return;
    }
    let stopped = false;
    const read = async () => {
      const found = await fetchDriverOpenBooking();
      if (stopped) return;
      setOpenBooking((prev) => (prev?.bookingId === found?.bookingId && prev?.status === found?.status ? prev : found));
      if (found && autoResume && !resumedThisPageLoad) {
        resumedThisPageLoad = true;
        navigate(found.route, { replace: true, state: { bookingId: found.bookingId } });
      }
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, autoResume, navigate]);

  return { openBooking, resume };
};
