import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { accessTokenFor, providerFor } from './oauth';
import {
  normaliseGmailMessage,
  normaliseGraphMessage,
  participantsOf,
  snippetOf,
  type GmailMessage,
  type GraphMessage,
  type IncomingMessage,
} from './message';
import type { EmailAccount, EmailAccountRow } from '@/lib/database.types';

/**
 * Bringing received mail in.
 *
 * What this does, and does not, do:
 *
 *   - it reads. The scopes requested are read-only, so nothing here can delete
 *     or alter a message in someone's mailbox;
 *   - it files. A message is matched to a customer by the addresses on it, and
 *     through that customer to their most recent open job, so the mail lands on
 *     the job it belongs to rather than in an undifferentiated pile;
 *   - it is idempotent. Messages are keyed by the provider's own id, so running
 *     the sync twice changes nothing.
 *
 * It runs with the service role, which is the only role that can read the
 * encrypted tokens at all. Every write names the account's own business_id —
 * taken from the account row, never from an argument — so a sync cannot write
 * into another tenant however it is called.
 */

/** How far back a first sync reaches. Later syncs only pick up what is new. */
const FIRST_SYNC_DAYS = 30;
const PAGE_SIZE = 50;

export interface SyncResult {
  fetched: number;
  stored: number;
  matched: number;
  error: string | null;
}

async function gmailMessages(token: string, since: Date): Promise<IncomingMessage[]> {
  const query = `in:anywhere after:${Math.floor(since.getTime() / 1000)}`;
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${PAGE_SIZE}` +
      `&q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!list.ok) throw new Error(`Gmail returned ${list.status} listing messages.`);
  const listed = (await list.json()) as { messages?: { id: string }[] };

  const messages: IncomingMessage[] = [];
  for (const stub of listed.messages ?? []) {
    const detail = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!detail.ok) continue;
    messages.push(normaliseGmailMessage((await detail.json()) as GmailMessage));
  }
  return messages;
}

