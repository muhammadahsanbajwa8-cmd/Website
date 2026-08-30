'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_BUSINESS_COOKIE, audit, requireSession } from '@/lib/session';
import { fieldErrors, onboardingSchema } from '@/lib/validation';
import { describeError, fail, invalid, type ActionState } from '@/lib/action-state';

/**
 * Business creation.
 *
 * The insert goes through `create_business_with_owner()` rather than a plain
 * insert: at this moment the user is a member of nothing, so an ordinary
 * insert would be refused by row level security — and a business created
 * without an owner membership in the same transaction would be orphaned.
 */
export async function createBusinessAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = onboardingSchema.safeParse({
    name: formData.get('name'),
    businessType: formData.get('businessType'),
    abn: formData.get('abn'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    addressLine1: formData.get('addressLine1'),
    suburb: formData.get('suburb'),
    state: formData.get('state'),
    postcode: formData.get('postcode'),
    gstRegistered: formData.get('gstRegistered') === 'on',
    paymentTermsDays: formData.get('paymentTermsDays') || 14,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc('create_business_with_owner', {
    p_name: parsed.data.name,
    p_business_type: parsed.data.businessType ?? null,
    p_abn: parsed.data.abn ?? null,
    p_email: parsed.data.email ?? session.email,
    p_phone: parsed.data.phone ?? null,
    p_address_line1: parsed.data.addressLine1 ?? null,
    p_suburb: parsed.data.suburb ?? null,
    p_state: parsed.data.state ?? null,
    p_postcode: parsed.data.postcode ?? null,
    p_gst_registered: parsed.data.gstRegistered,
    p_payment_terms_days: parsed.data.paymentTermsDays,
  });

  if (error || !businessId) {
    await audit(null, {
      action: 'business.create',
      outcome: 'error',
      detail: { reason: error?.message ?? 'no id returned' },
    });
    return fail(describeError(error));
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  await audit(businessId, {
    action: 'business.create',
    entityType: 'business',
    entityId: businessId,
    detail: { name: parsed.data.name },
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard?welcome=1');
}

/**
 * Switch which business the interface is showing.
 * The membership is re-checked here even though `getBusinessSession` also
 * falls back safely: a request to switch to a business you are not in is an
 * event worth recording, not a silent no-op.
 */
export async function switchBusinessAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const businessId = String(formData.get('businessId') ?? '');

  const membership = session.memberships.find((m) => m.businessId === businessId);
  if (!membership) {
    await audit(businessId || null, {
      action: 'business.switch',
      outcome: 'denied',
      entityType: 'business',
      entityId: businessId || null,
    });
    redirect('/dashboard');
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
