import Link from 'next/link';
import { SignUpForm } from './form';

export const metadata = { title: 'Create an account' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; email?: string }>;
}) {
  const params = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        {params.invite
          ? 'Accept your invitation by creating an account with the address it was sent to.'
          : 'Free to start. You will set up your business next.'}
      </p>

      <SignUpForm invite={params.invite} email={params.email} />

      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
