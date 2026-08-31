'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveQuoteAction } from './actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  InfoNote,
  Input,
  Select,
  Textarea,
  buttonClass,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { DocumentEditor, type EditorLine } from '@/components/line-items';
import { addDays, todayInAustralia } from '@/lib/format';
import type { CustomerOption, JobOption } from '@/lib/pickers';
import type { Quote } from '@/lib/database.types';

export function QuoteForm({
  quote,
  lines,
  customers,
  jobs,
  gstRegistered,
  validityDays,
  paymentTermsDays,
  defaultPaymentTerms,
  defaultTerms,
  defaultCustomerId,
  defaultJobId,
  defaultEstimateId,
}: {
  quote?: Quote;
  lines?: EditorLine[];
  customers: CustomerOption[];
  jobs: JobOption[];
  gstRegistered: boolean;
  validityDays: number;
  paymentTermsDays: number;
  /** The business's standing policies, from Settings. */
  defaultPaymentTerms?: string | null;
  defaultTerms?: string | null;
  defaultCustomerId?: string;
  defaultJobId?: string;
  defaultEstimateId?: string;
}) {
  const [state, action] = useActionState(saveQuoteAction, idleState);
  const today = todayInAustralia();

  return (
    <form action={action} className="space-y-5" noValidate>
      {quote ? <input type="hidden" name="id" value={quote.id} /> : null}
      {defaultEstimateId ? (
        <input type="hidden" name="estimateId" value={quote?.estimate_id ?? defaultEstimateId} />
      ) : quote?.estimate_id ? (
        <input type="hidden" name="estimateId" value={quote.estimate_id} />
      ) : null}

      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="The quote" />
        <CardBody className="space-y-5">
          <Field label="Title" htmlFor="title" error={state.fieldErrors?.title} required>
            <Input
              id="title"
              name="title"
              required
              autoFocus={!quote}
              defaultValue={quote?.title ?? ''}
              placeholder="Front elevation rebuild"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Customer" htmlFor="customerId" error={state.fieldErrors?.customerId} required>
              <Select
                id="customerId"
                name="customerId"
                required
                defaultValue={quote?.customer_id ?? defaultCustomerId ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.customerId)}
              >
                <option value="">Choose a customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Job" htmlFor="jobId">
              <Select id="jobId" name="jobId" defaultValue={quote?.job_id ?? defaultJobId ?? ''}>
                <option value="">Not linked to a job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.number} — {job.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Issue date" htmlFor="issueDate" error={state.fieldErrors?.issueDate}>
              <Input
                id="issueDate"
                name="issueDate"
                type="date"
                defaultValue={quote?.issue_date ?? today}
              />
            </Field>

            <Field
              label="Valid until"
              htmlFor="expiryDate"
              hint={`Defaults to ${validityDays} days after the issue date.`}
            >
              <Input
                id="expiryDate"
                name="expiryDate"
                type="date"
                defaultValue={quote?.expiry_date ?? addDays(today, validityDays)}
              />
            </Field>
          </div>

          <Field
            label="Scope of work"
            htmlFor="scopeOfWork"
            hint="Printed on the quote above the line items. What is included, and what is not."
          >
            <Textarea
              id="scopeOfWork"
              name="scopeOfWork"
              rows={5}
              defaultValue={quote?.scope_of_work ?? ''}
              placeholder={
                'Demolish the existing front elevation brickwork to sill level.\n' +
                'Supply and lay new face brick to match, including lintels and weep holes.\n' +
                'Excludes: painting, landscaping, and any structural work not visible at quoting.'
              }
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Priced lines" description="What the customer sees and pays." />
        <CardBody>
          {state.fieldErrors?.items ? (
            <div className="mb-4">
              <InfoNote tone="danger">{state.fieldErrors.items[0]}</InfoNote>
            </div>
          ) : null}

          <DocumentEditor
            initial={lines}
            gstApplies={quote ? quote.gst_applies : gstRegistered}
            discountCents={quote?.discount_cents ?? 0}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Terms" />
        <CardBody className="space-y-5">
          <Field label="Payment terms" htmlFor="paymentTerms">
            <Textarea
              id="paymentTerms"
              name="paymentTerms"
              rows={2}
              defaultValue={
                quote?.payment_terms ??
                defaultPaymentTerms ??
                `Payment within ${paymentTermsDays} days of invoice.`
              }
            />
          </Field>

          <Field
            label="Terms and conditions"
            htmlFor="terms"
            hint="Printed at the end of the quote, and on the copy the customer opens. Set your standing terms once in Settings."
          >
            <Textarea
              id="terms"
              name="terms"
              rows={4}
              defaultValue={
                quote?.terms ??
                defaultTerms ??
                'Prices are in Australian dollars and hold for the validity period shown. ' +
                  'Variations to the scope are quoted separately in writing before work proceeds.'
              }
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {quote ? 'Save quote' : 'Create quote'}
        </SubmitButton>
        <Link href={quote ? `/quotes/${quote.id}` : '/quotes'} className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
