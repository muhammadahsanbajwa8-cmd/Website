import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, lookup } from '@/lib/query';
import { changeJobStatusAction, deleteJobAction } from '../actions';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  EmptyState,
  Icon,
  PageHeader,
  Progress,
  StatCard,
  icons,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { Timeline } from '@/components/list';
import { JobNotes } from './notes';
import { PhotoGrid } from '@/components/photos';
import {
  formatBasisPoints,
  formatDate,
  formatMoney,
  todayInAustralia,
} from '@/lib/format';
import { formatMinutes } from '@/lib/calc';
import {
  invoiceStatus,
  jobStatus,
  nextJobStatuses,
  quoteStatus,
  reportStatus,
  taskStatus,
} from '@/lib/domain';
import type { Job, Json } from '@/lib/database.types';

interface Profitability {
  invoiced_ex_gst_cents: number;
  paid_cents: number;
  expenses_ex_gst_cents: number;
  profit_cents: number;
  margin_bp: number;
  labour_minutes: number;
  budget_cents: number | null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireBusiness();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select('number, name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data ? `${data.number} — ${data.name}` : 'Job' };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireBusiness();
  const { id } = await params;
  const supabase = await createClient();
  const today = todayInAustralia();
  const showsMoney = session.can('quotes.view');

  const { data } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const job = data as Job;

  const [
    customerResult,
    tasksResult,
    photosResult,
    reportsResult,
    worklogsResult,
    notesResult,
    activitiesResult,
    assignmentsResult,
    documentsResult,
  ] = await Promise.all([
    job.customer_id
      ? supabase
          .from('customers')
          .select('id, name, company, email, phone')
          .eq('id', job.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('job_tasks')
      .select('id, title, status, priority, due_date')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from('job_photos')
      .select('id, storage_path, caption, category, taken_at, file_name')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('taken_at', { ascending: false })
      .limit(12),
    supabase
      .from('reports')
      .select('id, number, title, report_date, status, template_key')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('report_date', { ascending: false })
      .limit(10),
    supabase
      .from('work_logs')
      .select('id, work_date, total_minutes, worker_count, work_completed')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('work_date', { ascending: false })
      .limit(10),
    supabase
      .from('job_notes')
      .select('id, body, created_at, created_by')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('activities')
      .select('id, summary, actor_label, created_at')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('job_assignments')
      .select('team_member_id')
      .eq('business_id', session.business.id)
      .eq('job_id', id),
    supabase
      .from('job_documents')
      .select('id, file_name, mime_type, created_at')
      .eq('business_id', session.business.id)
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const [quotesResult, invoicesResult, expensesResult, profitResult] = showsMoney
    ? await Promise.all([
        supabase
          .from('quotes')
          .select('id, number, title, status, total_cents, issue_date')
          .eq('business_id', session.business.id)
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('issue_date', { ascending: false }),
        supabase
          .from('invoices')
          .select('id, number, status, total_cents, paid_cents, issue_date, due_date')
          .eq('business_id', session.business.id)
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('issue_date', { ascending: false }),
        supabase
          .from('expenses')
          .select('id, description, amount_cents, category, spent_on')
          .eq('business_id', session.business.id)
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('spent_on', { ascending: false })
          .limit(10),
        supabase.rpc('job_profitability', { p_job: id }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: null as Json | null }];

  const customer = customerResult.data;
  const tasks = tasksResult.data ?? [];
  const photos = photosResult.data ?? [];
  const reports = reportsResult.data ?? [];
  const worklogs = worklogsResult.data ?? [];
  const quotes = quotesResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const expenses = expensesResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const profit = (profitResult.data ?? null) as Profitability | null;

  const team = await lookup(
    'team_members',
    idsFrom(assignmentsResult.data ?? [], (a) => a.team_member_id),
    'id, full_name, email, role'
  );
  const noteAuthors = await lookup(
    'profiles',
    idsFrom(notesResult.data ?? [], (note) => note.created_by),
    'id, full_name, email'
  );

  const totalMinutes = worklogs.reduce(
    (n, log) => n + log.total_minutes * Math.max(log.worker_count, 1),
    0
  );
  const openTasks = tasks.filter((task) => task.status === 'open' || task.status === 'in_progress');
  const siteAddress =
    [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
      .filter(Boolean)
      .join(', ') || null;

  const budgetUsed =
    job.budget_cents && profit ? (profit.expenses_ex_gst_cents / job.budget_cents) * 100 : null;

  return (
    <>
      <PageHeader
        title={job.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-[var(--text-default)]">{job.number}</span>
            {customer ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/customers/${customer.id}`} className="hover:text-[var(--accent)]">
                  {customer.company || customer.name}
                </Link>
              </>
            ) : null}
            {siteAddress ? (
              <>
                <span aria-hidden>·</span>
                <span>{siteAddress}</span>
              </>
            ) : null}
          </span>
        }
        breadcrumb={
          <Link href="/jobs" className="hover:text-[var(--text-strong)]">
            Jobs
          </Link>
        }
        actions={
          <>
            {session.can('reports.edit') ? (
              <ButtonLink href={`/reports/new?job=${job.id}`} variant="secondary">
                <Icon path={icons.reports} size={16} />
                Report
              </ButtonLink>
            ) : null}
            {session.can('worklogs.edit') ? (
              <ButtonLink href={`/timesheets/new?job=${job.id}`} variant="secondary">
                <Icon path={icons.clock} size={16} />
                Log hours
              </ButtonLink>
            ) : null}
            {session.can('quotes.edit') ? (
              <ButtonLink href={`/quotes/new?job=${job.id}`} variant="secondary">
                <Icon path={icons.quotes} size={16} />
                Quote
              </ButtonLink>
            ) : null}
            {session.can('jobs.edit') ? (
              <ButtonLink href={`/jobs/${job.id}/edit`}>
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {/* Status row */}
      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-center gap-3">
          <Badge tone={jobStatus(job.status).tone} dot>
            {jobStatus(job.status).label}
          </Badge>

          {session.can('jobs.edit') ? (
            <>
              <span className="text-sm text-[var(--text-muted)]">Move to</span>
              <div className="flex flex-wrap gap-2">
                {nextJobStatuses(job.status).map((status) => (
                  <form key={status} action={changeJobStatusAction}>
                    <input type="hidden" name="id" value={job.id} />
                    <input type="hidden" name="status" value={status} />
                    <button
                      type="submit"
                      className="rounded-full border border-[var(--line-default)] px-3 py-1 text-xs font-medium text-[var(--text-default)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                    >
                      {jobStatus(status).label}
                    </button>
                  </form>
                ))}
              </div>
            </>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[var(--text-muted)]">
            {job.start_date ? <span>Started {formatDate(job.start_date)}</span> : null}
            {job.expected_completion_date ? (
              <span
                className={
                  job.expected_completion_date < today &&
                  !['completed', 'invoiced', 'paid', 'cancelled'].includes(job.status)
                    ? 'font-medium text-[var(--bad)]'
                    : undefined
                }
              >
                Due {formatDate(job.expected_completion_date)}
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* Money */}
      {showsMoney ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Invoiced (ex GST)"
            value={formatMoney(profit?.invoiced_ex_gst_cents ?? 0)}
            hint={`${formatMoney(profit?.paid_cents ?? 0)} received`}
          />
          <StatCard
            label="Costs (ex GST)"
            value={formatMoney(profit?.expenses_ex_gst_cents ?? 0)}
            hint={
              job.budget_cents
                ? `Budget ${formatMoney(job.budget_cents)}`
                : `${expenses.length} recorded`
            }
          />
          <StatCard
            label="Profit"
            value={formatMoney(profit?.profit_cents ?? 0)}
            tone={(profit?.profit_cents ?? 0) >= 0 ? 'success' : 'danger'}
            hint={`${formatBasisPoints(profit?.margin_bp ?? 0)} margin`}
          />
          <StatCard
            label="Labour logged"
            value={formatMinutes(profit?.labour_minutes ?? totalMinutes)}
            hint={`${worklogs.length} shift${worklogs.length === 1 ? '' : 's'} recorded`}
          />
        </div>
      ) : null}

      {budgetUsed !== null ? (
        <Card className="mb-5">
          <CardBody>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium text-[var(--text-strong)]">Budget used</span>
              <span className="tabular text-[var(--text-muted)]">
                {formatMoney(profit?.expenses_ex_gst_cents ?? 0)} of{' '}
                {formatMoney(job.budget_cents ?? 0)} · {Math.round(budgetUsed)}%
              </span>
            </div>
            <Progress
              value={budgetUsed}
              tone={budgetUsed > 100 ? 'danger' : budgetUsed > 85 ? 'warning' : 'success'}
            />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {job.description ? (
            <Card>
              <CardHeader title="Scope" />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                  {job.description}
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/* Tasks */}
          <Card>
            <CardHeader
              title="Tasks"
              description={`${openTasks.length} open of ${tasks.length}`}
              action={
                session.can('tasks.edit') ? (
                  <ButtonLink href={`/tasks/new?job=${job.id}`} variant="secondary" size="sm">
                    Add task
                  </ButtonLink>
                ) : null
              }
            />
            {tasks.length === 0 ? (
              <EmptyState icon={<Icon path={icons.tasks} size={20} />} title="No tasks on this job" />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-default)]">
                        {task.title}
                      </span>
                      {task.due_date ? (
                        <span className="shrink-0 text-xs text-[var(--text-muted)]">
                          {formatDate(task.due_date)}
                        </span>
                      ) : null}
                      <Badge tone={taskStatus(task.status).tone}>
                        {taskStatus(task.status).label}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Photos */}
          <Card>
            <CardHeader
              title="Photos"
              description={`${photos.length} on this job`}
              action={
                session.can('photos.edit') ? (
                  <ButtonLink href={`/jobs/${job.id}/photos`} variant="secondary" size="sm">
                    <Icon path={icons.camera} size={15} />
                    Add photos
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody>
              <PhotoGrid photos={photos} emptyMessage="No photos yet. Add them from a phone on site." />
            </CardBody>
          </Card>

          {showsMoney ? (
            <>
              <Card>
                <CardHeader
                  title="Quotes"
                  action={
                    session.can('quotes.edit') ? (
                      <ButtonLink href={`/quotes/new?job=${job.id}`} variant="secondary" size="sm">
                        New quote
                      </ButtonLink>
                    ) : null
                  }
                />
                {quotes.length === 0 ? (
                  <EmptyState icon={<Icon path={icons.quotes} size={20} />} title="Not quoted yet" />
                ) : (
                  <ul className="divide-y divide-[var(--line-subtle)]">
                    {quotes.map((quote) => (
                      <li key={quote.id}>
                        <Link
                          href={`/quotes/${quote.id}`}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--text-strong)]">
                              {quote.title}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">
                              {quote.number} · {formatDate(quote.issue_date)}
                            </span>
                          </span>
                          <span className="shrink-0 tabular text-sm font-medium">
                            {formatMoney(quote.total_cents)}
                          </span>
                          <Badge tone={quoteStatus(quote.status).tone}>
                            {quoteStatus(quote.status).label}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Invoices"
                  action={
                    session.can('invoices.edit') ? (
                      <ButtonLink href={`/invoices/new?job=${job.id}`} variant="secondary" size="sm">
                        New invoice
                      </ButtonLink>
                    ) : null
                  }
                />
                {invoices.length === 0 ? (
                  <EmptyState icon={<Icon path={icons.invoices} size={20} />} title="Not invoiced yet" />
                ) : (
                  <ul className="divide-y divide-[var(--line-subtle)]">
                    {invoices.map((invoice) => (
                      <li key={invoice.id}>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-[var(--text-strong)]">
                              {invoice.number}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">
                              {formatDate(invoice.issue_date)}
                              {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 tabular text-sm font-medium">
                            {formatMoney(invoice.total_cents)}
                          </span>
                          <Badge tone={invoiceStatus(invoice.status).tone}>
                            {invoiceStatus(invoice.status).label}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : null}

          {/* Reports */}
          <Card>
            <CardHeader
              title="Reports"
              action={
                session.can('reports.edit') ? (
                  <ButtonLink href={`/reports/new?job=${job.id}`} variant="secondary" size="sm">
                    New report
                  </ButtonLink>
                ) : null
              }
            />
            {reports.length === 0 ? (
              <EmptyState icon={<Icon path={icons.reports} size={20} />} title="No reports filed" />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/reports/${report.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--text-strong)]">
                          {report.title}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {report.number} · {formatDate(report.report_date)}
                        </span>
                      </span>
                      <Badge tone={reportStatus(report.status).tone}>
                        {reportStatus(report.status).label}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Work logs */}
          <Card>
            <CardHeader
              title="Daily work log"
              description={totalMinutes > 0 ? `${formatMinutes(totalMinutes)} of labour recorded` : undefined}
              action={
                session.can('worklogs.edit') ? (
                  <ButtonLink href={`/timesheets/new?job=${job.id}`} variant="secondary" size="sm">
                    Log a shift
                  </ButtonLink>
                ) : null
              }
            />
            {worklogs.length === 0 ? (
              <EmptyState icon={<Icon path={icons.clock} size={20} />} title="No hours logged" />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {worklogs.map((log) => (
                  <li key={log.id}>
                    <Link
                      href={`/timesheets/${log.id}`}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--text-strong)]">
                          {formatDate(log.work_date)}
                        </span>
                        {log.work_completed ? (
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--text-muted)]">
                            {log.work_completed}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right text-xs text-[var(--text-muted)]">
                        <span className="block tabular font-medium text-[var(--text-strong)]">
                          {formatMinutes(log.total_minutes)}
                        </span>
                        {log.worker_count > 1 ? `× ${log.worker_count} workers` : '1 worker'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {showsMoney && expenses.length > 0 ? (
            <Card>
              <CardHeader title="Expenses" />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--text-default)]">
                        {expense.description}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {expense.category} · {formatDate(expense.spent_on)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular text-sm font-medium">
                      {formatMoney(expense.amount_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <JobNotes
            jobId={job.id}
            notes={(notesResult.data ?? []).map((note) => ({
              ...note,
              author:
                (note.created_by ? noteAuthors.get(note.created_by)?.full_name : null) ?? 'Someone',
            }))}
            canEdit={session.can('jobs.edit')}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Job number', value: job.number },
                  {
                    label: 'Customer',
                    value: customer ? (
                      <Link href={`/customers/${customer.id}`} className="text-[var(--accent)] hover:underline">
                        {customer.company || customer.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Site', value: siteAddress ?? '—' },
                  { label: 'Start', value: job.start_date ? formatDate(job.start_date) : '—' },
                  {
                    label: 'Expected completion',
                    value: job.expected_completion_date
                      ? formatDate(job.expected_completion_date)
                      : '—',
                  },
                  ...(showsMoney
                    ? [
                        {
                          label: 'Budget',
                          value: job.budget_cents ? formatMoney(job.budget_cents) : '—',
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Crew" />
            <CardBody>
              {team.size === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Nobody assigned yet.</p>
              ) : (
                <ul className="space-y-2">
                  {[...team.values()].map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-[var(--text-default)]">
                        {member.full_name ?? member.email}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {member.role}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {documents.length > 0 ? (
            <Card>
              <CardHeader
                title="Documents"
                action={
                  <Link href={`/documents?job=${job.id}`} className="text-sm text-[var(--accent)] hover:underline">
                    All
                  </Link>
                }
              />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center gap-2.5 px-5 py-2.5">
                    <Icon path={icons.file} size={16} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0 flex-1 truncate text-sm">{document.file_name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <Timeline entries={activitiesResult.data ?? []} />
            </CardBody>
          </Card>

          {session.can('jobs.delete') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Remove this job</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  It stops appearing in lists. Quotes and invoices already raised against it
                  are untouched.
                </p>
                <form action={deleteJobAction} className="mt-4">
                  <input type="hidden" name="id" value={job.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${job.number}?`}
                    confirmBody={`${job.name} will no longer appear in the jobs list.`}
                    confirmLabel="Remove job"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove job
                  </ConfirmSubmit>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
