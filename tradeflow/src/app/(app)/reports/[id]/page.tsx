import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { deleteReportAction, duplicateReportAction } from '../actions';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';
import { PhotoGrid } from '@/components/photos';
import { EmailReportPanel } from './email';
import { PhotoUploader } from '@/components/photo-uploader';
import { formatDate, formatDateTime } from '@/lib/format';
import { parseSections } from '@/lib/reports';
import { reportStatus } from '@/lib/domain';
import type { Json, Report } from '@/lib/database.types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('reports.view');
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('reports')
    .select('title')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  return { title: data?.title ?? 'Report' };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('reports.view');
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const report = data as Report;

  const [{ data: template }, { data: job }, { data: customer }, { data: photos }] =
    await Promise.all([
      supabase
        .from('report_templates')
        .select('name, sections')
        .eq('key', report.template_key)
        .or(`business_id.is.null,business_id.eq.${session.business.id}`)
        .limit(1)
        .maybeSingle(),
      report.job_id
        ? supabase.from('jobs').select('id, number, name').eq('id', report.job_id).maybeSingle()
        : Promise.resolve({ data: null }),
      report.customer_id
        ? supabase
            .from('customers')
            .select('id, name, company, email')
            .eq('id', report.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('job_photos')
        .select('id, storage_path, caption, category, taken_at, file_name')
        .eq('business_id', session.business.id)
        .eq('report_id', id)
        .is('deleted_at', null)
        .order('taken_at'),
    ]);

  const sections = parseSections((template?.sections ?? []) as Json);
  const answers = report.data as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={report.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-[var(--text-default)]">{report.number}</span>
            <span aria-hidden>·</span>
            <span>{template?.name ?? report.template_key}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(report.report_date)}</span>
            {job ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/jobs/${job.id}`} className="hover:text-[var(--accent)]">
                  {job.number}
                </Link>
              </>
            ) : null}
          </span>
        }
        breadcrumb={
          <Link href="/reports" className="hover:text-[var(--text-strong)]">
            Reports
          </Link>
        }
        actions={
          <>
            <ButtonLink href={`/reports/${report.id}/pdf`} target="_blank" variant="secondary">
              <Icon path={icons.eye} size={16} />
              PDF
            </ButtonLink>
            <ButtonLink href={`/reports/${report.id}/pdf?download=1`} variant="secondary">
              <Icon path={icons.download} size={16} />
              Download
            </ButtonLink>
            {session.can('reports.edit') ? (
              <>
                <form action={duplicateReportAction}>
                  <input type="hidden" name="id" value={report.id} />
                  <SubmitButton variant="secondary" pendingLabel="Copying…">
                    <Icon path={icons.copy} size={16} />
                    Duplicate
                  </SubmitButton>
                </form>
                <ButtonLink href={`/reports/${report.id}/edit`}>
                  <Icon path={icons.edit} size={16} />
                  Edit
                </ButtonLink>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
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

          {sections.map((section) => {
            const filled = section.fields.filter(
              (field) =>
                field.type !== 'photos' &&
                field.type !== 'signature' &&
                answers[field.id] !== undefined &&
                answers[field.id] !== null &&
                answers[field.id] !== ''
            );
            if (filled.length === 0) return null;

            return (
              <Card key={section.id}>
                <CardHeader title={section.title} />
                <CardBody className="space-y-4">
                  {filled.map((field) => {
                    const value = answers[field.id];
                    const text =
                      field.type === 'checkbox'
                        ? value === true
                          ? 'Yes'
                          : 'No'
                        : field.type === 'date' && typeof value === 'string'
                          ? formatDate(value)
                          : String(value);
                    return (
                      <div key={field.id}>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                          {field.label}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                          {text}
                        </p>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            );
          })}

          <Card>
            <CardHeader
              title="Photos"
              description={`${(photos ?? []).length} attached to this report`}
            />
            <CardBody className="space-y-5">
              <PhotoGrid
                photos={photos ?? []}
                columns={3}
                emptyMessage="No photos attached."
              />
              {session.can('photos.edit') ? (
                <div className="border-t border-[var(--line-subtle)] pt-5">
                  <PhotoUploader reportId={report.id} jobId={report.job_id ?? undefined} compact />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: 'Status',
                    value: (
                      <Badge tone={reportStatus(report.status).tone}>
                        {reportStatus(report.status).label}
                      </Badge>
                    ),
                  },
                  { label: 'Date', value: formatDate(report.report_date) },
                  {
                    label: 'Job',
                    value: job ? (
                      <Link href={`/jobs/${job.id}`} className="text-[var(--accent)] hover:underline">
                        {job.number} — {job.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Customer',
                    value: customer ? (
                      <Link
                        href={`/customers/${customer.id}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        {customer.company || customer.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Signed',
                    value: report.signature_name
                      ? `${report.signature_name}${report.signed_at ? ` · ${formatDateTime(report.signed_at)}` : ''}`
                      : 'Not signed',
                  },
                  {
                    label: 'Sent',
                    value: report.sent_at ? formatDateTime(report.sent_at) : 'Not sent',
                  },
                ]}
              />
            </CardBody>
          </Card>

          {session.can('reports.edit') ? (
            <EmailReportPanel
              reportId={report.id}
              defaultTo={customer?.email ?? ''}
              alreadySent={Boolean(report.sent_at)}
            />
          ) : null}

          {session.can('reports.edit') ? (
            <Card className="border-[var(--bad)]/25">
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">Remove report</h3>
                <form action={deleteReportAction} className="mt-3">
                  <input type="hidden" name="id" value={report.id} />
                  <ConfirmSubmit
                    confirmTitle={`Remove ${report.number}?`}
                    confirmBody="Photos attached to it stay on the job."
                    confirmLabel="Remove report"
                    size="md"
                  >
                    <Icon path={icons.trash} size={16} />
                    Remove report
                  </ConfirmSubmit>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
