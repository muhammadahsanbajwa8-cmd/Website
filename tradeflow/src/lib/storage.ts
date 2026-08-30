import 'server-only';

import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Files.
 *
 * Every object key starts with the business id — `<business>/<kind>/<uuid>.<ext>`
 * — and the storage policies in migration 0003 read that first segment and
 * apply the same membership check as every other table. So a signed URL is
 * only ever issued for a file whose row the caller could already read, and a
 * guessed key belonging to another business is refused by the database.
 */

export type Bucket = 'photos' | 'documents' | 'logos' | 'receipts';

const MAX_BYTES: Record<Bucket, number> = {
  photos: 25 * 1024 * 1024,
  documents: 50 * 1024 * 1024,
  logos: 5 * 1024 * 1024,
  receipts: 25 * 1024 * 1024,
};

const ALLOWED_MIME: Record<Bucket, RegExp> = {
  photos: /^image\/(jpeg|png|webp|heic|heif)$/i,
  logos: /^image\/(jpeg|png|webp|svg\+xml)$/i,
  receipts: /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i,
  documents:
    /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.ms-excel$|text\/plain$|text\/csv$)/i,
};

export class UploadError extends Error {}

/** `<business>/<kind>/<uuid>.<ext>` — the shape every policy depends on. */
export function storageKey(businessId: string, kind: string, fileName: string): string {
  const extension = (fileName.split('.').pop() ?? 'bin')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return `${businessId}/${kind}/${randomUUID()}.${extension || 'bin'}`;
}

export function assertUploadable(bucket: Bucket, file: File): void {
  if (file.size === 0) throw new UploadError(`${file.name} is empty.`);
  if (file.size > MAX_BYTES[bucket]) {
    throw new UploadError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_BYTES[bucket] / 1024 / 1024} MB.`
    );
  }
  if (!ALLOWED_MIME[bucket].test(file.type || '')) {
    throw new UploadError(`${file.name} is a ${file.type || 'unknown'} file, which is not accepted here.`);
  }
}

/**
 * Upload as the signed-in user, so the storage policy — not this function —
 * decides whether the write is allowed.
 */
export async function uploadFile(
  bucket: Bucket,
  businessId: string,
  kind: string,
  file: File
): Promise<{ path: string; size: number; mime: string }> {
  assertUploadable(bucket, file);

  const supabase = await createClient();
  const path = storageKey(businessId, kind, file.name);
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) throw new UploadError(`${file.name} could not be uploaded: ${error.message}`);

  return { path, size: file.size, mime: file.type || 'application/octet-stream' };
}

/**
 * A time-limited URL for a private object.
 *
 * Signed with the service role, but only after the caller has established that
 * the row referencing the file is theirs — every call site reads that row
 * under RLS first. Signing here rather than in the browser keeps the object
 * key out of any client-side request the user could edit.
 */
export async function signedUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

/** Signed URLs for many objects at once, keyed by path. */
export async function signedUrls(
  bucket: Bucket,
  paths: string[],
  expiresInSeconds = 60 * 60
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return map;

  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrls(unique, expiresInSeconds);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

/** Read an object's bytes — used when embedding a logo or photo in a PDF. */
export async function downloadFile(
  bucket: Bucket,
  path: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mime: data.type || 'application/octet-stream',
  };
}

export async function removeFile(bucket: Bucket, path: string): Promise<void> {
  if (!path) return;
  const supabase = await createClient();
  await supabase.storage.from(bucket).remove([path]);
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
