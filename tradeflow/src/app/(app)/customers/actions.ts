'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { contactSchema, customerSchema, fieldErrors } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';

function readCustomerForm(formData: FormData) {
  return {
    name: formData.get('name'),
    company: formData.get('company'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    abn: formData.get('abn'),
    contactPerson: formData.get('contactPerson'),
    addressLine1: formData.get('addressLine1'),
    addressLine2: formData.get('addressLine2'),
    suburb: formData.get('suburb'),
    state: formData.get('state'),
    postcode: formData.get('postcode'),
    notes: formData.get('notes'),
  };
}

export async function saveCustomerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('customers.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = customerSchema.safeParse(readCustomerForm(formData));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    name: parsed.data.name,
    company: parsed.data.company ?? null,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    abn: parsed.data.abn ?? null,
    contact_person: parsed.data.contactPerson ?? null,
    address_line1: parsed.data.addressLine1 ?? null,
    address_line2: parsed.data.addressLine2 ?? null,
    suburb: parsed.data.suburb ?? null,
    state: parsed.data.state ?? null,
    postcode: parsed.data.postcode ?? null,
    notes: parsed.data.notes ?? null,
  };

  if (id) {
    // `business_id` is in the filter as well as enforced by RLS: the policy is
    // the boundary, this is so a mistake here fails loudly rather than widely.
    const { error } = await supabase
      .from('customers')
      .update(values)
      .eq('id', id)
      .eq('business_id', session.business.id);

    if (error) return fail(describeError(error));

    await recordActivity(session, {
      verb: 'updated',
      summary: `Customer ${parsed.data.name} updated`,
      entityType: 'customer',
      entityId: id,
      customerId: id,
    });
    await audit(session.business.id, { action: 'customer.update', entityType: 'customer', entityId: id });
  } else {
    const { data, error } = await supabase
      .from('customers')
      .insert({ ...values, created_by: session.userId })
      .select('id')
      .single();

    if (error || !data) return fail(describeError(error));

    await recordActivity(session, {
      verb: 'created',
      summary: `Customer ${parsed.data.name} added`,
      entityType: 'customer',
      entityId: data.id,
      customerId: data.id,
    });
    await audit(session.business.id, {
      action: 'customer.create',
      entityType: 'customer',
      entityId: data.id,
    });

    revalidatePath('/customers');
    redirect(`/customers/${data.id}`);
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}

/**
 * Soft delete. The row stays so quotes, invoices and jobs that reference the
 * customer keep their history; it simply stops appearing in lists and pickers.
 */
export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const session = await requireCapability('customers.delete');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/customers');

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from('customers')
    .select('name')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (customer) {
    await recordActivity(session, {
      verb: 'deleted',
      summary: `Customer ${customer.name} removed`,
      entityType: 'customer',
      entityId: id,
    });
  }
  await audit(session.business.id, { action: 'customer.delete', entityType: 'customer', entityId: id });

  revalidatePath('/customers');
  redirect('/customers');
}

export async function saveContactAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('customers.edit');

  const parsed = contactSchema.safeParse({
    customerId: formData.get('customerId'),
    name: formData.get('name'),
    role: formData.get('role'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    isPrimary: formData.get('isPrimary') === 'on',
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.from('contacts').insert({
    business_id: session.business.id,
    customer_id: parsed.data.customerId,
    name: parsed.data.name,
    role: parsed.data.role ?? null,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    is_primary: parsed.data.isPrimary,
  });

  if (error) return fail(describeError(error));

  revalidatePath(`/customers/${parsed.data.customerId}`);
  return ok(`${parsed.data.name} added as a contact.`);
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const session = await requireCapability('customers.edit');
  const id = String(formData.get('id') ?? '');
  const customerId = String(formData.get('customerId') ?? '');

  const supabase = await createClient();
  await supabase
    .from('contacts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath(`/customers/${customerId}`);
}
