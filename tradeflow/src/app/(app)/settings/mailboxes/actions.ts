'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, requireCapability } from '@/lib/session';
import { syncAccount } from '@/lib/email/sync';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';
import type { EmailAccount } from '@/lib/database.types';

/**
 * Managing connected mailboxes.
 *
 * Both actions read the account through the user's own client first, so row
 * level security decides whether this business may touch it. Only then is the
 * row handed to the sync, which needs the service role to reach the encrypted
 * tokens. The id in the form is never trusted on its own.
 */

export async function syncMailboxAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('emails.view');
  const id = String(formData.get('id') ?? '');
  if (!id) return fail('Which mailbox?');

  const supabase = await createClient();
  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!account) return fail('That mailbox is not connected to this business.');

  const result = await syncAccount(account as EmailAccount);

  revalidatePath('/settings/mailboxes');
  revalidatePath('/emails');

  if (result.error) return fail(result.error);

  if (result.stored === 0) {
    return ok(
      result.fetched === 0
        ? 'Nothing new since the last sync.'
        : `Checked ${result.fetched} messages — all of them were already here.`
    );
  }

  return ok(
    `Brought in ${result.stored} message${result.stored === 1 ? '' : 's'}` +
      (result.matched > 0
        ? `, ${result.matched} of which matched a customer and went onto their job.`
        : '. None matched a customer, so they are filed under Emails only.')
  );
}

export async function disconnectMailboxAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();

  // Disconnect through the user's own client, so the policy decides. The mail
  // already brought in stays — it is part of the job's history now, and losing
  // it because a mailbox was disconnected would be its own kind of data loss.
  const { data: closed, error } = await supabase
    .from('email_accounts')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(describeError(error));
  if (!closed) return;

  // Only then are the tokens destroyed. `authenticated` has UPDATE revoked on
  // those two columns — nobody can write them through PostgREST — so this last
  // step needs the service role, and runs only after the policy above allowed
  // the disconnect.
  await createAdminClient()
    .from('email_accounts')
    .update({ refresh_token_enc: null, access_token_enc: null, token_expires_at: null })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'mailbox.disconnect',
    entityType: 'email_account',
    entityId: id,
  });

  revalidatePath('/settings/mailboxes');
  revalidatePath('/emails');
}
