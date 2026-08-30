import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { EstimateForm } from '../form';

export const metadata = { title: 'New estimate' };

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; job?: string }>;
}) {
  const session = await requireCapability('estimates.edit');
  const { customer, job } = await searchParams;

  const [customers, jobs] = await Promise.all([
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New estimate"
        description="Cost it up first. The quote is generated from this, with the markup applied."
        breadcrumb={
          <Link href="/estimates" className="hover:text-[var(--text-strong)]">
            Estimates
          </Link>
        }
      />
      <EstimateForm
        customers={customers}
        jobs={jobs}
        gstRegistered={session.business.gst_registered}
        defaultMarkupBp={session.business.default_markup_bp}
        defaultCustomerId={customer}
        defaultJobId={job}
      />
    </div>
  );
}
