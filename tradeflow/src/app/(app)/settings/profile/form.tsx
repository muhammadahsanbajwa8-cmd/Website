'use client';

import { useActionState } from 'react';
import { saveProfileAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Card, CardBody, Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action] = useActionState(saveProfileAction, idleState);

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-5" noValidate>
          <FormError>{state.error}</FormError>
          {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

          <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName} required>
            <Input id="fullName" name="fullName" required defaultValue={fullName} autoComplete="name" />
          </Field>

          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={phone} autoComplete="tel" />
          </Field>

          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}
