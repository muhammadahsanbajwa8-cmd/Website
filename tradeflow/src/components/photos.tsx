import { signedUrls } from '@/lib/storage';
import { formatDateTime } from '@/lib/format';
import { Icon, icons } from '@/components/ui';
import { PHOTO_CATEGORIES } from '@/lib/domain';

export interface PhotoRow {
  id: string;
  storage_path: string;
  caption: string | null;
  category: string;
  taken_at: string;
  file_name: string;
}

const CATEGORY_LABEL = new Map(PHOTO_CATEGORIES.map((c) => [c.value as string, c.label]));

/**
 * A grid of job photos.
 *
 * URLs are signed on the server for the whole grid in one call — the bucket is
 * private, so there is no public URL to fall back on, and signing one at a
 * time would be one network round trip per thumbnail.
 */
export async function PhotoGrid({
  photos,
  emptyMessage = 'No photos yet.',
  columns = 4,
}: {
  photos: PhotoRow[];
  emptyMessage?: string;
  columns?: 3 | 4 | 6;
}) {
  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-muted)]">
          <Icon path={icons.camera} size={18} />
        </span>
        <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  const urls = await signedUrls(
    'photos',
    photos.map((photo) => photo.storage_path)
  );

  const gridClass =
    columns === 3
      ? 'grid-cols-2 sm:grid-cols-3'
      : columns === 6
        ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'
        : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  return (
    <ul className={`grid gap-3 ${gridClass}`}>
      {photos.map((photo) => {
        const url = urls.get(photo.storage_path);
        return (
          <li key={photo.id} className="group">
            <a
              href={url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-sunken)]"
            >
              {url ? (
                // Signed Supabase URLs are not a configured next/image domain,
                // and they expire; a plain img avoids the optimiser caching a
                // URL that will 403 in an hour.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={photo.caption ?? photo.file_name}
                  loading="lazy"
                  className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center text-[var(--text-muted)]">
                  <Icon path={icons.camera} size={22} />
                </span>
              )}
            </a>
            <div className="mt-1.5 px-0.5">
              {photo.caption ? (
                <p className="truncate text-xs font-medium text-[var(--text-strong)]">
                  {photo.caption}
                </p>
              ) : null}
              <p className="truncate text-[0.7rem] text-[var(--text-muted)]">
                {photo.category !== 'general'
                  ? `${CATEGORY_LABEL.get(photo.category) ?? photo.category} · `
                  : ''}
                {formatDateTime(photo.taken_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
