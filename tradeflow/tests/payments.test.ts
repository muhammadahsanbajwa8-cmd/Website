import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Taking money.
 *
 * The parts that can be checked without Stripe on the other end: the fee
 * arithmetic, the webhook signature, and — read from the source — the rules
 * that keep a payment honest. The rules matter most: the amount must come from
 * the invoice rather than the request, only a webhook may declare a payment
 * succeeded, and a redelivered event must not credit twice.
 */

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const source = (path: string) => readFileSync(join(ROOT, 'src', path), 'utf8');

describe('the platform fee', () => {
  let fee: (amount: number, bp: number) => number;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_used_for_this';
    ({ platformFeeCents: fee } = await import('@/lib/payments/stripe'));
  });

  it('is nothing until the platform charges something', () => {
    // The default is zero, and the whole marketplace works at zero.
    expect(fee(100_00, 0)).toBe(0);
    expect(fee(100_00, -5)).toBe(0);
  });

  it('is basis points of the payment', () => {
    expect(fee(100_00, 100)).toBe(100); // 1% of $100 = $1
    expect(fee(2_035_00, 250)).toBe(5088); // 2.5% of $2,035 = $50.875, rounded up
  });

  it('rounds to a whole cent', () => {
    expect(Number.isInteger(fee(3_33, 175))).toBe(true);
    expect(fee(3_33, 175)).toBe(6);
  });

  it('never takes the whole payment', () => {
    // A fee that swallowed the payment would leave the business with nothing
    // and Stripe would refuse the charge anyway.
    expect(fee(100, 10_000)).toBe(99);
    expect(fee(1, 10_000)).toBe(0);
  });
});

describe('the webhook signature', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });

  const sign = (body: string, at: number, withSecret = secret) => {
    const signature = createHmac('sha256', withSecret).update(`${at}.${body}`).digest('hex');
    return `t=${at},v1=${signature}`;
  };

  let verify: (raw: string, signature: string | null) => unknown;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    ({ verifyWebhook: verify } = await import('@/lib/payments/stripe'));
  });

  it('accepts an event Stripe signed', () => {
    const now = Math.floor(Date.now() / 1000);
    const event = verify(payload, sign(payload, now)) as { id: string };
    expect(event.id).toBe('evt_1');
  });

  it('refuses a payload someone edited', () => {
    // The attack: change the amount, keep the signature.
    const now = Math.floor(Date.now() / 1000);
    const signature = sign(payload, now);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', amount: 1 });
    expect(() => verify(tampered, signature)).toThrow();
  });

  it('refuses a signature made with another secret', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => verify(payload, sign(payload, now, 'whsec_someone_else'))).toThrow();
  });

  it('refuses a replayed event', () => {
    // An hour old: Stripe's tolerance window has long passed.
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verify(payload, sign(payload, old))).toThrow();
  });

  it('refuses a request with no signature at all', () => {
    expect(() => verify(payload, null)).toThrow(/signature/i);
  });

  it('refuses everything when no secret is configured', () => {
    const kept = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = '';
    try {
      const now = Math.floor(Date.now() / 1000);
      expect(() => verify(payload, sign(payload, now))).toThrow(/STRIPE_WEBHOOK_SECRET/);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = kept;
    }
  });
});

describe('the amount is never the browser’s to decide', () => {
  const checkout = source('app/api/payments/checkout/route.ts');

  it('prices from the invoice row', () => {
    expect(checkout).toMatch(/amountCents: payable\.amount_due_cents/);
    // Nothing is read off the request except the token.
    const bodyReads = new Set([...checkout.matchAll(/body\.(\w+)/g)].map((m) => m[1]));
    expect([...bodyReads]).toEqual(['token']);
  });

  it('refuses an invoice that is settled, draft or cancelled', () => {
    expect(checkout).toMatch(/amount_due_cents <= 0/);
    // The definer function will not return a draft or cancelled invoice at all.
    expect(ALL_SQL).toMatch(/status not in \('draft', 'cancelled'\)/);
  });

  it('refuses when the business cannot take money yet', () => {
    expect(checkout).toMatch(/stripe_charges_enabled/);
  });

  it('does not hand the connected account id to the customer', () => {
    // public_invoice_payable carries the account id and the fee, so anon must
    // not be able to call it — the route calls it with the service role.
    expect(ALL_SQL).toMatch(/revoke all on function public_invoice_payable\(text\) from public/);
    const anonGrants = [...ALL_SQL.matchAll(/grant execute on function ([\w.]+)\([^)]*\) to ([^;]+);/gi)]
      .filter((m) => /anon/.test(m[2]))
      .map((m) => m[1]);
    expect(anonGrants).not.toContain('public_invoice_payable');
  });
});

