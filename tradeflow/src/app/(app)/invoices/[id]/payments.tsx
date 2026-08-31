'use client';

import { useActionState } from 'react';
import { recordPaymentAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { PAYMENT_METHODS } from '@/lib/domain';
import { centsToInput } from '@/lib/money';
import { todayInAustralia } from '@/lib/format';

/** Recording money in. Defaults to the full outstanding balance. */
export function PaymentPanel({
  invoiceId,
  outstandingCents,
}: {
  invoiceId: string;
  outstandingCents: number;
}) {
  const [state, action] = useActionState(recordPaymentAction, idleState);

  return (
    <Card>
      <CardHeader
        title="Record a payment"
        description="Part payments are fine — the balance and status update themselves."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <FormError>{state.error}</FormError>
          {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount" htmlFor="payment-amount" error={state.fieldErrors?.amountCents} required>
              <MoneyInput
                id="payment-amount"
                name="amount"
                required
                defaultValue={outstandingCents > 0 ? centsToInput(outstandingCents) : ''}
              />
            </Field>

            <Field label="Method" htmlFor="payment-method">
              <Select id="payment-method" name="method" defaultValue="bank_transfer">
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date received" htmlFor="payment-date" error={state.fieldErrors?.paidOn}>
              <Input
                id="payment-date"
                name="paidOn"
                type="date"
                defaultValue={todayInAustralia()}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference" htmlFor="payment-reference" hint="Their transfer reference or receipt number.">
              <Input id="payment-reference" name="reference" />
            </Field>

            <Field label="Notes" htmlFor="payment-notes">
              <Textarea id="payment-notes" name="notes" rows={1} />
            </Field>
          </div>

          <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}
