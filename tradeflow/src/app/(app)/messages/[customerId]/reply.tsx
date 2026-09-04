'use client';

import { useActionState, useEffect, useRef } from 'react';
import { replyToCustomerAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { FormError, FormSuccess, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ReplyForm({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [state, action] = useActionState(replyToCustomerAction, idleState);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok && box.current) box.current.value = '';
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />

      <FormError>{state.error}</FormError>
      {state.ok ? <FormSuccess>{state.message}</FormSuccess> : null}

      <Textarea
        ref={box}
        name="body"
        rows={4}
        required
        maxLength={5000}
        placeholder={`Reply to ${customerName}…`}
        aria-label="Your reply"
      />

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send reply</SubmitButton>
      </div>
    </form>
  );
}
