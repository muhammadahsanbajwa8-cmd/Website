'use client';

import { useActionState } from 'react';
import { updateMyDetailsAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { AU_STATES } from '@/lib/format';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export interface AccountDefaults {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
}

/**
 * Their details, editable by them.
 *
 * The email here is the one the business sends reports and invoices to, which
 * is why it is worth letting a customer correct it themselves: a wrong address
 * on file is the commonest reason a report never arrives.
 */
export function AccountForm({
  defaults,
  businessName,
}: {
  defaults: AccountDefaults;
  businessName: string;
}) {
  const [state, action] = useActionState(updateMyDetailsAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError>{state.error}</FormError>
      {state.ok ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Card>
        <CardHeader
          title="Your details"
          description={`What ${businessName} has on file for you. Reports and invoices go to the email below.`}
        />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" htmlFor="fullName">
              <Input id="fullName" name="fullName" defaultValue={defaults.fullName} />
            </Field>

            <Field
              label="Email"
              htmlFor="email"
              error={state.fieldErrors?.email}
              hint="Where reports and invoices are sent."
            >
              <Input
                id="email"
                name="email"
                type="email"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={defaults.email}
                aria-invalid={Boolean(state.fieldErrors?.email)}
              />
            </Field>
          </div>

          <Field label="Phone" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={defaults.phone}
              placeholder="0412 345 678"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Address" description="Where the work usually is." />
        <CardBody className="space-y-5">
          <Field label="Street address" htmlFor="addressLine1">
            <Input id="addressLine1" name="addressLine1" defaultValue={defaults.addressLine1} />
          </Field>

          <Field label="Unit, level or building" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" defaultValue={defaults.addressLine2} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Suburb" htmlFor="suburb">
              <Input id="suburb" name="suburb" defaultValue={defaults.suburb} />
            </Field>

            <Field label="State" htmlFor="state">
              <Select id="state" name="state" defaultValue={defaults.state}>
                <option value="">—</option>
                {AU_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Postcode" htmlFor="postcode">
              <Input
                id="postcode"
                name="postcode"
                inputMode="numeric"
                maxLength={4}
                defaultValue={defaults.postcode}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <SubmitButton size="lg" pendingLabel="Saving…">
        Save my details
      </SubmitButton>
    </form>
  );
}
