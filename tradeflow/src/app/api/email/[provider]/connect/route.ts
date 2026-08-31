import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireCapability } from '@/lib/session';
import { authorizeUrl, providerFor } from '@/lib/email/oauth';
import { encryptionReady, newNonce, signState } from '@/lib/email/crypto';

export const OAUTH_NONCE_COOKIE = 'tf_mailbox_oauth';

/**
 * Start connecting a mailbox.
 *
 * Two things travel to the provider and back: a signed `state`, which carries
 * which business and which person began this, and a nonce that is also written
 * to a short-lived cookie. The callback requires both to agree, so a link
 * someone sends you cannot attach their mailbox to your business.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  // Connecting a mailbox is a business-level change, so it takes the same
  // capability as the rest of the settings.
  const session = await requireCapability('business.edit');
  const { provider } = await params;

  const config = providerFor(provider);
  if (!config) {
    return NextResponse.redirect(
      new URL('/settings/mailboxes?error=not-configured', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
    );
  }

  // A refresh token is never written unencrypted, so without a key the
  // connection is refused before it starts rather than half-made.
  if (!encryptionReady()) {
    return NextResponse.redirect(
      new URL('/settings/mailboxes?error=no-key', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
    );
  }

  const nonce = newNonce();
  const state = signState({
    businessId: session.business.id,
    userId: session.userId,
    nonce,
    expires: Date.now() + 10 * 60 * 1000,
  });

  const store = await cookies();
  store.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(config, state));
}
