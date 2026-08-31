'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { handleTurn, startCall } from '@/lib/voice/agent';
import { processEndedCall } from '@/lib/voice/after-call';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';

/**
 * The call log's actions: applying what a call asked for, correcting the agent
 * when it got something wrong, and driving the test console.
 */

/**
 * Turn a proposal into a real task.
 *
 * This is the confirmation step the phone agent deliberately does not take
 * itself. Nothing a caller says creates work until a person presses this.
 */
export async function applyCallActionAction(formData: FormData): Promise<void> {
  const session = await requireCapability('tasks.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const { data: action } = await supabase
    .from('call_actions')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!action || action.applied || action.dismissed) return;

  const { data: task, error } = await supabase
    .from('job_tasks')
    .insert({
      business_id: session.business.id,
      title: action.title,
      description: action.detail,
      priority: action.priority,
      status: 'open',
      due_date: action.due_date,
      job_id: action.suggested_job_id,
      customer_id: action.suggested_customer_id,
      source: 'customer_request',
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (error || !task) return;

  await supabase
    .from('call_actions')
    .update({ applied: true, applied_at: new Date().toISOString(), task_id: task.id })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await recordActivity(session, {
    verb: 'created',
    summary: `Task from a phone call: ${action.title}`,
    entityType: 'job_task',
    entityId: task.id,
    jobId: action.suggested_job_id,
    customerId: action.suggested_customer_id,
  });
  await audit(session.business.id, {
    action: 'call_action.apply',
    entityType: 'call_action',
    entityId: id,
    detail: { taskId: task.id },
  });

  revalidatePath(`/calls/${action.call_id}`);
  revalidatePath('/calls');
  revalidatePath('/tasks');
}

export async function dismissCallActionAction(formData: FormData): Promise<void> {
  const session = await requireCapability('tasks.edit');
  const id = String(formData.get('id') ?? '');
  const callId = String(formData.get('callId') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('call_actions')
    .update({ dismissed: true })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (callId) revalidatePath(`/calls/${callId}`);
  revalidatePath('/calls');
}

/**
 * Rate a call, and correct the agent.
 *
 * A correction becomes an approved knowledge note — the business's own words,
 * which the agent then quotes. Nothing is used to train a model: the private
 * conversation stays in the business's own database, and improvement happens
 * by writing down the right answer.
 */
export async function reviewCallAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('ai.use');
  const callId = String(formData.get('callId') ?? '');
  const rating = String(formData.get('rating') ?? '');
  if (!callId || (rating !== 'good' && rating !== 'needs_improvement')) {
    return fail('Choose whether the call went well.');
  }

  const misunderstanding = String(formData.get('misunderstanding') ?? '').trim() || null;
  const correction = String(formData.get('correction') ?? '').trim() || null;

  const supabase = await createClient();
  let knowledgeId: string | null = null;

  if (correction) {
    const { data: knowledge, error } = await supabase
      .from('ai_knowledge')
      .insert({
        business_id: session.business.id,
        title: misunderstanding
          ? `Correction: ${misunderstanding.slice(0, 120)}`
          : 'Correction from a call review',
        body: correction,
        category: 'correction',
        approved: true,
        created_by: session.userId,
      })
      .select('id')
      .single();

    if (error) return fail(describeError(error));
    knowledgeId = knowledge?.id ?? null;
  }

  const { error } = await supabase.from('ai_feedback').insert({
    business_id: session.business.id,
    call_id: callId,
    rating,
    misunderstanding,
    correction,
    applied_to_brain: Boolean(knowledgeId),
    knowledge_id: knowledgeId,
    created_by: session.userId,
  });

  if (error) return fail(describeError(error));

  await audit(session.business.id, {
    action: 'call.review',
    entityType: 'call',
    entityId: callId,
    detail: { rating, applied: Boolean(knowledgeId) },
  });

  revalidatePath(`/calls/${callId}`);
  revalidatePath('/settings/ai');

  return ok(
    knowledgeId
      ? 'Thanks — your correction has been added to the assistant\'s knowledge, so it will use ' +
          'your wording next time.'
      : 'Thanks, that has been recorded.'
  );
}

// --- the test console --------------------------------------------------------

/**
 * Start a test call from the browser.
 *
 * The same agent, the same brain, the same tools — the only difference is that
 * the words arrive typed rather than spoken. This is how a business tries the
 * assistant before buying a phone number, and how it checks a change to the
 * brain without ringing itself.
 */
export async function startTestCallAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('ai.use');
  const fromNumber = String(formData.get('fromNumber') ?? '').trim() || null;

  // Make sure a brain row exists before the first test.
  const supabase = await createClient();
  await supabase.rpc('ensure_ai_brain', { target: session.business.id });

  const started = await startCall({
    businessId: session.business.id,
    fromNumber,
    toNumber: 'test-console',
    provider: 'console',
  });

  if (!started) {
    return fail(
      'The assistant could not be started. Set it up first under Settings → AI assistant.'
    );
  }

  await audit(session.business.id, {
    action: 'call.test_start',
    entityType: 'call',
    entityId: started.callId,
  });

  redirect(`/calls/${started.callId}?console=1`);
}

export async function testTurnAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('ai.use');
  const callId = String(formData.get('callId') ?? '');
  const said = String(formData.get('said') ?? '').trim();

  if (!callId) return fail('No call.');
  if (!said) return fail('Type what the caller would say.');

  // The call must belong to this business — checked under RLS before the
  // service-role agent is handed the id.
  const supabase = await createClient();
  const { data: call } = await supabase
    .from('calls')
    .select('id, status')
    .eq('id', callId)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!call) return fail('That call was not found.');
  if (call.status !== 'in_progress') return fail('That call has already ended.');

  const result = await handleTurn({
    callId,
    businessId: session.business.id,
    said,
  });

  revalidatePath(`/calls/${callId}`);

  if (result.error) {
    return { ok: true, message: result.reply, data: { warning: result.error } };
  }
  return ok(result.reply, { escalated: result.escalated });
}

export async function endTestCallAction(formData: FormData): Promise<void> {
  const session = await requireCapability('ai.use');
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return;

  const supabase = await createClient();
  const { data: call } = await supabase
    .from('calls')
    .select('id')
    .eq('id', callId)
    .eq('business_id', session.business.id)
    .maybeSingle();
  if (!call) return;

  await processEndedCall(session.business.id, callId);

  await audit(session.business.id, {
    action: 'call.test_end',
    entityType: 'call',
    entityId: callId,
  });

  revalidatePath(`/calls/${callId}`);
  revalidatePath('/calls');
  redirect(`/calls/${callId}`);
}

/** Re-run the extraction on a call whose summary looks wrong. */
export async function reprocessCallAction(formData: FormData): Promise<void> {
  const session = await requireCapability('ai.use');
  const callId = String(formData.get('callId') ?? '');
  if (!callId) return;

  const admin = createAdminClient();
  const { data: call } = await admin
    .from('calls')
    .select('id')
    .eq('id', callId)
    .eq('business_id', session.business.id)
    .maybeSingle();
  if (!call) return;

  await processEndedCall(session.business.id, callId);
  revalidatePath(`/calls/${callId}`);
}
