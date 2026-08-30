'use client';

import { useActionState } from 'react';
import { forgotPasswordAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, idleState);

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@yourbusiness.com.au"
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
