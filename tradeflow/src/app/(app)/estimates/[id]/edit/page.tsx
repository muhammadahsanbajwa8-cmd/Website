import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { EstimateForm } from '../../form';
import { toEditorLines } from '@/components/line-items';
import type { Estimate, EstimateItem } from '@/lib/database.types';

export const metadata = { title: 'Edit estimate' };

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireCapability('estimates.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, { data: items }, customers, jobs] = await Promise.all([
    supabase
      .from('estimates')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('estimate_items')
      .select('*')
      .eq('estimate_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
    customerOptions(session.business.id),
    jobOptions(session.business.id),
  ]);

  if (!data) notFound();
  const estimate = data as Estimate;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Edit ${estimate.title}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/estimates" className="hover:text-[var(--text-strong)]">
              Estimates
            </Link>
            <span>/</span>
            <Link href={`/estimates/${estimate.id}`} className="hover:text-[var(--text-strong)]">
              {estimate.number}
            </Link>
          </span>
        }
      />
      <EstimateForm
        estimate={estimate}
        lines={toEditorLines((items ?? []) as EstimateItem[])}
        customers={customers}
        jobs={jobs}
        gstRegistered={session.business.gst_registered}
        defaultMarkupBp={session.business.default_markup_bp}
      />
    </div>
  );
}
