import { ResetPasswordForm } from './form';

export const metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        You opened a valid reset link. Set a new password and you will be signed in.
      </p>
      <ResetPasswordForm />
    </div>
  );
}
