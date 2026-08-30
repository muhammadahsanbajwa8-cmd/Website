import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Logo } from '@/components/marketing';
import { ButtonLink, Card, CardBody } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/client';
import { OnboardingForm } from './form';

export const metadata = { title: 'Set up your business' };

export default async function OnboardingPage() {
  const session = await requireSession();

  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          {session.memberships.length > 0 ? (
            <ButtonLink href="/dashboard" variant="ghost" size="sm">
              Back to {session.memberships[0]!.businessName}
            </ButtonLink>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-5 pb-20 pt-6 sm:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {session.memberships.length > 0 ? 'Add another business' : 'Set up your business'}
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          This is what goes on your quotes and invoices. You can change any of it later in
          Settings — only the name is needed to start.
        </p>

        <Card className="mt-8">
          <CardBody>
            <OnboardingForm defaultEmail={session.email} />
          </CardBody>
        </Card>

        {session.memberships.length === 0 ? (
          <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
            Been invited to someone else&rsquo;s business? Open the invitation link they sent
            you instead, or{' '}
            <Link href="/login" className="text-[var(--accent)] hover:underline">
              sign in with that address
            </Link>
            .
          </p>
        ) : null}
      </main>
    </div>
  );
}
