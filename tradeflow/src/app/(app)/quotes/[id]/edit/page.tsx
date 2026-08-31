import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader, InfoNote } from '@/components/ui';
import { QuoteForm } from '../../form';
import { toEditorLines } from '@/components/line-items';
import type { Quote, QuoteItem } from '@/lib/database.types';

export const metadata = { title: 'Edit quote' };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('quotes.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, { data: items }, customers, jobs] = await Promise.all([
    supabase
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  if (!data) notFound();
  const quote = data as Quote;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Edit ${quote.number}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/quotes" className="hover:text-[var(--text-strong)]">
              Quotes
            </Link>
            <span>/</span>
            <Link href={`/quotes/${quote.id}`} className="hover:text-[var(--text-strong)]">
              {quote.number}
            </Link>
          </span>
        }
      />

      {quote.status !== 'draft' ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            This quote has already been sent. Editing it changes what the share link shows —
            the customer will see the new figures. What they were originally sent is kept as a
            snapshot on the quote page.
          </InfoNote>
        </div>
      ) : null}

      <QuoteForm
        quote={quote}
        lines={toEditorLines((items ?? []) as QuoteItem[])}
        customers={customers}
        jobs={jobs}
        gstRegistered={session.business.gst_registered}
        validityDays={session.business.quote_validity_days}
        paymentTermsDays={session.business.default_payment_terms_days}
        defaultPaymentTerms={session.business.default_payment_terms}
        defaultTerms={session.business.default_quote_terms}
      />
    </div>
  );
}
