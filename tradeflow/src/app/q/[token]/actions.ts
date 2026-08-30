'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { quoteResponseSchema, fieldErrors } from '@/lib/validation';
import { fail, invalid, ok, type ActionState } from '@/lib/action-state';

/**
 * The customer's answer.
 *
 * All the work happens in `public_quote_respond()`: it re-reads the token,
 * refuses an expired or cancelled quote, moves the job, writes the activity
 * line and notifies the business. Doing it in one definer function means the
 * anonymous caller never needs write access to any table.
 */
export async function respondToQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  if (!token) return fail('That link is not valid.');

  const parsed = quoteResponseSchema.safeParse({
    action: formData.get('action'),
    name: formData.get('name') || undefined,
    message: formData.get('message') || undefined,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  if (parsed.data.action === 'accept' && !parsed.data.name?.trim()) {
    return invalid({ name: ['Type your name to accept the quote'] }, 'Your name is needed to accept.');
  }
  if (parsed.data.action === 'decline' && !parsed.data.message?.trim()) {
    return invalid(
      { message: ['A short reason helps them price the next one better'] },
      'Add a brief reason.'
    );
  }
  if (parsed.data.action === 'request_changes' && !parsed.data.message?.trim()) {
    return invalid({ message: ['Say what you would like changed'] }, 'Tell them what to change.');
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc('public_quote_respond', {
    p_token: token,
    p_action: parsed.data.action,
    p_name: parsed.data.name ?? null,
    p_message: parsed.data.message ?? null,
  });

  if (error) {
    // The function raises with a readable sentence for the cases a customer
    // can actually hit (expired, cancelled, already answered).
    return fail(error.message || 'That could not be recorded. Refresh and try again.');
  }

  // A best-effort record of who answered; the header is not trustworthy, so it
  // is written to the audit log rather than used for any decision.
  try {
    const headerList = await headers();
    const forwarded = headerList.get('x-forwarded-for');
    await admin.from('audit_logs').insert({
      action: `quote.customer_${parsed.data.action}`,
      entity_type: 'quote',
      outcome: 'allowed',
      actor_email: parsed.data.name ?? null,
      ip_address: forwarded ? forwarded.split(',')[0]!.trim() : null,
      user_agent: headerList.get('user-agent'),
    });
  } catch {
    // Never let the log stop the customer's answer being recorded.
  }

  revalidatePath(`/q/${token}`);

  switch (parsed.data.action) {
    case 'accept':
      return ok('Accepted. They have been notified and will be in touch.');
    case 'decline':
      return ok('Recorded — thanks for letting them know.');
    case 'request_changes':
      return ok('Sent. They will come back to you with a revised quote.');
    default:
      return ok('Message sent.');
  }
}
