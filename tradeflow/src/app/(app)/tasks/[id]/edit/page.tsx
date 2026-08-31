import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions, teamOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { TaskForm } from '../../form';
import type { JobTask } from '@/lib/database.types';

export const metadata = { title: 'Edit task' };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('tasks.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, jobs, customers, team] = await Promise.all([
    supabase
      .from('job_tasks')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    jobOptions(session.business.id),
    customerOptions(session.business.id),
    teamOptions(session.business.id),
  ]);

  if (!data) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Edit task"
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/tasks" className="hover:text-[var(--text-strong)]">
              Tasks
            </Link>
            <span>/</span>
            <Link href={`/tasks/${id}`} className="hover:text-[var(--text-strong)]">
              {(data as JobTask).title}
            </Link>
          </span>
        }
      />
      <TaskForm task={data as JobTask} jobs={jobs} customers={customers} team={team} />
    </div>
  );
}
