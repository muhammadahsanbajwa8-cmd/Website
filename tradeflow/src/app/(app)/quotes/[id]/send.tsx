'use client';

import { useActionState, useState } from 'react';
import { sendQuoteAction } from '../actions';
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

export function SendQuotePanel({
  quoteId,
  defaultTo,
  customerName,
  alreadySent,
  shareUrl,
}: {
  quoteId: string;
  defaultTo: string;
  customerName: string;
  alreadySent: boolean;
  shareUrl: string | null;
}) {
  const [state, action] = useActionState(sendQuoteAction, idleState);
  const [open, setOpen] = useState(!alreadySent && !shareUrl);

  return (
    <Card>
      <CardHeader
        title={alreadySent ? 'Send again' : 'Send to the customer'}
        description={
          alreadySent
            ? 'Re-sending takes a fresh snapshot of the quote as it stands now.'
            : 'Attaches the PDF and includes the link they accept from.'
        }
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
            <input type="hidden" name="id" value={quoteId} />

            <FormError>{state.error}</FormError>
            {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

            <Field
              label="To"
              htmlFor="send-to"
              error={state.fieldErrors?.to}
              hint={defaultTo ? undefined : 'This customer has no email address saved.'}
              required
            >
              <Input
                id="send-to"
                name="to"
                type="email"
                required
                defaultValue={defaultTo}
                placeholder="them@example.com"
              />
            </Field>

            <Field
              label="Message"
              htmlFor="send-message"
              hint="Leave blank for a plain covering note with the total and expiry."
            >
              <Textarea
                id="send-message"
                name="message"
                rows={4}
                placeholder={
                  customerName
                    ? `Hi ${customerName.split(' ')[0]}, here is the quote we discussed on site.`
                    : 'Here is the quote we discussed.'
                }
              />
            </Field>

            <SubmitButton className="w-full" pendingLabel="Sending…">
              <Icon path={icons.send} size={16} />
              {alreadySent ? 'Send again' : 'Send quote'}
            </SubmitButton>
          </form>
        </CardBody>
      ) : null}
    </Card>
  );
}
