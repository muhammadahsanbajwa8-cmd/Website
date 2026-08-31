import 'server-only';

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Encrypting the mailbox tokens.
 *
 * A refresh token is a standing key to somebody's email. It is the most
 * dangerous value this application stores, so it never sits in the database in
 * a form the database can read: it is sealed here with AES-256-GCM before the
 * insert and opened here after the select.
 *
 * That is defence in depth, not the only defence. The columns are also revoked
 * from `authenticated` in migration 0003, so PostgREST will not return them to
 * anyone at all — only the service role, from server code, reaches them. This
 * layer is what makes a leaked database dump useless.
 *
 * The key comes from TOKEN_ENCRYPTION_KEY. Without it, connecting a mailbox is
 * refused outright rather than storing a token in the clear.
 */

const VERSION = 'v1';

export class MissingKeyError extends Error {
  constructor() {
    super(
      'TOKEN_ENCRYPTION_KEY is not set. Connecting a mailbox stores a refresh token, ' +
        'which is never written unencrypted. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
    this.name = 'MissingKeyError';
  }
}

/** The 32-byte key, however it was written in the environment. */
function key(): Buffer {
  const raw = env.tokenEncryptionKey;
  if (!raw) throw new MissingKeyError();

  // Accept base64, base64url or hex — whichever the person pasted.
  const decoded = /^[0-9a-f]{64}$/i.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64');

  if (decoded.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${decoded.length}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  return decoded;
}

/** True when tokens can be stored, i.e. a valid key is configured. */
export function encryptionReady(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * Seal a token. The output carries its own nonce and tag, and a version, so
 * the format can change later without a migration guessing game.
 *
 *   v1.<iv base64url>.<ciphertext base64url>.<tag base64url>
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    VERSION,
    iv.toString('base64url'),
    sealed.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/**
 * Open a sealed token. Returns null rather than throwing when the value cannot
 * be opened — a rotated key should disconnect the mailbox and ask the person
 * to reconnect, not crash the page that happened to read the row.
 */
export function decryptToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The OAuth `state` parameter.
 *
 * It travels to Google or Microsoft and back through the person's browser, so
 * it is signed rather than trusted: the callback verifies the signature before
 * it will exchange a code for a token. That is what stops someone handing your
 * signed-in browser a link that connects *their* mailbox to your business.
 */
export interface OAuthState {
  businessId: string;
  userId: string;
  nonce: string;
  expires: number;
}

function stateKey(): Buffer {
  // The state is short-lived and never leaves the round trip, so it is signed
  // with the service-role key rather than needing a key of its own.
  return createHmac('sha256', env.serviceRoleKey).update('oauth-state').digest();
}

export function signState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyState(value: string | null): OAuthState | null {
  if (!value) return null;

  const [body, signature] = value.split('.');
  if (!body || !signature) return null;

  const expected = createHmac('sha256', stateKey()).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    if (!state.businessId || !state.userId) return null;
    if (typeof state.expires !== 'number' || state.expires < Date.now()) return null;
    return state;
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}
