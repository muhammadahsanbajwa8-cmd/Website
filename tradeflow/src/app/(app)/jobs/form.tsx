'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveJobAction } from './actions';
import { idleState } from '@/lib/action-state';
import { AU_STATES } from '@/lib/format';
import { JOB_STATUSES } from '@/lib/domain';
import { centsToInput } from '@/lib/money';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  Input,
  MoneyInput,
  Select,
  Textarea,
  buttonClass,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { Job } from '@/lib/database.types';

export interface JobFormCustomer {
  id: string;
  name: string;
  company: string | null;
  address_line1: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

export function JobForm({
  job,
  customers,
  team,
  assignedIds = [],
  defaultCustomerId,
}: {
  job?: Job;
  customers: JobFormCustomer[];
  team: { id: string; full_name: string | null; email: string; role: string }[];
  assignedIds?: string[];
  defaultCustomerId?: string;
}) {
  const [state, action] = useActionState(saveJobAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      {job ? <input type="hidden" name="id" value={job.id} /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="The job" />
        <CardBody className="space-y-5">
          <Field label="Job name" htmlFor="name" error={state.fieldErrors?.name} required>
            <Input
              id="name"
              name="name"
              required
              autoFocus={!job}
              defaultValue={job?.name ?? ''}
              placeholder="Front elevation rebuild"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Customer"
              htmlFor="customerId"
              error={state.fieldErrors?.customerId}
              hint={
                customers.length === 0 ? (
                  <>
                    No customers yet —{' '}
                    <Link href="/customers/new" className="text-[var(--accent)] hover:underline">
                      add one first
                    </Link>
                    .
                  </>
                ) : undefined
              }
            >
              <Select
                id="customerId"
                name="customerId"
                defaultValue={job?.customer_id ?? defaultCustomerId ?? ''}
              >
                <option value="">No customer yet</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="status" error={state.fieldErrors?.status}>
              <Select id="status" name="status" defaultValue={job?.status ?? 'lead'}>
                {JOB_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="description" error={state.fieldErrors?.description}>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={job?.description ?? ''}
              placeholder="What the job actually involves. This becomes the starting point for the quote's scope of work."
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Site" description="Where the work happens, if it is not the customer's address." />
        <CardBody className="space-y-5">
          <Field label="Site address" htmlFor="siteAddressLine1" error={state.fieldErrors?.siteAddressLine1}>
            <Input
              id="siteAddressLine1"
              name="siteAddressLine1"
              defaultValue={job?.site_address_line1 ?? ''}
              placeholder="14 Wattle Street"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-[1fr_8rem_8rem]">
            <Field label="Suburb" htmlFor="siteSuburb">
              <Input id="siteSuburb" name="siteSuburb" defaultValue={job?.site_suburb ?? ''} />
            </Field>
            <Field label="State" htmlFor="siteState">
              <Select id="siteState" name="siteState" defaultValue={job?.site_state ?? 'NSW'}>
                {AU_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Postcode" htmlFor="sitePostcode" error={state.fieldErrors?.sitePostcode}>
              <Input
                id="sitePostcode"
                name="sitePostcode"
                inputMode="numeric"
                maxLength={4}
                defaultValue={job?.site_postcode ?? ''}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Schedule and budget" />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Start date" htmlFor="startDate" error={state.fieldErrors?.startDate}>
              <Input id="startDate" name="startDate" type="date" defaultValue={job?.start_date ?? ''} />
            </Field>

            <Field
              label="Expected completion"
              htmlFor="expectedCompletionDate"
              error={state.fieldErrors?.expectedCompletionDate}
            >
              <Input
                id="expectedCompletionDate"
                name="expectedCompletionDate"
                type="date"
                defaultValue={job?.expected_completion_date ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.expectedCompletionDate)}
              />
            </Field>

            <Field label="Budget" htmlFor="budget" hint="Ex GST. For your own tracking." error={state.fieldErrors?.budgetCents}>
              <MoneyInput
                id="budget"
                name="budget"
                defaultValue={job?.budget_cents ? centsToInput(job.budget_cents) : ''}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {team.length > 0 ? (
        <Card>
          <CardHeader title="Who is on it" description="Assigned workers see the job on their list." />
          <CardBody>
            <div className="grid gap-1 sm:grid-cols-2">
              {team.map((member) => (
                <Checkbox
                  key={member.id}
                  name="assignedTeamMemberIds"
                  value={member.id}
                  defaultChecked={assignedIds.includes(member.id)}
                  label={member.full_name ?? member.email}
                  description={member.role}
                />
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Notes" />
        <CardBody>
          <Field label="" htmlFor="notes" error={state.fieldErrors?.notes}>
            <Textarea id="notes" name="notes" rows={3} defaultValue={job?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {job ? 'Save changes' : 'Create job'}
        </SubmitButton>
        <Link href={job ? `/jobs/${job.id}` : '/jobs'} className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
