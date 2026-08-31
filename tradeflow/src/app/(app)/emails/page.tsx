import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { env } from '@/lib/env';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDateTime, truncate } from '@/lib/format';
import type { Email } from '@/lib/database.types';

export const metadata = { title: 'Emails' };

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('emails.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const direction = param(params, 'direction');
  const jobId = param(params, 'job');
  const sent = param(params, 'sent');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();
  let query = supabase
    .from('emails')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (direction === 'inbound' || direction === 'outbound') query = query.eq('direction', direction);
  if (jobId) query = query.eq('job_id', jobId);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(
      `subject.ilike.${pattern},body_text.ilike.${pattern},from_address.ilike.${pattern},snippet.ilike.${pattern}`
    );
  }

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to);
  const emails = (data ?? []) as Email[];

  const [customers, jobs, { data: accounts }] = await Promise.all([
    lookup('customers', idsFrom(emails, (email) => email.customer_id), 'id, name, company'),
    lookup('jobs', idsFrom(emails, (email) => email.job_id), 'id, number, name'),
    supabase
      .from('email_accounts')
      .select('id, email_address, provider, last_synced_at, sync_error')
      .eq('business_id', session.business.id)
      .is('deleted_at', null),
  ]);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  for (const [key, value] of [['q', search], ['direction', direction], ['job', jobId]] as const) {
    if (value) queryString.set(key, value);
  }

  const mailboxReady = (accounts ?? []).length > 0;

  return (
    <>
      <PageHeader
        title="Emails"
        description="Everything sent from here, and — once a mailbox is connected — everything received."
        actions={
          session.can('emails.send') ? (
            <ButtonLink href="/emails/new">
              <Icon path={icons.plus} size={18} />
              Compose
            </ButtonLink>
          ) : null
        }
      />

      {sent === '1' ? (
        <div className="mb-5">
          <InfoNote>Your message has been recorded and, if delivery is configured, sent.</InfoNote>
        </div>
      ) : null}

      {!mailboxReady ? (
        <div className="mb-5">
          <InfoNote>
            <strong>No mailbox connected.</strong> Quotes, invoices and reports send from here
            already. Connecting Gmail or Outlook is what puts the replies onto the job they belong
            to.{' '}
            <Link href="/settings/mailboxes" className="underline">
              Connect one
            </Link>
            .
          </InfoNote>
        </div>
      ) : null}

      <FilterBar>
        <SearchInput placeholder="Search subject, sender or body…" />
        <FilterSelect
          paramName="direction"
          label="Filter by direction"
          allLabel="Everything"
          options={[
            { value: 'inbound', label: 'Received' },
            { value: 'outbound', label: 'Sent' },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={emails}
        hrefFor={(email) => `/emails/${email.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.emails} size={20} />}
            title={search || direction ? 'Nothing matches that' : 'No email yet'}
            description="Anything sent from a quote, an invoice or a report lands here with its attachment."
            action={
              session.can('emails.send') ? (
                <ButtonLink href="/emails/new">Write a message</ButtonLink>
              ) : null
            }
          />
        }
        columns={[
          {
            key: 'subject',
            header: 'Message',
            render: (email) => (
              <span>
                <span className={email.is_read ? 'block' : 'block font-semibold'}>
                  {email.subject || '(no subject)'}
                </span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {email.direction === 'inbound'
                    ? `From ${email.from_name || email.from_address}`
                    : `To ${email.to_addresses.join(', ')}`}
                </span>
              </span>
            ),
          },
          {
            key: 'snippet',
            header: 'Preview',
            secondary: true,
            render: (email) => (
              <span className="text-sm text-[var(--text-muted)]">
                {truncate(email.snippet ?? email.body_text, 70) || '—'}
              </span>
            ),
          },
          {
            key: 'linked',
            header: 'On',
            render: (email) => {
              const job = email.job_id ? jobs.get(email.job_id) : null;
              const customer = email.customer_id ? customers.get(email.customer_id) : null;
              return (
                <span className="text-sm">
                  {job ? job.number : customer ? customer.company || customer.name : '—'}
                </span>
              );
            },
          },
          {
            key: 'when',
            header: 'When',
            render: (email) => (
              <span className="text-sm">{formatDateTime(email.sent_at ?? email.created_at)}</span>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            render: (email) => (
              <Badge
                tone={
                  email.state === 'failed'
                    ? 'danger'
                    : email.state === 'sent'
                      ? 'success'
                      : email.state === 'received'
                        ? 'info'
                        : 'neutral'
                }
              >
                {email.state === 'queued' ? 'Not delivered' : email.state}
              </Badge>
            ),
          },
        ]}
      />

      <Pagination info={info} basePath="/emails" query={queryString} />

      {env.emailProvider === 'log' ? (
        <Card className="mt-6">
          <CardHeader title="Delivery is switched off" />
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              <code>EMAIL_PROVIDER</code> is <code>log</code>, so messages are recorded here in
              full — recipients, subject, body and attachments — but nothing leaves the server.
              That is deliberate: the whole send path works, and a demo cannot email a real
              customer by accident. Set <code>EMAIL_PROVIDER=resend</code> with a{' '}
              <code>RESEND_API_KEY</code> to deliver for real.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
