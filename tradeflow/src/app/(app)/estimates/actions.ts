'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { parseItems, readPercent } from '@/lib/form-items';
import { computeEstimateTotals } from '@/lib/calc';
import { describeError, fail, type ActionState } from '@/lib/action-state';
import { addDays, todayInAustralia } from '@/lib/format';

export async function saveEstimateAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('estimates.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return fail('Give the estimate a title.', { title: ['A title is required'] });

  const items = parseItems(formData);
  if (items.length === 0) {
    return fail('An estimate needs at least one cost line.', {
      items: ['Add a line for the labour, materials or plant'],
    });
  }

  const markupBp = readPercent(formData, 'markupPercent', session.business.default_markup_bp);
  const contingencyBp = readPercent(formData, 'contingencyPercent', 0);
  const gstApplies = formData.get('gstApplies') === 'on' && session.business.gst_registered;

  const supabase = await createClient();
  const header = {
    business_id: session.business.id,
    customer_id: (String(formData.get('customerId') ?? '') || null) as string | null,
    job_id: (String(formData.get('jobId') ?? '') || null) as string | null,
    title,
    notes: String(formData.get('notes') ?? '').trim() || null,
    status: (String(formData.get('status') ?? 'draft') || 'draft') as
      | 'draft' | 'ready' | 'converted' | 'archived',
    markup_bp: markupBp,
    contingency_bp: contingencyBp,
    gst_bp: 1000,
    gst_applies: gstApplies,
  };

  let estimateId = id;

  if (id) {
    const { error } = await supabase
      .from('estimates')
      .update(header)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
      target: session.business.id,
      doc_kind: 'estimate',
    });
    if (numberError || !number) return fail(describeError(numberError));

    const { data, error } = await supabase
      .from('estimates')
      .insert({ ...header, number, created_by: session.userId })
      .select('id, number')
      .single();
    if (error || !data) return fail(describeError(error));
    estimateId = data.id;
  }

  if (!estimateId) return fail('The estimate could not be saved.');

  // Line items are replaced wholesale. The form always posts the complete set,
  // and reconciling by id would leave a deleted row behind if the delete and
  // the insert disagreed.
  await supabase
    .from('estimate_items')
    .delete()
    .eq('estimate_id', estimateId)
    .eq('business_id', session.business.id);

  const { error: itemsError } = await supabase.from('estimate_items').insert(
    items.map((item, position) => ({
      business_id: session.business.id,
      estimate_id: estimateId,
      kind: item.kind,
      description: item.description,
      quantity_milli: item.quantityMilli,
      unit: item.unit,
      unit_cost_cents: item.amountCents,
      taxable: item.taxable,
      position,
    }))
  );
  if (itemsError) return fail(describeError(itemsError));

  const totals = computeEstimateTotals({
    items: items.map((item) => ({
      kind: item.kind,
      quantityMilli: item.quantityMilli,
      unitCostCents: item.amountCents,
      taxable: item.taxable,
    })),
    markupBasisPoints: markupBp,
    contingencyBasisPoints: contingencyBp,
    gstApplies,
  });

  await recordActivity(session, {
    verb: id ? 'updated' : 'created',
    summary: `Estimate ${title} ${id ? 'updated' : 'created'} — ${(totals.subtotalCents / 100).toFixed(2)} ex GST`,
    entityType: 'estimate',
    entityId: estimateId,
    jobId: header.job_id,
    customerId: header.customer_id,
  });
  await audit(session.business.id, {
    action: id ? 'estimate.update' : 'estimate.create',
    entityType: 'estimate',
    entityId: estimateId,
  });

  revalidatePath('/estimates');
  revalidatePath(`/estimates/${estimateId}`);
  redirect(`/estimates/${estimateId}`);
}

/**
 * Estimate to quote.
 *
 * The cost lines become priced lines: each line's sell price is its cost with
 * the markup and contingency applied, so the quote adds up to the estimate's
 * subtotal, and the customer sees prices rather than the business's costs.
 */
export async function convertEstimateToQuoteAction(formData: FormData): Promise<void> {
  const session = await requireCapability('quotes.edit');
  const estimateId = String(formData.get('id') ?? '');
  if (!estimateId) redirect('/estimates');

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', estimateId)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!estimate) redirect('/estimates');
  if (!estimate.customer_id) redirect(`/estimates/${estimateId}?error=no-customer`);

  const { data: items } = await supabase
    .from('estimate_items')
    .select('*')
    .eq('estimate_id', estimateId)
    .eq('business_id', session.business.id)
    .order('position');

  const lines = items ?? [];
  const uplift = 1 + (estimate.markup_bp + estimate.contingency_bp) / 10_000;

  const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
    target: session.business.id,
    doc_kind: 'quote',
  });
  if (numberError || !number) redirect(`/estimates/${estimateId}?error=numbering`);

  const today = todayInAustralia();
  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      business_id: session.business.id,
      estimate_id: estimateId,
      job_id: estimate.job_id,
      customer_id: estimate.customer_id,
      number,
      title: estimate.title,
      status: 'draft',
      issue_date: today,
      expiry_date: addDays(today, session.business.quote_validity_days),
      gst_bp: estimate.gst_bp,
      gst_applies: estimate.gst_applies,
      payment_terms: `Payment within ${session.business.default_payment_terms_days} days of invoice.`,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (error || !quote) redirect(`/estimates/${estimateId}?error=convert`);

  if (lines.length > 0) {
    await supabase.from('quote_items').insert(
      lines.map((line, position) => ({
        business_id: session.business.id,
        quote_id: quote.id,
        description: line.description,
        quantity_milli: line.quantity_milli,
        unit: line.unit,
        // Round at the unit price so the line total the customer sees is a
        // clean multiple of a real rate, not a rounded lump.
        unit_price_cents: Math.round(line.unit_cost_cents * uplift),
        taxable: line.taxable,
        position,
      }))
    );
  }

  await supabase
    .from('estimates')
    .update({ status: 'converted' })
    .eq('id', estimateId)
    .eq('business_id', session.business.id);

  if (estimate.job_id) {
    await supabase
      .from('jobs')
      .update({ status: 'estimating' })
      .eq('id', estimate.job_id)
      .eq('business_id', session.business.id)
      .eq('status', 'lead');
  }

  await recordActivity(session, {
    verb: 'converted',
    summary: `Estimate ${estimate.number} turned into quote ${number}`,
    entityType: 'quote',
    entityId: quote.id,
    jobId: estimate.job_id,
    customerId: estimate.customer_id,
    quoteId: quote.id,
  });
  await audit(session.business.id, {
    action: 'estimate.convert',
    entityType: 'estimate',
    entityId: estimateId,
    detail: { quoteId: quote.id },
  });

  revalidatePath('/quotes');
  redirect(`/quotes/${quote.id}/edit`);
}

export async function deleteEstimateAction(formData: FormData): Promise<void> {
  const session = await requireCapability('estimates.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/estimates');

  const supabase = await createClient();
  await supabase
    .from('estimates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'estimate.delete', entityType: 'estimate', entityId: id });
  revalidatePath('/estimates');
  redirect('/estimates');
}
