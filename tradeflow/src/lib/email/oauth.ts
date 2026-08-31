import 'server-only';

import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptToken, encryptToken } from './crypto';
import type { EmailAccountRow, MailboxProvider } from '@/lib/database.types';

/**
 * Connecting a mailbox.
 *
 * Two providers, one shape. Google and Microsoft both do authorisation-code
 * OAuth with refresh tokens, so the differences — endpoints, scopes, the
 * parameter that makes a refresh token actually appear — are declared in a
 * table here and everything else is written once.
 *
 * Neither client id can be created from this application: Google and Microsoft
 * issue them to a named app that a person registers. So this module is written
 * to be honest about that rather than to fail obscurely — `providerFor` returns
 * null when the credentials are absent, and the interface says which two
 * variables are missing.
 */

export type ConnectableProvider = Extract<MailboxProvider, 'google' | 'microsoft'>;

export interface ProviderConfig {
  key: ConnectableProvider;
  name: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra parameters the provider needs on the authorize request. */
  authorizeExtras: Record<string, string>;
  /** Where the person's own address is read from, once connected. */
  profileUrl: string;
  readProfile: (json: Record<string, unknown>) => { address: string; name: string | null };
}

export function providerFor(key: string): ProviderConfig | null {
  if (key === 'google') {
    const credentials = env.googleOAuth;
    if (!credentials) return null;
    return {
      key: 'google',
      name: 'Gmail',
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      // Read-only on the mailbox. This application never deletes a customer's
      // mail, and does not ask for the permission that would let it.
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      // Without both of these Google returns a refresh token once and never
      // again, and the connection silently stops working in an hour.
      authorizeExtras: { access_type: 'offline', prompt: 'consent' },
      profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      readProfile: (json) => ({
        address: String(json.email ?? ''),
        name: (json.name as string | undefined) ?? null,
      }),
    };
  }

  if (key === 'microsoft') {
    const credentials = env.microsoftOAuth;
    if (!credentials) return null;
    const tenant = credentials.tenant;
    return {
      key: 'microsoft',
      name: 'Outlook',
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scopes: ['offline_access', 'openid', 'email', 'profile', 'Mail.Read'],
      authorizeExtras: { response_mode: 'query' },
      profileUrl: 'https://graph.microsoft.com/v1.0/me',
      readProfile: (json) => ({
        address: String(json.mail ?? json.userPrincipalName ?? ''),
        name: (json.displayName as string | undefined) ?? null,
      }),
    };
  }

  return null;
}

/** The two providers, with whether each is configured. For the settings page. */
export function connectableProviders(): {
  key: ConnectableProvider;
  name: string;
  configured: boolean;
  missing: string[];
}[] {
  return [
    {
      key: 'google',
      name: 'Gmail',
      configured: Boolean(env.googleOAuth),
      missing: env.googleOAuth ? [] : ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    },
    {
      key: 'microsoft',
      name: 'Outlook',
      configured: Boolean(env.microsoftOAuth),
      missing: env.microsoftOAuth
        ? []
        : ['MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET'],
    },
  ];
}

export function redirectUri(provider: ConnectableProvider): string {
  return `${env.appUrl}/api/email/${provider}/callback`;
}

export function authorizeUrl(config: ProviderConfig, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri(config.key));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  for (const [name, value] of Object.entries(config.authorizeExtras)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
}

async function requestTokens(
  config: ProviderConfig,
  body: Record<string, string>
): Promise<TokenSet> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = String(json.error_description ?? json.error ?? response.statusText);
    throw new Error(`${config.name} refused the token request: ${detail}`);
  }

  const expiresIn = Number(json.expires_in ?? 3600);
  return {
    accessToken: String(json.access_token ?? ''),
    refreshToken: (json.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: String(json.scope ?? config.scopes.join(' ')).split(/\s+/).filter(Boolean),
  };
}

export function exchangeCode(config: ProviderConfig, code: string): Promise<TokenSet> {
  return requestTokens(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config.key),
  });
}

export function refreshTokens(config: ProviderConfig, refreshToken: string): Promise<TokenSet> {
  return requestTokens(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function readProfile(
  config: ProviderConfig,
  accessToken: string
): Promise<{ address: string; name: string | null }> {
  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${config.name} would not say which mailbox this is (${response.status}).`);
  }
  return config.readProfile((await response.json()) as Record<string, unknown>);
}

/**
 * A usable access token for an account, refreshing it if it has expired.
 *
 * Reads and writes the encrypted columns with the service role, which is the
 * only role that can see them at all. The caller must already have established
 * that this account belongs to the business it is acting for — this function
 * takes an account row, not an id, precisely so it cannot be called with an id
 * from a URL.
 */
export async function accessTokenFor(account: EmailAccountRow): Promise<string> {
  const config = providerFor(account.provider);
  if (!config) {
    throw new Error(
      `${account.provider} is no longer configured. The mailbox stays connected but cannot sync ` +
        'until its client id and secret are set again.'
    );
  }

  const existing = decryptToken(account.access_token_enc);
  const expires = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;

  // A minute of slack, so a token does not expire mid-request.
  if (existing && expires > Date.now() + 60_000) return existing;

  const refresh = decryptToken(account.refresh_token_enc);
  if (!refresh) {
    throw new Error(
      'This mailbox has no usable refresh token. Disconnect it and connect it again.'
    );
  }

  const tokens = await refreshTokens(config, refresh);

  const admin = createAdminClient();
  await admin
    .from('email_accounts')
    .update({
      access_token_enc: encryptToken(tokens.accessToken),
      // Google returns a new refresh token only sometimes; keep the old one
      // when it does not.
      ...(tokens.refreshToken ? { refresh_token_enc: encryptToken(tokens.refreshToken) } : {}),
      token_expires_at: tokens.expiresAt,
      sync_error: null,
    })
    .eq('id', account.id);

  return tokens.accessToken;
}
