'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { saveWorkLogAction } from '../field/actions';
import { idleState } from '@/lib/action-state';
import { formatMinutes, minutesToDecimalHours, workedMinutes } from '@/lib/calc';
import { todayInAustralia } from '@/lib/format';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
  buttonClass,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import type { JobOption } from '@/lib/pickers';
import type { WorkLog } from '@/lib/database.types';

const WEATHER = ['Fine', 'Overcast', 'Light rain', 'Heavy rain', 'Wind', 'Extreme heat'];

/**
 * The timesheet. Hours are worked out as the times are typed, including a
 * shift that runs past midnight, so nobody has to do the arithmetic on site.
 */
export function WorkLogForm({
  log,
  jobs,
  defaultJobId,
}: {
  log?: WorkLog;
  jobs: JobOption[];
  defaultJobId?: string;
}) {
  const [state, action] = useActionState(saveWorkLogAction, idleState);
  const [start, setStart] = useState(log?.start_time?.slice(0, 5) ?? '07:00');
  const [finish, setFinish] = useState(log?.finish_time?.slice(0, 5) ?? '15:30');
  const [breakMinutes, setBreakMinutes] = useState(String(log?.break_minutes ?? 30));
  const [workers, setWorkers] = useState(String(log?.worker_count ?? 1));

  const minutes = workedMinutes(start, finish, Number(breakMinutes) || 0);
  const crewMinutes = minutes * Math.max(Number(workers) || 1, 1);

  return (
    <form action={action} className="space-y-5" noValidate>
      {log ? <input type="hidden" name="id" value={log.id} /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="The shift" />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Job" htmlFor="jobId" error={state.fieldErrors?.jobId} required>
              <Select
                id="jobId"
                name="jobId"
                required
                defaultValue={log?.job_id ?? defaultJobId ?? ''}
                aria-invalid={Boolean(state.fieldErrors?.jobId)}
              >
                <option value="">Choose a job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.number} — {job.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date" htmlFor="workDate">
              <Input
                id="workDate"
                name="workDate"
                type="date"
                defaultValue={log?.work_date ?? todayInAustralia()}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Start" htmlFor="startTime">
              <Input
                id="startTime"
                name="startTime"
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field label="Finish" htmlFor="finishTime">
              <Input
                id="finishTime"
                name="finishTime"
                type="time"
                value={finish}
                onChange={(event) => setFinish(event.target.value)}
              />
            </Field>
            <Field label="Break (min)" htmlFor="breakMinutes">
              <Input
                id="breakMinutes"
                name="breakMinutes"
                type="number"
                inputMode="numeric"
                min={0}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </Field>
            <Field label="Workers" htmlFor="workerCount">
              <Input
                id="workerCount"
                name="workerCount"
                type="number"
                inputMode="numeric"
                min={0}
                value={workers}
                onChange={(event) => setWorkers(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 rounded-[0.625rem] bg-[var(--surface-sunken)] p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Hours worked
              </div>
              <div className="mt-0.5 text-xl font-semibold tabular text-[var(--text-strong)]">
                {formatMinutes(minutes)}
                <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                  {minutesToDecimalHours(minutes)} h
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Crew hours
              </div>
              <div className="mt-0.5 text-xl font-semibold tabular text-[var(--text-strong)]">
                {formatMinutes(crewMinutes)}
              </div>
            </div>
            {finish < start ? (
              <p className="text-xs text-[var(--text-muted)] sm:col-span-2">
                Finish is before start, so this is counted as a shift running past midnight.
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What happened" />
        <CardBody className="space-y-5">
          <Field label="Work completed" htmlFor="workCompleted">
            <Textarea
              id="workCompleted"
              name="workCompleted"
              rows={3}
              defaultValue={log?.work_completed ?? ''}
              placeholder="Two courses of face brick to the front elevation. Lintels set over both openings."
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Materials used" htmlFor="materialsUsed">
              <Textarea id="materialsUsed" name="materialsUsed" rows={2} defaultValue={log?.materials_used ?? ''} />
            </Field>
            <Field label="Plant and equipment" htmlFor="equipmentUsed">
              <Textarea id="equipmentUsed" name="equipmentUsed" rows={2} defaultValue={log?.equipment_used ?? ''} />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Weather" htmlFor="weather">
              <Select id="weather" name="weather" defaultValue={log?.weather ?? ''}>
                <option value="">Not recorded</option>
                {WEATHER.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Problems or delays" htmlFor="problems">
              <Input id="problems" name="problems" defaultValue={log?.problems ?? ''} />
            </Field>
          </div>

          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} defaultValue={log?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {log ? 'Save shift' : 'Log the shift'}
        </SubmitButton>
        <Link
          href={log ? `/timesheets/${log.id}` : '/timesheets'}
          className={buttonClass('secondary', 'lg')}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
