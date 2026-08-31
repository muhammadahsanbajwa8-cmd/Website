import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { signedUrls, humanFileSize } from '@/lib/storage';
import { deleteDocumentAction } from '../field/actions';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SearchInput } from '@/components/ui/client';
import { FilterBar, Pagination } from '@/components/list';
import { DocumentUploader } from './uploader';
import { formatDate } from '@/lib/format';
import type { JobDocument } from '@/lib/database.types';

export const metadata = { title: 'Documents' };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('documents.view');
  const params = await searchParams;
  const search = param(params, 'q');
  const jobId = param(params, 'job');
  const customerId = param(params, 'customer');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();
  let query = supabase
    .from('job_documents')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (jobId) query = query.eq('job_id', jobId);
  if (customerId) query = query.eq('customer_id', customerId);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`file_name.ilike.${pattern},description.ilike.${pattern},category.ilike.${pattern}`);
  }

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to);
  const documents = (data ?? []) as JobDocument[];

  const [urls, jobs, customers] = await Promise.all([
    signedUrls('documents', documents.map((d) => d.storage_path)),
    lookup('jobs', idsFrom(documents, (d) => d.job_id), 'id, number, name'),
    lookup('customers', idsFrom(documents, (d) => d.customer_id), 'id, name, company'),
  ]);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  for (const [key, value] of [['q', search], ['job', jobId], ['customer', customerId]] as const) {
    if (value) queryString.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Plans, permits, certificates, warranties and anything else that belongs to a job."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div>
          <FilterBar>
            <SearchInput placeholder="Search file name or description…" />
          </FilterBar>

          {documents.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Icon path={icons.documents} size={20} />}
                title={search ? 'Nothing matches that' : 'No documents yet'}
                description="Files here are private: every download link is signed and expires."
              />
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--line-subtle)]">
                {documents.map((document) => {
                  const url = urls.get(document.storage_path);
                  const job = document.job_id ? jobs.get(document.job_id) : null;
                  const customer = document.customer_id
                    ? customers.get(document.customer_id)
                    : null;

                  return (
                    <li key={document.id} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.5rem] bg-[var(--surface-sunken)] text-[var(--text-muted)]">
                        <Icon path={icons.file} size={18} />
                      </span>

                      <span className="min-w-0 flex-1">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-sm font-medium text-[var(--text-strong)] hover:text-[var(--accent)]"
                          >
                            {document.file_name}
                          </a>
                        ) : (
                          <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                            {document.file_name}
                          </span>
                        )}
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {[
                            humanFileSize(document.size_bytes),
                            formatDate(document.created_at.slice(0, 10)),
                            document.category !== 'general' ? document.category : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {job || customer ? (
                          <span className="mt-1 flex flex-wrap gap-2 text-xs">
                            {job ? (
                              <Link
                                href={`/jobs/${job.id}`}
                                className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
                              >
                                {job.number}
                              </Link>
                            ) : null}
                            {customer ? (
                              <Link
                                href={`/customers/${customer.id}`}
                                className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
                              >
                                {customer.company || customer.name}
                              </Link>
                            ) : null}
                          </span>
                        ) : null}
                      </span>

                      {session.can('documents.edit') ? (
                        <form action={deleteDocumentAction}>
                          <input type="hidden" name="id" value={document.id} />
                          <ConfirmSubmit
                            confirmTitle={`Delete ${document.file_name}?`}
                            confirmBody="The file is removed from storage as well."
                            confirmLabel="Delete file"
                          >
                            <Icon path={icons.trash} size={14} />
                          </ConfirmSubmit>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Pagination info={info} basePath="/documents" query={queryString} />
        </div>

        {session.can('documents.edit') ? (
          <Card className="h-fit">
            <CardHeader title="Upload" description="PDF, images, Word and Excel." />
            <CardBody>
              <DocumentUploader defaultJobId={jobId} defaultCustomerId={customerId} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
