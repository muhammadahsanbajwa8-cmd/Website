'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { saveExpenseAction } from '../field/actions';
import { idleState } from '@/lib/action-state';
import { COST_KINDS } from '@/lib/calc';
import { centsToInput, moneyToCents } from '@/lib/money';
import { formatMoney, todayInAustralia } from '@/lib/format';
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
  MoneyInput,
  Select,
  Textarea,
  buttonClass,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { JobOption } from '@/lib/pickers';
import type { Expense } from '@/lib/database.types';

/**
 * Recording money out. The GST field is filled in for you at a tenth of the
 * amount, because that is right for almost every receipt a trade business
 * picks up — and editable, because it is not right for all of them.
 */
export function ExpenseForm({
  expense,
  jobs,
  suppliers,
  gstRegistered,
  defaultJobId,
}: {
  expense?: Expense;
  jobs: JobOption[];
  suppliers: { id: string; name: string }[];
  gstRegistered: boolean;
  defaultJobId?: string;
}) {
  const [state, action] = useActionState(saveExpenseAction, idleState);
  const [amount, setAmount] = useState(
    expense?.amount_cents ? centsToInput(expense.amount_cents) : ''
  );
  const [gst, setGst] = useState(expense?.gst_cents ? centsToInput(expense.gst_cents) : '');
  const [gstTouched, setGstTouched] = useState(Boolean(expense?.gst_cents));
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  const amountCents = moneyToCents(amount);
  const suggestedGst = gstRegistered ? Math.round(amountCents / 11) : 0;

  return (
    <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
      {expense ? <input type="hidden" name="id" value={expense.id} /> : null}
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Card>
        <CardHeader title="What was spent" />
        <CardBody className="space-y-5">
          <Field
            label="What was it for"
            htmlFor="description"
            error={state.fieldErrors?.description}
            required
          >
            <Input
              id="description"
              name="description"
              required
              autoFocus={!expense}
              defaultValue={expense?.description ?? ''}
              placeholder="Pavers from Boral"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Amount (inc GST)" htmlFor="amount" error={state.fieldErrors?.amountCents} required>
              <MoneyInput
                id="amount"
                name="amount"
                required
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  if (!gstTouched) {
                    const cents = moneyToCents(event.target.value);
                    setGst(gstRegistered && cents > 0 ? centsToInput(Math.round(cents / 11)) : '');
                  }
                }}
              />
            </Field>

            <Field
              label="GST included"
              htmlFor="gst"
              hint={
                gstRegistered && amountCents > 0 && !gstTouched
                  ? `Filled in as ${formatMoney(suggestedGst)}`
                  : 'Zero for a GST-free purchase.'
              }
            >
              <MoneyInput
                id="gst"
                name="gst"
                value={gst}
                onChange={(event) => {
                  setGst(event.target.value);
                  setGstTouched(true);
                }}
              />
            </Field>

            <Field label="Date" htmlFor="spentOn">
              <Input
                id="spentOn"
                name="spentOn"
                type="date"
                defaultValue={expense?.spent_on ?? todayInAustralia()}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Category" htmlFor="category">
              <Select id="category" name="category" defaultValue={expense?.category ?? 'materials'}>
                {COST_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Job" htmlFor="jobId" hint="Drives the job's profit figure.">
              <Select id="jobId" name="jobId" defaultValue={expense?.job_id ?? defaultJobId ?? ''}>
                <option value="">Not on a job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.number} — {job.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Supplier" htmlFor="supplierId">
              <Select id="supplierId" name="supplierId" defaultValue={expense?.supplier_id ?? ''}>
                <option value="">Not recorded</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Reference" htmlFor="reference" hint="Docket or invoice number.">
              <Input id="reference" name="reference" defaultValue={expense?.reference ?? ''} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox
                name="billable"
                defaultChecked={expense?.billable ?? false}
                label="Rechargeable to the customer"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Receipt" description="Photograph it now and it is filed against the job." />
        <CardBody className="space-y-3">
          <button
            type="button"
            onClick={() => receiptRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[0.75rem] border-2 border-dashed border-[var(--line-default)] py-7 text-sm font-medium text-[var(--text-default)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            <Icon path={icons.camera} size={24} />
            {receiptName ?? 'Photograph or choose the receipt'}
          </button>
          <input
            ref={receiptRef}
            type="file"
            name="receipt"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(event) => setReceiptName(event.target.files?.[0]?.name ?? null)}
          />

          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} defaultValue={expense?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {expense ? 'Save expense' : 'Record expense'}
        </SubmitButton>
        <Link href="/expenses" className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
