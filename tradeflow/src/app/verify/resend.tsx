'use client';

import { useActionState } from 'react';
import { resendConfirmationAction } from '../(auth)/actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ResendConfirmation() {
  const [state, action] = useActionState(resendConfirmationAction, idleState);

  return (
    <form action={action} className="space-y-3">
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Field label="Send another confirmation link" htmlFor="resend-email">
        <div className="flex gap-2">
          <Input
            id="resend-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@yourbusiness.com.au"
          />
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            Resend
          </SubmitButton>
        </div>
      </Field>
    </form>
  );
}
