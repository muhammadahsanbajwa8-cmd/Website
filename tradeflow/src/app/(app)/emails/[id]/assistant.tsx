'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { emailAssistAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Icon,
  InfoNote,
  Textarea,
  buttonClass,
  icons,
} from '@/components/ui';
import { CopyButton, SubmitButton } from '@/components/ui/client';

/**
 * The email assistant.
 *
 * Every button here produces a draft. None of them sends anything — the
 * output lands in a box the person edits, and sending is a separate,
 * deliberate step on the compose page.
 */

const READ_ACTIONS = [
  { action: 'summarise', label: 'Summarise', icon: icons.reports },
  { action: 'what_do_i_need_to_do', label: 'What do I need to do?', icon: icons.tasks },
  { action: 'create_task', label: 'Turn into a task', icon: icons.check },
  { action: 'create_report', label: 'Draft a report', icon: icons.reports },
] as const;

const DRAFT_ACTIONS = [
  { action: 'draft_reply', label: 'Draft a reply', icon: icons.send },
  { action: 'make_professional', label: 'Make it professional', icon: icons.edit },
  { action: 'make_shorter', label: 'Make it shorter', icon: icons.edit },
] as const;

export function EmailAssistant({
  emailId,
  configured,
  existingSummary,
  replyTo,
  subject,
  jobId,
  customerId,
}: {
  emailId: string;
  configured: boolean;
  existingSummary: string | null;
  replyTo: string;
  subject: string;
  jobId: string | null;
  customerId: string | null;
}) {
  const [state, action] = useActionState(emailAssistAction, idleState);
  const [draft, setDraft] = useState('');
  const [pendingAction, setPendingAction] = useState<string>('summarise');

  const output = state.ok ? state.message ?? '' : '';
  const producedDraft =
    state.ok &&
    typeof state.data?.action === 'string' &&
    ['draft_reply', 'make_professional', 'make_shorter'].includes(state.data.action);

  const composeHref =
    `/emails/new?to=${encodeURIComponent(replyTo)}` +
    `&subject=${encodeURIComponent(subject.startsWith('Re:') ? subject : `Re: ${subject}`)}` +
    (jobId ? `&job=${jobId}` : '') +
    (customerId ? `&customer=${customerId}` : '') +
    (producedDraft ? `&body=${encodeURIComponent(output)}` : '');

  return (
    <Card>
      <CardHeader
        title="Assistant"
        description="Reads this email and drafts for you. It never sends anything."
      />
      <CardBody className="space-y-4">
        {!configured ? (
          <InfoNote>
            The assistant needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY</code> to{' '}
            <code>.env.local</code> and it appears here — nothing else on this page depends on it.
          </InfoNote>
        ) : null}

        <form action={action} className="space-y-4">
          <input type="hidden" name="emailId" value={emailId} />
          <input type="hidden" name="action" value={pendingAction} />
          <input type="hidden" name="draft" value={draft} />

          <div className="flex flex-wrap gap-2">
            {READ_ACTIONS.map((item) => (
              <SubmitButton
                key={item.action}
                variant="secondary"
                size="sm"
                disabled={!configured}
                onClick={() => setPendingAction(item.action)}
                pendingLabel="Reading…"
              >
                <Icon path={item.icon} size={14} />
                {item.label}
              </SubmitButton>
            ))}
          </div>

          <div className="border-t border-[var(--line-subtle)] pt-4">
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
              Your draft
            </label>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              placeholder="Draft a reply below, or paste one here and ask for it to be tightened up."
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {DRAFT_ACTIONS.map((item) => (
                <SubmitButton
                  key={item.action}
                  variant="secondary"
                  size="sm"
                  disabled={!configured || (item.action !== 'draft_reply' && !draft.trim())}
                  onClick={() => setPendingAction(item.action)}
                  pendingLabel="Writing…"
                >
                  <Icon path={item.icon} size={14} />
                  {item.label}
                </SubmitButton>
              ))}
            </div>
          </div>
        </form>

        {state.error ? (
          <InfoNote tone="danger">{state.error}</InfoNote>
        ) : null}

        {output ? (
          <div className="rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Draft — review before sending
              </span>
              <CopyButton value={output} />
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
              {output}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {producedDraft ? (
                <>
                  <button
                    type="button"
                    onClick={() => setDraft(output)}
                    className={buttonClass('secondary', 'sm')}
                  >
                    Use as my draft
                  </button>
                  <Link href={composeHref} className={buttonClass('primary', 'sm')}>
                    <Icon path={icons.send} size={14} />
                    Open in compose
                  </Link>
                </>
              ) : null}
              {state.data?.action === 'create_task' ? (
                <Link
                  href={`/tasks/new?title=${encodeURIComponent(output.split('\n')[0] ?? '')}&email=${emailId}${
                    jobId ? `&job=${jobId}` : ''
                  }${customerId ? `&customer=${customerId}` : ''}`}
                  className={buttonClass('primary', 'sm')}
                >
                  <Icon path={icons.check} size={14} />
                  Create this task
                </Link>
              ) : null}
              {state.data?.action === 'create_report' ? (
                <Link href={`/reports/new${jobId ? `?job=${jobId}` : ''}`} className={buttonClass('primary', 'sm')}>
                  <Icon path={icons.reports} size={14} />
                  Start the report
                </Link>
              ) : null}
            </div>
          </div>
        ) : existingSummary ? (
          <div className="rounded-[0.625rem] bg-[var(--surface-sunken)] p-4">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Summary from earlier
            </div>
            <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">{existingSummary}</p>
          </div>
        ) : null}

        <p className="text-xs text-[var(--text-muted)]">
          The assistant never sends email. You review every draft and press send yourself.
        </p>
      </CardBody>
    </Card>
  );
}
