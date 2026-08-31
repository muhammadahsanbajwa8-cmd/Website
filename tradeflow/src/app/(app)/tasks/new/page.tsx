import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions, jobOptions, teamOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { TaskForm } from '../form';

export const metadata = { title: 'New task' };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; customer?: string; title?: string; email?: string; due?: string; priority?: string }>;
}) {
  const session = await requireCapability('tasks.edit');
  const params = await searchParams;

  const [jobs, customers, team] = await Promise.all([
    jobOptions(session.business.id),
    customerOptions(session.business.id),
    teamOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New task"
        breadcrumb={
          <Link href="/tasks" className="hover:text-[var(--text-strong)]">
            Tasks
          </Link>
        }
      />
      <TaskForm
        jobs={jobs}
        customers={customers}
        team={team}
        defaults={{
          jobId: params.job,
          customerId: params.customer,
          title: params.title,
          emailId: params.email,
          dueDate: params.due,
          priority: params.priority,
        }}
      />
    </div>
  );
}
