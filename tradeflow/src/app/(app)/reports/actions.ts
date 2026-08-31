'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { missingRequired, parseSections, readAnswers, summarise } from '@/lib/reports';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';
import { todayInAustralia } from '@/lib/format';
import { env } from '@/lib/env';
import { htmlBody, sendAndRecord } from '@/lib/email/send';
import { loadReportForPdf, renderReportPdf, reportFilename } from '@/lib/report-pdf';
import type { Json } from '@/lib/database.types';

export async function saveReportAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('reports.edit');
  const id = String(formData.get('id') ?? '').trim() || null;
  const templateKey = String(formData.get('templateKey') ?? '').trim();

  if (!templateKey) return fail('Choose a report template.');

  const supabase = await createClient();

  // The template decides which answers are accepted; anything not declared in
  // it is discarded, so a hand-built POST cannot write arbitrary JSON.
  const { data: template } = await supabase
    .from('report_templates')
    .select('id, key, name, sections')
    .eq('key', templateKey)
    .or(`business_id.is.null,business_id.eq.${session.business.id}`)
    .limit(1)
    .maybeSingle();

  if (!template) return fail('That report template was not found.');

  const sections = parseSections(template.sections);
  const answers = readAnswers(sections, formData);
  const status = (String(formData.get('status') ?? 'draft') || 'draft') as 'draft' | 'final' | 'sent';

  // Required fields are enforced on the finished article, not on a draft that
  // someone is halfway through in a ute.
  if (status !== 'draft') {
    const missing = missingRequired(sections, answers);
    if (missing.length > 0) {
      return fail(
        `Fill in ${missing.map((field) => field.label).join(', ')} before marking this report final.`,
        Object.fromEntries(missing.map((field) => [`field.${field.id}`, ['Required']]))
      );
    }
  }

  const title =
    String(formData.get('title') ?? '').trim() ||
    `${template.name} — ${todayInAustralia()}`;
  const signatureName = String(formData.get('signatureName') ?? '').trim() || null;

  const header = {
    business_id: session.business.id,
    template_id: template.id,
    template_key: template.key,
    job_id: (String(formData.get('jobId') ?? '') || null) as string | null,
    customer_id: (String(formData.get('customerId') ?? '') || null) as string | null,
    title,
    report_date: String(formData.get('reportDate') ?? '') || todayInAustralia(),
    status,
    data: answers as Record<string, Json>,
    summary: String(formData.get('summary') ?? '').trim() || summarise(sections, answers) || null,
    signature_name: signatureName,
    signed_at: signatureName ? new Date().toISOString() : null,
  };

  let reportId = id;

  if (id) {
    const { error } = await supabase
      .from('reports')
      .update(header)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
      target: session.business.id,
      doc_kind: 'report',
    });
    if (numberError || !number) return fail(describeError(numberError));

    const { data, error } = await supabase
      .from('reports')
      .insert({ ...header, number, created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) return fail(describeError(error));
    reportId = data.id;
  }

  if (!reportId) return fail('The report could not be saved.');

  // Photos taken while filling the report in are attached to it here.
  const photoIds = formData.getAll('photoIds').map(String).filter(Boolean);
  if (photoIds.length > 0) {
    await supabase
      .from('job_photos')
      .update({ report_id: reportId })
      .in('id', photoIds)
      .eq('business_id', session.business.id);

    await supabase.from('report_photos').upsert(
      photoIds.map((photoId, position) => ({
        business_id: session.business.id,
        report_id: reportId,
        photo_id: photoId,
        position,
      })),
      { onConflict: 'report_id,photo_id' }
    );
  }

  await recordActivity(session, {
    verb: id ? 'updated' : 'created',
    summary: `${template.name} ${id ? 'updated' : 'filed'}: ${title}`,
    entityType: 'report',
    entityId: reportId,
    jobId: header.job_id,
    customerId: header.customer_id,
  });
  await audit(session.business.id, {
    action: id ? 'report.update' : 'report.create',
    entityType: 'report',
    entityId: reportId,
  });

  revalidatePath('/reports');
  revalidatePath(`/reports/${reportId}`);
  if (header.job_id) revalidatePath(`/jobs/${header.job_id}`);
  redirect(`/reports/${reportId}`);
}

