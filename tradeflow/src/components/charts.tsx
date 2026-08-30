/**
 * Charts, drawn as inline SVG.
 *
 * No charting library: three chart shapes at this size are a few dozen lines
 * of geometry, they render on the server with no hydration, and they inherit
 * the theme tokens so light and dark work without a second palette.
 */

import { formatMoneyCompact } from '@/lib/format';
import { cn } from '@/components/ui';

export interface MonthPoint {
  month: string;
  revenue_cents: number;
  expenses_cents: number;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function monthLetter(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[index] ?? '';
}

/** Revenue against costs, twelve months. */
export function RevenueChart({ data }: { data: MonthPoint[] }) {
  const width = 640;
  const height = 200;
  const padding = { top: 12, right: 8, bottom: 26, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(
    1,
    ...data.map((point) => Math.max(point.revenue_cents, point.expenses_cents))
  );
  const slot = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(slot * 0.33, 18);

  const hasAnything = data.some((p) => p.revenue_cents > 0 || p.expenses_cents > 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" /> Payments received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--line-strong)]" /> Expenses
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full"
        role="img"
        aria-label={
          hasAnything
            ? 'Payments received and expenses over the last twelve months'
            : 'No payments or expenses recorded in the last twelve months'
        }
      >
        {/* Gridlines at quarters of the maximum. */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = padding.top + plotHeight * (1 - fraction);
          return (
            <line
              key={fraction}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="var(--line-subtle)"
              strokeWidth={1}
            />
          );
        })}

        {data.map((point, index) => {
          const centre = padding.left + slot * (index + 0.5);
          const revenueHeight = (point.revenue_cents / max) * plotHeight;
          const expenseHeight = (point.expenses_cents / max) * plotHeight;
          return (
            <g key={point.month}>
              <rect
                x={centre - barWidth - 1}
                y={padding.top + plotHeight - revenueHeight}
                width={barWidth}
                height={Math.max(revenueHeight, point.revenue_cents > 0 ? 2 : 0)}
                rx={2}
                fill="var(--accent)"
              >
                <title>{`${point.month}: ${formatMoneyCompact(point.revenue_cents)} received`}</title>
              </rect>
              <rect
                x={centre + 1}
                y={padding.top + plotHeight - expenseHeight}
                width={barWidth}
                height={Math.max(expenseHeight, point.expenses_cents > 0 ? 2 : 0)}
                rx={2}
                fill="var(--line-strong)"
              >
                <title>{`${point.month}: ${formatMoneyCompact(point.expenses_cents)} spent`}</title>
              </rect>
              <text
                x={centre}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {monthLetter(point.month)}
              </text>
            </g>
          );
        })}
      </svg>

      {!hasAnything ? (
        <p className="-mt-24 mb-14 text-center text-sm text-[var(--text-muted)]">
          Nothing to chart yet. Record a payment or an expense and it appears here.
        </p>
      ) : null}
    </div>
  );
}

/** Jobs by status, as a horizontal bar list. */
export function StatusBars({
  data,
  total,
  hrefFor,
}: {
  data: { label: string; value: number; tone: string; key: string }[];
  total: number;
  hrefFor?: (key: string) => string;
}) {
  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--text-muted)]">
        No jobs yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {data.map((entry) => {
        const pct = total > 0 ? (entry.value / total) * 100 : 0;
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-[var(--text-default)]">{entry.label}</span>
              <span className="shrink-0 tabular font-medium text-[var(--text-strong)]">
                {entry.value}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, entry.value > 0 ? 3 : 0)}%`, background: entry.tone }}
              />
            </div>
          </>
        );
        return (
          <li key={entry.key}>
            {hrefFor ? (
              <a href={hrefFor(entry.key)} className="block rounded p-0.5 hover:bg-[var(--surface-sunken)]">
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A tiny trend line for a stat card. */
export function Sparkline({
  values,
  className,
  tone = 'var(--accent)',
}: {
  values: number[];
  className?: string;
  tone?: string;
}) {
  if (values.length < 2) return null;
  const width = 100;
  const height = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-7 w-24', className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
