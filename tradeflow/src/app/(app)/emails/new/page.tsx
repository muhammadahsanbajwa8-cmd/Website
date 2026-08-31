import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { ComposeForm } from './form';

export const metadata = { title: 'Compose' };

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireCapability('emails.send');
  const params = await searchParams;

  const supabase = await createClient();
  const [jobs, customers, { data: quotes }, { data: invoices }, { data: reports }] =
    await Promise.all([
      jobOptions(session.business.id),
      customerOptions(session.business.id),
      session.can('quotes.view')
        ? supabase
            .from('quotes')
            .select('id, number, title')
            .eq('business_id', session.business.id)
            .is('deleted_at', null)
            .order('issue_date', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      session.can('invoices.view')
        ? supabase
            .from('invoices')
            .select('id, number, title')
            .eq('business_id', session.business.id)
            .is('deleted_at', null)
            .order('issue_date', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      supabase
        .from('reports')
        .select('id, number, title')
        .eq('business_id', session.business.id)
        .is('deleted_at', null)
        .order('report_date', { ascending: false })
        .limit(50),
    ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Compose"
        description="Attach a quote, invoice or report and it is generated fresh from the record."
        breadcrumb={
          <Link href="/emails" className="hover:text-[var(--text-strong)]">
            Emails
          </Link>
        }
      />
      <ComposeForm
        jobs={jobs}
        customers={customers}
        quotes={quotes ?? []}
        invoices={invoices ?? []}
        reports={reports ?? []}
        defaults={{
          to: params.to,
          subject: params.subject,
          body: params.body,
          jobId: params.job,
          customerId: params.customer,
          quoteId: params.quote,
          invoiceId: params.invoice,
          reportId: params.report,
        }}
      />
    </div>
  );
}
