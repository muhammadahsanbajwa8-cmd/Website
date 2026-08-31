import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/marketing';
import { Badge, Icon, icons } from '@/components/ui';
import {
  formatAbn,
  formatBsb,
  formatDate,
  formatDateLong,
  formatMoney,
  todayInAustralia,
} from '@/lib/format';
import { milliToInput } from '@/lib/money';
import { invoiceStatus } from '@/lib/domain';

/**
 * The customer's read-only invoice page.
 *
 * As with the quote portal, everything comes from a definer function that
 * returns a fixed set of fields for a valid token. Unlike the quote portal
 * there is nothing to act on here — payment happens through the bank — so the
 * page has no write path at all.
 */

export const dynamic = 'force-dynamic';

interface PortalPayload {
  invoice: {
    id: string;
    number: string;
    status: string;
    title: string | null;
    issue_date: string;
    due_date: string | null;
    payment_terms: string | null;
    notes: string | null;
    bank_details: string | null;
    gst_applies: boolean;
    discount_cents: number;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    paid_cents: number;
  };
  business: {
    name: string;
    abn: string | null;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    gst_registered: boolean;
    bank_account_name: string | null;
    bank_bsb: string | null;
    bank_account_number: string | null;
  };
  customer: {
    name: string;
    company: string | null;
    address_line1: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
  };
  items: {
    id: string;
    description: string;
    detail: string | null;
    quantity_milli: number;
    unit: string;
    unit_price_cents: number;
    taxable: boolean;
    line_total_cents: number;
  }[];
}

async function loadInvoice(token: string): Promise<PortalPayload | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('public_invoice_by_token', { p_token: token });
  if (error || !data) return null;
  return data as unknown as PortalPayload;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await loadInvoice(token);
  return {
    title: payload ? `Invoice ${payload.invoice.number} from ${payload.business.name}` : 'Invoice',
    robots: { index: false, follow: false },
  };
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await loadInvoice(token);
  if (!payload) notFound();

  const { invoice, business, customer, items } = payload;
  const today = todayInAustralia();
  const outstanding = Math.max(invoice.total_cents - invoice.paid_cents, 0);
  const overdue =
    invoice.due_date != null && invoice.due_date < today && outstanding > 0;
  const isTaxInvoice = business.gst_registered && invoice.gst_applies;

  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <header className="border-b border-[var(--line-subtle)] bg-[var(--surface-card)] px-4 py-4 no-print">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--text-strong)]">{business.name}</div>
            {business.abn ? (
              <div className="text-xs text-[var(--text-muted)]">ABN {formatAbn(business.abn)}</div>
            ) : null}
          </div>
          <Badge tone={overdue ? 'danger' : invoiceStatus(invoice.status).tone}>
            {overdue ? 'Overdue' : invoiceStatus(invoice.status).label}
          </Badge>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-[var(--text-muted)]">
          {isTaxInvoice ? 'Tax invoice' : 'Invoice'} {invoice.number}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {invoice.title || `Invoice ${invoice.number}`}
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          For {customer.company || customer.name}, issued {formatDateLong(invoice.issue_date)}
          {invoice.due_date ? `, due ${formatDateLong(invoice.due_date)}` : ''}.
        </p>

        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5">
          <div className="text-sm text-[var(--text-muted)]">
            {outstanding > 0 ? 'Amount due' : 'Paid in full'}
          </div>
          <div
            className={`mt-1 text-3xl font-semibold tabular ${
              overdue ? 'text-[var(--bad)]' : outstanding > 0 ? 'text-[var(--text-strong)]' : 'text-[var(--ok)]'
            }`}
          >
            {formatMoney(outstanding > 0 ? outstanding : invoice.total_cents)}
          </div>
          {invoice.paid_cents > 0 && outstanding > 0 ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {formatMoney(invoice.paid_cents)} of {formatMoney(invoice.total_cents)} received.
            </p>
          ) : null}
          {overdue ? (
            <p className="mt-2 text-sm text-[var(--bad)]">
              This was due on {formatDate(invoice.due_date)}.
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 no-print">
          <a
            href={`/i/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-[0.625rem] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            <Icon path={icons.eye} size={16} />
            View the PDF
          </a>
          <a
            href={`/i/${token}/pdf?download=1`}
            className="inline-flex h-11 items-center gap-2 rounded-[0.625rem] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            <Icon path={icons.download} size={16} />
            Download
          </a>
        </div>

        <section className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)]">
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
                    <td className="text-right tabular text-sm">{formatMoney(item.unit_price_cents)}</td>
                    <td className="text-right tabular text-sm font-medium text-[var(--text-strong)]">
                      {formatMoney(item.line_total_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-5">
            <div className="ml-auto max-w-xs space-y-2">
              <Row label="Subtotal" value={formatMoney(invoice.subtotal_cents)} />
              {invoice.discount_cents > 0 ? (
                <Row label="Discount" value={`−${formatMoney(invoice.discount_cents)}`} />
              ) : null}
              {invoice.gst_applies ? <Row label="GST" value={formatMoney(invoice.tax_cents)} /> : null}
              <Row label="Total" value={formatMoney(invoice.total_cents)} strong />
              {invoice.paid_cents > 0 ? (
                <>
                  <Row label="Paid" value={`−${formatMoney(invoice.paid_cents)}`} />
                  <Row label="Balance" value={formatMoney(outstanding)} strong />
                </>
              ) : null}
            </div>
          </div>
        </section>

        {business.bank_bsb || business.bank_account_number || invoice.bank_details ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              How to pay
            </h2>
            {business.bank_bsb || business.bank_account_number ? (
              <dl className="grid gap-3 sm:grid-cols-3">
                {business.bank_account_name ? (
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Account name</dt>
                    <dd className="text-sm font-medium text-[var(--text-strong)]">
                      {business.bank_account_name}
                    </dd>
                  </div>
                ) : null}
                {business.bank_bsb ? (
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">BSB</dt>
                    <dd className="tabular text-sm font-medium text-[var(--text-strong)]">
                      {formatBsb(business.bank_bsb)}
                    </dd>
                  </div>
                ) : null}
                {business.bank_account_number ? (
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Account number</dt>
                    <dd className="tabular text-sm font-medium text-[var(--text-strong)]">
                      {business.bank_account_number}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                {invoice.bank_details}
              </p>
            )}
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Please use <strong className="text-[var(--text-strong)]">{invoice.number}</strong> as
              the payment reference.
            </p>
            {invoice.payment_terms ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                {invoice.payment_terms}
              </p>
            ) : null}
          </section>
        ) : null}

        {invoice.notes ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5">
            <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">{invoice.notes}</p>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-[var(--line-subtle)] pt-6 text-sm text-[var(--text-muted)]">
          <p className="font-medium text-[var(--text-strong)]">{business.name}</p>
          <p className="mt-1">
            {[
              business.abn ? `ABN ${formatAbn(business.abn)}` : null,
              [business.address_line1, business.suburb, business.state, business.postcode]
                .filter(Boolean)
                .join(' ') || null,
              business.phone,
              business.email,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs no-print">
            <span>Sent with</span>
            <Logo size="sm" />
          </div>
        </footer>
      </main>
    </div>
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
            ? 'tabular text-xl font-semibold text-[var(--text-strong)]'
            : 'tabular text-sm text-[var(--text-default)]'
        }
      >
        {value}
      </span>
    </div>
  );
}
