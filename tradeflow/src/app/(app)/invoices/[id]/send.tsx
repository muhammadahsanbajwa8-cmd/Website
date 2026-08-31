'use client';

import { useActionState, useState } from 'react';
import { sendInvoiceAction } from '../actions';
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
  Textarea,
  buttonClass,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function SendInvoicePanel({
  invoiceId,
  defaultTo,
  alreadySent,
}: {
  invoiceId: string;
  defaultTo: string;
  alreadySent: boolean;
}) {
  const [state, action] = useActionState(sendInvoiceAction, idleState);
  const [open, setOpen] = useState(!alreadySent);

  return (
    <Card>
      <CardHeader
        title={alreadySent ? 'Send again' : 'Send the invoice'}
        description="Attaches the PDF and a link to a read-only copy."
        action={
          alreadySent ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={buttonClass('secondary', 'sm')}
            >
              {open ? 'Cancel' : 'Send again'}
            </button>
          ) : null
        }
      />

      {open ? (
        <CardBody>
          <form action={action} className="space-y-4">
            <input type="hidden" name="id" value={invoiceId} />

            <FormError>{state.error}</FormError>
            {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

            <Field
              label="To"
              htmlFor="invoice-to"
              error={state.fieldErrors?.to}
              hint={defaultTo ? undefined : 'No email address saved for this customer.'}
              required
            >
              <Input id="invoice-to" name="to" type="email" required defaultValue={defaultTo} />
            </Field>

            <Field label="Message" htmlFor="invoice-message" hint="Leave blank for a plain covering note.">
              <Textarea id="invoice-message" name="message" rows={3} />
            </Field>

            <SubmitButton className="w-full" pendingLabel="Sending…">
              <Icon path={icons.send} size={16} />
              {alreadySent ? 'Send again' : 'Send invoice'}
            </SubmitButton>
          </form>
        </CardBody>
      ) : null}
    </Card>
  );
}
