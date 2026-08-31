import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { ButtonLink, EmptyState, Icon, PageHeader, StatCard, icons } from '@/components/ui';
import { DataTable, Pagination } from '@/components/list';
import { formatDate, truncate } from '@/lib/format';
import { formatMinutes, minutesToDecimalHours } from '@/lib/calc';
import type { WorkLog } from '@/lib/database.types';

export const metadata = { title: 'Timesheets' };

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('worklogs.view');
  const params = await searchParams;
  const jobId = param(params, 'job');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();
  let query = supabase
    .from('work_logs')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (jobId) query = query.eq('job_id', jobId);

  const { data, count } = await query
    .order('work_date', { ascending: false })
    .range(from, to);

  const logs = (data ?? []) as WorkLog[];
  const jobs = await lookup('jobs', idsFrom(logs, (log) => log.job_id), 'id, number, name');

  // Totals across everything, not just this page.
  const { data: allLogs } = await supabase
    .from('work_logs')
    .select('total_minutes, worker_count, work_date')
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  const rows = allLogs ?? [];
  const crewMinutes = rows.reduce(
    (n, row) => n + row.total_minutes * Math.max(row.worker_count, 1),
    0
  );
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthMinutes = rows
    .filter((row) => row.work_date.startsWith(thisMonth))
    .reduce((n, row) => n + row.total_minutes * Math.max(row.worker_count, 1), 0);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  if (jobId) queryString.set('job', jobId);

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="Hours on site, worked out from start and finish times."
        actions={
          session.can('worklogs.edit') ? (
            <ButtonLink href="/timesheets/new">
              <Icon path={icons.plus} size={18} />
              Log hours
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Crew hours this month" value={formatMinutes(monthMinutes)} />
        <StatCard
          label="Crew hours all time"
          value={formatMinutes(crewMinutes)}
          hint={`${minutesToDecimalHours(crewMinutes)} decimal hours`}
        />
        <StatCard label="Shifts recorded" value={rows.length} />
      </div>

      <DataTable
        rows={logs}
        hrefFor={(log) => `/timesheets/${log.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.clock} size={20} />}
            title="No hours logged"
            description="Start time, finish time, break. The rest is worked out."
            action={
              session.can('worklogs.edit') ? (
                <ButtonLink href="/timesheets/new">Log the first shift</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'date',
            header: 'Date',
            render: (log) => <span>{formatDate(log.work_date)}</span>,
          },
          {
            key: 'job',
            header: 'Job',
            render: (log) => {
              const job = jobs.get(log.job_id);
              return <span className="text-sm">{job ? `${job.number} — ${job.name}` : '—'}</span>;
            },
          },
          {
            key: 'times',
            header: 'Times',
            secondary: true,
            render: (log) => (
              <span className="text-sm text-[var(--text-muted)]">
                {log.start_time && log.finish_time
                  ? `${log.start_time.slice(0, 5)}–${log.finish_time.slice(0, 5)}`
                  : '—'}
                {log.break_minutes > 0 ? ` · ${log.break_minutes}m break` : ''}
              </span>
            ),
          },
          {
            key: 'hours',
            header: 'Hours',
            align: 'right',
            render: (log) => (
              <span className="tabular text-sm font-medium">
                {formatMinutes(log.total_minutes)}
                {log.worker_count > 1 ? (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    × {log.worker_count} = {formatMinutes(log.total_minutes * log.worker_count)}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'work',
            header: 'Work completed',
            secondary: true,
            render: (log) => (
              <span className="text-sm text-[var(--text-muted)]">
                {truncate(log.work_completed, 60) || '—'}
              </span>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/timesheets" query={queryString} />
    </>
  );
}
