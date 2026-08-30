'use client';

import { useActionState, useRef } from 'react';
import { addJobNoteAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { Card, CardBody, CardHeader, FormError, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { formatDateTime } from '@/lib/format';

export function JobNotes({
  jobId,
  notes,
  canEdit,
}: {
  jobId: string;
  notes: { id: string; body: string; created_at: string; author: string }[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState(addJobNoteAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing after a success keeps the box ready for the next note rather than
  // leaving the last one sitting there to be posted twice.
  if (state.ok && formRef.current) formRef.current.reset();

  return (
    <Card>
      <CardHeader title="Notes" description="Anything worth writing down about this job." />

      {canEdit ? (
        <CardBody className="border-b border-[var(--line-subtle)]">
          <form ref={formRef} action={action} className="space-y-3">
            <input type="hidden" name="jobId" value={jobId} />
            <FormError>{state.error}</FormError>
            <Textarea
              name="body"
              rows={3}
              required
              placeholder="Gate code changed to 4821. Sparky booked for Thursday."
              aria-label="New note"
            />
            <SubmitButton size="sm" pendingLabel="Adding…">
              Add note
            </SubmitButton>
          </form>
        </CardBody>
      ) : null}

      {notes.length === 0 ? (
        <CardBody>
          <p className="text-sm text-[var(--text-muted)]">No notes yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-[var(--line-subtle)]">
          {notes.map((note) => (
            <li key={note.id} className="px-5 py-3.5">
              <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">{note.body}</p>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {note.author} · {formatDateTime(note.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
