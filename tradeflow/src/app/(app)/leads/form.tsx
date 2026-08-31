'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveLeadAction } from '../field/actions';
import { idleState } from '@/lib/action-state';
import { LEAD_STATUSES } from '@/lib/domain';
import { centsToInput } from '@/lib/money';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  Input,
  MoneyInput,
  Select,
  Textarea,
  buttonClass,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { CustomerOption } from '@/lib/pickers';
import type { Lead } from '@/lib/database.types';

export function LeadForm({ lead, customers }: { lead?: Lead; customers: CustomerOption[] }) {
  const [state, action] = useActionState(saveLeadAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      {lead ? <input type="hidden" name="id" value={lead.id} /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="Who called" />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={state.fieldErrors?.name} required>
              <Input id="name" name="name" required autoFocus={!lead} defaultValue={lead?.name ?? ''} />
            </Field>
            <Field label="Company" htmlFor="company">
              <Input id="company" name="company" defaultValue={lead?.company ?? ''} />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={lead?.phone ?? ''} />
            </Field>
            <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoCapitalize="none"
                defaultValue={lead?.email ?? ''}
              />
            </Field>
          </div>

          <Field label="How did they find you" htmlFor="source">
            <Input
              id="source"
              name="source"
              defaultValue={lead?.source ?? ''}
              placeholder="Word of mouth, Google, repeat customer, sign on the fence"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The work" />
        <CardBody className="space-y-5">
          <Field label="What they want" htmlFor="description">
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={lead?.description ?? ''}
              placeholder="Rebuild the front elevation brickwork. Wants it done before Christmas."
            />
          </Field>

          <Field label="Site address" htmlFor="siteAddress">
            <Input id="siteAddress" name="siteAddress" defaultValue={lead?.site_address ?? ''} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Rough value" htmlFor="estimatedValue" hint="Your gut feel, ex GST.">
              <MoneyInput
                id="estimatedValue"
                name="estimatedValue"
                defaultValue={
                  lead?.estimated_value_cents ? centsToInput(lead.estimated_value_cents) : ''
                }
              />
            </Field>

            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={lead?.status ?? 'new'}>
                {LEAD_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Follow up on" htmlFor="nextFollowUpAt">
              <Input
                id="nextFollowUpAt"
                name="nextFollowUpAt"
                type="date"
                defaultValue={lead?.next_follow_up_at ?? ''}
              />
            </Field>
          </div>

          {customers.length > 0 ? (
            <Field
              label="Existing customer"
              htmlFor="customerId"
              hint="If this is repeat work from someone already on your books."
            >
              <Select id="customerId" name="customerId" defaultValue={lead?.customer_id ?? ''}>
                <option value="">New customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {lead?.status === 'lost' || lead ? (
            <Field label="If lost, why" htmlFor="lostReason">
              <Input id="lostReason" name="lostReason" defaultValue={lead?.lost_reason ?? ''} />
            </Field>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {lead ? 'Save lead' : 'Add lead'}
        </SubmitButton>
        <Link href={lead ? `/leads/${lead.id}` : '/leads'} className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
