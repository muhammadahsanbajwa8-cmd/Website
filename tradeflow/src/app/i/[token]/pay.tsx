'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/format';

/**
 * Pay now.
 *
 * The button asks the server to start a session and then hands the customer to
 * Stripe. It sends only the token: the amount is read from the invoice on the
 * server, so nothing here can decide what is charged.
 *
 * Every failure says what to do next, because the alternative — a customer
 * staring at a spinner — means a phone call to the business.
 */
export function PayNow({
  token,
  amountCents,
  businessName,
  paid,
  cancelled,
}: {
  token: string;
  amountCents: number;
  businessName: string;
  paid: boolean;
  cancelled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (paid) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--good)]/30 bg-[var(--good)]/10 p-5">
        <p className="font-medium text-[var(--text-strong)]">Thank you — your payment went through.</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {businessName} has been notified. A receipt is on its way to your email. If this page still
          shows a balance, give it a moment and refresh — the bank confirms it a few seconds behind.
        </p>
      </div>
    );
  }

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const result = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !result.url) {
        setError(result.error ?? 'We could not start the payment. Please try again in a moment.');
        setBusy(false);
        return;
      }
      window.location.href = result.url;
    } catch {
      setError(
        'We could not reach the payment page. Check your connection and try again, or pay by bank transfer using the details below.'
      );
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-muted)]">Amount due</p>
          <p className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] tabular-nums">
            {formatMoney(amountCents)}
          </p>
        </div>

        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[0.625rem] bg-[var(--accent)] px-5 py-2.5 text-base font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? 'Taking you to the payment page…' : 'Pay now'}
        </button>
      </div>

      {cancelled && !error ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          The payment was cancelled and nothing has been charged. You can try again whenever you like.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-[0.5rem] bg-[var(--bad)]/10 px-3 py-2 text-sm text-[var(--bad)]">
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Card details are entered on Stripe&rsquo;s secure page. {businessName} and this site never
        see your card number.
      </p>
    </div>
  );
}
