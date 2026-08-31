import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { connectableProviders } from '@/lib/email/oauth';
import { encryptionReady } from '@/lib/email/crypto';
import { formatRelative } from '@/lib/format';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  icons,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { SyncButton } from './form';
import { disconnectMailboxAction } from './actions';
import type { EmailAccount } from '@/lib/database.types';

export const metadata = { title: 'Mailboxes' };

/** What went wrong, said in words rather than in a code. */
const REASONS: Record<string, string> = {
  'not-configured':
    'That provider has no client id and secret on this server, so there is nothing to connect to yet.',
  'no-key':
    'TOKEN_ENCRYPTION_KEY is not set. A refresh token is never written unencrypted, so the connection was refused rather than half-made.',
  denied: 'You cancelled at the provider, so nothing was connected.',
  state:
    'That link did not come from this browser, or it had gone stale. Start the connection again from this page.',
  session: 'Your session changed while you were away. Sign in and try again.',
  permission: 'Only an owner or admin can connect a mailbox.',
  'no-code': 'The provider sent you back without an authorisation code.',
  'no-refresh-token':
    'The provider did not issue a refresh token, which means the connection would stop working within the hour. Nothing was saved. Remove this app from your Google account’s third-party access and connect again.',
  'no-address': 'The provider would not say which mailbox that was.',
  exchange: 'The provider refused the exchange.',
};

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; detail?: string }>;
}) {
  const session = await requireBusiness();
  const { connected, error, detail } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .order('created_at');

  const accounts = (data ?? []) as EmailAccount[];
  const providers = connectableProviders();
  const anyConfigured = providers.some((provider) => provider.configured);
  const keyReady = encryptionReady();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Mailboxes"
        description="Connect the mailbox you already use, so what customers send you lands on the job it belongs to."
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
      />

      {connected ? (
        <div className="mb-5">
          <InfoNote tone="success">
            <strong>{connected}</strong> is connected. Press “Sync now” to bring in the last month,
            or wait for the next scheduled sync.
          </InfoNote>
        </div>
      ) : null}

      {error ? (
        <div className="mb-5">
          <InfoNote tone="danger">
            {REASONS[error] ?? 'That did not work.'}
            {detail ? <span className="mt-1 block text-xs opacity-80">{detail}</span> : null}
          </InfoNote>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Connected"
          description="Read-only. Nothing here can delete or alter a message in your mailbox."
        />
        {accounts.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={icons.emails}
              title="No mailbox connected"
              description="Sending already works — quotes, invoices and reports go out from here and are recorded against the job. Connecting a mailbox is what brings the replies back in."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Icon path={icons.emails} size={18} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--text-strong)]">
                      {account.email_address}
                    </span>
                    <Badge tone="neutral">
                      {account.provider === 'google' ? 'Gmail' : 'Outlook'}
                    </Badge>
                    {account.sync_error ? <Badge tone="danger">Needs attention</Badge> : null}
                  </div>

                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {account.sync_error
                      ? account.sync_error
                      : account.last_synced_at
                        ? `Last checked ${formatRelative(account.last_synced_at)}.`
                        : 'Not synced yet.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {session.can('emails.view') ? <SyncButton accountId={account.id} /> : null}
                  {session.can('business.edit') ? (
                    <form action={disconnectMailboxAction}>
                      <input type="hidden" name="id" value={account.id} />
                      <ConfirmSubmit
                        confirmTitle="Disconnect this mailbox?"
                        confirmBody="The tokens are destroyed and nothing further is brought in. Mail already filed against a job stays where it is."
                        confirmLabel="Disconnect"
                      >
                        Disconnect
                      </ConfirmSubmit>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Connect a mailbox" />
        <CardBody className="space-y-4">
          {!keyReady ? (
            <InfoNote tone="warning">
              <strong>TOKEN_ENCRYPTION_KEY is not set.</strong> A refresh token is a standing key to
              your email, so it is never written to the database unencrypted — connecting is refused
              until there is a key to seal it with. Generate one with{' '}
              <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-xs">
                node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
              </code>
              .
            </InfoNote>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((provider) => (
              <div
                key={provider.key}
                className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[var(--text-strong)]">{provider.name}</span>
                  {provider.configured ? (
                    <Badge tone="success">Available</Badge>
                  ) : (
                    <Badge tone="neutral">Not set up</Badge>
                  )}
                </div>

                {provider.configured ? (
                  session.can('business.edit') && keyReady ? (
                    <ButtonLink
                      href={`/api/email/${provider.key}/connect`}
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                    >
                      Connect {provider.name}
                    </ButtonLink>
                  ) : (
                    <Button variant="secondary" size="sm" className="mt-3" disabled>
                      Connect {provider.name}
                    </Button>
                  )
                ) : (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Needs {provider.missing.join(' and ')} in the environment.
                  </p>
                )}
              </div>
            ))}
          </div>

          {!anyConfigured ? (
            <InfoNote>
              Neither provider is set up on this server. Both client secrets are issued by Google
              and Microsoft to an application you register with them, so they cannot be created
              from here — see the README for the two-minute version.
            </InfoNote>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardBody>
          <h2 className="text-sm font-medium text-[var(--text-strong)]">What connecting does</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-muted)]">
            <li>
              Brings in the last month of mail on the first sync, and only what is new after that.
            </li>
            <li>
              Matches each message to a customer by the addresses on it, and files it against that
              customer’s current job. You can change where anything is filed.
            </li>
            <li>
              Asks for read-only access. It cannot send, delete or alter anything in your mailbox —
              sending goes out through this application’s own settings.
            </li>
            <li>
              Records attachment names and sizes, not the files. Your customers’ attachments stay in
              your mailbox.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
