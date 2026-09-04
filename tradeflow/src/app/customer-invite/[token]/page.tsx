import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/session';
import { Logo } from '@/components/marketing';
import { ButtonLink, Card, CardBody, Icon, InfoNote, icons } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { acceptCustomerInviteAction } from './actions';

export const metadata = { title: 'Your account', robots: { index: false } };

/**
 * Where a customer's invitation lands.
 *
 * Read with the service role, because whoever is opening it is by definition
 * not yet linked to anything — but only the business's name and the address it
 * was sent to are shown, and the token is checked again inside
 * `accept_customer_invite()` before any access is granted.
 */
export default async function CustomerInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from('customer_users')
    .select('email, business_id, customer_id, accepted_at')
    .eq('invite_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  const [{ data: business }, { data: customer }] = invite
    ? await Promise.all([
        admin.from('businesses').select('name').eq('id', invite.business_id).maybeSingle(),
        admin.from('customers').select('name').eq('id', invite.customer_id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  const session = await getSession();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <Link href="/" aria-label="TradeFlow home" className="mb-8">
        <Logo />
      </Link>

      <Card className="w-full max-w-md">
        <CardBody className="space-y-4">
          {!invite ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">
                That invitation is not valid
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                It may have been used already, or withdrawn. Ask whoever sent it to send a new one
                — or just reply to the email it came in.
              </p>
              <ButtonLink href="/login" variant="secondary">
                Sign in
              </ButtonLink>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">
                Your account with {business?.name ?? 'us'}
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                See your bookings, the reports written up after each visit, your invoices, and pay
                any that are due. The invitation is for{' '}
                <strong className="text-[var(--text-strong)]">{invite.email}</strong> and works only
                for that address.
                {customer?.name ? ` It is for ${customer.name}'s records.` : ''}
              </p>

              {error ? <InfoNote tone="danger">{decodeURIComponent(error)}</InfoNote> : null}

              {session ? (
                session.email.toLowerCase() === invite.email.toLowerCase() ? (
                  <form action={acceptCustomerInviteAction}>
                    <input type="hidden" name="token" value={token} />
                    <SubmitButton size="lg" className="w-full" pendingLabel="Opening…">
                      <Icon path={icons.check} size={18} />
                      Open my account
                    </SubmitButton>
                  </form>
                ) : (
                  <InfoNote tone="warning">
                    You are signed in as {session.email}, but this invitation was sent to{' '}
                    {invite.email}. Sign out and sign in with that address.
                  </InfoNote>
                )
              ) : (
                <div className="space-y-2">
                  <ButtonLink
                    href={`/signup?customer_invite=${token}&email=${encodeURIComponent(invite.email)}`}
                    size="lg"
                    className="w-full"
                  >
                    Set up my login
                  </ButtonLink>
                  <ButtonLink
                    href={`/login?next=${encodeURIComponent(`/customer-invite/${token}`)}`}
                    variant="secondary"
                    size="lg"
                    className="w-full"
                  >
                    I already have one
                  </ButtonLink>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
