import { useCallback, useEffect, useState } from "react";
import {
  fetchMyAppeals,
  fetchMyStrikes,
  type PassengerAppeal,
  type StrikeHistory,
} from "../../../services/strikeAppealService";

/**
 * The signed-in passenger's strikes and appeals (Rules 20 and 25) for the screens that show them. `reload` reads both again, for example
 * after an appeal was sent. `failed` means the strikes could not be read (not "there are none").
 */
export function usePassengerStrikes() {
  const [history, setHistory] = useState<StrikeHistory | null>(null);
  const [appeals, setAppeals] = useState<PassengerAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchMyStrikes(), fetchMyAppeals()]).then(([h, a]) => {
      if (!alive) return;
      setHistory(h);
      setFailed(h === null);
      setAppeals(a);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { history, appeals, loading, failed, reload };
}
