import { type DashboardSummary, formatAmd } from '@costly/shared';
import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { compactDram, type DailyDatum, dailyData } from './chart-data';
import { AXIS_TICK, CHART_ANIMATION, ChartTooltipCard, GRID_STROKE } from './ChartTooltip';
import { DashboardCard, PanelEmpty } from './DashboardCard';
import { formatCalendarDate } from '../../lib/dates';
import { formatMonth } from './month';

/**
 * Spending per day of the month as an area, so the days with more spending
 * stand out. The current month stops at today: the days still ahead have no
 * spending yet, and plotting them as zeros would read as frugal days.
 */
export function DailySpendingChart({
  summary,
  today,
  className,
}: {
  summary: DashboardSummary;
  /** Today in the user's time zone, YYYY-MM-DD. */
  today: string;
  className?: string;
}) {
  const gradient = useId();
  const data = dailyData(summary.daily.filter((day) => day.date <= today));
  const spent = data.some((day) => day.expenseMinor > 0n);

  return (
    <DashboardCard
      className={className}
      title="Daily spending"
      description={formatMonth(summary.month)}
    >
      {spent ? (
        <>
          <div className="h-56" aria-hidden="true">
            <AreaChart
              responsive
              style={{ width: '100%', height: '100%' }}
              data={data}
              margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-expense)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--chart-expense)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickFormatter={compactDram}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: 'var(--costly-color-border-strong)', strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const day = payload?.[0]?.payload as DailyDatum | undefined;
                  if (!active || !day) return null;
                  return (
                    <ChartTooltipCard
                      title={formatCalendarDate(day.date)}
                      rows={[
                        {
                          key: 'spent',
                          label: 'Spent',
                          value: formatAmd(day.expenseMinor),
                          color: 'var(--chart-expense)',
                        },
                        {
                          key: 'total',
                          label: 'Month so far',
                          value: formatAmd(day.cumulativeMinor),
                        },
                      ]}
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="expense"
                name="Spent"
                stroke="var(--chart-expense)"
                strokeWidth={2}
                fill={`url(#${gradient})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--costly-color-surface)' }}
                {...CHART_ANIMATION}
              />
            </AreaChart>
          </div>
          <DailyTable data={data} />
        </>
      ) : (
        <PanelEmpty>No spending in {formatMonth(summary.month)} yet.</PanelEmpty>
      )}
    </DashboardCard>
  );
}

/** The days with spending, for assistive technology. */
function DailyTable({ data }: { data: DailyDatum[] }) {
  return (
    <table className="sr-only">
      <caption>Spending by day</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Spent</th>
        </tr>
      </thead>
      <tbody>
        {data
          .filter((day) => day.expenseMinor > 0n)
          .map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatCalendarDate(day.date)}</th>
              <td>{formatAmd(day.expenseMinor)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
