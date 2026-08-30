'use client';

import { useActionState, useState } from 'react';
import { respondToQuoteAction } from './actions';
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
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

type Choice = 'accept' | 'decline' | 'request_changes' | 'message';

const PROMPTS: Record<Choice, { title: string; blurb: string; cta: string; danger?: boolean }> = {
  accept: {
    title: 'Accept this quote',
    blurb: 'Type your name to confirm. That is your acceptance, and they will be notified straight away.',
    cta: 'Accept the quote',
  },
  decline: {
    title: 'Decline this quote',
    blurb: 'A one-line reason helps — price, timing, or you went another way.',
    cta: 'Decline the quote',
    danger: true,
  },
  request_changes: {
    title: 'Ask for changes',
    blurb: 'Say what you would like different and they will send a revised quote.',
    cta: 'Send the request',
  },
  message: {
    title: 'Send a message',
    blurb: 'A question about the quote, without accepting or declining yet.',
    cta: 'Send the message',
  },
};

export function QuoteResponse({ token, customerName }: { token: string; customerName: string }) {
  const [state, action] = useActionState(respondToQuoteAction, idleState);
  const [choice, setChoice] = useState<Choice | null>(null);

  if (state.ok && state.message) {
    return (
      <Card>
        <CardBody>
          <FormSuccess>{state.message}</FormSuccess>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="What would you like to do?"
        description="Your answer goes straight to the business."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setChoice('accept')}
            className={cn(
              buttonClass(choice === 'accept' ? 'primary' : 'secondary', 'lg'),
              'w-full'
            )}
          >
            <Icon path={icons.check} size={18} />
            Accept
          </button>
          <button
            type="button"
            onClick={() => setChoice('request_changes')}
            className={cn(
              buttonClass(choice === 'request_changes' ? 'primary' : 'secondary', 'lg'),
              'w-full'
            )}
          >
            <Icon path={icons.edit} size={16} />
            Ask for changes
          </button>
          <button
            type="button"
            onClick={() => setChoice('message')}
            className={cn(buttonClass(choice === 'message' ? 'primary' : 'ghost', 'md'), 'w-full')}
          >
            <Icon path={icons.emails} size={16} />
            Ask a question
          </button>
          <button
            type="button"
            onClick={() => setChoice('decline')}
            className={cn(buttonClass(choice === 'decline' ? 'danger' : 'ghost', 'md'), 'w-full')}
          >
            <Icon path={icons.x} size={16} />
            Decline
          </button>
        </div>

        {choice ? (
          <form action={action} className="space-y-4 border-t border-[var(--line-subtle)] pt-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="action" value={choice} />

            <div>
              <h3 className="text-sm font-semibold text-[var(--text-strong)]">
                {PROMPTS[choice].title}
              </h3>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">{PROMPTS[choice].blurb}</p>
            </div>

            <FormError>{state.error}</FormError>

            <Field
              label="Your name"
              htmlFor="respond-name"
              error={state.fieldErrors?.name}
              required={choice === 'accept'}
            >
              <Input
                id="respond-name"
                name="name"
                defaultValue={customerName}
                required={choice === 'accept'}
                autoComplete="name"
              />
            </Field>

            <Field
              label={choice === 'accept' ? 'Anything to add (optional)' : 'Message'}
              htmlFor="respond-message"
              error={state.fieldErrors?.message}
              required={choice !== 'accept'}
            >
              <Textarea
                id="respond-message"
                name="message"
                rows={3}
                required={choice !== 'accept'}
                placeholder={
                  choice === 'accept'
                    ? 'Can you start the week of the 14th?'
                    : choice === 'decline'
                      ? 'Went with another quote on price.'
                      : 'Could you split the scaffold out as a separate line?'
                }
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <SubmitButton
                size="lg"
                variant={PROMPTS[choice].danger ? 'danger' : 'primary'}
                pendingLabel="Sending…"
              >
                {PROMPTS[choice].cta}
              </SubmitButton>
              <button
                type="button"
                onClick={() => setChoice(null)}
                className={buttonClass('ghost', 'lg')}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
