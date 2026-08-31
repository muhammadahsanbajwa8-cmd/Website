import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import type { BusinessSession } from '@/lib/session';

/**
 * Outbound email.
 *
 * Three providers, chosen by EMAIL_PROVIDER:
 *
 *   log     — the default. The message is written to the `emails` table in
 *             full and appears in the outbox; nothing leaves the server. The
 *             whole send path is therefore exercisable with no account
 *             anywhere, and a demo never mails a real customer by accident.
 *   resend  — RESEND_API_KEY, one HTTPS call.
 *   smtp    — SMTP_URL, for a business that already has a mail server.
 *
 * Every send is recorded either way, so the record of what was sent does not
 * depend on which provider is configured.
 */

export interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface OutboundMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export interface SendResult {
  delivered: boolean;
  provider: string;
  providerMessageId: string | null;
  error: string | null;
}

async function sendViaResend(message: OutboundMessage): Promise<SendResult> {
  const key = env.resendKey;
  if (!key) {
    return { delivered: false, provider: 'resend', providerMessageId: null, error: 'RESEND_API_KEY is not set' };
  }

  try {
    const response = await fetch(`${env.resendBaseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: message.to,
        cc: message.cc?.length ? message.cc : undefined,
        bcc: message.bcc?.length ? message.bcc : undefined,
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.content).toString('base64'),
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        delivered: false,
        provider: 'resend',
        providerMessageId: null,
        error: `Resend returned ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    const data = (await response.json()) as { id?: string };
    return { delivered: true, provider: 'resend', providerMessageId: data.id ?? null, error: null };
  } catch (error) {
    return {
      delivered: false,
      provider: 'resend',
      providerMessageId: null,
      error: error instanceof Error ? error.message : 'Resend request failed',
    };
  }
}

async function sendViaSmtp(message: OutboundMessage): Promise<SendResult> {
  if (!env.smtpUrl) {
    return { delivered: false, provider: 'smtp', providerMessageId: null, error: 'SMTP_URL is not set' };
  }
  // Sending over raw SMTP needs a mail library with a TLS socket
  // implementation, which this project does not carry. The configuration is
  // read and reported so the choice is visible rather than silently ignored.
  return {
    delivered: false,
    provider: 'smtp',
    providerMessageId: null,
    error:
      'SMTP delivery needs a mail transport package installed (for example nodemailer). ' +
      'Use EMAIL_PROVIDER=resend, or add one and implement sendViaSmtp.',
  };
}

async function sendViaLog(message: OutboundMessage): Promise<SendResult> {
  console.info(
    `[email:log] to=${message.to.join(', ')} subject=${JSON.stringify(message.subject)} ` +
      `attachments=${message.attachments?.length ?? 0}`
  );
  return { delivered: false, provider: 'log', providerMessageId: null, error: null };
}

export async function deliver(message: OutboundMessage): Promise<SendResult> {
  switch (env.emailProvider) {
    case 'resend':
      return sendViaResend(message);
    case 'smtp':
      return sendViaSmtp(message);
    default:
      return sendViaLog(message);
  }
}

export interface RecordedSend {
  emailId: string | null;
  result: SendResult;
}

/**
 * Send and record. The row lands whatever the provider does, so a failed send
 * is visible in the outbox with its error rather than disappearing.
 */
export async function sendAndRecord(
  session: BusinessSession,
  message: OutboundMessage,
  links: {
    customerId?: string | null;
    jobId?: string | null;
    quoteId?: string | null;
    invoiceId?: string | null;
    reportId?: string | null;
    threadId?: string | null;
  } = {},
  attachmentMeta: { kind: 'quote' | 'invoice' | 'report'; id: string; filename: string }[] = []
): Promise<RecordedSend> {
  const result = await deliver(message);
  const supabase = await createClient();

  const { data: email } = await supabase
    .from('emails')
    .insert({
      business_id: session.business.id,
      thread_id: links.threadId ?? null,
      direction: 'outbound',
      state: result.delivered ? 'sent' : result.error ? 'failed' : 'queued',
      from_address: session.business.email ?? session.email,
      from_name: session.business.name,
      to_addresses: message.to,
      cc_addresses: message.cc ?? [],
      bcc_addresses: message.bcc ?? [],
      subject: message.subject,
      body_text: message.text,
      body_html: message.html ?? null,
      snippet: message.text.replace(/\s+/g, ' ').slice(0, 200),
      customer_id: links.customerId ?? null,
      job_id: links.jobId ?? null,
      quote_id: links.quoteId ?? null,
      invoice_id: links.invoiceId ?? null,
      report_id: links.reportId ?? null,
      provider_message_id: result.providerMessageId,
      error: result.error,
      is_read: true,
      sent_at: result.delivered ? new Date().toISOString() : null,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (email && attachmentMeta.length > 0) {
    await supabase.from('email_attachments').insert(
      attachmentMeta.map((attachment) => ({
        business_id: session.business.id,
        email_id: email.id,
        file_name: attachment.filename,
        mime_type: 'application/pdf',
        generated_kind: attachment.kind,
        generated_id: attachment.id,
      }))
    );
  }

  return { emailId: email?.id ?? null, result };
}

/** Plain text wrapped in the same shell for every outbound message. */
export function htmlBody(businessName: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 18px;font-size:18px;color:#0f172a;">${escape(businessName)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6;font-size:15px;">${escape(p)}</p>`).join('\n')}
${
  cta
    ? `<p style="margin:24px 0 0;"><a href="${escape(cta.url)}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${escape(cta.label)}</a></p>`
    : ''
}
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center;">Sent by ${escape(businessName)} through TradeFlow.</p>
</body></html>`;
}
