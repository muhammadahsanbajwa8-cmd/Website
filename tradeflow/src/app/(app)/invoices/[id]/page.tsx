import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import {
  changeInvoiceStatusAction,
  deleteInvoiceAction,
  deletePaymentAction,
} from '../actions';
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
  Progress,
  StatCard,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, CopyButton } from '@/components/ui/client';
import { Timeline } from '@/components/list';
import { PaymentPanel } from './payments';
import { SendInvoicePanel } from './send';
import { formatDate, formatDateTime, formatMoney, todayInAustralia } from '@/lib/format';
import { lineTotalCents, milliToInput } from '@/lib/money';
import { invoiceStatus, PAYMENT_METHODS } from '@/lib/domain';
import type { Invoice, InvoiceItem, Payment } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('invoices.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('invoices')
    .select('number')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.number ?? 'Invoice' };
}

const METHOD_LABEL = new Map(PAYMENT_METHODS.map((m) => [m.value as string, m.label]));

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('invoices.view');
  const { id } = await params;
  const supabase = await createClient();
  const today = todayInAustralia();

  const [{ data }, { data: itemRows }, { data: paymentRows }] = await Promise.all([
    supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
    supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .order('paid_on', { ascending: false }),
  ]);

  if (!data) notFound();
  const invoice = data as Invoice;
  const items = (itemRows ?? []) as InvoiceItem[];
  const payments = (paymentRows ?? []) as Payment[];

  const [customerResult, jobResult, quoteResult, activitiesResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, company, email')
      .eq('id', invoice.customer_id)
      .maybeSingle(),
    invoice.job_id
      ? supabase.from('jobs').select('id, number, name').eq('id', invoice.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
    invoice.quote_id
      ? supabase.from('quotes').select('id, number').eq('id', invoice.quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('activities')
      .select('id, summary, actor_label, created_at')
      .eq('business_id', session.business.id)
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const customer = customerResult.data;
  const job = jobResult.data;
  const quote = quoteResult.data;

  const outstanding = Math.max(invoice.total_cents - invoice.paid_cents, 0);
  const overdue =
    invoice.due_date != null &&
    invoice.due_date < today &&
    !['paid', 'draft', 'cancelled'].includes(invoice.status);
  const paidPercent =
    invoice.total_cents > 0 ? (invoice.paid_cents / invoice.total_cents) * 100 : 0;
  const shareUrl = invoice.share_token ? `${env.appUrl}/i/${invoice.share_token}` : null;

  return (
    <>
      <PageHeader
        title={invoice.number}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {invoice.title ? <span>{invoice.title}</span> : null}
            {customer ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/customers/${customer.id}`} className="hover:text-[var(--accent)]">
                  {customer.company || customer.name}
                </Link>
              </>
            ) : null}
            {job ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/jobs/${job.id}`} className="hover:text-[var(--accent)]">
                  {job.number}
                </Link>
              </>
            ) : null}
            {quote ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/quotes/${quote.id}`} className="hover:text-[var(--accent)]">
                  from {quote.number}
                </Link>
              </>
            ) : null}
          </span>
        }
        breadcrumb={
          <Link href="/invoices" className="hover:text-[var(--text-strong)]">
            Invoices
          </Link>
        }
        actions={
          <>
            <ButtonLink href={`/invoices/${invoice.id}/pdf`} target="_blank" variant="secondary">
              <Icon path={icons.eye} size={16} />
              Preview
            </ButtonLink>
            <ButtonLink href={`/invoices/${invoice.id}/pdf?download=1`} variant="secondary">
              <Icon path={icons.download} size={16} />
              Download
            </ButtonLink>
            {session.can('invoices.edit') ? (
              <ButtonLink href={`/invoices/${invoice.id}/edit`} variant="secondary">
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {overdue ? (
        <div className="mb-5">
          <InfoNote tone="danger">
            <strong>Overdue.</strong> {formatMoney(outstanding)} was due on{' '}
            {formatDate(invoice.due_date)}.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invoice total" value={formatMoney(invoice.total_cents)} />
        <StatCard label="Paid" value={formatMoney(invoice.paid_cents)} tone="success" />
        <StatCard
          label="Outstanding"
          value={formatMoney(outstanding)}
          tone={overdue ? 'danger' : outstanding > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Status"
          value={
            <Badge tone={overdue ? 'danger' : invoiceStatus(invoice.status).tone}>
              {overdue ? 'Overdue' : invoiceStatus(invoice.status).label}
            </Badge>
          }
          hint={invoice.due_date ? `Due ${formatDate(invoice.due_date)}` : 'No due date'}
        />
      </div>

      {invoice.paid_cents > 0 && outstanding > 0 ? (
        <Card className="mb-5">
          <CardBody>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium text-[var(--text-strong)]">Part paid</span>
              <span className="tabular text-[var(--text-muted)]">
                {formatMoney(invoice.paid_cents)} of {formatMoney(invoice.total_cents)}
              </span>
            </div>
            <Progress value={paidPercent} tone="warning" />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader title="Lines" />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="text-sm text-[var(--text-strong)]">{item.description}</span>
                        {item.detail ? (
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                            {item.detail}
                          </span>
                        ) : null}
                        {!item.taxable && invoice.gst_applies ? (
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">GST-free</span>
                        ) : null}
                      </td>
                      <td className="text-right tabular text-sm">
                        {milliToInput(item.quantity_milli)} {item.unit}
                      </td>
                      <td className="text-right tabular text-sm">
                        {formatMoney(item.unit_price_cents)}
                      </td>
                      <td className="text-right tabular text-sm font-medium text-[var(--text-strong)]">
                        {formatMoney(lineTotalCents(item.quantity_milli, item.unit_price_cents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <CardBody className="border-t border-[var(--line-subtle)] bg-[var(--surface-sunken)]">
              <div className="ml-auto max-w-xs space-y-2">
                <Row label="Subtotal" value={formatMoney(invoice.subtotal_cents)} />
                {invoice.discount_cents > 0 ? (
                  <Row label="Discount" value={`−${formatMoney(invoice.discount_cents)}`} />
                ) : null}
                {invoice.gst_applies ? (
                  <Row label="GST" value={formatMoney(invoice.tax_cents)} />
                ) : null}
                <Row label="Total" value={formatMoney(invoice.total_cents)} strong />
                {invoice.paid_cents > 0 ? (
                  <>
                    <Row label="Paid" value={`−${formatMoney(invoice.paid_cents)}`} />
                    <Row label="Balance" value={formatMoney(outstanding)} strong />
                  </>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {session.can('payments.edit') ? (
            <PaymentPanel invoiceId={invoice.id} outstandingCents={outstanding} />
          ) : null}

          <Card>
            <CardHeader title="Payments" description={`${payments.length} recorded`} />
            {payments.length === 0 ? (
              <CardBody>
                <p className="text-sm text-[var(--text-muted)]">Nothing received yet.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--text-strong)]">
                        {formatMoney(payment.amount_cents)}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {METHOD_LABEL.get(payment.method) ?? payment.method} ·{' '}
                        {formatDate(payment.paid_on)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </span>
                    </span>
                    {session.can('payments.edit') ? (
                      <form action={deletePaymentAction}>
                        <input type="hidden" name="id" value={payment.id} />
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <ConfirmSubmit
                          confirmTitle="Remove this payment?"
                          confirmBody="The invoice balance and status are worked out again without it."
                          confirmLabel="Remove payment"
                        >
                          <Icon path={icons.trash} size={14} />
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {invoice.notes || invoice.payment_terms || invoice.bank_details ? (
            <Card>
              <CardHeader title="Terms and payment details" />
              <CardBody className="space-y-4">
                {invoice.payment_terms ? (
                  <Section label="Payment terms" body={invoice.payment_terms} />
                ) : null}
                {invoice.bank_details ? (
                  <Section label="Bank details" body={invoice.bank_details} />
                ) : null}
                {invoice.notes ? <Section label="Notes" body={invoice.notes} /> : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {session.can('invoices.send') ? (
            <SendInvoicePanel
              invoiceId={invoice.id}
              defaultTo={customer?.email ?? ''}
              alreadySent={Boolean(invoice.sent_at)}
            />
          ) : null}

          {shareUrl ? (
            <Card>
              <CardHeader title="Customer link" description="A read-only copy they can open." />
              <CardBody className="space-y-3">
                <div className="break-all rounded-[0.625rem] bg-[var(--surface-sunken)] p-3 font-mono text-xs">
                  {shareUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={shareUrl} label="Copy link" />
                  <ButtonLink href={shareUrl} target="_blank" variant="secondary" size="sm">
                    <Icon path={icons.eye} size={15} />
                    Open
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Issued', value: formatDate(invoice.issue_date) },
                  { label: 'Due', value: invoice.due_date ? formatDate(invoice.due_date) : '—' },
                  {
                    label: 'Sent',
                    value: invoice.sent_at ? formatDateTime(invoice.sent_at) : 'Not sent',
                  },
                  {
                    label: 'Opened',
                    value: invoice.viewed_at ? formatDateTime(invoice.viewed_at) : 'Not yet',
                  },
                  {
                    label: 'Paid in full',
                    value: invoice.paid_at ? formatDateTime(invoice.paid_at) : '—',
                  },
                  { label: 'GST', value: invoice.gst_applies ? 'Charged at 10%' : 'Not charged' },
                ]}
              />
            </CardBody>
          </Card>

          {session.can('invoices.edit') ? (
            <Card>
              <CardHeader title="Change status" />
              <CardBody className="flex flex-wrap gap-2">
                {(['draft', 'sent', 'cancelled'] as const)
                  .filter((status) => status !== invoice.status)
                  .map((status) => (
                    <form key={status} action={changeInvoiceStatusAction}>
                      <input type="hidden" name="id" value={invoice.id} />
                      <input type="hidden" name="status" value={status} />
                      <button
                        type="submit"
                        className="rounded-full border border-[var(--line-default)] px-3 py-1 text-xs font-medium text-[var(--text-default)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                      >
                        Mark {invoiceStatus(status).label.toLowerCase()}
                      </button>
                    </form>
                  ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <Timeline entries={activitiesResult.data ?? []} />
            </CardBody>
          </Card>

          {session.can('invoices.edit') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Remove invoice</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Cancelling is usually the right move for a sent invoice — it keeps the number
                  in sequence.
                </p>
                <form action={deleteInvoiceAction} className="mt-3">
                  <input type="hidden" name="id" value={invoice.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${invoice.number}?`}
                    confirmBody="Payments recorded against it stay in the ledger but the invoice disappears from the list."
                    confirmLabel="Remove invoice"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove invoice
                  </ConfirmSubmit>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={
          strong ? 'text-sm font-semibold text-[var(--text-strong)]' : 'text-sm text-[var(--text-muted)]'
        }
      >
        {label}
      </span>
      <span
        className={
          strong
            ? 'tabular text-lg font-semibold text-[var(--text-strong)]'
            : 'tabular text-sm text-[var(--text-default)]'
        }
      >
        {value}
      </span>
    </div>
  );
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">{body}</p>
    </div>
  );
}
