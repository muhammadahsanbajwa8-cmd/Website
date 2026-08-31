import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { setTaskStatusAction } from './actions';
import { formatDate, todayInAustralia } from '@/lib/format';
import { TASK_PRIORITIES, TASK_STATUSES, taskPriority, taskStatus } from '@/lib/domain';
import type { JobTask, TaskPriority, TaskStatus } from '@/lib/database.types';

export const metadata = { title: 'Tasks' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('tasks.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const priority = param(params, 'priority');
  const due = param(params, 'due');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();
  let query = supabase
    .from('job_tasks')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status as TaskStatus);
  else query = query.in('status', ['open', 'in_progress']);

  if (priority) query = query.eq('priority', priority as TaskPriority);
  if (due === 'today') query = query.lte('due_date', today);
  if (due === 'overdue') query = query.lt('due_date', today);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { data, count } = await query
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  const tasks = (data ?? []) as JobTask[];
  const [jobs, assignees] = await Promise.all([
    lookup('jobs', idsFrom(tasks, (t) => t.job_id), 'id, number, name'),
    lookup('team_members', idsFrom(tasks, (t) => t.assigned_to), 'id, full_name, email'),
  ]);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  for (const [key, value] of [['q', search], ['status', status], ['priority', priority], ['due', due]] as const) {
    if (value) queryString.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          status ? undefined : 'Open and in-progress work. Filter by status to see everything.'
        }
        actions={
          session.can('tasks.edit') ? (
            <ButtonLink href="/tasks/new">
              <Icon path={icons.plus} size={18} />
              New task
            </ButtonLink>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search tasks…" />
        <FilterSelect
          paramName="status"
          label="Filter by status"
          allLabel="Open and in progress"
          options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <FilterSelect
          paramName="priority"
          label="Filter by priority"
          allLabel="Any priority"
          options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
        />
        <FilterSelect
          paramName="due"
          label="Filter by due date"
          allLabel="Any date"
          options={[
            { value: 'today', label: 'Due today or earlier' },
            { value: 'overdue', label: 'Overdue' },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={tasks}
        hrefFor={(task) => `/tasks/${task.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.check} size={20} />}
            title={search || status || priority || due ? 'Nothing matches that' : 'Nothing outstanding'}
            description="Tasks come from emails, reports, defects, phone calls and customer requests."
            action={
              session.can('tasks.edit') ? <ButtonLink href="/tasks/new">Add a task</ButtonLink> : null
            }
          />
        }
        columns={[
          {
            key: 'title',
            header: 'Task',
            render: (task) => (
              <span>
                <span className="block">{task.title}</span>
                {task.source !== 'manual' ? (
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    From {task.source.replace(/_/g, ' ')}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'job',
            header: 'Job',
            render: (task) => {
              const job = task.job_id ? jobs.get(task.job_id) : null;
              return <span className="text-sm">{job ? job.number : '—'}</span>;
            },
          },
          {
            key: 'assignee',
            header: 'Assigned',
            secondary: true,
            render: (task) => {
              const member = task.assigned_to ? assignees.get(task.assigned_to) : null;
              return (
                <span className="text-sm text-[var(--text-muted)]">
                  {member ? member.full_name ?? member.email : 'Nobody'}
                </span>
              );
            },
          },
          {
            key: 'due',
            header: 'Due',
            render: (task) => {
              if (!task.due_date) return <span className="text-sm text-[var(--text-muted)]">—</span>;
              const overdue =
                task.due_date < today && (task.status === 'open' || task.status === 'in_progress');
              return (
                <span className={overdue ? 'text-sm font-medium text-[var(--bad)]' : 'text-sm'}>
                  {formatDate(task.due_date)}
                </span>
              );
            },
          },
          {
            key: 'priority',
            header: 'Priority',
            render: (task) => (
              <Badge tone={taskPriority(task.priority).tone}>{taskPriority(task.priority).label}</Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (task) =>
              session.can('tasks.edit') && task.status !== 'verified' ? (
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={task.status === 'open' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'verified'}
                  />
                  <button
                    type="submit"
                    className="rounded-full border border-[var(--line-default)] px-2.5 py-0.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {task.status === 'open'
                      ? 'Start'
                      : task.status === 'in_progress'
                        ? 'Complete'
                        : 'Verify'}
                  </button>
                </form>
              ) : (
                <Badge tone={taskStatus(task.status).tone}>{taskStatus(task.status).label}</Badge>
              ),
          },
        ]}
      />

      <Pagination info={info} basePath="/tasks" query={queryString} />
    </>
  );
}
