import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { LeadForm } from '../../form';
import type { Lead } from '@/lib/database.types';

export const metadata = { title: 'Edit lead' };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('leads.edit');
  const { id } = await params;

  const supabase = await createClient();
  const [{ data }, customers] = await Promise.all([
    supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    customerOptions(session.business.id),
  ]);

  if (!data) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${(data as Lead).name}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/leads" className="hover:text-[var(--text-strong)]">
              Leads
            </Link>
            <span>/</span>
            <Link href={`/leads/${id}`} className="hover:text-[var(--text-strong)]">
              {(data as Lead).name}
            </Link>
          </span>
        }
      />
      <LeadForm lead={data as Lead} customers={customers} />
    </div>
  );
}
