'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, requireCapability } from '@/lib/session';
import { businessSettingsSchema, fieldErrors, profileSchema } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';
import { UploadError, removeFile, uploadFile } from '@/lib/storage';

export async function saveBusinessSettingsAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');

  const parsed = businessSettingsSchema.safeParse({
    name: formData.get('name'),
    businessType: formData.get('businessType'),
    abn: formData.get('abn'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    addressLine1: formData.get('addressLine1'),
    addressLine2: formData.get('addressLine2'),
    suburb: formData.get('suburb'),
    state: formData.get('state'),
    postcode: formData.get('postcode'),
    gstRegistered: formData.get('gstRegistered') === 'on',
    defaultPaymentTermsDays: formData.get('defaultPaymentTermsDays') || 14,
    quoteValidityDays: formData.get('quoteValidityDays') || 30,
    defaultMarkupBp: Math.round((Number(formData.get('defaultMarkupPercent') ?? 15) || 0) * 100),
    bankAccountName: formData.get('bankAccountName'),
    bankBsb: formData.get('bankBsb'),
    bankAccountNumber: formData.get('bankAccountNumber'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();

  // The logo is optional and its failure must not lose the settings.
  let logoPath: string | null = null;
  let logoProblem: string | null = null;
  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try {
      const stored = await uploadFile('logos', session.business.id, 'logo', logo);
      logoPath = stored.path;
    } catch (error) {
      logoProblem = error instanceof UploadError ? error.message : 'The logo could not be uploaded.';
    }
  }

  const { error } = await supabase
    .from('businesses')
    .update({
      name: parsed.data.name,
      business_type: parsed.data.businessType ?? null,
      abn: parsed.data.abn ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address_line1: parsed.data.addressLine1 ?? null,
      address_line2: parsed.data.addressLine2 ?? null,
      suburb: parsed.data.suburb ?? null,
      state: parsed.data.state ?? null,
      postcode: parsed.data.postcode ?? null,
      gst_registered: parsed.data.gstRegistered,
      default_payment_terms_days: parsed.data.defaultPaymentTermsDays,
      quote_validity_days: parsed.data.quoteValidityDays,
      default_markup_bp: parsed.data.defaultMarkupBp,
      bank_account_name: parsed.data.bankAccountName ?? null,
      bank_bsb: parsed.data.bankBsb ?? null,
      bank_account_number: parsed.data.bankAccountNumber ?? null,
      ...(logoPath ? { logo_path: logoPath } : {}),
    })
    .eq('id', session.business.id);

  if (error) {
    if (logoPath) await removeFile('logos', logoPath);
    return fail(describeError(error));
  }

  // The old logo is removed only once the new one is safely on the row.
  if (logoPath && session.business.logo_path) {
    await removeFile('logos', session.business.logo_path);
  }

  await audit(session.business.id, {
    action: 'business.update',
    entityType: 'business',
    entityId: session.business.id,
  });

  revalidatePath('/settings');
  revalidatePath('/', 'layout');

  if (logoProblem) {
    return { ok: true, message: `Settings saved, but the logo did not upload: ${logoProblem}` };
  }
  return ok('Settings saved. Quotes and invoices use these from now on.');
}

export async function saveProfileAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.view');

  const parsed = profileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone ?? null })
    .eq('id', session.userId);

  if (error) return fail(describeError(error));

  revalidatePath('/settings/profile');
  revalidatePath('/', 'layout');
  return ok('Your details have been updated.');
}
