import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { ButtonLink, Card, CardBody, CardHeader, EmptyState, Icon, PageHeader, cn, icons } from '@/components/ui';
import { ReplyForm } from './reply';
import { markThreadReadAction } from '../actions';
import type { Customer, Message } from '@/lib/database.types';

export const metadata = { title: 'Conversation' };

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const session = await requireCapability('customers.view');
  const { customerId } = await params;
  const supabase = await createClient();

  const { data: customerRow } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!customerRow) notFound();
  const customer = customerRow as Customer;

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('business_id', session.business.id)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  const messages = (data ?? []) as Message[];

  if (messages.some((message) => message.sender === 'customer' && !message.read_by_business_at)) {
    await markThreadReadAction(customerId);
  }

  const name = customer.company || customer.name;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={
          <Link href="/messages" className="hover:text-[var(--text-strong)]">
            ← Messages
          </Link>
        }
        title={name}
        description="Everything said in their account."
        actions={
          <ButtonLink href={`/customers/${customer.id}`} variant="secondary">
            <Icon path={icons.customers} size={16} />
            Open their record
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader title="Conversation" description={customer.email ?? undefined} />

        {messages.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.emails} size={22} />}
              title="Nothing yet"
              description="Write the first message — it appears in their account and they are notified."
            />
          </CardBody>
        ) : (
          <ul className="space-y-3 p-5">
            {messages.map((message) => {
              const mine = message.sender === 'business';
              return (
                <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-[0.875rem] px-4 py-2.5 text-sm',
                      mine
                        ? 'bg-[var(--accent)] text-[var(--accent-on)]'
                        : 'bg-[var(--surface-sunken)] text-[var(--text-default)]'
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <p
                      className={cn(
                        'mt-1 text-[0.7rem]',
                        mine ? 'text-[var(--accent-on)]/75' : 'text-[var(--text-muted)]'
                      )}
                    >
                      {message.author_label ?? (mine ? session.business.name : customer.name)} ·{' '}
                      {formatDateTime(message.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <CardBody className="border-t border-[var(--line-subtle)]">
          <ReplyForm customerId={customer.id} customerName={customer.name} />
        </CardBody>
      </Card>
    </div>
  );
}
