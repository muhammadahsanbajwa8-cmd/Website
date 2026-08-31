'use client';

import { useActionState, useState } from 'react';
import { reviewCallAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Textarea,
  buttonClass,
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/**
 * Rate the call, and correct the assistant.
 *
 * A correction is written into the business's own knowledge as an approved
 * note, which the assistant then quotes. No private conversation is used to
 * train a model — improvement happens by the business writing down the right
 * answer in its own words.
 */
export function CallReview({
  callId,
  existing,
}: {
  callId: string;
  existing: { rating: string; correction: string | null } | null;
}) {
  const [state, action] = useActionState(reviewCallAction, idleState);
  const [rating, setRating] = useState<string | null>(existing?.rating ?? null);

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
        title="How did the assistant do?"
        description="Corrections become part of what it knows about your business."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="callId" value={callId} />
          <input type="hidden" name="rating" value={rating ?? ''} />

          <FormError>{state.error}</FormError>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRating('good')}
              className={cn(
                buttonClass(rating === 'good' ? 'primary' : 'secondary', 'md'),
                'flex-1 sm:flex-none'
              )}
            >
              <Icon path={icons.check} size={16} />
              Handled it well
            </button>
            <button
              type="button"
              onClick={() => setRating('needs_improvement')}
              className={cn(
                buttonClass(rating === 'needs_improvement' ? 'danger' : 'secondary', 'md'),
                'flex-1 sm:flex-none'
              )}
            >
              <Icon path={icons.warning} size={16} />
              Needs improvement
            </button>
          </div>

          {rating === 'needs_improvement' ? (
            <div className="space-y-4 border-t border-[var(--line-subtle)] pt-4">
              <Field
                label="What did it get wrong?"
                htmlFor="misunderstanding"
                hint="In a sentence — what it misunderstood, or should not have said."
              >
                <Textarea
                  id="misunderstanding"
                  name="misunderstanding"
                  rows={2}
                  placeholder="It said we work weekends. We only do emergency call-outs on a Saturday."
                />
              </Field>

              <Field
                label="What should it have said?"
                htmlFor="correction"
                hint="Your words. The assistant will use these next time the question comes up."
              >
                <Textarea
                  id="correction"
                  name="correction"
                  rows={3}
                  placeholder="We work Monday to Friday, 7am to 5pm. Saturdays are emergency call-outs only, at the after-hours rate."
                />
              </Field>
            </div>
          ) : null}

          {rating ? (
            <SubmitButton pendingLabel="Saving…">Save review</SubmitButton>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
