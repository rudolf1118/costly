import type { ReactNode } from 'react';

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  /** The series' colour, as a swatch beside its name; text stays in text colours. */
  color?: string;
}

/**
 * The hover card every dashboard chart uses: a title, then one row per
 * series, the values in tabular mono figures. The inverse surface matches
 * the app's tooltips in both themes.
 */
export function ChartTooltipCard({ title, rows }: { title: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-44 rounded-sm bg-inverse px-3 py-2 text-label text-on-inverse shadow-e1">
      <div className="mb-1 text-on-inverse-secondary">{title}</div>
      <dl className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5">
              {row.color && (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: row.color }}
                />
              )}
              {row.label}
            </dt>
            <dd className="font-mono tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Axis text and gridlines in the theme's recessive colours. */
export const AXIS_TICK = { fill: 'var(--costly-color-text-secondary)', fontSize: 12 } as const;
export const GRID_STROKE = 'var(--costly-color-grid)';

/** The Motion board's chart timing (520 ms). */
export const CHART_ANIMATION = { animationDuration: 520, animationEasing: 'ease-out' } as const;
