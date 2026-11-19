import { type DashboardSummary, formatAmd } from '@costly/shared';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { SegmentedControl } from '../../ui/SegmentedControl';
import {
  compactDram,
  hasHistory,
  type HistoryDatum,
  historyData,
  type HistoryRange,
} from './chart-data';
import { AXIS_TICK, CHART_ANIMATION, ChartTooltipCard, GRID_STROKE } from './ChartTooltip';
import { DashboardCard, PanelEmpty } from './DashboardCard';
import { formatMonth } from './month';

const RANGES = [
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
] as const;

const SERIES = [
  { key: 'income', label: 'Income', color: 'var(--chart-income)' },
  { key: 'expense', label: 'Expenses', color: 'var(--chart-expense)' },
] as const;

/**
 * Income and expenses per month as grouped bars, ending at the selected
 * month. One axis, two series told apart by colour, by the legend and by
 * their order (income first). A table with the same numbers is available
 * to screen readers.
 */
export function IncomeExpenseChart({
  summary,
  className,
}: {
  summary: DashboardSummary;
  className?: string;
}) {
  const [range, setRange] = useState<'6' | '12'>('6');
  const data = historyData(summary.history, Number(range) as HistoryRange);

  return (
    <DashboardCard
      className={className}
      title="Income vs expenses"
      description={`Monthly totals up to ${formatMonth(summary.month)}`}
      action={
        <SegmentedControl label="Period" options={RANGES} value={range} onValueChange={setRange} />
      }
    >
      {hasHistory(data) ? (
        <>
          <Legend />
          <div className="mt-3 h-64" aria-hidden="true">
            <BarChart
              responsive
              style={{ width: '100%', height: '100%' }}
              data={data}
              barGap={2}
              barCategoryGap="22%"
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={compactDram}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                width={44}
              />
              <Tooltip
                cursor={{ fill: 'var(--costly-color-subtle)' }}
                content={({ active, payload }) => {
                  const datum = payload?.[0]?.payload as HistoryDatum | undefined;
                  if (!active || !datum) return null;
                  return (
                    <ChartTooltipCard
                      title={formatMonth(datum.month)}
                      rows={[
                        {
                          key: 'income',
                          label: 'Income',
                          value: formatAmd(datum.incomeMinor),
                          color: 'var(--chart-income)',
                        },
                        {
                          key: 'expense',
                          label: 'Expenses',
                          value: formatAmd(datum.expenseMinor),
                          color: 'var(--chart-expense)',
                        },
                        {
                          key: 'net',
                          label: 'Net',
                          value: formatAmd(datum.incomeMinor - datum.expenseMinor, {
                            sign: 'always',
                          }),
                        },
                      ]}
                    />
                  );
                }}
              />
              {SERIES.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label}
                  fill={series.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  {...CHART_ANIMATION}
                />
              ))}
            </BarChart>
          </div>
          <HistoryTable data={data} />
        </>
      ) : (
        <PanelEmpty>No income or expenses in these months yet.</PanelEmpty>
      )}
    </DashboardCard>
  );
}

function Legend() {
  return (
    <ul className="flex gap-4 text-label text-text-secondary" aria-hidden="true">
      {SERIES.map((series) => (
        <li key={series.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs" style={{ background: series.color }} />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

/** The chart's numbers for assistive technology. */
function HistoryTable({ data }: { data: HistoryDatum[] }) {
  return (
    <table className="sr-only">
      <caption>Income and expenses by month</caption>
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Income</th>
          <th scope="col">Expenses</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.month}>
            <th scope="row">{formatMonth(datum.month)}</th>
            <td>{formatAmd(datum.incomeMinor)}</td>
            <td>{formatAmd(datum.expenseMinor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
