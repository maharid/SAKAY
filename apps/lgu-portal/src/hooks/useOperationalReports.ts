import { useCallback, useEffect, useMemo, useState } from 'react';
import { NO_ANALYTICS_FILTER, filterProblem } from '@sakay/shared';
import type { AnalyticsFilter } from '@sakay/shared';

import { EMPTY_SOURCE, buildOperationalReports, fetchOperationalSource } from '../services/operationalReportsService';
import type { OperationalReportsData, OperationalSource } from '../services/operationalReportsService';

export interface UseOperationalReports {
  data: OperationalReportsData | null;
  filter: AnalyticsFilter;
  setFilter: (next: AnalyticsFilter) => void;
  isLoading: boolean;
  /** why the records could not be read, or null */
  loadError: string | null;
  reload: () => Promise<void>;
}

/**
 * The records are read once (and again on Refresh); the figures are rebuilt from them whenever the filter changes. A filter whose start date is after its end date
 * is not applied: the page keeps showing the last valid figures and the filter bar says what is wrong.
 */
export function useOperationalReports(): UseOperationalReports {
  const [source, setSource] = useState<OperationalSource | null>(null);
  const [filter, setFilter] = useState<AnalyticsFilter>(NO_ANALYTICS_FILTER);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setSource(await fetchOperationalSource());
      setLoadError(null);
    } catch (err) {
      console.error('[useOperationalReports] Failed to read the records:', err);
      setSource((known) => known ?? EMPTY_SOURCE);
      setLoadError(err instanceof Error ? err.message : 'The records could not be read.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applied = useMemo(() => (filterProblem(filter) ? NO_ANALYTICS_FILTER : filter), [filter]);
  const data = useMemo(() => (source ? buildOperationalReports(source, applied) : null), [source, applied]);

  return { data, filter, setFilter, isLoading, loadError, reload };
}
