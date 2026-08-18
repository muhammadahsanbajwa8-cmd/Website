import { forbidden, unauthenticated } from '../lib/errors.js';

// Must run after `authenticate`. Kept separate from it so the two failures stay
// distinguishable: 401 means "we do not know who you are", 403 means "we know,
// and the answer is no". Collapsing them into one middleware is how APIs end up
// returning 401 to a signed-in user, which tells them to log in again and does
// not help.
export function requireRole(...roles) {
  return function roleGuard(req, _res, next) {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('This action requires elevated privileges.'));
    }
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');
