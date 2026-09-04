'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, requireCapability } from '@/lib/session';
import { parseMoneyToCents } from '@/lib/money';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';

/**
 * The list of what a business will take on.
 *
 * Short and editable, because it is marketing copy as much as data: the words
 * here are what a customer reads in the portal before asking for work.
 */
export async function saveServiceAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');
  const id = String(formData.get('id') ?? '').trim() || null;
  const name = String(formData.get('name') ?? '').trim();

  if (name.length < 2) {
    return fail('Give the service a name.', { name: ['A name is needed — "Blocked drains".'] });
  }

  const priceFrom = String(formData.get('priceFrom') ?? '').trim();
  const cents = priceFrom ? parseMoneyToCents(priceFrom) : null;
  if (priceFrom && (cents === null || cents < 0)) {
    return fail('That price did not make sense.', { priceFrom: ['A number, like 180 or 180.00.'] });
  }

  const values = {
    business_id: session.business.id,
    name,
    description: String(formData.get('description') ?? '').trim() || null,
    price_from_cents: cents,
    price_note: String(formData.get('priceNote') ?? '').trim() || null,
    lead_time: String(formData.get('leadTime') ?? '').trim() || null,
    is_active: formData.get('isActive') !== 'off',
    position: Number.parseInt(String(formData.get('position') ?? '0'), 10) || 0,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase
        .from('services')
        .update(values)
        .eq('id', id)
        .eq('business_id', session.business.id)
    : await supabase.from('services').insert(values);

  if (error) return fail(describeError(error));

  await audit(session.business.id, {
    action: id ? 'service.update' : 'service.create',
    entityType: 'service',
    entityId: id,
    detail: { name },
  });

  revalidatePath('/settings/services');
  return ok(id ? `${name} updated.` : `${name} added. Your customers can now ask for it.`);
}

export async function deleteServiceAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.edit');
  const id = String(formData.get('id') ?? '');

  const supabase = await createClient();
  await supabase
    .from('services')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'service.delete',
    entityType: 'service',
    entityId: id,
  });

  revalidatePath('/settings/services');
}

/** Show it to customers, or take it down without losing the wording. */
export async function toggleServiceAction(formData: FormData): Promise<void> {
  const session = await requireCapability('business.edit');
  const id = String(formData.get('id') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';

  const supabase = await createClient();
  await supabase
    .from('services')
    .update({ is_active: active })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/settings/services');
}
