import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/format';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';
import { ServiceForm } from './form';
import { deleteServiceAction, toggleServiceAction } from './actions';
import type { Service } from '@/lib/database.types';

export const metadata = { title: 'Services' };

/**
 * What you offer.
 *
 * The list a customer sees in their portal, and the one they choose from when
 * they ask for work. Nothing here is required — a business with no list still
 * takes requests, they just arrive described from scratch.
 */
export default async function ServicesSettingsPage() {
  const session = await requireBusiness();
  const supabase = await createClient();
  const canEdit = session.can('business.edit');

  const { data } = await supabase
    .from('services')
    .select('*')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .order('position')
    .order('name');

  const services = (data ?? []) as Service[];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
        title="Services"
        description="What you take on, in your own words. Customers see this list in their account and pick from it when they ask for work."
      />

      {!canEdit ? (
        <div className="mb-5">
          <InfoNote>Only an owner or admin can change this list.</InfoNote>
        </div>
      ) : null}

      <div className="space-y-4">
        {services.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Icon path={icons.jobs} size={22} />}
                title="No services listed"
                description="Add the three or four things you get asked for most. It takes a minute and saves your customers describing them from scratch."
              />
            </CardBody>
          </Card>
        ) : (
          services.map((service) => (
            <Card key={service.id}>
              <CardBody className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-[var(--text-strong)]">{service.name}</h2>
                    <Badge tone={service.is_active ? 'success' : 'neutral'}>
                      {service.is_active ? 'Live' : 'Hidden'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--accent)]">
                    {service.price_from_cents !== null
                      ? `From ${formatMoney(service.price_from_cents)}`
                      : 'Priced on the job'}
                    {service.price_note ? ` · ${service.price_note}` : ''}
                  </p>
                  {service.description ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {service.description}
                    </p>
                  ) : null}
                  {service.lead_time ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{service.lead_time}</p>
                  ) : null}
                </div>

                {canEdit ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <form action={toggleServiceAction}>
                      <input type="hidden" name="id" value={service.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={service.is_active ? 'false' : 'true'}
                      />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="…">
                        {service.is_active ? 'Hide' : 'Show'}
                      </SubmitButton>
                    </form>
                    <form action={deleteServiceAction}>
                      <input type="hidden" name="id" value={service.id} />
                      <ConfirmSubmit
                        confirmTitle={`Remove ${service.name}?`}
                        confirmBody="It stops appearing in your customers' portal. Requests already made keep their history."
                        confirmLabel="Remove"
                        size="sm"
                      >
                        Remove
                      </ConfirmSubmit>
                    </form>
                  </div>
                ) : null}
              </CardBody>

              {canEdit ? (
                <details className="border-t border-[var(--line-subtle)]">
                  <summary className="cursor-pointer px-5 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]">
                    Edit wording and price
                  </summary>
                  <div className="border-t border-[var(--line-subtle)] p-5">
                    <ServiceForm service={service} count={services.length} />
                  </div>
                </details>
              ) : null}
            </Card>
          ))
        )}

        {canEdit ? <ServiceForm count={services.length} /> : null}
      </div>
    </div>
  );
}
