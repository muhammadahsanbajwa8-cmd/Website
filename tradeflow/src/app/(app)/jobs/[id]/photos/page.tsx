import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';
import { deletePhotoAction } from '@/app/(app)/photos/actions';
import { Card, CardBody, CardHeader, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { PhotoUploader } from '@/components/photo-uploader';
import { formatDateTime } from '@/lib/format';
import { PHOTO_CATEGORIES } from '@/lib/domain';

export const metadata = { title: 'Job photos' };

const CATEGORY_LABEL = new Map(PHOTO_CATEGORIES.map((c) => [c.value as string, c.label]));

export default async function JobPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireBusiness();
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from('jobs')
    .select('id, number, name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!job) notFound();

  const { data: photos } = await supabase
    .from('job_photos')
    .select('id, storage_path, caption, category, taken_at, file_name, size_bytes')
    .eq('business_id', session.business.id)
    .eq('job_id', id)
    .is('deleted_at', null)
    .order('taken_at', { ascending: false });

  const list = photos ?? [];
  const urls = await signedUrls('photos', list.map((photo) => photo.storage_path));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Photos"
        description={`${list.length} photo${list.length === 1 ? '' : 's'} on ${job.name}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/jobs" className="hover:text-[var(--text-strong)]">
              Jobs
            </Link>
            <span>/</span>
            <Link href={`/jobs/${job.id}`} className="hover:text-[var(--text-strong)]">
              {job.number}
            </Link>
          </span>
        }
      />

      {session.can('photos.edit') ? (
        <Card className="mb-5">
          <CardHeader title="Add photos" description="Straight from the camera, or from the library." />
          <CardBody>
            <PhotoUploader jobId={job.id} />
          </CardBody>
        </Card>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon path={icons.camera} size={20} />}
            title="No photos on this job"
            description="Before, during and after shots make a defect argument a lot shorter."
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((photo) => {
            const url = urls.get(photo.storage_path);
            return (
              <li key={photo.id}>
                <Card className="overflow-hidden">
                  <a
                    href={url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-[var(--surface-sunken)]"
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={photo.caption ?? photo.file_name}
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <span className="flex aspect-[4/3] w-full items-center justify-center text-[var(--text-muted)]">
                        <Icon path={icons.camera} size={24} />
                      </span>
                    )}
                  </a>
                  <CardBody className="p-3.5">
                    <p className="truncate text-sm font-medium text-[var(--text-strong)]">
                      {photo.caption || photo.file_name}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {CATEGORY_LABEL.get(photo.category) ?? photo.category} ·{' '}
                      {formatDateTime(photo.taken_at)}
                    </p>

                    {session.can('photos.edit') ? (
                      <form action={deletePhotoAction} className="mt-3">
                        <input type="hidden" name="id" value={photo.id} />
                        <input type="hidden" name="jobId" value={job.id} />
                        <ConfirmSubmit
                          confirmTitle="Delete this photo?"
                          confirmBody="The image file is removed from storage as well."
                          confirmLabel="Delete photo"
                        >
                          <Icon path={icons.trash} size={14} />
                          Delete
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
