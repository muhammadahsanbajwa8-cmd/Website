/**
 * The interface kit.
 *
 * Everything the application renders is built from this file, which is why it
 * is one module: the pieces share tone names, sizing and focus treatment, and
 * splitting them across thirty files made that agreement easy to break.
 *
 * Server-safe by default. Pieces that need state live in ./client.tsx.
 */

import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import type { Tone } from '@/lib/domain';

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

// --- buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[0.625rem] font-medium ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-100 ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-55 ' +
  'whitespace-nowrap select-none';

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // 44px minimum on md and lg: the smallest comfortable touch target.
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-on)] shadow-[var(--shadow-card)] hover:bg-[var(--accent-hover)]',
  secondary:
    'bg-[var(--surface-card)] text-[var(--text-strong)] border border-[var(--line-default)] ' +
    'hover:bg-[var(--surface-sunken)] hover:border-[var(--line-strong)]',
  ghost: 'text-[var(--text-default)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]',
  subtle:
    'bg-[var(--surface-sunken)] text-[var(--text-strong)] hover:bg-[var(--line-subtle)]',
  danger: 'bg-[var(--bad)] text-white hover:brightness-110',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string
): string {
  return cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], extra);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

// --- surfaces ---------------------------------------------------------------

export function Card({
  className,
  children,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'bg-[var(--surface-card)] border border-[var(--line-subtle)] rounded-[var(--radius-card)]',
        'shadow-[var(--shadow-card)]',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-[var(--line-subtle)]',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-[var(--text-strong)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('p-5', className)} />;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2 text-sm text-[var(--text-muted)]">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-[1.75rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

// --- status ------------------------------------------------------------------

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--line-default)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)] border-transparent',
  progress: 'bg-[var(--progress-soft)] text-[var(--progress)] border-transparent',
  success: 'bg-[var(--ok-soft)] text-[var(--ok)] border-transparent',
  warning: 'bg-[var(--warn-soft)] text-[var(--warn)] border-transparent',
  danger: 'bg-[var(--bad-soft)] text-[var(--bad)] border-transparent',
};

/** Just the background colour for a tone, for dots and bars. */
export function badgeTone(tone: Tone): string {
  return {
    neutral: 'bg-[var(--text-muted)]',
    info: 'bg-[var(--info)]',
    progress: 'bg-[var(--progress)]',
    success: 'bg-[var(--ok)]',
    warning: 'bg-[var(--warn)]',
    danger: 'bg-[var(--bad)]',
  }[tone];
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

// --- layout helpers ----------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-muted)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-[var(--text-strong)]">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card className="border-[var(--bad)]/30">
      <CardBody className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bad-soft)] text-[var(--bad)]"
        >
          !
        </span>
        <div>
          <h3 className="font-semibold text-[var(--text-strong)]">{title}</h3>
          {detail ? <p className="mt-1 text-sm text-[var(--text-muted)]">{detail}</p> : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="mb-3 flex gap-4 last:mb-0">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cn('h-5', c === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

// --- data display ------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-[var(--text-muted)]">{label}</span>
        {icon ? <span className="text-[var(--text-muted)]">{icon}</span> : null}
      </div>
      <div
        className={cn(
          'mt-2 text-2xl font-semibold tabular tracking-tight',
          tone === 'danger'
            ? 'text-[var(--bad)]'
            : tone === 'success'
              ? 'text-[var(--ok)]'
              : tone === 'warning'
                ? 'text-[var(--warn)]'
                : 'text-[var(--text-strong)]'
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div> : null}
    </>
  );

  const className = cn(
    'block bg-[var(--surface-card)] border border-[var(--line-subtle)] rounded-[var(--radius-card)]',
    'shadow-[var(--shadow-card)] p-4 transition-shadow',
    href && 'hover:shadow-[var(--shadow-raised)]'
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function DescriptionList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-4',
        columns === 1 ? 'grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-[var(--text-strong)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal scroll container so a wide table never widens the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-px overflow-x-auto">
      <div className="min-w-full align-middle">{children}</div>
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const letters = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {letters || '?'}
    </span>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="my-6 border-[var(--line-subtle)]" />;
  return (
    <div className="my-6 flex items-center gap-3">
      <hr className="flex-1 border-[var(--line-subtle)]" />
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      <hr className="flex-1 border-[var(--line-subtle)]" />
    </div>
  );
}

export function Progress({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, value));
  const colour =
    tone === 'success' ? 'var(--ok)' : tone === 'danger' ? 'var(--bad)' : tone === 'warning' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: colour }} />
    </div>
  );
}

