import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { JOB_STATUSES, jobStatus } from '@/lib/domain';
import type { Job, JobStatus } from '@/lib/database.types';

export const metadata = { title: 'Jobs' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireBusiness();
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const customerId = param(params, 'customer');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();
  let query = supabase
    .from('jobs')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as JobStatus);
  if (customerId) query = query.eq('customer_id', customerId);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(
      `name.ilike.${pattern},number.ilike.${pattern},description.ilike.${pattern},site_address_line1.ilike.${pattern},site_suburb.ilike.${pattern}`
    );
  }

  const { data, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  const jobs = (data ?? []) as Job[];
  const customers = await lookup(
    'customers',
    idsFrom(jobs, (job) => job.customer_id),
    'id, name, company'
  );

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);
  if (customerId) queryString.set('customer', customerId);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every job, from first enquiry to paid."
        actions={
          session.can('jobs.edit') ? (
            <ButtonLink href="/jobs/new">
              <Icon path={icons.plus} size={18} />
              New job
            </ButtonLink>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search job name, number, site or description…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={JOB_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={jobs}
        hrefFor={(job) => `/jobs/${job.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.jobs} size={20} />}
            title={search || status ? 'No jobs match that' : 'No jobs yet'}
            description={
              search || status
                ? 'Clear the filters to see everything.'
                : 'A job holds the customer, the site, the quote, the photos, the hours and the invoice.'
            }
            action={
              !search && !status && session.can('jobs.edit') ? (
                <ButtonLink href="/jobs/new">Create the first job</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'job',
            header: 'Job',
            render: (job) => (
              <span>
                <span className="block">{job.name}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {job.number}
                </span>
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            render: (job) => {
              const customer = job.customer_id ? customers.get(job.customer_id) : null;
              return (
                <span className="text-sm">
                  {customer ? customer.company || customer.name : '—'}
                </span>
              );
            },
          },
          {
            key: 'site',
            header: 'Site',
            secondary: true,
            render: (job) => (
              <span className="text-sm text-[var(--text-muted)]">
                {[job.site_address_line1, job.site_suburb].filter(Boolean).join(', ') || '—'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (job) => (
              <Badge tone={jobStatus(job.status).tone}>{jobStatus(job.status).label}</Badge>
            ),
          },
          {
            key: 'due',
            header: 'Due',
            render: (job) => {
              if (!job.expected_completion_date) {
                return <span className="text-sm text-[var(--text-muted)]">—</span>;
              }
              const late =
                job.expected_completion_date < today &&
                !['completed', 'invoiced', 'paid', 'cancelled'].includes(job.status);
              return (
                <span className={late ? 'text-sm font-medium text-[var(--bad)]' : 'text-sm'}>
                  {formatDate(job.expected_completion_date)}
                </span>
              );
            },
          },
          ...(session.can('dashboard.financials')
            ? [
                {
                  key: 'budget',
                  header: 'Budget',
                  align: 'right' as const,
                  render: (job: Job) => (
                    <span className="tabular text-sm">
                      {job.budget_cents ? formatMoney(job.budget_cents) : '—'}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Pagination info={info} basePath="/jobs" query={queryString} />
    </>
  );
}
