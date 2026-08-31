import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { stripeConfigured } from '@/lib/payments/stripe';
import { formatMoney, formatDate } from '@/lib/format';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  InfoNote,
  PageHeader,
  StatCard,
  icons,
} from '@/components/ui';
import { ConnectPanel } from './form';

export const metadata = { title: 'Payments setup' };

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; refresh?: string }>;
}) {
  const session = await requireBusiness();
  const { connected } = await searchParams;
  const business = session.business;
  const supabase = await createClient();

  // What has actually come through this account.
  const { data: payments } = await supabase
    .from('payments')
    .select('amount_cents, refunded_cents, platform_fee_cents, provider_fee_cents, status, provider')
    .eq('business_id', business.id)
    .eq('provider', 'stripe')
    .is('deleted_at', null);

  const settled = (payments ?? []).filter((p) => p.status === 'succeeded');
  const received = settled.reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const fees = settled.reduce((sum, p) => sum + p.provider_fee_cents + p.platform_fee_cents, 0);
  const pending = (payments ?? [])
    .filter((p) => p.status === 'pending' || p.status === 'processing')
    .reduce((sum, p) => sum + p.amount_cents, 0);

  const ready = business.stripe_charges_enabled;
  const started = Boolean(business.stripe_account_id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Taking payments"
        description="Let customers pay an invoice by card. The money goes to your own account, not ours."
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
      />

      {connected ? (
        <div className="mb-5">
          <InfoNote tone="success">
            You are back from Stripe. Press <strong>Check again</strong> below to confirm the
            account is ready — Stripe sometimes takes a minute to finish.
          </InfoNote>
        </div>
      ) : null}

      {!stripeConfigured() ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            <strong>Card payments are not switched on for this site.</strong> They need{' '}
            <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-xs">
              STRIPE_SECRET_KEY
            </code>{' '}
            and{' '}
            <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-xs">
              STRIPE_WEBHOOK_SECRET
            </code>{' '}
            in the environment. Everything else works without them: you can still issue invoices and
            record a bank transfer when it lands.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Taken by card" value={formatMoney(received)} icon={icons.invoices} />
        <StatCard
          label="Still clearing"
          value={formatMoney(pending)}
          hint="Started but not settled"
          icon={icons.clock}
        />
        <StatCard label="Fees" value={formatMoney(fees)} hint="Stripe and platform" icon={icons.expenses} />
      </div>

      <ConnectPanel
        configured={stripeConfigured()}
        started={started}
        ready={ready}
        detailsSubmitted={business.stripe_details_submitted}
        accountId={business.stripe_account_id}
        connectedAt={business.stripe_connected_at}
        canEdit={session.can('business.edit')}
      />

      <Card className="mt-5">
        <CardHeader title="How the money moves" />
        <CardBody>
          <ol className="space-y-2.5 text-sm text-[var(--text-muted)]">
            <li>
              <span className="font-medium text-[var(--text-strong)]">1.</span> You send an invoice.
              The customer gets a private link — no account needed.
            </li>
            <li>
              <span className="font-medium text-[var(--text-strong)]">2.</span> They press{' '}
              <strong>Pay now</strong> and enter their card on Stripe&rsquo;s own page. Their card
              details never touch this application.
            </li>
            <li>
              <span className="font-medium text-[var(--text-strong)]">3.</span> Stripe tells us the
              payment settled, and only then is the invoice marked paid. A customer coming back from
              the payment page cannot mark it themselves.
            </li>
            <li>
              <span className="font-medium text-[var(--text-strong)]">4.</span> Stripe pays out to
              your bank on your own schedule. The money is never held by us.
            </li>
          </ol>

          {business.platform_fee_bp > 0 ? (
            <p className="mt-4 border-t border-[var(--line-subtle)] pt-3 text-sm text-[var(--text-muted)]">
              A platform fee of {(business.platform_fee_bp / 100).toFixed(2)}% is taken from each
              card payment, on top of Stripe&rsquo;s own fee.
            </p>
          ) : (
            <p className="mt-4 border-t border-[var(--line-subtle)] pt-3 text-sm text-[var(--text-muted)]">
              We take no fee from your payments. Stripe charges its own.
            </p>
          )}
        </CardBody>
      </Card>

      {business.stripe_connected_at ? (
        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          Connected {formatDate(business.stripe_connected_at)}
          {business.stripe_account_id ? ` · ${business.stripe_account_id}` : ''}
        </p>
      ) : null}
    </div>
  );
}