async function graphMessages(token: string, since: Date): Promise<IncomingMessage[]> {
  const url =
    'https://graph.microsoft.com/v1.0/me/messages' +
    `?$top=${PAGE_SIZE}&$orderby=receivedDateTime desc` +
    `&$filter=receivedDateTime ge ${since.toISOString()}` +
    '&$select=id,conversationId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,body,from,toRecipients,ccRecipients';

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Microsoft returned ${response.status} listing messages.`);

  const json = (await response.json()) as { value?: GraphMessage[] };
  return (json.value ?? []).map(normaliseGraphMessage);
}

/**
 * Sync one mailbox.
 *
 * The caller must have already established that this account belongs to the
 * business it is acting for. It takes the row, not an id, so it cannot be
 * handed an id out of a URL.
 */
export async function syncAccount(account: EmailAccount): Promise<SyncResult> {
  const admin = createAdminClient();
  const businessId = account.business_id;

  const fail = async (message: string): Promise<SyncResult> => {
    await admin
      .from('email_accounts')
      .update({ sync_error: message.slice(0, 500), last_synced_at: new Date().toISOString() })
      .eq('id', account.id);
    return { fetched: 0, stored: 0, matched: 0, error: message };
  };

  const config = providerFor(account.provider);
  if (!config) {
    return fail(
      `${account.provider} is not configured on this server, so this mailbox cannot sync.`
    );
  }

  // Re-read with the service role: `authenticated` has SELECT revoked on the
  // token columns, so the row the caller handed us has no token on it.
  const { data: withTokens } = await admin
    .from('email_accounts')
    .select('*')
    .eq('id', account.id)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!withTokens) return fail('That mailbox is no longer connected.');

  let messages: IncomingMessage[];
  try {
    const token = await accessTokenFor(withTokens as EmailAccountRow);
    const since = account.last_synced_at
      ? new Date(Date.parse(account.last_synced_at) - 60 * 60 * 1000) // an hour of overlap
      : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);

    messages =
      account.provider === 'google'
        ? await gmailMessages(token, since)
        : await graphMessages(token, since);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The mailbox could not be reached.');
  }

  if (messages.length === 0) {
    await admin
      .from('email_accounts')
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq('id', account.id);
    return { fetched: 0, stored: 0, matched: 0, error: null };
  }

  // --- who these messages are from ------------------------------------------
  // One query for every address across the whole batch, rather than one per
  // message: a customer is matched on any address that appears on the mail.
  const addresses = [...new Set(messages.flatMap(participantsOf))].filter(
    (address) => address !== account.email_address.toLowerCase()
  );

  const { data: customers } = await admin
    .from('customers')
    .select('id, email')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .in('email', addresses.length ? (addresses as never) : ([''] as never));

  const customerByAddress = new Map<string, string>();
  for (const customer of customers ?? []) {
    if (customer.email) customerByAddress.set(customer.email.toLowerCase(), customer.id);
  }

  // The job to file it against: that customer's most recently started job that
  // is still live. A guess, and an overridable one — every email has a "file it
  // against" control — but it is right far more often than leaving it blank.
  const customerIds = [...new Set(customerByAddress.values())];
  const jobByCustomer = new Map<string, string>();
  if (customerIds.length) {
    const { data: jobs } = await admin
      .from('jobs')
      .select('id, customer_id, status, created_at')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .in('customer_id', customerIds as never)
      .not('status', 'in', '("completed","paid","cancelled")')
      .order('created_at', { ascending: false });

    for (const job of jobs ?? []) {
      if (job.customer_id && !jobByCustomer.has(job.customer_id)) {
        jobByCustomer.set(job.customer_id, job.id);
      }
    }
  }

  // --- what we already have --------------------------------------------------
  const { data: seen } = await admin
    .from('emails')
    .select('provider_message_id')
    .eq('business_id', businessId)
    .eq('email_account_id', account.id)
    .in('provider_message_id', messages.map((message) => message.providerMessageId) as never);

  const known = new Set((seen ?? []).map((row) => row.provider_message_id));

  let stored = 0;
  let matched = 0;

  for (const message of messages) {
    if (known.has(message.providerMessageId)) continue;

    const customerId =
      participantsOf(message)
        .map((address) => customerByAddress.get(address))
        .find(Boolean) ?? null;
    const jobId = customerId ? (jobByCustomer.get(customerId) ?? null) : null;
    if (customerId) matched += 1;

    // --- the thread ---------------------------------------------------------
    let threadId: string | null = null;
    if (message.providerThreadId) {
      const { data: existing } = await admin
        .from('email_threads')
        .select('id')
        .eq('business_id', businessId)
        .eq('email_account_id', account.id)
        .eq('provider_thread_id', message.providerThreadId)
        .maybeSingle();

      if (existing) {
        threadId = existing.id;
        await admin
          .from('email_threads')
          .update({
            snippet: snippetOf(message),
            last_message_at: message.receivedAt,
            is_read: message.isRead,
            ...(customerId ? { customer_id: customerId } : {}),
            ...(jobId ? { job_id: jobId } : {}),
          })
          .eq('id', threadId)
          .eq('business_id', businessId);
      } else {
        const { data: created } = await admin
          .from('email_threads')
          .insert({
            business_id: businessId,
            email_account_id: account.id,
            provider_thread_id: message.providerThreadId,
            subject: message.subject,
            snippet: snippetOf(message),
            participants: participantsOf(message),
            customer_id: customerId,
            job_id: jobId,
            is_read: message.isRead,
            last_message_at: message.receivedAt,
          })
          .select('id')
          .single();
        threadId = created?.id ?? null;
      }
    }

    // --- the message --------------------------------------------------------
    const direction =
      message.from.address === account.email_address.toLowerCase() ? 'outbound' : 'inbound';

    const { data: inserted, error } = await admin
      .from('emails')
      .insert({
        business_id: businessId,
        thread_id: threadId,
        email_account_id: account.id,
        provider_message_id: message.providerMessageId,
        direction,
        state: direction === 'inbound' ? 'received' : 'sent',
        from_address: message.from.address,
        from_name: message.from.name,
        to_addresses: message.to.map((address) => address.address),
        cc_addresses: message.cc.map((address) => address.address),
        subject: message.subject,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        snippet: snippetOf(message),
        customer_id: customerId,
        job_id: jobId,
        is_read: message.isRead,
        received_at: direction === 'inbound' ? message.receivedAt : null,
        sent_at: direction === 'outbound' ? message.receivedAt : null,
      })
      .select('id')
      .single();

    if (error || !inserted) continue;
    stored += 1;

    // Attachment metadata only. The file itself stays in the mailbox: copying
    // every customer's attachments into our storage is not something a sync
    // should decide to do on their behalf.
    if (message.attachments.length) {
      await admin.from('email_attachments').insert(
        message.attachments.slice(0, 20).map((attachment) => ({
          business_id: businessId,
          email_id: inserted.id,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
        }))
      );
    }

    if (threadId) {
      const { count } = await admin
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('thread_id', threadId);
      await admin
        .from('email_threads')
        .update({ message_count: count ?? 1 })
        .eq('id', threadId)
        .eq('business_id', businessId);
    }
  }

  await admin
    .from('email_accounts')
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq('id', account.id);

  return { fetched: messages.length, stored, matched, error: null };
}

/** Sync every connected mailbox for a business. */
export async function syncBusiness(businessId: string): Promise<SyncResult> {
  const admin = createAdminClient();
  const { data: accounts } = await admin
    .from('email_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .is('deleted_at', null);

  const total: SyncResult = { fetched: 0, stored: 0, matched: 0, error: null };

  for (const account of (accounts ?? []) as EmailAccount[]) {
    const result = await syncAccount(account);
    total.fetched += result.fetched;
    total.stored += result.stored;
    total.matched += result.matched;
    // Report the first failure, but keep going: one broken mailbox should not
    // stop the others.
    if (result.error && !total.error) total.error = result.error;
  }

  return total;
}
