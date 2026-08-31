import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { deleteWorkLogAction } from '../../field/actions';
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { formatDate } from '@/lib/format';
import { formatMinutes, minutesToDecimalHours } from '@/lib/calc';
import type { WorkLog } from '@/lib/database.types';

export const metadata = { title: 'Shift' };

export default async function WorkLogPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('worklogs.view');
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('work_logs')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const log = data as WorkLog;

  const { data: job } = await supabase
    .from('jobs')
    .select('id, number, name')
    .eq('id', log.job_id)
    .maybeSingle();

  const crewMinutes = log.total_minutes * Math.max(log.worker_count, 1);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={formatDate(log.work_date)}
        description={job ? `${job.number} — ${job.name}` : undefined}
        breadcrumb={
          <Link href="/timesheets" className="hover:text-[var(--text-strong)]">
            Timesheets
          </Link>
        }
        actions={
          session.can('worklogs.edit') ? (
            <ButtonLink href={`/timesheets/${log.id}/edit`}>
              <Icon path={icons.edit} size={16} />
              Edit
            </ButtonLink>
          ) : null
        }
      />

      <div className="space-y-5">
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Hours
              </div>
              <div className="mt-1 text-2xl font-semibold tabular text-[var(--text-strong)]">
                {formatMinutes(log.total_minutes)}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {minutesToDecimalHours(log.total_minutes)} decimal
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Crew hours
              </div>
              <div className="mt-1 text-2xl font-semibold tabular text-[var(--text-strong)]">
                {formatMinutes(crewMinutes)}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {log.worker_count} worker{log.worker_count === 1 ? '' : 's'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Times
              </div>
              <div className="mt-1 text-2xl font-semibold tabular text-[var(--text-strong)]">
                {log.start_time && log.finish_time
                  ? `${log.start_time.slice(0, 5)}–${log.finish_time.slice(0, 5)}`
                  : '—'}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {log.break_minutes} minute break
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="On the day" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: 'Work completed', value: log.work_completed || '—' },
                { label: 'Materials used', value: log.materials_used || '—' },
                { label: 'Plant and equipment', value: log.equipment_used || '—' },
                { label: 'Weather', value: log.weather || '—' },
                { label: 'Problems', value: log.problems || '—' },
                { label: 'Notes', value: log.notes || '—' },
              ]}
            />
          </CardBody>
        </Card>

        {session.can('worklogs.edit') ? (
          <Card className="border-[var(--bad)]/25">
            <CardBody>
              <form action={deleteWorkLogAction}>
                <input type="hidden" name="id" value={log.id} />
                <ConfirmSubmit
                  confirmTitle="Remove this shift?"
                  confirmBody="The hours come off the job's labour total."
                  confirmLabel="Remove shift"
                  size="md"
                >
                  <Icon path={icons.trash} size={16} />
                  Remove shift
                </ConfirmSubmit>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
