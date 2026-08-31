import 'server-only';

import Stripe from 'stripe';
import { env } from '@/lib/env';

/**
 * Stripe, on a marketplace footing from the start.
 *
 * The money belongs to the business, not to this platform. Each business
 * connects its own Stripe account and the customer's payment is created
 * **on that account** — so funds settle to the trade business's bank, and the
 * platform never holds them. That is what `stripeAccount` on every call below
 * means, and it is the reason this is Connect rather than a single account
 * with a spreadsheet.
 *
 * The platform's own cut is `application_fee_amount`, computed from the
 * business's `platform_fee_bp`, which is zero until the platform charges
 * anything. Setting it later is a number in a column, not a rewrite — and if
 * the platform never charges, no fee is ever sent.
 *
 * Nothing here handles a card number. The customer is sent to Stripe's own
 * hosted Checkout; this application never sees, and could not store, a PAN.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!env.stripeSecretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Online payments are off until it is — everything else, ' +
        'including recording a payment that arrived by bank transfer, works without it.'
    );
  }
  if (!client) {
    client = new Stripe(env.stripeSecretKey, {
      // Pinned: an account-level API upgrade must never silently change the
      // shape of a webhook this code parses.
      apiVersion: '2026-08-26.dahlia',
      appInfo: { name: 'TradeFlow', version: '1.0.0' },
      // Overridable so the whole path can be exercised against a stand-in.
      ...(env.stripeBaseUrl
        ? {
            host: new URL(env.stripeBaseUrl).hostname,
            port: Number(new URL(env.stripeBaseUrl).port || 443),
            protocol: (new URL(env.stripeBaseUrl).protocol.replace(':', '') as 'http' | 'https'),
          }
        : {}),
    });
  }
  return client;
}

export const stripeConfigured = (): boolean => Boolean(env.stripeSecretKey);

/** What the platform takes from a payment. Zero unless the business is set up for it. */
export function platformFeeCents(amountCents: number, platformFeeBp: number): number {
  if (!platformFeeBp || platformFeeBp <= 0) return 0;
  const fee = Math.round((amountCents * platformFeeBp) / 10000);
  // Never take more than the payment, and never take the whole of a small one.
  return Math.max(0, Math.min(fee, amountCents - 1));
}

// --- connecting a business --------------------------------------------------

export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  /** Anything Stripe still wants before this account can take money. */
  outstanding: string[];
}

/**
 * Create the business's connected account.
 *
 * Express: Stripe hosts the onboarding and the identity checks, which is what
 * keeps this platform out of scope for holding that information.
 */
export async function createConnectedAccount(input: {
  businessId: string;
  businessName: string;
  email: string | null;
}): Promise<string> {
  const account = await stripe().accounts.create({
    type: 'express',
    country: 'AU',
    email: input.email ?? undefined,
    business_profile: { name: input.businessName, mcc: '1520' },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { business_id: input.businessId },
  });
  return account.id;
}

/** The link the owner follows to finish onboarding. Single use, short lived. */
export async function onboardingLink(accountId: string, businessId: string): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${env.appUrl}/settings/payments?refresh=1`,
    return_url: `${env.appUrl}/settings/payments?connected=1&b=${businessId}`,
  });
  return link.url;
}

/** Where the business manages payouts, disputes and its own details. */
export async function dashboardLink(accountId: string): Promise<string> {
  const link = await stripe().accounts.createLoginLink(accountId);
  return link.url;
}

export async function accountStatus(accountId: string): Promise<ConnectStatus> {
  const account = await stripe().accounts.retrieve(accountId);
  const requirements = account.requirements;
  return {
    accountId: account.id,
    chargesEnabled: Boolean(account.charges_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    outstanding: [
      ...(requirements?.currently_due ?? []),
      ...(requirements?.past_due ?? []),
    ],
  };
}

// --- taking a payment -------------------------------------------------------

export interface CheckoutInput {
  connectedAccountId: string;
  businessName: string;
  invoiceId: string;
  invoiceNumber: string;
  businessId: string;
  customerId: string | null;
  customerEmail: string | null;
  description: string;
  amountCents: number;
  platformFeeBp: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * A hosted Checkout session on the business's own account.
 *
 * `stripeAccount` puts the charge on their account, so the money is theirs and
 * the platform is not in the flow of funds. The invoice and business ids ride
 * along in metadata, which is what the webhook uses to find the row again —
 * never anything the browser sent back.
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<{ id: string; url: string }> {
  const fee = platformFeeCents(input.amountCents, input.platformFeeBp);

  const session = await stripe().checkout.sessions.create(
    {
      mode: 'payment',
      // Card plus the local rails an Australian customer expects.
      payment_method_types: ['card'],
      customer_email: input.customerEmail ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: input.amountCents,
            product_data: {
              name: `Invoice ${input.invoiceNumber}`,
              description: input.description.slice(0, 300),
            },
          },
        },
      ],
      payment_intent_data: {
        description: `${input.businessName} — invoice ${input.invoiceNumber}`,
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        metadata: {
          invoice_id: input.invoiceId,
          business_id: input.businessId,
          customer_id: input.customerId ?? '',
        },
      },
      metadata: {
        invoice_id: input.invoiceId,
        business_id: input.businessId,
        customer_id: input.customerId ?? '',
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
    { stripeAccount: input.connectedAccountId }
  );

  if (!session.url) throw new Error('Stripe did not return a checkout URL.');
  return { id: session.id, url: session.url };
}

/**
 * Verify a webhook came from Stripe.
 *
 * The raw body must be the bytes as received — parsing and re-serialising it
 * changes the signature and every event would be rejected.
 */
export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  if (!env.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set, so no webhook can be trusted.');
  }
  if (!signature) {
    throw new Error('No Stripe signature on the request.');
  }
  return stripe().webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
}

/** Refund a payment on the business's own account. */
export async function refundPayment(
  connectedAccountId: string,
  paymentIntentId: string,
  amountCents?: number
): Promise<{ id: string; amountCents: number; status: string }> {
  const refund = await stripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amountCents ? { amount: amountCents } : {}),
      // The platform's fee goes back too, so a refunded job costs the business
      // nothing rather than leaving them out of pocket for our cut.
      refund_application_fee: true,
    },
    { stripeAccount: connectedAccountId }
  );
  return { id: refund.id, amountCents: refund.amount, status: refund.status ?? 'pending' };
}
