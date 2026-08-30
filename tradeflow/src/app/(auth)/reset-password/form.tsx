'use client';

import { useActionState } from 'react';
import { resetPasswordAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, idleState);

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      <FormError>{state.error}</FormError>

      <Field
        label="New password"
        htmlFor="password"
        error={state.fieldErrors?.password}
        hint="At least 10 characters, with a letter and a number."
        required
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={state.fieldErrors?.confirmPassword}
        required
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Saving…">
        Set password and sign in
      </SubmitButton>
    </form>
  );
}
