import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyWebhook } from '@/lib/payments/stripe';
import type { PaymentStatus } from '@/lib/database.types';

/**
 * Stripe tells us what happened.
 *
 * This route is the only thing in the application that may declare a payment
 * succeeded. Nothing a customer's browser sends — not a success_url, not a
 * query parameter — moves an invoice: the browser returning from Checkout only
 * changes what is displayed, and this route changes what is true.
 *
 * Three rules it keeps:
 *
 *   1. the signature is verified against the raw bytes before anything is read;
 *   2. every event is recorded in `payment_events` first, and its unique index
 *      on (provider, event_id) is what makes a redelivery a no-op — Stripe
 *      retries, and it must never credit twice;
 *   3. the amount and the business come from the event, never from metadata a
 *      client could have influenced beyond what we ourselves set.
 *
 * It answers 200 to anything it has already handled or cannot act on, because
 * a non-2xx makes Stripe retry forever over something that will never change.
 */

export const dynamic = 'force-dynamic';

/** Stripe's own vocabulary, mapped to ours. */
function statusFor(intent: Stripe.PaymentIntent): PaymentStatus {
  switch (intent.status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'canceled':
      return 'cancelled';
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return 'pending';
    default:
      return 'pending';
  }
}

export async function POST(request: Request) {
  // The bytes exactly as they arrived. Parsing first would break the signature.
  const raw = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = verifyWebhook(raw, signature);
  } catch (error) {
    // Unsigned or mis-signed: refuse, and say nothing about why.
    return new NextResponse('Signature verification failed', { status: 400 });
  }

  const admin = createAdminClient();

  // Record it before acting. The unique index is the idempotency guard: a
  // conflict means we have seen this event and there is nothing to do.
  const { error: insertError } = await admin.from('payment_events').insert({
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, never>,
  });

  if (insertError) {
    // 23505 is the unique violation — a redelivery of something already done.
    if ((insertError as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return new NextResponse('Could not record the event', { status: 500 });
  }

  try {
    await handle(event, admin);
    await admin
      .from('payment_events')
      .update({ handled: true })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    await admin
      .from('payment_events')
      .update({ handled: false, error: detail })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
    // A 500 asks Stripe to retry, which is right for a transient failure.
    return new NextResponse('Handler failed', { status: 500 });
  }

  return NextResponse.json({ received: true });
}

type Admin = ReturnType<typeof createAdminClient>;

async function handle(event: Stripe.Event, admin: Admin): Promise<void> {
  switch (event.type) {
    // --- the business finished (or changed) its onboarding -------------------
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      await admin
        .from('businesses')
        .update({
          stripe_charges_enabled: Boolean(account.charges_enabled),
          stripe_details_submitted: Boolean(account.details_submitted),
          ...(account.charges_enabled ? { stripe_connected_at: new Date().toISOString() } : {}),
        })
        .eq('stripe_account_id', account.id);
      return;
    }

    // --- a payment moved -----------------------------------------------------
    case 'payment_intent.succeeded':
    case 'payment_intent.processing':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await upsertPayment(admin, intent, event);
      return;
    }

    // --- money went back -----------------------------------------------------
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const intentId =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!intentId) return;

      const { data: payment } = await admin
        .from('payments')
        .select('id, amount_cents, invoice_id, business_id')
        .eq('provider', 'stripe')
        .eq('provider_payment_id', intentId)
        .maybeSingle();
      if (!payment) return;

      const refunded = charge.amount_refunded ?? 0;
      await admin
        .from('payments')
        .update({
          refunded_cents: refunded,
          status: refunded >= payment.amount_cents ? 'refunded' : 'partially_refunded',
        })
        .eq('id', payment.id);

      await notify(admin, payment.business_id, {
        kind: 'payment.refunded',
        title: 'Refund processed',
        body: `${money(refunded)} was refunded.`,
        link: `/invoices/${payment.invoice_id}`,
        severity: 'warning',
      });
      return;
    }

    default:
      // Everything else is subscribed to but not acted on. Recorded, ignored.
      return;
  }
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function upsertPayment(admin: Admin, intent: Stripe.PaymentIntent, event: Stripe.Event) {
  const invoiceId = intent.metadata?.invoice_id;
  const businessId = intent.metadata?.business_id;
  if (!invoiceId || !businessId) return; // not one of ours

  // The invoice is re-read rather than trusted: the event says which one, the
  // database says whether it exists and who it belongs to.
  const { data: invoice } = await admin
    .from('invoices')
    .select('id, number, business_id, customer_id, total_cents')
    .eq('id', invoiceId)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!invoice) return;

  const status = statusFor(intent);
  const amount = intent.amount_received || intent.amount;

  const charge =
    typeof intent.latest_charge === 'object' && intent.latest_charge
      ? (intent.latest_charge as Stripe.Charge)
      : null;

  const { data: existing } = await admin
    .from('payments')
    .select('id, status')
    .eq('provider', 'stripe')
    .eq('provider_payment_id', intent.id)
    .maybeSingle();

  const values = {
    business_id: invoice.business_id,
    invoice_id: invoice.id,
    customer_id: invoice.customer_id,
    amount_cents: amount,
    method: 'card' as const,
    provider: 'stripe' as const,
    provider_payment_id: intent.id,
    status,
    provider_fee_cents:
      typeof charge?.balance_transaction === 'object' && charge.balance_transaction
        ? (charge.balance_transaction as Stripe.BalanceTransaction).fee
        : 0,
    platform_fee_cents:
      typeof intent.application_fee_amount === 'number' ? intent.application_fee_amount : 0,
    receipt_url: charge?.receipt_url ?? null,
    failure_reason: intent.last_payment_error?.message ?? null,
    paid_at: status === 'succeeded' ? new Date(event.created * 1000).toISOString() : null,
    paid_on: new Date(event.created * 1000).toISOString().slice(0, 10),
    reference: intent.id,
    notes: 'Paid online by card.',
  };

  if (existing) {
    await admin.from('payments').update(values).eq('id', existing.id);
  } else {
    await admin.from('payments').insert(values);
  }

  // The invoice's own totals are maintained by the trigger on `payments`, so
  // nothing here writes paid_cents by hand.

  if (status === 'succeeded' && existing?.status !== 'succeeded') {
    await notify(admin, invoice.business_id, {
      kind: 'payment.succeeded',
      title: `${money(amount)} received`,
      body: `Invoice ${invoice.number} was paid by card.`,
      link: `/invoices/${invoice.id}`,
      severity: 'success',
    });
  }

  if (status === 'failed' || intent.last_payment_error) {
    await notify(admin, invoice.business_id, {
      kind: 'payment.failed',
      title: `A payment on ${invoice.number} failed`,
      body: intent.last_payment_error?.message ?? 'The card was declined.',
      link: `/invoices/${invoice.id}`,
      severity: 'danger',
    });
  }
}

/** Tell the people who run the business. Uses the service role, so no session. */
async function notify(
  admin: Admin,
  businessId: string,
  notification: { kind: string; title: string; body: string; link: string; severity: string }
) {
  const { data: members } = await admin
    .from('team_members')
    .select('user_id')
    .eq('business_id', businessId)
    .in('role', ['owner', 'admin', 'manager', 'accountant'])
    .is('deleted_at', null)
    .not('user_id', 'is', null);

  if (!members?.length) return;

  await admin.from('notifications').insert(
    members.map((member) => ({
      business_id: businessId,
      user_id: member.user_id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      severity: notification.severity,
    }))
  );
}
