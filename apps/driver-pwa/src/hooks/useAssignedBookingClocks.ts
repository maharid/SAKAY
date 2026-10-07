import { useEffect, useState } from 'react';

import { getAssignedBookingClocks, type AssignedBookingClocks } from '../services/bookingClockService';

const POLL_MS = 3000;

const NO_MARKS: AssignedBookingClocks = { stallWarnedAt: null, bookingGone: false };

/**
 * Watches the system's marks on the driver's accepted booking: the "you have not started" warning, and whether the booking was taken from
 * him (the stall and connectivity rules cancel it on his behalf and hand it to another driver). Read from the database every few seconds;
 * a failed read changes nothing. `active` = a trip is in its approach phase.
 */
export const useAssignedBookingClocks = (bookingId: string, active: boolean): AssignedBookingClocks => {
  const [marks, setMarks] = useState<AssignedBookingClocks>(NO_MARKS);

  useEffect(() => {
    if (!bookingId || !active) {
      setMarks(NO_MARKS);
      return;
    }
    let stopped = false;
    const read = async () => {
      const answer = await getAssignedBookingClocks(bookingId);
      if (!stopped && answer) setMarks((prev) => (prev.stallWarnedAt === answer.stallWarnedAt && prev.bookingGone === answer.bookingGone ? prev : answer));
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bookingId, active]);

  return marks;
};
