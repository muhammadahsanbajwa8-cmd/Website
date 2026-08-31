'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, notifyRoles, recordActivity, requireCapability } from '@/lib/session';
import { parseItems } from '@/lib/form-items';
import { moneyToCents } from '@/lib/money';
import { addDays, formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { env } from '@/lib/env';
import { fieldErrors, paymentSchema } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';
import {
  loadInvoiceForPdf,
  newShareToken,
  pdfFilename,
  renderInvoicePdf,
} from '@/lib/documents';
import { htmlBody, sendAndRecord } from '@/lib/email/send';

export async function saveInvoiceAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('invoices.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const customerId = String(formData.get('customerId') ?? '').trim();
  if (!customerId) {
    return fail('Choose the customer to bill.', { customerId: ['An invoice needs a customer'] });
  }

  const items = parseItems(formData);
  if (items.length === 0) {
    return fail('An invoice needs at least one line.', { items: ['Add a line to bill'] });
  }

  const issueDate = String(formData.get('issueDate') ?? '') || todayInAustralia();
  const dueDate =
    String(formData.get('dueDate') ?? '') ||
    addDays(issueDate, session.business.default_payment_terms_days);

  if (dueDate < issueDate) {
    return fail('The due date cannot be before the issue date.', {
      dueDate: ['Pick a date on or after the issue date'],
    });
  }

  const supabase = await createClient();
  const header = {
    business_id: session.business.id,
    customer_id: customerId,
    job_id: (String(formData.get('jobId') ?? '') || null) as string | null,
    quote_id: (String(formData.get('quoteId') ?? '') || null) as string | null,
    title: String(formData.get('title') ?? '').trim() || null,
    issue_date: issueDate,
    due_date: dueDate,
    payment_terms: String(formData.get('paymentTerms') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
    bank_details: String(formData.get('bankDetails') ?? '').trim() || null,
    gst_bp: 1000,
    gst_applies: formData.get('gstApplies') === 'on' && session.business.gst_registered,
    discount_cents: moneyToCents(formData.get('discount') as string),
  };

  let invoiceId = id;

  if (id) {
    const { error } = await supabase
      .from('invoices')
      .update(header)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
      target: session.business.id,
      doc_kind: 'invoice',
    });
    if (numberError || !number) return fail(describeError(numberError));

    const { data, error } = await supabase
      .from('invoices')
      .insert({ ...header, number, status: 'draft', created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) return fail(describeError(error));
    invoiceId = data.id;
  }

  if (!invoiceId) return fail('The invoice could not be saved.');

  await supabase
    .from('invoice_items')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('business_id', session.business.id);

  const { error: itemsError } = await supabase.from('invoice_items').insert(
    items.map((item, position) => ({
      business_id: session.business.id,
      invoice_id: invoiceId,
      description: item.description,
      detail: item.detail,
      quantity_milli: item.quantityMilli,
      unit: item.unit,
      unit_price_cents: item.amountCents,
      taxable: item.taxable,
      position,
    }))
  );
  if (itemsError) return fail(describeError(itemsError));

  // The trigger has just rewritten the totals; recompute the paid/status
  // rollup so a re-priced invoice does not stay marked paid at the old figure.
  await supabase.rpc('recalc_invoice_payments', { p_invoice: invoiceId });

  await recordActivity(session, {
    verb: id ? 'updated' : 'created',
    summary: `Invoice ${id ? 'updated' : 'raised'}`,
    entityType: 'invoice',
    entityId: invoiceId,
    invoiceId,
    jobId: header.job_id,
    customerId,
  });
  await audit(session.business.id, {
    action: id ? 'invoice.update' : 'invoice.create',
    entityType: 'invoice',
    entityId: invoiceId,
  });

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function sendInvoiceAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('invoices.send');
  const id = String(formData.get('id') ?? '');
  if (!id) return fail('That invoice was not found.');

  const loaded = await loadInvoiceForPdf(session.business.id, id);
  if (!loaded) return fail('That invoice was not found.');
  const { invoice, business, customer, items, job } = loaded;

  const recipient = String(formData.get('to') ?? '').trim() || customer?.email?.trim() || '';
  if (!recipient) {
    return fail('There is no email address for this customer. Add one, or type one here.', {
      to: ['Enter an email address'],
    });
  }

  const supabase = await createClient();
  const shareToken = invoice.share_token ?? newShareToken();

  await supabase
    .from('invoices')
    .update({
      status: invoice.status === 'draft' ? 'sent' : invoice.status,
      sent_at: invoice.sent_at ?? new Date().toISOString(),
      share_token: shareToken,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  const pdf = await renderInvoicePdf(invoice, business, customer, items, job);
  const shareUrl = `${env.appUrl}/i/${shareToken}`;
  const outstanding = invoice.total_cents - invoice.paid_cents;

  const message = String(formData.get('message') ?? '').trim();
  const paragraphs = [
    `Hello${customer?.name ? ` ${customer.name.split(' ')[0]}` : ''},`,
    message ||
      `Please find attached invoice ${invoice.number} for ${formatMoney(outstanding)}` +
        `${invoice.gst_applies ? ' including GST' : ''}.`,
    invoice.due_date ? `Payment is due by ${formatDate(invoice.due_date)}.` : '',
    business.bank_bsb && business.bank_account_number
      ? `Bank transfer: BSB ${business.bank_bsb}, account ${business.bank_account_number}, ` +
        `reference ${invoice.number}.`
      : '',
  ].filter(Boolean);

  const { result } = await sendAndRecord(
    session,
    {
      to: [recipient],
      subject: `Invoice ${invoice.number} from ${business.name}`,
      text: `${paragraphs.join('\n\n')}\n\n${shareUrl}\n\n${business.name}`,
      html: htmlBody(business.name, paragraphs, { label: 'View the invoice', url: shareUrl }),
      replyTo: business.email ?? undefined,
      attachments: [
        {
          filename: pdfFilename('invoice', invoice.number, business.name),
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    },
    { customerId: invoice.customer_id, jobId: invoice.job_id, invoiceId: invoice.id },
    [{ kind: 'invoice', id: invoice.id, filename: pdfFilename('invoice', invoice.number, business.name) }]
  );

  await recordActivity(session, {
    verb: 'sent',
    summary: `Invoice ${invoice.number} sent to ${recipient}`,
    entityType: 'invoice',
    entityId: id,
    invoiceId: id,
    jobId: invoice.job_id,
    customerId: invoice.customer_id,
  });
  await audit(session.business.id, {
    action: 'invoice.send',
    entityType: 'invoice',
    entityId: id,
    detail: { to: recipient, delivered: result.delivered },
  });

  revalidatePath(`/invoices/${id}`);
  revalidatePath('/invoices');

  if (result.error) {
    return {
      ok: true,
      message: `Marked as sent, but the email did not go out: ${result.error}`,
      data: { shareUrl },
    };
  }
  if (!result.delivered) {
    return ok(
      'Recorded in the outbox. Email delivery is not configured, so send the link yourself.',
      { shareUrl }
    );
  }
  return ok(`Invoice sent to ${recipient}.`, { shareUrl });
}

export async function recordPaymentAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('payments.edit');

  const parsed = paymentSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    amountCents: moneyToCents(formData.get('amount') as string),
    method: formData.get('method') || 'bank_transfer',
    reference: formData.get('reference'),
    paidOn: formData.get('paidOn') || todayInAustralia(),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, number, total_cents, paid_cents, customer_id, job_id')
    .eq('id', parsed.data.invoiceId)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!invoice) return fail('That invoice was not found.');

  const { error } = await supabase.from('payments').insert({
    business_id: session.business.id,
    invoice_id: parsed.data.invoiceId,
    customer_id: invoice.customer_id,
    amount_cents: parsed.data.amountCents,
    method: parsed.data.method,
    reference: parsed.data.reference ?? null,
    paid_on: parsed.data.paidOn,
    notes: parsed.data.notes ?? null,
    created_by: session.userId,
  });
  if (error) return fail(describeError(error));

  // The payments trigger has already rolled the totals and status forward.
  const nowPaid = invoice.paid_cents + parsed.data.amountCents;
  const settled = nowPaid >= invoice.total_cents;

  if (settled && invoice.job_id) {
    await supabase
      .from('jobs')
      .update({ status: 'paid' })
      .eq('id', invoice.job_id)
      .eq('business_id', session.business.id)
      .in('status', ['invoiced', 'completed']);
  }

  await recordActivity(session, {
    verb: 'payment',
    summary: `${formatMoney(parsed.data.amountCents)} received against ${invoice.number}${settled ? ' — paid in full' : ''}`,
    entityType: 'payment',
    entityId: parsed.data.invoiceId,
    invoiceId: parsed.data.invoiceId,
    jobId: invoice.job_id,
    customerId: invoice.customer_id,
  });
  await audit(session.business.id, {
    action: 'payment.create',
    entityType: 'invoice',
    entityId: parsed.data.invoiceId,
    detail: { amountCents: parsed.data.amountCents },
  });

  if (settled) {
    await notifyRoles(session, ['owner', 'admin'], {
      kind: 'invoice_paid',
      title: `${invoice.number} paid in full`,
      body: formatMoney(invoice.total_cents),
      link: `/invoices/${invoice.id}`,
      severity: 'success',
    });
  }

  revalidatePath(`/invoices/${parsed.data.invoiceId}`);
  revalidatePath('/invoices');
  return ok(
    settled
      ? `${formatMoney(parsed.data.amountCents)} recorded. This invoice is now paid in full.`
      : `${formatMoney(parsed.data.amountCents)} recorded. ${formatMoney(invoice.total_cents - nowPaid)} still outstanding.`
  );
}

export async function deletePaymentAction(formData: FormData): Promise<void> {
  const session = await requireCapability('payments.edit');
  const id = String(formData.get('id') ?? '');
  const invoiceId = String(formData.get('invoiceId') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('payments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  // The trigger fires on the update, but the status also depends on the due
  // date, so recompute explicitly rather than assume.
  if (invoiceId) await supabase.rpc('recalc_invoice_payments', { p_invoice: invoiceId });

  await audit(session.business.id, { action: 'payment.delete', entityType: 'payment', entityId: id });
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function changeInvoiceStatusAction(formData: FormData): Promise<void> {
  const session = await requireCapability('invoices.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !status) return;

  const supabase = await createClient();
  await supabase
    .from('invoices')
    .update({ status: status as never })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'invoice.status_change',
    entityType: 'invoice',
    entityId: id,
    detail: { to: status },
  });
  revalidatePath(`/invoices/${id}`);
  revalidatePath('/invoices');
}

export async function deleteInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireCapability('invoices.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/invoices');

  const supabase = await createClient();
  await supabase
    .from('invoices')
    .update({ deleted_at: new Date().toISOString(), share_token: null })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'invoice.delete', entityType: 'invoice', entityId: id });
  revalidatePath('/invoices');
  redirect('/invoices');
}
