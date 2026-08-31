'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { askAssistantAction } from './actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  FormError,
  Icon,
  Input,
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

const MONEY_PROMPTS = [
  'Which invoices are overdue?',
  'Show me my outstanding money',
  "Which quotes haven't been accepted?",
  'How are we going this year?',
];

const WORK_PROMPTS = [
  'What jobs are currently active?',
  'What do I need to do today?',
  "What's scheduled this fortnight?",
];

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
}

export function AssistantChat({
  configured,
  canSeeMoney,
  firstName,
}: {
  configured: boolean;
  canSeeMoney: boolean;
  firstName: string;
}) {
  const [state, action] = useActionState(askAssistantAction, idleState);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Fold each answer into the transcript once it arrives.
  useEffect(() => {
    if (state.ok && state.message && asked) {
      setTurns((current) => [
        ...current,
        { role: 'user', content: asked },
        {
          role: 'assistant',
          content: state.message!,
          tools: Array.isArray(state.data?.tools) ? (state.data.tools as string[]) : undefined,
        },
      ]);
      setAsked(null);
      setQuestion('');
    }
  }, [state, asked]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  const suggestions = canSeeMoney ? [...MONEY_PROMPTS, ...WORK_PROMPTS] : WORK_PROMPTS;

  return (
    <Card>
      <CardBody className="space-y-4">
        {turns.length === 0 ? (
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon path={icons.ai} size={22} />
            </span>
            <p className="text-sm text-[var(--text-strong)]">
              {firstName ? `What do you need, ${firstName}?` : 'What do you need?'}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              It reads your jobs, customers, quotes and invoices to answer.
            </p>
          </div>
        ) : (
          <div className="max-h-[30rem] space-y-4 overflow-y-auto pr-1">
            {turns.map((turn, index) => (
              <div
                key={index}
                className={cn('flex', turn.role === 'assistant' ? 'justify-start' : 'justify-end')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-[0.875rem] px-4 py-3 text-sm',
                    turn.role === 'assistant'
                      ? 'bg-[var(--surface-sunken)] text-[var(--text-default)]'
                      : 'bg-[var(--accent-soft)] text-[var(--text-strong)]'
                  )}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                  {turn.tools?.length ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Read: {[...new Set(turn.tools)].map((tool) => tool.replace(/_/g, ' ')).join(', ')}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}

        <FormError>{state.error}</FormError>

        <form action={action} className="space-y-3">
          <input type="hidden" name="history" value={JSON.stringify(turns.map(({ role, content }) => ({ role, content })))} />

          <div className="flex gap-2">
            <Input
              name="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about your jobs, customers or money…"
              disabled={!configured}
              autoComplete="off"
              aria-label="Your question"
            />
            <SubmitButton
              disabled={!configured || !question.trim()}
              onClick={() => setAsked(question)}
              pendingLabel="Thinking…"
            >
              <Icon path={icons.send} size={16} />
            </SubmitButton>
          </div>

          {turns.length === 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!configured}
                  onClick={() => setQuestion(suggestion)}
                  className="rounded-full border border-[var(--line-subtle)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
