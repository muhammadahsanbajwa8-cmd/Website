import Link from 'next/link';
import { ButtonLink, Card, Icon, icons } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/client';
import { MarketingFooter, MarketingNav } from '@/components/marketing';

export const metadata = {
  title: 'TradeFlow — run your entire trade business from one place',
};

const FEATURES = [
  {
    icon: icons.jobs,
    title: 'Jobs that hold everything',
    body: 'One job carries the customer, the site, the quote, the photos, the daily logs, the expenses and the invoice. Nothing lives in a separate spreadsheet.',
  },
  {
    icon: icons.estimates,
    title: 'Estimating that shows the margin',
    body: 'Price labour, materials, plant, travel and subbies. Markup and contingency on top, GST on the sell price, and the profit on the job in front of you before you send it.',
  },
  {
    icon: icons.quotes,
    title: 'Quotes the customer can accept',
    body: 'A real PDF with your logo and ABN, and a private link. They open it, read the scope, and press Accept. The job status moves and you get a notification.',
  },
  {
    icon: icons.invoices,
    title: 'Invoices and payments',
    body: 'Turn an accepted quote into a tax invoice in one action. Record part payments, watch what is overdue, and never chase the wrong number.',
  },
  {
    icon: icons.reports,
    title: 'Site reports from a phone',
    body: 'Eleven templates — daily site, progress, defect, safety, inspection, variation, patrol, service, handover. Photos attach, the customer signs, it exports as a PDF.',
  },
  {
    icon: icons.emails,
    title: 'Email against the job',
    body: 'Connect your mailbox and every message sits on the job it belongs to. Attach a quote or invoice without leaving the page.',
  },
  {
    icon: icons.ai,
    title: 'An assistant that knows your books',
    body: '“Which invoices are overdue?” “What do I need to do today?” “Read this email and tell me what it needs.” Answered from your data, and only yours.',
  },
  {
    icon: icons.money,
    title: 'Where the money went',
    body: 'Log expenses and receipts against a job, and see the profit on it against what you estimated. In AUD, with GST handled properly.',
  },
];

