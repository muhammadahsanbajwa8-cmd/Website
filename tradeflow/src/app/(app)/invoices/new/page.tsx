import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { InvoiceForm } from '../form';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; job?: string }>;
}) {
  const session = await requireCapability('invoices.edit');
  const { customer, job } = await searchParams;

  const [customers, jobs] = await Promise.all([
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New invoice"
        description="Or raise one from an accepted quote and the lines come across for you."
        breadcrumb={
          <Link href="/invoices" className="hover:text-[var(--text-strong)]">
            Invoices
          </Link>
        }
      />
      <InvoiceForm
        customers={customers}
        jobs={jobs}
        business={session.business}
        defaultCustomerId={customer}
        defaultJobId={job}
      />
    </div>
  );
}
