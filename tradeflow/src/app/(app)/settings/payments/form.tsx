'use client';

import { useActionState } from 'react';
import { connectPaymentsAction, refreshPaymentsAction } from './actions';
import { idleState } from '@/lib/action-state';
import { Badge, Card, CardBody, CardHeader, FormError, FormSuccess } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { formatDate } from '@/lib/format';

/**
 * Where a business connects its own Stripe account.
 *
 * Three states, and the copy says plainly which one they are in: not started,
 * started but not finished, and ready.
 */
export function ConnectPanel({
  configured,
  started,
  ready,
  detailsSubmitted,
  accountId,
  connectedAt,
  canEdit,
}: {
  configured: boolean;
  started: boolean;
  ready: boolean;
  detailsSubmitted: boolean;
  accountId: string | null;
  connectedAt: string | null;
  canEdit: boolean;
}) {
  const [connectState, connect] = useActionState(connectPaymentsAction, idleState);
  const [refreshState, refresh] = useActionState(refreshPaymentsAction, idleState);

  return (
    <Card>
      <CardHeader
        title="Your payment account"
        description="Stripe holds the account and does the identity checks. We only store which account is yours."
        action={
          ready ? (
            <Badge tone="success">Ready</Badge>
          ) : started ? (
            <Badge tone="warning">Not finished</Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )
        }
      />

      <CardBody className="space-y-4">
        <FormError>{connectState.error ?? refreshState.error}</FormError>
        {refreshState.ok && refreshState.message ? (
          <FormSuccess>{refreshState.message}</FormSuccess>
        ) : null}

        {ready ? (
          <p className="text-sm text-[var(--text-muted)]">
            Card payments are on. Every invoice you send now carries a <strong>Pay now</strong>{' '}
            button, and the money lands in your own account
            {connectedAt ? `, connected ${formatDate(connectedAt)}` : ''}.
          </p>
        ) : started ? (
          <p className="text-sm text-[var(--text-muted)]">
            {detailsSubmitted
              ? 'Stripe has your details and is reviewing them. This is usually quick.'
              : 'The setup was started but not finished. Pick up where you left off — Stripe keeps what you have already entered.'}
          </p>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            You will need your ABN, your bank details, and identification. It takes about five
            minutes. Until then, invoices still go out and you can record a bank transfer by hand
            when it arrives.
          </p>
        )}

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <form action={connect}>
              <SubmitButton disabled={!configured} pendingLabel="Taking you to Stripe…">
                {ready ? 'Update your details' : started ? 'Finish setting up' : 'Connect an account'}
              </SubmitButton>
            </form>

            {started ? (
              <form action={refresh}>
                <SubmitButton variant="secondary" pendingLabel="Checking…">
                  Check again
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Only an owner or admin can connect the payment account.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
