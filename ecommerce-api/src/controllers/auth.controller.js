import * as authService from '../services/auth.service.js';
import { publicUser } from '../lib/serialize.js';

// Controllers translate HTTP into a service call and back. No Prisma, no
// business rules, no status-code logic beyond the success code.

// The guest cart token travels in a header rather than the body, so the same
// mechanism works for every cart route without changing their payloads.
const cartSessionHeader = (req) => req.get('x-cart-session') || null;

export async function register(req, res, next) {
  try {
    const { user, accessToken } = await authService.register(req.body, {
      sessionToken: cartSessionHeader(req),
    });
    res.status(201).json({ user: publicUser(user), accessToken });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { user, accessToken } = await authService.login(req.body, {
      sessionToken: cartSessionHeader(req),
    });
    res.status(200).json({ user: publicUser(user), accessToken });
  } catch (error) {
    next(error);
  }
}

// Lets a client confirm a token is still good and read its own record.
export function me(req, res) {
  res.status(200).json({ user: publicUser(req.user) });
}
