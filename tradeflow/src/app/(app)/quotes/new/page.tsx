import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { QuoteForm } from '../form';

export const metadata = { title: 'New quote' };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; job?: string; estimate?: string }>;
}) {
  const session = await requireCapability('quotes.edit');
  const { customer, job, estimate } = await searchParams;

  const [customers, jobs] = await Promise.all([
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New quote"
        description="Save it as a draft first; sending is a separate, deliberate step."
        breadcrumb={
          <Link href="/quotes" className="hover:text-[var(--text-strong)]">
            Quotes
          </Link>
        }
      />
      <QuoteForm
        customers={customers}
        jobs={jobs}
        gstRegistered={session.business.gst_registered}
        validityDays={session.business.quote_validity_days}
        paymentTermsDays={session.business.default_payment_terms_days}
        defaultPaymentTerms={session.business.default_payment_terms}
        defaultTerms={session.business.default_quote_terms}
        defaultCustomerId={customer}
        defaultJobId={job}
        defaultEstimateId={estimate}
      />
    </div>
  );
}
