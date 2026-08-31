'use client';

import { useActionState, useRef, useState } from 'react';
import { saveBusinessSettingsAction } from './actions';
import { idleState } from '@/lib/action-state';
import { AU_STATES, formatBsb } from '@/lib/format';
import { BUSINESS_TYPES } from '@/lib/domain';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  Select,
  Textarea,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { Business } from '@/lib/database.types';

export function BusinessSettingsForm({ business }: { business: Business }) {
  const [state, action] = useActionState(saveBusinessSettingsAction, idleState);
  const [logoName, setLogoName] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Card>
        <CardHeader title="Your business" description="This is what appears on every document." />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Business name" htmlFor="name" error={state.fieldErrors?.name} required>
              <Input id="name" name="name" required defaultValue={business.name} />
            </Field>
            <Field label="Trade" htmlFor="businessType">
              <Select id="businessType" name="businessType" defaultValue={business.business_type ?? ''}>
                <option value="">Not set</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="ABN" htmlFor="abn" error={state.fieldErrors?.abn}>
              <Input id="abn" name="abn" inputMode="numeric" defaultValue={business.abn ?? ''} />
            </Field>
            <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoCapitalize="none"
                defaultValue={business.email ?? ''}
              />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={business.phone ?? ''} />
            </Field>
          </div>

          <Field label="Street address" htmlFor="addressLine1">
            <Input id="addressLine1" name="addressLine1" defaultValue={business.address_line1 ?? ''} />
          </Field>
          <Field label="Address line 2" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" defaultValue={business.address_line2 ?? ''} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-[1fr_8rem_8rem]">
            <Field label="Suburb" htmlFor="suburb">
              <Input id="suburb" name="suburb" defaultValue={business.suburb ?? ''} />
            </Field>
            <Field label="State" htmlFor="state">
              <Select id="state" name="state" defaultValue={business.state ?? 'NSW'}>
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
                defaultValue={business.postcode ?? ''}
              />
            </Field>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">Logo</span>
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-[0.625rem] border-2 border-dashed border-[var(--line-default)] py-5 text-sm font-medium text-[var(--text-default)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Icon path={icons.upload} size={18} />
              {logoName ?? (business.logo_path ? 'Replace the logo' : 'Add a logo')}
            </button>
            <input
              ref={logoRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? null)}
            />
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              PNG or JPEG for the PDF masthead. An SVG is accepted but the PDF falls back to your
              business name, because the PDF engine cannot draw one.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Money" description="Defaults for new quotes and invoices." />
        <CardBody className="space-y-5">
          <Checkbox
            name="gstRegistered"
            defaultChecked={business.gst_registered}
            label="Registered for GST"
            description="Adds 10% GST and prints invoices as tax invoices. Turn it off and no GST is added anywhere."
          />

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Payment terms" htmlFor="defaultPaymentTermsDays" hint="Days from the invoice date.">
              <Input
                id="defaultPaymentTermsDays"
                name="defaultPaymentTermsDays"
                type="number"
                min={0}
                max={365}
                defaultValue={business.default_payment_terms_days}
              />
            </Field>
            <Field label="Quotes valid for" htmlFor="quoteValidityDays" hint="Days.">
              <Input
                id="quoteValidityDays"
                name="quoteValidityDays"
                type="number"
                min={1}
                max={365}
                defaultValue={business.quote_validity_days}
              />
            </Field>
            <Field label="Default markup" htmlFor="defaultMarkupPercent" hint="Per cent, on new estimates.">
              <Input
                id="defaultMarkupPercent"
                name="defaultMarkupPercent"
                type="number"
                step="0.5"
                min={0}
                defaultValue={business.default_markup_bp / 100}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Account name" htmlFor="bankAccountName">
              <Input
                id="bankAccountName"
                name="bankAccountName"
                defaultValue={business.bank_account_name ?? ''}
              />
            </Field>
            <Field label="BSB" htmlFor="bankBsb" error={state.fieldErrors?.bankBsb}>
              <Input
                id="bankBsb"
                name="bankBsb"
                inputMode="numeric"
                defaultValue={formatBsb(business.bank_bsb)}
                placeholder="062-000"
              />
            </Field>
            <Field label="Account number" htmlFor="bankAccountNumber">
              <Input
                id="bankAccountNumber"
                name="bankAccountNumber"
                inputMode="numeric"
                defaultValue={business.bank_account_number ?? ''}
              />
            </Field>
          </div>

          <p className="text-sm text-[var(--text-muted)]">
            These print on every invoice, with the invoice number as the payment reference.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your terms"
          description="Write these once. Every new quote and invoice starts with them, and they print at the end of what the customer receives. Changing them here never alters a quote you have already sent."
        />
        <CardBody className="space-y-5">
          <Field
            label="How you expect to be paid"
            htmlFor="defaultPaymentTerms"
            hint="One or two lines, shown just above the terms."
          >
            <Textarea
              id="defaultPaymentTerms"
              name="defaultPaymentTerms"
              rows={2}
              defaultValue={business.default_payment_terms ?? ''}
              placeholder="Payment within 14 days of the invoice date. 30% deposit before work starts."
            />
          </Field>

          <Field
            label="Terms on a quote"
            htmlFor="defaultQuoteTerms"
            hint="What is and is not included, how variations are handled, how long the price holds."
          >
            <Textarea
              id="defaultQuoteTerms"
              name="defaultQuoteTerms"
              rows={6}
              defaultValue={business.default_quote_terms ?? ''}
              placeholder="Variations to the scope are quoted separately in writing before that work starts."
            />
          </Field>

          <Field
            label="Terms on an invoice"
            htmlFor="defaultInvoiceTerms"
            hint="Anything the customer should read when the bill arrives."
          >
            <Textarea
              id="defaultInvoiceTerms"
              name="defaultInvoiceTerms"
              rows={3}
              defaultValue={business.default_invoice_terms ?? ''}
              placeholder="Please quote the invoice number with your payment."
            />
          </Field>
        </CardBody>
      </Card>

      <SubmitButton size="lg" pendingLabel="Saving…">
        Save settings
      </SubmitButton>
    </form>
  );
}
