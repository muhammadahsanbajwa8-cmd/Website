'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { composeEmailSchema, emailAssistSchema, fieldErrors } from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';
import { htmlBody, sendAndRecord } from '@/lib/email/send';
import { loadQuoteForPdf, loadInvoiceForPdf, pdfFilename, renderQuotePdf, renderInvoicePdf } from '@/lib/documents';
import { loadReportForPdf, renderReportPdf, reportFilename } from '@/lib/report-pdf';
import { runOnce } from '@/lib/ai/run';
import { brainSystemPrompt, loadBrain } from '@/lib/ai/brain';
import { aiConfigured, describeAiError, EFFORT } from '@/lib/ai/client';
import type { Attachment } from '@/lib/email/send';
import type { Json } from '@/lib/database.types';

/**
 * Sending and answering email.
 *
 * The AI here never sends anything. Every action returns a draft, and the
 * person presses send — that is a hard rule, not a setting.
 */

export async function composeEmailAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('emails.send');

  const parsed = composeEmailSchema.safeParse({
    to: formData.get('to') ?? '',
    cc: formData.get('cc') ?? '',
    bcc: formData.get('bcc') ?? '',
    subject: formData.get('subject'),
    body: formData.get('body'),
    customerId: formData.get('customerId') || null,
    jobId: formData.get('jobId') || null,
    threadId: formData.get('threadId') || null,
    attachQuoteId: formData.get('attachQuoteId') || null,
    attachInvoiceId: formData.get('attachInvoiceId') || null,
    attachReportId: formData.get('attachReportId') || null,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  // Attachments are generated from the live record, so an email always carries
  // the document as it stands rather than a stale copy.
  const attachments: Attachment[] = [];
  const meta: { kind: 'quote' | 'invoice' | 'report'; id: string; filename: string }[] = [];

  if (parsed.data.attachQuoteId && session.can('quotes.view')) {
    const loaded = await loadQuoteForPdf(session.business.id, parsed.data.attachQuoteId);
    if (loaded) {
      const filename = pdfFilename('quote', loaded.quote.number, loaded.business.name);
      attachments.push({
        filename,
        content: await renderQuotePdf(loaded.quote, loaded.business, loaded.customer, loaded.items, loaded.job),
        contentType: 'application/pdf',
      });
      meta.push({ kind: 'quote', id: loaded.quote.id, filename });
    }
  }

  if (parsed.data.attachInvoiceId && session.can('invoices.view')) {
    const loaded = await loadInvoiceForPdf(session.business.id, parsed.data.attachInvoiceId);
    if (loaded) {
      const filename = pdfFilename('invoice', loaded.invoice.number, loaded.business.name);
      attachments.push({
        filename,
        content: await renderInvoicePdf(loaded.invoice, loaded.business, loaded.customer, loaded.items, loaded.job),
        contentType: 'application/pdf',
      });
      meta.push({ kind: 'invoice', id: loaded.invoice.id, filename });
    }
  }

  if (parsed.data.attachReportId && session.can('reports.view')) {
    const loaded = await loadReportForPdf(session.business.id, parsed.data.attachReportId);
    if (loaded) {
      const filename = reportFilename(loaded.report.number, loaded.templateName, loaded.business.name);
      attachments.push({
        filename,
        content: await renderReportPdf(loaded),
        contentType: 'application/pdf',
      });
      meta.push({ kind: 'report', id: loaded.report.id, filename });
    }
  }

  const { result, emailId } = await sendAndRecord(
    session,
    {
      to: parsed.data.to,
      cc: parsed.data.cc,
      bcc: parsed.data.bcc,
      subject: parsed.data.subject,
      text: parsed.data.body,
      html: htmlBody(
        session.business.name,
        parsed.data.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
      ),
      replyTo: session.business.email ?? undefined,
      attachments,
    },
    {
      customerId: parsed.data.customerId,
      jobId: parsed.data.jobId,
      quoteId: parsed.data.attachQuoteId,
      invoiceId: parsed.data.attachInvoiceId,
      reportId: parsed.data.attachReportId,
      threadId: parsed.data.threadId,
    },
    meta
  );

  if (parsed.data.jobId) {
    await recordActivity(session, {
      verb: 'emailed',
      summary: `Email sent to ${parsed.data.to.join(', ')}: ${parsed.data.subject}`,
      entityType: 'email',
      entityId: emailId,
      jobId: parsed.data.jobId,
      customerId: parsed.data.customerId,
    });
  }

  await audit(session.business.id, {
    action: 'email.send',
    entityType: 'email',
    entityId: emailId,
    detail: { to: parsed.data.to, delivered: result.delivered },
  });

  revalidatePath('/emails');

  if (result.error) {
    return { ok: true, message: `Recorded in the outbox, but delivery failed: ${result.error}` };
  }
  if (!result.delivered) {
    return ok(
      'Recorded in the outbox. Email delivery is not configured, so nothing was sent — set ' +
        'EMAIL_PROVIDER to send for real.'
    );
  }
  redirect('/emails?sent=1');
}

export async function markEmailReadAction(formData: FormData): Promise<void> {
  const session = await requireCapability('emails.view');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('emails')
    .update({ is_read: true })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/emails');
}

/** Attach an email to a job or customer, so it joins that job's history. */
export async function linkEmailAction(formData: FormData): Promise<void> {
  const session = await requireCapability('emails.view');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from('emails')
    .update({
      job_id: String(formData.get('jobId') ?? '') || null,
      customer_id: String(formData.get('customerId') ?? '') || null,
    })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath(`/emails/${id}`);
  revalidatePath('/emails');
}

// --- the email assistant ------------------------------------------------------

const ACTIONS = {
  summarise: {
    instruction:
      'Summarise this email in two or three plain sentences: who it is from, what they want, ' +
      'and any deadline. No preamble.',
    tokens: 500,
  },
  what_do_i_need_to_do: {
    instruction:
      'List what the business now has to do because of this email, as short imperative lines. ' +
      'One line per action, with a deadline where one is stated. If nothing is required, say so ' +
      'in one line.',
    tokens: 600,
  },
  draft_reply: {
    instruction:
      'Write a reply, ready to send. Answer what was asked, confirm what can be confirmed, and ' +
      'say plainly where something has to be checked. No subject line, no signature block — ' +
      'those are added separately.',
    tokens: 1200,
  },
  make_professional: {
    instruction:
      'Rewrite the draft below so it reads professionally, keeping every fact and commitment ' +
      'exactly as written. Do not add anything that was not there.',
    tokens: 1200,
  },
  make_shorter: {
    instruction:
      'Cut the draft below to the shortest version that still says everything it needs to. Keep ' +
      'every fact, date and figure.',
    tokens: 800,
  },
  create_task: {
    instruction:
      'Write the single most important action from this email as one short imperative line, ' +
      'then on a second line write "Priority: low|medium|high|urgent", then on a third line ' +
      '"Due: YYYY-MM-DD" if a deadline is stated, or "Due: none".',
    tokens: 200,
  },
  create_report: {
    instruction:
      'Draft the body of a site report from what this email describes. Cover what happened, ' +
      'where, and what needs doing. Plain paragraphs.',
    tokens: 1200,
  },
} as const;

/**
 * The email assistant.
 *
 * Everything it produces is a draft handed back to the person. There is no
 * code path in this function that sends anything.
 */
export async function emailAssistAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('ai.use');

  const parsed = emailAssistSchema.safeParse({
    emailId: formData.get('emailId'),
    action: formData.get('action'),
    draft: formData.get('draft') || undefined,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  if (!aiConfigured()) {
    return fail(
      'The AI assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local — ' +
        'everything else on this page works without it.'
    );
  }

  const supabase = await createClient();
  const { data: email } = await supabase
    .from('emails')
    .select('*')
    .eq('id', parsed.data.emailId)
    .eq('business_id', session.business.id)
    .maybeSingle();

  if (!email) return fail('That email was not found.');

  const brain = await loadBrain(session.business.id);
  const system = brain
    ? brainSystemPrompt(brain, 'email')
    : `You are the assistant for ${session.business.name}, an Australian trade business. ` +
      'Write plainly and briefly. Never send anything — everything you produce is a draft.';

  const config = ACTIONS[parsed.data.action];

  const prompt = [
    config.instruction,
    '',
    '--- the email ---',
    `From: ${email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}`,
    `Subject: ${email.subject ?? '(no subject)'}`,
    '',
    (email.body_text ?? email.snippet ?? '').slice(0, 20_000),
    parsed.data.draft
      ? ['', '--- the draft to work on ---', parsed.data.draft.slice(0, 20_000)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const output = await runOnce({
      system,
      prompt,
      effort: EFFORT.email,
      maxTokens: config.tokens,
    });

    // A summary is worth keeping on the row; a draft is not.
    if (parsed.data.action === 'summarise') {
      await supabase
        .from('emails')
        .update({ ai_summary: output.slice(0, 4000) })
        .eq('id', email.id)
        .eq('business_id', session.business.id);
      revalidatePath(`/emails/${email.id}`);
    }

    if (parsed.data.action === 'what_do_i_need_to_do') {
      await supabase
        .from('emails')
        .update({ ai_actions: { actions: output.slice(0, 4000) } as unknown as Json })
        .eq('id', email.id)
        .eq('business_id', session.business.id);
      revalidatePath(`/emails/${email.id}`);
    }

    await audit(session.business.id, {
      action: `email.ai_${parsed.data.action}`,
      entityType: 'email',
      entityId: email.id,
    });

    return ok(output, { action: parsed.data.action });
  } catch (error) {
    return fail(describeAiError(error));
  }
}
