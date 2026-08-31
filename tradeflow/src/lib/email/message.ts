/**
 * Turning a provider's message into ours.
 *
 * Gmail and Microsoft Graph describe the same thing in entirely different
 * shapes — Gmail as RFC 822 headers and a tree of base64url parts, Graph as a
 * flat JSON object. Both are reduced here to one `IncomingMessage`, which is
 * what the rest of the application sees.
 *
 * Deliberately free of imports: no network, no database, no `server-only`. It
 * is the part of the sync worth testing, so it is the part that can be tested
 * without either provider.
 */

export interface Address {
  address: string;
  name: string | null;
}

export interface IncomingAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface IncomingMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  receivedAt: string;
  isRead: boolean;
  attachments: IncomingAttachment[];
}

/** `Dana Whitfield <dana@example.com>` → the two halves. */
export function parseAddress(value: string | null | undefined): Address | null {
  if (!value) return null;

  const angled = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, '').trim();
    return { address: angled[2].trim().toLowerCase(), name: name || null };
  }

  const bare = value.trim();
  if (!bare.includes('@')) return null;
  return { address: bare.toLowerCase(), name: null };
}

/** A header that may hold several addresses, comma separated. */
export function parseAddressList(value: string | null | undefined): Address[] {
  if (!value) return [];

  // Split on commas that are not inside quotes or angle brackets.
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';

  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (character === '<') depth += 1;
    if (character === '>') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0 && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);

  return parts
    .map((part) => parseAddress(part))
    .filter((address): address is Address => address !== null);
}

const decodeBase64Url = (value: string): string =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Strip tags well enough to read, and to summarise. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Gmail -------------------------------------------------------------------

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

function gmailHeader(message: GmailMessage, name: string): string | null {
  const headers = message.payload?.headers ?? [];
  const found = headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

/** Walk the part tree, collecting bodies and attachment metadata. */
function walkGmailParts(
  part: GmailPart | undefined,
  found: { text: string[]; html: string[]; attachments: IncomingAttachment[] }
): void {
  if (!part) return;

  if (part.filename && part.body?.attachmentId) {
    found.attachments.push({
      fileName: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      sizeBytes: part.body.size ?? 0,
    });
  } else if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/html') found.html.push(decoded);
    else if (!part.mimeType || part.mimeType.startsWith('text/')) found.text.push(decoded);
  }

  for (const child of part.parts ?? []) walkGmailParts(child, found);
}

export function normaliseGmailMessage(message: GmailMessage): IncomingMessage {
  const found = { text: [] as string[], html: [] as string[], attachments: [] as IncomingAttachment[] };
  walkGmailParts(message.payload, found);

  const html = found.html.join('\n') || null;
  const text = found.text.join('\n') || (html ? htmlToText(html) : null);

  const received = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : (gmailHeader(message, 'Date') && !Number.isNaN(Date.parse(gmailHeader(message, 'Date')!))
        ? new Date(gmailHeader(message, 'Date')!).toISOString()
        : new Date().toISOString());

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    from: parseAddress(gmailHeader(message, 'From')) ?? { address: 'unknown@unknown', name: null },
    to: parseAddressList(gmailHeader(message, 'To')),
    cc: parseAddressList(gmailHeader(message, 'Cc')),
    subject: gmailHeader(message, 'Subject'),
    bodyText: text,
    bodyHtml: html,
    snippet: message.snippet ?? (text ? text.slice(0, 300) : null),
    receivedAt: received,
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
    attachments: found.attachments,
  };
}

// --- Microsoft Graph ---------------------------------------------------------

export type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  attachments?: { name?: string; contentType?: string; size?: number }[];
};

const graphAddress = (
  recipient: { emailAddress?: { address?: string; name?: string } } | undefined
): Address | null =>
  recipient?.emailAddress?.address
    ? {
        address: recipient.emailAddress.address.toLowerCase(),
        name: recipient.emailAddress.name ?? null,
      }
    : null;

export function normaliseGraphMessage(message: GraphMessage): IncomingMessage {
  const isHtml = (message.body?.contentType ?? '').toLowerCase() === 'html';
  const content = message.body?.content ?? null;
  const html = isHtml ? content : null;
  const text = isHtml ? (content ? htmlToText(content) : null) : content;

  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? null,
    from: graphAddress(message.from) ?? { address: 'unknown@unknown', name: null },
    to: (message.toRecipients ?? [])
      .map(graphAddress)
      .filter((address): address is Address => address !== null),
    cc: (message.ccRecipients ?? [])
      .map(graphAddress)
      .filter((address): address is Address => address !== null),
    subject: message.subject ?? null,
    bodyText: text,
    bodyHtml: html,
    snippet: message.bodyPreview ?? (text ? text.slice(0, 300) : null),
    receivedAt: message.receivedDateTime
      ? new Date(message.receivedDateTime).toISOString()
      : new Date().toISOString(),
    isRead: message.isRead ?? false,
    attachments: (message.attachments ?? []).map((attachment) => ({
      fileName: attachment.name ?? 'attachment',
      mimeType: attachment.contentType ?? 'application/octet-stream',
      sizeBytes: attachment.size ?? 0,
    })),
  };
}

/**
 * Everyone the message involves, lowercased and deduplicated.
 *
 * Used to find the customer it belongs to, and to fill the thread's
 * participant list.
 */
export function participantsOf(message: IncomingMessage): string[] {
  return [...new Set([message.from.address, ...message.to.map((a) => a.address), ...message.cc.map((a) => a.address)])];
}

/** A short line for a list, whatever the message did or did not carry. */
export function snippetOf(message: IncomingMessage): string {
  const source = message.snippet || message.bodyText || '';
  return source.replace(/\s+/g, ' ').trim().slice(0, 300);
}
