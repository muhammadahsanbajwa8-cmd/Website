import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { InfoNote, PageHeader } from '@/components/ui';
import { InvoiceForm } from '../../form';
import { toEditorLines } from '@/components/line-items';
import type { Invoice, InvoiceItem } from '@/lib/database.types';

export const metadata = { title: 'Edit invoice' };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('invoices.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, { data: items }, customers, jobs] = await Promise.all([
    supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  if (!data) notFound();
  const invoice = data as Invoice;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Edit ${invoice.number}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/invoices" className="hover:text-[var(--text-strong)]">
              Invoices
            </Link>
            <span>/</span>
            <Link href={`/invoices/${invoice.id}`} className="hover:text-[var(--text-strong)]">
              {invoice.number}
            </Link>
          </span>
        }
      />

      {invoice.paid_cents > 0 ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            Payments have already been recorded against this invoice. Changing the amount
            re-works the outstanding balance and may change its status.
          </InfoNote>
        </div>
      ) : null}

      <InvoiceForm
        invoice={invoice}
        lines={toEditorLines((items ?? []) as InvoiceItem[])}
        customers={customers}
        jobs={jobs}
        business={session.business}
      />
    </div>
  );
}
