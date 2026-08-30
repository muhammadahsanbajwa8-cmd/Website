import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { convertEstimateToQuoteAction, deleteEstimateAction } from '../actions';
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
  StatCard,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';
import { computeEstimateTotals, COST_KINDS } from '@/lib/calc';
import { formatBasisPoints, formatDate, formatMoney } from '@/lib/format';
import { milliToInput } from '@/lib/money';
import { estimateStatus } from '@/lib/domain';
import type { Estimate, EstimateItem } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('estimates.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('estimates')
    .select('title')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.title ?? 'Estimate' };
}

const ERROR_MESSAGES: Record<string, string> = {
  'no-customer': 'Add a customer to the estimate before turning it into a quote — a quote has to be addressed to someone.',
  numbering: 'A quote number could not be allocated. Try again.',
  convert: 'The quote could not be created. Try again.',
};

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireCapability('estimates.view');
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data }, { data: itemRows }] = await Promise.all([
    supabase
      .from('estimates')
      .select('*')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('estimate_items')
      .select('*')
      .eq('estimate_id', id)
      .eq('business_id', session.business.id)
      .order('position'),
  ]);

  if (!data) notFound();
  const estimate = data as Estimate;
  const items = (itemRows ?? []) as EstimateItem[];

  const [customerResult, jobResult, quotesResult] = await Promise.all([
    estimate.customer_id
      ? supabase.from('customers').select('id, name, company').eq('id', estimate.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    estimate.job_id
      ? supabase.from('jobs').select('id, number, name').eq('id', estimate.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('quotes')
      .select('id, number, title, status, total_cents')
      .eq('business_id', session.business.id)
      .eq('estimate_id', id)
      .is('deleted_at', null),
  ]);

  const totals = computeEstimateTotals({
    items: items.map((item) => ({
      kind: item.kind,
      quantityMilli: item.quantity_milli,
      unitCostCents: item.unit_cost_cents,
      taxable: item.taxable,
    })),
    markupBasisPoints: estimate.markup_bp,
    contingencyBasisPoints: estimate.contingency_bp,
    gstApplies: estimate.gst_applies,
  });

  const customer = customerResult.data;
  const job = jobResult.data;
  const quotes = quotesResult.data ?? [];
  const uplift = 1 + (estimate.markup_bp + estimate.contingency_bp) / 10_000;

  return (
    <>
      <PageHeader
        title={estimate.title}
        description={`${estimate.number} · created ${formatDate(estimate.created_at.slice(0, 10))}`}
        breadcrumb={
          <Link href="/estimates" className="hover:text-[var(--text-strong)]">
            Estimates
          </Link>
        }
        actions={
          <>
            {session.can('quotes.edit') && quotes.length === 0 ? (
              <form action={convertEstimateToQuoteAction}>
                <input type="hidden" name="id" value={estimate.id} />
                <SubmitButton pendingLabel="Creating quote…">
                  <Icon path={icons.quotes} size={16} />
                  Turn into a quote
                </SubmitButton>
              </form>
            ) : null}
            {session.can('estimates.edit') ? (
              <ButtonLink href={`/estimates/${estimate.id}/edit`} variant="secondary">
                <Icon path={icons.edit} size={16} />
                Edit
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {error && ERROR_MESSAGES[error] ? (
        <div className="mb-5">
          <InfoNote tone="danger">{ERROR_MESSAGES[error]}</InfoNote>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Estimated cost" value={formatMoney(totals.estimatedCostCents)} />
        <StatCard
          label="Sell price (ex GST)"
          value={formatMoney(totals.subtotalCents)}
          hint={estimate.gst_applies ? `${formatMoney(totals.totalCents)} inc GST` : 'No GST'}
        />
        <StatCard
          label="Estimated profit"
          value={formatMoney(totals.estimatedProfitCents)}
          tone={totals.estimatedProfitCents >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="Margin"
          value={formatBasisPoints(totals.marginBasisPoints)}
          hint={`${formatBasisPoints(totals.markupBasisPoints)} markup on cost`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader
              title="Cost lines"
              description={`${items.length} line${items.length === 1 ? '' : 's'}`}
            />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const cost = Math.round((item.quantity_milli * item.unit_cost_cents) / 1000);
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="text-xs text-[var(--text-muted)]">
                            {COST_KINDS.find((k) => k.value === item.kind)?.label ?? item.kind}
                          </span>
                        </td>
                        <td>
                          <span className="text-sm text-[var(--text-strong)]">{item.description}</span>
                          {!item.taxable && estimate.gst_applies ? (
                            <span className="ml-2 text-xs text-[var(--text-muted)]">GST-free</span>
                          ) : null}
                        </td>
                        <td className="text-right tabular text-sm">
                          {milliToInput(item.quantity_milli)} {item.unit}
                        </td>
                        <td className="text-right tabular text-sm">
                          {formatMoney(item.unit_cost_cents)}
                        </td>
                        <td className="text-right tabular text-sm">{formatMoney(cost)}</td>
                        <td className="text-right tabular text-sm font-medium text-[var(--text-strong)]">
                          {formatMoney(Math.round(cost * uplift))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <CardBody className="border-t border-[var(--line-subtle)] bg-[var(--surface-sunken)]">
              <div className="ml-auto max-w-xs space-y-2">
                <Row label="Estimated cost" value={formatMoney(totals.estimatedCostCents)} />
                <Row
                  label={`Markup (${formatBasisPoints(estimate.markup_bp)})`}
                  value={formatMoney(totals.markupCents)}
                />
                {estimate.contingency_bp > 0 ? (
                  <Row
                    label={`Contingency (${formatBasisPoints(estimate.contingency_bp)})`}
                    value={formatMoney(totals.contingencyCents)}
                  />
                ) : null}
                <Row label="Subtotal" value={formatMoney(totals.subtotalCents)} strong />
                {estimate.gst_applies ? (
                  <Row label="GST" value={formatMoney(totals.gstCents)} />
                ) : null}
                <Row label="Total" value={formatMoney(totals.totalCents)} strong />
              </div>
            </CardBody>
          </Card>

          {estimate.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                  {estimate.notes}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: 'Status',
                    value: (
                      <Badge tone={estimateStatus(estimate.status).tone}>
                        {estimateStatus(estimate.status).label}
                      </Badge>
                    ),
                  },
                  {
                    label: 'Customer',
                    value: customer ? (
                      <Link href={`/customers/${customer.id}`} className="text-[var(--accent)] hover:underline">
                        {customer.company || customer.name}
                      </Link>
                    ) : (
                      'Not set'
                    ),
                  },
                  {
                    label: 'Job',
                    value: job ? (
                      <Link href={`/jobs/${job.id}`} className="text-[var(--accent)] hover:underline">
                        {job.number} — {job.name}
                      </Link>
                    ) : (
                      'Not linked'
                    ),
                  },
                  { label: 'Markup', value: formatBasisPoints(estimate.markup_bp) },
                  { label: 'Contingency', value: formatBasisPoints(estimate.contingency_bp) },
                  { label: 'GST', value: estimate.gst_applies ? 'Added at 10%' : 'Not added' },
                ]}
              />
            </CardBody>
          </Card>

          {quotes.length > 0 ? (
            <Card>
              <CardHeader title="Quotes from this estimate" />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {quotes.map((quote) => (
                  <li key={quote.id}>
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--text-strong)]">
                          {quote.number}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">{quote.status}</span>
                      </span>
                      <span className="tabular text-sm font-medium">
                        {formatMoney(quote.total_cents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {session.can('estimates.edit') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Remove estimate</h3>
                <form action={deleteEstimateAction} className="mt-3">
                  <input type="hidden" name="id" value={estimate.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${estimate.number}?`}
                    confirmBody="Quotes already created from it are not affected."
                    confirmLabel="Remove estimate"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove estimate
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
      <span className={strong ? 'text-sm font-semibold text-[var(--text-strong)]' : 'text-sm text-[var(--text-muted)]'}>
        {label}
      </span>
      <span
        className={
          strong
            ? 'tabular text-base font-semibold text-[var(--text-strong)]'
            : 'tabular text-sm text-[var(--text-default)]'
        }
      >
        {value}
      </span>
    </div>
  );
}
