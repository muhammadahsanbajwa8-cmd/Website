import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { deleteCustomerAction } from '../actions';
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
  StatCard,
  icons,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { Timeline } from '@/components/list';
import {
  formatAbn,
  formatAddress,
  formatDate,
  formatMoney,
  formatPhone,
  todayInAustralia,
} from '@/lib/format';
import { invoiceStatus, jobStatus, quoteStatus } from '@/lib/domain';
import { ContactsPanel } from './contacts';
import type { Customer } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireBusiness();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.name ?? 'Customer' };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireBusiness();
  const { id } = await params;
  const supabase = await createClient();
  const today = todayInAustralia();
  const showsMoney = session.can('quotes.view');

  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const customer = data as Customer;

  const [jobsResult, contactsResult, activitiesResult, documentsResult] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, number, name, status, start_date, expected_completion_date')
      .eq('business_id', session.business.id)
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('contacts')
      .select('*')
      .eq('business_id', session.business.id)
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('name'),
    supabase
      .from('activities')
      .select('id, summary, actor_label, created_at')
      .eq('business_id', session.business.id)
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('job_documents')
      .select('id, file_name, mime_type, size_bytes, created_at, category')
      .eq('business_id', session.business.id)
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const [quotesResult, invoicesResult] = showsMoney
    ? await Promise.all([
        supabase
          .from('quotes')
          .select('id, number, title, status, total_cents, issue_date, expiry_date')
          .eq('business_id', session.business.id)
          .eq('customer_id', id)
          .is('deleted_at', null)
          .order('issue_date', { ascending: false })
          .limit(20),
        supabase
          .from('invoices')
          .select('id, number, status, total_cents, paid_cents, issue_date, due_date')
          .eq('business_id', session.business.id)
          .eq('customer_id', id)
          .is('deleted_at', null)
          .order('issue_date', { ascending: false })
          .limit(20),
      ])
    : [{ data: [] }, { data: [] }];

  const jobs = jobsResult.data ?? [];
  const quotes = quotesResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const documents = documentsResult.data ?? [];

  const invoicedTotal = invoices.reduce((n, invoice) => n + invoice.total_cents, 0);
  const paidTotal = invoices.reduce((n, invoice) => n + invoice.paid_cents, 0);
  const outstanding = invoices
    .filter((invoice) => !['draft', 'cancelled', 'paid'].includes(invoice.status))
    .reduce((n, invoice) => n + (invoice.total_cents - invoice.paid_cents), 0);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.company ?? undefined}
        breadcrumb={
          <Link href="/customers" className="hover:text-[var(--text-strong)]">
            Customers
          </Link>
        }
        actions={
          <>
            {session.can('jobs.edit') ? (
              <ButtonLink href={`/jobs/new?customer=${customer.id}`} variant="secondary">
                <Icon path={icons.jobs} size={16} />
                New job
              </ButtonLink>
            ) : null}
            {session.can('quotes.edit') ? (
              <ButtonLink href={`/quotes/new?customer=${customer.id}`} variant="secondary">
                <Icon path={icons.quotes} size={16} />
                New quote
              </ButtonLink>
            ) : null}
            {session.can('customers.edit') ? (
              <ButtonLink href={`/customers/${customer.id}/edit`}>
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {showsMoney ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Invoiced" value={formatMoney(invoicedTotal)} hint="All time" />
          <StatCard label="Paid" value={formatMoney(paidTotal)} tone="success" />
          <StatCard
            label="Outstanding"
            value={formatMoney(outstanding)}
            tone={outstanding > 0 ? 'warning' : 'neutral'}
          />
          <StatCard label="Jobs" value={jobs.length} hint={`${quotes.length} quotes`} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {/* Jobs */}
          <Card>
            <CardHeader
              title="Jobs"
              description={`${jobs.length} recorded`}
              action={
                session.can('jobs.edit') ? (
                  <ButtonLink href={`/jobs/new?customer=${customer.id}`} variant="secondary" size="sm">
                    New job
                  </ButtonLink>
                ) : null
              }
            />
            {jobs.length === 0 ? (
              <EmptyState
                icon={<Icon path={icons.jobs} size={20} />}
                title="No jobs yet"
                description="Create one and it will appear here with its quotes, photos and invoices."
              />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                          {job.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {job.number}
                          {job.start_date ? ` · started ${formatDate(job.start_date)}` : ''}
                        </span>
                      </span>
                      <Badge tone={jobStatus(job.status).tone}>{jobStatus(job.status).label}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {showsMoney ? (
            <>
              {/* Quotes */}
              <Card>
                <CardHeader title="Quotes" description={`${quotes.length} recorded`} />
                {quotes.length === 0 ? (
                  <EmptyState
                    icon={<Icon path={icons.quotes} size={20} />}
                    title="No quotes yet"
                  />
                ) : (
                  <ul className="divide-y divide-[var(--line-subtle)]">
                    {quotes.map((quote) => (
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
                              {quote.number} · {formatDate(quote.issue_date)}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold tabular text-[var(--text-strong)]">
                              {formatMoney(quote.total_cents)}
                            </span>
                            <Badge tone={quoteStatus(quote.status).tone}>
                              {quoteStatus(quote.status).label}
                            </Badge>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Invoices */}
              <Card>
                <CardHeader title="Invoices" description={`${invoices.length} recorded`} />
                {invoices.length === 0 ? (
                  <EmptyState
                    icon={<Icon path={icons.invoices} size={20} />}
                    title="No invoices yet"
                  />
                ) : (
                  <ul className="divide-y divide-[var(--line-subtle)]">
                    {invoices.map((invoice) => {
                      const overdue =
                        invoice.due_date != null &&
                        invoice.due_date < today &&
                        !['paid', 'draft', 'cancelled'].includes(invoice.status);
                      return (
                        <li key={invoice.id}>
                          <Link
                            href={`/invoices/${invoice.id}`}
                            className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-sunken)]"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-[var(--text-strong)]">
                                {invoice.number}
                              </span>
                              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                                Issued {formatDate(invoice.issue_date)}
                                {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-sm font-semibold tabular text-[var(--text-strong)]">
                                {formatMoney(invoice.total_cents)}
                              </span>
                              <Badge tone={overdue ? 'danger' : invoiceStatus(invoice.status).tone}>
                                {overdue ? 'Overdue' : invoiceStatus(invoice.status).label}
                              </Badge>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </>
          ) : null}

          {/* Documents */}
          <Card>
            <CardHeader
              title="Documents"
              action={
                <Link href={`/documents?customer=${customer.id}`} className="text-sm text-[var(--accent)] hover:underline">
                  All documents
                </Link>
              }
            />
            {documents.length === 0 ? (
              <EmptyState
                icon={<Icon path={icons.documents} size={20} />}
                title="Nothing filed against this customer"
              />
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center gap-3 px-5 py-3">
                    <Icon path={icons.file} size={18} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-default)]">
                      {document.file_name}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {formatDate(document.created_at.slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Email', value: customer.email || '—' },
                  { label: 'Phone', value: formatPhone(customer.phone) || '—' },
                  { label: 'Contact person', value: customer.contact_person || '—' },
                  { label: 'ABN', value: formatAbn(customer.abn) || '—' },
                  { label: 'Address', value: formatAddress(customer) || '—' },
                  { label: 'Added', value: formatDate(customer.created_at.slice(0, 10)) },
                ]}
              />
              {customer.notes ? (
                <div className="mt-5 rounded-[0.625rem] bg-[var(--surface-sunken)] p-3.5">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Notes
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                    {customer.notes}
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <ContactsPanel
            customerId={customer.id}
            contacts={contactsResult.data ?? []}
            canEdit={session.can('customers.edit')}
          />

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <Timeline entries={activitiesResult.data ?? []} />
            </CardBody>
          </Card>

          {session.can('customers.delete') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">
                  Remove this customer
                </h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  They stop appearing in lists and pickers. Their jobs, quotes and invoices
                  keep their history.
                </p>
                <form action={deleteCustomerAction} className="mt-4">
                  <input type="hidden" name="id" value={customer.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${customer.name}?`}
                    confirmBody="Their records stay, but they will no longer appear when you create a job or a quote."
                    confirmLabel="Remove customer"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove customer
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
