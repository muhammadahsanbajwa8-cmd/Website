import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { billWord } from '@/lib/portal';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  StatCard,
  TableWrap,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { openDocumentAction } from '../actions';
import type { Payment } from '@/lib/database.types';

export const metadata = { title: 'Payments' };

const PAYMENT_WORD: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  succeeded: { label: 'Paid', tone: 'success' },
  processing: { label: 'Clearing', tone: 'warning' },
  pending: { label: 'Started', tone: 'warning' },
  failed: { label: 'Did not go through', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded to you', tone: 'neutral' },
  partially_refunded: { label: 'Part refunded', tone: 'warning' },
};

/**
 * What is owed, and what has been paid.
 *
 * Paying goes to the invoice's own hosted page, which is where the card form
 * lives — on the provider's page, never on this one. Nothing on this screen
 * touches a card number, and nothing here decides an amount: the invoice does.
 */
export default async function PortalPaymentsPage() {
  const session = await requireCustomer();
  const { link } = session;
  const supabase = await createClient();

  const [invoicesResult, paymentsResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, number, title, status, total_cents, paid_cents, issue_date, due_date')
      .eq('business_id', link.businessId)
      .eq('customer_id', link.customerId)
      .is('deleted_at', null)
      .in('status', ['sent', 'viewed', 'partially_paid', 'overdue'])
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('payments')
      .select('*')
      .eq('business_id', link.businessId)
      .eq('customer_id', link.customerId)
      .is('deleted_at', null)
      .order('paid_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const invoices = invoicesResult.data ?? [];
  const payments = (paymentsResult.data ?? []) as Payment[];

  const due = invoices.reduce(
    (sum, invoice) => sum + Math.max(invoice.total_cents - invoice.paid_cents, 0),
    0
  );
  const overdue = invoices
    .filter((invoice) => invoice.status === 'overdue')
    .reduce((sum, invoice) => sum + Math.max(invoice.total_cents - invoice.paid_cents, 0), 0);
  const paid = payments
    .filter((payment) => payment.status === 'succeeded')
    .reduce((sum, payment) => sum + payment.amount_cents - payment.refunded_cents, 0);

  return (
    <div>
      <PageHeader
        title="Payments"
        description={`What you owe ${link.businessName}, and everything you have paid them.`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="To pay"
          value={formatMoney(due)}
          hint={invoices.length === 1 ? '1 open invoice' : `${invoices.length} open invoices`}
          tone={due > 0 ? 'warning' : 'neutral'}
          icon={<Icon path={icons.money} size={18} />}
        />
        <StatCard
          label="Overdue"
          value={formatMoney(overdue)}
          hint={overdue > 0 ? 'Please settle when you can' : 'Nothing overdue'}
          tone={overdue > 0 ? 'danger' : 'success'}
          icon={<Icon path={icons.clock} size={18} />}
        />
        <StatCard
          label="Paid to date"
          value={formatMoney(paid)}
          hint="Received and cleared"
          tone="success"
          icon={<Icon path={icons.check} size={18} />}
        />
      </div>

      {!link.acceptsCards && due > 0 ? (
        <div className="mb-5">
          <InfoNote>
            {link.businessName} is not set up to take cards yet. Their bank details are on the
            invoice — open it below to see how they would like to be paid.
          </InfoNote>
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader title="Open invoices" description="Oldest due date first." />
        {invoices.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.check} size={22} />}
              title="Nothing owing"
              description="You are all square. New invoices appear here the moment they are sent."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {invoices.map((invoice) => {
              const said = billWord(invoice.status);
              const outstanding = Math.max(invoice.total_cents - invoice.paid_cents, 0);
              return (
                <li key={invoice.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-strong)]">
                      {invoice.title || invoice.number}
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {invoice.number}
                      {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                    </div>
                    <Badge tone={said.tone} className="mt-1.5">
                      {said.label}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-[var(--text-strong)]">
                      {formatMoney(outstanding)}
                    </div>
                    {invoice.paid_cents > 0 ? (
                      <div className="text-xs text-[var(--text-muted)]">
                        {formatMoney(invoice.paid_cents)} already paid
                      </div>
                    ) : null}
                  </div>
                  <form action={openDocumentAction}>
                    <input type="hidden" name="kind" value="invoice" />
                    <input type="hidden" name="id" value={invoice.id} />
                    <SubmitButton pendingLabel="Opening…">
                      {link.acceptsCards ? 'Pay now' : 'View invoice'}
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Payment history" description="Everything received, however it arrived." />
        {payments.length === 0 ? (
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Nothing paid yet. Once a payment goes through it is listed here with its receipt.
            </p>
          </CardBody>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-subtle)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-semibold">When</th>
                  <th className="px-5 py-2.5 font-semibold">How</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const word = PAYMENT_WORD[payment.status] ?? {
                    label: payment.status,
                    tone: 'neutral' as const,
                  };
                  return (
                    <tr
                      key={payment.id}
                      className="border-b border-[var(--line-subtle)] last:border-0"
                    >
                      <td className="px-5 py-3 tabular-nums">
                        {formatDate(payment.paid_on)}
                        {payment.paid_at ? (
                          <div className="text-xs text-[var(--text-muted)]">
                            {formatDateTime(payment.paid_at).split(', ')[1] ?? ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-[var(--text-muted)]">
                        {payment.provider === 'stripe'
                          ? 'Card'
                          : payment.method.replace(/_/g, ' ')}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={word.tone}>{word.label}</Badge>
                        {payment.failure_reason ? (
                          <div className="mt-0.5 text-xs text-[var(--bad)]">
                            {payment.failure_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        <span className="font-medium">{formatMoney(payment.amount_cents)}</span>
                        {payment.refunded_cents > 0 ? (
                          <div className="text-xs text-[var(--text-muted)]">
                            {formatMoney(payment.refunded_cents)} refunded
                          </div>
                        ) : null}
                        {payment.receipt_url ? (
                          <a
                            href={payment.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-xs text-[var(--accent)] hover:underline"
                          >
                            Receipt
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
        Card details are entered on the payment provider&rsquo;s own page. Neither{' '}
        {link.businessName} nor this site ever sees your card number.
      </p>
    </div>
  );
}
