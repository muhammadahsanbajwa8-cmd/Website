import Link from 'next/link';
import { ForgotPasswordForm } from './form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        Enter your email address and we will send you a link to set a new one.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
