import Link from 'next/link';
import { requireCustomer, payload } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateLong, formatMoney, formatRelative } from '@/lib/format';
import {
  bookingWord,
  billWord,
  isUpcoming,
  siteLine,
  type PortalJob,
  type PortalRequest,
  type PortalSummary,
} from '@/lib/portal';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  StatCard,
  icons,
} from '@/components/ui';
import type { Invoice, Report } from '@/lib/database.types';

export const metadata = { title: 'Home' };

const EMPTY_SUMMARY: PortalSummary = {
  open_requests: 0,
  active_jobs: 0,
  completed_jobs: 0,
  next_visit: null,
  amount_due_cents: 0,
  overdue_cents: 0,
  paid_cents: 0,
  reports: 0,
  open_quotes: 0,
  unread_messages: 0,
};

/**
 * Home.
 *
 * The four questions a customer actually has, in the order they have them:
 * when is someone coming, what do I owe, what have you written about my job,
 * and where do I ask for something else. Everything on this page is a link to
 * the page that answers it properly.
 */
export default async function PortalHome() {
  const session = await requireCustomer();
  const { link } = session;
  const supabase = await createClient();

  const [{ data: summaryData }, { data: jobsData }, { data: requestsData }, reportsResult, invoicesResult] =
    await Promise.all([
      supabase.rpc('portal_summary', {
        p_business: link.businessId,
        p_customer: link.customerId,
      }),
      supabase.rpc('portal_jobs', { p_business: link.businessId }),
      supabase.rpc('portal_requests', { p_business: link.businessId }),
      supabase
        .from('reports')
        .select('id, number, title, report_date, sent_at')
        .eq('business_id', link.businessId)
        .eq('customer_id', link.customerId)
        .is('deleted_at', null)
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(3),
      supabase
        .from('invoices')
        .select('id, number, title, status, total_cents, paid_cents, due_date')
        .eq('business_id', link.businessId)
        .eq('customer_id', link.customerId)
        .is('deleted_at', null)
        .in('status', ['sent', 'viewed', 'partially_paid', 'overdue'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(3),
    ]);

  const summary = payload<PortalSummary>(summaryData, EMPTY_SUMMARY);
  const jobs = payload<PortalJob[]>(jobsData, []);
  const requests = payload<PortalRequest[]>(requestsData, []);
  const reports = (reportsResult.data ?? []) as Pick<
    Report,
    'id' | 'number' | 'title' | 'report_date' | 'sent_at'
  >[];
  const invoices = (invoicesResult.data ?? []) as Pick<
    Invoice,
    'id' | 'number' | 'title' | 'status' | 'total_cents' | 'paid_cents' | 'due_date'
  >[];

  const upcoming = jobs.filter(isUpcoming).slice(0, 3);
  const openRequests = requests.filter((request) => !['won', 'lost'].includes(request.status));
  const firstName = link.customerName.split(/\s+/)[0] ?? link.customerName;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-[1.75rem]">
          Hello {firstName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Everything {link.businessName} has for you, in one place.
        </p>
      </div>

      {/* What is happening, in four numbers. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bookings"
          value={summary.active_jobs}
          hint={summary.next_visit ? `Next: ${formatDate(summary.next_visit.start_date)}` : 'Nothing booked'}
          icon={<Icon path={icons.calendar} size={18} />}
          href="/portal/bookings"
        />
        <StatCard
          label="To pay"
          value={formatMoney(summary.amount_due_cents)}
          hint={summary.overdue_cents > 0 ? `${formatMoney(summary.overdue_cents)} overdue` : 'Nothing overdue'}
          tone={summary.overdue_cents > 0 ? 'danger' : summary.amount_due_cents > 0 ? 'warning' : 'neutral'}
          icon={<Icon path={icons.money} size={18} />}
          href="/portal/payments"
        />
        <StatCard
          label="Reports"
          value={summary.reports}
          hint="Written up for your job"
          icon={<Icon path={icons.reports} size={18} />}
          href="/portal/reports"
        />
        <StatCard
          label="Requests open"
          value={summary.open_requests}
          hint={summary.open_quotes > 0 ? `${summary.open_quotes} price waiting on you` : 'Ask for work any time'}
          icon={<Icon path={icons.leads} size={18} />}
          href="/portal/bookings"
        />
      </div>

      {/* The one thing most worth saying. */}
      {summary.next_visit ? (
        <Card className="mb-5 border-[var(--accent)]/25">
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Next visit
              </div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-strong)]">
                {formatDateLong(summary.next_visit.start_date)}
              </div>
              <div className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                {summary.next_visit.name} · {summary.next_visit.number}
              </div>
            </div>
            <ButtonLink href={`/portal/bookings/${summary.next_visit.id}`} variant="secondary">
              See the booking
            </ButtonLink>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your bookings"
            description="Work booked in or under way."
            action={
              <ButtonLink href="/portal/bookings/new" size="sm">
                <Icon path={icons.plus} size={16} />
                Ask for work
              </ButtonLink>
            }
          />
          {upcoming.length === 0 && openRequests.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Icon path={icons.calendar} size={22} />}
                title="Nothing booked in"
                description={`When ${link.businessName} schedules a visit it appears here, with the date and the address.`}
                action={
                  <ButtonLink href="/portal/bookings/new" size="sm">
                    Ask for work
                  </ButtonLink>
                }
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-[var(--line-subtle)]">
              {upcoming.map((job) => {
                const said = bookingWord(job.status);
                return (
                  <li key={job.id}>
                    <Link
                      href={`/portal/bookings/${job.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-strong)]">
                          {job.name}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                          {job.start_date ? formatDate(job.start_date) : 'Date to come'}
                          {siteLine(job) ? ` · ${siteLine(job)}` : ''}
                        </div>
                      </div>
                      <Badge tone={said.tone}>{said.label}</Badge>
                    </Link>
                  </li>
                );
              })}
              {openRequests.slice(0, 2).map((request) => (
                <li key={request.id} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[var(--text-strong)]">
                        {request.service_name ?? 'Work requested'}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                        Asked {formatRelative(request.created_at)}
                      </div>
                    </div>
                    <Badge tone="info">Requested</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="To pay"
            description="Invoices that are still open."
            action={
              <ButtonLink href="/portal/payments" size="sm" variant="secondary">
                All payments
              </ButtonLink>
            }
          />
          {invoices.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Icon path={icons.money} size={22} />}
                title="Nothing owing"
                description="You are all square. New invoices show up here the moment they are sent."
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-[var(--line-subtle)]">
              {invoices.map((invoice) => {
                const said = billWord(invoice.status);
                const outstanding = Math.max(invoice.total_cents - invoice.paid_cents, 0);
                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/portal/payments`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-strong)]">
                          {invoice.number}
                          {invoice.title ? ` · ${invoice.title}` : ''}
                        </div>
                        <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                          {invoice.due_date ? `Due ${formatDate(invoice.due_date)}` : 'No due date'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums text-[var(--text-strong)]">
                          {formatMoney(outstanding)}
                        </div>
                        <Badge tone={said.tone}>{said.label}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest reports"
            description="What was done, written up."
            action={
              <ButtonLink href="/portal/reports" size="sm" variant="secondary">
                All reports
              </ButtonLink>
            }
          />
          {reports.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Icon path={icons.reports} size={22} />}
                title="No reports yet"
                description="When a report is finished and sent to you, it lands here and stays."
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-[var(--line-subtle)]">
              {reports.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/portal/reports/${report.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[var(--text-strong)]">
                        {report.title}
                      </div>
                      <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                        {report.number} · {formatDate(report.report_date)}
                      </div>
                    </div>
                    <Icon path={icons.chevronRight} size={16} className="text-[var(--text-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Talk to ${link.businessName}`} description="However suits you." />
          <CardBody className="space-y-3">
            <ButtonLink href="/portal/messages" className="w-full">
              <Icon path={icons.emails} size={17} />
              Send a message
              {summary.unread_messages > 0 ? ` (${summary.unread_messages} new)` : ''}
            </ButtonLink>
            {link.businessPhone ? (
              <a
                href={`tel:${link.businessPhone.replace(/\s+/g, '')}`}
                className="flex items-center gap-2.5 rounded-[0.625rem] border border-[var(--line-default)] px-4 py-3 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon path={icons.phone} size={17} className="text-[var(--text-muted)]" />
                Call {link.businessPhone}
              </a>
            ) : null}
            {link.businessEmail ? (
              <a
                href={`mailto:${link.businessEmail}`}
                className="flex items-center gap-2.5 rounded-[0.625rem] border border-[var(--line-default)] px-4 py-3 text-sm text-[var(--text-default)] hover:bg-[var(--surface-sunken)]"
              >
                <Icon path={icons.send} size={17} className="text-[var(--text-muted)]" />
                Email {link.businessEmail}
              </a>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
