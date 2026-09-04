'use client';

import { useActionState, useEffect, useRef } from 'react';
import { sendMessageAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { FormError, FormSuccess, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/**
 * Writing to the business.
 *
 * The box clears itself on a successful send, because a message still sitting
 * there afterwards reads as one that did not go.
 */
export function MessageForm({
  jobId,
  placeholder = 'Type your message…',
}: {
  jobId?: string;
  placeholder?: string;
}) {
  const [state, action] = useActionState(sendMessageAction, idleState);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok && box.current) box.current.value = '';
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}

      <FormError>{state.error}</FormError>
      {state.ok ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Textarea
        ref={box}
        name="body"
        rows={4}
        required
        maxLength={5000}
        placeholder={placeholder}
        aria-label="Your message"
        aria-invalid={Boolean(state.fieldErrors?.body)}
      />

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
      </div>
    </form>
  );
}
