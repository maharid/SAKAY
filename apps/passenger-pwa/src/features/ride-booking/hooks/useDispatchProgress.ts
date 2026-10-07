import { useSyncExternalStore } from "react";

import {
  getDispatchProgress,
  subscribeDispatchProgress,
  type DispatchProgress,
} from "../../../services/dispatchService";

/** Where the driver search for a booking stands (null until the dispatcher has started for it). */
export const useDispatchProgress = (bookingId?: string | null): DispatchProgress | null =>
  useSyncExternalStore(subscribeDispatchProgress, () => getDispatchProgress(bookingId));
