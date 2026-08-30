import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { CustomerForm } from '../form';

export const metadata = { title: 'New customer' };

export default async function NewCustomerPage() {
  await requireCapability('customers.edit');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New customer"
        description="Only a name is required. Everything else can be filled in later."
        breadcrumb={
          <Link href="/customers" className="hover:text-[var(--text-strong)]">
            Customers
          </Link>
        }
      />
      <CustomerForm />
    </div>
  );
}
