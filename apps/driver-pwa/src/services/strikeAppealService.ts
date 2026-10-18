import { fetchOwnAppeals, fetchStrikeHistory, submitStrikeAppeal as submitAppeal } from '@sakay/shared';
import type { AppealResult, AppealRow, ExemptionCauseCode, StrikeHistory, StrikeRow } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rules 8.6, 9.4 and 25: the driver reads his own strikes and appeals one. The database decides everything (who may appeal which strike, the 48-hour
// window, where the request goes, how many times the same cause may be used); the calls themselves are shared with the Passenger app
// (packages/shared/src/utils/strikeAppeals.ts), this module only gives them the driver's client and id.

export type DriverStrike = StrikeRow;
export type DriverAppeal = AppealRow;
export type { AppealResult, StrikeHistory };

const driverId = (): string | null => {
  try {
    return localStorage.getItem('sakay_driver_id');
  } catch {
    return null;
  }
};

/** The driver's own strike ledger, newest first (null when it could not be read). */
export const fetchMyStrikes = async (): Promise<StrikeHistory | null> => {
  const id = driverId();
  return id ? fetchStrikeHistory(supabase, 'driver', id) : null;
};

/** The driver's own appeals (row security shows him only his). */
export const fetchMyAppeals = (): Promise<DriverAppeal[]> => fetchOwnAppeals(supabase);

/** Rule 25: asks for a strike to be waived. */
export const submitStrikeAppeal = (strikeId: string, cause: ExemptionCauseCode, justification: string): Promise<AppealResult> =>
  submitAppeal(supabase, strikeId, cause, justification);
