import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBusinessSession, audit } from '@/lib/session';
import { exchangeCode, providerFor, readProfile } from '@/lib/email/oauth';
import { encryptToken, verifyState } from '@/lib/email/crypto';
import { env } from '@/lib/env';
import { OAUTH_NONCE_COOKIE } from '../connect/route';

/**
 * The provider sends the person back here.
 *
 * Nothing in this request is trusted on its face. Before a code is exchanged
 * for a token, all four of these must hold:
 *
 *   1. the `state` carries our signature,
 *   2. its nonce matches the cookie set when the flow began,
 *   3. it has not expired,
 *   4. the person is still signed in, as the same user, in the same business.
 *
 * Any of them failing sends them back to the settings page with a reason and
 * nothing written.
 */

const back = (query: string) => NextResponse.redirect(`${env.appUrl}/settings/mailboxes?${query}`);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const url = new URL(request.url);

  // The person pressed cancel on the provider's consent screen.
  const denied = url.searchParams.get('error');
  if (denied) return back(`error=denied&detail=${encodeURIComponent(denied)}`);

  const config = providerFor(provider);
  if (!config) return back('error=not-configured');

  const state = verifyState(url.searchParams.get('state'));
  if (!state) return back('error=state');

  const store = await cookies();
  const nonce = store.get(OAUTH_NONCE_COOKIE)?.value ?? null;
  store.delete(OAUTH_NONCE_COOKIE);
  if (!nonce || nonce !== state.nonce) return back('error=state');

  // The session is checked independently of the state: a signed state proves
  // where the flow started, not that the person finishing it is the same one.
  const session = await getBusinessSession();
  if (!session || session.userId !== state.userId || session.business.id !== state.businessId) {
    return back('error=session');
  }
  if (!session.can('business.edit')) return back('error=permission');

  const code = url.searchParams.get('code');
  if (!code) return back('error=no-code');

  try {
    const tokens = await exchangeCode(config, code);

    // Google hands out a refresh token on the first consent only. Without one
    // the connection would work for an hour and then quietly stop, so it is
    // refused rather than half-made.
    if (!tokens.refreshToken) {
      return back('error=no-refresh-token');
    }

    const profile = await readProfile(config, tokens.accessToken);
    if (!profile.address) return back('error=no-address');

    const admin = createAdminClient();

    // Reconnecting the same mailbox updates it rather than making a second
    // row — including one that was previously disconnected.
    const { data: existing } = await admin
      .from('email_accounts')
      .select('id')
      .eq('business_id', session.business.id)
      .eq('email_address', profile.address)
      .maybeSingle();

    const values = {
      business_id: session.business.id,
      user_id: session.userId,
      provider: config.key,
      email_address: profile.address,
      display_name: profile.name,
      refresh_token_enc: encryptToken(tokens.refreshToken),
      access_token_enc: encryptToken(tokens.accessToken),
      token_expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      is_active: true,
      sync_error: null,
      deleted_at: null,
    };

    if (existing) {
      await admin.from('email_accounts').update(values).eq('id', existing.id);
    } else {
      await admin.from('email_accounts').insert(values);
    }

    await audit(session.business.id, {
      action: 'mailbox.connect',
      entityType: 'email_account',
      entityId: existing?.id ?? null,
      // The address, never the token.
      detail: { provider: config.key, address: profile.address },
    });

    return back(`connected=${encodeURIComponent(profile.address)}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The connection failed.';
    return back(`error=exchange&detail=${encodeURIComponent(detail.slice(0, 200))}`);
  }
}
