import Link from 'next/link';
import { ButtonLink } from '@/components/ui';

/** The wordmark. Drawn rather than an image file so it stays sharp and themes. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 28 : 32;
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={box}
        height={box}
        viewBox="0 0 32 32"
        aria-hidden
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path
          d="M8 21.5 13.5 10l4 8 2.5-4.5 4 8"
          stroke="var(--accent-on)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span
        className={`font-semibold tracking-tight text-[var(--text-strong)] ${
          size === 'sm' ? 'text-base' : 'text-lg'
        }`}
      >
        TradeFlow
      </span>
    </span>
  );
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line-subtle)] bg-[var(--surface-page)]/85 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" aria-label="TradeFlow home">
          <Logo />
        </Link>
        <div className="hidden items-center gap-6 text-sm font-medium text-[var(--text-muted)] md:flex">
          <Link href="/#features" className="hover:text-[var(--text-strong)]">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-[var(--text-strong)]">
            Pricing
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Start free
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo size="sm" />
          <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
            Job management, quoting, invoicing and site reporting for trades and
            field-service businesses.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-muted)]">
          <Link href="/pricing" className="hover:text-[var(--text-strong)]">
            Pricing
          </Link>
          <Link href="/login" className="hover:text-[var(--text-strong)]">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-[var(--text-strong)]">
            Create an account
          </Link>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl border-t border-[var(--line-subtle)] pt-6 text-xs text-[var(--text-muted)]">
        <p>
          Amounts are in Australian dollars and GST is calculated at 10% where a business
          is registered. TradeFlow records and formats your figures; it does not give
          legal, tax or accounting advice — check anything that matters with your
          accountant.
        </p>
      </div>
    </footer>
  );
}
