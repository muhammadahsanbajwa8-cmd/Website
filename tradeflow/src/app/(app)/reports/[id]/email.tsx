'use client';

import { useActionState, useState } from 'react';
import { emailReportAction } from '../actions';
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

export function EmailReportPanel({
  reportId,
  defaultTo,
  alreadySent,
}: {
  reportId: string;
  defaultTo: string;
  alreadySent: boolean;
}) {
  const [state, action] = useActionState(emailReportAction, idleState);
  const [open, setOpen] = useState(!alreadySent);

  return (
    <Card>
      <CardHeader
        title={alreadySent ? 'Send again' : 'Email this report'}
        description="Attaches the PDF, photos included."
        action={
          alreadySent ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={buttonClass('secondary', 'sm')}
            >
              {open ? 'Cancel' : 'Send'}
            </button>
          ) : null
        }
      />
      {open ? (
        <CardBody>
          <form action={action} className="space-y-4">
            <input type="hidden" name="id" value={reportId} />
            <FormError>{state.error}</FormError>
            {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

            <Field label="To" htmlFor="report-to" error={state.fieldErrors?.to} required>
              <Input id="report-to" name="to" type="email" required defaultValue={defaultTo} />
            </Field>

            <Field label="Message" htmlFor="report-message">
              <Textarea id="report-message" name="message" rows={3} />
            </Field>

            <SubmitButton className="w-full" pendingLabel="Sending…">
              <Icon path={icons.send} size={16} />
              Send report
            </SubmitButton>
          </form>
        </CardBody>
      ) : null}
    </Card>
  );
}
