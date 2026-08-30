'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signInAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function LoginForm({ next, confirmed }: { next?: string; confirmed?: boolean }) {
  const [state, action] = useActionState(signInAction, idleState);

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      {confirmed ? (
        <FormSuccess>Email confirmed. Sign in to get started.</FormSuccess>
      ) : null}
      <FormError>{state.error}</FormError>

      {next ? <input type="hidden" name="next" value={next} /> : null}

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

      <Field
        label={
          <span className="flex items-baseline justify-between gap-3">
            <span>Password</span>
            <Link
              href="/forgot-password"
              className="text-xs font-normal text-[var(--accent)] hover:underline"
            >
              Forgot it?
            </Link>
          </span>
        }
        htmlFor="password"
        error={state.fieldErrors?.password}
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
