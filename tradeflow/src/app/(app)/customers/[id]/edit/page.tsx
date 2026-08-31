import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { CustomerForm } from '../../form';
import type { Customer } from '@/lib/database.types';

export const metadata = { title: 'Edit customer' };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireCapability('customers.edit');
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  // A row belonging to another business never comes back from this query —
  // row level security filters it out — so this is a genuine 404 either way.
  if (!data) notFound();
  const customer = data as Customer;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${customer.name}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/customers" className="hover:text-[var(--text-strong)]">
              Customers
            </Link>
            <span>/</span>
            <Link href={`/customers/${customer.id}`} className="hover:text-[var(--text-strong)]">
              {customer.name}
            </Link>
          </span>
        }
      />
      <CustomerForm customer={customer} />
    </div>
  );
}
