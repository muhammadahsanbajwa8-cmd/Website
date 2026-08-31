import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { customerOptions, jobOptions } from '@/lib/pickers';
import { Card, CardBody, Icon, PageHeader, icons } from '@/components/ui';
import { parseSections } from '@/lib/reports';
import { ReportForm } from '../form';
import type { Json } from '@/lib/database.types';

export const metadata = { title: 'New report' };

/**
 * Two steps: pick a template, then fill it in. The picker is a page rather
 * than a dropdown because on a phone the template choice is the one decision
 * worth making deliberately — everything after it is typing.
 */
export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; job?: string; customer?: string }>;
}) {
  const session = await requireCapability('reports.edit');
  const { template: templateKey, job, customer } = await searchParams;

  const supabase = await createClient();
  const { data: templates } = await supabase
    .from('report_templates')
    .select('key, name, description, sections')
    .or(`business_id.is.null,business_id.eq.${session.business.id}`)
    .is('deleted_at', null)
    .order('is_system', { ascending: false })
    .order('name');

  const list = templates ?? [];
  const chosen = templateKey ? list.find((t) => t.key === templateKey) : null;

  if (!chosen) {
    const query = new URLSearchParams();
    if (job) query.set('job', job);
    if (customer) query.set('customer', customer);

    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="New report"
          description="Pick the template that matches what you are recording."
          breadcrumb={
            <Link href="/reports" className="hover:text-[var(--text-strong)]">
              Reports
            </Link>
          }
        />
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((template) => {
            const params = new URLSearchParams(query);
            params.set('template', template.key);
            return (
              <li key={template.key}>
                <Link
                  href={`/reports/new?${params.toString()}`}
                  className="flex h-full gap-3 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon path={icons.reports} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--text-strong)]">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block text-sm text-[var(--text-muted)]">
                      {template.description}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {list.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)]">
                No templates found. Run <code>npm run db:push</code> to load the stock report
                library.
              </p>
            </CardBody>
          </Card>
        ) : null}
      </div>
    );
  }

  const [jobs, customers] = await Promise.all([
    jobOptions(session.business.id),
    customerOptions(session.business.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={chosen.name}
        description={chosen.description ?? undefined}
        breadcrumb={
          <span className="flex gap-1.5">
            <Link href="/reports" className="hover:text-[var(--text-strong)]">
              Reports
            </Link>
            <span>/</span>
            <Link href="/reports/new" className="hover:text-[var(--text-strong)]">
              New
            </Link>
          </span>
        }
      />
      <ReportForm
        templateKey={chosen.key}
        templateName={chosen.name}
        sections={parseSections(chosen.sections as Json)}
        templates={list.map((t) => ({ key: t.key, name: t.name, description: t.description }))}
        jobs={jobs}
        customers={customers}
        defaultJobId={job}
        defaultCustomerId={customer}
      />
    </div>
  );
}
