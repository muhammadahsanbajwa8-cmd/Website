import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatMoney, todayInAustralia } from '@/lib/format';
import { PageHeader } from '@/components/ui';
import { RequestForm, type ServiceChoice } from './form';
import type { Service } from '@/lib/database.types';

export const metadata = { title: 'Ask for work' };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const session = await requireCustomer();
  const { service } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from('services')
    .select('id, name, price_from_cents, price_note')
    .eq('business_id', session.link.businessId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('position')
    .order('name');

  const services: ServiceChoice[] = ((data ?? []) as Pick<
    Service,
    'id' | 'name' | 'price_from_cents' | 'price_note'
  >[]).map((row) => ({
    id: row.id,
    name: row.name,
    priceLabel: row.price_from_cents
      ? `from ${formatMoney(row.price_from_cents)}`
      : (row.price_note ?? null),
  }));

  const address = [
    session.link.customerAddressLine1,
    session.link.customerSuburb,
    session.link.customerState,
    session.link.customerPostcode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Ask for work"
        description={`Tell ${session.link.businessName} what you need. They will come back to you with a time, and a price if one is needed.`}
      />
      <RequestForm
        services={services}
        businessName={session.link.businessName}
        defaultAddress={address}
        preselected={service}
        todayIso={todayInAustralia()}
      />
    </div>
  );
}
