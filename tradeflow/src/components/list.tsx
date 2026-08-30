import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, Icon, cn, icons } from '@/components/ui';
import type { PageInfo } from '@/lib/query';

/**
 * List-page furniture: the filter bar, the table wrapper that turns into cards
 * on a phone, and pagination. Every index page in the app is built from these,
 * so they all behave the same way.
 */

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 [&>*:first-child]:min-w-[14rem] [&>*:first-child]:flex-1">
      {children}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  /** Hidden below `lg`, where the row becomes a card. */
  secondary?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

/**
 * A table on a wide screen, a stack of cards on a phone.
 *
 * The card layout is not a horizontally scrolling table: on site, a scrolling
 * table is unusable, so the first column becomes the card's heading and the
 * rest become labelled lines beneath it.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  hrefFor,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  hrefFor?: (row: T) => string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <Card>{empty}</Card>;

  const [primary, ...rest] = columns;

  return (
    <>
      {/* Wide */}
      <Card className="hidden overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={column.align === 'right' ? 'text-right' : undefined}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = hrefFor?.(row);
                return (
                  <tr key={row.id}>
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={cn(column.align === 'right' && 'text-right')}
                      >
                        {index === 0 && href ? (
                          <Link
                            href={href}
                            className="block font-medium text-[var(--text-strong)] hover:text-[var(--accent)]"
                          >
                            {column.render(row)}
                          </Link>
                        ) : (
                          column.render(row)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Narrow */}
      <ul className="space-y-2.5 lg:hidden">
        {rows.map((row) => {
          const href = hrefFor?.(row);
          const content = (
            <>
              <div className="mb-2 font-medium text-[var(--text-strong)]">
                {primary?.render(row)}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {rest
                  .filter((column) => !column.secondary)
                  .map((column) => (
                    <div key={column.key} className="min-w-0">
                      <dt className="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                        {column.header}
                      </dt>
                      <dd className="mt-0.5 truncate text-sm text-[var(--text-default)]">
                        {column.render(row)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </>
          );

          return (
            <li key={row.id}>
              {href ? (
                <Link
                  href={href}
                  className="block rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-card)] active:bg-[var(--surface-sunken)]"
                >
                  {content}
                </Link>
              ) : (
                <Card className="p-4">{content}</Card>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Pagination({ info, basePath, query }: { info: PageInfo; basePath: string; query: URLSearchParams }) {
  if (info.pageCount <= 1) return null;

  const link = (page: number) => {
    const params = new URLSearchParams(query);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-3 text-sm"
    >
      <span className="text-[var(--text-muted)]">
        {info.from + 1}–{info.to} of {info.total}
      </span>
      <div className="flex gap-2">
        {info.hasPrevious ? (
          <Link
            href={link(info.page - 1)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[0.625rem] border border-[var(--line-default)] px-3 font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            <Icon path={icons.arrowLeft} size={15} />
            Previous
          </Link>
        ) : null}
        {info.hasNext ? (
          <Link
            href={link(info.page + 1)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[0.625rem] border border-[var(--line-default)] px-3 font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            Next
            <Icon path={icons.arrowRight} size={15} />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Timeline used on job, customer, quote and invoice pages. */
export function Timeline({
  entries,
}: {
  entries: { id: string; summary: string; actor_label: string | null; created_at: string }[];
}) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--text-muted)]">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-[var(--line-subtle)] pl-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden
            className="absolute -left-[1.6rem] top-1.5 h-2 w-2 rounded-full bg-[var(--accent)] ring-4 ring-[var(--surface-card)]"
          />
          <div className="text-sm text-[var(--text-default)]">{entry.summary}</div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            {entry.actor_label ?? 'System'} ·{' '}
            {new Intl.DateTimeFormat('en-AU', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Australia/Sydney',
            }).format(new Date(entry.created_at))}
          </div>
        </li>
      ))}
    </ol>
  );
}
