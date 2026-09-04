import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/format';
import {
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import type { Service } from '@/lib/database.types';

export const metadata = { title: 'Services' };

/**
 * What this business does.
 *
 * A list the business writes for itself, so the prices and the wording are
 * theirs. Every card ends in the same place: asking for it, with the service
 * already chosen on the form.
 */
export default async function ServicesPage() {
  const session = await requireCustomer();
  const { link } = session;
  const supabase = await createClient();

  const { data } = await supabase
    .from('services')
    .select('*')
    .eq('business_id', link.businessId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('position')
    .order('name');

  const services = (data ?? []) as Service[];

  return (
    <div>
      <PageHeader
        title="Services"
        description={`What ${link.businessName} takes on. Prices are a guide — you get a proper price before any work starts.`}
        actions={
          <ButtonLink href="/portal/bookings/new" variant="secondary">
            <Icon path={icons.plus} size={17} />
            Ask for something else
          </ButtonLink>
        }
      />

      {services.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.jobs} size={22} />}
              title="No list published yet"
              description={`${link.businessName} has not put up a list of services. You can still ask them for anything — describe the work and they will come back to you.`}
              action={<ButtonLink href="/portal/bookings/new">Ask for work</ButtonLink>}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id} className="flex flex-col">
                <CardBody className="flex flex-1 flex-col">
                  <h2 className="text-base font-semibold text-[var(--text-strong)]">
                    {service.name}
                  </h2>

                  {service.price_from_cents !== null || service.price_note ? (
                    <p className="mt-1 text-sm font-medium text-[var(--accent)]">
                      {service.price_from_cents !== null
                        ? `From ${formatMoney(service.price_from_cents)}`
                        : service.price_note}
                      {service.price_from_cents !== null && service.price_note
                        ? ` · ${service.price_note}`
                        : ''}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--text-muted)]">Priced on the job</p>
                  )}

                  {service.description ? (
                    <p className="mt-3 flex-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {service.description}
                    </p>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {service.lead_time ? (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                      <Icon path={icons.clock} size={14} />
                      {service.lead_time}
                    </p>
                  ) : null}

                  <ButtonLink
                    href={`/portal/bookings/new?service=${service.id}`}
                    className="mt-4 w-full"
                    variant="secondary"
                  >
                    Ask for this
                  </ButtonLink>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="mt-5">
            <InfoNote>
              Nothing here quite right?{' '}
              <a href="/portal/bookings/new" className="underline">
                Describe what you need
              </a>{' '}
              and {link.businessName} will tell you whether they can help.
            </InfoNote>
          </div>
        </>
      )}
    </div>
  );
}
