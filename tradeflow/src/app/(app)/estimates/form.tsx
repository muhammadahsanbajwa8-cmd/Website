'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveEstimateAction } from './actions';
import { idleState } from '@/lib/action-state';
import { ESTIMATE_STATUSES } from '@/lib/domain';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  Input,
  InfoNote,
  Select,
  Textarea,
  buttonClass,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { EstimateEditor, type EditorLine } from '@/components/line-items';
import type { CustomerOption, JobOption } from '@/lib/pickers';
import type { Estimate } from '@/lib/database.types';

export function EstimateForm({
  estimate,
  lines,
  customers,
  jobs,
  gstRegistered,
  defaultMarkupBp,
  defaultCustomerId,
  defaultJobId,
}: {
  estimate?: Estimate;
  lines?: EditorLine[];
  customers: CustomerOption[];
  jobs: JobOption[];
  gstRegistered: boolean;
  defaultMarkupBp: number;
  defaultCustomerId?: string;
  defaultJobId?: string;
}) {
  const [state, action] = useActionState(saveEstimateAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      {estimate ? <input type="hidden" name="id" value={estimate.id} /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="What is being estimated" />
        <CardBody className="space-y-5">
          <Field label="Title" htmlFor="title" error={state.fieldErrors?.title} required>
            <Input
              id="title"
              name="title"
              required
              autoFocus={!estimate}
              defaultValue={estimate?.title ?? ''}
              placeholder="Front elevation rebuild"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Customer" htmlFor="customerId">
              <Select
                id="customerId"
                name="customerId"
                defaultValue={estimate?.customer_id ?? defaultCustomerId ?? ''}
              >
                <option value="">No customer yet</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Job" htmlFor="jobId">
              <Select id="jobId" name="jobId" defaultValue={estimate?.job_id ?? defaultJobId ?? ''}>
                <option value="">Not linked to a job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.number} — {job.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={estimate?.status ?? 'draft'}>
                {ESTIMATE_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Costs"
          description="What the work costs you. Markup and contingency go on top; the margin is worked out as you type."
        />
        <CardBody>
          {state.fieldErrors?.items ? (
            <div className="mb-4">
              <InfoNote tone="danger">{state.fieldErrors.items[0]}</InfoNote>
            </div>
          ) : null}

          {!gstRegistered ? (
            <div className="mb-4">
              <InfoNote>
                Your business is not marked as GST registered, so no GST is added. Change that
                in Settings if it is wrong.
              </InfoNote>
            </div>
          ) : null}

          <EstimateEditor
            initial={lines}
            gstApplies={estimate ? estimate.gst_applies : gstRegistered}
            markupBpDefault={estimate?.markup_bp ?? defaultMarkupBp}
            contingencyBpDefault={estimate?.contingency_bp ?? 0}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notes" description="Your own working notes. These do not appear on a quote." />
        <CardBody>
          <Field label="" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={estimate?.notes ?? ''}
              placeholder="Allowed two days for scaffold. Brick price valid to end of month."
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {estimate ? 'Save estimate' : 'Create estimate'}
        </SubmitButton>
        <Link
          href={estimate ? `/estimates/${estimate.id}` : '/estimates'}
          className={buttonClass('secondary', 'lg')}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
