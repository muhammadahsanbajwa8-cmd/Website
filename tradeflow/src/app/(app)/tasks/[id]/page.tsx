import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { deleteTaskAction, setTaskStatusAction } from '../actions';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { formatDate, formatDateTime, todayInAustralia } from '@/lib/format';
import { TASK_STATUSES, taskPriority, taskStatus } from '@/lib/domain';
import type { JobTask } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('tasks.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('job_tasks')
    .select('title')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.title ?? 'Task' };
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('tasks.view');
  const { id } = await params;
  const supabase = await createClient();
  const today = todayInAustralia();

  const { data } = await supabase
    .from('job_tasks')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const task = data as JobTask;

  const [{ data: job }, { data: customer }, { data: assignee }, { data: email }] =
    await Promise.all([
      task.job_id
        ? supabase.from('jobs').select('id, number, name').eq('id', task.job_id).maybeSingle()
        : Promise.resolve({ data: null }),
      task.customer_id
        ? supabase
            .from('customers')
            .select('id, name, company')
            .eq('id', task.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      task.assigned_to
        ? supabase
            .from('team_members')
            .select('full_name, email')
            .eq('id', task.assigned_to)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      task.email_id
        ? supabase.from('emails').select('id, subject').eq('id', task.email_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const overdue =
    task.due_date != null &&
    task.due_date < today &&
    (task.status === 'open' || task.status === 'in_progress');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={task.title}
        breadcrumb={
          <Link href="/tasks" className="hover:text-[var(--text-strong)]">
            Tasks
          </Link>
        }
        actions={
          session.can('tasks.edit') ? (
            <ButtonLink href={`/tasks/${task.id}/edit`}>
              <Icon path={icons.edit} size={16} />
              Edit
            </ButtonLink>
          ) : null
        }
      />

      <div className="space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <Badge tone={overdue ? 'danger' : taskStatus(task.status).tone} dot>
              {overdue ? 'Overdue' : taskStatus(task.status).label}
            </Badge>
            <Badge tone={taskPriority(task.priority).tone}>
              {taskPriority(task.priority).label}
            </Badge>

            {session.can('tasks.edit') ? (
              <div className="ml-auto flex flex-wrap gap-2">
                {TASK_STATUSES.filter((s) => s.value !== task.status).map((s) => (
                  <form key={s.value} action={setTaskStatusAction}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value={s.value} />
                    <button
                      type="submit"
                      className="rounded-full border border-[var(--line-default)] px-3 py-1 text-xs font-medium text-[var(--text-default)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                    >
                      Mark {s.label.toLowerCase()}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {task.description ? (
          <Card>
            <CardHeader title="Detail" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                {task.description}
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: 'Due',
                  value: task.due_date ? formatDate(task.due_date) : 'No due date',
                },
                {
                  label: 'Assigned to',
                  value: assignee ? (assignee.full_name ?? assignee.email) : 'Nobody',
                },
                {
                  label: 'Job',
                  value: job ? (
                    <Link href={`/jobs/${job.id}`} className="text-[var(--accent)] hover:underline">
                      {job.number} — {job.name}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Customer',
                  value: customer ? (
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {customer.company || customer.name}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Source', value: task.source.replace(/_/g, ' ') },
                {
                  label: 'Came from',
                  value: email ? (
                    <Link href={`/emails/${email.id}`} className="text-[var(--accent)] hover:underline">
                      {email.subject ?? 'an email'}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Created', value: formatDateTime(task.created_at) },
                {
                  label: 'Completed',
                  value: task.completed_at ? formatDateTime(task.completed_at) : '—',
                },
              ]}
            />
          </CardBody>
        </Card>

        {session.can('tasks.edit') ? (
          <Card className="border-[var(--bad)]/25">
            <CardBody>
              <form action={deleteTaskAction}>
                <input type="hidden" name="id" value={task.id} />
                <ConfirmSubmit
                  confirmTitle="Remove this task?"
                  confirmBody="It disappears from the task list."
                  confirmLabel="Remove task"
                  size="md"
                >
                  <Icon path={icons.trash} size={16} />
                  Remove task
                </ConfirmSubmit>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
