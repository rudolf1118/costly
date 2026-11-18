import { type DashboardSummary, formatAmd } from '@costly/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Pie, PieChart, Sector, Tooltip } from 'recharts';
import { type CategorySlice, categorySlices } from './chart-data';
import { CHART_ANIMATION, ChartTooltipCard } from './ChartTooltip';
import { DashboardCard, PanelEmpty } from './DashboardCard';
import { formatMonth, monthDays } from './month';

/**
 * The month's spending by category: a donut for the proportions and, beside
 * it, the same slices as a list with names, amounts and shares, so nothing
 * depends on telling colours apart. Each category opens its transactions for
 * the month; so does each slice.
 */
export function CategoryBreakdown({
  summary,
  className,
}: {
  summary: DashboardSummary;
  className?: string;
}) {
  const navigate = useNavigate();
  const slices = categorySlices(summary.categories, summary.expense);
  const days = monthDays(summary.month);
  const search = (slice: CategorySlice) =>
    slice.categoryId
      ? { categoryId: slice.categoryId, type: 'expense' as const, ...days }
      : { type: 'expense' as const, ...days };

  return (
    <DashboardCard
      className={className}
      title="Spending by category"
      description={formatMonth(summary.month)}
    >
      {slices.length === 0 ? (
        <PanelEmpty>No spending in {formatMonth(summary.month)}.</PanelEmpty>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative size-48 shrink-0" aria-hidden="true">
            <PieChart responsive style={{ width: '100%', height: '100%' }}>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="68%"
                outerRadius="100%"
                paddingAngle={slices.length > 1 ? 1.5 : 0}
                cornerRadius={4}
                stroke="var(--costly-color-surface)"
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                rootTabIndex={-1}
                className="cursor-pointer"
                onClick={(_, index) => {
                  const slice = slices[index];
                  if (slice) void navigate({ to: '/transactions', search: search(slice) });
                }}
                shape={(props) => (
                  <Sector {...props} fill={(props.payload as CategorySlice).color} />
                )}
                {...CHART_ANIMATION}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const slice = payload?.[0]?.payload as CategorySlice | undefined;
                  if (!active || !slice) return null;
                  return (
                    <ChartTooltipCard
                      title={slice.label}
                      rows={[
                        {
                          key: 'amount',
                          label: 'Spent',
                          value: formatAmd(slice.amount),
                          color: slice.color,
                        },
                        {
                          key: 'share',
                          label: 'Share',
                          value: slice.percent === null ? '—' : `${slice.percent}%`,
                        },
                      ]}
                    />
                  );
                }}
              />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-label text-text-secondary">Spent</span>
              <span className="font-mono text-body font-medium tabular-nums">
                {formatAmd(summary.expense)}
              </span>
            </div>
          </div>

          <ul className="flex w-full min-w-0 flex-col gap-1" aria-label="Categories">
            {slices.map((slice) => (
              <li key={slice.categoryId ?? 'other'}>
                <Link
                  to="/transactions"
                  search={search(slice)}
                  className="group flex flex-col gap-1.5 rounded-sm px-2 py-1.5 hover:bg-subtle"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: slice.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-body-small font-medium">
                      {slice.label}
                    </span>
                    <span className="shrink-0 font-mono text-body-small tabular-nums">
                      {formatAmd(slice.amount)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-label text-text-secondary tabular-nums">
                      {slice.percent === null ? '—' : `${slice.percent}%`}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-4.5 h-1 overflow-hidden rounded-full bg-subtle"
                  >
                    <span
                      className="block h-full rounded-full transition-[width] duration-520 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                      style={{
                        width: `${slice.percent === null ? 0 : Number(slice.percent)}%`,
                        background: slice.color,
                      }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}
