// Access tokens.

import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function signAccessToken(user) {
  return jwt.sign(
    // `role` rides along so a caller can see what they are without a round
    // trip. It is NOT what authorisation reads — see middleware/authenticate.js
    // for why the database stays authoritative.
    { role: user.role },
    config.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: config.JWT_EXPIRES_IN,
      issuer: 'ecommerce-api',
    },
  );
}

// Returns the payload, or null for anything wrong: bad signature, expired,
// wrong issuer, malformed. The caller decides what a failure means, because
// "no token" and "bad token" are the same 401 to a client but different
// situations for a permissive route.
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET, { issuer: 'ecommerce-api' });
  } catch {
    return null;
  }
}
