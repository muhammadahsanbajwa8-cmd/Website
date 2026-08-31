'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveInvoiceAction } from './actions';
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
import { addDays, formatBsb, todayInAustralia } from '@/lib/format';
import type { CustomerOption, JobOption } from '@/lib/pickers';
import type { Business, Invoice } from '@/lib/database.types';

export function InvoiceForm({
  invoice,
  lines,
  customers,
  jobs,
  business,
  defaultCustomerId,
  defaultJobId,
}: {
  invoice?: Invoice;
  lines?: EditorLine[];
  customers: CustomerOption[];
  jobs: JobOption[];
  business: Business;
  defaultCustomerId?: string;
  defaultJobId?: string;
}) {
  const [state, action] = useActionState(saveInvoiceAction, idleState);
  const today = todayInAustralia();

  const defaultBankDetails = [
    business.bank_account_name ? `Account name: ${business.bank_account_name}` : null,
    business.bank_bsb ? `BSB: ${formatBsb(business.bank_bsb)}` : null,
    business.bank_account_number ? `Account: ${business.bank_account_number}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <form action={action} className="space-y-5" noValidate>
      {invoice ? <input type="hidden" name="id" value={invoice.id} /> : null}
      {invoice?.quote_id ? <input type="hidden" name="quoteId" value={invoice.quote_id} /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="Who and what" />
        <CardBody className="space-y-5">
          <Field label="Description" htmlFor="title" hint="Printed under the customer's name. Optional.">
            <Input
              id="title"
              name="title"
              defaultValue={invoice?.title ?? ''}
              placeholder="Front elevation rebuild"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Customer" htmlFor="customerId" error={state.fieldErrors?.customerId} required>
              <Select
                id="customerId"
                name="customerId"
                required
                defaultValue={invoice?.customer_id ?? defaultCustomerId ?? ''}
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
              <Select id="jobId" name="jobId" defaultValue={invoice?.job_id ?? defaultJobId ?? ''}>
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
            <Field label="Issue date" htmlFor="issueDate">
              <Input
                id="issueDate"
                name="issueDate"
                type="date"
                defaultValue={invoice?.issue_date ?? today}
              />
            </Field>

            <Field
              label="Due date"
              htmlFor="dueDate"
              error={state.fieldErrors?.dueDate}
              hint={`Your default terms are ${business.default_payment_terms_days} days.`}
            >
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={
                  invoice?.due_date ?? addDays(today, business.default_payment_terms_days)
                }
                aria-invalid={Boolean(state.fieldErrors?.dueDate)}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What is being billed" />
        <CardBody>
          {state.fieldErrors?.items ? (
            <div className="mb-4">
              <InfoNote tone="danger">{state.fieldErrors.items[0]}</InfoNote>
            </div>
          ) : null}
          <DocumentEditor
            initial={lines}
            gstApplies={invoice ? invoice.gst_applies : business.gst_registered}
            discountCents={invoice?.discount_cents ?? 0}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payment" />
        <CardBody className="space-y-5">
          <Field label="Payment terms" htmlFor="paymentTerms">
            <Textarea
              id="paymentTerms"
              name="paymentTerms"
              rows={2}
              defaultValue={
                invoice?.payment_terms ??
                `Payment due within ${business.default_payment_terms_days} days of the issue date.`
              }
            />
          </Field>

          <Field
            label="Bank details"
            htmlFor="bankDetails"
            hint={
              defaultBankDetails
                ? 'Taken from your business settings. Edit here for this invoice only.'
                : 'Add your account details in Settings and they will be filled in for you.'
            }
          >
            <Textarea
              id="bankDetails"
              name="bankDetails"
              rows={3}
              defaultValue={invoice?.bank_details ?? defaultBankDetails}
            />
          </Field>

          <Field label="Notes" htmlFor="notes" hint="Printed at the end of the invoice.">
            <Textarea id="notes" name="notes" rows={2} defaultValue={invoice?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {invoice ? 'Save invoice' : 'Create invoice'}
        </SubmitButton>
        <Link
          href={invoice ? `/invoices/${invoice.id}` : '/invoices'}
          className={buttonClass('secondary', 'lg')}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
