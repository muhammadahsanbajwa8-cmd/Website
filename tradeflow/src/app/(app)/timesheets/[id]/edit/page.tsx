import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { WorkLogForm } from '../../form';
import type { WorkLog } from '@/lib/database.types';

export const metadata = { title: 'Edit shift' };

export default async function EditWorkLogPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('worklogs.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, jobs] = await Promise.all([
    supabase
      .from('work_logs')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    jobOptions(session.business.id),
  ]);

  if (!data) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Edit shift"
        breadcrumb={
          <Link href="/timesheets" className="hover:text-[var(--text-strong)]">
            Timesheets
          </Link>
        }
      />
      <WorkLogForm log={data as WorkLog} jobs={jobs} />
    </div>
  );
}
