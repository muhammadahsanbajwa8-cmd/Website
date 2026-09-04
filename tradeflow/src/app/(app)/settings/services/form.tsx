'use client';

import { useActionState, useState } from 'react';
import { saveServiceAction } from './actions';
import { idleState } from '@/lib/action-state';
import { centsToInput } from '@/lib/money';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  MoneyInput,
  Textarea,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { Service } from '@/lib/database.types';

/**
 * Adding or changing one service.
 *
 * Collapsed until asked for, because most visits to this page are to read the
 * list rather than to change it.
 */
export function ServiceForm({ service, count }: { service?: Service; count: number }) {
  const [state, action] = useActionState(saveServiceAction, idleState);
  const [open, setOpen] = useState(Boolean(service));

  if (!service && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--line-strong)] px-4 py-4 text-sm font-medium text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <Icon path={icons.plus} size={17} />
        Add a service
      </button>
    );
  }

  return (
    <Card>
      <CardHeader
        title={service ? `Edit ${service.name}` : 'Add a service'}
        description="This is what your customers read in their portal."
      />
      <CardBody>
        <form action={action} className="space-y-5" noValidate>
          {service ? <input type="hidden" name="id" value={service.id} /> : null}
          <input
            type="hidden"
            name="position"
            value={service ? service.position : count}
          />

          <FormError>{state.error}</FormError>
          {state.ok ? <FormSuccess>{state.message}</FormSuccess> : null}

          <Field label="Name" htmlFor={`name-${service?.id ?? 'new'}`} error={state.fieldErrors?.name} required>
            <Input
              id={`name-${service?.id ?? 'new'}`}
              name="name"
              required
              defaultValue={service?.name ?? ''}
              placeholder="Blocked drains"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
          </Field>

          <Field
            label="What it covers"
            htmlFor={`description-${service?.id ?? 'new'}`}
            hint="A couple of sentences in plain words. What you do, and what is included."
          >
            <Textarea
              id={`description-${service?.id ?? 'new'}`}
              name="description"
              rows={3}
              defaultValue={service?.description ?? ''}
              placeholder="We clear blocked sinks, toilets and stormwater lines, and put a camera down if it keeps coming back."
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              label="From"
              htmlFor={`priceFrom-${service?.id ?? 'new'}`}
              error={state.fieldErrors?.priceFrom}
              hint="Leave blank for “priced on the job”."
            >
              <MoneyInput
                id={`priceFrom-${service?.id ?? 'new'}`}
                name="priceFrom"
                defaultValue={
                  service?.price_from_cents ? centsToInput(service.price_from_cents) : ''
                }
              />
            </Field>

            <Field label="Price note" htmlFor={`priceNote-${service?.id ?? 'new'}`}>
              <Input
                id={`priceNote-${service?.id ?? 'new'}`}
                name="priceNote"
                defaultValue={service?.price_note ?? ''}
                placeholder="incl. GST, first hour"
              />
            </Field>

            <Field label="Typical wait" htmlFor={`leadTime-${service?.id ?? 'new'}`}>
              <Input
                id={`leadTime-${service?.id ?? 'new'}`}
                name="leadTime"
                defaultValue={service?.lead_time ?? ''}
                placeholder="Usually within 48 hours"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Saving…">
              {service ? 'Save changes' : 'Add service'}
            </SubmitButton>
            {!service ? (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
