import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate } from '@/lib/format';
import { REPORT_STATUSES, reportStatus } from '@/lib/domain';
import { truncate } from '@/lib/format';
import type { Report, ReportStatus } from '@/lib/database.types';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('reports.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const templateKey = param(params, 'template');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();

  const [templatesResult] = await Promise.all([
    supabase
      .from('report_templates')
      .select('key, name')
      .or(`business_id.is.null,business_id.eq.${session.business.id}`)
      .is('deleted_at', null)
      .order('name'),
  ]);

  let query = supabase
    .from('reports')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as ReportStatus);
  if (templateKey) query = query.eq('template_key', templateKey);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`title.ilike.${pattern},number.ilike.${pattern},summary.ilike.${pattern}`);
  }

  const { data, count } = await query
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  const reports = (data ?? []) as Report[];
  const jobs = await lookup(
    'jobs',
    idsFrom(reports, (report) => report.job_id),
    'id, number, name'
  );

  const templates = templatesResult.data ?? [];
  const templateNames = new Map(templates.map((t) => [t.key, t.name]));

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  if (status) queryString.set('status', status);
  if (templateKey) queryString.set('template', templateKey);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Daily site, progress, defect, safety, inspection, variation, patrol, service and handover."
        actions={
          session.can('reports.edit') ? (
            <ButtonLink href="/reports/new">
              <Icon path={icons.plus} size={18} />
              New report
            </ButtonLink>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search report title, number or summary…" />
        <FilterSelect
          paramName="template"
          label="Filter by template"
          allLabel="All templates"
          options={templates.map((t) => ({ value: t.key, label: t.name }))}
        />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="All statuses"
          options={REPORT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
      </FilterBar>

      <DataTable
        rows={reports}
        hrefFor={(report) => `/reports/${report.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.reports} size={20} />}
            title={search || status || templateKey ? 'No reports match that' : 'No reports yet'}
            description="Pick a template, fill it in from the phone, attach photos, and it exports as a PDF."
            action={
              !search && !status && !templateKey && session.can('reports.edit') ? (
                <ButtonLink href="/reports/new">File the first report</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'title',
            header: 'Report',
            render: (report) => (
              <span>
                <span className="block">{report.title}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {report.number} · {templateNames.get(report.template_key) ?? report.template_key}
                </span>
              </span>
            ),
          },
          {
            key: 'job',
            header: 'Job',
            render: (report) => {
              const job = report.job_id ? jobs.get(report.job_id) : null;
              return <span className="text-sm">{job ? job.number : '—'}</span>;
            },
          },
          {
            key: 'date',
            header: 'Date',
            render: (report) => <span className="text-sm">{formatDate(report.report_date)}</span>,
          },
          {
            key: 'summary',
            header: 'Summary',
            secondary: true,
            render: (report) => (
              <span className="text-sm text-[var(--text-muted)]">
                {truncate(report.summary, 70) || '—'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (report) => (
              <Badge tone={reportStatus(report.status).tone}>
                {reportStatus(report.status).label}
              </Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/reports" query={queryString} />
    </>
  );
}
