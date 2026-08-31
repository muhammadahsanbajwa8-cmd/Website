'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, notifyRoles, recordActivity, requireCapability } from '@/lib/session';
import { fieldErrors, taskSchema } from '@/lib/validation';
import { describeError, fail, invalid, type ActionState } from '@/lib/action-state';

export async function saveTaskAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('tasks.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = taskSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    priority: formData.get('priority') || 'medium',
    status: formData.get('status') || 'open',
    jobId: formData.get('jobId') || null,
    customerId: formData.get('customerId') || null,
    assignedTo: formData.get('assignedTo') || null,
    dueDate: formData.get('dueDate'),
    source: formData.get('source') || 'manual',
    emailId: formData.get('emailId') || null,
    reportId: formData.get('reportId') || null,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const now = new Date().toISOString();
  const values = {
    business_id: session.business.id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority,
    status: parsed.data.status,
    job_id: parsed.data.jobId ?? null,
    customer_id: parsed.data.customerId ?? null,
    assigned_to: parsed.data.assignedTo ?? null,
    due_date: parsed.data.dueDate ?? null,
    source: parsed.data.source,
    email_id: parsed.data.emailId ?? null,
    report_id: parsed.data.reportId ?? null,
    completed_at:
      parsed.data.status === 'completed' || parsed.data.status === 'verified' ? now : null,
    verified_at: parsed.data.status === 'verified' ? now : null,
  };

  let taskId = id;

  if (id) {
    const { error } = await supabase
      .from('job_tasks')
      .update(values)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data, error } = await supabase
      .from('job_tasks')
      .insert({ ...values, created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) return fail(describeError(error));
    taskId = data.id;

    await recordActivity(session, {
      verb: 'created',
      summary: `Task added: ${parsed.data.title}`,
      entityType: 'job_task',
      entityId: data.id,
      jobId: parsed.data.jobId ?? null,
      customerId: parsed.data.customerId ?? null,
    });

    // Somebody else's task is worth a notification; your own is not.
    if (parsed.data.assignedTo) {
      await notifyRoles(session, ['owner', 'admin', 'manager', 'worker'], {
        kind: 'task_created',
        title: `New task: ${parsed.data.title}`,
        body: parsed.data.dueDate ? `Due ${parsed.data.dueDate}` : null,
        link: `/tasks/${data.id}`,
      });
    }
  }

  await audit(session.business.id, {
    action: id ? 'task.update' : 'task.create',
    entityType: 'job_task',
    entityId: taskId,
  });

  revalidatePath('/tasks');
  revalidatePath('/dashboard');
  if (parsed.data.jobId) revalidatePath(`/jobs/${parsed.data.jobId}`);
  redirect(`/tasks/${taskId}`);
}

/** The one-tap status change from a list. */
export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const session = await requireCapability('tasks.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !status) return;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: task } = await supabase
    .from('job_tasks')
    .select('title, job_id')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  await supabase
    .from('job_tasks')
    .update({
      status: status as never,
      completed_at: status === 'completed' || status === 'verified' ? now : null,
      verified_at: status === 'verified' ? now : null,
      verified_by: status === 'verified' ? session.teamMemberId : null,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (task && (status === 'completed' || status === 'verified')) {
    await recordActivity(session, {
      verb: status,
      summary: `Task ${status}: ${task.title}`,
      entityType: 'job_task',
      entityId: id,
      jobId: task.job_id,
    });
  }

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  revalidatePath('/dashboard');
  if (task?.job_id) revalidatePath(`/jobs/${task.job_id}`);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const session = await requireCapability('tasks.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/tasks');

  const supabase = await createClient();
  await supabase
    .from('job_tasks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'task.delete', entityType: 'job_task', entityId: id });
  revalidatePath('/tasks');
  redirect('/tasks');
}
