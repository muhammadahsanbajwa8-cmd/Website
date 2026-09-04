'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { audit, ACTIVE_BUSINESS_COOKIE } from '@/lib/session';
import { landingPath } from '@/lib/customer-session';
import {
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';

/**
 * Authentication.
 *
 * Supabase Auth holds the credentials; a trigger in migration 0002 mirrors
 * each new user into `profiles` and claims any team invitation issued to that
 * address, so signing up from an invite link puts you straight into the right
 * business.
 */

export async function signUpAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${env.appUrl}/auth/confirm`,
    },
  });

  if (error) {
    await audit(null, {
      action: 'auth.signup',
      outcome: 'denied',
      detail: { email: parsed.data.email, reason: error.message },
    });
    // Supabase returns "User already registered" here; say it plainly rather
    // than pretending the account was created.
    if (/already registered/i.test(error.message)) {
      return fail('An account already exists for that email address. Sign in instead.');
    }
    return fail(describeError(error));
  }

  await audit(null, {
    action: 'auth.signup',
    detail: { email: parsed.data.email },
    ...(data.user ? { entityType: 'user', entityId: data.user.id } : {}),
  });

  // With email confirmation on, there is no session yet.
  if (!data.session) {
    return ok(
      `Check ${parsed.data.email} for a confirmation link. Open it and you will be signed in.`
    );
  }

  // A customer who signed up from an invitation is already attached to their
  // account by the time the session exists, so this lands them in the portal
  // rather than asking them to set up a business they do not have.
  redirect(await landingPath());
}

export async function signInAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const next = formData.get('next');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    await audit(null, {
      action: 'auth.signin',
      outcome: 'denied',
      detail: { email: parsed.data.email },
    });
    if (/email not confirmed/i.test(error.message)) {
      return fail('Confirm your email address first — check your inbox for the link.');
    }
    // Deliberately vague: which half was wrong is not the caller's business.
    return fail('That email address and password do not match an account.');
  }

  await audit(null, { action: 'auth.signin', detail: { email: parsed.data.email } });

  const destination =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
      ? next
      : await landingPath();
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await audit(null, { action: 'auth.signout' });
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_BUSINESS_COOKIE);

  redirect('/login');
}

export async function forgotPasswordAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.appUrl}/auth/confirm?next=/reset-password`,
  });

  await audit(null, { action: 'auth.password_reset_requested', detail: { email: parsed.data.email } });

  // Always the same answer, whether or not the address is registered: the
  // response must not reveal who has an account.
  return ok(
    `If an account exists for ${parsed.data.email}, a reset link is on its way. ` +
      'The link works once and expires in an hour.'
  );
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail('That reset link has expired. Request a new one and try again.');
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(describeError(error));

  await audit(null, { action: 'auth.password_changed', entityType: 'user', entityId: user.id });
  redirect('/dashboard');
}

export async function resendConfirmationAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return fail('Enter the email address you signed up with.');

  const supabase = await createClient();
  await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${env.appUrl}/auth/confirm` },
  });

  return ok(`If that address is waiting on confirmation, another link is on its way.`);
}
