'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { endTestCallAction, testTurnAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  FormError,
  Icon,
  InfoNote,
  Input,
  buttonClass,
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { CallTurn } from '@/lib/database.types';

const SUGGESTIONS = [
  "Yeah, um… I'm calling about that job we had last week, the one at Smith Street.",
  "The kitchen was supposed to be finished yesterday.",
  "I've called three times and nobody has gotten back to me.",
  "There's a crack near the window, can someone come have a look before Friday?",
  'How much would it cost to do a retaining wall?',
  'Can I speak to John?',
];

/**
 * The test console.
 *
 * Typed lines go through the same agent, the same brain and the same tools as
 * a real call. The suggested lines are deliberately the awkward ones — a
 * half-finished sentence, a frustrated caller, a question the assistant is not
 * allowed to answer — because those are what tell a business whether the
 * assistant is ready to answer its phone.
 */
export function CallConsole({ callId, turns }: { callId: string; turns: CallTurn[] }) {
  const [state, action] = useActionState(testTurnAction, idleState);
  const [said, setSaid] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, state.message]);

  useEffect(() => {
    if (state.ok) setSaid('');
  }, [state]);

  return (
    <Card>
      <CardHeader
        title="Live test call"
        description="Type what a caller would say. The assistant answers with what it would speak."
        action={
          <form action={endTestCallAction}>
            <input type="hidden" name="callId" value={callId} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Hanging up…">
              <Icon path={icons.x} size={14} />
              Hang up
            </SubmitButton>
          </form>
        }
      />

      <CardBody className="space-y-4">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={cn('flex', turn.role === 'agent' ? 'justify-start' : 'justify-end')}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-[0.875rem] px-3.5 py-2.5 text-sm',
                  turn.role === 'agent'
                    ? 'bg-[var(--surface-sunken)] text-[var(--text-default)]'
                    : 'bg-[var(--accent-soft)] text-[var(--text-strong)]'
                )}
              >
                <div className="mb-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {turn.role === 'agent' ? 'Assistant' : 'You, as the caller'}
                  {turn.latency_ms ? ` · ${(turn.latency_ms / 1000).toFixed(1)}s` : ''}
                </div>
                <p className="whitespace-pre-wrap">{turn.text}</p>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <FormError>{state.error}</FormError>

        {state.ok && state.data?.escalated ? (
          <InfoNote tone="warning">
            The assistant flagged this call for a person. On a real call it would transfer to your
            escalation number if one is set.
          </InfoNote>
        ) : null}

        <form ref={formRef} action={action} className="space-y-3">
          <input type="hidden" name="callId" value={callId} />
          <div className="flex gap-2">
            <Input
              name="said"
              value={said}
              onChange={(event) => setSaid(event.target.value)}
              placeholder="Say something…"
              autoComplete="off"
              aria-label="What the caller says"
            />
            <SubmitButton disabled={!said.trim()} pendingLabel="…">
              <Icon path={icons.send} size={16} />
            </SubmitButton>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setSaid(suggestion)}
                className="rounded-full border border-[var(--line-subtle)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {suggestion.length > 46 ? `${suggestion.slice(0, 45)}…` : suggestion}
              </button>
            ))}
          </div>
        </form>

        <p className="text-xs text-[var(--text-muted)]">
          Anything the caller asks for is written down as a proposal, not created. You confirm it
          after the call — the same as a real one.
        </p>
      </CardBody>
    </Card>
  );
}
