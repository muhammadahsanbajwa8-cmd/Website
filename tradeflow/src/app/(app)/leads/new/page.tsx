import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { customerOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { LeadForm } from '../form';

export const metadata = { title: 'New lead' };

export default async function NewLeadPage() {
  const session = await requireCapability('leads.edit');
  const customers = await customerOptions(session.business.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New lead"
        description="Enough to ring them back. The rest can wait."
        breadcrumb={
          <Link href="/leads" className="hover:text-[var(--text-strong)]">
            Leads
          </Link>
        }
      />
      <LeadForm customers={customers} />
    </div>
  );
}
