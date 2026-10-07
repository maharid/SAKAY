import { useEffect, useState } from "react";

import { fetchOpenBooking, type OpenBooking } from "../../../services/bookingService";

const POLL_MS = 5000;

/**
 * The passenger's one open booking (a search that is running, or a trip that is not finished) as the DATABASE has it, refreshed every few
 * seconds. It does not depend on what this browser remembers, so a search or a trip started on another device, or before the app was closed,
 * is found again.
 */
export const useOpenBooking = (): { openBooking: OpenBooking | null; loaded: boolean } => {
  const [state, setState] = useState<{ openBooking: OpenBooking | null; loaded: boolean }>({ openBooking: null, loaded: false });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const open = await fetchOpenBooking();
      if (stopped) return;
      setState((prev) => (prev.loaded && prev.openBooking?.booking_id === open?.booking_id && prev.openBooking?.booking_status === open?.booking_status
        ? prev
        : { openBooking: open, loaded: true }));
      timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
};
