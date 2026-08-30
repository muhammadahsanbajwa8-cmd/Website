import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { likePattern, pageFromParams, pageInfo, param } from '@/lib/query';
import { ButtonLink, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatAddress, formatPhone } from '@/lib/format';
import type { Customer } from '@/lib/database.types';

export const metadata = { title: 'Customers' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireBusiness();
  const params = await searchParams;
  const search = param(params, 'q');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();
  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (search) {
    const pattern = likePattern(search);
    query = query.or(
      `name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},suburb.ilike.${pattern}`
    );
  }

  const { data, count } = await query.order('name', { ascending: true }).range(from, to);
  const customers = (data ?? []) as Customer[];
  const info = pageInfo(page, pageSize, count ?? 0);

  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you work for, and everything you have done for them."
        actions={
          session.can('customers.edit') ? (
            <ButtonLink href="/customers/new">
              <Icon path={icons.plus} size={18} />
              New customer
            </ButtonLink>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search name, company, email, phone or suburb…" />
      </FilterBar>

      <DataTable
        rows={customers}
        hrefFor={(customer) => `/customers/${customer.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.customers} size={20} />}
            title={search ? 'No customers match that' : 'No customers yet'}
            description={
              search
                ? 'Try a shorter search, or clear it to see everyone.'
                : 'Add the first one and their jobs, quotes and invoices will collect against it.'
            }
            action={
              !search && session.can('customers.edit') ? (
                <ButtonLink href="/customers/new">Add a customer</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Customer',
            render: (customer) => (
              <span>
                <span className="block">{customer.name}</span>
                {customer.company ? (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    {customer.company}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'contact',
            header: 'Contact',
            render: (customer) => (
              <span className="text-sm">
                {customer.email ? <span className="block truncate">{customer.email}</span> : null}
                {customer.phone ? (
                  <span className="block text-[var(--text-muted)]">
                    {formatPhone(customer.phone)}
                  </span>
                ) : null}
                {!customer.email && !customer.phone ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'address',
            header: 'Address',
            render: (customer) => (
              <span className="text-sm text-[var(--text-muted)]">
                {formatAddress(customer) || '—'}
              </span>
            ),
          },
          {
            key: 'person',
            header: 'Contact person',
            secondary: true,
            render: (customer) => (
              <span className="text-sm text-[var(--text-muted)]">
                {customer.contact_person || '—'}
              </span>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/customers" query={queryString} />
    </>
  );
}
