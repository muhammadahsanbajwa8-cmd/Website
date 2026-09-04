import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { convertLeadAction, deleteLeadAction } from '../../field/actions';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';
import { formatDate, formatMoney, formatPhone } from '@/lib/format';
import { leadStatus } from '@/lib/domain';
import type { Lead } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('leads.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('leads')
    .select('name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.name ?? 'Lead' };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('leads.view');
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const lead = data as Lead;

  const { data: job } = await supabase
    .from('jobs')
    .select('id, number, name')
    .eq('business_id', session.business.id)
    .eq('lead_id', id)
    .is('deleted_at', null)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={lead.name}
        description={lead.company ?? undefined}
        breadcrumb={
          <Link href="/leads" className="hover:text-[var(--text-strong)]">
            Leads
          </Link>
        }
        actions={
          <>
            {session.can('jobs.edit') && !job && lead.status !== 'lost' ? (
              <form action={convertLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <SubmitButton pendingLabel="Converting…">
                  <Icon path={icons.jobs} size={16} />
                  Turn into a job
                </SubmitButton>
              </form>
            ) : null}
            {session.can('leads.edit') ? (
              <ButtonLink href={`/leads/${lead.id}/edit`} variant="secondary">
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {job ? (
        <div className="mb-5">
          <InfoNote>
            This lead became{' '}
            <Link href={`/jobs/${job.id}`} className="underline">
              {job.number} — {job.name}
            </Link>
            .
          </InfoNote>
        </div>
      ) : null}

      <div className="space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <Badge tone={leadStatus(lead.status).tone} dot>
              {leadStatus(lead.status).label}
            </Badge>
            {lead.estimated_value_cents ? (
              <span className="text-sm text-[var(--text-muted)]">
                Estimated at{' '}
                <span className="font-medium tabular text-[var(--text-strong)]">
                  {formatMoney(lead.estimated_value_cents)}
                </span>
              </span>
            ) : null}
            {lead.next_follow_up_at ? (
              <span className="ml-auto text-sm text-[var(--text-muted)]">
                Follow up {formatDate(lead.next_follow_up_at)}
              </span>
            ) : null}
          </CardBody>
        </Card>

        {lead.description ? (
          <Card>
            <CardHeader
              title="What they want"
              description={
                lead.source === 'portal' ? 'In their own words, from their account.' : undefined
              }
            />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                {lead.description}
              </p>
              {lead.preferred_date || lead.preferred_window ? (
                <p className="mt-4 rounded-[0.625rem] bg-[var(--surface-sunken)] px-3.5 py-3 text-sm text-[var(--text-muted)]">
                  They asked for{' '}
                  <span className="font-medium text-[var(--text-strong)]">
                    {lead.preferred_date ? formatDate(lead.preferred_date) : 'no particular day'}
                    {lead.preferred_window ? `, ${lead.preferred_window.toLowerCase()}` : ''}
                  </span>
                  . Nothing is booked until you schedule it.
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Phone', value: formatPhone(lead.phone) || '—' },
                { label: 'Email', value: lead.email || '—' },
                { label: 'Source', value: lead.source || '—' },
                { label: 'Site', value: lead.site_address || '—' },
                { label: 'Added', value: formatDate(lead.created_at.slice(0, 10)) },
                { label: 'Lost because', value: lead.lost_reason || '—' },
              ]}
            />
          </CardBody>
        </Card>

        {session.can('leads.edit') ? (
          <Card className="border-[var(--bad)]/25">
            <CardBody>
              <form action={deleteLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <ConfirmSubmit
                  confirmTitle={`Remove ${lead.name}?`}
                  confirmBody="The lead disappears from the list."
                  confirmLabel="Remove lead"
                  size="md"
                >
                  <Icon path={icons.trash} size={16} />
                  Remove lead
                </ConfirmSubmit>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
