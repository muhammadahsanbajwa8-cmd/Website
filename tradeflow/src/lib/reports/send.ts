import 'server-only';

import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { htmlBody, sendAndRecord } from '@/lib/email/send';
import { loadReportForPdf, renderReportPdf, reportFilename } from '@/lib/report-pdf';
import { audit, recordActivity, notifyRoles } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { BusinessSession } from '@/lib/session';
import type { Report } from '@/lib/database.types';

/**
 * Sending a report to the customer.
 *
 * This is the whole path, and none of it is decoration:
 *
 *   1. the recipient is resolved and checked before anything else happens —
 *      a report with nowhere to go fails here, with the reason;
 *   2. the PDF is generated from the live record, so what is attached is what
 *      the report says right now;
 *   3. the message goes through the same provider every other email uses, and
 *      the result — delivered or not, and why — is written to the `emails`
 *      table and back onto the report;
 *   4. a share link is minted so the customer can open it without an account;
 *   5. the outcome is audited, put on the job's timeline, and notified.
 *
 * What it will not do is claim success it did not have. If the provider
 * refuses the message, `sent_at` is left alone and the error is returned and
 * stored. A report is only marked sent when a provider accepted it.
 */

export interface SendReportResult {
  ok: boolean;
  delivered: boolean;
  recipient: string | null;
  error: string | null;
  /** True when the message was recorded but no provider is configured. */
  recordedOnly: boolean;
  shareUrl: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const newShareToken = () => randomBytes(24).toString('hex');

/**
 * Where a report should go, and whether that address is usable.
 *
 * An explicit recipient wins — the person sending it may know better than the
 * record — but it still has to be a real address.
 */
export async function resolveRecipient(
  businessId: string,
  report: Pick<Report, 'customer_id' | 'sent_to'>,
  override?: string | null
): Promise<{ email: string | null; source: 'entered' | 'customer' | 'none'; reason: string | null }> {
  const entered = override?.trim();
  if (entered) {
    return EMAIL_PATTERN.test(entered)
      ? { email: entered.toLowerCase(), source: 'entered', reason: null }
      : { email: null, source: 'entered', reason: `“${entered}” is not a valid email address.` };
  }

  if (!report.customer_id) {
    return {
      email: null,
      source: 'none',
      reason: 'This report is not linked to a customer, so there is nobody to send it to. Add a customer, or type an address.',
    };
  }

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from('customers')
    .select('name, email')
    .eq('id', report.customer_id)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!customer?.email) {
    return {
      email: null,
      source: 'none',
      reason: `${customer?.name ?? 'That customer'} has no email address saved. Add one to their record, or type an address below.`,
    };
  }
  if (!EMAIL_PATTERN.test(customer.email)) {
    return {
      email: null,
      source: 'customer',
      reason: `The address saved against ${customer.name} (“${customer.email}”) is not valid. Correct it on their record.`,
    };
  }

  return { email: customer.email.toLowerCase(), source: 'customer', reason: null };
}

export async function sendReport(
  session: BusinessSession,
  reportId: string,
  options: { recipient?: string | null; message?: string | null; resend?: boolean } = {}
): Promise<SendReportResult> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) {
    return { ok: false, delivered: false, recipient: null, recordedOnly: false, shareUrl: null,
      error: 'That report was not found, or is not yours to send.' };
  }
  const report = data as Report;

  // Sending the same report twice by accident is a real thing on a phone with
  // a slow connection. A deliberate resend has to say so.
  if (report.sent_at && !options.resend) {
    return {
      ok: false, delivered: false, recipient: report.sent_to, recordedOnly: false,
      shareUrl: report.share_token ? `${env.appUrl}/r/${report.share_token}` : null,
      error: `This report was already sent to ${report.sent_to ?? 'the customer'} on ${formatDate(report.sent_at)}. Use “Send again” if you meant to.`,
    };
  }

  const { email: recipient, reason } = await resolveRecipient(
    session.business.id,
    report,
    options.recipient
  );

  if (!recipient) {
    await supabase
      .from('reports')
      .update({ send_error: reason })
      .eq('id', report.id)
      .eq('business_id', session.business.id);
    return { ok: false, delivered: false, recipient: null, recordedOnly: false, shareUrl: null, error: reason };
  }

  // --- build it -------------------------------------------------------------
  let pdf: Uint8Array;
  let filename: string;
  let templateName: string;
  try {
    const loaded = await loadReportForPdf(session.business.id, report.id);
    if (!loaded) throw new Error('The report could not be loaded.');
    pdf = await renderReportPdf(loaded);
    filename = reportFilename(loaded.report.number, loaded.templateName, loaded.business.name);
    templateName = loaded.templateName;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The PDF could not be produced.';
    await supabase
      .from('reports')
      .update({ send_error: detail })
      .eq('id', report.id)
      .eq('business_id', session.business.id);
    return { ok: false, delivered: false, recipient, recordedOnly: false, shareUrl: null,
      error: `We could not build the PDF for this report. ${detail}` };
  }

  // The share link is minted before sending, so the email can carry it.
  const shareToken = report.share_token ?? newShareToken();
  const shareUrl = `${env.appUrl}/r/${shareToken}`;

  const intro = options.message?.trim();
  const paragraphs = [
    intro || `Here is ${templateName.toLowerCase()} ${report.number} for ${report.title}.`,
    `You can read it online at ${shareUrl} — no login needed — or open the PDF attached.`,
    `If anything looks wrong, reply to this email and it comes straight back to us.`,
    `${session.business.name}`,
  ];

  const { result, emailId } = await sendAndRecord(
    session,
    {
      to: [recipient],
      subject: `${templateName} ${report.number} — ${report.title}`,
      text: paragraphs.join('\n\n'),
      html: htmlBody(session.business.name, paragraphs),
      replyTo: session.business.email ?? undefined,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    },
    { customerId: report.customer_id, jobId: report.job_id, reportId: report.id },
    [{ kind: 'report', id: report.id, filename }]
  );

  const now = new Date().toISOString();
  const accepted = result.delivered || !result.error;

  await supabase
    .from('reports')
    .update({
      share_token: shareToken,
      sent_to: recipient,
      send_error: result.error,
      // Only a message a provider took counts as sent.
      ...(accepted
        ? {
            sent_at: now,
            send_count: (report.send_count ?? 0) + 1,
            status: report.status === 'draft' ? 'final' : report.status,
            completed_at: report.completed_at ?? now,
          }
        : {}),
    })
    .eq('id', report.id)
    .eq('business_id', session.business.id);

  await audit(session.business.id, {
    action: 'report.send',
    entityType: 'report',
    entityId: report.id,
    detail: { to: recipient, delivered: result.delivered, error: result.error, emailId },
  });

  if (accepted) {
    await recordActivity(session, {
      verb: 'sent',
      summary: `${templateName} ${report.number} sent to ${recipient}`,
      entityType: 'report',
      entityId: report.id,
      jobId: report.job_id,
      customerId: report.customer_id,
    });
    await notifyRoles(session, ['owner', 'admin', 'manager'], {
      kind: 'report.sent',
      title: `Report ${report.number} sent`,
      body: `${report.title} went to ${recipient}.`,
      link: `/reports/${report.id}`,
      severity: 'success',
    });
  }

  if (result.error) {
    return {
      ok: false, delivered: false, recipient, recordedOnly: false, shareUrl,
      error: `We couldn’t send the report to ${recipient}. ${result.error} Check the address and try again — nothing has been lost.`,
    };
  }

  return {
    ok: true,
    delivered: result.delivered,
    recipient,
    recordedOnly: !result.delivered,
    shareUrl,
    error: null,
  };
}
