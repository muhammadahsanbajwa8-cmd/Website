import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, StatCard, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { QUOTE_STATUSES, quoteStatus } from '@/lib/domain';
import type { Quote, QuoteStatus } from '@/lib/database.types';

export const metadata = { title: 'Quotes' };

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('quotes.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();
  let query = supabase
    .from('quotes')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as QuoteStatus);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`title.ilike.${pattern},number.ilike.${pattern},scope_of_work.ilike.${pattern}`);
  }

  const { data, count } = await query.order('issue_date', { ascending: false }).range(from, to);
  const quotes = (data ?? []) as Quote[];
  const customers = await lookup(
    'customers',
    idsFrom(quotes, (quote) => quote.customer_id),
    'id, name, company'
  );

  // Totals across every open quote, not just this page.
  const { data: openRows } = await supabase
    .from('quotes')
    .select('total_cents, status')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .in('status', ['sent', 'viewed', 'changes_requested', 'accepted']);

  const open = (openRows ?? []).filter((q) => q.status !== 'accepted');
  const accepted = (openRows ?? []).filter((q) => q.status === 'accepted');

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);

  return (
    <>
      <PageHeader
        title="Quotes"
        description="What you have priced, what the customer has seen, and what they said."
        actions={
          session.can('quotes.edit') ? (
            <ButtonLink href="/quotes/new">
              <Icon path={icons.plus} size={18} />
              New quote
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Out with customers"
          value={formatMoney(open.reduce((n, q) => n + q.total_cents, 0))}
          hint={`${open.length} awaiting a decision`}
        />
        <StatCard
          label="Accepted"
          value={formatMoney(accepted.reduce((n, q) => n + q.total_cents, 0))}
          tone="success"
          hint={`${accepted.length} won`}
        />
        <StatCard label="Total quotes" value={count ?? 0} />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search quote title, number or scope…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={QUOTE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={quotes}
        hrefFor={(quote) => `/quotes/${quote.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.quotes} size={20} />}
            title={search || status ? 'No quotes match that' : 'No quotes yet'}
            description="A quote gets a PDF and a private link the customer can accept from."
            action={
              !search && !status && session.can('quotes.edit') ? (
                <ButtonLink href="/quotes/new">Write the first quote</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'quote',
            header: 'Quote',
            render: (quote) => (
              <span>
                <span className="block">{quote.title}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {quote.number}
                  {quote.version > 1 ? ` v${quote.version}` : ''} · {formatDate(quote.issue_date)}
                </span>
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (quote) => {
              const customer = customers.get(quote.customer_id);
              return <span className="text-sm">{customer ? customer.company || customer.name : '—'}</span>;
            },
          },
          {
            key: 'expiry',
            header: 'Valid until',
            secondary: true,
            render: (quote) => {
              if (!quote.expiry_date) return <span className="text-sm text-[var(--text-muted)]">—</span>;
              const expired =
                quote.expiry_date < today &&
                ['sent', 'viewed', 'changes_requested'].includes(quote.status);
              return (
                <span className={expired ? 'text-sm font-medium text-[var(--warn)]' : 'text-sm'}>
                  {formatDate(quote.expiry_date)}
                </span>
              );
            },
          },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (quote) => (
              <span className="tabular text-sm font-medium">{formatMoney(quote.total_cents)}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (quote) => (
              <Badge tone={quoteStatus(quote.status).tone}>{quoteStatus(quote.status).label}</Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/quotes" query={queryString} />
    </>
  );
}
