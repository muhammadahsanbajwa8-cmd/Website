import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseAddress,
  parseAddressList,
  htmlToText,
  normaliseGmailMessage,
  normaliseGraphMessage,
  participantsOf,
  snippetOf,
  type GmailMessage,
  type GraphMessage,
} from '@/lib/email/message';

/**
 * Connecting a mailbox.
 *
 * Two things are worth testing without a provider on the other end: that a
 * message from either of them ends up in the same shape, and that a refresh
 * token is never written where it could be read.
 */

const base64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

describe('reading an address', () => {
  it('separates the name from the address', () => {
    expect(parseAddress('Dana Whitfield <dana@harbourside.example>')).toEqual({
      address: 'dana@harbourside.example',
      name: 'Dana Whitfield',
    });
  });

  it('takes a bare address', () => {
    expect(parseAddress('marcus@example.com')).toEqual({
      address: 'marcus@example.com',
      name: null,
    });
  });

  it('drops the quotes people put around a name with a comma in it', () => {
    expect(parseAddress('"Raman, Priya" <priya@corvus.example>')?.name).toBe('Raman, Priya');
  });

  it('lowercases the address, so matching a customer is not case sensitive', () => {
    expect(parseAddress('Dana@Harbourside.Example')?.address).toBe('dana@harbourside.example');
  });

  it('refuses something that is not an address at all', () => {
    expect(parseAddress('undisclosed recipients')).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });

  it('splits a list without breaking on a comma inside a quoted name', () => {
    const list = parseAddressList(
      '"Raman, Priya" <priya@corvus.example>, dana@harbourside.example, Marcus <marcus@example.com>'
    );
    expect(list.map((entry) => entry.address)).toEqual([
      'priya@corvus.example',
      'dana@harbourside.example',
      'marcus@example.com',
    ]);
    expect(list[0].name).toBe('Raman, Priya');
  });
});

describe('reading a message body', () => {
  it('turns HTML into something a person and a summariser can read', () => {
    const text = htmlToText(
      '<style>p{color:red}</style><p>Hi Alex,</p><p>Can you come Tuesday?</p>' +
        '<ul><li>Front wall</li><li>Gate</li></ul>'
    );
    expect(text).not.toContain('<');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Can you come Tuesday?');
    expect(text).toContain('Front wall');
  });

  it('unescapes the entities that would otherwise be read aloud', () => {
    expect(htmlToText('<p>Bricks &amp; mortar &lt;urgent&gt;</p>')).toBe('Bricks & mortar <urgent>');
  });
});

describe('a Gmail message', () => {
  const message: GmailMessage = {
    id: 'msg-1',
    threadId: 'thread-1',
    snippet: 'Can you come Tuesday?',
    internalDate: String(Date.UTC(2026, 2, 9, 22, 30)),
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Dana Whitfield <dana@harbourside.example>' },
        { name: 'To', value: 'alex@democonstruction.example' },
        { name: 'Cc', value: 'accounts@harbourside.example' },
        { name: 'Subject', value: 'Boundary wall — Tuesday?' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: base64url('Hi Alex,\n\nCan you come Tuesday?') } },
            { mimeType: 'text/html', body: { data: base64url('<p>Hi Alex,</p>') } },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'site-plan.pdf',
          body: { attachmentId: 'att-1', size: 88_120 },
        },
      ],
    },
  };

  const normalised = normaliseGmailMessage(message);

  it('finds the body in the part tree', () => {
    expect(normalised.bodyText).toContain('Can you come Tuesday?');
    expect(normalised.bodyHtml).toBe('<p>Hi Alex,</p>');
  });

  it('reads the headers it needs', () => {
    expect(normalised.from).toEqual({ address: 'dana@harbourside.example', name: 'Dana Whitfield' });
    expect(normalised.to.map((a) => a.address)).toEqual(['alex@democonstruction.example']);
    expect(normalised.cc.map((a) => a.address)).toEqual(['accounts@harbourside.example']);
    expect(normalised.subject).toBe('Boundary wall — Tuesday?');
  });

  it('records the attachment without taking the file', () => {
    expect(normalised.attachments).toEqual([
      { fileName: 'site-plan.pdf', mimeType: 'application/pdf', sizeBytes: 88_120 },
    ]);
    // The attachment is not mistaken for the body.
    expect(normalised.bodyText).not.toContain('site-plan');
  });

  it('reads UNREAD as unread', () => {
    expect(normalised.isRead).toBe(false);
    expect(normaliseGmailMessage({ ...message, labelIds: ['INBOX'] }).isRead).toBe(true);
  });

  it('dates it from the internal timestamp', () => {
    expect(normalised.receivedAt).toBe('2026-03-09T22:30:00.000Z');
  });

  it('survives a message with nothing on it', () => {
    const empty = normaliseGmailMessage({ id: 'msg-2' });
    expect(empty.providerMessageId).toBe('msg-2');
    expect(empty.to).toEqual([]);
    expect(empty.attachments).toEqual([]);
    expect(Number.isNaN(Date.parse(empty.receivedAt))).toBe(false);
  });
});

