import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { likePattern, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, StatCard, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate, formatMoney, formatPhone, todayInAustralia } from '@/lib/format';
import { LEAD_STATUSES, leadStatus } from '@/lib/domain';
import type { Lead, LeadStatus } from '@/lib/database.types';

export const metadata = { title: 'Leads' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('leads.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();
  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as LeadStatus);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(
      `name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},description.ilike.${pattern},site_address.ilike.${pattern}`
    );
  }

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to);
  const leads = (data ?? []) as Lead[];

  const { data: openRows } = await supabase
    .from('leads')
    .select('estimated_value_cents, status, next_follow_up_at')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .in('status', ['new', 'contacted', 'qualified', 'quoted']);

  const open = openRows ?? [];
  const dueFollowUps = open.filter(
    (lead) => lead.next_follow_up_at != null && lead.next_follow_up_at <= today
  ).length;

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Enquiries before they become jobs. Nothing falls through a gap in a notebook."
        actions={
          session.can('leads.edit') ? (
            <ButtonLink href="/leads/new">
              <Icon path={icons.plus} size={18} />
              New lead
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open leads" value={open.length} />
        <StatCard
          label="Pipeline value"
          value={formatMoney(open.reduce((n, l) => n + (l.estimated_value_cents ?? 0), 0))}
        />
        <StatCard
          label="Follow-ups due"
          value={dueFollowUps}
          tone={dueFollowUps > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search leads…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={LEAD_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={leads}
        hrefFor={(lead) => `/leads/${lead.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.leads} size={20} />}
            title={search || status ? 'No leads match that' : 'No leads yet'}
            description="Write down the enquiry when the phone rings; turn it into a job when it comes off."
            action={
              session.can('leads.edit') ? <ButtonLink href="/leads/new">Add a lead</ButtonLink> : null
            }
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Lead',
            render: (lead) => (
              <span>
                <span className="block">{lead.name}</span>
                {lead.company ? (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    {lead.company}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'contact',
            header: 'Contact',
            render: (lead) => (
              <span className="text-sm">
                {lead.phone ? formatPhone(lead.phone) : lead.email || '—'}
              </span>
            ),
          },
          {
            key: 'source',
            header: 'Source',
            secondary: true,
            render: (lead) => (
              <span className="text-sm text-[var(--text-muted)]">{lead.source || '—'}</span>
            ),
          },
          {
            key: 'value',
            header: 'Est. value',
            align: 'right',
            render: (lead) => (
              <span className="tabular text-sm">
                {lead.estimated_value_cents ? formatMoney(lead.estimated_value_cents) : '—'}
              </span>
            ),
          },
          {
            key: 'followup',
            header: 'Follow up',
            render: (lead) => {
              if (!lead.next_follow_up_at) {
                return <span className="text-sm text-[var(--text-muted)]">—</span>;
              }
              const due = lead.next_follow_up_at <= today;
              return (
                <span className={due ? 'text-sm font-medium text-[var(--warn)]' : 'text-sm'}>
                  {formatDate(lead.next_follow_up_at)}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (lead) => (
              <Badge tone={leadStatus(lead.status).tone}>{leadStatus(lead.status).label}</Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/leads" query={queryString} />
    </>
  );
}
