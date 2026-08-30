'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { UploadError, removeFile, uploadFile } from '@/lib/storage';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';
import { photoSchema, fieldErrors } from '@/lib/validation';
import type { PhotoCategory } from '@/lib/database.types';

/**
 * Photo upload.
 *
 * Several files arrive in one submission, and one bad file — a HEIC over the
 * size limit, say — must not lose the other nine. Each is attempted
 * independently and the result reports how many landed and what stopped the
 * rest.
 */
export async function uploadPhotosAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('photos.edit');

  const parsed = photoSchema.safeParse({
    jobId: formData.get('jobId') || null,
    reportId: formData.get('reportId') || null,
    caption: formData.get('caption'),
    category: formData.get('category') || 'general',
  });
  if (!parsed.success) return fail('Check the photo details', fieldErrors(parsed.error));

  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail('Choose at least one photo.');
  if (files.length > 30) return fail('Thirty photos at a time is the limit. Send the rest in a second batch.');

  const supabase = await createClient();
  const problems: string[] = [];
  let uploaded = 0;

  for (const file of files) {
    try {
      const stored = await uploadFile('photos', session.business.id, 'job', file);

      const { error } = await supabase.from('job_photos').insert({
        business_id: session.business.id,
        job_id: parsed.data.jobId ?? null,
        report_id: parsed.data.reportId ?? null,
        storage_path: stored.path,
        file_name: file.name.slice(0, 200),
        mime_type: stored.mime,
        size_bytes: stored.size,
        caption: parsed.data.caption ?? null,
        category: parsed.data.category,
        created_by: session.userId,
      });

      if (error) {
        // The object landed but the row did not; do not leave an orphan.
        await removeFile('photos', stored.path);
        problems.push(`${file.name}: ${describeError(error)}`);
        continue;
      }
      uploaded += 1;
    } catch (error) {
      problems.push(
        error instanceof UploadError ? error.message : `${file.name} could not be uploaded.`
      );
    }
  }

  if (uploaded > 0) {
    if (parsed.data.jobId) {
      await recordActivity(session, {
        verb: 'uploaded',
        summary: `${uploaded} photo${uploaded === 1 ? '' : 's'} added`,
        entityType: 'job_photo',
        jobId: parsed.data.jobId,
      });
      revalidatePath(`/jobs/${parsed.data.jobId}`);
      revalidatePath(`/jobs/${parsed.data.jobId}/photos`);
    }
    if (parsed.data.reportId) revalidatePath(`/reports/${parsed.data.reportId}`);
    await audit(session.business.id, {
      action: 'photo.upload',
      entityType: 'job',
      entityId: parsed.data.jobId ?? null,
      detail: { count: uploaded },
    });
  }

  if (problems.length > 0 && uploaded === 0) return fail(problems.join(' '));
  if (problems.length > 0) {
    return {
      ok: true,
      message: `${uploaded} photo${uploaded === 1 ? '' : 's'} added. ${problems.length} did not: ${problems.join(' ')}`,
    };
  }
  return ok(`${uploaded} photo${uploaded === 1 ? '' : 's'} added.`);
}

export async function updatePhotoAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('photos.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return fail('That photo was not found.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('job_photos')
    .update({
      caption: String(formData.get('caption') ?? '').slice(0, 500) || null,
      category: String(formData.get('category') ?? 'general') as PhotoCategory,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (error) return fail(describeError(error));

  const jobId = String(formData.get('jobId') ?? '');
  if (jobId) revalidatePath(`/jobs/${jobId}/photos`);
  return ok('Photo updated.');
}

export async function deletePhotoAction(formData: FormData): Promise<void> {
  const session = await requireCapability('photos.edit');
  const id = String(formData.get('id') ?? '');
  const jobId = String(formData.get('jobId') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const { data: photo } = await supabase
    .from('job_photos')
    .select('storage_path')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  // Soft delete the row, and remove the object: a deleted photo should stop
  // costing storage, and the row keeps the record that it existed.
  await supabase
    .from('job_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (photo?.storage_path) await removeFile('photos', photo.storage_path);

  await audit(session.business.id, { action: 'photo.delete', entityType: 'job_photo', entityId: id });

  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/photos`);
  }
}
