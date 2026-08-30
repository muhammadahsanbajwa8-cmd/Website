'use client';

/**
 * The interactive half of the kit: anything that needs state, a portal, or the
 * form status hook.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buttonClass, cn, Icon, icons } from './index';

// --- submit -----------------------------------------------------------------

/**
 * A submit button that shows it is working. Every form in the app uses this
 * rather than a bare <button type="submit">, so no action can be fired twice
 * by an impatient double tap.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...props}
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Spinner size={16} /> : null}
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// --- toasts -----------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'danger';
}

const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void }>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto animate-in rounded-[0.625rem] px-4 py-3 text-sm font-medium shadow-[var(--shadow-pop)]',
              'max-w-sm border',
              toast.tone === 'success'
                ? 'border-[var(--ok)]/30 bg-[var(--ok-soft)] text-[var(--ok)]'
                : toast.tone === 'danger'
                  ? 'border-[var(--bad)]/30 bg-[var(--bad-soft)] text-[var(--bad)]'
                  : 'border-[var(--line-default)] bg-[var(--surface-raised)] text-[var(--text-strong)]'
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// --- dialog -----------------------------------------------------------------

/**
 * A modal built on <dialog>, so focus trapping, Escape and the backdrop are
 * the platform's job rather than ours.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop closes; clicking the panel does not.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-[var(--line-subtle)] p-0',
        'bg-[var(--surface-card)] text-[var(--text-default)] shadow-[var(--shadow-pop)]',
        'backdrop:bg-black/45 backdrop:backdrop-blur-[2px] animate-scale-in',
        widths[size]
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--line-subtle)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-strong)]">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
        >
          <Icon path={icons.x} size={18} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line-subtle)] px-5 py-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Destructive actions ask first. The form is submitted only after the person
 * confirms, so a mis-tap on a phone cannot delete a job.
 */
export function ConfirmSubmit({
  children,
  confirmTitle,
  confirmBody,
  confirmLabel = 'Delete',
  variant = 'danger',
  size = 'sm',
  className,
}: {
  children: ReactNode;
  confirmTitle: string;
  confirmBody: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass(variant, size, className)}
      >
        {children}
      </button>
      <button ref={buttonRef} type="submit" className="hidden" aria-hidden tabIndex={-1} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmBody}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass('secondary', 'md')}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.click();
              }}
              className={buttonClass(variant === 'danger' ? 'danger' : 'primary', 'md')}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-default)]">
          This cannot be undone from the interface.
        </p>
      </Modal>
    </>
  );
}

// --- search / filter --------------------------------------------------------

/** Writes its value into the URL, debounced, so results are shareable. */
export function SearchInput({
  placeholder = 'Search…',
  paramName = 'q',
  className,
}: {
  placeholder?: string;
  paramName?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? '');
  const [pending, startTransition] = useTransition();
  const id = useId();

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(paramName, value);
      else params.delete(paramName);
      params.delete('page');
      const next = `${pathname}?${params.toString()}`;
      if (next !== `${pathname}?${searchParams.toString()}`) {
        startTransition(() => router.replace(next, { scroll: false }));
      }
    }, 280);
    return () => clearTimeout(timer);
    // `searchParams` intentionally omitted: including it re-runs the debounce
    // on our own replace and fights the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, pathname, paramName]);

  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
        <Icon path={icons.search} size={18} />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field-input pl-10"
      />
      {pending ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
          <Spinner size={16} />
        </span>
      ) : null}
    </div>
  );
}

/** A select that filters by writing to the URL. */
export function FilterSelect({
  paramName,
  options,
  label,
  allLabel = 'All',
}: {
  paramName: string;
  options: { value: string; label: string }[];
  label: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? '';

  return (
    <select
      aria-label={label}
      value={current}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams.toString());
        if (event.target.value) params.set(paramName, event.target.value);
        else params.delete(paramName);
        params.delete('page');
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className="field-input h-11 w-auto min-w-36 py-0"
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// --- misc -------------------------------------------------------------------

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access can be refused; the value is visible on screen
          // for the person to copy by hand.
        }
      }}
      className={buttonClass('secondary', 'sm')}
    >
      <Icon path={copied ? icons.check : icons.copy} size={16} />
      {copied ? 'Copied' : label}
    </button>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('tf-theme');
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle('dark', next);
        try {
          localStorage.setItem('tf-theme', next ? 'dark' : 'light');
        } catch {
          // Private browsing can refuse storage; the toggle still works for
          // this page view.
        }
      }}
      className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
    >
      <Icon path={dark ? icons.sun : icons.moon} size={18} />
    </button>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-[0.625rem] border border-[var(--line-subtle)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[var(--text-strong)]">
        {summary}
        <span className="text-[var(--text-muted)] transition-transform group-open:rotate-180">
          <Icon path={icons.chevronDown} size={18} />
        </span>
      </summary>
      <div className="border-t border-[var(--line-subtle)] px-4 py-3">{children}</div>
    </details>
  );
}

/** Tabs that keep the chosen panel in the URL, so a refresh stays put. */
export function Tabs({
  tabs,
  paramName = 'tab',
}: {
  tabs: { id: string; label: string; count?: number; content: ReactNode }[];
  paramName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(paramName) ?? tabs[0]?.id ?? '';
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--line-subtle)]"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current?.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set(paramName, tab.id);
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }}
              className={cn(
                'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span className="ml-1.5 rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-xs tabular">
                  {tab.count}
                </span>
              ) : null}
              {selected ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </div>
  );
}
