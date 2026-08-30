import Link from 'next/link';
import { Logo } from '@/components/marketing';
import { ButtonLink, Card, CardBody } from '@/components/ui';
import { ResendConfirmation } from './resend';

export const metadata = { title: 'Confirm your email' };

const EXPLANATIONS: Record<string, string> = {
  missing: 'That link did not carry a confirmation token. It may have been truncated by an email client.',
  expired: 'That link has expired. Confirmation links last 24 hours and reset links last one hour.',
};

function explain(error: string | undefined): string {
  if (!error) {
    return 'Open the link in the email we sent you. It signs you in and confirms the address at the same time.';
  }
  if (EXPLANATIONS[error]) return EXPLANATIONS[error]!;
  if (/expired|invalid/i.test(error)) return EXPLANATIONS.expired!;
  return error;
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <Link href="/" aria-label="TradeFlow home" className="mb-8">
        <Logo />
      </Link>

      <Card className="w-full max-w-md">
        <CardBody>
          <h1 className="text-xl font-semibold tracking-tight">
            {error ? 'That link did not work' : 'Check your email'}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{explain(error)}</p>

          <div className="mt-6">
            <ResendConfirmation />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/login" variant="secondary" size="sm">
              Back to sign in
            </ButtonLink>
            <ButtonLink href="/forgot-password" variant="ghost" size="sm">
              Reset password instead
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
