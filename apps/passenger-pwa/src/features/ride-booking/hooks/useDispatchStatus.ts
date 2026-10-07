import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../../../services/supabaseClient";
import { getDispatchStatus, type DispatchPhase, type DispatchStatus } from "../../../services/dispatchService";

/** The search status plus when its cycle began on THIS phone's clock (the database counts the seconds, so a wrong phone clock cannot skew it). */
export interface LiveDispatchStatus extends DispatchStatus {
  startedAt: number;
}

const SEARCHING_POLL_MS = 3000;
const ENDED_POLL_MS = 8000;

/**
 * Follows the search for a driver for one booking: asks the database how it is going every few seconds (the answer also nudges a search
 * that is due), and at once when the booking row changes (a driver accepted, the booking was cancelled). One source for every screen.
 */
export const useDispatchStatus = (bookingId?: string | null): { status: LiveDispatchStatus | null; refresh: () => Promise<void> } => {
  const [latest, setLatest] = useState<{ bookingId: string; status: LiveDispatchStatus } | null>(null);
  const idRef = useRef<string | null>(bookingId ?? null);
  const phaseRef = useRef<DispatchPhase | null>(null);

  const refresh = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const answer = await getDispatchStatus(id);
    if (!answer || idRef.current !== id) return;
    phaseRef.current = answer.phase;
    setLatest({ bookingId: id, status: { ...answer, startedAt: Date.now() - answer.searchSeconds * 1000 } });
  }, []);

  useEffect(() => {
    idRef.current = bookingId ?? null;
    phaseRef.current = null;
    if (!bookingId) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await refresh();
      if (stopped) return;
      timer = setTimeout(loop, phaseRef.current === "ended" ? ENDED_POLL_MS : SEARCHING_POLL_MS);
    };
    loop();

    const channel = supabase
      .channel(`dispatch_status_${bookingId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "booking", filter: `booking_id=eq.${bookingId}` }, () => {
        refresh();
      })
      .subscribe();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [bookingId, refresh]);

  return { status: latest && bookingId && latest.bookingId === bookingId ? latest.status : null, refresh };
};
