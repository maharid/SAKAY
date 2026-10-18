import { fetchOwnAppeals, fetchStrikeHistory, submitStrikeAppeal as submitAppeal } from '@sakay/shared';
import type { AppealResult, AppealRow, ExemptionCauseCode, StrikeHistory } from '@sakay/shared';

import { supabase } from './supabaseClient';

// Rules 20, 22.3 and 25: the passenger reads her own strikes and appeals one. The database decides everything (who may appeal which strike, the
// 48-hour window, that a passenger's appeal goes to the LGU Administrator (25.5), how many times the same cause may be used); the calls are shared
// with the Driver app (packages/shared/src/utils/strikeAppeals.ts), this module only gives them the passenger's client and id.

export type { AppealResult, StrikeHistory };
export type PassengerAppeal = AppealRow;

/** The signed-in passenger's own record id (row security shows a passenger only her own row), or null when it cannot be read. */
const ownPassengerId = async (): Promise<string | null> => {
  const { data, error } = await supabase.from('passenger').select('passenger_id').maybeSingle();
  return error || !data ? null : String(data.passenger_id);
};

/** The passenger's own strike ledger, newest first (null when it could not be read). */
export const fetchMyStrikes = async (): Promise<StrikeHistory | null> => {
  const id = await ownPassengerId();
  return id ? fetchStrikeHistory(supabase, 'passenger', id) : null;
};

/** The passenger's own appeals (row security shows her only hers). */
export const fetchMyAppeals = (): Promise<PassengerAppeal[]> => fetchOwnAppeals(supabase);

/** Rule 25: asks for a strike to be waived. */
export const submitStrikeAppeal = (strikeId: string, cause: ExemptionCauseCode, justification: string): Promise<AppealResult> =>
  submitAppeal(supabase, strikeId, cause, justification);
