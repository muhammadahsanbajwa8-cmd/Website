'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { fieldErrors, jobNoteSchema, jobSchema } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';
import { jobStatus, type JobStatus } from '@/lib/domain';
import { moneyToCents } from '@/lib/money';

export async function saveJobAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('jobs.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = jobSchema.safeParse({
    name: formData.get('name'),
    customerId: formData.get('customerId') || null,
    description: formData.get('description'),
    siteAddressLine1: formData.get('siteAddressLine1'),
    siteSuburb: formData.get('siteSuburb'),
    siteState: formData.get('siteState'),
    sitePostcode: formData.get('sitePostcode'),
    status: formData.get('status') || 'lead',
    startDate: formData.get('startDate'),
    expectedCompletionDate: formData.get('expectedCompletionDate'),
    budgetCents: moneyToCents(formData.get('budget') as string),
    notes: formData.get('notes'),
    assignedTeamMemberIds: formData.getAll('assignedTeamMemberIds').map(String).filter(Boolean),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    customer_id: parsed.data.customerId ?? null,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    site_address_line1: parsed.data.siteAddressLine1 ?? null,
    site_suburb: parsed.data.siteSuburb ?? null,
    site_state: parsed.data.siteState ?? null,
    site_postcode: parsed.data.sitePostcode ?? null,
    status: parsed.data.status,
    start_date: parsed.data.startDate ?? null,
    expected_completion_date: parsed.data.expectedCompletionDate ?? null,
    budget_cents: parsed.data.budgetCents || null,
    notes: parsed.data.notes ?? null,
  };

  let jobId = id;

  if (id) {
    const { data: before } = await supabase
      .from('jobs')
      .select('status, name')
      .eq('id', id)
      .eq('business_id', session.business.id)
      .maybeSingle();

    const { error } = await supabase
      .from('jobs')
      .update({
        ...values,
        // Completing a job stamps the time; reopening one clears it.
        completed_at:
          parsed.data.status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .eq('business_id', session.business.id);

    if (error) return fail(describeError(error));

    if (before && before.status !== parsed.data.status) {
      await recordActivity(session, {
        verb: 'status_changed',
        summary: `Job moved from ${jobStatus(before.status).label} to ${jobStatus(parsed.data.status).label}`,
        entityType: 'job',
        entityId: id,
        jobId: id,
        customerId: parsed.data.customerId ?? null,
      });
    } else {
      await recordActivity(session, {
        verb: 'updated',
        summary: `Job ${parsed.data.name} updated`,
        entityType: 'job',
        entityId: id,
        jobId: id,
        customerId: parsed.data.customerId ?? null,
      });
    }
    await audit(session.business.id, { action: 'job.update', entityType: 'job', entityId: id });
  } else {
    const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
      target: session.business.id,
      doc_kind: 'job',
    });
    if (numberError || !number) return fail(describeError(numberError));

    const { data, error } = await supabase
      .from('jobs')
      .insert({ ...values, number, created_by: session.userId })
      .select('id')
      .single();

    if (error || !data) return fail(describeError(error));
    jobId = data.id;

    await recordActivity(session, {
      verb: 'created',
      summary: `Job ${number} — ${parsed.data.name} created`,
      entityType: 'job',
      entityId: data.id,
      jobId: data.id,
      customerId: parsed.data.customerId ?? null,
    });
    await audit(session.business.id, { action: 'job.create', entityType: 'job', entityId: data.id });
  }

  if (!jobId) return fail('The job could not be saved.');

  // Assignments are replaced wholesale: the form always posts the full set.
  await supabase.from('job_assignments').delete().eq('job_id', jobId).eq('business_id', session.business.id);
  if (parsed.data.assignedTeamMemberIds.length > 0) {
    await supabase.from('job_assignments').insert(
      parsed.data.assignedTeamMemberIds.map((teamMemberId) => ({
        business_id: session.business.id,
        job_id: jobId,
        team_member_id: teamMemberId,
      }))
    );
  }

  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}`);
}

/** The one-tap status change from the job page. */
export async function changeJobStatusAction(formData: FormData): Promise<void> {
  const session = await requireCapability('jobs.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') as JobStatus;
  if (!id || !status) redirect('/jobs');

  const supabase = await createClient();
  const { data: job } = await supabase
    .from('jobs')
    .select('status, name, customer_id')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!job) redirect('/jobs');

  await supabase
    .from('jobs')
    .update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await recordActivity(session, {
    verb: 'status_changed',
    summary: `Job moved from ${jobStatus(job.status).label} to ${jobStatus(status).label}`,
    entityType: 'job',
    entityId: id,
    jobId: id,
    customerId: job.customer_id,
  });
  await audit(session.business.id, {
    action: 'job.status_change',
    entityType: 'job',
    entityId: id,
    detail: { from: job.status, to: status },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath('/jobs');
}

export async function addJobNoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('jobs.edit');

  const parsed = jobNoteSchema.safeParse({
    jobId: formData.get('jobId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.from('job_notes').insert({
    business_id: session.business.id,
    job_id: parsed.data.jobId,
    body: parsed.data.body,
    created_by: session.userId,
  });

  if (error) return fail(describeError(error));

  await recordActivity(session, {
    verb: 'noted',
    summary: 'Note added to the job',
    entityType: 'job_note',
    jobId: parsed.data.jobId,
  });

  revalidatePath(`/jobs/${parsed.data.jobId}`);
  return ok('Note added.');
}

export async function deleteJobAction(formData: FormData): Promise<void> {
  const session = await requireCapability('jobs.delete');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/jobs');

  const supabase = await createClient();
  const { data: job } = await supabase
    .from('jobs')
    .select('number, name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  await supabase
    .from('jobs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (job) {
    await recordActivity(session, {
      verb: 'deleted',
      summary: `Job ${job.number} — ${job.name} removed`,
      entityType: 'job',
      entityId: id,
    });
  }
  await audit(session.business.id, { action: 'job.delete', entityType: 'job', entityId: id });

  revalidatePath('/jobs');
  redirect('/jobs');
}
