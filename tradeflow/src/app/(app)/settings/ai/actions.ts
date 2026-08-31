'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, requireCapability } from '@/lib/session';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';
import type { AiVoiceTone, Json } from '@/lib/database.types';

/**
 * Editing the AI Business Brain.
 *
 * Two of these fields matter more than the rest: `allowed_topics` and
 * `forbidden_topics`. They are the business saying, in its own words, what its
 * assistant may and may not talk about — and they are enforced in the system
 * prompt on every single call, not as a filter after the fact.
 */

const lines = (value: FormDataEntryValue | null): string[] =>
  String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export async function saveBrainAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.view');
  if (!session.can('team.manage') && session.role !== 'manager') {
    return fail('Only an owner, admin or manager can change the assistant.');
  }

  const supabase = await createClient();
  await supabase.rpc('ensure_ai_brain', { target: session.business.id });

  const hours: Record<string, string> = {};
  for (const day of DAYS) {
    const value = String(formData.get(`hours.${day}`) ?? '').trim();
    if (value) hours[day] = value;
  }

  // Staff are entered one per line as "Name — role — note".
  const staff = lines(formData.get('staff')).map((line) => {
    const [name, role, note] = line.split(/\s*[—-]\s*/);
    return { name: name ?? line, role: role ?? null, note: note ?? null };
  });

  const values = {
    industry_key: String(formData.get('industryKey') ?? '').trim() || null,
    tone: String(formData.get('tone') ?? 'friendly') as AiVoiceTone,
    voice_name: String(formData.get('voiceName') ?? 'Polly.Nicole').trim() || 'Polly.Nicole',
    speaking_rate: Math.min(Math.max(Number(formData.get('speakingRate') ?? 1) || 1, 0.5), 2),
    language: String(formData.get('language') ?? 'en-AU').trim() || 'en-AU',
    greeting: String(formData.get('greeting') ?? '').trim() || null,
    after_hours_greeting: String(formData.get('afterHoursGreeting') ?? '').trim() || null,
    voicemail_greeting: String(formData.get('voicemailGreeting') ?? '').trim() || null,
    services: lines(formData.get('services')),
    service_area: String(formData.get('serviceArea') ?? '').trim() || null,
    business_hours: hours as unknown as Json,
    emergency_hours: String(formData.get('emergencyHours') ?? '').trim() || null,
    staff: staff as unknown as Json,
    escalation_name: String(formData.get('escalationName') ?? '').trim() || null,
    escalation_phone: String(formData.get('escalationPhone') ?? '').trim() || null,
    escalation_email: String(formData.get('escalationEmail') ?? '').trim() || null,
    allowed_topics: lines(formData.get('allowedTopics')),
    forbidden_topics: lines(formData.get('forbiddenTopics')),
    policies: String(formData.get('policies') ?? '').trim() || null,
    pricing_guidance: String(formData.get('pricingGuidance') ?? '').trim() || null,
    // Disclosure is a checkbox, but the greeting composer appends it whatever
    // this says when the law of the business's state requires it. Turning it
    // off only removes the standing line, never a truthful answer to "are you
    // a real person?" — that rule lives in the system prompt.
    disclose_ai: formData.get('discloseAi') !== null,
    may_discuss_pricing: formData.get('mayDiscussPricing') !== null,
    may_confirm_bookings: formData.get('mayConfirmBookings') !== null,
    may_share_job_status: formData.get('mayShareJobStatus') !== null,
    max_call_minutes: Math.min(Math.max(Number(formData.get('maxCallMinutes') ?? 10) || 10, 1), 60),
    enabled: formData.get('enabled') !== null,
    phone_number: String(formData.get('phoneNumber') ?? '').trim() || null,
  };

  const { error } = await supabase
    .from('ai_brain')
    .update(values)
    .eq('business_id', session.business.id);

  if (error) return fail(describeError(error));

  await audit(session.business.id, {
    action: 'ai_brain.update',
    entityType: 'ai_brain',
    entityId: session.business.id,
    detail: { enabled: values.enabled },
  });

  revalidatePath('/settings/ai');
  revalidatePath('/calls');
  return ok('The assistant has been updated. It uses this from the next call.');
}

export async function saveFaqAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.view');
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();

  if (!question) return fail('Enter the question.', { question: ['A question is needed'] });
  if (!answer) return fail('Enter the answer.', { answer: ['An answer is needed'] });

  const supabase = await createClient();
  const { error } = await supabase.from('ai_faqs').insert({
    business_id: session.business.id,
    question,
    answer,
    category: String(formData.get('category') ?? '').trim() || null,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/settings/ai');
  return ok('Added. The assistant will use your wording when that comes up.');
}

export async function deleteFaqAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.view');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('ai_faqs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/settings/ai');
}

export async function saveKnowledgeAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.view');
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!title) return fail('Give it a title.', { title: ['A title is needed'] });
  if (!body) return fail('Write what the assistant should know.', { body: ['Some detail is needed'] });

  const supabase = await createClient();
  const { error } = await supabase.from('ai_knowledge').insert({
    business_id: session.business.id,
    title,
    body,
    category: String(formData.get('category') ?? 'general').trim() || 'general',
    approved: formData.get('approved') !== null,
    created_by: session.userId,
  });

  if (error) return fail(describeError(error));

  revalidatePath('/settings/ai');
  return ok('Added to what the assistant knows.');
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.view');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('ai_knowledge')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/settings/ai');
}