const WORKFLOW = [
  { step: 'Lead', body: 'Someone calls. You write it down once.' },
  { step: 'Estimate', body: 'Price the work. See the margin before you commit.' },
  { step: 'Quote', body: 'Send a proper PDF. They accept it online.' },
  { step: 'Job', body: 'Schedule it, run it, photograph it, log the hours.' },
  { step: 'Invoice', body: 'Bill from the quote. Track what is still owed.' },
  { step: 'Paid', body: 'Record it. The job closes with its real profit on it.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <MarketingNav />

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 h-96 opacity-[0.18] blur-3xl"
            style={{
              background:
                'radial-gradient(50% 60% at 50% 50%, var(--accent) 0%, transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-5xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line-default)] bg-[var(--surface-card)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              Built for Australian trades — AUD, GST and ABN throughout
            </span>

            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-[var(--text-strong)] sm:text-5xl md:text-6xl">
              Run your entire trade business
              <br className="hidden sm:block" /> from one place.
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-[var(--text-muted)]">
              Customers, leads, estimates, quotes, jobs, tasks, site reports, photos,
              timesheets, expenses, email, invoices and payments. One system, from the
              first phone call to the money in the account.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" className="w-full sm:w-auto">
                Start free
                <Icon path={icons.arrowRight} size={18} />
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" size="lg" className="w-full sm:w-auto">
                See pricing
              </ButtonLink>
            </div>

            <p className="mt-4 text-sm text-[var(--text-muted)]">
              No card required. Load the demo business and click through a real one.
            </p>
          </div>

          {/* A representative screen, drawn rather than screenshotted, so it
              never goes stale against the real interface. */}
          <div className="relative mx-auto mt-14 max-w-5xl">
            <Card className="overflow-hidden p-0 shadow-[var(--shadow-pop)]">
              <div className="flex items-center gap-2 border-b border-[var(--line-subtle)] bg-[var(--surface-sunken)] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--bad)]/50" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]/50" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--ok)]/50" />
                <span className="ml-3 text-xs text-[var(--text-muted)]">Dashboard</span>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-4">
                {[
                  { label: 'Revenue this year', value: '$284,610', tone: 'text-[var(--text-strong)]' },
                  { label: 'Outstanding', value: '$41,280', tone: 'text-[var(--text-strong)]' },
                  { label: 'Overdue', value: '$6,450', tone: 'text-[var(--bad)]' },
                  { label: 'Open quotes', value: '$88,900', tone: 'text-[var(--text-strong)]' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-4"
                  >
                    <div className="text-xs font-medium text-[var(--text-muted)]">{stat.label}</div>
                    <div className={`mt-1.5 text-xl font-semibold tabular ${stat.tone}`}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[1.6fr_1fr]">
                <div className="rounded-[0.625rem] border border-[var(--line-subtle)] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-strong)]">
                    Revenue and costs
                  </div>
                  <svg viewBox="0 0 320 90" className="h-24 w-full" role="img" aria-label="Illustrative revenue chart">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
                      const heights = [34, 41, 30, 52, 47, 61, 55, 68, 58, 74, 66, 80];
                      const costs = [20, 24, 18, 30, 27, 34, 31, 38, 33, 41, 37, 44];
                      const x = i * 26 + 6;
                      return (
                        <g key={i}>
                          <rect x={x} y={86 - heights[i]!} width={9} height={heights[i]} rx={2} fill="var(--accent)" opacity={0.85} />
                          <rect x={x + 10} y={86 - costs[i]!} width={9} height={costs[i]} rx={2} fill="var(--line-strong)" opacity={0.5} />
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div className="rounded-[0.625rem] border border-[var(--line-subtle)] p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-strong)]">Today</div>
                  <ul className="space-y-2.5 text-sm">
                    {[
                      ['Repair damaged brickwork — 14 Wattle St', 'Urgent'],
                      ['Send progress report to Harbourside', 'High'],
                      ['Order second batch of pavers', 'Medium'],
                    ].map(([task, priority]) => (
                      <li key={task} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span className="min-w-0 flex-1 truncate text-[var(--text-default)]">{task}</span>
                        <span className="shrink-0 text-xs text-[var(--text-muted)]">{priority}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* Workflow */}
        <section className="border-y border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              One thread, first call to final payment
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-[var(--text-muted)]">
              Every stage carries the last one forward. You never retype a customer, an
              address, a scope or a price.
            </p>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              {WORKFLOW.map((stage, index) => (
                <li key={stage.step} className="relative">
                  <div className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-page)] p-4">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">
                      {index + 1}
                    </div>
                    <div className="mt-3 font-semibold text-[var(--text-strong)]">{stage.step}</div>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{stage.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything the job needs
            </h2>
            <p className="mt-3 max-w-2xl text-[var(--text-muted)]">
              Not modules bolted together — one database, one customer record, one set of
              numbers that agree with each other.
            </p>

            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <Card key={feature.title} className="p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon path={feature.icon} size={20} />
                  </div>
                  <h3 className="mt-4 font-semibold text-[var(--text-strong)]">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                    {feature.body}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Mobile */}
        <section className="border-y border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-16">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                A report from site in under a minute
              </h2>
              <p className="mt-4 text-[var(--text-muted)]">
                The people who actually fill this in are standing in the rain with one
                hand free. So the phone layout is not a shrunk-down desktop: big targets,
                the camera one tap away, the template pre-filled with the job, and as
                little typing as the report can get away with.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Camera upload straight into the job and the report',
                  'Templates that remember the job, the site and the crew',
                  'Timesheets that work out the hours, including night shifts',
                  'Receipts photographed against the job they belong to',
                  'Sign on the glass and it is done',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                      <Icon path={icons.check} size={12} />
                    </span>
                    <span className="text-[var(--text-default)]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mx-auto w-full max-w-xs">
              <div className="rounded-[2rem] border-[10px] border-[var(--ink-900)] bg-[var(--surface-page)] p-3 shadow-[var(--shadow-pop)]">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-[var(--text-strong)]">
                    Daily site report
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">JOB-0042</span>
                </div>
                <div className="space-y-2.5">
                  {['Weather', 'Crew on site', 'Work completed'].map((label) => (
                    <div
                      key={label}
                      className="rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-card)] px-3 py-2.5"
                    >
                      <div className="text-[0.65rem] uppercase tracking-wide text-[var(--text-muted)]">
                        {label}
                      </div>
                      <div className="mt-0.5 h-3 w-2/3 rounded bg-[var(--surface-sunken)]" />
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex aspect-square items-center justify-center rounded-[0.625rem] border border-dashed border-[var(--line-default)] text-[var(--text-muted)]"
                      >
                        <Icon path={icons.camera} size={18} />
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[0.625rem] bg-[var(--accent)] py-3 text-center text-sm font-medium text-[var(--accent-on)]">
                    Save report
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Your books are yours
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-[var(--text-muted)]">
              Every table in the database carries the business it belongs to, and every
              query is filtered by row level security in Postgres before it returns a row.
              Not a filter in application code that someone can forget — the database
              refuses. Changing an id in a URL gets you a 404, and the attempt is logged.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                ['Row level security', 'Tenancy enforced in the database, on every table.'],
                ['Roles that mean something', 'A worker on the tools sees no pricing at all.'],
                ['Audit log', 'Append-only. Not even an owner can rewrite it.'],
              ].map(([title, body]) => (
                <Card key={title} className="p-5 text-left">
                  <h3 className="font-semibold text-[var(--text-strong)]">{title}</h3>
                  <p className="mt-1.5 text-sm text-[var(--text-muted)]">{body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 pb-20">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-inverse)] px-6 py-14 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-inverse)] sm:text-3xl">
              Stop running the business out of a glovebox
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--text-inverse)] opacity-75">
              Set it up in a few minutes, load the demo business, and see the whole thing
              working before you put a single real customer in.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg">
                Start free
              </ButtonLink>
              <Link
                href="/pricing"
                className="text-sm font-medium text-[var(--text-inverse)] underline underline-offset-4 opacity-80 hover:opacity-100"
              >
                Compare the plans
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
      <div className="fixed bottom-4 right-4 z-40 no-print">
        <ThemeToggle />
      </div>
    </div>
  );
}
