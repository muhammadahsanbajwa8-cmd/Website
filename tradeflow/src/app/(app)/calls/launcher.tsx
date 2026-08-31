'use client';

import { useActionState, useState } from 'react';
import { startTestCallAction } from './actions';
import { idleState } from '@/lib/action-state';
import { Field, FormError, Icon, Input, buttonClass, icons } from '@/components/ui';
import { Modal, SubmitButton } from '@/components/ui/client';

/**
 * Start a test call. Entering a customer's number is the interesting case:
 * the assistant recognises them and greets them by name, which is the whole
 * difference between this and a phone menu.
 */
export function TestCallLauncher() {
  const [state, action] = useActionState(startTestCallAction, idleState);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass('primary', 'md')}>
        <Icon path={icons.phone} size={16} />
        Try a call
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Try the assistant"
        description="The same assistant that answers your phone, typed instead of spoken."
      >
        <form action={action} className="space-y-4">
          <FormError>{state.error}</FormError>

          <Field
            label="Call from this number"
            htmlFor="fromNumber"
            hint="Use a customer's number to see it recognise them and pick up their job."
          >
            <Input id="fromNumber" name="fromNumber" type="tel" placeholder="0400 123 456" />
          </Field>

          <SubmitButton className="w-full" size="lg" pendingLabel="Connecting…">
            Start the call
          </SubmitButton>
        </form>
      </Modal>
    </>
  );
}