describe('a Microsoft message', () => {
  const message: GraphMessage = {
    id: 'AAMk-1',
    conversationId: 'conv-1',
    subject: 'Garage slab',
    bodyPreview: 'Confirming the pour',
    receivedDateTime: '2026-03-09T22:30:00Z',
    isRead: true,
    body: { contentType: 'html', content: '<p>Confirming the pour for the 9th.</p>' },
    from: { emailAddress: { address: 'Marcus@Example.com', name: 'Marcus Iereti' } },
    toRecipients: [{ emailAddress: { address: 'alex@democonstruction.example' } }],
    attachments: [{ name: 'permit.pdf', contentType: 'application/pdf', size: 12_000 }],
  };

  const normalised = normaliseGraphMessage(message);

  it('lands in the same shape as Gmail', () => {
    expect(Object.keys(normalised).sort()).toEqual(
      Object.keys(normaliseGmailMessage({ id: 'x' })).sort()
    );
  });

  it('reads the sender, lowercased', () => {
    expect(normalised.from).toEqual({ address: 'marcus@example.com', name: 'Marcus Iereti' });
  });

  it('keeps the HTML and derives readable text from it', () => {
    expect(normalised.bodyHtml).toContain('<p>');
    expect(normalised.bodyText).toBe('Confirming the pour for the 9th.');
  });

  it('carries the conversation id, so a reply joins its thread', () => {
    expect(normalised.providerThreadId).toBe('conv-1');
  });
});

describe('filing a message', () => {
  const message = normaliseGmailMessage({
    id: 'msg-3',
    payload: {
      headers: [
        { name: 'From', value: 'dana@harbourside.example' },
        { name: 'To', value: 'alex@democonstruction.example, site@democonstruction.example' },
        { name: 'Cc', value: 'accounts@harbourside.example' },
      ],
      body: { data: base64url('   Lots   of\n\n  whitespace   ') },
    },
  });

  it('lists everyone on it, once each', () => {
    expect(participantsOf(message)).toEqual([
      'dana@harbourside.example',
      'alex@democonstruction.example',
      'site@democonstruction.example',
      'accounts@harbourside.example',
    ]);
  });

  it('makes a snippet that fits on one line', () => {
    expect(snippetOf(message)).toBe('Lots of whitespace');
    expect(snippetOf(message).length).toBeLessThanOrEqual(300);
  });
});

describe('the tokens are never stored readable', () => {
  // The crypto module reads the key through `env`, which is server-only, so it
  // is imported after the variable is set.
  let crypto: typeof import('@/lib/email/crypto');

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
    crypto = await import('@/lib/email/crypto');
  });

  it('seals and opens a refresh token', () => {
    const token = '1//0gxyz-a-google-refresh-token';
    const sealed = crypto.encryptToken(token);

    expect(sealed).not.toContain(token);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(crypto.decryptToken(sealed)).toBe(token);
  });

  it('never produces the same ciphertext twice', () => {
    // A fresh nonce every time, so two accounts with the same token do not
    // have the same row.
    expect(crypto.encryptToken('same-token')).not.toBe(crypto.encryptToken('same-token'));
  });

  it('refuses to open a tampered value rather than returning something wrong', () => {
    const sealed = crypto.encryptToken('a-token');
    const [version, iv, body, tag] = sealed.split('.');

    expect(crypto.decryptToken(`${version}.${iv}.${body}.${'A'.repeat(tag.length)}`)).toBeNull();
    expect(crypto.decryptToken(`${version}.${iv}.${'A'.repeat(body.length)}.${tag}`)).toBeNull();
    expect(crypto.decryptToken('not-sealed-at-all')).toBeNull();
    expect(crypto.decryptToken(null)).toBeNull();
  });

  it('says a key is needed rather than storing a token in the clear', async () => {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = '';
    try {
      expect(crypto.encryptionReady()).toBe(false);
      expect(() => crypto.encryptToken('a-token')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = key;
    }
  });

  it('refuses a key that is the wrong length', () => {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    try {
      expect(() => crypto.encryptToken('a-token')).toThrow(/32 bytes/);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = key;
    }
  });
});