describe('only the webhook may declare a payment succeeded', () => {
  const webhook = source('app/api/payments/webhook/route.ts');

  it('verifies the signature before reading anything', () => {
    const verifyAt = webhook.indexOf('verifyWebhook(');
    const insertAt = webhook.indexOf("from('payment_events')");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(insertAt);
  });

  it('reads the raw body, because parsing it would break the signature', () => {
    expect(webhook).toMatch(/await request\.text\(\)/);
    expect(webhook).not.toMatch(/await request\.json\(\)/);
  });

  it('records the event before acting on it, and treats a repeat as done', () => {
    expect(webhook).toMatch(/payment_events/);
    expect(webhook).toMatch(/23505/);
    expect(webhook).toMatch(/duplicate: true/);
    // The unique index is what actually enforces it.
    expect(ALL_SQL).toMatch(/payment_events_provider_event_uniq[\s\S]{0,120}\(provider, event_id\)/);
  });

  it('re-reads the invoice rather than trusting the event’s metadata alone', () => {
    expect(webhook).toMatch(/from\('invoices'\)[\s\S]{0,200}\.eq\('business_id', businessId\)/);
  });

  it('leaves the invoice totals to the trigger', () => {
    // Writing paid_cents here as well would double-count.
    expect(webhook).not.toMatch(/paid_cents:/);
  });

  it('answers 200 to a duplicate so Stripe stops retrying', () => {
    expect(webhook).toMatch(/received: true, duplicate: true/);
  });
});

describe('the database is the one that counts money', () => {
  it('credits an invoice only from a succeeded payment', () => {
    const recalc = ALL_SQL.slice(ALL_SQL.lastIndexOf('create or replace function recalc_invoice_payments'));
    expect(recalc).toMatch(/status = 'succeeded'/);
    expect(recalc).toMatch(/amount_cents - refunded_cents/);
  });

  it('keeps unsettled money out of revenue', () => {
    // Every payments sum in the dashboard filters on succeeded — otherwise an
    // abandoned checkout would show up as money received.
    // The last *definition*, not the last mention — a `grant` line comes after it.
    const dashboard = ALL_SQL.slice(ALL_SQL.lastIndexOf('create or replace function dashboard_summary'));
    const sums = dashboard.split('from payments p').slice(1).map((part) => part.slice(0, 300));
    expect(sums.length).toBe(3);
    for (const sum of sums) {
      expect(sum, `a payments sum without a status filter: ${sum.slice(0, 90)}`).toMatch(
        /p\.status = 'succeeded'/
      );
    }
  });

  it('cannot record the same provider payment twice', () => {
    expect(ALL_SQL).toMatch(/payments_provider_payment_uniq[\s\S]{0,160}provider_payment_id/);
  });
});

describe('no card details come near this application', () => {
  const stripeLib = source('lib/payments/stripe.ts');
  const files = ['lib/payments/stripe.ts', 'app/api/payments/checkout/route.ts', 'app/api/payments/webhook/route.ts'];

  it('uses Stripe’s hosted checkout', () => {
    expect(stripeLib).toMatch(/checkout\.sessions\.create/);
  });

  it('never names a card field anywhere in the payment code', () => {
    for (const file of files) {
      const text = source(file);
      expect(text, `${file} mentions a PAN field`).not.toMatch(/card_number|cardNumber|\bcvc\b|\bcvv\b/i);
    }
  });

  it('has no card columns in the schema', () => {
    expect(ALL_SQL).not.toMatch(/\b(card_number|cardnumber|cvc|cvv)\b/i);
  });

  it('puts the charge on the business’s own account, not the platform’s', () => {
    expect(stripeLib).toMatch(/stripeAccount: input\.connectedAccountId/);
    expect(stripeLib).toMatch(/application_fee_amount/);
  });
});
