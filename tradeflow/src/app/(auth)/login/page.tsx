import Link from 'next/link';
import { LoginForm } from './form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmed?: string }>;
}) {
  const params = await searchParams;
  // Only same-origin paths are ever followed after sign-in.
  const next =
    params.next && params.next.startsWith('/') && !params.next.startsWith('//')
      ? params.next
      : undefined;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        Welcome back. Pick up where the job left off.
      </p>

      <LoginForm next={next} confirmed={params.confirmed === '1'} />

      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        No account yet?{' '}
        <Link href="/signup" className="font-medium text-[var(--accent)] hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
