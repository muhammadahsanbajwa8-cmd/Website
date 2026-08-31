'use client';

import { useActionState, useRef, useState } from 'react';
import { uploadDocumentsAction } from '../field/actions';
import { idleState } from '@/lib/action-state';
import {
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  Select,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

const CATEGORIES = [
  'general',
  'plans',
  'permits',
  'certificates',
  'warranties',
  'insurance',
  'contracts',
  'safety',
  'correspondence',
];

export function DocumentUploader({
  defaultJobId,
  defaultCustomerId,
}: {
  defaultJobId?: string;
  defaultCustomerId?: string;
}) {
  const [state, action] = useActionState(uploadDocumentsAction, idleState);
  const [names, setNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  if (state.ok && names.length > 0) setNames([]);

  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      {defaultJobId ? <input type="hidden" name="jobId" value={defaultJobId} /> : null}
      {defaultCustomerId ? (
        <input type="hidden" name="customerId" value={defaultCustomerId} />
      ) : null}

      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-[0.75rem] border-2 border-dashed border-[var(--line-default)] py-7 text-sm font-medium text-[var(--text-default)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      >
        <Icon path={icons.upload} size={24} />
        {names.length > 0
          ? `${names.length} file${names.length === 1 ? '' : 's'} ready`
          : 'Choose files'}
      </button>

      <input
        ref={inputRef}
        type="file"
        name="documents"
        multiple
        className="sr-only"
        onChange={(event) =>
          setNames(Array.from(event.target.files ?? []).map((file) => file.name))
        }
      />

      {names.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-[var(--text-muted)]">
          {names.slice(0, 5).map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
          {names.length > 5 ? <li>and {names.length - 5} more</li> : null}
        </ul>
      ) : null}

      <Field label="Category" htmlFor="doc-category">
        <Select id="doc-category" name="category" defaultValue="general">
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category.replace(/^./, (c) => c.toUpperCase())}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Description" htmlFor="doc-description">
        <Input id="doc-description" name="description" placeholder="Optional" />
      </Field>

      <SubmitButton className="w-full" disabled={names.length === 0} pendingLabel="Uploading…">
        Upload
      </SubmitButton>
    </form>
  );
}
