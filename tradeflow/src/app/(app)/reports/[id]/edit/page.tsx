import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { PageHeader } from '@/components/ui';
import { parseSections } from '@/lib/reports';
import { ReportForm } from '../../form';
import type { Json, Report } from '@/lib/database.types';

export const metadata = { title: 'Edit report' };

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('reports.edit');
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

  const [{ data: template }, jobs, customers, { data: attached }] = await Promise.all([
    supabase
      .from('report_templates')
      .select('key, name, description, sections')
      .eq('key', report.template_key)
      .or(`business_id.is.null,business_id.eq.${session.business.id}`)
      .limit(1)
      .maybeSingle(),
    jobOptions(session.business.id),
    customerOptions(session.business.id),
    supabase
      .from('job_photos')
      .select('id')
      .eq('business_id', session.business.id)
      .eq('report_id', id)
      .is('deleted_at', null),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${report.number}`}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/reports" className="hover:text-[var(--text-strong)]">
              Reports
            </Link>
            <span>/</span>
            <Link href={`/reports/${report.id}`} className="hover:text-[var(--text-strong)]">
              {report.number}
            </Link>
          </span>
        }
      />
      <ReportForm
        report={report}
        templateKey={report.template_key}
        templateName={template?.name ?? 'Report'}
        sections={parseSections((template?.sections ?? []) as Json)}
        templates={template ? [{ key: template.key, name: template.name, description: template.description }] : []}
        jobs={jobs}
        customers={customers}
        attachedPhotoIds={(attached ?? []).map((p) => p.id)}
      />
    </div>
  );
}
