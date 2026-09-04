import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatMoney } from '@/lib/format';
import { billWord, quoteWord } from '@/lib/portal';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { openDocumentAction } from '../actions';

export const metadata = { title: 'Documents' };

/**
 * Quotes and invoices.
 *
 * Opening one hands the customer to the page that document already has — the
 * same page anyone who was emailed a link lands on, with the same accept and
 * pay buttons on it. Nothing here reimplements that; the button asks the
 * database for the document's own token and follows it.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireCustomer();
  const { error } = await searchParams;
  const supabase = await createClient();

  const [quotesResult, invoicesResult] = await Promise.all([
    supabase
      .from('quotes')
      .select('id, number, title, status, total_cents, issue_date, expiry_date')
      .eq('business_id', session.link.businessId)
      .eq('customer_id', session.link.customerId)
      .is('deleted_at', null)
      .neq('status', 'draft')
      .order('issue_date', { ascending: false })
      .limit(50),
    supabase
      .from('invoices')
      .select('id, number, title, status, total_cents, paid_cents, issue_date, due_date')
      .eq('business_id', session.link.businessId)
      .eq('customer_id', session.link.customerId)
      .is('deleted_at', null)
      .neq('status', 'draft')
      .order('issue_date', { ascending: false })
      .limit(50),
  ]);

  const quotes = quotesResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const awaiting = quotes.filter((quote) => ['sent', 'viewed'].includes(quote.status));

  return (
    <div>
      <PageHeader
        title="Documents"
        description={`Every quote and invoice ${session.link.businessName} has sent you.`}
      />

      {error === 'missing' ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            That document could not be opened. It may have been withdrawn — ask{' '}
            {session.link.businessName} about it, or send them a message.
          </InfoNote>
        </div>
      ) : null}

      {awaiting.length > 0 ? (
        <div className="mb-5">
          <InfoNote>
            <strong>
              {awaiting.length === 1
                ? 'A price is waiting on you.'
                : `${awaiting.length} prices are waiting on you.`}
            </strong>{' '}
            Open a quote to read it and either accept it or ask for changes — no account details
            needed.
          </InfoNote>
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader title="Quotes" description="Prices you have been sent." />
        {quotes.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.quotes} size={22} />}
              title="No quotes yet"
              description="When you are sent a price it appears here, and you can accept it from this page."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {quotes.map((quote) => {
              const said = quoteWord(quote.status);
              return (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-strong)]">
                      {quote.title}
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {quote.number} · {formatDate(quote.issue_date)}
                      {quote.expiry_date ? ` · valid to ${formatDate(quote.expiry_date)}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums text-[var(--text-strong)]">
                      {formatMoney(quote.total_cents)}
                    </div>
                    <Badge tone={said.tone}>{said.label}</Badge>
                  </div>
                  <form action={openDocumentAction}>
                    <input type="hidden" name="kind" value="quote" />
                    <input type="hidden" name="id" value={quote.id} />
                    <SubmitButton
                      variant={['sent', 'viewed'].includes(quote.status) ? 'primary' : 'secondary'}
                      size="sm"
                      pendingLabel="Opening…"
                    >
                      {['sent', 'viewed'].includes(quote.status) ? 'Read and respond' : 'Open'}
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Invoices" description="What you have been billed." />
        {invoices.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.invoices} size={22} />}
              title="No invoices yet"
              description="Invoices appear here as soon as they are sent, paid or not."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {invoices.map((invoice) => {
              const said = billWord(invoice.status);
              const outstanding = Math.max(invoice.total_cents - invoice.paid_cents, 0);
              return (
                <li key={invoice.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-strong)]">
                      {invoice.title || invoice.number}
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {invoice.number} · {formatDate(invoice.issue_date)}
                      {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums text-[var(--text-strong)]">
                      {formatMoney(invoice.total_cents)}
                    </div>
                    <Badge tone={said.tone}>{said.label}</Badge>
                    {outstanding > 0 && outstanding !== invoice.total_cents ? (
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatMoney(outstanding)} left
                      </div>
                    ) : null}
                  </div>
                  <form action={openDocumentAction}>
                    <input type="hidden" name="kind" value="invoice" />
                    <input type="hidden" name="id" value={invoice.id} />
                    <SubmitButton
                      variant={outstanding > 0 ? 'primary' : 'secondary'}
                      size="sm"
                      pendingLabel="Opening…"
                    >
                      {outstanding > 0 ? 'View and pay' : 'Open'}
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
