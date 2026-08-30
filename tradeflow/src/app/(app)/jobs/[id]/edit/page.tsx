import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, teamOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { JobForm } from '../../form';
import type { Job } from '@/lib/database.types';

export const metadata = { title: 'Edit job' };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('jobs.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, customers, team, { data: assignments }] = await Promise.all([
    supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    customerOptions(session.business.id),
    teamOptions(session.business.id),
    supabase
      .from('job_assignments')
      .select('team_member_id')
      .eq('job_id', id)
      .eq('business_id', session.business.id),
  ]);

  if (!data) notFound();
  const job = data as Job;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${job.name}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/jobs" className="hover:text-[var(--text-strong)]">
              Jobs
            </Link>
            <span>/</span>
            <Link href={`/jobs/${job.id}`} className="hover:text-[var(--text-strong)]">
              {job.number}
            </Link>
          </span>
        }
      />
      <JobForm
        job={job}
        customers={customers}
        team={team}
        assignedIds={(assignments ?? []).map((a) => a.team_member_id)}
      />
    </div>
  );
}
