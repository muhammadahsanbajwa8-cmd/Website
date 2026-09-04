'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { htmlBody, sendAndRecord } from '@/lib/email/send';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { contactSchema, customerSchema, fieldErrors } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

// --- letting a customer in --------------------------------------------------

/**
 * Give a customer a login.
 *
 * The link is `customer_users`: one row joining an email address to this
 * customer at this business. Until they accept it holds only the address and
 * a token; accepting attaches their user id, and from then on the portal shows
 * them their own jobs, reports and invoices — and nothing else, here or at any
 * other business.
 */
export async function inviteCustomerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('customers.edit');
  const customerId = String(formData.get('customerId') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!customerId) return fail('That customer was not found.');
  if (!EMAIL_PATTERN.test(email)) {
    return fail('That email address does not look right.', {
      email: ['Check for a typo — it needs an @ and a domain.'],
    });
  }

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', customerId)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!customer) return fail('That customer was not found, or is not yours.');

  // An invitation already out to this address is refreshed rather than
  // duplicated: a second row would leave two live tokens for one person.
  const { data: existing } = await supabase
    .from('customer_users')
    .select('id, accepted_at')
    .eq('business_id', session.business.id)
    .eq('customer_id', customerId)
    .eq('email', email)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing?.accepted_at) {
    return fail(`${email} already has access to this customer's account.`);
  }

  const token = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();

  const { error } = existing
    ? await supabase
        .from('customer_users')
        .update({ invite_token: token, invited_at: now })
        .eq('id', existing.id)
        .eq('business_id', session.business.id)
    : await supabase.from('customer_users').insert({
        business_id: session.business.id,
        customer_id: customerId,
        email,
        invite_token: token,
        invited_at: now,
      });

  if (error) return fail(describeError(error));

  const inviteUrl = `${env.appUrl}/customer-invite/${token}`;
  const paragraphs = [
    `${session.business.name} has set up an account for you.`,
    'Sign in and you can see your bookings, the reports written up after each visit, your invoices, and pay any that are due — all in one place.',
    'The link below works only for this email address.',
  ];

  const { result } = await sendAndRecord(
    session,
    {
      to: [email],
      subject: `Your account with ${session.business.name}`,
      text: `${paragraphs.join('\n\n')}\n\n${inviteUrl}`,
      html: htmlBody(session.business.name, paragraphs, {
        label: 'Open your account',
        url: inviteUrl,
      }),
      replyTo: session.business.email ?? undefined,
    },
    { customerId }
  );

  await recordActivity(session, {
    verb: 'invited',
    summary: `${email} invited to ${customer.name}'s customer account`,
    entityType: 'customer',
    entityId: customerId,
    customerId,
  });
  await audit(session.business.id, {
    action: 'customer.invite',
    entityType: 'customer',
    entityId: customerId,
    detail: { email, delivered: result.delivered, error: result.error },
  });

  revalidatePath(`/customers/${customerId}`);

  if (result.error) {
    return ok(
      `The invitation is ready, but the email did not go: ${result.error} Send them this link instead: ${inviteUrl}`,
      { inviteUrl }
    );
  }
  if (!result.delivered) {
    return ok(
      `Invitation created. Email delivery is not configured, so send them this link yourself: ${inviteUrl}`,
      { inviteUrl }
    );
  }
  return ok(`Invitation sent to ${email}.`, { inviteUrl });
}

/** Take a customer's access away. Their records are untouched. */
export async function revokeCustomerAccessAction(formData: FormData): Promise<void> {
  const session = await requireCapability('customers.edit');
  const id = String(formData.get('id') ?? '');
  const customerId = String(formData.get('customerId') ?? '');

  const supabase = await createClient();
  await supabase
    .from('customer_users')
    .update({ deleted_at: new Date().toISOString(), invite_token: null })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'customer.access_revoked',
    entityType: 'customer',
    entityId: customerId,
    detail: { linkId: id },
  });

  revalidatePath(`/customers/${customerId}`);
}
