import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer, payload } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateLong, formatMoney } from '@/lib/format';
import { bookingWord, billWord, siteLine, type PortalJobDetail } from '@/lib/portal';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { MessageForm } from '../../messages/form';
import type { Invoice, Report } from '@/lib/database.types';

export const metadata = { title: 'Booking' };

/**
 * One booking, end to end.
 *
 * The date, where, who is coming, what was written up, and what it came to.
 * Everything on this page is read through `portal_job()` or a policy the
 * customer already satisfies — there is no id in the URL that opens anything
 * belonging to anyone else.
 */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCustomer();
  const { id } = await params;
  const supabase = await createClient();

  const { data: jobData } = await supabase.rpc('portal_job', { p_job: id });
  const job = payload<PortalJobDetail | null>(jobData, null);
  if (!job || job.business_id !== session.link.businessId) notFound();

  const [reportsResult, invoicesResult, quotesResult] = await Promise.all([
    supabase
      .from('reports')
      .select('id, number, title, report_date, sent_at')
      .eq('business_id', job.business_id)
      .eq('job_id', job.id)
      .is('deleted_at', null)
      .not('sent_at', 'is', null)
      .order('report_date', { ascending: false }),
    supabase
      .from('invoices')
      .select('id, number, title, status, total_cents, paid_cents, due_date')
      .eq('business_id', job.business_id)
      .eq('job_id', job.id)
      .is('deleted_at', null)
      .neq('status', 'draft')
      .order('issue_date', { ascending: false }),
    supabase
      .from('quotes')
      .select('id, number, title, status, total_cents')
      .eq('business_id', job.business_id)
      .eq('job_id', job.id)
      .is('deleted_at', null)
      .neq('status', 'draft')
      .order('issue_date', { ascending: false }),
  ]);

  const reports = (reportsResult.data ?? []) as Pick<
    Report,
    'id' | 'number' | 'title' | 'report_date' | 'sent_at'
  >[];
  const invoices = (invoicesResult.data ?? []) as Pick<
    Invoice,
    'id' | 'number' | 'title' | 'status' | 'total_cents' | 'paid_cents' | 'due_date'
  >[];
  const quotes = (quotesResult.data ?? []) as {
    id: string;
    number: string;
    title: string;
    status: string;
    total_cents: number;
  }[];

  const said = bookingWord(job.status);
  const address = siteLine(job);

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/portal/bookings" className="hover:text-[var(--accent)]">
            ← Bookings
          </Link>
        }
        title={job.name}
        description={`${job.number} with ${session.link.businessName}`}
        actions={<Badge tone={said.tone}>{said.label}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="The work" />
            <CardBody className="space-y-5">
              {job.description ? (
                <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                  {job.description}
                </p>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  No description was added to this booking.
                </p>
              )}

              <DescriptionList
                items={[
                  {
                    label: 'Starts',
                    value: job.start_date ? formatDateLong(job.start_date) : 'To be confirmed',
                  },
                  {
                    label: 'Expected to finish',
                    value: job.expected_completion_date
                      ? formatDateLong(job.expected_completion_date)
                      : '—',
                  },
                  { label: 'Where', value: address || 'At your address on file' },
                  {
                    label: 'Who is coming',
                    value: job.assigned.length > 0 ? job.assigned.join(', ') : 'To be assigned',
                  },
                ]}
              />

              {said.note ? (
                <p className="rounded-[0.625rem] bg-[var(--surface-sunken)] px-3.5 py-3 text-sm text-[var(--text-muted)]">
                  {said.note}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Reports"
              description="Written up after the visit."
              action={
                reports.length > 0 ? (
                  <ButtonLink href="/portal/reports" size="sm" variant="secondary">
                    All reports
                  </ButtonLink>
                ) : null
              }
            />
            {reports.length === 0 ? (
              <CardBody>
                <p className="text-sm text-[var(--text-muted)]">
                  Nothing yet. A report appears here the moment it is sent to you.
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/portal/reports/${report.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <Icon path={icons.reports} size={17} className="text-[var(--text-muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-strong)]">
                          {report.title}
                        </div>
                        <div className="text-sm text-[var(--text-muted)]">
                          {report.number} · {formatDate(report.report_date)}
                        </div>
                      </div>
                      <Icon
                        path={icons.chevronRight}
                        size={16}
                        className="text-[var(--text-muted)]"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={`Message ${session.link.businessName}`} description="About this job." />
            <CardBody>
              <MessageForm jobId={job.id} placeholder={`A question about ${job.name}…`} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Money" />
            {invoices.length === 0 && quotes.length === 0 ? (
              <CardBody>
                <p className="text-sm text-[var(--text-muted)]">
                  Nothing has been billed for this job yet.
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {quotes.map((quote) => (
                  <li key={quote.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          Quote
                        </div>
                        <div className="truncate font-medium text-[var(--text-strong)]">
                          {quote.number}
                        </div>
                      </div>
                      <div className="text-right tabular-nums font-medium text-[var(--text-strong)]">
                        {formatMoney(quote.total_cents)}
                      </div>
                    </div>
                  </li>
                ))}
                {invoices.map((invoice) => {
                  const word = billWord(invoice.status);
                  return (
                    <li key={invoice.id} className="px-5 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                            Invoice
                          </div>
                          <div className="truncate font-medium text-[var(--text-strong)]">
                            {invoice.number}
                          </div>
                          <Badge tone={word.tone} className="mt-1">
                            {word.label}
                          </Badge>
                        </div>
                        <div className="text-right tabular-nums font-medium text-[var(--text-strong)]">
                          {formatMoney(invoice.total_cents)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <CardBody className="border-t border-[var(--line-subtle)]">
              <ButtonLink href="/portal/payments" variant="secondary" className="w-full">
                Go to payments
              </ButtonLink>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
