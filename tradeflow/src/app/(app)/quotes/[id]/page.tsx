import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import {
  changeQuoteStatusAction,
  convertQuoteToInvoiceAction,
  createShareLinkAction,
  deleteQuoteAction,
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
  icons,
} from '@/components/ui';
import { ConfirmSubmit, CopyButton, SubmitButton } from '@/components/ui/client';
import { Timeline } from '@/components/list';
import { SendQuotePanel } from './send';
import { formatDate, formatDateTime, formatMoney, todayInAustralia } from '@/lib/format';
import { lineTotalCents, milliToInput } from '@/lib/money';
import { quoteStatus } from '@/lib/domain';
import type { Quote, QuoteItem } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('quotes.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('quotes')
    .select('number, title')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data ? `${data.number} — ${data.title}` : 'Quote' };
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireCapability('quotes.view');
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const today = todayInAustralia();

  const [{ data }, { data: itemRows }] = await Promise.all([
    supabase
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
  ]);

  if (!data) notFound();
  const quote = data as Quote;
  const items = (itemRows ?? []) as QuoteItem[];

  const [customerResult, jobResult, activitiesResult, versionsResult, invoiceResult] =
    await Promise.all([
      supabase
        .from('customers')
        .select('id, name, company, email')
        .eq('id', quote.customer_id)
        .maybeSingle(),
      quote.job_id
        ? supabase.from('jobs').select('id, number, name').eq('id', quote.job_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('activities')
        .select('id, summary, actor_label, created_at')
        .eq('business_id', session.business.id)
        .eq('quote_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('quote_versions')
        .select('id, version, total_cents, created_at')
        .eq('business_id', session.business.id)
        .eq('quote_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('invoices')
        .select('id, number, status, total_cents')
        .eq('business_id', session.business.id)
        .eq('quote_id', id)
        .is('deleted_at', null)
        .maybeSingle(),
    ]);

  const customer = customerResult.data;
  const job = jobResult.data;
  const invoice = invoiceResult.data;
  const versions = versionsResult.data ?? [];

  const expired =
    quote.expiry_date != null &&
    quote.expiry_date < today &&
    ['sent', 'viewed', 'changes_requested'].includes(quote.status);
  const shareUrl = quote.share_token ? `${env.appUrl}/q/${quote.share_token}` : null;

  return (
    <>
      <PageHeader
        title={quote.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-[var(--text-default)]">
              {quote.number}
              {quote.version > 1 ? ` · version ${quote.version}` : ''}
            </span>
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
          </span>
        }
        breadcrumb={
          <Link href="/quotes" className="hover:text-[var(--text-strong)]">
            Quotes
          </Link>
        }
        actions={
          <>
            <ButtonLink href={`/quotes/${quote.id}/pdf`} target="_blank" variant="secondary">
              <Icon path={icons.eye} size={16} />
              Preview PDF
            </ButtonLink>
            <ButtonLink href={`/quotes/${quote.id}/pdf?download=1`} variant="secondary">
              <Icon path={icons.download} size={16} />
              Download
            </ButtonLink>
            {session.can('quotes.edit') ? (
              <ButtonLink href={`/quotes/${quote.id}/edit`} variant="secondary">
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
            {session.can('invoices.edit') && quote.status === 'accepted' && !invoice ? (
              <form action={convertQuoteToInvoiceAction}>
                <input type="hidden" name="id" value={quote.id} />
                <SubmitButton pendingLabel="Raising invoice…">
                  <Icon path={icons.invoices} size={16} />
                  Raise invoice
                </SubmitButton>
              </form>
            ) : null}
          </>
        }
      />

      {error ? (
        <div className="mb-5">
          <InfoNote tone="danger">
            {error === 'numbering'
              ? 'An invoice number could not be allocated. Try again.'
              : 'The invoice could not be created. Try again.'}
          </InfoNote>
        </div>
      ) : null}

      {expired ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            This quote passed its expiry date of {formatDate(quote.expiry_date)}. Extend the date
            and send it again if the customer still wants it.
          </InfoNote>
        </div>
      ) : null}

      {quote.status === 'changes_requested' && quote.customer_message ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            <strong>The customer asked for changes:</strong> {quote.customer_message}
          </InfoNote>
        </div>
      ) : null}

      {quote.status === 'declined' ? (
        <div className="mb-5">
          <InfoNote tone="danger">
            <strong>Declined{quote.declined_at ? ` on ${formatDate(quote.declined_at.slice(0, 10))}` : ''}.</strong>{' '}
            {quote.decline_reason || 'No reason was given.'}
          </InfoNote>
        </div>
      ) : null}

      {quote.status === 'accepted' ? (
        <div className="mb-5">
          <InfoNote>
            <strong>Accepted</strong>
            {quote.accepted_by_name ? ` by ${quote.accepted_by_name}` : ''}
            {quote.accepted_at ? ` on ${formatDateTime(quote.accepted_at)}` : ''}.
            {invoice ? (
              <>
                {' '}
                Invoiced as{' '}
                <Link href={`/invoices/${invoice.id}`} className="underline">
                  {invoice.number}
                </Link>
                .
              </>
            ) : session.can('invoices.edit') ? (
              ' Raise the invoice when you are ready.'
            ) : null}
          </InfoNote>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {quote.scope_of_work ? (
            <Card>
              <CardHeader title="Scope of work" />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                  {quote.scope_of_work}
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader title="Lines" description={`${items.length} priced`} />
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
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                            GST-free
                          </span>
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
                <TotalRow label="Subtotal" value={formatMoney(quote.subtotal_cents)} />
                {quote.discount_cents > 0 ? (
                  <TotalRow label="Discount" value={`−${formatMoney(quote.discount_cents)}`} />
                ) : null}
                {quote.gst_applies ? (
                  <TotalRow label="GST" value={formatMoney(quote.tax_cents)} />
                ) : null}
                <TotalRow label="Total" value={formatMoney(quote.total_cents)} strong />
                {!quote.gst_applies ? (
                  <p className="pt-1 text-xs text-[var(--text-muted)]">No GST on this quote.</p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {quote.terms || quote.payment_terms ? (
            <Card>
              <CardHeader title="Terms" />
              <CardBody className="space-y-4">
                {quote.payment_terms ? (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      Payment terms
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                      {quote.payment_terms}
                    </p>
                  </div>
                ) : null}
                {quote.terms ? (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      Terms and conditions
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {quote.terms}
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {session.can('quotes.send') ? (
            <SendQuotePanel
              quoteId={quote.id}
              defaultTo={customer?.email ?? ''}
              customerName={customer?.name ?? ''}
              alreadySent={Boolean(quote.sent_at)}
              shareUrl={shareUrl}
            />
          ) : null}

          {shareUrl ? (
            <Card>
              <CardHeader
                title="Customer link"
                description="The page where they read, download and accept it."
              />
              <CardBody className="space-y-3">
                <div className="break-all rounded-[0.625rem] bg-[var(--surface-sunken)] p-3 font-mono text-xs text-[var(--text-default)]">
                  {shareUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={shareUrl} label="Copy link" />
                  <ButtonLink href={shareUrl} target="_blank" variant="secondary" size="sm">
                    <Icon path={icons.eye} size={15} />
                    Open
                  </ButtonLink>
                </div>
                {session.can('quotes.send') ? (
                  <form action={createShareLinkAction}>
                    <input type="hidden" name="id" value={quote.id} />
                    <ConfirmSubmit
                      confirmTitle="Issue a new link?"
                      confirmBody="The current link stops working immediately. Use this if the old one went to the wrong person."
                      confirmLabel="Issue new link"
                      variant="secondary"
                    >
                      <Icon path={icons.link} size={14} />
                      Issue a new link
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: 'Status',
                    value: (
                      <Badge tone={expired ? 'warning' : quoteStatus(quote.status).tone}>
                        {expired ? 'Expired' : quoteStatus(quote.status).label}
                      </Badge>
                    ),
                  },
                  { label: 'Issued', value: formatDate(quote.issue_date) },
                  {
                    label: 'Valid until',
                    value: quote.expiry_date ? formatDate(quote.expiry_date) : 'No expiry',
                  },
                  { label: 'Sent', value: quote.sent_at ? formatDateTime(quote.sent_at) : 'Not sent' },
                  {
                    label: 'Opened by customer',
                    value: quote.viewed_at ? formatDateTime(quote.viewed_at) : 'Not yet',
                  },
                  { label: 'Total', value: formatMoney(quote.total_cents) },
                ]}
              />
            </CardBody>
          </Card>

          {session.can('quotes.edit') ? (
            <Card>
              <CardHeader title="Record the answer" description="If they told you by phone." />
              <CardBody className="flex flex-wrap gap-2">
                {(['accepted', 'declined', 'sent', 'cancelled'] as const)
                  .filter((status) => status !== quote.status)
                  .map((status) => (
                    <form key={status} action={changeQuoteStatusAction}>
                      <input type="hidden" name="id" value={quote.id} />
                      <input type="hidden" name="status" value={status} />
                      <button
                        type="submit"
                        className="rounded-full border border-[var(--line-default)] px-3 py-1 text-xs font-medium text-[var(--text-default)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                      >
                        Mark {quoteStatus(status).label.toLowerCase()}
                      </button>
                    </form>
                  ))}
              </CardBody>
            </Card>
          ) : null}

          {versions.length > 0 ? (
            <Card>
              <CardHeader
                title="What was sent"
                description="A snapshot is kept each time the quote goes out."
              />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="text-sm text-[var(--text-default)]">
                      Version {version.version}
                      <span className="block text-xs text-[var(--text-muted)]">
                        {formatDateTime(version.created_at)}
                      </span>
                    </span>
                    <span className="tabular text-sm">{formatMoney(version.total_cents)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <Timeline entries={activitiesResult.data ?? []} />
            </CardBody>
          </Card>

          {session.can('quotes.edit') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Remove quote</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  The share link stops working straight away.
                </p>
                <form action={deleteQuoteAction} className="mt-3">
                  <input type="hidden" name="id" value={quote.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${quote.number}?`}
                    confirmBody="Any invoice already raised from it is not affected."
                    confirmLabel="Remove quote"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove quote
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

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
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
