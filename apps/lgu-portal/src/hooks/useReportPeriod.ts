import { useEffect, useState } from 'react';
import { scopeRange, shiftAnchor, todayKey } from '@sakay/shared';
import type { AnalyticsFilter, ReportScope, ScopeRange } from '@sakay/shared';

export interface ReportPeriodState {
  scope: ReportScope;
  /** a day inside the chosen period ("YYYY-MM-DD", Manila) */
  anchor: string;
  /** the dates of the chosen day / week / month; null for a custom range */
  range: ScopeRange | null;
  setScope: (scope: ReportScope) => void;
  setAnchor: (anchor: string) => void;
  /** one period back / forward */
  step: (delta: number) => void;
  /** back to the period that contains today */
  today: () => void;
  /** a period that has not started yet has nothing to show: forward stops at the one that contains today */
  canStepForward: boolean;
}

/**
 * Decision D-P6 (panel: "kapag day lang, 1 day lang ang makikita; kapag week, 1 week"): the report period is ONE day, week or month that the person steps through, and
 * the filter's from / to dates follow it, so every figure of the page shows exactly that period. "Custom" leaves the two dates to the person.
 */
export function useReportPeriod(filter: AnalyticsFilter, setFilter: (next: AnalyticsFilter) => void, initial: ReportScope = 'week'): ReportPeriodState {
  const [scope, setScope] = useState<ReportScope>(initial);
  const [anchor, setAnchor] = useState<string>(todayKey());
  const range = scope === 'custom' ? null : scopeRange(scope, anchor);

  // the filter's dates follow the chosen period (and are put back if "Clear filters" empties them)
  useEffect(() => {
    if (range && (filter.from !== range.from || filter.to !== range.to)) setFilter({ ...filter, from: range.from, to: range.to });
  }, [range?.from, range?.to, filter.from, filter.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeScope = (next: ReportScope) => {
    setScope(next);
    // leaving a period for "custom" keeps the dates it had, so the numbers do not jump; going back to a period starts from today
    if (next !== 'custom') setAnchor(todayKey());
  };

  return {
    scope,
    anchor,
    range,
    setScope: changeScope,
    setAnchor,
    step: (delta) => scope !== 'custom' && setAnchor((a) => shiftAnchor(scope, a, delta)),
    today: () => setAnchor(todayKey()),
    canStepForward: scope !== 'custom' && range !== null && range.to < todayKey(),
  };
}
