'use client';

import { useActionState, useState } from 'react';
import { emailReportAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  InfoNote,
  Input,
  Textarea,
} from '@/components/ui';
import { CopyButton, SubmitButton } from '@/components/ui/client';
import { formatDateTime } from '@/lib/format';

/**
 * Sending a report.
 *
 * Everything the person needs to decide with is on screen before they press
 * the button: who it is going to, where that address came from, and whether it
 * has been sent before. Nothing here reports success the send did not have —
 * the state comes back from the server after the provider answered.
 */
export function EmailReportPanel({
  reportId,
  defaultTo,
  recipientReason,
  alreadySent,
  sentAt,
  sentTo,
  sendCount,
  sendError,
  shareUrl,
  viewedAt,
}: {
  reportId: string;
  defaultTo: string;
  recipientReason: string | null;
  alreadySent: boolean;
  sentAt: string | null;
  sentTo: string | null;
  sendCount: number;
  sendError: string | null;
  shareUrl: string | null;
  viewedAt: string | null;
}) {
  const [state, action] = useActionState(emailReportAction, idleState);
  const [open, setOpen] = useState(!alreadySent);

  const liveShareUrl = (state.data?.shareUrl as string | undefined) ?? shareUrl;
  const sent = alreadySent || Boolean(state.data?.delivered);

  return (
    <Card>
      <CardHeader
        title={sent ? 'Sent to the customer' : 'Send to the customer'}
        description={
          sent
            ? 'They can open it online or read the PDF attached to the email.'
            : 'Emails the PDF and gives them a private link — no account needed.'
        }
      />

      <CardBody className="space-y-4">
        <FormError>{state.error}</FormError>
        {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

        {/* What has happened so far, before anything is pressed. */}
        {alreadySent ? (
          <dl className="grid gap-2 rounded-[0.625rem] bg-[var(--surface-sunken)] p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Sent to</dt>
              <dd className="font-medium">{sentTo}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">When</dt>
              <dd>{sentAt ? formatDateTime(sentAt) : '—'}</dd>
            </div>
            {sendCount > 1 ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Times sent</dt>
                <dd>{sendCount}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Opened</dt>
              <dd>
                {viewedAt ? (
                  <Badge tone="success">{formatDateTime(viewedAt)}</Badge>
                ) : (
                  <Badge tone="neutral">Not yet</Badge>
                )}
              </dd>
            </div>
          </dl>
        ) : null}

        {sendError && !alreadySent ? (
          <InfoNote tone="danger">
            <strong>The last attempt failed.</strong> {sendError}
          </InfoNote>
        ) : null}

        {liveShareUrl ? (
          <div className="flex items-center gap-2 rounded-[0.625rem] border border-[var(--line-subtle)] p-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-muted)]">
              {liveShareUrl}
            </span>
            <CopyButton value={liveShareUrl} label="Copy link" />
          </div>
        ) : null}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-[var(--accent)] hover:underline">
            Send it again
          </button>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="id" value={reportId} />
            {alreadySent ? <input type="hidden" name="resend" value="1" /> : null}

            <Field
              label="Send to"
              htmlFor="to"
              error={state.fieldErrors?.to}
              hint={
                recipientReason
                  ? recipientReason
                  : defaultTo
                    ? 'Taken from the customer’s record. Change it here if it should go somewhere else.'
                    : 'No address on file for this customer.'
              }
            >
              <Input
                id="to"
                name="to"
                type="email"
                autoCapitalize="none"
                defaultValue={sentTo ?? defaultTo}
                placeholder="name@example.com"
                required={!defaultTo}
              />
            </Field>

            <Field label="Anything to say with it" htmlFor="message">
              <Textarea
                id="message"
                name="message"
                rows={3}
                placeholder="Here is where we got to this week. The two items listed need your go-ahead before we can finish."
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingLabel="Sending…">
                {alreadySent ? 'Send again' : 'Send report'}
              </SubmitButton>
              {alreadySent ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-[var(--text-muted)] hover:underline"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
