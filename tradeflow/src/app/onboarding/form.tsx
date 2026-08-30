'use client';

import { useActionState } from 'react';
import { createBusinessAction } from './actions';
import { idleState } from '@/lib/action-state';
import { AU_STATES } from '@/lib/format';
import { BUSINESS_TYPES } from '@/lib/domain';
import { Checkbox, Field, FormError, Input, Select } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action] = useActionState(createBusinessAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError>{state.error}</FormError>

      <Field label="Business name" htmlFor="name" error={state.fieldErrors?.name} required>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          placeholder="Ironbark Building Services"
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Trade" htmlFor="businessType" error={state.fieldErrors?.businessType}>
          <Select id="businessType" name="businessType" defaultValue="">
            <option value="">Choose a trade…</option>
            {BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="ABN"
          htmlFor="abn"
          error={state.fieldErrors?.abn}
          hint="11 digits. Checked against the ATO formula."
        >
          <Input
            id="abn"
            name="abn"
            inputMode="numeric"
            placeholder="51 824 753 556"
            aria-invalid={Boolean(state.fieldErrors?.abn)}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business email" htmlFor="email" error={state.fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultEmail}
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" placeholder="0400 123 456" />
        </Field>
      </div>

      <Field label="Street address" htmlFor="addressLine1" error={state.fieldErrors?.addressLine1}>
        <Input id="addressLine1" name="addressLine1" placeholder="12 Forge Lane" autoComplete="street-address" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Suburb" htmlFor="suburb" error={state.fieldErrors?.suburb}>
          <Input id="suburb" name="suburb" placeholder="Marrickville" />
        </Field>

        <Field label="State" htmlFor="state" error={state.fieldErrors?.state}>
          <Select id="state" name="state" defaultValue="NSW" className="w-full sm:w-28">
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
            placeholder="2204"
            className="w-full sm:w-28"
            aria-invalid={Boolean(state.fieldErrors?.postcode)}
          />
        </Field>
      </div>

      <div className="rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-4">
        <Checkbox
          name="gstRegistered"
          defaultChecked
          label="Registered for GST"
          description="Adds 10% GST to quotes and invoices and prints them as tax invoices. Turn it off and no GST is added anywhere."
        />

        <div className="mt-4 max-w-[16rem]">
          <Field
            label="Default payment terms"
            htmlFor="paymentTermsDays"
            error={state.fieldErrors?.paymentTermsDays}
            hint="Days from the invoice date."
          >
            <Input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              defaultValue={14}
            />
          </Field>
        </div>
      </div>

      <SubmitButton size="lg" className="w-full" pendingLabel="Setting up…">
        Create business
      </SubmitButton>
    </form>
  );
}
