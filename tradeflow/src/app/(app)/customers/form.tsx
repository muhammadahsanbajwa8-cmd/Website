'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { saveCustomerAction } from './actions';
import { idleState } from '@/lib/action-state';
import { AU_STATES } from '@/lib/format';
import { Card, CardBody, CardHeader, Field, FormError, Input, Select, Textarea, buttonClass } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { Customer } from '@/lib/database.types';

export function CustomerForm({ customer }: { customer?: Customer }) {
  const [state, action] = useActionState(saveCustomerAction, idleState);
  const cancelHref = customer ? `/customers/${customer.id}` : '/customers';

  return (
    <form action={action} className="space-y-5" noValidate>
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="Who they are" />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={state.fieldErrors?.name} required>
              <Input
                id="name"
                name="name"
                required
                autoFocus={!customer}
                defaultValue={customer?.name ?? ''}
                placeholder="Dana Whitfield"
                aria-invalid={Boolean(state.fieldErrors?.name)}
              />
            </Field>

            <Field label="Company" htmlFor="company" error={state.fieldErrors?.company}>
              <Input
                id="company"
                name="company"
                defaultValue={customer?.company ?? ''}
                placeholder="Harbourside Property Group"
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={customer?.email ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.email)}
              />
            </Field>

            <Field label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" defaultValue={customer?.phone ?? ''} />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="ABN"
              htmlFor="abn"
              error={state.fieldErrors?.abn}
              hint="Optional. Checked against the ATO formula if you enter one."
            >
              <Input
                id="abn"
                name="abn"
                inputMode="numeric"
                defaultValue={customer?.abn ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.abn)}
              />
            </Field>

            <Field
              label="Contact person"
              htmlFor="contactPerson"
              error={state.fieldErrors?.contactPerson}
              hint="Who you actually deal with, if different."
            >
              <Input
                id="contactPerson"
                name="contactPerson"
                defaultValue={customer?.contact_person ?? ''}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where they are" description="Used on quotes and invoices." />
        <CardBody className="space-y-5">
          <Field label="Street address" htmlFor="addressLine1" error={state.fieldErrors?.addressLine1}>
            <Input
              id="addressLine1"
              name="addressLine1"
              autoComplete="street-address"
              defaultValue={customer?.address_line1 ?? ''}
            />
          </Field>

          <Field label="Address line 2" htmlFor="addressLine2" error={state.fieldErrors?.addressLine2}>
            <Input id="addressLine2" name="addressLine2" defaultValue={customer?.address_line2 ?? ''} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-[1fr_8rem_8rem]">
            <Field label="Suburb" htmlFor="suburb" error={state.fieldErrors?.suburb}>
              <Input id="suburb" name="suburb" defaultValue={customer?.suburb ?? ''} />
            </Field>

            <Field label="State" htmlFor="state" error={state.fieldErrors?.state}>
              <Select id="state" name="state" defaultValue={customer?.state ?? 'NSW'}>
                {AU_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Postcode" htmlFor="postcode" error={state.fieldErrors?.postcode}>
              <Input
                id="postcode"
                name="postcode"
                inputMode="numeric"
                maxLength={4}
                defaultValue={customer?.postcode ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.postcode)}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notes" description="Anything worth remembering. Only your team sees this." />
        <CardBody>
          <Field label="" htmlFor="notes" error={state.fieldErrors?.notes}>
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={customer?.notes ?? ''}
              placeholder="Prefers a call to an email. Gate code 4821. Invoices go to accounts@…"
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {customer ? 'Save changes' : 'Create customer'}
        </SubmitButton>
        <Link href={cancelHref} className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
