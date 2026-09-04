import Link from 'next/link';
import { requireCustomer } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatRelative } from '@/lib/format';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import type { Report } from '@/lib/database.types';

export const metadata = { title: 'Reports' };

/**
 * Every report written up for this customer.
 *
 * Only reports that have actually been sent: a draft is the business's working
 * copy, and the row level policy will not return one here even if this page
 * asked for it.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireCustomer();
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from('reports')
    .select('id, number, title, report_date, sent_at, viewed_at, job_id, summary')
    .eq('business_id', session.link.businessId)
    .eq('customer_id', session.link.customerId)
    .is('deleted_at', null)
    .not('sent_at', 'is', null)
    .order('report_date', { ascending: false })
    .limit(100);

  const reports = (data ?? []) as Pick<
    Report,
    'id' | 'number' | 'title' | 'report_date' | 'sent_at' | 'viewed_at' | 'job_id' | 'summary'
  >[];

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`What ${session.link.businessName} wrote up after each visit. Yours to keep — open or download any of them.`}
      />

      {error === 'missing' ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            That report could not be opened. It may have been withdrawn — ask{' '}
            {session.link.businessName} to send it again.
          </InfoNote>
        </div>
      ) : null}

      {reports.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Icon path={icons.reports} size={22} />}
              title="No reports yet"
              description="After a visit, the person who did the work writes it up. When it is sent to you it appears here and stays here."
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--line-subtle)]">
            {reports.map((report) => (
              <li key={report.id}>
                <Link
                  href={`/portal/reports/${report.id}`}
                  className="flex items-start gap-4 px-5 py-4 hover:bg-[var(--surface-sunken)]"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon path={icons.reports} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-strong)]">
                      {report.title}
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {report.number} · {formatDate(report.report_date)}
                    </div>
                    {report.summary ? (
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--text-muted)]">
                        {report.summary}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {report.viewed_at ? null : <Badge tone="info">New</Badge>}
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      Sent {formatRelative(report.sent_at)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
