import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { WorkLogForm } from '../form';

export const metadata = { title: 'Log hours' };

export default async function NewWorkLogPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const session = await requireCapability('worklogs.edit');
  const { job } = await searchParams;
  const jobs = await jobOptions(session.business.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Log hours"
        description="A shift on a job. The hours are worked out for you."
        breadcrumb={
          <Link href="/timesheets" className="hover:text-[var(--text-strong)]">
            Timesheets
          </Link>
        }
      />
      <WorkLogForm jobs={jobs} defaultJobId={job} />
    </div>
  );
}
