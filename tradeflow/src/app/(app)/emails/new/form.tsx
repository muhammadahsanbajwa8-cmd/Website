'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { composeEmailAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  Select,
  Textarea,
  buttonClass,
  icons,
} from '@/components/ui';
import { Disclosure, SubmitButton } from '@/components/ui/client';
import type { CustomerOption, JobOption } from '@/lib/pickers';

interface DocumentOption {
  id: string;
  number: string;
  title: string | null;
}

export function ComposeForm({
  jobs,
  customers,
  quotes,
  invoices,
  reports,
  defaults,
}: {
  jobs: JobOption[];
  customers: CustomerOption[];
  quotes: DocumentOption[];
  invoices: DocumentOption[];
  reports: DocumentOption[];
  defaults: Record<string, string | undefined>;
}) {
  const [state, action] = useActionState(composeEmailAction, idleState);
  const [attachments, setAttachments] = useState({
    quote: defaults.quoteId ?? '',
    invoice: defaults.invoiceId ?? '',
    report: defaults.reportId ?? '',
  });

  const attached = Object.values(attachments).filter(Boolean).length;

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Card>
        <CardHeader title="Message" />
        <CardBody className="space-y-5">
          <Field label="To" htmlFor="to" error={state.fieldErrors?.to} required>
            <Input
              id="to"
              name="to"
              required
              defaultValue={defaults.to ?? ''}
              placeholder="them@example.com, someone.else@example.com"
              autoCapitalize="none"
            />
          </Field>

          <Disclosure summary="Cc and Bcc">
            <div className="grid gap-4 pt-1 sm:grid-cols-2">
              <Field label="Cc" htmlFor="cc">
                <Input id="cc" name="cc" autoCapitalize="none" />
              </Field>
              <Field label="Bcc" htmlFor="bcc">
                <Input id="bcc" name="bcc" autoCapitalize="none" />
              </Field>
            </div>
          </Disclosure>

          <Field label="Subject" htmlFor="subject" error={state.fieldErrors?.subject} required>
            <Input id="subject" name="subject" required defaultValue={defaults.subject ?? ''} />
          </Field>

          <Field label="Message" htmlFor="body" error={state.fieldErrors?.body} required>
            <Textarea id="body" name="body" rows={10} required defaultValue={defaults.body ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Attach"
          description={
            attached > 0
              ? `${attached} document${attached === 1 ? '' : 's'} — generated fresh from the record when you send.`
              : 'Quotes, invoices and reports are generated as PDFs at the moment you send.'
          }
        />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          {quotes.length > 0 ? (
            <Field label="Quote" htmlFor="attachQuoteId">
              <Select
                id="attachQuoteId"
                name="attachQuoteId"
                value={attachments.quote}
                onChange={(event) =>
                  setAttachments((current) => ({ ...current, quote: event.target.value }))
                }
              >
                <option value="">None</option>
                {quotes.map((quote) => (
                  <option key={quote.id} value={quote.id}>
                    {quote.number} — {quote.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {invoices.length > 0 ? (
            <Field label="Invoice" htmlFor="attachInvoiceId">
              <Select
                id="attachInvoiceId"
                name="attachInvoiceId"
                value={attachments.invoice}
                onChange={(event) =>
                  setAttachments((current) => ({ ...current, invoice: event.target.value }))
                }
              >
                <option value="">None</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.number}
                    {invoice.title ? ` — ${invoice.title}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {reports.length > 0 ? (
            <Field label="Report" htmlFor="attachReportId">
              <Select
                id="attachReportId"
                name="attachReportId"
                value={attachments.report}
                onChange={(event) =>
                  setAttachments((current) => ({ ...current, report: event.target.value }))
                }
              >
                <option value="">None</option>
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.number} — {report.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="File it against" description="So it joins that job's email timeline." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Job" htmlFor="jobId">
            <Select id="jobId" name="jobId" defaultValue={defaults.jobId ?? ''}>
              <option value="">Not on a job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} — {job.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Customer" htmlFor="customerId">
            <Select id="customerId" name="customerId" defaultValue={defaults.customerId ?? ''}>
              <option value="">No customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Sending…">
          <Icon path={icons.send} size={18} />
          Send
        </SubmitButton>
        <Link href="/emails" className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
