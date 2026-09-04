import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, lookup } from '@/lib/query';
import { formatRelative, truncate } from '@/lib/format';
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  EmptyState,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import type { Message } from '@/lib/database.types';

export const metadata = { title: 'Messages' };

/**
 * Messages from customers.
 *
 * One row per customer, most recent first, unread marked. Not an inbox of
 * individual messages: a customer is a conversation, and answering one means
 * reading what they said last week as well as this morning.
 */
export default async function MessagesPage() {
  const session = await requireCapability('customers.view');
  const supabase = await createClient();

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(400);

  const messages = (data ?? []) as Message[];

  // Fold to one entry per customer, keeping the newest and counting unread.
  const threads = new Map<
    string,
    { customerId: string; last: Message; unread: number; total: number }
  >();
  for (const message of messages) {
    const thread = threads.get(message.customer_id);
    const unread = message.sender === 'customer' && !message.read_by_business_at ? 1 : 0;
    if (thread) {
      thread.unread += unread;
      thread.total += 1;
    } else {
      threads.set(message.customer_id, {
        customerId: message.customer_id,
        last: message,
        unread,
        total: 1,
      });
    }
  }

  const list = [...threads.values()];
  const customers = await lookup(
    'customers',
    idsFrom(list, (thread) => thread.customerId),
    'id, name, company'
  );
  const unreadTotal = list.reduce((sum, thread) => sum + thread.unread, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Messages"
        description="What your customers have written from their account. Replies land back there and they are notified."
        actions={
          unreadTotal > 0 ? (
            <Badge tone="danger">
              {unreadTotal} unread
            </Badge>
          ) : null
        }
      />

      <Card>
        {list.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.emails} size={22} />}
              title="No messages yet"
              description="Customers with a login can message you from their account. Give one a login from their record, under Customer login."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {list.map((thread) => {
              const customer = customers.get(thread.customerId);
              const name = customer?.company || customer?.name || 'Customer';
              return (
                <li key={thread.customerId}>
                  <Link
                    href={`/messages/${thread.customerId}`}
                    className="flex items-start gap-3 px-5 py-4 hover:bg-[var(--surface-sunken)]"
                  >
                    <Avatar name={name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-[var(--text-strong)]">
                          {name}
                        </span>
                        {thread.unread > 0 ? (
                          <Badge tone="danger">{thread.unread} new</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                        {thread.last.sender === 'business' ? 'You: ' : ''}
                        {truncate(thread.last.body, 90)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {formatRelative(thread.last.created_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
