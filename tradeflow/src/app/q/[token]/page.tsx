import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { QuoteResponse } from './respond';
import { Logo } from '@/components/marketing';
import { Badge, Icon, icons } from '@/components/ui';
import {
  formatAbn,
  formatDate,
  formatDateLong,
  formatMoney,
  todayInAustralia,
} from '@/lib/format';
import { milliToInput } from '@/lib/money';
import { quoteStatus } from '@/lib/domain';

/**
 * The customer's quote page.
 *
 * Unauthenticated: the share token in the URL is the credential. Everything on
 * this page comes from `public_quote_by_token()`, a definer function that
 * returns exactly the fields a customer should see — no internal ids, no
 * business settings, no other quotes. That is why the page can be reached
 * without a login and still not be a hole in the tenancy.
 *
 * The admin client is used purely to call that function as `anon` would; the
 * function does its own token check and returns null for a bad one.
 */

export const dynamic = 'force-dynamic';

interface PortalPayload {
  quote: {
    id: string;
    number: string;
    version: number;
    status: string;
    title: string;
    scope_of_work: string | null;
    terms: string | null;
    payment_terms: string | null;
    issue_date: string;
    expiry_date: string | null;
    gst_applies: boolean;
    discount_cents: number;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    accepted_at: string | null;
    declined_at: string | null;
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

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await loadQuote(token);
  return {
    title: payload ? `Quote ${payload.quote.number} from ${payload.business.name}` : 'Quote',
    // A private link should never turn up in a search result.
    robots: { index: false, follow: false },
  };
}

async function loadQuote(token: string): Promise<PortalPayload | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('public_quote_by_token', { p_token: token });
  if (error || !data) return null;
  return data as unknown as PortalPayload;
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await loadQuote(token);
  if (!payload) notFound();

  const { quote, business, customer, items } = payload;
  const today = todayInAustralia();
  const expired =
    quote.expiry_date != null &&
    quote.expiry_date < today &&
    !['accepted', 'declined'].includes(quote.status);
  const decided = quote.status === 'accepted' || quote.status === 'declined';

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
          <Badge tone={expired ? 'warning' : quoteStatus(quote.status).tone}>
            {expired ? 'Expired' : quoteStatus(quote.status).label}
          </Badge>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-[var(--text-muted)]">Quote {quote.number}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{quote.title}</h1>
          <p className="mt-2 text-[var(--text-muted)]">
            Prepared for {customer.company || customer.name} on {formatDateLong(quote.issue_date)}
            {quote.expiry_date ? `, valid until ${formatDateLong(quote.expiry_date)}` : ''}.
          </p>
        </div>

        {decided ? (
          <div
            className={`mb-6 rounded-[var(--radius-card)] border px-4 py-3.5 text-sm ${
              quote.status === 'accepted'
                ? 'border-[var(--ok)]/35 bg-[var(--ok-soft)] text-[var(--ok)]'
                : 'border-[var(--bad)]/35 bg-[var(--bad-soft)] text-[var(--bad)]'
            }`}
          >
            {quote.status === 'accepted'
              ? `You accepted this quote${quote.accepted_at ? ` on ${formatDate(quote.accepted_at.slice(0, 10))}` : ''}. ${business.name} has been notified.`
              : `You declined this quote${quote.declined_at ? ` on ${formatDate(quote.declined_at.slice(0, 10))}` : ''}. Get in touch if that was a mistake.`}
          </div>
        ) : expired ? (
          <div className="mb-6 rounded-[var(--radius-card)] border border-[var(--warn)]/35 bg-[var(--warn-soft)] px-4 py-3.5 text-sm text-[var(--warn)]">
            This quote passed its expiry date of {formatDate(quote.expiry_date)}. Contact{' '}
            {business.name} if you would still like to go ahead — prices may have changed.
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap gap-2 no-print">
          <a
            href={`/q/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-[0.625rem] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            <Icon path={icons.eye} size={16} />
            View the PDF
          </a>
          <a
            href={`/q/${token}/pdf?download=1`}
            className="inline-flex h-11 items-center gap-2 rounded-[0.625rem] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
          >
            <Icon path={icons.download} size={16} />
            Download
          </a>
        </div>

        {quote.scope_of_work ? (
          <section className="mb-5 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Scope of work
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
              {quote.scope_of_work}
            </p>
          </section>
        ) : null}

        <section className="mb-5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)]">
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
                      {!item.taxable && quote.gst_applies ? (
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
              <Row label="Subtotal" value={formatMoney(quote.subtotal_cents)} />
              {quote.discount_cents > 0 ? (
                <Row label="Discount" value={`−${formatMoney(quote.discount_cents)}`} />
              ) : null}
              {quote.gst_applies ? <Row label="GST" value={formatMoney(quote.tax_cents)} /> : null}
              <Row label="Total" value={formatMoney(quote.total_cents)} strong />
              <p className="pt-1 text-xs text-[var(--text-muted)]">
                {quote.gst_applies
                  ? 'All amounts in Australian dollars, including GST.'
                  : 'All amounts in Australian dollars. No GST applies.'}
              </p>
            </div>
          </div>
        </section>

        {!decided && !expired ? (
          <div className="no-print">
            <QuoteResponse token={token} customerName={customer.name} />
          </div>
        ) : null}

        {quote.payment_terms || quote.terms ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5">
            {quote.payment_terms ? (
              <>
                <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Payment terms
                </h2>
                <p className="mb-4 whitespace-pre-wrap text-sm text-[var(--text-default)]">
                  {quote.payment_terms}
                </p>
              </>
            ) : null}
            {quote.terms ? (
              <>
                <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Terms and conditions
                </h2>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-muted)]">
                  {quote.terms}
                </p>
              </>
            ) : null}
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