describe('the OAuth round trip cannot be forged', () => {
  let crypto: typeof import('@/lib/email/crypto');

  beforeAll(async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
    crypto = await import('@/lib/email/crypto');
  });

  const state = () => ({
    businessId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    nonce: 'a-nonce',
    expires: Date.now() + 60_000,
  });

  it('reads back what it signed', () => {
    const original = state();
    expect(crypto.verifyState(crypto.signState(original))).toEqual(original);
  });

  it('refuses a state somebody edited', () => {
    // The attack this stops: a link that connects the attacker's mailbox to
    // your business, or yours to theirs.
    const signed = crypto.signState(state());
    const [body, signature] = signed.split('.');

    const swapped = Buffer.from(
      JSON.stringify({ ...state(), businessId: '99999999-9999-4999-8999-999999999999' }),
      'utf8'
    ).toString('base64url');

    expect(crypto.verifyState(`${swapped}.${signature}`)).toBeNull();
    expect(crypto.verifyState(`${body}.${'A'.repeat(signature.length)}`)).toBeNull();
    expect(crypto.verifyState('rubbish')).toBeNull();
    expect(crypto.verifyState(null)).toBeNull();
  });

  it('refuses one that has expired', () => {
    const stale = crypto.signState({ ...state(), expires: Date.now() - 1000 });
    expect(crypto.verifyState(stale)).toBeNull();
  });

  it('gives a different nonce every time', () => {
    expect(crypto.newNonce()).not.toBe(crypto.newNonce());
    expect(crypto.newNonce().length).toBeGreaterThan(16);
  });
});

describe('what the sync is allowed to do', () => {
  const root = join(import.meta.dirname, '..', 'src', 'lib', 'email');
  const sync = readFileSync(join(root, 'sync.ts'), 'utf8');
  const oauth = readFileSync(join(root, 'oauth.ts'), 'utf8');

  it('asks for read-only access to the mailbox', () => {
    // The application never deletes a customer's mail, so it does not hold the
    // permission that would let it.
    expect(oauth).toContain('gmail.readonly');
    expect(oauth).toContain("'Mail.Read'");
    expect(oauth).not.toMatch(/gmail\.modify|mail\.readwrite|Mail\.ReadWrite/i);
    expect(oauth).not.toMatch(/gmail\.send|Mail\.Send/i);
  });

  it('makes Google issue a refresh token rather than failing in an hour', () => {
    expect(oauth).toContain("access_type: 'offline'");
    expect(oauth).toContain("prompt: 'consent'");
  });

  it('takes the business from the account row, never from an argument', () => {
    expect(sync).toContain('const businessId = account.business_id;');
    // Nothing in the sync accepts a business id it could be handed.
    expect(sync).not.toMatch(/function sync\w*\([^)]*businessId: string[^)]*\)\s*:\s*Promise<SyncResult>\s*\{[\s\S]{0,200}from\('emails'\)/);
  });

  it('scopes every write to that one business', () => {
    const filters = [...sync.matchAll(/\.eq\('business_id',\s*([^)]+)\)/g)].map((m) => m[1].trim());
    expect(filters.length).toBeGreaterThan(3);
    for (const filter of filters) expect(filter).toBe('businessId');

    const inserts = [...sync.matchAll(/business_id:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    expect(inserts.length).toBeGreaterThan(2);
    for (const insert of inserts) expect(insert).toBe('businessId');
  });

  it('keys messages by the provider id, so a second sync is a no-op', () => {
    expect(sync).toContain('provider_message_id');
    expect(sync).toContain('known.has(message.providerMessageId)');
  });
});
