'use client';

import { useActionState } from 'react';
import { syncMailboxAction } from './actions';
import { idleState } from '@/lib/action-state';
import { FormError, FormSuccess } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/** "Sync now", with whatever it brought in reported underneath. */
export function SyncButton({ accountId }: { accountId: string }) {
  const [state, action] = useActionState(syncMailboxAction, idleState);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={accountId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
        Sync now
      </SubmitButton>
      {state.error ? <FormError>{state.error}</FormError> : null}
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}
    </form>
  );
}
