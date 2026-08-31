'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveTaskAction } from './actions';
import { idleState } from '@/lib/action-state';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/domain';
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
import type { CustomerOption, JobOption, TeamOption } from '@/lib/pickers';
import type { JobTask } from '@/lib/database.types';

export function TaskForm({
  task,
  jobs,
  customers,
  team,
  defaults,
}: {
  task?: JobTask;
  jobs: JobOption[];
  customers: CustomerOption[];
  team: TeamOption[];
  defaults?: { jobId?: string; customerId?: string; title?: string; emailId?: string; dueDate?: string; priority?: string };
}) {
  const [state, action] = useActionState(saveTaskAction, idleState);

  return (
    <form action={action} className="space-y-5" noValidate>
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      {defaults?.emailId ? <input type="hidden" name="emailId" value={defaults.emailId} /> : null}
      {defaults?.emailId ? <input type="hidden" name="source" value="email" /> : null}
      <FormError>{state.error}</FormError>

      <Card>
        <CardHeader title="The task" />
        <CardBody className="space-y-5">
          <Field label="What needs doing" htmlFor="title" error={state.fieldErrors?.title} required>
            <Input
              id="title"
              name="title"
              required
              autoFocus={!task}
              defaultValue={task?.title ?? defaults?.title ?? ''}
              placeholder="Repair damaged brickwork at 14 Wattle Street"
            />
          </Field>

          <Field label="Detail" htmlFor="description">
            <Textarea id="description" name="description" rows={3} defaultValue={task?.description ?? ''} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Priority" htmlFor="priority">
              <Select id="priority" name="priority" defaultValue={task?.priority ?? defaults?.priority ?? 'medium'}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={task?.status ?? 'open'}>
                {TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Due" htmlFor="dueDate" error={state.fieldErrors?.dueDate}>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={task?.due_date ?? defaults?.dueDate ?? ''}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who and where" />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <Field label="Assign to" htmlFor="assignedTo">
            <Select id="assignedTo" name="assignedTo" defaultValue={task?.assigned_to ?? ''}>
              <option value="">Nobody yet</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name ?? member.email}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Job" htmlFor="jobId">
            <Select id="jobId" name="jobId" defaultValue={task?.job_id ?? defaults?.jobId ?? ''}>
              <option value="">Not on a job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} — {job.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Customer" htmlFor="customerId">
            <Select
              id="customerId"
              name="customerId"
              defaultValue={task?.customer_id ?? defaults?.customerId ?? ''}
            >
              <option value="">No customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {task ? 'Save task' : 'Create task'}
        </SubmitButton>
        <Link href={task ? `/tasks/${task.id}` : '/tasks'} className={buttonClass('secondary', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
