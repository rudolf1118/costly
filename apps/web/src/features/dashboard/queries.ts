import { dashboardSummaryPath, dashboardSummarySchema } from '@costly/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../auth/SessionContext';

/** Query keys. A transaction or account write refetches the dashboard with everything else. */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (month: string) => ['dashboard', 'summary', month] as const,
};

/**
 * Everything the dashboard shows for one month, in one request. While
 * another month loads, the previous one stays on screen (dimmed) instead of
 * collapsing into skeletons.
 */
export function useDashboardSummary(month: string) {
  const { api } = useSessionStore();
  return useQuery({
    queryKey: dashboardKeys.summary(month),
    queryFn: ({ signal }) =>
      api.request(dashboardSummaryPath(month), { schema: dashboardSummarySchema, signal }),
    placeholderData: keepPreviousData,
  });
}