/** Copy a report as a new draft — the usual way to file tomorrow's site report. */
export async function duplicateReportAction(formData: FormData): Promise<void> {
  const session = await requireCapability('reports.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/reports');

  const supabase = await createClient();
  const { data: report } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!report) redirect('/reports');

  const { data: number } = await supabase.rpc('next_document_number', {
    target: session.business.id,
    doc_kind: 'report',
  });
  if (!number) redirect(`/reports/${id}`);

  const today = todayInAustralia();
  const { data: copy } = await supabase
    .from('reports')
    .insert({
      business_id: session.business.id,
      template_id: report.template_id,
      template_key: report.template_key,
      job_id: report.job_id,
      customer_id: report.customer_id,
      number,
      title: report.title.replace(/\s*—\s*\d{4}-\d{2}-\d{2}$/, '') + ` — ${today}`,
      report_date: today,
      status: 'draft',
      data: report.data,
      summary: null,
      // The copy is unsigned: a signature belongs to the day it was given.
      signature_name: null,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (copy) {
    await audit(session.business.id, {
      action: 'report.duplicate',
      entityType: 'report',
      entityId: copy.id,
      detail: { from: id },
    });
    revalidatePath('/reports');
    redirect(`/reports/${copy.id}/edit`);
  }
  redirect(`/reports/${id}`);
}

export async function emailReportAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('reports.edit');
  const id = String(formData.get('id') ?? '');
  const recipient = String(formData.get('to') ?? '').trim();
  if (!id) return fail('That report was not found.');
  if (!recipient) return fail('Enter an email address.', { to: ['An address is needed'] });

  const loaded = await loadReportForPdf(session.business.id, id);
  if (!loaded) return fail('That report was not found.');

  const pdf = await renderReportPdf(loaded);
  const filename = reportFilename(loaded.report.number, loaded.templateName, loaded.business.name);

  const message = String(formData.get('message') ?? '').trim();
  const paragraphs = [
    'Hello,',
    message || `Please find attached ${loaded.templateName.toLowerCase()} ${loaded.report.number}.`,
    loaded.report.summary || '',
  ].filter(Boolean);

  const { result } = await sendAndRecord(
    session,
    {
      to: [recipient],
      subject: `${loaded.templateName} ${loaded.report.number} — ${loaded.report.title}`,
      text: `${paragraphs.join('\n\n')}\n\n${loaded.business.name}`,
      html: htmlBody(loaded.business.name, paragraphs),
      replyTo: loaded.business.email ?? undefined,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    },
    {
      customerId: loaded.report.customer_id,
      jobId: loaded.report.job_id,
      reportId: loaded.report.id,
    },
    [{ kind: 'report', id: loaded.report.id, filename }]
  );

  const supabase = await createClient();
  await supabase
    .from('reports')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await recordActivity(session, {
    verb: 'sent',
    summary: `Report ${loaded.report.number} emailed to ${recipient}`,
    entityType: 'report',
    entityId: id,
    jobId: loaded.report.job_id,
    customerId: loaded.report.customer_id,
  });
  await audit(session.business.id, {
    action: 'report.send',
    entityType: 'report',
    entityId: id,
    detail: { to: recipient, delivered: result.delivered },
  });

  revalidatePath(`/reports/${id}`);

  if (result.error) return { ok: true, message: `Marked as sent, but the email failed: ${result.error}` };
  if (!result.delivered) {
    return ok(
      `Recorded in the outbox. Email delivery is not configured — download the PDF and send it yourself. ` +
        `(${env.appUrl}/reports/${id}/pdf)`
    );
  }
  return ok(`Report sent to ${recipient}.`);
}

export async function deleteReportAction(formData: FormData): Promise<void> {
  const session = await requireCapability('reports.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/reports');

  const supabase = await createClient();
  await supabase
    .from('reports')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, { action: 'report.delete', entityType: 'report', entityId: id });
  revalidatePath('/reports');
  redirect('/reports');
}
