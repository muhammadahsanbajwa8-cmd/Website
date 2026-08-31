import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { jobOptions, supplierOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { ExpenseForm } from '../form';

export const metadata = { title: 'Record an expense' };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const session = await requireCapability('expenses.create');
  const { job } = await searchParams;

  const [jobs, suppliers] = await Promise.all([
    jobOptions(session.business.id),
    supplierOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Record an expense"
        breadcrumb={
          <Link href="/expenses" className="hover:text-[var(--text-strong)]">
            Expenses
          </Link>
        }
      />
      <ExpenseForm
        jobs={jobs}
        suppliers={suppliers}
        gstRegistered={session.business.gst_registered}
        defaultJobId={job}
      />
    </div>
  );
}
