import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/session';
import { acceptInviteAction } from '@/app/(app)/team/actions';
import { Logo } from '@/components/marketing';
import { ButtonLink, Card, CardBody, Icon, InfoNote, icons } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { roleLabel, type TeamRole } from '@/lib/permissions';

export const metadata = { title: 'Join the team', robots: { index: false } };

/**
 * The invitation landing page.
 *
 * It is read with the service role because the person opening it is, by
 * definition, not yet a member of anything — but only the business name and
 * the role are shown, and the token is checked again inside
 * `accept_team_invite()` before anything is granted.
 */
export default async function InvitePage({
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
    .from('team_members')
    .select('email, role, full_name, business_id, accepted_at')
    .eq('invite_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  const { data: business } = invite
    ? await admin.from('businesses').select('name').eq('id', invite.business_id).maybeSingle()
    : { data: null };

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
                It may have been used already, or withdrawn. Ask whoever invited you to send a new
                one.
              </p>
              <ButtonLink href="/login" variant="secondary">
                Sign in
              </ButtonLink>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">
                Join {business?.name ?? 'the team'}
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                You have been invited as{' '}
                <strong className="text-[var(--text-strong)]">
                  {roleLabel(invite.role as TeamRole)}
                </strong>
                . The invitation is for <strong className="text-[var(--text-strong)]">{invite.email}</strong>
                {' '}and works only for that address.
              </p>

              {error ? <InfoNote tone="danger">{decodeURIComponent(error)}</InfoNote> : null}

              {session ? (
                session.email.toLowerCase() === invite.email.toLowerCase() ? (
                  <form action={acceptInviteAction}>
                    <input type="hidden" name="token" value={token} />
                    <SubmitButton size="lg" className="w-full" pendingLabel="Joining…">
                      <Icon path={icons.check} size={18} />
                      Join {business?.name ?? 'the team'}
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
                    href={`/signup?invite=${token}&email=${encodeURIComponent(invite.email)}`}
                    size="lg"
                    className="w-full"
                  >
                    Create an account
                  </ButtonLink>
                  <ButtonLink
                    href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
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
