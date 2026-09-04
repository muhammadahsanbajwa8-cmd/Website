import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, Icon, PageHeader, cn, icons } from '@/components/ui';
import { MessageForm } from './form';
import type { Message } from '@/lib/database.types';

export const metadata = { title: 'Messages' };

/**
 * The thread.
 *
 * One conversation with the business, oldest at the top, exactly like every
 * messaging app anyone has used. Opening the page marks what they sent as
 * read — that is what opening it means.
 */
export default async function MessagesPage() {
  const session = await requireCustomer();
  const { link } = session;
  const supabase = await createClient();

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('business_id', link.businessId)
    .eq('customer_id', link.customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  const messages = (data ?? []) as Message[];

  if (messages.some((message) => message.sender === 'business' && !message.read_by_customer_at)) {
    await supabase.rpc('portal_mark_messages_read', {
      p_business: link.businessId,
      p_customer: link.customerId,
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Messages"
        description={`Anything you send here goes to ${link.businessName}. Replies land back on this page.`}
      />

      <Card>
        <CardHeader title={link.businessName} description="Your conversation" />

        {messages.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.emails} size={22} />}
              title="No messages yet"
              description="Ask a question, send a photo of the problem in words, or chase something up. It goes straight to the office."
            />
          </CardBody>
        ) : (
          <ul className="space-y-3 p-5">
            {messages.map((message) => {
              const mine = message.sender === 'customer';
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
                      {mine ? 'You' : (message.author_label ?? link.businessName)} ·{' '}
                      {formatDateTime(message.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <CardBody className="border-t border-[var(--line-subtle)]">
          <MessageForm placeholder={`Write to ${link.businessName}…`} />
        </CardBody>
      </Card>
    </div>
  );
}
