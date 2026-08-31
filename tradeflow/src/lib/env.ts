/**
 * Environment access, in one place.
 *
 * Two rules hold throughout the app:
 *  - a secret is read only from a module that never reaches the browser;
 *  - a missing optional key degrades the feature that needs it and nothing
 *    else, so the platform runs with Supabase configured and nothing more.
 */

import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('your-') || value.includes('YOUR-PROJECT')) {
    throw new Error(
      `${name} is not configured. Copy .env.example to .env.local and fill it in, ` +
        'or run `npm run setup`.'
    );
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === '') return null;
  return value;
}

export const env = {
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  /** Server only. Bypasses RLS — used deliberately, in named places. */
  get serviceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get appUrl() {
    return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  },
  get anthropicKey() {
    return optional('ANTHROPIC_API_KEY');
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  },
  get emailProvider() {
    const value = (process.env.EMAIL_PROVIDER || 'log').toLowerCase();
    return value === 'resend' || value === 'smtp' ? value : 'log';
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || 'TradeFlow <no-reply@example.com>';
  },
  get resendKey() {
    return optional('RESEND_API_KEY');
  },
  /**
   * Where the Resend API lives. Overridable so the send path can be exercised
   * end to end against a local stand-in — the request, the base64 attachment,
   * the success and the failure — without mailing anyone. Production leaves it
   * unset and talks to Resend.
   */
  get resendBaseUrl() {
    return (process.env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/$/, '');
  },
  get smtpUrl() {
    return optional('SMTP_URL');
  },
  get googleOAuth() {
    const id = optional('GOOGLE_OAUTH_CLIENT_ID');
    const secret = optional('GOOGLE_OAUTH_CLIENT_SECRET');
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  },
  get microsoftOAuth() {
    const id = optional('MICROSOFT_OAUTH_CLIENT_ID');
    const secret = optional('MICROSOFT_OAUTH_CLIENT_SECRET');
    return id && secret
      ? { clientId: id, clientSecret: secret, tenant: process.env.MICROSOFT_OAUTH_TENANT || 'common' }
      : null;
  },
  // --- payments -------------------------------------------------------------
  // Absent, online payment is simply off: an invoice can still be issued and a
  // bank transfer recorded against it by hand.
  get stripeSecretKey() {
    return optional('STRIPE_SECRET_KEY');
  },
  get stripePublishableKey() {
    return optional('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  },
  get stripeWebhookSecret() {
    return optional('STRIPE_WEBHOOK_SECRET');
  },
  /** Overridable so the payment path can be exercised against a stand-in. */
  get stripeBaseUrl() {
    return optional('STRIPE_BASE_URL');
  },
  get tokenEncryptionKey() {
    return optional('TOKEN_ENCRYPTION_KEY');
  },
};

/** Which optional integrations are live. Rendered on the settings page. */
export interface FeatureStatus {
  key: string;
  name: string;
  ready: boolean;
  missing: string[];
  note: string;
}

export function featureStatus(): FeatureStatus[] {
  return [
    {
      key: 'ai',
      name: 'AI assistant',
      ready: Boolean(env.anthropicKey),
      missing: env.anthropicKey ? [] : ['ANTHROPIC_API_KEY'],
      note: 'Summarising email, drafting replies and answering questions about your business data.',
    },
    {
      key: 'email_send',
      name: 'Outbound email',
      ready: env.emailProvider !== 'log',
      missing:
        env.emailProvider === 'log'
          ? ['EMAIL_PROVIDER + RESEND_API_KEY or SMTP_URL']
          : env.emailProvider === 'resend' && !env.resendKey
            ? ['RESEND_API_KEY']
            : env.emailProvider === 'smtp' && !env.smtpUrl
              ? ['SMTP_URL']
              : [],
      note:
        env.emailProvider === 'log'
          ? 'Messages are recorded in full and shown in the outbox, but not delivered.'
          : 'Quotes, invoices and replies are delivered to the recipient.',
    },
    {
      key: 'payments',
      name: 'Online payments',
      ready: Boolean(process.env.STRIPE_SECRET_KEY),
      missing: process.env.STRIPE_SECRET_KEY
        ? process.env.STRIPE_WEBHOOK_SECRET
          ? []
          : ['STRIPE_WEBHOOK_SECRET']
        : ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      note: process.env.STRIPE_SECRET_KEY
        ? 'Customers can pay an invoice by card. The money goes to your own connected account.'
        : 'Invoices can still be issued and payments recorded by hand; nothing can be paid online.',
    },
    {
      key: 'mailbox_google',
      name: 'Gmail mailbox connection',
      ready: Boolean(env.googleOAuth),
      missing: env.googleOAuth ? [] : ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      note: 'Google issues these to a named application, so they cannot be created from here.',
    },
    {
      key: 'mailbox_microsoft',
      name: 'Outlook mailbox connection',
      ready: Boolean(env.microsoftOAuth),
      missing: env.microsoftOAuth
        ? []
        : ['MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET'],
      note: 'Microsoft issues these to a named application, so they cannot be created from here.',
    },
    {
      key: 'token_encryption',
      name: 'Mailbox token encryption',
      ready: Boolean(env.tokenEncryptionKey),
      missing: env.tokenEncryptionKey ? [] : ['TOKEN_ENCRYPTION_KEY'],
      note: 'Required before a mailbox can be connected: refresh tokens are never stored in the clear.',
    },
  ];
}

export function isConfigured(): boolean {
  try {
    return Boolean(env.supabaseUrl && env.supabaseAnonKey);
  } catch {
    return false;
  }
}
