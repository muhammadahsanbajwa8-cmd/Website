import Link from 'next/link';
import { Logo } from '@/components/marketing';
import { ThemeToggle } from '@/components/ui/client';

/**
 * The signed-out shell: the form on the left, a plain statement of what the
 * product is on the right. Nothing decorative that would push the form below
 * the fold on a phone.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="TradeFlow home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>

        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>

        <p className="text-center text-xs text-[var(--text-muted)]">
          By continuing you agree that TradeFlow stores your business records so it can
          show them back to you.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-[var(--surface-inverse)] px-12 py-16 lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'var(--accent)' }}
        />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-[var(--text-inverse)]">
            Everything about a job, in one place.
          </h2>
          <p className="mt-4 text-[var(--text-inverse)] opacity-75">
            The quote you sent, the photos from Tuesday, the hours the crew put in, the
            receipt for the pavers, and the invoice that came out of all of it.
          </p>

          <ul className="mt-10 space-y-5">
            {[
              ['Quote to invoice without retyping', 'An accepted quote becomes a tax invoice in one action.'],
              ['Reports from the phone, on site', 'Eleven templates, camera upload, sign on the glass.'],
              ['Real numbers, not estimates of estimates', 'Costs, margin and what is still owed, from your own records.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
                <div>
                  <div className="font-medium text-[var(--text-inverse)]">{title}</div>
                  <div className="text-sm text-[var(--text-inverse)] opacity-65">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
