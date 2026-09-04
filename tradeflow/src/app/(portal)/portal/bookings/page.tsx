import Link from 'next/link';
import { requireCustomer, payload } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatRelative } from '@/lib/format';
import {
  bookingWord,
  requestWord,
  siteLine,
  isUpcoming,
  type PortalJob,
  type PortalRequest,
} from '@/lib/portal';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';

export const metadata = { title: 'Bookings' };

/**
 * Bookings and requests.
 *
 * One page, because to a customer they are the same thing at two stages: a
 * request is work they have asked for, a booking is work that has a date. The
 * split is by whether it has happened yet, not by which table it came from.
 */
export default async function BookingsPage() {
  const session = await requireCustomer();
  const { link } = session;
  const supabase = await createClient();

  const [{ data: jobsData }, { data: requestsData }] = await Promise.all([
    supabase.rpc('portal_jobs', { p_business: link.businessId }),
    supabase.rpc('portal_requests', { p_business: link.businessId }),
  ]);

  const jobs = payload<PortalJob[]>(jobsData, []);
  const requests = payload<PortalRequest[]>(requestsData, []);

  const upcoming = jobs.filter(isUpcoming);
  const past = jobs.filter((job) => !isUpcoming(job));
  // A request that became a job is shown as the job, not twice.
  const openRequests = requests.filter(
    (request) => !request.job_id && !['won', 'lost'].includes(request.status)
  );

  return (
    <div>
      <PageHeader
        title="Bookings"
        description={`Work you have asked ${link.businessName} for, and what is booked in.`}
        actions={
          <ButtonLink href="/portal/bookings/new">
            <Icon path={icons.plus} size={17} />
            Ask for work
          </ButtonLink>
        }
      />

      {openRequests.length > 0 ? (
        <Card className="mb-5">
          <CardHeader
            title="Requested"
            description="Asked for, not yet booked. You will hear back — there is nothing more to do."
          />
          <ul className="divide-y divide-[var(--line-subtle)]">
            {openRequests.map((request) => {
              const said = requestWord(request.status);
              return (
                <li key={request.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-strong)]">
                        {request.service_name ?? 'Work requested'}
                      </div>
                      {request.description ? (
                        <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                          {request.description}
                        </p>
                      ) : null}
                      <div className="mt-1.5 text-xs text-[var(--text-muted)]">
                        Asked {formatRelative(request.created_at)}
                        {request.preferred_date
                          ? ` · you asked for ${formatDate(request.preferred_date)}`
                          : ''}
                        {request.preferred_window ? ` (${request.preferred_window})` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge tone={said.tone}>{said.label}</Badge>
                      {said.note ? (
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{said.note}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader title="Coming up" description="Booked in or under way." />
        {upcoming.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.calendar} size={22} />}
              title="Nothing booked in"
              description={`Ask ${link.businessName} for work and it appears here once they schedule it.`}
              action={
                <ButtonLink href="/portal/bookings/new" size="sm">
                  Ask for work
                </ButtonLink>
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {upcoming.map((job) => (
              <BookingRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Finished" description="Work that is done." />
        {past.length === 0 ? (
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Nothing finished yet. Completed work stays here with its reports and invoices.
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {past.map((job) => (
              <BookingRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BookingRow({ job }: { job: PortalJob }) {
  const said = bookingWord(job.status);
  const address = siteLine(job);
  return (
    <li>
      <Link
        href={`/portal/bookings/${job.id}`}
        className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--surface-sunken)]"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[var(--text-strong)]">{job.name}</div>
          <div className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
            {job.number}
            {job.start_date ? ` · ${formatDate(job.start_date)}` : ''}
            {address ? ` · ${address}` : ''}
          </div>
        </div>
        <Badge tone={said.tone}>{said.label}</Badge>
        <Icon path={icons.chevronRight} size={16} className="shrink-0 text-[var(--text-muted)]" />
      </Link>
    </li>
  );
}
