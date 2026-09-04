import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { signedUrls } from '@/lib/storage';
import { parseSections } from '@/lib/reports';
import { formatDate, formatDateLong } from '@/lib/format';
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import type { Json, Report } from '@/lib/database.types';

export const metadata = { title: 'Report' };

/**
 * One report, in the portal.
 *
 * The report itself is read as the customer, so row level security decides
 * whether they may have it — a draft, or somebody else's, simply is not
 * returned. Only after that read succeeds are the template and the photo files
 * fetched with the service role, because neither is reachable by a customer
 * and both are needed to render what they are entitled to see.
 */
export default async function PortalReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCustomer();
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.link.businessId)
    .eq('customer_id', session.link.customerId)
    .is('deleted_at', null)
    .not('sent_at', 'is', null)
    .maybeSingle();

  if (!data) notFound();
  const report = data as Report;

  const admin = createAdminClient();

  const [{ data: template }, { data: photoRows }, { data: job }] = await Promise.all([
    admin
      .from('report_templates')
      .select('name, sections')
      .eq('key', report.template_key)
      .or(`business_id.is.null,business_id.eq.${report.business_id}`)
      .limit(1)
      .maybeSingle(),
    admin
      .from('job_photos')
      .select('storage_path, caption')
      .eq('business_id', report.business_id)
      .eq('report_id', report.id)
      .is('deleted_at', null)
      .order('taken_at')
      .limit(24),
    report.job_id
      ? admin
          .from('jobs')
          .select('id, number, name')
          .eq('id', report.job_id)
          .eq('business_id', report.business_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const photos = photoRows ?? [];
  const imageUrls = photos.length
    ? await signedUrls('photos', photos.map((photo) => photo.storage_path), 3600)
    : new Map<string, string>();

  const sections = parseSections((template?.sections ?? []) as Json);
  const answers = (report.data ?? {}) as Record<string, unknown>;
  const answered = sections
    .flatMap((section) =>
      section.fields.map((field) => ({ label: field.label, value: answers[field.id] }))
    )
    .filter(
      (entry) =>
        entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== ''
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={
          <Link href="/portal/reports" className="hover:text-[var(--accent)]">
            ← Reports
          </Link>
        }
        title={report.title}
        description={`${template?.name ?? 'Report'} ${report.number} · ${formatDateLong(report.report_date)}`}
        actions={
          <ButtonLink href={`/portal/reports/${report.id}/pdf?download=1`} variant="secondary">
            <Icon path={icons.download} size={17} />
            Download PDF
          </ButtonLink>
        }
      />

      <div className="space-y-5">
        {job ? (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  For the booking
                </div>
                <div className="mt-0.5 font-medium text-[var(--text-strong)]">
                  {job.name} · {job.number}
                </div>
              </div>
              <ButtonLink href={`/portal/bookings/${job.id}`} size="sm" variant="secondary">
                Open the booking
              </ButtonLink>
            </CardBody>
          </Card>
        ) : null}

        {report.summary ? (
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                {report.summary}
              </p>
            </CardBody>
          </Card>
        ) : null}

        {answered.length > 0 ? (
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-[var(--line-subtle)]">
              {answered.map((entry, index) => (
                <div key={index} className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <dt className="text-sm text-[var(--text-muted)]">{entry.label}</dt>
                  <dd className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                    {typeof entry.value === 'boolean'
                      ? entry.value
                        ? 'Yes'
                        : 'No'
                      : String(entry.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}

        {photos.length > 0 ? (
          <Card>
            <CardHeader title="Photos" description="Taken on site." />
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => {
                  const url = imageUrls.get(photo.storage_path);
                  if (!url) return null;
                  return (
                    <figure
                      key={index}
                      className="overflow-hidden rounded-[0.625rem] border border-[var(--line-subtle)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={photo.caption ?? 'Site photo'}
                        className="aspect-4/3 w-full object-cover"
                      />
                      {photo.caption ? (
                        <figcaption className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
                          {photo.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
            <span>
              {report.signature_name ? `Signed by ${report.signature_name} · ` : ''}
              Sent to you on {formatDate(report.sent_at)}
            </span>
            <ButtonLink href="/portal/messages" size="sm" variant="ghost">
              Something not right?
            </ButtonLink>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
