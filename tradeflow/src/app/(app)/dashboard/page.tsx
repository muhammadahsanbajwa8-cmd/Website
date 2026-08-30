import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, lookup } from '@/lib/query';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  StatCard,
  icons,
} from '@/components/ui';
import { RevenueChart, StatusBars, type MonthPoint } from '@/components/charts';
import { formatDate, formatMoney, formatMoneyCompact, todayInAustralia } from '@/lib/format';
import { JOB_STATUSES, jobStatus, taskPriority, quoteStatus } from '@/lib/domain';
import type { Json } from '@/lib/database.types';

export const metadata = { title: 'Dashboard' };

interface Summary {
  revenue_cents: number;
  revenue_30d_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  overdue_count: number;
  open_quotes_cents: number;
  open_quotes_count: number;
  active_jobs: number;
  tasks_due: number;
  tasks_open: number;
  expenses_30d_cents: number;
  expenses_ytd_cents: number;
  unread_emails: number;
  revenue_by_month: MonthPoint[];
  jobs_by_status: Record<string, number>;
}

const TONE_COLOUR: Record<string, string> = {
  neutral: 'var(--text-muted)',
  info: 'var(--info)',
  progress: 'var(--progress)',
  success: 'var(--ok)',
  warning: 'var(--warn)',
  danger: 'var(--bad)',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const session = await requireBusiness();
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const today = todayInAustralia();
  const showsMoney = session.can('dashboard.financials');

  // Bring overdue invoices up to date before the figures are read, so the
  // "overdue" number is never a day stale.
  if (session.can('invoices.edit')) {
    await supabase.rpc('mark_overdue_invoices', { target: session.business.id });
  }

  const [{ data: summaryData }, tasksResult, jobsResult, activityResult] = await Promise.all([
    supabase.rpc('dashboard_summary', { target: session.business.id }),
    supabase
      .from('job_tasks')
      .select('id, title, priority, status, due_date, job_id')
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .in('status', ['open', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(6),
    supabase
      .from('jobs')
      .select('id, number, name, status, customer_id, expected_completion_date')
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .in('status', ['accepted', 'scheduled', 'in_progress', 'on_hold'])
      .order('expected_completion_date', { ascending: true, nullsFirst: false })
      .limit(6),
    supabase
      .from('activities')
      .select('id, summary, actor_label, created_at, verb')
      .eq('business_id', session.business.id)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const summary = (summaryData ?? null) as Summary | null;
  const tasks = tasksResult.data ?? [];
  const jobs = jobsResult.data ?? [];
  const activities = activityResult.data ?? [];

  const customers = await lookup(
    'customers',
    idsFrom(jobs, (job) => job.customer_id),
    'id, name, company'
  );

  const quotesResult = showsMoney
    ? await supabase
        .from('quotes')
        .select('id, number, title, status, total_cents, expiry_date, customer_id')
        .eq('business_id', session.business.id)
        .is('deleted_at', null)
        .in('status', ['sent', 'viewed', 'changes_requested'])
        .order('issue_date', { ascending: false })
        .limit(5)
    : { data: [] };
  const openQuotes = quotesResult.data ?? [];

  const jobsByStatus = summary?.jobs_by_status ?? {};
  const totalJobs = Object.values(jobsByStatus).reduce((n, v) => n + Number(v), 0);
  const estimatedProfit = (summary?.revenue_cents ?? 0) - (summary?.expenses_ytd_cents ?? 0);

  const firstName = (session.profile?.full_name ?? session.email).split(/[\s@]/)[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${session.business.name} — here is where things stand today, ${formatDate(today)}.`}
        actions={
          session.can('jobs.edit') ? (
            <ButtonLink href="/jobs/new">
              <Icon path={icons.plus} size={18} />
              New job
            </ButtonLink>
          ) : null
        }
      />

      {welcome ? (
        <div className="mb-6">
          <InfoNote>
            <strong>{session.business.name} is set up.</strong> Add a customer, then a job,
            then quote it — or load the demo business from{' '}
            <Link href="/settings/demo" className="underline">
              Settings → Demo data
            </Link>{' '}
            to see a full one first.
          </InfoNote>
        </div>
      ) : null}

      {/* --- headline figures --- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showsMoney ? (
          <>
            <StatCard
              label="Revenue this year"
              value={formatMoneyCompact(summary?.revenue_cents ?? 0)}
              hint={`${formatMoney(summary?.revenue_30d_cents ?? 0)} in the last 30 days`}
              icon={<Icon path={icons.money} size={18} />}
              href="/invoices?status=paid"
            />
            <StatCard
              label="Outstanding"
              value={formatMoneyCompact(summary?.outstanding_cents ?? 0)}
              hint="Sent and unpaid"
              icon={<Icon path={icons.invoices} size={18} />}
              href="/invoices?status=sent"
            />
            <StatCard
              label="Overdue"
              value={formatMoneyCompact(summary?.overdue_cents ?? 0)}
              tone={(summary?.overdue_cents ?? 0) > 0 ? 'danger' : 'neutral'}
              hint={
                (summary?.overdue_count ?? 0) > 0
                  ? `${summary?.overdue_count} invoice${summary?.overdue_count === 1 ? '' : 's'} past due`
                  : 'Nothing past due'
              }
              icon={<Icon path={icons.warning} size={18} />}
              href="/invoices?status=overdue"
            />
            <StatCard
              label="Open quotes"
              value={formatMoneyCompact(summary?.open_quotes_cents ?? 0)}
              hint={`${summary?.open_quotes_count ?? 0} awaiting a decision`}
              icon={<Icon path={icons.quotes} size={18} />}
              href="/quotes?status=sent"
            />
          </>
        ) : null}

        <StatCard
          label="Active jobs"
          value={summary?.active_jobs ?? 0}
          hint="Accepted, scheduled or under way"
          icon={<Icon path={icons.jobs} size={18} />}
          href="/jobs?status=in_progress"
        />
        <StatCard
          label="Tasks due"
          value={summary?.tasks_due ?? 0}
          tone={(summary?.tasks_due ?? 0) > 0 ? 'warning' : 'neutral'}
          hint={`${summary?.tasks_open ?? 0} open in total`}
          icon={<Icon path={icons.tasks} size={18} />}
          href="/tasks?due=today"
        />

        {showsMoney ? (
          <>
            <StatCard
              label="Expenses this year"
              value={formatMoneyCompact(summary?.expenses_ytd_cents ?? 0)}
              hint={`${formatMoney(summary?.expenses_30d_cents ?? 0)} in the last 30 days`}
              icon={<Icon path={icons.expenses} size={18} />}
              href="/expenses"
            />
            <StatCard
              label="Estimated profit"
              value={formatMoneyCompact(estimatedProfit)}
              tone={estimatedProfit >= 0 ? 'success' : 'danger'}
              hint="Payments received less expenses, this year"
              icon={<Icon path={icons.chart} size={18} />}
            />
          </>
        ) : (
          <StatCard
            label="Unread email"
            value={summary?.unread_emails ?? 0}
            hint="On jobs and customers"
            icon={<Icon path={icons.emails} size={18} />}
            href="/emails"
          />
        )}
      </div>

      {/* --- charts and lists --- */}
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {showsMoney ? (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Money in and money out"
              description="Payments received against expenses recorded, by month."
            />
            <CardBody>
              <RevenueChart data={summary?.revenue_by_month ?? []} />
            </CardBody>
          </Card>
        ) : null}

        <Card className={showsMoney ? '' : 'lg:col-span-2'}>
          <CardHeader title="Jobs by status" action={<Link href="/jobs" className="text-sm text-[var(--accent)] hover:underline">All jobs</Link>} />
          <CardBody>
            <StatusBars
              total={totalJobs}
              hrefFor={(key) => `/jobs?status=${key}`}
              data={JOB_STATUSES.filter((status) => Number(jobsByStatus[status.value] ?? 0) > 0).map(
                (status) => ({
                  key: status.value,
                  label: status.label,
                  value: Number(jobsByStatus[status.value] ?? 0),
                  tone: TONE_COLOUR[status.tone] ?? 'var(--accent)',
                })
              )}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Tasks */}
        <Card>
          <CardHeader
            title="What needs doing"
            action={
              <Link href="/tasks" className="text-sm text-[var(--accent)] hover:underline">
                All tasks
              </Link>
            }
          />
          {tasks.length === 0 ? (
            <EmptyState
              icon={<Icon path={icons.check} size={20} />}
              title="Nothing outstanding"
              description="Tasks created from emails, reports and defects land here."
              action={
                session.can('tasks.edit') ? (
                  <ButtonLink href="/tasks/new" variant="secondary" size="sm">
                    Add a task
                  </ButtonLink>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--line-subtle)]">
              {tasks.map((task) => {
                const overdue = task.due_date != null && task.due_date < today;
                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                          {task.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {task.due_date
                            ? overdue
                              ? `Overdue — was due ${formatDate(task.due_date)}`
                              : `Due ${formatDate(task.due_date)}`
                            : 'No due date'}
                        </span>
                      </span>
                      <Badge tone={overdue ? 'danger' : taskPriority(task.priority).tone}>
                        {overdue ? 'Overdue' : taskPriority(task.priority).label}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Jobs on the go */}
        <Card>
          <CardHeader
            title="Jobs on the go"
            action={
              <Link href="/jobs" className="text-sm text-[var(--accent)] hover:underline">
                All jobs
              </Link>
            }
          />
          {jobs.length === 0 ? (
            <EmptyState
              icon={<Icon path={icons.jobs} size={20} />}
              title="No active jobs"
              description="A job moves here once it is accepted, scheduled or under way."
              action={
                session.can('jobs.edit') ? (
                  <ButtonLink href="/jobs/new" variant="secondary" size="sm">
                    Create a job
                  </ButtonLink>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--line-subtle)]">
              {jobs.map((job) => {
                const customer = job.customer_id ? customers.get(job.customer_id) : null;
                const late =
                  job.expected_completion_date != null && job.expected_completion_date < today;
                return (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                          {job.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                          {job.number}
                          {customer ? ` · ${customer.company || customer.name}` : ''}
                          {job.expected_completion_date
                            ? ` · ${late ? 'was due' : 'due'} ${formatDate(job.expected_completion_date)}`
                            : ''}
                        </span>
                      </span>
                      <Badge tone={late ? 'danger' : jobStatus(job.status).tone}>
                        {jobStatus(job.status).label}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {showsMoney ? (
          <Card>
            <CardHeader
              title="Quotes awaiting a decision"
              action={
                <Link href="/quotes" className="text-sm text-[var(--accent)] hover:underline">
                  All quotes
                </Link>
              }
            />
            {openQuotes.length === 0 ? (
              <EmptyState
                icon={<Icon path={icons.quotes} size={20} />}
                title="No open quotes"
                description="Quotes you have sent but the customer has not answered appear here."
              />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {openQuotes.map((quote) => {
                  const expiring = quote.expiry_date != null && quote.expiry_date < today;
                  return (
                    <li key={quote.id}>
                      <Link
                        href={`/quotes/${quote.id}`}
                        className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                            {quote.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                            {quote.number}
                            {quote.expiry_date
                              ? expiring
                                ? ` · expired ${formatDate(quote.expiry_date)}`
                                : ` · valid to ${formatDate(quote.expiry_date)}`
                              : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold tabular text-[var(--text-strong)]">
                            {formatMoney(quote.total_cents)}
                          </span>
                          <Badge tone={expiring ? 'warning' : quoteStatus(quote.status).tone}>
                            {expiring ? 'Expired' : quoteStatus(quote.status).label}
                          </Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}

        <Card className={showsMoney ? '' : 'lg:col-span-2'}>
          <CardHeader title="Recent activity" description="Everything that happened, in order." />
          {activities.length === 0 ? (
            <EmptyState
              icon={<Icon path={icons.clock} size={20} />}
              title="Nothing has happened yet"
              description="Every quote sent, invoice paid and report filed is recorded here."
            />
          ) : (
            <CardBody>
              <ol className="relative space-y-4 border-l border-[var(--line-subtle)] pl-5">
                {activities.map((activity) => (
                  <li key={activity.id} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[1.6rem] top-1.5 h-2 w-2 rounded-full bg-[var(--accent)] ring-4 ring-[var(--surface-card)]"
                    />
                    <div className="text-sm text-[var(--text-default)]">{activity.summary}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {activity.actor_label ?? 'System'} · {formatDate(activity.created_at.slice(0, 10))}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Australia/Sydney',
    }).format(new Date())
  );
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

export type { Json };