// --- forms (uncontrolled, server-action friendly) ---------------------------

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]"
        >
          {label}
          {required ? <span className="ml-0.5 text-[var(--bad)]">*</span> : null}
        </label>
      ) : null}
      {children}
      {message ? (
        <p className="mt-1.5 text-sm text-[var(--bad)]" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn('field-input', className)} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} {...props} className={cn('field-input resize-y', className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={cn('field-input appearance-none pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='none' stroke='%2394a3b8' stroke-width='1.75'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.5rem center',
      }}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: ComponentProps<'input'> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 py-1', className)}>
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-[var(--line-strong)] accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text-strong)]">{label}</span>
        {description ? (
          <span className="block text-xs text-[var(--text-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** A prefixed money input: the `$` sits inside the control. */
export function MoneyInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        {...props}
        className={cn('field-input pl-7 text-right tabular', className)}
      />
    </div>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[0.625rem] border border-[var(--bad)]/35 bg-[var(--bad-soft)] px-3.5 py-3 text-sm text-[var(--bad)]"
    >
      <span aria-hidden className="mt-px font-bold">!</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FormSuccess({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-[0.625rem] border border-[var(--ok)]/35 bg-[var(--ok-soft)] px-3.5 py-3 text-sm text-[var(--ok)]"
    >
      <span aria-hidden className="mt-px font-bold">✓</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      className={cn(
        'rounded-[0.625rem] border px-3.5 py-3 text-sm',
        tone === 'warning'
          ? 'border-[var(--warn)]/35 bg-[var(--warn-soft)] text-[var(--warn)]'
          : tone === 'danger'
            ? 'border-[var(--bad)]/35 bg-[var(--bad-soft)] text-[var(--bad)]'
            : 'border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]'
      )}
    >
      {children}
    </div>
  );
}

// --- icons ------------------------------------------------------------------
// Inline strokes rather than an icon package: a dozen glyphs is not worth a
// dependency, and these inherit currentColor everywhere.

export function Icon({
  path,
  size = 20,
  className,
  filled = false,
}: {
  path: string;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

export const icons = {
  dashboard: 'M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5',
  jobs: 'M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16',
  customers: 'M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 20v-2a4 4 0 0 0-3-3.87M16 1.13a4 4 0 0 1 0 7.75',
  leads: 'M13 2 4.5 12.5h6L11 22l8.5-10.5h-6z',
  estimates: 'M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2M8 3h8M8 8h8M8 12h5M8 16h3',
  quotes: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  invoices: 'M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8M8 16h5',
  reports: 'M4 3h16v18H4zM8 8h8M8 12h8M8 16h4',
  expenses: 'M3 6h18v12H3zM3 10h18M7 15h3',
  materials: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  emails: 'M3 5h18v14H3zM3 6l9 7 9-7',
  documents: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7',
  tasks: 'M4 6h16M4 12h16M4 18h10M2 6l1 1 2-2M2 12l1 1 2-2',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.07V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  money: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  ai: 'M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5zM5 3v4M3 5h4M19 17v4M17 19h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  building: 'M3 21h18M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 21V9h3a1 1 0 0 1 1 1v11M9 7h2M9 11h2M9 15h2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  location: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  warning: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  chart: 'M3 3v18h18M7 15l3-4 3 3 5-7',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
} as const;
