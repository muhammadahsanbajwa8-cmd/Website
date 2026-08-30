import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { group, idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatBasisPoints, formatDate, formatMoney } from '@/lib/format';
import { ESTIMATE_STATUSES, estimateStatus } from '@/lib/domain';
import { computeEstimateTotals } from '@/lib/calc';
import type { Estimate, EstimateStatus } from '@/lib/database.types';

export const metadata = { title: 'Estimates' };

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireBusiness();
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();
  let query = supabase
    .from('estimates')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as EstimateStatus);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`title.ilike.${pattern},number.ilike.${pattern},notes.ilike.${pattern}`);
  }

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to);
  const estimates = (data ?? []) as Estimate[];

  // One further query gets every line for the page, so each row can show its
  // real total and margin rather than a placeholder.
  const [items, customers] = await Promise.all([
    group('estimate_items', 'estimate_id', estimates.map((e) => e.id)),
    lookup('customers', idsFrom(estimates, (e) => e.customer_id), 'id, name, company'),
  ]);

  const totalsFor = (estimate: Estimate) =>
    computeEstimateTotals({
      items: (items.get(estimate.id) ?? []).map((item) => ({
        kind: item.kind,
        quantityMilli: item.quantity_milli,
        unitCostCents: item.unit_cost_cents,
        taxable: item.taxable,
      })),
      markupBasisPoints: estimate.markup_bp,
      contingencyBasisPoints: estimate.contingency_bp,
      gstApplies: estimate.gst_applies,
    });

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);

  return (
    <>
      <PageHeader
        title="Estimates"
        description="Price the work and see the margin before you commit to it."
        actions={
          session.can('estimates.edit') ? (
            <ButtonLink href="/estimates/new">
              <Icon path={icons.plus} size={18} />
              New estimate
            </ButtonLink>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search estimate title or number…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={ESTIMATE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={estimates}
        hrefFor={(estimate) => `/estimates/${estimate.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.estimates} size={20} />}
            title={search || status ? 'No estimates match that' : 'No estimates yet'}
            description="Add labour, materials, plant, travel and subbies, then a markup. The margin is worked out for you."
            action={
              !search && !status && session.can('estimates.edit') ? (
                <ButtonLink href="/estimates/new">Build the first estimate</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'title',
            header: 'Estimate',
            render: (estimate) => (
              <span>
                <span className="block">{estimate.title}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {estimate.number} · {formatDate(estimate.created_at.slice(0, 10))}
                </span>
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (estimate) => {
              const customer = estimate.customer_id ? customers.get(estimate.customer_id) : null;
              return <span className="text-sm">{customer ? customer.company || customer.name : '—'}</span>;
            },
          },
          {
            key: 'cost',
            header: 'Cost',
            align: 'right',
            secondary: true,
            render: (estimate) => (
              <span className="tabular text-sm text-[var(--text-muted)]">
                {formatMoney(totalsFor(estimate).estimatedCostCents)}
              </span>
            ),
          },
          {
            key: 'sell',
            header: 'Sell (ex GST)',
            align: 'right',
            render: (estimate) => (
              <span className="tabular text-sm font-medium">
                {formatMoney(totalsFor(estimate).subtotalCents)}
              </span>
            ),
          },
          {
            key: 'margin',
            header: 'Margin',
            align: 'right',
            render: (estimate) => {
              const totals = totalsFor(estimate);
              return (
                <span className="tabular text-sm">
                  <span className="block font-medium text-[var(--text-strong)]">
                    {formatMoney(totals.estimatedProfitCents)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatBasisPoints(totals.marginBasisPoints)}
                  </span>
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (estimate) => (
              <Badge tone={estimateStatus(estimate.status).tone}>
                {estimateStatus(estimate.status).label}
              </Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/estimates" query={queryString} />
    </>
  );
}
