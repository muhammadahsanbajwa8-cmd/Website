import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, StatCard, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { INVOICE_STATUSES, invoiceStatus } from '@/lib/domain';
import type { Invoice, InvoiceStatus } from '@/lib/database.types';

export const metadata = { title: 'Invoices' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('invoices.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();

  // Bring the overdue flag up to date before the list is read.
  if (session.can('invoices.edit')) {
    await supabase.rpc('mark_overdue_invoices', { target: session.business.id });
  }

  let query = supabase
    .from('invoices')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as InvoiceStatus);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`number.ilike.${pattern},title.ilike.${pattern},notes.ilike.${pattern}`);
  }

  const { data, count } = await query.order('issue_date', { ascending: false }).range(from, to);
  const invoices = (data ?? []) as Invoice[];
  const customers = await lookup(
    'customers',
    idsFrom(invoices, (invoice) => invoice.customer_id),
    'id, name, company'
  );

  const { data: allRows } = await supabase
    .from('invoices')
    .select('total_cents, paid_cents, status, due_date')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .not('status', 'in', '("draft","cancelled")');

  const rows = allRows ?? [];
  const outstanding = rows
    .filter((row) => row.status !== 'paid')
    .reduce((n, row) => n + (row.total_cents - row.paid_cents), 0);
  const overdue = rows
    .filter((row) => row.status !== 'paid' && row.due_date != null && row.due_date < today)
    .reduce((n, row) => n + (row.total_cents - row.paid_cents), 0);
  const received = rows.reduce((n, row) => n + row.paid_cents, 0);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="What has been billed, what has been paid, and what is late."
        actions={
          session.can('invoices.edit') ? (
            <ButtonLink href="/invoices/new">
              <Icon path={icons.plus} size={18} />
              New invoice
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Outstanding" value={formatMoney(outstanding)} />
        <StatCard
          label="Overdue"
          value={formatMoney(overdue)}
          tone={overdue > 0 ? 'danger' : 'neutral'}
        />
        <StatCard label="Received" value={formatMoney(received)} tone="success" />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search invoice number or description…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={INVOICE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={invoices}
        hrefFor={(invoice) => `/invoices/${invoice.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.invoices} size={20} />}
            title={search || status ? 'No invoices match that' : 'No invoices yet'}
            description="Raise one from an accepted quote, or start from scratch."
            action={
              !search && !status && session.can('invoices.edit') ? (
                <ButtonLink href="/invoices/new">Raise the first invoice</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'number',
            header: 'Invoice',
            render: (invoice) => (
              <span>
                <span className="block">{invoice.number}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {invoice.title || formatDate(invoice.issue_date)}
                </span>
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (invoice) => {
              const customer = customers.get(invoice.customer_id);
              return <span className="text-sm">{customer ? customer.company || customer.name : '—'}</span>;
            },
          },
          {
            key: 'due',
            header: 'Due',
            render: (invoice) => {
              if (!invoice.due_date) return <span className="text-sm text-[var(--text-muted)]">—</span>;
              const late =
                invoice.due_date < today &&
                !['paid', 'draft', 'cancelled'].includes(invoice.status);
              return (
                <span className={late ? 'text-sm font-medium text-[var(--bad)]' : 'text-sm'}>
                  {formatDate(invoice.due_date)}
                </span>
              );
            },
          },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (invoice) => (
              <span className="tabular text-sm font-medium">{formatMoney(invoice.total_cents)}</span>
            ),
          },
          {
            key: 'due_amount',
            header: 'Outstanding',
            align: 'right',
            render: (invoice) => {
              const amount = Math.max(invoice.total_cents - invoice.paid_cents, 0);
              return (
                <span
                  className={
                    amount > 0 ? 'tabular text-sm font-medium' : 'tabular text-sm text-[var(--text-muted)]'
                  }
                >
                  {amount > 0 ? formatMoney(amount) : 'Paid'}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (invoice) => (
              <Badge tone={invoiceStatus(invoice.status).tone}>
                {invoiceStatus(invoice.status).label}
              </Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/invoices" query={queryString} />
    </>
  );
}
