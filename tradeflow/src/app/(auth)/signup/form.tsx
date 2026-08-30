'use client';

import { useActionState, useState } from 'react';
import { signUpAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/** Rough strength feedback. The rule that is actually enforced is in the schema. */
function strength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  return { score, label: labels[score] ?? 'Weak' };
}

export function SignUpForm({ invite, email }: { invite?: string; email?: string }) {
  const [state, action] = useActionState(signUpAction, idleState);
  const [password, setPassword] = useState('');
  const meter = strength(password);

  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      {invite ? <input type="hidden" name="invite" value={invite} /> : null}

      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName} required>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          placeholder="Sam Marsh"
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
        />
      </Field>

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={email}
          readOnly={Boolean(invite && email)}
          placeholder="you@yourbusiness.com.au"
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={state.fieldErrors?.password}
        hint="At least 10 characters, with a letter and a number."
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        {password ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-1 flex-1 gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-full flex-1 rounded-full transition-colors"
                  style={{
                    background:
                      i < meter.score
                        ? meter.score <= 2
                          ? 'var(--bad)'
                          : meter.score <= 3
                            ? 'var(--warn)'
                            : 'var(--ok)'
                        : 'var(--line-subtle)',
                  }}
                />
              ))}
            </div>
            <span className="w-20 shrink-0 text-right text-xs text-[var(--text-muted)]">
              {meter.label}
            </span>
          </div>
        ) : null}
      </Field>

      <Field
        label="Confirm password"
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
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
    </form>
  );
}
