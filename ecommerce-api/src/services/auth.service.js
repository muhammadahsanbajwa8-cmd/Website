import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword, burnTimeLikeAVerification } from '../lib/password.js';
import { signAccessToken } from '../lib/tokens.js';
import { conflict, unauthenticated } from '../lib/errors.js';
import { claimGuestCart } from './cart.service.js';

// Services know about business rules and Prisma. They never see req or res, and
// they never decide a status code — they throw a typed error and let the error
// handler map it. That is what makes them testable without HTTP.

export async function register({ email, password, name }, { sessionToken } = {}) {
  // Checked up front so the common case gets a clear 409 rather than a raw
  // constraint violation. This is a check-then-act race, and losing the race is
  // fine: the unique index still rejects the insert, and the error handler maps
  // P2002 to the same 409. The index is the guarantee; this is the nice message.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict('An account with that email already exists.');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, passwordHash, name: name ?? null },
    });
    await claimGuestCart(tx, created.id, sessionToken);
    return created;
  });

  return { user, accessToken: signAccessToken(user) };
}

export async function login({ email, password }, { sessionToken } = {}) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Spend the same time a real verification would, so response latency does
    // not reveal whether this email is registered. Without it, login is a free
    // account-enumeration oracle.
    await burnTimeLikeAVerification();
    throw unauthenticated('Email or password is incorrect.');
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    // Same message and same status as the unknown-email case, deliberately.
    throw unauthenticated('Email or password is incorrect.');
  }

  if (sessionToken) {
    await prisma.$transaction((tx) => claimGuestCart(tx, user.id, sessionToken));
  }

  return { user, accessToken: signAccessToken(user) };
}
