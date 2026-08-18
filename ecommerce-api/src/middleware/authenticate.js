import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { unauthenticated } from '../lib/errors.js';

function bearerToken(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

// Loads the user named by a valid token, or returns null.
//
// Note that this hits the database on every authenticated request rather than
// trusting the `role` inside the token. That costs one primary-key lookup and
// buys two things: demoting an admin takes effect immediately instead of when
// their token expires, and a deleted user's token stops working at once. A
// token is a claim about who you were 15 minutes ago; the database is the
// authority on what you may do now.
async function resolveUser(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload?.sub) return null;

  return prisma.user.findUnique({ where: { id: payload.sub } });
}

// For routes that require a signed-in user. 401 otherwise.
export async function authenticate(req, _res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return next(unauthenticated('A valid access token is required.'));
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// For routes that work signed in OR signed out — the cart, and the auth routes
// themselves, which accept a guest cart token to claim. A bad or expired token
// is treated as no token rather than an error, so an expired session degrades
// a visitor to a guest instead of blocking them.
export async function authenticateOptional(req, _res, next) {
  try {
    req.user = (await resolveUser(req)) ?? null;
    next();
  } catch (error) {
    next(error);
  }
}
