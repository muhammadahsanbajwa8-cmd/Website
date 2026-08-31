import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { aiConfigured } from '@/lib/ai/client';
import { linkEmailAction } from '../actions';
import { jobOptions, customerOptions } from '@/lib/pickers';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  PageHeader,
  Select,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { EmailAssistant } from './assistant';
import { formatDateTime } from '@/lib/format';
import type { Email } from '@/lib/database.types';

export const metadata = { title: 'Email' };

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('emails.view');
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('emails')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const email = data as Email;

  // Opening an inbound message marks it read.
  if (email.direction === 'inbound' && !email.is_read) {
    await supabase
      .from('emails')
      .update({ is_read: true })
      .eq('id', id)
      .eq('business_id', session.business.id);
  }

  const [{ data: attachments }, jobs, customers, { data: job }, { data: customer }] =
    await Promise.all([
      supabase
        .from('email_attachments')
        .select('id, file_name, mime_type, generated_kind, generated_id')
        .eq('email_id', id)
        .eq('business_id', session.business.id),
      jobOptions(session.business.id),
      customerOptions(session.business.id),
      email.job_id
        ? supabase
            .from('jobs')
            .select('id, number, name')
            .eq('id', email.job_id)
            .eq('business_id', session.business.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      email.customer_id
        ? supabase
            .from('customers')
            .select('id, name, company')
            .eq('id', email.customer_id)
            .eq('business_id', session.business.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const replyTo =
    email.direction === 'inbound' ? email.from_address : email.to_addresses[0] ?? '';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={email.subject || '(no subject)'}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {email.direction === 'inbound' ? 'From ' : 'To '}
              {email.direction === 'inbound'
                ? email.from_name || email.from_address
                : email.to_addresses.join(', ')}
            </span>
            <span aria-hidden>·</span>
            <span>{formatDateTime(email.sent_at ?? email.created_at)}</span>
          </span>
        }
        breadcrumb={
          <Link href="/emails" className="hover:text-[var(--text-strong)]">
            Emails
          </Link>
        }
        actions={
          session.can('emails.send') ? (
            <ButtonLink
              href={`/emails/new?to=${encodeURIComponent(replyTo)}&subject=${encodeURIComponent(
                email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject ?? ''}`
              )}${email.job_id ? `&job=${email.job_id}` : ''}${
                email.customer_id ? `&customer=${email.customer_id}` : ''
              }`}
            >
              <Icon path={icons.send} size={16} />
              Reply
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-5">
          <Card>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                {email.body_text || email.snippet || '(no content)'}
              </p>
            </CardBody>
          </Card>

          {attachments && attachments.length > 0 ? (
            <Card>
              <CardHeader title="Attachments" />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-3 px-5 py-3">
                    <Icon path={icons.file} size={16} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0 flex-1 truncate text-sm">{attachment.file_name}</span>
                    {attachment.generated_kind && attachment.generated_id ? (
                      <Link
                        href={`/${attachment.generated_kind}s/${attachment.generated_id}`}
                        className="shrink-0 text-sm text-[var(--accent)] hover:underline"
                      >
                        Open {attachment.generated_kind}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {session.can('ai.use') ? (
            <EmailAssistant
              emailId={email.id}
              configured={aiConfigured()}
              existingSummary={email.ai_summary}
              replyTo={replyTo}
              subject={email.subject ?? ''}
              jobId={email.job_id}
              customerId={email.customer_id}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'From', value: email.from_address },
                  { label: 'To', value: email.to_addresses.join(', ') || '—' },
                  ...(email.cc_addresses.length
                    ? [{ label: 'Cc', value: email.cc_addresses.join(', ') }]
                    : []),
                  {
                    label: 'Status',
                    value: (
                      <Badge
                        tone={
                          email.state === 'failed'
                            ? 'danger'
                            : email.state === 'sent'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {email.state === 'queued' ? 'Recorded, not delivered' : email.state}
                      </Badge>
                    ),
                  },
                  ...(email.error ? [{ label: 'Delivery error', value: email.error }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="File it against" description="So it joins that job's history." />
            <CardBody>
              <form action={linkEmailAction} className="space-y-3">
                <input type="hidden" name="id" value={email.id} />

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                    Job
                  </span>
                  <Select name="jobId" defaultValue={email.job_id ?? ''}>
                    <option value="">Not on a job</option>
                    {jobs.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.number} — {option.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                    Customer
                  </span>
                  <Select name="customerId" defaultValue={email.customer_id ?? ''}>
                    <option value="">No customer</option>
                    {customers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.company ? `${option.company} — ${option.name}` : option.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <SubmitButton size="sm" pendingLabel="Filing…">
                  Save
                </SubmitButton>
              </form>

              {job || customer ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line-subtle)] pt-4">
                  {job ? (
                    <Link
                      href={`/jobs/${job.id}`}
                      className="rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
                    >
                      {job.number}
                    </Link>
                  ) : null}
                  {customer ? (
                    <Link
                      href={`/customers/${customer.id}`}
                      className="rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
                    >
                      {customer.company || customer.name}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
