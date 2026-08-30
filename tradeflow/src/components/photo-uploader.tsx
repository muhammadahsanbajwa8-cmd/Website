'use client';

import { useActionState, useRef, useState } from 'react';
import { uploadPhotosAction } from '@/app/(app)/photos/actions';
import { idleState } from '@/lib/action-state';
import { PHOTO_CATEGORIES } from '@/lib/domain';
import {
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  Select,
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/**
 * The camera control.
 *
 * `capture="environment"` on the first input makes a phone open the rear
 * camera directly rather than the photo library, which is the difference
 * between a report taking thirty seconds and taking three minutes. A second
 * input covers picking from the library.
 */
export function PhotoUploader({
  jobId,
  reportId,
  compact = false,
}: {
  jobId?: string;
  reportId?: string;
  compact?: boolean;
}) {
  const [state, action] = useActionState(uploadPhotosAction, idleState);
  const [selected, setSelected] = useState<File[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (state.ok && selected.length > 0) setSelected([]);

  return (
    <form ref={formRef} action={action} className={cn('space-y-4', compact && 'space-y-3')}>
      {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
      {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}

      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-[0.75rem] border-2 border-dashed border-[var(--line-default)] py-6 text-sm font-medium text-[var(--text-default)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        >
          <Icon path={icons.camera} size={24} />
          Take a photo
        </button>

        <button
          type="button"
          onClick={() => libraryRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-[0.75rem] border-2 border-dashed border-[var(--line-default)] py-6 text-sm font-medium text-[var(--text-default)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        >
          <Icon path={icons.upload} size={24} />
          Choose files
        </button>
      </div>

      {/* Both inputs post under the same name, so whichever the person used
          arrives as `photos`. */}
      <input
        ref={cameraRef}
        type="file"
        name="photos"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(event) => setSelected(Array.from(event.target.files ?? []))}
      />
      <input
        ref={libraryRef}
        type="file"
        name="photos"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="sr-only"
        onChange={(event) => setSelected(Array.from(event.target.files ?? []))}
      />

      {selected.length > 0 ? (
        <div className="rounded-[0.625rem] bg-[var(--surface-sunken)] px-3.5 py-2.5 text-sm">
          <span className="font-medium text-[var(--text-strong)]">
            {selected.length} photo{selected.length === 1 ? '' : 's'} ready
          </span>
          <ul className="mt-1 space-y-0.5 text-xs text-[var(--text-muted)]">
            {selected.slice(0, 4).map((file) => (
              <li key={file.name} className="truncate">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </li>
            ))}
            {selected.length > 4 ? <li>and {selected.length - 4} more</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="photo-category">
          <Select id="photo-category" name="category" defaultValue="general">
            {PHOTO_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Caption" htmlFor="photo-caption" hint="Applied to all photos in this batch.">
          <Input id="photo-caption" name="caption" placeholder="North wall, second course" />
        </Field>
      </div>

      <SubmitButton
        className="w-full"
        size="lg"
        disabled={selected.length === 0}
        pendingLabel="Uploading…"
      >
        {selected.length === 0
          ? 'Choose photos first'
          : `Upload ${selected.length} photo${selected.length === 1 ? '' : 's'}`}
      </SubmitButton>
    </form>
  );
}
