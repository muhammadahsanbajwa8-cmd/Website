'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { createRequestAction } from '../../actions';
import { idleState } from '@/lib/action-state';
import {
  ButtonLink,
  Card,
  CardBody,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export interface ServiceChoice {
  id: string;
  name: string;
  priceLabel: string | null;
}

/**
 * Asking for work.
 *
 * Four fields, one of them required. Anything more and the form starts doing
 * the business's job of working out what is needed — that conversation happens
 * after, and it happens with a person.
 */
export function RequestForm({
  services,
  businessName,
  defaultAddress,
  preselected,
  todayIso,
}: {
  services: ServiceChoice[];
  businessName: string;
  defaultAddress: string;
  preselected?: string;
  todayIso: string;
}) {
  const [state, action] = useActionState(createRequestAction, idleState);

  if (state.ok) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <FormSuccess>{state.message}</FormSuccess>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/portal/bookings">See your bookings</ButtonLink>
            <ButtonLink href="/portal" variant="secondary">
              Back to home
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError>{state.error}</FormError>

      <Card>
        <CardBody className="space-y-5">
          {services.length > 0 ? (
            <Field
              label="What do you need?"
              htmlFor="serviceId"
              hint="Not sure which one? Leave it on “Something else” and describe it below."
            >
              <Select id="serviceId" name="serviceId" defaultValue={preselected ?? ''}>
                <option value="">Something else</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {service.priceLabel ? ` — ${service.priceLabel}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field
            label="Tell us about the work"
            htmlFor="description"
            error={state.fieldErrors?.description}
            hint="A sentence or two is plenty. What is wrong, or what you would like done."
            required
          >
            <Textarea
              id="description"
              name="description"
              rows={5}
              required
              autoFocus
              placeholder="The hot water has stopped in the upstairs bathroom — no water at all from the hot tap since Tuesday."
              aria-invalid={Boolean(state.fieldErrors?.description)}
            />
          </Field>

          <Field
            label="Where is it?"
            htmlFor="siteAddress"
            hint="Leave blank to use the address on your account."
          >
            <Input
              id="siteAddress"
              name="siteAddress"
              defaultValue=""
              placeholder={defaultAddress || '12 Marsden Street, Parramatta NSW 2150'}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="When suits you?"
              htmlFor="preferredDate"
              error={state.fieldErrors?.preferredDate}
              hint="A preference, not a booking — they will confirm."
            >
              <Input id="preferredDate" name="preferredDate" type="date" min={todayIso} />
            </Field>

            <Field label="Time of day" htmlFor="preferredWindow">
              <Select id="preferredWindow" name="preferredWindow" defaultValue="">
                <option value="">Any time</option>
                <option value="Morning">Morning</option>
                <option value="Afternoon">Afternoon</option>
                <option value="Outside business hours">Outside business hours</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="lg" pendingLabel="Sending…">
          Send to {businessName}
        </SubmitButton>
        <Link
          href="/portal/bookings"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
