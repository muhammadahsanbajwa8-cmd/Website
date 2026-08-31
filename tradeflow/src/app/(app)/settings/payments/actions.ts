'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, requireCapability } from '@/lib/session';
import {
  accountStatus,
  createConnectedAccount,
  dashboardLink,
  onboardingLink,
  stripeConfigured,
} from '@/lib/payments/stripe';
import { fail, ok, type ActionState } from '@/lib/action-state';

/**
 * Connecting the business's own payment account.
 *
 * The account belongs to them, not to this platform: it is created with their
 * name and email against their business id, and Stripe hosts the identity
 * checks. All this application ever stores is the account id and whether it
 * can take money yet.
 */

export async function connectPaymentsAction(
  _previous: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');

  if (!stripeConfigured()) {
    return fail(
      'Online payments are not switched on for this site yet. It needs STRIPE_SECRET_KEY in the ' +
        'environment — until then, invoices still work and payments can be recorded by hand.'
    );
  }

  const supabase = await createClient();
  let accountId = session.business.stripe_account_id;

  try {
    if (!accountId) {
      accountId = await createConnectedAccount({
        businessId: session.business.id,
        businessName: session.business.name,
        email: session.business.email ?? session.email,
      });

      // The account id is written with the service role: `authenticated` can
      // change business settings, but not silently repoint where money lands.
      await createAdminClient()
        .from('businesses')
        .update({ stripe_account_id: accountId })
        .eq('id', session.business.id);

      await audit(session.business.id, {
        action: 'payments.account_created',
        entityType: 'business',
        entityId: session.business.id,
        detail: { account: accountId },
      });
    }

    const url = await onboardingLink(accountId, session.business.id);
    redirect(url);
  } catch (error) {
    // `redirect` throws by design; let it through.
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    const detail = error instanceof Error ? error.message : 'unknown error';
    return fail(`Stripe could not start the setup: ${detail}`);
  }
}

/** Ask Stripe where the account is up to, and store the answer. */
export async function refreshPaymentsAction(
  _previous: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');
  const accountId = session.business.stripe_account_id;
  if (!accountId) return fail('No payment account is connected yet.');

  try {
    const status = await accountStatus(accountId);
    await createAdminClient()
      .from('businesses')
      .update({
        stripe_charges_enabled: status.chargesEnabled,
        stripe_details_submitted: status.detailsSubmitted,
        ...(status.chargesEnabled ? { stripe_connected_at: new Date().toISOString() } : {}),
      })
      .eq('id', session.business.id);

    revalidatePath('/settings/payments');

    if (status.chargesEnabled) return ok('Ready — you can take card payments.');
    if (status.outstanding.length > 0) {
      return ok(`Stripe still needs: ${status.outstanding.slice(0, 4).join(', ')}.`);
    }
    return ok('Stripe is still reviewing the account. This is usually quick.');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return fail(`Could not reach Stripe: ${detail}`);
  }
}

/** Send the owner to Stripe to manage payouts, disputes and their details. */
export async function openStripeDashboardAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.edit');
  const accountId = session.business.stripe_account_id;
  if (!accountId) return;

  const url = await dashboardLink(accountId);
  redirect(url);
}
