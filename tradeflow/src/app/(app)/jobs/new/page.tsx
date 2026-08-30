import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions, teamOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { JobForm } from '../form';

export const metadata = { title: 'New job' };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const session = await requireCapability('jobs.edit');
  const { customer } = await searchParams;

  const [customers, team] = await Promise.all([
    customerOptions(session.business.id),
    teamOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New job"
        description="The job number is allocated automatically when you save."
        breadcrumb={
          <Link href="/jobs" className="hover:text-[var(--text-strong)]">
            Jobs
          </Link>
        }
      />
      <JobForm customers={customers} team={team} defaultCustomerId={customer} />
    </div>
  );
}
