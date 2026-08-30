'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, notifyRoles, recordActivity, requireCapability } from '@/lib/session';
import { parseItems } from '@/lib/form-items';
import { computeDocumentTotals } from '@/lib/calc';
import { moneyToCents } from '@/lib/money';
import { addDays, formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { env } from '@/lib/env';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';
import {
  loadQuoteForPdf,
  newShareToken,
  pdfFilename,
  renderQuotePdf,
} from '@/lib/documents';
import { htmlBody, sendAndRecord } from '@/lib/email/send';

export async function saveQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('quotes.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const title = String(formData.get('title') ?? '').trim();
  const customerId = String(formData.get('customerId') ?? '').trim();
  if (!title) return fail('Give the quote a title.', { title: ['A title is required'] });
  if (!customerId) {
    return fail('Choose the customer this quote is for.', {
      customerId: ['A quote has to be addressed to someone'],
    });
  }

  const items = parseItems(formData);
  if (items.length === 0) {
    return fail('A quote needs at least one line.', { items: ['Add a line to price'] });
  }

  const gstApplies = formData.get('gstApplies') === 'on' && session.business.gst_registered;
  const discountCents = moneyToCents(formData.get('discount') as string);
  const issueDate = String(formData.get('issueDate') ?? '') || todayInAustralia();

  const supabase = await createClient();
  const header = {
    business_id: session.business.id,
    customer_id: customerId,
    job_id: (String(formData.get('jobId') ?? '') || null) as string | null,
    estimate_id: (String(formData.get('estimateId') ?? '') || null) as string | null,
    title,
    scope_of_work: String(formData.get('scopeOfWork') ?? '').trim() || null,
    terms: String(formData.get('terms') ?? '').trim() || null,
    payment_terms: String(formData.get('paymentTerms') ?? '').trim() || null,
    issue_date: issueDate,
    expiry_date:
      String(formData.get('expiryDate') ?? '') ||
      addDays(issueDate, session.business.quote_validity_days),
    gst_bp: 1000,
    gst_applies: gstApplies,
    discount_cents: discountCents,
  };

  let quoteId = id;

  if (id) {
    const { error } = await supabase
      .from('quotes')
      .update(header)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
      target: session.business.id,
      doc_kind: 'quote',
    });
    if (numberError || !number) return fail(describeError(numberError));

    const { data, error } = await supabase
      .from('quotes')
      .insert({ ...header, number, status: 'draft', created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) return fail(describeError(error));
    quoteId = data.id;
  }

  if (!quoteId) return fail('The quote could not be saved.');

  await supabase
    .from('quote_items')
    .delete()
    .eq('quote_id', quoteId)
    .eq('business_id', session.business.id);

  const { error: itemsError } = await supabase.from('quote_items').insert(
    items.map((item, position) => ({
      business_id: session.business.id,
      quote_id: quoteId,
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

  // The trigger on quote_items has recomputed the stored totals; this is the
  // same arithmetic, for the activity line, without a second read.
  const totals = computeDocumentTotals({
    lines: items.map((item) => ({
      quantityMilli: item.quantityMilli,
      unitPriceCents: item.amountCents,
      taxable: item.taxable,
    })),
    discountCents,
    gstApplies,
  });

  await recordActivity(session, {
    verb: id ? 'updated' : 'created',
    summary: `Quote ${title} ${id ? 'updated' : 'created'} — ${formatMoney(totals.totalCents)}`,
    entityType: 'quote',
    entityId: quoteId,
    quoteId,
    jobId: header.job_id,
    customerId,
  });
  await audit(session.business.id, {
    action: id ? 'quote.update' : 'quote.create',
    entityType: 'quote',
    entityId: quoteId,
  });

  revalidatePath('/quotes');
  revalidatePath(`/quotes/${quoteId}`);
  redirect(`/quotes/${quoteId}`);
}

/**
 * Send the quote.
 *
 * Three things happen together: an immutable snapshot is written so "what did
 * they actually accept" survives later edits, a share token is minted if the
 * quote does not have one, and the PDF is attached to an email. If the email
 * cannot go out the quote is still marked sent, with the failure recorded on
 * the message — the share link works either way.
 */
export async function sendQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('quotes.send');
  const id = String(formData.get('id') ?? '');
  if (!id) return fail('That quote was not found.');

  const loaded = await loadQuoteForPdf(session.business.id, id);
  if (!loaded) return fail('That quote was not found.');
  const { quote, business, customer, items, job } = loaded;

  const recipient =
    String(formData.get('to') ?? '').trim() || customer?.email?.trim() || '';
  if (!recipient) {
    return fail('There is no email address for this customer. Add one, or type one here.', {
      to: ['Enter an email address'],
    });
  }

  const supabase = await createClient();
  const shareToken = quote.share_token ?? newShareToken();

  const { error: updateError } = await supabase
    .from('quotes')
    .update({
      status: quote.status === 'draft' ? 'sent' : quote.status,
      sent_at: quote.sent_at ?? new Date().toISOString(),
      share_token: shareToken,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);
  if (updateError) return fail(describeError(updateError));

  await supabase.from('quote_versions').insert({
    business_id: session.business.id,
    quote_id: id,
    version: quote.version,
    total_cents: quote.total_cents,
    snapshot: {
      quote: { ...quote, share_token: undefined },
      items,
      customer,
      sent_at: new Date().toISOString(),
    } as never,
    created_by: session.userId,
  });

  const shareUrl = `${env.appUrl}/q/${shareToken}`;
  const pdf = await renderQuotePdf(quote, business, customer, items, job);

  const message = String(formData.get('message') ?? '').trim();
  const paragraphs = [
    `Hello${customer?.name ? ` ${customer.name.split(' ')[0]}` : ''},`,
    message ||
      `Please find attached our quote ${quote.number} for ${quote.title}, ` +
        `totalling ${formatMoney(quote.total_cents)}${quote.gst_applies ? ' including GST' : ''}.`,
    quote.expiry_date
      ? `This quote is valid until ${formatDate(quote.expiry_date)}.`
      : 'Let us know if you have any questions.',
    'You can view it, accept it, or ask for changes using the link below.',
  ];

  const { result } = await sendAndRecord(
    session,
    {
      to: [recipient],
      subject: `Quote ${quote.number} — ${quote.title}`,
      text: `${paragraphs.join('\n\n')}\n\n${shareUrl}\n\n${business.name}`,
      html: htmlBody(business.name, paragraphs, { label: 'View and accept the quote', url: shareUrl }),
      replyTo: business.email ?? undefined,
      attachments: [
        {
          filename: pdfFilename('quote', quote.number, business.name),
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    },
    { customerId: quote.customer_id, jobId: quote.job_id, quoteId: quote.id },
    [{ kind: 'quote', id: quote.id, filename: pdfFilename('quote', quote.number, business.name) }]
  );

  if (quote.job_id) {
    await supabase
      .from('jobs')
      .update({ status: 'quote_sent' })
      .eq('id', quote.job_id)
      .eq('business_id', session.business.id)
      .in('status', ['lead', 'estimating']);
  }

  await recordActivity(session, {
    verb: 'sent',
    summary: `Quote ${quote.number} sent to ${recipient}`,
    entityType: 'quote',
    entityId: id,
    quoteId: id,
    jobId: quote.job_id,
    customerId: quote.customer_id,
  });
  await audit(session.business.id, {
    action: 'quote.send',
    entityType: 'quote',
    entityId: id,
    detail: { to: recipient, delivered: result.delivered, provider: result.provider },
  });

  revalidatePath(`/quotes/${id}`);
  revalidatePath('/quotes');

  if (result.error) {
    return {
      ok: true,
      message:
        `The quote is marked as sent and the share link is live, but the email did not go out: ` +
        `${result.error} Send the link to ${recipient} yourself, or fix the email settings.`,
      data: { shareUrl },
    };
  }
  if (!result.delivered) {
    return ok(
      `Recorded in the outbox. Email delivery is not configured, so nothing was sent — ` +
        `copy the share link to ${recipient} yourself.`,
      { shareUrl }
    );
  }
  return ok(`Quote sent to ${recipient}.`, { shareUrl });
}

/** Mint or re-mint the share link without emailing anything. */
export async function createShareLinkAction(formData: FormData): Promise<void> {
  const session = await requireCapability('quotes.send');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('quotes')
    .update({ share_token: newShareToken() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'quote.share_link', entityType: 'quote', entityId: id });
  revalidatePath(`/quotes/${id}`);
}

export async function changeQuoteStatusAction(formData: FormData): Promise<void> {
  const session = await requireCapability('quotes.edit');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !status) return;

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from('quotes')
    .select('number, job_id, customer_id, status')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();
  if (!quote) return;

  const now = new Date().toISOString();
  await supabase
    .from('quotes')
    .update({
      status: status as never,
      accepted_at: status === 'accepted' ? now : null,
      declined_at: status === 'declined' ? now : null,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (status === 'accepted' && quote.job_id) {
    await supabase
      .from('jobs')
      .update({ status: 'accepted' })
      .eq('id', quote.job_id)
      .eq('business_id', session.business.id)
      .in('status', ['lead', 'estimating', 'quote_sent']);
  }

  await recordActivity(session, {
    verb: status,
    summary: `Quote ${quote.number} marked ${status.replace(/_/g, ' ')}`,
    entityType: 'quote',
    entityId: id,
    quoteId: id,
    jobId: quote.job_id,
    customerId: quote.customer_id,
  });
  await audit(session.business.id, {
    action: 'quote.status_change',
    entityType: 'quote',
    entityId: id,
    detail: { from: quote.status, to: status },
  });

  if (status === 'accepted') {
    await notifyRoles(session, ['owner', 'admin', 'manager'], {
      kind: 'quote_accepted',
      title: `Quote ${quote.number} accepted`,
      link: `/quotes/${id}`,
      severity: 'success',
    });
  }

  revalidatePath(`/quotes/${id}`);
  revalidatePath('/quotes');
}

/**
 * Accepted quote to tax invoice.
 *
 * The lines are copied as they stand, so the invoice matches what the customer
 * agreed to. The due date comes from the business's default terms.
 */
export async function convertQuoteToInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireCapability('invoices.edit');
  const quoteId = String(formData.get('id') ?? '');
  if (!quoteId) redirect('/quotes');

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!quote) redirect('/quotes');

  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('business_id', session.business.id)
    .eq('quote_id', quoteId)
    .is('deleted_at', null)
    .maybeSingle();
  // Already invoiced: go to the invoice rather than raising a second one.
  if (existing) redirect(`/invoices/${existing.id}`);

  const { data: items } = await supabase
    .from('quote_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('business_id', session.business.id)
    .order('position');

  const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
    target: session.business.id,
    doc_kind: 'invoice',
  });
  if (numberError || !number) redirect(`/quotes/${quoteId}?error=numbering`);

  const today = todayInAustralia();
  const bankDetails = [
    session.business.bank_account_name ? `Account name: ${session.business.bank_account_name}` : null,
    session.business.bank_bsb ? `BSB: ${session.business.bank_bsb}` : null,
    session.business.bank_account_number
      ? `Account: ${session.business.bank_account_number}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      business_id: session.business.id,
      quote_id: quoteId,
      job_id: quote.job_id,
      customer_id: quote.customer_id,
      number,
      title: quote.title,
      status: 'draft',
      issue_date: today,
      due_date: addDays(today, session.business.default_payment_terms_days),
      payment_terms:
        quote.payment_terms ??
        `Payment due within ${session.business.default_payment_terms_days} days.`,
      bank_details: bankDetails || null,
      gst_bp: quote.gst_bp,
      gst_applies: quote.gst_applies,
      discount_cents: quote.discount_cents,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (error || !invoice) redirect(`/quotes/${quoteId}?error=convert`);

  if (items?.length) {
    await supabase.from('invoice_items').insert(
      items.map((item, position) => ({
        business_id: session.business.id,
        invoice_id: invoice.id,
        description: item.description,
        detail: item.detail,
        quantity_milli: item.quantity_milli,
        unit: item.unit,
        unit_price_cents: item.unit_price_cents,
        taxable: item.taxable,
        position,
      }))
    );
  }

  if (quote.job_id) {
    await supabase
      .from('jobs')
      .update({ status: 'invoiced' })
      .eq('id', quote.job_id)
      .eq('business_id', session.business.id)
      .in('status', ['accepted', 'scheduled', 'in_progress', 'completed']);
  }

  await recordActivity(session, {
    verb: 'invoiced',
    summary: `Invoice ${number} raised from quote ${quote.number}`,
    entityType: 'invoice',
    entityId: invoice.id,
    quoteId,
    invoiceId: invoice.id,
    jobId: quote.job_id,
    customerId: quote.customer_id,
  });
  await audit(session.business.id, {
    action: 'quote.convert_to_invoice',
    entityType: 'quote',
    entityId: quoteId,
    detail: { invoiceId: invoice.id },
  });

  revalidatePath('/invoices');
  redirect(`/invoices/${invoice.id}`);
}

export async function deleteQuoteAction(formData: FormData): Promise<void> {
  const session = await requireCapability('quotes.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/quotes');

  const supabase = await createClient();
  await supabase
    .from('quotes')
    .update({ deleted_at: new Date().toISOString(), share_token: null })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'quote.delete', entityType: 'quote', entityId: id });
  revalidatePath('/quotes');
  redirect('/quotes');
}
