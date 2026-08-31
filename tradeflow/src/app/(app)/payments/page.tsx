import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { lookup, idsFrom, pageFromParams, param } from '@/lib/query';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  InfoNote,
  PageHeader,
  StatCard,
  TableWrap,
  icons,
} from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import type { Payment, PaymentStatus } from '@/lib/database.types';

export const metadata = { title: 'Payments' };

const STATUS_TONE: Record<PaymentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  succeeded: 'success',
  processing: 'warning',
  pending: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
  refunded: 'neutral',
  partially_refunded: 'warning',
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  succeeded: 'Paid',
  processing: 'Clearing',
  pending: 'Started',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  partially_refunded: 'Part refunded',
};

/**
 * Every payment, however it arrived.
 *
 * Card and bank transfer in one list, because the question an owner is asking
 * is "who has paid me", not "which rail did it come down".
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('payments.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const status = param(params, 'status');
  const { from, to, page, pageSize } = pageFromParams(params);

  const supabase = await createClient();

  let query = supabase
    .from('payments')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status) query = query.eq('status', status as PaymentStatus);
  if (search) query = query.ilike('reference', `%${search}%`);

  const { data, count } = await query;
  const payments = (data ?? []) as Payment[];

  // Totals across everything, not just this page.
  const { data: allRows } = await supabase
    .from('payments')
    .select('amount_cents, refunded_cents, status, provider')
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  const all = allRows ?? [];
  const settled = all.filter((p) => p.status === 'succeeded');
  const received = settled.reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const clearing = all
    .filter((p) => p.status === 'pending' || p.status === 'processing')
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const refunded = all.reduce((sum, p) => sum + p.refunded_cents, 0);
  const failed = all.filter((p) => p.status === 'failed').length;

  const [invoices, customers] = await Promise.all([
    lookup('invoices', idsFrom(payments, (p) => p.invoice_id), 'id, number, title'),
    lookup('customers', idsFrom(payments, (p) => p.customer_id), 'id, name, company'),
  ]);

  const { data: outstandingRows } = await supabase
    .from('invoices')
    .select('total_cents, paid_cents')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .in('status', ['sent', 'viewed', 'partially_paid', 'overdue']);

  const outstanding = (outstandingRows ?? []).reduce(
    (sum, invoice) => sum + Math.max(invoice.total_cents - invoice.paid_cents, 0),
    0
  );

  const cardReady = session.business.stripe_charges_enabled;

  return (
    <div>
      <PageHeader
        title="Payments"
        description="What has come in, what is still clearing, and what has gone back."
        actions={
          session.can('business.edit') && !cardReady ? (
            <ButtonLink href="/settings/payments" variant="secondary">
              Set up card payments
            </ButtonLink>
          ) : null
        }
      />

      {!cardReady ? (
        <div className="mb-5">
          <InfoNote>
            <strong>Customers cannot pay by card yet.</strong> Invoices still go out and you can
            record a bank transfer when it lands.{' '}
            <Link href="/settings/payments" className="underline">
              Connect an account
            </Link>{' '}
            to add a Pay now button to every invoice.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Received" value={formatMoney(received)} icon={icons.invoices} tone="success" />
        <StatCard label="Still owed" value={formatMoney(outstanding)} hint="Sent and unpaid" icon={icons.clock} />
        <StatCard
          label="Clearing"
          value={formatMoney(clearing)}
          hint="Started but not settled"
          icon={icons.clock}
        />
        <StatCard
          label="Refunded"
          value={formatMoney(refunded)}
          hint={failed > 0 ? `${failed} failed attempt${failed === 1 ? '' : 's'}` : 'Nothing failed'}
          icon={icons.expenses}
          tone={refunded > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card>
        <CardBody className="flex flex-wrap gap-3">
          <SearchInput placeholder="Search by reference…" />
          <FilterSelect
            paramName="status"
            label="Status"
            options={[
              { value: 'succeeded', label: 'Paid' },
              { value: 'pending', label: 'Started' },
              { value: 'processing', label: 'Clearing' },
              { value: 'failed', label: 'Failed' },
              { value: 'refunded', label: 'Refunded' },
            ]}
            allLabel="Any status"
          />
        </CardBody>

        {payments.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={icons.invoices}
              title={status || search ? 'Nothing matches' : 'No payments yet'}
              description={
                status || search
                  ? 'Try a different filter.'
                  : 'When a customer pays — by card or by bank transfer — it appears here against the invoice it settles.'
              }
            />
          </CardBody>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-subtle)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold">Invoice</th>
                  <th className="px-4 py-2.5 font-semibold">How</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const invoice = invoices.get(payment.invoice_id);
                  const customer = payment.customer_id ? customers.get(payment.customer_id) : null;
                  return (
                    <tr key={payment.id} className="border-b border-[var(--line-subtle)] last:border-0">
                      <td className="px-4 py-3 tabular-nums">
                        {formatDate(payment.paid_on)}
                        {payment.paid_at ? (
                          <div className="text-xs text-[var(--text-muted)]">
                            {formatDateTime(payment.paid_at).split(', ')[1] ?? ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{customer?.company || customer?.name || '—'}</td>
                      <td className="px-4 py-3">
                        {invoice ? (
                          <Link href={`/invoices/${invoice.id}`} className="hover:text-[var(--accent)]">
                            <span className="font-medium">{invoice.number}</span>
                            <span className="block text-xs text-[var(--text-muted)]">
                              {invoice.title}
                            </span>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[var(--text-muted)]">
                          {payment.provider === 'stripe' ? 'Card' : payment.method.replace('_', ' ')}
                        </span>
                        {payment.reference ? (
                          <div className="truncate font-mono text-xs text-[var(--text-muted)]">
                            {payment.reference}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[payment.status]}>
                          {STATUS_LABEL[payment.status]}
                        </Badge>
                        {payment.failure_reason ? (
                          <div className="mt-0.5 text-xs text-[var(--bad)]">
                            {payment.failure_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium">{formatMoney(payment.amount_cents)}</span>
                        {payment.refunded_cents > 0 ? (
                          <div className="text-xs text-[var(--text-muted)]">
                            −{formatMoney(payment.refunded_cents)} refunded
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

      {(count ?? 0) > pageSize ? (
        <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
          Showing {from + 1}–{Math.min(to + 1, count ?? 0)} of {count}
          {page > 1 ? (
            <Link href={`/payments?page=${page - 1}`} className="ml-3 text-[var(--accent)] hover:underline">
              Previous
            </Link>
          ) : null}
          {to + 1 < (count ?? 0) ? (
            <Link href={`/payments?page=${page + 1}`} className="ml-3 text-[var(--accent)] hover:underline">
              Next
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
