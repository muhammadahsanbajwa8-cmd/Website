import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCheckoutSession, stripeConfigured } from '@/lib/payments/stripe';
import { env } from '@/lib/env';

/**
 * Start a payment.
 *
 * The customer arrives here from their invoice page with nothing but the share
 * token. Two things follow from that:
 *
 *   - the token is the credential, checked by a definer function that will not
 *     return a draft or cancelled invoice;
 *   - **the amount comes from the invoice row, never from the request.** The
 *     browser cannot say what to charge. If it could, a customer could pay one
 *     cent and mark the job settled.
 *
 * The session is created on the business's own connected account, so the money
 * is theirs. Nothing here sees a card: Stripe's hosted page does that.
 */

export const dynamic = 'force-dynamic';

interface Payable {
  invoice_id: string;
  business_id: string;
  customer_id: string | null;
  number: string;
  title: string;
  amount_due_cents: number;
  status: string;
  business_name: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  platform_fee_bp: number;
  customer_email: string | null;
}

const problem = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
  let token: string;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token : '';
  } catch {
    return problem('That request could not be read.');
  }
  if (!token) return problem('This payment link is incomplete.');

  if (!stripeConfigured()) {
    return problem(
      'Online payment is not switched on for this site. Pay by bank transfer using the details on the invoice.',
      503
    );
  }

  const admin = createAdminClient();
  const { data } = await admin.rpc('public_invoice_payable', { p_token: token });
  const payable = data as unknown as Payable | null;

  if (!payable) return problem('That invoice could not be found, or is no longer payable.', 404);

  if (payable.amount_due_cents <= 0) {
    return problem('This invoice is already settled — there is nothing left to pay.');
  }
  if (!payable.stripe_account_id || !payable.stripe_charges_enabled) {
    return problem(
      `${payable.business_name} has not finished setting up card payments. Pay by bank transfer using the details on the invoice, or contact them.`,
      503
    );
  }

  try {
    const session = await createCheckoutSession({
      connectedAccountId: payable.stripe_account_id,
      businessName: payable.business_name,
      businessId: payable.business_id,
      invoiceId: payable.invoice_id,
      invoiceNumber: payable.number,
      customerId: payable.customer_id,
      customerEmail: payable.customer_email,
      description: payable.title,
      // From the row. Not from the request.
      amountCents: payable.amount_due_cents,
      platformFeeBp: payable.platform_fee_bp,
      successUrl: `${env.appUrl}/i/${token}?paid=1`,
      cancelUrl: `${env.appUrl}/i/${token}?cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    // Recorded so the business can see a payment attempt failed before it began.
    await admin.from('payment_events').insert({
      business_id: payable.business_id,
      provider: 'stripe',
      event_id: `checkout_failed_${payable.invoice_id}_${Date.now()}`,
      event_type: 'checkout.create_failed',
      payload: { invoice_id: payable.invoice_id, error: detail } as unknown as Record<string, never>,
      handled: true,
      error: detail,
    });

    return problem(
      'We could not start the payment. Please try again, or pay by bank transfer using the details on the invoice.',
      502
    );
  }
}
